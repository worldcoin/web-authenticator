import type { ReactNode } from "react";

const PRIVACY_URL = "https://www.toolsforhumanity.com/legal/privacy-notice";

/** Shared chrome stays mounted while the current screen changes. */
export function AppLayout({ footerActions, hideControls = false, hideHeader = false, authenticator = false, children }: {
  footerActions: ReactNode;
  hideControls?: boolean;
  hideHeader?: boolean;
  authenticator?: boolean;
  children: ReactNode;
}) {
  return <div className="flex min-h-dvh flex-col bg-white pb-(--site-footer-height)">
    <header inert={hideHeader} aria-hidden={hideHeader || undefined} className="data-[hidden=true]:invisible flex min-h-(--site-header-height) items-center px-6 pt-[calc(16px+env(safe-area-inset-top))] pb-4 md:px-8" data-hidden={hideHeader}>
      <p className="z-5 max-w-full self-center text-center text-[13px] leading-[1.2] text-[#4e4e4e] md:text-[15px]">World ID</p>
    </header>
    <main className={`relative flex w-full min-w-0 min-h-0 flex-1 flex-col overflow-x-clip min-[600px]:justify-center ${authenticator ? "bg-[#e8ecf2]" : "bg-white"}`}>{children}</main>
    <footer className="fixed inset-x-0 bottom-0 z-30 flex min-h-(--site-footer-height) items-center justify-between gap-4 bg-surface-page px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-[13px] text-foreground-secondary data-[hidden=true]:invisible md:px-8" data-hidden={hideControls} inert={hideControls} aria-hidden={hideControls || undefined}>
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="World links">
        <a className="hover:text-foreground hover:underline" href="https://world.org/world-id">World ID</a>
        <a className="hover:text-foreground hover:underline" href="https://world.org/world-app">World App</a>
        <a className="hover:text-foreground hover:underline" href="https://world.org/ecosystem">Mini Apps</a>
        <a className="hover:text-foreground hover:underline" href="https://docs.world.org/world-id/overview">Build with World ID</a>
        <a className="hover:text-foreground hover:underline" href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy</a>
      </nav>
      {footerActions}
    </footer>
  </div>;
}
