import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type PageTitleContextValue = { title: string; setTitle: (title: string) => void };

const PageTitleContext = createContext<PageTitleContextValue | null>(null);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState("");
  return <PageTitleContext.Provider value={{ title, setTitle }}>{children}</PageTitleContext.Provider>;
}

export function usePageTitleContext(): PageTitleContextValue {
  const ctx = useContext(PageTitleContext);
  if (!ctx) throw new Error("usePageTitleContext must be used within PageTitleProvider");
  return ctx;
}

/** Call in a page component to set the TopBar's title. */
export function usePageTitle(title: string) {
  const { setTitle } = usePageTitleContext();
  useEffect(() => {
    setTitle(title);
  }, [title, setTitle]);
}
