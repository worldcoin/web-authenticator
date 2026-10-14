// Browser APIs return ArrayBuffers, but injected providers may return typed-array
// views or buffers from another realm. Normalize bytes without changing derivation.
// 1Password FS-5593 also reports plain byte arrays in its browser extension.
export function prfBytes(value: unknown): Uint8Array<ArrayBuffer> | undefined {
	if (Array.isArray(value)) {
		// Check every index: Array.every would skip holes, and Uint8Array would
		// silently coerce missing, fractional, or out-of-range values.
		if (value.length !== 32) return undefined
		for (let i = 0; i < value.length; i++) {
			if (!Number.isInteger(value[i]) || value[i] < 0 || value[i] > 255) return undefined
		}
		return Uint8Array.from(value)
	}
	let view: Uint8Array
	try {
		if (ArrayBuffer.isView(value)) {
			view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
		} else {
			// Use the native brand check; instanceof rejects cross-realm ArrayBuffers.
			const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!.call(value)
			view = new Uint8Array(value as ArrayBuffer, 0, byteLength)
		}
	} catch {
		return undefined
	}
	try {
		return view.byteLength === 32 ? new Uint8Array(view) : undefined
	} finally {
		view.fill(0)
	}
}
