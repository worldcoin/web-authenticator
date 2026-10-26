// Pose challenge: port of android core/PoseChallenge.java (algorithm 7) and PoseChallengeReplay.java.
// The head has to turn the ways the phone picks at random, one after the other, coming to rest where
// each is reached (Face ID enrolment's ring of directions, in an order and at moments nobody knows
// beforehand); a followed challenge then passes only when the irises counter-rotated
// against the yaw (eyes kept on the screen), which a printed iris does not.
//
// The flow: hold the head in the middle (MIDDLE_RADIUS, HOLD_SECONDS), where the middle is measured afresh
// (a hand-held phone drifts; at most MIDDLE_DRIFT from where the run began); after a random pause the first
// target appears: a direction. The head comes to rest at least OUT_DEGREES out within SECTOR_DEGREES of it
// (within STILL_RADIUS for HOLD_SECONDS; any farther out is fine); a moment later (NEXT_DELAY_MIN–
// NEXT_DELAY_MAX) the next target appears, at least MIN_FROM_PREVIOUS from the one before (an earlier one
// may come back), and the head turns on to it. Coming to rest on the way anywhere but near the target's
// direction (STOP_CONE), near the middle (STOP_MIDDLE_RADIUS), where the head was when the target appeared
// (STOP_START_RADIUS) or the previous target's direction ends the run. Version 8 (2026-10-08): directions
// may come back; versions 3–7 also kept each 55° from every earlier one, which made the later ones
// predictable (the best fixed video, one stop per target, passed 2.2 % of runs; now 0.47 %, and 1.7 % with
// two stops per target, the second 20° on, which the rests allowed near the target let through). Version 7
// (2026-10-08): version 6's wait for fresh stillness between targets was slow and let a video circling in
// steps through; now each stop has to be in the target's sector (android/README.md › Pose challenge ›
// Coming to rest in the direction).
//
// Head angles are the face mesh's (MediaPipe's facial transformation matrix: yaw positive when the head
// turns to the user's left, pitch positive when it tilts down), relative to the head at the middle,
// drawn as a point in a mirror view: x = −Δyaw (the user's left is the screen's left), y = Δpitch (down
// is down), in degrees.
//
// The same numbers as the Java: the same constants and order of operations, Java's Random (48-bit LCG)
// for the targets, landmark arithmetic in float where Java computes in float (Math.fround), Java's
// Math.hypot (fdlibm), toRadians/toDegrees by Java's constants. Portable: the page, workers and Node.

import { hypot } from './lightanalyzer.js';
import { median as planarMedian, solve } from './planar.js';

export const VERSION = 8;

/** Targets in a run. */
export const TARGETS = 4;
/** A target is reached at least this far out (degrees of head angle from the middle). */
export const OUT_DEGREES = 15;
/** ... and with the head pointing within this many degrees of the target's direction (the lit ticks). */
export const SECTOR_DEGREES = 25;
/**
 * Each target at least this far (degrees) from the one before: never the same direction twice in a row, and
 * the head, at rest at the previous one (at most SECTOR_DEGREES off its direction), starts well outside the
 * new sector. The only rule between targets (version 8): an earlier one may come back.
 */
export const MIN_FROM_PREVIOUS = 90;
/** In the middle (before the first target): within this many degrees of the middle. */
export const MIDDLE_RADIUS = 7;
/**
 * At rest: within this many degrees of where the rest began, for HOLD_SECONDS. A target is reached by coming
 * to rest in its sector; a rest elsewhere on the way may end the run (STOP_CONE).
 */
export const STILL_RADIUS = 3;
/** The middle, a target or a rest is reached after this long, over at least this many face-mesh results. */
export const HOLD_SECONDS = 0.3;
export const HOLD_OBSERVATIONS = 3;
/** After the middle is held, the first target appears this much later (uniform; leaving the middle restarts). */
export const ARM_DELAY_MIN = 0.15, ARM_DELAY_MAX = 0.6;
/** After a target is reached, the next appears this much later (uniform), wherever the head is then. */
export const NEXT_DELAY_MIN = 0.1, NEXT_DELAY_MAX = 0.3;
/**
 * A rest on the way to a target ends the run unless it is within STOP_CONE degrees of the target's
 * direction, within STOP_MIDDLE_RADIUS of the middle (short of OUT_DEGREES: no target is reached there),
 * within STOP_START_RADIUS of where the head was when the target appeared, or in the previous target's
 * direction (within SECTOR_DEGREES, at any distance).
 */
export const STOP_CONE = 45, STOP_MIDDLE_RADIUS = 10, STOP_START_RADIUS = 8;
/** A target not reached within this long ends the run; so does the middle not held. */
export const TARGET_SECONDS = 8, PAUSE_SECONDS = 6;
/** The middle may move by at most this much from the run's first (degrees). */
export const MIDDLE_DRIFT = 12;
/** The middle is measured from the results this long after the head came within MIDDLE_RADIUS. */
export const MIDDLE_SETTLE = 0.2;
/** No face for longer than this ends the run (FaceContinuity's gap, lib/continuity.js MAX_GAP_SECONDS). */
export const LOST_SECONDS = 0.7;
/** The move towards a target has started once the head has come this far its way (degrees). */
export const ONSET_DEGREES = 3;
/**
 * Moved this far from where the head was when the target appeared, in a direction more than 90° off the
 * target's, counts as a wrong way first (recorded only).
 */
export const WRONG_WAY_DEGREES = 10;
/** Every run has a target at least this far to each side (|cos| of its direction). */
export const SIDE_COSINE = 0.6;
/** The eyes' fit: results within GAZE_MAX_YAW of the run's first yaw, over a yaw range of at least GAZE_MIN_RANGE. */
export const GAZE_MAX_YAW = 30, GAZE_MIN_RANGE = 20;
/**
 * The yaw range: from the this-many-th smallest yaw to the this-many-th largest (version 5; the 5th to 95th
 * percentile measured how long the head stayed turned, not how far it turned).
 */
export const GAZE_RANGE_TRIM = 5;
/** Counter-rotated: slope (eye widths per degree) at most this, R² at least this. */
export const GAZE_SLOPE_PASS = -0.0025, GAZE_R2_PASS = 0.5;
/** Not counter-rotated (a printed iris): R² below this or slope above this. */
export const GAZE_R2_FAIL = 0.25, GAZE_SLOPE_FAIL = -0.0015;
/** ... and only with a clear view: the face found in at least this share of the face-mesh results. */
export const GAZE_MIN_FOUND = 0.9;
/** Eye corners (a, b) of each eye and the two iris centres of the 478-point face mesh. */
export const EYES = [
  [33, 133],
  [362, 263],
];
export const IRISES = [468, 473];
/** Landmarks on the face's broad surfaces (forehead, brows, eye corners, upper lip, mouth corners). */
export const SURFACE = [10, 151, 9, 70, 105, 107, 336, 334, 300, 33, 133, 362, 263, 0, 61, 291];
export const NOSE_TIP = 1, EYE_A = 33, EYE_B = 263;

/** PAUSE: before a target (the middle held before the first; the short delay after one is reached before the others). */
export const Phase = Object.freeze({ PAUSE: 0, TARGET: 1, DONE: 2 });
export const PHASE_NAMES = ['PAUSE', 'TARGET', 'DONE'];

const f = Math.fround;
/** Java's Math.toRadians and Math.toDegrees (JDK 9+: one multiplication by these constants). */
export const toRadians = (x) => x * 0.017453292519943295;
export const toDegrees = (x) => x * 57.29577951308232;

// MARK: java.util.Random

const TWO_24 = 0x1000000;

/**
 * java.util.Random, to the bit: the 48-bit linear congruential generator (multiplier 0x5DEECE66D, addend
 * 0xB), kept as two 24-bit halves so every product stays exact in a double. Seeds are 64-bit (BigInt,
 * a decimal string or a safe integer), scrambled as Java's constructor does.
 */
export class JavaRandom {
  constructor(seed) {
    const s = BigInt.asUintN(48, BigInt.asUintN(64, BigInt(seed)) ^ 0x5deece66dn);
    this.hi = Number(s >> 24n);
    this.lo = Number(s & 0xffffffn);
    this.nextNextGaussian = 0;
    this.haveNextNextGaussian = false;
  }

  /** Java's next(bits): the top bits of the advanced state, as an int. */
  next(bits) {
    // (seed * 0x5DEECE66D + 0xB) mod 2^48 with seed = hi·2^24 + lo and the multiplier 0x5DE·2^24 + 0xECE66D.
    const p0 = this.lo * 0xece66d + 0xb;
    const lo = p0 % TWO_24;
    const hi = (this.lo * 0x5de + this.hi * 0xece66d + Math.floor(p0 / TWO_24)) % TWO_24;
    this.hi = hi;
    this.lo = lo;
    const v = Math.floor((hi * TWO_24 + lo) / 2 ** (48 - bits));
    return bits === 32 ? v | 0 : v;
  }

  nextDouble() {
    return (this.next(26) * 134217728 + this.next(27)) * 2 ** -53;
  }

  /** Java's nextGaussian (polar method). StrictMath.log is fdlibm's, as V8's Math.log. */
  nextGaussian() {
    if (this.haveNextNextGaussian) {
      this.haveNextNextGaussian = false;
      return this.nextNextGaussian;
    }
    let v1, v2, s;
    do {
      v1 = 2 * this.nextDouble() - 1;
      v2 = 2 * this.nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const multiplier = Math.sqrt((-2 * Math.log(s)) / s);
    this.nextNextGaussian = v2 * multiplier;
    this.haveNextNextGaussian = true;
    return v1 * multiplier;
  }
}

/** A fresh 64-bit seed from the platform's secure generator (as java.security.SecureRandom.nextLong), signed. */
export function secureSeed() {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return BigInt.asIntN(64, (BigInt(b[0]) << 32n) | BigInt(b[1]));
}

// MARK: Targets

export class Target {
  constructor() {
    this.index = 0;
    /** Direction anticlockwise from the screen's right (degrees). */
    this.direction = 0;
    /** The unit direction in the mirror view (y down). */
    this.x = 0;
    this.y = 0;
    /** The pause before this target appears: after the middle is held (the first), after the one before is reached (seconds). */
    this.armDelay = 0;
    /** The head's angles at the middle this target was measured from. */
    this.middleYaw = NaN;
    this.middlePitch = NaN;
    this.shownAt = NaN;
    this.onsetAt = NaN;
    this.enteredAt = NaN;
    this.hitAt = NaN;
    this.pathDegrees = 0;
    this.peakDegreesPerSecond = 0;
    this.reachDegrees = 0;
    this.outAtHit = NaN;
    this.firstOutDirectionError = NaN;
    /**
     * Farthest the head moved, from where it was when the target appeared, in a direction more than 90° off
     * the target's before the hit (0: never past WRONG_WAY_DEGREES).
     */
    this.wrongWayDegrees = 0;
    /** When the head came to rest where a rest ends the run, and how far off this target's direction (degrees). */
    this.stoppedAt = NaN;
    this.stopDirectionError = NaN;
    /** The nose tip against the plane through the face's broad surfaces (interocular distances; recorded, not decided). */
    this.noseParallax = NaN;
    this.noseParallaxX = NaN;
    this.noseParallaxY = NaN;
    this.hit = false;
  }

  document() {
    return {
      index: this.index,
      directionDegrees: this.direction,
      x: this.x,
      y: this.y,
      armDelaySeconds: this.armDelay,
      middleYaw: this.middleYaw,
      middlePitch: this.middlePitch,
      shownAt: this.shownAt,
      onsetAt: this.onsetAt,
      enteredAt: this.enteredAt,
      hitAt: this.hitAt,
      hit: this.hit,
      onsetSeconds: this.onsetAt - this.shownAt,
      hitSeconds: this.hitAt - this.shownAt,
      pathDegrees: this.pathDegrees,
      directness: this.hit && this.pathDegrees > 0 ? Math.min(1, OUT_DEGREES / this.pathDegrees) : NaN,
      peakDegreesPerSecond: this.peakDegreesPerSecond,
      reachDegrees: this.reachDegrees,
      outAtHit: this.outAtHit,
      firstOutDirectionError: this.firstOutDirectionError,
      wrongWayDegrees: this.wrongWayDegrees,
      stoppedAt: this.stoppedAt,
      stopDirectionError: this.stopDirectionError,
      noseParallax: this.noseParallax,
      noseParallaxX: this.noseParallaxX,
      noseParallaxY: this.noseParallaxY,
    };
  }
}

/** The targets of a run, from its seed: drawn again until one lies to each side. */
export function targets(seed) {
  const random = new JavaRandom(seed);
  for (;;) {
    const out = draw(random);
    if (out === null) continue;
    let left = false, right = false;
    for (const t of out) {
      left ||= t.x <= -SIDE_COSINE;
      right ||= t.x >= SIDE_COSINE;
    }
    if (left && right) return out;
  }
}

/** One draw; null when a target found no direction far enough from the one before in 1000 tries (the set is drawn again). */
function draw(random) {
  const out = [];
  for (let i = 0; i < TARGETS; i++) {
    let direction, apart;
    let tries = 0;
    do {
      if (++tries > 1000) return null;
      direction = 360 * random.nextDouble();
      apart = out.length === 0 || angleBetween(direction, out[out.length - 1].direction) >= MIN_FROM_PREVIOUS;
    } while (!apart);
    const t = new Target();
    t.index = i;
    t.direction = direction;
    t.x = Math.cos(toRadians(direction));
    t.y = -Math.sin(toRadians(direction));
    t.armDelay =
      i === 0
        ? ARM_DELAY_MIN + (ARM_DELAY_MAX - ARM_DELAY_MIN) * random.nextDouble()
        : NEXT_DELAY_MIN + (NEXT_DELAY_MAX - NEXT_DELAY_MIN) * random.nextDouble();
    out.push(t);
  }
  return out;
}

/** The smaller angle between two directions (degrees, 0…180). */
export function angleBetween(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

const WORDS = ['right', 'up and right', 'up', 'up and left', 'left', 'down and left', 'down', 'down and right'];

/** The direction in words, as the user turns (the mirror view's left is the user's left). */
export function words(direction) {
  return WORDS[Math.floor(((((direction + 22.5) % 360) + 360) % 360) / 45) | 0];
}

/** One face-mesh result: t, present, yaw, pitch, landmarks (normalised (x, y, z) floats or null), width, height. */
export function observation(t, present, yaw = NaN, pitch = NaN, landmarks = null, width = 0, height = 0) {
  return { t, present, yaw, pitch, landmarks, width, height };
}

/** The rules of the challenge, for the sample. */
export function constants() {
  return {
    version: VERSION,
    targets: TARGETS,
    outDegrees: OUT_DEGREES,
    sectorDegrees: SECTOR_DEGREES,
    middleRadiusDegrees: MIDDLE_RADIUS,
    middleSettleSeconds: MIDDLE_SETTLE,
    holdSeconds: HOLD_SECONDS,
    holdObservations: HOLD_OBSERVATIONS,
    armDelaySeconds: [ARM_DELAY_MIN, ARM_DELAY_MAX],
    nextDelaySeconds: [NEXT_DELAY_MIN, NEXT_DELAY_MAX],
    targetSeconds: TARGET_SECONDS,
    pauseSeconds: PAUSE_SECONDS,
    stillRadiusDegrees: STILL_RADIUS,
    stopConeDegrees: STOP_CONE,
    stopMiddleRadiusDegrees: STOP_MIDDLE_RADIUS,
    stopStartRadiusDegrees: STOP_START_RADIUS,
    minimumFromPreviousDegrees: MIN_FROM_PREVIOUS,
    middleDriftDegrees: MIDDLE_DRIFT,
    lostSeconds: LOST_SECONDS,
    sideCosine: SIDE_COSINE,
    gazeMaxYawDegrees: GAZE_MAX_YAW,
    gazeMinYawRangeDegrees: GAZE_MIN_RANGE,
    gazeYawRangeTrim: GAZE_RANGE_TRIM,
    gazePass: { slope: GAZE_SLOPE_PASS, r2: GAZE_R2_PASS },
    gazeFail: { r2Below: GAZE_R2_FAIL, slopeAbove: GAZE_SLOPE_FAIL, faceFoundAtLeast: GAZE_MIN_FOUND },
  };
}

// MARK: The eyes

/**
 * Where the irises sit along their eyes, in eye widths from the middle of each eye's corners, positive
 * towards the image's right, the mean of both eyes; NaN without the iris points (478).
 */
export function iris(landmarks, width, height) {
  if (!landmarks || landmarks.length < 3 * 478) return NaN;
  let sum = 0;
  for (const eye of EYES) {
    // float × int in Java: rounded to float.
    const ax = f(landmarks[3 * eye[0]] * width), ay = f(landmarks[3 * eye[0] + 1] * height);
    const bx = f(landmarks[3 * eye[1]] * width), by = f(landmarks[3 * eye[1] + 1] * height);
    const mx = (ax + bx) / 2, my = (ay + by) / 2, w = hypot(bx - ax, by - ay);
    if (!(w > 0)) return NaN;
    const ux = (bx - ax) / w, uy = (by - ay) / w, sign = ux >= 0 ? 1 : -1;
    // The iris nearer this eye's middle.
    let best = Infinity, along = NaN;
    for (const k of IRISES) {
      const dx = f(landmarks[3 * k] * width) - mx, dy = f(landmarks[3 * k + 1] * height) - my;
      const d = hypot(dx, dy);
      if (d < best) {
        best = d;
        along = ((dx * ux + dy * uy) * sign) / w;
      }
    }
    sum += along;
  }
  return sum / EYES.length;
}

/** The eyes against the head: least-squares slope of the iris offset on the yaw, its R², the yaw range used. */
export class Gaze {
  constructor() {
    this.slope = NaN;
    this.r2 = NaN;
    this.yawRange = 0;
    this.residual = NaN;
    /** Share of the face-mesh results with the face (and its irises) found. */
    this.found = 1;
    this.results = 0;
  }
}

/** The fit over (yaw relative to the run's first, iris) pairs within GAZE_MAX_YAW. */
export function gaze(yawIris) {
  const g = new Gaze();
  const use = [];
  for (const p of yawIris) if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= GAZE_MAX_YAW) use.push(p);
  g.results = use.length;
  if (use.length < 10) return g;
  const yaws = new Float64Array(use.length);
  let my = 0, mi = 0;
  for (let i = 0; i < use.length; i++) {
    yaws[i] = use[i][0];
    my += use[i][0] / use.length;
    mi += use[i][1] / use.length;
  }
  // Float64Array sorts numerically with −0 before +0, as Java's Arrays.sort(double[]).
  yaws.sort();
  g.yawRange = yaws[yaws.length - GAZE_RANGE_TRIM] - yaws[GAZE_RANGE_TRIM - 1];
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of use) {
    sxy += (p[0] - my) * (p[1] - mi);
    sxx += (p[0] - my) * (p[0] - my);
    syy += (p[1] - mi) * (p[1] - mi);
  }
  if (!(sxx > 0) || !(syy > 0)) return g;
  g.slope = sxy / sxx;
  g.r2 = (sxy * sxy) / (sxx * syy);
  g.residual = Math.sqrt(Math.max(0, syy - g.slope * sxy) / use.length);
  return g;
}

/** "passed" (the eyes counter-rotated), "failed" (they did not: a printed iris), else "inconclusive"; null: too little yaw. */
export function gazeVerdict(g) {
  if (!(g.yawRange >= GAZE_MIN_RANGE) || !Number.isFinite(g.slope)) return null;
  if (g.slope <= GAZE_SLOPE_PASS && g.r2 >= GAZE_R2_PASS) return 'passed';
  if ((g.r2 < GAZE_R2_FAIL || g.slope > GAZE_SLOPE_FAIL) && g.found >= GAZE_MIN_FOUND) return 'failed';
  return 'inconclusive';
}

/** Trace columns: one row per face-mesh result. */
export const TRACE_COLUMNS = ['t', 'present', 'yaw', 'pitch', 'x', 'y', 'phase', 'target', 'hold', 'iris'];

// MARK: Session

/** One run. Fed every face-mesh result (observe) and the clock (tick); read through the getters. */
export class Session {
  /**
   * Starts in the middle at the reference frame's angles; its mesh (normalised landmarks of a width ×
   * height frame, may be null) is the first middle's. seed: a 64-bit integer (BigInt, decimal string).
   */
  constructor(seed, t, yaw, pitch, mesh, width, height) {
    this.seed = BigInt.asIntN(64, BigInt(seed));
    this.targets = targets(this.seed);
    this.startedAt = t;
    this.firstYaw = this.middleYaw = yaw;
    this.firstPitch = this.middlePitch = pitch;
    this._phase = Phase.PAUSE;
    this._index = 0;
    this.x = 0;
    this.y = 0;
    this._hold = 0;
    this._present = true;
    this._completion = null;
    this.completedAt = NaN;
    this.phaseSince = t;
    this.lastSeen = t;
    this.insideSince = NaN;
    this.insideCount = 0;
    /** In the middle: (t, yaw, pitch) of every result since the head came within the radius. */
    this.resting = [];
    /** In a target's sector: where the head's rest began (mirror view, degrees). */
    this.holdX = 0;
    this.holdY = 0;
    /** On the way to a target: where and when the head's latest rest began, and its results since. */
    this.restX = 0;
    this.restY = 0;
    this.restSince = NaN;
    this.restCount = 0;
    this.candidateMesh = null;
    this.middleMesh = mesh ?? null;
    this.meshWidth = width;
    this.meshHeight = height;
    this.armAt = NaN;
    this.startProjection = 0;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.lastT = NaN;
    this._trace = [];
    this._middles = [[t, yaw, pitch]];
  }

  observe(o) {
    if (this._completion !== null || !Number.isFinite(o.t)) return;
    if (!o.present || !Number.isFinite(o.yaw) || !Number.isFinite(o.pitch)) {
      this._present = false;
      this.resetHold();
      this.restSince = NaN;
      this._trace.push([o.t, 0, NaN, NaN, NaN, NaN, this._phase, this._index, 0, NaN]);
      this.tick(o.t);
      return;
    }
    this._present = true;
    this.lastSeen = o.t;
    const px = -(o.yaw - this.middleYaw), py = o.pitch - this.middlePitch;
    if (this._phase === Phase.PAUSE) this.pause(o, px, py);
    else if (this._phase === Phase.TARGET) this.target(o, px, py);
    // The middle may just have been measured afresh: the point is relative to the new one.
    this.x = -(o.yaw - this.middleYaw);
    this.y = o.pitch - this.middlePitch;
    this.lastX = this.x;
    this.lastY = this.y;
    this.lastT = o.t;
    this._trace.push([o.t, 1, o.yaw, o.pitch, this.x, this.y, this._phase, this._index, this._hold, iris(o.landmarks, o.width, o.height)]);
    this.tick(o.t);
  }

  /**
   * Before a target: the first waits for the head in the middle, then its random delay, still in the middle,
   * and it appears; every later one appears its delay after the one before was reached, wherever the head is.
   */
  pause(o, px, py) {
    if (this._index > 0) {
      if (o.t >= this.armAt) this.show(o);
      return;
    }
    if (hypot(px, py) > MIDDLE_RADIUS) {
      this.resetHold();
      this.armAt = NaN;
      return;
    }
    if (Number.isNaN(this.insideSince)) {
      this.insideSince = o.t;
      this.insideCount = 0;
      this.resting.length = 0;
    }
    this.insideCount++;
    this.resting.push([o.t, o.yaw, o.pitch]);
    if (o.landmarks) {
      this.candidateMesh = o.landmarks;
      this.meshWidth = o.width;
      this.meshHeight = o.height;
    }
    this._hold = Math.min(1, (o.t - this.insideSince) / HOLD_SECONDS);
    if (o.t - this.insideSince < HOLD_SECONDS || this.insideCount < HOLD_OBSERVATIONS) return;
    if (Number.isNaN(this.armAt)) this.armAt = o.t + this.targets[this._index].armDelay;
    if (o.t < this.armAt) return;
    this.remeasureMiddle(o.t);
    this.show(o);
  }

  /** The next target appears. */
  show(o) {
    const next = this.targets[this._index];
    this._phase = Phase.TARGET;
    this.phaseSince = o.t;
    next.shownAt = o.t;
    next.middleYaw = this.middleYaw;
    next.middlePitch = this.middlePitch;
    this.startX = -(o.yaw - this.middleYaw);
    this.startY = o.pitch - this.middlePitch;
    this.startProjection = this.startX * next.x + this.startY * next.y;
    this.resetHold();
    this.restSince = NaN;
    this.armAt = NaN;
    this.lastT = NaN;
  }

  /**
   * The middle measured afresh, where the head has come to rest before the first target (a hand-held phone
   * drifts), but not farther than MIDDLE_DRIFT from the run's first.
   */
  remeasureMiddle(t) {
    let yaw = 0, pitch = 0, n = 0;
    for (const r of this.resting)
      if (r[0] >= this.insideSince + MIDDLE_SETTLE) {
        yaw += r[1];
        pitch += r[2];
        n++;
      }
    if (n === 0)
      for (const r of this.resting) {
        yaw += r[1];
        pitch += r[2];
        n++;
      }
    yaw /= n;
    pitch /= n;
    if (hypot(yaw - this.firstYaw, pitch - this.firstPitch) <= MIDDLE_DRIFT) {
      this.middleYaw = yaw;
      this.middlePitch = pitch;
      if (this.candidateMesh !== null) this.middleMesh = this.candidateMesh;
      this._middles.push([t, yaw, pitch]);
    }
  }

  target(o, px, py) {
    const g = this.targets[this._index];
    if (Number.isFinite(this.lastT) && o.t > this.lastT) {
      const step = hypot(px - this.lastX, py - this.lastY);
      g.pathDegrees += step;
      // Over at least two camera frames: one face-mesh result after another can be close in time.
      if (o.t - this.lastT >= 0.05) g.peakDegreesPerSecond = Math.max(g.peakDegreesPerSecond, step / (o.t - this.lastT));
    }
    const along = px * g.x + py * g.y, out = hypot(px, py);
    g.reachDegrees = Math.max(g.reachDegrees, along);
    if (Number.isNaN(g.onsetAt) && along - this.startProjection >= ONSET_DEGREES) g.onsetAt = o.t;
    const movedX = px - this.startX, movedY = py - this.startY, moved = hypot(movedX, movedY);
    if (moved >= WRONG_WAY_DEGREES && movedX * g.x + movedY * g.y < 0) g.wrongWayDegrees = Math.max(g.wrongWayDegrees, moved);
    const pointing = toDegrees(Math.atan2(-py, px)), off = angleBetween(pointing, g.direction);
    if (out >= OUT_DEGREES && Number.isNaN(g.firstOutDirectionError)) g.firstOutDirectionError = off;
    // Come to rest where no target is: the run ends (a video that stops and goes guesses with every stop).
    if (Number.isFinite(this.restSince) && hypot(px - this.restX, py - this.restY) <= STILL_RADIUS) {
      this.restCount++;
      if (o.t - this.restSince >= HOLD_SECONDS && this.restCount >= HOLD_OBSERVATIONS && !this.restAllowed(g, px, py, pointing, off)) {
        g.stoppedAt = o.t;
        g.stopDirectionError = off;
        this._phase = Phase.DONE;
        this._completion = 'stopped_elsewhere';
        this.completedAt = o.t;
        this.resetHold();
        return;
      }
    } else {
      this.restX = px;
      this.restY = py;
      this.restSince = o.t;
      this.restCount = 1;
    }
    if (out < OUT_DEGREES || off > SECTOR_DEGREES || (Number.isFinite(this.insideSince) && hypot(px - this.holdX, py - this.holdY) > STILL_RADIUS))
      this.resetHold();
    if (out < OUT_DEGREES || off > SECTOR_DEGREES) return;
    if (Number.isNaN(this.insideSince)) {
      this.insideSince = o.t;
      this.insideCount = 0;
      this.holdX = px;
      this.holdY = py;
      if (Number.isNaN(g.enteredAt)) g.enteredAt = o.t;
    }
    this.insideCount++;
    this._hold = Math.min(1, (o.t - this.insideSince) / HOLD_SECONDS);
    if (o.t - this.insideSince < HOLD_SECONDS || this.insideCount < HOLD_OBSERVATIONS) return;
    g.hit = true;
    g.hitAt = o.t;
    g.outAtHit = out;
    const parallax = noseParallax(this.middleMesh, o.landmarks, this.meshWidth, this.meshHeight, o.width, o.height);
    if (parallax !== null) {
      g.noseParallaxX = parallax[0];
      g.noseParallaxY = parallax[1];
      g.noseParallax = hypot(parallax[0], parallax[1]);
    }
    this._index++;
    this.resetHold();
    this.phaseSince = o.t;
    if (this._index >= this.targets.length) {
      this._phase = Phase.DONE;
      this._completion = 'complete';
      this.completedAt = o.t;
    } else {
      this._phase = Phase.PAUSE;
      this.armAt = o.t + this.targets[this._index].armDelay;
    }
  }

  /**
   * Where a rest on the way to g is fine: near its direction (short of it, or just off the sector), the
   * middle, where the head was when it appeared, the previous target's direction.
   */
  restAllowed(g, px, py, pointing, off) {
    if (off <= STOP_CONE || hypot(px, py) <= STOP_MIDDLE_RADIUS || hypot(px - this.startX, py - this.startY) <= STOP_START_RADIUS) return true;
    return g.index > 0 && angleBetween(pointing, this.targets[g.index - 1].direction) <= SECTOR_DEGREES;
  }

  resetHold() {
    this.insideSince = NaN;
    this.insideCount = 0;
    this._hold = 0;
  }

  /** By the clock: a face out of view, a target not reached or a pause not held in time end the run. */
  tick(t) {
    if (this._completion !== null) return;
    let ended = null;
    if (t - this.lastSeen > LOST_SECONDS) ended = 'face_lost';
    else if (this._phase === Phase.TARGET && t - this.phaseSince > TARGET_SECONDS) ended = 'target_timeout';
    else if (this._phase === Phase.PAUSE && this._index === 0 && t - this.phaseSince > PAUSE_SECONDS) ended = 'pause_timeout';
    if (ended === null) return;
    this._completion = ended;
    this.completedAt = t;
    this._phase = Phase.DONE;
  }

  done() {
    return this._completion !== null;
  }

  completion() {
    return this._completion;
  }

  phase() {
    return this._phase;
  }

  /** The target being worked on (the next one in the pause phase), its number from 0. */
  index() {
    return this._index;
  }

  /** The head's point now (degrees, mirror view, y down). */
  point() {
    return [this.x, this.y];
  }

  present() {
    return this._present;
  }

  /** How far the current hold has come, 0…1. */
  hold() {
    return this._hold;
  }

  /** The middle has been held, or a target reached, and the next target is about to appear. */
  armed() {
    return Number.isFinite(this.armAt);
  }

  trace() {
    return this._trace.slice();
  }

  /** Every time the middle was measured: (t, yaw, pitch). */
  middles() {
    return this._middles.slice();
  }

  /** pose_challenge.json: the seed, the middles, the targets and every face-mesh result. */
  document() {
    return {
      version: VERSION,
      seed: this.seed.toString(),
      startedAt: this.startedAt,
      firstYaw: this.firstYaw,
      firstPitch: this.firstPitch,
      completion: this._completion,
      middles: this._middles.slice(),
      targets: this.targets.map((g) => g.document()),
      columns: TRACE_COLUMNS,
      rows: this._trace.slice(),
    };
  }

  result() {
    const r = { status: null, outcome: null, reason: null, metrics: {} };
    let hits = 0, shown = 0, wrong = 0, stop = NaN;
    const onsets = [], times = [], parallax = [], peaks = [];
    for (const g of this.targets) {
      if (Number.isFinite(g.shownAt)) shown++;
      if (Number.isFinite(g.stoppedAt)) stop = g.stopDirectionError;
      if (g.hit) {
        hits++;
        times.push(g.hitAt - g.shownAt);
        if (Number.isFinite(g.onsetAt)) onsets.push(g.onsetAt - g.shownAt);
        if (Number.isFinite(g.noseParallax)) parallax.push(g.noseParallax);
        peaks.push(g.peakDegreesPerSecond);
        if (g.wrongWayDegrees > 0) wrong++;
      }
    }
    const m = r.metrics;
    m.targets = this.targets.length;
    m.targetsShown = shown;
    m.targetsReached = hits;
    m.medianOnsetSeconds = median(onsets);
    m.medianReachSeconds = median(times);
    m.medianPeakDegreesPerSecond = median(peaks);
    m.wrongWayFirst = wrong;
    m.stopDirectionError = stop;
    m.medianNoseParallax = median(parallax);
    m.minimumNoseParallax = parallax.length === 0 ? NaN : parallax.reduce((a, b) => (b < a ? b : a));
    m.middleDriftDegrees = hypot(this.middleYaw - this.firstYaw, this.middlePitch - this.firstPitch);
    m.seconds = Number.isFinite(this.completedAt) ? this.completedAt - this.startedAt : NaN;
    const pairs = [];
    let seen = 0;
    for (const row of this._trace) {
      if (row[1] === 1) pairs.push([row[2] - this.firstYaw, row[9]]);
      if (row[1] === 1 && Number.isFinite(row[9])) seen++;
    }
    const g = gaze(pairs);
    g.found = this._trace.length === 0 ? 0 : seen / this._trace.length;
    m.gazeFaceFound = g.found;
    m.gazeSlope = g.slope;
    m.gazeR2 = g.r2;
    m.gazeYawRange = g.yawRange;
    m.gazeResidual = g.residual;
    m.gazeResults = g.results;
    const eyes = gazeVerdict(g);
    switch (this._completion ?? '') {
      case 'complete':
        if (eyes === 'passed') Object.assign(r, { status: 'passed', outcome: 'followed', reason: 'The head turned every way asked, the eyes stayed on the screen' });
        else if (eyes === 'failed') Object.assign(r, { status: 'failed', outcome: 'eyes_turned_with_head', reason: 'The eyes turned with the head. Keep looking at the screen while you turn.' });
        else if (eyes === null) Object.assign(r, { status: 'inconclusive', outcome: 'too_little_turn', reason: 'Turn further to the left and to the right' });
        else Object.assign(r, { status: 'inconclusive', outcome: 'eyes_unclear', reason: 'Could not tell whether the eyes stayed on the screen' });
        break;
      case 'target_timeout':
        Object.assign(r, { status: 'failed', outcome: 'did_not_follow', reason: `The head did not turn to target ${this._index + 1} of ${this.targets.length}` });
        break;
      case 'stopped_elsewhere':
        Object.assign(r, { status: 'failed', outcome: 'did_not_follow', reason: `The head stopped away from target ${this._index + 1} of ${this.targets.length}` });
        break;
      case 'pause_timeout':
        Object.assign(r, { status: 'failed', outcome: 'did_not_hold_still', reason: 'The head did not hold still in the middle' });
        break;
      case 'face_lost':
        Object.assign(r, { status: 'inconclusive', outcome: 'face_lost', reason: 'Keep your face in view while you turn' });
        break;
      default:
        Object.assign(r, { status: 'inconclusive', outcome: 'unfinished', reason: 'The challenge did not finish' });
    }
    return r;
  }
}

export function median(v) {
  return v.length === 0 ? NaN : planarMedian(v);
}

// MARK: Nose parallax (recorded, not decided)

/**
 * The nose tip's move against the face's broad surfaces from before to after (normalised landmarks of
 * frames w0 × h0 and w1 × h1): a homography fitted to SURFACE carries the earlier nose tip to where a
 * plane through them would put it; the offset of the actual one, in interocular distances of the later
 * frame (x, y in image coordinates). Null when either mesh is missing or the fit fails.
 */
export function noseParallax(before, after, w0, h0, w1, h1) {
  if (!before || !after || before.length < 3 * 468 || after.length < 3 * 468) return null;
  const n = SURFACE.length;
  const ax = new Float64Array(n), ay = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = SURFACE[i];
    ax[i] = f(before[3 * k] * w0);
    ay[i] = f(before[3 * k + 1] * h0);
    bx[i] = f(after[3 * k] * w1);
    by[i] = f(after[3 * k + 1] * h1);
  }
  const iodA = hypot(f(f(before[3 * EYE_A] - before[3 * EYE_B]) * w0), f(f(before[3 * EYE_A + 1] - before[3 * EYE_B + 1]) * h0));
  const iodB = hypot(f(f(after[3 * EYE_A] - after[3 * EYE_B]) * w1), f(f(after[3 * EYE_A + 1] - after[3 * EYE_B + 1]) * h1));
  if (!(iodA > 0) || !(iodB > 0)) return null;
  // Centred and scaled by the interocular distance, for a well-conditioned fit.
  let max = 0, may = 0, mbx = 0, mby = 0;
  for (let i = 0; i < n; i++) {
    max += ax[i] / n;
    may += ay[i] / n;
    mbx += bx[i] / n;
    mby += by[i] / n;
  }
  const ata = Array.from({ length: 8 }, () => new Float64Array(8));
  const atb = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const x = (ax[i] - max) / iodA, y = (ay[i] - may) / iodA, u = (bx[i] - mbx) / iodB, v = (by[i] - mby) / iodB;
    const rows = [
      [x, y, 1, 0, 0, 0, -u * x, -u * y],
      [0, 0, 0, x, y, 1, -v * x, -v * y],
    ];
    const rhs = [u, v];
    for (let r = 0; r < 2; r++)
      for (let p = 0; p < 8; p++) {
        atb[p] += rows[r][p] * rhs[r];
        for (let q = 0; q < 8; q++) ata[p][q] += rows[r][p] * rows[r][q];
      }
  }
  const h = solve(ata, atb);
  if (h === null) return null;
  const x = (f(before[3 * NOSE_TIP] * w0) - max) / iodA, y = (f(before[3 * NOSE_TIP + 1] * h0) - may) / iodA;
  const d = h[6] * x + h[7] * y + 1;
  if (!(Math.abs(d) > 1e-9)) return null;
  const u = (h[0] * x + h[1] * y + h[2]) / d, v = (h[3] * x + h[4] * y + h[5]) / d;
  const nu = (f(after[3 * NOSE_TIP] * w1) - mbx) / iodB, nv = (f(after[3 * NOSE_TIP + 1] * h1) - mby) / iodB;
  return [nu - u, nv - v];
}

// MARK: Replay (PoseChallengeReplay)

/**
 * JSON as the samples write it (Gson keeps NaN and ±Infinity as bare tokens; pose_challenge.json and the
 * trace files carry them): read with those tokens as null, which every reader here takes as NaN.
 */
export function parseJSON(text) {
  return JSON.parse(text.replace(/([:\[,]\s*)-?(?:NaN|Infinity)(?=\s*[,\]}])/g, '$1null'));
}

/** JSON with NaN and ±Infinity written as bare tokens (as Gson's serializeSpecialFloatingPointValues). */
export function stringifyWithNaN(value) {
  return JSON.stringify(value, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `\u0000${v}` : v)).replace(/"\\u0000(NaN|-?Infinity)"/g, '$1');
}

const number = (v) => (v === null || v === undefined ? NaN : v);

/**
 * A sample played back: its seed, its first face and every face-mesh result in order (pose_challenge.json's
 * rows, each present one with its mesh from replay.json by time). challenge, replay: the parsed documents.
 */
export function replaySequence(challenge, replay, name) {
  const s = {
    name,
    seed: BigInt.asIntN(64, BigInt(String(challenge.seed))),
    startedAt: challenge.startedAt,
    firstYaw: number(challenge.firstYaw),
    firstPitch: number(challenge.firstPitch),
    width: replay.width,
    height: replay.height,
    firstMesh: null,
    observations: [],
  };
  const meshes = new Map();
  for (const fr of replay.frames) {
    if (!Array.isArray(fr.landmarks)) continue;
    meshes.set(fr.t, Float32Array.from(fr.landmarks, (v) => (v === null ? NaN : v)));
  }
  s.firstMesh = meshes.get(s.startedAt) ?? null;
  const columns = challenge.columns;
  const t = columns.indexOf('t'), present = columns.indexOf('present'), yaw = columns.indexOf('yaw'), pitch = columns.indexOf('pitch');
  for (const row of challenge.rows) {
    const o = observation(number(row[t]), number(row[present]) === 1);
    if (o.present) {
      o.yaw = number(row[yaw]);
      o.pitch = number(row[pitch]);
      o.landmarks = meshes.get(o.t) ?? null;
      o.width = s.width;
      o.height = s.height;
    }
    s.observations.push(o);
  }
  return s;
}

/** The session after every face-mesh result, in order (the clock's own ticks are not recorded). */
export function replayRun(s) {
  const session = new Session(s.seed, s.startedAt, s.firstYaw, s.firstPitch, s.firstMesh, s.width, s.height);
  for (const o of s.observations) session.observe(o);
  return session;
}

/** What the ports compare: the verdict, its metrics, the targets and the trace. */
export function replayDocument(s, session) {
  const r = session.result();
  const trace = session.document();
  return {
    name: s.name,
    version: VERSION,
    completion: session.completion(),
    result: { status: r.status, outcome: r.outcome, reason: r.reason, metrics: r.metrics },
    targets: trace.targets,
    middles: trace.middles,
    rows: trace.rows,
  };
}
