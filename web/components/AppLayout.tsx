import type { ReactNode } from "react";

const PRIVACY_URL = "https://www.toolsforhumanity.com/legal/privacy-notice";

/** Shared chrome stays mounted while the current screen or developer mode changes. */
export function AppLayout({ developer, footerActions, children }: {
  developer: boolean;
  footerActions: ReactNode;
  children: ReactNode;
}) {
  return <div className={`authenticator-shell app-layout ${developer ? "authenticator-shell--dev developer-workspace" : "authenticator-shell--public"}`}>
    <header className="site-header"><p className="brand-label">World ID</p></header>
    <main className="app-main app-main--landing">{children}</main>
    <footer className="site-footer">
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy</a>
      {footerActions}
    </footer>
  </div>;
}
