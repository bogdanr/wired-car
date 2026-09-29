/* ============================================================
   System schematic: the network drawn the way an electronics
   engineer would draw it:

     · CAN and CAN FD are terminated two-wire lines (120 Ω at each end);
       modules tap off them in front-to-rear order.
     · FlexRay and Ethernet are stars centred on the gateway
       (star coupler / switch: placement schematic, as the data says).
     · LIN hangs off its master, not the gateway.
     · The tester sits outside the vehicle boundary; its only way in is
       the OBD socket → gateway.
     · A module on two buses is drawn once; its second connection is an
       off-sheet connector flag.
     · Wire weight follows bit rate; colour means bus, nothing else.

   The desktop drawing is one SVG; below 900 px a stacked HTML version
   (one panel per bus) replaces it. Hover lights a module's path to the
   gateway; "trace" plays the scenarios as packets that stop at the
   gateway only when they change bus, the same rule the 3D stage uses.
   ============================================================ */
import { esc, $, $$, fmtRate } from './chapters.js';

const SHORT = { can: 'CAN', canfd: 'CAN FD', flexray: 'FlexRay', lin: 'LIN', eth: 'Ethernet' };
const WIRE = { lin: 1, can: 1.1, canfd: 1.4, flexray: 1.9, eth: 2.6 };  // stroke ∝ bit rate
const PAIR = { can: 2.4, canfd: 2.8 };                                  // half-gap of the H/L pair
const PRIMARY = ['can', 'canfd', 'flexray', 'eth'];
const LINEBUS = new Set(['can', 'canfd']);

const W = 1280;           // viewBox width
const BX1 = 1176;         // vehicle boundary, right edge (tester lives outside it)
const FONT_W = 5.75;      // average glyph width of the 10.5 px label face
const r1 = v => Math.round(v * 10) / 10;

function wrap(text, cpl) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if (line && (line + ' ' + w).length > cpl) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}

export function renderSchematic(D, ctx, hooks) {
  const { MOD, BUS, itemNo } = ctx;
  const GW = D.topology.gateway;
  const gwM = MOD[GW];
  const X = id => MOD[id].location.mm.x;
  const byX = (a, b) => X(a) - X(b);
  const linSegs = D.topology.lin || [];
  const linMasterOf = {};                         // slave → master
  linSegs.forEach(s => s.slaves.forEach(sl => { linMasterOf[sl] = s.master; }));
  const linMasters = new Set(linSegs.map(s => s.master));
  const localLin = new Set(D.topology.localLin || []);
  const busesOf = id => id === 'tester' ? ['eth'] : (MOD[id].bus || []).filter(b => PRIMARY.includes(b));
  const home = id => busesOf(id)[0] || null;

  /* ---------------- geometry registry (used by the tracer) ---------------- */
  const pin = {};          // pin[id][bus] = { edge:[x,y], tap:[x,y] }
  const gwp = {};          // gwp[bus] = { tap, port, via:[...pts to core] }
  const placed = {};       // id → times drawn as a block
  const setPin = (id, b, edge, tap) => { (pin[id] = pin[id] || {})[b] = { edge, tap: tap || edge }; };

  const svg = [];          // layered output
  const wires = [], blocks = [], marks = [], under = [];
  const add = (arr, s) => arr.push(s);

  /* a module block: address line + wrapped full name, never truncated */
  function block(id, x, y, w, opts = {}) {
    const m = MOD[id];
    const cpl = Math.max(8, Math.floor((w - 14) / FONT_W));
    const lines = wrap(m.label, cpl);
    const h = 18 + lines.length * 13;
    const b = opts.bus || home(id) || 'none';
    placed[id] = (placed[id] || 0) + 1;
    const no = itemNo[id] ? `<text class="sc-no" x="${r1(x + w - 7)}" y="${r1(y + 13)}" text-anchor="end">${itemNo[id]}</text>` : '';
    add(blocks, `<g class="sx sc-blk${opts.cls ? ' ' + opts.cls : ''}" data-m="${esc(id)}" data-bus="${b}" tabindex="0" role="button"
      aria-label="${esc((m.addr ? m.addr + ', ' : '') + m.label)}. Show on the car.">
      <rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="5"/>
      <rect class="sc-blk-tab" x="${r1(x)}" y="${r1(y)}" width="3" height="${h}" rx="1.5"/>
      <text class="sc-addr" x="${r1(x + 9)}" y="${r1(y + 13)}">${esc(opts.addr || m.addr || '—')}</text>${no}
      ${lines.map((l, i) => `<text class="sc-lab" x="${r1(x + 9)}" y="${r1(y + 27 + i * 13)}">${esc(l)}</text>`).join('')}
    </g>`);
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, top: y, bottom: y + h, left: x, right: x + w };
  }
  const hOf = (id, w) => 18 + wrap(MOD[id].label, Math.max(8, Math.floor((w - 14) / FONT_W))).length * 13;

  const dot = (x, y, b, m = '') => add(marks, `<circle class="sx sc-dot" data-b="${b}" data-m="${m}" data-bus="${b}" cx="${r1(x)}" cy="${r1(y)}" r="${b === 'eth' || b === 'flexray' ? 3.4 : 3}"/>`);
  const line = (pts, b, m = '', cls = '') => add(wires, `<polyline class="sx sc-w${cls ? ' ' + cls : ''}" data-b="${b}" data-m="${m}" data-bus="${b}" style="stroke-width:${WIRE[b]}" points="${pts.map(p => p.map(r1).join(',')).join(' ')}"/>`);
  /* off-sheet connector: a flag pointing at the other half of the connection */
  function flag(x, y, dir, text, b, m) {
    const w = 8 + text.length * 5.6, h = 16, x0 = x - w / 2;
    const tip = dir === 'up' ? `M${r1(x0)},${r1(y + h)} L${r1(x0)},${r1(y + 5)} L${r1(x)},${r1(y)} L${r1(x0 + w)},${r1(y + 5)} L${r1(x0 + w)},${r1(y + h)} Z`
      : `M${r1(x0)},${r1(y)} L${r1(x0 + w)},${r1(y)} L${r1(x0 + w)},${r1(y + h - 5)} L${r1(x)},${r1(y + h)} L${r1(x0)},${r1(y + h - 5)} Z`;
    add(blocks, `<g class="sx sc-flag" data-m="${esc(m)}" data-b="${b}" data-bus="${b}" tabindex="0" role="button" aria-label="${esc(MOD[m].label)}, also on ${esc(BUS[b].label)}. Show on the car.">
      <path d="${tip}"/><text x="${r1(x)}" y="${r1(y + (dir === 'up' ? 13 : 11))}" text-anchor="middle">${esc(text)}</text></g>`);
  }
  function termination(x, y, b) {
    add(marks, `<g class="sx sc-term" data-b="${b}" data-m="" data-bus="${b}"><rect x="${r1(x - 3.5)}" y="${r1(y - 9)}" width="7" height="18" rx="1"/>
      <text x="${r1(x)}" y="${r1(y - 14)}" text-anchor="middle">120 Ω</text></g>`);
  }
  function busLabel(x, y, b, anchor = 'start', extra = '') {
    const B = BUS[b];
    add(marks, `<g class="sx sc-busl" data-b="${b}" data-m="" data-bus="${b}"><text class="sc-busn" x="${x}" y="${y}" text-anchor="${anchor}">${esc(SHORT[b] || B.label)}${extra ? `<tspan class="sc-bust"> · ${esc(extra)}</tspan>` : ''}</text>
      <text class="sc-busr" x="${x}" y="${y + (LINEBUS.has(b) ? 26 : 12)}" text-anchor="${anchor}">${esc(fmtRate(B.bitrate))}</text></g>`);
  }
  /* the pair: two thin conductors (H/L) plus a fat invisible hit line */
  function pairLine(x0, x1, y, b) {
    const g = PAIR[b];
    add(wires, `<g class="sx sc-trunk" data-b="${b}" data-m="" data-bus="${b}">
      <line class="sc-w" x1="${x0}" x2="${x1}" y1="${r1(y - g)}" y2="${r1(y - g)}" style="stroke-width:${WIRE[b]}"/>
      <line class="sc-w" x1="${x0}" x2="${x1}" y1="${r1(y + g)}" y2="${r1(y + g)}" style="stroke-width:${WIRE[b]}"/>
      <line class="sc-hit" x1="${x0}" x2="${x1}" y1="${y}" y2="${y}"/></g>`);
    termination(x0 - 4, y, b); termination(x1 + 4, y, b);
  }
  const taps = { can: [], canfd: [] };

  /* ================= CAN: alternate above / below, gateway takes a slot ================= */
  const canIds = D.modules.filter(m => m.id !== GW && home(m.id) === 'can').map(m => m.id);
  const canRow = [...canIds, GW].sort(byX);
  const gwIdx = canRow.indexOf(GW);
  const cX0 = 150, cX1 = 1100, cStep = (cX1 - cX0) / (canRow.length - 1), cW = Math.round(2 * cStep - 10);
  const sideOf = i => ((i - gwIdx) % 2 === 0) ? 'bot' : 'top';
  const topMaxH = Math.max(...canRow.filter((id, i) => id !== GW && sideOf(i) === 'top').map(id => hOf(id, cW)));
  const linSlaveH = Math.max(0, ...Object.keys(linMasterOf).map(id => hOf(id, cW)));
  const canY = 16 + (linSlaveH ? linSlaveH + 34 : 0) + topMaxH + 26;
  pairLine(40, 1150, canY, 'can');
  busLabel(56, canY - 9, 'can');
  let canBottom = canY + 26;
  const canGwX = cX0 + gwIdx * cStep;
  const tails = [];      // local LIN / second-bus tails drawn after blocks are known
  canRow.forEach((id, i) => {
    const x = cX0 + i * cStep;
    if (id === GW) { gwp.can = { tap: [x, canY] }; taps.can.push(x); return; }
    const side = sideOf(i);
    const h = hOf(id, cW);
    const y = side === 'top' ? canY - 26 - h : canY + 26;
    const bk = block(id, x - cW / 2, y, cW, { bus: 'can' });
    const ey = side === 'top' ? bk.bottom : bk.top, ty = canY + (side === 'top' ? -PAIR.can : PAIR.can);
    line([[x, ey], [x, ty]], 'can', id);
    dot(x, ty, 'can', id);
    setPin(id, 'can', [x, ey], [x, canY]);
    if (side === 'bot') canBottom = Math.max(canBottom, bk.bottom);
    tails.push({ id, bk, side, x });
  });

  /* LIN master → slaves (above the master block), local LIN tails, second-bus flags */
  let tailBottom = canBottom;
  tails.forEach(({ id, bk, side, x }) => {
    if (linMasters.has(id)) {
      const seg = linSegs.find(s => s.master === id);
      seg.slaves.forEach(sl => {
        const h = hOf(sl, cW);
        const sb = block(sl, x - cW / 2, bk.top - 34 - h, cW, { bus: 'lin', cls: 'slave', addr: 'LIN slave' });
        line([[x, bk.top], [x, sb.bottom]], 'lin', '', 'sc-linw');
        add(marks, `<g class="sx sc-ms" data-b="lin" data-m="" data-bus="lin"><circle cx="${r1(x)}" cy="${r1(bk.top - 7)}" r="5.5"/><text x="${r1(x)}" y="${r1(bk.top - 4.3)}" text-anchor="middle">M</text>
          <circle cx="${r1(x)}" cy="${r1(sb.bottom + 7)}" r="5.5"/><text x="${r1(x)}" y="${r1(sb.bottom + 9.7)}" text-anchor="middle">S</text>
          <text class="sc-busn" x="${r1(x + 11)}" y="${r1((bk.top + sb.bottom) / 2 - 1)}">LIN</text><text class="sc-busr" x="${r1(x + 11)}" y="${r1((bk.top + sb.bottom) / 2 + 10)}">${esc(fmtRate(BUS.lin.bitrate))}</text></g>`);
        setPin(id, 'lin', [x, bk.top]);
        setPin(sl, 'lin', [x, sb.bottom]);
      });
    }
    if (localLin.has(id)) {
      const y0 = side === 'top' ? bk.top : bk.bottom, y1 = side === 'top' ? y0 - 16 : y0 + 16;
      const tx = bk.left + 16;
      line([[tx, y0], [tx, y1]], 'lin', id);
      add(marks, `<g class="sx sc-local" data-b="lin" data-m="${esc(id)}" data-bus="lin"><line x1="${r1(tx - 4)}" x2="${r1(tx + 4)}" y1="${r1(y1)}" y2="${r1(y1)}"/>
        <text x="${r1(tx + 7)}" y="${r1(y1 + (side === 'top' ? 3 : 3))}">local LIN</text><title>Runs its own LIN sub-bus; the slaves on it are not listed in the data</title></g>`);
      if (side === 'bot') tailBottom = Math.max(tailBottom, y1 + 6);
    }
    const extra = busesOf(id).filter(b => b !== 'can');
    extra.forEach(b => {
      const y0 = side === 'top' ? bk.top : bk.bottom, dir = side === 'top' ? 'up' : 'down';
      const fx = bk.right - 26;
      const fy = side === 'top' ? y0 - 30 : y0 + 12;
      line([[fx, y0], [fx, side === 'top' ? fy + 16 : fy]], b, id);
      flag(fx, fy, dir, SHORT[b] + (dir === 'down' ? ' ▾' : ' ▴'), b, id);
      if (side === 'bot') tailBottom = Math.max(tailBottom, fy + 18);
    });
  });

  /* ================= middle band: FlexRay star · gateway · Ethernet switch ================= */
  const colW = 214, frX = 24, ethX = BX1 - 16 - colW, gapV = 7, diagGap = 20;
  const frIds = D.modules.filter(m => m.id !== GW && home(m.id) === 'flexray').map(m => m.id).sort(byX);
  const ethIds = D.modules.filter(m => m.id !== GW && m.id !== 'tester' && home(m.id) === 'eth').map(m => m.id).sort(byX);
  const stackH = ids => ids.reduce((s, id) => s + hOf(id, colW), 0) + Math.max(0, ids.length - 1) * gapV;
  const ethUp = ethIds.slice(0, Math.ceil(ethIds.length / 2)), ethLo = ethIds.slice(ethUp.length);
  const midTop = tailBottom + 44;
  const frH = stackH(frIds), CH = 180;
  const hubY = midTop + Math.max(frH / 2, stackH(ethUp) + diagGap, CH / 2 + 30);
  const midBottom = hubY + Math.max(frH / 2, stackH(ethLo) + diagGap, CH / 2 + 30);

  /* CAN FD placement is needed now: the gateway's bottom port sits on its slot */
  const fdIds = D.modules.filter(m => m.id !== GW && home(m.id) === 'canfd').map(m => m.id).sort(byX);
  const fdFlags = D.modules.filter(m => m.id !== GW && home(m.id) !== 'canfd' && busesOf(m.id).includes('canfd')).map(m => m.id);
  const fX0 = 150, fX1 = 1100, fStep = (fX1 - fX0) / Math.max(1, fdIds.length - 1), fW = Math.round(fStep - 10);
  const fdX = fdIds.map((_, i) => fX0 + i * fStep);
  const above = [GW, ...fdFlags].sort(byX);      // items that sit above the line, between blocks
  const aboveX = {};
  {
    const gapIdx = id => { let k = fdIds.findIndex(f => X(f) > X(id)); return k < 0 ? fdIds.length : k; };
    const groups = {};
    above.forEach(id => (groups[gapIdx(id)] = groups[gapIdx(id)] || []).push(id));
    Object.entries(groups).forEach(([k, ids]) => {
      k = +k;
      const a = k === 0 ? fX0 - fStep : fdX[k - 1], b = k === fdIds.length ? fX1 + fStep : fdX[k];
      ids.forEach((id, j) => { aboveX[id] = a + (j + 1) * (b - a) / (ids.length + 1); });
    });
  }
  const fdGwX = aboveX[GW];

  /* gateway chip */
  const CW = 320;
  const cx0 = Math.max(frX + colW + 150, Math.min(canGwX, fdGwX) - 52), cx1 = cx0 + CW;
  const cy0 = hubY - CH / 2, cy1 = hubY + CH / 2;
  const core = [cx0 + CW / 2 + 8, hubY];
  const coreW = 138, coreH = 62, coreL = core[0] - coreW / 2, coreR = core[0] + coreW / 2;
  const hubFR = [cx0, hubY], hubETH = [cx1, hubY];
  {
    const clampX = v => Math.max(coreL + 12, Math.min(coreR - 12, v));
    const viaTop = x => [[x, cy0 + 22], [clampX(x), cy0 + 22], [clampX(x), hubY - coreH / 2], core];
    const viaBot = x => [[x, cy1 - 22], [clampX(x), cy1 - 22], [clampX(x), hubY + coreH / 2], core];
    gwp.can.port = [canGwX, cy0]; gwp.can.via = viaTop(canGwX);
    gwp.canfd = { tap: [fdGwX, 0], port: [fdGwX, cy1], via: viaBot(fdGwX) };    // tap.y set with fdY
    gwp.flexray = { tap: hubFR, port: hubFR, via: [[coreL, hubY], core] };
    gwp.eth = { tap: hubETH, port: hubETH, via: [[coreR, hubY], core] };
    const internal = (pts, b) => add(marks, `<polyline class="sx sc-int" data-b="${b}" data-m="${GW}" data-bus="${b}" points="${pts.map(p => p.map(r1).join(',')).join(' ')}"/>`);
    add(under, `<g class="sx sc-chip" data-m="${GW}" data-b="" tabindex="0" role="button" aria-label="Central gateway ${GW}: every bus meets here. Show on the car.">
      <rect class="sc-chip-body" x="${cx0}" y="${r1(cy0)}" width="${CW}" height="${CH}" rx="10"/>
      <text class="sc-chip-k" x="${cx1 - 14}" y="${r1(cy0 + 17)}" text-anchor="end">${esc(gwM.name || '')}</text>
    </g>`);
    internal([[canGwX, cy0 + 4], ...gwp.can.via.slice(0, -1)], 'can');
    internal([[fdGwX, cy1 - 5], ...gwp.canfd.via.slice(0, -1)], 'canfd');
    internal([[cx0 + 11, hubY], [coreL, hubY]], 'flexray');
    internal([[cx1 - 8, hubY], [coreR, hubY]], 'eth');
    add(marks, `<g class="sx sc-core" data-m="${GW}" data-b="">
      <rect x="${r1(coreL)}" y="${r1(hubY - coreH / 2)}" width="${coreW}" height="${coreH}" rx="6"/>
      <text class="sc-core-t" x="${r1(core[0])}" y="${r1(hubY - 9)}" text-anchor="middle">CENTRAL GATEWAY</text>
      <text class="sc-core-a" x="${r1(core[0])}" y="${r1(hubY + 6)}" text-anchor="middle">${GW}</text>
      <text class="sc-core-s" x="${r1(core[0])}" y="${r1(hubY + 20)}" text-anchor="middle">store · check · forward</text></g>`);
    // pins on the chip edge, IC-style
    const pinMark = (x, y, b, lab, lx, ly, anchor) => add(marks, `<g class="sx sc-pin" data-b="${b}" data-m="${GW}" data-bus="${b}">
      <rect x="${r1(x - 6)}" y="${r1(y - 4)}" width="12" height="8" rx="1.5"/><text x="${r1(lx)}" y="${r1(ly)}" text-anchor="${anchor}">${lab}</text></g>`);
    pinMark(canGwX, cy0, 'can', 'CAN', canGwX + 10, cy0 + 16, 'start');
    pinMark(fdGwX, cy1, 'canfd', 'CAN FD', fdGwX + 10, cy1 - 10, 'start');
    // star coupler: a hub with spokes; switch: a box with port ticks
    add(marks, `<g class="sx sc-hub" data-b="flexray" data-m="${GW}" data-bus="flexray">
      <circle cx="${cx0}" cy="${r1(hubY)}" r="10"/>${[0, 45, 90, 135].map(a => { const c = Math.cos(a * Math.PI / 180) * 6, s = Math.sin(a * Math.PI / 180) * 6; return `<line x1="${r1(cx0 - c)}" y1="${r1(hubY - s)}" x2="${r1(cx0 + c)}" y2="${r1(hubY + s)}"/>`; }).join('')}
      <text x="${cx0 + 16}" y="${r1(hubY - 3)}">FlexRay</text><text x="${cx0 + 16}" y="${r1(hubY + 9)}">star coupler</text></g>
      <g class="sx sc-hub" data-b="eth" data-m="${GW}" data-bus="eth">
      <rect x="${cx1 - 8}" y="${r1(hubY - 14)}" width="16" height="28" rx="2"/>${[-8, -2.7, 2.7, 8].map(d => `<line x1="${cx1 - 4}" x2="${cx1 + 4}" y1="${r1(hubY + d)}" y2="${r1(hubY + d)}"/>`).join('')}
      <text x="${cx1 - 16}" y="${r1(hubY - 3)}" text-anchor="end">Ethernet</text><text x="${cx1 - 16}" y="${r1(hubY + 9)}" text-anchor="end">switch</text></g>`);
    // gateway taps onto the two lines
    line([[canGwX, canY + PAIR.can], [canGwX, cy0 - 4]], 'can', GW);
    dot(canGwX, canY + PAIR.can, 'can', GW);
    placed[GW] = 1;
  }

  /* star columns */
  function starColumn(ids, x, yStart, hub, b, side) {
    let y = yStart;
    ids.forEach(id => {
      const bk = block(id, x, y, colW, { bus: b });
      const ex = side === 'left' ? bk.right : bk.left, kx = ex + (side === 'left' ? 16 : -16);
      line([[ex, bk.cy], [kx, bk.cy], hub], b, id, 'sc-spoke');
      dot(kx, bk.cy, b, id);
      setPin(id, b, [ex, bk.cy], [kx, bk.cy]);
      y = bk.bottom + gapV;
    });
    return y - gapV;
  }
  const frTop = hubY - frH / 2;
  starColumn(frIds, frX, frTop, hubFR, 'flexray', 'left');
  busLabel(frX, frTop - 22, 'flexray', 'start', 'active star');
  const ethTop = hubY - diagGap - stackH(ethUp);
  starColumn(ethUp, ethX, ethTop, hubETH, 'eth', 'right');
  starColumn(ethLo, ethX, hubY + diagGap, hubETH, 'eth', 'right');
  busLabel(ethX + colW, ethTop - 22, 'eth', 'end', 'switched');

  /* diagnostics: switch port → OBD socket on the boundary → tester outside */
  {
    const tW = 84, tH = hOf('tester', tW);
    const tb = block('tester', BX1 + 12, hubY - tH / 2, tW, { bus: 'eth', addr: 'off-board', cls: 'tester' });
    line([hubETH, [BX1 - 7, hubY]], 'eth', 'tester', 'sc-diag');
    line([[BX1 + 7, hubY], [tb.left, hubY]], 'eth', 'tester', 'sc-diag sc-off');
    add(marks, `<g class="sx sc-obd" data-b="eth" data-m="tester" data-bus="eth"><path d="M${BX1 - 7},${r1(hubY - 11)} h14 l-3,22 h-8 Z"/>
      <text x="${BX1}" y="${r1(hubY + 24)}" text-anchor="middle">OBD</text>
      <text class="sc-diag-t" x="${ethX + 4}" y="${r1(hubY - 6)}">${esc((D.topology.diag && D.topology.diag.link) || 'DoIP')}</text></g>`);
    setPin('tester', 'eth', [tb.left, hubY], [BX1, hubY]);
    add(marks, `<text class="sc-zone" x="${BX1 + 12 + tW / 2}" y="30" text-anchor="middle">OFF-BOARD</text>`);
  }

  /* ================= CAN FD: blocks below, gateway + flags above ================= */
  const fdY = midBottom + 58;
  gwp.canfd.tap = [fdGwX, fdY];
  pairLine(40, 1150, fdY, 'canfd');
  busLabel(56, fdY - 9, 'canfd');
  let fdBottom = fdY;
  fdIds.forEach((id, i) => {
    const x = fdX[i];
    const bk = block(id, x - fW / 2, fdY + 26, fW, { bus: 'canfd' });
    line([[x, fdY + PAIR.canfd], [x, bk.top]], 'canfd', id);
    dot(x, fdY + PAIR.canfd, 'canfd', id);
    setPin(id, 'canfd', [x, bk.top], [x, fdY]);
    fdBottom = Math.max(fdBottom, bk.bottom);
  });
  line([[fdGwX, cy1 + 4], [fdGwX, fdY - PAIR.canfd]], 'canfd', GW);
  dot(fdGwX, fdY - PAIR.canfd, 'canfd', GW);
  fdFlags.forEach(id => {
    const x = aboveX[id], fy = fdY - 40;
    flag(x, fy, 'up', (MOD[id].addr || id) + ' ▴', 'canfd', id);
    line([[x, fy + 16], [x, fdY - PAIR.canfd]], 'canfd', id);
    dot(x, fdY - PAIR.canfd, 'canfd', id);
    setPin(id, 'canfd', [x, fy + 16], [x, fdY]);
  });

  const H = Math.ceil(fdBottom + 34);
  const boundary = `<rect class="sc-veh" x="8" y="8" width="${BX1 - 8}" height="${H - 16}" rx="18"/>
    <text class="sc-zone" x="24" y="${H - 18}">VEHICLE</text>`;

  /* check: every networked module drawn exactly once */
  const expect = D.modules.filter(m => m.id === 'tester' || (m.bus && m.bus.length)).map(m => m.id);
  const bad = expect.filter(id => placed[id] !== 1);
  if (bad.length) console.error('schematic: not drawn exactly once:', bad.map(id => `${id}×${placed[id] || 0}`).join(', '));

  const host = $('#schem');
  host.innerHTML = `
    <div class="sc-bar" id="sc-bar">
      <span class="sc-bar-k">Trace</span>
      <div class="sc-scen" role="group" aria-label="Trace a scenario on the schematic">
        ${D.scenarios.map(s => `<button type="button" data-scen="${esc(s.id)}" aria-pressed="false">${esc(s.title)}</button>`).join('')}
      </div>
      <button type="button" class="sc-stop" id="sc-stop" hidden>Stop</button>
    </div>
    <div class="sc-canvas">
      <svg viewBox="0 0 ${W} ${H}" class="sc-svg" id="sc-svg" role="group"
        aria-label="System schematic: ${expect.length - 1} modules on five buses. CAN and CAN FD are terminated lines, FlexRay and Ethernet are stars at the gateway ${GW}, LIN hangs off its master, and the tester reaches the car only through the OBD socket.">
        ${boundary}
        <g class="sc-l-u">${under.join('')}</g>
        <g class="sc-l-w">${wires.join('')}</g>
        <g class="sc-l-m">${marks.join('')}</g>
        <g class="sc-l-b">${blocks.join('')}</g>
        <g class="sc-l-p" id="sc-pk"></g>
      </svg>
    </div>
    <p class="sc-read" id="sc-read" aria-live="polite"></p>
    ${mobileHTML()}`;
  const S = $('#sc-svg', host), read = $('#sc-read', host);
  const els = $$('.sx', S);
  const HINT = 'Hover a module or a wire to see where it connects. Select a module to find it on the car.';
  read.innerHTML = HINT;

  /* ---------------- highlight ---------------- */
  function focus(ids, buses) {
    if (!ids) { S.classList.remove('focus'); els.forEach(e => e.classList.remove('on')); return; }
    S.classList.add('focus');
    els.forEach(e => {
      const m = e.dataset.m, b = e.dataset.b;
      const on = m ? ids.has(m) && (!b || buses.has(b)) : (b ? buses.has(b) : false);
      e.classList.toggle('on', on);
    });
  }
  function modSets(id) {
    const buses = new Set(busesOf(id));
    if (linMasters.has(id) || linMasterOf[id] || localLin.has(id)) buses.add('lin');
    const ids = new Set([id]);
    if (linMasterOf[id]) { ids.add(linMasterOf[id]); busesOf(linMasterOf[id]).forEach(b => buses.add(b)); }
    if (linMasters.has(id)) linSegs.filter(s => s.master === id).forEach(s => s.slaves.forEach(x => ids.add(x)));
    if (id !== GW && busesOf(linMasterOf[id] || id).length) ids.add(GW);
    if (id === GW) PRIMARY.forEach(b => buses.add(b));
    return { ids, buses };
  }
  function busSets(b) {
    const ids = new Set([GW]);
    const buses = new Set([b]);
    if (b === 'lin') { ids.delete(GW); linSegs.forEach(s => { ids.add(s.master); s.slaves.forEach(x => ids.add(x)); }); localLin.forEach(x => ids.add(x)); }
    else D.modules.forEach(m => { if (busesOf(m.id).includes(b)) ids.add(m.id); });
    if (b === 'eth') ids.add('tester');
    return { ids, buses };
  }
  const chips = id => [...modSets(id).buses].filter(b => b !== 'lin' || id !== GW).map(b => `<span class="bus-tag" data-bus="${b}"><i></i>${esc(SHORT[b])}</span>`).join('');
  function showMod(id) {
    const m = MOD[id], s = modSets(id);
    focus(s.ids, s.buses);
    const route = id === GW ? 'every bus meets here' : id === 'tester' ? 'outside the car, reaching it only through the OBD socket and the gateway'
      : linMasterOf[id] ? `LIN slave of ${linMasterOf[id]}; reaches the rest of the car through its master`
      : busesOf(id).length > 1 ? 'on two buses: drawn once, the second connection is a flag' : `talks to other buses only through the gateway ${GW}`;
    read.innerHTML = `<b class="mono">${esc(m.addr || m.id)}</b> <strong>${esc(m.label)}</strong> ${chips(id)} <span class="sc-read-r">${esc(route)}</span>`;
  }
  function showBusInfo(b) {
    const B = BUS[b], s = busSets(b);
    focus(s.ids, s.buses);
    read.innerHTML = `<span class="bus-tag" data-bus="${b}"><i></i>${esc(B.label)}</span> <strong>${esc(fmtRate(B.bitrate))}</strong> · ${esc(B.topology)} · ${s.ids.size - (b === 'lin' ? 0 : 1)} nodes <span class="sc-read-r">${esc(B.why || '')}</span>`;
  }
  let tracing = false;
  const clear = () => { if (tracing) return; focus(null); read.innerHTML = HINT; };
  const hover = t => {
    if (tracing) return;
    const g = t.closest && t.closest('[data-m]');
    if (g && g.dataset.m) return showMod(g.dataset.m);
    const tr = t.closest && t.closest('.sc-trunk, .sc-busl, .sc-term, .sc-hub, .sc-pin, .sc-spoke, .sc-linw, .sc-ms');
    if (tr && tr.dataset.b) return showBusInfo(tr.dataset.b);
    clear();
  };
  S.addEventListener('pointerover', e => hover(e.target));
  S.addEventListener('pointerleave', clear);
  S.addEventListener('focusin', e => hover(e.target));
  S.addEventListener('focusout', clear);
  const pick = t => { const g = t.closest('[data-m][role=button]'); if (g && g.dataset.m && g.dataset.m !== 'tester') hooks.showModule(g.dataset.m); };
  S.addEventListener('click', e => pick(e.target));
  S.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target); } });
  $('.sc-mob', host).addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b && b.dataset.id !== 'tester') hooks.showModule(b.dataset.id); });

  /* ---------------- tracer: packets along the drawn wires ---------------- */
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speed = b => 140 + 95 * Math.log10(BUS[b].bitrate / 2e4);          // px/s: faster wire, faster packet
  const dedupe = pts => pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  const P = (id, b) => pin[id] && pin[id][b];
  function toGw(id, b) {
    const p = P(id, b), g = gwp[b];
    return dedupe([p.edge, p.tap, g.tap, g.port, ...g.via]);
  }
  function legs(a, z) {
    if (a === z) return null;
    const flow = D.flows.find(f => f.from === a && f.to === z);
    if (flow && flow.kind === 'power') return null;                     // HV power is not on this diagram
    if ((linMasterOf[z] === a && P(a, 'lin') && P(z, 'lin')) || (linMasterOf[a] === z && P(a, 'lin') && P(z, 'lin')))
      return [{ b: 'lin', pts: [P(a, 'lin').edge, P(z, 'lin').edge] }];
    if (a === GW) { const b = busesOf(z)[0]; if (!b || !P(z, b)) return null; return [{ b, pts: toGw(z, b).reverse() }]; }
    if (z === GW) { const b = busesOf(a)[0]; if (!b || !P(a, b)) return null; return [{ b, pts: toGw(a, b) }]; }
    const common = busesOf(a).filter(b => busesOf(z).includes(b) && P(a, b) && P(z, b));
    if (common.length) {
      const b = common[0], A = P(a, b), Z = P(z, b);
      const mid = LINEBUS.has(b) ? [] : [gwp[b].tap];
      return [{ b, pts: dedupe([A.edge, A.tap, ...mid, Z.tap, Z.edge]) }];
    }
    const ba = busesOf(a).find(b => P(a, b)), bz = busesOf(z).find(b => P(z, b));
    if (!ba || !bz) return null;
    return [{ b: ba, pts: toGw(a, ba) }, { pause: 520 }, { b: bz, pts: toGw(z, bz).reverse() }];
  }
  const pk = $('#sc-pk', S), coreEl = $('.sc-core', S);
  let raf = 0, timer = 0, run = 0;
  function animate(list, done) {
    // list: [{ legs }]: one packet each, run together
    const packets = list.map(L => {
      const segs = []; let t = 0;
      L.forEach(l => {
        if (l.pause) { segs.push({ t0: t, t1: t + l.pause, pause: true }); t += l.pause; return; }
        let len = 0; const cum = [0];
        for (let i = 1; i < l.pts.length; i++) { len += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]); cum.push(len); }
        const dur = Math.max(260, len / speed(l.b) * 1000);
        segs.push({ t0: t, t1: t + dur, b: l.b, pts: l.pts, cum, len }); t += dur;
      });
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      el.setAttribute('class', 'sc-pk');
      el.innerHTML = '<circle class="sc-pk-h" r="9"/><circle class="sc-pk-c" r="3.6"/>';
      pk.appendChild(el);
      if (reduce) L.forEach(l => { if (l.pts) pk.insertAdjacentHTML('beforeend', `<polyline class="sc-path" data-bus="${l.b}" points="${l.pts.map(p => p.map(r1).join(',')).join(' ')}"/>`); });
      return { segs, T: t, el };
    });
    const T = Math.max(0, ...packets.map(p => p.T));
    if (reduce) { packets.forEach(p => p.el.remove()); timer = setTimeout(done, 2600); return; }
    const t0 = performance.now();
    const tick = now => {
      const t = now - t0;
      let busy = false;
      packets.forEach(p => {
        const s = p.segs.find(s => t < s.t1) || p.segs[p.segs.length - 1];
        if (!s) return;
        if (s.pause) { busy = busy || t < s.t1; return; }
        const d = Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) * s.len;
        let i = 1; while (i < s.cum.length - 1 && s.cum[i] < d) i++;
        const a = s.pts[i - 1], b = s.pts[i], f = (d - s.cum[i - 1]) / ((s.cum[i] - s.cum[i - 1]) || 1);
        p.el.setAttribute('transform', `translate(${r1(a[0] + (b[0] - a[0]) * f)},${r1(a[1] + (b[1] - a[1]) * f)})`);
        p.el.setAttribute('data-bus', s.b);
        p.el.style.opacity = t > p.T + 250 ? 0 : 1;
      });
      coreEl.classList.toggle('busy', busy);
      if (t < T + 400) raf = requestAnimationFrame(tick); else done();
    };
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    run++; cancelAnimationFrame(raf); clearTimeout(timer);
    pk.innerHTML = ''; coreEl.classList.remove('busy');
    tracing = false; host.classList.remove('tracing');
    $$('[data-scen]', host).forEach(b => b.setAttribute('aria-pressed', 'false'));
    $('#sc-stop', host).hidden = true;
    focus(null); read.innerHTML = HINT;
  }
  function play(sid) {
    stop();
    const sc = D.scenarios.find(s => s.id === sid); if (!sc) return;
    const my = ++run;
    tracing = true; host.classList.add('tracing');
    $(`[data-scen="${sid}"]`, host).setAttribute('aria-pressed', 'true');
    $('#sc-stop', host).hidden = false;
    const step = k => {
      if (my !== run) return;
      if (k >= sc.steps.length) { timer = setTimeout(() => my === run && stop(), 1400); return; }
      const st = sc.steps[k];
      const pairs = st.flows || (st.path ? st.path.slice(1).map((z, i) => [st.path[i], z]) : []);
      const list = [], ids = new Set(), buses = new Set();
      let skipped = 0;
      (st.path ? [pairs] : pairs.map(p => [p])).forEach(chain => {
        const L = [];
        chain.forEach(([a, z]) => {
          const l = legs(a, z);
          if (!l) { skipped++; return; }
          if (L.length) L.push({ pause: 520 });
          L.push(...l); ids.add(a); ids.add(z);
          l.forEach(x => x.b && buses.add(x.b));
          if (l.some(x => x.pause) || a === GW || z === GW) ids.add(GW);
        });
        if (L.length) list.push(L);
      });
      focus(ids, buses);
      read.innerHTML = `<span class="sc-step">${k + 1}/${sc.steps.length}</span> <span>${st.caption}</span>${skipped && !list.length ? ' <span class="sc-read-r">High-voltage power is not a data message, so it is not on this diagram.</span>' : ''}`;
      if (!list.length) { timer = setTimeout(() => step(k + 1), 2600); return; }
      animate(list, () => { if (my !== run) return; pk.innerHTML = ''; timer = setTimeout(() => step(k + 1), 700); });
    };
    step(0);
  }
  $('.sc-scen', host).addEventListener('click', e => { const b = e.target.closest('[data-scen]'); if (!b) return; b.getAttribute('aria-pressed') === 'true' ? stop() : play(b.dataset.scen); });
  $('#sc-stop', host).addEventListener('click', stop);

  /* ---------------- symbol legend ---------------- */
  $('#schem-legend').innerHTML = [
    ['<circle cx="12" cy="8" r="3" fill="currentColor"/><line x1="2" x2="22" y1="8" y2="8"/>', 'connection'],
    ['<line x1="2" x2="10" y1="5" y2="5"/><line x1="2" x2="10" y1="11" y2="11"/><rect x="10" y="2" width="6" height="12" rx="1"/>', '120 Ω termination'],
    ['<circle cx="12" cy="8" r="6"/><line x1="8" x2="16" y1="8" y2="8"/><line x1="12" x2="12" y1="4" y2="12"/>', 'star coupler / switch'],
    ['<path d="M5 3h14v7l-7 4-7-4z"/>', 'off-sheet connector'],
    ['<circle cx="7" cy="8" r="5"/><text x="7" y="10.5" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">M</text><line x1="12" x2="22" y1="8" y2="8"/>', 'LIN master / slave'],
    ['<line x1="2" x2="22" y1="4" y2="4" stroke-width="1"/><line x1="2" x2="22" y1="11" y2="11" stroke-width="2.6"/>', 'wire weight = bit rate'],
  ].map(([g, t]) => `<span><svg viewBox="0 0 24 16" aria-hidden="true">${g}</svg>${esc(t)}</span>`).join('');

  /* ---------------- stacked version for narrow screens ---------------- */
  function mobileHTML() {
    const node = (id, extra = '') => { const m = MOD[id]; return `<li><button type="button" data-id="${esc(id)}"><b class="mono">${esc(m.addr || (id === 'tester' ? 'off-board' : 'LIN'))}</b><span>${esc(m.label)}</span>${extra}</button></li>`; };
    const panel = (b, kind, ids, note) => `<section class="scm-bus scm-${kind}" data-bus="${b}">
      <header><i></i><strong>${esc(BUS[b].label)}</strong><em>${esc(fmtRate(BUS[b].bitrate))}</em></header>
      <p>${note}</p><ul>${ids}</ul></section>`;
    const gwLi = `<li class="scm-gw"><span><b class="mono">${GW}</b><span>Central gateway</span></span></li>`;
    const also = (id, pb) => busesOf(id).length > 1 ? `<small>also ${busesOf(id).filter(b => b !== pb).map(b => SHORT[b]).join(', ')}</small>` : '';
    const fd = [...fdIds, ...fdFlags].sort(byX);
    return `<div class="sc-mob">
      <div class="scm-chip"><b class="mono">${GW}</b><strong>Central gateway</strong><span>Every bus ends here. It checks each message and forwards it. It is the only path between buses and from the OBD socket into the car.</span></div>
      ${panel('can', 'line', canRow.map(id => id === GW ? gwLi : node(id, also(id, 'can'))).join(''), 'A shared two-wire line, terminated with 120 Ω at both ends. Front to rear.')}
      ${panel('canfd', 'line', [...fd, GW].sort(byX).map(id => id === GW ? gwLi : node(id, also(id, 'canfd'))).join(''), 'The powertrain line: same wiring as CAN, faster data phase.')}
      ${panel('flexray', 'star', frIds.map(id => node(id)).join(''), 'An active star: each module has its own link to the star coupler in the gateway.')}
      ${panel('eth', 'star', ethIds.map(id => node(id)).join('') + node('tester', '<small>via OBD · DoIP</small>'), 'A switched star: every link is point-to-point to the switch in the gateway. The tester plugs in here.')}
      ${panel('lin', 'lin', linSegs.map(s => node(s.master, '<small>master</small>') + s.slaves.map(x => node(x, '<small>slave</small>')).join('')).join('') + [...localLin].map(id => node(id, '<small>own local LIN</small>')).join(''), 'A single wire from a master to its slaves. It never touches the gateway.')}
    </div>`;
  }
}
