import { resolve } from 'node:path'
import { createECDH } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const directory = process.argv[2]
if (!directory) throw new Error('Usage: bun scripts/create-selfie-admission-key.ts /private/directory')
// Refuse existing directories so an active signing key cannot be overwritten.
await mkdir(directory, { mode: 0o700 })
const key = createECDH('prime256v1')
key.generateKeys()
await writeFile(
	resolve(directory, 'admission-private.hex'),
	key.getPrivateKey().toString('hex').padStart(64, '0') + '\n',
	{ mode: 0o600, flag: 'wx' }
)
await writeFile(resolve(directory, 'admission-public.hex'), key.getPublicKey().toString('hex') + '\n', {
	mode: 0o600,
	flag: 'wx',
})
console.log(
	'Created admission-private.hex and admission-public.hex. Only the public key belongs in staging configuration.'
)
