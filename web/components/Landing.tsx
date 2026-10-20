import { Home } from "./Home";
import { PasskeyIcon, SigninPage } from "./SigninPage";

/**
 * Direct-open page (no app request, wallet closed). Without a request there is
 * nothing to approve, so it shows the home page with an explicit authenticator entry. Dev mode adds the passkey
 * button so the wallet can be opened for inspection; its label depends on
 * whether this browser already holds a wallet, because the same passkey action
 * creates a new World ID when it does not.
 */
export function Landing({ devMode, saved, busy, progress, error, onOpen }: {
  devMode: boolean;
  saved: boolean;
  busy: boolean;
  progress: string;
  error: string | null;
  onOpen: () => void;
}) {
  if (!devMode) return <Home onOpen={onOpen} />;

  return <SigninPage>
    <h1>{saved ? "Welcome back" : "Create your World ID"}</h1>
    <button className="signin-primary" disabled={busy} onClick={onOpen}>
      <PasskeyIcon /><span aria-live="polite">{busy ? progress || "Waiting for your passkey…" : saved ? "Sign in with passkey" : "Continue with passkey"}</span>
    </button>
    {error && <p className="signin-error" role="alert">{error}</p>}
  </SigninPage>;
}
