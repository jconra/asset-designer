// Bump vs Normal — a side-by-side playground. ONE grayscale height field feeds two
// identical spheres: the left uses it as a bumpMap (height only — the renderer guesses the
// slope per-pixel), the right uses a normal map DERIVED from that same height (the slope is
// baked in at full resolution). A sweeping light makes the difference obvious. Optional
// matching roughness ("specular") map can be layered on BOTH so the comparison stays fair.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── canvas toolkit (grayscale height fields for the CPU materials) ───────────
const S = 256;
function gcanvas() { const cv = document.createElement('canvas'); cv.width = cv.height = S; return cv; }
function fillG(ctx, v) { ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(0, 0, S, S); }
function speckle(ctx, amt, n) {
  for (let i = 0; i < n; i++) { const v = (Math.random() * 2 - 1) * amt | 0, g = 128 + v;
    ctx.fillStyle = `rgba(${g},${g},${g},0.5)`; ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1); }
}
function softBlob(ctx, x, y, r, g, a) {
  const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, `rgba(${g},${g},${g},${a})`); grd.addColorStop(1, `rgba(${g},${g},${g},0)`);
  ctx.fillStyle = grd; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function wrapBlob(ctx, x, y, r, g, a) { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) softBlob(ctx, x + dx, y + dy, r, g, a); }
function radialShade(ctx, radiusF, heightF, strength, darkInside) {
  if (strength <= 0) return; const cx = S / 2, cy = S * heightF, r = S * radiusF;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (darkInside) { grd.addColorStop(0, `rgba(0,0,0,${strength})`); grd.addColorStop(1, 'rgba(0,0,0,0)'); }
  else { grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${strength})`); }
  ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
}

// CPU material height fields (grayscale = relief)
function drawConcrete(ctx) { fillG(ctx, 150); speckle(ctx, 70, 6000);
  for (let i = 0; i < 30; i++) { const dark = Math.random() < 0.6; wrapBlob(ctx, Math.random() * S, Math.random() * S, 12 + Math.random() * 44, dark ? 70 : 210, 0.25 + Math.random() * 0.2); } }
function drawRust(ctx) { fillG(ctx, 150); speckle(ctx, 90, 6000);
  for (let i = 0; i < 70; i++) { wrapBlob(ctx, Math.random() * S, Math.random() * S, 6 + Math.random() * 26, Math.random() < 0.6 ? 60 : 200, 0.3 + Math.random() * 0.4); } }
function drawScratched(ctx) { fillG(ctx, 175); speckle(ctx, 30, 2200); ctx.lineWidth = 1;
  for (let i = 0; i < 130; i++) { const x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI, len = 8 + Math.random() * 60, ex = Math.cos(a) * len, ey = Math.sin(a) * len, g = Math.random() < 0.5 ? 255 : 40;
    ctx.strokeStyle = `rgba(${g},${g},${g},${0.15 + Math.random() * 0.4})`;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx + ex, y + dy + ey); ctx.stroke(); } } }
function drawFabric(ctx) { fillG(ctx, 200);
  for (let i = 0; i < 18; i++) { const sun = Math.random() < 0.5; wrapBlob(ctx, Math.random() * S, Math.random() * S, 28 + Math.random() * 60, sun ? 235 : 120, 0.18 + Math.random() * 0.18); }
  radialShade(ctx, 0.72, -0.24, 0.5, true); radialShade(ctx, 1.1, 0.16, 0.4, false); speckle(ctx, 18, 1200); }

// ── registry ─────────────────────────────────────────────────────────────────
const GEN = {
  // GPU noise height fields (mode → NOISE_FRAG), with a base albedo tint per material
  stone:    { label: 'Stone',     gpu: 2, scale: 6, tint: '#b9b4a9' },
  erosion:  { label: 'Erosion',   gpu: 0, scale: 8, tint: '#9a8b76' },
  curl:     { label: 'Curl',      gpu: 1, scale: 8, tint: '#8a9aa6' },
  wool:     { label: 'Wool',      gpu: 3, scale: 6, tint: '#c8c2b4' },
  gabor:    { label: 'Gabor',     gpu: 4, scale: 6, tint: '#b0a99a' },
  worley:   { label: 'Worley',    gpu: 8, scale: 6, tint: '#9aa094' },
  crater:   { label: 'Crater',    gpu: 7, scale: 6, tint: '#9a958c' },
  simplex:  { label: 'Simplex',   gpu: 9, scale: 6, tint: '#a6a298' },
  paper:    { label: 'Paper',     gpu: 10, scale: 4, tint: '#d6d0c2' },
  // CPU material height fields
  concrete: { label: 'Concrete',  cpu: drawConcrete, tint: '#bdb9b2' },
  rust:     { label: 'Corrosion', cpu: drawRust, tint: '#b07a44' },
  scratched:{ label: 'Scuffed',   cpu: drawScratched, tint: '#9aa2aa' },
  fabric:   { label: 'Tent',      cpu: drawFabric, tint: '#8a9a5a' },
};
let cur = 'stone';

// global tunables
const P = { bump: 0.6, normal: 1.6, depth: 2.5, repeat: 1.5, rough: 0.7, spec: false, spin: true, lightSpeed: 1, color: '' };

// ── three scene ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b0e14');
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.5, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.4, 0); controls.enablePan = false; controls.update();
scene.add(new THREE.HemisphereLight('#33405a', '#0a0c10', 0.35));
const key = new THREE.PointLight('#fff4e0', 60, 60); key.position.set(4, 4, 5); scene.add(key);
const keyBall = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshBasicMaterial({ color: '#fff4e0' }));
scene.add(keyBall);

const GEOMS = {
  sphere: new THREE.SphereGeometry(2.2, 160, 160),
  plane: new THREE.PlaneGeometry(3.8, 3.8, 1, 1),   // faces the camera — flat faces show the gap best
  box: new THREE.BoxGeometry(3, 3, 3),
};
const matBump = new THREE.MeshStandardMaterial({ roughness: P.rough, metalness: 0.1 });
const matNorm = new THREE.MeshStandardMaterial({ roughness: P.rough, metalness: 0.1 });
const meshBump = new THREE.Mesh(GEOMS.sphere, matBump); meshBump.position.x = -2.7; scene.add(meshBump);
const meshNorm = new THREE.Mesh(GEOMS.sphere, matNorm); meshNorm.position.x = 2.7; scene.add(meshNorm);
function setGeom(name) {
  meshBump.geometry = GEOMS[name]; meshNorm.geometry = GEOMS[name];
  const rx = name === 'box' ? 0.32 : 0, ry = name === 'box' ? 0.6 : 0;  // angle the box to show 3 faces
  meshBump.rotation.set(rx, ry, 0); meshNorm.rotation.set(rx, ry, 0);
  P.geom = name;
}

// ── GPU noise renderer (same library as the Texture Lab) ─────────────────────
const RTS = S;
const noiseRT = new THREE.WebGLRenderTarget(RTS, RTS, { depthBuffer: false, stencilBuffer: false });
const noiseScene = new THREE.Scene();
const noiseCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); noiseCam.position.z = 1;
const NOISE_VERT = `in vec3 position; in vec2 uv; uniform mat4 projectionMatrix, modelViewMatrix; out vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const NOISE_FRAG = `precision highp float; precision highp int;
in vec2 vUv; out vec4 outColor; uniform int uMode; uniform float uScale;
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
float worley12(vec2 p){ vec2 i=floor(p); p-=i; float w=1e9;
  for(float x=-1.0;x<=1.0;x++) for(float y=-1.0;y<=1.0;y++){ vec2 c=p-vec2(x,y)-hash12(i+vec2(x,y)); w=min(w,dot(c,c)); } return 1.0-sqrt(w); }
float crater12(vec2 p){ vec2 f=fract(p); p=floor(p); float va=0.,wt=0.;
  for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++){ vec2 g=vec2(i,j); vec2 o=hash22(p+g); float d=distance(f-g,o);
    float w=exp(-4.*d); va+=w*sin(6.28*sqrt(max(d,0.06))); wt+=w; } return abs(va/wt); }
float simplex12(vec2 p){ vec2 i=floor(p+(p.x+p.y)*0.366025); vec2 a=p-i+(i.x+i.y)*0.211324; float m=step(a.y,a.x);
  vec2 o=vec2(m,1.0-m); vec2 b=a-o+0.211324; vec2 c=a-0.577351; vec3 h=max(0.5-vec3(dot(a,a),dot(b,b),dot(c,c)),0.0);
  vec3 n=h*h*h*h*vec3(dot(a,hash22(i)-0.5),dot(b,hash22(i+o)-0.5),dot(c,hash22(i+1.0)-0.5)); return dot(n,vec3(70))+0.5; }
vec2 fbm_paper(vec2 p){ vec2 s=vec2(0); float m=0.0,a=1.0; for(int i=0;i<10;i++){ s+=a*clamp(perlin12d(p).yz*0.5+0.5,vec2(0),vec2(1)); m+=a; a*=0.8; p*=2.0; } return s/m; }
float paper12(vec2 p){ return length(fbm_paper(p))/1.414*0.6+0.4; }
void main(){ vec2 p=vUv*uScale; float v=0.0; int m=uMode;
  if(m==0) v=erosion12(p).x*0.5+0.5;
  else if(m==1) v=length(curl22(p))/1.414;
  else if(m==2) v=stone12(p);
  else if(m==3) v=wool12(p);
  else if(m==4) v=gabor12(p)*0.5+0.5;
  else if(m==7) v=crater12(p);
  else if(m==8) v=worley12(p);
  else if(m==9) v=simplex12(p);
  else v=paper12(p);
  outColor=vec4(vec3(clamp(v,0.0,1.0)),1.0); }`;
const noiseMat = new THREE.RawShaderMaterial({ vertexShader: NOISE_VERT, fragmentShader: NOISE_FRAG, glslVersion: THREE.GLSL3,
  uniforms: { uMode: { value: 2 }, uScale: { value: 6 } } });
noiseScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), noiseMat));
const _buf = new Uint8Array(RTS * RTS * 4);

// ── build the height canvas (grayscale) for the current source ───────────────
const heightCv = document.getElementById('height-cv');
const normalCv = document.getElementById('normal-cv');
function buildHeight() {
  const G = GEN[cur];
  const cv = gcanvas(), ctx = cv.getContext('2d');
  if (G.cpu) { G.cpu(ctx); }
  else {
    noiseMat.uniforms.uMode.value = G.gpu; noiseMat.uniforms.uScale.value = G.scale;
    renderer.setRenderTarget(noiseRT); renderer.render(noiseScene, noiseCam);
    renderer.readRenderTargetPixels(noiseRT, 0, 0, RTS, RTS, _buf); renderer.setRenderTarget(null);
    const img = ctx.createImageData(RTS, RTS);
    for (let y = 0; y < RTS; y++) { const sy = RTS - 1 - y; for (let x = 0; x < RTS; x++) { const di = (y * RTS + x) * 4, si = (sy * RTS + x) * 4; const v = _buf[si]; img.data[di] = img.data[di + 1] = img.data[di + 2] = v; img.data[di + 3] = 255; } }
    ctx.putImageData(img, 0, 0);
  }
  return cv;
}
// derive a tangent-space normal map from the height via a Sobel gradient (wrapped)
function heightToNormal(hCv, strength) {
  const hctx = hCv.getContext('2d'); const hd = hctx.getImageData(0, 0, S, S).data;
  const out = document.createElement('canvas'); out.width = out.height = S;
  const octx = out.getContext('2d'); const od = octx.createImageData(S, S);
  const H = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;   // +Y up (OpenGL/three convention)
    let nx = dx, ny = dy, nz = 1; const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv;
    const i = (y * S + x) * 4;
    od.data[i] = (nx * 0.5 + 0.5) * 255; od.data[i + 1] = (ny * 0.5 + 0.5) * 255; od.data[i + 2] = (nz * 0.5 + 0.5) * 255; od.data[i + 3] = 255;
  }
  octx.putImageData(od, 0, 0); return out;
}
function mkTex(cv, srgb) { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(P.repeat, P.repeat); t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

let heightCanvas, normalCanvas;
function rebuild() {
  heightCanvas = buildHeight();
  normalCanvas = heightToNormal(heightCanvas, P.depth);
  // previews
  heightCv.getContext('2d').drawImage(heightCanvas, 0, 0, 128, 128);
  normalCv.getContext('2d').drawImage(normalCanvas, 0, 0, 128, 128);
  applyMaps();
}
function applyMaps() {
  const tint = P.color || GEN[cur].tint;
  // dispose old maps
  for (const m of [matBump, matNorm]) { for (const k of ['bumpMap', 'normalMap', 'roughnessMap']) if (m[k]) { m[k].dispose(); m[k] = null; } }
  // BUMP sphere — height only
  matBump.color.set(tint); matBump.roughness = P.rough; matBump.bumpMap = mkTex(heightCanvas, false); matBump.bumpScale = P.bump;
  // NORMAL sphere — baked tangent normals
  matNorm.color.set(tint); matNorm.roughness = P.rough; matNorm.normalMap = mkTex(normalCanvas, false);
  matNorm.normalMap.colorSpace = THREE.NoColorSpace; matNorm.normalScale.set(P.normal, P.normal);
  // optional matching roughness ("specular") map on BOTH — crevices duller, peaks shinier
  if (P.spec) { matBump.roughnessMap = mkTex(heightCanvas, false); matNorm.roughnessMap = mkTex(heightCanvas, false); }
  matBump.needsUpdate = matNorm.needsUpdate = true;
}
function retile() { for (const m of [matBump, matNorm]) for (const k of ['bumpMap', 'normalMap', 'roughnessMap']) if (m[k]) m[k].repeat.set(P.repeat, P.repeat); }

// ── UI ───────────────────────────────────────────────────────────────────────
const list = document.getElementById('tex-list');
for (const k in GEN) { const b = document.createElement('button'); b.className = 'tex-btn'; b.textContent = GEN[k].label; b.dataset.k = k;
  b.onclick = () => { cur = k; P.color = ''; sync(); rebuild(); }; list.appendChild(b); }
function sync() { [...list.children].forEach(b => b.classList.toggle('on', b.dataset.k === cur)); }

const rows = document.getElementById('param-rows');
// geometry picker (sphere / plane / box)
(function geomRow() {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<label>Geometry</label>';
  const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:5px';
  const btns = ['sphere', 'plane', 'box'].map(name => {
    const b = document.createElement('button'); b.textContent = name.toUpperCase();
    b.style.cssText = 'flex:1;font-family:inherit;font-size:11px;cursor:pointer;padding:6px 0;border-radius:5px;background:rgba(8,12,20,0.9);color:#8fb6e6;border:1px solid #2a466e';
    b.onclick = () => { setGeom(name); btns.forEach(x => { const on = x.textContent === name.toUpperCase(); x.style.color = on ? '#9fd0ff' : '#8fb6e6'; x.style.borderColor = on ? '#9fd0ff' : '#2a466e'; }); };
    wrap.appendChild(b); return b;
  });
  btns[0].style.color = '#9fd0ff'; btns[0].style.borderColor = '#9fd0ff';
  row.appendChild(wrap); rows.appendChild(row);
})();
function slider(label, key, min, max, step, after) {
  const row = document.createElement('div'); row.className = 'row';
  const lab = document.createElement('label'); lab.innerHTML = `${label}<span class="val">${P[key]}</span>`;
  const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = P[key];
  inp.oninput = () => { P[key] = parseFloat(inp.value); lab.querySelector('.val').textContent = inp.value; after(); };
  row.appendChild(lab); row.appendChild(inp); rows.appendChild(row);
}
function toggle(label, key, after) {
  const row = document.createElement('div'); row.className = 'row btn';
  const b = document.createElement('button'); b.textContent = label + ': ' + (P[key] ? 'ON' : 'OFF'); b.classList.toggle('on', P[key]);
  b.onclick = () => { P[key] = !P[key]; b.textContent = label + ': ' + (P[key] ? 'ON' : 'OFF'); b.classList.toggle('on', P[key]); after(); };
  row.appendChild(b); rows.appendChild(row);
}
slider('Bump scale (left)', 'bump', 0, 2, 0.02, () => { matBump.bumpScale = P.bump; });
slider('Normal scale (right)', 'normal', 0, 4, 0.05, () => { matNorm.normalScale.set(P.normal, P.normal); });
slider('Relief depth (bake)', 'depth', 0.5, 8, 0.1, () => rebuild());
slider('Tiling', 'repeat', 1, 5, 0.5, () => retile());
slider('Roughness', 'rough', 0.05, 1, 0.05, () => { matBump.roughness = matNorm.roughness = P.rough; });
toggle('Matching spec map (both)', 'spec', () => applyMaps());
toggle('Sweep light', 'spin', () => {});
slider('Light speed', 'lightSpeed', 0, 3, 0.1, () => {});
const crow = document.createElement('div'); crow.className = 'row';
crow.innerHTML = '<label>Base color (override)</label>';
const cinp = document.createElement('input'); cinp.type = 'color'; cinp.value = '#b9b4a9';
cinp.oninput = () => { P.color = cinp.value; matBump.color.set(P.color); matNorm.color.set(P.color); };
crow.appendChild(cinp); rows.appendChild(crow);

// ── collapsible panels: header click folds a panel; title click folds the controls ──
document.querySelectorAll('.panel h2').forEach(h =>
  h.addEventListener('click', () => h.parentElement.classList.toggle('min')));
const titleEl = document.getElementById('title'), paramsEl = document.getElementById('params');
titleEl.addEventListener('click', e => {
  if (e.target.tagName === 'A') return;                 // let nav links navigate
  paramsEl.classList.toggle('min'); titleEl.classList.toggle('folded');
});

// ── boot ─────────────────────────────────────────────────────────────────────
sync(); rebuild();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setSize(innerWidth, innerHeight);
let lt = 0;
(function loop() {
  requestAnimationFrame(loop);
  if (P.spin) lt += 0.016 * P.lightSpeed;
  const r = 6.5; key.position.set(Math.cos(lt) * r, 2.6 + Math.sin(lt * 0.7) * 1.8, Math.sin(lt) * r + 1.5);
  keyBall.position.copy(key.position);
  controls.update(); renderer.render(scene, camera);
})();

window.SL = { pick: k => { cur = k; sync(); rebuild(); }, set: (k, v) => { P[k] = v; rebuild(); }, geom: setGeom, P, kinds: Object.keys(GEN),
  lightTo: t => { lt = t; key.position.set(Math.cos(t) * 6.5, 2.6, Math.sin(t) * 6.5 + 1.5); keyBall.position.copy(key.position); } };
