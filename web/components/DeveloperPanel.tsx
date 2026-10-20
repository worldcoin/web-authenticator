import { useState, type ReactNode } from "react";
import type { CredentialMetadata } from "../lib/walletkit";
import type { IncomingRequest } from "../lib/incoming-request";
import { credentialRequirementsLabel } from "../lib/proof-request";

const SCHEMA_NAMES: Record<string, string> = { "1": "Orb", "11": "Selfie Check", "128": "Faux" };
const credentialName = (schema: bigint) => SCHEMA_NAMES[schema.toString()] ?? "Credential";

function date(value: bigint) { return new Date(Number(value) * 1000).toLocaleString(); }

export function DeveloperPanel({ records, unlocked, disabled, incoming, onRefresh, onDelete, onOpenCamera, children }: {
  records: CredentialMetadata[];
  unlocked: boolean;
  disabled: boolean;
  incoming: IncomingRequest | null;
  onRefresh: () => void;
  onDelete: (id: bigint) => void;
  onOpenCamera?: () => void;
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState<bigint | null>(null);
  const pending = records.find(record => record.credentialId === selected);
  return <div id="developer-panel" className="developer-panel">
    <section aria-labelledby="vault-title">
      <h3 id="vault-title">Credential vault</h3>
      {!unlocked ? <p className="dev-notice">Unlock your wallet to inspect its credentials.</p> : <>
        <div className="dev-toolbar"><span>{records.length} stored</span><button disabled={disabled} onClick={onRefresh}>Refresh vault</button></div>
        {!records.length && <p>No credentials stored yet.</p>}
        {records.map(record => {
          return <details className="dev-credential" key={record.credentialId.toString()}>
            <summary>{credentialName(record.issuerSchemaId)} <span>· {record.isExpired ? "Expired" : "Active"}</span></summary>
            <dl><dt>Credential ID</dt><dd><code>{record.credentialId.toString()}</code></dd><dt>Issuer schema</dt><dd>{record.issuerSchemaId.toString()}</dd><dt>Originally issued</dt><dd>{date(record.genesisIssuedAt)}</dd><dt>Expires</dt><dd>{date(record.expiresAt)}</dd></dl>
            <button disabled={disabled} onClick={() => setSelected(record.credentialId)}>Delete local credential</button>
          </details>;
        })}
        {pending && <div className="dev-confirm" role="group" aria-label="Confirm credential deletion">
          <p>Delete credential <code>{pending.credentialId.toString()}</code> from this browser?</p>
          <div className="dev-toolbar"><button disabled={disabled} onClick={() => { setSelected(null); onDelete(pending.credentialId); }}>Confirm deletion</button><button disabled={disabled} onClick={() => setSelected(null)}>Keep credential</button></div>
        </div>}
      </>}
    </section>
    <section aria-labelledby="request-title"><h3 id="request-title">Current request</h3>
      {incoming ? <dl><dt>Requesting RP</dt><dd>{incoming.label}</dd><dt>Action</dt><dd>{incoming.actionLabel || "No action label"}</dd><dt>Accepted credentials</dt><dd>{credentialRequirementsLabel(incoming.proof)}</dd><dt>Expires</dt><dd>{date(BigInt(incoming.proof.expires_at))}</dd></dl> : <p>No request loaded.</p>}
    </section>
    <section aria-labelledby="runtime-title"><h3 id="runtime-title">Selfie Check</h3>
      <p>Local camera diagnostics. Capturing a selfie does not issue a credential.</p>
      <button disabled={!onOpenCamera} onClick={onOpenCamera}>Open Selfie Check</button>
    </section>
    {children}
  </div>;
}
