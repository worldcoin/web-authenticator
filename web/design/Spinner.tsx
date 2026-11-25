import { defaultSize } from "./Icon";

/** A 24 px indeterminate spinner in the current text colour, like iOS WLDSpinner. */
export function Spinner({ className = "" }: { className?: string }) {
  return <svg className={`animate-spin motion-reduce:animate-none ${defaultSize(className)} ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>;
}
