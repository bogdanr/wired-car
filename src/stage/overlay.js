/* ============================================================
   Overlay — the annotation layer of the drawing
   ------------------------------------------------------------
   Everything textual lives here, in SVG/HTML projected from the
   3D stage every frame the view changes:
     · item balloons with leaders, laid out in rows above and
       below the car (engineering callout style, collision-free)
     · callouts with full labels (scenarios, selection)
     · tolerance rings: inferred positions are drawn as a zone,
       with a dashed leader, never as a precise point
     · dimension lines with arrowheads and centred values
   Elements are created once and only their attributes change.
   ============================================================ */
import * as THREE from 'three';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const TOL = { high: 0, medium: 60, low: 140 }; // tolerance radius (mm) drawn around inferred positions

export function createOverlay(stage, D, host, hooks = {}) {
  const svg = el('svg', { class: 'ov', 'aria-hidden': 'true' });
  host.appendChild(svg);
  const defs = el('defs', {}, svg);
  const mk = el('marker', { id: 'ov-arrow', viewBox: '0 0 10 10', refX: '10', refY: '5', markerWidth: '9', markerHeight: '9', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, defs);
  el('path', { d: 'M0,1.6 L10,5 L0,8.4 z', class: 'ov-arrowhead' }, mk);
  const gDims = el('g', { class: 'ov-dims' }, svg);
  const gTol = el('g', { class: 'ov-tol' }, svg);
  const gLead = el('g', { class: 'ov-leaders' }, svg);
  const gBal = el('g', { class: 'ov-balloons' }, svg);
  const gComp = el('g', { class: 'ov-comps' }, svg);
  const gPress = el('g', { class: 'ov-press' }, svg);
  const P = {};   // press callouts: id -> {g, lead, dot, t, sub}

  /* ---------- item numbers: front to rear, like a real drawing ---------- */
  const items = D.modules.filter(m => m.id !== 'tester').slice()
    .sort((a, b) => a.location.mm.x - b.location.mm.x || b.location.mm.y - a.location.mm.y);
  const itemNo = {}; items.forEach((m, i) => { itemNo[m.id] = i + 1; });
  const MOD = Object.fromEntries(D.modules.map(m => [m.id, m]));
  const GW = D.topology.gateway;

  const N = {};
  D.modules.forEach(m => {
    const busClass = m.id === GW ? 'gw' : (m.bus && m.bus[0]) || 'none';
    const n = {
      m, bus: busClass,
      tol: el('ellipse', { class: 'tol' }, gTol),
      lead: el('path', { class: 'lead' + (m.location.confidence === 'high' ? '' : ' inferred') }, gLead),
      g: el('g', { class: 'bal b-' + busClass, 'data-id': m.id }, gBal),
      w: 0
    };
    n.dot = el('circle', { class: 'dot', r: 2.6 }, n.g);
    n.ring = el('circle', { class: 'ring', r: 10.5 }, n.g);
    n.num = el('text', { class: 'num', 'text-anchor': 'middle', dy: '0.35em' }, n.g);
    n.num.textContent = itemNo[m.id] || 'T';
    n.lab = el('g', { class: 'lab' }, n.g);
    n.labBg = el('rect', { rx: 3 }, n.lab);
    n.labT = el('text', { dy: '0.35em' }, n.lab);
    n.labT.textContent = (m.addr ? m.addr + '  ' : '') + m.label;
    n.g.addEventListener('pointerenter', () => hooks.onHover && hooks.onHover(m.id, n));
    n.g.addEventListener('pointerleave', () => hooks.onHover && hooks.onHover(null));
    n.g.addEventListener('click', e => { e.stopPropagation(); hooks.onPick && hooks.onPick(m.id); });
    N[m.id] = n;
  });

  /* ---------- component tags (scenario parts: motors, doors, lamps…) ---------- */
  const C = {};
  D.components.forEach(c => {
    const g = el('g', { class: 'ctag' }, gComp);
    const line = el('path', {}, g), bg = el('rect', { rx: 2 }, g), t = el('text', { dy: '0.35em' }, g);
    t.textContent = c.label;
    C[c.id] = { c, g, line, bg, t, w: 0 };
  });

  /* ---------- dimensions (car mm) ---------- */
  const V = D.vehicle.dimensions, [FA, RA] = [V.frontOverhang, V.frontOverhang + V.wheelbase];
  const Wy = V.width / 2;
  const DIMS = [
    { id: 'L', a: [0, Wy, -150], b: [V.length, Wy, -150], ext: [[0, Wy, 330], [V.length, Wy, 440]], val: V.length, views: ['hero', 'side', 'plan', 'iso'] },
    { id: 'WB', a: [FA, Wy, -40], b: [RA, Wy, -40], ext: [[FA, Wy, V.tyreRadius], [RA, Wy, V.tyreRadius]], val: V.wheelbase, views: ['hero', 'side', 'iso'] },
    { id: 'H', a: [V.length + 170, Wy, 0], b: [V.length + 170, Wy, V.height], ext: [[V.length - 60, Wy, 0], [V.length - 1300, Wy, V.height]], val: V.height, views: ['hero', 'side', 'rear', 'iso'] },
    { id: 'W', a: [-170, -Wy, 0], b: [-170, Wy, 0], ext: [[160, -Wy, 0], [160, Wy, 0]], val: V.width, views: ['front', 'plan'] },
    { id: 'Wr', a: [V.length + 170, -Wy, 0], b: [V.length + 170, Wy, 0], ext: [[V.length - 160, -Wy, 0], [V.length - 160, Wy, 0]], val: V.width, views: ['rear'] },
    { id: 'T', a: [FA, -V.trackFront / 2, -80], b: [FA, V.trackFront / 2, -80], ext: [[FA, -V.trackFront / 2, 60], [FA, V.trackFront / 2, 60]], val: V.trackFront, views: ['front'] }
  ];
  const Wp = (p) => stage.G.W(p[0], p[1], p[2]);
  DIMS.forEach(d => {
    d.g = el('g', { class: 'dim' }, gDims);
    d.e1 = el('path', { class: 'ext' }, d.g); d.e2 = el('path', { class: 'ext' }, d.g);
    d.line = el('path', { class: 'dl', 'marker-start': 'url(#ov-arrow)', 'marker-end': 'url(#ov-arrow)' }, d.g);
    d.bg = el('rect', { class: 'dbg', rx: 2 }, d.g);
    d.t = el('text', { class: 'dt', 'text-anchor': 'middle', dy: '0.35em' }, d.g);
    d.t.textContent = String(d.val);
    d.A = Wp(d.a); d.B = Wp(d.b); d.E = d.ext.map(Wp);
  });

  /* ---------- state ---------- */
  const S = { mode: 'none', ids: null, dims: false, selected: null, hover: null, faded: () => false, compIds: [], press: [] };
  function pressNode(id, label) {
    if (P[id]) return P[id];
    const m = MOD[id], g = el('g', { class: 'pc' }, gPress);
    const lead = el('path', { class: 'pl' }, g), dot = el('circle', { class: 'pd', r: 2.4 }, g);
    const t = el('text', { class: 'pt' }, g), sub = el('text', { class: 'ps' }, g);
    t.textContent = label || m.label.replace(/\s*\(.*\)$/, ''); sub.textContent = m.addr || m.id;
    return (P[id] = { g, lead, dot, t, sub, w: 0 });
  }
  let dirty = true;
  const set = o => { Object.assign(S, o); dirty = true; stage.invalidate(); };

  const measure = (t, cache, key) => {
    if (!cache[key]) cache[key] = t.getComputedTextLength ? t.getComputedTextLength() : t.textContent.length * 6.5;
    return cache[key];
  };
  const widths = {};

  /* 1D collision relaxation along a row: keep order, keep min gap, stay within [lo, hi] */
  function relax(list, gap, lo, hi) {
    list.sort((a, b) => a.want - b.want);
    list.forEach(n => { n.x = n.want; });
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < list.length; i++) { const need = list[i - 1].x + (list[i - 1].half + list[i].half + gap); if (list[i].x < need) list[i].x = need; }
      if (list.length && list[list.length - 1].x > hi - list[list.length - 1].half) list[list.length - 1].x = hi - list[list.length - 1].half;
      for (let i = list.length - 2; i >= 0; i--) { const need = list[i + 1].x - (list[i + 1].half + list[i].half + gap); if (list[i].x > need) list[i].x = need; }
      if (list.length && list[0].x < lo + list[0].half) list[0].x = lo + list[0].half;
    }
  }

  function layout() {
    const W = stage.W, H = stage.H, mmpx = stage.mmPerPx();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const r = stage.carRect(), ins = S.insets || { l: 0, r: 0, t: 0, b: 0 };
    const mobile = W < 700;
    const showAll = S.mode === 'balloons' || S.mode === 'dots';
    const want = id => (S.ids ? S.ids.includes(id) : showAll) || id === S.selected;
    const rows = { top: [], bot: [] };
    const cy = (r.y0 + r.y1) / 2;
    Object.entries(N).forEach(([id, n]) => {
      const on = S.mode !== 'none' && want(id) && !(id === 'tester' && S.mode === 'dots');
      n.on = on;
      if (!on) { n.g.style.display = 'none'; n.lead.style.display = 'none'; n.tol.style.display = 'none'; return; }
      const p = stage.toScreen(stage.worldOf(id));
      n.p = p;
      n.g.style.display = ''; n.tol.style.display = '';
      const faded = S.faded(id);
      n.g.classList.toggle('faded', faded);
      n.g.classList.toggle('sel', id === S.selected);
      n.g.classList.toggle('hov', id === S.hover);
      // tolerance zone, in true scale
      const tr = TOL[n.m.location.confidence] / mmpx;
      if (tr > 2 && id !== 'tester') { n.tol.setAttribute('cx', p.x); n.tol.setAttribute('cy', p.y); n.tol.setAttribute('rx', tr); n.tol.setAttribute('ry', tr * 0.8); n.tol.classList.toggle('faded', faded); n.tol.classList.toggle('sel', id === S.selected); }
      else n.tol.style.display = 'none';
      const label = S.mode === 'callouts' || id === S.selected || (S.labelled && S.labelled.includes(id));
      n.label = label;
      n.g.classList.toggle('labelled', label);
      if (S.mode === 'dots' && !label || mobile && !label) {
        // number sits on the part itself
        n.bx = p.x; n.by = p.y; n.lead.style.display = 'none';
        n.g.classList.add('inline');
        n.dot.setAttribute('cx', 0); n.dot.setAttribute('cy', 0);
        n.g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
        return;
      }
      n.g.classList.remove('inline');
      let half = 12;
      if (label) { n.w = measure(n.labT, widths, id) + 30; half = n.w / 2; }
      (p.y < cy ? rows.top : rows.bot).push(Object.assign(n, { want: p.x, half }));
    });
    // balloon rows sit clear of the car, inside the usable window
    const lo = ins.l + 14, hi = W - ins.r - 14;
    const rowY = { top: Math.max(ins.t + 22, r.y0 - 30), bot: Math.min(H - ins.b - 22, r.y1 + 30) };
    ['top', 'bot'].forEach(k => {
      const list = rows[k];
      // two tiers when a row is too crowded
      const total = list.reduce((s, n) => s + n.half * 2 + 6, 0);
      const tiers = total > (hi - lo) * 0.92 ? 2 : 1;
      const split = tiers === 1 ? [list] : [list.filter((_, i) => i % 2 === 0), list.filter((_, i) => i % 2 === 1)];
      // keep every tier inside the usable window: extra tiers stack away from the car only if there is room
      const base = k === 'top' ? Math.max(rowY.top, ins.t + 22 + (tiers - 1) * 30) : Math.min(rowY.bot, H - ins.b - 22 - (tiers - 1) * 30);
      split.forEach((tl, ti) => {
        relax(tl, 6, lo, hi);
        const y = base + (k === 'top' ? -1 : 1) * ti * 30;
        tl.forEach(n => {
          n.bx = n.x; n.by = y;
          n.g.setAttribute('transform', `translate(${n.bx.toFixed(1)},${n.by.toFixed(1)})`);
          n.dot.setAttribute('cx', (n.p.x - n.bx).toFixed(1)); n.dot.setAttribute('cy', (n.p.y - n.by).toFixed(1));
          // leader: from the part to the balloon edge, with a short horizontal shoulder
          const edgeY = n.by + (k === 'top' ? 11 : -11), sx = n.bx;
          n.lead.style.display = '';
          n.lead.setAttribute('d', `M${n.p.x.toFixed(1)},${n.p.y.toFixed(1)} L${sx.toFixed(1)},${edgeY.toFixed(1)}`);
          n.lead.classList.toggle('faded', S.faded(n.m.id));
          n.lead.classList.toggle('sel', n.m.id === S.selected);
          if (n.label) {
            n.labBg.setAttribute('x', -n.half); n.labBg.setAttribute('y', -11); n.labBg.setAttribute('width', n.w); n.labBg.setAttribute('height', 22);
            n.labT.setAttribute('x', -n.half + 24);
            n.ring.setAttribute('cx', -n.half + 11); n.num.setAttribute('x', -n.half + 11);
          } else { n.ring.setAttribute('cx', 0); n.num.setAttribute('x', 0); }
        });
      });
    });

    /* component tags */
    Object.values(C).forEach(t => {
      const on = S.compIds.includes(t.c.id) && !mobile;
      t.g.style.display = on ? '' : 'none';
      if (!on) return;
      const a = t.c.anchor, p = stage.toScreen(stage.G.W(a.x, a.y, a.z));
      if (!t.w) t.w = measure(t.t, widths, 'c:' + t.c.id) + 14;
      const ox = p.x + 18, oy = p.y + 26;
      t.line.setAttribute('d', `M${p.x},${p.y} L${ox},${oy} L${ox + 8},${oy}`);
      t.bg.setAttribute('x', ox + 8); t.bg.setAttribute('y', oy - 9); t.bg.setAttribute('width', t.w); t.bg.setAttribute('height', 18);
      t.t.setAttribute('x', ox + 15); t.t.setAttribute('y', oy);
    });

    /* press callouts: vertical hairline leaders up to light, unboxed text above the car */
    Object.values(P).forEach(c => { c.g.style.display = 'none'; });
    if (S.press && S.press.length && !mobile) {
      const lo = Math.max(ins.l + 14, r.x0 - 30), hi = W - ins.r - 14;
      const all = S.press.map(e => {
        const id = typeof e === 'string' ? e : e.id;
        const c = pressNode(id, e.label), p = stage.toScreen(stage.worldOf(id));
        if (!c.w) c.w = Math.max(measure(c.t, widths, 'p:' + id), 56) + 4;
        return Object.assign(c, { id, p, want: p.x + c.w / 2 - 2, half: c.w / 2 });
      }).sort((a, b) => a.p.x - b.p.x);
      // one row if it fits, otherwise alternate between two rows 30 px apart
      const fits = all.reduce((s, c) => s + c.w + 18, 0) < (hi - lo);
      const tiers = fits ? [all] : [all.filter((_, i) => i % 2 === 0), all.filter((_, i) => i % 2 === 1)];
      const base = Math.max(ins.t + 30 + (tiers.length - 1) * 30, r.y0 - 36);
      tiers.forEach((list, ti) => {
      const yl = base - ti * 30;
      relax(list, 18, lo, hi);
      list.forEach(c => {
        c.g.style.display = '';
        // text is left-aligned on its leader; the leader drops, kinks once, then falls onto the part
        const tx = c.x - c.half + 2, px = c.p.x.toFixed(1), py = c.p.y.toFixed(1);
        const knee = yl + 22 + Math.min(40, Math.abs(tx - c.p.x) * 0.2);
        c.lead.setAttribute('d', `M${tx.toFixed(1)},${yl + 10} V${knee.toFixed(1)} L${px},${(knee + 14).toFixed(1)} V${py}`);
        c.dot.setAttribute('cx', px); c.dot.setAttribute('cy', py);
        c.t.setAttribute('x', tx); c.t.setAttribute('y', yl - 8);
        c.sub.setAttribute('x', tx); c.sub.setAttribute('y', yl + 4);
      });
      });
    }

    /* dimensions */
    const shot = stage.shot, placed = [];
    DIMS.forEach(d => {
      const on = S.dims && d.views.includes(shot) && stage.explode < 0.05;
      d.g.style.display = on ? '' : 'none';
      if (!on) return;
      const a = stage.toScreen(d.A), b = stage.toScreen(d.B), len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 70) { d.g.style.display = 'none'; return; }
      d.line.setAttribute('d', `M${a.x},${a.y} L${b.x},${b.y}`);
      const e1 = stage.toScreen(d.E[0]), e2 = stage.toScreen(d.E[1]);
      const ext = (e, p) => { const dx = p.x - e.x, dy = p.y - e.y, l = Math.hypot(dx, dy) || 1; return `M${(e.x + dx / l * 4).toFixed(1)},${(e.y + dy / l * 4).toFixed(1)} L${(p.x + dx / l * 7).toFixed(1)},${(p.y + dy / l * 7).toFixed(1)}`; };
      d.e1.setAttribute('d', ext(e1, a)); d.e2.setAttribute('d', ext(e2, b));
      let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // never let two dimension values collide (small screens): the first one wins
      if (placed.some(q => Math.abs(q.x - mx) < 52 && Math.abs(q.y - my) < 22)) { d.g.style.display = 'none'; return; }
      placed.push({ x: mx, y: my });
      d.t.setAttribute('transform', `translate(${mx},${my}) rotate(${ang})`);
      d.bg.setAttribute('transform', `translate(${mx},${my}) rotate(${ang})`);
      d.bg.setAttribute('x', -22); d.bg.setAttribute('y', -8); d.bg.setAttribute('width', 44); d.bg.setAttribute('height', 16);
    });
  }

  stage.onFrame(({ viewChanged }) => { if (viewChanged || dirty) { layout(); dirty = false; } });

  /* ---------- picking: nearest part within reach ---------- */
  function pick(x, y, reach = 16) {
    let best = null, bd = reach * reach;
    Object.entries(N).forEach(([id, n]) => {
      if (!n.on || !n.p || S.faded(id)) return;
      const d = (n.p.x - x) ** 2 + (n.p.y - y) ** 2;
      if (d < bd) { bd = d; best = id; }
    });
    return best;
  }

  return { svg, set, pick, itemNo, items, get state() { return S; }, node: id => N[id], refresh() { dirty = true; stage.invalidate(); } };
}
