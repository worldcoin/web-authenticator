import type { ReactNode } from "react";

const PRIVACY_URL = "https://www.toolsforhumanity.com/legal/privacy-notice";

export function PasskeyIcon() {
  return <svg className="signin-icon" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <path stroke="currentColor" strokeWidth="1.65" d="M12 18.3333H3.66667C3.66667 15.802 5.7187 13.75 8.25 13.75H12.8333M16.5 14.6667C15.4875 14.6667 14.6667 15.4875 14.6667 16.5C14.6667 17.5125 15.4875 18.3333 16.5 18.3333C17.5125 18.3333 18.3333 17.5125 18.3333 16.5C18.3333 15.4875 17.5125 14.6667 16.5 14.6667ZM16.5 14.6667V11.9167M19.25 9.16667H16.5V11.9167M16.5 11.9167H19.25M13.9913 6.64607C13.9913 8.41787 12.555 9.8542 10.7832 9.8542C9.01136 9.8542 7.57503 8.41787 7.57503 6.64607C7.57503 4.87428 9.01136 3.43795 10.7832 3.43795C12.555 3.43795 13.9913 4.87428 13.9913 6.64607Z" />
  </svg>;
}

export function SiteFooter({ footerActions }: { footerActions: ReactNode }) {
  return <footer className="signin-footer">
    <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy</a>
    {footerActions}
  </footer>;
}

/** Shared frame for the browser pages: centered column under the World mark, footer links. */
export function SigninPage({ footerActions, children }: { footerActions: ReactNode; children: ReactNode }) {
  return <div className="signin">
    <section className="signin-body">
      <div className="signin-form">
        <img className="signin-badge" src="/assets/brand/human-badge.svg" alt="" />
        {children}
      </div>
    </section>
    <SiteFooter footerActions={footerActions} />
  </div>;
}
