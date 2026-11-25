import { buttonStyle } from "../design/buttons";
import { actions } from "./styles";

/** A way on from the end screen: a link back to the RP. */
export type EndAction = { label: string; href: string };

// The Nucleus focus ring is the accent, which would vanish on the blue end screen.
const END_FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-foreground-inverse!";

/**
 * The end screen: the whole screen blue, "You're all set" and "You can close this tab" together, and a white
 * button back to the authenticator at the bottom (with the RP's return link under it if it gave one).
 */
export function AllSet({ action }: { action?: EndAction }) {
  return <div className="fixed inset-0 z-50 flex flex-col items-center bg-accent-blue px-6 pt-[max(16px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))] text-center text-foreground-inverse" data-testid="all-set">
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 motion-safe:animate-completion-in">
      <h2 className="text-h2">You’re all set</h2>
      <p className="text-b2 text-foreground-inverse/80">You can close this tab</p>
    </div>
    <div className={`${actions} motion-safe:animate-completion-in`}>
      <a className={`${buttonStyle("inverse48")} w-full ${END_FOCUS}`} href="/authenticator">Return to authenticator</a>
      {action && <a className={`${END_FOCUS} block min-h-11 content-center text-center text-b2 text-foreground-inverse underline underline-offset-3`} href={action.href}>{action.label}</a>}
    </div>
  </div>;
}
