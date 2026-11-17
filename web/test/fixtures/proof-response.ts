/** Rust-compatible wire shape with synthetic proof material; never a valid ZKP. */
export function proofResponse(issuerSchemaId: number | string = 11) {
	return {
		id: 'test-request',
		version: 1 as const,
		responses: [{
			identifier: 'credential',
			issuer_schema_id: issuerSchemaId,
			proof: '00'.repeat(160),
			nullifier: 'nil_' + '0'.repeat(63) + '1',
			expires_at_min: 1_800_000_000,
		}],
	}
}
