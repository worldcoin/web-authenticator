// Verbatim fdlibm hypot excerpt from worldcoin/face-pad; see ../PROVENANCE.md.
// MARK: fdlibm hypot (OpenJDK FdLibm.Hypot, the algorithm of Java's StrictMath.hypot)

const view = new DataView(new ArrayBuffer(8));

function hi(x) {
  view.setFloat64(0, x);
  return view.getInt32(0);
}

/** A double with high word h and low word 0. */
function withHi(h) {
  view.setInt32(0, h);
  view.setInt32(4, 0);
  return view.getFloat64(0);
}

const TWO_MINUS_600 = 2 ** -600, TWO_PLUS_600 = 2 ** 600;
/** Java's 0x1.00000_ffff_ffffp500 (high word 0x5f300000, low word all ones). */
const A_LARGE = (2 ** 52 + 2 ** 32 - 1) * 2 ** 448;

/** Java's Math.hypot (fdlibm, correctly rounded to within one ulp, the same bits as on the JVM and on Android). */
export function hypot(x, y) {
  let a = Math.abs(x), b = Math.abs(y);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    if (a === Infinity || b === Infinity) return Infinity;
    return a + b; // NaN
  }
  if (b > a) {
    const t = a;
    a = b;
    b = t;
  }
  let ha = hi(a), hb = hi(b);
  if (ha - hb > 0x3c00000) return a + b; // a / b > 2^60
  let k = 0;
  if (a > A_LARGE) {
    // a > ~2^500: scale a and b by 2^-600
    ha -= 0x25800000;
    hb -= 0x25800000;
    a = a * TWO_MINUS_600;
    b = b * TWO_MINUS_600;
    k += 600;
  }
  let t1, t2;
  if (b < 2 ** -500) {
    if (b < 2.2250738585072014e-308) {
      // subnormal b or 0
      if (b === 0.0) return a;
      t1 = 2 ** 1022;
      b *= t1;
      a *= t1;
      k -= 1022;
    } else {
      // scale a and b by 2^600
      ha += 0x25800000;
      hb += 0x25800000;
      a = a * TWO_PLUS_600;
      b = b * TWO_PLUS_600;
      k -= 600;
    }
  }
  // medium size a and b
  let w = a - b;
  if (w > b) {
    t1 = withHi(ha);
    t2 = a - t1;
    w = Math.sqrt(t1 * t1 - (b * -b - t2 * (a + t1)));
  } else {
    a = a + a;
    const y1 = withHi(hb);
    const y2 = b - y1;
    t1 = withHi(ha + 0x00100000);
    t2 = a - t1;
    w = Math.sqrt(t1 * y1 - (w * -w - (t1 * y2 + t2 * b)));
  }
  return k !== 0 ? 2 ** k * w : w;
}

