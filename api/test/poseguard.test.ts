import { expect, test } from 'bun:test';
import { authorizePoseGuard, PoseGuardRuns } from '../lib/poseguard';
import { createPoseGuardHandlers } from '../routes/api/poseguard/handlers';
import { POSEGUARD_BODY_LIMIT, isPoseGuardEvidence, type PoseGuardChallenge } from '../../packages/contracts/src/poseguard';
import { followingEvidence } from '../../tests/integration/fixtures/poseguard';
import { targets, angleBetween } from '../../packages/poseguard/src/vendor/posechallenge.js';
import { signedRequest } from '../../tests/integration/fixtures/request';

const origin = 'https://authenticator.example';
const headers = { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
function request(path: string, body: unknown, overrides = {}) {
  return new Request(`${origin}/api/poseguard/${path}`, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
}
function harness() {
  let time = 0, wall = Date.now();
  const expires = wall + 600_000;
  const runs = new PoseGuardRuns(() => time, () => wall);
  return { runs, expires, advance: (ms: number) => { time += ms; wall += ms; } };
}

test('server replay agrees with the unchanged core on following eyes and printed eyes', () => {
  const h = harness();
  for (const slope of [-.005, 0]) for (let i = 0; i < 20; i++) {
    const challenge = h.runs.create(`request-${i}`, h.expires);
    const { evidence, status } = followingEvidence(challenge.seed, slope);
    expect(status).toBe(slope === 0 ? 'failed' : 'passed');
    expect(isPoseGuardEvidence(evidence)).toBe(true);
    expect(JSON.stringify(evidence).length).toBeLessThan(POSEGUARD_BODY_LIMIT);
    h.advance(evidence.frames.at(-1)!.t * 1000);
    const verdict = h.runs.verify(challenge.id, challenge.capability, evidence);
    expect(verdict.status).toBe(status);
    expect(Object.keys(verdict).sort()).toEqual(['outcome', 'profile', 'reason', 'status']);
    expect(() => h.runs.verify(challenge.id, challenge.capability, evidence)).toThrow('challenge_unavailable');
  }
});

test('one active challenge, wrong capabilities, cancellation, expiry, and bounded store', () => {
  const h = harness();
  const c = h.runs.create('same', h.expires);
  expect(() => h.runs.create('same', h.expires)).toThrow('challenge_in_progress');
  expect(() => h.runs.cancel(c.id, '0'.repeat(64))).toThrow('challenge_unavailable');
  h.runs.cancel(c.id, c.capability);
  expect(() => h.runs.cancel(c.id, c.capability)).toThrow('challenge_unavailable');
  const expired = h.runs.create('same', h.expires);
  h.advance(120_001);
  expect(() => h.runs.cancel(expired.id, expired.capability)).toThrow('challenge_unavailable');
  const short = h.runs.create('short', h.expires - 479_000);
  h.advance(1000);
  expect(() => h.runs.cancel(short.id, short.capability)).toThrow('challenge_unavailable');
  for (let i = 0; i < 64; i++) h.runs.create(`r${i}`, h.expires);
  expect(() => h.runs.create('overflow', h.expires)).toThrow('challenge_capacity');
  h.advance(120_001);
  expect(h.runs.create('after-expiry', h.expires).id).toBeTruthy();
});

test('a trace cannot finish faster than elapsed server time or skip a face gap', () => {
  const h = harness();
  const c = h.runs.create('timing', h.expires);
  const { evidence } = followingEvidence(c.seed);
  expect(() => h.runs.verify(c.id, c.capability, evidence)).toThrow('invalid_evidence_timing');
  expect(() => h.runs.verify(c.id, c.capability, evidence)).toThrow('challenge_unavailable');
  const gap = h.runs.create('gap', h.expires);
  const frames = followingEvidence(gap.seed).evidence.frames;
  h.advance(10_000);
  expect(h.runs.verify(gap.id, gap.capability, { frames: [frames[0], { ...frames[1], t: 1 }] }).status).toBe('inconclusive');
});

test('server uses its own seed, never a client target definition or result', async () => {
  const h = harness();
  const handlers = createPoseGuardHandlers(h.runs, async () => ({ binding: 'signed', expiresAt: h.expires }));
  const c = await (await handlers.challenge(request('challenge', {}))).json() as PoseGuardChallenge;
  let wrongSeed = BigInt(c.seed) + 1n;
  while (angleBetween(targets(wrongSeed)[0].direction, targets(c.seed)[0].direction) < 100) wrongSeed++;
  const wrong = followingEvidence(wrongSeed.toString()).evidence;
  h.advance(wrong.frames.at(-1)!.t * 1000);
  const response = await handlers.verify(request('verify', { id: c.id, capability: c.capability, evidence: wrong }));
  expect(response.status).toBe(200);
  expect((await response.json()).status).not.toBe('passed');
  expect((await handlers.verify(request('verify', { ...c, result: 'passed', evidence: wrong }))).status).toBe(400);
});

test('API requires same-origin JSON and rejects extra, unbounded or malformed measurements', async () => {
  const h = harness(); let authorized = 0;
  const handlers = createPoseGuardHandlers(h.runs, async () => { authorized++; return { binding: 'signed', expiresAt: h.expires }; });
  for (const overrides of [{ origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }]) {
    expect((await handlers.challenge(request('challenge', {}, overrides))).status).toBe(403);
  }
  expect(authorized).toBe(0);
  const response = await handlers.challenge(request('challenge', {}));
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const c = await response.json() as PoseGuardChallenge;
  const { evidence } = followingEvidence(c.seed);
  for (const invalid of [
    { ...evidence, image: 'private' }, { frames: [] }, { frames: Array(1001).fill(evidence.frames[0]) },
    { frames: [evidence.frames[0], { ...evidence.frames[1], t: 0 }] },
    { frames: [evidence.frames[0], { ...evidence.frames[1], t: 46 }] },
    { frames: [evidence.frames[0], { ...evidence.frames[1], yaw: null }] },
    { frames: [evidence.frames[0], { ...evidence.frames[1], eyes: [0] }] },
    { frames: [evidence.frames[0], { ...evidence.frames[1], landmarks: [] }] },
  ]) {
    expect((await handlers.verify(request('verify', { id: c.id, capability: c.capability, evidence: invalid }))).status).toBe(400);
  }
  expect((await handlers.verify(request('verify', { padding: 'x'.repeat(POSEGUARD_BODY_LIMIT) }))).status).toBe(413);
  expect((await handlers.cancel(request('cancel', { id: c.id, capability: c.capability }))).status).toBe(204);
});

test('authorization validates signature, staging RP, expiry, and supported requirements', async () => {
  const { payload, registry } = await signedRequest();
  payload.proof_request.rp_id = 'rp_ab';
  const lookup: Parameters<typeof authorizePoseGuard>[1] = async id => {
    expect(id).toBe(171n);
    return { initialized: true, active: true, signer: registry.signer, manager: registry.signer, oprfKeyId: 1n, unverifiedWellKnownDomain: '' };
  };
  expect((await authorizePoseGuard(payload, lookup)).expiresAt).toBe(payload.proof_request.expires_at * 1000);
  for (const change of [
    { environment: 'production' }, { require_user_presence: true }, { identity_attributes: ['name'] },
    { proof_request: { ...payload.proof_request, signature: `0x${'00'.repeat(65)}` } },
    { proof_request: { ...payload.proof_request, oprf_key_id: '0x2' } },
    { proof_request: { ...payload.proof_request, expires_at: 1 } },
    { proof_request: { ...payload.proof_request, proof_requests: [{ identifier: 'orb', issuer_schema_id: 1 }] } },
  ]) await expect(authorizePoseGuard({ ...payload, ...change }, lookup)).rejects.toThrow();
  await expect(authorizePoseGuard(payload, async id => ({ ...await lookup!(id), active: false }))).rejects.toThrow('invalid_request');
});

test('parallel creation has one winner and shares the request limit with verification and cancellation', async () => {
  const h = harness(); let resolve!: () => void;
  const wait = new Promise<void>(done => { resolve = done; });
  const handlers = createPoseGuardHandlers(h.runs, async () => { await wait; return { binding: 'same', expiresAt: h.expires }; });
  const pending = Array.from({ length: 4 }, () => handlers.challenge(request('challenge', {})));
  expect((await handlers.challenge(request('challenge', {}))).status).toBe(429);
  expect((await handlers.verify(request('verify', {}))).status).toBe(429);
  expect((await handlers.cancel(request('cancel', {}))).status).toBe(429);
  resolve();
  expect((await Promise.all(pending)).map(r => r.status).sort()).toEqual([201, 409, 409, 409]);
});


test('Origin and JSON remain required when fetch metadata is unavailable', async () => {
  const h = harness();
  const handlers = createPoseGuardHandlers(h.runs, async () => ({ binding: 'legacy', expiresAt: h.expires }));
  const make = (includeOrigin: boolean) => new Request(`${origin}/api/poseguard/challenge`, { method: 'POST',
    headers: { ...(includeOrigin ? { origin } : {}), 'content-type': 'application/json' }, body: '{}' });
  expect((await handlers.challenge(make(false))).status).toBe(403);
  expect((await handlers.challenge(make(true))).status).toBe(201);
});
