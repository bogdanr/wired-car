/* ============================================================
   The Wired Car — page app
   ------------------------------------------------------------
   One stage (WebGL drawing + SVG annotation), pinned while the
   story beats scroll over it. Each beat sets a stage "mode":
     hero      the drawing prints itself, dimensions on
     xray      body ghosts away, every ECU numbered, ambient traffic
     gateway   detail view of the router, only cross-bus traffic
     explore   free explorer: views, layers, bus filter, parts list
     scenarios scripted sequences of real flows
   ============================================================ */
import { createStage, SHOTS } from './stage/stage.js';
import { createOverlay } from './stage/overlay.js';
import { BUS_ORDER } from './stage/network.js';
import { renderChapters, esc, $, $$, CRIT, critTicks, busDots } from './chapters.js';

const D = window.__ETRON__;
const MOD = Object.fromEntries(D.modules.map(m => [m.id, m]));
const BUS = Object.fromEntries(D.buses.map(b => [b.id, b]));
const DOM = Object.fromEntries(D.domains.map(d => [d.id, d]));
const COMP = Object.fromEntries(D.components.map(c => [c.id, c]));
const GW = D.topology.gateway;
const html = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const q = new URLSearchParams(location.search);
const deep = !!(q.get('shot') || q.get('mode'));
const live = msg => { $('#live').textContent = msg; };

/* ---------- stage + overlay ---------- */
const stageEl = $('#stage');
const stage = createStage($('#gl-host'), D, {
  startHidden: !reducedMotion && !deep,
  forceSVG: q.get('svg') === '1',
  onSlow: () => { stage.lowPower(); stageEl.classList.add('low-power'); }
});
window.__stage = stage;
const tip = $('#tip');
const overlay = createOverlay(stage, D, $('#gl-host'), {
  onHover: (id) => hoverModule(id, 'balloon'),
  onPick: id => selectModule(id)
});
const ctx = { MOD, BUS, DOM, itemNo: overlay.itemNo, items: overlay.items };
const flowsOf = id => D.flows.filter(f => f.from === id || f.to === id);
const hopFlows = D.flows.filter(f => f.kind !== 'power' && stage.net.flowPath(f.from, f.to, f.kind).legs.some(l => l.hop));

/* ============================================================
   MODES
   ============================================================ */
let mode = null, ambientTimer = 0, scen = null;
const desktop = () => innerWidth >= 900;

function insetsFor(m) {
  const W = stageEl.clientWidth, H = stageEl.clientHeight, bar = 64;
  if (!desktop()) return m === 'explore' ? { l: 0, r: 0, t: 56, b: 60 } : m === 'scenarios' ? { l: 0, r: 0, t: 56, b: 150 } : { l: 0, r: 0, t: 12, b: 12 };
  const text = Math.min(560, W * 0.4);
  switch (m) {
    case 'hero': return { l: text, r: 40, t: bar + 20, b: 110 };
    case 'xray': return { l: text, r: 40, t: bar + 30, b: 150 };
    case 'gateway': return { l: text + 40, r: 40, t: bar + 60, b: 170 };
    // bottom inset keeps the lowest callout row above the title block (~130 px tall)
    case 'explore': return { l: 24, r: Math.min(400, W * 0.3) + 24, t: bar + 70, b: 150 };
    case 'scenarios': return { l: Math.min(430, W * 0.32) + 24, r: 32, t: bar + 70, b: 150 };
  }
  return { l: 0, r: 0, t: 0, b: 0 };
}

function setMode(m) {
  if (m === mode) return;
  const prev = mode; mode = m;
  stageEl.dataset.mode = m;
  clearInterval(ambientTimer); ambientTimer = 0;
  stopScenario();
  deselect(true);
  stage.setBus(null); stage.setDomain(null); setBusChip(null);
  stage.setComponents([]);
  stage.setInsets(insetsFor(m));
  overlay.set({ insets: insetsFor(m) });
  if (m !== 'explore') stage.setShell(true);   // the Body layer toggle belongs to the explorer only
  switch (m) {
    case 'hero':
      stage.setShot('hero'); stage.setSystems(0); stage.setGhost(1); stage.setStudio(1);
      stage.setFlows([]);
      overlay.set({ mode: 'none', ids: null, dims: true, labelled: null, compIds: [], faded: () => false });
      break;
    case 'xray':
      stage.setShot('xray'); stage.setSystems(1); stage.setGhost(0.32); stage.setStudio(0);
      overlay.set({ mode: 'dots', ids: null, dims: false, labelled: null, compIds: [], faded: () => false, press: [{ id: '0x4010', label: 'Gateway' }, { id: '0x404F', label: 'zFAS' }, { id: '0x400E', label: 'Body control' }, { id: '0x407B', label: 'Battery (BECM)' }, { id: '0x40B8', label: 'Rear motor' }] });
      ambient(D.flows.filter(f => f.kind !== 'power'), 3, 2600);
      break;
    case 'gateway':
      stage.setShot('gateway'); stage.setSystems(1); stage.setGhost(0.2); stage.setStudio(0);
      overlay.set({ mode: 'balloons', ids: [GW], labelled: [GW], dims: false, compIds: [], faded: () => false });
      ambient(hopFlows, 2, 2200);
      break;
    case 'explore':
      stage.setStudio(0); stage.setShot(view); stage.setSystems(layers.systems ? 1 : 0); stage.setGhost(view === 'xray' ? 0.3 : 0.55); stage.setShell(layers.body);
      overlay.set({ mode: layers.labels ? 'balloons' : 'dots', ids: null, labelled: null, dims: layers.dims, compIds: [], faded: explorerFaded });
      ambient(D.flows.filter(f => f.kind !== 'power'), 2, 3200);
      break;
    case 'scenarios':
      stage.setSystems(1); stage.setGhost(0.42); stage.setStudio(0);
      overlay.set({ mode: 'balloons', ids: [], labelled: [], dims: false, compIds: [], faded: () => false });
      startScenario(scen ? scen.s.id : D.scenarios[0].id, 0, !prev);
      break;
  }
  const lab = $('#tb-view'); if (lab) lab.textContent = viewLabel();
}

function ambient(pool, n, every) {
  if (!pool.length) return;
  let i = 0;
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const step = () => {
    if (selected) return;
    const pick = [];
    for (let k = 0; k < n; k++) pick.push(shuffled[(i + k) % shuffled.length]);
    i += n;
    stage.setFlows(pick.map(f => ({ from: f.from, to: f.to, kind: f.kind })));
    if (mode === 'gateway') overlay.set({ ids: [GW, ...new Set(pick.flatMap(f => [f.from, f.to]))], labelled: [GW] });
  };
  step();
  if (!reducedMotion) ambientTimer = setInterval(step, every);
}

/* beats: which one owns the stage */
const beats = $$('.beat');
const beatObs = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) { setMode(e.target.dataset.beat); markRail(e.target.id); } });
}, { rootMargin: desktop() ? '-45% 0px -45% 0px' : '-74% 0px -18% 0px' });
beats.forEach(b => beatObs.observe(b));

/* ============================================================
   EXPLORER HUD
   ============================================================ */
const VIEWS = [['iso', 'Three-quarter', '3/4'], ['iso-rear', 'Rear three-quarter', 'Rear 3/4'], ['side', 'Side elevation', 'Side'], ['plan', 'Plan', 'Plan'], ['front', 'Front elevation', 'Front'], ['rear', 'Rear elevation', 'Rear'], ['exploded', 'Exploded', 'Exploded'], ['xray', 'X-ray', 'X-ray']];
let view = 'iso';
const layers = { body: true, hidden: true, systems: true, harness: true, packets: true, dims: false, labels: false };
const LAYERS = [['body', 'Body'], ['hidden', 'Hidden lines'], ['harness', 'Harness'], ['packets', 'Traffic'], ['dims', 'Dimensions'], ['labels', 'Labels']];

$('#views').innerHTML = VIEWS.map(([id, long, short], i) => `<button type="button" role="radio" data-view="${id}" aria-checked="${id === view}" title="${esc(long)} · ${i + 1}"><span class="k">${i + 1}</span>${esc(short)}</button>`).join('');
$('#layers').innerHTML = LAYERS.map(([id, l]) => `<button type="button" data-layer="${id}" aria-pressed="${layers[id]}">${esc(l)}</button>`).join('');
$('#busfilter').innerHTML = `<button type="button" class="bchip on" data-bus="">All buses</button>` + BUS_ORDER.map(b => `<button type="button" class="bchip" data-bus="${b}" aria-pressed="false"><i></i>${esc(BUS[b].label)}<em>${BUS[b].members.length}</em></button>`).join('');

function setView(v) {
  view = v;
  $$('#views button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.view === v)));
  if (mode !== 'explore') return;
  stage.unfocus();
  stage.setShot(v);
  stage.setGhost(v === 'xray' ? 0.28 : 0.55);
  if (v === 'xray' || v === 'exploded') { stage.setSystems(1); }
  else stage.setSystems(layers.systems ? 1 : 0);
  $('#tb-view').textContent = viewLabel();
  live(VIEWS.find(x => x[0] === v)[1]);
}
$('#views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
$('#layers').addEventListener('click', e => {
  const b = e.target.closest('[data-layer]'); if (!b) return;
  const k = b.dataset.layer; layers[k] = !layers[k]; b.setAttribute('aria-pressed', String(layers[k]));
  if (k === 'body') { stage.setShell(layers.body); live(layers.body ? 'Body shown' : 'Body hidden'); }
  if (k === 'hidden') stage.setLayer('hidden', layers.hidden);
  if (k === 'harness') stage.setLayer('harness', layers.harness);
  if (k === 'packets') stage.setLayer('packets', layers.packets);
  if (k === 'dims') overlay.set({ dims: layers.dims });
  if (k === 'labels') overlay.set({ mode: layers.labels ? 'balloons' : 'dots' });
});

let busSel = null;
function setBusChip(b) {
  busSel = b || null;
  $$('#busfilter .bchip').forEach(c => { const on = (c.dataset.bus || null) === busSel; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
}
function filterBus(b) {
  setBusChip(b); stage.setBus(busSel);
  overlay.refresh();
  if (busSel) {
    const pool = D.flows.filter(f => f.kind !== 'power' && stage.net.flowPath(f.from, f.to, f.kind).legs.some(l => l.bus === busSel));
    clearInterval(ambientTimer); ambient(pool.length ? pool : D.flows, 2, 2600);
  }
  renderSheet();
}
$('#busfilter').addEventListener('click', e => { const b = e.target.closest('.bchip'); if (b) filterBus(b.dataset.bus); });
const explorerFaded = id => {
  const m = MOD[id]; if (!m) return false;
  if (busSel && id !== GW && !(m.bus || []).includes(busSel)) return true;
  return false;
};

$('#zoom-in').onclick = () => stage.zoom(0.8);
$('#zoom-out').onclick = () => stage.zoom(1.25);
$('#zoom-reset').onclick = () => { deselect(); setView(view); };
$('#export').onclick = () => {
  const blob = new Blob([stage.exportSVG(false)], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `etron-${stage.shot}.svg`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (stageEl.requestFullscreen) stageEl.requestFullscreen().catch(() => stageEl.classList.toggle('full'));
  else stageEl.classList.toggle('full');
};
document.addEventListener('fullscreenchange', () => $('#fullscreen').setAttribute('aria-pressed', String(!!document.fullscreenElement)));

/* ============================================================
   POINTER: orbit, pan, pick, hover
   ============================================================ */
const interactive = () => mode === 'explore' || mode === 'scenarios';
let drag = null;
const glHost = $('#gl-host');
glHost.addEventListener('pointerdown', e => {
  if (!interactive() || e.target.closest('.bal')) return;
  drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey, id: e.pointerId };
});
addEventListener('pointermove', e => {
  if (drag && e.pointerId === drag.id) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (drag.moved > 4) {
      if (!drag.cap) { try { glHost.setPointerCapture(e.pointerId); } catch (_) { /* noop */ } drag.cap = true; stageEl.classList.add('dragging'); }
      if (drag.pan) stage.pan(dx, dy); else stage.orbit(dx * 0.32, dy * 0.22);   // grab-and-turn: the car follows the pointer
      $('#tb-view').textContent = viewLabel();
      hideTip();
    }
    return;
  }
  if (!interactive() || e.target.closest('.hud,.sheet,.player,.titleblock')) return;
  const r = glHost.getBoundingClientRect();
  if (e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom) return;
  if (e.target.closest('.bal')) return;
  const id = overlay.pick(e.clientX - r.left, e.clientY - r.top, 14);
  hoverModule(id, 'part', e);
});
addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const was = drag; drag = null; stageEl.classList.remove('dragging');
  if (was.moved <= 4 && interactive()) {
    const r = glHost.getBoundingClientRect();
    const id = overlay.pick(e.clientX - r.left, e.clientY - r.top, 18);
    if (id) selectModule(id); else if (mode === 'explore') deselect();
  }
});
glHost.addEventListener('contextmenu', e => { if (interactive()) e.preventDefault(); });
glHost.addEventListener('wheel', e => {
  if (!interactive() || !(e.ctrlKey || e.metaKey || document.fullscreenElement)) return;
  e.preventDefault(); stage.zoom(Math.exp(e.deltaY * 0.0022));
}, { passive: false });

function hoverModule(id, _src, e) {
  stage.hover(id); overlay.set({ hover: id });
  if (!id) { hideTip(); return; }
  const m = MOD[id], n = overlay.node(id);
  tip.innerHTML = `<span class="tip-no">${overlay.itemNo[id] || 'T'}</span><div><b>${esc(m.label)}</b><span class="mono">${esc(m.addr || '')}${m.addr ? ' · ' : ''}${(m.bus || []).map(b => BUS[b].label).join(' + ') || 'no bus'}</span></div>`;
  tip.hidden = false;
  const p = n && n.p ? n.p : null;
  const r = stageEl.getBoundingClientRect(), g = glHost.getBoundingClientRect();
  const x = e ? e.clientX - r.left : p ? p.x + g.left - r.left : 0, y = e ? e.clientY - r.top : p ? p.y + g.top - r.top : 0;
  tip.style.transform = `translate(${Math.min(r.width - 280, x + 16)}px, ${y + 14}px)`;
  stageEl.classList.toggle('pointing', true);
}
function hideTip() { tip.hidden = true; stageEl.classList.remove('pointing'); }

/* ============================================================
   SELECTION + INSPECTOR (the parts list doubles as the roster)
   ============================================================ */
let selected = null;
function selectModule(id, opts = {}) {
  if (!MOD[id]) return;
  if (mode !== 'explore' && mode !== 'scenarios' && !opts.fromOutside) return;
  if (mode === 'scenarios' && !opts.fromOutside) { pauseScenario(); }
  selected = id;
  const m = MOD[id];
  stage.select(id);
  if (id !== 'tester') stage.focusOn(id);
  const fl = flowsOf(id);
  const partners = [...new Set(fl.flatMap(f => [f.from, f.to]))];
  overlay.set({ selected: id, ids: mode === 'explore' ? null : partners.concat(id), labelled: [id, ...partners], faded: x => x !== id && !partners.includes(x) && x !== GW });
  stage.setFlows(fl.map(f => ({ from: f.from, to: f.to, kind: f.kind })));
  stage.setComponents(stage.compOf[id] || []);
  overlay.set({ compIds: stage.compOf[id] || [] });
  renderSheet();
  $('#tb-view').textContent = viewLabel();
  live(`${m.label}${m.addr ? ', ' + m.addr : ''} selected. ${fl.length} flows.`);
}
function deselect(silent) {
  if (!selected) return;
  selected = null;
  stage.select(null); stage.unfocus(); stage.setComponents([]);
  overlay.set({ selected: null, labelled: null, compIds: [], ids: mode === 'explore' ? null : overlay.state.ids, faded: mode === 'explore' ? explorerFaded : () => false });
  if (!silent) { renderSheet(); if (mode === 'explore' && !ambientTimer) ambient(D.flows.filter(f => f.kind !== 'power'), 2, 3200); }
}

const sheet = $('#sheet-body');
let sheetQ = '';
function renderSheet() {
  if (selected) { renderInspector(selected); return; }
  const list = overlay.items.filter(m => !busSel || (m.bus || []).includes(busSel) || m.id === GW)
    .filter(m => !sheetQ || [m.label, m.addr, m.part, m.name].join(' ').toLowerCase().includes(sheetQ));
  const had = document.activeElement && document.activeElement.id === 'sheet-q';
  sheet.innerHTML = `<header class="sh-head">
      <div><p class="sh-k">Parts list</p><h3>${busSel ? esc(BUS[busSel].label) + ' · ' : ''}${list.length} items</h3></div>
      <label class="sh-q"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4 4"/></svg><input id="sheet-q" type="search" placeholder="Filter" value="${esc(sheetQ)}" aria-label="Filter the parts list"></label>
    </header>
    <ol class="parts">${list.map(m => `<li><button type="button" data-id="${esc(m.id)}" class="${m.id === GW ? 'is-gw' : ''}">
      <span class="p-no">${overlay.itemNo[m.id]}</span>
      <span class="p-main"><b>${esc(m.label)}</b><span class="mono">${esc(m.addr || '—')}</span></span>
      <span class="p-bus">${(m.id === GW ? BUS_ORDER : m.bus || []).map(b => `<i data-bus="${b}" title="${esc(BUS[b].label)}"></i>`).join('')}</span>
    </button></li>`).join('')}</ol>`;
  if (had) { const i = $('#sheet-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function renderInspector(id) {
  const m = MOD[id], fl = flowsOf(id), comps = (stage.compOf[id] || []).map(c => COMP[c]);
  const loc = m.location, conf = { high: 'measured / certain', medium: 'inferred, likely', low: 'inferred, rough' }[loc.confidence];
  const flowRow = f => {
    const out = f.from === id, other = out ? f.to : f.from, om = MOD[other];
    const hop = f.kind !== 'power' && stage.net.flowPath(f.from, f.to, f.kind).legs.some(l => l.hop);
    return `<li><button type="button" data-flow="${esc(f.from)}>${esc(f.to)}"><span class="f-dir ${out ? 'out' : 'in'}">${out ? '→' : '←'}</span><span class="f-main"><b>${esc(f.label)}</b><span>${esc(om ? om.label : other)}${hop ? ' · via gateway' : ''}</span></span><span class="f-kind k-${esc(f.kind)}">${esc(f.kind)}</span></button></li>`;
  };
  sheet.innerHTML = `<header class="in-head">
      <button type="button" class="back" id="in-back" aria-label="Back to the parts list"><svg viewBox="0 0 20 20"><path d="M12 5l-5 5 5 5"/></svg>Parts</button>
      <span class="in-no" aria-label="Item ${overlay.itemNo[id] || 'T'}">${overlay.itemNo[id] || 'T'}</span>
    </header>
    <div class="in-title"><p class="mono">${esc(m.addr || m.kind)}${m.name ? ' · ' + esc(m.name) : ''}</p><h3>${esc(m.label)}</h3></div>
    <p class="in-role">${esc(m.role || DOM[m.domain].blurb)}</p>
    <dl class="in-grid">
      <div><dt>Domain</dt><dd>${esc(DOM[m.domain].label)}</dd></div>
      <div><dt>Criticality</dt><dd>${critTicks(m.criticality)} ${esc(CRIT[m.criticality].label)}</dd></div>
      <div><dt>Access</dt><dd><span class="acc ${m.access === 'read-only' ? 'ro' : 'rw'}">${esc(m.access)}</span></dd></div>
      <div><dt>Part no.</dt><dd class="mono">${esc(m.part || '—')}</dd></div>
      <div class="wide"><dt>Bus</dt><dd>${id === GW ? BUS_ORDER.map(b => `<span class="bus-tag" data-bus="${b}"><i></i>${esc(BUS[b].label)}</span>`).join('') : busDots(m, BUS)}</dd></div>
    </dl>
    <div class="in-loc conf-${esc(loc.confidence)}"><p class="sh-k">Position · ${esc(conf)}</p><p>${esc(loc.basis || '')}</p><p class="mono dim">x ${loc.mm.x} · y ${loc.mm.y} · z ${loc.mm.z} mm</p></div>
    ${comps.length ? `<div class="in-sec"><p class="sh-k">Drives</p><div class="in-comps">${comps.map(c => `<button type="button" class="comp on" data-comp="${esc(c.id)}" aria-pressed="true">${esc(c.label)}</button>`).join('')}</div></div>` : ''}
    <div class="in-sec"><p class="sh-k">Message flows · ${fl.length}</p>${fl.length ? `<ul class="in-flows">${fl.map(flowRow).join('')}</ul>` : '<p class="dim">No mapped flows.</p>'}</div>`;
  $('#in-back').onclick = () => { deselect(); $('#sheet-body button[data-id]')?.focus(); };
}
sheet.addEventListener('click', e => {
  const b = e.target.closest('button[data-id]'); if (b) { selectModule(b.dataset.id); $('#in-back')?.focus(); return; }
  const f = e.target.closest('button[data-flow]');
  if (f) {
    const [a, z] = f.dataset.flow.split('>'); const fl = D.flows.find(x => x.from === a && x.to === z);
    stage.setFlows([{ from: a, to: z, kind: fl.kind }]);
    $$('.in-flows button').forEach(x => x.classList.toggle('on', x === f));
    return;
  }
  const c = e.target.closest('button[data-comp]');
  if (c) {
    const on = c.getAttribute('aria-pressed') !== 'true'; c.setAttribute('aria-pressed', String(on)); c.classList.toggle('on', on);
    const ids = $$('.in-comps button[aria-pressed="true"]').map(x => x.dataset.comp);
    stage.setComponents(ids); overlay.set({ compIds: ids });
  }
});
sheet.addEventListener('input', e => { if (e.target.id === 'sheet-q') { sheetQ = e.target.value.trim().toLowerCase(); renderSheet(); } });
$('#sheet-grip').addEventListener('click', () => $('#sheet').classList.toggle('open'));

/* ============================================================
   SCENARIOS
   ============================================================ */
const STEP_MS = 5600;
$('#scen-tabs').innerHTML = D.scenarios.map((s, i) => `<button type="button" role="tab" data-scen="${s.id}" aria-selected="false"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</button>`).join('');
let scenTimer = 0, playing = !reducedMotion;
function startScenario(id, step = 0, instant) {
  const s = D.scenarios.find(x => x.id === id);
  scen = { s, i: step };
  $$('#scen-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.scen === id)));
  $('#scen-bar').innerHTML = s.steps.map((_, i) => `<button type="button" data-step="${i}" aria-label="Step ${i + 1}"><i></i></button>`).join('');
  showStep(instant);
}
function showStep(instant) {
  if (!scen || mode !== 'scenarios') return;
  deselect(true);
  const { s, i } = scen, st = s.steps[i];
  const list = st.path ? [{ path: st.path, kind: st.kind }] : (st.flows || []).map(([a, b]) => ({ from: a, to: b, kind: (D.flows.find(f => f.from === a && f.to === b) || {}).kind }));
  const ids = [...new Set(st.path ? st.path : st.flows.flat())];
  const shot = st.shot || s.shot;
  if (stage.shot !== shot) stage.setShot(shot, instant);
  stage.setFlows(list);
  stage.setComponents(st.components || []);
  overlay.set({ mode: 'balloons', ids, labelled: ids, compIds: st.components || [], faded: () => false, selected: null });
  $('#scen-count').innerHTML = `<b>${esc(s.title)}</b><span>Step ${i + 1} / ${s.steps.length}</span>`;
  $('#scen-caption').innerHTML = st.caption;
  $('#scen-caption').classList.remove('in'); void $('#scen-caption').offsetWidth; $('#scen-caption').classList.add('in');
  $$('#scen-bar button').forEach((b, k) => { b.classList.toggle('done', k < i); b.classList.toggle('now', k === i); b.style.setProperty('--dur', STEP_MS + 'ms'); });
  $('#tb-view').textContent = viewLabel();
  schedule();
}
function schedule() {
  clearTimeout(scenTimer);
  $('#player').classList.toggle('paused', !playing);
  $('#scen-play').setAttribute('aria-pressed', String(playing));
  $('#scen-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (playing && scen) scenTimer = setTimeout(() => nextStep(true), STEP_MS);
}
function nextStep(auto) {
  if (!scen) return;
  if (scen.i < scen.s.steps.length - 1) scen.i++;
  else if (auto) { const k = D.scenarios.indexOf(scen.s); startScenario(D.scenarios[(k + 1) % D.scenarios.length].id); return; }
  showStep();
}
function prevStep() { if (scen && scen.i > 0) { scen.i--; showStep(); } }
function pauseScenario() { playing = false; schedule(); }
function stopScenario() { clearTimeout(scenTimer); }
$('#scen-tabs').addEventListener('click', e => { const b = e.target.closest('[data-scen]'); if (b) { playing = !reducedMotion; startScenario(b.dataset.scen); } });
$('#scen-bar').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b && scen) { scen.i = +b.dataset.step; showStep(); } });
$('#scen-next').onclick = () => nextStep(false);
$('#scen-prev').onclick = prevStep;
$('#scen-play').onclick = () => { playing = !playing; if (playing && scen && scen.i === scen.s.steps.length - 1) scen.i = -1, nextStep(); else schedule(); };

/* ============================================================
   TITLE BLOCK — live view name and true drawing scale
   ============================================================ */
function viewLabel() {
  if (selected) return 'Detail · ' + (MOD[selected].addr || MOD[selected].label);
  const s = SHOTS[stage.shot];
  return s ? s.label : 'Free view';
}
$('#titleblock').innerHTML = `<div class="tb-row tb-main"><b>THE WIRED CAR</b><span>Audi e-tron 55 quattro · GE</span></div>
  <div class="tb-row"><span class="k">View</span><span id="tb-view">—</span></div>
  <div class="tb-row tb-3"><span><span class="k">Scale</span><span id="tb-scale">—</span></span><span><span class="k">Units</span>mm</span><span><span class="k">Sheet</span>1/1</span></div>
  <div class="tb-row tb-3"><span><span class="k">Scan</span>${esc(D.meta.scanned)}</span><span><span class="k">Rev</span>${esc(D.meta.as_of)}</span><span><span class="k">Proj</span><svg class="proj" viewBox="0 0 30 14" aria-label="first-angle projection"><path d="M1 3l10 2v4L1 11z"/><circle cx="21" cy="7" r="5"/><circle cx="21" cy="7" r="2.2"/></svg></span></div>`;
let lastScale = 0;
stage.onFrame(() => {
  const mmPerCssMm = stage.mmPerPx() / 0.2646;
  const nice = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100].reduce((a, b) => Math.abs(b - mmPerCssMm) < Math.abs(a - mmPerCssMm) ? b : a);
  if (nice !== lastScale) { lastScale = nice; $('#tb-scale').textContent = '1:' + nice; }
});

/* ============================================================
   PALETTE (⌘K)
   ============================================================ */
const pal = $('#palette'), palQ = $('#pal-q'), palList = $('#pal-list');
let palSel = 0, palItems = [];
function palRender() {
  const s = palQ.value.trim().toLowerCase();
  const pool = overlay.items.map(m => ({ m, hay: [m.label, m.addr, m.part, m.name, DOM[m.domain].label].join(' ').toLowerCase() }));
  palItems = (s ? pool.filter(x => s.split(/\s+/).every(t => x.hay.includes(t))) : pool).slice(0, 40).map(x => x.m);
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  palList.innerHTML = palItems.length ? palItems.map((m, i) => `<li role="option" id="pal-${i}" aria-selected="${i === palSel}" data-id="${esc(m.id)}">
    <span class="p-no">${overlay.itemNo[m.id]}</span><span class="p-main"><b>${esc(m.label)}</b><span>${esc(DOM[m.domain].label)}</span></span>
    <span class="mono">${esc(m.addr || '')}</span><span class="p-bus">${(m.bus || []).map(b => `<i data-bus="${b}"></i>`).join('')}</span></li>`).join('')
    : '<li class="pal-empty">No module matches.</li>';
  palQ.setAttribute('aria-activedescendant', palItems.length ? 'pal-' + palSel : '');
  $('#pal-' + palSel)?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { if (pal.open) return; palQ.value = ''; palSel = 0; palRender(); pal.showModal(); palQ.focus(); }
function palGo(id) { pal.close(); showModule(id); }
palQ.addEventListener('input', () => { palSel = 0; palRender(); });
palQ.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); palRender(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); palRender(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (palItems[palSel]) palGo(palItems[palSel].id); }
});
palList.addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) palGo(li.dataset.id); });
pal.addEventListener('click', e => { if (e.target === pal) pal.close(); });
$('#open-find').onclick = openPalette;

/* go to the explorer and show a module there (from anywhere on the page) */
function showModule(id) {
  const ex = $('#explore');
  const go = () => { setMode('explore'); markRail('explore'); selectModule(id, { fromOutside: true }); };
  const r = ex.getBoundingClientRect();
  if (Math.abs(r.top) < innerHeight * 0.4 && mode === 'explore') { go(); return; }
  ex.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  // wait until the scroll settles, then select (the beat observer switches the mode on the way)
  let t = 0; const wait = () => { const rr = ex.getBoundingClientRect(); if (Math.abs(rr.top) < 4 || t++ > 90) go(); else requestAnimationFrame(wait); }; requestAnimationFrame(wait);
}
function showBus(b) {
  const ex = $('#explore');
  ex.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  let t = 0; const wait = () => { if (Math.abs(ex.getBoundingClientRect().top) < 4 || t++ > 90) { setMode('explore'); filterBus(b); } else requestAnimationFrame(wait); }; requestAnimationFrame(wait);
}

/* ============================================================
   KEYBOARD
   ============================================================ */
addEventListener('keydown', e => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (typing || pal.open) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (mode === 'explore' && /^[1-8]$/.test(e.key)) { setView(VIEWS[+e.key - 1][0]); return; }
  if (e.key === 'Escape' && selected) { deselect(); return; }
  if (interactive() && document.activeElement === glHost) {
    const k = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, 6], ArrowDown: [0, -6] }[e.key];
    if (k) { e.preventDefault(); stage.orbit(k[0], k[1]); }
    if (e.key === '+' || e.key === '=') stage.zoom(0.85);
    if (e.key === '-') stage.zoom(1.18);
  }
  if (mode === 'scenarios' && e.key === ' ' && document.activeElement === document.body) { e.preventDefault(); $('#scen-play').click(); }
});
glHost.tabIndex = 0;
glHost.setAttribute('role', 'img');
glHost.setAttribute('aria-label', 'Engineering drawing of the Audi e-tron with its control units and wiring. Use the parts list to select a module; arrow keys turn the view.');

/* ============================================================
   CHROME: rail, progress, theme
   ============================================================ */
const CHAPTERS = [['top', 'Intro'], ['inside', 'Inside'], ['router', 'Gateway'], ['explore', 'Drawing'], ['scenarios', 'In motion'], ['network', 'Network'], ['modules', 'Roster'], ['critical', 'Criticality'], ['uds', 'UDS'], ['story', 'Findings']];
$('#rail').innerHTML = CHAPTERS.map(([id, l], i) => `<a href="#${id}" data-sec="${id}"><span class="mono">${String(i).padStart(2, '0')}</span>${esc(l)}</a>`).join('');
function markRail(id) { $$('#rail a').forEach(a => a.classList.toggle('on', a.dataset.sec === id)); }
const chObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) markRail(e.target.id); }), { rootMargin: '-40% 0px -55% 0px' });
$$('.chapter').forEach(c => chObs.observe(c));
let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const h = document.documentElement.scrollHeight - innerHeight;
    $('#progress i').style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
    $('#bar').classList.toggle('scrolled', scrollY > 8);
    // studio → x-ray: scrubbed by scroll through the hero, so the paint dissolves into the network
    if (mode === 'hero') {
      const hero = $('#top'), t = Math.max(0, Math.min(1, scrollY / Math.max(1, hero.offsetHeight * 0.75)));
      stage.setStudio(1 - t); stage.setSystems(t * 0.8); stage.setGhost(1 - 0.6 * t);
    }
  });
}, { passive: true });

const themeBtn = $('#theme');
function syncTheme() {
  const light = html.dataset.theme === 'vellum';
  themeBtn.setAttribute('aria-label', light ? 'Switch to the dark theme' : 'Switch to the light theme');
}
themeBtn.onclick = () => {
  html.dataset.theme = html.dataset.theme === 'vellum' ? 'graphite' : 'vellum';
  try { localStorage.setItem('etron-theme', html.dataset.theme); } catch (_) { /* private mode */ }
  syncTheme();
};
syncTheme();
addEventListener('beforeprint', () => { html.dataset.prevTheme = html.dataset.theme; html.dataset.theme = 'vellum'; });
addEventListener('afterprint', () => { if (html.dataset.prevTheme) html.dataset.theme = html.dataset.prevTheme; });

let rz = 0;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (mode) { stage.setInsets(insetsFor(mode)); overlay.set({ insets: insetsFor(mode) }); } }, 120); });

/* ============================================================
   CHAPTERS + BOOT
   ============================================================ */
renderChapters(D, ctx, { showModule, showBus });
$('#trace-play').onclick = () => {
  $('#scenarios').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  let t = 0; const wait = () => { if (Math.abs($('#scenarios').getBoundingClientRect().top) < 4 || t++ > 90) { setMode('scenarios'); playing = true; startScenario('diag'); } else requestAnimationFrame(wait); }; requestAnimationFrame(wait);
};
renderSheet();
setMode('hero');
if (!stage.reduced && !deep) {
  stageEl.classList.add('printing');
  setTimeout(() => stage.drawOn(2800).then(() => stageEl.classList.remove('printing')), 250);
}
// deep links / screenshot hooks: ?mode=explore&view=side&sel=0x4010&scen=doors&theme=vellum
if (q.get('theme')) { html.dataset.theme = q.get('theme'); syncTheme(); }
if (q.get('mode')) {
  const m = q.get('mode'); const beat = beats.find(b => b.dataset.beat === m);
  if (beat) { beatObs.disconnect(); beat.scrollIntoView(); setMode(m); markRail(beat.id); setTimeout(() => beats.forEach(b => beatObs.observe(b)), 400); }
  if (q.get('view')) setView(q.get('view'));
  if (q.get('scen')) startScenario(q.get('scen'), +(q.get('step') || 0), true);
  if (q.get('sel')) selectModule(q.get('sel'), { fromOutside: true });
  if (q.get('bus')) filterBus(q.get('bus'));
}
// review hook used by tools/shoot.py
window.__app = {
  select: id => selectModule(id, { fromOutside: true }),
  view: setView,
  scenario: (id, step = 0) => { setMode('scenarios'); startScenario(id, step, true); pauseScenario(); },
  bus: filterBus,
};
