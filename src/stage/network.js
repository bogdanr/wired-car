/* ============================================================
   Network — harness routing and message paths
   ------------------------------------------------------------
   The harness is a graph of physical routes (data.harness). Each
   module drops to its nearest route; each bus is the tree of
   routes from the gateway to its members. A message then follows
   the wire it would really use:
     · CAN / CAN FD are shared lines  → member to member along the bus
     · FlexRay / Ethernet are stars   → out to the gateway and back
     · different buses                → store-and-forward at the gateway
     · LIN                            → from its master, never the gateway
     · power                          → the orange HV cables
   ============================================================ */
import * as THREE from 'three';
import { fillet } from './lines.js';

export const BUS_ORDER = ['eth', 'flexray', 'canfd', 'can', 'lin'];
const PREF = ['canfd', 'flexray', 'can', 'eth', 'lin'];

export function buildNetwork(D, G) {
  const { W } = G;
  const MOD = Object.fromEntries(D.modules.map(m => [m.id, m]));
  const COMP = Object.fromEntries(D.components.map(c => [c.id, c]));
  const topo = D.topology, GW = topo.gateway;
  const pos = id => {
    const m = MOD[id];
    if (m) { const p = m.location.mm; return W(p.x, p.y, p.z); }
    const c = COMP[id]; if (c) { const a = c.anchor; return W(a.x, a.y, a.z); }
    return null;
  };

  /* ---------- graph ---------- */
  const nodes = {}; // name → Vector3
  Object.entries(D.harness.nodes).forEach(([k, p]) => { nodes[k] = W(p.x, p.y, p.z); });
  let edges = D.harness.edges.map(([a, b]) => [a, b]);
  const attach = {}; // module id → graph node name

  const lin = new Set(topo.lin.flatMap(s => s.slaves));
  D.modules.forEach(m => {
    if (m.id === GW) { attach[m.id] = 'gw'; return; }
    if (!m.bus || !m.bus.length) return;          // motors and the tester have no bus drop
    const p = pos(m.id);
    let best = null;
    edges.forEach((e, i) => {
      const a = nodes[e[0]], b = nodes[e[1]], ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
      const q = a.clone().addScaledVector(ab, t), d = q.distanceTo(p);
      if (!best || d < best.d) best = { d, i, t, q };
    });
    const e = edges[best.i], name = 'a:' + m.id;
    if (best.t < 0.02) attach[m.id] = e[0];
    else if (best.t > 0.98) attach[m.id] = e[1];
    else {
      nodes[name] = best.q;
      edges.splice(best.i, 1, [e[0], name], [name, e[1]]);
      attach[m.id] = name;
    }
  });

  const adj = {};
  edges.forEach(([a, b]) => {
    const w = nodes[a].distanceTo(nodes[b]);
    (adj[a] = adj[a] || []).push([b, w]); (adj[b] = adj[b] || []).push([a, w]);
  });
  function dijkstra(src, allowed) {
    const dist = { [src]: 0 }, prev = {}, done = new Set();
    for (;;) {
      let u = null, du = Infinity;
      for (const k in dist) if (!done.has(k) && dist[k] < du) { du = dist[k]; u = k; }
      if (u === null) break;
      done.add(u);
      for (const [v, w] of adj[u] || []) {
        if (allowed && !allowed.has(ekey(u, v))) continue;
        const nd = du + w;
        if (dist[v] === undefined || nd < dist[v]) { dist[v] = nd; prev[v] = u; }
      }
    }
    return prev;
  }
  const ekey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  function route(prev, src, dst) {
    const out = [dst];
    let c = dst;
    while (c !== src) { c = prev[c]; if (c === undefined) return null; out.push(c); }
    return out.reverse();
  }

  /* ---------- bus trees ---------- */
  const fromGW = dijkstra('gw');
  const busMembers = {};
  D.buses.forEach(b => { busMembers[b.id] = b.members.slice(); });
  const busEdges = {};    // bus → Set(edge keys)
  const busPaths = {};    // bus → [node-name paths], drawn as wires
  D.buses.forEach(b => {
    const set = new Set(), paths = [];
    if (b.id === 'lin') {
      topo.lin.forEach(seg => {
        const pv = dijkstra(attach[seg.master]);
        seg.slaves.forEach(s => {
          const r = route(pv, attach[seg.master], attach[s]);
          if (r) { paths.push(r); for (let i = 1; i < r.length; i++) set.add(ekey(r[i - 1], r[i])); }
        });
      });
    } else {
      b.members.forEach(mid => {
        if (lin.has(mid)) return;
        const r = route(fromGW, 'gw', attach[mid]);
        if (r) { paths.push(r); for (let i = 1; i < r.length; i++) set.add(ekey(r[i - 1], r[i])); }
      });
    }
    busEdges[b.id] = set; busPaths[b.id] = paths;
  });

  /* ---------- geometry: every bus is offset inside the bundle ---------- */
  const OFFSET = new THREE.Vector3(1, 1.25, 0.8).normalize();
  const offsetOf = bus => OFFSET.clone().multiplyScalar(0.017 * (BUS_ORDER.indexOf(bus) - 2));
  /* Harnesses are laid at right angles, taped to the body along its main axes.
     ortho(a, b): the axis-aligned corner points between a and b, longest run first,
     so a drop falls vertically and a trunk runs fore-aft before it turns. */
  function ortho(a, b) {
    const d = b.clone().sub(a), ax = ['x', 'y', 'z'].filter(k => Math.abs(d[k]) > 0.004)
      .sort((p, q) => Math.abs(d[q]) - Math.abs(d[p]));
    const out = [], c = a.clone();
    ax.forEach(k => { c[k] = b[k]; out.push(c.clone()); });
    if (!out.length) out.push(b.clone());
    return out;
  }
  const orthoPath = list => list.reduce((acc, p, i) => i ? acc.concat(ortho(acc[acc.length - 1], p)) : [p.clone()], []);
  const pts = (names, bus) => {
    const o = offsetOf(bus);
    return orthoPath(names.map(n => nodes[n].clone().add(o)));
  };
  // merge the tree into unique edges, then draw each edge once
  function busWire(bus) {
    const o = offsetOf(bus), segs = [];
    busEdges[bus].forEach(k => { const [a, b] = k.split('|'); segs.push(fillet(orthoPath([nodes[a].clone().add(o), nodes[b].clone().add(o)]), 0.04, 4)); });
    return segs;
  }
  // the drop from a module's housing to its attach point, per bus: vertical, then square to the trunk
  function drop(mid, bus) {
    const p = pos(mid), a = nodes[attach[mid]].clone().add(offsetOf(bus));
    const d = a.clone().sub(p);
    const path = [p, new THREE.Vector3(p.x, a.y, p.z)];
    if (Math.abs(d.x) > Math.abs(d.z)) path.push(new THREE.Vector3(a.x, a.y, p.z)); else path.push(new THREE.Vector3(p.x, a.y, a.z));
    path.push(a);
    return fillet(path.filter((q, i, arr) => i === 0 || q.distanceToSquared(arr[i - 1]) > 1e-8), 0.035, 4);
  }
  function drops() {
    const out = [];
    D.modules.forEach(m => {
      if (m.id === GW || !m.bus) return;
      m.bus.forEach(b => {
        if (b === 'lin' && topo.localLin.includes(m.id)) return;
        out.push({ id: m.id, bus: b, pts: drop(m.id, b) });
      });
    });
    return out;
  }
  // the bundle sheath: every harness edge that carries at least one bus
  function bundle() {
    const used = new Set();
    Object.values(busEdges).forEach(s => s.forEach(k => used.add(k)));
    const segs = [];
    used.forEach(k => { const [a, b] = k.split('|'); segs.push(fillet(orthoPath([nodes[a], nodes[b]]), 0.04, 4)); });
    return segs;
  }

  /* ---------- HV cables ---------- */
  const hvNodes = Object.fromEntries(Object.entries(D.harness.hvNodes).map(([k, p]) => [k, W(p.x, p.y, p.z)]));
  function hvPath(a, b) {
    let pa = pos(a), pb = pos(b);
    const via = [];
    // cables leave the pack at its front or rear terminal
    if (a === '0x407B') { const t = pb.x < hvNodes['pack-f'].x + 0.6 ? hvNodes['pack-f'] : hvNodes['pack-r']; pa = pos(a); via.push(new THREE.Vector3(pa.x, t.y, pa.z), t); }
    if (b === '0x407B') { const t = pa.x < hvNodes['pack-f'].x + 0.6 ? hvNodes['pack-f'] : hvNodes['pack-r']; via.push(t, new THREE.Vector3(pb.x, t.y, pb.z)); }
    const sag = (p, q) => new THREE.Vector3((p.x + q.x) / 2, Math.min(p.y, q.y) - 0.04, (p.z + q.z) / 2);
    const chain = [pa, ...via, pb];
    const out = [chain[0]];
    for (let i = 1; i < chain.length; i++) { out.push(sag(chain[i - 1], chain[i]), chain[i]); }
    return fillet(out, 0.06, 5);
  }
  const hvCables = topo.hv.map(([a, b]) => ({ a, b, pts: hvPath(a, b) }));

  /* ---------- flow paths (legs with a bus, possibly a gateway hop) ---------- */
  const bussesOf = id => (MOD[id] && MOD[id].bus) ? MOD[id].bus.filter(b => !(b === 'lin' && topo.localLin.includes(id))) : [];
  function leg(from, to, bus) {
    // along bus `bus` from module `from` to module `to` (either may be the gateway)
    const allowed = busEdges[bus];
    const aN = attach[from], bN = attach[to];
    const star = topo.star[bus] === GW;
    let names;
    if (star && from !== GW && to !== GW) {
      names = route(dijkstra(aN, allowed), aN, 'gw').concat(route(dijkstra('gw', allowed), 'gw', bN).slice(1));
    } else {
      names = route(dijkstra(aN, allowed), aN, bN);
    }
    if (!names) names = [aN, bN];
    const body = pts(names, bus);
    const head = from === GW ? [] : drop(from, bus);
    const tail = to === GW ? [] : drop(to, bus).slice().reverse();
    return { bus, pts: fillet([...head, ...body, ...tail].filter((p, i, a) => i === 0 || p.distanceToSquared(a[i - 1]) > 1e-8), 0.05, 4) };
  }

  const linMaster = {}; topo.lin.forEach(s => s.slaves.forEach(sl => { linMaster[sl] = s.master; }));
  const flowByPair = {}; D.flows.forEach(fl => { flowByPair[fl.from + '>' + fl.to] = fl; });

  function flowPath(from, to, kind) {
    const fl = flowByPair[from + '>' + to];
    kind = kind || (fl && fl.kind);
    if (kind === 'power') {
      const c = hvCables.find(c => c.a === from && c.b === to);
      if (c) return { kind, legs: [{ bus: 'hv', pts: c.pts }] };
      return { kind, legs: [{ bus: 'hv', pts: hvPath(from, to) }] };
    }
    if (linMaster[to] === from || linMaster[from] === to) {
      return { kind, legs: [leg(from, to, 'lin')] };
    }
    if (from === 'tester' || to === 'tester') {
      const other = from === 'tester' ? to : from;
      const cable = diagCable();
      const legs = [{ bus: 'diag', pts: from === 'tester' ? cable : cable.slice().reverse() }];
      if (other !== GW) {
        const inner = leg(GW, other, bussesOf(other)[0]);
        if (from === 'tester') legs.push({ ...inner, hop: true });
        else legs.unshift({ ...leg(other, GW, bussesOf(other)[0]) }), legs[1].hop = true;
      }
      return { kind: 'diag', legs };
    }
    const A = bussesOf(from), B = bussesOf(to);
    if (from === GW) return { kind, legs: [leg(GW, to, B[0])] };
    if (to === GW) return { kind, legs: [leg(from, GW, A[0])] };
    const common = PREF.find(b => A.includes(b) && B.includes(b));
    if (common) return { kind, legs: [leg(from, to, common)] };
    const ba = PREF.find(b => A.includes(b)), bb = PREF.find(b => B.includes(b));
    return { kind, legs: [leg(from, GW, ba), { ...leg(GW, to, bb), hop: true }] };
  }

  // tester laptop → cable → OBD socket → gateway
  function diagCable() {
    const t = pos('tester'), obd = pos('obd'), gw = nodes.gw;
    const sill = W(1900, 1000, 330);
    const pts = [t.clone().add(new THREE.Vector3(0.08, -0.05, -0.12)), new THREE.Vector3(t.x + 0.1, 0.02, (t.z + sill.z) / 2), sill, obd, new THREE.Vector3(obd.x, gw.y - 0.05, gw.z + 0.1), gw];
    return fillet(pts, 0.12, 8);
  }

  return { nodes, edges, attach, busEdges, busPaths, busWire, drops, bundle, hvCables, flowPath, diagCable, pos, MOD, COMP, offsetOf };
}
