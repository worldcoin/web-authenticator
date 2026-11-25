import { Button } from "../design/Button";
import { Spinner } from "../design/Spinner";

export function AccessOptions({ saved, progress, onOpen }: {
  saved: boolean;
  progress: string | null;
  onOpen: (mode: "open" | "create") => Promise<void>;
}) {
  return <div className="flex flex-1 flex-col pt-9">
    <h1 className="text-h1">Your World ID,<br />in this browser.</h1>
    <p className="mt-4 max-w-[22em] text-b1 text-foreground-secondary">Sign in with your saved passkey, or create a new World ID.</p>
    {progress !== null ? <div className="mt-8 flex items-center gap-3 text-b2 text-foreground-secondary" role="status" aria-live="polite">
      <Spinner className="shrink-0 text-accent-blue" />
      <span>{progress}</span>
    </div> : <div className="mt-8 grid gap-2">
      <Button buttonStyle="primary48" className="w-full" onClick={() => void onOpen("open")}>Sign in with passkey</Button>
      <Button buttonStyle="tertiary48" className="w-full" disabled={saved} onClick={() => void onOpen("create")}>Create a new World ID</Button>
      <Button buttonStyle="tertiary48" className="w-full" disabled>Link an authenticator (coming soon)</Button>
      <p className="mt-1 text-b3 text-foreground-secondary">Linking an authenticator isn’t available yet.</p>
    </div>}
    <p className="mt-auto border-t border-stroke-secondary pt-4 text-b3 text-foreground-secondary">Use your passkey to unlock your authenticator in this browser.</p>
  </div>;
}
