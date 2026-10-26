import { expect, spyOn, test } from 'bun:test';
import { captureVerifiedPoseGuard, verifyPoseGuardChallenge } from '../lib/poseguard-api';
import * as capture from '../lib/poseguard-capture';
import { POSEGUARD_PROFILE, type PoseGuardChallenge } from '../../packages/contracts/src/poseguard';
import { signedRequest } from '../../tests/integration/fixtures/request';
import { followingEvidence } from '../../tests/integration/fixtures/poseguard';

const challenge: PoseGuardChallenge = { id: '00000000-0000-4000-8000-000000000001', capability: 'a'.repeat(64),
  seed: '42', profile: POSEGUARD_PROFILE, expiresAt: Date.now() + 3600_000, targets: [] };
const evidence = followingEvidence(challenge.seed).evidence;
const result = { image: new Blob(['test']), timing: { guidanceMs: 300, totalMs: 6000, width: 720, height: 960 }, evidence,
  verdict: { status: 'passed', outcome: 'followed', reason: 'passed', metrics: {} } as const };
const mockFetch = (fn: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => spyOn(globalThis, "fetch").mockImplementation(fn as typeof fetch);
const video = {} as HTMLVideoElement;
const verdict = { profile: POSEGUARD_PROFILE, status: 'passed', outcome: 'followed', reason: 'passed' };

test('local success waits for API verification, sending only bounded measurements', async () => {
  const { payload } = await signedRequest();
  const captured = spyOn(capture, 'capturePoseGuard').mockResolvedValue(result);
  let finish!: (response: Response) => void;
  const calls: Array<{ url: string; body: unknown }> = [];
  const network = mockFetch(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init!.body)) });
    if (String(url).endsWith('/challenge')) return Response.json(challenge);
    return new Promise<Response>(resolve => { finish = resolve; });
  });
  try {
    let complete = false;
    const controller = new AbortController();
    const pending = captureVerifiedPoseGuard(video, controller.signal, () => {}, payload).then(value => { complete = true; return value; });
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    expect(complete).toBe(false);
    expect(captured.mock.calls[0]![3].seed).toBe(challenge.seed);
    expect(Object.keys(calls[1].body as object).sort()).toEqual(['capability', 'evidence', 'id']);
    expect(Object.keys((calls[1].body as { evidence: object }).evidence)).toEqual(['frames']);
    finish(Response.json(verdict));
    expect((await pending).image).toBe(result.image);
    expect(complete).toBe(true);
    expect(calls.length).toBe(2);
    controller.abort();
  } finally { captured.mockRestore(); network.mockRestore(); }
});

for (const response of [
  { status: 'failed', outcome: 'eyes_turned_with_head' },
  { status: 'inconclusive', outcome: 'eyes_unclear' },
  { profile: 'unknown' }, { status: 'unknown' }, { outcome: null },
]) test(`API refusal cannot become success: ${JSON.stringify(response)}`, async () => {
  const { payload } = await signedRequest();
  const captured = spyOn(capture, 'capturePoseGuard').mockResolvedValue(result);
  const network = mockFetch(async url => String(url).endsWith('/challenge')
    ? Response.json(challenge) : String(url).endsWith('/cancel') ? new Response(null, { status: 204 }) : Response.json({ ...verdict, ...response }));
  try {
    await expect(captureVerifiedPoseGuard(video, new AbortController().signal, () => {}, payload)).rejects.toThrow();
    expect(captured.mock.calls[0]![1].aborted).toBe(true);
  } finally { captured.mockRestore(); network.mockRestore(); }
});

test('failed API transport releases retained camera and cancels the challenge', async () => {
  const { payload } = await signedRequest();
  const captured = spyOn(capture, 'capturePoseGuard').mockResolvedValue(result);
  const network = mockFetch(async url => {
    if (String(url).endsWith('/challenge')) return Response.json(challenge);
    if (String(url).endsWith('/cancel')) return new Response(null, { status: 204 });
    throw new Error('offline');
  });
  try {
    await expect(captureVerifiedPoseGuard(video, new AbortController().signal, () => {}, payload, { retainPreviewUntilAbort: true })).rejects.toThrow();
    expect(captured.mock.calls[0]![1].aborted).toBe(true);
    expect(String(network.mock.calls.at(-1)![0])).toEndWith('/cancel');
  } finally { captured.mockRestore(); network.mockRestore(); }
});

test('cancellation during challenge creation cleans up a late response without opening camera', async () => {
  const { payload } = await signedRequest();
  let finish!: (response: Response) => void;
  const captured = spyOn(capture, 'capturePoseGuard');
  const network = mockFetch(async url => String(url).endsWith('/challenge')
    ? new Promise<Response>(resolve => { finish = resolve; }) : new Response(null, { status: 204 }));
  try {
    const controller = new AbortController();
    const pending = captureVerifiedPoseGuard(video, controller.signal, () => {}, payload);
    controller.abort();
    await expect(pending).rejects.toThrow();
    finish(Response.json(challenge));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(captured).not.toHaveBeenCalled();
    expect(String(network.mock.calls.at(-1)![0])).toEndWith('/cancel');
  } finally { captured.mockRestore(); network.mockRestore(); }
});

test('no request payload means no challenge or camera; unavailable verification never passes', async () => {
  const network = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 410 }));
  try {
    await expect(captureVerifiedPoseGuard(video, new AbortController().signal, () => {}, undefined)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
    await expect(verifyPoseGuardChallenge(challenge, evidence, new AbortController().signal)).rejects.toThrow();
  } finally { network.mockRestore(); }
});
