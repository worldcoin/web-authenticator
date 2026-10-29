import type { ReactNode } from "react";
import { signinPage } from "./styles";

export function PasskeyIcon() {
  return <svg className="size-5" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <path stroke="currentColor" strokeWidth="1.65" d="M12 18.3333H3.66667C3.66667 15.802 5.7187 13.75 8.25 13.75H12.8333M16.5 14.6667C15.4875 14.6667 14.6667 15.4875 14.6667 16.5C14.6667 17.5125 15.4875 18.3333 16.5 18.3333C17.5125 18.3333 18.3333 17.5125 18.3333 16.5C18.3333 15.4875 17.5125 14.6667 16.5 14.6667ZM16.5 14.6667V11.9167M19.25 9.16667H16.5V11.9167M16.5 11.9167H19.25M13.9913 6.64607C13.9913 8.41787 12.555 9.8542 10.7832 9.8542C9.01136 9.8542 7.57503 8.41787 7.57503 6.64607C7.57503 4.87428 9.01136 3.43795 10.7832 3.43795C12.555 3.43795 13.9913 4.87428 13.9913 6.64607Z" />
  </svg>;
}

/** Centered sign-in content within the shared app layout. */
export function SigninPage({ children }: { children: ReactNode }) {
  return <div className={signinPage}>
    <section className="flex flex-1 items-center justify-center px-6 py-16 md:py-18">
      <div className="flex w-full max-w-130 flex-col items-center text-center">
        <img className="mb-5 size-18" src="/assets/brand/human-badge.svg" alt="" />
        {children}
      </div>
    </section>
  </div>;
}
