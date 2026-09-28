/* ============================================================
   Packets — messages moving on the wires
   ------------------------------------------------------------
   One GL_POINTS draw call for every packet and its comet tail.
   Speed is log-scaled to the bus bitrate (LIN crawls, Ethernet
   flies); a message that changes bus waits at the gateway for a
   store-and-forward beat. Flow kinds differ by cadence, not
   colour: values stream, commands burst, diagnostics ping-pong.
   ============================================================ */
import * as THREE from 'three';

export const SPEED = { lin: 0.55, can: 1.35, canfd: 2.1, flexray: 2.7, eth: 3.8, diag: 1.3, hv: 1.6 };
const DWELL = 0.32, TAIL = 5, MAX = 260;
const CADENCE = { value: { period: 0.62, burst: 1, gap: 0 }, command: { period: 1.7, burst: 3, gap: 0.13 }, diag: { period: 2.8, burst: 1, gap: 0 } };

function prep(legs) {
  return legs.map(l => {
    const cum = [0];
    for (let i = 1; i < l.pts.length; i++) cum.push(cum[i - 1] + l.pts[i].distanceTo(l.pts[i - 1]));
    return { ...l, cum, len: cum[cum.length - 1], dur: cum[cum.length - 1] / (SPEED[l.bus] || 1.5) };
  });
}
function at(leg, d, out) {
  const c = leg.cum;
  if (d <= 0) return out.copy(leg.pts[0]);
  if (d >= leg.len) return out.copy(leg.pts[leg.pts.length - 1]);
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] > d) hi = m; else lo = m; }
  return out.copy(leg.pts[lo]).lerp(leg.pts[hi], (d - c[lo]) / (c[hi] - c[lo] || 1));
}

export function buildPackets(colorOf) {
  const n = MAX * TAIL;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uLight: { value: 0 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 color; varying vec3 vC; varying float vA;
      uniform float uScale;
      void main(){ vC=color; vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale; }`,
    fragmentShader: `varying vec3 vC; varying float vA; uniform float uLight;
      void main(){ vec2 p=gl_PointCoord-0.5; float r=length(p)*2.0; if(r>1.0) discard;
        float core=smoothstep(0.34,0.0,r); float halo=pow(1.0-r,2.2)*0.55;
        vec3 glow = mix(vC, vec3(1.0), core*0.65)*(core+halo);
        vec3 ink = mix(vC, vec3(1.0), core*0.35);
        gl_FragColor = uLight > 0.5 ? vec4(ink, clamp(core*1.2+halo*0.5,0.0,1.0)*vA) : vec4(glow, (core+halo)*vA); }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false; points.renderOrder = 10;

  let streams = [], packets = [], clock = 0;
  const tmp = new THREE.Vector3(), c3 = new THREE.Color();
  const gwFlash = { t: 0 };

  function setStreams(list) {
    streams = list.map((s, i) => ({ ...s, legs: prep(s.legs), next: clock + (s.delay || 0) + i * 0.09, sent: 0 }));
    packets = packets.filter(p => p.keep);
  }
  function total(legs) { let t = 0; legs.forEach((l, i) => { t += l.dur + (l.hop ? DWELL : 0); }); return t; }

  function update(dt) {
    clock += dt;
    // emit
    streams.forEach(s => {
      if (s.kind === 'power') return;
      const cad = CADENCE[s.kind] || CADENCE.value;
      while (clock >= s.next && packets.length < MAX) {
        packets.push({ s, t0: s.next, life: total(s.legs) });
        s.sent++;
        s.next += (s.sent % cad.burst === 0) ? cad.period : cad.gap;
      }
    });
    // advance + write
    let k = 0, hitGW = false;
    const live = [];
    for (const p of packets) {
      const age = clock - p.t0;
      if (age > p.life + 0.25) continue;
      live.push(p);
      for (let tIdx = 0; tIdx < TAIL; tIdx++) {
        let t = age - tIdx * 0.028;
        if (t < 0) { size[k] = 0; alpha[k] = 0; k++; continue; }
        let legI = 0, wait = false;
        for (; legI < p.s.legs.length; legI++) {
          const L = p.s.legs[legI];
          if (L.hop) { if (t < DWELL) { wait = true; break; } t -= DWELL; }
          if (t <= L.dur || legI === p.s.legs.length - 1) break;
          t -= L.dur;
        }
        const L = p.s.legs[Math.min(legI, p.s.legs.length - 1)];
        if (wait) { tmp.copy(L.pts[0]); if (tIdx === 0) hitGW = true; }
        else at(L, Math.min(t, L.dur) * (SPEED[L.bus] || 1.5), tmp);
        pos[k * 3] = tmp.x; pos[k * 3 + 1] = tmp.y; pos[k * 3 + 2] = tmp.z;
        c3.copy(colorOf(L.bus));
        col[k * 3] = c3.r; col[k * 3 + 1] = c3.g; col[k * 3 + 2] = c3.b;
        const fadeOut = Math.min(1, Math.max(0, (p.life + 0.25 - age) / 0.25));
        const fadeIn = Math.min(1, age / 0.08);
        size[k] = (tIdx === 0 ? 15 : 11 - tIdx * 1.6) * (wait ? 1.25 : 1);
        alpha[k] = (tIdx === 0 ? 1 : 0.55 - tIdx * 0.1) * fadeOut * fadeIn;
        k++;
      }
    }
    packets = live;
    for (let i = k; i < n; i++) { size[i] = 0; alpha[i] = 0; }
    g.setDrawRange(0, Math.max(k, 1));
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = true;
    if (hitGW) gwFlash.t = 1; else gwFlash.t = Math.max(0, gwFlash.t - dt * 2.5);
    return { active: packets.length > 0 || streams.some(s => s.kind !== 'power'), gw: gwFlash.t };
  }
  function clear() { streams = []; packets = []; update(0); }
  // positions of live packet heads, for the SVG fallback renderer
  function heads() {
    const o = [];
    for (let i = 0; i < n; i += TAIL) if (alpha[i] > 0.05) o.push({ p: new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), c: new THREE.Color(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]), a: alpha[i] });
    return o;
  }
  return { points, mat, setStreams, update, clear, heads, get count() { return packets.length; } };
}
