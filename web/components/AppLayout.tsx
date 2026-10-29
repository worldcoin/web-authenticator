import type { ReactNode } from "react";

const PRIVACY_URL = "https://www.toolsforhumanity.com/legal/privacy-notice";

/** Shared chrome stays mounted while the current screen changes. */
export function AppLayout({ footerActions, hideControls = false, children }: {
  footerActions: ReactNode;
  hideControls?: boolean;
  children: ReactNode;
}) {
  return <div className="flex min-h-dvh flex-col bg-white pb-(--site-footer-height)">
    <header className="flex min-h-(--site-header-height) items-center px-6 pt-[calc(16px+env(safe-area-inset-top))] pb-4 md:px-8">
      <p className="z-5 max-w-full self-center text-center text-[13px] leading-[1.2] text-[#4e4e4e] md:text-[15px]">World ID</p>
    </header>
    <main className="relative flex w-full min-w-0 min-h-0 flex-1 flex-col overflow-x-clip bg-white min-[600px]:justify-center">{children}</main>
    <footer className="fixed inset-x-0 bottom-0 z-30 flex min-h-(--site-footer-height) items-center justify-between gap-4 bg-surface-page px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-[13px] text-foreground-secondary data-[hidden=true]:invisible md:px-8" data-hidden={hideControls} inert={hideControls} aria-hidden={hideControls || undefined}>
      <a className="hover:text-foreground hover:underline" href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy</a>
      {footerActions}
    </footer>
  </div>;
}
