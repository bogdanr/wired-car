/* ============================================================
   Line art — the drawing grammar
   ------------------------------------------------------------
   Every line is drawn twice from the same buffer:
     visible pass : solid, depth-tested against the body
     hidden pass  : dashed and faint, drawn only where the body
                    is in front (depthFunc = GreaterDepth)
   which is the classic hidden-line convention of an engineering
   drawing. Contours (the outline of curved surfaces) depend on
   the view, so they are re-extracted whenever the camera turns.
   ============================================================ */
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export { polysToSegments } from './geo.js';

const ALL = new Set();          // every LineMaterial, for resolution + theme updates
export const lineMaterials = ALL;

export function lineMat(o = {}) {
  const m = new LineMaterial({
    color: o.color ?? 0xffffff,
    linewidth: o.width ?? 1,
    transparent: true,
    opacity: o.opacity ?? 1,
    dashed: !!o.dashed,
    dashSize: o.dashSize ?? 0.028,
    gapSize: o.gapSize ?? 0.022,
    depthTest: o.depthTest ?? true,
    depthWrite: false,
    worldUnits: false,
    vertexColors: !!o.vertexColors
  });
  if (o.depthFunc !== undefined) m.depthFunc = o.depthFunc;
  if (o.clip) { m.clippingPlanes = o.clip; }
  m.userData = { role: o.role || 'ink', baseWidth: o.width ?? 1, baseOpacity: o.opacity ?? 1 };
  ALL.add(m);
  return m;
}

/**
 * A set of line segments with an optional hidden-line twin.
 * `role` names the theme colour it takes (ink, ink2, accent, bus-can …).
 */
export class LineSet {
  constructor(o = {}) {
    this.group = new THREE.Group();
    this.vis = lineMat({ ...o, role: o.role });
    this.geo = new LineSegmentsGeometry();
    this.line = new LineSegments2(this.geo, this.vis);
    this.line.renderOrder = o.order ?? 2;
    this.line.frustumCulled = false;
    this.group.add(this.line);
    if (o.hidden) {
      this.hid = lineMat({ ...o, role: o.hiddenRole || o.role, opacity: o.hiddenOpacity ?? 0.26, dashed: true, width: Math.max(0.6, (o.width ?? 1) * 0.7), depthFunc: THREE.GreaterDepth });
      this.hid.userData.hidden = true;
      this.hline = new LineSegments2(this.geo, this.hid);
      this.hline.renderOrder = (o.order ?? 2) + 1;
      this.hline.frustumCulled = false;
      this.group.add(this.hline);
    }
    this.empty = true;
  }
  set(segments, colors) {
    if (!segments || segments.length === 0) { this.group.visible = false; this.empty = true; return this; }
    this.group.visible = true; this.empty = false;
    // LineSegmentsGeometry reallocates on every setPositions; dispose the old buffers
    this.geo.dispose();
    const g = new LineSegmentsGeometry();
    g.setPositions(segments);
    if (colors) g.setColors(colors);
    this.geo = g;
    this.line.geometry = g;
    if (this.hline) this.hline.geometry = g;
    if (this.vis.dashed || (this.hid && this.hid.dashed)) { this.line.computeLineDistances(); }
    return this;
  }
  setOpacity(a) {
    this.vis.opacity = this.vis.userData.baseOpacity * a;
    if (this.hid) this.hid.opacity = 0.26 * a;
  }
}

/**
 * Smooth contour extraction on a triangle mesh for an orthographic view.
 * f = n·v is interpolated over each triangle; the zero crossing is the
 * outline. Using vertex normals gives smooth, non-staircase contours.
 */
export class Contour {
  constructor(geometry) {
    this.pos = geometry.attributes.position.array;
    this.nrm = geometry.attributes.normal.array;
    this.idx = geometry.index ? geometry.index.array : null;
    this.nv = this.pos.length / 3;
    this.f = new Float32Array(this.nv);
    this.buf = new Float32Array(Math.max(6000, this.nv * 3));
  }
  /** v: view direction in the mesh's local frame (unit). Returns a Float32Array of segments. */
  compute(v) {
    const { pos, nrm, f } = this, idx = this.idx;
    for (let i = 0; i < this.nv; i++) f[i] = nrm[i * 3] * v.x + nrm[i * 3 + 1] * v.y + nrm[i * 3 + 2] * v.z;
    let out = this.buf, n = 0;
    const tri = idx ? idx.length / 3 : this.nv / 3;
    const pt = (a, b, o) => {
      const t = f[a] / (f[a] - f[b]);
      out[o] = pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t;
      out[o + 1] = pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t;
      out[o + 2] = pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t;
    };
    for (let t = 0; t < tri; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const sa = f[a] > 0, sb = f[b] > 0, sc = f[c] > 0;
      if (sa === sb && sb === sc) continue;
      if (n + 6 > out.length) { const g = new Float32Array(out.length * 2); g.set(out); out = this.buf = g; }
      if (sa !== sb && sa !== sc) { pt(a, b, n); pt(a, c, n + 3); }
      else if (sb !== sa && sb !== sc) { pt(b, a, n); pt(b, c, n + 3); }
      else { pt(c, a, n); pt(c, b, n + 3); }
      n += 6;
    }
    return out.slice(0, n);
  }
}

/** Hull fill: a faint tone that darkens toward grazing angles, like illustration shading. */
export function toneMaterial(o = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(o.color ?? 0xffffff) }, uOpacity: { value: o.opacity ?? 0.06 } },
    vertexShader: /* glsl */`
      #include <clipping_planes_pars_vertex>
      varying vec3 vN;
      void main(){
        #include <begin_vertex>
        vN = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; varying vec3 vN;
      void main(){
        #include <clipping_planes_fragment>
        float r = 1.0 - abs(normalize(vN).z);
        float top = clamp(normalize(vN).y * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(uColor, uOpacity * (0.30 + 0.9 * r * r + 0.25 * top));
      }`,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 3
  });
  m.clipping = true;
  if (o.clip) m.clippingPlanes = o.clip;
  m.userData = { role: o.role || 'tone', baseOpacity: o.opacity ?? 0.06 };
  return m;
}

/**
 * Studio look: shaded car paint, tinted glass, satin black cladding and tyres.
 * The environment is analytic (a photo-studio softbox: overhead strip lights,
 * two tall side boxes, a dark cyclorama and floor), so there are no cube maps,
 * no extra passes and no textures, just one fragment evaluation per pixel.
 * aMat: 0 paint · 1 glass · 2 cladding · 3 tyre · 4 alloy
 */
export function studioMaterial(o = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uPaint: { value: new THREE.Color(o.paint ?? 0x5e6166) },
      uAlpha: { value: 0 },
      uKind: { value: o.kind ?? -1 },
      uLight: { value: 0 }
    },
    vertexShader: /* glsl */`
      #include <clipping_planes_pars_vertex>
      attribute float aMat;
      uniform float uKind;
      varying vec3 vNw; varying vec3 vPw; varying float vMat;
      void main(){
        #include <begin_vertex>
        vMat = uKind >= 0.0 ? uKind : aMat;
        vNw = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vPw = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <clipping_planes_pars_fragment>
      uniform vec3 uPaint; uniform float uAlpha; uniform float uLight;
      varying vec3 vNw; varying vec3 vPw; varying float vMat;
      // softbox studio, direction → radiance
      vec3 env(vec3 r){
        float up = r.y;
        vec3 c = mix(vec3(0.015), vec3(0.06), smoothstep(-0.2, 0.4, up));          // cyclorama
        float box = smoothstep(0.80, 0.93, up) * smoothstep(0.5, 0.35, abs(r.x));
        c += vec3(1.0) * 2.2 * box;                                                 // overhead box (finite, so it has edges)
        float strip = smoothstep(0.02, 0.0, abs(r.z * 0.9 + r.x * 0.25)) * smoothstep(0.55, 0.75, up);
        c += vec3(0.9, 0.95, 1.0) * 0.9 * strip;                                    // long roof strip
        float side = smoothstep(0.55, 0.85, abs(r.z)) * smoothstep(-0.02, 0.10, up) * smoothstep(0.42, 0.22, up);
        c += vec3(1.0, 0.97, 0.92) * 1.8 * side;                                    // side boxes → the shoulder highlight
        float rim = smoothstep(0.9, 0.99, -r.x) * smoothstep(-0.1, 0.2, up);
        c += vec3(0.9, 0.55, 0.3) * 0.5 * rim;                                      // warm kicker from the front
        c += vec3(0.02) * smoothstep(0.0, -0.3, up);                                // floor bounce
        return mix(c, c * 0.55 + vec3(0.30), uLight);                               // paper theme: brighter cyc
      }
      void main(){
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNw);
        vec3 v = normalize(cameraPosition - vPw);
        if (dot(n, v) < 0.0) n = -n;
        vec3 r = reflect(-v, n);
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
        float key = clamp(dot(n, normalize(vec3(-0.3, 1.0, 0.45))), 0.0, 1.0);
        float ao = mix(0.35, 1.0, smoothstep(0.0, 0.55, vPw.y));                   // darker toward the sills
        vec3 col; float a = 1.0;
        if (vMat < 0.5) {            // metallic paint: tinted diffuse + flake + clear coat
          vec3 base = uPaint * (0.10 + 0.55 * key) * ao;
          vec3 flake = uPaint * env(normalize(mix(r, n, 0.55))) * 0.8;
          col = base + flake + env(r) * mix(0.07, 1.0, F) * mix(0.6, 1.0, ao);
        } else if (vMat < 1.5) {     // glass: almost black, strong reflection
          col = vec3(0.006, 0.008, 0.011) + env(r) * mix(0.03, 0.5, F) * vec3(0.8, 0.9, 1.0);
        } else if (vMat < 2.5) {     // satin black cladding
          col = vec3(0.022) * (0.4 + key) * ao + env(normalize(mix(r, n, 0.6))) * 0.06;
        } else if (vMat < 3.5) {     // tyre rubber
          col = vec3(0.018) * (0.5 + key) + env(normalize(mix(r, n, 0.8))) * 0.03;
        } else {                     // machined alloy rim, dark-tinted
          col = vec3(0.09) * (0.3 + key) + env(r) * mix(0.35, 0.9, F) * vec3(0.95, 0.97, 1.0);
        }
        // filmic-ish shoulder so the highlights roll off instead of clipping
        col = col / (1.0 + col * 0.6);
        col = pow(col, vec3(1.0 / 1.9));
        gl_FragColor = vec4(col, a * uAlpha);
      }`,
    transparent: true,
    depthWrite: true,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 3
  });
  m.clipping = true;
  if (o.clip) m.clippingPlanes = o.clip;
  m.userData = { role: 'studio' };
  return m;
}

/**
 * X-ray housings: small solid boxes in their bus colour, flat-shaded per face
 * (top light, side mid, front dark) so they read as parts, not wire cages.
 */
export function housingMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vN;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; uniform float opacity; varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float k = 0.42 + 0.5 * clamp(n.y, 0.0, 1.0) + 0.22 * abs(n.z) + 0.1 * abs(n.x);
        gl_FragColor = vec4(color * k, opacity);
      }`,
    transparent: true, depthWrite: false, depthTest: false
  });
  // keep the MeshBasicMaterial-like API the stage already uses (.color, .opacity)
  Object.defineProperty(m, 'color', { get() { return m.uniforms.color.value; } });
  Object.defineProperty(m, 'opacity', { get() { return m.uniforms.opacity.value; }, set(v) { if (m.uniforms) m.uniforms.opacity.value = v; } });
  return m;
}

/* ---------- small 3D polyline builders (world units) ---------- */
export function circle3(center, r, axis, n = 48) {
  // circle of radius r around `axis` ('x' | 'y' | 'z') through `center`
  const o = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
    if (axis === 'z') o.push(new THREE.Vector3(center.x + c, center.y + s, center.z));
    else if (axis === 'x') o.push(new THREE.Vector3(center.x, center.y + c, center.z + s));
    else o.push(new THREE.Vector3(center.x + c, center.y, center.z + s));
  }
  return o;
}
export function boxEdges(c, sx, sy, sz) {
  // axis-aligned box centred at c, sizes in world units; returns 12 edges as polylines
  const x0 = c.x - sx / 2, x1 = c.x + sx / 2, y0 = c.y - sy / 2, y1 = c.y + sy / 2, z0 = c.z - sz / 2, z1 = c.z + sz / 2;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  return [
    [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), v(x0, y0, z0)],
    [v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1), v(x0, y1, z0)],
    [v(x0, y0, z0), v(x0, y1, z0)], [v(x1, y0, z0), v(x1, y1, z0)],
    [v(x1, y0, z1), v(x1, y1, z1)], [v(x0, y0, z1), v(x0, y1, z1)]
  ];
}
/** Round the corners of a 3D polyline (quadratic fillets), for harness-like routing. */
export function fillet(pts, r = 0.08, n = 6) {
  if (pts.length < 3) return pts.slice();
  const o = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const da = a.distanceTo(p), db = b.distanceTo(p);
    const rr = Math.min(r, da * 0.45, db * 0.45);
    if (rr < 1e-4) { o.push(p); continue; }
    const s = p.clone().lerp(a, rr / da), e = p.clone().lerp(b, rr / db);
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      o.push(new THREE.Vector3(
        u * u * s.x + 2 * u * t * p.x + t * t * e.x,
        u * u * s.y + 2 * u * t * p.y + t * t * e.y,
        u * u * s.z + 2 * u * t * p.z + t * t * e.z));
    }
  }
  o.push(pts[pts.length - 1]);
  return o;
}
