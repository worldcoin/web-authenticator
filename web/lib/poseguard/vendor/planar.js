// Verbatim median/solve excerpt from worldcoin/face-pad; see ../PROVENANCE.md.
/** Median of a copy (NaN sorts last, as Java's Arrays.sort). */
export function median(v) {
  if (v.length === 0) return NaN;
  const c = Float64Array.from(v).sort();
  const n = c.length;
  return n % 2 === 1 ? c[n >> 1] : (c[(n >> 1) - 1] + c[n >> 1]) / 2;
}

/** Gaussian elimination with partial pivoting; null when singular. Does not modify the inputs. */
export function solve(a0, b0) {
  const n = b0.length;
  const a = a0.map((r) => Float64Array.from(r));
  const b = Float64Array.from(b0);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-14) return null;
    const t = a[c];
    a[c] = a[p];
    a[p] = t;
    const tb = b[c];
    b[c] = b[p];
    b[p] = tb;
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

