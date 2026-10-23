import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createPoseWorker } from '../lib/poseguard/worker'

function harness() {
  const messages: { data: { type: string; id?: number }; transfer?: unknown[] }[] = []
  const timers = new Map<number, () => void>()
  let terminated = 0, closed = 0, timerId = 0
  const worker = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onmessageerror: undefined as (() => void) | undefined,
    postMessage(data: { type: string; id?: number }, transfer?: unknown[]) { messages.push({ data, transfer }) },
    terminate() { terminated++ },
  }
  return {
    worker, messages, timers,
    Worker: function () { return worker },
    setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id },
    clearTimeout: (id: number) => { timers.delete(id) },
    frame: () => ({ close: () => { closed++ } }) as ImageBitmap,
    emit: (data: unknown) => worker.onmessage?.({ data }),
    counts: () => ({ terminated, closed }),
  }
}

async function withWorker(run: (h: ReturnType<typeof harness>) => Promise<void>) {
  const h = harness()
  const replacements = { Worker: h.Worker, setTimeout: h.setTimeout, clearTimeout: h.clearTimeout }
  const saved = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true })
  try { await run(h) }
  finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('pose worker transfers one frame, rejects concurrent work and matches its response', async () => {
  await withWorker(async h => {
    const opening = createPoseWorker(new AbortController().signal)
    assert.equal(h.messages[0].data.type, 'init')
    h.emit({ type: 'ready', delegate: 'GPU' })
    const pose = await opening
    const frame = h.frame()
    const pending = pose.analyze(frame, 100)
    assert.deepEqual(h.messages[1].transfer, [frame])
    await assert.rejects(pose.analyze(h.frame(), 101), /already in flight/)
    assert.equal(h.counts().closed, 1)
    assert.equal(h.messages.length, 2)
    const observation = { t: 100, present: false, yaw: NaN, pitch: NaN, landmarks: null, width: 720, height: 960, fraction: 0, cx: 0, cy: 0, iod: 0 }
    h.emit({ type: 'result', id: 1, observation })
    assert.equal(await pending, observation)
    assert.equal(h.timers.size, 0)
    pose.dispose()
    pose.dispose()
    assert.equal(h.counts().terminated, 1)
  })
})

test('pose worker abort rejects pending inference and refuses later bitmaps', async () => {
  await withWorker(async h => {
    const controller = new AbortController()
    const opening = createPoseWorker(controller.signal)
    h.emit({ type: 'ready', delegate: 'CPU' })
    const pose = await opening
    const pending = pose.analyze(h.frame(), 1)
    const rejected = assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError')
    controller.abort()
    await rejected
    await assert.rejects(pose.analyze(h.frame(), 2), /cancelled/)
    assert.equal(h.counts().terminated, 1)
    assert.equal(h.counts().closed, 1)
    assert.equal(h.timers.size, 0)
  })
})

test('pose worker startup timeout terminates and rejects initialization', async () => {
  await withWorker(async h => {
    const opening = createPoseWorker(new AbortController().signal)
    const rejected = assert.rejects(opening, /startup timed out/)
    ;[...h.timers.values()][0]()
    await rejected
    assert.equal(h.counts().terminated, 1)
    assert.equal(h.timers.size, 0)
  })
})

test('pose worker rejects a response for another frame instead of applying it', async () => {
  await withWorker(async h => {
    const opening = createPoseWorker(new AbortController().signal)
    h.emit({ type: 'ready', delegate: 'GPU' })
    const pose = await opening
    const pending = pose.analyze(h.frame(), 1)
    const rejected = assert.rejects(pending, /Unexpected pose frame response/)
    h.emit({ type: 'result', id: 999, observation: {} })
    await rejected
    assert.equal(h.counts().terminated, 1)
    assert.equal(h.timers.size, 0)
  })
})

