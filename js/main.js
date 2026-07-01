// Asset Designer — view AND EDIT the placeable assets from the shared manifest.
// Loads an asset's code-built meshes as editable "parts" (frozen geometry, so
// curved/jittered code geometry round-trips exactly), lets you add primitives,
// select by raycast, move/scale/rotate per axis, recolour, edit metadata
// (HP/footprint), and save/export/import a JSON config per asset.
//
// Dependency is ONE WAY: imports from https://rmrfbase.com/; the game never imports
// from here. Mobile-friendly collapsing widgets in each corner + pinch-zoom.

import * as THREE from 'three';
import { ASSETS } from 'https://rmrfbase.com/js/assets.manifest.js?v=4';
import { TEAM_COLORS, getCamoTextures } from 'https://rmrfbase.com/js/CamoTexture.js';
import { concreteTexture, ribbedMetalTexture, fabricTexture, crateTexture, roofTexture, accentPlateTexture, hazardTexture,
  noiseTexture, grimeTexture, woodTexture, scratchedTexture } from 'https://rmrfbase.com/js/Textures.js?v=6';

// Procedural textures available to apply in the MATERIAL menu.
const TEX = {
  concrete: () => concreteTexture(), metal: () => ribbedMetalTexture(), fabric: () => fabricTexture(),
  crate: () => crateTexture(), roof: () => roofTexture(), accent: () => accentPlateTexture(),
  hazard: () => hazardTexture(),
  noise: () => noiseTexture(), grime: () => grimeTexture(), wood: () => woodTexture(), scratched: () => scratchedTexture(),
  camo: () => camoColorTex(),   // the vehicles' camo, in the current COLOR-menu team colour
};
// The camo colour map at the current accent (downscaled from the 512px source to keep
// the baked data URL reasonable). Camo exports by KIND id like the other procedural
// textures; the game rebuilds it fresh in the part's team colour (AssetBuilder handles
// 'camo' specially), so the export stays tiny — no base64 blob.
function camoColorTex() {
  const src = getCamoTextures(accentIndex).map.image;   // 512px camo canvas (cached per colour)
  const c = document.createElement('canvas'); c.width = c.height = 256;
  c.getContext('2d').drawImage(src, 0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CELL = 5;
const SLOP = 9;   // px a press may wander and still count as a tap (select)

// ── Scene / renderer ─────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1812);
scene.add(new THREE.DirectionalLight(0xffeebb, 3.6).translateX(18).translateY(26).translateZ(14));
const fill = new THREE.DirectionalLight(0x88bbee, 1.8); fill.position.set(-12, 10, -14); scene.add(fill);
scene.add(new THREE.AmbientLight(0x88aa99, 2.6));

const gridHelper = new THREE.GridHelper(CELL * 12, 12, 0x1d4030, 0x12281d);
scene.add(gridHelper);

const model = new THREE.Group();   // the editable parts live here
scene.add(model);

const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd24a);
selBox.visible = false; scene.add(selBox);
// Dimmer boxes for the non-primary parts of a multi-selection.
const multiBoxes = new THREE.Group(); scene.add(multiBoxes);
function updateMultiSel() {
  while (multiBoxes.children.length) { const h = multiBoxes.children[0]; multiBoxes.remove(h); h.geometry.dispose(); h.material.dispose(); }
  if (thumb || elemMode()) return;   // multi-select boxes are an OBJECT-mode affordance
  for (const i of selSet) {
    if (i === selIndex) continue;   // primary uses selBox
    const m = parts()[i]; if (!m) continue;
    const b = new THREE.Box3Helper(new THREE.Box3().setFromObject(m), 0xffd24a);
    b.material.transparent = true; b.material.opacity = 0.45;
    multiBoxes.add(b);
  }
}

// ── RGB transform gizmo ───────────────────────────────────────────────────────
// Draggable X(red)/Y(green)/Z(blue) arrows at the selection. Grabbing an arrow picks
// that axis and drives the active MOVE/SCALE/ROTATE tool as you drag along it — an
// alternative to the axis buttons. Drawn over everything at a constant screen size.
const GIZMO_AXES = { x: 0xff5555, y: 0x55ff77, z: 0x5599ff };
// arrows/scale draw ON TOP of everything (depthTest off) — they read fine that way.
const gizmoMat = color => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
// the rotation RINGS instead depth-test against the scene, so the part HIDES their back
// half (they go behind the object, Blender-style) instead of floating flat over it.
const gizmoArcMat = color => new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: false, transparent: true });
// Straight arrow handle (shown for MOVE / SCALE).
function makeArrow(axis, mat) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), mat); shaft.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 12), mat); head.position.y = 1.05;
  g.add(shaft, head);
  if (axis === 'x') g.rotation.z = -Math.PI / 2; else if (axis === 'z') g.rotation.x = Math.PI / 2;   // +Y arrow → axis
  g.traverse(o => { o.userData.axis = axis; o.renderOrder = 1001; });
  return g;
}
// Curved ring handle (shown for ROTATE) — lies in the plane the axis spins IN
// (perpendicular to the axis), so it reads as "turn around this axis".
function makeArc(axis, mat) {
  // a FULL ring (not a partial arc) — the three circles sit in clearly different planes
  // so X/Y/Z read apart and each has lots of unambiguous area to grab (partial arcs
  // overlapped near the poles, where two rings cross, making X and Z feel like one axis).
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 8, 48), mat);
  if (axis === 'x') arc.rotation.y = Math.PI / 2;        // ring around X (YZ plane)
  else if (axis === 'y') arc.rotation.x = Math.PI / 2;   // ring around Y (XZ plane); Z uses the default XY plane
  arc.userData.axis = axis; arc.renderOrder = 1001;
  return arc;
}
// Box-tipped handle (shown for SCALE) — Blender-style, so scale reads differently
// from the move arrow and the rotate ring at a glance.
function makeScaleHandle(axis, mat) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.92, 8), mat); shaft.position.y = 0.46;
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), mat); knob.position.y = 1.03;
  g.add(shaft, knob);
  if (axis === 'x') g.rotation.z = -Math.PI / 2; else if (axis === 'z') g.rotation.x = Math.PI / 2;   // +Y handle → axis
  g.traverse(o => { o.userData.axis = axis; o.renderOrder = 1001; });
  return g;
}
const gizmo = new THREE.Group(); gizmo.visible = false; scene.add(gizmo);
const gizmoSets = Object.entries(GIZMO_AXES).map(([ax, c]) => {
  const mat = gizmoMat(c);   // arrows + scale share the always-on-top material
  const arrow = makeArrow(ax, mat), scale = makeScaleHandle(ax, mat), arc = makeArc(ax, gizmoArcMat(c));
  gizmo.add(arrow, scale, arc); return { axis: ax, arrow, scale, arc };
});
const gizmoSelActive = () => elemMode() ? hasSel() : (selSet.length > 0 || selIndex >= 0);
const gizmoActive = () => !thumb && (toolMode === 'move' || toolMode === 'scale' || toolMode === 'rotate') && gizmoSelActive();
// World position the gizmo sits at: object-mode = centre of the selected parts;
// element-mode = world centroid of the selected verts.
function gizmoOrigin() {
  if (elemMode()) {
    const m = parts()[selIndex], groups = selGroupSet(); if (!m || !vertGroups || !groups.length) return null;
    const pos = m.geometry.attributes.position, c = new THREE.Vector3();
    for (const g of groups) { const i = vertGroups[g][0]; c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))); }
    return m.localToWorld(c.multiplyScalar(1 / groups.length));
  }
  const idxs = selSet.length ? selSet : (selIndex >= 0 ? [selIndex] : []);
  if (idxs.length > 1) {   // multi-select GROUP: collective centre = mean of part origins (the rigid-rotate pivot)
    const c = new THREE.Vector3(); let n = 0;
    for (const i of idxs) { const m = parts()[i]; if (m) { c.add(m.position); n++; } }
    return n ? c.multiplyScalar(1 / n) : null;
  }
  const box = new THREE.Box3();
  for (const i of idxs) { const m = parts()[i]; if (m) box.expandByObject(m); }
  return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}
// World bounding-sphere radius of the current selection (the whole part in element mode)
// — used to size the rotation rings so they ENCIRCLE the object.
function selectionRadius() {
  const idxs = elemMode() ? (selIndex >= 0 ? [selIndex] : []) : (selSet.length ? selSet : (selIndex >= 0 ? [selIndex] : []));
  const box = new THREE.Box3();
  for (const i of idxs) { const m = parts()[i]; if (m) box.expandByObject(m); }
  if (box.isEmpty()) return 1;
  return box.getBoundingSphere(new THREE.Sphere()).radius || 1;
}
function updateGizmo() {
  if (!gizmoActive()) { gizmo.visible = false; return; }
  const o = gizmoOrigin(); if (!o) { gizmo.visible = false; return; }
  gizmo.visible = true; gizmo.position.copy(o);
  // MOVE/SCALE: constant on-screen size. ROTATE: grow to encircle the object so the rings
  // wrap AROUND it (the back arc passes behind and is hidden by depth) — never buried inside.
  const screenS = Math.max(1.5, camRadius * 0.11);
  gizmo.scale.setScalar(toolMode === 'rotate' ? Math.max(screenS, selectionRadius() * 1.45) : screenS);
  // distinct handle per tool: MOVE → arrows, SCALE → box-tipped, ROTATE → rings
  for (const s of gizmoSets) { s.arrow.visible = toolMode === 'move'; s.scale.visible = toolMode === 'scale'; s.arc.visible = toolMode === 'rotate'; }
}
// A world axis at the gizmo origin → a normalised SCREEN direction (y DOWN, matching
// pointer deltas), so a drag along the arrow maps to motion along that axis.
function axisScreenDir(axis, origin) {
  const o = origin.clone().project(camera);
  const tip = origin.clone().add(new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)).project(camera);
  const sx = tip.x - o.x, sy = -(tip.y - o.y), len = Math.hypot(sx, sy) || 1;
  return { x: sx / len, y: sy / len };
}
function raycastGizmo(px, py) {
  if (!gizmo.visible) return null;
  gizmo.updateMatrixWorld(true);   // click may land between render frames
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const handles = gizmoSets.map(s => toolMode === 'rotate' ? s.arc : toolMode === 'scale' ? s.scale : s.arrow);   // only the visible set
  const hit = raycaster.intersectObjects(handles, true)[0];
  return hit ? hit.object.userData.axis : null;
}
function highlightAxisButton(axis) {
  document.querySelectorAll('.tool.active .tool-kids button[data-axis]').forEach(b => b.classList.toggle('active', b.dataset.axis === axis));
}

// ── Camera (orbit around a target) ───────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 600);
const target = new THREE.Vector3(0, 2, 0);
let camTheta = 0.72, camPhi = 0.95, camRadius = 22;
function updateCamera() {
  camera.position.set(
    target.x + Math.sin(camTheta) * Math.sin(camPhi) * camRadius,
    target.y + Math.cos(camPhi) * camRadius,
    target.z + Math.cos(camTheta) * Math.sin(camPhi) * camRadius);
  camera.lookAt(target);
  updateGizmo();   // keep the gizmo a constant on-screen size as we orbit/zoom
}
const _panR = new THREE.Vector3(), _panU = new THREE.Vector3();
// Blender-style pan: slide the orbit target across the camera's screen plane so the scene
// tracks the cursor 1:1 at the target distance (shift + middle mouse).
function panCamera(dx, dy) {
  _panR.setFromMatrixColumn(camera.matrixWorld, 0);   // world-space screen-right
  _panU.setFromMatrixColumn(camera.matrixWorld, 1);   // world-space screen-up
  const k = (2 * camRadius * Math.tan(camera.fov * Math.PI / 360)) / container.clientHeight;
  target.addScaledVector(_panR, -dx * k).addScaledVector(_panU, dy * k);
  updateCamera();
}
window.setCameraView = ({ theta, phi, radius } = {}) => {
  if (theta != null) camTheta = theta; if (phi != null) camPhi = phi; if (radius != null) camRadius = radius;
  updateCamera();
};

// ── State ─────────────────────────────────────────────────────────────────────
let activeIndex = 0;
let accentIndex = 0;
let selIndex = -1;       // primary selection (drives the param panels / coords)
let selSet = [];         // OBJECT-mode multi-selection (part indices); selIndex = the last picked
let toolMode = null;   // 'add' | 'move' | 'scale' | 'rotate' | 'material' | null
let matSub = null;     // which MATERIAL sub-tool is open: 'colors'|'textures'|'specular'|'normal'|null
let dmgPreviewHP = 1;  // DAMAGE-tool preview health (1 = intact .. 0 = destroyed)
let toolAxis = null;   // 'x' | 'y' | 'z'
// Blender-style element-selection mode (the right-side icon toolbar):
//   'object' = transform the whole part; 'vertex'/'edge'/'face' = edit sub-geometry.
let selMode = 'object';
const elemMode = () => selMode !== 'object';
let thumb = false;
const meta = { id: '', name: '', category: '', accent: true, hp: 0, type: 'building', fw: 1, fd: 1 };

const parts = () => model.children;   // each child mesh = a part; userData holds {kind, params, mat}

// ── Material (de)serialise ───────────────────────────────────────────────────
// Serialise a texture to a data URL so it round-trips (covers both the assets'
// original baked textures and ones applied from the MATERIAL menu).
function texToURL(tex) {
  if (!tex) return null;
  if (tex.userData && tex.userData.src) return tex.userData.src;
  try { if (tex.image && tex.image.toDataURL) return tex.image.toDataURL(); } catch (e) { /* tainted */ }
  return tex.image && tex.image.src ? tex.image.src : null;
}
// Build a THREE.Texture from a data-URL (with tiling), for any map slot.
function texFromURL(url, tile) {
  const img = new Image();
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace; t.userData = { src: url };
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (tile) t.repeat.set(tile[0], tile[1]);
  img.onload = () => { t.needsUpdate = true; };
  img.src = url;
  return t;
}
function applyMapURL(mat, url, tile) { if (url) { mat.map = texFromURL(url, tile); mat.needsUpdate = true; } }
// Rotate a canvas by a multiple of 90° (lossless; keeps tiling). The rotation is BAKED
// into the pixels rather than set on tex.rotation, so a derived normal map stays correct
// (its encoded vectors rotate with the relief — a plain UV spin would not).
function rotateCanvas(src, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return src;
  const swap = deg === 90 || deg === 270;
  const cv = document.createElement('canvas');
  cv.width = swap ? src.height : src.width; cv.height = swap ? src.width : src.height;
  const ctx = cv.getContext('2d');
  ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return cv;
}
// Build a fresh procedural texture (TEX[kind]) at the part's tiling + rotation; returns {tex,url}.
function buildTex(kind, tile, rot = 0) {
  const src = TEX[kind](), cv = rotateCanvas(src.image, rot);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
  let url = null; try { url = cv.toDataURL(); } catch (e) { /* tainted */ }
  tex.userData = { src: url, kind: (src.userData && src.userData.kind) || kind };
  if (tile) tex.repeat.set(tile[0], tile[1]);
  return { tex, url };
}
// Build a NORMAL map from a kind's procedural texture (its luminance = height). Kept
// self-contained (not imported from Textures.js) so the designer stays decoupled, but it
// mirrors the game's toNormalTexture exactly so the designer is WYSIWYG. Data, not colour.
function buildNormalTex(kind, tile, rot = 0) {
  const src = TEX[kind](), img = rotateCanvas(src.image, rot), s = img.width;   // rotate HEIGHT first → correct vectors
  const sd = img.getContext('2d').getImageData(0, 0, s, s).data;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d'), out = ctx.createImageData(s, s);
  const H = (x, y) => { const i = (((y + s) % s) * s + ((x + s) % s)) * 4; return (sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114) / 255; };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let nx = (H(x - 1, y) - H(x + 1, y)) * 2, ny = (H(x, y + 1) - H(x, y - 1)) * 2, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv;
    const i = (y * s + x) * 4;
    out.data[i] = (nx * 0.5 + 0.5) * 255; out.data[i + 1] = (ny * 0.5 + 0.5) * 255; out.data[i + 2] = (nz * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (tile) tex.repeat.set(tile[0], tile[1]);
  let url = null; try { url = cv.toDataURL(); } catch (e) { /* tainted */ }
  tex.userData = { src: url, kind: (src.userData && src.userData.kind) || kind };
  return { tex, url };
}
// A procedural texture from Textures.js self-identifies via userData.kind — capture it
// (when it's one of our TEX kinds) so the export ships the short id, not the fat data-URL.
function texKind(tex) { const k = tex && tex.userData && tex.userData.kind; return k && TEX[k] ? k : null; }
function matInfo(m) {
  const anyMap = m.map || m.normalMap || m.roughnessMap;
  return {
    kind: m.isMeshBasicMaterial ? 'basic' : 'standard',
    color: '#' + m.color.getHexString(),
    roughness: m.roughness ?? 1, metalness: m.metalness ?? 0, flatShading: !!m.flatShading,
    emissive: m.emissive ? '#' + m.emissive.getHexString() : null, emissiveIntensity: m.emissiveIntensity ?? 0,
    opacity: m.opacity ?? 1, transparent: !!m.transparent,
    map: texToURL(m.map), mapKind: texKind(m.map),
    // normal + spec are now INDEPENDENT map slots (their own texture, no colour map needed);
    // one shared tiling drives whichever maps are present.
    tile: anyMap ? [anyMap.repeat.x, anyMap.repeat.y] : null, rot: 0,   // rotation is baked into the canvas; u.rot is the source of truth
    normalTex: texToURL(m.normalMap), normalKind: texKind(m.normalMap), normalScale: m.normalScale ? m.normalScale.x : 1,
    specTex: texToURL(m.roughnessMap), specKind: texKind(m.roughnessMap),
  };
}
// Canonical material defaults (mirror addMesh's new-part material). The minimal
// export OMITS any field equal to these; makeMat fills them back in on load, so a
// stripped material round-trips exactly.
const MAT_DEF = { kind: 'standard', color: '#b0b6bb', roughness: 0.8, metalness: 0.1, flatShading: true, emissive: null, emissiveIntensity: 0, opacity: 1, transparent: false, normalScale: 1, rot: 0 };
function makeMat(info) {
  info = { ...MAT_DEF, ...(info || {}) };
  const base = { color: info.color, transparent: info.transparent, opacity: info.opacity, side: THREE.DoubleSide };
  let mat;
  if (info.kind === 'basic') mat = new THREE.MeshBasicMaterial(base);
  else {
    mat = new THREE.MeshStandardMaterial({ ...base, roughness: info.roughness, metalness: info.metalness, flatShading: info.flatShading });
    if (info.emissive) { mat.emissive = new THREE.Color(info.emissive); mat.emissiveIntensity = info.emissiveIntensity; }
  }
  const tile = info.tile;
  // Prefer a procedural KIND id (rebuilt fresh, no base64); fall back to a stored data URL.
  const rot = info.rot || 0;
  if (info.mapKind && TEX[info.mapKind]) mat.map = buildTex(info.mapKind, tile || [1, 1], rot).tex;
  else if (info.map) applyMapURL(mat, info.map, tile);
  if (info.normalKind && TEX[info.normalKind]) { mat.normalMap = buildNormalTex(info.normalKind, tile || [1, 1], rot).tex; const ns = info.normalScale ?? 1; mat.normalScale.set(ns, ns); }
  else if (info.normalTex) { const t = texFromURL(info.normalTex, tile); t.colorSpace = THREE.NoColorSpace; mat.normalMap = t; const ns = info.normalScale ?? 1; mat.normalScale.set(ns, ns); }
  if (mat.isMeshStandardMaterial) {
    if (info.specKind && TEX[info.specKind]) mat.roughnessMap = buildTex(info.specKind, tile || [1, 1], rot).tex;
    else if (info.specTex) mat.roughnessMap = texFromURL(info.specTex, tile);
    else if (info.spec && mat.map) mat.roughnessMap = mat.map;   // legacy
  }
  mat.needsUpdate = true;
  return mat;
}

// ── Primitive geometry from a spec ───────────────────────────────────────────
// Editable parameter schema per primitive: [key, label, default]. (Cylinder
// top/bottom radius let you make cones; 0 top radius = a point.)
const GEO_PARAMS = {
  box: [['w', 'width', 2], ['h', 'height', 2], ['d', 'depth', 2]],
  sphere: [['r', 'radius', 1.4], ['detail', 'detail', 1]],
  cylinder: [['rt', 'top radius', 1], ['rb', 'bottom radius', 1], ['h', 'height', 3], ['seg', 'segments', 14]],
  cone: [['r', 'radius', 1.2], ['h', 'height', 3], ['seg', 'segments', 14]],
  plane: [['w', 'width', 3], ['h', 'height', 3]],
};
function defaultParams(kind) { const p = {}; for (const [k, , d] of (GEO_PARAMS[kind] || [])) p[k] = d; return p; }
function makeGeo(kind, p = {}) {
  switch (kind) {
    case 'box': return new THREE.BoxGeometry(p.w ?? 2, p.h ?? 2, p.d ?? 2);
    case 'sphere': return new THREE.IcosahedronGeometry(p.r ?? 1.4, p.detail ?? 1);
    case 'cylinder': return new THREE.CylinderGeometry(p.rt ?? 1, p.rb ?? 1, p.h ?? 3, p.seg ?? 14);
    case 'cone': return new THREE.ConeGeometry(p.r ?? 1.2, p.h ?? 3, p.seg ?? 14);
    case 'plane': return new THREE.PlaneGeometry(p.w ?? 3, p.h ?? 3);
    default: return new THREE.BoxGeometry(2, 2, 2);
  }
}

// Map an existing geometry to an editable primitive so decomposed asset meshes
// expose their real params. Returns null for shapes we can't parametrise
// (extrusions, torus, merged buffers) — those stay frozen (SCALE only).
function readGeo(g) {
  const t = g.type, p = g.parameters || {};
  if (t === 'BoxGeometry') return { kind: 'box', params: { w: p.width, h: p.height, d: p.depth } };
  if (t === 'CylinderGeometry') return { kind: 'cylinder', params: { rt: p.radiusTop, rb: p.radiusBottom, h: p.height, seg: p.radialSegments } };
  if (t === 'ConeGeometry') return { kind: 'cone', params: { r: p.radius, h: p.height, seg: p.radialSegments } };
  if (t === 'IcosahedronGeometry') return { kind: 'sphere', params: { r: p.radius, detail: p.detail } };
  if (t === 'PlaneGeometry') return { kind: 'plane', params: { w: p.width, h: p.height } };
  return null;
}

// Add one part mesh. If `geometry` is given it's rendered as-is (exact original);
// otherwise the geometry is built from kind+params. `parametric` marks whether
// the live geometry came from params (so export/edit treat it as editable).
function addPart({ kind, params, geometry, pos, rot, scale, mat, parametric, fallAt, dmgStyle, group }) {
  const hasGeo = geometry != null;
  const geo = hasGeo
    ? (geometry instanceof THREE.BufferGeometry ? geometry : new THREE.BufferGeometryLoader().parse(geometry))
    : makeGeo(kind, params);
  // A minimal export omits default mat fields and trims trailing 0/1 from the
  // transform arrays — rebuild the full forms so editing + re-export stay exact.
  const fullMat = { ...MAT_DEF, ...(mat || {}) };
  const mesh = new THREE.Mesh(geo, makeMat(fullMat));
  if (pos) mesh.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
  if (rot) mesh.rotation.set(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0);
  if (scale) mesh.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
  mesh.userData = {
    kind, params: params || null, mat: fullMat, parametric: parametric !== undefined ? parametric : (!hasGeo && kind !== 'frozen'),
    // DESTRUCTION STAGING: fallAt = HP fraction (0..1) at/below which this part lets go;
    // dmgStyle = how it goes ('tumble' = explode outward, 'squish' = pancake flat). 0 = only at death.
    fallAt: fallAt ?? 0, dmgStyle: dmgStyle || 'tumble',
  };
  if (group) mesh.userData.group = group;   // named subassembly (see groupSelected / cfg.groups)
  model.add(mesh);
  return mesh;
}

// ── Load an asset → parts ────────────────────────────────────────────────────
function buildFromMake(asset) {
  const accentHex = '#' + new THREE.Color(TEAM_COLORS[accentIndex].hex).getHexString();
  const g = asset.make(CELL, new THREE.Color(TEAM_COLORS[accentIndex].hex));
  g.updateMatrixWorld(true);
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  g.traverse(o => {
    if (!o.isMesh) return;
    o.matrixWorld.decompose(pos, q, s);
    const e = new THREE.Euler().setFromQuaternion(q);
    const info = matInfo(Array.isArray(o.material) ? o.material[0] : o.material);
    // parts drawn in the accent colour follow the team colour automatically
    if (info.color.toLowerCase() === accentHex.toLowerCase()) info.team = true;
    // recognise clean primitives so their params are editable; otherwise freeze.
    const mapped = readGeo(o.geometry);
    addPart({
      // render the EXACT original geometry (plain BufferGeometry copy — captures
      // baked verts AND serialises with `.data`); kind/params let it be edited.
      kind: mapped ? mapped.kind : 'frozen', params: mapped ? mapped.params : null,
      geometry: new THREE.BufferGeometry().copy(o.geometry),
      pos: pos.toArray(), rot: [e.x, e.y, e.z], scale: s.toArray(), mat: info, parametric: false,
    });
  });
}

function clearModel() { clearVertHandles(); while (model.children.length) { const m = model.children[0]; model.remove(m); m.geometry.dispose(); } selIndex = -1; selSet = []; groupMeta = {}; _gidNext = 1; updateMultiSel(); selBox.visible = false; }

function loadAsset(i, { fresh = false } = {}) {
  flushSave();   // persist the asset we're leaving before we swap it out
  activeIndex = i;
  try { localStorage.setItem('assetdesigner:_last', String(i)); } catch (e) { /* private mode */ }
  const a = allAssets()[i];
  meta.id = a.id; meta.name = a.name; meta.category = a.category; meta.accent = a.accent;
  meta.hp = a.destructible ? a.destructible.hp : 0; meta.type = a.destructible ? a.destructible.type : '—';
  meta.fw = a.footprint.w; meta.fd = a.footprint.d;
  clearModel();

  // manifest assets rebuild from their code maker; brand-new user assets have no
  // maker, so they fall back to a single starter box.
  const saved = !fresh && localStorage.getItem('assetdesigner:' + a.id);
  if (saved) { try { importConfig(JSON.parse(saved), { silent: true }); } catch (e) { a.make ? buildFromMake(a) : addMesh('box'); } }
  else if (a.make) buildFromMake(a);
  else addMesh('box');

  frameModel();
  if (dmgActive()) { dmgSnapshot(); dmgPreviewHP = 1; }   // switched assets mid-DAMAGE: re-arm the preview
  refreshAssetTabs(); refreshStats();
  resetHistory();   // undo history is per-asset
}

function frameModel() {
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) { target.set(0, 2, 0); camRadius = 22; updateCamera(); return; }
  const size = new THREE.Vector3(); box.getSize(size);
  target.set(0, size.y * 0.5, 0);
  const sph = new THREE.Sphere(); box.getBoundingSphere(sph);
  camRadius = Math.max(sph.radius * (thumb ? 2.05 : 3.3), thumb ? 6 : 14);
  updateCamera();
}

// ── Selection ─────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
// additive (shift) toggles the hit part in/out of the multi-selection; otherwise it
// replaces the selection with the single hit (or clears it).
function raycastSelect(px, py, additive = false) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(parts(), false)[0];
  const idx = hit ? parts().indexOf(hit.object) : -1;
  if (!elemMode()) {
    // SHIFT toggles; otherwise the selection-op toolbar decides (ADD unions, SUBTRACT
    // removes, NORMAL replaces) — same as element picking, now for whole parts too.
    // A grouped part drags its whole group in, so subassemblies select as one.
    const mates = idx >= 0 ? groupMates(idx) : [];
    const allIn = mates.length > 0 && mates.every(i => selSet.includes(i));
    if (additive) {
      if (mates.length) { if (allIn) selSet = selSet.filter(i => !mates.includes(i)); else for (const i of mates) if (!selSet.includes(i)) selSet.push(i); }
    } else if (selOp === 'add') {
      for (const i of mates) if (!selSet.includes(i)) selSet.push(i);
    } else if (selOp === 'subtract') {
      selSet = selSet.filter(i => !mates.includes(i));
    } else {
      selSet = mates.slice();
    }
    selIndex = idx >= 0 && selSet.includes(idx) ? idx : (selSet.length ? selSet[selSet.length - 1] : -1);
  } else {
    selIndex = idx; selSet = idx >= 0 ? [idx] : [];
  }
  updateSel();
}
function updateSel() {
  const m = parts()[selIndex];
  if (m) {
    selBox.box.setFromObject(m); selBox.visible = !thumb;
    document.getElementById('sel-tag').textContent = selSet.length > 1 ? `▣ ${selSet.length} parts` : `▣ part ${selIndex + 1}/${parts().length}`;
  }
  else { selBox.visible = false; document.getElementById('sel-tag').textContent = ''; }
  updateMultiSel();
  refreshStats();
  refreshGeomParams();
  refreshMatParams();
  refreshDmgParams();
  syncMapButtons();
  updateGizmo();
  refreshGroupUI();
}

// ── Transform (axis-constrained drag) ────────────────────────────────────────
const transformActive = () => !elemMode() && (toolMode === 'move' || toolMode === 'scale' || toolMode === 'rotate') && toolAxis && parts()[selIndex];
// Snap increment (0 = off): quantises drag-adjustments + typed values to a grid.
let snap = 0;
function snapVal(v) { return snap > 0 ? +(Math.round(v / snap) * snap).toFixed(4) : v; }
const _ROT_AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const _rotQ = new THREE.Quaternion();
const _unit = new THREE.Vector3();
// For a (possibly rotated) part, the LOCAL scale axis whose world direction points most
// along the grabbed WORLD axis — so a world-aligned scale handle stretches along that
// world axis (exact for 90° rotations; nearest-axis otherwise).
function localScaleAxis(m, worldAxisKey) {
  const w = _ROT_AXES[worldAxisKey];
  let best = 'x', bestDot = -1;
  for (const k of ['x', 'y', 'z']) {
    const d = Math.abs(_unit.copy(_ROT_AXES[k]).applyQuaternion(m.quaternion).dot(w));
    if (d > bestDot) { bestDot = d; best = k; }
  }
  return best;
}
function applyTransform(dx) {
  const targets = (selSet.length ? selSet : (selIndex >= 0 ? [selIndex] : [])).map(i => parts()[i]).filter(Boolean);
  if (!targets.length) return;
  // ROTATE about the WORLD axis via quaternion (matches the gizmo rings; Euler would
  // gimbal-lock at yaw 90°). For a MULTI-part selection the whole group rotates as ONE
  // rigid body around its collective centre (mean of origins — invariant under the
  // rotation, so it doesn't drift); a single part still spins about its own origin.
  let rotQ = null, pivot = null;
  if (toolMode === 'rotate') {
    let deg = dx * 1.2;
    if (snap > 0) deg = Math.round(deg / snap) * snap;   // step by the snap increment (degrees)
    if (deg) {
      rotQ = _rotQ.setFromAxisAngle(_ROT_AXES[toolAxis], deg * Math.PI / 180);
      if (targets.length > 1) {
        pivot = new THREE.Vector3();
        for (const m of targets) pivot.add(m.position);
        pivot.multiplyScalar(1 / targets.length);
      }
    }
  }
  for (const m of targets) {
    if (toolMode === 'move') m.position[toolAxis] = snapVal(m.position[toolAxis] + dx * 0.04);
    else if (toolMode === 'scale') {
      // ALL = uniform scale (rotation-independent). One axis = grow the LOCAL axis aligned
      // with the grabbed WORLD axis, so scaling stays aligned to the world even when the
      // part is rotated (e.g. boards turned 90° to build a crate).
      const axes = toolAxis === 'all' ? ['x', 'y', 'z'] : [localScaleAxis(m, toolAxis)];
      for (const ax of axes) m.scale[ax] = Math.max(0.05, snapVal(m.scale[ax] + dx * 0.012));
    }
    else if (rotQ) {
      m.quaternion.premultiply(rotQ);                       // orientation
      if (pivot) m.position.sub(pivot).applyQuaternion(rotQ).add(pivot);   // swing position around the group centre
    }
  }
  const pm = parts()[selIndex]; if (pm) selBox.box.setFromObject(pm);
  updateMultiSel();
  updateGizmo();
  refreshStats();
}

// ── Vertex editing (sub-object) ──────────────────────────────────────────────
// VERTEX mode lets you push individual vertices around to make custom shapes.
// Coincident verts are WELDED (grouped by position) so a corner shared by
// several faces moves as one and the mesh stays watertight. A part becomes a
// FROZEN custom geometry the moment a vertex is edited (so it exports its exact
// verts, not a primitive's params).
const AXIS_COMP = { x: 0, y: 1, z: 2 };
// The selection is a LIST of elements; each element is an array of welded-group
// indices (1 = vertex, 2 = edge, 3 = face triangle). The left-side toolbar sets
// how a fresh pick combines with it: NORMAL replaces, ADD unions, SUBTRACT removes
// (+ a SELECT-ALL action). So you can grab e.g. both triangles of a quad.
let selElems = [];          // array of group-index arrays
let selOp = 'normal';       // 'normal' | 'add' | 'subtract'
let vertGroups = null;      // array of arrays: position-attribute indices sharing a position
let groupOfIndex = null;    // Map: original position-attribute index -> its welded group index
let vertHandles = null;     // THREE.Points overlay (child of the selected mesh)
let vertHilite = null;      // marker Points for the selected elements' vertices
let elemLine = null;        // overlay line segments for selected edges / faces

function clearVertHandles() {
  for (const h of [vertHandles, vertHilite, elemLine]) {
    if (h) { if (h.parent) h.parent.remove(h); h.geometry.dispose(); h.material.dispose(); }
  }
  vertHandles = vertHilite = elemLine = null;
  selElems = []; vertGroups = null; groupOfIndex = null;
}
const vertexActive = () => elemMode();
const elemSig = a => [...a].sort((x, y) => x - y).join(',');
// Combine a freshly-picked element into the selection per the active op.
function applyPick(groups, additive = false) {
  if (!groups) return false;
  const s = elemSig(groups);
  if (additive) {   // SHIFT: toggle this element in/out, like object multi-select
    const at = selElems.findIndex(e => elemSig(e) === s);
    if (at >= 0) selElems.splice(at, 1); else selElems.push(groups);
  }
  else if (selOp === 'subtract') selElems = selElems.filter(e => elemSig(e) !== s);
  else if (selOp === 'add') { if (!selElems.some(e => elemSig(e) === s)) selElems.push(groups); }
  else selElems = [groups];
  updateElemHilite(); updateHint(); return true;
}
// The unique welded groups every selected element touches (drives the transforms).
function selGroupSet() {
  const set = new Set();
  for (const e of selElems) for (const g of e) set.add(g);
  return [...set];
}
const hasSel = () => selElems.length > 0;
// VERTEX coord boxes only make sense for exactly one picked vertex.
function singleVertGroup() {
  return (selMode === 'vertex' && selElems.length === 1 && selElems[0].length === 1) ? selElems[0][0] : -1;
}
const elemDragActive = () => elemMode() && (toolMode === 'move' || toolMode === 'scale' || toolMode === 'rotate')
  && toolAxis && parts()[selIndex] && hasSel();

// Build the green handle cloud for the selected mesh, welding coincident verts.
function buildVertHandles() {
  clearVertHandles();
  const m = parts()[selIndex]; if (!m) return;
  const pos = m.geometry.attributes.position; if (!pos) return;
  const map = new Map(); vertGroups = []; groupOfIndex = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = pos.getX(i).toFixed(4) + ',' + pos.getY(i).toFixed(4) + ',' + pos.getZ(i).toFixed(4);
    let g = map.get(key);
    if (!g) { g = []; map.set(key, g); vertGroups.push(g); }
    g.push(i);
  }
  vertGroups.forEach((g, k) => g.forEach(i => groupOfIndex.set(i, k)));
  const arr = new Float32Array(vertGroups.length * 3);
  vertGroups.forEach((g, k) => { arr[k * 3] = pos.getX(g[0]); arr[k * 3 + 1] = pos.getY(g[0]); arr[k * 3 + 2] = pos.getZ(g[0]); });
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  vertHandles = new THREE.Points(hg, new THREE.PointsMaterial({ color: 0x5dff9f, size: 12, sizeAttenuation: false, depthTest: false, transparent: true }));
  vertHandles.renderOrder = 998; m.add(vertHandles);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  vertHilite = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffd24a, size: 19, sizeAttenuation: false, depthTest: false, transparent: true }));
  vertHilite.renderOrder = 999; vertHilite.visible = false; m.add(vertHilite);
}

// Pick the element under the cursor for the active selMode → its group array (or null).
function pickElement(px, py) {
  const m = parts()[selIndex]; if (!m) return null;
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (selMode === 'vertex') {   // nearest welded handle from the green cloud
    if (!vertHandles) return null;
    raycaster.params.Points.threshold = camRadius * 0.045;
    const hit = raycaster.intersectObject(vertHandles, false)[0];
    return hit ? [hit.index] : null;
  }
  if (!groupOfIndex) return null;   // edge/face: raycast the mesh triangle
  const hit = raycaster.intersectObject(m, false)[0];
  if (!hit || !hit.face) return null;
  const f = hit.face;
  if (selMode === 'face') return [groupOfIndex.get(f.a), groupOfIndex.get(f.b), groupOfIndex.get(f.c)];
  // edge: closest of the triangle's 3 sides to the (local) hit point
  const pos = m.geometry.attributes.position, lp = m.worldToLocal(hit.point.clone());
  const v = i => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  const sides = [[f.a, f.b], [f.b, f.c], [f.c, f.a]];
  let best = Infinity, pick = sides[0];
  for (const s of sides) { const d = distToSeg(lp, v(s[0]), v(s[1])); if (d < best) { best = d; pick = s; } }
  return [groupOfIndex.get(pick[0]), groupOfIndex.get(pick[1])];
}
function distToSeg(p, a, b) {
  const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}
// SELECT ALL: every vertex / unique edge / unique face triangle of the current mesh.
function selectAllElements() {
  if (!elemMode()) {   // OBJECT mode → select every part
    selSet = parts().map((_, i) => i);
    selIndex = selSet.length ? selSet.length - 1 : -1;
    updateSel();
    return;
  }
  const m = parts()[selIndex]; if (!m) return;
  buildVertHandles();
  if (selMode === 'vertex') { selElems = vertGroups.map((_, k) => [k]); }
  else {
    selElems = []; const seen = new Set();
    const addTri = (a, b, c) => {
      const ga = groupOfIndex.get(a), gb = groupOfIndex.get(b), gc = groupOfIndex.get(c);
      if (selMode === 'face') { const s = elemSig([ga, gb, gc]); if (!seen.has(s)) { seen.add(s); selElems.push([ga, gb, gc]); } }
      else [[ga, gb], [gb, gc], [gc, ga]].forEach(pr => { const s = elemSig(pr); if (!seen.has(s)) { seen.add(s); selElems.push(pr); } });
    };
    const idx = m.geometry.index;
    if (idx) { for (let i = 0; i < idx.count; i += 3) addTri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)); }
    else { const c = m.geometry.attributes.position.count; for (let i = 0; i < c; i += 3) addTri(i, i + 1, i + 2); }
  }
  updateElemHilite(); refreshCoords(); updateHint();
}
// Highlight every selected element: yellow points on its verts + a loop per edge/face.
function updateElemHilite() {
  const m = parts()[selIndex];
  if (!m || !vertHilite) return;
  const groups = selGroupSet(), pos = m.geometry.attributes.position;
  const need = Math.max(3, groups.length) * 3;
  if (vertHilite.geometry.attributes.position.array.length < need)
    vertHilite.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(need), 3));
  const arr = vertHilite.geometry.attributes.position.array;
  groups.forEach((g, k) => { const i = vertGroups[g][0]; arr[k * 3] = pos.getX(i); arr[k * 3 + 1] = pos.getY(i); arr[k * 3 + 2] = pos.getZ(i); });
  vertHilite.geometry.setDrawRange(0, groups.length);
  vertHilite.geometry.attributes.position.needsUpdate = true;
  vertHilite.visible = groups.length > 0;
  if (elemLine) { if (elemLine.parent) elemLine.parent.remove(elemLine); elemLine.geometry.dispose(); elemLine.material.dispose(); elemLine = null; }
  const seg = [], gp = g => { const i = vertGroups[g][0]; return new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)); };
  for (const e of selElems) { if (e.length < 2) continue; for (let k = 0; k < e.length; k++) seg.push(gp(e[k]), gp(e[(k + 1) % e.length])); }
  if (seg.length) {
    elemLine = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0xffd24a, depthTest: false, transparent: true }));
    elemLine.renderOrder = 999; m.add(elemLine);
  }
}
const updateVertHilite = updateElemHilite;   // back-compat alias for the headless hooks
// Once vertices are moved the part is a one-off mesh — freeze it so it exports
// its real geometry (toJSON) and the param editor stops offering to rebuild it.
function markCustom(m) {
  m.userData.kind = 'frozen'; m.userData.params = null; m.userData.parametric = false;
  // a typed subclass (BoxGeometry, …) serialises to PARAMETRIC form which the
  // loader can't reparse — bake it to a plain BufferGeometry so toJSON has .data.
  if (m.geometry.constructor !== THREE.BufferGeometry) {
    const plain = new THREE.BufferGeometry().copy(m.geometry);
    m.geometry.dispose(); m.geometry = plain;
  }
}

function setVertexComponent(comp, v) {
  const m = parts()[selIndex]; const g = singleVertGroup(); if (!m || g < 0) return;
  const pos = m.geometry.attributes.position;
  for (const i of vertGroups[g]) pos.setComponent(i, comp, v);
  pos.needsUpdate = true; m.geometry.computeVertexNormals();
  markCustom(m); syncHandles(m); updateElemHilite();
  selBox.box.setFromObject(m); refreshStats();
}
// Re-read every green handle from the (possibly moved) geometry.
function syncHandles(m) {
  if (!vertHandles) return;
  const pos = m.geometry.attributes.position, hp = vertHandles.geometry.attributes.position;
  vertGroups.forEach((g, k) => hp.setXYZ(k, pos.getX(g[0]), pos.getY(g[0]), pos.getZ(g[0])));
  hp.needsUpdate = true;
}
// MOVE / SCALE / ROTATE the selected element (vertex/edge/face) along the active axis.
// SCALE & ROTATE pivot about the element's own centroid.
function applyElementTransform(dx) {
  const m = parts()[selIndex]; const groups = selGroupSet(); if (!m || !groups.length) return;
  const pos = m.geometry.attributes.position, comp = AXIS_COMP[toolAxis];
  const idxs = []; for (const g of groups) for (const i of vertGroups[g]) idxs.push(i);
  if (toolMode === 'move') {
    const d = snap > 0 ? snapVal(dx * 0.04) : dx * 0.04;
    for (const i of idxs) pos.setComponent(i, comp, pos.getComponent(i, comp) + d);
  } else if (toolMode === 'scale') {
    // ALL scales toward/away from the selection's shared centre on every axis at once.
    const c = elemCentroid(pos, idxs), f = Math.max(0.02, 1 + dx * 0.01);
    const comps = toolAxis === 'all' ? [0, 1, 2] : [comp];
    for (const i of idxs) for (const cc of comps) pos.setComponent(i, cc, c[cc] + (pos.getComponent(i, cc) - c[cc]) * f);
  } else {   // rotate about the centroid, around the chosen axis
    const c = elemCentroid(pos, idxs), ang = dx * 0.02;
    const [u, w] = comp === 0 ? [1, 2] : comp === 1 ? [0, 2] : [0, 1];
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const i of idxs) {
      const du = pos.getComponent(i, u) - c[u], dw = pos.getComponent(i, w) - c[w];
      pos.setComponent(i, u, c[u] + du * cs - dw * sn);
      pos.setComponent(i, w, c[w] + du * sn + dw * cs);
    }
  }
  pos.needsUpdate = true; m.geometry.computeVertexNormals();
  markCustom(m); syncHandles(m); updateElemHilite();
  selBox.box.setFromObject(m); updateGizmo(); refreshStats();
  if (selMode === 'vertex') refreshCoords();
}
function elemCentroid(pos, idxs) {
  const c = [0, 0, 0];
  for (const i of idxs) { c[0] += pos.getX(i); c[1] += pos.getY(i); c[2] += pos.getZ(i); }
  return [c[0] / idxs.length, c[1] / idxs.length, c[2] / idxs.length];
}

// ── EXTRUDE / SUBDIVIDE (mesh-building tools) ────────────────────────────────
// Read the mesh as explicit triangles, each carrying its 3 welded-group indices
// (so we can tell which triangles the face-selection covers).
function readTriangles(m) {
  const pos = m.geometry.attributes.position, idx = m.geometry.index, tris = [];
  const get = i => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  const push = (a, b, c) => tris.push({
    v: [get(a), get(b), get(c)],
    g: groupOfIndex ? [groupOfIndex.get(a), groupOfIndex.get(b), groupOfIndex.get(c)] : null,
  });
  if (idx) for (let i = 0; i < idx.count; i += 3) push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  else for (let i = 0; i < pos.count; i += 3) push(i, i + 1, i + 2);
  return tris;
}
// Box/planar-project UVs onto a non-indexed triangle soup so textured parts keep
// their map after EXTRUDE/SUBDIVIDE (the rebuilt geometry would otherwise have no
// UVs and render the bare colour). Each triangle projects onto its dominant axis;
// 1 UV unit = 1 model unit, so the material's own tiling still drives repeat.
function planarUVs(g) {
  const pos = g.attributes.position, n = pos.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const ux = pos.getX(i + 1) - ax, uy = pos.getY(i + 1) - ay, uz = pos.getZ(i + 1) - az;
    const vx = pos.getX(i + 2) - ax, vy = pos.getY(i + 2) - ay, vz = pos.getZ(i + 2) - az;
    const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
    const pick = (nx >= ny && nx >= nz) ? 0 : (ny >= nz) ? 1 : 2;   // dominant normal axis
    for (let k = 0; k < 3; k++) {
      const X = pos.getX(i + k), Y = pos.getY(i + k), Z = pos.getZ(i + k);
      const s = pick === 0 ? Z : X, t = pick === 1 ? Z : Y;
      uv[(i + k) * 2] = s; uv[(i + k) * 2 + 1] = t;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
// Replace the mesh with a fresh non-indexed triangle soup (a flat list of Vector3s,
// 3 per triangle), re-weld handles, freeze it. Caller manages the selection after.
function commitTriangleSoup(m, pts) {
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  planarUVs(g);
  m.geometry.dispose(); m.geometry = g;
  m.userData.kind = 'frozen'; m.userData.params = null; m.userData.parametric = false;
  buildVertHandles();   // re-weld + rebuild the green handle cloud (clears selElems)
  selBox.box.setFromObject(m); refreshStats();
}
// Re-select faces by their (post-rebuild) world positions — used to keep the new
// cap selected right after an extrude.
function reselectFaces(triples) {
  const m = parts()[selIndex]; if (!m || !vertGroups) return;
  const pos = m.geometry.attributes.position, key = new Map();
  const K = (x, y, z) => x.toFixed(4) + ',' + y.toFixed(4) + ',' + z.toFixed(4);
  vertGroups.forEach((grp, k) => { const i = grp[0]; key.set(K(pos.getX(i), pos.getY(i), pos.getZ(i)), k); });
  selElems = [];
  for (const t of triples) {
    const gs = t.map(v => key.get(K(v.x, v.y, v.z)));
    if (gs.every(x => x != null)) selElems.push(gs);
  }
  updateElemHilite();
}
const selectedFaceSigs = () => new Set(selElems.filter(e => e.length === 3).map(elemSig));
// SUBDIVIDE: split each selected face triangle into a (cuts+1)² grid of triangles.
// With nothing selected, subdivide the whole mesh.
function subdivideMesh(cuts) {
  const m = parts()[selIndex]; if (!m) return;
  const sigs = selectedFaceSigs(), anySel = sigs.size > 0;
  const tris = readTriangles(m), out = [], k = cuts + 1;
  const sub = (A, B, C) => {
    const P = (a, b) => A.clone().multiplyScalar(1 - a / k - b / k).add(B.clone().multiplyScalar(a / k)).add(C.clone().multiplyScalar(b / k));
    for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) {
      out.push(P(i, j), P(i + 1, j), P(i, j + 1));
      if (i + j < k - 1) out.push(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
    }
  };
  for (const t of tris) {
    if (anySel && (!t.g || !sigs.has(elemSig(t.g)))) { out.push(t.v[0], t.v[1], t.v[2]); continue; }
    sub(t.v[0], t.v[1], t.v[2]);
  }
  commitTriangleSoup(m, out);
  selElems = []; updateElemHilite(); updateHint();
}
// EXTRUDE: pull the selected face region out along its average normal, walling the
// boundary edges, and keep the new cap selected so MOVE/SCALE can fine-tune it.
function extrudeSelection() {
  const m = parts()[selIndex]; if (!m) return;
  const sigs = selectedFaceSigs();
  if (!sigs.size) { document.getElementById('hint').textContent = 'EXTRUDE needs a FACE selected'; return; }
  const tris = readTriangles(m);
  const selTris = tris.filter(t => t.g && sigs.has(elemSig(t.g)));
  const unsel = tris.filter(t => !(t.g && sigs.has(elemSig(t.g))));
  // average region normal + a sensible default push distance
  const normal = new THREE.Vector3(), bb = new THREE.Box3();
  for (const t of selTris) {
    normal.add(new THREE.Vector3().crossVectors(t.v[1].clone().sub(t.v[0]), t.v[2].clone().sub(t.v[0])));
    t.v.forEach(v => bb.expandByPoint(v));
  }
  if (normal.lengthSq() < 1e-9) normal.set(0, 1, 0);
  normal.normalize();
  const size = new THREE.Vector3(); bb.getSize(size);
  const dist = Math.max(0.3, Math.max(size.x, size.y, size.z) * 0.5);
  const offset = normal.multiplyScalar(dist);
  // one new (offset) vertex per touched welded group → shared verts stay shared
  const newPos = new Map();
  for (const t of selTris) t.g.forEach((g, i) => { if (!newPos.has(g)) newPos.set(g, t.v[i].clone().add(offset)); });
  const out = [], cap = [];
  unsel.forEach(t => out.push(t.v[0], t.v[1], t.v[2]));
  for (const t of selTris) { const c = t.g.map(g => newPos.get(g)); out.push(c[0], c[1], c[2]); cap.push(c); }
  // wall every BOUNDARY edge (used by exactly one selected triangle)
  const cnt = new Map(), dir = new Map(), ek = (a, b) => a < b ? a + '_' + b : b + '_' + a;
  for (const t of selTris) for (let e = 0; e < 3; e++) {
    const ga = t.g[e], gb = t.g[(e + 1) % 3], k = ek(ga, gb);
    cnt.set(k, (cnt.get(k) || 0) + 1);
    if (!dir.has(k)) dir.set(k, [ga, gb, t.v[e], t.v[(e + 1) % 3]]);
  }
  for (const [k, c] of cnt) {
    if (c !== 1) continue;
    const [ga, gb, va, vb] = dir.get(k), na = newPos.get(ga), nb = newPos.get(gb);
    out.push(va.clone(), vb.clone(), nb.clone());
    out.push(va.clone(), nb.clone(), na.clone());
  }
  commitTriangleSoup(m, out);
  reselectFaces(cap);   // new cap stays selected for an immediate MOVE
  updateHint();
}
// FLIP a quad's diagonal: select its TWO triangles (FACE mode) — they share an edge
// (the current diagonal); this re-triangulates the quad across the OTHER two corners.
function flipQuad() {
  const m = parts()[selIndex];
  if (!m || !elemMode() || !vertGroups) { msg('FLIP: select 2 faces of a quad'); return; }
  const faces = selElems.filter(e => e.length === 3);
  if (faces.length !== 2) { document.getElementById('hint').textContent = 'FLIP needs exactly 2 FACES (a quad) selected'; return; }
  const [t1, t2] = faces;
  const shared = t1.filter(g => t2.includes(g));               // the current diagonal (2 shared corners)
  if (shared.length !== 2 || new Set([...t1, ...t2]).size !== 4) { msg("FLIP: those faces don't share an edge"); return; }
  const [s1, s2] = shared;
  const o1 = t1.find(g => !shared.includes(g)), o2 = t2.find(g => !shared.includes(g));   // the off-diagonal corners
  const pos = m.geometry.attributes.position;
  const P = g => new THREE.Vector3(pos.getX(vertGroups[g][0]), pos.getY(vertGroups[g][0]), pos.getZ(vertGroups[g][0]));
  const sigs = new Set([elemSig(t1), elemSig(t2)]);
  const out = [];
  for (const t of readTriangles(m)) { if (t.g && sigs.has(elemSig(t.g))) continue; out.push(t.v[0], t.v[1], t.v[2]); }
  const a = P(o1), b = P(o2), c = P(s1), d = P(s2);
  out.push(a.clone(), c.clone(), b.clone());   // new diagonal runs o1↔o2
  out.push(a.clone(), b.clone(), d.clone());
  commitTriangleSoup(m, out);
  reselectFaces([[a, c, b], [a, b, d]]);
  updateHint(); scheduleSave();
  msg('flipped quad diagonal');
}
// Switch element-selection mode (the right-side icon toolbar).
function setSelMode(mode) {
  selMode = mode;
  document.querySelectorAll('.selmode-btn').forEach(b => b.classList.toggle('active', b.dataset.selmode === mode));
  // the selection-op toolbar stays visible in EVERY mode — NORMAL/ADD/SUBTRACT/ALL drive
  // object multi-select too (not just element picks), so there's no reason to hide it.
  selElems = [];   // switching element type drops the (now-incompatible) selection
  if (mode === 'object') clearVertHandles();
  else { selSet = selIndex >= 0 ? [selIndex] : []; buildVertHandles(); updateElemHilite(); }   // element edits are single-part
  updateMultiSel();
  updateHint();
}
// Switch how a pick combines with the selection (the left-side toolbar).
function setSelOp(op) {
  selOp = op;
  document.querySelectorAll('.selop-btn').forEach(b => b.classList.toggle('active', b.dataset.selop === op));
  updateHint();
}

// ── Edit ops ────────────────────────────────────────────────────────────────
function addMesh(kind) {
  const mesh = addPart({ kind, params: defaultParams(kind), pos: [0, 1.5, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    mat: { kind: 'standard', color: '#b0b6bb', roughness: 0.8, metalness: 0.1, flatShading: true, emissive: null, emissiveIntensity: 0, opacity: 1, transparent: false } });
  selIndex = parts().indexOf(mesh); selSet = [selIndex]; updateSel();
}
// Rebuild the selected parametric part's geometry from its (edited) params.
function rebuildGeo() {
  const m = parts()[selIndex]; if (!m || m.userData.kind === 'frozen') return;
  const old = m.geometry;
  m.geometry = makeGeo(m.userData.kind, m.userData.params);
  m.userData.parametric = true;   // now driven by params (exports as kind+params)
  old.dispose();
  if (elemMode()) { buildVertHandles(); updateElemHilite(); }   // verts changed — rebuild the handle cloud
  selBox.box.setFromObject(m); refreshStats();
}
// The top box is shared: hide it when none of its rows apply, OR when the TOOLS panel is
// minimized (no tool in play, and it would overlap the top menus otherwise).
function syncTopBox() {
  const toolsOpen = document.getElementById('w-tools').classList.contains('open');
  const shown = toolsOpen && ['coords', 'geom-params', 'mat-params', 'dmg-hp', 'dmg-params'].some(id => {
    const el = document.getElementById(id); return el && el.style.display !== 'none';
  });
  document.getElementById('top-center').classList.toggle('empty', !shown);
}
// Short axis-style label for a geometry param key (full name on hover).
const GP_SHORT = { w: 'W', h: 'H', d: 'D', r: 'R', detail: 'DET', rt: 'R▲', rb: 'R▼', seg: 'SEG' };
// Editable geometry params, inline (one compact row). Hidden in MATERIAL mode (you're
// not editing geometry there) and when nothing's selected.
function refreshGeomParams() {
  const wrap = document.getElementById('geom-params');
  const m = parts()[selIndex];
  if (toolMode === 'material' || toolMode === 'damage' || !m) { wrap.style.display = 'none'; wrap.innerHTML = ''; syncTopBox(); return; }
  wrap.style.display = 'flex';
  if (m.userData.kind === 'frozen') { wrap.innerHTML = '<span class="gmode">GEO</span><span class="ghint">custom mesh — use SCALE</span>'; syncTopBox(); return; }
  const kind = m.userData.kind, schema = GEO_PARAMS[kind] || [];
  wrap.innerHTML = `<span class="gmode">${kind.toUpperCase()}</span>` + schema.map(([k, label, def]) => {
    const v = m.userData.params[k] ?? def;
    const step = (k === 'seg' || k === 'detail') ? 1 : 0.1;
    return `<label title="${label}">${GP_SHORT[k] || k.toUpperCase()}</label><input data-gp="${k}" type="number" step="${step}" value="${v}">`;
  }).join('');
  syncTopBox();
  wrap.querySelectorAll('input[data-gp]').forEach(inp => inp.addEventListener('change', () => {
    const key = inp.dataset.gp; let val = parseFloat(inp.value); if (Number.isNaN(val)) return;
    if (key === 'seg') val = Math.max(3, Math.round(val));
    if (key === 'detail') val = Math.max(0, Math.round(val));
    m.userData.params[key] = val; rebuildGeo();
  }));
}
function deleteSelected() {
  // delete the whole multi-selection (high index first so the rest stay valid)
  const idxs = (selSet.length ? selSet : (selIndex >= 0 ? [selIndex] : [])).slice().sort((a, b) => b - a);
  if (!idxs.length) return;
  for (const i of idxs) { const m = parts()[i]; if (m) { model.remove(m); m.geometry.dispose(); } }
  selIndex = -1; selSet = []; updateSel();
}
// Copy ONE part (copy lands EXACTLY on the original — no offset — so you can immediately
// rotate/mirror it about the origin into place). Parametric parts copy their params;
// custom/frozen meshes copy their exact geometry. Returns the new mesh.
function duplicateOne(m) {
  const u = m.userData, keepGeo = u.kind === 'frozen' || !u.parametric;
  return addPart({
    kind: u.kind, params: u.params ? { ...u.params } : null,
    geometry: keepGeo ? new THREE.BufferGeometry().copy(m.geometry) : undefined,
    pos: [m.position.x, m.position.y, m.position.z],
    rot: [m.rotation.x, m.rotation.y, m.rotation.z], scale: m.scale.toArray(),
    mat: JSON.parse(JSON.stringify(u.mat)), parametric: u.parametric,
    fallAt: u.fallAt, dmgStyle: u.dmgStyle,
  });
}
// Duplicate EVERY selected part and select the new copies as a group, so a multi-select
// dupe can be moved/rotated together right away.
function duplicateSelected() {
  const idxs = selSet.length ? selSet.slice() : (selIndex >= 0 ? [selIndex] : []);
  const sources = idxs.map(i => parts()[i]).filter(Boolean);
  if (!sources.length) { msg('select a part to copy'); return; }
  const copies = sources.map(duplicateOne);
  selSet = copies.map(mesh => parts().indexOf(mesh)).filter(i => i >= 0);
  selIndex = selSet.length ? selSet[selSet.length - 1] : -1;
  updateSel(); scheduleSave();
  msg(copies.length > 1 ? `duplicated ${copies.length} parts` : 'duplicated part');
}
// ── Groups (named subassemblies) ─────────────────────────────────────────────
// A group tags a set of parts with a shared id so they select/move as ONE, and can
// carry a ROLE (gun, gate, …) that tells the GAME how the subassembly articulates.
// Membership lives on each part (userData.group); groupMeta holds each group's role.
let groupMeta = {};      // groupId -> { role }
let _gidNext = 1;
const selIdxs = () => (selSet.length ? selSet.slice() : (selIndex >= 0 ? [selIndex] : []));
// Every part index sharing idx's group (or just [idx] when it's ungrouped).
function groupMates(idx) {
  const m = parts()[idx]; if (!m) return [];
  const g = m.userData.group; if (!g) return [idx];
  const out = []; parts().forEach((p, i) => { if (p.userData.group === g) out.push(i); });
  return out.length ? out : [idx];
}
// The single group id spanning the current selection (null if none / mixed).
function currentGroupId() {
  const ids = new Set();
  for (const i of selIdxs()) { const g = parts()[i] && parts()[i].userData.group; if (g) ids.add(g); }
  return ids.size === 1 ? [...ids][0] : null;
}
function pruneGroups() {
  const used = new Set(parts().map(p => p.userData.group).filter(Boolean));
  for (const id of Object.keys(groupMeta)) if (!used.has(id)) delete groupMeta[id];
}
function groupSelected() {
  const idxs = selIdxs();
  if (!idxs.length) { msg('select parts to group'); return; }
  const id = 'g' + (_gidNext++);
  for (const i of idxs) { const m = parts()[i]; if (m) m.userData.group = id; }
  groupMeta[id] = { role: '' };
  updateSel(); scheduleSave();
  msg(`grouped ${idxs.length} part${idxs.length > 1 ? 's' : ''}`);
}
function ungroupSelected() {
  const idxs = selIdxs();
  for (const i of idxs) { const m = parts()[i]; if (m) delete m.userData.group; }
  pruneGroups(); updateSel(); scheduleSave(); msg('ungrouped');
}
function setGroupRole(role) {
  const id = currentGroupId();
  if (!id) { msg('select one group to give it a role'); return; }
  (groupMeta[id] = groupMeta[id] || { role: '' }).role = role;
  updateSel(); scheduleSave(); msg(`group role → ${role || 'none'}`);
}
// Reflect the current group + role in the GROUP tool controls.
function refreshGroupUI() {
  const id = currentGroupId();
  const sel = document.getElementById('group-role');
  const info = document.getElementById('group-info');
  if (sel) { sel.value = id ? (groupMeta[id]?.role || '') : ''; sel.disabled = !id; }
  if (info) {
    if (id) { const n = groupMates(selIndex).length; const r = groupMeta[id]?.role; info.textContent = `⛓ ${id} · ${n} parts${r ? ' · ' + r : ''}`; }
    else info.textContent = selIdxs().length ? 'ungrouped selection' : '';
  }
}

// Turn the SELECTED part(s) around the world origin's Y axis (a fixed 90° step). Bakes
// the turn into each part's transform — orbits its position about origin + spins its
// orientation — so it exports/round-trips (vs. just rotating the display group).
function rotateSelY(angle = Math.PI / 2) {
  const targets = (selSet.length ? selSet : (selIndex >= 0 ? [selIndex] : [])).map(i => parts()[i]).filter(Boolean);
  if (!targets.length) { msg('select a part to rotate'); return; }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  for (const m of targets) { m.position.applyQuaternion(q); m.quaternion.premultiply(q); }
  const sel = parts()[selIndex]; if (sel) selBox.box.setFromObject(sel);
  updateMultiSel(); refreshStats(); refreshCoords(); updateGizmo(); scheduleSave();
  msg('rotated part 90° around origin Y');
}
function setColor(hex) {
  const m = parts()[selIndex]; if (!m) return;
  m.material.color.set(hex); m.userData.mat.color = hex; m.userData.mat.team = false;   // a fixed colour is no longer team-driven
}
// Mark the selected part as TEAM-coloured: its colour now follows the COLOR menu.
function applyTeamColor() {
  const m = parts()[selIndex]; if (!m) return;
  const hex = '#' + new THREE.Color(TEAM_COLORS[accentIndex].hex).getHexString();
  m.material.color.set(hex); m.userData.mat.color = hex; m.userData.mat.team = true;
}
// Re-tint every team-flagged part to a new accent — WITHOUT rebuilding (keeps edits).
function applyAccent(hex) {
  const norm = '#' + new THREE.Color(hex).getHexString();
  for (const m of parts()) {
    if (m.userData.mat && m.userData.mat.team) { m.material.color.set(norm); m.userData.mat.color = norm; }
  }
  if (parts()[selIndex]) selBox.box.setFromObject(parts()[selIndex]);
}
// COLOUR map — its own slot now (no longer drags bump/spec along).
function applyTexture(kind) {
  const m = parts()[selIndex]; if (!m) return;
  const mat = m.material, u = m.userData.mat;
  if (kind === 'none') { mat.map = null; u.map = null; u.mapKind = null; }
  else {
    const { tex, url } = buildTex(kind, u.tile || [1, 1], u.rot || 0);
    mat.map = tex; mat.color.set('#ffffff');     // white base so the texture reads true
    // remember the procedural KIND so export can reference it by id (no fat base64);
    // u.map keeps the data URL only as a fallback for round-tripping.
    u.color = '#ffffff'; u.map = url; u.mapKind = kind; u.tile = u.tile || [1, 1];
  }
  mat.needsUpdate = true; refreshMatParams(); syncMapButtons();
}
// NORMAL map — an INDEPENDENT texture giving surface relief; works with no colour map.
// Derived from the chosen procedural texture (luminance = height); crisper than a bump map.
function applyNormalTex(kind) {
  const m = parts()[selIndex]; if (!m) return;
  const mat = m.material, u = m.userData.mat;
  if (!mat.isMeshStandardMaterial) return;   // normal maps need a lit material
  if (kind === 'none') { mat.normalMap = null; u.normalTex = null; u.normalKind = null; }
  else {
    const { tex, url } = buildNormalTex(kind, u.tile || [1, 1], u.rot || 0);
    const ns = u.normalScale ?? 1; mat.normalMap = tex; mat.normalScale.set(ns, ns);
    u.normalTex = url; u.normalKind = kind; u.normalScale = ns; u.tile = u.tile || [1, 1];
  }
  mat.needsUpdate = true;
}
// SPEC (roughness) map — an INDEPENDENT texture varying shininess; works with no colour map.
function applySpecTex(kind) {
  const m = parts()[selIndex]; if (!m) return;
  const mat = m.material, u = m.userData.mat;
  if (!mat.isMeshStandardMaterial) return;
  if (kind === 'none') { mat.roughnessMap = null; u.specTex = null; u.specKind = null; }
  else {
    const { tex, url } = buildTex(kind, u.tile || [1, 1], u.rot || 0);
    mat.roughnessMap = tex; u.specTex = url; u.specKind = kind; u.tile = u.tile || [1, 1];
  }
  mat.needsUpdate = true;
}
function setNormalScale(v) {
  const m = parts()[selIndex]; if (!m || !m.material.isMeshStandardMaterial) return;
  m.material.normalScale.set(v, v); m.userData.mat.normalScale = v; m.material.needsUpdate = true;
}
// One tiling drives every map slot the part has (colour / normal / spec).
function setTile(axis, v) {
  const m = parts()[selIndex]; if (!m) return;
  const mat = m.material, maps = [mat.map, mat.normalMap, mat.roughnessMap].filter(Boolean);
  if (!maps.length) return;
  for (const map of maps) { map.wrapS = map.wrapT = THREE.RepeatWrapping; if (axis === 'x') map.repeat.x = v; else map.repeat.y = v; map.needsUpdate = true; }
  m.userData.mat.tile = [maps[0].repeat.x, maps[0].repeat.y];
}
// Rotate every procedural map slot by a multiple of 90° (baked into the canvas, so a
// derived normal map stays correct). e.g. flips the metal ribs from vertical to horizontal.
function setRotation(deg) {
  const m = parts()[selIndex]; if (!m) return;
  const mat = m.material, u = m.userData.mat, rot = ((deg % 360) + 360) % 360; u.rot = rot;
  const tile = u.tile || [1, 1];
  if (u.mapKind) mat.map = buildTex(u.mapKind, tile, rot).tex;
  if (u.normalKind && mat.isMeshStandardMaterial) { const ns = u.normalScale ?? 1; mat.normalMap = buildNormalTex(u.normalKind, tile, rot).tex; mat.normalScale.set(ns, ns); }
  if (u.specKind && mat.isMeshStandardMaterial) mat.roughnessMap = buildTex(u.specKind, tile, rot).tex;
  mat.needsUpdate = true;
}
// Top-stack panel under MATERIAL: the active sub-tool's map controls — TILING for the
// slot it edits (colour / normal / spec), plus the NORMAL STRENGTH when that menu is open.
function refreshMatParams() {
  const wrap = document.getElementById('mat-params'); if (!wrap) return;
  const m = parts()[selIndex], mat = m ? m.material : null;
  // which map does the open sub-tool care about?
  const slot = !mat ? null : matSub === 'normal' ? mat.normalMap : matSub === 'specular' ? mat.roughnessMap : matSub === 'textures' ? mat.map : null;
  if (toolMode !== 'material' || !slot) { wrap.style.display = 'none'; wrap.innerHTML = ''; syncTopBox(); return; }
  wrap.style.display = 'flex';
  const u = m.userData.mat, tile = u.tile || [slot.repeat.x, slot.repeat.y];
  let html =
    `<span class="gmode">TILE</span>` +
    `<label>X</label><input id="mp-tx" type="number" step="0.5" min="0.1" value="${+tile[0].toFixed(2)}">` +
    `<label>Y</label><input id="mp-ty" type="number" step="0.5" min="0.1" value="${+tile[1].toFixed(2)}">` +
    `<label style="margin-left:8px">ROT°</label><input id="mp-rot" type="number" step="90" value="${(u.rot ?? 0)}">`;
  if (matSub === 'normal') html += `<label style="margin-left:10px">STRENGTH</label><input id="mp-bs" type="number" step="0.1" min="0" value="${(u.normalScale ?? 1)}">`;
  wrap.innerHTML = html;
  syncTopBox();
  document.getElementById('mp-tx').addEventListener('change', e => { const v = parseFloat(e.target.value); if (v > 0) setTile('x', v); });
  document.getElementById('mp-ty').addEventListener('change', e => { const v = parseFloat(e.target.value); if (v > 0) setTile('y', v); });
  const rt = document.getElementById('mp-rot'); if (rt) rt.addEventListener('change', e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { setRotation(v); refreshMatParams(); } });
  const bs = document.getElementById('mp-bs'); if (bs) bs.addEventListener('change', e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) setNormalScale(v); });
}

// ── Destruction staging (DAMAGE tool) ─────────────────────────────────────────
// Each part has fallAt (HP fraction it lets go at) + dmgStyle (tumble / squish). The
// preview scrubs HP and animates parts through their stages — DETERMINISTIC (a pure
// function of HP), so dragging the slider scrubs cleanly both ways. The real geometry
// transform is snapshotted (_dmg0) so editing/export ignore the preview pose.
const lerp = (a, b, t) => a + (b - a) * t;
const DMG_BAND = 0.18;   // HP span over which a triggered part fully gives way
const dmgActive = () => toolMode === 'damage';
function dmgSnapshot() {
  for (const m of parts()) {
    const u = m.userData;
    u._dmg0 = { pos: m.position.toArray(), rot: [m.rotation.x, m.rotation.y, m.rotation.z], scale: m.scale.toArray() };
    const a = Math.random() * Math.PI * 2;   // a stable per-part tumble direction for the preview
    u._dmgRest = { dx: Math.cos(a) * CELL * 0.45, dz: Math.sin(a) * CELL * 0.45, rx: (Math.random() - 0.5) * 2.6, ry: (Math.random() - 0.5) * 2.6, rz: (Math.random() - 0.5) * 2.6 };
  }
}
function dmgRestore() {
  for (const m of parts()) {
    const s0 = m.userData._dmg0;
    if (s0) { m.position.fromArray(s0.pos); m.rotation.set(s0.rot[0], s0.rot[1], s0.rot[2]); m.scale.fromArray(s0.scale); }
    delete m.userData._dmg0; delete m.userData._dmgRest;
  }
  if (parts()[selIndex]) selBox.box.setFromObject(parts()[selIndex]);
}
function applyDamagePreview() {
  const hp = dmgPreviewHP;
  for (const m of parts()) {
    const u = m.userData, s0 = u._dmg0; if (!s0) continue;
    const fa = u.fallAt ?? 0;
    let t = hp <= fa ? Math.min(1, (fa - hp) / DMG_BAND) : 0;   // 0 intact .. 1 fully gone
    t = t * t * (3 - 2 * t);   // smoothstep
    if (t <= 0) { m.position.fromArray(s0.pos); m.rotation.set(s0.rot[0], s0.rot[1], s0.rot[2]); m.scale.fromArray(s0.scale); continue; }
    if (u.dmgStyle === 'squish') {
      m.scale.set(s0.scale[0] * (1 + 0.3 * t), s0.scale[1] * (1 - 0.9 * t), s0.scale[2] * (1 + 0.3 * t));
      m.position.set(s0.pos[0], lerp(s0.pos[1], s0.pos[1] * 0.08, t), s0.pos[2]);
      m.rotation.set(s0.rot[0], s0.rot[1], s0.rot[2]);
    } else {   // tumble: slide outward + drop to rubble + spin
      const r = u._dmgRest;
      m.position.set(lerp(s0.pos[0], s0.pos[0] + r.dx, t), lerp(s0.pos[1], 0.25, t), lerp(s0.pos[2], s0.pos[2] + r.dz, t));
      m.scale.fromArray(s0.scale);
      m.rotation.set(s0.rot[0] + r.rx * t, s0.rot[1] + r.ry * t, s0.rot[2] + r.rz * t);
    }
  }
  if (parts()[selIndex] && selBox.visible) selBox.box.setFromObject(parts()[selIndex]);
}
function setFallAt(frac) {
  const m = parts()[selIndex]; if (!m) return;
  m.userData.fallAt = Math.max(0, Math.min(1, frac));
  if (dmgActive()) applyDamagePreview();
}
function setDmgStyle(style) {
  const m = parts()[selIndex]; if (!m) return;
  m.userData.dmgStyle = style;
  document.querySelectorAll('#tools-stack [data-dmgstyle]').forEach(b => b.classList.toggle('active', b.dataset.dmgstyle === style));
  if (dmgActive()) applyDamagePreview();
}
// Top-box rows for DAMAGE: a global HP scrub slider + the selected part's FALL@ %.
function refreshDmgParams() {
  const hpRow = document.getElementById('dmg-hp'), fallRow = document.getElementById('dmg-params');
  if (!dmgActive()) { hpRow.style.display = 'none'; fallRow.style.display = 'none'; syncTopBox(); return; }
  hpRow.style.display = 'flex';
  hpRow.innerHTML = `<span class="gmode">HP</span><input id="dmg-slider" type="range" min="0" max="100" value="${Math.round(dmgPreviewHP * 100)}"><span id="dmg-hpval">${Math.round(dmgPreviewHP * 100)}%</span>`;
  document.getElementById('dmg-slider').addEventListener('input', e => {
    dmgPreviewHP = (parseInt(e.target.value, 10) || 0) / 100;
    document.getElementById('dmg-hpval').textContent = Math.round(dmgPreviewHP * 100) + '%';
    applyDamagePreview();
  });
  const m = parts()[selIndex];
  if (!m) { fallRow.style.display = 'none'; syncTopBox(); return; }
  fallRow.style.display = 'flex';
  fallRow.innerHTML = `<span class="gmode">FALL@</span><input id="dmg-fall" type="number" min="0" max="100" step="5" value="${Math.round((m.userData.fallAt ?? 0) * 100)}"><label>% HP</label>`;
  document.getElementById('dmg-fall').addEventListener('change', e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) setFallAt(v / 100); });
  // reflect the part's style on the flyout buttons
  document.querySelectorAll('#tools-stack [data-dmgstyle]').forEach(b => b.classList.toggle('active', b.dataset.dmgstyle === (m.userData.dmgStyle || 'tumble')));
  syncTopBox();
}

// ── Export / import / save ───────────────────────────────────────────────────
// MINIMAL export: ship only what differs from the load-time defaults. Every omitted
// field is reconstructed by makeMat/addPart (which already default them), so it still
// round-trips exactly — just far smaller.
// Round each element to `dp` decimals, then drop trailing elements equal to `defv`
// (pos/rot → 0, scale → 1). Returns the shortened array, or null if all-default.
const trimTrail = (a, defv, dp = 3) => {
  if (!a) return null;
  const f = 10 ** dp;
  const r = a.map(v => Number.isInteger(v) ? v : Math.round(v * f) / f);
  let n = r.length;
  while (n > 0 && r[n - 1] === defv) n--;
  return n ? r.slice(0, n) : null;
};
// Recursively round every number to `dp` decimals (no crazy float precision in the file).
function roundNums(o, dp = 3) {
  const f = 10 ** dp;
  const walk = v => {
    if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * f) / f;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const r = {}; for (const k in v) r[k] = walk(v[k]); return r; }
    return v;
  };
  return walk(o);
}
// When a texture slot has pixels but no recognised KIND id (an untagged original from a
// decomposed asset, or an imported map), we refuse to bake a fat base64 data-URL into the
// export. Instead the slot falls back to this placeholder kind — tiny, and easy to spot and
// re-texture later. _texFallbacks counts how many slots were defaulted in the last export.
const FALLBACK_TEX = 'concrete';
let _texFallbacks = 0;
// A material reduced to its non-default fields. Every texture slot ships a KIND id
// (its own, or FALLBACK_TEX for an untagged one) — never a base64 data-URL.
function minimalMat(u) {
  const out = {};
  const mapKind = u.mapKind || (u.map ? (_texFallbacks++, FALLBACK_TEX) : null);
  const normalKind = u.normalKind || (u.normalTex ? (_texFallbacks++, FALLBACK_TEX) : null);
  const specKind = u.specKind || (u.specTex ? (_texFallbacks++, FALLBACK_TEX) : null);
  const hasMap = !!(mapKind || normalKind || specKind);
  if (u.kind === 'basic') out.kind = 'basic';
  if (u.color && u.color.toLowerCase() !== MAT_DEF.color) out.color = u.color;
  if (u.roughness != null && u.roughness !== MAT_DEF.roughness) out.roughness = u.roughness;   // default 0.8
  if (u.metalness != null && u.metalness !== MAT_DEF.metalness) out.metalness = u.metalness;   // default 0.1
  if (u.flatShading === false) out.flatShading = false;              // default true → only note when OFF
  if (u.emissive && u.emissive !== '#000000') { out.emissive = u.emissive; out.emissiveIntensity = u.emissiveIntensity ?? 1; }
  if (u.opacity != null && u.opacity !== 1) out.opacity = u.opacity;
  if (u.transparent) out.transparent = true;
  if (u.team) out.team = true;                                        // follows team colour
  if (mapKind) out.mapKind = mapKind;
  if (normalKind) out.normalKind = normalKind;
  if (normalKind && u.normalScale != null && u.normalScale !== 1) out.normalScale = u.normalScale;
  if (specKind) out.specKind = specKind;
  if (hasMap && u.tile && (u.tile[0] !== 1 || u.tile[1] !== 1)) out.tile = u.tile;
  if (hasMap && u.rot) out.rot = u.rot;
  return out;
}
function exportConfig() {
  _texFallbacks = 0;   // minimalMat bumps this per untagged texture slot it defaults
  const cfg = {
    id: meta.id, name: meta.name, category: meta.category, accent: meta.accent,
    destructible: meta.type === '—' ? null : { type: meta.type, hp: meta.hp },
    footprint: { w: meta.fw, d: meta.fd },
    parts: parts().map(m => {
      const u = m.userData;
      const editable = u.kind !== 'frozen';          // maps to a primitive (params known)
      // while the DAMAGE preview is scrubbed, the live transform is animated — the TRUE
      // (intact) transform is snapshotted in _dmg0, so export/save use that.
      const s0 = u._dmg0;
      const pos = s0 ? s0.pos : m.position.toArray();
      const rot = s0 ? s0.rot : [m.rotation.x, m.rotation.y, m.rotation.z];
      const scale = s0 ? s0.scale : m.scale.toArray();
      const part = { kind: editable ? u.kind : 'frozen' };
      // Round, then drop trailing default elements: pos/rot default 0, scale default 1.
      // So [-0.229, 0, 0] → [-0.229] and an identity transform vanishes entirely.
      const tp = trimTrail(pos, 0), tr = trimTrail(rot, 0), ts = trimTrail(scale, 1);
      if (tp) part.pos = tp;
      if (tr) part.rot = tr;
      if (ts) part.scale = ts;
      const mat = minimalMat(u.mat); if (Object.keys(mat).length) part.mat = mat;   // omit an all-default material
      if (u.fallAt) part.fallAt = u.fallAt;                          // default 0
      if (u.dmgStyle && u.dmgStyle !== 'tumble') part.dmgStyle = u.dmgStyle;
      if (u.group) part.group = u.group;                             // subassembly membership
      if (editable && u.parametric) {
        if (u.params && Object.keys(u.params).length) part.params = u.params;   // rebuild from params on load
      } else {
        part.geo = m.geometry.toJSON();              // ship the exact geometry…
        if (editable && u.params && Object.keys(u.params).length) part.params = u.params;   // …but KEEP params so it stays editable
      }
      return part;
    }),
  };
  // Group manifest: only groups that are actually used, with their role. The game
  // reads this to assemble each subassembly into a pivoted, role-tagged sub-group.
  const usedGroups = new Set(parts().map(m => m.userData.group).filter(Boolean));
  if (usedGroups.size) {
    cfg.groups = {};
    for (const id of usedGroups) cfg.groups[id] = { role: (groupMeta[id]?.role) || '' };
  }
  return roundNums(cfg, 3);
}
function importConfig(cfg, { silent = false } = {}) {
  clearModel();
  if (cfg.destructible) { meta.type = cfg.destructible.type; meta.hp = cfg.destructible.hp; }
  if (cfg.footprint) { meta.fw = cfg.footprint.w; meta.fd = cfg.footprint.d; }
  for (const p of cfg.parts) addPart({ kind: p.kind, params: p.params, geometry: p.geo, pos: p.pos, rot: p.rot, scale: p.scale, mat: p.mat, fallAt: p.fallAt, dmgStyle: p.dmgStyle, group: p.group });
  // Restore group roles + advance the id counter past any imported gN ids.
  groupMeta = {}; _gidNext = 1;
  if (cfg.groups) for (const [id, g] of Object.entries(cfg.groups)) {
    groupMeta[id] = { role: (g && g.role) || '' };
    const n = /^g(\d+)$/.exec(id); if (n) _gidNext = Math.max(_gidNext, +n[1] + 1);
  }
  if (!silent) { frameModel(); refreshStats(); }
}

// ── Stats / live measurement ─────────────────────────────────────────────────
function refreshStats() {
  document.getElementById('stats-name').textContent = meta.name.toUpperCase();
  // NAME is editable only for user-created assets (manifest names are code).
  const isUser = !!(currentAsset() && currentAsset().user);
  document.getElementById('s-name-row').style.display = isUser ? 'flex' : 'none';
  const nameEl = document.getElementById('s-name');
  if (nameEl && document.activeElement !== nameEl) nameEl.value = meta.name;
  document.getElementById('s-cat').textContent = meta.category;
  document.getElementById('s-hp').value = meta.hp;
  document.getElementById('s-hptype').textContent = meta.type === '—' ? '(indestructible)' : '(' + meta.type + ')';
  document.getElementById('s-fw').value = meta.fw;
  document.getElementById('s-fd').value = meta.fd;
  const box = new THREE.Box3().setFromObject(model);
  if (!box.isEmpty()) {
    const s = new THREE.Vector3(); box.getSize(s);
    document.getElementById('s-size').textContent = `${s.x.toFixed(1)}·${s.y.toFixed(1)}·${s.z.toFixed(1)}`;
    document.getElementById('s-meas').textContent = `${Math.max(1, Math.ceil((s.x - 1e-4) / CELL))} × ${Math.max(1, Math.ceil((s.z - 1e-4) / CELL))} cells`;
  } else { document.getElementById('s-size').textContent = '—'; document.getElementById('s-meas').textContent = '—'; }
  document.getElementById('s-parts').textContent = parts().length;
  refreshCoords();
}

// Live X/Y/Z position of the selected part (editable). Don't clobber a box the
// user is currently typing in.
// Which transform the X/Y/Z boxes reflect: scale/rotation follow the active
// tool, otherwise position (move / nothing selected).
function coordTarget() { return toolMode === 'scale' ? 'scale' : toolMode === 'rotate' ? 'rotation' : 'position'; }
const vertexCoordActive = () => singleVertGroup() >= 0 && parts()[selIndex];
function refreshCoords() {
  const coordsEl = document.getElementById('coords');
  // MATERIAL / DAMAGE modes don't edit position/scale/rotation → drop the X/Y/Z bar.
  if (toolMode === 'material' || toolMode === 'damage') { coordsEl.style.display = 'none'; syncTopBox(); return; }
  coordsEl.style.display = 'flex';
  // VERTEX mode: the boxes show/set the selected vertex's local position.
  if (vertexCoordActive()) {
    document.getElementById('coord-mode').textContent = 'VERT';
    const pos = parts()[selIndex].geometry.attributes.position, i0 = vertGroups[singleVertGroup()][0];
    for (const [id, c] of [['cx', 0], ['cy', 1], ['cz', 2]]) {
      const el = document.getElementById(id); el.disabled = false;
      if (document.activeElement === el) continue;
      el.value = +pos.getComponent(i0, c).toFixed(2);
    }
    syncTopBox(); return;
  }
  const m = parts()[selIndex];
  const tgt = coordTarget();
  document.getElementById('coord-mode').textContent = tgt === 'scale' ? 'SCALE' : tgt === 'rotation' ? 'ROT°' : 'POS';
  for (const [ax, id] of [['x', 'cx'], ['y', 'cy'], ['z', 'cz']]) {
    const el = document.getElementById(id);
    el.disabled = !m;
    if (document.activeElement === el) continue;
    if (!m) { el.value = ''; continue; }
    let v = m[tgt][ax];
    if (tgt === 'rotation') v *= 180 / Math.PI;   // show rotation in degrees
    el.value = +v.toFixed(2);
  }
  syncTopBox();
}
[['x', 'cx', 0], ['y', 'cy', 1], ['z', 'cz', 2]].forEach(([ax, id, comp]) => {
  document.getElementById(id).addEventListener('change', e => {
    const v = parseFloat(e.target.value); if (Number.isNaN(v)) return;
    if (vertexCoordActive()) { setVertexComponent(comp, snapVal(v)); return; }
    const m = parts()[selIndex]; if (!m) return;
    const tgt = coordTarget();
    if (tgt === 'rotation') m.rotation[ax] = snapVal(v) * Math.PI / 180;
    else if (tgt === 'scale') m.scale[ax] = Math.max(0.05, snapVal(v));
    else m.position[ax] = snapVal(v);
    selBox.box.setFromObject(m); refreshStats();
  });
});

// ── UI: collapsible widgets ──────────────────────────────────────────────────
document.querySelectorAll('.wbtn[data-toggle]').forEach(btn =>
  btn.addEventListener('click', () => { document.getElementById(btn.dataset.toggle).classList.toggle('open'); syncTopBox(); }));

// asset list = the shared MANIFEST assets + the user's own NEW assets (kept in
// localStorage). User assets have no code maker — they live entirely as a saved
// config + a small index entry, so they reappear on reload like any other.
const listEl = document.getElementById('assets-list');
const USER_KEY = 'assetdesigner:userlist';
function loadUserIndex() {
  try { const a = JSON.parse(localStorage.getItem(USER_KEY)); return Array.isArray(a) ? a.map(x => ({ ...x, user: true })) : []; }
  catch (e) { return []; }
}
function saveUserIndex() { try { localStorage.setItem(USER_KEY, JSON.stringify(userAssets)); } catch (e) { /* private/full */ } }
let userAssets = loadUserIndex();
const allAssets = () => ASSETS.concat(userAssets);
const currentAsset = () => allAssets()[activeIndex];

function rebuildAssetList() {
  const rows = allAssets().map((a, i) =>
    `<button data-index="${i}"${a.user ? ' class="user"' : ''}>${a.name.toUpperCase()}` +
    `${a.user ? `<span class="del-asset" data-del="${i}" title="delete asset">✕</span>` : ''}</button>`).join('');
  listEl.innerHTML = rows + `<button id="new-asset-btn">+ NEW ASSET</button>`;
  listEl.querySelectorAll('button[data-index]').forEach(b => b.addEventListener('click', e => {
    if (e.target.classList.contains('del-asset')) return;
    loadAsset(parseInt(b.dataset.index, 10));
  }));
  listEl.querySelectorAll('.del-asset').forEach(s => s.addEventListener('click', e => { e.stopPropagation(); deleteUserAsset(parseInt(s.dataset.del, 10)); }));
  const nb = document.getElementById('new-asset-btn'); if (nb) nb.addEventListener('click', () => newAsset());
  refreshAssetTabs();
}
function refreshAssetTabs() { listEl.querySelectorAll('button[data-index]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.index, 10) === activeIndex)); }

// Create a fresh blank asset (a single starter box) and open it.
function newAsset(presetName) {
  const def = `Custom ${userAssets.length + 1}`;
  const name = presetName != null ? String(presetName).trim() : ((window.prompt('New asset name:', def) || '').trim());
  if (!name) return null;
  const a = { id: 'user-' + Date.now().toString(36) + Math.floor(Math.random() * 1e3), name,
    category: 'custom', accent: true, destructible: { type: 'building', hp: 100 }, footprint: { w: 1, d: 1 }, user: true };
  userAssets.push(a); saveUserIndex(); rebuildAssetList();
  loadAsset(allAssets().length - 1, { fresh: true });   // → starter box
  saveLocal();   // persist the starter so it survives a reload
  msg('created "' + name + '"');
  return a.id;
}
function deleteUserAsset(i) {
  const a = allAssets()[i]; if (!a || !a.user) return;
  if (typeof window.confirm === 'function' && !window.confirm(`Delete asset "${a.name}"? This can't be undone.`)) return;
  flushSave();
  try { localStorage.removeItem(LS_KEY(a.id)); } catch (e) { /* ignore */ }
  const ui = userAssets.indexOf(a); if (ui >= 0) userAssets.splice(ui, 1);
  saveUserIndex(); rebuildAssetList();
  loadAsset(0);   // fall back to the first manifest asset
  msg('deleted "' + a.name + '"');
}
rebuildAssetList();

// colors (all team colours)
const colorsEl = document.getElementById('colors-list');
colorsEl.innerHTML = TEAM_COLORS.map((c, i) => `<button class="accent-sw${i === 0 ? ' active' : ''}" data-index="${i}" style="background:${c.hex}" title="${c.name}"></button>`).join('');
colorsEl.querySelectorAll('.accent-sw').forEach(b => b.addEventListener('click', () => {
  accentIndex = parseInt(b.dataset.index, 10);
  colorsEl.querySelectorAll('.accent-sw').forEach(x => x.classList.remove('active')); b.classList.add('active');
  applyAccent(TEAM_COLORS[accentIndex].hex);   // re-tint team-coloured parts only; keeps edits
  updateTeamSwatch();
}));

// MATERIAL nested flyout: MATERIAL → [COLORS, TEXTURES, SPECULAR, NORMAL] sub-tools,
// each of which flies its own samples/options further left. Leaf buttons keep their
// data-* hooks so one set of listeners (queried under #material-kids) wires them all.
const MAT_PALETTE = ['#e8e8e8', '#9a948a', '#6f6a61', '#3b3f44', ...TEAM_COLORS.slice(0, 4).map(c => c.hex)];
const texSwatches = Object.keys(TEX).map(k => {
  let url = ''; try { url = TEX[k]().image.toDataURL(); } catch (e) { /* ignore */ }
  return `<button class="sw tex" data-tex="${k}" title="${k}" style="background-image:url(${url})"></button>`;
}).join('');
const noneSwatch = `<button class="sw none-sw" data-tex="none" title="no texture">∅</button>`;
const teamSwatch = `<button class="sw team-sw" data-team="1" title="team colour (follows the COLOR menu)">T</button>`;
const colorSwatches = MAT_PALETTE.map(h => `<button class="sw" style="background:${h}" data-color="${h}"></button>`).join('');
// NORMAL + SPEC are independent texture pickers now (∅ + the same texture swatches).
const texSwatchesFor = (attr) => `<button class="sw none-sw" ${attr}="none" title="no map">∅</button>` + Object.keys(TEX).map(k => {
  let url = ''; try { url = TEX[k]().image.toDataURL(); } catch (e) { /* ignore */ }
  return `<button class="sw tex" ${attr}="${k}" title="${k}" style="background-image:url(${url})"></button>`;
}).join('');
document.getElementById('sub-textures').innerHTML = texSwatches + noneSwatch;
document.getElementById('sub-colors').innerHTML = teamSwatch + colorSwatches;
document.getElementById('sub-normal').innerHTML = texSwatchesFor('data-normaltex');
document.getElementById('sub-specular').innerHTML = texSwatchesFor('data-spectex');

document.querySelectorAll('#material-kids [data-tex]').forEach(b => b.addEventListener('click', () => applyTexture(b.dataset.tex)));
document.querySelectorAll('#material-kids [data-team]').forEach(b => b.addEventListener('click', applyTeamColor));
document.querySelectorAll('#material-kids [data-color]').forEach(b => b.addEventListener('click', () => setColor(b.dataset.color)));
document.querySelectorAll('#material-kids [data-normaltex]').forEach(b => b.addEventListener('click', () => { applyNormalTex(b.dataset.normaltex); syncMapButtons(); refreshMatParams(); }));
document.querySelectorAll('#material-kids [data-spectex]').forEach(b => b.addEventListener('click', () => { applySpecTex(b.dataset.spectex); syncMapButtons(); refreshMatParams(); }));
function updateTeamSwatch() { const el = document.querySelector('#material-kids .team-sw'); if (el) el.style.background = TEAM_COLORS[accentIndex].hex; }
updateTeamSwatch();

// Reflect the selected part's normal/spec state — highlight ∅ when that slot is empty.
function syncMapButtons() {
  const m = parts()[selIndex], mat = m ? m.material : null;
  document.querySelectorAll('#sub-normal [data-normaltex="none"]').forEach(b => b.classList.toggle('active', !mat || !mat.normalMap));
  document.querySelectorAll('#sub-specular [data-spectex="none"]').forEach(b => b.classList.toggle('active', !mat || !mat.roughnessMap));
}

// Sub-tool buttons: open one set of samples at a time, flying further left.
document.querySelectorAll('.subtool > .subtool-btn').forEach(btn => {
  const sub = btn.parentElement;
  btn.addEventListener('click', () => {
    const opening = !sub.classList.contains('active');
    document.querySelectorAll('.subtool').forEach(x => x.classList.remove('active'));
    matSub = opening ? sub.dataset.sub : null;
    if (opening) { sub.classList.add('active'); if (matSub === 'specular' || matSub === 'normal') syncMapButtons(); }
    refreshMatParams();   // TILING pops in only under TEXTURES
  });
});

// SNAP: a compact button that pops a value list (like the COLOR button) — keeps the
// coords row narrow so it doesn't wrap on a phone.
const snapBtn = document.getElementById('snap-btn');
const snapPop = document.getElementById('snap-pop');
// The button keeps a fixed "⊞ SNAP" label (like COLOR); the current value shows as the
// highlighted option when the picker is open.
function updateSnapBtn() {
  snapPop.querySelectorAll('button').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.snap) === snap));
}
snapBtn.addEventListener('click', e => { e.stopPropagation(); updateSnapBtn(); snapPop.classList.toggle('open'); });
snapPop.querySelectorAll('button[data-snap]').forEach(b => b.addEventListener('click', () => {
  snap = parseFloat(b.dataset.snap) || 0; updateSnapBtn(); snapPop.classList.remove('open');
}));
document.addEventListener('click', () => snapPop.classList.remove('open'));   // close on any outside click
updateSnapBtn();

// stats inputs
document.getElementById('s-name').addEventListener('change', e => {
  const a = currentAsset(); if (!a || !a.user) return;
  const nm = e.target.value.trim(); if (!nm) { e.target.value = meta.name; return; }
  meta.name = nm; a.name = nm; saveUserIndex(); rebuildAssetList(); refreshStats();
});
document.getElementById('s-hp').addEventListener('change', e => { meta.hp = parseInt(e.target.value, 10) || 0; });
document.getElementById('s-fw').addEventListener('change', e => { meta.fw = Math.max(1, parseInt(e.target.value, 10) || 1); });
document.getElementById('s-fd').addEventListener('change', e => { meta.fd = Math.max(1, parseInt(e.target.value, 10) || 1); });

// export / import / save / reset / AUTOSAVE
const msg = (t) => { document.getElementById('export-msg').textContent = t; };
const LS_KEY = (id) => 'assetdesigner:' + id;
let saveTimer = null;

// ── Undo / redo ───────────────────────────────────────────────────────────────
// A history of SETTLED states (each a serialised exportConfig). recordHistory runs
// on the same path as autosave (an edit settling), banking the PRIOR state so undo
// can return to it; restoreState replays a snapshot without re-recording. History is
// per-asset — switching assets resets it.
const UNDO_MAX = 40;
let undoStack = [], redoStack = [], present = null, applyingHistory = false;
function snapshotState() { try { return JSON.stringify(exportConfig()); } catch (e) { return null; } }
function updateUndoButtons() {
  const u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}
function resetHistory() { undoStack = []; redoStack = []; present = snapshotState(); updateUndoButtons(); }
function recordHistory() {
  if (applyingHistory) return;
  const s = snapshotState(); if (s == null || s === present) return;
  if (present != null) { undoStack.push(present); if (undoStack.length > UNDO_MAX) undoStack.shift(); }
  present = s; redoStack = [];   // a fresh edit invalidates the redo trail
  updateUndoButtons();
}
function restoreState(s) {
  applyingHistory = true;
  try { importConfig(JSON.parse(s), { silent: true }); selIndex = -1; if (elemMode()) clearVertHandles(); updateSel(); }
  finally { applyingHistory = false; }
  present = s;
  try { localStorage.setItem(LS_KEY(meta.id), s); } catch (e) { /* quota — the edit still applied */ }
  updateUndoButtons();
}
function undo() { if (!undoStack.length) { msg('nothing to undo'); return; } redoStack.push(present); restoreState(undoStack.pop()); msg('undo ✓'); }
function redo() { if (!redoStack.length) { msg('nothing to redo'); return; } undoStack.push(present); restoreState(redoStack.pop()); msg('redo ✓'); }

// Persist the working asset to localStorage (quota-guarded). exportConfig captures
// every part + geometry/material, so reopening this asset restores the edits.
function saveLocal() {
  recordHistory();   // bank the just-settled state for undo (same trigger as autosave)
  try {
    localStorage.setItem(LS_KEY(meta.id), JSON.stringify(exportConfig()));
    msg('saved locally ✓'); flashSaved('saved ✓');
  } catch (e) {
    msg('⚠ save failed: ' + (e && e.name === 'QuotaExceededError' ? 'storage full — EXPORT to back up' : (e && e.message)));
    flashSaved('save failed');
  }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 500); }   // debounced: a drag = one write
function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveLocal(); } }   // save NOW (e.g. before switching asset)
function flashSaved(t) {
  const el = document.getElementById('save-dot'); if (!el) return;
  el.textContent = t; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1500);
}
// Discard this asset's local save and rebuild it from the code default.
function resetAsset() {
  clearTimeout(saveTimer); saveTimer = null;       // drop any pending autosave first
  localStorage.removeItem(LS_KEY(meta.id));
  loadAsset(activeIndex, { fresh: true });
  msg('reset to code default'); flashSaved('reset');
}

document.getElementById('btn-export').addEventListener('click', () => {
  document.getElementById('export-text').value = JSON.stringify(exportConfig());
  msg('exported ' + parts().length + ' parts' + (_texFallbacks ? ` — ${_texFallbacks} untagged texture${_texFallbacks > 1 ? 's' : ''} defaulted to ${FALLBACK_TEX}` : ''));
});
document.getElementById('btn-import').addEventListener('click', () => {
  try { const cfg = JSON.parse(document.getElementById('export-text').value); importConfig(cfg); saveLocal(); msg('imported ' + parts().length + ' parts'); }
  catch (e) { msg('✗ invalid JSON: ' + e.message); }
});
document.getElementById('btn-save').addEventListener('click', saveLocal);
const _resetBtn = document.getElementById('btn-reset'); if (_resetBtn) _resetBtn.addEventListener('click', resetAsset);
const _undoBtn = document.getElementById('btn-undo'); if (_undoBtn) _undoBtn.addEventListener('click', undo);
const _redoBtn = document.getElementById('btn-redo'); if (_redoBtn) _redoBtn.addEventListener('click', redo);
// Keyboard: Ctrl/Cmd+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo (ignored while typing in a field).
window.addEventListener('keydown', e => {
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  // Delete / Backspace — remove the selected part(s), no modifier needed
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
  else if (k === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelected() : groupSelected(); }
});
document.getElementById('btn-group').addEventListener('click', groupSelected);
document.getElementById('btn-ungroup').addEventListener('click', ungroupSelected);
document.getElementById('group-role').addEventListener('change', e => setGroupRole(e.target.value));

// AUTOSAVE: persist shortly after any edit gesture (a drag, a tap on a tool/swatch, a
// typed value), debounced so a drag is a single write. Loading an asset isn't a user
// gesture, so a freshly-opened code default isn't written until you actually touch it.
['pointerup', 'change'].forEach(ev => document.addEventListener(ev, scheduleSave, true));

// tools (flyout to the left; tapping the active parent collapses it)
document.querySelectorAll('.tool > .tool-btn').forEach(btn => {
  const tool = btn.parentElement;
  btn.addEventListener('click', () => {
    const t = tool.dataset.tool;
    if (t === 'delete') { deleteSelected(); return; }
    if (t === 'dupe') { duplicateSelected(); return; }     // immediate action, no flyout
    if (t === 'extrude') { extrudeSelection(); return; }   // immediate action, no flyout
    const opening = !tool.classList.contains('active');
    document.querySelectorAll('.tool').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tool-kids button[data-axis]').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.subtool').forEach(x => x.classList.remove('active'));   // collapse MATERIAL's nested menus
    matSub = null;   // leaving/entering a tool collapses MATERIAL's sub-menus
    if (dmgActive()) dmgRestore();   // leaving DAMAGE: put the asset back together
    if (opening) { tool.classList.add('active'); toolMode = t; toolAxis = null; }
    else { toolMode = null; toolAxis = null; }
    if (toolMode === 'damage') { dmgSnapshot(); dmgPreviewHP = 1; }   // enter DAMAGE: snapshot, start intact
    updateHint();
  });
});
document.querySelectorAll('.tool-kids button[data-geo]').forEach(b => b.addEventListener('click', () => addMesh(b.dataset.geo)));
document.querySelectorAll('.tool-kids button[data-dmgstyle]').forEach(b => b.addEventListener('click', () => setDmgStyle(b.dataset.dmgstyle)));
document.querySelectorAll('.tool-kids button[data-cuts]').forEach(b => b.addEventListener('click', () => subdivideMesh(parseInt(b.dataset.cuts, 10))));
document.querySelectorAll('.tool-kids button[data-axis]').forEach(b => b.addEventListener('click', () => {
  b.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active');
  toolAxis = b.dataset.axis; updateHint();
}));
document.querySelectorAll('.tool-kids button[data-quadflip]').forEach(b => b.addEventListener('click', flipQuad));
document.querySelectorAll('.tool-kids button[data-spiny]').forEach(b => b.addEventListener('click', () => rotateSelY()));
// element-selection mode toolbar (Blender-style: OBJECT / VERTEX / EDGE / FACE)
document.querySelectorAll('.selmode-btn').forEach(b => b.addEventListener('click', () => setSelMode(b.dataset.selmode)));
// selection-op toolbar (left): NORMAL / ADD / SUBTRACT modes + a SELECT-ALL action
document.querySelectorAll('.selop-btn').forEach(b => b.addEventListener('click', () => setSelOp(b.dataset.selop)));
document.querySelectorAll('.selact-btn').forEach(b => b.addEventListener('click', () => { if (b.dataset.selact === 'all') selectAllElements(); }));
function updateHint() {
  let txt;
  if (elemMode()) {
    const lbl = selMode.toUpperCase(), op = selOp === 'normal' ? '' : ` [${selOp.toUpperCase()}]`;
    const n = selElems.length;
    const lblN = n > 1 ? (selMode === 'vertex' ? 'VERTICES' : lbl + 'S') : lbl;
    txt = !hasSel() ? `TAP A ${lbl}${op} to select  •  OBJECT mode edits the whole part`
      : toolAxis ? `DRAG = ${(toolMode || 'MOVE').toUpperCase()} ${n} ${lblN} ${toolAxis.toUpperCase()}  •  tap${op} to pick more`
      : `${n} ${lblN} SELECTED${op}  •  pick MOVE/SCALE/ROTATE + an axis to edit`;
  }
  else if (transformActive()) txt = `DRAG = ${toolMode.toUpperCase()} ${toolAxis.toUpperCase()}  •  tap ${toolMode.toUpperCase()} to exit`;
  else txt = 'TAP = SELECT • SHIFT-TAP = MULTI • DRAG = ORBIT • PINCH = ZOOM';
  document.getElementById('hint').textContent = txt;
  // the shared top box reshapes to the active tool: coords (pos/scale/rot/vert) +
  // geom params when editing geometry; tiling only under MATERIAL ▸ TEXTURES.
  refreshCoords();
  refreshGeomParams();
  refreshMatParams();
  refreshDmgParams();
  updateGizmo();
}

// ── Pointer: tap=select, 1-finger drag=orbit/transform, 2-finger=pinch ───────
const canvas = renderer.domElement;
const pts = new Map();   // pointerId -> {x,y}
let dragId = null, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false, pinchD = 0, orbitBtn = false, panDrag = false;
let gizmoDrag = null;   // {x,y} screen-space axis direction while dragging a gizmo arrow
const dist2 = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };

canvas.addEventListener('pointerdown', e => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // MIDDLE mouse (button 1) always orbits, even when a transform tool is armed.
  if (pts.size === 1) {
    dragId = e.pointerId; lastX = downX = e.clientX; lastY = downY = e.clientY; moved = false;
    orbitBtn = e.button === 1; if (orbitBtn) e.preventDefault();
    panDrag = orbitBtn && e.shiftKey;   // shift + middle mouse → pan (Blender-style)
    // grab a gizmo arrow? → lock that axis and drag-transform along it
    gizmoDrag = null;
    if (!orbitBtn) {
      const ax = raycastGizmo(e.clientX, e.clientY);
      if (ax) { toolAxis = ax; highlightAxisButton(ax); const o = gizmoOrigin(); gizmoDrag = o ? axisScreenDir(ax, o) : { x: 1, y: 0 }; }
    }
  }
  else if (pts.size === 2) { pinchD = dist2(); dragId = null; gizmoDrag = null; panDrag = false; }
});
canvas.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size >= 2) {
    const d = dist2();
    if (pinchD) { camRadius = Math.max(4, Math.min(140, camRadius * (pinchD / d))); updateCamera(); }
    pinchD = d; return;
  }
  if (e.pointerId !== dragId) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > SLOP) moved = true;
  if (gizmoDrag) {   // dragging an arrow → motion projected onto its screen axis
    const along = dx * gizmoDrag.x + dy * gizmoDrag.y;
    if (elemMode()) applyElementTransform(along); else applyTransform(along);
  }
  else if (panDrag) panCamera(dx, dy);   // shift + middle mouse → pan
  else if (!orbitBtn && elemDragActive()) applyElementTransform(dx);
  else if (!orbitBtn && transformActive()) applyTransform(dx);
  else { camTheta -= dx * 0.008; camPhi = Math.max(0.1, Math.min(1.5, camPhi - dy * 0.008)); updateCamera(); }
});
function endPointer(e) {
  const wasDrag = e.pointerId === dragId;
  pts.delete(e.pointerId);
  if (wasDrag) {
    if (!moved && !orbitBtn && !gizmoDrag) {
      if (elemMode()) {
        const groups = pickElement(downX, downY);
        if (groups) applyPick(groups, e.shiftKey);   // SHIFT adds/toggles the element
        else { raycastSelect(downX, downY); buildVertHandles(); selElems = []; updateElemHilite(); }
      }
      // a clean tap reselects even while a MOVE/SCALE/ROTATE tool is armed;
      // SHIFT-tap toggles the part in/out of a multi-selection.
      else raycastSelect(downX, downY, e.shiftKey);
    }
    dragId = null; orbitBtn = false; gizmoDrag = null; panDrag = false;
  }
  if (pts.size === 1) { const [id, p] = [...pts.entries()][0]; dragId = id; lastX = downX = p.x; lastY = downY = p.y; moved = true; }
  if (pts.size >= 2) pinchD = dist2();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => { e.preventDefault(); camRadius = Math.max(4, Math.min(140, camRadius + e.deltaY * 0.02)); updateCamera(); }, { passive: false });

window.addEventListener('resize', () => {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
});

// ── Thumbnail mode (used by ~/pw/make-thumbs.js) ─────────────────────────────
function thumbMode(on) {
  thumb = on;
  scene.background = on ? null : new THREE.Color(0x0a1812);
  document.documentElement.style.background = on ? 'transparent' : '';
  document.body.style.background = on ? 'transparent' : '';
  gridHelper.visible = !on; selBox.visible = on ? false : (selIndex >= 0);
  ['w-assets', 'w-export', 'w-colors', 'w-stats', 'w-tools', 'w-selmode', 'w-selop', 'hint', 'top-center'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = on ? 'none' : '';
  });
  container.style.top = on ? '0' : '';
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
  frameModel();
}

// ── Debug / headless hooks ───────────────────────────────────────────────────
window.__model = () => model;   // headless tests fingerprint the rendered meshes
window.AD = {
  assets: ASSETS,
  select: (i) => loadAsset(i, { fresh: true }),   // fresh = ignore localStorage (thumbnails want code default)
  thumbMode,
  selectPart: (i) => { selIndex = i; selSet = i >= 0 ? [i] : []; updateSel(); },
  shiftSelect: (i) => { const at = selSet.indexOf(i); if (at >= 0) selSet.splice(at, 1); else selSet.push(i); selIndex = selSet.length ? selSet[selSet.length - 1] : -1; updateSel(); },
  selObjCount: () => selSet.length,
  partCount: () => parts().length,
  addMesh, deleteSelected, duplicateSelected, setColor, applyTexture, applyTeamColor,
  setAccent: (i) => { accentIndex = i; applyAccent(TEAM_COLORS[i].hex); },
  partHasMap: (i) => !!(parts()[i] && parts()[i].material.map),
  partTeam: (i) => !!(parts()[i] && parts()[i].userData.mat && parts()[i].userData.mat.team),
  // texture-map hooks (headless): tiling, normal, spec + a readback
  matTile: (x, y) => { setTile('x', x); setTile('y', y); },
  matNormal: (kind, scale) => { applyNormalTex(kind); if (scale != null) setNormalScale(scale); },
  matRot: (deg) => setRotation(deg),
  matSpec: (kind) => applySpecTex(kind),
  // damage-staging hooks (headless)
  damageMode: (on) => { if (dmgActive()) dmgRestore(); toolMode = on ? 'damage' : null; if (on) { dmgSnapshot(); dmgPreviewHP = 1; } },
  setFall: (i, frac) => { selIndex = i; setFallAt(frac); },
  setStyle: (i, s) => { selIndex = i; setDmgStyle(s); },
  previewHP: (frac) => { dmgPreviewHP = frac; applyDamagePreview(); },
  partPos: (i) => { const m = parts()[i]; return m ? m.position.toArray() : null; },
  partScale: (i) => { const m = parts()[i]; return m ? m.scale.toArray() : null; },
  partFall: (i) => { const m = parts()[i]; return m ? { fallAt: m.userData.fallAt, style: m.userData.dmgStyle } : null; },
  partMaps: (i) => { const m = parts()[i]; if (!m) return null; const t = m.material, a = t.map || t.normalMap || t.roughnessMap; return { map: !!t.map, normal: !!t.normalMap, spec: !!t.roughnessMap, normalScale: t.normalScale ? t.normalScale.x : null, tile: a ? [a.repeat.x, a.repeat.y] : null }; },
  setGeomParam: (key, val) => { const m = parts()[selIndex]; if (m && m.userData.kind !== 'frozen') { m.userData.params[key] = val; rebuildGeo(); } },
  partKind: (i) => parts()[i] ? parts()[i].userData.kind : null,
  partColor: (i) => parts()[i] ? '#' + parts()[i].material.color.getHexString() : null,
  transform: (op, axis, delta) => { toolMode = op; toolAxis = axis; applyTransform(delta); },
  // element-edit hooks (headless): set mode, count welded groups, pick + move sub-geometry
  setSelMode,
  selMode: () => selMode,
  vertexMode: (on) => setSelMode(on ? 'vertex' : 'object'),
  vertGroupCount: () => (vertGroups ? vertGroups.length : 0),
  setSelOp, selOp: () => selOp, selectAll: selectAllElements,
  selCount: () => selGroupSet().length, selElemCount: () => selElems.length,
  pickVertex: (i, add) => applyPick([i], add),
  pickEdge: (a, b, add) => applyPick([a, b], add),
  pickFace: (a, b, c, add) => applyPick([a, b, c], add),
  pan: (dx, dy) => panCamera(dx, dy),
  camInfo: () => ({ pos: camera.position.toArray(), target: target.toArray() }),
  moveVertex: (axis, delta) => { toolMode = 'move'; toolAxis = axis; applyElementTransform(delta); },
  moveElement: (op, axis, delta) => { toolMode = op; toolAxis = axis; applyElementTransform(delta); },
  extrude: extrudeSelection, subdivide: subdivideMesh, flipQuad,
  newAsset, deleteAsset: deleteUserAsset, assetCount: () => allAssets().length,
  assetMeta: () => ({ id: meta.id, name: meta.name, category: meta.category, user: !!(currentAsset() && currentAsset().user) }),
  triCount: () => { const g = parts()[selIndex] && parts()[selIndex].geometry; return g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0; },
  vertPos: (i) => { const m = parts()[selIndex]; if (!m || !vertGroups) return null; const p = m.geometry.attributes.position, g = vertGroups[i]; return [p.getX(g[0]), p.getY(g[0]), p.getZ(g[0])]; },
  setSnap: (s) => { snap = s; },
  undo, redo, undoDepth: () => undoStack.length, redoDepth: () => redoStack.length,
  gizmoVisible: () => gizmo.visible, gizmoOrigin: () => { const o = gizmoOrigin(); return o ? o.toArray() : null; },
  partDir: (i = selIndex) => { const m = parts()[i]; return m ? new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion).toArray().map(v => +v.toFixed(3)) : null; },
  duplicate: duplicateSelected, recordHistory, rotateSelY,
  group: groupSelected, ungroup: ungroupSelected, setGroupRole,
  groupOf: (i = selIndex) => (parts()[i] ? parts()[i].userData.group || null : null),
  groupMeta: () => JSON.parse(JSON.stringify(groupMeta)),
  setMeta: (k, v) => { meta[k] = v; refreshStats(); },
  exportConfig, importConfig,
  measureAll: () => ASSETS.map(a => {
    const g = a.make(CELL, new THREE.Color('#c0392b')); g.updateMatrixWorld(true);
    const s = new THREE.Vector3(); new THREE.Box3().setFromObject(g).getSize(s);
    return { id: a.id, footprint: a.footprint, measured: { w: Math.max(1, Math.ceil((s.x - 1e-4) / CELL)), d: Math.max(1, Math.ceil((s.z - 1e-4) / CELL)) } };
  }),
};

// ── Boot ──────────────────────────────────────────────────────────────────────
// Reopen the asset you last had open (autosaved), falling back to the first one.
let _startIdx = 0;
try { const v = parseInt(localStorage.getItem('assetdesigner:_last'), 10); if (Number.isInteger(v) && v >= 0 && v < allAssets().length) _startIdx = v; } catch (e) { /* private mode */ }
loadAsset(_startIdx);
setSelMode('object');
setSelOp('normal');
updateCamera();
(function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); })();
