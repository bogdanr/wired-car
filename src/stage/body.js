/* ============================================================
   The e-tron body, drawn
   ------------------------------------------------------------
   What makes it read as an Audi e-tron is not mesh detail but
   the character lines: the octagonal Singleframe with vertical
   struts, the wedge headlamps with their four-bar signature, the
   full-width rear light bar, the quattro blisters over the
   arches, the long DLO with a rear quarter light, the charge
   flaps on the front wings and big multi-spoke wheels. All of
   them are authored here in the view they are designed in.
   ============================================================ */
import * as THREE from 'three';
import { arc, rrect, close } from './geo.js';
import { LineSet, Contour, toneMaterial, studioMaterial, circle3, polysToSegments } from './lines.js';

const T = (p) => p; // readability marker for authored point lists

export function buildBody(G, clip) {
  const { D, L, W, f, axles, project } = G;
  const root = new THREE.Group();          // body shell (lifts in the exploded view)
  const wheelsRoot = new THREE.Group();    // wheels stay on the ground
  const parts = {};                        // movable / highlightable sub-assemblies
  const sets = [];                         // every LineSet, for theme + opacity updates
  const contours = [];                     // {contour, set, object} re-extracted per view

  const LW = { sil: 1.55, feat: 1.0, det: 0.7 };
  const mk = (o) => { const s = new LineSet({ hidden: true, clip, ...o }); sets.push(s); return s; };

  /* ---------- hull ---------- */
  const hullGeo = G.hull();
  const hullMat = toneMaterial({ clip, opacity: 0.05 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.renderOrder = 0;
  root.add(hull);
  // studio look: the same hull, shaded (hidden entirely while its alpha is 0)
  const studioMats = [];
  const paintMat = studioMaterial({ clip }); studioMats.push(paintMat);
  const paint = new THREE.Mesh(hullGeo, paintMat);
  paint.renderOrder = 0; paint.visible = false;
  root.add(paint);
  const hullC = mk({ width: LW.sil, role: 'ink' });
  root.add(hullC.group);
  contours.push({ contour: new Contour(hullGeo), set: hullC, object: hull });

  /* ---------- helpers ---------- */
  const polys = { body: [] };
  const add = (key, list) => { (polys[key] = polys[key] || []).push(...list); };
  const side = (key, pts, o) => add(key, project('side', pts, o));
  const sideL = (key, pts, o) => add(key, project('side', pts, { ...o, mirror: false }));
  const sideR = (key, pts, o) => add(key, project('side', pts, o).filter(p => p[0].z < 0));
  const front = (key, pts, mirror = true) => {
    add(key, project('front', pts));
    if (mirror) add(key, project('front', pts.map(([y, z]) => [-y, z])));
  };
  const rear = (key, pts, mirror = true) => {
    add(key, project('rear', pts));
    if (mirror) add(key, project('rear', pts.map(([y, z]) => [-y, z])));
  };
  const top = (key, pts) => add(key, project('top', pts));

  /* ===================== SIDE (authored as seen from the left) ===================== */
  const [FA, RA] = axles, R = D.archRadius, WR = D.tyreRadius;
  // wheel-arch trim and the quattro blister above each arch
  axles.forEach(cx => {
    side('body', arc(cx, WR, R + 44, 180, 0, 40).reverse());
    side('body', arc(cx, WR, R + 118, 158, 22, 40));
  });
  // shoulder line, running from headlamp to rear lamp, interrupted by the blisters
  side('body', T([[430, 868], [700, 880], [FA - 330, 884]]));
  side('body', T([[FA + 330, 886], [2000, 894], [RA - 340, 904]]));
  side('body', T([[RA + 340, 912], [4500, 916], [4640, 1060]]));
  // sill + the e-tron lower blade
  side('body', T([[FA + R + 44, 318], [RA - R - 44, 318]]));
  side('body', T([[FA + R + 60, 380], [2400, 372], [RA - R - 60, 392]]));
  // front bumper → wing seam, rear bumper seam
  side('body', T([[180, 330], [300, 520], [420, 700], [440, 820]]));
  side('body', T([[4700, 330], [4620, 560], [4610, 820]]));
  // headlamp and rear-lamp wraps (highlightable)
  side('lamp-l', close([[70, 800], [420, 858], [446, 820], [110, 764]]), { mirror: false });
  sideR('lamp-r', close([[70, 800], [420, 858], [446, 820], [110, 764]]));
  side('rear-bar', close([[4600, 1146], [4870, 1082], [4892, 1034], [4640, 1096]]));
  // rear quarter light and D-pillar
  side('body', close([[4000, 1522], [4196, 1476], [4338, 1196], [4000, 1160]]));
  side('body', T([[1630, 1086], [2400, 1586], [3720, 1590], [4040, 1552], [4240, 1490], [4392, 1188]]));
  // roof edge is a contour; the windscreen/roof seam is drawn from the top below

  // --- doors (each its own sub-assembly: outline, glass, handle) ---
  const DF = [1650, 2900], DR = [2906, 3990];
  const doorFront = close([[DF[0] + 6, 322], [DF[0] - 8, 700], [DF[0] - 14, 1082], [2390, 1580], [DF[1] - 6, 1584], [DF[1], 322]]);
  const winFront = close([[1706, 1098], [2384, 1548], [2858, 1562], [2858, 1114]]);
  const handleF = rrect(2450, 996, 2632, 1026, 13);
  const rearArc = arc(RA, WR, R + 44, 104, 180, 20);          // the rear door wraps the arch
  const doorRear = close([[DR[0], 322], [DR[0], 1584], [3714, 1580], [3930, 1548], [DR[1] - 10, 1150], [DR[1] - 30, 905], ...rearArc.slice(0), [RA - R - 44, 322]]);
  const winRear = close([[2944, 1114], [2944, 1560], [3712, 1556], [3900, 1528], [3950, 1154]]);
  const handleR = rrect(3570, 1030, 3750, 1060, 13);
  const bPillar = [[[2862, 1112], [2848, 1566]], [[2940, 1112], [2928, 1566]]];
  ['l', 'r'].forEach(s => {
    const put = s === 'l' ? sideL : sideR;
    put('door-f' + s, doorFront); put('door-f' + s, winFront); put('door-f' + s, handleF);
    put('door-r' + s, doorRear); put('door-r' + s, winRear); put('door-r' + s, handleR);
    bPillar.forEach(p => put('body', p));
    put('charge-' + s, rrect(1300, 868, 1560, 958, 22));
  });
  // lower-door character line (on the doors)
  sideL('door-fl', T([[DF[0] + 10, 560], [DF[1] - 6, 574]])); sideR('door-fr', T([[DF[0] + 10, 560], [DF[1] - 6, 574]]));
  sideL('door-rl', T([[DR[0] + 6, 575], [3440, 590]])); sideR('door-rr', T([[DR[0] + 6, 575], [3440, 590]]));

  /* ===================== FRONT ===================== */
  // Singleframe: wide, low octagon — chamfered upper corners, widest at ~735 mm,
  // gently tapering to the base (measured off a scaled front elevation)
  const OT = 842, OW = 735, OB = 470, TH = 410, WH = 560, BH = 470;
  const oct = close([[-TH, OT], [TH, OT], [WH, OW], [WH - 6, 560], [BH, OB], [-BH, OB], [-(WH - 6), 560], [-WH, OW]]);
  front('body', oct, false);
  const inset = 22;
  const oin = close([[-(TH - 8), OT - inset], [TH - 8, OT - inset], [WH - inset, OW - 6], [WH - 6 - inset, 566], [BH - 14, OB + inset], [-(BH - 14), OB + inset], [-(WH - 6 - inset), 566], [-(WH - inset), OW - 6]]);
  front('body', oin, false);
  // vertical struts, clipped to the inner octagon
  // half-width of the inner octagon at height z (right-hand vertices, bottom → top)
  const oz = [[OB + inset, BH - 14], [566, WH - 6 - inset], [OW - 6, WH - inset], [OT - inset, TH - 8]];
  const hwAt = z => {
    for (let i = 1; i < oz.length; i++) if (z <= oz[i][0]) {
      const [z0, w0] = oz[i - 1], [z1, w1] = oz[i];
      return w0 + (w1 - w0) * (z - z0) / (z1 - z0);
    }
    return oz[oz.length - 1][1];
  };
  for (let y = -500; y <= 500; y += 62) {
    let zt = OT - inset - 6, zb = OB + inset + 6;
    while (zt > zb && Math.abs(y) > hwAt(zt) - 4) zt -= 6;
    while (zb < zt && Math.abs(y) > hwAt(zb) - 4) zb += 6;
    if (zt - zb > 40) front('body', [[y, zb], [y, zt]], false);
  }
  // four rings sit high on the grille, number plate below them
  [-96, -32, 32, 96].forEach(cy => front('body', arc(cy, 752, 40, 0, 360, 28), false));
  front('body', rrect(-262, 520, 262, 632, 8), false);        // number plate
  // wedge headlamps with the four-segment daytime signature
  const lampF = close([[590, 822], [880, 862], [918, 800], [895, 760], [620, 742]]);
  add('lamp-l', project('front', lampF)); add('lamp-r', project('front', lampF.map(([y, z]) => [-y, z])));
  for (let i = 0; i < 4; i++) {
    const seg = [[650 + i * 62, 792 + i * 6], [696 + i * 62, 797 + i * 6]];
    add('lamp-l', project('front', seg)); add('lamp-r', project('front', seg.map(([y, z]) => [-y, z])));
  }
  // side air curtains with their vertical blades
  front('body', close([[640, 640], [720, 664], [846, 520], [856, 380], [782, 368], [700, 470]]));
  front('body', [[740, 600], [800, 404]]); front('body', [[700, 548], [740, 400]]);
  front('body', [[-720, 300], [720, 300]], false);            // lower lip
  front('body', [[-560, 334], [560, 334]], false);

  /* ===================== REAR ===================== */
  const tg = close([[-640, 1512], [640, 1512], [672, 1150], [640, 1010], [620, 790], [-620, 790], [-640, 1010], [-672, 1150]]);
  rear('tailgate', tg, false);
  rear('tailgate', close([[-575, 1488], [575, 1488], [625, 1184], [-625, 1184]]), false);  // rear glass
  rear('tailgate', [[-630, 1520], [630, 1520]], false);        // roof spoiler lip
  rear('tailgate', rrect(-270, 850, 270, 970, 10), false);     // plate recess
  [-66, -22, 22, 66].forEach(cy => rear('tailgate', arc(cy, 1030, 26, 0, 360, 24), false));
  // the full-width light bar: the e-tron's rear signature
  rear('rear-bar', close([[-560, 1080], [560, 1080], [560, 1104], [-560, 1104]]), false);
  rear('rear-bar', close([[560, 1124], [900, 1102], [915, 1044], [600, 1066]]));
  rear('body', [[-900, 770], [900, 770]], false);              // bumper shoulder
  rear('body', [[-650, 420], [650, 420]], false);              // diffuser
  rear('body', rrect(760, 540, 862, 566, 8)); rear('body', rrect(-862, 540, -760, 566, 8));

  /* ===================== TOP ===================== */
  const hood = [];
  for (let x = 150; x <= 1470; x += 60) hood.push([x, f.rw(x) - 55]);
  for (let x = 1470; x >= 150; x -= 60) hood.push([x, -(f.rw(x) - 55)]);
  top('body', close(hood));
  top('body', [[420, 300], [900, 318], [1360, 330]]); top('body', [[420, -300], [900, -318], [1360, -330]]);
  top('body', [[1530, -(f.rw(1530) - 60)], [1530, f.rw(1530) - 60]]);            // scuttle
  top('body', [[2430, -(f.rw(2430) - 70)], [2430, f.rw(2430) - 70]]);            // screen header
  top('body', rrect(2560, -500, 3720, 500, 70));                                  // panoramic roof
  top('tailgate', [[4238, -(f.rw(4238) - 60)], [4238, f.rw(4238) - 60]]);

  /* ---------- roof rails, mirrors (true 3D, not projected) ---------- */
  const rail = [];
  ['l', 'r'].forEach(s => {
    const sg = s === 'l' ? 1 : -1, pts = [];
    // rails sit on the roof surface where it is, not on the centreline height
    const ry = x => f.rw(x) - 90, rz = x => (G.topZ(x, ry(x)) ?? f.zt(x));
    for (let x = 2560; x <= 4060; x += 60) pts.push(W(x, sg * ry(x), rz(x) + 38 - Math.max(0, (x - 3800) * 0.05)));
    rail.push(pts, [W(2560, sg * ry(2560), rz(2560) + 38), W(2560, sg * ry(2560), rz(2560) + 2)],
      [W(4060, sg * ry(4060), rz(4060) + 25), W(4060, sg * ry(4060), rz(4060) + 2)]);
    // door mirror: a housing loop on a stalk, on the front door
    // housing = outer loop at the mirror tip + inner loop at the glass, joined like a shell; a stalk to the door
    const base = f.hw(1800) - 60;
    const outer = rrect(1790, 1092, 1960, 1190, 38).map(([x, z]) => W(x, sg * 1090, z));
    const inner = rrect(1830, 1100, 1960, 1176, 30).map(([x, z]) => W(x, sg * (base + 70), z));
    const ties = [[1800, 1110], [1955, 1110], [1955, 1180], [1810, 1180]].map(([x, z]) => [W(x, sg * 1090, z), W(Math.max(x, 1832), sg * (base + 70), z)]);
    add('door-f' + s, [outer, inner, ...ties, [W(1870, sg * (base + 70), 1100), W(1880, sg * base, 1070)], [W(1930, sg * (base + 70), 1100), W(1930, sg * base, 1074)]]);
  });
  add('body', rail);

  /* ---------- assemble the line sets ---------- */
  const hinge = {
    'door-fl': { p: W(DF[0] - 14, f.hw(DF[0]), 800), axis: 'y', dir: -1, max: 62 },
    'door-fr': { p: W(DF[0] - 14, -f.hw(DF[0]), 800), axis: 'y', dir: 1, max: 62 },
    'door-rl': { p: W(DR[0], f.hw(DR[0]), 800), axis: 'y', dir: -1, max: 66 },
    'door-rr': { p: W(DR[0], -f.hw(DR[0]), 800), axis: 'y', dir: 1, max: 66 },
    'tailgate': { p: W(4250, 0, 1540), axis: 'z', dir: 1, max: 78 },
    'charge-l': { p: W(1430, f.hw(1430), 910), axis: 'slide', dir: 1, max: 1 },
    'charge-r': { p: W(1430, -f.hw(1430), 910), axis: 'slide', dir: 1, max: 1 }
  };
  Object.keys(polys).forEach(key => {
    const isLamp = key.startsWith('lamp') || key === 'rear-bar';
    const set = mk({ width: key === 'body' ? LW.feat : isLamp ? LW.feat * 1.15 : LW.feat, role: 'ink' });
    const h = hinge[key];
    const pivot = new THREE.Group();
    if (h) {
      pivot.position.copy(h.p);
      polys[key].forEach(p => p.forEach(v => v.sub(h.p)));
    }
    set.set(polysToSegments(polys[key]));
    pivot.add(set.group);
    root.add(pivot);
    parts[key] = { pivot, set, hinge: h, open: 0, target: 0, glow: 0, glowTarget: 0, lamp: isLamp };
  });
  // the tailgate carries the centre of the light bar with it
  // (kept as one set for highlighting; the bar outboard of the tailgate stays on the body)

  /* ---------- wheels: tyres (contoured), rims, spokes, discs ---------- */
  const tyreProfile = [[270, -118], [330, -130], [368, -132], [382, -122], [386, -100], [386, 100], [382, 122], [368, 132], [330, 130], [270, 118]]
    .map(([r, w]) => new THREE.Vector2(r / 1000, w / 1000));
  const tyreGeo = new THREE.LatheGeometry(tyreProfile, 72);
  tyreGeo.rotateX(Math.PI / 2);
  tyreGeo.computeVertexNormals();
  // five-arm rim face: a disc with five windows cut between the arms (ShapeGeometry, ~300 tris)
  const rimShape = new THREE.Shape(); rimShape.absarc(0, 0, 0.262, 0, Math.PI * 2, false);
  for (let k = 0; k < 5; k++) {
    const a0 = (k * 72 + 90 + 13) * Math.PI / 180, a1 = a0 + 46 * Math.PI / 180;
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.236, a0, a1, false); hole.absarc(0, 0, 0.100, a1 - 0.18, a0 + 0.18, true);
    rimShape.holes.push(hole);
  }
  const rimGeo = new THREE.ShapeGeometry(rimShape, 12);
  rimGeo.computeVertexNormals();
  const wheels = [];
  [[FA, D.trackFront], [RA, D.trackRear]].forEach(([cx, track]) => {
    [1, -1].forEach(sg => {
      const c = W(cx, sg * track / 2, WR);
      const g = new THREE.Group(); g.position.copy(c);
      const tyre = new THREE.Mesh(tyreGeo, toneMaterial({ clip, opacity: 0.07 }));
      tyre.renderOrder = 1; // after the hull has written depth, so the far tyre is hidden by the body
      g.add(tyre);
      const tm = studioMaterial({ clip, kind: 3 }); studioMats.push(tm);
      const rubber = new THREE.Mesh(tyreGeo, tm); rubber.visible = false; rubber.renderOrder = 1;
      g.add(rubber);
      // alloy face: a shallow dish under the spoke lines (studio look only)
      const am = studioMaterial({ clip, kind: 4 }); studioMats.push(am);
      const dish = new THREE.Mesh(rimGeo, am); dish.visible = false; dish.renderOrder = 1;
      dish.position.z = sg * 0.098; if (sg < 0) dish.rotation.y = Math.PI;
      g.add(dish);
      const tc = mk({ width: LW.sil * 0.9, role: 'ink' });
      g.add(tc.group);
      contours.push({ contour: new Contour(tyreGeo), set: tc, object: tyre });
      // spinning part: rim, spokes, hub (local frame, axis = Z)
      const spin = new THREE.Group();
      const o = sg * 0.100, ls = [];
      const ring = (r, z, n = 64) => circle3(new THREE.Vector3(0, 0, z), r, 'z', n);
      ls.push(ring(0.267, o), ring(0.252, o), ring(0.076, o + sg * 0.012), ring(0.034, o + sg * 0.016));
      for (let k = 0; k < 5; k++) {
        const a = (k * 72 + 90) * Math.PI / 180;
        const P = (r, da) => new THREE.Vector3(Math.cos(a + da) * r, Math.sin(a + da) * r, o + sg * 0.01 * (1 - r / 0.26));
        ls.push([P(0.078, 0.20), P(0.252, 0.075)], [P(0.078, -0.20), P(0.252, -0.075)], [P(0.10, 0), P(0.236, 0)]);
        const b = a + Math.PI / 5;
        ls.push([new THREE.Vector3(Math.cos(b) * 0.055, Math.sin(b) * 0.055, o + sg * 0.014), new THREE.Vector3(Math.cos(b) * 0.055 + 0.006, Math.sin(b) * 0.055, o + sg * 0.014)]);
      }
      const rs = mk({ width: LW.det + 0.1, role: 'ink' });
      rs.set(polysToSegments(ls));
      spin.add(rs.group);
      g.add(spin);
      // brake disc + caliper (do not spin)
      const bs = mk({ width: LW.det, role: 'ink2' });
      const cal = [...arc(0, 0, 0.212, 28, 76, 10), ...arc(0, 0, 0.158, 76, 28, 10)].map(([x, y]) => new THREE.Vector3(x, y, sg * 0.03));
      bs.set(polysToSegments([ring(0.192, sg * 0.03), ring(0.12, sg * 0.03), close(cal)]));
      g.add(bs.group);
      wheelsRoot.add(g);
      wheels.push({ group: g, spin, sign: sg });
    });
  });

  /* ---------- ground shadow ---------- */
  const shCanvas = document.createElement('canvas'); shCanvas.width = shCanvas.height = 128;
  const cx2 = shCanvas.getContext('2d'), gr = cx2.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  cx2.fillStyle = gr; cx2.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L / 1000 * 1.18, D.width / 1000 * 1.45),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCanvas), transparent: true, depthWrite: false, opacity: 0.85 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.001; shadow.renderOrder = -1;

  const studio = { mats: studioMats, meshes: [] };
  root.traverse(o => { if (o.isMesh && studioMats.includes(o.material)) studio.meshes.push(o); });
  wheelsRoot.traverse(o => { if (o.isMesh && studioMats.includes(o.material)) studio.meshes.push(o); });
  return { root, wheelsRoot, parts, sets, contours, hull, hullMat, wheels, shadow, studio };
}
