/* ============================================================
   Chapters — the report below the stage
   ------------------------------------------------------------
   Pure DOM rendering from the dataset. Nothing here draws the
   car; rows and chips call back into the stage via `hooks`.
   ============================================================ */
import { BUS_ORDER } from './stage/network.js';
import { HAS_MODEL } from 'etron-model';
import { renderSchematic } from './schematic.js';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

export const CRIT = {
  critical: { label: 'Critical', long: 'Critical — safety', ticks: 4 },
  high: { label: 'High', long: 'High — functional safety', ticks: 3 },
  medium: { label: 'Medium', long: 'Medium — functional', ticks: 2 },
  low: { label: 'Low', long: 'Low — comfort', ticks: 1 }
};
export const CRIT_ORDER = ['critical', 'high', 'medium', 'low'];

export const fmtRate = r => r >= 1e9 ? (r / 1e9) + ' Gbit/s' : r >= 1e6 ? (r / 1e6) + ' Mbit/s' : (r / 1e3) + ' kbit/s';
export const critTicks = c => `<span class="ticks-c" aria-label="${esc(CRIT[c].long)}" title="${esc(CRIT[c].long)}">${[1, 2, 3, 4].map(i => `<i class="${i <= CRIT[c].ticks ? 'on' : ''}"></i>`).join('')}</span>`;
export const busDots = (m, BUS) => (m.bus && m.bus.length)
  ? m.bus.map(b => `<span class="bus-tag" data-bus="${b}"><i></i>${esc(BUS[b].label)}</span>`).join('')
  : '<span class="bus-tag none"><i></i>no bus</span>';

export function renderChapters(D, ctx, hooks) {
  const { MOD, BUS, DOM, itemNo } = ctx;
  const GW = D.topology.gateway;
  const ecus = D.modules.filter(m => m.kind === 'ecu');

  /* ---------- hero facts ---------- */
  $('#facts').innerHTML = [
    [ecus.length, 'control units'],
    [D.buses.length, 'networks'],
    [D.flows.length, 'message flows'],
    ['1', 'gateway']
  ].map(([v, k]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  /* ---------- under the skin: per-bus counters ---------- */
  $('#counters').innerHTML = BUS_ORDER.map(id => {
    const b = BUS[id];
    return `<div class="counter" data-bus="${id}"><b>${b.members.length}</b><span>${esc(b.label.replace(/^Automotive\s+/i, ''))}</span></div>`;
  }).join('');

  /* ---------- the router ---------- */
  $('#gw-addr').textContent = GW;
  $('#ports').innerHTML = BUS_ORDER.map(id => {
    const b = BUS[id];
    return `<li data-bus="${id}"><i></i><span>${esc(D.topology.ports[id] || b.label)}</span><em>${esc(fmtRate(b.bitrate))}</em></li>`;
  }).join('');

  /* ---------- bus spec table: log-scale bitrate ruler ---------- */
  const lg = r => (Math.log10(r) - 3) / 6; // 1 kbit/s … 1 Gbit/s
  const spec = $('#bus-spec');
  spec.removeAttribute('role');
  spec.innerHTML = `<table class="spec-t">
    <thead><tr><th scope="col">Bus</th><th scope="col" class="c-rate">Bit rate <span class="axis"><span>1k</span><span>10k</span><span>100k</span><span>1M</span><span>10M</span><span>100M</span><span>1G</span></span></th><th scope="col">Topology</th><th scope="col" class="num">Nodes</th><th scope="col">Why it exists</th></tr></thead>
    <tbody>${BUS_ORDER.slice().reverse().map(id => {
      const b = BUS[id];
      return `<tr data-bus="${id}">
        <th scope="row"><span class="bus-name"><i></i>${esc(b.label)}</span></th>
        <td class="c-rate"><span class="rate"><span class="rate-bar" style="left:${(lg(b.bitrateMin) * 100).toFixed(1)}%;width:${Math.max(1.4, (lg(b.bitrate) - lg(b.bitrateMin)) * 100).toFixed(1)}%"></span></span><span class="rate-v">${esc(b.speed)}</span></td>
        <td>${esc(b.topology)}</td>
        <td class="num">${b.members.length}</td>
        <td class="why">${esc(b.why)}</td></tr>`;
    }).join('')}</tbody></table>`;
  spec.addEventListener('click', e => { const tr = e.target.closest('tr[data-bus]'); if (tr) hooks.showBus(tr.dataset.bus); });

  renderSchematic(D, ctx, hooks);

  /* ---------- roster ---------- */
  const roster = $('#roster');
  const rows = ctx.items.concat(D.modules.filter(m => m.id === 'tester'));
  roster.innerHTML = `<thead><tr><th scope="col" class="num">No.</th><th scope="col">Address</th><th scope="col">Module</th><th scope="col">Domain</th><th scope="col">Bus</th><th scope="col">Criticality</th><th scope="col">Access</th><th scope="col">Part no.</th></tr></thead>
    <tbody>${rows.map(m => `<tr data-id="${esc(m.id)}" data-dom="${esc(m.domain)}" tabindex="0">
      <td class="num mono">${itemNo[m.id] || 'T'}</td>
      <td class="mono">${esc(m.addr || '—')}</td>
      <td><b>${esc(m.label)}</b><small>${esc(m.role || '')}</small></td>
      <td>${esc(DOM[m.domain] ? DOM[m.domain].label : m.domain)}</td>
      <td class="buses">${busDots(m, BUS)}</td>
      <td>${critTicks(m.criticality)}<span class="crit-l">${esc(CRIT[m.criticality].label)}</span></td>
      <td><span class="acc ${m.access === 'read-only' ? 'ro' : 'rw'}">${esc(m.access)}</span></td>
      <td class="mono dim">${esc(m.part || '—')}</td></tr>`).join('')}</tbody>`;
  const chips = $('#mod-dom');
  const domsUsed = D.domains.filter(d => D.modules.some(m => m.domain === d.id));
  chips.innerHTML = `<button type="button" class="chip on" data-dom="">All</button>` + domsUsed.map(d => `<button type="button" class="chip" data-dom="${d.id}">${esc(d.label)}</button>`).join('');
  let dom = '', q = '';
  const filter = () => {
    let n = 0;
    $$('tbody tr', roster).forEach(tr => {
      const m = MOD[tr.dataset.id];
      const hay = [m.label, m.addr, m.part, m.name, m.role, m.id].join(' ').toLowerCase();
      const on = (!dom || m.domain === dom) && (!q || hay.includes(q));
      tr.hidden = !on; if (on) n++;
    });
    $('#mod-count').textContent = `${n} of ${rows.length}`;
  };
  chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    dom = b.dataset.dom; $$('.chip', chips).forEach(c => c.classList.toggle('on', c === b)); filter();
  });
  $('#mod-q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); filter(); });
  const pickRow = tr => tr && hooks.showModule(tr.dataset.id);
  roster.addEventListener('click', e => pickRow(e.target.closest('tr[data-id]')));
  roster.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(e.target.closest('tr[data-id]')); } });
  filter();

  /* ---------- criticality × access matrix ---------- */
  const acc = ['read+write', 'read-only'];
  $('#matrix').innerHTML = `<div class="mx-corner"><span>Criticality</span><span>Access →</span></div>` +
    acc.map(a => `<div class="mx-colh">${a === 'read-only' ? 'Read only' : 'Read + write'}<small>${a === 'read-only' ? 'writing refused or never attempted' : 'extended session, some behind SFD'}</small></div>`).join('') +
    CRIT_ORDER.map(c => `<div class="mx-rowh">${critTicks(c)}<b>${esc(CRIT[c].label)}</b><small>${esc(CRIT[c].long.split('— ')[1])}</small></div>` +
      acc.map(a => {
        const ms = D.modules.filter(m => m.criticality === c && m.access === a && m.id !== 'tester');
        return `<div class="mx-cell${ms.length ? '' : ' empty'}" data-c="${c}" data-a="${a}"><span class="mx-n">${ms.length}</span><div class="mx-chips">${ms.map(m => `<button type="button" data-id="${esc(m.id)}" data-bus="${esc((m.bus && m.bus[0]) || 'none')}" title="${esc(m.label)}"><i></i>${esc(m.addr || m.label)}</button>`).join('')}</div></div>`;
      }).join('')).join('');
  $('#matrix').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) hooks.showModule(b.dataset.id); });

  $('#access').innerHTML = `<thead><tr><th scope="col">Group</th><th scope="col">Read, free</th><th scope="col">Write, gated</th></tr></thead><tbody>` +
    D.accessGroups.map(g => `<tr><th scope="row">${esc(g.group)}</th><td>${esc(g.read)}</td><td class="${/never|locked/i.test(g.write) ? 'locked' : ''}">${esc(g.write)}</td></tr>`).join('') + '</tbody>';

  /* ---------- UDS verbs + ladder ---------- */
  const barrierCls = b => b === 'free' ? 'free' : /security|sfd/i.test(b) ? 'locked' : 'gated';
  $('#verbs').innerHTML = D.udsServices.map(s => `<div class="verb ${barrierCls(s.barrier)}">
    <span class="verb-id mono">${esc(s.id.replace('0x', ''))}</span>
    <div><b>${esc(s.name)}</b><p>${esc(s.role)}</p></div>
    <span class="verb-b">${esc(s.barrier)}</span></div>`).join('');
  $('#ladder').innerHTML = D.privilegeLadder.map(l => `<li><span class="lad-n">${l.n}</span><div><b>${esc(l.name)}</b><p>${esc(l.detail)}</p><small>unlocks: ${esc(l.blocks)}</small></div></li>`).join('');

  /* ---------- sequence diagram of the real exchange ---------- */
  const lanes = [['tester', 'Tester', 'laptop · DoIP'], [GW, 'Gateway', GW], ['0x4014', 'Cluster', '0x4014']];
  const col = id => lanes.findIndex(l => l[0] === id);
  const seq = $('#seq');
  seq.innerHTML = `<div class="seq-lanes">${lanes.map(l => `<div class="seq-lane"><b>${esc(l[1])}</b><span class="mono">${esc(l[2])}</span></div>`).join('')}</div>
    <ol class="seq-rows">${D.udsTrace.map((t, i) => {
      // tester ↔ ECU traffic always crosses the gateway: draw it as two hops
      let a = col(t.from), b = col(t.to);
      const through = Math.abs(a - b) === 2;
      const dir = b > a ? 'r' : 'l';
      return `<li class="seq-row s-${esc(t.state)}" style="--a:${Math.min(a, b)};--b:${Math.max(a, b)}" data-i="${i}">
        <span class="seq-t mono">${String(i + 1).padStart(2, '0')}</span>
        <div class="seq-msg"><span class="seq-what">${t.what}</span>${t.note ? `<span class="seq-note">${esc(t.note)}</span>` : ''}</div>
        <span class="seq-arrow ${dir}${through ? ' thru' : ''}"><i></i></span></li>`;
    }).join('')}</ol>`;

  /* ---------- footer ---------- */
  const mt = D.meta;
  $('#foot-meta').innerHTML = `<span>${esc(mt.model)}</span><span class="mono">VIN ${esc(mt.vin)}</span><span>Scanned ${esc(mt.scanned)}</span><span>Rev. ${esc(mt.as_of)}</span>`;
  const provEntries = Object.entries(D.provenance);
  $('#prov').innerHTML = provEntries.map(([k, v]) => {
    const tag = /^INFERRED/.test(v) ? 'inferred' : /^SCHEMATIC/.test(v) ? 'schematic' : 'sourced';
    return `<div class="prov-row ${tag}"><dt>${esc(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</dt><dd><span class="prov-tag">${tag}</span>${esc(String(v).replace(/^(INFERRED|SCHEMATIC) — /, ''))}</dd></div>`;
  }).join('');
  // licensed body model (painted look only): the credit its licence requires
  const md = D.vehicle.model;
  if (HAS_MODEL && md) {
    const cr = $('#foot-credit');
    cr.innerHTML = `<span class="prov-tag">3D model</span> The painted body is based on <a href="${esc(md.url)}" rel="noopener">“${esc(md.title)}”</a>
      by <a href="${esc(md.authorUrl)}" rel="noopener">${esc(md.author)}</a>, licensed under
      <a href="${esc(md.licenseUrl)}" rel="noopener">${esc(md.license)}</a>; simplified and re-materialled for this page. ${esc(md.note)}`;
    cr.hidden = false;
  }
}
