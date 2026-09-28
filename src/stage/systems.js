/* ============================================================
   Systems — what the body hides
   ------------------------------------------------------------
   ECU housings sit at location.mm and take the colour of the
   bus they live on (colour means bus, nothing else). The gateway
   is the one box with a port per bus. Power electronics, pack
   and motors are drawn as simplified but correctly placed solids.
   ============================================================ */
import * as THREE from 'three';
import { LineSet, circle3, boxEdges, polysToSegments, fillet, housingMaterial } from './lines.js';
import { arc } from './geo.js';
import { BUS_ORDER } from './network.js';

const SIZE = { // housing sizes in mm [x, y, z]
  '0x4010': [230, 180, 64], '0x4014': [70, 310, 130], '0x401B': [150, 240, 60], '0x4073': [170, 230, 70],
  '0x404F': [240, 190, 52], '0x407C': [300, 360, 110], '0x40B8': [300, 380, 110], '0x40C4': [180, 140, 70], '0x40C5': [180, 140, 70],
  '0x4044': [300, 250, 110], '0x40B7': [240, 200, 90], '0x407B': [220, 160, 50],
  '0x404A': [170, 40, 120], '0x404B': [170, 40, 120], '0x403E': [170, 40, 120], '0x403F': [170, 40, 120],
  '0x4057': [50, 130, 100], '0x409D': [70, 70, 90], '0x409E': [70, 70, 90], '0x404E': [70, 70, 90], '0x408A': [70, 70, 90],
  '0x4096': [120, 150, 70], '0x4097': [120, 150, 70], 'rear-lights': [60, 330, 50], '0x4013': [220, 180, 160],
  '0x4012': [200, 140, 120], '0x4042': [220, 260, 120], '0x4015': [140, 110, 50], '0x40F1': [140, 110, 50]
};
const DEF = [150, 110, 44];

/** Fan / beam shader: fades with range, with an optional sweeping highlight. */
function fanMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0 }, uSweep: { value: 0 }, uSweepOn: { value: 0 } },
    vertexShader: `attribute float aT; attribute float aA; varying float vT; varying float vA;
      void main(){ vT=aT; vA=aA; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uSweep; uniform float uSweepOn; varying float vT; varying float vA;
      void main(){ float a = pow(1.0 - vT, 1.4) * 0.55 + 0.08 * (1.0 - vT);
        float s = exp(-pow((vA - uSweep) * 7.0, 2.0)) * uSweepOn;
        gl_FragColor = vec4(uColor, uOpacity * (a + s * 0.7 * (1.0 - vT * 0.6))); }`,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
  });
}
function fanGeometry(apex, dirAngle, half, range, n = 24, tilt = 0) {
  // horizontal fan in the world XZ plane; dirAngle measured from +X toward +Z
  const pos = [apex.x, apex.y, apex.z], t = [0], aa = [0], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n * 2 - 1, a = dirAngle + u * half;
    pos.push(apex.x + Math.cos(a) * range, apex.y - Math.sin(tilt) * range, apex.z + Math.sin(a) * range);
    t.push(1); aa.push(u);
    if (i > 0) idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(aa, 1));
  g.setIndex(idx);
  return g;
}

export function buildSystems(D, G, N) {
  const { W, V } = G, root = new THREE.Group(), sets = [], ecus = {}, extras = {};
  const mk = (o) => { const s = new LineSet({ hidden: false, depthTest: false, ...o }); sets.push(s); root.add(s.group); return s; };
  const MOD = N.MOD;

  /* ---------- HV battery ---------- */
  const B = V.battery, bc = W((B.x0 + B.x1) / 2, 0, (B.z0 + B.z1) / 2);
  const bs = [(B.x1 - B.x0) / 1000, (B.z1 - B.z0) / 1000, B.halfWidth * 2 / 1000];
  const batt = new THREE.Group(); root.add(batt);
  const battLines = new LineSet({ depthTest: false, width: 1.1, role: 'ink2' }); sets.push(battLines); batt.add(battLines.group);
  const cellsX = 9, cellsY = 4, cells = [];
  const grid = [...boxEdges(bc, bs[0], bs[1], bs[2])];
  const topY = bc.y + bs[1] / 2 + 0.002;
  for (let i = 1; i < cellsX; i++) { const x = bc.x - bs[0] / 2 + bs[0] * i / cellsX; grid.push([new THREE.Vector3(x, topY, bc.z - bs[2] / 2), new THREE.Vector3(x, topY, bc.z + bs[2] / 2)]); }
  for (let j = 1; j < cellsY; j++) { const z = bc.z - bs[2] / 2 + bs[2] * j / cellsY; grid.push([new THREE.Vector3(bc.x - bs[0] / 2, topY, z), new THREE.Vector3(bc.x + bs[0] / 2, topY, z)]); }
  battLines.set(polysToSegments(grid));
  // section hatching on the left face — the pack is "cut" by the sill in a drawing
  const hatch = new LineSet({ depthTest: false, width: 0.6, role: 'ink3' }); sets.push(hatch); batt.add(hatch.group);
  const hs = [], zf = bc.z + bs[2] / 2 + 0.001, x0 = bc.x - bs[0] / 2, x1 = bc.x + bs[0] / 2, y0 = bc.y - bs[1] / 2, y1 = bc.y + bs[1] / 2;
  // 45° hatch lines x − y = c, clipped to the face rectangle
  for (let c = x0 - (y1 - y0); c < x1; c += 0.06) {
    const sx = Math.max(x0, c), ex = Math.min(x1, c + (y1 - y0));
    if (ex > sx) hs.push([new THREE.Vector3(sx, y0 + (sx - c), zf), new THREE.Vector3(ex, y0 + (ex - c), zf)]);
  }
  hatch.set(polysToSegments(hs));
  const cellMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < cellsX; i++) for (let j = 0; j < cellsY; j++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(bs[0] / cellsX * 0.86, bs[2] / cellsY * 0.8), cellMat.clone());
    m.rotation.x = -Math.PI / 2;
    m.position.set(bc.x - bs[0] / 2 + bs[0] * (i + 0.5) / cellsX, topY + 0.001, bc.z - bs[2] / 2 + bs[2] * (j + 0.5) / cellsY);
    m.userData.order = (cellsX - 1 - i) * cellsY + j;
    cells.push(m); batt.add(m);
  }
  extras.battery = { group: batt, cells, fill: 0, target: 0 };

  /* ---------- traction motors + half shafts ---------- */
  const motors = {};
  [['motor-f', V.motors.front], ['motor-r', V.motors.rear]].forEach(([key, m]) => {
    const c = W(m.x, 0, V.dimensions.tyreRadius), r = m.radius / 1000, len = m.length / 1000;
    const g = new THREE.Group(); g.position.copy(c); root.add(g);
    const ls = new LineSet({ depthTest: false, width: 1.25, role: 'ink' }); sets.push(ls); g.add(ls.group);
    const rings = [-len / 2, -len / 2 + 0.03, 0, len / 2 - 0.03, len / 2].map(z => circle3(new THREE.Vector3(0, 0, z), z === 0 ? r * 1.02 : r, 'z', 56));
    ls.set(polysToSegments(rings));
    const sil = new LineSet({ depthTest: false, width: 1.25, role: 'ink' }); sets.push(sil); g.add(sil.group);
    const rotor = new THREE.Group(); g.add(rotor);
    const rl = new LineSet({ depthTest: false, width: 1.0, role: 'hv' }); sets.push(rl); rotor.add(rl.group);
    const sp = [];
    [-len / 2 - 0.002, len / 2 + 0.002].forEach(z => {
      sp.push(circle3(new THREE.Vector3(0, 0, z), r * 0.55, 'z', 40));
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; sp.push([new THREE.Vector3(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12, z), new THREE.Vector3(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, z)]); }
    });
    rl.set(polysToSegments(sp));
    rl.setOpacity(0.35);
    // half shafts with CV joints
    const track = key === 'motor-f' ? V.dimensions.trackFront : V.dimensions.trackRear;
    const shafts = new LineSet({ depthTest: false, width: 1.1, role: 'ink2' }); sets.push(shafts); g.add(shafts.group);
    const sh = [];
    [1, -1].forEach(s => {
      const a = new THREE.Vector3(0, 0, s * len / 2), b = new THREE.Vector3(0, 0, s * (track / 2000 - 0.06));
      sh.push([a, b], circle3(a.clone().add(new THREE.Vector3(0, 0, s * 0.05)), 0.045, 'z', 20), circle3(b, 0.05, 'z', 20));
    });
    shafts.set(polysToSegments(sh));
    motors[key] = { group: g, rotor, rotorLines: rl, sil, r, len, spin: 0, target: 0, angle: 0 };
  });
  extras.motors = motors;
  function motorSilhouettes(viewDir) {
    Object.values(motors).forEach(m => {
      const axis = new THREE.Vector3(0, 0, 1), side = new THREE.Vector3().crossVectors(axis, viewDir);
      if (side.lengthSq() < 1e-6) { m.sil.set(null); return; }
      side.normalize().multiplyScalar(m.r);
      const a = new THREE.Vector3(0, 0, -m.len / 2), b = new THREE.Vector3(0, 0, m.len / 2);
      m.sil.set(polysToSegments([[a.clone().add(side), b.clone().add(side)], [a.clone().sub(side), b.clone().sub(side)]]));
    });
  }

  /* ---------- ECU housings ---------- */
  const fillGeo = new THREE.BoxGeometry(1, 1, 1);
  D.modules.forEach(m => {
    if (m.kind === 'machine' || m.id === 'tester') return;
    const p = N.pos(m.id), s = SIZE[m.id] || DEF;
    const sx = s[0] / 1000, sy = s[2] / 1000, sz = s[1] / 1000;
    const bus = m.id === D.topology.gateway ? 'gw' : (m.bus && m.bus[0]) || 'none';
    const g = new THREE.Group(); g.position.copy(p); root.add(g);
    const role = bus === 'gw' ? 'ink' : 'bus-' + bus;
    const ls = new LineSet({ depthTest: false, width: bus === 'gw' ? 1.6 : 1.15, role }); sets.push(ls); g.add(ls.group);
    const edges = boxEdges(new THREE.Vector3(), sx, sy, sz);
    // a connector on the face toward the harness
    const cy = -sy / 2, cz = 0;
    edges.push([new THREE.Vector3(-sx * 0.2, cy - 0.012, cz - sz * 0.25), new THREE.Vector3(sx * 0.2, cy - 0.012, cz - sz * 0.25), new THREE.Vector3(sx * 0.2, cy - 0.012, cz + sz * 0.25), new THREE.Vector3(-sx * 0.2, cy - 0.012, cz + sz * 0.25), new THREE.Vector3(-sx * 0.2, cy - 0.012, cz - sz * 0.25)]);
    ls.set(polysToSegments(edges));
    const fill = new THREE.Mesh(fillGeo, housingMaterial());
    fill.renderOrder = 2;
    fill.scale.set(sx, sy, sz); fill.userData.role = role; g.add(fill);
    ecus[m.id] = { group: g, lines: ls, fill, bus, size: [sx, sy, sz], hot: 0, target: 0 };
  });

  /* ---------- gateway ports: one per bus, in the bus colour ---------- */
  const gwp = N.nodes.gw, ports = new THREE.Group(); root.add(ports);
  BUS_ORDER.forEach(b => {
    const o = N.offsetOf(b), p = gwp.clone().add(o);
    const ls = new LineSet({ depthTest: false, width: 2.2, role: 'bus-' + b }); sets.push(ls); ports.add(ls.group);
    ls.set(polysToSegments(boxEdges(p, 0.034, 0.034, 0.034)));
    extras['port-' + b] = ls;
  });

  /* ---------- harness: sheath, bus wires, drops ---------- */
  const sheath = mk({ width: 7, role: 'sheath', opacity: 1, order: 1 });
  sheath.set(polysToSegments(N.bundle().map(s => s)));
  const wires = {}, dropSets = {};
  const drops = N.drops();
  D.topology.lin.forEach(seg => drops.push({ id: seg.master, bus: 'lin', pts: dropFrom(seg.master) }));
  function dropFrom(id) {
    const p = N.pos(id), a = N.nodes[N.attach[id]].clone().add(N.offsetOf('lin'));
    return fillet([p, new THREE.Vector3(p.x, a.y, p.z), a], 0.05, 5);
  }
  D.buses.forEach(b => {
    wires[b.id] = mk({ width: 1.7, role: 'bus-' + b.id, order: 3 });
    wires[b.id].set(polysToSegments(N.busWire(b.id)));
    dropSets[b.id] = mk({ width: 1.0, role: 'bus-' + b.id, order: 3 });
    dropSets[b.id].set(polysToSegments(drops.filter(d => d.bus === b.id).map(d => d.pts)));
  });
  // local LIN sub-buses: short stubs from the master toward what it drives
  const localLin = mk({ width: 1.0, role: 'bus-lin', dashed: true, dashSize: 0.012, gapSize: 0.01 });
  const ll = [];
  const toward = { '0x4096': 'headlamp-l', '0x4097': 'headlamp-r' };
  D.topology.localLin.forEach(id => {
    const p = N.pos(id), q = toward[id] ? N.pos(toward[id]) : p.clone().add(new THREE.Vector3(0.12, -0.08, 0));
    ll.push([p, q]);
  });
  localLin.set(polysToSegments(ll));
  localLin.line.computeLineDistances();

  /* ---------- HV cables ---------- */
  const hv = mk({ width: 3.0, role: 'hv', opacity: 0.55, order: 2 });
  hv.set(polysToSegments(N.hvCables.map(c => c.pts)));
  const hvFlow = {};
  N.hvCables.forEach(c => {
    const s = mk({ width: 3.4, role: 'hv-hot', dashed: true, dashSize: 0.05, gapSize: 0.06, order: 4 });
    s.set(polysToSegments([c.pts])); s.line.computeLineDistances(); s.group.visible = false;
    hvFlow[c.a + '>' + c.b] = { set: s, on: 0 };
  });

  /* ---------- tester laptop + DoIP cable + OBD socket ---------- */
  const tp = N.pos('tester');
  const lap = new THREE.Group(); lap.position.copy(tp); root.add(lap);
  const lapL = new LineSet({ depthTest: false, width: 1.2, role: 'ink' }); sets.push(lapL); lap.add(lapL.group);
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const base = [v3(-0.17, 0, -0.12), v3(0.17, 0, -0.12), v3(0.17, 0, 0.12), v3(-0.17, 0, 0.12), v3(-0.17, 0, -0.12)];
  const scr = [v3(-0.17, 0, -0.12), v3(-0.2, 0.22, -0.12), v3(-0.2, 0.22, 0.12), v3(-0.17, 0, 0.12)];
  const keys = [];
  for (let i = 1; i < 5; i++) keys.push([v3(-0.13 + i * 0.05, 0.001, -0.09), v3(-0.13 + i * 0.05, 0.001, 0.09)]);
  lapL.set(polysToSegments([base, scr, ...keys, [v3(-0.19, 0.2, -0.1), v3(-0.19, 0.2, 0.1)]]));
  const diag = mk({ width: 1.3, role: 'ink2', dashed: true, dashSize: 0.03, gapSize: 0.02 });
  diag.set(polysToSegments([N.diagCable()])); diag.line.computeLineDistances();
  const obd = mk({ width: 1.3, role: 'ink' });
  obd.set(polysToSegments(boxEdges(N.pos('obd'), 0.05, 0.03, 0.03)));
  extras.diag = diag;

  /* ---------- radar fans and lamp beams ---------- */
  const fans = {};
  const fanDefs = {
    'radar-front': { id: '0x4057', dir: Math.PI, half: 0.17, range: 2.6 },
    'radar-fl': { id: '0x409D', dir: Math.PI - 0.8, half: 0.75, range: 1.5 },
    'radar-fr': { id: '0x409E', dir: Math.PI + 0.8, half: 0.75, range: 1.5 },
    'radar-rl': { id: '0x404E', dir: 0.8, half: 0.75, range: 1.5 },
    'radar-rr': { id: '0x408A', dir: -0.8, half: 0.75, range: 1.5 }
  };
  Object.entries(fanDefs).forEach(([k, d]) => {
    const apex = N.pos(d.id), mat = fanMaterial();
    const mesh = new THREE.Mesh(fanGeometry(apex, d.dir, d.half, d.range), mat); mesh.renderOrder = 1; root.add(mesh);
    const edge = mk({ width: 0.9, role: 'bus-eth', dashed: true, dashSize: 0.04, gapSize: 0.03 });
    const rim = arc(0, 0, d.range, (d.dir - d.half) * 180 / Math.PI, (d.dir + d.half) * 180 / Math.PI, 30).map(([c, s]) => new THREE.Vector3(apex.x + c, apex.y, apex.z + s));
    edge.set(polysToSegments([[apex, rim[0]], rim, [rim[rim.length - 1], apex]])); edge.line.computeLineDistances();
    fans[k] = { mesh, mat, edge, on: 0, target: 0, role: 'bus-eth' };
  });
  [['headlamp-l', 1], ['headlamp-r', -1]].forEach(([k, s]) => {
    const apex = N.pos(k).clone(), mat = fanMaterial();
    const mesh = new THREE.Mesh(fanGeometry(apex, Math.PI + s * 0.05, 0.24, 2.4, 20, 0.05), mat); mesh.renderOrder = 1; root.add(mesh);
    fans[k] = { mesh, mat, on: 0, target: 0, role: 'lamp', beam: true };
  });
  extras.fans = fans;

  return { root, sets, ecus, extras, motorSilhouettes, wires, dropSets, sheath, hv, hvFlow, localLin, ports };
}
