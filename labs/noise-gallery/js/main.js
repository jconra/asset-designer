// Noise Gallery — a living wall of procedural fields. One fullscreen quad runs the same
// GLSL noise library as the Texture Lab, but tiled into a 4×3 grid (one noise per cell)
// and driven by a uTime uniform that *warps the sample point* every frame, so each field
// boils/churns in place instead of just scrolling. No render-target readback — the shader
// draws straight to screen, so all twelve animate smoothly together.

import * as THREE from 'three';

const COLS = 4, ROWS = 3;
// label + tint per cell, in grid order (row 0 = top-left). Tints mirror the Texture Lab.
const TILES = [
  { name: 'EROSION',   tint: '#9a8b76' },
  { name: 'CURL',      tint: '#8a9aa6' },
  { name: 'STONE',     tint: '#cfcabf' },
  { name: 'WOOL',      tint: '#d8d2c4' },
  { name: 'GABOR',     tint: '#b0a99a' },
  { name: 'GABOR FBM', tint: '#b0a99a' },
  { name: 'SCRATCH',   tint: '#b8bcc0' },
  { name: 'CRATER',    tint: '#9a958c' },
  { name: 'WORLEY',    tint: '#aab0a4' },
  { name: 'SIMPLEX',   tint: '#b6b2a8' },
  { name: 'PAPER',     tint: '#e6e0d2' },
  { name: 'CLOUDS',    tint: '#aebfd0' },
];
const SCALE = [8, 8, 6, 6, 6, 4, 6, 6, 6, 6, 4, 5];   // per-noise base frequency

const hexVec = h => new THREE.Color(h);

// ── labels overlay (CSS grid matching the shader grid) ───────────────────────
const labels = document.getElementById('labels');
labels.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
labels.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
for (const t of TILES) {
  const c = document.createElement('div'); c.className = 'cell';
  const s = document.createElement('span'); s.textContent = t.name; c.appendChild(s); labels.appendChild(c);
}

// ── three: fullscreen quad ───────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); camera.position.z = 1;

const VERT = `in vec3 position; in vec2 uv; uniform mat4 projectionMatrix, modelViewMatrix; out vec2 vUv;
void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

// noise library — identical functions to texture-lab; main() tiles a grid and warps by time.
const FRAG = `precision highp float; precision highp int;
in vec2 vUv; out vec4 outColor;
uniform float uTime, uWarp, uScaleMul; uniform int uMono, uFocus, uTile, uGrid;
uniform vec3 uTints[12]; uniform float uScales[12];
const int COLS=${COLS}, ROWS=${ROWS};

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

// ── tileable (periodic-lattice) variants ─────────────────────────────────────
// Wrap each integer cell index mod P before hashing, doubling the period per fBm
// octave, so a tile of size P seams perfectly. Domain-warping by a P-periodic field
// keeps the result P-periodic. Only the clean lattice noises get a tileable form;
// scratch/erosion/gabor/simplex have no simple period and fall back (seam stays).
vec2 phash22(vec2 i, float P){ return hash22(mod(i, vec2(P))); }
float phash12(vec2 i, float P){ return hash12(mod(i, vec2(P))); }
float tperlin(vec2 p, float P){ vec2 i=floor(p); vec2 f=p-i; vec2 u=f*f*f*(10.0+f*(6.0*f-15.0));
  float a=dot(normalize(phash22(i+vec2(0,0),P)-0.5),f-vec2(0,0)); float b=dot(normalize(phash22(i+vec2(1,0),P)-0.5),f-vec2(1,0));
  float c=dot(normalize(phash22(i+vec2(0,1),P)-0.5),f-vec2(0,1)); float d=dot(normalize(phash22(i+vec2(1,1),P)-0.5),f-vec2(1,1));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*0.7+0.5; }
vec3 tperlind(vec2 p, float P){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0); vec2 du=30.0*f*f*(f*(f-2.0)+1.0);
  vec2 ga=phash22(i+vec2(0,0),P)*2.0-1.0; vec2 gb=phash22(i+vec2(1,0),P)*2.0-1.0; vec2 gc=phash22(i+vec2(0,1),P)*2.0-1.0; vec2 gd=phash22(i+vec2(1,1),P)*2.0-1.0;
  float va=dot(ga,f-vec2(0,0)); float vb=dot(gb,f-vec2(1,0)); float vc=dot(gc,f-vec2(0,1)); float vd=dot(gd,f-vec2(1,1));
  return vec3(va+u.x*(vb-va)+u.y*(vc-va)+u.x*u.y*(va-vb-vc+vd), ga+u.x*(gb-ga)+u.y*(gc-ga)+u.x*u.y*(ga-gb-gc+gd)+du*(u.yx*(va-vb-vc+vd)+vec2(vb,vc)-va)); }
float tfbm(vec2 p, float P){ float s=0.,m=0.,a=1.; float pp=P; for(int i=0;i<6;i++){ s+=a*tperlin(p,pp); m+=a; a*=0.5; p*=2.0; pp*=2.0; } return s/m; }
vec3 tfbmd(vec2 p, float P){ vec3 s=vec3(0); float a=1.; float pp=P; for(int i=0;i<6;i++){ s+=a*tperlind(p,pp); a*=0.5; p*=2.0; pp*=2.0; } return s; }
float tstone(vec2 p, float P){ return tfbm(p+tfbmd(p,P).yz*0.4, P); }
vec2 tfbmwool(vec2 p, float P){ vec2 s=vec2(0.); float m=0.,a=1.; float pp=P; for(int i=0;i<6;i++){ vec2 n=tperlind(p,pp).yz; s+=a*n; m+=a; a*=0.5; p*=2.0; pp*=2.0; } return s/m; }
float twool(vec2 p, float P){ vec2 n=tfbmwool(p,P); return max(abs(n.x),abs(n.y)); }
vec2 tfbmpaper(vec2 p, float P){ vec2 s=vec2(0); float m=0.,a=1.; float pp=P; for(int i=0;i<10;i++){ s+=a*clamp(tperlind(p,pp).yz*0.5+0.5,vec2(0),vec2(1)); m+=a; a*=0.8; p*=2.0; pp*=2.0; } return s/m; }
float tpaper(vec2 p, float P){ return length(tfbmpaper(p,P))/1.414*0.6+0.4; }
vec2 tcurl(vec2 p, float P){ vec2 e=vec2(0.01,0); vec2 a=vec2(tperlin(p+e.xy,P),tperlin(p+e.yx,P)); vec2 b=vec2(tperlin(p-e.xy,P),tperlin(p-e.yx,P)); return (a-b)/e.x*0.5; }
float tworley(vec2 p, float P){ vec2 i=floor(p); p-=i; float w=1e9;
  for(float x=-1.0;x<=1.0;x++) for(float y=-1.0;y<=1.0;y++){ vec2 g=vec2(x,y); vec2 c=p-g-phash12(i+g,P); w=min(w,dot(c,c)); } return 1.0-sqrt(w); }
float tcrater(vec2 p, float P){ vec2 f=fract(p); p=floor(p); float va=0.,wt=0.;
  for(int i=-2;i<=2;i++) for(int j=-2;j<=2;j++){ vec2 g=vec2(i,j); vec2 o=phash22(p+g,P); float d=distance(f-g,o);
    float w=exp(-4.*d); va+=w*sin(6.28*sqrt(max(d,0.06))); wt+=w; } return abs(va/wt); }

float noiseVal(int m, vec2 p);
float tileVal(int m, vec2 p, float P){
  if(m==1) return clamp(length(tcurl(p,P))/1.414,0.0,1.0);
  else if(m==2) return tstone(p,P);
  else if(m==3) return twool(p,P);
  else if(m==7) return tcrater(p,P);
  else if(m==8) return tworley(p,P);
  else if(m==10) return tpaper(p,P);
  else if(m==11) return tfbm(p,P);
  return noiseVal(m,p);   // no clean period → unchanged (seam stays — by design)
}

float noiseVal(int m, vec2 p){
  if(m==0) return erosion12(p).x*0.5+0.5;
  else if(m==1) return clamp(length(curl22(p))/1.414,0.0,1.0);
  else if(m==2) return stone12(p);
  else if(m==3) return wool12(p);
  else if(m==4) return gabor12(p)*0.5+0.5;
  else if(m==5) return fbm_gabor(p)*0.5+0.5;
  else if(m==6) return clamp(scratches12(p),0.0,1.0);
  else if(m==7) return crater12(p);
  else if(m==8) return worley12(p);
  else if(m==9) return simplex12(p);
  else if(m==10) return paper12(p);
  else return fbm_perlin(p);
}

void main(){
  float t = uTime;
  if(uFocus < 0){
    // ── GRID: 4×3, one noise per cell ──
    vec2 g = vUv * vec2(float(COLS), float(ROWS));
    vec2 cellId = floor(g);
    vec2 luv = fract(g);                                  // 0..1 within the tile
    int idx = (ROWS-1-int(cellId.y))*COLS + int(cellId.x);// row 0 = top
    if(idx > 11) idx = 11;
    vec2 d = min(luv, 1.0-luv);
    float border = uGrid==1 ? smoothstep(0.0, 0.012, min(d.x, d.y)) : 1.0; // thin gutter (optional)
    vec2 p = luv * uScales[idx] * uScaleMul + cellId * 31.7;
    vec2 w = vec2(perlin12(p*0.45 + vec2(1.7, t*0.18)), perlin12(p*0.45 + vec2(-4.3, t*0.18)));
    p += (w - 0.5) * 2.6 * uWarp;                         // churn (boils in place)
    p += vec2(t*0.02, t*0.011);                           // faint global drift
    float v = noiseVal(idx, p);
    if(idx==6) v = 1.0 - v;                               // scratch ships inverted
    vec3 col = (uMono==1) ? vec3(v) : uTints[idx] * (v*1.15);
    outColor = vec4(col * border, 1.0);
    return;
  }
  // ── FOCUS: one noise filling the screen, repeated 2×2 to expose seams ──
  int f = uFocus;
  float rep = 2.0;
  vec2 suv = fract(vUv * rep);                            // repeated tile coords
  float P = max(2.0, floor(uScales[f] * uScaleMul));      // integer period (cells)
  vec2 p = suv * P;
  float v;
  if(uTile == 1){                                         // periodic warp + periodic noise
    vec2 w = vec2(tperlin(p + vec2(0.0, t*0.18), P), tperlin(p + vec2(11.0, t*0.18), P));
    v = tileVal(f, p + (w-0.5) * 2.6 * uWarp, P);
  } else {                                                // free noise → seams at the repeat edges
    vec2 w = vec2(perlin12(p*0.9 + vec2(1.7, t*0.18)), perlin12(p*0.9 + vec2(-4.3, t*0.18)));
    v = noiseVal(f, p + (w-0.5) * 2.6 * uWarp);
  }
  if(f==6) v = 1.0 - v;
  vec3 col = (uMono==1) ? vec3(v) : uTints[f] * (v*1.15);
  // faint cyan crosshair at the repeat boundary (vUv = 0.5) — where seams would show;
  // GRID toggles it off along with the tile gutters
  if(uGrid==1){ float seam = min(abs(vUv.x-0.5), abs(vUv.y-0.5));
    col = mix(col, vec3(0.36,1.0,0.72), (1.0 - smoothstep(0.0, 0.0016, seam)) * 0.5); }
  outColor = vec4(col, 1.0);
}`;

const uTints = TILES.map(t => hexVec(t.tint));
const mat = new THREE.RawShaderMaterial({
  vertexShader: VERT, fragmentShader: FRAG, glslVersion: THREE.GLSL3,
  uniforms: {
    uTime: { value: 0 }, uWarp: { value: 0.6 }, uScaleMul: { value: 1 }, uMono: { value: 0 },
    uFocus: { value: -1 }, uTile: { value: 0 }, uGrid: { value: 1 },
    uTints: { value: uTints }, uScales: { value: SCALE },
  },
});
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

// ── controls ─────────────────────────────────────────────────────────────────
let speed = 1, playing = true, clock = 0, last = performance.now();
const bind = (id, valId, fn) => {
  const el = document.getElementById(id), v = document.getElementById(valId);
  el.oninput = () => { v.textContent = parseFloat(el.value).toFixed(el.step < 0.1 ? 2 : 1); fn(parseFloat(el.value)); };
};
bind('spd', 'spd-v', x => speed = x);
bind('warp', 'warp-v', x => mat.uniforms.uWarp.value = x);
bind('scl', 'scl-v', x => mat.uniforms.uScaleMul.value = x);
document.getElementById('pause').onclick = e => {
  playing = !playing; e.target.textContent = playing ? '⏸ PAUSE' : '▶ PLAY'; e.target.classList.toggle('on', !playing);
};
document.getElementById('mono').onclick = e => {
  const on = mat.uniforms.uMono.value = mat.uniforms.uMono.value ? 0 : 1; e.target.classList.toggle('on', !!on);
};
document.getElementById('grid').onclick = e => {
  const on = mat.uniforms.uGrid.value = mat.uniforms.uGrid.value ? 0 : 1; e.target.classList.toggle('on', !!on);
};
// clean / fullscreen view — hide all chrome (and request real fullscreen where allowed)
document.getElementById('full').onclick = () => {
  document.body.classList.add('clean');
  document.documentElement.requestFullscreen?.().catch(() => {});
};
document.getElementById('restore').onclick = () => {
  document.body.classList.remove('clean');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
};
document.addEventListener('fullscreenchange', () => {            // leaving fullscreen restores chrome
  if (!document.fullscreenElement) document.body.classList.remove('clean');
});

// ── focus mode: tap a tile → fullscreen, with a TILEABLE toggle ───────────────
const TILEABLE = new Set([1, 2, 3, 7, 8, 10, 11]);   // modes with a clean period
const focusbar = document.getElementById('focusbar');
const tileBtn = document.getElementById('tileable');
const statusEl = document.getElementById('tile-status');
function enterFocus(idx) {
  mat.uniforms.uFocus.value = idx; mat.uniforms.uTile.value = 0;
  tileBtn.textContent = 'TILEABLE: OFF'; tileBtn.classList.remove('on');
  document.getElementById('focus-name').textContent = TILES[idx].name;
  const ok = TILEABLE.has(idx);
  statusEl.textContent = ok ? '2×2 repeat · toggle to wrap the lattice & kill the seam'
                            : 'no clean period (screen-space / aperiodic) — seam stays, by design';
  statusEl.className = ok ? 'ok' : 'no';
  document.body.classList.add('focused'); focusbar.classList.add('show');
}
function exitFocus() {
  mat.uniforms.uFocus.value = -1;
  document.body.classList.remove('focused'); focusbar.classList.remove('show');
}
document.getElementById('scene').addEventListener('pointerdown', e => {
  if (mat.uniforms.uFocus.value >= 0) return;            // already focused → ignore field taps
  const col = Math.floor((e.clientX / innerWidth) * COLS);
  const row = Math.floor((e.clientY / innerHeight) * ROWS);
  enterFocus(Math.min(11, Math.max(0, row * COLS + col)));
});
document.getElementById('back').onclick = exitFocus;
tileBtn.onclick = () => {
  const on = mat.uniforms.uTile.value = mat.uniforms.uTile.value ? 0 : 1;
  tileBtn.textContent = 'TILEABLE: ' + (on ? 'ON' : 'OFF'); tileBtn.classList.toggle('on', !!on);
};
addEventListener('keydown', e => { if (e.key === 'Escape') exitFocus(); });

// ── boot ─────────────────────────────────────────────────────────────────────
function resize() { renderer.setSize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();
(function loop() {
  requestAnimationFrame(loop);
  const now = performance.now(), dt = (now - last) / 1000; last = now;
  if (playing) clock += dt * speed;
  mat.uniforms.uTime.value = clock;
  renderer.render(scene, camera);
})();

window.NG = { setSpeed: x => speed = x, setWarp: x => mat.uniforms.uWarp.value = x,
  focus: enterFocus, exit: exitFocus, tile: on => mat.uniforms.uTile.value = on ? 1 : 0, mat };
