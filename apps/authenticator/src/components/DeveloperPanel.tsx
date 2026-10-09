import { useState } from "react";
import type { CredentialMetadata } from "../lib/walletkit";
import type { IncomingRequest } from "../lib/requests/incoming-request";
import { credentialRequirementsLabel } from "../lib/requests/proof-request";
import { LIVE_GUIDANCE_MODEL_V1 } from "../walkthrough/model-provenance";

function credentialDescription(schema: bigint) {
  if (schema === 11n) return { name: "Selfie Check", description: "Schema 11. A proof can disclose the uniqueness score. Credentials issued by this local flow use synthetic face data." };
  if (schema === 1n) return { name: "Orb", description: "Schema 1. Used for requests accepting Orb verification. Orb enrollment and transfer are not available here." };
  if (schema === 128n) return { name: "Faux", description: "Schema 128. A development credential; it does not establish face verification." };
  return { name: "Credential", description: "No description is available for this issuer schema." };
}

function date(value: bigint) { return new Date(Number(value) * 1000).toLocaleString(); }

export function DeveloperPanel({ records, unlocked, disabled, incoming, canIssue, configurationError, preview, onRefresh, onDelete }: {
  records: CredentialMetadata[];
  unlocked: boolean;
  disabled: boolean;
  incoming: IncomingRequest | null;
  canIssue: boolean;
  configurationError: boolean;
  preview: boolean;
  onRefresh: () => void;
  onDelete: (id: bigint) => void;
}) {
  const [selected, setSelected] = useState<bigint | null>(null);
  const pending = records.find(record => record.credentialId === selected);
  return <aside id="developer-panel" className="developer-panel" aria-label="Developer tools">
    <header><p className="dev-eyebrow">Staging workspace</p><h2>Developer tools</h2><p>Inspect this wallet and the active flow.</p></header>
    <section aria-labelledby="vault-title">
      <h3 id="vault-title">Credential vault</h3>
      <p>WalletKit stores credentials and their blinding factors in this browser’s encrypted vault. Your passkey’s PRF output unlocks it.</p>
      {!unlocked ? <p className="dev-notice">Unlock your wallet to inspect its credentials.</p> : <>
        <div className="dev-toolbar"><span>{records.length} stored</span><button disabled={disabled} onClick={onRefresh}>Refresh vault</button></div>
        {!records.length && <p>No credentials stored yet.</p>}
        {records.map(record => {
          const info = credentialDescription(record.issuerSchemaId);
          return <details className="dev-credential" key={record.credentialId.toString()}>
            <summary>{info.name} <span>· {record.isExpired ? "Expired" : "Active"}</span></summary>
            <p>{info.description}</p>
            <dl><dt>Credential ID</dt><dd><code>{record.credentialId.toString()}</code></dd><dt>Issuer schema</dt><dd>{record.issuerSchemaId.toString()}</dd><dt>Originally issued</dt><dd>{date(record.genesisIssuedAt)}</dd><dt>Expires</dt><dd>{date(record.expiresAt)}</dd></dl>
            <button disabled={disabled} onClick={() => setSelected(record.credentialId)}>Delete local credential</button>
          </details>;
        })}
        {pending && <div className="dev-confirm" role="group" aria-label="Confirm credential deletion">
          <p>Delete credential <code>{pending.credentialId.toString()}</code> and its local blinding factors? This cannot be undone here. Your passkey, account registration, and issuer records remain unchanged.</p>
          <div className="dev-toolbar"><button disabled={disabled} onClick={() => { setSelected(null); onDelete(pending.credentialId); }}>Confirm deletion</button><button disabled={disabled} onClick={() => setSelected(null)}>Keep credential</button></div>
        </div>}
      </>}
      <details><summary>What is stored here?</summary><p>The credential vault is local to this browser and origin. A synced passkey does not sync this vault. PCP backup and storage are not connected in this branch.</p><p>This inspector shows metadata only. Secret keys, PRF output, blinding factors, and proof payloads are excluded.</p></details>
    </section>
    <section aria-labelledby="request-title"><h3 id="request-title">Current request</h3>
      {incoming ? <dl><dt>Requesting RP</dt><dd>{incoming.label}</dd><dt>Action</dt><dd>{incoming.actionLabel || "No action label"}</dd><dt>Accepted credentials</dt><dd>{credentialRequirementsLabel(incoming.proof)}</dd><dt>Expires</dt><dd>{date(BigInt(incoming.proof.expires_at))}</dd></dl> : <p>No RP request loaded. Open a request from the separate demo app.</p>}
    </section>
    <section aria-labelledby="runtime-title"><h3 id="runtime-title">Camera & issuance</h3>
      <dl><dt>Preview</dt><dd>{preview ? "Open — local camera guidance" : "Closed"}</dd><dt>Guidance model</dt><dd>{LIVE_GUIDANCE_MODEL_V1.modelKind}</dd><dt>Runtime</dt><dd>{LIVE_GUIDANCE_MODEL_V1.runtimePackage} · {LIVE_GUIDANCE_MODEL_V1.runtimeVersion} · CPU / WASM</dd><dt>Staging issuance</dt><dd>{configurationError ? "Configuration unavailable" : canIssue ? "Available · synthetic face input" : "Unavailable on this server"}</dd><dt>TEE face verification</dt><dd>Not connected</dd></dl>
      <p>RGBNet face boxes drive face-count, centering and distance instructions. Inference runs in a dedicated worker, one frame at a time. Camera frames stay in this tab; they are not used by the staging issuer.</p>
    </section>
  </aside>;
}
