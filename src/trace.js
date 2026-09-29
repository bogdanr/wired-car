/* ============================================================
   One real exchange — a UDS sequence diagram of the cluster
   read and the write that needed an undocumented precondition.

     · Five phases (data: udsPhases), each a band with a letter.
     · The unit of reading is a request and its response: a solid
       arrow out, a dashed arrow back directly under it.
     · Colour means bus, as everywhere on the page: the tester ↔
       gateway half is Ethernet (DoIP), the gateway ↔ ECU half is
       the ECU's own bus. Outcome is a glyph, not a hue; the single
       negative response is the only use of the --hv accent.
     · A bar on the ECU lifeline marks the extended session, so the
       rows the precondition depends on sit visibly inside it.
     · "Step through" walks the pairs in place (← → space, Esc).
   ============================================================ */
import { esc, $, $$ } from './chapters.js';

// bytes that name the service: SID plus sub-function / DID (or the SID + NRC of a 7F)
const KEY = { 0x10: 2, 0x50: 2, 0x22: 3, 0x62: 3, 0x2E: 3, 0x6E: 3, 0x7F: 3 };
const TICK = '<svg class="seq-g ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const CROSS = '<svg class="seq-g no" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';

const hex = bytes => {
  const b = bytes.split(' ').filter(Boolean);
  if (!b.length) return '';
  const n = KEY[parseInt(b[0], 16)] || 1;
  return `<span class="seq-hex"><b>${esc(b.slice(0, n).join(' '))}</b>${b.length > n ? ' ' + esc(b.slice(n).join(' ')) : ''}</span>`;
};

export function renderTrace(D, ctx) {
  const { MOD, BUS } = ctx;
  const GW = D.topology.gateway;
  const trace = D.udsTrace;
  const ecu = trace.map(t => t.to).find(id => id !== 'tester' && id !== GW);
  const ecuBus = (MOD[ecu].bus && MOD[ecu].bus[0]) || 'can';
  const short = id => BUS[id].label.replace(/^Automotive\s+/i, '');
  const lanes = [
    { id: 'tester', name: 'Tester', sub: 'laptop · OBD socket' },
    { id: GW, name: 'Gateway', sub: GW },
    { id: ecu, name: MOD[ecu].label, sub: ecu }
  ];
  const wires = [{ bus: 'eth', label: `DoIP · ${short('eth')}` }, { bus: ecuBus, label: `ISO-TP · ${short(ecuBus)}` }];
  const col = id => lanes.findIndex(l => l.id === id);
  const who = id => id === ecu ? 'the cluster' : lanes[col(id)].name.toLowerCase();

  /* ---------- one message ---------- */
  const msg = (t, i) => {
    const a = col(t.from), b = col(t.to), lo = Math.min(a, b), hi = Math.max(a, b);
    const through = hi - lo === 2;
    const segs = [];
    for (let k = lo; k < hi; k++) {
      if (k > lo) segs.push(`<i class="seq-port" style="--l:var(--bus-${wires[k - 1].bus});--r:var(--bus-${wires[k].bus})"></i>`);
      segs.push(`<span class="seq-seg" data-bus="${wires[k].bus}"></span>`);
    }
    const glyph = t.dir === 'resp' ? (t.outcome === 'negative' ? CROSS : TICK) : '';
    const sr = `${who(t.from)} to ${who(t.to)}${through ? ', through the gateway' : ''}: ${t.meaning}${t.bytes ? `, bytes ${t.bytes}` : ''}${t.value ? `, value ${t.value}` : ''}${t.outcome === 'negative' ? ', refused' : ''}.`;
    return `<div class="seq-msg ${t.dir} ${t.outcome}" data-i="${i}" style="--x0:${lo};--x1:${hi}">
      <div class="seq-lab" aria-hidden="true"><span class="seq-who">${esc(lanes[a].name)} → ${esc(lanes[b].name)}</span>${glyph}${hex(t.bytes)}<span class="seq-mean">${esc(t.meaning)}</span>${t.value ? `<span class="seq-val">${esc(t.value)}</span>` : ''}${t.note ? `<span class="seq-note">${esc(t.note)}</span>` : ''}</div>
      <div class="seq-arr ${b > a ? 'r' : 'l'}" aria-hidden="true">${segs.join('')}</div>
      ${t.gwNote ? `<div class="seq-gwn" aria-hidden="true" style="--gx:${(1 - lo) / (hi - lo)}"><span>${esc(t.gwNote)}</span></div>` : ''}
      <span class="sr-only">${esc(sr.charAt(0).toUpperCase() + sr.slice(1))}</span></div>`;
  };

  /* ---------- group into pairs, pairs into phases ---------- */
  const pairs = [];
  trace.forEach((t, i) => {
    if (t.dir === 'resp') pairs[pairs.length - 1].items.push(i);
    else pairs.push({ phase: t.phase, fold: !!t.fold, items: [i] });
  });
  pairs.forEach((p, n) => { p.n = n; });

  const pairHtml = p => {
    const req = trace[p.items[0]], res = p.items[1] != null ? trace[p.items[1]] : null;
    const neg = res && res.outcome === 'negative';
    const fold = p.fold ? `<button type="button" class="seq-fold" aria-expanded="false" style="--x0:0;--x1:2">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>
        <span class="seq-hex">${esc(req.bytes)}</span><span class="seq-mean">${esc(req.meaning.split(' · ').pop())}</span>${res && res.value ? `<span class="seq-val">${esc(res.value)}</span>` : ''}
        <span class="seq-fold-k">+1 read</span></button>` : '';
    const inSess = p.items[0] > D.udsSession.opener;
    return `<li class="seq-pair${p.fold ? ' fold' : ''}${neg ? ' neg' : ''}${inSess ? ' in-sess' : ''}" data-step="${p.n}">${fold}${p.items.map(i => msg(trace[i], i)).join('')}</li>`;
  };

  const phases = D.udsPhases.map(ph => {
    const ps = pairs.filter(p => p.phase === ph.id);
    if (!ps.length) return '';
    const neg = ps.some(p => p.items.some(i => trace[i].outcome === 'negative'));
    return `<section class="seq-phase${neg ? ' neg' : ''}" data-phase="${esc(ph.id)}" aria-labelledby="seq-ph-${esc(ph.id)}">
      <header class="seq-ph"><span class="seq-ph-l" aria-hidden="true">${esc(ph.letter)}</span>
        <div><h4 id="seq-ph-${esc(ph.id)}"><span class="sr-only">Phase ${esc(ph.letter)}: </span>${esc(ph.title)}</h4><p>${esc(ph.gist)}</p>
        ${ph.repeat || ph.noteRef ? `<div class="seq-ph-tags">${ph.repeat ? `<span class="seq-tag">${esc(ph.repeat)}</span>` : ''}${ph.noteRef ? `<a class="seq-tag link" href="#${esc(ph.noteRef)}">${esc(ph.noteLabel || 'Note')} ↓</a>` : ''}</div>` : ''}</div>
      </header>
      <ol class="seq-pairs">${ps.map(pairHtml).join('')}</ol></section>`;
  }).join('');

  const seq = $('#seq');
  seq.innerHTML = `<div class="seq-head">
      <div class="seq-lanes" aria-hidden="true">
        ${lanes.map((l, k) => `<div class="seq-lane" style="--lane:${k}"><b>${esc(l.name)}</b><span>${esc(l.sub)}</span></div>`).join('')}
        ${wires.map((w, k) => `<div class="seq-wire" data-bus="${w.bus}" style="--lane:${k + 0.5}"><i></i>${esc(w.label)}</div>`).join('')}
      </div>
      <div class="seq-cap" hidden>
        <div class="seq-cap-ctl">
          <button type="button" class="icon sm" data-go="-1" aria-label="Previous step"><svg viewBox="0 0 20 20"><path d="M12 5l-5 5 5 5"/></svg></button>
          <button type="button" class="icon sm" data-go="1" aria-label="Next step"><svg viewBox="0 0 20 20"><path d="M8 5l5 5-5 5"/></svg></button>
        </div>
        <span class="seq-cap-k mono"></span>
        <p class="seq-cap-t"></p>
        <button type="button" class="icon sm" data-go="stop" aria-label="Stop stepping"><svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8"/></svg></button>
      </div>
    </div>
    <div class="seq-body">
      ${lanes.map((_, k) => `<span class="seq-life" style="--lane:${k}" aria-hidden="true"></span>`).join('')}
      <div class="seq-sess" aria-hidden="true"><span>${esc(D.udsSession.label)}</span></div>
      ${phases}
    </div>`;

  /* ---------- session bar: from the 50 03 response to the last message ---------- */
  const body = $('.seq-body', seq), bar = $('.seq-sess', seq);
  const placeBar = () => {
    const from = $(`.seq-msg[data-i="${D.udsSession.opener}"]`, seq);
    const rows = $$('.seq-msg', seq).filter(r => r.offsetParent);
    const to = rows[rows.length - 1];
    if (!from || !to) return;
    const top = body.getBoundingClientRect().top;
    const y0 = from.getBoundingClientRect().bottom - top - 6, y1 = $('.seq-arr', to).getBoundingClientRect().top - top + 5;  // stop at the last arrow's line
    bar.style.top = `${y0}px`; bar.style.height = `${Math.max(0, y1 - y0)}px`;
  };
  if ('ResizeObserver' in window) new ResizeObserver(placeBar).observe(body);
  addEventListener('resize', placeBar);
  placeBar();

  /* ---------- fold the repeated read ---------- */
  const setFold = (li, open) => {
    li.classList.toggle('open', open);
    const b = $('.seq-fold', li);
    b.setAttribute('aria-expanded', String(open));
    $('.seq-fold-k', b).textContent = open ? 'fold' : '+1 read';
    placeBar();
  };
  seq.addEventListener('click', e => {
    const f = e.target.closest('.seq-fold');
    if (f) setFold(f.closest('.seq-pair'), !f.closest('.seq-pair').classList.contains('open'));
  });

  /* ---------- stepper ---------- */
  const units = $$('.seq-pair', seq);
  const cap = $('.seq-cap', seq), capK = $('.seq-cap-k', seq), capT = $('.seq-cap-t', seq);
  const btn = $('#trace-step');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let step = -1;
  const phaseOf = id => D.udsPhases.find(p => p.id === id);

  const go = n => {
    step = Math.max(0, Math.min(units.length - 1, n));
    const li = units[step], p = pairs[step], ph = phaseOf(p.phase);
    units.forEach((u, k) => { u.classList.toggle('cur', k === step); u.classList.toggle('past', k < step); });
    $$('.seq-phase', seq).forEach(s => s.classList.toggle('cur', s.dataset.phase === p.phase));
    if (li.classList.contains('fold') && !li.classList.contains('open')) setFold(li, true);
    const say = trace[p.items[0]].say || '';
    capK.textContent = `${String(step + 1).padStart(2, '0')} / ${String(units.length).padStart(2, '0')} · ${ph.letter} ${ph.title}`;
    capT.textContent = say;
    const live = $('#live'); if (live) live.textContent = `Step ${step + 1} of ${units.length}. ${say}`;
    $('[data-go="-1"]', cap).disabled = step === 0;
    $('[data-go="1"]', cap).disabled = step === units.length - 1;
    const r = li.getBoundingClientRect(), head = $('.seq-head', seq).getBoundingClientRect().bottom;
    if (r.top < head + 8 || r.bottom > innerHeight - 24) {
      scrollBy({ top: r.top - head - Math.max(24, (innerHeight - head - r.height) / 2.5), behavior: reduced ? 'auto' : 'smooth' });
    }
  };
  const start = () => {
    seq.classList.add('stepping'); cap.hidden = false;
    btn.setAttribute('aria-pressed', 'true'); $('span', btn).textContent = 'Restart';
    go(0); placeBar();
  };
  const stop = () => {
    seq.classList.remove('stepping'); cap.hidden = true; step = -1;
    units.forEach(u => u.classList.remove('cur', 'past'));
    $$('.seq-phase', seq).forEach(s => s.classList.remove('cur'));
    btn.setAttribute('aria-pressed', 'false'); $('span', btn).textContent = 'Step through';
    placeBar();
  };
  btn.addEventListener('click', start);
  cap.addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'stop') { stop(); btn.focus(); } else go(step + +b.dataset.go);
  });
  // click a pair while stepping to jump there
  seq.addEventListener('click', e => {
    if (step < 0 || e.target.closest('.seq-fold, a, button')) return;
    const li = e.target.closest('.seq-pair'); if (li) go(+li.dataset.step);
  });
  document.addEventListener('keydown', e => {
    if (step < 0 || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const r = seq.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;           // only while the diagram is on screen
    if (e.key === 'ArrowRight' || (e.key === ' ' && e.target.tagName !== 'BUTTON')) { e.preventDefault(); go(step + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(step - 1); }
    else if (e.key === 'Escape') { stop(); }
  });

  // print: every row, no stepper
  addEventListener('beforeprint', () => { units.filter(u => u.classList.contains('fold')).forEach(u => setFold(u, true)); stop(); });
}
