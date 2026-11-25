import { Button } from "../design/Button";
import { Icon } from "../design/Icon";
import type { CredentialMetadata } from "../lib/walletkit";

export function CredentialsPanel({ records, onPreview, onLock }: {
  records: CredentialMetadata[];
  onPreview: () => void;
  onLock: () => void;
}) {
  const hasSelfie = records.some(record => record.issuerSchemaId === 11n && !record.isExpired);
  return <div className="flex flex-1 flex-col pt-6">
    <div className="relative flex items-center gap-3 overflow-hidden py-3">
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40 [background:repeating-radial-gradient(circle_at_16%_128%,color-mix(in_srgb,var(--color-accent-blue)_13%,transparent)_0_1px,transparent_1px_7px)]" />
      <Icon icon="human-emblem" variant="solid" className="relative size-13 text-accent-blue" />
      <div className="relative"><h1 className="text-l1">Your authenticator</h1><p className="text-b3 text-foreground-secondary">Browser passkey</p></div>
      <span className="ml-auto text-b3 text-status-success">Active</span>
    </div>
    <div className="flex justify-between border-b border-stroke-secondary pt-4 pb-2"><h2 className="text-l3">Credentials</h2><span className="text-b3 text-foreground-secondary">{records.length} saved</span></div>
    <p className="sr-only">{records.length} credential{records.length === 1 ? "" : "s"} in your authenticator.</p>
    <ul>{records.map(record => <li key={record.credentialId.toString()} className="flex items-center gap-3 border-b border-stroke-secondary py-4">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border border-stroke-secondary text-accent-blue"><Icon icon="card-credential" /></span>
      <span className="flex-1 text-b1">{record.issuerSchemaId === 11n ? "Proof of Presence" : record.issuerSchemaId === 1n ? "Orb" : record.issuerSchemaId === 128n ? "Faux" : "Credential"}</span>
      <span className={`text-b3 ${record.isExpired ? "text-foreground-secondary" : "text-status-success"}`}>{record.isExpired ? "Expired" : "Active"}</span>
    </li>)}</ul>
    {!hasSelfie && <><div className="flex justify-between border-b border-stroke-secondary pt-6 pb-2"><h2 className="text-l3">Add to this World ID</h2></div>
      <div className="flex items-center gap-3 border-b border-stroke-secondary py-4">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full border border-dashed border-stroke-secondary text-foreground-secondary"><Icon icon="plus" /></span>
        <div className="flex-1"><p className="text-b1">Proof of Presence</p><p className="text-b3 text-foreground-secondary">Verify with a selfie</p></div>
        <Button buttonStyle="tertiary40" onClick={onPreview}>Set up Proof of Presence</Button>
      </div>
      <p className="mt-3 rounded-lg bg-background-secondary p-3 text-b3 text-foreground-secondary">Proof of Presence setup is not available yet. You can try the camera preview; it won’t issue a credential.</p></>}
    {/* The negative margin lines the ghost button's label up with the content edge. */}
    <div className="mt-auto pt-6"><Button buttonStyle="ghost40" className="-ml-5" onClick={onLock}>Lock authenticator</Button></div>
  </div>;
}
