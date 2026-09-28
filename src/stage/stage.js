/* ============================================================
   Stage — the engineering drawing as a live WebGL scene
   ------------------------------------------------------------
   Orthographic throughout (it is a drawing, not a photograph).
   Two passes per frame:
     1. body   : hull tone + contours + character lines, with a
                 hidden-line twin for everything behind the shell
     2. systems: depth cleared, then ECUs, harness, HV, packets —
                 the network is always legible through the body
   Renders only when something changed; sleeps when off-screen.
   ============================================================ */
import * as THREE from 'three';
import { makeGeo } from './geo.js';
import { buildBody } from './body.js';
import { buildNetwork, BUS_ORDER } from './network.js';
import { buildSystems } from './systems.js';
import { buildPackets } from './packets.js';
import { lineMaterials, LineSet, polysToSegments as _p } from './lines.js';
// resolved by build.py: model-gltf.js when assets/model/etron.glb exists, else model-none.js
import { loadModel, HAS_MODEL } from 'etron-model';

export const SHOTS = {
  hero:      { az: 146, el: 19, fit: 1.04, label: 'Three-quarter · front' },
  iso:       { az: 146, el: 25, fit: 1.06, label: 'Three-quarter · front' },
  'iso-rear':{ az: 36, el: 24, fit: 1.06, label: 'Three-quarter · rear' },
  side:      { az: 90, el: 0, fit: 1.08, label: 'Side elevation · left' },
  plan:      { az: 90, el: 89.5, fit: 1.08, label: 'Plan' },
  front:     { az: 180, el: 0, fit: 1.12, label: 'Front elevation' },
  rear:      { az: 0, el: 0, fit: 1.12, label: 'Rear elevation' },
  exploded:  { az: 146, el: 27, fit: 1.16, explode: 1, label: 'Exploded · body lifted' },
  gateway:   { az: 150, el: 34, vh: 3.5, target: '0x4010', label: 'Detail A · gateway' },
  xray:      { az: 146, el: 25, fit: 1.06, label: 'Three-quarter · X-ray' }
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export function createStage(container, D, opts = {}) {
  /* ---------- renderer ---------- */
  const canvas = document.createElement('canvas');
  canvas.className = 'stage-gl';
  container.appendChild(canvas);
  let renderer = null, fallback = null;
  try {
    if (opts.forceSVG) throw new Error('forced');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('webgl2');
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;
    renderer.autoClear = false;
    renderer.info.autoReset = false;   // one frame = two passes; reset per frame, not per pass
  } catch (e) {
    // no WebGL2: the same line data, projected to SVG by the same camera
    if (renderer) renderer.dispose();
    renderer = null; canvas.remove();
    fallback = document.createElement('div'); fallback.className = 'stage-svg';
    container.appendChild(fallback);
  }

  const G = makeGeo(D.vehicle);
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10);
  const body = buildBody(G, [clipPlane]);
  const net = buildNetwork(D, G);
  const sys = buildSystems(D, G, net);

  const bodyScene = new THREE.Scene(), sysScene = new THREE.Scene();
  bodyScene.add(body.shadow, body.root, body.wheelsRoot);
  sysScene.add(sys.root);
  // optional licensed body model: replaces the procedural paint in the studio look only.
  // Until it has loaded (or if it fails) the procedural studio hull stands in.
  let model = null;
  const modelReady = loadModel({ renderer, vehicle: D.vehicle, clip: [clipPlane] }).then(m => {
    if (!m) return null;
    model = m;
    body.root.add(m.root);
    body.studio.meshes.forEach(o => { o.visible = false; });
    body.studio.meshes = m.meshes; body.studio.mats = m.mats;
    // the baked contact shadow replaces the soft oval
    body.shadow.geometry.dispose();
    body.shadow.geometry = new THREE.PlaneGeometry(m.shadow.w, m.shadow.h);
    body.shadow.rotation.x = Math.PI / 2;
    body.shadow.material.map = m.shadow.texture; body.shadow.material.color.set(0x000000);
    body.shadow.material.side = THREE.DoubleSide; body.shadow.material.needsUpdate = true;
    readTheme(); applyStyles(); invalidate();
    return m.stats;
  }).catch(e => { console.warn('body model failed to load; using the procedural hull', e); return null; });
  // studio materials: the procedural shader (uniforms) or the model's PBR set (userData setters)
  const setStudioAlpha = (m, a) => { if (m.userData.setAlpha) m.userData.setAlpha(a); else m.uniforms.uAlpha.value = a; };
  const setStudioLight = (m, l) => { if (m.userData.setLight) m.userData.setLight(l); else m.uniforms.uLight.value = l; };
  const packets = buildPackets(bus => colorOf(bus));
  sysScene.add(packets.points);

  /* ---------- theme ---------- */
  const COLORS = {};
  const WHITE = new THREE.Color(1, 1, 1);
  const cssColor = (name, fb) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return new THREE.Color(v || fb);
  };
  function readTheme() {
    ['ink', 'ink2', 'ink3', 'tone', 'sheath', 'hv', 'hv-hot', 'lamp', 'accent', 'paper'].forEach(r => { COLORS[r] = cssColor('--gl-' + r, '#fff'); });
    D.buses.forEach(b => { COLORS['bus-' + b.id] = cssColor('--bus-' + b.id, '#fff'); });
    COLORS['bus-none'] = COLORS.ink2; COLORS['bus-diag'] = COLORS.ink; COLORS['bus-hv'] = COLORS.hv;
    lineMaterials.forEach(m => { const c = COLORS[m.userData.role]; if (c) m.color.copy(c); });
    const tone = COLORS.tone;
    const lightTheme = document.documentElement.dataset.theme === 'vellum' ? 1 : 0;
    if (model) model.mats[0].userData.setLight(lightTheme);
    else body.studio.mats.forEach(m => setStudioLight(m, lightTheme));
    body.shadow.material.opacity = model ? (lightTheme ? 0.55 : 0.9) : 0.85;
    [body.hullMat, ...body.wheels.map(w => w.group.children[0].material)].forEach(m => m.uniforms.uColor.value.copy(tone));
    Object.values(sys.ecus).forEach(e => e.fill.material.color.copy(COLORS[e.fill.userData.role] || COLORS.ink));
    Object.values(sys.extras.fans).forEach(f => f.mat.uniforms.uColor.value.copy(COLORS[f.role === 'lamp' ? 'lamp' : 'bus-eth']));
    sys.extras.battery.cells.forEach(c => c.material.color.copy(COLORS.hv));
    // additive glow vanishes on paper: switch to normal blending in the light theme
    const light = document.documentElement.dataset.theme === 'vellum';
    const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    [packets.mat, ...Object.values(sys.extras.fans).map(f => f.mat), ...sys.extras.battery.cells.map(c => c.material)].forEach(m => { m.blending = blend; m.needsUpdate = true; });
    packets.mat.uniforms.uLight.value = light ? 1 : 0;
    if (lastStreams.length) setRoutes(lastStreams);
    invalidate();
  }
  const colorOf = bus => COLORS['bus-' + bus] || COLORS.ink;

  /* ---------- section plane shown while the drawing "prints" ---------- */
  const scan = new LineSet({ width: 1.2, role: 'accent', depthTest: false });
  const Hm = D.vehicle.dimensions.height / 1000 + 0.12, Wm = D.vehicle.dimensions.width / 2000 + 0.14;
  scan.set(_p([[new THREE.Vector3(0, -0.02, -Wm), new THREE.Vector3(0, Hm, -Wm), new THREE.Vector3(0, Hm, Wm), new THREE.Vector3(0, -0.02, Wm), new THREE.Vector3(0, -0.02, -Wm)]]));
  scan.group.visible = false;
  sysScene.add(scan.group);

  /* ---------- selection halo: a soft billboard glow that pulses on the selected ECU ---------- */
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.renderOrder = 9; halo.visible = false;
  sysScene.add(halo);
  let pulseT = 0;

  /* ---------- camera ---------- */
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -40, 40);
  const tmpCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -40, 40);
  const cur = { az: 146, el: 21, vh: 3, tx: 0, ty: 0.75, tz: 0, ox: 0, oy: 0, explode: 0 };
  const goal = { ...cur };
  let shotName = 'hero', W = 1, H = 1, dpr = 1;
  const insets = { l: 0, r: 0, t: 0, b: 0 };
  let focusId = null;
  const carCorners = [];
  { const L = D.vehicle.dimensions.length / 2000, h = D.vehicle.dimensions.height / 1000, w = D.vehicle.dimensions.widthMirrors / 2000;
    for (const x of [-L, L]) for (const y of [0, h]) for (const z of [-w, w]) carCorners.push(new THREE.Vector3(x, y, z)); }
  const dirOf = (az, el) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)); };

  function resolveShot(name) {
    const s = SHOTS[name] || SHOTS.iso, g = { az: s.az, el: s.el, explode: s.explode || 0 };
    // the usable window: the stage minus whatever UI sits on top of it
    const uw = Math.max(0.2, (W - insets.l - insets.r) / W), uh = Math.max(0.2, (H - insets.t - insets.b) / H);
    g.ox = (insets.l - insets.r) / (2 * W); g.oy = (insets.b - insets.t) / (2 * H);
    let target = new THREE.Vector3(0, D.vehicle.dimensions.height / 2000, 0);
    const tid = focusId || s.target;
    if (tid) target = worldOf(tid).clone();
    g.tx = target.x; g.ty = target.y; g.tz = target.z;
    if (focusId) g.vh = 2.9 / uh;
    else if (s.vh) g.vh = s.vh / uh;
    else {
      tmpCam.position.copy(target).add(dirOf(g.az, g.el).multiplyScalar(20));
      tmpCam.up.set(0, 1, 0); tmpCam.lookAt(target); tmpCam.updateMatrixWorld();
      const inv = tmpCam.matrixWorldInverse;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      carCorners.forEach(c => {
        const p = c.clone(); if (g.explode) p.y += p.y > 0.5 ? 1.1 : 0;
        p.applyMatrix4(inv); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      });
      // centre the car's own bbox, not the target point
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const right = new THREE.Vector3().setFromMatrixColumn(tmpCam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(tmpCam.matrixWorld, 1);
      g.tx += right.x * cx + up.x * cy; g.ty += right.y * cx + up.y * cy; g.tz += right.z * cx + up.z * cy;
      const aspect = W / H;
      g.vh = Math.max((y1 - y0) / uh, (x1 - x0) / (aspect * uw)) * s.fit;
    }
    return g;
  }
  function setShot(name, instant) {
    shotName = name; focusId = null;
    Object.assign(goal, resolveShot(name));
    if (instant || reduced) Object.assign(cur, goal);
    viewChanged = true; invalidate();
  }
  function applyCamera() {
    const aspect = W / H, vh = cur.vh, vw = vh * aspect;
    camera.left = -vw / 2; camera.right = vw / 2; camera.top = vh / 2; camera.bottom = -vh / 2;
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3(cur.tx, cur.ty, cur.tz), d = dirOf(cur.az, clamp(cur.el, -89.5, 89.5));
    camera.position.copy(target).addScaledVector(d, 20);
    camera.up.set(0, 1, 0); camera.lookAt(target); camera.updateMatrixWorld();
    // screen-space offset: move the camera sideways so the car sits beside the text
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const shift = right.multiplyScalar(-cur.ox * vw).add(up.multiplyScalar(-cur.oy * vh));
    camera.position.add(shift); camera.updateMatrixWorld();
  }

  /* ---------- state ---------- */
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const st = {
    sys: 0, sysGoal: 0,          // systems layer visibility
    ghost: 1, ghostGoal: 1,      // body line strength (1 = full drawing, 0.4 = ghosted)
    studio: 0, studioGoal: 0,    // shaded studio look (1 = paint, 0 = pure drawing)
    shell: 1, shellGoal: 1,      // body shell presence (0 = body removed, wheels + systems only)
    hidden: true, harness: true, packets: true,
    bus: null, domain: null, selected: null, hover: null,
    comps: new Set()
  };
  let viewChanged = true, needs = true, running = false, visible = true, lastT = 0, draw = null, lowPower = false;
  const listeners = [];
  const onFrame = fn => listeners.push(fn);

  /* ---------- styles: opacity by layer / filter / focus ---------- */
  const MOD = net.MOD;
  function modFaded(id) {
    const m = MOD[id]; if (!m) return false;
    if (st.domain && m.domain !== st.domain) return true;
    if (st.bus && !(m.bus || []).includes(st.bus) && id !== D.topology.gateway) return true;
    return false;
  }
  // wheel line sets stay when the shell is removed (they locate the axles); everything else is shell
  const wheelSets = new Set();
  body.wheelsRoot.traverse(o => { body.sets.forEach(set => { if (set.group === o) wheelSets.add(set); }); });
  function applyStyles() {
    const g = st.ghost, s = st.sys, sd = st.studio, sh = st.shell;
    // selection pulse, 0..1 at ~1.1 Hz (held at 1 with reduced motion)
    const pulse = reduced ? 1 : 0.5 + 0.5 * Math.sin(pulseT * Math.PI * 2 * 1.1);
    body.hullMat.uniforms.uOpacity.value = 0.05 * (0.6 + 0.4 * g) * (1 - sd) * sh;
    body.studio.mats.forEach(m => setStudioAlpha(m, sd));
    body.studio.meshes.forEach(o => { o.visible = sd > 0.01; });
    // the procedural hull and tyre tone meshes are invisible but write depth (for the hidden-line
    // pass); under the model they would occlude its paint wherever the two surfaces differ
    const hullOn = !model || sd < 0.01;
    // with the shell removed the hull must stop writing depth, or it would still hide far-side lines
    body.hull.visible = hullOn && sh > 0.01;
    body.wheels.forEach(w => { w.group.children[0].visible = hullOn; });
    // with paint on, the drawing recedes to a faint panel-gap ink; under the model's own
    // surfaces it disappears (its panel gaps are the model's, not the drawing's)
    const lineK = 1 - (model ? 1 : 0.82) * sd;
    body.sets.forEach(set => {
      const k = wheelSets.has(set) ? 1 : sh;
      set.vis.opacity = set.vis.userData.baseOpacity * (0.34 + 0.66 * g) * lineK * k;
      set.vis.visible = set.vis.opacity > 0.002;
      if (set.hid) set.hid.visible = st.hidden && sd < 0.5 && k > 0.01, set.hid.opacity = 0.26 * (0.5 + 0.5 * g) * (1 - sd) * k;
    });
    Object.values(body.parts).forEach(p => {
      if (!p.lamp) return;
      const c = COLORS.ink.clone().lerp(COLORS.lamp, p.glow);
      p.set.vis.color.copy(c); p.set.vis.linewidth = 1.15 + p.glow * 1.3;
      p.set.vis.opacity = Math.min(1, (0.34 + 0.66 * g) * lineK + p.glow * (1 - (model ? sd : 0)) + (model ? 0 : 0.6 * sd)) * sh;
      p.set.vis.visible = p.set.vis.opacity > 0.002;
    });
    if (model) {
      const P = body.parts, gl = k => (P[k] ? P[k].glow : 0);
      model.setLamps(Math.max(0.55, gl('lamp-l'), gl('lamp-r')), Math.max(0.35, gl('rear-bar')));
    }
    const sel = st.selected, hov = st.hover;
    Object.entries(sys.ecus).forEach(([id, e]) => {
      const faded = modFaded(id), focus = id === sel || id === hov;
      const a = s * (faded ? 0.14 : 1);
      const isSel = id === sel;
      e.lines.vis.opacity = a * (focus ? 1 : 0.9);
      e.lines.vis.linewidth = (e.bus === 'gw' ? 1.6 : 1.15) + (focus ? 1.2 : 0) + (isSel ? 1.4 * pulse : 0);
      // solid housings: nearly opaque, brighter when focused or when the gateway is routing
      e.fill.material.opacity = Math.min(1, a * (focus ? 0.98 : 0.72) + (id === D.topology.gateway ? gwGlow * 0.3 * s : 0));
      // the selected housing breathes toward white so it stands out from its bus-mates
      const base = COLORS[e.fill.userData.role] || COLORS.ink;
      e.fill.material.color.copy(base);
      e.lines.vis.color.copy(COLORS[e.lines.vis.userData.role] || base);
      if (isSel) {
        e.fill.material.color.lerp(COLORS.paper.getHSL({}).l > 0.5 ? COLORS.ink : WHITE, 0.15 + 0.35 * pulse);
        e.lines.vis.color.lerp(WHITE, 0.5 * pulse);
      }
    });
    const se = sel && sys.ecus[sel];
    halo.visible = !!se && s > 0.05;
    if (halo.visible) {
      se.group.getWorldPosition(halo.position);
      const r = Math.max(...se.size) * 2.6 + 0.12;
      halo.scale.setScalar(r * (0.85 + 0.35 * pulse));
      halo.material.color.copy(COLORS[se.fill.userData.role] || COLORS.accent);
      halo.material.opacity = s * (0.35 + 0.55 * pulse);
    }
    const wireA = st.harness ? s : 0;
    D.buses.forEach(b => {
      const f = st.bus && st.bus !== b.id ? 0.1 : 1;
      sys.wires[b.id].vis.opacity = wireA * f * 0.95;
      sys.dropSets[b.id].vis.opacity = wireA * f * 0.8;
    });
    sys.localLin.vis.opacity = wireA * (st.bus && st.bus !== 'lin' ? 0.1 : 0.9);
    routes.vis.opacity = s * (reduced || !st.packets ? 0.95 : 0.4);
    if (lastStreams.length) {
      // a flow is playing: quiet the rest of the harness so the route reads
      D.buses.forEach(b => { sys.wires[b.id].vis.opacity *= 0.45; sys.dropSets[b.id].vis.opacity *= 0.45; });
    }
    sys.sheath.vis.opacity = wireA * 0.9;
    sys.hv.vis.opacity = s * (st.bus ? 0.25 : 0.62);
    BUS_ORDER.forEach(b => { const p = sys.extras['port-' + b]; p.vis.opacity = s * (st.bus && st.bus !== b ? 0.2 : 1); });
    const other = s * (st.bus || st.domain ? 0.35 : 1);
    [sys.extras.diag].forEach(x => { x.vis.opacity = s * 0.7; });
    batteryAndMotorsAlpha(other);
    packets.points.visible = st.packets && !reduced && s > 0.05;
  }
  const ecuSets = new Set(Object.values(sys.ecus).map(e => e.lines));
  const wireSets = new Set([...Object.values(sys.wires), ...Object.values(sys.dropSets), sys.localLin, sys.sheath, sys.hv, sys.extras.diag, ...BUS_ORDER.map(b => sys.extras['port-' + b]), ...Object.values(sys.hvFlow).map(h => h.set)]);
  const fanEdges = new Set(Object.values(sys.extras.fans).filter(f => f.edge).map(f => f.edge));
  function batteryAndMotorsAlpha(a) {
    sys.sets.forEach(set => {
      if (ecuSets.has(set) || wireSets.has(set) || fanEdges.has(set)) return;
      set.vis.opacity = set.vis.userData.baseOpacity * a * (set.vis.userData.role === 'ink3' ? 0.5 : 1);
    });
    Object.values(sys.extras.motors).forEach(m => { m.rotorLines.vis.opacity = a * (0.35 + 0.65 * m.spin); });
    sys.extras.battery.cells.forEach(c => { c.visible = a > 0.02; });
  }

  /* ---------- component behaviours ---------- */
  const compOf = {}; D.components.forEach(c => c.ecus.forEach(e => { (compOf[e] = compOf[e] || []).push(c.id); }));
  const partKey = { 'headlamp-l': 'lamp-l', 'headlamp-r': 'lamp-r', 'rear-bar': 'rear-bar', 'door-fl': 'door-fl', 'door-fr': 'door-fr', 'door-rl': 'door-rl', 'door-rr': 'door-rr', tailgate: 'tailgate', 'charge-l': 'charge-l', 'charge-r': 'charge-r' };
  function setComponents(ids) {
    st.comps = new Set(ids || []);
    Object.entries(partKey).forEach(([c, k]) => {
      const p = body.parts[k]; if (!p) return;
      const on = st.comps.has(c) ? 1 : 0;
      if (p.lamp) p.glowTarget = on; else p.target = on;
    });
    sys.extras.motors['motor-f'].target = st.comps.has('motor-f') ? 1 : 0;
    sys.extras.motors['motor-r'].target = st.comps.has('motor-r') ? 1 : 0;
    sys.extras.battery.target = st.comps.has('battery') ? 1 : 0;
    Object.entries(sys.extras.fans).forEach(([k, f]) => { f.target = st.comps.has(k) ? 1 : 0; });
    invalidate();
  }
  let gwGlow = 0, sweepT = 0;

  /* ---------- the routes of the active flows, drawn bright (static form of the packets) ---------- */
  const routes = new LineSet({ width: 2.4, role: 'ink', depthTest: false, vertexColors: true, order: 5 });
  routes.vis.userData.role = 'none';
  sysScene.add(routes.group); routes.set(null);
  function setRoutes(streams) {
    const segs = [], cols = [];
    streams.forEach(s => s.legs.forEach(l => {
      if (l.bus === 'hv') return;
      const c = colorOf(l.bus);
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1], b = l.pts[i];
        segs.push(a.x, a.y, a.z, b.x, b.y, b.z); cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }));
    routes.set(segs.length ? new Float32Array(segs) : null, cols.length ? new Float32Array(cols) : null);
    lastStreams = streams;
  }
  let lastStreams = [];
  function animateParts(dt) {
    let moving = false;
    const k = reduced ? 1 : damp(3.2, dt);
    Object.values(body.parts).forEach(p => {
      if (p.lamp) {
        if (Math.abs(p.glowTarget - p.glow) > 0.002) { p.glow += (p.glowTarget - p.glow) * k; moving = true; }
        return;
      }
      if (!p.hinge) return;
      if (Math.abs(p.target - p.open) > 0.001) { p.open += (p.target - p.open) * (reduced ? 1 : damp(2.4, dt)); moving = true; }
      const h = p.hinge, a = p.open * h.max * Math.PI / 180 * h.dir;
      if (h.axis === 'y') p.pivot.rotation.set(0, a, 0);
      else if (h.axis === 'z') p.pivot.rotation.set(0, 0, a);
      else p.pivot.position.set(h.p.x, h.p.y - 0.07 * p.open, h.p.z + Math.sign(h.p.z) * 0.01 * p.open);
    });
    Object.values(sys.extras.motors).forEach(m => {
      if (Math.abs(m.target - m.spin) > 0.002) { m.spin += (m.target - m.spin) * damp(2, dt); moving = true; }
      if (m.spin > 0.01) { m.angle += dt * m.spin * 9; m.rotor.rotation.z = m.angle; moving = true; }
    });
    const spinAll = Math.max(sys.extras.motors['motor-f'].spin, sys.extras.motors['motor-r'].spin);
    if (spinAll > 0.01) body.wheels.forEach(w => { w.spin.rotation.z -= dt * spinAll * 4.5; });
    const b = sys.extras.battery;
    if (Math.abs(b.target - b.fill) > 0.002 || b.target > 0) {
      b.fill += (b.target - b.fill) * damp(1.2, dt);
      const t = performance.now() / 1000;
      b.cells.forEach(c => {
        const lit = b.target > 0 ? clamp(((t * 9) % 44) - c.userData.order, 0, 1) : 0;
        c.material.opacity = b.fill * (0.10 + 0.32 * lit) * st.sys;
      });
      moving = true;
    }
    sweepT += dt;
    Object.values(sys.extras.fans).forEach(f => {
      if (Math.abs(f.target - f.on) > 0.002) { f.on += (f.target - f.on) * damp(3, dt); moving = true; }
      const a = f.on * st.sys;
      f.mat.uniforms.uOpacity.value = a * (f.beam ? 0.32 : 0.22);
      f.mat.uniforms.uSweepOn.value = f.beam ? 0 : 1;
      f.mat.uniforms.uSweep.value = Math.sin(sweepT * 2.2);
      f.mesh.visible = a > 0.01;
      if (f.edge) f.edge.vis.opacity = a * 0.8;
      if (a > 0.01 && !f.beam) moving = true;
    });
    return moving;
  }

  /* ---------- streams: what the packets are doing ---------- */
  function setFlows(list) {
    // list: [{from,to,kind?}] or [{path:[a,b,c], kind:'diag'}]
    const streams = [];
    Object.values(sys.hvFlow).forEach(h => { h.set.group.visible = false; });
    (list || []).forEach((f, i) => {
      if (f.path) {
        for (let k = 1; k < f.path.length; k++) {
          const fp = net.flowPath(f.path[k - 1], f.path[k], 'diag');
          streams.push({ legs: fp.legs, kind: 'diag', delay: (k - 1) * 0.9 });
        }
        return;
      }
      const fp = net.flowPath(f.from, f.to, f.kind);
      if (fp.kind === 'power') {
        const h = sys.hvFlow[f.from + '>' + f.to]; if (h) h.set.group.visible = true;
      }
      streams.push({ legs: fp.legs, kind: fp.kind || 'value', delay: i * 0.12, id: f.from + '>' + f.to });
    });
    packets.setStreams(streams);
    setRoutes(streams);
    invalidate();
  }

  /* ---------- draw-on (the drawing prints itself, front to rear) ---------- */
  function drawOn(ms = 2600) {
    if (reduced) { clipPlane.constant = 10; invalidate(); return Promise.resolve(); }
    return new Promise(res => { draw = { t0: performance.now(), ms, res }; scan.group.visible = true; invalidate(); });
  }

  /* ---------- loop ---------- */
  function invalidate() { needs = true; if (!running && visible) { running = true; lastT = performance.now(); requestAnimationFrame(tick); } }
  let hvPhase = 0, frames = 0, slow = 0, fpsT0 = 0, lastView = new THREE.Vector3(), lastSvg = 0;
  function tick(now) {
    if (!visible) { running = false; return; }
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    let anim = false;
    // camera
    const k = reduced ? 1 : damp(3.4, dt);
    let dAz = ((goal.az - cur.az + 540) % 360) - 180;
    const moves = ['el', 'vh', 'tx', 'ty', 'tz', 'ox', 'oy', 'explode'];
    if (Math.abs(dAz) > 0.01) { cur.az += dAz * k; anim = true; } else cur.az = goal.az;
    moves.forEach(m => { const d = goal[m] - cur[m]; if (Math.abs(d) > 1e-4) { cur[m] += d * k; anim = true; } else cur[m] = goal[m]; });
    if (anim) viewChanged = true;
    // layer fades
    ['sys', 'ghost', 'studio', 'shell'].forEach(n => { const d = st[n + 'Goal'] - st[n]; if (Math.abs(d) > 0.002) { st[n] += d * (reduced ? 1 : damp(2.6, dt)); anim = true; } else st[n] = st[n + 'Goal']; });
    // draw-on
    if (draw) {
      const t = clamp((now - draw.t0) / draw.ms, 0, 1), e = 1 - Math.pow(1 - t, 2.2);
      const half = D.vehicle.dimensions.length / 2000 + 0.5;
      clipPlane.constant = -half + e * half * 2;
      scan.group.position.x = clipPlane.constant;
      scan.vis.opacity = Math.sin(t * Math.PI);
      anim = true;
      if (t >= 1) { clipPlane.constant = 10; scan.group.visible = false; draw.res(); draw = null; }
    }
    if (animateParts(dt)) anim = true;
    // keep ticking while something is selected so its halo pulses
    if (st.selected && sys.ecus[st.selected] && !reduced && visible) { pulseT += dt; anim = true; }
    // explode: lift the shell clear of the network
    body.root.position.y = cur.explode * 1.1;
    sys.extras.battery.group.position.y = -cur.explode * 0.08;
    // packets + HV energy
    if (st.packets && !reduced && st.sys > 0.05) {
      const r = packets.update(dt);
      if (r.active) anim = true;
      gwGlow = r.gw;
      hvPhase -= dt * 0.9;
      Object.values(sys.hvFlow).forEach(h => { if (h.set.group.visible) { h.set.vis.dashOffset = hvPhase; h.set.vis.opacity = st.sys; anim = true; } });
    }
    sys.localLin.vis.dashOffset = hvPhase * 0.3;

    applyCamera();
    if (viewChanged) {
      const vd = new THREE.Vector3(); camera.getWorldDirection(vd); vd.negate();
      if (vd.distanceToSquared(lastView) > 1e-7 || body.root.position.y !== 0) {
        lastView.copy(vd);
        body.contours.forEach(c => {
          const inv = new THREE.Matrix4().copy(c.object.matrixWorld).invert();
          const local = vd.clone().transformDirection(inv);
          c.set.set(c.contour.compute(local));
        });
        sys.motorSilhouettes(vd);
      }
    }
    applyStyles();
    if (renderer) {
      renderer.info.reset();
      renderer.clear();
      renderer.render(bodyScene, camera);
      renderer.clearDepth();
      renderer.render(sysScene, camera);
    } else if (viewChanged || now - lastSvg > 400) {
      lastSvg = now; fallback.innerHTML = exportSVG(true);
    }
    listeners.forEach(fn => fn({ viewChanged: viewChanged || anim }));
    viewChanged = false; needs = false;

    // fps watchdog: only judged while animating
    if (anim && !reduced && renderer) {
      frames++;
      if (!fpsT0) fpsT0 = now;
      if (now - fpsT0 > 2000) { const fps = frames * 1000 / (now - fpsT0); if (fps < 24) slow++; else slow = 0; frames = 0; fpsT0 = now; if (slow >= 2 && opts.onSlow) opts.onSlow(fps); }
    } else { frames = 0; fpsT0 = 0; }

    if (anim || needs) requestAnimationFrame(tick);
    else running = false;
  }

  /* ---------- size + visibility ---------- */
  function resize() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 2);
    if (renderer) { renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); }
    lineMaterials.forEach(m => m.resolution.set(W, H));
    packets.mat.uniforms.uScale.value = dpr * clamp(W / 1400, 0.7, 1.15);
    Object.assign(goal, resolveShot(shotName));
    const keepAnim = Math.abs(goal.vh - cur.vh) > 0.5;
    if (!keepAnim) Object.assign(cur, { vh: goal.vh, ox: goal.ox, oy: goal.oy });
    viewChanged = true; invalidate();
  }
  new ResizeObserver(resize).observe(container);
  new IntersectionObserver(es => { visible = es[0].isIntersecting && !document.hidden; if (visible) invalidate(); }, { threshold: 0 }).observe(container);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) invalidate(); });
  const mq = new MutationObserver(() => readTheme());
  mq.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  resize(); readTheme();
  setShot('hero', true);
  clipPlane.constant = opts.startHidden ? -10 : 10;

  /* ---------- projection for the overlay ---------- */
  const v = new THREE.Vector3();
  function toScreen(p) { v.copy(p).project(camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, z: v.z }; }
  function worldOf(id) {
    const e = sys.ecus[id];
    if (e) return e.group.getWorldPosition(new THREE.Vector3());
    const p = net.pos(id); return p;
  }
  // the car's bounding box on screen, for laying out callout rows around it
  function carRect() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    carCorners.forEach(c => { const p = toScreen(c); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    if (cur.explode > 0.01) y0 -= cur.explode * 1.1 / cur.vh * H;
    return { x0, x1, y0, y1 };
  }

  /* ---------- vector export: the current view as an SVG drawing ---------- */
  function exportSVG(bare) {
    const seg = [], hex = c => '#' + c.getHexString();
    const walk = (root, hiddenToo) => root.traverse(o => {
      if (!o.isLineSegments2 || !o.visible || !o.parent.visible) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      const m = o.material; if (m.opacity < 0.03) return;
      const isHid = m.userData.hidden; if (isHid && !hiddenToo) return;
      const a = o.geometry.attributes.instanceStart, b = o.geometry.attributes.instanceEnd; if (!a) return;
      const col = m.vertexColors ? null : hex(m.color);
      const colA = o.geometry.attributes.instanceColorStart;
      let d = '';
      const va = new THREE.Vector3(), vb = new THREE.Vector3();
      for (let i = 0; i < a.count; i++) {
        va.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); vb.fromBufferAttribute(b, i).applyMatrix4(o.matrixWorld);
        const p = toScreen(va), q = toScreen(vb);
        if (colA) { const c = new THREE.Color().fromBufferAttribute(colA, i); seg.push(`<path d="M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}" stroke="${hex(c)}" stroke-width="${m.linewidth}" opacity="${m.opacity.toFixed(2)}"/>`); }
        else d += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
      }
      if (d) seg.push(`<path d="${d}" stroke="${col}" stroke-width="${m.linewidth}" opacity="${m.opacity.toFixed(2)}"${isHid || m.dashed ? ' stroke-dasharray="4 3"' : ''}/>`);
    });
    walk(bodyScene, false); walk(sysScene, false);
    const bg = bare ? '' : `<rect width="100%" height="100%" fill="${hex(COLORS.paper)}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bg}<g fill="none" stroke-linecap="round">${seg.join('')}</g></svg>`;
  }

  return {
    G, net, sys, body, camera, SHOTS, canvas,
    get W() { return W; }, get H() { return H; }, get shot() { return shotName; },
    get state() { return st; }, get explode() { return cur.explode; },
    mmPerPx() { return cur.vh * 1000 / H; },
    setShot, drawOn, onFrame, invalidate, toScreen, worldOf, setFlows, setComponents, compOf, carRect, exportSVG,
    get reduced() { return reduced; }, get isGL() { return !!renderer; },
    lowPower() { if (lowPower) return; lowPower = true; st.hidden = false; resize(); },
    setInsets(o) { Object.assign(insets, o); Object.assign(goal, resolveShot(shotName)); viewChanged = true; invalidate(); },
    focusOn(id) { focusId = id; Object.assign(goal, resolveShot(shotName)); if (reduced) Object.assign(cur, goal); invalidate(); },
    unfocus() { if (!focusId) return; focusId = null; Object.assign(goal, resolveShot(shotName)); invalidate(); },
    setLayer(name, on) { st[name] = on; invalidate(); },
    setSystems(a) { st.sysGoal = a; invalidate(); },
    setGhost(g) { st.ghostGoal = g; invalidate(); },
    setShell(on) { st.shellGoal = on ? 1 : 0; invalidate(); },
    setStudio(a) { st.studioGoal = a; if (reduced) st.studio = a; invalidate(); },
    // resolves to { tris, draws } once the licensed body model is in, or null without one
    modelReady, hasModel: HAS_MODEL,
    renderInfo: () => renderer ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles } : null,
    setBus(b) { st.bus = b; invalidate(); },
    setDomain(d) { st.domain = d; invalidate(); },
    select(id) { st.selected = id; invalidate(); },
    hover(id) { if (st.hover !== id) { st.hover = id; invalidate(); } },
    revealClip(on) { clipPlane.constant = on ? 10 : -10; invalidate(); },
    orbit(dAz, dEl) { goal.az += dAz; goal.el = clamp(goal.el + dEl, -5, 89.5); if (reduced) Object.assign(cur, goal); shotName = 'custom'; invalidate(); },
    zoom(f) { goal.vh = clamp(goal.vh * f, 0.6, 14); invalidate(); },
    pan(dx, dy) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const s = cur.vh / H; goal.tx -= (right.x * dx - up.x * dy) * s; goal.ty -= (right.y * dx - up.y * dy) * s; goal.tz -= (right.z * dx - up.z * dy) * s;
      Object.assign(cur, { tx: goal.tx, ty: goal.ty, tz: goal.tz }); invalidate();
    },
    renderer
  };
}
