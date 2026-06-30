// Texture Lab — tune the game's procedural CanvasTextures live, on a flat swatch AND a
// 3D tent / box, then EXPORT the params so they can be baked into rmrf/js/Textures.js.
// Self-contained (its own parameterised generators) so it runs straight off the box; the
// generators mirror Textures.js but take an options object so every knob is a slider.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── canvas helpers (same toolkit as Textures.js) ─────────────────────────────
const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v;
function speckle(ctx, s, amt, n) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 2 - 1) * amt | 0;
    ctx.fillStyle = `rgba(${v < 0 ? 0 : 255},${v < 0 ? 0 : 255},${v < 0 ? 0 : 255},${Math.abs(v) / 255})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
  }
}
function softBlob(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function wrapBlob(ctx, s, x, y, r, rgb, a) {
  for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) softBlob(ctx, x + dx, y + dy, r, rgb, a);
}
function tileLattice(c) { const g = []; for (let y = 0; y < c; y++) { g[y] = []; for (let x = 0; x < c; x++) g[y][x] = Math.random(); } return g; }
function sampleLattice(g, c, u, v) {
  const sm = t => t * t * (3 - 2 * t);
  const fx = u * c, fy = v * c, x0 = Math.floor(fx) % c, y0 = Math.floor(fy) % c, x1 = (x0 + 1) % c, y1 = (y0 + 1) % c;
  const tx = sm(fx - Math.floor(fx)), ty = sm(fy - Math.floor(fy));
  return (g[y0][x0] * (1 - tx) + g[y0][x1] * tx) * (1 - ty) + (g[y1][x0] * (1 - tx) + g[y1][x1] * tx) * ty;
}

// ── generator registry ───────────────────────────────────────────────────────
// Each: { label, size, params:[{k,label,min,max,step,def}|{k,type:'color',def}], draw(ctx,s,o) }
const GEN = {
  fabric: {
    label: 'Tent fabric', size: 128, tint: '#5f7a37',
    params: [
      { k: 'base', type: 'color', def: '#d8d4cc', label: 'Base' },
      { k: 'g1Strength', label: '◐ Inner-dark strength', min: 0, max: 1, step: 0.01, def: 0.24 },
      { k: 'g1Radius', label: '◐ Inner-dark radius', min: 0, max: 2, step: 0.02, def: 0.7 },
      { k: 'g1Height', label: '◐ Inner-dark height', min: -0.5, max: 1.5, step: 0.02, def: 0.92 },
      { k: 'g2Strength', label: '◑ Outer-dark strength', min: 0, max: 1, step: 0.01, def: 0.26 },
      { k: 'g2Radius', label: '◑ Outer-dark radius', min: 0, max: 2, step: 0.02, def: 1.1 },
      { k: 'g2Height', label: '◑ Outer-dark height', min: -0.5, max: 1.5, step: 0.02, def: 0.16 },
      { k: 'patch', label: 'Sunbaked patches', min: 0, max: 30, step: 1, def: 14 },
      { k: 'patchStrength', label: 'Patch contrast', min: 0, max: 0.2, step: 0.005, def: 0.07 },
      { k: 'grain', label: 'Grain', min: 0, max: 40, step: 1, def: 14 },
    ],
    draw: drawFabric,
  },
  concrete: {
    label: 'Concrete', size: 128, tint: '#9a948a',
    params: [
      { k: 'base', type: 'color', def: '#dad6d0', label: 'Base' },
      { k: 'speck', label: 'Speckle', min: 0, max: 120, step: 2, def: 60 },
      { k: 'blobs', label: 'Mottle blobs', min: 0, max: 60, step: 1, def: 22 },
      { k: 'blobStrength', label: 'Mottle contrast', min: 0, max: 0.25, step: 0.005, def: 0.1 },
    ],
    draw: (ctx, s, o) => {
      fill(ctx, s, o.base); speckle(ctx, s, o.speck, 2200);
      for (let i = 0; i < o.blobs; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 6 + Math.random() * 22, dark = Math.random() < 0.6;
        wrapBlob(ctx, s, x, y, r, dark ? '74,70,63' : '184,179,170', o.blobStrength * (0.4 + Math.random()));
      }
    },
  },
  metal: {
    label: 'Ribbed metal', size: 128, tint: '#7a8a96',
    params: [
      { k: 'base', type: 'color', def: '#e0e2e4', label: 'Base' },
      { k: 'ribs', label: 'Ribs', min: 4, max: 40, step: 1, def: 16 },
      { k: 'ribContrast', label: 'Rib contrast', min: 0, max: 0.5, step: 0.01, def: 0.22 },
    ],
    draw: (ctx, s, o) => {
      fill(ctx, s, o.base); const w = s / o.ribs;
      for (let i = 0; i < o.ribs; i++) {
        const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
        g.addColorStop(0, `rgba(0,0,0,${o.ribContrast})`); g.addColorStop(0.5, `rgba(255,255,255,${o.ribContrast * 0.7})`); g.addColorStop(1, `rgba(0,0,0,${o.ribContrast})`);
        ctx.fillStyle = g; ctx.fillRect(i * w, 0, w, s);
      }
      speckle(ctx, s, 26, 800);
    },
  },
  rust: {
    label: 'Corrosion', size: 128, tint: '#b5482a',
    params: [
      { k: 'base', type: 'color', def: '#cac6c0', label: 'Base' },
      { k: 'pits', label: 'Pits', min: 0, max: 80, step: 1, def: 38 },
      { k: 'pitStrength', label: 'Pit contrast', min: 0, max: 0.4, step: 0.01, def: 0.18 },
      { k: 'speck', label: 'Speckle', min: 0, max: 80, step: 2, def: 46 },
    ],
    draw: (ctx, s, o) => {
      fill(ctx, s, o.base); speckle(ctx, s, o.speck, 1700);
      const cols = ['150,146,140', '104,100,95', '186,182,176', '78,75,71', '206,202,196'];
      for (let i = 0; i < o.pits; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 3 + Math.random() * 15;
        wrapBlob(ctx, s, x, y, r, cols[(Math.random() * cols.length) | 0], o.pitStrength * (0.5 + Math.random()));
      }
    },
  },
  noise: {
    label: 'Perlin noise', size: 128, tint: '#4f8f5a',
    params: [
      { k: 'base', type: 'color', def: '#d7d4cf', label: 'Base' },
      { k: 'amp', label: 'Contrast', min: 0, max: 220, step: 2, def: 118 },
      { k: 'oct1', label: 'Big blobs (cells)', min: 2, max: 10, step: 1, def: 3 },
      { k: 'octaves', label: 'Octaves', min: 1, max: 5, step: 1, def: 4 },
    ],
    draw: (ctx, s, o) => {
      fill(ctx, s, o.base);
      const oc = []; let c = o.oct1, a = 0.52;
      for (let i = 0; i < o.octaves; i++) { oc.push([tileLattice(c), c, a]); c *= 2; a *= 0.55; }
      const img = ctx.getImageData(0, 0, s, s), d = img.data;
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        let n = 0; for (const [g, cc, aa] of oc) n += (sampleLattice(g, cc, x / s, y / s) - 0.5) * aa;
        const k = (n * o.amp) | 0, i = (y * s + x) * 4;
        d[i] = clamp255(d[i] + k); d[i + 1] = clamp255(d[i + 1] + k); d[i + 2] = clamp255(d[i + 2] + k);
      }
      ctx.putImageData(img, 0, 0);
    },
  },
  grime: {
    label: 'Grime', size: 128, tint: '#7a6a55',
    params: [
      { k: 'base', type: 'color', def: '#cecbc4', label: 'Base' },
      { k: 'smudges', label: 'Smudges', min: 0, max: 60, step: 1, def: 30 },
      { k: 'strength', label: 'Smudge contrast', min: 0, max: 0.3, step: 0.01, def: 0.13 },
    ],
    draw: (ctx, s, o) => {
      fill(ctx, s, o.base); speckle(ctx, s, 50, 1900);
      for (let i = 0; i < o.smudges; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 5 + Math.random() * 18, dark = Math.random() < 0.72;
        wrapBlob(ctx, s, x, y, r, dark ? '24,20,13' : '210,205,190', o.strength * (0.4 + Math.random()));
      }
    },
  },
  scratched: {
    label: 'Scuffed metal', size: 128, tint: '#8a9298',
    params: [
      { k: 'base', type: 'color', def: '#dcdde0', label: 'Base' },
      { k: 'scratches', label: 'Scratches', min: 0, max: 160, step: 2, def: 64 },
      { k: 'strength', label: 'Scratch contrast', min: 0, max: 0.3, step: 0.01, def: 0.11 },
    ],
    draw: (ctx, s, o) => {
      fill(ctx, s, o.base); speckle(ctx, s, 30, 1100); ctx.lineWidth = 1;
      for (let i = 0; i < o.scratches; i++) {
        const x = Math.random() * s, y = Math.random() * s, a = Math.random() * Math.PI, len = 4 + Math.random() * 24;
        const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
        ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * o.strength})`;
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) { ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx + ex, y + dy + ey); ctx.stroke(); }
      }
    },
  },
};
function fill(ctx, s, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, s, s); }

// Soft radial shade filling the whole canvas. darkInside=true → dark at the centre
// fading out (a shadow pool); false → clear centre darkening outward (a vignette).
// centre is horizontally centred; `heightF` (0=top, 1=bottom; may go off-canvas) sets
// the vertical position, `radiusF` the radius — both as a fraction of the canvas size.
function radialShade(ctx, s, radiusF, heightF, strength, darkInside) {
  if (strength <= 0 || radiusF <= 0) return;
  const cx = s / 2, cy = s * heightF, r = s * radiusF;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (darkInside) { g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)'); }
  else { g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
}

// Tent FABRIC: worn sun-baked canvas. Shading is TWO positionable radial gradients —
// one dark-inside (shadow pool), one dark-outside (vignette) — over soft bleached
// patches and faint grain. No lines.
function drawFabric(ctx, s, o) {
  fill(ctx, s, o.base);
  // sunbaked soft patches (under the shading)
  for (let i = 0; i < o.patch; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 14 + Math.random() * 34, sun = Math.random() < 0.55;
    wrapBlob(ctx, s, x, y, r, sun ? '255,252,244' : '78,74,66', o.patchStrength * (0.5 + Math.random()));
  }
  radialShade(ctx, s, o.g1Radius, o.g1Height, o.g1Strength, true);    // ◐ dark inside
  radialShade(ctx, s, o.g2Radius, o.g2Height, o.g2Strength, false);   // ◑ dark outside
  speckle(ctx, s, o.grain, 500);
}

// ── GPU noise generators (ported from noise-code.txt) ────────────────────────
// Rendered by a fragment shader to a render target, read back to a canvas so they share
// the same swatch/material path as the CPU ones. Controls map to shader uniforms; `tint`
// is the material colour. `invert` flips the value (scratch ships inverted = mostly white).
function gpuTex(label, mode, tint, scaleDef, invertDef) {
  return {
    label, gpu: true, mode, tint, size: 256, params: [
      { k: 'tint', type: 'color', def: tint, label: 'Tint' },
      { k: 'scale', label: 'Scale', min: 1, max: 24, step: 0.5, def: scaleDef },
      { k: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.05, def: 1 },
      { k: 'bright', label: 'Brightness', min: -0.5, max: 0.5, step: 0.02, def: 0 },
      { k: 'invert', label: 'Invert', min: 0, max: 1, step: 1, def: invertDef || 0 },
      { k: 'seed', label: 'Seed', min: 0, max: 50, step: 1, def: 0 },
    ],
  };
}
Object.assign(GEN, {
  erosion: gpuTex('Erosion', 0, '#9a8b76', 8, 0),
  curl: gpuTex('Curl', 1, '#8a9aa6', 8, 0),
  stone: gpuTex('Stone', 2, '#cfcabf', 6, 0),
  wool: gpuTex('Wool', 3, '#d8d2c4', 6, 0),
  gabor: gpuTex('Gabor', 4, '#b0a99a', 6, 0),
  gaborfbm: gpuTex('Gabor FBM', 5, '#b0a99a', 4, 0),
  scratch: gpuTex('Scratch', 6, '#b8bcc0', 6, 1),   // inverted: white surface, dark scratches
  crater: gpuTex('Crater', 7, '#9a958c', 6, 0),
  worley: gpuTex('Worley', 8, '#aab0a4', 6, 0),
  simplex: gpuTex('Simplex', 9, '#b6b2a8', 6, 0),
  paper: gpuTex('Paper', 10, '#e6e0d2', 4, 0),
});

// ── state ────────────────────────────────────────────────────────────────────
const opts = {};   // current params per kind
for (const k in GEN) { opts[k] = {}; for (const p of GEN[k].params) opts[k][p.k] = p.def; }
let cur = 'fabric';
let tiled = false;

function buildCanvas(kind) {
  const G = GEN[kind];
  if (G.gpu) return gpuCanvas(kind);
  const s = G.size;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  G.draw(cv.getContext('2d'), s, opts[kind]);
  return cv;
}

// ── three scene ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#1a241d');
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 4.5, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.2, 0); controls.update();
scene.add(new THREE.HemisphereLight('#dfeaff', '#46402f', 1.0));
const sun = new THREE.DirectionalLight('#fff3da', 1.4); sun.position.set(6, 12, 8);
sun.castShadow = true; scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#2a3527' }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1.0, side: THREE.DoubleSide });

// a flat upright PLANE (the honest 2D read), a TENT A-frame, and a BOX — all share `mat`.
function uprightPlane() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), mat);
  m.position.set(-5, 2.5, 0); m.castShadow = true; return m;
}
function tentMesh() {
  // triangular prism: two sloped roof quads (clean 0..1 UV) + two gable end triangles.
  const w = 2.4, h = 3.0, L = 4.2, hl = L / 2;
  const g = new THREE.BufferGeometry();
  const v = [], uv = [], idx = [];
  const push = (x, y, z, u, vv) => { v.push(x, y, z); uv.push(u, vv); return v.length / 3 - 1; };
  // LEFT roof (base -w..ridge), front->back: v across slope (0 base → 1 ridge), u along length
  let a = push(-w, 0, hl, 0, 0), b = push(-w, 0, -hl, 1, 0), c = push(0, h, -hl, 1, 1), d = push(0, h, hl, 0, 1);
  idx.push(a, b, c, a, c, d);
  // RIGHT roof
  let e = push(w, 0, -hl, 0, 0), f = push(w, 0, hl, 1, 0), gg = push(0, h, hl, 1, 1), hh = push(0, h, -hl, 0, 1);
  idx.push(e, f, gg, e, gg, hh);
  // gable triangles (front & back) — map the texture's top corners to the apex
  let f1 = push(-w, 0, hl, 0, 0), f2 = push(w, 0, hl, 1, 0), f3 = push(0, h, hl, 0.5, 1); idx.push(f1, f2, f3);
  let b1 = push(w, 0, -hl, 0, 0), b2 = push(-w, 0, -hl, 1, 0), b3 = push(0, h, -hl, 0.5, 1); idx.push(b1, b2, b3);
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.position.set(0, 0, 0); m.castShadow = true; return m;
}
function boxMesh() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), mat);
  m.position.set(5, 1.5, 0); m.castShadow = true; return m;
}
scene.add(uprightPlane(), tentMesh(), boxMesh());

// ── GPU noise renderer ───────────────────────────────────────────────────────
// A fullscreen quad runs the ported GLSL noise into a render target; we read it back
// into a canvas so GPU noises share the CPU swatch/material path.
const RTS = 256;
const noiseRT = new THREE.WebGLRenderTarget(RTS, RTS, { depthBuffer: false, stencilBuffer: false });
const noiseScene = new THREE.Scene();
const noiseCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); noiseCam.position.z = 1;
const NOISE_VERT = `in vec3 position; in vec2 uv; uniform mat4 projectionMatrix, modelViewMatrix; out vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const NOISE_FRAG = `precision highp float; precision highp int;
in vec2 vUv; out vec4 outColor;
uniform int uMode; uniform float uScale, uContrast, uBright, uInvert; uniform vec2 uSeed;
float hash12(vec2 p){ uvec2 u=floatBitsToUint(p*vec2(141421356.0,2718281828.0)); return float((u.x^u.y)*3141592653u)/float(0xffffffffu); }
vec2 hash22(vec2 p){ uvec2 u=floatBitsToUint(p*vec2(141421356.0,2718281828.0)); return vec2((u.x^u.y)*uvec2(3141592653u,1618033988u))/float(0xffffffffu); }
float perlin12(vec2 p){ vec2 i=floor(p); vec2 f=p-i; vec2 u=f*f*f*(10.0+f*(6.0*f-15.0));
  float a=dot(normalize(hash22(i+vec2(0,0))-0.5),f-vec2(0,0)); float b=dot(normalize(hash22(i+vec2(1,0))-0.5),f-vec2(1,0));
  float c=dot(normalize(hash22(i+vec2(0,1))-0.5),f-vec2(0,1)); float d=dot(normalize(hash22(i+vec2(1,1))-0.5),f-vec2(1,1));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*0.7+0.5; }
vec3 perlin12d(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0); vec2 du=30.0*f*f*(f*(f-2.0)+1.0);
  vec2 ga=hash22(i+vec2(0,0))*2.0-1.0; vec2 gb=hash22(i+vec2(1,0))*2.0-1.0; vec2 gc=hash22(i+vec2(0,1))*2.0-1.0; vec2 gd=hash22(i+vec2(1,1))*2.0-1.0;
  float va=dot(ga,f-vec2(0,0)); float vb=dot(gb,f-vec2(1,0)); float vc=dot(gc,f-vec2(0,1)); float vd=dot(gd,f-vec2(1,1));
  return vec3(va+u.x*(vb-va)+u.y*(vc-va)+u.x*u.y*(va-vb-vc+vd), ga+u.x*(gb-ga)+u.y*(gc-ga)+u.x*u.y*(ga-gb-gc+gd)+du*(u.yx*(va-vb-vc+vd)+vec2(vb,vc)-va)); }
float gabor12(vec2 p){ const float kF=8.0; vec2 i=floor(p); vec2 f=p-i; f*=f*(3.0-2.0*f);
  return mix(mix(sin(kF*dot(p,hash22(i+vec2(0,0)))),sin(kF*dot(p,hash22(i+vec2(1,0)))),f.x),
             mix(sin(kF*dot(p,hash22(i+vec2(0,1)))),sin(kF*dot(p,hash22(i+vec2(1,1)))),f.x),f.y); }
vec2 curl22(vec2 p){ vec2 e=vec2(0.01,0); vec2 a=vec2(perlin12(p+e.xy),perlin12(p+e.yx)); vec2 b=vec2(perlin12(p-e.xy),perlin12(p-e.yx)); return (a-b)/e.x*0.5; }
vec3 gullies(vec2 p, vec2 slope){ vec2 sd=vec2(-slope.y,slope.x)*3.14159265; vec2 id=floor(p); p-=id; vec2 hs=vec2(0); float ws=0.0;
  for(int x=-1;x<=2;x++) for(int y=-1;y<=2;y++){ vec2 off=vec2(x,y); vec2 c=p-off-hash22(id+off)+0.5; float d2=dot(c,c);
    float w=max(0.0,exp(-d2*2.0)-0.01111); ws+=w; float t=dot(c,sd); hs+=vec2(cos(t),-sin(t))*w; } return vec3(hs.x,hs.y*sd)/ws; }
vec3 erosion12(vec2 p){ vec3 nd=perlin12d(p); float st=0.25,fr=8.0,tot=1.0;
  for(int i=0;i<4;i++){ float l2=dot(nd.yz,nd.yz); nd+=gullies(p*fr, nd.yz*pow(max(l2,1e-6),-0.25))*st*vec3(1,fr,fr); tot+=st; st*=0.5; fr*=2.0; } return nd/tot; }
float fbm_perlin(vec2 p){ float s=0.0,m=0.0,a=1.0; for(int i=0;i<6;i++){ s+=a*perlin12(p); m+=a; a*=0.5; p*=2.0; } return s/m; }
vec3 fbm_stone(vec2 p){ vec3 s=vec3(0); float a=1.0; for(int i=0;i<6;i++){ s+=a*perlin12d(p); a*=0.5; p*=2.0; } return s; }
float stone12(vec2 p){ return fbm_perlin(p+fbm_stone(p).yz*0.4); }
vec2 fbm_wool(vec2 p){ vec2 s=vec2(0.0); float m=0.0,a=1.0; for(int i=0;i<6;i++){ vec2 n=perlin12d(p).yz; s+=a*n; m+=a; a*=0.5; p*=2.0; } return s/m; }
float wool12(vec2 p){ vec2 n=fbm_wool(p); return max(abs(n.x),abs(n.y)); }
float fbm_gabor(vec2 p){ float s=0.0,m=0.0,a=1.0; for(int i=0;i<6;i++){ s+=a*gabor12(p); m+=a; a*=0.5; p*=2.0; } return s/m; }
float worley12(vec2 p){ vec2 i=floor(p); p-=i; float w=1e9;
  for(float x=-1.0;x<=1.0;x++) for(float y=-1.0;y<=1.0;y++){ vec2 c=p-vec2(x,y)-hash12(i+vec2(x,y)); w=min(w,dot(c,c)); } return 1.0-sqrt(w); }
float crater12(vec2 p){ vec2 f=fract(p); p=floor(p); float va=0.,wt=0.;
  for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++){ vec2 g=vec2(i,j); vec2 o=hash22(p+g); float d=distance(f-g,o);
    float w=exp(-4.*d); va+=w*sin(6.28*sqrt(max(d,0.06))); wt+=w; } return abs(va/wt); }
float simplex12(vec2 p){ vec2 i=floor(p+(p.x+p.y)*0.366025); vec2 a=p-i+(i.x+i.y)*0.211324; float m=step(a.y,a.x);
  vec2 o=vec2(m,1.0-m); vec2 b=a-o+0.211324; vec2 c=a-0.577351; vec3 h=max(0.5-vec3(dot(a,a),dot(b,b),dot(c,c)),0.0);
  vec3 n=h*h*h*h*vec3(dot(a,hash22(i)-0.5),dot(b,hash22(i+o)-0.5),dot(c,hash22(i+1.0)-0.5)); return dot(n,vec3(70))+0.5; }
float scratch(vec2 uv, float f){ vec2 sd=floor(uv); uv-=sd; sd.x=floor(sin(sd.x*51024.0)*3104.0); sd.y=floor(sin(sd.y*1324.0)*554.0);
  uv=uv*2.0-1.0; uv=uv*cos(sd.x+sd.y)+vec2(-uv.y,uv.x)*sin(sd.x+sd.y); uv+=sin(sd.x-sd.y); uv=uv*0.5+0.5;
  float s=(sin(sd.x+uv.y*3.1415)+sin(sd.y+uv.y*3.1415))*0.2; float x=abs(uv.x-0.5+s); x=0.5-x*f;
  x=smoothstep(-2.0,fwidth(x)*1.5+16.0,x)*12.0; x*=uv.y; return x; }
float scratches12(vec2 uv){ float sc=0.0; float f=1.0/length(fwidth(uv));
  for(int i=0;i<8;++i){ float x=scratch(uv,f); sc=max(sc,x); uv=uv*mat2(1.0,0.7,-0.7,1.0)-12.31; } return sc; }
vec2 fbm_paper(vec2 p){ vec2 s=vec2(0); float m=0.0,a=1.0; for(int i=0;i<10;i++){ s+=a*clamp(perlin12d(p).yz*0.5+0.5,vec2(0),vec2(1)); m+=a; a*=0.8; p*=2.0; } return s/m; }
float paper12(vec2 p){ return length(fbm_paper(p))/1.414*0.6+0.4; }
void main(){ vec2 p=vUv*uScale+uSeed; float v=0.0; int m=uMode;
  if(m==0) v=erosion12(p).x*0.5+0.5;
  else if(m==1) v=length(curl22(p))/1.414;
  else if(m==2) v=stone12(p);
  else if(m==3) v=wool12(p);
  else if(m==4) v=gabor12(p)*0.5+0.5;
  else if(m==5) v=fbm_gabor(p)*0.5+0.5;
  else if(m==6) v=clamp(scratches12(p),0.0,1.0);
  else if(m==7) v=crater12(p);
  else if(m==8) v=worley12(p);
  else if(m==9) v=simplex12(p);
  else v=paper12(p);
  v=mix(v,1.0-v,uInvert); v=(v-0.5)*uContrast+0.5+uBright;
  outColor=vec4(vec3(clamp(v,0.0,1.0)),1.0); }`;
const noiseMat = new THREE.RawShaderMaterial({
  vertexShader: NOISE_VERT, fragmentShader: NOISE_FRAG, glslVersion: THREE.GLSL3,
  uniforms: { uMode: { value: 0 }, uScale: { value: 6 }, uContrast: { value: 1 }, uBright: { value: 0 }, uInvert: { value: 0 }, uSeed: { value: new THREE.Vector2() } },
});
noiseScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), noiseMat));
const _noiseBuf = new Uint8Array(RTS * RTS * 4);
function gpuCanvas(kind) {
  const o = opts[kind], G = GEN[kind], u = noiseMat.uniforms;
  u.uMode.value = G.mode; u.uScale.value = o.scale; u.uContrast.value = o.contrast;
  u.uBright.value = o.bright; u.uInvert.value = o.invert || 0;
  u.uSeed.value.set((o.seed || 0) * 17.3, (o.seed || 0) * 9.1);
  renderer.setRenderTarget(noiseRT); renderer.render(noiseScene, noiseCam);
  renderer.readRenderTargetPixels(noiseRT, 0, 0, RTS, RTS, _noiseBuf);
  renderer.setRenderTarget(null);
  const cv = document.createElement('canvas'); cv.width = cv.height = RTS;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(RTS, RTS);
  for (let y = 0; y < RTS; y++) { const sy = RTS - 1 - y; for (let x = 0; x < RTS; x++) { const di = (y * RTS + x) * 4, si = (sy * RTS + x) * 4; img.data[di] = _noiseBuf[si]; img.data[di + 1] = _noiseBuf[si + 1]; img.data[di + 2] = _noiseBuf[si + 2]; img.data[di + 3] = 255; } }
  ctx.putImageData(img, 0, 0); return cv;
}

// ── regenerate texture → swatch + material ───────────────────────────────────
const swatch = document.getElementById('swatch');
function regenerate() {
  const cv = buildCanvas(cur);
  // swatch (optionally tiled 2×2 to show seams)
  const sc = swatch.getContext('2d'); sc.imageSmoothingEnabled = true;
  sc.clearRect(0, 0, swatch.width, swatch.height);
  const reps = tiled ? 2 : 1, cell = swatch.width / reps;
  for (let i = 0; i < reps; i++) for (let j = 0; j < reps; j++) sc.drawImage(cv, i * cell, j * cell, cell, cell);
  // material map
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
  if (mat.map) mat.map.dispose();
  mat.map = tex; mat.color.set(opts[cur].tint || GEN[cur].tint || '#ffffff'); mat.needsUpdate = true;
  updateExport();
}
function updateExport() {
  const o = opts[cur]; const out = {};
  for (const k in o) out[k] = o[k];
  document.getElementById('export-text').value = `${cur}: ` + JSON.stringify(out);
}

// ── UI: texture list ─────────────────────────────────────────────────────────
const list = document.getElementById('tex-list');
for (const k in GEN) {
  const b = document.createElement('button'); b.className = 'tex-btn'; b.textContent = GEN[k].label; b.dataset.k = k;
  b.onclick = () => { cur = k; buildParams(); syncList(); regenerate(); };
  list.appendChild(b);
}
function syncList() { [...list.children].forEach(b => b.classList.toggle('on', b.dataset.k === cur)); }

// ── UI: param rows ───────────────────────────────────────────────────────────
function buildParams() {
  document.getElementById('params-title').textContent = GEN[cur].label.toUpperCase();
  const host = document.getElementById('param-rows'); host.innerHTML = '';
  for (const p of GEN[cur].params) {
    const row = document.createElement('div'); row.className = 'row';
    if (p.type === 'color') {
      row.innerHTML = `<label>${p.label}</label>`;
      const inp = document.createElement('input'); inp.type = 'color'; inp.value = opts[cur][p.k];
      inp.oninput = () => { opts[cur][p.k] = inp.value; regenerate(); };
      row.appendChild(inp);
    } else {
      const lab = document.createElement('label'); lab.innerHTML = `${p.label}<span class="val">${opts[cur][p.k]}</span>`;
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step; inp.value = opts[cur][p.k];
      inp.oninput = () => { opts[cur][p.k] = parseFloat(inp.value); lab.querySelector('.val').textContent = inp.value; regenerate(); };
      row.appendChild(lab); row.appendChild(inp);
    }
    host.appendChild(row);
  }
}

document.getElementById('tile-btn').onclick = e => { tiled = !tiled; e.target.classList.toggle('on', tiled); regenerate(); };
document.getElementById('copy-btn').onclick = () => {
  const t = document.getElementById('export-text'); t.select();
  navigator.clipboard?.writeText(t.value); document.getElementById('copy-btn').textContent = 'COPIED ✓';
  setTimeout(() => document.getElementById('copy-btn').textContent = 'COPY', 1200);
};
document.getElementById('reset-btn').onclick = () => {
  for (const p of GEN[cur].params) opts[cur][p.k] = p.def; buildParams(); regenerate();
};

// ── collapsible panels: click a panel's header to fold it to a button ─────────
document.querySelectorAll('.panel h2').forEach(h =>
  h.addEventListener('click', () => h.parentElement.classList.toggle('min')));

// ── boot ─────────────────────────────────────────────────────────────────────
buildParams(); syncList(); regenerate();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setSize(innerWidth, innerHeight);
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

// headless hook
window.TL = { setTex: k => { cur = k; buildParams(); syncList(); regenerate(); }, set: (k, v) => { opts[cur][k] = v; regenerate(); }, opts: () => opts[cur], kinds: Object.keys(GEN) };
