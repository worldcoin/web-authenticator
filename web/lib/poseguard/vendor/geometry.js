// 2D face geometry from the face mesh, as the Android app builds it (core/FaceGeometry.from with
// FaceMesh's landmark groups): eye centroids, interocular distance, the landmark-extent box with a
// forehead margin. Plus the head angles from the facial transformation matrix and the mouth's
// width and opening (Phone roll's "keep a still face").

const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  LEFT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
  BROWS = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  NOSE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327, 129, 358, 64, 294],
  OUTER_LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132,
    93, 234, 127, 162, 21, 54, 103, 67, 109,
  ];

function pick(L, idx, w, h) {
  return idx.map((i) => [L[3 * i] * w, L[3 * i + 1] * h]);
}

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

/** Geometry in working pixels from 478 × (x, y, z) normalised landmarks; null when not finite. */
export function faceGeometry(L, w, h) {
  const eyeA = pick(L, RIGHT_EYE, w, h), eyeB = pick(L, LEFT_EYE, w, h);
  // The jaw line: the outline below the eyes (the forehead margin of the box is added separately).
  let eyeLine = Infinity;
  for (const p of eyeA.concat(eyeB)) eyeLine = Math.min(eyeLine, p[1]);
  const jaw = pick(L, OVAL, w, h).filter((p) => p[1] >= eyeLine);
  const all = jaw.concat(eyeA, eyeB, pick(L, BROWS, w, h), pick(L, NOSE, w, h), pick(L, OUTER_LIPS, w, h));
  for (const p of all) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const a = centroid(eyeA), b = centroid(eyeB);
  const left = a[0] < b[0] ? a : b, right = a[0] < b[0] ? b : a;
  const iod = Math.max(8, Math.hypot(right[0] - left[0], right[1] - left[1]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return {
    center: [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2],
    iod,
    boxLeft: Math.max(0, minX - 0.05 * iod),
    boxTop: Math.max(0, minY - 0.55 * iod),
    boxRight: Math.min(w, maxX + 0.05 * iod),
    boxBottom: Math.min(h, maxY + 0.05 * iod),
  };
}

/**
 * Head angles (degrees) from the facial transformation matrix, as the Android app reads it: the
 * forward axis R·(0, 0, 1); the packed 4 × 4 is column-major when the translation sits in the last
 * four values.
 */
export function headAngles(a) {
  if (!a || a.length < 16) return { yaw: null, pitch: null };
  const columnMajor = Math.abs(a[3]) + Math.abs(a[7]) + Math.abs(a[11]) < 1e-6;
  const fx = columnMajor ? a[8] : a[2], fy = columnMajor ? a[9] : a[6], fz = a[10];
  return {
    yaw: Math.atan2(fx, fz) * 57.29577951308232,
    pitch: Math.atan2(-fy, Math.hypot(fx, fz)) * 57.29577951308232,
  };
}

/** Mouth width (61–291) and opening (13–14) in interocular distances. */
export function mouth(L, w, h, iod) {
  if (!(iod > 0)) return null;
  return [
    Math.hypot((L[3 * 61] - L[3 * 291]) * w, (L[3 * 61 + 1] - L[3 * 291 + 1]) * h) / iod,
    Math.hypot((L[3 * 13] - L[3 * 14]) * w, (L[3 * 13 + 1] - L[3 * 14 + 1]) * h) / iod,
  ];
}
