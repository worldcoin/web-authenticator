import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import model from '../apps/authenticator/src/face/rgbnet-model.json'

const source = process.argv[2]
if (!source) throw new Error('Usage: bun scripts/setup-rgbnet.ts /path/to/RGBNet.onnx')
const bytes = await readFile(source)
if (bytes.length !== model.bytes || createHash('sha256').update(bytes).digest('hex') !== model.sha256)
	throw new Error('RGBNet does not match the pinned model. Review model provenance before changing the manifest.')
const destination = resolve(import.meta.dir, '../apps/authenticator/public/models/rgbnet.onnx')
await mkdir(resolve(import.meta.dir, '../apps/authenticator/public/models'), { recursive: true })
await writeFile(destination, bytes)
console.info(`Installed verified RGBNet (${bytes.length} bytes) at ${destination}`)
