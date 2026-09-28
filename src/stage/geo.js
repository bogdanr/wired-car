/* ============================================================
   Vehicle geometry — the e-tron, constructed like a drawing
   ------------------------------------------------------------
   Everything is authored in millimetres in the car's own frame
   (x behind the front bumper, y left of the centreline, z up),
   from data/vehicle.json. The body is a loft of cross-sections
   driven by profile tables; drawing lines (grille, lamps, doors,
   glass…) are authored in the orthographic view they belong to
   and projected onto that surface analytically — the way a
   draughtsman constructs a view, and without any raycasting.
   ============================================================ */
import * as THREE from 'three';

/* ---------- monotone cubic interpolation (Fritsch–Carlson) ---------- */
export function mono(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const k = (lo + hi) >> 1; if (xs[k] > x) hi = k; else lo = k; }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] +
           (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/* ---------- 2D authoring helpers (all in mm) ---------- */
export function arc(cx, cy, r, a0, a1, n = 24) {
  const o = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return o;
}
export function rrect(x0, y0, x1, y1, r, n = 5) {
  const o = [];
  const c = [[x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180], [x1 - r, y0 + r, 270]];
  c.forEach(([cx, cy, a]) => o.push(...arc(cx, cy, r, a, a + 90, n)));
  o.push(o[0]);
  return o;
}
export function close(p) { return p.concat([p[0]]); }
/** Resample a polyline so no span is longer than `step` — projected lines must follow the surface. */
export function densify(p, step = 25) {
  const o = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
    for (let k = 1; k <= n; k++) o.push([a[0] + dx * k / n, a[1] + dy * k / n]);
  }
  return o;
}

/* ============================================================ */
export function makeGeo(V) {
  const D = V.dimensions, L = D.length;
  const P = V.profile, f = {};
  ['zt', 'zbelt', 'zs', 'zb', 'hw', 'rw'].forEach(k => { f[k] = mono(P[k]); });
  const axles = [D.frontOverhang, D.frontOverhang + D.wheelbase];

  /** car mm → world metres. Front of the car at −X, left side at +Z, up is +Y. */
  const W = (x, y, z) => new THREE.Vector3((x - L / 2) / 1000, z / 1000, y / 1000);
  const Wa = (x, y, z, out, i) => { out[i] = (x - L / 2) / 1000; out[i + 1] = z / 1000; out[i + 2] = y / 1000; };

  function archZ(x) {
    let z = -1;
    for (const cx of axles) {
      const d = x - cx;
      if (Math.abs(d) < D.archRadius) z = Math.max(z, D.tyreRadius + Math.sqrt(D.archRadius ** 2 - d * d));
    }
    return z;
  }

  /* ---------- cross-section at station x: half profile, bottom centre → top centre ---------- */
  const SUB = 4;
  function controls(x) {
    const zb = f.zb(x), zt = f.zt(x), zbelt = Math.min(f.zbelt(x), zt - 8), zs = Math.min(f.zs(x), zbelt - 20);
    const hw = f.hw(x), rw = Math.min(f.rw(x), hw - 44);
    const zA = archZ(x), s = smooth(0, 60, zA - zb);
    const g = Math.max(zt - zbelt, 16);
    const c3z = Math.max(zb + 45, zA);
    return [
      [0, zb],
      [560, zb],
      [lerp(hw - 80, 590, s), Math.max(zb, zA)],
      [hw - lerp(30, 12, s), c3z],
      [hw - 9, Math.max(lerp(zb, zs, 0.5), c3z + 20)],
      [hw, Math.max(zs, c3z + 40)],
      [hw - 22, zbelt],
      [hw - 40, zbelt + g * 0.10],
      [lerp(hw - 40, rw, 0.62), zbelt + g * 0.55],
      [rw, zbelt + g * 0.86],
      [rw * 0.55, zt - g * 0.02],
      [0, zt]
    ];
  }
  function section(x) {
    const c = controls(x), n = c.length, o = [];
    const at = i => i < 0 ? [-c[-i][0], c[-i][1]] : i >= n ? [-c[2 * n - 2 - i][0], c[2 * n - 2 - i][1]] : c[i];
    for (let i = 0; i < n - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB, t2 = t * t, t3 = t2 * t;
        const q = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
        o.push([Math.max(0, q(0)), q(1)]);
      }
    }
    o.push(c[n - 1]);
    return o;
  }
  const K = 11 * SUB + 1;

  /* ---------- the hull mesh (loft of sections, capped) ---------- */
  function hull(stations = 170) {
    const M = 2 * K - 2, xs = [];
    for (let i = 0; i < stations; i++) xs.push(L * (1 - Math.cos(Math.PI * i / (stations - 1))) / 2);
    const pos = new Float32Array((stations * M + 2) * 3), idx = [];
    // material id per vertex: 0 paint · 1 glass (greenhouse) · 2 black cladding (sills, arch trims, lower bumpers)
    const mat = new Float32Array(stations * M + 2);
    const GLASS = [1580, 4430];
    xs.forEach((x, i) => {
      const s = section(x), belt = f.zbelt(x), zA = archZ(x);
      for (let j = 0; j < M; j++) {
        const p = j < K ? s[j] : s[2 * K - 2 - j];
        const y = j < K ? p[0] : -p[0];
        Wa(x, y, p[1], pos, (i * M + j) * 3);
        const z = p[1];
        let m = 0;
        // windscreen and rear glass span the full width; over the roof only the side glass is glass
        const roof = x > 2380 && x < 4160;
        if (x > GLASS[0] && x < GLASS[1] && z > belt + 18 && (!roof || z < f.zt(x) - 40)) m = 1;
        else if (z < 390 || (zA > 0 && z < zA + 70)) m = 2;
        else if (x < 170 && Math.abs(y) < 560 && z > 470 && z < 842) m = 2;   // Singleframe, gloss black
        mat[i * M + j] = m;
      }
    });
    for (let i = 0; i < stations - 1; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
        idx.push(a, c, b, b, c, d);
      }
    }
    // caps: fan to the centroid of the end sections
    [[0, 0], [stations - 1, 1]].forEach(([i, e]) => {
      const ci = stations * M + e;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < M; j++) { cx += pos[(i * M + j) * 3]; cy += pos[(i * M + j) * 3 + 1]; cz += pos[(i * M + j) * 3 + 2]; }
      pos[ci * 3] = cx / M; pos[ci * 3 + 1] = cy / M; pos[ci * 3 + 2] = cz / M;
      for (let j = 0; j < M; j++) {
        const a = i * M + j, b = i * M + (j + 1) % M;
        if (e === 0) idx.push(ci, a, b); else idx.push(ci, b, a);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ---------- analytic projection of 2D-authored lines onto the body ---------- */
  // side view: a horizontal ray at height z hits the outer side of section(x)
  function sideY(x, z) {
    const s = section(x);
    let best = -1;
    for (let j = 0; j < s.length - 1; j++) {
      const a = s[j], b = s[j + 1];
      if ((a[1] - z) * (b[1] - z) > 0 || a[1] === b[1]) continue;
      const y = a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]);
      if (y > best) best = y;
    }
    return best < 0 ? null : best;
  }
  // plan view: a vertical ray at lateral |y| hits the top of section(x)
  function topZ(x, y) {
    const s = section(x), ay = Math.abs(y);
    let best = null;
    for (let j = 0; j < s.length - 1; j++) {
      const a = s[j], b = s[j + 1];
      if ((a[0] - ay) * (b[0] - ay) > 0 || a[0] === b[0]) continue;
      const z = a[1] + (b[1] - a[1]) * (ay - a[0]) / (b[0] - a[0]);
      if (best === null || z > best) best = z;
    }
    return best;
  }
  function inside(x, y, z) {
    const s = section(x), ay = Math.abs(y);
    let c = false;
    for (let j = 0, k = s.length - 1; j < s.length; k = j++) {
      const a = s[j], b = s[k];
      if ((a[1] > z) !== (b[1] > z) && ay < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  // front/rear view: march along x until the point (y,z) is inside the section
  function endX(y, z, fromRear) {
    const step = 12, lim = 1600;
    let prev = fromRear ? L : 0;
    for (let d = 0; d <= lim; d += step) {
      const x = fromRear ? L - d : d;
      if (inside(x, y, z)) {
        let lo = prev, hi = x;
        for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (inside(m, y, z)) hi = m; else lo = m; }
        return hi;
      }
      prev = x;
    }
    return null;
  }

  const OFF = 4; // lines float 4 mm proud of the surface so they win the depth test
  /**
   * Project a 2D polyline authored in `view` onto the body.
   * Returns an array of 3D polylines (world Vector3[]), split where the surface is missed.
   *   side  : [x, z] seen from the left (+y); `mirror` adds the right side
   *   front : [y, z] seen from ahead;  rear : [y, z] seen from behind;  top : [x, y] seen from above
   */
  function project(view, pts, opts = {}) {
    const step = opts.step || 22, out = [];
    const sides = (view === 'side' && opts.mirror !== false) ? [1, -1] : [1];
    for (const sg of sides) {
      let cur = [];
      for (const [u, v] of densify(pts, step)) {
        let p = null;
        if (view === 'side') {
          const y = sideY(u, v);
          if (y !== null && y > (opts.minY || 300)) p = W(u, sg * (y + OFF), v);
        } else if (view === 'top') {
          const z = topZ(u, v);
          if (z !== null) p = W(u, v, z + OFF);
        } else {
          const x = endX(u, v, view === 'rear');
          if (x !== null) p = W(view === 'rear' ? x + OFF : x - OFF, u, v);
        }
        if (p) cur.push(p);
        else if (cur.length) { if (cur.length > 1) out.push(cur); cur = []; }
      }
      if (cur.length > 1) out.push(cur);
    }
    return out;
  }

  return { D, L, W, f, axles, archZ, section, hull, project, sideY, topZ, endX, V };
}

/* ---------- geometry → segment buffers ---------- */
export function polysToSegments(polys, closed = false) {
  let n = 0;
  polys.forEach(p => { n += (p.length - 1) + (closed ? 1 : 0); });
  const a = new Float32Array(n * 6);
  let i = 0;
  polys.forEach(p => {
    const m = p.length - 1 + (closed ? 1 : 0);
    for (let k = 0; k < m; k++) {
      const s = p[k], e = p[(k + 1) % p.length];
      a[i++] = s.x; a[i++] = s.y; a[i++] = s.z; a[i++] = e.x; a[i++] = e.y; a[i++] = e.z;
    }
  });
  return a;
}
