import { Session, Phase, JavaRandom } from '../../../packages/poseguard/src/vendor/posechallenge.js';
import { encodeObservation } from '../../../packages/poseguard/src/evidence';
import type { PoseGuardEvidence, PoseGuardVerdict } from '../../../packages/contracts/src/poseguard';

/** Synthetic decision-rule fixture, not evidence from a real camera. */
export function followingEvidence(seed: string, slope = -0.005): { evidence: PoseGuardEvidence; status: PoseGuardVerdict["status"] } {
  const random = new JavaRandom(seed);
  const eyes = (offset: number) => {
    const mesh = new Float32Array(478 * 3);
    for (const [a, b, iris, left] of [[33, 133, 468, .4], [362, 263, 473, .54]]) {
      mesh[a * 3] = left; mesh[b * 3] = left + .06;
      mesh[a * 3 + 1] = mesh[b * 3 + 1] = mesh[iris * 3 + 1] = .4;
      mesh[iris * 3] = (mesh[a * 3] + mesh[b * 3]) / 2 + offset * (mesh[b * 3] - mesh[a * 3]);
    }
    return mesh;
  };
  const observe = (t: number, yaw: number, pitch: number) => ({ t, present: true, yaw, pitch, landmarks: eyes(slope * yaw + .004 * random.nextGaussian()), width: 720, height: 960 });
  const first = observe(0, 0, 0);
  const session = new Session(seed, 0, 0, 0, first.landmarks, 720, 960);
  const evidence: PoseGuardEvidence = { frames: [encodeObservation(first, 0)] };
  let fromX = 0, fromY = 0, toX = 0, toY = 0, moveAt = 0, lastIndex = -1, lastPhase = session.phase();
  for (let i = 1; i < 675 && !session.done(); i++) {
    const t = i / 15;
    const phase = session.phase(), index = session.index();
    if (phase !== lastPhase || index !== lastIndex) {
      [fromX, fromY] = session.point();
      if (phase === Phase.TARGET) {
        toX = 22 * session.targets[index].x; toY = 22 * session.targets[index].y;
      } else { toX = fromX; toY = fromY; }
      moveAt = t + .35; lastPhase = phase; lastIndex = index;
    }
    const u = .5 - .5 * Math.cos(Math.PI * Math.max(0, Math.min(1, (t - moveAt) / .6)));
    const o = observe(t, -(fromX + (toX - fromX) * u + .4 * random.nextGaussian()), fromY + (toY - fromY) * u + .4 * random.nextGaussian());
    session.tick(t); session.observe(o);
    evidence.frames.push(encodeObservation(o, 0));
  }
  return { evidence, status: session.result().status };
}
