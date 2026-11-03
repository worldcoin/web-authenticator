import { protocolEnvironmentForOrigin } from "../../packages/contracts/src/deployment";

export function currentProtocolEnvironment() {
  return protocolEnvironmentForOrigin(typeof window === "undefined" ? "http://localhost" : window.location.origin);
}
