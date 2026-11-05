import { isAllowedOrigin, parseAppEnvironment } from "../../config/environment";

export function currentProtocolEnvironment() {
  const environment = parseAppEnvironment(import.meta.env.VITE_APP_ENV ?? "staging");
  if (typeof window !== "undefined" && !isAllowedOrigin(environment, window.location.origin)) {
    throw new Error("This authenticator build is not configured for this origin.");
  }
  return environment;
}
