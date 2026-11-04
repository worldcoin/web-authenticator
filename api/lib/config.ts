import { parseAppEnvironment } from "../../config/environment";

const ENV: Readonly<Record<string, string | undefined>> =
  process.env;

function envValue(name: string): string | undefined {
  const value = ENV[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function envPort(): number {
  const raw = envValue("PORT") ?? envValue("AUTHENTICATOR_PORT");
  if (raw === undefined) return 4173;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`authenticator_port_invalid: ${raw}`);
  }
  return port;
}

export const AUTHENTICATOR_APP_CONFIG = Object.freeze({
  host: envValue("AUTHENTICATOR_HOST") ?? "127.0.0.1",
  port: envPort(),
  environment: parseAppEnvironment(envValue("APP_ENV") ?? "staging"),
});
