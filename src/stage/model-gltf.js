/* ============================================================
   Licensed body model (build input: assets/model/etron.glb)
   ------------------------------------------------------------
   build.py inlines the .glb as base64 in <script id="model">
   and aliases this module in place of model-none.js.

   · fit: rotated so the car faces −X like the drawing, scaled
     per axis from the source car's published dimensions to the
     55 quattro's (vehicle.json → model), ground at y = 0.
   · look: real PBR — metallic paint with clear coat, dark glass,
     gloss-black trim, machined alloys — lit by a procedural
     softbox studio baked once into a PMREM (no texture files,
     no per-frame cost).
   · shadow: a contact shadow rendered once from under the car,
     blurred, and laid on the floor plane.
   · lamps: DRL and rear light bar are emissive and follow the
     stage's lamp glow.
   Used for the painted (studio) look only. The drawing, X-ray,
   print and SVG export keep the procedural lines, whose
   positions come from the 55 quattro, never from this mesh.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const HAS_MODEL = true;

/* ---------- materials, keyed by the source material name ---------- */
const PAINT = { graphite: 0x2a3a55, vellum: 0x33445f };
const SPEC = {
  body:            { kind: 'paint' },
  glasss:          { color: 0x05070a, metalness: 0, roughness: 0.03, clearcoat: 1, opacity: 0.93, glass: true },
  refl_black:      { color: 0x040405, metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 },
  Rubber_Rough222: { color: 0x0b0b0c, metalness: 0, roughness: 0.82 },
  chrome:          { color: 0xc4c8ce, metalness: 1, roughness: 0.22 },          // machined alloy faces
  grey:            { color: 0x6b6e73, metalness: 1, roughness: 0.42 },          // discs / calipers
  mirror:          { color: 0xd8dde3, metalness: 1, roughness: 0.04 },
  wire_204204204:  { color: 0xe9eef4, metalness: 0, roughness: 0.25, emissive: 0xeaf2ff, lamp: 'front' },
  Red_Light:       { color: 0x4a0000, metalness: 0, roughness: 0.3, emissive: 0xff1a12, lamp: 'rear' },
  GlassRed:        { color: 0x3a0000, metalness: 0, roughness: 0.05, clearcoat: 1, opacity: 0.7, glass: true },
  '04___Default':  { color: 0x1c1d20, metalness: 0, roughness: 0.7 }
};

function physical(spec, clip) {
  const m = new THREE.MeshPhysicalMaterial({
    color: spec.color ?? 0x222222, metalness: spec.metalness ?? 0, roughness: spec.roughness ?? 0.5,
    clearcoat: spec.clearcoat ?? 0, clearcoatRoughness: spec.clearcoatRoughness ?? 0.05,
    emissive: spec.emissive ?? 0x000000, emissiveIntensity: 0,
    transparent: true, opacity: 0, depthWrite: !spec.glass,
    clippingPlanes: clip, side: THREE.DoubleSide   // the source is authored double-sided
  });
  // filmic roll-off on the PBR materials only: the ink lines keep their exact colours
  // (three only defines its tone-map functions when the renderer tone-maps, so the curve is inlined:
  //  Narkowicz's ACES fit)
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'vec3 acesFit(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }\nvoid main() {')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = acesFit(gl_FragColor.rgb * 1.15);');
  };
  m.userData = { role: 'studio', base: spec.opacity ?? 1, lamp: spec.lamp || null, spec };
  m.userData.setAlpha = a => { m.opacity = m.userData.base * a; m.visible = a > 0.01; };
  return m;
}

function paint(clip) {
  const m = physical({ color: PAINT.graphite, metalness: 0.7, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.02 }, clip);
  m.userData.paint = true;
  return m;
}

/* The source mixes inward- and outward-wound triangles (its materials are all
   double-sided), while its vertex normals consistently point out. Re-wind every
   triangle whose face normal disagrees with its vertex normals, once at load, so
   double-sided shading never flips the outer skin to face inward. */
function fixWinding(geo) {
  const idx = geo.index, P = geo.attributes.position, N = geo.attributes.normal;
  if (!idx || !N) return 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  const arr = idx.array; let flipped = 0;
  for (let i = 0; i < arr.length; i += 3) {
    const i0 = arr[i], i1 = arr[i + 1], i2 = arr[i + 2];
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    n.subVectors(b, a).cross(t.subVectors(c, a));
    const vn = N.getX(i0) + N.getX(i1) + N.getX(i2), vy = N.getY(i0) + N.getY(i1) + N.getY(i2), vz = N.getZ(i0) + N.getZ(i1) + N.getZ(i2);
    if (n.x * vn + n.y * vy + n.z * vz < 0) { arr[i + 1] = i2; arr[i + 2] = i1; flipped++; }
  }
  if (flipped) idx.needsUpdate = true;
  return flipped;
}

/* ---------- procedural photo studio → PMREM (once) ---------- */
function studioEnv(renderer, light) {
  const env = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40),
    new THREE.MeshBasicMaterial({ color: light ? 0x9a9fa6 : 0x1c1e22, side: THREE.BackSide }));
  box.position.y = 8; env.add(box);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: light ? 0xb9bcc0 : 0x0c0d0f }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; env.add(floor);
  const panel = (w, h, pos, rot, k, tint = 0xffffff) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(k), side: THREE.DoubleSide }));
    p.position.set(...pos); p.rotation.set(...rot); env.add(p);
  };
  // the big overhead softbox (the long bonnet/roof reflection) and a thin strip beside it
  panel(12, 5, [0, 9, 0], [Math.PI / 2, 0, 0], 6);
  panel(10, 0.35, [0, 8.6, 2.6], [Math.PI / 2, 0, 0], 7);
  // two tall side strips → the crisp shoulder line along the doors
  panel(14, 1.1, [0, 3.2, 9], [0, Math.PI, 0], 3.2);
  panel(14, 1.1, [0, 3.2, -9], [0, 0, 0], 3.2);
  // low side fills so the lower doors don't go black
  panel(16, 2.2, [0, 0.8, 10], [0, Math.PI, 0], 1.2);
  panel(16, 2.2, [0, 0.8, -10], [0, 0, 0], 1.2);
  // warm kicker from the front, cool one from behind
  panel(3, 5, [-12, 3, 3], [0, Math.PI / 2, 0], 1.6, 0xffd6b0);
  panel(3, 5, [12, 3, -3], [0, -Math.PI / 2, 0], 1.2, 0xbcd4ff);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035);
  pm.dispose();
  env.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}

/* ---------- contact shadow, rendered once from under the car ---------- */
function bakeShadow(renderer, root, pw, ph) {
  const RW = 512, RH = Math.round(512 * ph / pw);
  const opt = { type: THREE.HalfFloatType, depthBuffer: true };
  const a = new THREE.WebGLRenderTarget(RW, RH, opt), b = new THREE.WebGLRenderTarget(RW, RH, opt);
  const H = 0.9;   // only what is within 0.9 m of the ground casts
  const cam = new THREE.OrthographicCamera(-pw / 2, pw / 2, ph / 2, -ph / 2, 0, H);
  cam.position.set(0, 0, 0); cam.up.set(0, 0, 1); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
  const depth = new THREE.ShaderMaterial({
    vertexShader: 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying float vY; void main(){ float k = 1.0 - clamp(vY / ${H.toFixed(2)}, 0.0, 1.0); gl_FragColor = vec4(vec3(0.0), k * k * k); }`,
    side: THREE.DoubleSide
  });
  const blur = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
      void main(){ float s = 0.0; float w[5]; w[0]=0.227; w[1]=0.194; w[2]=0.122; w[3]=0.054; w[4]=0.016;
        s += texture2D(tMap, vUv).a * w[0];
        for (int i = 1; i < 5; i++) { s += texture2D(tMap, vUv + uDir * float(i)).a * w[i]; s += texture2D(tMap, vUv - uDir * float(i)).a * w[i]; }
        gl_FragColor = vec4(0.0, 0.0, 0.0, s); }`,
    depthTest: false, depthWrite: false
  });
  const quadScene = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blur);
  quad.frustumCulled = false; quadScene.add(quad);
  const scene = new THREE.Scene();
  const parent = root.parent; scene.add(root);
  const prev = { rt: renderer.getRenderTarget(), auto: renderer.autoClear, clip: renderer.localClippingEnabled, cc: renderer.getClearColor(new THREE.Color()), ca: renderer.getClearAlpha() };
  const vis = []; root.traverse(o => { if (o.isMesh) { vis.push([o, o.visible]); o.visible = true; } });
  scene.overrideMaterial = depth;
  renderer.localClippingEnabled = false; renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(a); renderer.render(scene, cam);
  // two separable passes each at a small and a large radius: a sharp contact core inside a soft penumbra
  for (const r of [1.2, 3.2]) {
    blur.uniforms.tMap.value = a.texture; blur.uniforms.uDir.value.set(r / RW, 0);
    renderer.setRenderTarget(b); renderer.render(quadScene, cam);
    blur.uniforms.tMap.value = b.texture; blur.uniforms.uDir.value.set(0, r / RH);
    renderer.setRenderTarget(a); renderer.render(quadScene, cam);
  }
  vis.forEach(([o, v]) => { o.visible = v; });
  scene.remove(root); if (parent) parent.add(root);
  renderer.setRenderTarget(prev.rt); renderer.autoClear = prev.auto; renderer.localClippingEnabled = prev.clip; renderer.setClearColor(prev.cc, prev.ca);
  b.dispose(); depth.dispose(); blur.dispose(); quad.geometry.dispose();
  return a;   // kept alive: its texture is the floor shadow
}

/* ---------- load + fit ---------- */
export async function loadModel({ renderer, vehicle, clip }) {
  // the model tag follows the app script in the document: wait until it has been parsed
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  const tag = document.getElementById('model');
  if (!renderer || !tag || !tag.textContent.trim()) return null;
  const bin = Uint8Array.from(atob(tag.textContent.trim()), c => c.charCodeAt(0));
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bin.buffer, '');
  const src = gltf.scene, dims = vehicle.dimensions, M = vehicle.model || {};

  // orient: the source faces +Z (vehicle.json → model.forward); the drawing's front is −X
  const inner = new THREE.Group(); inner.add(src);
  const fwd = M.forward || '+z';
  inner.rotation.y = { '+z': -Math.PI / 2, '-z': Math.PI / 2, '+x': Math.PI, '-x': 0 }[fwd];
  const root = new THREE.Group(); root.add(inner);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  // mm per source unit, from the source car's own published length; then per-axis to the 55 quattro
  const sd = M.sourceDims || { length: dims.length, width: dims.width, height: dims.height };
  const u = sd.length / size.x;
  root.scale.set(u * dims.length / sd.length / 1000, u * dims.height / sd.height / 1000, u * dims.width / sd.width / 1000);
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.set(-c.x, -box.min.y, -c.z);
  root.updateMatrixWorld(true);

  // direct light for the diffuse base (the PMREM gives reflections, not enough fill on dark paint);
  // lights are children of the model, so they only exist when it does
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(-3, 6, 4);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 0.9); rim.position.set(4, 3, -3);
  const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x1a1b1e, 0.35);
  root.add(key, key.target, rim, rim.target, hemi);

  const mats = [], meshes = [], byName = {};
  const mat = name => byName[name] || (byName[name] = SPEC[name]?.kind === 'paint' ? paint(clip) : physical(SPEC[name] || {}, clip));
  const named = name => { const m = mat(name); m.name = name || ''; return m; };
  src.traverse(o => {
    if (!o.isMesh) return;
    const m = named(o.material && o.material.name);
    o.material = m; o.visible = false; o.frustumCulled = false;
    o.renderOrder = m.userData.spec.glass ? 2 : 1;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    fixWinding(o.geometry);
    meshes.push(o);
  });
  Object.values(byName).forEach(m => mats.push(m));

  // environments for both themes, built once; swapped by setLight()
  const envs = { 0: studioEnv(renderer, false), 1: studioEnv(renderer, true) };
  const setLight = light => {
    mats.forEach(m => {
      m.envMap = envs[light ? 1 : 0];
      m.envMapIntensity = light ? 0.9 : 1.0;
      if (m.userData.paint) m.color.setHex(light ? PAINT.vellum : PAINT.graphite);
      m.needsUpdate = true;
    });
  };
  setLight(document.documentElement.dataset.theme === 'vellum');
  mats.forEach(m => { m.userData.setLight = setLight; });

  // lamp glow: 0..1 per group (front DRL, rear light bar)
  const setLamps = (front, rear) => {
    mats.forEach(m => {
      if (m.userData.lamp === 'front') m.emissiveIntensity = 0.25 + 2.2 * front;
      if (m.userData.lamp === 'rear') m.emissiveIntensity = 0.35 + 2.4 * rear;
    });
  };
  setLamps(0.6, 0.4);

  // contact shadow: plane a little larger than the footprint
  const pw = dims.length / 1000 * 1.25, ph = dims.width / 1000 * 1.7;
  const shadowRT = bakeShadow(renderer, root, pw, ph);
  const tris = meshes.reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
  return { root, meshes, mats, setLamps, shadow: { texture: shadowRT.texture, w: pw, h: ph }, stats: { tris, draws: meshes.length } };
}
