// Adapted from worldcoin/face-pad e5d90133; see ../lib/poseguard/PROVENANCE.md.
// The key scenarios of android core/PoseChallengeTest.java on the web port (static/core/posechallenge.js):
// targets from the seed and their constraints, the iris offset, the words, a simulated person who
// follows (40 seeds), a printout that follows but whose printed irises stay put, eyes that turn with
// the head, not far enough or the wrong way, a still face, 200 circling videos (3–90°/s), a head that
// drifts on after a target, a face out of view, the clock, the middle measured once and the nose
// parallax of a plane against a face. Plus Java's Random against values java.util.Random gives for the
// same seeds.
//
//   node web/tools/posetest.mjs

import assert from 'node:assert/strict';
import { test } from 'bun:test';
import * as Pose from '../../packages/poseguard/src/vendor/posechallenge.js';

const STEP = 1 / 15.0;
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message ?? ''} ${a} vs ${b} (±${tolerance})`);

test('javaRandom', () => {
  // From the JVM (17): Random(42).nextDouble() ×3, Random(-7).nextDouble(), Random(5).nextGaussian() ×3,
  // Random(Long.MIN_VALUE).nextInt().
  const r = new Pose.JavaRandom(42n);
  assert.equal(r.nextDouble(), 0.7275636800328681);
  assert.equal(r.nextDouble(), 0.6832234717598454);
  assert.equal(r.nextDouble(), 0.30871945533265976);
  assert.equal(new Pose.JavaRandom(-7n).nextDouble(), 0.2691218093260761);
  const g = new Pose.JavaRandom(5);
  assert.deepEqual([g.nextGaussian(), g.nextGaussian(), g.nextGaussian()], [0.23506366996956274, -0.41985748118642735, -0.8885070748712927]);
  // A seed as the samples store it (decimal string, the full 64 bits).
  assert.equal(new Pose.JavaRandom('-9223372036854775808').next(32), -1155484576);
});

test('targetsComeFromTheSeed', () => {
  let repeats = 0;
  for (let seed = 1; seed < 20000; seed++) {
    const a = Pose.targets(seed), b = Pose.targets(BigInt(seed));
    assert.equal(a.length, Pose.TARGETS);
    let left = false, right = false;
    for (let i = 0; i < a.length; i++) {
      const t = a[i];
      assert.equal(t.direction, b[i].direction);
      close(Math.hypot(t.x, t.y), 1, 1e-9);
      if (i === 0) assert.ok(t.armDelay >= Pose.ARM_DELAY_MIN && t.armDelay <= Pose.ARM_DELAY_MAX);
      else assert.ok(t.armDelay >= Pose.NEXT_DELAY_MIN && t.armDelay <= Pose.NEXT_DELAY_MAX);
      // Never the same way twice in a row: the head at rest at the last one starts outside the new sector.
      if (i > 0) assert.ok(Pose.angleBetween(t.direction, a[i - 1].direction) >= Pose.MIN_FROM_PREVIOUS);
      left ||= t.x <= -Pose.SIDE_COSINE;
      right ||= t.x >= Pose.SIDE_COSINE;
    }
    assert.ok(left && right, `seed ${seed}: a target to each side`);
    // An earlier direction may come back (version 8).
    const near = (i, j) => Pose.angleBetween(a[i].direction, a[j].direction) <= Pose.SECTOR_DEGREES;
    if (near(2, 0) || near(3, 1) || near(3, 0)) repeats++;
  }
  // About half the runs (47 % simulated), as on the JVM.
  assert.ok(repeats > 8000 && repeats < 11000, `repeats ${repeats}`);
  assert.notEqual(Pose.targets(1)[0].direction, Pose.targets(2)[0].direction);
  // Directions and pauses as the Android core draws them (PoseChallenge.targets on the JVM, algorithm 8):
  // the preview's seed, −1, and a recorded run's.
  const java = {
    '42': [[166.91528729129521, 0.5023058004555161], [330.9580018327381, 0.18729819488465732], [139.16407476936553, 0.13547569558187567], [297.3477138796156, 0.1344435875375705]],
    '-1': [[215.72212824871653, 0.5686105266870952], [83.74904753342805, 0.13520734057235034], [292.0839180036908, 0.1477446261212211], [38.98320810102061, 0.21925858959815897]],
    '315109044179184695': [[141.32863246888667, 0.15358312282380432], [274.31556898701393, 0.2765119712828279], [21.485623272939964, 0.2578530558408073], [238.14909204569705, 0.22435805447231888]],
  };
  for (const seed of ['42', '-1', '315109044179184695'])
    assert.deepEqual(Pose.targets(seed).map((t) => [t.direction, t.armDelay]), java[seed]);
});

/** A face mesh with only what the eyes need: both eyes' corners, and the irises offset eye widths along them. */
function eyes(offset) {
  const l = new Float32Array(3 * 478);
  const corners = [
    [0.4, 0.46],
    [0.54, 0.6],
  ].map((c) => c.map(Math.fround));
  const index = [
    [33, 133],
    [362, 263],
  ];
  const irisIndex = [468, 473];
  for (let e = 0; e < 2; e++) {
    l[3 * index[e][0]] = corners[e][0];
    l[3 * index[e][1]] = corners[e][1];
    l[3 * index[e][0] + 1] = l[3 * index[e][1] + 1] = 0.4;
    // Java: (float) ((a + b) / 2 + offset * (b - a)) with a, b floats.
    l[3 * irisIndex[e]] = (corners[e][0] + corners[e][1]) / 2 + offset * Math.fround(corners[e][1] - corners[e][0]);
    l[3 * irisIndex[e] + 1] = 0.4;
  }
  return l;
}

test('irisAlongTheEye', () => {
  close(Pose.iris(eyes(0), 720, 960), 0, 1e-6);
  close(Pose.iris(eyes(0.05), 720, 960), 0.05, 1e-6);
  close(Pose.iris(eyes(-0.08), 720, 960), -0.08, 1e-6);
  assert.ok(Number.isNaN(Pose.iris(new Float32Array(3 * 468), 720, 960)));
});

test('directionWords', () => {
  assert.equal(Pose.words(0), 'right');
  assert.equal(Pose.words(359), 'right');
  assert.equal(Pose.words(135), 'up and left');
  assert.equal(Pose.words(270), 'down');
  assert.equal(Pose.words(-40), 'down and right');
});

const seen = (t, yaw, pitch) => Pose.observation(t, true, yaw, pitch);

const COUNTER_ROTATION = -0.005;

/**
 * A person: rests at (yaw0, pitch0) with a little jitter, reacts `reaction` s after a target appears,
 * turns `out` degrees its way (off by `aim` degrees) in `turn` s (smoothly), stays where it reached it until
 * the next appears; the irises move `eyesPerDegree` eye widths per degree of yaw.
 */
function follow(seed, reaction, turn, yaw0, pitch0, out, aim, eyesPerDegree = COUNTER_ROTATION) {
  let t = 100;
  const s = new Pose.Session(seed, t, yaw0, pitch0, null, 720, 960);
  const noise = new Pose.JavaRandom(seed);
  let fromX = 0, fromY = 0, toX = 0, toY = 0, moveAt = NaN, lastIndex = -1, lastPhase = s.phase();
  while (!s.done() && t < 200) {
    t += STEP;
    const phase = s.phase(), index = s.index();
    if (phase !== lastPhase || index !== lastIndex) {
      [fromX, fromY] = s.point();
      if (phase === Pose.Phase.TARGET) {
        const a = Pose.toRadians(s.targets[index].direction + aim);
        toX = out * Math.cos(a);
        toY = -out * Math.sin(a);
      } else {
        // Reached (or waiting in the middle): stay there until the next direction lights up.
        toX = fromX;
        toY = fromY;
      }
      moveAt = t + reaction;
      lastPhase = phase;
      lastIndex = index;
    }
    let u = Number.isNaN(moveAt) ? 1 : Math.max(0, Math.min(1, (t - moveAt) / turn));
    u = 0.5 - 0.5 * Math.cos(Math.PI * u);
    const x = fromX + (toX - fromX) * u + 0.4 * noise.nextGaussian();
    const y = fromY + (toY - fromY) * u + 0.4 * noise.nextGaussian();
    const o = seen(t, yaw0 - x, pitch0 + y);
    o.landmarks = eyes(eyesPerDegree * -x + 0.004 * noise.nextGaussian());
    o.width = 720;
    o.height = 960;
    s.observe(o);
  }
  return s;
}

test('aPersonWhoFollowsPasses (40 seeds)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const out = [17, 30, 22][seed % 3], aim = seed % 2 === 0 ? 15 : -15;
    const s = follow(seed, 0.35, 0.6, 2, 8, out, aim);
    const r = s.result();
    assert.equal(r.status, 'passed', `seed ${seed}: ${r.outcome}`);
    assert.equal(r.metrics.targetsReached, Pose.TARGETS);
    const onset = r.metrics.medianOnsetSeconds;
    assert.ok(onset > 0.3 && onset < 0.8, `onset ${onset}`);
    for (const g of s.targets) {
      assert.ok(g.hit);
      assert.equal(g.wrongWayDegrees, 0);
      assert.ok(g.hitAt - g.enteredAt >= Pose.HOLD_SECONDS - 1e-9);
      assert.ok(g.outAtHit >= Pose.OUT_DEGREES);
    }
    assert.ok(r.metrics.seconds < 12);
    close(r.metrics.gazeSlope, COUNTER_ROTATION, 0.001, 'gaze slope');
  }
});

test('aPrintoutThatFollowsEveryWayFails (20 seeds)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = follow(seed, 0.6, 0.8, 0, 0, 19, 0, 0).result();
    assert.equal(r.status, 'failed');
    assert.equal(r.outcome, 'eyes_turned_with_head');
    assert.equal(r.metrics.targetsReached, Pose.TARGETS);
  }
});

test('noFailOnAPoorView', () => {
  const g = new Pose.Gaze();
  Object.assign(g, { slope: -0.0016, r2: 0.17, yawRange: 40, found: 0.95 });
  assert.equal(Pose.gazeVerdict(g), 'failed');
  g.found = 0.74;
  assert.equal(Pose.gazeVerdict(g), 'inconclusive');
  g.yawRange = 12;
  assert.equal(Pose.gazeVerdict(g), null);
});

test('theYawRangeIsHowFarTheHeadTurnedNotHowLong', () => {
  // PoseChallengeTest's: most of a quick run straight ahead, eight results out each side.
  const pairs = [];
  for (let i = 0; i < 200; i++) pairs.push([((i % 5) - 2) * 0.5, 0.001 * ((i % 3) - 1)]);
  for (let i = 0; i < 8; i++) {
    pairs.push([25, -0.125]);
    pairs.push([-25, 0.125]);
  }
  const g = Pose.gaze(pairs);
  assert.ok(Math.abs(g.yawRange - 50) <= 1e-9, `range ${g.yawRange}`);
  assert.equal(Pose.gazeVerdict(g), 'passed');
  // Four stray results far out do not make a turn.
  pairs.length -= 16;
  for (let i = 0; i < 4; i++) pairs.push([29, -0.145]);
  assert.equal(Pose.gazeVerdict(Pose.gaze(pairs)), null);
});

test('eyesThatLookWhereTheHeadTurnsFail', () => {
  assert.equal(follow(3, 0.35, 0.6, 0, 0, 22, 0, 0.004).result().status, 'failed');
  assert.notEqual(follow(3, 0.35, 0.6, 0, 0, 22, 0, -0.002).result().status, 'passed');
});

test('notFarEnoughOrTheWrongWayIsNotReached', () => {
  assert.equal(follow(5, 0.35, 0.6, 0, 0, 11, 0).result().outcome, 'did_not_follow');
  assert.equal(follow(5, 0.35, 0.6, 0, 0, 25, 40).result().outcome, 'did_not_follow');
  assert.equal(follow(5, 0.35, 0.6, 0, 0, 25, 22.5).result().status, 'passed');
});

test('aStillFaceDoesNotFollow', () => {
  let t = 0;
  const s = new Pose.Session(7, t, 1, 6, null, 720, 960);
  const noise = new Pose.JavaRandom(7);
  while (!s.done() && t < 60) {
    t += STEP;
    s.observe(seen(t, 1 + 3 * Math.sin(t) + 0.3 * noise.nextGaussian(), 6 + 2 * Math.cos(0.7 * t)));
  }
  const r = s.result();
  assert.equal(r.status, 'failed');
  assert.equal(r.outcome, 'did_not_follow');
  assert.equal(r.metrics.targetsShown, 1);
  assert.equal(r.metrics.targetsReached, 0);
});

/** Plays a recorded head (x, y of the mirror view at t, never looking at the targets) to a run from seed, jitter 0.3°. */
function plays(seed, video, noise) {
  let t = 0;
  const s = new Pose.Session(seed, t, 0, 0, null, 720, 960);
  while (!s.done() && t < 120) {
    t += STEP;
    const [x, y] = video(t);
    const yaw = -x + 0.3 * noise.nextGaussian();
    s.observe(seen(t, yaw, y + 0.3 * noise.nextGaussian()));
  }
  return s;
}
const reachedAll = (s) => s.result().status === 'passed' || s.result().metrics.targetsReached === Pose.TARGETS;

test('aCirclingVideoDoesNotPass (220 videos, 3–120°/s)', () => {
  // Frontal for a second and a half (the first target appears), then a head going round and round at 20°.
  // Faster than a rest it never reaches a target; slow enough to look at rest it rests where no target is
  // (version 7).
  const noise = new Pose.JavaRandom(1);
  let passedRuns = 0, runs = 0;
  for (const speed of [3, 5, 8, 12, 16, 20, 30, 45, 60, 90, 120])
    for (let seed = 1; seed <= 20; seed++) {
      const start = 360 * noise.nextDouble(), sense = seed % 2 === 0 ? 1 : -1;
      const s = plays(seed, (t) => {
        const a = Pose.toRadians(start + sense * speed * Math.max(0, t - 1.5)), r = Math.min(20, (20 * Math.max(0, t - 1.5)) / 0.5);
        return [r * Math.cos(a), -r * Math.sin(a)];
      }, noise);
      runs++;
      if (reachedAll(s)) passedRuns++;
    }
  assert.equal(passedRuns, 0);
  assert.equal(runs, 220);
});

test('aVideoThatStopsAndGoesDoesNotPass (240 videos)', () => {
  // Round the circle in steps of 20–45° (each in a sixth of a second), stopping 0.4–1.5 s after each: version
  // 6 took any stop for the stillness before the next target; now a stop counts only in the target's sector,
  // and one anywhere else ends the run.
  const noise = new Pose.JavaRandom(2);
  let passedRuns = 0, runs = 0, stoppedAfterAHit = 0;
  for (const step of [20, 30, 45])
    for (const stop of [0.4, 0.7, 1.0, 1.5])
      for (let seed = 1; seed <= 20; seed++) {
        const start = 360 * noise.nextDouble(), sense = seed % 2 === 0 ? 1 : -1, move = 1 / 6;
        const s = plays(seed, (t) => {
          const since = Math.max(0, t - 1.5), k = Math.floor(since / (stop + move)), u = Math.max(0, since - k * (stop + move) - stop) / move;
          const a = Pose.toRadians(start + sense * step * (k + 0.5 - 0.5 * Math.cos(Math.PI * u))), r = Math.min(20, 40 * since);
          return [r * Math.cos(a), -r * Math.sin(a)];
        }, noise);
        runs++;
        if (reachedAll(s)) passedRuns++;
        if (s.completion() === 'stopped_elsewhere' && s.result().metrics.targetsReached >= 1) stoppedAfterAHit++;
      }
  assert.equal(passedRuns, 0);
  assert.equal(runs, 240);
  // Some stopped in the first target's sector by chance; the next stop ended them.
  assert.ok(stoppedAfterAHit >= 10, `stopped after a hit: ${stoppedAfterAHit}`);
});

test('theNextDirectionFollowsTheGreen', () => {
  // At rest in the first direction until it turns green, then drifting on at 6°/s: the next direction appears
  // its short delay after the green all the same (version 6 waited for the head to hold still).
  const s = new Pose.Session(4, 0, 0, 0, null, 720, 960);
  let t = 0, driftFrom = NaN;
  while (!s.done() && t < 60 && Number.isNaN(s.targets[1].shownAt)) {
    t += STEP;
    let x = 0, y = 0;
    if (s.index() === 0 && s.phase() === Pose.Phase.TARGET) {
      x = 20 * s.targets[0].x;
      y = 20 * s.targets[0].y;
    } else if (s.index() === 1) {
      if (Number.isNaN(driftFrom)) driftFrom = t;
      x = 20 * s.targets[0].x + 6 * (t - driftFrom);
      y = 20 * s.targets[0].y;
    }
    s.observe(seen(t, -x, y));
  }
  const first = s.targets[0], next = s.targets[1];
  assert.ok(first.hit);
  assert.ok(next.shownAt - first.hitAt >= next.armDelay - 1e-9);
  assert.ok(next.shownAt - first.hitAt < next.armDelay + STEP + 1e-9);
});

/**
 * A person who reaches the first target, then on the way to the second comes to rest restOut degrees out,
 * restOff degrees off its direction (turned away from the first), for 0.6 s, then goes on to it.
 */
function restsOnTheWay(seed, restOut, restOff) {
  const s = new Pose.Session(seed, 0, 0, 0, null, 720, 960);
  let t = 0, shown = NaN;
  while (!s.done() && t < 60) {
    t += STEP;
    let x = 0, y = 0;
    const i = s.index();
    if (i === 0 && s.phase() === Pose.Phase.TARGET) {
      x = 20 * s.targets[0].x;
      y = 20 * s.targets[0].y;
    } else if (i === 1 && s.phase() === Pose.Phase.TARGET) {
      if (Number.isNaN(shown)) shown = t;
      const g = s.targets[1];
      const toward = Pose.angleBetween(s.targets[0].direction, g.direction + restOff) < Pose.angleBetween(s.targets[0].direction, g.direction - restOff) ? -restOff : restOff;
      const a = Pose.toRadians(g.direction + (t - shown < 0.6 ? toward : 0)), out = t - shown < 0.6 ? restOut : 20;
      x = out * Math.cos(a);
      y = -out * Math.sin(a);
    } else if (i >= 1) {
      x = 20 * s.targets[i - 1].x;
      y = 20 * s.targets[i - 1].y;
      if (s.phase() === Pose.Phase.TARGET) {
        x = 20 * s.targets[i].x;
        y = 20 * s.targets[i].y;
      }
    }
    s.observe(seen(t, -x, y));
  }
  return s;
}

test('aRestAwayFromTheDirectionEndsTheRun (20 seeds)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    // 20° out, 90° off the second direction (and away from the first): ends the run there.
    const s = restsOnTheWay(seed, 20, 90), r = s.result();
    assert.equal(s.completion(), 'stopped_elsewhere');
    assert.equal(r.status, 'failed');
    assert.equal(r.outcome, 'did_not_follow');
    assert.equal(r.metrics.targetsReached, 1);
    close(s.targets[1].stopDirectionError, 90, 1);
    // Short of it in its direction, 40° off, back near the middle: fine, it goes on and is reached.
    for (const [out, off] of [[10, 0], [20, 40], [3, 90], [9, 90]]) assert.equal(restsOnTheWay(seed, out, off).completion(), 'complete', `${out}° out ${off}° off`);
  }
});

test('aFaceOutOfViewEndsInconclusive', () => {
  const s = new Pose.Session(3, 0, 0, 0, null, 720, 960);
  let t = 0;
  for (; t < 0.5; t += STEP) s.observe(seen(t, 0, 0));
  for (; t < 2 && !s.done(); t += STEP) s.observe(Pose.observation(t, false));
  assert.ok(s.done());
  assert.equal(s.completion(), 'face_lost');
  assert.equal(s.result().status, 'inconclusive');
});

test('theClockEndsAStalledRun', () => {
  const s = new Pose.Session(3, 0, 0, 0, null, 720, 960);
  s.observe(seen(0.1, 0, 0));
  s.tick(0.5);
  assert.ok(!s.done());
  s.tick(1.0);
  assert.equal(s.completion(), 'face_lost');
});

test('theMiddleIsMeasuredOnceBeforeTheFirstDirection', () => {
  // The head rests 5° lower than the framed face (the phone sank a little): the middle moves there before
  // the first direction, and stays there (no return to the middle afterwards).
  const s = new Pose.Session(11, 0, 0, 0, null, 720, 960);
  let t = 0;
  while (!s.done() && t < 120) {
    t += STEP;
    let x = 0, y = 0;
    const i = s.index();
    if (s.phase() === Pose.Phase.TARGET) {
      x = 20 * s.targets[i].x;
      y = 20 * s.targets[i].y;
    } else if (i > 0) {
      x = 20 * s.targets[i - 1].x;
      y = 20 * s.targets[i - 1].y;
    }
    s.observe(seen(t, -x, 5 + y));
  }
  assert.equal(s.completion(), 'complete');
  assert.equal(s.middles().length, 2);
  close(s.middles()[1][2], 5, 1e-9);
});

/** A face-like set of landmarks: the broad surfaces on a gentle curve, the nose tip in front. */
function face(flat) {
  const r = new Pose.JavaRandom(5);
  const p = Array.from({ length: 478 }, () => [r.nextDouble() - 0.5, r.nextDouble() - 0.5, 0]);
  const layout = [
    [0, -0.9], [0, -0.65], [0, -0.5], [-0.6, -0.55], [-0.4, -0.6], [-0.15, -0.55], [0.15, -0.55], [0.4, -0.6],
    [0.6, -0.55], [-0.5, -0.3], [-0.2, -0.3], [0.2, -0.3], [0.5, -0.3], [0, 0.45], [-0.3, 0.55], [0.3, 0.55],
  ];
  Pose.SURFACE.forEach((k, i) => (p[k] = [layout[i][0], layout[i][1], flat ? 0 : -0.25 * layout[i][0] * layout[i][0]]));
  p[Pose.NOSE_TIP] = [0, 0.1, flat ? 0 : 0.45];
  return p;
}

/** Normalised landmarks of p turned by yaw and pitch (degrees), seen by a pinhole 4 units away. */
function view(p, yaw, pitch, w, h) {
  const cy = Math.cos(Pose.toRadians(yaw)), sy = Math.sin(Pose.toRadians(yaw));
  const cp = Math.cos(Pose.toRadians(pitch)), sp = Math.sin(Pose.toRadians(pitch));
  const out = new Float32Array(3 * p.length);
  p.forEach(([x, y, z], i) => {
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    const depth = 4 - z2, focal = 900;
    out[3 * i] = (w / 2.0 + (focal * x1) / depth) / w;
    out[3 * i + 1] = (h / 2.0 + (focal * y2) / depth) / h;
  });
  return out;
}

test('noseParallaxSeparatesAPlaneFromAFace', () => {
  const w = 720, h = 960;
  for (const [yaw, pitch] of [
    [20, 0],
    [-20, 0],
    [0, 18],
    [14, -14],
  ]) {
    const flat = face(true), real = face(false);
    const p = Pose.noseParallax(view(flat, 0, 0, w, h), view(flat, yaw, pitch, w, h), w, h, w, h);
    const q = Pose.noseParallax(view(real, 0, 0, w, h), view(real, yaw, pitch, w, h), w, h, w, h);
    assert.ok(Math.hypot(p[0], p[1]) < 0.01, `flat ${p}`);
    assert.ok(Math.hypot(q[0], q[1]) > 0.08, `face ${q}`);
  }
  assert.equal(Pose.noseParallax(null, new Float32Array(3 * 478), w, h, w, h), null);
});

test('documentRoundTrip', () => {
  // pose_challenge.json as the page writes it (NaN kept) replays to the same result.
  const s = follow(9, 0.35, 0.6, 2, 8, 22, 10);
  const text = Pose.stringifyWithNaN(s.document());
  assert.ok(text.includes('NaN'));
  const doc = Pose.parseJSON(text);
  const replay = { width: 720, height: 960, frames: [] };
  const sequence = Pose.replaySequence(doc, replay, 'roundtrip');
  const again = Pose.replayRun(sequence).result();
  // Without the meshes (no replay frames) the irises are gone: the head's part must agree.
  assert.equal(again.metrics.targetsReached, s.result().metrics.targetsReached);
  assert.equal(again.metrics.medianReachSeconds, s.result().metrics.medianReachSeconds);
});

