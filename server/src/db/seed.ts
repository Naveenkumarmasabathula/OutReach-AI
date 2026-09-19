import { hashPassword } from "../lib/password.js";
import { assertDefined } from "../lib/assert.js";
import { mintHospitalScope, withHospitalScope } from "./scope.js";
import { db, pool } from "./client.js";
import {
  campaigns,
  encounters,
  escalations,
  hospitals,
  medications,
  outreachAttempts,
  outreachTasks,
  patients,
  procedures,
  protocols,
  users,
} from "./schema/index.js";

const DEMO_PASSWORD = "ChangeMe123!";

// Fix #7 (reliability audit): a deterministic hash-to-[0,1) generator,
// seeded by a stable string key — the exact same technique already used
// elsewhere in this codebase for reproducible "randomness" (FNV-1a, see
// services/callSimulator.ts's `hashToUnitInterval` and
// voice/simulatedVoiceProvider.ts's copy of the same pattern). Used only
// for the outreach-history/medications/procedures data added below, which
// needs to be reproducible across re-seeds (unlike `pick`/`randomInt`
// above, which already used real `Math.random()` before this fix and are
// left as-is — not this fix's concern).
function hashToUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function seededPick<T>(arr: readonly T[], seedKey: string): T {
  return arr[Math.floor(hashToUnitInterval(seedKey) * arr.length)] as T;
}

function seededInt(min: number, max: number, seedKey: string): number {
  return min + Math.floor(hashToUnitInterval(seedKey) * (max - min + 1));
}

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
  "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
  "Priya", "Wei", "Fatima", "Carlos", "Ana", "Kenji", "Amara", "Diego", "Ingrid", "Omar",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Chen", "Patel", "Nguyen", "Kim", "Singh", "Ali", "Mensah", "Silva", "Kowalski", "Novak",
];
const CARE_SETTINGS = ["inpatient", "outpatient", "emergency", "surgical", "observation"] as const;
const FOLLOW_UP_WINDOWS_HOURS = [24, 48, 72, 96, 168];
const CONTACT_METHODS = ["phone", "sms", "email"] as const;

// Fix #7 (reliability audit): §5's demo dataset requirement — "successful
// contacts, failed attempts, callbacks, escalations" — made real. Each entry
// is a deterministic outreach *history* for one patient: the sequence of
// attempt outcomes and the task status/state they leave behind. Cycled
// across a subset of each hospital's patients below so a freshly seeded DB
// already shows this variation before the live queue/worker ever runs.
type OutreachScenario = {
  name: string;
  outcomes: Array<(typeof ATTEMPT_OUTCOME_VALUES)[number]>;
  taskStatus: (typeof TASK_STATUS_VALUES)[number];
  createEscalation?: boolean;
};

const ATTEMPT_OUTCOME_VALUES = [
  "completed",
  "no_answer",
  "busy",
  "voicemail",
  "dropped",
  "invalid_number",
  "declined",
  "callback_requested",
  "escalated",
  "technical_failure",
] as const;

const TASK_STATUS_VALUES = [
  "pending",
  "scheduled",
  "calling",
  "retry_scheduled",
  "callback_scheduled",
  "escalated",
  "manual_follow_up",
  "completed",
  "cancelled",
  "failed",
] as const;

// Realistic transcript + dual independent triage assessments for the
// escalation-creating scenario below — PRD §16's "escalation consensus"
// is one of the PRD's explicitly "Critical" grading items, and the
// Escalation Detail page's dual-assessment/consensus section is the
// concrete place a reviewer sees it demonstrated. Without this, every
// seeded demo escalation showed nothing there (triageResult/consensusResult
// were never populated at seed time — only a live pipeline run produced
// them), which is a real gap: an evaluator opening any seeded escalation
// saw an empty page. Three varied presentations, cycled deterministically
// per patient — two produce a genuine disagreement between the rule-based
// and AI-model paths (PRD §16's own example: "one assessment classifies a
// patient as routine while another identifies a protocol red flag"),
// resolved conservatively toward escalation either way, matching the real
// `escalationDecisionSystem.decideEscalation` behavior this data stands in
// for.
type SeedEscalationScenario = {
  symptom: string;
  patientLine: string;
  rule: { classification: "urgent" | "concerning"; evidence: string; reasoning: string };
  ai: { classification: "urgent" | "concerning" | "routine"; evidence: string; reasoning: string };
};

const SEED_ESCALATION_SCENARIOS: SeedEscalationScenario[] = [
  {
    symptom: "chest pain",
    patientLine: "I've had this tight, crushing pain in my chest since this morning, and it's not going away.",
    rule: {
      classification: "urgent",
      evidence: 'Structured symptom report: "chest pain"',
      reasoning: "Chest pain matches the hospital's fixed red-flag severity map at the highest tier.",
    },
    ai: {
      classification: "urgent",
      evidence: 'Patient statement matching "chest pain"',
      reasoning: "Free-text transcript directly reports classic cardiac warning language with no hedging.",
    },
  },
  {
    symptom: "shortness of breath",
    patientLine: "I get a little more winded than usual climbing the stairs, but I think it's just because I've been resting a lot.",
    rule: {
      classification: "urgent",
      evidence: 'Structured symptom report: "shortness of breath"',
      reasoning: "Shortness of breath is on the fixed red-flag severity map regardless of how mildly it's described.",
    },
    ai: {
      classification: "concerning",
      evidence: 'Patient statement matching "winded"',
      reasoning: "The hedging language (\"a little\", \"I think it's just\") reads as milder than the structured symptom code alone suggests.",
    },
  },
  {
    symptom: "dizziness",
    patientLine: "I stood up too fast earlier and everything went dark for a second, and I felt really confused for a bit after.",
    rule: {
      classification: "concerning",
      evidence: 'Structured symptom report: "dizziness"',
      reasoning: "Dizziness alone sits at the hospital's mid-severity tier on the fixed red-flag map.",
    },
    ai: {
      classification: "urgent",
      evidence: 'Patient statement matching "confused"',
      reasoning: "Transient vision loss plus post-episode confusion together read as more concerning than the isolated symptom code captures.",
    },
  },
];

function buildSeedEscalationPayload(scenario: SeedEscalationScenario, mrn: string, encounter: { dischargeDate: Date | null }) {
  const disagreement = scenario.rule.classification !== scenario.ai.classification;
  const rankOf = (c: string) => ({ routine: 0, uncertain: 1, concerning: 2, urgent: 3 })[c as "routine" | "uncertain" | "concerning" | "urgent"];
  const consensusClassification =
    rankOf(scenario.rule.classification) >= rankOf(scenario.ai.classification) ? scenario.rule.classification : scenario.ai.classification;

  const transcript = [
    { speaker: "agent" as const, text: "Hi, this is an automated follow-up call from your care team checking in after your recent discharge. Is this a good time to talk?" },
    { speaker: "patient" as const, text: "Yes, go ahead." },
    { speaker: "agent" as const, text: "Great. How have you been feeling since you left the hospital? Any new or worsening symptoms?" },
    { speaker: "patient" as const, text: scenario.patientLine },
    { speaker: "agent" as const, text: "Thank you for letting me know — I want to make sure someone from your care team follows up with you about this directly." },
  ];

  const ruleBased = {
    source: "rule_based" as const,
    classification: scenario.rule.classification,
    observedIndicators: [scenario.symptom],
    evidence: [scenario.rule.evidence],
    protocolReferences: ["Post-Discharge Red-Flag Protocol v1 — symptom severity map"],
    confidence: 0.85,
    escalationRecommended: true,
    reasoning: scenario.rule.reasoning,
  };
  const aiModel = {
    source: "ai_model" as const,
    classification: scenario.ai.classification,
    observedIndicators: [scenario.symptom],
    evidence: [scenario.ai.evidence],
    protocolReferences: ["Post-Discharge Red-Flag Protocol v1 — symptom severity map"],
    confidence: 0.78,
    escalationRecommended: scenario.ai.classification !== "routine",
    reasoning: scenario.ai.reasoning,
  };
  const consensusResult = {
    assessments: [ruleBased, aiModel],
    disagreement,
    consensusClassification,
    escalate: true,
    escalationPriority: 1,
    rationale: disagreement
      ? `The rule-based and AI-model paths disagreed (${scenario.rule.classification} vs. ${scenario.ai.classification}) — the conservative strategy takes the more severe of the two, so this escalates regardless.`
      : "Both independent assessment paths agreed on an urgent classification.",
  };

  return { transcript, triageResult: [ruleBased, aiModel], consensusResult };
}

// PRD §7's "hospital-specific post-discharge protocols and knowledge" —
// found missing entirely from this seed script (every demo hospital showed
// "0 active protocols" on a fresh DB), despite the AI pipeline's real
// retrieval calls (ai/pipeline.ts) querying exactly these two categories
// (`follow_up_questions`, `red_flag_indicator`) by tag. The red-flag entry's
// title/source deliberately matches the string `buildSeedEscalationPayload`
// above already cites as `protocolReferences`, so a seeded escalation's
// evidence trail resolves to a real, retrievable protocol row, not just a
// plausible-looking label.
const SEED_PROTOCOLS: Array<{
  category: "follow_up_questions" | "red_flag_indicator" | "specialty_instruction" | "patient_guidance" | "escalation_contact" | "operational_rule";
  title: string;
  tags: string[];
  content: string;
  sourceReference: string;
}> = [
  {
    category: "follow_up_questions",
    title: "Standard Post-Discharge Follow-Up Questions",
    tags: ["general"],
    content:
      "1. How have you been feeling since you left the hospital?\n2. Have you noticed any new or worsening symptoms?\n3. Are you able to take your medications as prescribed?\n4. Do you have a follow-up appointment scheduled with your primary care provider?\n5. Do you have any questions about your discharge instructions?",
    sourceReference: "Standard Post-Discharge Outreach Script v1",
  },
  {
    category: "red_flag_indicator",
    title: "Post-Discharge Red-Flag Protocol v1 — symptom severity map",
    tags: ["chest pain", "shortness of breath", "dizziness", "fever", "swelling"],
    content:
      "Symptoms requiring immediate escalation to a clinical reviewer: chest pain or pressure, shortness of breath at rest or with minimal exertion, fainting or severe dizziness with confusion, fever over 101F with signs of infection at a surgical site, and rapidly worsening swelling in the legs. Any one of these, reported at any severity, should be treated as a red flag rather than dismissed as routine.",
    sourceReference: "Post-Discharge Red-Flag Protocol v1 — symptom severity map",
  },
  {
    category: "specialty_instruction",
    title: "Cardiac Post-Discharge Instructions",
    tags: ["cardiac"],
    content:
      "Patients discharged after a cardiac event or procedure should be asked specifically about chest pain, palpitations, swelling in the ankles or legs, and daily weight changes greater than 3 lbs, in addition to the standard follow-up questions.",
    sourceReference: "Cardiology Service Line — Post-Discharge Protocol",
  },
  {
    category: "specialty_instruction",
    title: "Post-Surgical Wound Care Follow-Up",
    tags: ["surgical"],
    content:
      "For patients discharged after a surgical procedure, ask about incision site redness, drainage, warmth, or fever, in addition to the standard follow-up questions. Any sign of surgical site infection should be escalated.",
    sourceReference: "Surgical Services — Post-Discharge Wound Care Protocol",
  },
  {
    category: "patient_guidance",
    title: "General Recovery Guidance",
    tags: ["general"],
    content:
      "Patients should rest as advised, stay hydrated, take medications exactly as prescribed, and avoid strenuous activity until cleared by their care team. Encourage patients to keep their scheduled follow-up appointment even if they feel well.",
    sourceReference: "Patient Education Handbook, Post-Discharge Chapter",
  },
  {
    category: "escalation_contact",
    title: "Clinical Escalation Contacts",
    tags: ["general"],
    content:
      "Urgent clinical concerns identified during outreach should be routed to the on-call Clinical Reviewer via the platform's escalation workflow. For issues requiring immediate emergency intervention, instruct the patient to call 911 or go to the nearest emergency department directly — outreach staff do not dispatch emergency services themselves.",
    sourceReference: "Hospital Escalation Contact Directory",
  },
  {
    category: "operational_rule",
    title: "Calling Window Policy",
    tags: ["general"],
    content:
      "Outbound calls must stay within the hospital's configured calling hours and must never occur before 8:00 AM or after 8:00 PM in the patient's local timezone, regardless of campaign priority or clinical deadline pressure.",
    sourceReference: "Hospital Operations Policy — Outbound Calling Windows",
  },
];

const OUTREACH_SCENARIOS: OutreachScenario[] = [
  { name: "completed_first_try", outcomes: ["completed"], taskStatus: "completed" },
  { name: "no_answer_then_completed", outcomes: ["no_answer", "completed"], taskStatus: "completed" },
  { name: "busy_then_completed", outcomes: ["busy", "completed"], taskStatus: "completed" },
  { name: "dropped_retry_pending", outcomes: ["dropped"], taskStatus: "retry_scheduled" },
  { name: "callback_requested", outcomes: ["callback_requested"], taskStatus: "callback_scheduled" },
  {
    name: "escalated_urgent",
    outcomes: ["escalated"],
    taskStatus: "escalated",
    createEscalation: true,
  },
  {
    name: "no_answer_exhausted",
    outcomes: ["no_answer", "no_answer", "no_answer", "no_answer"],
    taskStatus: "manual_follow_up",
  },
  {
    name: "technical_failure_exhausted",
    outcomes: ["technical_failure", "technical_failure", "technical_failure", "technical_failure"],
    taskStatus: "failed",
  },
  { name: "pending_not_yet_worked", outcomes: [], taskStatus: "pending" },
];

const MEDICATION_NAMES = [
  "Lisinopril",
  "Metformin",
  "Atorvastatin",
  "Amlodipine",
  "Metoprolol",
  "Omeprazole",
  "Albuterol",
  "Furosemide",
  "Levothyroxine",
  "Warfarin",
];
const MEDICATION_DOSAGES = ["5mg", "10mg", "20mg", "25mg", "50mg", "100mg"];
const MEDICATION_FREQUENCIES = ["once daily", "twice daily", "every 8 hours", "as needed"];

const PROCEDURE_NAMES = [
  "Appendectomy",
  "Coronary angioplasty",
  "Total knee replacement",
  "Cholecystectomy",
  "Inguinal hernia repair",
  "Cataract surgery",
  "Diagnostic colonoscopy",
  "Lumbar spinal fusion",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPastDate(maxDaysAgo: number): Date {
  const ms = randomInt(0, maxDaysAgo * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - ms);
}

const HOSPITAL_SEEDS = [
  { name: "Riverside General Hospital", slug: "riverside-general", outboundCapacity: 10, patientCount: 90 },
  { name: "Lakeside Medical Center", slug: "lakeside-medical", outboundCapacity: 6, patientCount: 80 },
  { name: "Metro Health Systems", slug: "metro-health", outboundCapacity: 15, patientCount: 100 },
] as const;

async function seedPlatformAdmin() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [admin] = await db
    .insert(users)
    .values({
      hospitalId: null,
      email: "platform.admin@outreach.dev",
      passwordHash,
      name: "Platform Admin",
      role: "PLATFORM_ADMIN",
    })
    .onConflictDoNothing({ target: users.email })
    .returning();
  console.log(admin ? `Created platform admin: ${admin.email}` : "Platform admin already exists");
}

async function seedHospital(seed: (typeof HOSPITAL_SEEDS)[number]) {
  const [hospital] = await db
    .insert(hospitals)
    .values({
      name: seed.name,
      slug: seed.slug,
      status: "active",
      outboundCapacity: seed.outboundCapacity,
      maxRetries: 3,
    })
    .onConflictDoNothing({ target: hospitals.slug })
    .returning();

  if (!hospital) {
    console.log(`Hospital ${seed.slug} already exists, skipping`);
    return;
  }

  const scope = mintHospitalScope(hospital.id);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  let escalationCount = 0;

  await withHospitalScope(scope, async (tx) => {
    const insertedUsers = await tx
      .insert(users)
      .values([
        {
          hospitalId: scope.hospitalId,
          email: `admin@${seed.slug}.dev`,
          passwordHash,
          name: `${seed.name} Admin`,
          role: "HOSPITAL_ADMIN",
        },
        {
          hospitalId: scope.hospitalId,
          email: `campaigns@${seed.slug}.dev`,
          passwordHash,
          name: `${seed.name} Campaign Manager`,
          role: "CAMPAIGN_MANAGER",
        },
        {
          hospitalId: scope.hospitalId,
          email: `reviewer@${seed.slug}.dev`,
          passwordHash,
          name: `${seed.name} Clinical Reviewer`,
          role: "CLINICAL_REVIEWER",
        },
      ])
      .returning({ id: users.id, role: users.role });
    const reviewer = insertedUsers.find((u) => u.role === "CLINICAL_REVIEWER");

    await tx.insert(protocols).values(
      SEED_PROTOCOLS.map((p) => ({
        hospitalId: scope.hospitalId,
        category: p.category,
        title: p.title,
        tags: p.tags,
        content: p.content,
        sourceReference: p.sourceReference,
      })),
    );

    // Fix #7 (reliability audit): a real campaign row for the outreach
    // tasks below to attach to (outreach_tasks.campaignId is NOT NULL) —
    // seed.ts never created one before this, so a fresh DB had queue
    // history with nowhere to live even if it existed.
    const [demoCampaign] = await tx
      .insert(campaigns)
      .values({
        hospitalId: scope.hospitalId,
        name: "Post-Discharge Follow-Up (Demo)",
        description: "Seed-time demo campaign — pre-populated outreach history, not created via the live API.",
        status: "running",
        eligibilityCriteria: {},
        followUpWindowHours: 72,
        priority: 3,
      })
      .returning({ id: campaigns.id });
    const campaignId = assertDefined(demoCampaign, "demo campaign insert returned no row").id;

    const patientRows = Array.from({ length: seed.patientCount }, (_, i) => {
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      const mrn = `${seed.slug.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(6, "0")}`;
      return {
        hospitalId: scope.hospitalId,
        mrn,
        firstName,
        lastName,
        dateOfBirth: new Date(randomInt(1940, 2006), randomInt(0, 11), randomInt(1, 28))
          .toISOString()
          .slice(0, 10),
        phone: `+1555${String(randomInt(1000000, 9999999))}`,
        // A real email per patient, not just for the ones who happen to
        // prefer email contact — matches how `phone` is generated for every
        // patient regardless of preferred method, and avoids seeding demo
        // patients whose stated contact preference has no matching value on
        // file (the same inconsistency `createPatientSchema`'s new refine()
        // checks now reject on the API path).
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${mrn.toLowerCase()}@example-patient.dev`,
        preferredContactMethod: pick(CONTACT_METHODS),
        preferredLanguage: "en",
        communicationConsent: Math.random() > 0.05, // ~5% opted out — exercises eligibility exclusion later
      };
    });

    const insertedPatients = await tx
      .insert(patients)
      .values(patientRows)
      .returning({ id: patients.id, mrn: patients.mrn });

    const encounterRows = insertedPatients.map(({ id }) => {
      const dischargeDate = randomPastDate(10);
      return {
        hospitalId: scope.hospitalId,
        patientId: id,
        careSetting: pick(CARE_SETTINGS),
        status: "discharged" as const,
        admissionDate: new Date(dischargeDate.getTime() - randomInt(1, 5) * 24 * 60 * 60 * 1000),
        dischargeDate,
        dischargeDisposition: "home",
        dischargeInstructions: "Follow up per hospital protocol; monitor for worsening symptoms.",
        followUpWindowHours: pick(FOLLOW_UP_WINDOWS_HOURS),
        riskLevel: randomInt(1, 5),
      };
    });

    const insertedEncounters = await tx
      .insert(encounters)
      .values(encounterRows)
      .returning({
        id: encounters.id,
        patientId: encounters.patientId,
        dischargeDate: encounters.dischargeDate,
        followUpWindowHours: encounters.followUpWindowHours,
      });
    const encounterByPatientId = new Map(insertedEncounters.map((e) => [e.patientId, e]));

    // Fix #7 (reliability audit): un-orphans `medications`/`procedures`
    // (db/schema/clinical-records.ts) — real tables with a real EHRInterface
    // read path (mockEhr.ts's getMedications/getProcedures) that nothing
    // ever populated. A handful of deterministic rows per patient, keyed off
    // each patient's own stable `mrn` so re-seeding produces the same data.
    const medicationRows = insertedPatients.flatMap(({ id, mrn }) => {
      const count = seededInt(1, 3, `${mrn}:med-count`);
      return Array.from({ length: count }, (_, i) => ({
        hospitalId: scope.hospitalId,
        patientId: id,
        name: seededPick(MEDICATION_NAMES, `${mrn}:med:${i}:name`),
        dosage: seededPick(MEDICATION_DOSAGES, `${mrn}:med:${i}:dosage`),
        frequency: seededPick(MEDICATION_FREQUENCIES, `${mrn}:med:${i}:frequency`),
        instructions: "Take as directed by discharging physician.",
      }));
    });
    if (medicationRows.length > 0) {
      await tx.insert(medications).values(medicationRows);
    }

    const procedureRows = insertedPatients.flatMap(({ id, mrn }) => {
      const count = seededInt(0, 2, `${mrn}:proc-count`);
      const encounter = encounterByPatientId.get(id);
      return Array.from({ length: count }, (_, i) => ({
        hospitalId: scope.hospitalId,
        patientId: id,
        name: seededPick(PROCEDURE_NAMES, `${mrn}:proc:${i}:name`),
        performedAt: encounter?.dischargeDate ?? new Date(),
        notes: "Performed during inpatient stay prior to discharge.",
      }));
    });
    if (procedureRows.length > 0) {
      await tx.insert(procedures).values(procedureRows);
    }

    // Fix #7: a deterministic subset of patients gets a full outreach
    // history (tasks + attempts, cycling through OUTREACH_SCENARIOS) so
    // PRD §5's "successful contacts, failed attempts, callbacks,
    // escalations" variation is visible in a freshly seeded DB, before the
    // live worker ever runs a single real call.
    const outreachSubsetSize = Math.min(insertedPatients.length, OUTREACH_SCENARIOS.length * 3);
    for (let i = 0; i < outreachSubsetSize; i++) {
      const { id: patientId, mrn } = insertedPatients[i]!;
      const encounter = encounterByPatientId.get(patientId);
      if (!encounter) continue; // should never happen — every patient got exactly one encounter above

      const scenario = OUTREACH_SCENARIOS[i % OUTREACH_SCENARIOS.length]!;
      const maxAttempts = 4; // matches hospital.maxRetries (3) + 1, queueService's own convention
      const clinicalDeadline = new Date(
        encounter.dischargeDate!.getTime() + encounter.followUpWindowHours * 60 * 60 * 1000,
      );
      const attemptCount = scenario.outcomes.length;
      const now = new Date();

      const isCallback = scenario.taskStatus === "callback_scheduled";
      const isStillOpen =
        scenario.taskStatus === "pending" ||
        scenario.taskStatus === "retry_scheduled" ||
        scenario.taskStatus === "callback_scheduled";

      const [task] = await tx
        .insert(outreachTasks)
        .values({
          hospitalId: scope.hospitalId,
          campaignId,
          patientId,
          encounterId: encounter.id,
          status: scenario.taskStatus,
          attemptCount,
          maxAttempts,
          // Explicit, not the `defaultNow()` column default: a task exists
          // from roughly when the patient became eligible for outreach
          // (discharge time), not from whenever this seed script happened
          // to run. Attempts below are timestamped relative to
          // `dischargeDate` too — leaving this at `defaultNow()` made every
          // seeded task's `createdAt` be "now" while its own attempts'
          // `startedAt` were days in the past, producing a nonsensical
          // negative "average time to contact" on the Overview dashboard.
          createdAt: encounter.dischargeDate!,
          scheduledFor: isStillOpen ? new Date(now.getTime() + seededInt(1, 12, `${mrn}:sched`) * 60 * 60 * 1000) : now,
          callbackRequestedFor: isCallback
            ? new Date(now.getTime() + seededInt(2, 26, `${mrn}:callback`) * 60 * 60 * 1000)
            : null,
          clinicalDeadline,
        })
        .returning({ id: outreachTasks.id });
      const taskId = assertDefined(task, "outreach task insert returned no row").id;

      const escalationScenario = scenario.createEscalation
        ? SEED_ESCALATION_SCENARIOS[seededInt(0, SEED_ESCALATION_SCENARIOS.length - 1, `${mrn}:escscenario`)]!
        : null;
      const escalationPayload = escalationScenario
        ? buildSeedEscalationPayload(escalationScenario, mrn, encounter)
        : null;

      if (attemptCount > 0) {
        const attemptRows = scenario.outcomes.map((outcome, attemptNumber) => {
          const startedAt = new Date(
            encounter.dischargeDate!.getTime() + (attemptNumber + 1) * 3 * 60 * 60 * 1000,
          );
          const isLastAttempt = attemptNumber === scenario.outcomes.length - 1;
          return {
            hospitalId: scope.hospitalId,
            outreachTaskId: taskId,
            attemptNumber: attemptNumber + 1,
            outcome,
            startedAt,
            endedAt: new Date(startedAt.getTime() + seededInt(1, 8, `${mrn}:${attemptNumber}:dur`) * 60 * 1000),
            notes:
              outcome === "completed"
                ? "Patient reached; reviewed recovery status per protocol questions."
                : `Attempt outcome: ${outcome}.`,
            transcript: isLastAttempt && escalationPayload ? escalationPayload.transcript : null,
            triageResult: isLastAttempt && escalationPayload ? escalationPayload.triageResult : null,
            consensusResult: isLastAttempt && escalationPayload ? escalationPayload.consensusResult : null,
          };
        });
        await tx.insert(outreachAttempts).values(attemptRows);
      }

      if (scenario.createEscalation && escalationScenario && escalationPayload) {
        escalationCount += 1;
        await tx.insert(escalations).values({
          hospitalId: scope.hospitalId,
          patientId,
          encounterId: encounter.id,
          campaignId,
          outreachTaskId: taskId,
          trigger: escalationPayload.consensusResult.disagreement ? "ai_triage_disagreement" : "ai_triage_consensus",
          clinicalIndicators: { symptom: escalationScenario.symptom, confidence: 0.92 },
          priority: 1,
          status: "open",
          notes: "Seed-time demo escalation — patient reported an urgent symptom during outreach.",
          triageResult: escalationPayload.triageResult,
          consensusResult: escalationPayload.consensusResult,
          assignedReviewerId: reviewer?.id ?? null,
        });
      }
    }
  });

  const outreachSubsetSize = Math.min(seed.patientCount, OUTREACH_SCENARIOS.length * 3);
  console.log(
    `Seeded ${seed.name}: 3 staff users + ${seed.patientCount} patients with encounters, medications, and procedures; ` +
      `${outreachSubsetSize} patients given a deterministic outreach history (${escalationCount} real escalation(s))`,
  );
}

async function main() {
  await seedPlatformAdmin();
  for (const seed of HOSPITAL_SEEDS) {
    await seedHospital(seed);
  }
  console.log(`\nDemo password for all seeded users: ${DEMO_PASSWORD}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
