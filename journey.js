/* The Road So Far — a life-journey path game (Three.js) */
(() => {
'use strict';
const $ = id => document.getElementById(id);
if (!window.THREE) { document.body.innerHTML = '<p style="padding:2rem;color:#fff;font-family:sans-serif">Three.js failed to load (vendor/three.min.js).</p>'; return; }
const T = THREE;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- save */
const SAVE_KEY = 'gully-journey-v1';
const save = { done: [], visited: [] };
function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && Array.isArray(s.done)) Object.assign(save, s); } catch (e) { } }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { } }
function resetSave() { Object.assign(save, { done: [], visited: [] }); persist(); }

/* --------------------------------------------------------------- audio */
let ac;
function beep(f = 520, d = .06, type = 'square', v = .035) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = v;
    g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch (e) { }
}
const chime = () => [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => beep(f, .35, 'sine', .05), i * 120));

/* --------------------------------------------------------------- state */
const state = { mode: 'title' };
let ticker = null, race = null;
const keys = new Set();
const joy = { x: 0, z: 0 };

/* ------------------------------------------------------------ renderer */
const host = $('game');
let renderer;
try {
  renderer = new T.WebGLRenderer({ antialias: true });
} catch (e) { host.innerHTML = '<p style="padding:2rem">WebGL is unavailable in this browser.</p>'; return; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
let post = null;
try { post = new Post(renderer); } catch (e) { post = null; console.warn('post-processing unavailable', e); }
const draw = (sc, cm) => post ? post.render(sc, cm) : renderer.render(sc, cm);

const scene = new T.Scene();
const skyCanvas = document.createElement('canvas'); skyCanvas.width = 2; skyCanvas.height = 256;
const skyTex = new T.CanvasTexture(skyCanvas); skyTex.colorSpace = T.SRGBColorSpace; scene.background = skyTex;
scene.fog = new T.Fog(0xe8efe0, 90, 320);
const camera = new T.PerspectiveCamera(48, 1, .8, 500);
function resize() { renderer.setSize(innerWidth, innerHeight); if (post) post.resize(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (window.ChessGame) ChessGame.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();

const hemi = new T.HemisphereLight(0xd6ecff, 0x86a860, 1.05); scene.add(hemi);
const sun = new T.DirectionalLight(0xfff0cf, 2.5);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 120 });
sun.shadow.bias = -.0005;
scene.add(sun, sun.target);

/* ------------------------------------------------------------- helpers */
const mats = new Map();
const toonGrad = (() => { const d = new Uint8Array([120, 120, 120, 255, 185, 185, 185, 255, 235, 235, 235, 255, 255, 255, 255, 255]); const t = new T.DataTexture(d, 4, 1, T.RGBAFormat); t.minFilter = t.magFilter = T.NearestFilter; t.needsUpdate = true; return t; })();
const mat = (c, r = .85, m = 0) => { const k = c; if (!mats.has(k)) mats.set(k, new T.MeshToonMaterial({ color: c, gradientMap: toonGrad })); return mats.get(k); };
const INK = 0x3b2a22, inkMat = new T.MeshBasicMaterial({ color: INK, side: T.BackSide });
function outline(mesh, k = 1.07) { const o = new T.Mesh(mesh.geometry, inkMat); o.scale.setScalar(k); mesh.add(o); return o; }
function add(parent, geo, material, x, y, z, shadow = true) { const m = new T.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; }
const box = (p, w, h, d, c, x, y, z, sh = true) => add(p, new T.BoxGeometry(w, h, d), mat(c), x, y, z, sh);
const cyl = (p, rt, rb, h, c, x, y, z, seg = 8) => add(p, new T.CylinderGeometry(rt, rb, h, seg), mat(c), x, y, z);
const sph = (p, r, c, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = add(p, new T.SphereGeometry(r, 14, 10), mat(c), x, y, z); m.scale.set(sx, sy, sz); return m; };
const world = new T.Group(); scene.add(world);
const walls = [], rounds = [];
const WEATHER_PEOPLE = [];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function signBoard(parent, text, w, h, x, y, z, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w); const g = c.getContext('2d');
  g.fillStyle = '#b98652'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 18; i++) { g.fillStyle = i % 2 ? '#c4935b' : '#a9794a'; g.fillRect(0, i * c.height / 18, c.width, c.height / 18 - 2); }
  g.strokeStyle = '#6b4428'; g.lineWidth = 10; g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = '#fff4d6'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = sub ? c.height * .44 : c.height * .56; g.font = `700 ${fs}px Georgia, serif`; while (g.measureText(text).width > c.width - 50) { fs -= 3; g.font = `700 ${fs}px Georgia, serif`; }
  g.fillText(text, c.width / 2, sub ? c.height * .38 : c.height * .52);
  if (sub) { g.font = `italic ${c.height * .2}px Georgia, serif`; g.fillStyle = '#ffe1a0'; g.fillText(sub, c.width / 2, c.height * .76); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  const m = new T.Mesh(new T.BoxGeometry(w, h, .14), [mat(0x8a5a36), mat(0x8a5a36), mat(0x8a5a36), mat(0x8a5a36), new T.MeshToonMaterial({ map: t, gradientMap: toonGrad }), mat(0x8a5a36)]);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}


const far = new T.Group(); scene.add(far);
/* --------------------------------------------------------------- world */
{
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#86bd5a'; x.fillRect(0, 0, 512, 512);
  let sd = 3; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const tones = ['#9acb64', '#74ad52', '#a8d46e', '#6aa64f'];
  for (let i = 0; i < 900; i++) { x.globalAlpha = .22; x.fillStyle = tones[i % 4]; x.beginPath(); x.ellipse(r() * 512, r() * 512, 10 + r() * 34, 6 + r() * 20, r() * 3, 0, 7); x.fill(); }
  x.globalAlpha = .55; x.strokeStyle = '#5f9a47'; x.lineWidth = 1.6;
  for (let i = 0; i < 1100; i++) { const a = r() * 512, b = r() * 512; x.beginPath(); x.moveTo(a, b); x.lineTo(a - 2, b - 6 - r() * 4); x.moveTo(a + 2, b); x.lineTo(a + 3, b - 5 - r() * 3); x.stroke(); }
  x.globalAlpha = 1; const fl = ['#ffffff', '#fff3a8', '#ffc4de'];
  for (let i = 0; i < 70; i++) { x.fillStyle = fl[i % 3]; x.beginPath(); x.arc(r() * 512, r() * 512, 2 + r() * 1.5, 0, 7); x.fill(); }
  const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(120, 120); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
  const gm = new T.Mesh(new T.PlaneGeometry(900, 900), new T.MeshToonMaterial({ map: tex, gradientMap: toonGrad }));
  gm.rotation.x = -Math.PI / 2; gm.receiveShadow = true; gm.position.set(0, 0, -140); world.add(gm);
}
const dirtTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#e3c590'; x.fillRect(0, 0, 256, 256);
  let sd = 11; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 380; i++) { x.globalAlpha = .35; x.fillStyle = ['#cfae78', '#f0d9a8', '#bf9d68'][i % 3]; x.beginPath(); x.ellipse(r() * 256, r() * 256, 2 + r() * 7, 1.5 + r() * 4, r() * 3, 0, 7); x.fill(); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; return t;
})();
function house(x, z, w, d, wall, roof) {
  const g = new T.Group(); g.position.set(x, 0, z); world.add(g);
  box(g, w, 3.4, d, wall, 0, 1.7, 0);
  const a = .5, pw = (w / 2) / Math.cos(a) + .5;
  for (const s of [-1, 1]) { const r = box(g, pw, .3, d + 1.2, roof, s * w / 4, 3.4 + (w / 4) * Math.tan(a), 0); r.rotation.z = -s * a; }
  box(g, 1.2, 2.2, .12, 0x5a3a22, 0, 1.1, d / 2 + .02, false);
  for (const s of [-1, 1]) { box(g, 1, 1, .1, 0xbfe3ea, s * w * .3, 2, d / 2 + .02, false); box(g, 1.15, .12, .14, 0x6b3e1d, s * w * .3, 1.45, d / 2 + .06, false); }
  box(g, w + .6, .35, 1.4, 0xcdbb98, 0, .17, d / 2 + .5, false);
  walls.push({ x0: x - w / 2 - .3, x1: x + w / 2 + .3, z0: z - d / 2 - .3, z1: z + d / 2 + .3 });
  return g;
}
function tree(x, z, s = 1, kind = 0) {
  const g = new T.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); world.add(g);
  const tr = cyl(g, .2, .34, 2.4, 0x8a6044, 0, 1.2, 0, 7); tr.rotation.z = Math.sin(x) * .06;
  const pal = [[0x6fb550, 0x5da04a, 0x82c860], [0x4f9a4c, 0x3f8a46, 0x66b35a], [0x8bc34f, 0x76b043, 0xa4d66a]][Math.abs(Math.floor(x * 3 + z)) % 3];
  if (kind === 1) { for (let i = 0; i < 3; i++) sph(g, 1.5 - i * .35, pal[i % 3], 0, 2.9 + i * 1.15, 0, 1, .85, 1); }
  else for (const [dx, dy, dz, r, k] of [[0, 3.6, 0, 1.55, 0], [-1.05, 3.2, .3, 1.15, 1], [1.1, 3.3, -.2, 1.2, 2], [.2, 4.5, .1, 1.05, 2], [.2, 3.1, 1.0, 1, 1]]) sph(g, r, pal[k], dx, dy, dz);
  rounds.push({ x, z, r: .6 * s });
  return g;
}
function bigTree(x, z, fruit) {
  const g = new T.Group(); g.position.set(x, 0, z); world.add(g);
  cyl(g, .7, 1.1, 5, 0x6b4c38, 0, 2.5, 0, 8);
  for (const [dx, dy, dz, r] of [[0, 6.5, 0, 3.6], [-2.6, 5.6, .6, 2.6], [2.8, 5.8, -.4, 2.8], [.4, 8, -.8, 2.4], [-1, 5, 2.4, 2.2], [1.6, 5, 2.2, 2.2]]) sph(g, r, 0x3f7a3a, dx, dy, dz);
  if (fruit) for (let i = 0; i < 9; i++) sph(g, .26, 0xc9d94a, Math.cos(i * 2.3) * 2.6, 4.4 + (i % 3) * .5, 1.4 + Math.sin(i * 2.3) * 1.6, 1, 1.3, 1);
  rounds.push({ x, z, r: 1.4 });
  return g;
}

/* portfolio landmarks (the CV, as a little neighbourhood) */
const PORT = [];
function landmark(id, x, z, o) {
  const w = o.w || 8, d = o.d || 6, g = new T.Group(); g.position.set(x, 0, z); world.add(g);
  box(g, w, 3.6, d, o.wall, 0, 1.8, 0);
  box(g, w + .5, .3, d + .5, 0xcdbb98, 0, .15, 0, false);
  if (o.timber) { for (const dx of [-w / 2 + .1, -w / 4, 0, w / 4, w / 2 - .1]) box(g, .22, 3.6, .1, 0x5a3a28, dx, 1.8, d / 2 + .06, false); for (const y of [.5, 1.9, 3.5]) box(g, w, .2, .1, 0x5a3a28, 0, y, d / 2 + .06, false); }
  if (o.dome) { const dm = sph(g, w * .42, o.roof, 0, 3.6, 0, 1, .9, 1); dm.geometry = new T.SphereGeometry(w * .42, 20, 12, 0, 6.283, 0, 1.6); box(g, .12, 1.1, .12, 0xe8c25a, 0, 3.6 + w * .38 + .4, 0, false); }
  else { const a = .62, pw = (w / 2) / Math.cos(a) + .6; for (const sg of [-1, 1]) { const r = box(g, pw, .35, d + 1.4, o.roof, sg * w / 4, 3.6 + (w / 4) * Math.tan(a) + .02, 0); r.rotation.z = -sg * a; } }
  if (o.tower) { box(g, 2.6, 6, 2.6, o.wall, w / 2 - 1.2, 3, -d / 2 + 1.2); const tp = new T.Mesh(new T.ConeGeometry(2.2, 2.4, 4), mat(o.roof)); tp.position.set(w / 2 - 1.2, 7.2, -d / 2 + 1.2); tp.rotation.y = Math.PI / 4; tp.castShadow = true; g.add(tp);
    const cf = cyl(g, .8, .8, .12, 0xfff3d0, w / 2 - 1.2, 5, -d / 2 + 2.54, 20); cf.rotation.x = Math.PI / 2; box(g, .08, .6, .05, 0x3b2a22, w / 2 - 1.2, 5.15, -d / 2 + 2.64, false); box(g, .5, .08, .05, 0x3b2a22, w / 2 - 1.0, 5.0, -d / 2 + 2.64, false); }
  box(g, 1.3, 2.3, .14, 0x7a4a2c, 0, 1.15, d / 2 + .04, false);
  sph(g, .09, 0xe8c25a, .4, 1.1, d / 2 + .14);
  for (const sg of [-1, 1]) { box(g, 1.2, 1.1, .12, 0xcfeaf2, sg * w * .3, 2.2, d / 2 + .04, false); box(g, 1.5, .14, .22, 0x7a4a2c, sg * w * .3, 1.55, d / 2 + .12, false); for (let k = 0; k < 3; k++) sph(g, .13, [0xff9db8, 0xffd36a, 0xffffff][k], sg * w * .3 - .4 + k * .4, 1.72, d / 2 + .15, 1, .8, 1); }
  signBoard(g, o.title, Math.min(w - 1, 6.6), 1.2, 0, 3.1, d / 2 + .5, o.sub);
  for (const sg of [-1, 1]) cyl(g, .07, .07, 3.7, 0x6a4428, sg * (Math.min(w - 1, 6.6) / 2 - .3), 1.85, d / 2 + .5, 6);
  if (o.prop) o.prop(g, w, d);
  walls.push({ x0: x - w / 2 - .4, x1: x + w / 2 + .4, z0: z - d / 2 - .4, z1: z + d / 2 + .4 });
  // glowing doorstep ring
  const ring = new T.Mesh(new T.RingGeometry(1.0, 1.35, 32), new T.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: .9, depthWrite: false, side: T.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, .12, z + d / 2 + 2.4); scene.add(ring);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffd36a, transparent: true, opacity: .55, depthWrite: false })); glow.scale.set(5, 5, 1); glow.position.set(x, .9, z + d / 2 + 2.4); scene.add(glow);
  PORT.push({ id, x, z, door: [x, z + d / 2 + 2.4], ring, glow, title: o.label || o.title });
}
function glowTex() { if (glowTex.t) return glowTex.t; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.35, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; glowTex.t = t; return t; }
// Cricket ground
const PITCH = { cx: 42, cz: -36, R: 11 };
const stumpMeshes = [];
const PITCH_WETNESS = [];
let pitchDamp = 0;
{
  const g = new T.Group(); g.position.set(PITCH.cx, 0, PITCH.cz); world.add(g);
  add(g, new T.CylinderGeometry(PITCH.R, PITCH.R, .06, 56), mat(0x7fc15a), 0, .03, 0, false);
  add(g, new T.CylinderGeometry(PITCH.R * .7, PITCH.R * .7, .07, 48), mat(0x97d368), 0, .035, 0, false);
  const rope = add(g, new T.TorusGeometry(PITCH.R, .09, 6, 72), mat(0xfdf6e3), 0, .1, 0, false); rope.rotation.x = Math.PI / 2;
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; cyl(g, .05, .05, .5, 0xd8402a, Math.cos(a) * PITCH.R, .3, Math.sin(a) * PITCH.R, 5); }
  box(g, 3, .06, 12.8, 0xd9bd8a, 0, .1, 0, false);
  // Fine wet patches catch the light as rain settles over the outfield and wicket.
  for (const [x, z, sx, sz] of [[-5.5, -2, 1.8, .72], [4.5, 3.3, 1.45, .62], [1.7, -4.8, 1.1, .5], [-2.2, 4.9, 1.35, .55], [0, 0, 1.05, 2.9]]) {
    const wet = new T.Mesh(new T.CircleGeometry(1, 24), new T.MeshBasicMaterial({ color: 0x9eb9c2, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
    wet.rotation.x = -Math.PI / 2; wet.position.set(x, Math.abs(x) < 1 && Math.abs(z) < 1 ? .145 : .077, z); wet.scale.set(sx, sz, 1); g.add(wet); PITCH_WETNESS.push(wet);
  }
  for (const z of [-5.5, 5.5, -4.2, 4.2]) box(g, z === 5.5 || z === -5.5 ? 3 : 2.6, .01, .06, 0xffffff, 0, .14, z, false);
  for (const z of [-5.95, 5.95]) for (const dx of [-.14, 0, .14]) { const st = add(g, new T.CylinderGeometry(.035, .035, .9, 6), mat(0xf6e7c6), dx, .55, z); if (z > 0) stumpMeshes.push(st); }
  for (const z of [-5.95, 5.95]) for (const dx of [-.07, .07]) box(g, .13, .03, .04, 0xd8402a, dx, 1.02, z, false);
  signBoard(g, 'GULLY  CC', 6.2, 1.5, 0, 2.2, -PITCH.R - 2.25);
  box(g, 7, 3, .25, 0xf6f6ee, 0, 1.6, -PITCH.R - 2.4); for (const x of [-3.2, 3.2]) cyl(g, .08, .08, 3.2, 0x555555, x, 1.6, -PITCH.R - 2.6, 6);
  box(g, 3.4, 1.8, .2, 0x2f5a3a, PITCH.R + 2.2, 1.6, -3); box(g, 3, .3, .06, 0xf6e7c6, PITCH.R + 2.2, 2.2, -2.88, false);
  for (const z of [-7, 0, 6]) box(g, .5, .5, 2.2, 0x9a633f, -PITCH.R - 1.6, .3, z);
}
// Banyan + chess table
{
  const g = new T.Group(); g.position.set(-34, 0, -93); world.add(g);
  cyl(g, .9, 1.4, 5, 0x5a3f2c, 0, 2.5, 0, 9);
  for (const [dx, dy, dz, r] of [[0, 6.5, 0, 4], [-3.4, 5.4, 1, 3], [3.4, 5.6, -1, 3.2], [0, 5, 3.4, 2.8]]) sph(g, r, 0x2f6a3a, dx, dy, dz);
  rounds.push({ x: -34, z: -93, r: 1.6 });
  const tb = new T.Group(); tb.position.set(-27, 0, -90); world.add(tb);
  cyl(tb, .5, .5, 1, 0xb9a98a, 0, .5, 0, 10); box(tb, 1.8, .15, 1.8, 0xd9c9a0, 0, 1.05, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) box(tb, .45, .02, .45, 0x6b4a2a, -.67 + i * .45, 1.14, -.67 + j * .45, false);
  rounds.push({ x: -27, z: -90, r: 1 });
}
// Rolling hills + far blue mountains
for (let i = 0; i < 22; i++) { const a = -3.2 + i * .15, r = 118 + (i % 3) * 8, h = 9 + (i * 5 % 9), m = add(far, new T.SphereGeometry(1, 18, 10), mat([0x6fae55, 0x5c9c50, 0x7dbb5f][i % 3]), Math.cos(a) * r * 1.1, 0, Math.sin(a) * r * .9 - 45, false); m.scale.set(28 + (i % 4) * 7, h, 24); }
for (let i = 0; i < 14; i++) { const a = -3.3 + i * .24, m = add(far, new T.ConeGeometry(30 + (i % 3) * 10, 40 + (i * 7 % 22), 6), mat([0x9db8d6, 0x8fabd0, 0xa9c2dc][i % 3]), Math.cos(a) * 205, 14, Math.sin(a) * 175 - 70, false); m.scale.x = 1.6; }
// Soft sun glow
const SUNS = {};
{ const sg = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xfff1c0, transparent: true, opacity: .95, fog: false, depthWrite: false })); sg.scale.set(90, 90, 1); sg.position.set(-70, 80, -200); far.add(sg); SUNS.glow = sg;
  const sc = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, opacity: 1, fog: false, depthWrite: false })); sc.scale.set(30, 30, 1); sc.position.set(-70, 80, -199); far.add(sc); SUNS.core = sc; }
// Painted cumulus clouds
const cloudTex = (() => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  let sd = 5; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const blobs = []; for (let i = 0; i < 16; i++) { const t = i / 15; blobs.push([70 + t * 370, 150 - Math.sin(t * 3.14) * 50 + r() * 14, 34 + Math.sin(t * 3.14) * 38 + r() * 16]); }
  for (const [x, y, rad] of blobs) { const gr = g.createRadialGradient(x, y - rad * .25, rad * .1, x, y, rad); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.7, '#f4f8fc'); gr.addColorStop(1, '#c9d9ea'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); }
  g.globalCompositeOperation = 'destination-in'; const m = g.createLinearGradient(0, 0, 0, 256); m.addColorStop(0, '#fff'); m.addColorStop(.78, '#fff'); m.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = m; g.fillRect(0, 0, 512, 256);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
})();
const clouds = [];
for (let i = 0; i < 12; i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: .96 })); const w = 55 + rnd() * 60; sp.scale.set(w, w * .5, 1); sp.position.set(-170 + rnd() * 340, 85 + rnd() * 55, -280 - rnd() * 60); far.add(sp); clouds.push(sp); }
// Drifting pollen & petals
const motes = (() => {
  const n = 160, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { p[i * 3] = rnd() * 60 - 30; p[i * 3 + 1] = rnd() * 10; p[i * 3 + 2] = rnd() * 40 - 20; }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
  const pts = new T.Points(g, new T.PointsMaterial({ color: 0xfff3b0, map: glowTex(), size: .45, transparent: true, opacity: .85, depthWrite: false })); scene.add(pts); return pts;
})();

function person(o) {
  const g = new T.Group(), body = new T.Group(); g.add(body);
  const tm = c => new T.MeshToonMaterial({ color: c, gradientMap: toonGrad });
  const skin = tm(o.skin || 0xf0b98a), torsoMat = tm(o.shirt || 0xf08a4b), legMat = tm(o.pants || 0x35507a);
  const ink = (m, k) => outline(m, k);
  const torso = add(body, new T.CapsuleGeometry(.24, .5, 4, 12), torsoMat, 0, 1.12, 0); ink(torso, 1.08);
  const head = new T.Group(); head.position.y = 1.95; body.add(head);
  const face = add(head, new T.SphereGeometry(.3, 20, 14), skin, 0, 0, 0); face.scale.set(.95, 1, .95); ink(face, 1.06);
  for (const sg of [-1, 1]) { const ear = add(head, new T.SphereGeometry(.07, 8, 6), skin, sg * .295, -.01, -.01, false); ear.scale.set(.6, 1, .8); }
  for (const s of [-1, 1]) {
    const e = add(head, new T.SphereGeometry(.04, 8, 6), new T.MeshBasicMaterial({ color: 0x2a1c18 }), s * .1, .0, .275, false); e.scale.set(.9, 1.35, .5);
    const hl = add(head, new T.SphereGeometry(.012, 6, 4), new T.MeshBasicMaterial({ color: 0xffffff }), s * .1 + .012, .02, .292, false);
    const bl = add(head, new T.SphereGeometry(.05, 8, 6), new T.MeshBasicMaterial({ color: 0xff9a8a, transparent: true, opacity: .45 }), s * .17, -.07, .245, false); bl.scale.set(1, .6, .35);
    const br = add(head, new T.BoxGeometry(o.brow ? .125 : .1, o.brow ? .034 : .018, .02), new T.MeshBasicMaterial({ color: 0x3b2a22 }), s * .1, .075, .27, false);
  }
  add(head, new T.SphereGeometry(.022, 6, 5), tm(0xd89a74), 0, -.04, .295, false);
  const mo = add(head, new T.SphereGeometry(.03, 8, 5), new T.MeshBasicMaterial({ color: 0xb5524a }), 0, -.115, .27, false); mo.scale.set(1.3, .4, .5);
  const hc = tm(o.hairColor ?? 0x2a1d17);
  if (o.hair !== 'bald' && o.hair !== 'none') {
    const cap = add(head, new T.SphereGeometry(.325, 18, 12, 0, Math.PI * 2, 0, Math.PI * .58), hc, 0, .04, -.03); ink(cap, 1.05);
    for (const [x, y, r] of [[-.2, .2, .11], [-.08, .26, .12], [.06, .27, .12], [.19, .21, .11], [.27, .1, .1], [-.27, .1, .1]]) { const f = add(head, new T.SphereGeometry(r, 8, 6), hc, x, y, .2 + (Math.abs(x) < .1 ? .03 : 0)); f.scale.set(1, .85, .8); }
    for (const sg of [-1, 1]) { const sb = add(head, new T.SphereGeometry(.07, 8, 6), hc, sg * .29, -.02, .02); sb.scale.set(.6, 1.3, .9); }
    const ah = add(head, new T.ConeGeometry(.04, .2, 6), hc, .02, .43, .02, false); ah.rotation.z = -.5;
    if (o.hair === 'bun') sph(head, .13, o.hairColor ?? 0x2a1d17, 0, .3, -.18);
  }
  if (o.glasses) for (const s of [-1, 1]) add(head, new T.TorusGeometry(.08, .014, 5, 14), mat(0x3b2a22), s * .1, .0, .29, false);
  if (o.moustache) { const mm = box(head, .22, .045, .07, 0xf2f0ea, 0, -.08, .27, false); }
  if (o.beard) { const bd = add(head, new T.SphereGeometry(.2, 12, 8, 0, Math.PI * 2, Math.PI * .5, Math.PI * .5), hc, 0, -.08, .05); bd.scale.set(1, .9, 1); }
  let setAge = () => { };
  if (o.me) {
    const hm = tm(o.hairColor ?? 0x1e1512), kid = new T.Group(), man = new T.Group(); head.add(kid, man);
    const cap0 = add(kid, new T.SphereGeometry(.325, 18, 12, 0, Math.PI * 2, 0, Math.PI * .56), hm, 0, .04, -.03); outline(cap0, 1.05);
    for (const [x, y, z, r] of [[-.2, .2, .2, .11], [-.07, .26, .22, .12], [.07, .27, .22, .12], [.2, .2, .2, .11], [.27, .08, .12, .1], [-.27, .08, .12, .1]]) { const f = add(kid, new T.SphereGeometry(r, 8, 6), hm, x, y, z); f.scale.set(1, .85, .8); }
    const cap1 = add(man, new T.SphereGeometry(.33, 18, 12, 0, Math.PI * 2, 0, Math.PI * .54), hm, 0, .06, -.07); cap1.rotation.x = -.22; outline(cap1, 1.05);
    for (const [x, y, z, r, sy] of [[-.15, .33, .1, .14, .9], [0, .39, .06, .17, .95], [.15, .35, .04, .14, .9], [0, .34, -.1, .2, .85], [-.2, .28, -.02, .12, .9], [.21, .29, -.02, .12, .9], [0, .31, .2, .1, .8], [0, .22, -.24, .17, .9]]) { const b = add(man, new T.SphereGeometry(r, 10, 8), hm, x, y, z); b.scale.set(1, sy, 1.05); outline(b, 1.06); }
    for (const [x, rz] of [[-.1, .5], [.05, -.1], [.17, -.5]]) { const t = add(man, new T.ConeGeometry(.05, .15, 5), hm, x, .56, .02, false); t.rotation.z = rz; }
    for (const sg of [-1, 1]) { const sb = add(man, new T.SphereGeometry(.06, 8, 6), hm, sg * .285, -.02, .04); sb.scale.set(.55, 1.4, .8); }
    const stache = new T.Group(); head.add(stache); add(stache, new T.BoxGeometry(.2, .032, .05), hm, 0, -.083, .275, false);
    for (const sg of [-1, 1]) { const w = add(stache, new T.BoxGeometry(.08, .03, .05), hm, sg * .09, -.1, .262, false); w.rotation.z = sg * .35; }
    const goat = new T.Group(); head.add(goat);
    const ch = add(goat, new T.SphereGeometry(.2, 14, 8, 0, Math.PI * 2, Math.PI * .56, Math.PI * .44), new T.MeshToonMaterial({ color: 0x1e1512, gradientMap: toonGrad, transparent: true, opacity: .8 }), 0, -.08, .04, false); ch.scale.set(1, .95, 1.02);
    add(goat, new T.SphereGeometry(.05, 8, 6), hm, 0, -.2, .24, false).scale.set(1.3, 1.1, .8);
    setAge = kind => { kid.visible = kind === 'kid'; man.visible = kind !== 'kid'; stache.visible = kind !== 'kid'; goat.visible = kind === 'adult'; };
    setAge('adult');
  }
  const legs = [], arms = [];
  if (o.dress) { add(body, new T.CylinderGeometry(.3, .58, .95, 10), legMat, 0, .5, 0); }
  for (const s of [-1, 1]) {
    const lp = new T.Group(); lp.position.set(s * .15, .75, 0); body.add(lp);
    if (!o.dress) { const lg = add(lp, new T.CapsuleGeometry(.11, .48, 4, 8), legMat, 0, -.36, 0); ink(lg, 1.08); }
    const sh = add(lp, new T.SphereGeometry(.14, 10, 8), tm(o.shoe ?? 0x7a5238), 0, -.74, .06); sh.scale.set(1, .6, 1.5); legs.push(lp);
    const ap = new T.Group(); ap.position.set(s * .33, 1.5, 0); body.add(ap);
    const ar = add(ap, new T.CapsuleGeometry(.075, .5, 4, 8), torsoMat, 0, -.3, 0); ink(ar, 1.1); add(ap, new T.SphereGeometry(.085, 8, 6), skin, 0, -.66, 0); if (o.me && s === 1) { add(ap, new T.CylinderGeometry(.088, .088, .07, 12), tm(0x24242a), 0, -.56, 0, false); add(ap, new T.BoxGeometry(.05, .02, .1), new T.MeshBasicMaterial({ color: 0x7fd0e8 }), s * .0, -.56, .0, false).position.x = .085; } arms.push(ap);
  }
  // A compact open umbrella, hidden until rain reaches the character's area.
  const umbrella = new T.Group(); umbrella.position.set(.34, 0, .03); umbrella.visible = false; g.add(umbrella);
  const canopyColor = [0xd8402a, 0x397c98, 0xf0b84a, 0x8a4a8a, 0x3f8f88][Math.floor(Math.random() * 5)];
  const canopy = add(umbrella, new T.SphereGeometry(.57, 16, 8, 0, Math.PI * 2, 0, Math.PI * .5), tm(canopyColor), 0, 2.55, 0, false);
  canopy.scale.y = .34;
  const pole = add(umbrella, new T.CylinderGeometry(.025, .025, 1.36, 7), tm(0x59432d), 0, 1.78, 0, false);
  const hook = add(umbrella, new T.TorusGeometry(.09, .024, 5, 10, Math.PI), tm(0x59432d), 0, 1.12, .07, false); hook.rotation.x = Math.PI / 2;
  g.scale.setScalar(o.scale || 1);
  const p = { g, body, legs, arms, torsoMat, legMat, head, setAge, umbrella };
  WEATHER_PEOPLE.push(p);
  return p;
}
function walkAnim(p, phase, amt) {
  const s = Math.sin(phase) * .8 * amt;
  p.legs[0].rotation.x = s; p.legs[1].rotation.x = -s; p.arms[0].rotation.x = -s; p.arms[1].rotation.x = s;
  p.body.position.y = Math.abs(Math.sin(phase)) * .07 * amt;
}


/* ================================================================ THE JOURNEY */
const PATH = [[0, 44], [0, 0], [24, -14], [10, -44], [-14, -76], [-22, -100], [-6, -130], [-8, -160], [46, -160], [52, -190], [50, -215], [-20, -215], [-20, -250], [0, -285], [0, -318]];
const CUM = [0]; for (let i = 1; i < PATH.length; i++) CUM.push(CUM[i - 1] + Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]));
const TOTAL = CUM[CUM.length - 1], CORR = 56;
function pathNear(x, z) {
  let best = { d: 1e9 };
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), px = ax + dx * u, pz = az + dz * u, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz, s: CUM[i] + u * Math.sqrt(L2), i };
  }
  return best;
}
function pointAt(s) {
  s = clamp(s, 0, TOTAL); let i = 0; while (i < PATH.length - 2 && CUM[i + 1] < s) i++;
  const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], L = CUM[i + 1] - CUM[i], u = (s - CUM[i]) / L;
  return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, tx: (bx - ax) / L, tz: (bz - az) / L };
}
// the dirt road, office forecourt and stunt lane are painted as one soft decal (see 'ground paint' further down)
// golden stepping dots along the road
const DOTS = []; {
  const n = Math.floor(TOTAL / 3.2), im = new T.InstancedMesh(new T.CircleGeometry(.26, 12), new T.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: .9, depthWrite: false }), n);
  const q = new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)), m4 = new T.Matrix4();
  for (let i = 0; i < n; i++) { const s = 3 + i * 3.2, p = pointAt(s); m4.compose(new T.Vector3(p.x, .1, p.z), q, new T.Vector3(1, 1, 1)); im.setMatrixAt(i, m4); im.setColorAt(i, new T.Color(0xfff1b8)); DOTS.push(s); }
  im.frustumCulled = false; scene.add(im); DOTS.im = im;
}
// stations
const STN = [];
function ringAt(x, z, col = 0xffd36a) {
  const ring = new T.Mesh(new T.RingGeometry(1.0, 1.35, 32), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: .9, depthWrite: false, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(x, .12, z); scene.add(ring);
  const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: col, transparent: true, opacity: .5, depthWrite: false })); glow.scale.set(5, 5, 1); glow.position.set(x, .9, z); scene.add(glow);
  return { ring, glow };
}
// ---- start: a few homes
house(-16, 34, 8, 6, 0xf1d9a8, 0xb5532b); house(15, 28, 7, 6, 0xd7a6b0, 0x6b3e1d); house(-18, 8, 7, 6, 0xb9d7e0, 0x7a4a3a); house(16, 4, 6, 6, 0xe5c26b, 0x9a5a3a);
// ---- act 3: B.I.T. campus (north of the east-west stretch at z=-160)
{
  const g = new T.Group(); g.position.set(12, 0, -169); world.add(g);
  box(g, 22, 5, 8, 0xf6e1a8, 0, 2.5, 0); box(g, 23, .5, 9, 0xc4553a, 0, 5.2, 0);
  box(g, 3.4, 3.4, .2, 0x6b3e1d, 0, 1.7, 4.05, false);
  for (const x of [-8, -5, 5, 8]) box(g, 1.6, 1.8, .15, 0x9fd0dc, x, 2.8, 4.05, false);
  box(g, 6, 3, 6, 0xf6e1a8, 0, 6.8, 0); const roof = new T.Mesh(new T.ConeGeometry(4.6, 2.6, 4), mat(0xc4553a)); roof.position.set(0, 9.6, 0); roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  const cf = cyl(g, .9, .9, .12, 0xfff3d0, 0, 7, 3.06, 20); cf.rotation.x = Math.PI / 2; box(g, .08, .7, .05, 0x3b2a22, 0, 7.15, 3.14, false); box(g, .55, .08, .05, 0x3b2a22, .2, 7, 3.14, false);
  signBoard(g, 'B.I.T.', 5.4, 1.4, 0, 4.2, 4.5, 'Sathyamangalam'); for (const sg of [-1, 1]) cyl(g, .07, .07, 4.4, 0x6a4428, sg * 2.4, 2.2, 4.5, 6);
  // tricolour on a proper pole: saffron / white / green, navy Ashoka Chakra, waving cloth
  box(g, 1.4, .3, 1.4, 0xb8b0a0, 13, .15, 5); box(g, 1, .3, 1, 0xd8d0c0, 13, .45, 5);
  cyl(g, .07, .1, 8.2, 0xe8e8ee, 13, 4.6, 5, 8); sph(g, .2, 0xe8b84a, 13, 8.9, 5);
  const fc = document.createElement('canvas'); fc.width = 360; fc.height = 240; { const x = fc.getContext('2d'); x.fillStyle = '#ff9933'; x.fillRect(0, 0, 360, 80); x.fillStyle = '#ffffff'; x.fillRect(0, 80, 360, 80); x.fillStyle = '#138808'; x.fillRect(0, 160, 360, 80);
    x.strokeStyle = '#000080'; x.fillStyle = '#000080'; x.lineWidth = 3; x.beginPath(); x.arc(180, 120, 34, 0, 7); x.stroke(); x.beginPath(); x.arc(180, 120, 6, 0, 7); x.fill();
    for (let k = 0; k < 24; k++) { const a = k / 24 * 6.2832; x.lineWidth = 2; x.beginPath(); x.moveTo(180 + Math.cos(a) * 6, 120 + Math.sin(a) * 6); x.lineTo(180 + Math.cos(a) * 33, 120 + Math.sin(a) * 33); x.stroke(); x.beginPath(); x.arc(180 + Math.cos(a + .13) * 28, 120 + Math.sin(a + .13) * 28, 2.2, 0, 7); x.fill(); } }
  const ftex = new T.CanvasTexture(fc); ftex.encoding = T.sRGBEncoding; ftex.colorSpace = T.SRGBColorSpace || ftex.colorSpace;
  const fgeo = new T.PlaneGeometry(3.3, 2.2, 24, 12), fmesh = new T.Mesh(fgeo, new T.MeshBasicMaterial({ map: ftex, side: T.DoubleSide })); fmesh.position.set(13.05 + 1.65, 7.7, 5); g.add(fmesh); window.__flag = fmesh;
  const fbase = Float32Array.from(fgeo.attributes.position.array);
  (globalThis.PREAMB = globalThis.PREAMB || []).push(t => { const p = fgeo.attributes.position; for (let k = 0; k < p.count; k++) { const bx = fbase[k * 3], u = (bx + 1.65) / 3.3; p.setZ(k, Math.sin(bx * 2.6 - t * 4.2) * .16 * u + Math.sin(bx * 1.3 - t * 2.1 + fbase[k * 3 + 1]) * .06 * u); p.setY(k, fbase[k * 3 + 1] - Math.sin(bx * 2.6 - t * 4.2) * .03 * u); } p.needsUpdate = true; });
  walls.push({ x0: 0, x1: 24, z0: -174, z1: -164.4 });
  const r = ringAt(12, -162.4); STN.push({ id: 'edu', x: 12, z: -162.4, label: 'Visit · Bannari Amman Institute of Technology', kind: 'folio', act: 2, ...r });
}
// ---- landmarks: hackathon hall (college) and the working street
const ST0 = PORT.length;
landmark('ach', 36, -168, { title: 'HALL OF FAME', sub: 'BIT Hackathon', label: 'Hall of Fame · BIT Hackathon', wall: 0xf3e2b8, roof: 0xc4573a, w: 8, d: 6,
  prop: (g, w, d) => { cyl(g, .55, .7, .8, 0xd9d2c0, w / 2 + 1.4, .4, d / 2 - 1, 10); cyl(g, .38, .12, .55, 0xf2c14e, w / 2 + 1.4, 1.1, d / 2 - 1, 12); cyl(g, .08, .08, .4, 0xf2c14e, w / 2 + 1.4, 1.0, d / 2 - 1, 6); sph(g, .08, 0xf2c14e, w / 2 + 1.4, 1.5, d / 2 - 1); } });
// ---- one Grootan office: park, step off the bike and walk in (the projects are inside)
const OFFICE = { x: 24, z: -223, w: 26, d: 11 };
{
  const { x, z, w, d } = OFFICE, g = new T.Group(); g.position.set(x, 0, z); world.add(g);
  const mk = (c, tex) => new T.MeshToonMaterial({ color: c, gradientMap: toonGrad });
  // forecourt paving is part of the ground paint decal
  box(g, w, 9, d, 0xdfe6ee, 0, 4.5, 0); box(g, w + .6, 1.4, d + .6, 0x4f6fa8, 0, 9.5, 0);
  box(g, w * .6, 3, d * .66, 0xcdd7e3, -w * .12, 11.7, -.8); box(g, w * .6 + .5, .35, d * .66 + .5, 0x3c5788, -w * .12, 13.35, -.8);
  for (const y of [3.05, 5.95]) box(g, w + .3, .22, d + .3, 0xaab6c6, 0, y, 0, false);
  for (let f = 0; f < 3; f++) for (let k = 0; k < 9; k++) { const wx = -w / 2 + 1.9 + k * 2.85; if (f === 0 && Math.abs(wx) < 3.4) continue;
    const wy = 1.8 + f * 2.95; box(g, 2.3, 1.8, .12, 0x7fb4d6, wx, wy, d / 2 + .05, false); box(g, 2.45, .1, .16, 0xffffff, wx, wy - .95, d / 2 + .06, false); box(g, 2.45, .1, .16, 0xffffff, wx, wy + .95, d / 2 + .06, false); box(g, .08, 1.8, .16, 0xffffff, wx, wy, d / 2 + .06, false); }
  for (const sx of [-1, 1]) for (let f = 0; f < 3; f++) box(g, .12, 1.8, 6.5, 0x7fb4d6, sx * (w / 2 + .05), 1.8 + f * 2.95, 0, false);
  // glass entrance, canopy, steps
  box(g, 4.6, 3.1, .16, 0x9fd8e8, 0, 1.55, d / 2 + .08, false); for (const mx of [-1.1, 0, 1.1]) box(g, .08, 3.1, .2, 0xe8eef5, mx, 1.55, d / 2 + .1, false);
  for (const hx of [-.35, .35]) box(g, .08, .7, .1, 0x3c5788, hx, 1.5, d / 2 + .22, false);
  box(g, 7.4, .28, 3.4, 0x4f6fa8, 0, 3.55, d / 2 + 1.7); for (const sx of [-3.3, 3.3]) cyl(g, .1, .1, 3.5, 0xe8eef5, sx, 1.75, d / 2 + 3.2, 8);
  box(g, 6.4, .02, 2.6, 0xd8d0c0, 0, .1, d / 2 + 1.5, false); box(g, 5.6, .02, 1.5, 0xe6dfd0, 0, .12, d / 2 + .9, false);
  // big sign on the roof band
  const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 128; { const c = sc.getContext('2d'); c.fillStyle = '#3c5788'; c.fillRect(0, 0, 1024, 128); c.fillStyle = '#ffffff'; c.font = '800 70px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('GROOTAN TECHNOLOGIES', 540, 68);
    c.strokeStyle = '#ffd36a'; c.lineWidth = 9; c.beginPath(); c.arc(86, 64, 36, .5, 5.8); c.stroke(); c.fillStyle = '#ffd36a'; c.beginPath(); c.arc(86, 64, 11, 0, 7); c.fill(); }
  const stex = new T.CanvasTexture(sc); stex.colorSpace = T.SRGBColorSpace;
  const sgn = new T.Mesh(new T.PlaneGeometry(14.4, 1.2), new T.MeshBasicMaterial({ map: stex })); sgn.position.set(0, 9.5, d / 2 + .33); g.add(sgn);
  // rooftop plant + AC, planters, lamps
  for (let k = 0; k < 3; k++) box(g, 1.6, .9, 1.1, 0xb8bcc4, -w * .36 + k * 2.2, 10.1, 2.4, false);
  for (const sx of [-5.2, 5.2]) { box(g, 1.6, .7, .9, 0x8a5a36, sx, .35, d / 2 + 2.6); sph(g, .8, 0x4f9a52, sx, 1.2, d / 2 + 2.6, 1, 1.1, 1); }
  for (const sx of [-13.8, 13.8]) { cyl(g, .08, .1, 3.6, 0x444850, sx, 1.8, d / 2 + 1.8, 6); sph(g, .26, 0xfff1b0, sx, 3.7, d / 2 + 1.8); }
  // parking bay for the bike (right of the door)
  const BX = 9.2, BZ = d / 2 + 4.6; box(g, 5.2, .02, 3.4, 0x5c6068, BX, .1, BZ, false); for (let k = -1; k <= 1; k++) box(g, .1, .02, 2.8, 0xffffff, BX + k * 1.7, .12, BZ, false);
  cyl(g, .06, .06, 2.2, 0x6c7078, BX + 2.8, 1.1, BZ + 1.4, 6); signBoard(g, 'PARKING', 1.8, .6, BX + 2.8, 2.4, BZ + 1.5);
  walls.push({ x0: x - w / 2 - .4, x1: x + w / 2 + .4, z0: z - d / 2 - .4, z1: z + d / 2 + .4 });
  OFFICE.bay = { x: x + BX, z: z + BZ }; OFFICE.door = { x, z: z + d / 2 + 2.4 };
  const dr = ringAt(x, z + d / 2 + 2.4); dr.ring.position.y = .16; STN.push({ id: 'office', x, z: z + d / 2 + 2.4, label: 'Enter · Grootan Technologies', kind: 'door', act: 3, ...dr });
}
// Blue hologram kiosk outside the office opens the complete in-game portfolio.
{
  const H = { x: 13.5, z: -208.2 }, g = new T.Group(); g.position.set(H.x, 0, H.z); world.add(g);
  const blue = c => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: .8, depthWrite: false });
  const base = new T.Mesh(new T.CylinderGeometry(1.05, 1.2, .18, 32), new T.MeshToonMaterial({ color: 0x152e4a, gradientMap: toonGrad })); base.position.y = .12; base.castShadow = true; g.add(base);
  const pad = new T.Mesh(new T.TorusGeometry(.92, .055, 8, 48), blue(0x39c9ff)); pad.rotation.x = Math.PI / 2; pad.position.y = .23; g.add(pad);
  const beam = new T.Mesh(new T.CylinderGeometry(.56, .78, 1.5, 24, 1, true), blue(0x32bfff)); beam.material.opacity = .12; beam.position.y = 1.08; g.add(beam);
  const rings = [.62, 1.15, 1.72].map((y, i) => { const r = new T.Mesh(new T.TorusGeometry(.76 - i * .07, .025, 6, 40), blue(i === 1 ? 0x9deaff : 0x36c5ff)); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); return r; });
  const screenTex = textCanvas(512, 512, (c, w, h) => {
    const grad = c.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#08243ccc'); grad.addColorStop(1, '#1269aacc'); c.fillStyle = grad; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#62d9ff'; c.lineWidth = 8; c.strokeRect(12, 12, w - 24, h - 24);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#e8fbff'; c.shadowColor = '#39c9ff'; c.shadowBlur = 18;
    c.font = '800 48px system-ui, sans-serif'; c.fillText('JEEVA S U', w / 2, 106);
    c.shadowBlur = 0; c.font = '700 27px system-ui, sans-serif'; c.fillStyle = '#9deaff'; c.fillText('SOFTWARE ENGINEER', w / 2, 166);
    c.font = '600 24px system-ui, sans-serif'; c.fillStyle = '#e8fbff'; c.fillText('EDUCATION · PROJECTS', w / 2, 252); c.fillText('EXPERIENCE · SKILLS', w / 2, 294);
    c.font = '800 24px system-ui, sans-serif'; c.fillStyle = '#62d9ff'; c.fillText('PRESS E TO EXPLORE', w / 2, 404);
  });
  const screen = new T.Sprite(new T.SpriteMaterial({ map: screenTex, transparent: true, depthWrite: false, toneMapped: false })); screen.scale.set(2.25, 2.25, 1); screen.position.set(0, 2.35, .08); g.add(screen);
  const title = wordSprite('JEEVA · PORTFOLIO', '#39c9ff'); title.scale.set(3.4, .72, 1); title.position.set(0, 3.85, 0); g.add(title);
  const light = new T.PointLight(0x35bfff, 8, 9, 2); light.position.y = 1.4; g.add(light);
  rounds.push({ x: H.x, z: H.z, r: 1.15 });
  const r = ringAt(H.x, H.z + 1.7, 0x39c9ff);
  STN.push({ id: 'portfolio', x: H.x, z: H.z + 1.7, label: 'Explore · Jeeva’s portfolio hologram', kind: 'hologram', act: -1, ...r });
  (globalThis.PREAMB = globalThis.PREAMB || []).push(t => {
    rings.forEach((ring, i) => { ring.rotation.z = t * (i % 2 ? -.45 : .55); ring.material.opacity = .5 + .35 * Math.sin(t * 2 + i); });
    title.material.opacity = .78 + .22 * Math.sin(t * 2.2); light.intensity = 6 + 3 * (1 + Math.sin(t * 2.5));
  });
}
// ---- inside Grootan: lobby, project screens, desks (a separate room far off the map)
const INT = { x: 300, z: -223, W: 34, D: 22 }; let INTGLASS = null;
{
  const { x, z, W, D } = INT, g = new T.Group(); g.position.set(x, 0, z); world.add(g);
  const pc = document.createElement('canvas'); pc.width = pc.height = 256; { const c = pc.getContext('2d'); c.fillStyle = '#c9a87a'; c.fillRect(0, 0, 256, 256); for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#bf9c6e' : '#d2b284'; c.fillRect(0, k * 32, 256, 31); c.fillStyle = '#a98657'; c.fillRect(k * 37 % 256, k * 32, 2, 31); } }
  const ptex = new T.CanvasTexture(pc); ptex.wrapS = ptex.wrapT = T.RepeatWrapping; ptex.repeat.set(7, 5); ptex.colorSpace = T.SRGBColorSpace;
  { const out = new T.Mesh(new T.BoxGeometry(170, .1, 130), new T.MeshToonMaterial({ color: 0x2c3244, gradientMap: toonGrad })); out.position.set(0, .0, 12); out.receiveShadow = true; g.add(out); }
  const fl = new T.Mesh(new T.BoxGeometry(W, .2, D), new T.MeshToonMaterial({ map: ptex, gradientMap: toonGrad })); fl.position.y = 0; fl.receiveShadow = true; g.add(fl);
  // rug with the logo
  const rc = document.createElement('canvas'); rc.width = rc.height = 256; { const c = rc.getContext('2d'); c.fillStyle = '#35507a'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#ffd36a'; c.lineWidth = 10; c.beginPath(); c.arc(128, 128, 62, .5, 5.8); c.stroke(); c.fillStyle = '#ffd36a'; c.beginPath(); c.arc(128, 128, 18, 0, 7); c.fill(); c.strokeStyle = '#ffffff55'; c.lineWidth = 4; c.strokeRect(8, 8, 240, 240); }
  const rtex = new T.CanvasTexture(rc); rtex.colorSpace = T.SRGBColorSpace; const rug = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshBasicMaterial({ map: rtex })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, .125, 4.5); g.add(rug);
  // walls (open front and top so the camera can see in)
  box(g, W + 1, 6.04, .5, 0xe9e2d4, 0, 3.02, -D / 2); box(g, W + 1, 1.5, .5, 0x4f6fa8, 0, .75, -D / 2 + .3); for (const sx of [-1, 1]) { box(g, .5, 6, D - .06, 0xe9e2d4, sx * W / 2, 3, .03); box(g, .5, 1.46, D - .1, 0x4f6fa8, sx * (W / 2 - .3), .73, .05); }
  for (const sg of [-1, 1]) { box(g, W / 2 - 2.6, 1.1, .3, 0xd8dde6, sg * (W / 4 + 1.3), .55, D / 2); }
  box(g, W + 1.06, .3, .56, 0x4f6fa8, 0, 6.15, -D / 2);
  const sTex = (icon, title, sub, c1, c2) => { const c = document.createElement('canvas'); c.width = 512; c.height = 288; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 512, 288); gr.addColorStop(0, c1); gr.addColorStop(1, c2); x.fillStyle = gr; x.fillRect(0, 0, 512, 288);
    x.fillStyle = '#ffffff22'; x.beginPath(); x.arc(430, 60, 120, 0, 7); x.fill(); x.font = '90px serif'; x.textAlign = 'left'; x.fillStyle = '#fff'; x.fillText(icon, 36, 120); x.font = '800 38px system-ui, sans-serif'; x.fillText(title, 36, 190); x.font = '500 22px system-ui, sans-serif'; x.fillStyle = '#ffffffcc'; x.fillText(sub, 36, 226);
    x.font = '700 16px system-ui, sans-serif'; x.fillStyle = '#ffd36a'; x.fillText('PRESS E · OPEN THE SLIDES', 36, 262); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; };
  const SCR = [['ibm', '🔐', 'IBM PKV', 'Insurance · HSM keys', '#1d3b5a', '#3f7a8a', -12.5], ['ibb', '🕌', 'IBB Istanbul', 'Istanbul Senin city app', '#2a4a58', '#3a8a9a', -4.2], ['city', '🏰', 'CityApp Worms', 'Citizen app · GDPR consent', '#5a2f1d', '#b5532b', 4.2], ['skills', '🧰', 'The Tool Shed', 'Skills and stack', '#2d4a2a', '#6b8f4a', 12.5]];
  for (const [id, ic, ti, su, c1, c2, sx] of SCR) {
    box(g, 6.5, 3.8, .22, 0x1c2230, sx, 3.4, -D / 2 + .45); const sm = new T.Mesh(new T.PlaneGeometry(6.1, 3.43), new T.MeshBasicMaterial({ map: sTex(ic, ti, su, c1, c2) })); sm.position.set(sx, 3.4, -D / 2 + .58); g.add(sm);
    box(g, 2.6, .9, 1.1, 0xe8e2d2, sx, .45, -D / 2 + 2.4); box(g, 2.2, .1, .8, 0x4f6fa8, sx, .95, -D / 2 + 2.4);
    const sw = g.localToWorld(new T.Vector3(sx, 0, -D / 2 + 4.6)), r = ringAt(sw.x, sw.z); STN.push({ id, x: sw.x, z: sw.z, label: 'Present · ' + ti, kind: 'folio', act: 3, ...r }); rounds.push({ x: sw.x, z: sw.z - 2.2, r: 1.5 });
  }
  // reception desk + receptionist, with the Experience station
  box(g, 7.4, 1.15, 1.7, 0x4f6fa8, 0, .6, -3.2); box(g, 7.6, .12, 1.9, 0xf4f0e6, 0, 1.2, -3.2); box(g, 2.2, .75, .08, 0x1c2230, -1.8, 1.65, -3.4); box(g, 2.2, .75, .08, 0x1c2230, 1.8, 1.65, -3.4);
  const rec = person({ shirt: 0x8f5fd0, pants: 0x2a2a3a, scale: .9, hair: 'bun', hairColor: 0x2a1713 }); rec.g.position.set(0, .11, -4.3); rec.g.rotation.y = 0; g.add(rec.g);
  { const rw = g.localToWorld(new T.Vector3(0, 0, -1.2)), r = ringAt(rw.x, rw.z); STN.push({ id: 'exp', x: rw.x, z: rw.z, label: 'Reception · My experience here', kind: 'folio', act: 3, ...r }); const dw = g.localToWorld(new T.Vector3(0, 0, -3.2)); rounds.push({ x: dw.x - 2.6, z: dw.z, r: 1.2 }, { x: dw.x, z: dw.z, r: 1.4 }, { x: dw.x + 2.6, z: dw.z, r: 1.2 }); }
  // desk islands with colleagues
  const col = [0xe0705a, 0x4a9a6a, 0xd0a040, 0x6a7fd0]; let ci = 0; const typers = [];
  for (const [dx, dz] of [[-10.5, 2], [-10.5, 6.5], [10.5, 2], [10.5, 6.5]]) {
    box(g, 3.2, .1, 1.4, 0xd8c8a8, dx, .95, dz); for (const lx of [-1.4, 1.4]) box(g, .1, .9, 1.2, 0x7a6a5a, dx + lx, .45, dz);
    box(g, .9, .6, .08, 0x1c2230, dx, 1.4, dz - .3); box(g, .12, .3, .12, 0x333333, dx, 1.12, dz - .3); box(g, 1.3, .05, .5, 0x444850, dx, 1.02, dz + .15);
    const pn = person({ shirt: col[ci++ % 4], pants: 0x2a3042, scale: .88, hair: ci % 2 ? 'none' : 'bun', hairColor: 0x2a1713 }); pn.g.position.set(dx, .11, dz + 1.35); pn.g.rotation.y = Math.PI; g.add(pn.g); typers.push(pn);
    const dw = g.localToWorld(new T.Vector3(dx, 0, dz)); rounds.push({ x: dw.x, z: dw.z, r: 1.9 });
  }
  // wall decor: whiteboard, clock, plants, cooler
  const wc = document.createElement('canvas'); wc.width = 512; wc.height = 256; { const c = wc.getContext('2d'); c.fillStyle = '#f4f0e6'; c.fillRect(0, 0, 512, 256); c.fillStyle = '#3c5788'; c.font = '800 34px system-ui, sans-serif'; c.fillText('What we build', 24, 50); c.font = '600 26px system-ui, sans-serif'; c.fillStyle = '#2b1d16'; ['Keycloak · OAuth 2.0 · OIDC', 'Spring Boot · Java 17', 'Secure login for banks', 'Zero-downtime upgrades'].forEach((t, k) => c.fillText('• ' + t, 24, 96 + k * 38)); }
  const wt = new T.CanvasTexture(wc); wt.colorSpace = T.SRGBColorSpace; const wb = new T.Mesh(new T.PlaneGeometry(5, 2.5), new T.MeshBasicMaterial({ map: wt })); wb.position.set(-W / 2 + .3, 3.1, 4); wb.rotation.y = Math.PI / 2; g.add(wb);
  const clk = cyl(g, .7, .7, .12, 0xfff3d0, 0, 5.1, -D / 2 + .45, 20); clk.rotation.x = Math.PI / 2; box(g, .08, .5, .05, 0x3b2a22, 0, 5.2, -D / 2 + .55, false); box(g, .4, .08, .05, 0x3b2a22, .15, 5.1, -D / 2 + .55, false);
  for (const [px, pz] of [[-15.5, -9], [15.5, -9], [-15.5, 9.5], [15.5, 9.5], [-6, 9.8], [6, 9.8]]) { cyl(g, .5, .38, .7, 0xb5532b, px, .35, pz, 10); sph(g, .7, 0x4f9a52, px, 1.3, pz, 1, 1.2, 1); sph(g, .5, 0x3f8a4a, px + .25, 1.8, pz - .1); }
  cyl(g, .35, .35, 1.2, 0xe8f2f8, 15.8, .6, 1, 10); sph(g, .4, 0x9fd8e8, 15.8, 1.45, 1);
  for (let k = -2; k <= 2; k++) { const l = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xfff1c0, transparent: true, opacity: .55, depthWrite: false })); l.position.set(k * 6.5, 5.6, 2); l.scale.set(5, 5, 1); g.add(l); }
  // ---- pantry along the left wall, with Keerthi, Dhanush and Bharath on their chai break
  {
    const wp = (lx, lz) => g.localToWorld(new T.Vector3(lx, 0, lz));
    const solidP = (lx, lz, r) => { const w = wp(lx, lz); rounds.push({ x: w.x, z: w.z, r }); };
    // checkered mat marks the pantry floor
    const mc = document.createElement('canvas'); mc.width = mc.height = 128; { const c = mc.getContext('2d'); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? '#e8e2d2' : '#b8c4cc'; c.fillRect(i * 32, j * 32, 32, 32); } }
    const mtex = new T.CanvasTexture(mc); mtex.colorSpace = T.SRGBColorSpace; mtex.wrapS = mtex.wrapT = T.RepeatWrapping; mtex.repeat.set(4, 7);
    const mat0 = new T.Mesh(new T.PlaneGeometry(4.6, 8.4), new T.MeshToonMaterial({ map: mtex, gradientMap: toonGrad, polygonOffset: true, polygonOffsetFactor: -2 })); mat0.receiveShadow = true; mat0.rotation.x = -Math.PI / 2; mat0.position.set(-14.5, .125, -4.3); g.add(mat0);
    // base cabinets, worktop, tiled splashback, wall cabinets
    box(g, 1.3, .95, 7.2, 0xb98652, -16.0, .5, -4.6); box(g, 1.45, .1, 7.3, 0xf4f0e6, -15.95, 1.0, -4.6); box(g, .08, 1.0, 7.2, 0xcfe3e8, -16.7, 1.55, -4.6);
    for (let k = 0; k < 6; k++) box(g, .04, .8, .02, 0x6a4a2a, -15.34, .55, -7.6 + k * 1.2 + .0).rotation.y = 0;
    box(g, .9, .9, 5.8, 0xc9a070, -16.4, 3.2, -4.2); for (let k = 0; k < 5; k++) box(g, .04, .5, .05, 0x6a4a2a, -15.94, 3.2, -6.5 + k * 1.15);
    // appliances on the worktop: coffee machine, kettle, microwave, toaster, jar, fruit
    box(g, .7, .75, .6, 0x2a2e36, -16.0, 1.43, -7.0); box(g, .5, .08, .4, 0xb8bcc4, -15.9, 1.1, -6.95); box(g, .12, .12, .02, 0xd8402a, -15.66, 1.6, -6.7, false); cyl(g, .1, .1, .22, 0xf4f0e6, -15.85, 1.17, -6.95, 10);
    cyl(g, .2, .22, .4, 0xb8bcc4, -16.0, 1.25, -5.9, 12); box(g, .06, .06, .3, 0x3a3e48, -15.75, 1.3, -5.9, false);
    box(g, .6, .4, .5, 0xe8e2d2, -16.1, 1.25, -4.9); box(g, .45, .28, .02, 0x2a3a4a, -15.8, 1.25, -4.9, false);
    box(g, .4, .25, .3, 0xb8bcc4, -16.1, 1.15, -3.9); cyl(g, .16, .16, .35, 0xcfe3e8, -16.1, 1.28, -3.1, 10); sph(g, .17, 0xe0705a, -15.8, 1.14, -2.6); sph(g, .15, 0xf2c14a, -15.62, 1.12, -2.45); sph(g, .13, 0x6fb550, -15.72, 1.12, -2.3);
    // sink with tap
    box(g, .9, .1, 1.0, 0x8a8e96, -15.9, 1.06, -1.7); cyl(g, .035, .035, .35, 0xd8dde6, -16.3, 1.25, -1.7, 8); box(g, .25, .04, .04, 0xd8dde6, -16.17, 1.42, -1.7, false);
    // tall fridge with magnets and a sticky note
    box(g, 1.2, 2.7, 1.2, 0xd8dde6, -16.0, 1.45, -0.0); box(g, 1.22, .04, .04, 0x8a8e96, -15.4, 1.9, -0.0); box(g, .06, .7, .08, 0x8a8e96, -15.4, 2.2, .45); box(g, .06, .8, .08, 0x8a8e96, -15.4, 1.0, .45);
    box(g, .02, .3, .3, 0xffe38a, -15.39, 2.2, -.3, false); sph(g, .05, 0xd8402a, -15.38, 1.9, .2); sph(g, .05, 0x3f8f88, -15.38, 2.5, -.4);
    solidP(-15.4, -7.4, 1.0); solidP(-15.4, -6.0, 1.0); solidP(-15.4, -4.6, 1.0); solidP(-15.4, -3.2, 1.0); solidP(-15.4, -1.8, 1.0); solidP(-15.4, 0, 1.1);
    // high table with stools, cups and a biscuit plate
    box(g, 1.2, .08, 1.2, 0xa9794a, -13.3, 1.05, -4.4).geometry = new T.CylinderGeometry(.75, .75, .08, 18); cyl(g, .07, .07, 1.05, 0x6c7078, -13.3, .52, -4.4, 6); cyl(g, .4, .4, .05, 0x6c7078, -13.3, .03, -4.4, 12);
    for (const [sx, sz] of [[-14.4, -4.9], [-12.3, -5.0], [-13.0, -3.2]]) { cyl(g, .22, .22, .08, 0xd8402a, sx, .78, sz, 10); cyl(g, .03, .03, .78, 0x6c7078, sx, .4, sz, 5); }
    cyl(g, .22, .22, .03, 0xf4f0e6, -13.3, 1.1, -4.4, 12); for (let k = 0; k < 3; k++) cyl(g, .06, .06, .02, 0xd2a060, -13.3 + (k - 1) * .09, 1.13 + k * .0, -4.4 + (k % 2) * .06, 8);
    for (const [cx, cz] of [[-13.75, -4.2], [-12.9, -4.6]]) { cyl(g, .06, .05, .1, 0xf4f0e6, cx, 1.14, cz, 10); }
    solidP(-13.3, -4.4, .95);
    // sign and a chalkboard menu on the wall
    const psg = signBoard(g, 'PANTRY', 2.4, .62, -16.62, 4.5, -4.5, 'chai . coffee . biscuits'); psg.rotation.y = Math.PI / 2;
    { const cc = document.createElement('canvas'); cc.width = 256; cc.height = 192; const x = cc.getContext('2d'); x.fillStyle = '#2a2e2a'; x.fillRect(0, 0, 256, 192); x.strokeStyle = '#b98652'; x.lineWidth = 8; x.strokeRect(4, 4, 248, 184); x.fillStyle = '#ffd36a'; x.textAlign = 'center'; x.font = '800 34px Georgia, serif'; x.fillText('TODAY', 128, 48);
      x.fillStyle = '#f4f0e6'; x.font = '600 26px Georgia, serif'; x.fillText('Masala chai', 128, 92); x.fillText('Filter coffee', 128, 126); x.fillText('Marie biscuit', 128, 160);
      const t = new T.CanvasTexture(cc); t.colorSpace = T.SRGBColorSpace; const mb = new T.Mesh(new T.PlaneGeometry(1.6, 1.2), new T.MeshBasicMaterial({ map: t })); mb.position.set(-16.62, 2.3, -.8); mb.rotation.y = Math.PI / 2; g.add(mb); }
    { const pl = new T.PointLight(0xfff0d8, 10, 15, 2); pl.position.set(-12.2, 4.6, -4.4); g.add(pl); }
    // the big side walls would throw the sun's shadow over the whole pantry: let them not cast
    g.children.forEach(o => { if (o.isMesh && o.geometry.parameters && o.geometry.parameters.height >= 5.5) o.castShadow = false; });

    // ---- the three: build helpers
    const torso = P => P.body.children[0];
    const crop = (P, col, r = .322, tilt = -.22) => { const cap = new T.Mesh(new T.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * .5), new T.MeshToonMaterial({ color: col, gradientMap: toonGrad })); cap.position.set(0, .02, -.01); cap.rotation.x = tilt; P.head.add(cap); return cap; };
    const hold = (P, i) => add(P.arms[i], new T.CylinderGeometry(.055, .045, .11, 10), mat(0xf4f0e6), 0, -.7, .06, false);
    const tag = (P, name, y) => { const tex = textCanvas(256, 64, (x, w, h) => { x.fillStyle = '#000000aa'; x.beginPath(); x.roundRect ? x.roundRect(8, 8, w - 16, h - 16, 16) : x.rect(8, 8, w - 16, h - 16); x.fill(); x.font = '700 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText(name, w / 2, h / 2 + 1); });
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })); s.scale.set(1.9, .48, 1); s.position.set(P.g.position.x, y, P.g.position.z); g.add(s); return s; };
    const portfolioTag = (P, y, ready) => { const tex = textCanvas(320, 64, (x, w, h) => { x.fillStyle = ready ? '#163e32ee' : '#51442fee'; x.beginPath(); x.roundRect ? x.roundRect(8, 8, w - 16, h - 16, 16) : x.rect(8, 8, w - 16, h - 16); x.fill(); x.font = '800 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = ready ? '#c8ffdc' : '#ffe6b0'; x.fillText(ready ? 'PORTFOLIO ↗' : 'PORTFOLIO SOON', w / 2, h / 2 + 1); });
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })); s.scale.set(1.7, .36, 1); s.position.set(P.g.position.x, y, P.g.position.z); s.renderOrder = 10; g.add(s); return s; };
    // Keerthi, 23: pretty bulky and fit, full beard
    const K = person({ shirt: 0x38b0c8, pants: 0x3a4660, skin: 0xd09468, beard: true, brow: true, hair: 'bald', hairColor: 0x15100d, scale: 1.1 });
    torso(K).scale.set(1.5, 1.05, 1.35); K.arms.forEach((a, i) => { a.scale.set(1.55, 1, 1.55); a.position.x = (i ? 1 : -1) * .5; }); K.legs.forEach((l, i) => { l.scale.set(1.4, 1, 1.4); l.position.x = (i ? 1 : -1) * .2; });
    for (const sg of [-1, 1]) { sph(K.body, .2, 0x38b0c8, sg * .45, 1.5, 0); sph(K.body, .15, 0x38b0c8, sg * .24, 1.62, -.02); } crop(K, 0x15100d, .322, -.3);
    for (const sg of [-1, 1]) { const w = box(K.head, .09, .035, .06, 0x15100d, sg * .09, -.1, .265, false); w.rotation.z = sg * .3; } box(K.head, .2, .04, .06, 0x15100d, 0, -.09, .27, false); hold(K, 1);
    K.g.position.set(-14.7, .11, -5.6); K.g.rotation.y = .85; g.add(K.g); tag(K, 'Keerthi', 3.05); portfolioTag(K, 3.48, true);
    // Dhanush: lean and tall, French beard (moustache joined to a chin goatee)
    const Dh = person({ shirt: 0xd2d6cc, pants: 0x2b3a60, skin: 0xd49c70, brow: true, hairColor: 0x1f1612, scale: 1.0 });
    Dh.g.scale.set(.9, 1.2, .9); torso(Dh).scale.set(.82, 1.05, .78); Dh.arms.forEach((a, i) => { a.scale.set(.75, 1.02, .75); a.position.x = (i ? 1 : -1) * .27; }); Dh.legs.forEach((l, i) => { l.scale.set(.8, 1.02, .8); l.position.x = (i ? 1 : -1) * .13; });
    { const bc = 0x1f1612; box(Dh.head, .24, .045, .06, bc, 0, -.085, .27, false); for (const sg of [-1, 1]) { box(Dh.head, .04, .12, .045, bc, sg * .085, -.15, .262, false); const w = box(Dh.head, .09, .03, .05, bc, sg * .13, -.1, .262, false); w.rotation.z = sg * .35; } const ch = sph(Dh.head, .085, bc, 0, -.2, .23); ch.scale.set(1, 1.35, .75); }
    hold(Dh, 1); Dh.arms[0].rotation.x = -.9; Dh.g.position.set(-12.4, .11, -3.6); Dh.g.rotation.y = -2.4; g.add(Dh.g); tag(Dh, 'Dhanush', 3.3); portfolioTag(Dh, 3.72, true);
    // Bharath: short, dark-skinned, buzz cut and a full beard
    const Bh = person({ shirt: 0xf2c040, pants: 0x7a6a58, skin: 0x5a3a2a, beard: true, brow: true, hair: 'bald', hairColor: 0x14100e, scale: 1.0 });
    torso(Bh).scale.set(1.12, 1, 1.05); Bh.arms.forEach(a => a.scale.set(1.1, 1, 1.1)); crop(Bh, 0x1c1a1a, .318, -.05);
    for (const sg of [-1, 1]) { const w = box(Bh.head, .09, .035, .06, 0x14100e, sg * .09, -.1, .265, false); w.rotation.z = sg * .3; } box(Bh.head, .2, .04, .06, 0x14100e, 0, -.09, .27, false);
    Bh.g.position.set(-14.2, .11, -1.7); Bh.g.rotation.y = 2.75; g.add(Bh.g); tag(Bh, 'Bharath', 2.8); portfolioTag(Bh, 3.22, false); hold(Bh, 0);
    for (const [P, lx, lz] of [[K, -14.7, -5.6], [Dh, -12.4, -3.6], [Bh, -14.2, -1.7]]) solidP(lx, lz, .55);
    // chat stations: stand beside each of them and press E
    const CHAT = { keerthi: ['Keerthi', 'Chai? I just made a fresh batch. Careful, it is strong, like my deadlifts.', 'Twenty-three, and the gym is the only place where I do not get merge conflicts.'], dhanush: ['Dhanush', 'You walked in right on time. The whole team reaches this pantry at the same minute every day. Classic race condition.', 'I keep the coffee strong and the commits small. Works for both.'], bharath: ['Bharath', 'Short in height, tall in deploys. Ask anyone here.', 'The secret to good code is the same as good biscuits: dunk it at the right moment and do not let it fall apart.'] };
    INT.chat = CHAT;
    for (const [id, lx, lz] of [['keerthi', -12.6, -7.0], ['dhanush', -10.8, -2.6], ['bharath', -12.1, -0.4]]) {
      const w = wp(lx, lz), r = ringAt(w.x, w.z, 0xffb86a);
      STN.push({ id, x: w.x, z: w.z, label: 'Chat · ' + CHAT[id][0], kind: 'chat', ...r });
    }
    const PROFILE_URL = { keerthi: 'https://keerthivibisan.com/', dhanush: 'https://dhanushkarthik.com/', bharath: '' };
    for (const [id, lx, lz] of [['keerthi', -13.5, -5.6], ['dhanush', -11.2, -3.6], ['bharath', -13.0, -1.7]]) {
      const w = wp(lx, lz), r = ringAt(w.x, w.z, 0x73c79a);
      STN.push({ id: 'portfolio-' + id, x: w.x, z: w.z, label: 'Portfolio · ' + CHAT[id][0], kind: 'portfolio', url: PROFILE_URL[id], ...r });
    }
    (globalThis.PREAMB = globalThis.PREAMB || []).push(t => {
      K.arms[0].rotation.x = -1.2 + Math.sin(t * 3.2) * .18; K.arms[1].rotation.x = -.9 + Math.sin(t * 3.2 + 1) * .08; K.body.rotation.y = Math.sin(t * 1.1) * .08;
      Dh.arms[1].rotation.x = -1.35 + Math.max(0, Math.sin(t * .7)) * -.5; Dh.head.rotation.x = Math.max(0, Math.sin(t * .7)) * -.15 + .04; Dh.body.position.y = Math.sin(t * 1.4) * .012;
      Bh.arms[0].rotation.x = -1.1 + Math.sin(t * 1.3 + 2) * .1; Bh.arms[1].rotation.x = -.5; Bh.body.position.y = Math.abs(Math.sin(t * 2.6)) * .03; Bh.body.rotation.z = Math.sin(t * 2.6) * .03;
    });
  }
  // exit door (front gap) with a glowing exit sign
  for (const sg of [-1, 1]) cyl(g, .12, .12, 3.4, 0x4f6fa8, sg * 2.6, 1.7, D / 2, 8); 
  { const ew = g.localToWorld(new T.Vector3(0, 0, D / 2 - 2.2)), r = ringAt(ew.x, ew.z, 0x7fe8a0); STN.push({ id: 'exit', x: ew.x, z: ew.z, label: 'Leave · Back to your bike', kind: 'exit', act: 3, ...r }); }
  const W0 = { x, z }; walls.push({ x0: x - W / 2 - .6, x1: x + W / 2 + .6, z0: z - D / 2 - .6, z1: z - D / 2 + .3 }, { x0: x - W / 2 - .6, x1: x - W / 2 + .3, z0: z - D / 2, z1: z + D / 2 }, { x0: x + W / 2 - .3, x1: x + W / 2 + .6, z0: z - D / 2, z1: z + D / 2 }, { x0: x - W / 2, x1: x - 2.9, z0: z + D / 2 - .2, z1: z + D / 2 + .4 }, { x0: x + 2.9, x1: x + W / 2, z0: z + D / 2 - .2, z1: z + D / 2 + .4 }, { x0: x - 3, x1: x + 3, z0: z + D / 2 - .2, z1: z + D / 2 + .4 });
  { const gl = new T.Mesh(new T.PlaneGeometry(5.2, 3.2), new T.MeshBasicMaterial({ color: 0x9fd8e8, transparent: true, opacity: .22, side: T.DoubleSide, depthWrite: false })); gl.position.set(x, 1.7, z + D / 2); INTGLASS = gl; world.add(gl); }
  INT.spawn = { x, z: z + D / 2 - 3.4 }; for (const st of STN) if (st.x > 250) { st.ring.position.y = .17; st.glow.visible = false; }
  (globalThis.PREAMB = globalThis.PREAMB || []).push(t => { typers.forEach((p, k) => { p.arms[0].rotation.x = -1.25 + Math.sin(t * 5 + k) * .07; p.arms[1].rotation.x = -1.25 + Math.sin(t * 5 + k + 2) * .07; }); rec.arms[1].rotation.x = Math.sin(t * 1.6) > .8 ? -2.4 : -.1; });
}
const ACT_OF = { edu: 2, ach: 2, exp: 3, ibm: 3, ibb: 3, city: 3, skills: 3 };
for (const p of PORT) STN.push({ id: p.id, x: p.door[0], z: p.door[1], label: 'Visit · ' + p.title, kind: 'folio', act: ACT_OF[p.id], ring: p.ring, glow: p.glow });

// ---- people: Ravi + cricket side, Thatha + chess side
const A = (who, text) => ({ who, text }), NAR = text => ({ who: '', text });
const NPCS = [];
function npc(name, x, z, o) { const p = person(o); p.g.position.set(x, 0, z); scene.add(p.g); const n = { name, p, ph: Math.random() * 6 }; NPCS.push(n); return n; }
const ravi = npc('Ravi', 24.6, -25, { shirt: 0xd8402a, pants: 0x35507a, scale: .78 });
const thatha = npc('Thatha', -24.6, -87.6, { shirt: 0xffffff, pants: 0xf3f0e6, hair: 'bald', moustache: true, glasses: true, scale: .95 });
const stumpMeshes0 = stumpMeshes;
const fielders = [[-8.5, -2], [-6, -8], [0, -9.5], [6, -8.5], [8.5, -3], [-7.5, 4]].map(([dx, dz], i) => {
  const p = person({ shirt: [0x3f8f88, 0xf0b84a, 0xd8402a, 0x8a4a8a, 0x6b8f4a, 0x397c98][i], pants: 0x35507a, scale: .75, hairColor: 0x2a211c });
  p.g.position.set(PITCH.cx + dx, .07, PITCH.cz + dz); p.g.rotation.y = Math.atan2(-dx, 5 - dz); scene.add(p.g); return p;
});
{ const r = ringAt(22.2, -22.6); STN.push({ id: 'ravi', x: 22.2, z: -22.6, label: 'Talk · Ravi', kind: 'story', act: 0, ...r }); }
{ const r = ringAt(-22.2, -88.8); STN.push({ id: 'thatha', x: -22.2, z: -88.8, label: 'Talk · Thatha', kind: 'story', act: 1, ...r }); }

// ---- the AI tower
const SPIRE = { g: new T.Group(), rings: [], shards: [], clouds: [], awaken: 0 };
{
  const g = SPIRE.g; g.position.set(0, 0, -334); world.add(g);
  cyl(g, 11, 12, .7, 0xd9d2c0, 0, .35, 0, 36); cyl(g, 8.5, 9.5, .6, 0xe8e2d0, 0, .9, 0, 36); cyl(g, 6, 7, .5, 0xf2eedd, 0, 1.4, 0, 36);
  const glowMat = c => new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(1.7) });
  SPIRE.core = new T.Group(); SPIRE.core.position.y = 1; g.add(SPIRE.core);
  const body = new T.Mesh(new T.CylinderGeometry(1.1, 2.8, 26, 6), glowMat(0xbff6ff)); body.position.y = 13; SPIRE.core.add(body);
  const shell = new T.Mesh(new T.CylinderGeometry(1.7, 3.6, 26, 6), new T.MeshToonMaterial({ color: 0x9ed8e8, gradientMap: toonGrad, transparent: true, opacity: .5 })); shell.position.y = 13; SPIRE.core.add(shell);
  const tip = new T.Mesh(new T.OctahedronGeometry(1, 0), glowMat(0xffe9a8)); tip.scale.set(2.2, 5, 2.2); tip.position.y = 30; SPIRE.core.add(tip);
  for (let i = 0; i < 4; i++) { const r = new T.Mesh(new T.TorusGeometry(5 + i * 1.7, .12, 6, 48), glowMat(i % 2 ? 0xffe9a8 : 0xbff6ff)); r.position.y = 8 + i * 5; r.rotation.x = Math.PI / 2 + (i - 1.5) * .12; g.add(r); SPIRE.rings.push(r); }
  for (let i = 0; i < 16; i++) { const s = new T.Mesh(new T.OctahedronGeometry(.45 + (i % 3) * .15, 0), glowMat(i % 2 ? 0xffe9a8 : 0xbff6ff)); s.userData = { a: i / 16 * 6.283, r: 6 + (i % 4) * 1.5, h: 5 + (i * 2.1) % 22, sp: .25 + (i % 5) * .06 }; g.add(s); SPIRE.shards.push(s); }
  SPIRE.halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xbff6ff, transparent: true, opacity: .55, depthWrite: false, fog: false })); SPIRE.halo.scale.set(50, 50, 1); SPIRE.halo.position.y = 20; g.add(SPIRE.halo);
  for (let i = 0; i < 9; i++) { const c = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, color: 0x7a6aa0, transparent: true, opacity: .95, depthWrite: false })); const a = i / 9 * 6.283; c.userData = { a, r: 20 + (i % 3) * 8, y: 36 + (i % 4) * 5 }; c.scale.set(44, 22, 1); g.add(c); SPIRE.clouds.push(c); }
  SPIRE.light = new T.PointLight(0xbff6ff, 40, 70, 1.5); SPIRE.light.position.set(0, 12, 6); g.add(SPIRE.light);
  rounds.push({ x: 0, z: -334, r: 3.5 });
  const r = ringAt(0, -322); STN.push({ id: 'ai', x: 0, z: -322, label: 'Face the tower', kind: 'story', act: 4, ...r });
  signBoard(world, 'THE BIG PICTURE', 5.4, 1.3, 0, 3.2, -316, 'AI'); for (const sg of [-1, 1]) cyl(world, .07, .07, 3.9, 0x6a4428, sg * 2.5, 1.95, -316, 6);
}
// ---- gates between acts
const GATES = [[3, 6, 'CHESS AHEAD'], [5, 8, 'COLLEGE AHEAD'], [8, 8, 'WORK AHEAD'], [11, 6, 'THE BIG PICTURE']].map(([wi, off, txt], k) => {
  const p = pointAt(CUM[wi] + off), nx = -p.tz, nz = p.tx, g = new T.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI / 2; world.add(g);
  for (const sg of [-1, 1]) cyl(g, .12, .14, 2.2, 0x6a4428, 0, 1.1, sg * 5.2, 6);
  const bar = box(g, .18, .22, 10.4, 0xb98652, 0, 1.5, 0), bar2 = box(g, .18, .22, 10.4, 0xb98652, 0, .8, 0);
  signBoard(g, 'TO BE CONTINUED', 4.2, 1, -.2, 2.9, 0, 'finish this first').rotation.y = -Math.PI / 2;
  for (let l = -9; l <= 9; l += 1.8) rounds.push({ x: p.x + nx * l, z: p.z + nz * l, r: 1.2, gate: k });
  return { g, k, open: false, t: 0 };
});
function openGate(k) { const G = GATES[k]; if (!G || G.open) return; G.open = true; for (let i = rounds.length - 1; i >= 0; i--) if (rounds[i].gate === k) rounds.splice(i, 1); }
// ---- trees, lanterns and crystals along the way
{
  const stn = STN.map(s => [s.x, s.z]);
  const RESV = [[CUM[3] + 14, 7.5, 5], [CUM[5] + 12, -8, 3.5], [CUM[5] + 17, -11, 3.5], [CUM[5] + 22, 8.5, 3.5], [CUM[6] + 20, 4.6, 3.5], [CUM[1] - 14, -9, 3], [CUM[11] + 16, -11, 8.5], [CUM[9] - 4, 12, 32]].map(([ss, off, r]) => { const p = pointAt(ss); return [p.x - p.tz * off, p.z + p.tx * off, r]; });
  const blocked = (x, z) => RESV.some(([a, b, r]) => Math.hypot(a - x, b - z) < r + 2.5) || walls.some(w => x > w.x0 - 4 && x < w.x1 + 4 && z > w.z0 - 4 && z < w.z1 + 4) || rounds.some(r => Math.hypot(r.x - x, r.z - z) < r.r + 3.5 && !r.gate) || stn.some(([a, b]) => Math.hypot(a - x, b - z) < 5) || Math.hypot(x - PITCH.cx, z - PITCH.cz) < PITCH.R + 4 || Math.hypot(x, z + 334) < 16;
  for (let s = 5; s < TOTAL - 20; s += 6.5) {
    for (const side of [-1, 1]) {
      if (rnd() < .3) continue; const p = pointAt(s), off = side * (9 + rnd() * 17), x = p.x - p.tz * off, z = p.z + p.tx * off;
      if (blocked(x, z)) continue; if (s > CUM[13] && rnd() < .7) continue;
      tree(x, z, .8 + rnd() * .7, rnd() < .3 ? 1 : 0);
    }
  }
  for (let s = 14, k = 0; s < TOTAL - 6; s += 21, k++) {
    const p = pointAt(s), side = k % 2 ? 1 : -1, off = side * 4.2, x = p.x - p.tz * off, z = p.z + p.tx * off;
    const g = new T.Group(); g.position.set(x, 0, z); world.add(g); cyl(g, .06, .08, 2.1, 0x5a3a22, 0, 1.05, 0, 6);
    const lamp = new T.Mesh(new T.SphereGeometry(.28, 10, 8), new T.MeshBasicMaterial({ color: new T.Color(0xffb85a).multiplyScalar(1.5) })); lamp.scale.y = 1.25; lamp.position.y = 2.3; g.add(lamp);
    const gl = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffb85a, transparent: true, opacity: .5, depthWrite: false })); gl.scale.set(3, 3, 1); gl.position.y = 2.3; g.add(gl);
  }
  for (let s = CUM[12] + 6; s < TOTAL - 4; s += 7) for (const side of [-1, 1]) { const p = pointAt(s), off = side * (6 + rnd() * 5), c = new T.Mesh(new T.OctahedronGeometry(.5 + rnd() * .5, 0), new T.MeshBasicMaterial({ color: new T.Color(rnd() < .5 ? 0xbff6ff : 0xffe9a8).multiplyScalar(1.5) })); c.position.set(p.x - p.tz * off, .6, p.z + p.tx * off); c.scale.y = 1.8; c.rotation.y = rnd() * 3; scene.add(c); }
}
// ---- player (built from the photos) + looks per act
const player = person({ me: true, hair: 'none', brow: true, skin: 0xc98a5e, shirt: 0xf0a44b, pants: 0xeadcc0, scale: .62, hairColor: 0x1e1512 });
player.g.position.set(0, .07, 42); scene.add(player.g); player.heading = Math.PI; player.v = 0; player.lean = 0;
/* ------------------------------------------------------------ vehicles */
function wheelOf(parent, r, tube, z, color = 0x3a2e2a, knobs = 0) {
  const g = new T.Group(); g.position.set(0, r, z); parent.add(g);
  const ring = new T.Mesh(new T.TorusGeometry(r, tube, 8, 24), mat(color)); ring.rotation.y = Math.PI / 2; ring.castShadow = true; g.add(ring);
  const s1 = new T.Mesh(new T.BoxGeometry(.03, r * 1.8, .03), mat(0xe8e2d0)); g.add(s1);
  const s2 = s1.clone(); s2.rotation.x = Math.PI / 2; g.add(s2);
  for (let k = 0; k < knobs; k++) { const a = k / knobs * Math.PI * 2, kb = new T.Mesh(new T.BoxGeometry(.17, .05, .07), mat(color)); kb.position.set(0, Math.cos(a) * (r + tube * .95), Math.sin(a) * (r + tube * .95)); kb.rotation.x = a; g.add(kb); }
  g.userData.r = r; return g;
}
function barOf(parent, a, b, r, color) {
  const u = new T.Vector3(...a), v = new T.Vector3(...b), d = v.clone().sub(u);
  const m = new T.Mesh(new T.CylinderGeometry(r, r, d.length(), 7), mat(color, .4, .2));
  m.position.copy(u.clone().add(v).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; parent.add(m); return m;
}
const VEH = {
  trike: { max: 10.5, acc: 9, turn: 5, seat: { y: -.1, z: -.2, lean: 0 }, build() {
    const g = new T.Group(), red = 0xd94e47, gold = 0xf1ca68;
    const front = wheelOf(g, .3, .07, .6), rl = wheelOf(g, .27, .07, -.5), rr = wheelOf(g, .27, .07, -.5); rl.position.x = -.32; rr.position.x = .32;
    barOf(g, [0, .62, -.45], [0, .6, .1], .05, red); barOf(g, [0, .6, .1], [0, .35, .6], .05, red);
    barOf(g, [-.32, .27, -.5], [0, .62, -.45], .04, gold); barOf(g, [.32, .27, -.5], [0, .62, -.45], .04, gold);
    barOf(g, [0, .35, .6], [0, 1.0, .5], .05, red); barOf(g, [-.3, 1.0, .5], [.3, 1.0, .5], .05, gold);
    box(g, .46, .1, .34, 0x4b6d79, 0, .66, -.25);
    for (const sd of [-1, 1]) { const p = box(g, .09, .05, .16, gold, 0, 0, 0, false); front.add(p); p.position.set(sd * .22, sd * .13, 0); }
    return { g, wheels: [front, rl, rr], front };
  } },
  bike: { max: 12.5, acc: 4.2, turn: 4, seat: { y: .27, z: -.2, lean: .3 }, build() {
    const g = new T.Group(), blue = 0x397c98;
    const fw = wheelOf(g, .42, .05, .64), rw = wheelOf(g, .42, .05, -.64);
    const BB = [0, .46, -.02], S = [0, .98, -.24], H = [0, .96, .46], Rh = [0, .42, -.64], Fh = [0, .42, .64];
    barOf(g, BB, S, .04, blue); barOf(g, BB, H, .045, blue); barOf(g, S, H, .04, blue); barOf(g, S, Rh, .03, blue); barOf(g, BB, Rh, .03, blue); barOf(g, H, Fh, .035, 0xcccccc);
    barOf(g, H, [0, 1.1, .42], .035, 0x333333); barOf(g, [-.3, 1.1, .42], [.3, 1.1, .42], .035, 0x222222);
    box(g, .3, .08, .3, 0x222222, 0, 1.02, -.28);
    const crank = new T.Group(); crank.position.set(0, .46, -.02); g.add(crank);
    for (const sd of [-1, 1]) { const p = box(g, .12, .04, .16, 0x222222, 0, 0, 0, false); crank.add(p); p.position.set(sd * .16, sd * .17, 0); }
    return { g, wheels: [fw, rw], crank };
  } },
  moto: { max: 17, acc: 4.2, turn: 4.6, seat: { y: .3, z: -.42, lean: .12 }, build() {
    const g = new T.Group(), AZ = 0x1f86d8, AZD = 0x145c9e, RED = 0xd8402f, BLK = 0x2b2b30, WHT = 0xf3efe4, GRY = 0xb8bcc4, GOLD = 0xd9a441;
    const fw = wheelOf(g, .46, .1, .9, 0x2a2420, 22), rw = wheelOf(g, .42, .12, -.86, 0x2a2420, 22);
    for (const w of [fw, rw]) { const rim = new T.Mesh(new T.TorusGeometry(w.userData.r * .8, .022, 6, 28), mat(GRY)); rim.rotation.y = Math.PI / 2; w.add(rim); }
    box(g, .34, .4, .66, 0x3a3a42, 0, .55, 0); box(g, .3, .22, .3, 0x4a4a54, 0, .82, -.05);
    barOf(g, [0, .95, .42], [0, .55, .12], .05, BLK); barOf(g, [0, .55, .12], [0, .45, -.2], .05, BLK); barOf(g, [0, .9, .4], [0, .95, -.3], .05, BLK);
    sph(g, .3, AZ, 0, 1.02, .18, .9, .72, 1.45); for (const sg of [-1, 1]) { const st = box(g, .02, .07, .5, WHT, sg * .265, 1.03, .2, false); st.rotation.x = .08; }
    for (const sg of [-1, 1]) { const sh = box(g, .08, .3, .52, AZ, sg * .23, .94, .12); sh.rotation.x = .1; const sw = box(g, .085, .08, .4, WHT, sg * .232, .86, .1, false); sw.rotation.x = .1; box(g, .09, .12, .3, AZD, sg * .2, .62, -.62, false); }
    box(g, .3, .09, .82, BLK, 0, 1.0, -.52); const tail = box(g, .26, .08, .46, BLK, 0, 1.07, -1.0); tail.rotation.x = .2;
    barOf(g, [0, .55, -.1], [0, .43, -.86], .045, BLK); barOf(g, [0, .92, -.5], [0, .6, -.4], .04, GOLD);
    for (const sg of [-1, 1]) { barOf(g, [sg * .11, 1.3, .55], [sg * .11, .48, .9], .045, 0x2a2a2a); barOf(g, [sg * .11, .95, .7], [sg * .11, .55, .86], .06, GOLD); }
    const fm = box(g, .2, .05, .64, WHT, 0, .93, .98); fm.rotation.x = -.18; box(g, .2, .05, .12, AZ, 0, .98, 1.3).rotation.x = -.5;
    const nose = box(g, .4, .34, .2, AZ, 0, 1.34, .68); nose.rotation.x = -.25; const ns = box(g, .42, .06, .21, WHT, 0, 1.2, .71, false); ns.rotation.x = -.25;
    add(g, new T.SphereGeometry(.13, 12, 9), new T.MeshBasicMaterial({ color: new T.Color(0xfff0a8).multiplyScalar(1.4) }), 0, 1.3, .8, false);
    const ws = new T.Mesh(new T.BoxGeometry(.36, .4, .02), new T.MeshToonMaterial({ color: 0xaedcf0, gradientMap: toonGrad, transparent: true, opacity: .55 })); ws.position.set(0, 1.66, .6); ws.rotation.x = -.5; g.add(ws);
    barOf(g, [0, 1.24, .5], [0, 1.32, .5], .04, BLK); barOf(g, [-.47, 1.34, .5], [.47, 1.34, .5], .03, BLK);
    for (const sg of [-1, 1]) { box(g, .06, .2, .14, WHT, sg * .5, 1.38, .56); sph(g, .05, 0x222222, sg * .46, 1.34, .5); }
    const ex = cyl(g, .075, .09, .85, 0xc8ccd4, .3, .76, -.5, 10); ex.rotation.x = 1.3; box(g, .05, .1, .5, BLK, .36, .72, -.5).rotation.x = .25;
    barOf(g, [.2, .5, .1], [.3, .62, -.15], .05, GRY);
    for (const sg of [-1, 1]) box(g, .08, .04, .16, GRY, sg * .3, .42, -.18, false);
    box(g, .12, .06, .05, 0xff3030, 0, 1.12, -1.24, false); box(g, .32, .03, .5, BLK, 0, 1.12, -1.15);
    return { g, wheels: [fw, rw], exhaust: new T.Vector3(.3, .66, -.95) };
  } },
};
function setSeat() { const s = player.veh.cfg.seat; player.body.position.set(0, s.y, s.z); player.body.rotation.set(s.lean, 0, 0); }
function setVehicle(type) {
  if (player.veh && player.veh.type === type) return;
  if (player.veh) player.veh.d.g.visible = false;
  player.vehCache = player.vehCache || {};
  if (!player.vehCache[type]) { const d = VEH[type].build(); player.g.add(d.g); player.vehCache[type] = { type, d, cfg: VEH[type] }; }
  player.veh = player.vehCache[type]; player.veh.d.g.visible = !player.onFoot; if (!player.onFoot) setSeat();
}
function hideVehicle(on) {
  player.veh.d.g.visible = !on;
  if (on) { player.body.position.set(0, 0, 0); player.body.rotation.set(0, 0, 0); } else setSeat();
}
function rideAnim(dt, v) {
  if (player.onFoot) { walkAnim(dt, v); return; }
  const V = player.veh, d = V.d;
  for (const w of d.wheels) w.rotation.x += v * dt / w.userData.r;
  if (V.type === 'trike') { const ph = d.front.rotation.x; player.legs[0].rotation.x = -1.0 + Math.sin(ph) * .4; player.legs[1].rotation.x = -1.0 - Math.sin(ph) * .4; player.arms[0].rotation.x = player.arms[1].rotation.x = -1.0; }
  else if (V.type === 'bike') { d.crank.rotation.x += v * dt * 2.2; const ph = d.crank.rotation.x; player.legs[0].rotation.x = -.6 + Math.sin(ph) * .5; player.legs[1].rotation.x = -.6 - Math.sin(ph) * .5; player.arms[0].rotation.x = player.arms[1].rotation.x = -.95; }
  else { player.legs[0].rotation.x = player.legs[1].rotation.x = -1.15; player.arms[0].rotation.x = player.arms[1].rotation.x = -1.0; }
}
const vehicleFor = i => i < 1 ? 'trike' : i < 4 ? 'bike' : 'moto';



const LOOKS = [[0xf0a44b, 0xeadcc0, .62, 'kid', 'trike'], [0xb7a2dc, 0x2b3a6b, .74, 'kid', 'bike'], [0xf4f0e6, 0x3a3a48, .9, 'teen', 'bike'], [0x7a2d3f, 0xc9b48a, 1, 'adult', 'moto'], [0x7a2d3f, 0xc9b48a, 1, 'adult', 'moto']];
const VEHNAME = { trike: 'a red tricycle', bike: 'a cycle', moto: 'an Azure Blue XPulse 210-style bike' };
let targetScale = .62;
setVehicle('trike');
function applyLook(i) { const L = LOOKS[Math.min(i, 4)]; player.torsoMat.color.setHex(L[0]); player.legMat.color.setHex(L[1]); targetScale = L[2]; player.setAge(L[3]); setVehicle(stageVeh()); }
const S_CHESS = pathNear(-22.2, -88.8).s + 8, S_COLLEGE = pathNear(12, -162.4).s + 8;
const VRANK = { trike: 0, bike: 1, moto: 2 }, VBYRANK = ['trike', 'bike', 'moto'];
// a vehicle upgrade is permanent: never fall back to an older one
function stageVeh() { const r = save.reach || 0; save.vrank = Math.max(save.vrank || 0, r > S_COLLEGE ? 2 : r > S_CHESS ? 1 : 0); return VBYRANK[save.vrank]; }
// ---- sky / light progression
const SKY = { day: ['#3f86d8', '#7fbbea', '#cfe6ee', '#f6ecd0'], gold: ['#4a7fd0', '#a8c8e8', '#f9dfb0', '#ffd9a0'], storm: ['#2a3a78', '#6a6aa8', '#d49ab0', '#ffd09a'], dawn: ['#2e5fae', '#f2a8b8', '#ffd7a0', '#fff3c4'] };
const mixHex = (a, b, t) => '#' + new T.Color(a).lerp(new T.Color(b), t).getHexString();
function skyFor(p, aw) {
  let A, B, t;
  if (p < .35) { A = SKY.day; B = SKY.day; t = 0; } else if (p < .62) { A = SKY.day; B = SKY.gold; t = (p - .35) / .27; } else if (p < .82) { A = SKY.gold; B = SKY.storm; t = (p - .62) / .2; } else { A = SKY.storm; B = SKY.storm; t = 0; }
  return A.map((c, i) => mixHex(mixHex(c, B[i], t), SKY.dawn[i], aw));
}
// ---- climates + day/night cycle
const KF = [  // hour, sky (top, mid, low, horizon), sun colour + intensity, hemisphere sky/ground + intensity, daylight
  { h: 0, sky: ['#050a1e', '#0a1636', '#16285a', '#24386a'], sun: '#9fb4ff', si: .5, hs: '#4a5f9a', hg: '#1a2238', hi: .5, day: 0 },
  { h: 5.2, sky: ['#050a1e', '#0a1636', '#16285a', '#24386a'], sun: '#9fb4ff', si: .5, hs: '#4a5f9a', hg: '#1a2238', hi: .5, day: 0 },
  { h: 6.6, sky: SKY.dawn, sun: '#ffc38a', si: 1.6, hs: '#ffd9c0', hg: '#8a7860', hi: .8, day: .55 },
  { h: 8.8, sky: SKY.day, sun: '#fff0cf', si: 2.5, hs: '#d6ecff', hg: '#86a860', hi: 1.05, day: 1 },
  { h: 16.2, sky: SKY.day, sun: '#fff0cf', si: 2.5, hs: '#d6ecff', hg: '#86a860', hi: 1.05, day: 1 },
  { h: 18.2, sky: ['#2a3a78', '#d0708a', '#ffa070', '#ffd09a'], sun: '#ff9a60', si: 1.6, hs: '#ffc0a0', hg: '#6a5a50', hi: .8, day: .55 },
  { h: 19.9, sky: ['#050a1e', '#0a1636', '#16285a', '#24386a'], sun: '#9fb4ff', si: .5, hs: '#4a5f9a', hg: '#1a2238', hi: .5, day: 0 },
  { h: 24, sky: ['#050a1e', '#0a1636', '#16285a', '#24386a'], sun: '#9fb4ff', si: .5, hs: '#4a5f9a', hg: '#1a2238', hi: .5, day: 0 }];
const CLIM = {   // cover = cloud cover, sunK/hemiK light multipliers, fn/ff fog distances, gray = how washed-out the sky is
  clear: { name: 'Clear', icon: '☀', cover: .2, sunK: 1, hemiK: 1, fn: 90, ff: 320, gray: 0, rain: 0, wind: .15, storm: 0 },
  cloudy: { name: 'Cloudy', icon: '☁', cover: .85, sunK: .45, hemiK: .92, fn: 70, ff: 280, gray: .35, rain: 0, wind: .45, storm: 0 },
  rain: { name: 'Rain', icon: '🌧', cover: 1, sunK: .18, hemiK: .74, fn: 40, ff: 200, gray: .6, rain: .7, wind: .6, storm: 0 },
  storm: { name: 'Thunderstorm', icon: '⛈', cover: 1, sunK: .12, hemiK: .58, fn: 28, ff: 150, gray: .75, rain: 1, wind: 1, storm: 1 },
  fog: { name: 'Fog', icon: '🌫', cover: .7, sunK: .4, hemiK: .95, fn: 6, ff: 85, gray: .5, rain: 0, wind: .1, storm: 0 } };
const CLIM_ORDER = ['clear', 'cloudy', 'rain', 'storm', 'fog'];
const ENV = { hour: 10, speed: 24 / 480, auto: true, next: 70, target: 'clear', cur: { ...CLIM.clear }, indoor: 0, flash: 0, boltT: 8, skyT: 0, hudT: 0, cloudT: 0 };
delete ENV.cur.name; delete ENV.cur.icon;
function envSet(name) { ENV.target = name; ENV.next = 90 + Math.random() * 60; }
function envNext() { envSet(CLIM_ORDER[(CLIM_ORDER.indexOf(ENV.target) + 1) % CLIM_ORDER.length]); toast(CLIM[ENV.target].icon + ' ' + CLIM[ENV.target].name, 'The weather is changing.'); }
function envPick() { const w = { clear: 34, cloudy: 24, rain: 20, fog: 10, storm: 12 }; let r = Math.random() * 100, pick = 'clear'; for (const k in w) { r -= w[k]; if (r <= 0) { pick = k; break; } } if (pick === ENV.target) pick = 'clear'; envSet(pick); }
// moon + stars in the far dome
const MOON = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 8, 64, 64, 64); g.addColorStop(0, 'rgba(230,236,255,.5)'); g.addColorStop(1, 'rgba(230,236,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#eef2ff'; x.beginPath(); x.arc(64, 64, 24, 0, 7); x.fill(); x.fillStyle = '#c9d2ee'; for (const [a, b, r] of [[56, 58, 6], [72, 70, 5], [66, 52, 4], [54, 74, 3]]) { x.beginPath(); x.arc(a, b, r, 0, 7); x.fill(); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, fog: false, depthWrite: false })); s.scale.set(34, 34, 1); far.add(s); return s;
})();
const STARS = (() => {
  const n = 420, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, e = Math.random() * 1.25 + .08, r = 440; p[i * 3] = Math.cos(a) * Math.cos(e) * r; p[i * 3 + 1] = Math.sin(e) * r; p[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3)); const pts = new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); pts.frustumCulled = false; far.add(pts); return pts;
})();
// rain: streaks falling around the player
const RAIN = (() => {
  const N = 2800, BX = 64, BY2 = 34, g = new T.BufferGeometry(), pos = new Float32Array(N * 6), seed = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { seed[i * 3] = (Math.random() - .5) * BX; seed[i * 3 + 1] = Math.random() * BY2; seed[i * 3 + 2] = (Math.random() - .5) * BX; }
  g.setAttribute('position', new T.BufferAttribute(pos, 3)); const m = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: .5, fog: false, depthWrite: false })); m.frustumCulled = false; m.visible = false; scene.add(m);
  return { m, pos, seed, N, BX, BY2, g };
})();
if ($('envHud')) $('envHud').onclick = envNext;
const plight = new T.PointLight(0xffe2b8, 0, 30, 1.6); scene.add(plight);
// sound: rain hiss + thunder, started on the first key or click (browsers need that)
const SND = { rain: null, gain: null };
function envAudio() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); if (!SND.rain) { const n = ac.sampleRate * 2, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = b; s.loop = true; f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = .4; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(ac.destination); s.start(); SND.rain = s; SND.gain = g; } } catch (e) { } }
addEventListener('pointerdown', envAudio, { once: true }); addEventListener('keydown', envAudio, { once: true });
function thunder() {
  try { if (!ac) return; const n = Math.floor(ac.sampleRate * 2.6), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2) * (1 + Math.sin(i / 900) * .4);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = b; f.type = 'lowpass'; f.frequency.value = 220; g.gain.value = .7 * (1 - ENV.indoor * .6); s.connect(f); f.connect(g); g.connect(ac.destination); s.start(); } catch (e) { }
}
const hex3 = (a, b, t) => mixHex(a, b, clamp(t, 0, 1));
function envStep(dt, t, aw) {
  const E = ENV, pp = player.g.position;
  E.hour = (E.hour + dt * E.speed) % 24;
  E.next -= dt; if (E.auto && E.next <= 0) envPick();
  const T0 = CLIM[E.target], k = Math.min(1, dt * .3); for (const key in E.cur) if (key in T0 && typeof T0[key] === 'number') E.cur[key] += (T0[key] - E.cur[key]) * k;
  E.indoor += ((player.inside ? 1 : 0) - E.indoor) * Math.min(1, dt * 3);
  const C = E.cur, h = E.hour; let i = 0; while (i < KF.length - 2 && KF[i + 1].h <= h) i++;
  const A = KF[i], B = KF[i + 1], f0 = clamp((h - A.h) / (B.h - A.h), 0, 1), f = f0 * f0 * (3 - 2 * f0);
  const day = lerp(A.day, B.day, f), night = 1 - day, ind = E.indoor;
  // Disable the moving sun shadow map at night, when its low light reveals map-edge streaks.
  const shadowsOn = !player.inside && day > .12;
  if (sun.castShadow !== shadowsOn) sun.castShadow = shadowsOn;
  // sun/moon light on a continuous arc: west at dusk, overhead at midnight is the moon, east at dawn
  const a = (h - 6) / 12 * Math.PI, el = Math.sin(a);
  sun.position.set(pp.x + 30 * Math.cos(a), 14 + 22 * Math.abs(el), pp.z + 14);
  const gc = hex3('#1c2232', '#9aa3ad', day);
  E.skyT -= dt;
  if (E.skyT <= 0) {
    E.skyT = .12;
    const sky = A.sky.map((c, j) => { let m = mixHex(c, B.sky[j], f); m = mixHex(m, mixHex(gc, '#ffffff', j * .05 * day), clamp(C.gray * .85, 0, 1)); m = mixHex(m, SKY.dawn[j], aw); m = mixHex(m, SKY.day[j], ind); return m; });
    const x = skyCanvas.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, sky[0]); g.addColorStop(.45, sky[1]); g.addColorStop(.8, sky[2]); g.addColorStop(1, sky[3]); x.fillStyle = g; x.fillRect(0, 0, 2, 256); skyTex.needsUpdate = true;
    scene.fog.color.set(sky[3]);
    // clouds: count, darkness and colour follow the weather and the hour
    const cc = mixHex(mixHex('#2a3150', '#ffffff', day), mixHex('#27303c', '#8f98a4', day), clamp(C.cover * C.gray * 1.1, 0, 1));
    clouds.forEach((sp, j) => { const on = j < 3 + C.cover * 9; sp.visible = on; sp.material.color.set(cc); sp.material.opacity = (.35 + .6 * C.cover) * (on ? 1 : 0) * (1 - .35 * ind); });
  }
  const sc = clamp(1 - C.cover * .9, 0, 1) * (1 - ind);
  const sunC = mixHex(A.sun, B.sun, f);
  sun.color.set(mixHex(sunC, '#ffe3b8', aw * .6)); sun.intensity = lerp(lerp(A.si, B.si, f) * C.sunK, 1.4, ind) - .3 * 0;
  hemi.color.set(mixHex(mixHex(A.hs, B.hs, f), '#fff4e0', ind)); hemi.groundColor.set(mixHex(mixHex(A.hg, B.hg, f), '#a89878', ind));
  E.flash *= Math.pow(.02, dt * 3); hemi.intensity = lerp(lerp(A.hi, B.hi, f) * C.hemiK, .95, ind) + E.flash * 2.4 * (1 - ind);
  renderer.toneMappingExposure = lerp(1 + night * .25 + C.gray * .05, 1, ind);
  scene.fog.near = lerp(C.fn, 90, ind); scene.fog.far = lerp(C.ff, 320, ind);
  // sun + moon discs in the sky (the far dome follows the player)
  const sa = a, ma = a + Math.PI, rr = 235;
  SUNS.glow.position.set(rr * Math.cos(sa), rr * Math.sin(sa) - 6, -200); SUNS.core.position.set(rr * Math.cos(sa), rr * Math.sin(sa) - 6, -199);
  const sv = clamp(Math.sin(sa) * 3 + .4, 0, 1) * sc; SUNS.glow.material.opacity = .95 * sv; SUNS.core.material.opacity = sv; SUNS.glow.material.color.set(mixHex('#ff9a60', '#fff1c0', clamp(Math.sin(sa) * 2, 0, 1)));
  MOON.position.set(rr * Math.cos(ma), rr * Math.sin(ma) - 6, -200); MOON.material.opacity = clamp(Math.sin(ma) * 3 + .4, 0, 1) * clamp(1 - C.cover * .85, 0, 1) * night;
  STARS.material.opacity = clamp(night * (1 - C.cover) * (.75 + .15 * Math.sin(t * 2)), 0, 1) * (1 - ind); STARS.visible = STARS.material.opacity > .01;
  // the player carries a little light after dark
  plight.position.set(pp.x, pp.y + 3.2, pp.z); plight.intensity = night * (1 - ind) * (14 + C.cover * 8);
  // rain
  const rk = C.rain * (1 - ind), R = RAIN; R.m.visible = rk > .02;
  pitchDamp += (C.rain - pitchDamp) * Math.min(1, dt * .18);
  for (const wet of PITCH_WETNESS) wet.material.opacity = pitchDamp * .34;
  for (const p of WEATHER_PEOPLE) p.umbrella.visible = rk > .12;
  if (R.m.visible) {
    R.m.position.set(pp.x, 0, pp.z); R.m.material.opacity = .32 + .4 * rk; R.g.setDrawRange(0, Math.floor(R.N * (.25 + .75 * rk)) * 2);
    const vy = 24 + 8 * rk, wx = C.wind * 6, len = .55 + .4 * rk;
    for (let n = 0; n < R.N; n++) { const s = R.seed; s[n * 3 + 1] -= vy * dt; s[n * 3] += wx * dt; if (s[n * 3 + 1] < 0) { s[n * 3 + 1] += R.BY2; s[n * 3] = (Math.random() - .5) * R.BX; s[n * 3 + 2] = (Math.random() - .5) * R.BX; } if (s[n * 3] > R.BX / 2) s[n * 3] -= R.BX;
      const o = n * 6; R.pos[o] = s[n * 3]; R.pos[o + 1] = s[n * 3 + 1]; R.pos[o + 2] = s[n * 3 + 2]; R.pos[o + 3] = s[n * 3] - wx * .03 * len; R.pos[o + 4] = s[n * 3 + 1] + len; R.pos[o + 5] = s[n * 3 + 2]; }
    R.g.attributes.position.needsUpdate = true;
  }
  if (SND.gain) SND.gain.gain.value += (rk * .09 - SND.gain.gain.value) * Math.min(1, dt * 2);
  // lightning in a thunderstorm
  if (C.storm > .5 && !ind) { E.boltT -= dt; if (E.boltT <= 0) { E.boltT = 5 + Math.random() * 9; E.flash = 1; const fl = $('flash'); fl.classList.remove('bolt'); void fl.offsetWidth; fl.classList.add('bolt'); setTimeout(thunder, 350 + Math.random() * 1800); } }
  // HUD
  E.hudT -= dt; if (E.hudT <= 0) { E.hudT = .3; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), el2 = $('envHud'); if (el2) el2.textContent = (night > .6 ? '🌙' : CLIM[E.target].icon) + ' ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ' · ' + CLIM[E.target].name; }
}

// free roam: every gate starts open
GATES.forEach((G, k) => { openGate(k); G.t = 1; G.g.visible = false; });

// ---- resume printer beside the Grootan building
const PRINTER = { x: 49, z: -218.5, paper: null, slot: null };
{
  const g = new T.Group(); g.position.set(PRINTER.x, 0, PRINTER.z); g.rotation.y = -.35; g.scale.setScalar(1.6); world.add(g); PRINTER.g = g;
  box(g, 1.9, .28, 1.5, 0x7a8590, 0, .14, 0);              // plinth
  box(g, 1.8, 1.05, 1.35, 0xf2efe6, 0, .8, 0);              // body
  box(g, 1.86, .16, 1.4, 0xd9d4c6, 0, 1.38, 0);             // lid
  box(g, 1.2, .08, .7, 0xfaf8f2, 0, 1.46, -.1);             // paper tray
  box(g, .5, .22, .06, 0x2b3a4a, -.45, 1.0, .69, false);    // screen
  const led = box(g, .5, .22, .06, 0x6fe3c1, -.45, 1.0, .7, false); led.material = new T.MeshBasicMaterial({ color: 0x6fe3c1 }); PRINTER.led = led;
  box(g, .3, .08, .06, 0xd8402a, .35, 1.0, .69, false);     // button
  box(g, 1.3, .1, .06, 0x2a2a2a, 0, .55, .69, false);       // output slot
  const paper = box(g, 1.05, .02, .75, 0xffffff, 0, .56, .85, false); paper.visible = false; PRINTER.paper = paper;
  signBoard(g, 'RESUME', 2.1, .8, 0, 2.5, 0, 'press E to print');
  cyl(g, .05, .05, 1.1, 0x555555, -.7, 1.9, -.4, 6); cyl(g, .05, .05, 1.1, 0x555555, .7, 1.9, -.4, 6);
  rounds.push({ x: PRINTER.x, z: PRINTER.z, r: 1.9 });
  const r = ringAt(PRINTER.x - .6, PRINTER.z + 3.6, 0x7fe0c8);
  PRINTER.stn = { id: 'printer', x: PRINTER.x - .6, z: PRINTER.z + 3.6, label: 'Print · Jeeva\'s resume', kind: 'print', act: -1, ring: r.ring, glow: r.glow };
  STN.push(PRINTER.stn);
}

// ---- the AI stretch: agent desks, drifting code, words orbiting the tower
function textCanvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; }
function wordSprite(text, col) {
  const tex = textCanvas(512, 128, (x, w, h) => { x.font = '700 64px ui-monospace, Menlo, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = col; x.shadowBlur = 24; x.fillStyle = '#ffffff'; x.fillText(text, w / 2, h / 2); x.shadowBlur = 0; x.fillStyle = col; x.globalAlpha = .55; x.fillText(text, w / 2, h / 2); });
  const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); s.scale.set(8, 2, 1); return s;
}
const AGENTS = [
  { id: 'claude', title: 'CLAUDE CODE', sub: 'pair-programmer in the terminal', x: -9, z: -297, col: '#f2a36b' },
  { id: 'codex', title: 'CODEX', sub: 'many tasks, in parallel', x: 9, z: -297, col: '#8fd8ff' },
  { id: 'astra', title: 'ASTRA', sub: 'agents on the night shift', x: -9, z: -309, col: '#c7a6ff' },
  { id: 'auto', title: 'AUTOMATION', sub: 'pipelines that run themselves', x: 9, z: -309, col: '#9ff0b0' },
];
for (const a of AGENTS) {
  const g = new T.Group(); g.position.set(a.x, 0, a.z); g.rotation.y = a.x < 0 ? .55 : -.55; world.add(g);
  box(g, 2.2, .3, 1.4, 0x5a6270, 0, .15, 0); box(g, .35, 1.6, .35, 0x3a404a, 0, 1.05, -.2);
  box(g, 2.9, 1.9, .18, 0x22262e, 0, 2.6, -.2);
  const scr = textCanvas(512, 320, (x, w, h) => {
    x.fillStyle = '#0e1320'; x.fillRect(0, 0, w, h); x.fillStyle = '#1b2236'; x.fillRect(0, 0, w, 34);
    ['#ff6b5e', '#ffc65a', '#5fd38a'].forEach((c, i) => { x.fillStyle = c; x.beginPath(); x.arc(22 + i * 22, 17, 7, 0, 7); x.fill(); });
    x.font = '700 54px ui-monospace, Menlo, monospace'; x.fillStyle = a.col; x.fillText(a.title, 26, 118);
    x.font = '26px ui-monospace, Menlo, monospace'; x.fillStyle = '#c9d4e8'; x.fillText(a.sub, 26, 168);
    x.fillStyle = '#7f8aa3'; x.fillText('> press E to open session_', 26, 260);
  });
  const sm = new T.Mesh(new T.PlaneGeometry(2.7, 1.7), new T.MeshBasicMaterial({ map: scr })); sm.position.set(0, 2.6, -.1); g.add(sm);
  const gl = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: new T.Color(a.col), transparent: true, opacity: .35, depthWrite: false })); gl.scale.set(6, 4, 1); gl.position.set(0, 2.6, -.4); g.add(gl);
  rounds.push({ x: a.x, z: a.z, r: 1.4 });
  const sx = a.x < 0 ? a.x + 2.6 : a.x - 2.6, r = ringAt(sx, a.z, new T.Color(a.col).getHex());
  STN.push({ id: a.id, x: sx, z: a.z, label: 'Open · ' + a.title.charAt(0) + a.title.slice(1).toLowerCase(), kind: 'term', act: 4, ...r });
}
// drifting code glyphs along the last stretch
const GLYPHS = [];
{
  const bits = ['{ }', '</>', '+ diff', '- bug', '=>', 'git push', '✓ tests', 'async', '#!', 'λ', 'PR #42', '[ ]', 'npm i', 'deploy', 'agent', '{…}'];
  const cols = ['#bff6ff', '#ffe9a8', '#c7a6ff', '#9ff0b0'];
  for (let i = 0; i < 34; i++) {
    const tex = textCanvas(256, 64, (x, w, h) => { x.font = '600 34px ui-monospace, Menlo, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = cols[i % 4]; x.shadowColor = cols[i % 4]; x.shadowBlur = 12; x.fillText(bits[i % bits.length], w / 2, h / 2); });
    const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false })); s.scale.set(2.4, .6, 1);
    s.userData = { x: (Math.random() - .5) * 26, z: -288 - Math.random() * 44, y: Math.random() * 12, sp: .4 + Math.random() * .8 };
    s.position.set(s.userData.x, s.userData.y, s.userData.z); scene.add(s); GLYPHS.push(s);
  }
}
// words orbiting the tower
SPIRE.words = ['CLAUDE CODE', 'CODEX', 'ASTRA', 'AUTOMATION', 'CHANGES'].map((w, i) => { const s = wordSprite(w, ['#f2a36b', '#8fd8ff', '#c7a6ff', '#9ff0b0', '#ffe9a8'][i]); s.userData = { a: i / 5 * Math.PI * 2, y: 9 + i * 3.2 }; SPIRE.g.add(s); return s; });

// ---- life along the road: boost pads, memory orbs and little scenes
const AMB = [...(globalThis.PREAMB || [])];
function lerpAngle(a, b, k) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; }
const along = (s, off) => { const p = pointAt(clamp(s, 0, TOTAL)); return { x: p.x - p.tz * off, z: p.z + p.tx * off, ry: Math.atan2(p.tx, p.tz), p }; };
const sOf = (x, z) => pathNear(x, z).s;
const STN_S = STN.map(s => sOf(s.x, s.z));
const nearStation = (x, z, d) => STN.some(s => Math.hypot(s.x - x, s.z - z) < d);
// boost pads
const PADS = [];
for (let s = 22; s < TOTAL - 45; s += 34) {
  const q = along(s, 0); if (nearStation(q.x, q.z, 9)) continue;
  const g = new T.Group(); g.position.set(q.x, .075, q.z); g.rotation.y = q.ry; world.add(g);
  const m = new T.MeshBasicMaterial({ color: new T.Color(0xffc24a).multiplyScalar(1.3), transparent: true, opacity: .85, depthWrite: false });
  for (let k = 0; k < 3; k++) { const sh = new T.Shape(); sh.moveTo(-.9, 0); sh.lineTo(0, -.7); sh.lineTo(.9, 0); sh.lineTo(.9, .35); sh.lineTo(0, -.35); sh.lineTo(-.9, .35); sh.closePath(); const mm = m.clone(); mm.side = T.DoubleSide; const c = new T.Mesh(new T.ShapeGeometry(sh), mm); c.rotation.x = -Math.PI / 2; c.position.z = (k - 1) * .85; g.add(c); }
  PADS.push({ x: q.x, z: q.z, g, cool: 0 });
}
AMB.push(t => { for (const P of PADS) P.g.children.forEach((c, k) => { c.material.opacity = .35 + .6 * Math.max(0, Math.sin(t * 6 - k * 1.2)); }); });
// memory orbs
const MEMS = [
  'Summer holidays: cricket from sunrise until someone\'s amma called everyone home.',
  'Gully rule: hit it over the wall, you go and get it.',
  'Thatha never let you win. That is why the wins counted.',
  'Chess lesson: the move you did not see is the one that beats you.',
  'First program: Hello, World. It felt like magic.',
  'Exam week. Coffee. More coffee. Then sleep for a whole day.',
  'Hackathon, 3 a.m.: the bug was one missing character.',
  'First pull request merged. Quietly framed it in your head.',
  'One production night teaches more than a semester.',
  'Security rule: never trust input. Not even your own.',
  'Learning never ends. Only the syllabus changes.',
  'Next: build something that outlives the hype.',
];
const ORBS = [];
{
  const n = MEMS.length;
  for (let i = 0; i < n; i++) {
    let s = 14 + i * (TOTAL - 50) / (n - 1), q = along(s, (i % 2 ? 1 : -1) * 1.1), tries = 0;
    while (nearStation(q.x, q.z, 6) && tries++ < 6) { s += 5; q = along(s, (i % 2 ? 1 : -1) * 1.1); }
    const g = new T.Group(); g.position.set(q.x, 1.3, q.z); scene.add(g);
    const core = new T.Mesh(new T.OctahedronGeometry(.32, 0), new T.MeshBasicMaterial({ color: new T.Color(0xffe9a8).multiplyScalar(1.5) })); g.add(core);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffd36a, transparent: true, opacity: .7, depthWrite: false })); sp.scale.set(2.4, 2.4, 1); g.add(sp);
    ORBS.push({ i, x: q.x, z: q.z, g, core, got: false });
  }
}
AMB.push(t => { for (const O of ORBS) if (!O.got) { O.core.rotation.y = t * 2 + O.i; O.g.position.y = 1.3 + Math.sin(t * 2 + O.i) * .18; } });
// chapter signposts
for (const [frac, txt] of [[.2, 'CHESS AHEAD'], [.4, 'COLLEGE AHEAD'], [.58, 'WORK AHEAD'], [.83, 'THE BIG PICTURE']]) {
  const q = along(TOTAL * frac, 4.2); if (nearStation(q.x, q.z, 6)) continue;
  const g = new T.Group(); g.position.set(q.x, 0, q.z); g.rotation.y = q.ry + Math.PI; world.add(g);
  cyl(g, .09, .11, 2.6, 0x6a4428, 0, 1.3, 0, 6); signBoard(g, txt, 3.2, .8, 0, 2.3, .1); rounds.push({ x: q.x, z: q.z, r: .4 });
}
// tea stall with steam, between cricket and chess
{
  const q = along(CUM[3] + 14, 7.5), g = new T.Group(); g.position.set(q.x, 0, q.z); g.rotation.y = q.ry - Math.PI / 2; world.add(g);
  box(g, 3, 1.1, 1.2, 0x9a633f, 0, .55, 0); box(g, 3.2, .1, 1.4, 0x7a4a2a, 0, 1.15, 0);
  for (const sx of [-1.45, 1.45]) cyl(g, .07, .07, 2.4, 0x5a3f2c, sx, 1.2, -.55, 6);
  const roof = box(g, 3.6, .12, 2.2, 0xd8402a, 0, 2.45, -.1); roof.rotation.x = -.18;
  signBoard(g, 'CHAI · 10 ₹', 2.2, .6, 0, 2.95, .45);
  const ket = cyl(g, .22, .26, .4, 0xb8bcc4, -.8, 1.4, .1, 10); sph(g, .08, 0x333333, -.8, 1.65, .1);
  for (let k = 0; k < 3; k++) box(g, .12, .16, .12, 0xf4f0e6, .3 + k * .3, 1.28, .2, false);
  box(g, 2.4, .12, .5, 0x7a4a2a, 0, .5, 1.6); for (const sx of [-1, 1]) box(g, .12, .45, .4, 0x5a3f2c, sx, .25, 1.6);
  const a = person({ shirt: 0xf4f0e6, pants: 0x3a3a48, scale: .9, moustache: true }); a.g.position.set(0, 0, -1.2); g.add(a.g);
  const b = person({ shirt: 0x3f8f88, pants: 0x35507a, scale: .82 }); b.g.position.set(.8, 0, 1.9); b.g.rotation.y = Math.PI; g.add(b.g);
  rounds.push({ x: q.x, z: q.z, r: 2.2 });
  const steam = []; for (let k = 0; k < 6; k++) { const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); g.add(s); steam.push(s); }
  AMB.push(t => { steam.forEach((s, k) => { const u = (t * .45 + k / 6) % 1; s.position.set(-.8 + Math.sin(u * 6 + k) * .12, 1.75 + u * 1.4, .1); s.scale.setScalar(.25 + u * .7); s.material.opacity = .45 * (1 - u); }); a.arms[1].rotation.x = -.6 + Math.sin(t * 2) * .3; b.arms[1].rotation.x = -1.2 + Math.max(0, Math.sin(t * .8)) * .9; });
}
// cows grazing between chess and college
{
  const mk = (s, off, col) => {
    const q = along(s, off), g = new T.Group(); g.position.set(q.x, 0, q.z); g.rotation.y = q.ry + (off > 0 ? 1.2 : -1.9); world.add(g);
    box(g, .8, .7, 1.7, col, 0, 1.0, 0); box(g, .5, .5, .6, col, 0, 1.15, 1.1);
    const head = new T.Group(); head.position.set(0, 1.1, 1.15); g.add(head); box(head, .42, .42, .55, col, 0, -.1, .3); box(head, .3, .22, .2, 0xe8b8a8, 0, -.25, .6, false);
    for (const sx of [-1, 1]) { const h = cyl(head, .03, .05, .3, 0xf4f0e6, sx * .18, .2, .2, 5); h.rotation.z = sx * -.6; }
    for (const [lx, lz] of [[-.28, .6], [.28, .6], [-.28, -.6], [.28, -.6]]) box(g, .16, .7, .16, 0x5a4a3a, lx, .35, lz);
    const tail = new T.Group(); tail.position.set(0, 1.25, -.86); g.add(tail); box(tail, .05, .7, .05, col, 0, -.35, 0);
    rounds.push({ x: q.x, z: q.z, r: 1.3 });
    const ph = Math.random() * 6; AMB.push(t => { head.rotation.x = .55 + Math.sin(t * .7 + ph) * .35; tail.rotation.z = Math.sin(t * 2.4 + ph) * .4; });
  };
  mk(CUM[5] + 12, -8, 0xf4f0e6); mk(CUM[5] + 17, -11, 0x9a6a4a); mk(CUM[5] + 22, 8.5, 0xe8dcc8);
}
// bus stop before college
{
  const q = along(CUM[6] + 20, 4.6), g = new T.Group(); g.position.set(q.x, 0, q.z); g.rotation.y = q.ry + Math.PI / 2; world.add(g);
  box(g, 3, .1, 1.3, 0x8a8e96, 0, 2.3, 0); for (const sx of [-1.4, 1.4]) cyl(g, .06, .06, 2.3, 0x555555, sx, 1.15, -.5, 6);
  box(g, 2.8, 1.2, .08, 0x8fc8e0, 0, 1.4, -.55, false); box(g, 2.4, .1, .45, 0x7a4a2a, 0, .5, -.25);
  signBoard(g, 'BUS · B.I.T. 2 km', 2.6, .55, 0, 2.75, .2); rounds.push({ x: q.x, z: q.z, r: 1.6 });
  const s = person({ shirt: 0x8a4a8a, pants: 0x35507a, scale: .8 }); s.g.position.set(.6, 0, .2); g.add(s.g);
}
// kid flying a kite near home
{
  const q = along(CUM[1] - 14, -9), kid = person({ shirt: 0xf0b84a, pants: 0x35507a, scale: .6 }); kid.g.position.set(q.x, 0, q.z); kid.g.rotation.y = q.ry + 2.4; world.add(kid.g); kid.arms[1].rotation.x = -2.4;
  const kite = new T.Mesh(new T.OctahedronGeometry(.9, 0), new T.MeshToonMaterial({ color: 0xd8402a, gradientMap: toonGrad })); kite.scale.set(1, 1.3, .15); scene.add(kite);
  const tail = new T.Mesh(new T.BoxGeometry(.06, 1.6, .02), mat(0xf0b84a)); scene.add(tail);
  const lg = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), line = new T.Line(lg, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7 })); scene.add(line);
  AMB.push(t => { const kx = q.x - 6 + Math.sin(t * .5) * 2.5, ky = 13 + Math.sin(t * .8) * 1.5, kz = q.z - 5 + Math.cos(t * .4) * 2; kite.position.set(kx, ky, kz); kite.rotation.z = Math.sin(t * 1.3) * .3; tail.position.set(kx, ky - 1.6, kz); tail.rotation.z = Math.sin(t * 2) * .4; const a = lg.attributes.position; a.setXYZ(0, q.x, 1.2, q.z); a.setXYZ(1, kx, ky - .8, kz); a.needsUpdate = true; });
  rounds.push({ x: q.x, z: q.z, r: .6 });
}
// pond with ducks on the quiet stretch after work
{
  const q = along(CUM[11] + 16, -11), g = new T.Group(); g.position.set(q.x, 0, q.z); world.add(g);
  const water = new T.Mesh(new T.CylinderGeometry(5, 5, .06, 40), new T.MeshToonMaterial({ color: 0x6fb6d8, gradientMap: toonGrad, transparent: true, opacity: .9 })); water.position.y = .05; water.receiveShadow = true; g.add(water);
  for (let k = 0; k < 18; k++) { const a = k / 18 * 6.283; sph(g, .35 + (k % 3) * .1, 0x9a9488, Math.cos(a) * 5.2, .12, Math.sin(a) * 5.2, 1, .5, 1); }
  for (let k = 0; k < 5; k++) { const a = 2 + k * .25; const r = cyl(g, .04, .05, 1.2 + (k % 2) * .5, 0x6b8f4a, Math.cos(a) * 4.4, .6, Math.sin(a) * 4.4, 5); r.rotation.z = (k - 2) * .08; }
  const ducks = []; for (let k = 0; k < 3; k++) { const d = new T.Group(); g.add(d); sph(d, .3, 0xffffff, 0, .25, 0, 1, .8, 1.3); sph(d, .17, 0xffffff, 0, .55, .3); box(d, .1, .05, .16, 0xf0a030, 0, .52, .5, false); ducks.push(d); }
  rounds.push({ x: q.x, z: q.z, r: 5.4 });
  AMB.push(t => ducks.forEach((d, k) => { const a = t * .25 + k * 2.1, r = 2.2 + k * .7; d.position.set(Math.cos(a) * r, .02 + Math.sin(t * 3 + k) * .03, Math.sin(a) * r); d.rotation.y = -a; }));
}
// his girlfriend waits on a bench by the pond, waves when he rides by
{
  const q = along(CUM[11] + 9, -4.5), g = new T.Group(); g.position.set(q.x, 0, q.z); g.rotation.y = q.ry + Math.PI / 2; world.add(g);
  box(g, 2, .14, .6, 0x8a5a36, 0, .55, 0); box(g, 2, .5, .1, 0x8a5a36, 0, .9, -.3); for (const sx of [-.8, .8]) box(g, .1, .5, .5, 0x5a3f2c, sx, .28, 0);
  const gf = person({ shirt: 0xf27aa0, pants: 0x4a5a8a, scale: .92, hair: 'bun', hairColor: 0x2a1713, brow: false }); gf.g.position.set(.2, 0, .9); gf.g.rotation.y = Math.PI * .5; g.add(gf.g);
  const hearts = []; for (let k = 0; k < 4; k++) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#ff6f91'; x.font = '48px sans-serif'; x.textAlign = 'center'; x.fillText('\u2665', 32, 50); const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false })); g.add(sp); hearts.push(sp); }
  rounds.push({ x: q.x, z: q.z, r: 1.6 });
  let greeted = false;
  AMB.push((t, dt, pp) => {
    const d = Math.hypot(q.x - pp.x, q.z - pp.z), near = d < 14;
    gf.arms[1].rotation.x = near ? -2.5 + Math.sin(t * 7) * .35 : -.1; gf.g.position.y = near ? Math.abs(Math.sin(t * 4)) * .05 : 0;
    gf.g.rotation.y = lerpAngle(gf.g.rotation.y, near ? Math.atan2((pp.x - q.x), (pp.z - q.z)) - g.rotation.y : Math.PI * .5, Math.min(1, dt * 4));
    hearts.forEach((h, k) => { const u = (t * .5 + k / 4) % 1; h.position.set(.2 + Math.sin(u * 5 + k) * .25, 2.4 + u * 1.2, .9); h.scale.setScalar(.35 + u * .3); h.material.opacity = near ? Math.sin(u * Math.PI) * .9 : 0; });
    if (near && d < 8 && !greeted) { greeted = true; toast('\u2665 She is waiting by the pond', 'Waves and cheers: "Look how far you came. Proud of you!"'); }
    if (d > 30) greeted = false;
  });
}
// stunt lane: one-way track that peels off the road (entry curve), launches over a gap jump (stunt) and rejoins the road (exit curve)
const AR = { active: false, t: 0, tricks: 0, goal: 1, limit: 25, dir: 0, cd: 0, skip: false, parts: [] };
const ARENA = { ramps: [], score: 0, combo: 0 }; const _rv = new T.Vector3();
// height of the ramp surface under a world point (the bike climbs the kickers)
function rampH(p) {
  for (const R of ARENA.ramps) { if (!R.len) continue; _rv.set(p.x, 0, p.z); R.r.worldToLocal(_rv); const u = (_rv.x + R.len / 2) / R.len; if (u < 0 || u > 1 || Math.abs(_rv.z) > R.w / 2) continue; return R.h * Math.pow(u, 1.9) * .95; }
  return 0;
}
{
  // local frame: origin on the road, -x along the road (direction of travel), +z towards the open side; the lane runs at z = LANE
  const q = along(CUM[9] + 12, 0), g = new T.Group(); g.position.set(q.x, 0, q.z); g.rotation.y = q.ry + Math.PI / 2; world.add(g); world.updateMatrixWorld(true);
  const LANE = 12, LY = .068, LW = 5.6, S0 = -38, S1 = 8;
  const roadAt = (s, off = 0) => { const a = along(CUM[9] + 12 + s, off); return g.worldToLocal(new T.Vector3(a.x, 0, a.z)); };
  const bez = (p0, p1, p2, p3, n = 30) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u; return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z }; });
  const solid = (x, z, r, ground) => { const w = g.localToWorld(new T.Vector3(x, 0, z)); rounds.push({ x: w.x, z: w.z, r, ground }); }; // ground: only blocks riders on the ground, not ones in the air

  // lane geometry: entry curve, straight stunt section, exit curve
  const P0 = roadAt(S0), P0b = roadAt(S0 + 2), d0 = { x: P0b.x - P0.x, z: P0b.z - P0.z }, dl = Math.hypot(d0.x, d0.z); d0.x /= dl; d0.z /= dl;
  const P3 = roadAt(S1), P3b = roadAt(S1 - 2), d3 = { x: P3.x - P3b.x, z: P3.z - P3b.z }, el = Math.hypot(d3.x, d3.z); d3.x /= el; d3.z /= el;
  const XA = 28, XB = 4.5;
  const entry = bez(P0, { x: P0.x + d0.x * 5.5, z: P0.z + d0.z * 5.5 }, { x: XA + 5.5, z: LANE }, { x: XA, z: LANE });
  const exit = bez({ x: XB, z: LANE }, { x: XB - 5.5, z: LANE }, { x: P3.x - d3.x * 5.5, z: P3.z - d3.z * 5.5 }, P3);
  const straight = [{ x: XA, z: LANE }, { x: XB, z: LANE }];
  // the lane surface itself is painted in the ground decal; only its centre line is kept (ARENA.lane, set below)
  const full = entry.concat(straight.slice(1), exit);
  // weathered concrete: oil stains and expansion joints
  for (let k = 0; k < 8; k++) { const sx = XA - 2 - k * 2.8, st = new T.Mesh(new T.CircleGeometry(.4 + (k % 3) * .22, 14), new T.MeshBasicMaterial({ color: 0x25272c, transparent: true, opacity: .26 + (k % 3) * .06, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    st.rotation.x = -Math.PI / 2; st.scale.set(1.5, 1, 1); st.position.set(sx, LY + .014, LANE + ((k * 37 % 5) - 2) * .8); g.add(st); }
  for (let k = 0; k <= 5; k++) box(g, .07, .01, LW - .3, 0x4e5056, XA - 1 - k * 4, LY + .015, LANE, false);
  // tyre skid marks leading into the ramp
  for (let k = 0; k < 6; k++) { const sm = box(g, 3 + (k % 3), .01, .2, 0x55575e, XA - 3 - k * 1.6, LY + .016, LANE + (k % 2 ? .9 : -.9), false); sm.material = new T.MeshBasicMaterial({ color: 0x55575e, transparent: true, opacity: .4, polygonOffset: true, polygonOffsetFactor: -3 }); }

  // wedge builder: solid side profile (concave lip) extruded across the width
  const wedge = (len, h, w, col) => {
    const sh = new T.Shape(); sh.moveTo(0, 0); sh.lineTo(len, 0); sh.lineTo(len, h); sh.quadraticCurveTo(len * .45, h * .12, 0, 0);
    const geo = new T.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false, steps: 1 }); geo.translate(-len / 2, 0, -w / 2);
    const m = new T.Mesh(geo, new T.MeshToonMaterial({ color: col, gradientMap: toonGrad })); m.castShadow = m.receiveShadow = true; outline(m, 1.02); return m;
  };
  const mkRamp = (x, z, ry, col, len, h, w, opt = {}) => {
    const r = new T.Group(); r.position.set(x, LY, z); r.rotation.y = ry; g.add(r);
    r.add(wedge(len, h, w, col));
    for (const sz of [-1, 1]) { const rail = box(r, len * .98, .08, .1, 0xf4f0e6, 0, h * .55, sz * w / 2); rail.rotation.z = Math.atan2(h, len) * .82; }
    for (let k = 0; k < 4; k++) box(r, .05, .02, w * .94, 0xf4f0e6, -len / 2 + len * (.2 + k * .2), .01 + h * .16 * (k * .2 + .2) * 2, 0, false);
    ARENA.ramps.push({ r, x: 0, z: 0, cool: 0, lx: len / 2 - .6, len, h, w, trig: opt.trig !== false, big: !!opt.big });
  };
  const RW = LW - .6;
  mkRamp(20.5, LANE, Math.PI, 0xff7a2a, 7, 2.6, RW, { big: true });    // kicker, lip at x = 17 (it is also the landing for riders coming the other way)
  mkRamp(8.5, LANE, 0, 0xff7a2a, 7, 2.6, RW, { big: true });          // matching kicker from the other side, lip at x = 12
  box(g, 5, .02, RW, 0x1c2230, 14.5, LY + .014, LANE, false); for (let k = 0; k < 5; k++) box(g, 1, .02, .5, k % 2 ? 0xffffff : 0x1c2230, 16.5 - k, LY + .028, LANE - RW / 2 + .5, false);

  // an arch with sign + start lights at each end: the lane runs both ways
  const mkArch = (ax, ry) => {
    const arch = new T.Group(); arch.position.set(ax, 0, LANE); arch.rotation.y = ry; g.add(arch);
    for (const sx of [-3.4, 3.4]) cyl(arch, .18, .22, 5.2, 0xd8402a, sx, 2.6, 0, 8); box(arch, 7.4, .5, .4, 0xd8402a, 0, 5.2, 0);
    signBoard(arch, 'STUNT LANE', 5.4, 1.1, 0, 6.3, 0, 'ride fast . land clean'); signBoard(arch, 'LAND THE JUMP', 5.0, .8, 0, 4.5, -.2);
    for (const sx of [-2.4, 2.4]) { box(arch, .5, 1.2, .3, 0x15181e, sx, 3.45, .1); [0xe03a2a, 0xffc93a, 0x4fd070].forEach((c, i) => { const l = new T.Mesh(new T.SphereGeometry(.13, 10, 8), new T.MeshBasicMaterial({ color: c })); l.position.set(sx, 3.8 - i * .36, .28); arch.add(l); }); }
    solid(ax, LANE - 3.4, .5); solid(ax, LANE + 3.4, .5);
  };
  mkArch(XA + 1.5, Math.PI / 2); mkArch(XB - 1.5, -Math.PI / 2);

  // sponsor boards along both sides of the stunt section
  const banner = (txt, c1, c2) => { const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d'); x.fillStyle = c1; x.fillRect(0, 0, 512, 160); x.fillStyle = c2; x.fillRect(0, 0, 512, 14); x.fillRect(0, 146, 512, 14);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; let fs = 78; x.font = `900 ${fs}px system-ui, sans-serif`; while (x.measureText(txt).width > 450) { fs -= 3; x.font = `900 ${fs}px system-ui, sans-serif`; } x.fillText(txt, 256, 82);
    x.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 90; i++) x.fillRect(Math.random() * 512, Math.random() * 160, 1 + Math.random() * 3, 1 + Math.random() * 2);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; };
  const adTex = [['GROOTAN', '#0f5c4c', '#7fe8a0'], ['NITRO ENERGY', '#b5321f', '#ffd36a'], ['B.I.T.', '#3a4a8a', '#ffffff'], ['GULLY CRICKET', '#2f7a40', '#f4f0e6'], ['CHAI & CO', '#6a3f22', '#e8b84a'], ['IRON GYM', '#2c3556', '#ffc93a']].map(a => banner(...a));
  for (const side of [1, -1]) for (let k = 0; k < 11; k++) {
    const bx = 27.1 - k * 2.2, bz = LANE + side * 3.5; box(g, 2.2, .8, .3, 0xb8b9bd, bx, .45, bz); box(g, 2.2, .1, .34, k % 2 ? 0xd8402a : 0xf4f0e6, bx, .02 + LY, bz, false);
    const ad = new T.Mesh(new T.PlaneGeometry(2.05, .62), new T.MeshBasicMaterial({ map: adTex[(k + (side > 0 ? 0 : 3)) % adTex.length] })); ad.position.set(bx, .45, bz - side * .16); ad.rotation.y = side > 0 ? Math.PI : 0; g.add(ad);
  }

  // the lane is only enterable through its two curves: solid side walls behind the boards, and the gap itself is blocked on the ground (jumping over it still works)
  for (let x = 28.2; x >= 3.9; x -= .8) for (const sd of [-1, 1]) solid(x, LANE + sd * 3.5, .5);
  for (const x of [15.7, 13.3]) for (let z = -2.4; z <= 2.5; z += .8) solid(x, LANE + z, .5, true);
  // stands behind the boards: posts, rail, steps and a shade roof, with the cheering crowd
  const stands = new T.Group(); stands.position.set(19, 0, LANE + 6.2); g.add(stands);
  for (let r = 0; r < 3; r++) { box(stands, 8, .4, 1, r % 2 ? 0x6a5a48 : 0x8a7358, 0, .5 + r * .6, r * .9); box(stands, 8, .05, .5, 0xc9ccd2, 0, .74 + r * .6, r * .9 - .1, false); }
  box(stands, 8.2, 2.6, .12, 0x4a3a2a, 0, 1.4, 3); box(stands, 8.2, .1, 4.6, 0x3f8f88, 0, 4.25, 1.2); box(stands, 8.2, .1, .1, 0x2c6a66, 0, 4.18, -1.1);
  for (const sx of [-3.9, 3.9]) for (const sz of [-.5, 2.9]) cyl(stands, .07, .07, 4.2, 0x8d939c, sx, 2.1, sz, 6);
  for (let k = 0; k <= 8; k++) cyl(stands, .025, .025, 1, 0xb8bcc4, -4 + k, 1.0, -.8, 5); box(stands, 8, .06, .06, 0xb8bcc4, 0, 1.45, -.8, false);
  for (let s = 0; s < 3; s++) box(stands, 1, .2, .45, 0x7a7e86, -4.5, .15 + s * .3, -.6 + s * .55);
  solid(19, LANE + 8, 4.6);
  const crowd = [], cs = [0xe0705a, 0x4a9a6a, 0xd0a040, 0x6a7fd0, 0xb06ad0, 0xf4f0e6, 0x3f8f88];
  const addFan = (px, py, pz, i) => { const f = person({ shirt: cs[i % cs.length], pants: i % 2 ? 0x2a3042 : 0x6a5a48, scale: .8 + (i % 3) * .05, hair: i % 4 === 0 ? 'none' : 'bun', hairColor: [0x2a1713, 0x4a3020, 0x1a1a1a][i % 3] }); f.g.position.set(px, py, pz); f.g.rotation.y = Math.PI; stands.add(f.g); crowd.push({ f, base: py, ph: i * 1.7 }); };
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) addFan(-3 + k * 2, .78 + r * .6, r * .9 + .2, r * 4 + k);

  // scoreboard (live jump / time / score), posts and floodlights
  const sbc = document.createElement('canvas'); sbc.width = 640; sbc.height = 320; const sbx = sbc.getContext('2d'), sbt = new T.CanvasTexture(sbc); sbt.colorSpace = T.SRGBColorSpace; let sbKey = '';
  const SBX = 6.5, SBZ = LANE + 7.5;
  for (const sx of [-2.6, 2.6]) cyl(g, .14, .18, 5.4, 0x4a4e58, SBX + sx, 2.7, SBZ, 8); box(g, 6.2, 3.4, .4, 0x1c2230, SBX, 4.8, SBZ); box(g, 6.5, .2, .55, 0xd8402a, SBX, 6.6, SBZ);
  const sbm = new T.Mesh(new T.PlaneGeometry(5.8, 2.9), new T.MeshBasicMaterial({ map: sbt })); sbm.position.set(SBX, 4.8, SBZ - .21); sbm.rotation.y = Math.PI; g.add(sbm);
  solid(SBX - 2.6, SBZ, .5); solid(SBX + 2.6, SBZ, .5);
  const sbDraw = () => {
    const act = AR.active, key = act ? [AR.tricks, Math.ceil(AR.limit - AR.t), ARENA.score].join() : 'idle' + (ARENA.best || 0); if (key === sbKey) return; sbKey = key;
    sbx.fillStyle = '#0d1220'; sbx.fillRect(0, 0, 640, 320); sbx.textAlign = 'center'; sbx.fillStyle = '#ffd36a'; sbx.font = '800 40px system-ui, sans-serif'; sbx.fillText('STUNT LANE', 320, 56);
    sbx.strokeStyle = '#ffffff22'; sbx.lineWidth = 3; sbx.beginPath(); sbx.moveTo(40, 76); sbx.lineTo(600, 76); sbx.stroke();
    if (act) { sbx.fillStyle = '#7fe8a0'; sbx.font = '800 100px system-ui, sans-serif'; sbx.fillText(AR.tricks ? 'LANDED' : 'GO GO GO', 320, 180); sbx.fillStyle = '#fff'; sbx.font = '700 42px system-ui, sans-serif'; sbx.fillText('TIME ' + Math.max(0, Math.ceil(AR.limit - AR.t)) + 's   ·   SCORE ' + ARENA.score, 320, 268); }
    else { sbx.fillStyle = '#fff'; sbx.font = '800 56px system-ui, sans-serif'; sbx.fillText('LAND THE JUMP', 320, 160); sbx.fillStyle = '#9be8ff'; sbx.font = '600 30px system-ui, sans-serif'; sbx.fillText(ARENA.best ? 'BEST SCORE ' + ARENA.best : 'RIDE UP THE LANE TO START', 320, 255); }
    sbt.needsUpdate = true; };
  sbDraw();
  for (const fx of [30, 2]) { const fz = LANE + 6; cyl(g, .12, .2, 9, 0x5c6068, fx, 4.5, fz, 8); const hd = box(g, 1.6, .4, .9, 0x2a2e36, fx, 9.1, fz); const gl = box(g, 1.4, .08, .7, 0xfff4c0, fx, 8.85, fz, false); gl.material = new T.MeshBasicMaterial({ color: 0xfff1b0 }); const hs = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xfff1b0, transparent: true, opacity: .5, depthWrite: false })); hs.position.set(fx, 8.6, fz); hs.scale.set(5, 5, 1); g.add(hs); solid(fx, fz, .5); }


  // paddock tent with table, cooler, spare tyres
  { const tn = new T.Group(); tn.position.set(31, 0, LANE + 10); g.add(tn);
    for (const [px, pz] of [[-2, -1.6], [2, -1.6], [-2, 1.6], [2, 1.6]]) cyl(tn, .05, .05, 2.6, 0xc9ccd2, px, 1.3, pz, 6);
    const rf = new T.Mesh(new T.ConeGeometry(3.4, 1.1, 4), mat(0xf4f0e6)); rf.position.y = 3.15; rf.rotation.y = Math.PI / 4; rf.scale.set(1.0, 1, .8); rf.castShadow = true; tn.add(rf);
    box(tn, 4.4, .5, .05, 0xd8402a, 0, 2.35, -1.72, false); box(tn, 2.4, .08, .9, 0x9a7a52, 0, .85, .9); for (const px of [-1, 1]) cyl(tn, .05, .05, .8, 0x6c7078, px, .42, .9, 5);
    box(tn, .6, .5, .5, 0x3a78c8, 1.5, .25, -.6); box(tn, .62, .08, .52, 0xf4f0e6, 1.5, .52, -.6);
    for (let t = 0; t < 3; t++) { const ty = new T.Mesh(new T.TorusGeometry(.38, .16, 8, 16), mat(0x24262b)); ty.position.set(-1.5, .17 + t * .3, -.8); ty.rotation.x = Math.PI / 2; ty.castShadow = true; tn.add(ty); }
    solid(31, LANE + 10, 2.8); }
  // camera crew on tripods beside the gap
  for (const [cx1, cz1, cr] of [[14.5, LANE - 5.4, Math.PI / 2 + .3], [14.5, LANE + 5.2, -Math.PI / 2 - .3]]) { const tr = new T.Group(); tr.position.set(cx1, LY, cz1); tr.rotation.y = cr; g.add(tr);
    for (let l = 0; l < 3; l++) { const la = l * 2.094, lg = cyl(tr, .02, .02, 1.5, 0x15181e, Math.cos(la) * .3, .7, Math.sin(la) * .3, 5); lg.rotation.set(Math.sin(la) * .2, 0, -Math.cos(la) * .2); }
    box(tr, .3, .25, .55, 0x1c2230, 0, 1.5, 0); cyl(tr, .08, .1, .3, 0x15181e, 0, 1.5, .4, 8).rotation.x = Math.PI / 2; }

  AMB.push((t, dt) => { sbDraw(); const ch = ARENA.cheerT > 0; if (ch) ARENA.cheerT -= dt;
    crowd.forEach(c => { const f = c.f; f.g.position.y = c.base + (ch ? Math.abs(Math.sin(t * 9 + c.ph)) * .22 : Math.sin(t * 2 + c.ph) * .01); const up = ch ? -2.7 + Math.sin(t * 12 + c.ph) * .3 : -.15 + Math.sin(t * 1.5 + c.ph) * .05; f.arms[0].rotation.x = up; f.arms[1].rotation.x = ch ? up + .2 : up; }); });

  // world anchors: challenge trigger on the entry curve, finish line after the landing
  world.updateMatrixWorld(true);
  const W = (x, z) => g.localToWorld(new T.Vector3(x, 0, z)), gp = entry[Math.floor(entry.length * .7)], gq = exit[Math.floor(exit.length * .3)];
  ARENA.center = W(14.5, LANE); ARENA.lane = { pts: full.map(p => { const w = W(p.x, p.z); return [w.x, w.z]; }), w: LW };
  ARENA.gates = [W(gp.x, gp.z), W(gq.x, gq.z)];
  ARENA.fins = [[3, 2], [25, 26]].map(([a, b]) => { const f0 = W(a, LANE), f1 = W(b, LANE); return { x: f0.x, z: f0.z, dx: f1.x - f0.x, dz: f1.z - f0.z }; }); // past the landing, per direction of travel
  for (const R of ARENA.ramps) { const v = R.r.localToWorld(new T.Vector3(R.lx, 0, 0)), w0 = R.r.localToWorld(new T.Vector3(0, 0, 0)), w1 = R.r.localToWorld(new T.Vector3(1, 0, 0)); R.x = v.x; R.z = v.z; R.dx = w1.x - w0.x; R.dz = w1.z - w0.z; }
  // booster pads on both curves so nobody reaches a kicker too slowly to clear the gap
  for (const [pts, i, sgn] of [[entry, Math.floor(entry.length * .88), 1], [exit, Math.floor(exit.length * .12), -1]]) {
    const c = pts[i], n = pts[i + sgn], fx = n.x - c.x, fz = n.z - c.z; // arrows point up the curve towards the kicker
    const pg = new T.Group(); pg.position.set(c.x, LY + .012, c.z); pg.rotation.y = Math.atan2(fx, fz); g.add(pg);
    const bm = new T.MeshBasicMaterial({ color: new T.Color(0xffc24a).multiplyScalar(1.3), transparent: true, opacity: .85, depthWrite: false });
    for (let k = 0; k < 3; k++) { const sh = new T.Shape(); sh.moveTo(-.9, 0); sh.lineTo(0, -.7); sh.lineTo(.9, 0); sh.lineTo(.9, .35); sh.lineTo(0, -.35); sh.lineTo(-.9, .35); sh.closePath(); const mm = bm.clone(); mm.side = T.DoubleSide; const ar = new T.Mesh(new T.ShapeGeometry(sh), mm); ar.rotation.x = -Math.PI / 2; ar.position.z = (k - 1) * .85; pg.add(ar); }
    const w = W(c.x, c.z); PADS.push({ x: w.x, z: w.z, g: pg, cool: 0 });
  }
  const _pv = new T.Vector3(), EXD = (() => { const e0 = W(0, LANE), e1 = W(1, LANE); return { x: e1.x - e0.x, z: e1.z - e0.z }; })();
  let greeted = false;
  AMB.push((t, dt, pp) => {
    const d = Math.hypot(ARENA.center.x - pp.x, ARENA.center.z - pp.z);
    // landed short? nobody stays in the gap: whoever drops into it is set back on the lane, past the far kicker, going the way they were heading
    if (state.mode === 'explore' && !busy && !(stunt && stunt.air)) {
      const lp = g.worldToLocal(_pv.set(pp.x, 0, pp.z));
      if (lp.x > 12.3 && lp.x < 16.7 && Math.abs(lp.z - LANE) < 3.6) {
        const fwd = Math.sin(player.heading) * EXD.x + Math.cos(player.heading) * EXD.z, tw = W(fwd > 0 ? 25.6 : 3.4, LANE);
        player.g.position.x = tw.x; player.g.position.z = tw.z; player.v = Math.min(player.v, 6); player.vdir = player.heading;
        if (AR.active) arenaCancel('Landed short. Ride the lane again.'); else toast('Back on the lane', 'You landed short of the far kicker. Carry some speed.');
      }
    }
    if (d < 30 && !greeted) { greeted = true; toast('STUNT LANE', 'Take the curve, hit the orange kicker at speed and land it clean.'); }
    if (d > 60) greeted = false;
    arenaStep(dt, pp, t);
    for (const R of ARENA.ramps) {
      R.cool -= dt;
      if (R.trig === false) continue;
      if (R.cool <= 0 && !stunt && state.mode === 'explore' && !busy && player.veh && !player.onFoot && player.v > 4.5 && (pp.x - R.x) * R.dx + (pp.z - R.z) * R.dz > -.4 && (pp.x - R.x) * R.dx + (pp.z - R.z) * R.dz < 1.4 && Math.abs(-(pp.x - R.x) * R.dz + (pp.z - R.z) * R.dx) < R.w / 2 + .3 && Math.sin(player.heading) * R.dx + Math.cos(player.heading) * R.dz > .45) {
        R.cool = 2.2; const vy = clamp(player.v * 1.9 * R.h / R.len * .95, 3.8, 13), kinds = R.big && vy > 8 ? ['flip', 'tabletop', 'superman', 'whip'] : ['tabletop', 'whip', 'superman', 'nohands'];
        startStunt(kinds[Math.floor(Math.random() * kinds.length)], { vy, arena: true }); player.v = Math.max(player.v, player.veh.cfg.max * .95);
      }
    }
  });
}
const RAY = { camp: null, stn: null, npc: null, greeted: false };   // Beedi Rayappan's beach club (set up in the beach block)
/* ------------------------------------------------- beach: the edge of the map is a shore with cafes, boats and fish */
{
  const BY = .07, SAND0 = 44, SHORE = 58.5;   // sand starts 44 m from the road, the waterline is at 58.5 m (riders stop at CORR, on the wet sand)
  let sd2 = 99; const r2 = () => (sd2 = (sd2 * 16807) % 2147483647) / 2147483647;

  // ---- shoreline painted from the distance to the road: grass fringe, dry sand, wet sand, foam, shallows, deep water
  const xs = PATH.map(p => p[0]), zs = PATH.map(p => p[1]), M = 110, PX = 1.5;
  const X0 = Math.min(...xs) - M, X1 = Math.max(...xs) + M, Z0 = Math.min(...zs) - M, Z1 = Math.max(...zs) + M;
  const CW = Math.ceil((X1 - X0) * PX), CH = Math.ceil((Z1 - Z0) * PX);
  const SEG = []; for (let i = 0; i < PATH.length - 1; i++) { const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], dx = bx - ax, dz = bz - az; SEG.push([ax, az, dx, dz, dx * dx + dz * dz]); }
  const distTo = (x, z) => { let best = 1e9; for (const [ax, az, dx, dz, L2] of SEG) { let u = ((x - ax) * dx + (z - az) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u; const ex = x - ax - dx * u, ez = z - az - dz * u, d = ex * ex + ez * ez; if (d < best) best = d; } return Math.sqrt(best); };
  const wob = (x, z) => 1.8 * Math.sin(x * .09 + z * .05) + 1.1 * Math.sin(z * .17 - x * .11) + .6 * Math.sin(x * .31 + z * .27);
  const DN = new Float32Array(CW * CH);
  for (let r = 0; r < CH; r++) for (let c = 0; c < CW; c++) { const x = X0 + (c + .5) / PX, z = Z0 + (r + .5) / PX, d = distTo(x, z); DN[r * CW + c] = d < 38 ? d : d + wob(x, z); }
  const mkCanvas = () => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; };
  const GRASS = [150, 200, 100], SAND = [242, 222, 170], SAND2 = [230, 205, 148], WET = [200, 172, 118], FOAMC = [248, 252, 250], SHAL = [120, 224, 212], MID = [48, 160, 205], DEEP = [22, 95, 160];
  const col = [0, 0, 0], mix = (a, b, t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; col[0] = a[0] + (b[0] - a[0]) * t; col[1] = a[1] + (b[1] - a[1]) * t; col[2] = a[2] + (b[2] - a[2]) * t; };
  const baseC = mkCanvas(), bctx = baseC.getContext('2d'), img = bctx.createImageData(CW, CH), D = img.data;
  for (let i = 0, n = CW * CH; i < n; i++) {
    const dn = DN[i], rr = Math.random(); let a = 255;
    if (dn < SAND0) { D[i * 4 + 3] = 0; continue; }
    if (dn < 48.5) { const t = (dn - SAND0) / 4.5; mix(GRASS, SAND, t); a = clamp(t * 1.3 + (rr - .5) * .6, 0, 1) * 255; }
    else if (dn < 54) { mix(SAND, SAND2, rr * .7); const sp = (rr - .5) * 14; col[0] += sp; col[1] += sp; col[2] += sp; }
    else if (dn < 57.4) { mix(SAND2, WET, (dn - 54) / 3.4); const sp = (rr - .5) * 10; col[0] += sp; col[1] += sp; col[2] += sp; }
    else if (dn < SHORE) mix(WET, FOAMC, (dn - 57.4) / 1.1);
    else {
      const w = dn - SHORE; if (w < 5) mix(SHAL, MID, w / 5); else mix(MID, DEEP, (w - 5) / 40);
      const sh = clamp(1 - w / 2.6, 0, 1) * .55; col[0] += (WET[0] - col[0]) * sh; col[1] += (WET[1] - col[1]) * sh; col[2] += (WET[2] - col[2]) * sh;
      const rip = 1 + .05 * Math.sin(dn * 1.7 + (i % CW) * .09) + (rr - .5) * .06; col[0] *= rip; col[1] *= rip; col[2] *= rip;
      if (rr > .9985) { col[0] = col[1] = col[2] = 255; }
    }
    D[i * 4] = col[0]; D[i * 4 + 1] = col[1]; D[i * 4 + 2] = col[2]; D[i * 4 + 3] = a;
  }
  bctx.putImageData(img, 0, 0);
  const mkTex = c => { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; return t; };
  const PW = X1 - X0, PH = Z1 - Z0, pcx = (X0 + X1) / 2, pcz = (Z0 + Z1) / 2;
  const sheet = (material, y) => { const m = new T.Mesh(new T.PlaneGeometry(PW, PH), material); m.rotation.x = -Math.PI / 2; m.position.set(pcx, y, pcz); m.renderOrder = 2; world.add(m); return m; };
  const beachMat = new T.MeshToonMaterial({ map: mkTex(baseC), gradientMap: toonGrad, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  sheet(beachMat, BY).receiveShadow = true;
  // endless open sea around the painted sheet (same colour as the deep edge)
  { const fm = new T.MeshToonMaterial({ color: new T.Color(0x165fa0), gradientMap: toonGrad, polygonOffset: true, polygonOffsetFactor: -2 }), FR = 1400;
    // the Grootan interior is a separate room far off to the east: leave a hole in the sea around it (its floor used to fight with the water and shimmer)
    const HOLE = { x0: INT.x - 85, x1: INT.x + 85, z0: INT.z - 53, z1: INT.z + 77 };
    const sea = (x0, x1, z0, z1) => { if (x1 - x0 < .01 || z1 - z0 < .01) return; const m = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), fm); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, BY, (z0 + z1) / 2); world.add(m); };
    const seaRect = (x0, x1, z0, z1) => { if (x1 <= HOLE.x0 || x0 >= HOLE.x1 || z1 <= HOLE.z0 || z0 >= HOLE.z1) { sea(x0, x1, z0, z1); return; }
      sea(x0, HOLE.x0, z0, z1); sea(HOLE.x1, x1, z0, z1); const hx0 = Math.max(x0, HOLE.x0), hx1 = Math.min(x1, HOLE.x1); sea(hx0, hx1, z0, HOLE.z0); sea(hx0, hx1, HOLE.z1, z1); };
    seaRect(X0 - FR, X0, pcz - PH / 2 - FR, pcz + PH / 2 + FR); seaRect(X1, X1 + FR, pcz - PH / 2 - FR, pcz + PH / 2 + FR); seaRect(X0, X1, Z0 - FR, Z0); seaRect(X0, X1, Z1, Z1 + FR); }
  // waves lapping the shore: three foam bands that surge in turn
  const foams = [-.2, 1.0, 2.3].map(off => {
    const c = mkCanvas(), cx = c.getContext('2d'), im = cx.createImageData(CW, CH), d = im.data, o = SHORE + off;
    for (let i = 0, n = CW * CH; i < n; i++) {
      const band = 1 - Math.abs(DN[i] - o) / .9; if (band <= 0) continue;
      const x = X0 + ((i % CW) + .5) / PX, z = Z0 + (((i / CW) | 0) + .5) / PX, lace = .55 + .45 * Math.sin(x * 1.1 + Math.sin(z * .6) * 2.2) * Math.sin(z * 1.3 + Math.sin(x * .5) * 1.7);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255 * clamp(band * 1.3, 0, 1) * clamp(lace + (Math.random() - .5) * .5, 0, 1);
    }
    cx.putImageData(im, 0, 0);
    const m = sheet(new T.MeshBasicMaterial({ map: mkTex(c), transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }), BY + .01); m.renderOrder = 3; return m;
  });
  AMB.push(t => foams.forEach((f, k) => { f.material.opacity = .9 * Math.pow(Math.max(0, Math.sin(t * 1.0 - k * 1.15)), 1.3); }));
  // Curved surf lines move across the shoreline in pulses instead of only fading in place.
  const waveCanvas = document.createElement('canvas'); waveCanvas.width = 256; waveCanvas.height = 64;
  { const x = waveCanvas.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.3, 'rgba(255,255,255,.16)'); gr.addColorStop(.52, 'rgba(255,255,255,.9)'); gr.addColorStop(.72, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 90; i++) { const y = 20 + Math.random() * 25; x.globalAlpha = .18 + Math.random() * .45; x.fillStyle = '#fff'; x.fillRect(Math.random() * 256, y, 2 + Math.random() * 22, 1 + Math.random() * 2); } }
  const waveTex = mkTex(waveCanvas), surfWaves = [];
  for (let i = 0; i < SEG.length; i++) {
    const [ax, az, dx, dz, L2] = SEG[i], L = Math.sqrt(L2), nx = -dz / L, nz = dx / L, mx = ax + dx * .5, mz = az + dz * .5;
    for (const side of [-1, 1]) {
      const normal = { x: nx * side, z: nz * side }, y = .085;
      const base = SHORE - wob(mx + normal.x * SHORE, mz + normal.z * SHORE);
      for (let lane = 0; lane < 2; lane++) {
        const mesh = new T.Mesh(new T.PlaneGeometry(L + 1.4, 1.15), new T.MeshBasicMaterial({ map: waveTex, transparent: true, opacity: .58 - lane * .12, depthWrite: false, side: T.DoubleSide }));
        mesh.rotation.set(-Math.PI / 2, Math.atan2(-dz, dx), 0);
        mesh.position.set(mx + normal.x * (base + lane * 1.25), y + lane * .001, mz + normal.z * (base + lane * 1.25));
        mesh.renderOrder = 4; world.add(mesh);
        surfWaves.push({ mesh, mx, mz, normal, base, lane, phase: i * .78 + (side > 0 ? 0 : 1.7) + lane * 1.1 });
      }
    }
  }
  AMB.push(t => surfWaves.forEach(w => {
    const surge = Math.sin(t * 1.15 - w.phase), advance = surge * 1.15;
    w.mesh.position.x = w.mx + w.normal.x * (w.base + w.lane * 1.25 + advance);
    w.mesh.position.z = w.mz + w.normal.z * (w.base + w.lane * 1.25 + advance);
    w.mesh.material.opacity = (.34 + .36 * Math.max(0, surge)) * (w.lane ? .72 : 1);
  }));

  // ---- helpers
  const bm = (p, w, h, d, c, x, y, z) => add(p, new T.BoxGeometry(w, h, d), mat(c), x, y, z, false);
  const cm = (p, rt, rb, h, c, x, y, z, seg = 8) => add(p, new T.CylinderGeometry(rt, rb, h, seg), mat(c), x, y, z, false);
  const sm = (p, r, c, x, y, z) => add(p, new T.SphereGeometry(r, 10, 8), mat(c), x, y, z, false);
  const glow = (p, c, x, y, z, r = .09) => { const m = new T.Mesh(new T.SphereGeometry(r, 8, 6), new T.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); p.add(m); return m; };
  const solid = (g, lx, lz, r) => { g.updateMatrixWorld(true); const w = g.localToWorld(new T.Vector3(lx, 0, lz)); rounds.push({ x: w.x, z: w.z, r }); };
  // a spot on the sand `off` metres from the road, with the direction to the sea; null where scenery or another stretch of road is in the way
  const spot = (s, side, off, loose) => {
    const a = along(s, side * off), n = pathNear(a.x, a.z); if (Math.abs(n.d - off) > (loose ? 3 : 1.2)) return null;
    if (!loose && (rounds.some(r => Math.hypot(r.x - a.x, r.z - a.z) < r.r + 7) || walls.some(w => a.x > w.x0 - 7 && a.x < w.x1 + 7 && a.z > w.z0 - 7 && a.z < w.z1 + 7) || STN.some(st => Math.hypot(st.x - a.x, st.z - a.z) < 12))) return null;
    const ux = (a.x - n.px) / n.d, uz = (a.z - n.pz) / n.d; return { x: a.x, z: a.z, ux, uz, ry: Math.atan2(ux, uz) };
  };
  const at = (sp, y = BY) => { const g = new T.Group(); g.position.set(sp.x, y, sp.z); g.rotation.y = sp.ry; world.add(g); return g; };
  const palms = [];
  const palm = (p, x, z, sc = 1) => {
    const g = new T.Group(); g.position.set(x, 0, z); g.scale.setScalar(sc); p.add(g); const lean = (r2() - .5) * .5; let px = 0;
    for (let k = 0; k < 6; k++) { cm(g, .17 - k * .012, .21 - k * .012, 1.05, k % 2 ? 0x9a7048 : 0x8a6038, px, .52 + k * 1.0, 0, 7); px += lean * .2; }
    const crown = new T.Group(); crown.position.set(px, 6.1, 0); g.add(crown);
    for (let k = 0; k < 8; k++) { const arm = new T.Group(); arm.rotation.y = k * .785; crown.add(arm); const fr = bm(arm, 2.5, .05, .55, k % 2 ? 0x3f9a4c : 0x58b05a, 1.15, 0, 0); fr.rotation.z = -.42; }
    sm(crown, .2, 0x6a4a2a, .15, -.3, .1); sm(crown, .2, 0x6a4a2a, -.12, -.32, -.1);
    palms.push({ crown, ph: r2() * 6 });
  };
  const umbrella = (p, x, z, c) => { cm(p, .035, .035, 2.4, 0xe8e2d2, x, 1.2, z, 5); const cn = add(p, new T.CylinderGeometry(0, 1.5, .55, 10), mat(c), x, 2.5, z, false); cn.scale.set(1, 1, 1); sm(p, .07, 0xe8e2d2, x, 2.8, z); };
  const lounger = (p, x, z, c, ry = 0) => { const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; p.add(g); bm(g, .55, .08, 1.5, 0xf4f0e6, 0, .3, 0); const bk = bm(g, .55, .08, .7, 0xf4f0e6, 0, .55, -.75); bk.rotation.x = -.7; bm(g, .5, .02, 1.3, c, 0, .35, 0); for (const sx of [-.24, .24]) for (const sz of [-.65, .65]) cm(g, .025, .025, .3, 0xb8bcc4, sx, .15, sz, 4); };

  // ---- cafes, huts, lifeguard towers, volleyball, palm groves along both edges of the road
  const NAMES = ['SEA BREEZE CAFE', 'CHAI SHORE', 'FILTER COFFEE & WAVES', 'LIGHTHOUSE BAKERY', 'SALT & SUGAR', 'TIDE & TEA'];
  let nameI = 0;
  const cafe = sp => {
    const g = at(sp), wall = [0xf6e3c0, 0xcfe8e0, 0xf6d0c0, 0xe8e0f0][nameI % 4], roof = [0x3f8f88, 0xd8402a, 0x4a5aa8, 0xe0a030][nameI % 4];
    bm(g, 7, 3.2, 4.4, wall, 0, 1.6, 0); bm(g, 7.5, .3, 4.9, roof, 0, 3.35, 0); bm(g, 7.5, .5, .2, roof, 0, 3.75, 2.4);
    signBoard(g, NAMES[nameI++ % NAMES.length], 5.6, 1.05, 0, 4.4, 2.3, 'espresso . chai . waves');
    bm(g, 3.2, 1.3, .1, 0x2a2420, -1.4, 1.9, 2.23); bm(g, 3.6, .12, .6, 0x8a5a36, -1.4, 1.2, 2.55); bm(g, 1.2, 2.2, .1, 0x5a3a22, 2.4, 1.1, 2.23);
    for (let k = 0; k < 8; k++) { const aw = bm(g, 1, .06, 1.5, k % 2 ? 0xf4f0e6 : 0xd8402a, -3.4 + k * .95 * .78 + .0, 2.75, 2.9); aw.rotation.x = .35; aw.scale.x = .82; }
    bm(g, 8.6, .14, 5.4, 0xb98652, 0, .07, 4.7);
    const tabs = [[-2.7, 5.6], [-.9, 7.3], [1.1, 5.6], [2.9, 7.3]], cols = [0xd8402a, 0x3f8f88, 0xe0a030, 0x4a5aa8];
    tabs.forEach(([x, z], i) => { cm(g, .5, .5, .06, 0xf4f0e6, x, .86, z, 14); cm(g, .05, .05, .8, 0x6c7078, x, .45, z, 5); for (const sx of [-.8, .8]) { cm(g, .24, .24, .08, 0x8a5a36, x + sx, .5, z, 8); cm(g, .04, .04, .45, 0x6c7078, x + sx, .25, z, 4); } umbrella(g, x, z, cols[i]); });
    for (const [x, z] of [[-3.9, 7.4], [3.9, 7.4], [-3.9, 2.4], [3.9, 2.4]]) cm(g, .06, .06, 3, 0x5c4028, x, 1.5, z, 5);
    for (let k = 0; k <= 12; k++) { const u = k / 12; glow(g, 0xfff0b0, -3.9 + u * 7.8, 2.95 - Math.sin(Math.PI * u) * .35, 7.4); }
    const cb = bm(g, .9, 1.2, .08, 0x2a2e2a, 3.3, .6, 3.4); cb.rotation.x = -.15; bm(g, 1, .06, .1, 0xb98652, 3.3, 1.22, 3.4);
    for (const px of [-3.4, 3.4]) { cm(g, .25, .2, .5, 0xb5532b, px, .3, 3.2, 8); sm(g, .35, 0x4f9a52, px, .75, 3.2); }
    const cust = (x, z, shirt, ry) => { const p = person({ shirt, pants: 0x35507a, scale: .85, hair: 'bun', hairColor: 0x2a1713 }); p.g.position.set(x, .42, z); p.g.rotation.y = ry; p.legs[0].rotation.x = p.legs[1].rotation.x = -1.4; g.add(p.g); };
    cust(-.2, 7.3, 0xe0705a, 1.6); cust(1.9, 5.6, 0x6a7fd0, -1.6);
    const bar = person({ shirt: 0xf4f0e6, pants: 0x222a3a, scale: .9, moustache: true }); bar.g.position.set(-1.4, 0, 1.2); bar.g.rotation.y = 0; g.add(bar.g);
    solid(g, -1.8, 0, 2.3); solid(g, 1.8, 0, 2.3);
  };
  const hut = sp => {
    const g = at(sp); bm(g, 3, 2.2, 2.6, 0xf4ead0, 0, 1.1, 0); const rf = add(g, new T.ConeGeometry(2.7, 1.5, 8), mat(0xc9a35a), 0, 2.95, 0, false); rf.rotation.y = .4;
    bm(g, 1.6, 1.0, .1, 0x2a2420, 0, 1.4, 1.33); bm(g, 2, .1, .6, 0x8a5a36, 0, 0.95, 1.6); signBoard(g, 'SURF & ICE CREAM', 2.6, .6, 0, 2.5, 1.45);
    [0xff7a2a, 0x3f8f88, 0xd8402a].forEach((c, i) => { const b = bm(g, .34, 1.9, .06, c, 2.1 + i * .38, 1.0, .2); b.rotation.z = -.12; });
    solid(g, 0, 0, 2.1);
  };
  const lifeguard = sp => {
    const g = at(sp); for (const sx of [-.8, .8]) for (const sz of [-.8, .8]) cm(g, .07, .07, 2.4, 0x8a6a4a, sx, 1.2, sz, 5);
    bm(g, 2.2, .12, 2.2, 0xb98652, 0, 2.4, 0); bm(g, 1.6, 1.1, 1.6, 0xf4f0e6, 0, 3.0, 0); bm(g, 1.9, .14, 1.9, 0xd8402a, 0, 3.65, 0); bm(g, 1.2, .6, .1, 0xbfe3ea, 0, 3.1, .82);
    cm(g, .03, .03, 1.4, 0x8a6a4a, .95, 4.2, .95, 4); bm(g, .6, .35, .03, 0xd8402a, 1.25, 4.7, .95);
    const st = bm(g, .5, .08, 2.2, 0xb98652, 0, 1.1, 1.5); st.rotation.x = .75;
    solid(g, 0, 0, 1.3);
  };
  const volley = sp => {
    const g = at(sp); for (const sx of [-3, 3]) cm(g, .05, .05, 2.4, 0xe8e2d2, sx, 1.2, 0, 5);
    const net = new T.Mesh(new T.PlaneGeometry(6, .9, 14, 3), new T.MeshBasicMaterial({ color: 0xf4f0e6, wireframe: true, side: T.DoubleSide })); net.position.set(0, 1.95, 0); g.add(net);
    sm(g, .2, 0xffffff, 1.2, .2, 2.5); sm(g, .2, 0xd8402a, -2.4, .2, -2.2);
  };
  const umbrellas = sp => {
    const g = at(sp), cs = [0xd8402a, 0x3f8f88, 0xe0a030, 0xe0705a, 0x6a7fd0]; const k0 = Math.floor(r2() * 5);
    umbrella(g, -1.6, 0, cs[k0]); umbrella(g, 1.7, .6, cs[(k0 + 2) % 5]);
    lounger(g, -1.6, 1.4, cs[(k0 + 1) % 5], .1); lounger(g, -.6, 1.5, cs[(k0 + 3) % 5], -.05); lounger(g, 1.7, 2.0, cs[(k0 + 4) % 5], .1);
    bm(g, .9, .02, 1.6, cs[(k0 + 2) % 5], 3.2, .09, 1.2);
    const cs2 = add(g, new T.ConeGeometry(.45, .5, 8), mat(0xe4c88a), 0, .25, 3.4, false); bm(g, .5, .35, .5, 0xe4c88a, .8, .18, 3.5);
    solid(g, -1.6, 0, .35); solid(g, 1.7, .6, .35);
  };
  const grove = sp => { const g = at(sp); palm(g, -2.4, -.6, 1 + r2() * .3); palm(g, 0.6, 1.1, 1 + r2() * .3); palm(g, 3.2, -.4, .9 + r2() * .3); for (const [x, z] of [[-2.4, -.6], [.6, 1.1], [3.2, -.4]]) solid(g, x, z, .5); };
  // ---- Beedi Rayappan's beach boxing club (side quest: catch crabs, first person)
  const rayCamp = sp => {
    const g = at(sp);
    // boxing ring on the sand
    const rg = new T.Group(); rg.position.set(-1.5, 0, 3.6); g.add(rg);
    bm(rg, 5.4, .45, 5.4, 0x8a5a36, 0, .22, 0); bm(rg, 5.0, .06, 5.0, 0x3f6aa8, 0, .48, 0); bm(rg, 1.0, .07, 5.0, 0xf4f0e6, 0, .5, 0); bm(rg, 1.4, .2, .7, 0x6a4a2a, 0, .1, 3.0);
    for (const [px, pz, c] of [[-2.5, -2.5, 0xd8402a], [2.5, -2.5, 0x3a78c8], [-2.5, 2.5, 0x3a78c8], [2.5, 2.5, 0xd8402a]]) { cm(rg, .09, .09, 1.55, 0x3a3e48, px, 1.25, pz, 6); bm(rg, .26, .9, .26, c, px, 1.05, pz); }
    for (const [h, c] of [[.85, 0xf4f0e6], [1.15, 0xd8402a], [1.45, 0xf4f0e6]]) { for (const sz of [-2.5, 2.5]) bm(rg, 5.0, .05, .05, c, 0, h, sz); for (const sx of [-2.5, 2.5]) bm(rg, .05, .05, 5.0, c, sx, h, 0); }
    solid(g, -1.5, 3.6, 3.3);
    // heavy bag frame, speed bag, tyres
    const fr = new T.Group(); fr.position.set(-8.2, 0, 1.2); g.add(fr);
    for (const sx of [-1.5, 1.5]) cm(fr, .09, .09, 3.4, 0x6a4a2a, sx, 1.7, 0, 6); bm(fr, 3.2, .14, .14, 0x6a4a2a, 0, 3.4, 0);
    const bag = new T.Group(); bag.position.set(-.4, 3.4, 0); fr.add(bag); cm(bag, .02, .02, .6, 0x8a8e96, 0, -.3, 0, 4); cm(bag, .32, .32, 1.25, 0xb5322a, 0, -1.2, 0, 12); cm(bag, .33, .33, .12, 0x6a1a14, 0, -.62, 0, 12);
    const spd = new T.Group(); spd.position.set(1.0, 3.4, 0); fr.add(spd); cm(spd, .015, .015, .5, 0x8a8e96, 0, -.25, 0, 4); sm(spd, .16, 0xd8a030, 0, -.62, 0);
    solid(g, -9.7, 1.2, .35); solid(g, -6.7, 1.2, .35);
    for (let k = 0; k < 4; k++) { const ty = new T.Mesh(new T.TorusGeometry(.4, .17, 8, 14), mat(0x24262b)); ty.position.set(-5.4, .2 + (k % 3) * .3, -1.6 + (k > 2 ? .9 : 0)); ty.rotation.x = Math.PI / 2; g.add(ty); }
    // sign, chalkboard, glove rack, crab bucket
    for (const sx of [-1.2, 3.4]) cm(g, .07, .07, 3.0, 0x6a4a2a, sx, 1.5, -2.6, 6);
    signBoard(g, 'RAYAPPAN BOXING CLUB', 4.9, 1.0, 1.1, 3.0, -2.6, 'north madras style');
    { const cc = document.createElement('canvas'); cc.width = 256; cc.height = 192; const x = cc.getContext('2d'); x.fillStyle = '#2a2e2a'; x.fillRect(0, 0, 256, 192); x.strokeStyle = '#b98652'; x.lineWidth = 8; x.strokeRect(4, 4, 248, 184);
      x.fillStyle = '#f4f0e6'; x.textAlign = 'center'; x.font = '700 30px Georgia, serif'; x.fillText('TODAY\'S TRAINING', 128, 52); x.fillStyle = '#ffd36a'; x.font = '800 40px Georgia, serif'; x.fillText('CATCH 3 CRABS', 128, 104); x.fillStyle = '#f4f0e6'; x.font = 'italic 26px Georgia, serif'; x.fillText('in 60 seconds', 128, 146);
      const t = new T.CanvasTexture(cc); t.colorSpace = T.SRGBColorSpace; const cb = new T.Mesh(new T.PlaneGeometry(1.5, 1.12), new T.MeshBasicMaterial({ map: t })); cb.position.set(5.4, 1.15, -1.2); cb.rotation.y = -.25; g.add(cb); for (const dx of [-.5, .5]) cm(g, .04, .04, 1.2, 0x6a4a2a, 5.4 + dx, .6, -1.28, 5); }
    bm(g, 1.6, .08, .12, 0x6a4a2a, 7.2, 1.6, -1.8); for (const [k, c] of [[0, 0xd8202a], [1, 0xd8202a], [2, 0x3a78c8]]) { sm(g, .17, c, 6.7 + k * .5, 1.38, -1.8).scale.set(1, 1.1, 1); }
    cm(g, .3, .24, .5, 0x3a78c8, 4.4, .27, 1.0, 12); for (let k = 0; k < 3; k++) { const dc = mkCrab(.5); dc.position.set(4.4 + (k - 1) * .13, .55, 1.0 + (k % 2) * .08); dc.rotation.y = k * 2; g.add(dc); }
    // Beedi Rayappan himself
    const rp = g.localToWorld(new T.Vector3(3.6, 0, -.6));
    const n = npc('Beedi Rayappan', rp.x, rp.z, { shirt: 0xe8e4d8, pants: 0x2f5fa8, dress: true, skin: 0x8a5c3c, brow: true, hair: 'bald', beard: true, glasses: true, hairColor: 0xe9e6df, scale: 1.02, shoe: 0x3a2a1a }), P = n.p;
    P.g.position.y = BY; P.g.rotation.y = sp.ry + Math.PI; P.body.rotation.x = .14; P.head.position.z = .08;
    const hd = P.head, WH = 0xeeeae2;
    bm(hd, .3, .06, .08, WH, 0, -.085, .27); for (const sg of [-1, 1]) { const w = bm(hd, .12, .045, .07, WH, sg * .14, -.12, .262); w.rotation.z = sg * .5; const br = bm(hd, .13, .035, .05, WH, sg * .1, .085, .275); br.rotation.z = sg * -.15; const tf = sph(hd, .075, WH, sg * .285, .02, 0); tf.scale.set(.6, 1.3, .9); }
    for (const sg of [-1, 1]) { bm(hd, .12, .008, .02, 0x5a3a24, sg * .1, .15, .28); bm(hd, .1, .008, .02, 0x5a3a24, sg * .1, .125, .285); bm(hd, .07, .008, .02, 0x5a3a24, sg * .17, -.02, .27).rotation.z = sg * .6; }
    const bd = add(hd, new T.CylinderGeometry(.013, .013, .15, 6), mat(0x8a6a44), .075, -.125, .36, false); bd.rotation.x = Math.PI / 2;
    const ember = glow(hd, 0xff6a1a, .075, -.125, .44, .02);
    bm(P.body, .62, .1, .32, 0xf4f0e6, 0, 1.64, 0); cm(P.body, .34, .34, .1, 0xf4f0e6, 0, .98, 0, 12);
    { const ap = P.arms[1]; ap.rotation.x = -.1; cm(ap, .028, .034, 1.3, 0x6a4a2a, 0, -1.02, .08, 6); const hk = cm(ap, .03, .03, .22, 0x6a4a2a, 0, -.4, .08, 6); hk.rotation.x = Math.PI / 2; hk.position.set(0, -.36, .0); }
    for (const sg of [-1, 1]) { cm(P.body, .01, .01, .3, 0x6a5a48, sg * .3, .92, .22, 4); sm(P.body, .13, 0xd8202a, sg * .3, .72, .22).scale.set(1, 1.1, .9); }
    const smoke = [0, 1, 2].map(i => { const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xd8d8d8, transparent: true, opacity: 0, depthWrite: false })); world.add(s); return { s, ph: i / 3 }; });
    solid(g, 3.6, -.6, .55);
    // the interaction ring sits a few steps in front of him, towards the road
    const sw = g.localToWorld(new T.Vector3(3.6, 0, -3.1)), rr = ringAt(sw.x, sw.z, 0xff8a2a);
    STN.push({ id: 'rayappan', x: sw.x, z: sw.z, label: 'Talk · Beedi Rayappan (training)', kind: 'side', ...rr });
    RAY.camp = { x: sp.x, z: sp.z, ux: sp.ux, uz: sp.uz, ry: sp.ry }; RAY.g = g; RAY.ring = { x: -1.5, z: 3.6, top: .53 }; RAY.stn = { x: sw.x, z: sw.z }; RAY.npc = n;
    AMB.push((t, dt, pp) => {
      bag.rotation.z = Math.sin(t * 1.3) * .06; bag.rotation.x = Math.sin(t * .9) * .03; spd.rotation.z = Math.sin(t * 9) * .05;
      ember.material.color.setHex(Math.sin(t * 3) > .2 ? 0xff7a2a : 0xc84a14);
      const hp = P.g.localToWorld(new T.Vector3(.075, 1.95 - .125, .5));
      smoke.forEach(m => { const u = (t * .35 + m.ph) % 1; m.s.position.set(hp.x + Math.sin(u * 5 + m.ph * 6) * .12, hp.y + u * 1.1, hp.z + Math.cos(u * 4 + m.ph * 6) * .1); m.s.scale.setScalar(.12 + u * .5); m.s.material.opacity = (1 - u) * .22; });
      if (Math.hypot(RAY.stn.x - pp.x, RAY.stn.z - pp.z) < 34 && !RAY.greeted && state.mode === 'explore') { RAY.greeted = true; toast('RAYAPPAN BOXING CLUB', 'Beedi Rayappan runs a training club on the beach. Walk up and talk to him.'); }
    });
  };
  let campSp = null;
  search: for (const s of [46, 62, 78, 94, 110, 126, 142, 158, 174, 190]) for (const side of [-1, 1]) { const sp = spot(s, side, 50); if (sp) { campSp = sp; rayCamp(sp); break search; } }
  const KINDS = [cafe, grove, umbrellas, hut, grove, lifeguard, umbrellas, volley, grove, cafe, umbrellas, grove, hut, lifeguard];
  const KOFF = new Map([[cafe, 47], [hut, 50], [lifeguard, 52], [volley, 51], [umbrellas, 50.5], [grove, 48.5]]);
  { let ki = 0; for (let s = 16; s < TOTAL - 10; s += 15) for (const side of [1, -1]) { const kind = KINDS[ki++ % KINDS.length], sp = spot(s, side, KOFF.get(kind)); if (sp && !(campSp && Math.hypot(sp.x - campSp.x, sp.z - campSp.z) < 24)) kind(sp); } }
  AMB.push(t => palms.forEach(p => { p.crown.rotation.z = Math.sin(t * (.8 + ENV.cur.wind) + p.ph) * (.05 + .1 * ENV.cur.wind); p.crown.rotation.x = Math.sin(t * .6 + p.ph * 1.3) * (.03 + .05 * ENV.cur.wind); }));

  // ---- boats out on the water
  const boats = [];
  const mkBoat = kind => {
    const g = new T.Group(), hullCol = [0xd8402a, 0x3f8f88, 0xe0a030, 0x4a5aa8, 0xf4f0e6][Math.floor(r2() * 5)];
    const sh = new T.Shape(); sh.moveTo(-2.2, .6); sh.lineTo(-1.9, -.4); sh.lineTo(1.7, -.4); sh.lineTo(2.6, .8); sh.lineTo(-2.2, .6);
    const geo = new T.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false }); geo.translate(0, 0, -.8); const hull = new T.Mesh(geo, mat(hullCol)); g.add(hull); outline(hull, 1.03);
    bm(g, 4.3, .08, 1.5, 0xc9a878, -.25, .62, 0); bm(g, 4.4, .1, 1.68, 0xf4f0e6, -.2, .58, 0).scale.set(1, .5, 1);
    if (kind === 'sail') {
      cm(g, .06, .07, 4.6, 0x8a6a4a, .5, 2.9, 0, 6); const sl = new Shape2(0, 0, 0, 3.8, 2.2, 0); const sail = new T.Mesh(new T.ShapeGeometry(sl), new T.MeshToonMaterial({ color: 0xfaf4e6, gradientMap: toonGrad, side: T.DoubleSide })); sail.position.set(.45, 1.0, 0); g.add(sail);
      const jb = new T.Mesh(new T.ShapeGeometry(new Shape2(0, 0, 0, 3.2, -1.6, 0)), new T.MeshToonMaterial({ color: hullCol === 0xf4f0e6 ? 0xd8402a : hullCol, gradientMap: toonGrad, side: T.DoubleSide })); jb.position.set(.55, 1.2, 0); g.add(jb);
    } else if (kind === 'fish') {
      bm(g, 1.4, 1.0, 1.2, 0xf4f0e6, -.9, 1.15, 0); bm(g, 1.6, .12, 1.4, hullCol, -.9, 1.7, 0); bm(g, .1, .5, .9, 0xbfe3ea, -.18, 1.3, 0);
      cm(g, .05, .06, 2.4, 0x6a5a48, 1.0, 1.9, 0, 6); const bo = bm(g, 1.6, .04, .04, 0x6a5a48, 1.7, 2.9, 0); bo.rotation.z = -.5;
      for (let k = 0; k < 3; k++) bm(g, .5, .3, .5, 0xb98652, 1.2 + k * .0, .85 + .0, -.4 + k * .4);
      glow(g, 0xffd36a, -1.6, 2.0, .5, .12);
    } else {
      bm(g, .1, .04, 1.6, 0x8a6a4a, 0, .75, 0); for (const sz of [-1, 1]) { const oar = bm(g, 1.6, .04, .08, 0x8a6a4a, 0, .8, sz * 1.1); oar.rotation.y = sz * .5; }
    }
    return g;
  };
  // triangle sail helper (a Shape through three points)
  function Shape2(x0, y0, x1, y1, x2, y2) { const s = new T.Shape(); s.moveTo(x0, y0); s.lineTo(x1, y1); s.lineTo(x2, y2); s.closePath(); return s; }
  { const kinds = ['sail', 'fish', 'row', 'sail', 'fish']; let bi = 0;
    for (let s = 24; s < TOTAL - 14; s += 41) for (const side of [1, -1]) { const off = 74 + r2() * 30, sp = spot(s + side * 9, side, off, true); if (!sp) continue;
      const b = mkBoat(kinds[bi++ % kinds.length]), hd = Math.atan2(-sp.ux, -sp.uz) + (r2() < .5 ? 0 : Math.PI); b.position.set(sp.x, BY, sp.z); b.rotation.y = hd; b.scale.setScalar(1.1 + r2() * .4); world.add(b);
      boats.push({ g: b, x: sp.x, z: sp.z, tx: Math.cos(-hd), tz: Math.sin(-hd), ph: r2() * 6 }); }
    // buoys
    for (let s = 30; s < TOTAL - 20; s += 46) for (const side of [1, -1]) { const sp = spot(s, side, 66 + r2() * 4, true); if (!sp) continue; const bu = new T.Group(); bu.position.set(sp.x, BY, sp.z); world.add(bu); cm(bu, .22, .3, .6, 0xd8402a, 0, .1, 0, 8); cm(bu, .23, .23, .16, 0xf4f0e6, 0, .22, 0, 8); sm(bu, .1, 0xfff0b0, 0, .62, 0); boats.push({ g: bu, x: sp.x, z: sp.z, tx: 0, tz: 0, ph: r2() * 6, buoy: true }); } }
  AMB.push((t, dt, pp) => boats.forEach(b => { const near = Math.hypot(b.x - pp.x, b.z - pp.z) < 160; b.g.visible = near; if (!near) return; const k = b.buoy ? 1.6 : 1, drift = b.buoy ? 0 : Math.sin(t * .1 + b.ph) * 3;
    b.g.position.set(b.x + b.tx * drift, BY + Math.sin(t * 1.2 * k + b.ph) * .06 * k, b.z + b.tz * drift); b.g.rotation.z = Math.sin(t * .9 * k + b.ph) * .04 * k; b.g.rotation.x = Math.sin(t * .7 * k + b.ph) * .03 * k; }));

  // ---- fish: shaped, two-tone bodies with fins and a forked tail (kinds: tuna-blue, clownfish, tang, silver)
  const FISH = [{ back: 0x2f6fae, belly: 0xe2ecf2, fin: 0x2a5f9a, eye: 0xffffff }, { back: 0xff7a2a, belly: 0xffb870, fin: 0xff9a4a, eye: 0xffffff, stripes: true }, { back: 0xffd23a, belly: 0xfff2a8, fin: 0xffb000, eye: 0xffffff }, { back: 0x7f9bb0, belly: 0xf4f8fa, fin: 0x6f8aa0, eye: 0xffffff }];
  const FS = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const fishParts = FISH.map(F => {
    const geo = new T.SphereGeometry(1, 16, 12), pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), cb = new T.Color(F.back), cl = new T.Color(F.belly), cw = new T.Color(0xffffff), cc = new T.Color();
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const taper = (1 - .62 * FS(0, 1, -x)) * (1 - .3 * x * x * (x > 0 ? 1 : 0)); pos.setY(i, y * taper); pos.setZ(i, z * taper);
      cc.lerpColors(cb, cl, FS(.15, -.35, y)); if (F.stripes && (Math.abs(x - .32) < .1 || Math.abs(x + .3) < .07)) cc.lerp(cw, .9); cols.set([cc.r, cc.g, cc.b], i * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3)); geo.computeVertexNormals();
    const fs = (...p) => { const s = new T.Shape(); s.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) s.lineTo(p[i], p[i + 1]); s.closePath(); return new T.ShapeGeometry(s); };
    return { geo, bodyMat: new T.MeshToonMaterial({ vertexColors: true, gradientMap: toonGrad }), finMat: new T.MeshToonMaterial({ color: F.fin, gradientMap: toonGrad, side: T.DoubleSide, transparent: true, opacity: .92 }),
      tail: fs(0, 0, -.2, .2, -.13, 0, -.2, -.2), dorsal: fs(.18, 0, -.02, .2, -.26, 0), pect: fs(0, 0, -.14, .02, -.02, -.1), eyeMat: new T.MeshBasicMaterial({ color: F.eye }) };
  });
  const pupilMat = new T.MeshBasicMaterial({ color: 0x15100d }), eyeGeo = new T.SphereGeometry(.035, 8, 6), pupGeo = new T.SphereGeometry(.018, 6, 5);
  const mkFish = kind => {
    const P0 = fishParts[kind % 4], g = new T.Group(), body = new T.Mesh(P0.geo, P0.bodyMat); body.scale.set(.42, .15, .11); g.add(body);
    const tail = new T.Group(); tail.position.set(-.38, 0, 0); g.add(tail); tail.add(new T.Mesh(P0.tail, P0.finMat));
    const dor = new T.Mesh(P0.dorsal, P0.finMat); dor.position.set(0, .12, 0); g.add(dor);
    for (const s of [-1, 1]) { const pf = new T.Mesh(P0.pect, P0.finMat); pf.position.set(.1, -.03, s * .1); pf.rotation.y = s * .9; g.add(pf); const e = new T.Mesh(eyeGeo, P0.eyeMat); e.position.set(.28, .04, s * .085); g.add(e); const pu = new T.Mesh(pupGeo, pupilMat); pu.position.set(.298, .042, s * .1); g.add(pu); }
    g.userData.tail = tail; return g;
  };
  const schools = [];
  const stayOffshore = (x, z) => {
    const n = pathNear(x, z), minD = SHORE + 13;
    if (n.d >= minD) return { x, z };
    const d = Math.max(n.d, .001), k = minD / d;
    return { x: n.px + (x - n.px) * k, z: n.pz + (z - n.pz) * k };
  };
  for (let s = 20; s < TOTAL - 10; s += 52) for (const side of [1, -1]) { const sp = spot(s + (side > 0 ? 0 : 20), side, 72 + r2() * 2, true); if (!sp) continue;
    const fishes = []; const n = 6; for (let i = 0; i < n; i++) { const f = mkFish(i + schools.length); f.visible = false; f.scale.setScalar(1.2 + r2() * .5); world.add(f); fishes.push({ f, ph: i * .55 + r2() * .3, rr: .65 + r2() * .45 }); }
    const rip = new T.Mesh(new T.RingGeometry(.4, .55, 20), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .0, depthWrite: false, side: T.DoubleSide })); rip.rotation.x = -Math.PI / 2; rip.visible = false; world.add(rip);
    schools.push({ x: sp.x, z: sp.z, r: 2.5 + r2() * 1.5, w: (r2() < .5 ? -1 : 1) * (.45 + r2() * .25), fishes, rip, ph: r2() * 6 }); }
  // leaping fish: one hops near each few schools
  const jumpers = schools.filter((_, i) => i % 2 === 0).map(s => ({ s, f: mkFish(3), next: 2 + r2() * 8, u: -1, ang: r2() * 6.28, sp: r2() * 6 }));
  jumpers.forEach(j => { j.f.visible = false; j.f.scale.setScalar(2.2); world.add(j.f); j.ring = new T.Mesh(new T.RingGeometry(.2, .32, 20), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide })); j.ring.rotation.x = -Math.PI / 2; world.add(j.ring); });
  // ---- dolphins leaping far out at sea
  const dolBody = (() => {
    const pr = [[0, 1.45], [.05, 1.36], [.085, 1.2], [.1, 1.08], [.17, .95], [.27, .72], [.33, .3], [.34, -.05], [.3, -.5], [.22, -.9], [.13, -1.22], [.08, -1.45], [.05, -1.62], [0, -1.7]];
    const geo = new T.LatheGeometry(pr.map(([r, y]) => new T.Vector2(r, y)), 18); geo.rotateZ(-Math.PI / 2); const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), cb = new T.Color(0x56728c), cl = new T.Color(0xe6eef2), cc = new T.Color();
    for (let i = 0; i < pos.count; i++) { pos.setZ(i, pos.getZ(i) * .85); cc.lerpColors(cb, cl, FS(.12, -.16, pos.getY(i))); cols.set([cc.r, cc.g, cc.b], i * 3); }
    geo.setAttribute('color', new T.BufferAttribute(cols, 3)); geo.computeVertexNormals(); return geo;
  })();
  const dolFin = (...p) => { const s = new T.Shape(); s.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) s.quadraticCurveTo(p[i], p[i + 1], p[i + 2], p[i + 3]), i += 2; s.closePath(); return new T.ShapeGeometry(s); };
  const dolMat = new T.MeshToonMaterial({ vertexColors: true, gradientMap: toonGrad }), dolFinMat = new T.MeshToonMaterial({ color: 0x4a6680, gradientMap: toonGrad, side: T.DoubleSide });
  const dorsalG = dolFin(.25, 0, .02, .1, -.18, .5, -.55, 0, -.55, 0), flipG = dolFin(0, 0, -.1, -.2, -.4, -.5, -.3, -.04, -.3, -.04), flukeG = (() => { const s = new T.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(-.2, .2, -.6, .55); s.quadraticCurveTo(-.55, .15, -.42, 0); s.quadraticCurveTo(-.55, -.15, -.6, -.55); s.quadraticCurveTo(-.2, -.2, 0, 0); return new T.ShapeGeometry(s); })();
  const mkDolphin = () => {
    const g = new T.Group(), b = new T.Mesh(dolBody, dolMat); b.castShadow = false; g.add(b);
    const d = new T.Mesh(dorsalG, dolFinMat); d.position.set(-.1, .3, 0); g.add(d);
    for (const s of [-1, 1]) { const f = new T.Mesh(flipG, dolFinMat); f.position.set(.55, -.15, s * .26); f.rotation.set(s * .9, s * -.4, 0); g.add(f); const e = new T.Mesh(pupGeo, pupilMat); e.scale.setScalar(1.7); e.position.set(.98, .1, s * .12); g.add(e); }
    const tail = new T.Group(); tail.position.set(-1.45, 0, 0); g.add(tail); const fl = new T.Mesh(flukeG, dolFinMat); fl.rotation.x = -Math.PI / 2; tail.add(fl);
    g.userData.tail = tail; return g;
  };
  const pods = [], drops = [];
  for (let k = 0; k < 40; k++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); sp.visible = false; world.add(sp); drops.push({ sp, life: 0, vx: 0, vy: 0, vz: 0 }); }
  const splash = (x, z, n = 8) => { let c = 0; for (const D of drops) { if (D.life > 0) continue; D.life = .9; D.sp.position.set(x, BY + .1, z); D.vx = (Math.random() - .5) * 4; D.vy = 3 + Math.random() * 3; D.vz = (Math.random() - .5) * 4; D.sp.visible = true; D.sp.scale.setScalar(.35 + Math.random() * .3); if (++c >= n) break; } };
  for (let s = 30; s < TOTAL - 10; s += 60) for (const side of [1, -1]) { const sh = spot(s + (side > 0 ? 0 : 30), side, 57, true); if (!sh) continue; const dd = 40 + r2() * 26, sp = { x: sh.x + sh.ux * dd, z: sh.z + sh.uz * dd }; if (pathNear(sp.x, sp.z).d < 90) continue;
    const dols = [0, 1, 2].map(i => { const g = mkDolphin(); g.scale.setScalar(1.9 - i * .22); g.visible = false; world.add(g); return { g, delay: i * .28 + r2() * .1, u: -1, ring: null }; });
    const rings = [0, 1, 2, 3].map(() => { const m = new T.Mesh(new T.RingGeometry(.3, .5, 24), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = BY + .02; world.add(m); return { m, t: 1 }; });
    pods.push({ x: sp.x, z: sp.z, ang: r2() * 6.28, next: 2 + r2() * 9, t: -1, dols, rings, ri: 0 }); }
  RAY.pods = pods; RAY.schools = schools;
  AMB.push((t, dt, pp) => {
    for (const D of drops) { if (D.life <= 0) continue; D.life -= dt; D.vy -= 9 * dt; D.sp.position.x += D.vx * dt; D.sp.position.y += D.vy * dt; D.sp.position.z += D.vz * dt; D.sp.material.opacity = Math.max(0, D.life / .9) * .8; if (D.life <= 0 || D.sp.position.y < BY) { D.life = 0; D.sp.visible = false; } }
    for (const P of pods) {
      for (const R of P.rings) if (R.t < 1) { R.t += dt / 1.1; R.m.scale.setScalar(1 + R.t * 6); R.m.material.opacity = (1 - R.t) * .7; }
      if (Math.hypot(P.x - pp.x, P.z - pp.z) > 230) { P.dols.forEach(d => { d.g.visible = false; d.u = -1; }); P.t = -1; continue; }
      P.next -= dt;
      if (P.t < 0 && P.next <= 0) { P.t = 0; P.ang = Math.random() * 6.28; P.dols.forEach(d => { d.u = -1; d.fired = false; d.landed = false; }); }
      if (P.t >= 0) {
        P.t += dt; const L = 10, H = 3.4, DUR = 1.7; let any = false;
        P.dols.forEach((d, i) => { const u = (P.t - d.delay) / DUR; if (u < 0) { any = true; return; } if (u >= 1) { d.g.visible = false; if (!d.landed) { d.landed = true; } return; } any = true;
          const ox = Math.cos(P.ang + 1.57) * (i - 1) * 3.2, oz = Math.sin(P.ang + 1.57) * (i - 1) * 3.2, x = P.x + ox + Math.cos(P.ang) * (u - .5) * L, z = P.z + oz + Math.sin(P.ang) * (u - .5) * L, y = BY - .5 + (4 * u * (1 - u)) * (H + .5) - .0;
          const slope = 4 * (1 - 2 * u) * (H + .5) / L; d.g.visible = y > BY - .45; d.g.position.set(x, y, z); d.g.rotation.set(0, -P.ang, Math.atan(slope) + .0); d.g.userData.tail.rotation.z = Math.sin(t * 16 + i) * .35;
          if (!d.fired && u > .02) { d.fired = true; const R = P.rings[P.ri++ % 4]; R.m.position.set(x, BY + .02, z); R.t = 0; splash(x, z, 7); }
          if (u > .94 && !d.landed) { d.landed = true; const R = P.rings[P.ri++ % 4]; R.m.position.set(x, BY + .02, z); R.t = 0; splash(x, z, 9); } });
        if (!any) { P.t = -1; P.next = 6 + Math.random() * 9; }
      }
    }
  });
  AMB.push((t, dt, pp) => {
    for (const S of schools) {
      const near = Math.hypot(S.x - pp.x, S.z - pp.z) < 90; S.fishes.forEach(o => o.f.visible = near); S.rip.visible = near; if (!near) continue;
      S.fishes.forEach((o, i) => { const a = t * S.w + o.ph * (S.w > 0 ? 1 : -1), rr = S.r * o.rr, vx = -Math.sin(a) * S.w, vz = Math.cos(a) * .7 * S.w, p = stayOffshore(S.x + Math.cos(a) * rr, S.z + Math.sin(a) * rr * .7);
        o.f.position.set(p.x, BY + .03 + Math.sin(t * 3 + i) * .015, p.z); o.f.rotation.y = -Math.atan2(vz, vx); o.f.rotation.z = Math.sin(t * 5 + i) * .08; o.f.userData.tail.rotation.y = Math.sin(t * 14 + i * 2) * .6; });
      const pr = (t * .7 + S.ph) % 1; S.rip.position.set(S.x + Math.cos(t * S.w) * S.r * .9, BY + .02, S.z + Math.sin(t * S.w) * S.r * .6); S.rip.scale.setScalar(1 + pr * 3); S.rip.material.opacity = (1 - pr) * .45;
    }
    for (const J of jumpers) {
      const near = Math.hypot(J.s.x - pp.x, J.s.z - pp.z) < 90; if (!near) { J.f.visible = false; continue; }
      J.next -= dt; if (J.u < 0 && J.next <= 0) { J.u = 0; J.ang = Math.random() * 6.28; J.sp = 3 + Math.random() * 3; const base = stayOffshore(J.s.x + (Math.random() - .5) * 8, J.s.z + (Math.random() - .5) * 6); J.bx = base.x; J.bz = base.z; J.ring.position.set(J.bx, BY + .02, J.bz); J.rt = 0; }
      if (J.u >= 0) { J.u += dt / .95; const u = J.u, rawX = J.bx + Math.cos(J.ang) * J.sp * u, rawZ = J.bz + Math.sin(J.ang) * J.sp * u, p = stayOffshore(rawX, rawZ), x = p.x, z = p.z, h = 4.4 * u * (1 - u) * 1.1;
        J.f.visible = u < 1; J.f.position.set(x, BY + h, z); J.f.rotation.y = -J.ang; J.f.rotation.z = (1 - 2 * u) * 1.1; J.f.userData.tail.rotation.y = Math.sin(t * 30) * .7;
        if (u >= 1) { J.u = -1; J.next = 4 + Math.random() * 8; J.ring.position.set(x, BY + .02, z); J.rt = 0; J.f.visible = false; } }
      if (J.rt !== undefined && J.rt < 1) { J.rt += dt / .9; J.ring.scale.setScalar(1 + J.rt * 5); J.ring.material.opacity = Math.max(0, 1 - J.rt) * .8; } else J.ring.material.opacity = 0;
    }
  });
}
/* ------------------------------------------------- ground paint: dirt road, office forecourt and stunt lane share one soft-edged decal */
{
  const PX = 5, X0 = Math.min(...PATH.map(p => p[0])) - 8, X1 = Math.max(...PATH.map(p => p[0])) + 8, Z0 = Math.min(...PATH.map(p => p[1])) - 8, Z1 = Math.max(...PATH.map(p => p[1])) + 8;
  const CW = Math.ceil((X1 - X0) * PX), CH = Math.ceil((Z1 - Z0) * PX);
  const sst = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const SEG = []; for (let i = 0; i < PATH.length - 1; i++) { const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); SEG.push([ax, az, dx, dz, L * L, L]); }
  // stunt lane centre line (world), with the distance walked along it so the paving can fade into dirt at both ends
  const LN = ARENA.lane, LS = []; let LT = 0;
  if (LN) for (let i = 0; i < LN.pts.length - 1; i++) { const [ax, az] = LN.pts[i], [bx, bz] = LN.pts[i + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 1e-4) continue; LS.push([ax, az, dx, dz, L * L, L, LT]); LT += L; }
  const lx0 = LN ? Math.min(...LN.pts.map(p => p[0])) - LN.w : 0, lx1 = LN ? Math.max(...LN.pts.map(p => p[0])) + LN.w : 0, lz0 = LN ? Math.min(...LN.pts.map(p => p[1])) - LN.w : 0, lz1 = LN ? Math.max(...LN.pts.map(p => p[1])) + LN.w : 0;
  const PL = { cx: OFFICE.x, cz: OFFICE.z + 4.2, hx: (OFFICE.w + 10) / 2, hz: (OFFICE.d + 17) / 2, r: 2.6 };
  const c = document.createElement('canvas'); c.width = CW; c.height = CH; const cx = c.getContext('2d'), img = cx.createImageData(CW, CH), D = img.data;
  const DIRT = [228, 198, 146], PAVE = [203, 206, 213], CONC = [152, 154, 160];
  for (let r = 0; r < CH; r++) for (let q = 0; q < CW; q++) {
    const x = X0 + (q + .5) / PX, z = Z0 + (r + .5) / PX, n = Math.random(); let pr = 0, pg = 0, pb = 0, A = 0;
    const over = (R, G, B, a) => { if (a <= 0) return; pr = R * a + pr * (1 - a); pg = G * a + pg * (1 - a); pb = B * a + pb * (1 - a); A = a + A * (1 - a); };
    // dirt road
    let best = 1e9, lat = 0; for (const [ax, az, dx, dz, L2, L] of SEG) { const u = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), ex = x - ax - dx * u, ez = z - az - dz * u, d2 = ex * ex + ez * ez; if (d2 < best) { best = d2; lat = (dx * ez - dz * ex) / L; } }
    const d = Math.sqrt(best), edge = 2.3 + .25 * Math.sin(x * .9 + z * .7) + .2 * Math.sin(z * 1.7 - x * .5);
    if (d < edge + .6) {
      let a = 1 - sst(edge - .5, edge + .45, d); a *= clamp(1 - n * clamp((d - (edge - .9)) / .9, 0, 1) * .75, 0, 1);
      const sp = (n - .5) * 26, trk = clamp(1 - Math.abs(Math.abs(lat) - .85) / .3, 0, 1) * .1, ed = clamp((d - (edge - 1.1)) / 1.1, 0, 1) * .5, k = 1 - trk;
      over((DIRT[0] + sp) * k * (1 - ed) + 150 * ed, (DIRT[1] + sp) * k * (1 - ed) + 150 * ed, (DIRT[2] + sp) * k * (1 - ed) + 92 * ed, a);
    }
    // office forecourt: paving with a curb, feathered into the dirt and the grass
    { const qx = Math.abs(x - PL.cx) - (PL.hx - PL.r), qz = Math.abs(z - PL.cz) - (PL.hz - PL.r), sdf = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - PL.r;
      if (sdf < .4) { const a = sst(0, 1.6, -sdf - (n - .5) * .5);
        if (a > 0) { const gx = (x - PL.cx + PL.hx) % 2.6, gz = (z - PL.cz + PL.hz) % 2.6, line = (gx < .07 || gz < .07) ? 1 : 0, sp = (n - .5) * 10, curb = clamp(1 - Math.abs(-sdf - .45) / .22, 0, 1), t = line * .35 + curb * .5;
          over((PAVE[0] + sp) * (1 - t) + 146 * t, (PAVE[1] + sp) * (1 - t) + 152 * t, (PAVE[2] + sp) * (1 - t) + 164 * t, a); } } }
    // stunt lane: dusty concrete that fades into the road's dirt at both ends, with white edge lines
    if (LS.length && x > lx0 && x < lx1 && z > lz0 && z < lz1) {
      let lb = 1e9, ls = 0; for (const [ax, az, dx, dz, L2, L, s0] of LS) { const u = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), ex = x - ax - dx * u, ez = z - az - dz * u, d2 = ex * ex + ez * ez; if (d2 < lb) { lb = d2; ls = s0 + u * L; } }
      const ld = Math.sqrt(lb), half = LN.w / 2;
      if (ld < half + .3) {
        let a = 1 - sst(half - .45, half + .15, ld); a *= clamp(1 - n * clamp((ld - (half - .6)) / .6, 0, 1) * .7, 0, 1);
        const we = sst(0, 11, Math.min(ls, LT - ls)), sp = (n - .5) * 22, patch = Math.sin(x * .7 + z * .4) * Math.sin(z * .9 - x * .3) * 8, cc = [CONC[0] + sp + patch, CONC[1] + sp + patch, CONC[2] + sp + patch], dd = [DIRT[0] + sp, DIRT[1] + sp, DIRT[2] + sp], m = (1 - we) * .9;
        let R = cc[0] * (1 - m) + dd[0] * m, G = cc[1] * (1 - m) + dd[1] * m, B = cc[2] * (1 - m) + dd[2] * m;
        const ln = clamp(1 - Math.abs(ld - (half - .55)) / .09, 0, 1) * .9 * we; R = R * (1 - ln) + 244 * ln; G = G * (1 - ln) + 240 * ln; B = B * (1 - ln) + 230 * ln;
        over(R, G, B, a);
      }
    }
    const i = (r * CW + q) * 4; if (A > 0) { D[i] = pr / A; D[i + 1] = pg / A; D[i + 2] = pb / A; D[i + 3] = A * 255; }
  }
  cx.putImageData(img, 0, 0);
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
  const m = new T.Mesh(new T.PlaneGeometry(X1 - X0, Z1 - Z0), new T.MeshToonMaterial({ map: tex, gradientMap: toonGrad, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.rotation.x = -Math.PI / 2; m.position.set((X0 + X1) / 2, .045, (Z0 + Z1) / 2); m.receiveShadow = true; m.renderOrder = 1; world.add(m);
}
// birds and butterflies live at fixed places in the world (they do not follow the camera)
{
  const mkBird = () => { const b = new T.Group(); for (const sx of [-1, 1]) { const w = new T.Mesh(new T.BoxGeometry(.6, .03, .22), mat(0x3b2a22)); w.position.x = sx * .3; b.add(w); } b.visible = false; scene.add(b); return b; };
  const mkFly = k => { const f = new T.Group(); for (const sx of [-1, 1]) { const w = new T.Mesh(new T.PlaneGeometry(.22, .16), new T.MeshBasicMaterial({ color: [0xffd36a, 0xf2a3c0, 0xffffff, 0x9be8ff][k % 4], side: T.DoubleSide })); w.position.x = sx * .11; f.add(w); } f.visible = false; scene.add(f); return f; };
  const flocks = [], patches = [];
  for (let s2 = 30; s2 < TOTAL - 30; s2 += 62) { const q = along(s2, (rnd() - .5) * 30); flocks.push({ x: q.x, z: q.z, ph: rnd() * 6, r: 14 + rnd() * 8, birds: [0, 1, 2, 3, 4].map(mkBird) }); }
  for (let s2 = 12; s2 < TOTAL - 20; s2 += 26) { const q = along(s2, (rnd() - .5) * 26); if (nearStation(q.x, q.z, 5)) continue; patches.push({ x: q.x, z: q.z, ph: rnd() * 6, flies: [0, 1, 2, 3].map(mkFly) }); }
  AMB.push((t, dt, pp) => {
    for (const F of flocks) {
      const near = Math.hypot(F.x - pp.x, F.z - pp.z) < 70;
      F.birds.forEach((b, k) => { b.visible = near; if (!near) return; const a = t * .16 + F.ph + k * .12, r = F.r - (k % 3); b.position.set(F.x + Math.cos(a) * r, 18 + Math.sin(t * .5 + k) * .7, F.z + Math.sin(a) * r); b.rotation.y = -a; const fl = Math.sin(t * 9 + k) * .5; b.children[0].rotation.z = fl; b.children[1].rotation.z = -fl; });
    }
    for (const P of patches) {
      const near = Math.hypot(P.x - pp.x, P.z - pp.z) < 45;
      P.flies.forEach((f, k) => { f.visible = near; if (!near) return; const a = t * (.35 + k * .08) + P.ph + k * 1.7, r = 1.5 + k * .7; f.position.set(P.x + Math.cos(a) * r + Math.sin(t * 1.3 + k) * .5, .8 + Math.sin(t * 2 + k * 2 + P.ph) * .45, P.z + Math.sin(a * 1.2) * r); f.rotation.y = -a; const fl = Math.sin(t * 18 + k) * .9; f.children[0].rotation.y = fl; f.children[1].rotation.y = -fl; });
    }
  });
}

/* --------------------------------------------------------- dialogue */
let dlg = null;
function say(lines) {
  return new Promise(resolve => {
    const q = lines.map(l => typeof l === 'string' ? { who: '', text: l } : { ...l });
    dlg = { q, i: 0, pos: 0, full: false, result: 0, resolve, waitingChoice: false };
    state.mode = 'dialog'; $('dlg').hidden = false;
    showLine();
  });
}
function showLine() {
  const l = dlg.q[dlg.i];
  $('dlgName').textContent = l.who || ''; $('dlgName').style.display = l.who ? '' : 'none';
  $('dlgText').textContent = ''; $('dlgChoices').innerHTML = ''; $('dlgHint').hidden = true;
  dlg.pos = 0; dlg.full = false; dlg.waitingChoice = false;
}
function finishText() {
  const l = dlg.q[dlg.i]; dlg.full = true; $('dlgText').textContent = l.text;
  if (l.choices && !l.picked) {
    dlg.waitingChoice = true;
    l.choices.forEach((c, k) => { const b = document.createElement('button'); b.textContent = `${k + 1}. ${c.label}`; b.onclick = e => { e.stopPropagation(); pick(k); }; $('dlgChoices').appendChild(b); });
  } else $('dlgHint').hidden = false;
}
function pick(k) {
  if (!dlg || !dlg.waitingChoice || !(dlg.q[dlg.i].choices || [])[k]) return;
  const l = dlg.q[dlg.i]; l.picked = true; dlg.result = k; dlg.waitingChoice = false;
  beep(660, .08, 'triangle'); $('dlgChoices').innerHTML = '';
  if (l.choices[k].reply) dlg.q.splice(dlg.i + 1, 0, ...l.choices[k].reply);
  advance(true);
}
function advance(force) {
  if (!dlg) return;
  if (!dlg.full && !force) { finishText(); return; }
  if (dlg.waitingChoice) return;
  beep(440, .04);
  dlg.i++;
  if (dlg.i >= dlg.q.length) { const r = dlg.result, res = dlg.resolve; dlg = null; $('dlg').hidden = true; state.mode = 'explore'; res(r); }
  else showLine();
}

function showCard(emoji, title, text, age) {
  return new Promise(resolve => {
    $('cardEmoji').textContent = emoji; $('cardTitle').textContent = title; $('cardText').textContent = text; $('cardAge').textContent = age;
    $('card').hidden = false; state.mode = 'card'; chime();
    const done = () => { $('card').removeEventListener('click', done); removeEventListener('keydown', onKey); $('card').hidden = true; state.mode = 'explore'; resolve(); };
    const onKey = e => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Escape') done(); };
    setTimeout(() => { $('card').addEventListener('click', done); addEventListener('keydown', onKey); }, 700);
  });
}

/* ------------------------------------------------------------ portfolio */
const FOLIO = {
  exp: { icon: '🏢', title: 'Experience', sub: 'Grootan Technologies · Chennai', photo: true, blocks: [
    { h: 'Software Engineer Level 1', meta: 'May 2024 – Present', items: [
      'Engineered secure authentication systems for 3 major banking clients in Europe with 1M+ users.',
      'Led development of authentication flows for IBM, implementing 20+ authenticators and 10+ authentication flows, including QR and notification-based flows.',
      'Migrated an enterprise application from Java 11 to Java 17, addressing deprecated APIs, module compatibility and build pipeline updates.',
      'Took part in architectural planning meetings, contributing to 4 major security design decisions.'] },
    { h: 'Junior Software Engineer (Intern)', meta: 'Jun 2023 – May 2024', items: ['Part of the Keycloak version migration team (19 to 23) for the product, ensuring zero downtime.'] }] },
  ibm: { icon: '🔐', title: 'IBM PKV', sub: 'Insurance Provider · Accessible authentication', blocks: [{ h: 'ARIA for accessible authentication', items: [
    'Designed and implemented secure key management with Hardware Security Modules (HSMs) to protect cryptographic keys from extraction or misuse.',
    'Added ARIA accessibility support to IBM authentication experiences for assistive technology users.',
    'Wrote data validation and cleanup scripts for production and pre-production environments.',
    'Implemented notification triggers based on authentication events, user actions and insurance workflow status.',
    'Integrated external video identification (Video-Ident) providers for secure remote identity verification.'] }] },
  ibb: { icon: '🕌', title: 'IBB · Istanbul Senin', sub: 'Istanbul city app', blocks: [{ items: [
    'Worked closely with product, QA and DevOps teams to deliver secure and scalable features.',
    'Debugged and resolved production issues across authentication, database queries and user access.',
    'Owned features end to end, from requirement understanding to deployment and post-release support.'] }] },
  city: { icon: '🏰', title: 'CityApp · Nibelungenstadt Worms', sub: 'Municipal services · Consent management', blocks: [{ h: 'Consent management with on-demand authenticator', items: [
    'Designed and implemented a centralized consent management system to capture, store and validate user consents, in line with GDPR and municipal data protection policies.',
    'Used an on-demand authenticator to support consent-related authentication flows.',
    'Integrated Keycloak with backend services using OAuth 2.0 / OpenID Connect for secure token-based communication.'] }] },
  skills: { icon: '🧰', title: 'The Tool Shed', sub: 'Technical skills', blocks: [], chips: [
    ['Languages', ['Java', 'JPA', 'JDBC', 'JavaScript']], ['Frameworks', ['Spring Boot', 'ReactJS']], ['Database', ['PostgreSQL', 'MySQL']], ['Testing & quality', ['JUnit', 'Unit testing', 'Integration testing', 'Code coverage', 'SonarQube']], ['Observability & events', ['OpenTelemetry', 'Event-driven systems']], ['Tools', ['Git', 'Docker', 'Keycloak']]] },
  ach: { icon: '🏆', title: 'Hall of Fame', sub: 'Achievements', blocks: [{ h: 'BIT Hackathon · Finalist', items: ['Finalist in a highly competitive hackathon conducted by BIT, for innovative problem-solving.'] }] },
  edu: { icon: '🎓', title: 'Bannari Amman Institute of Technology', sub: 'Sathyamangalam, India', blocks: [{ h: 'Bachelor of Engineering · Information Science and Engineering', meta: '2020 – 2024', items: ['CGPA: 8.3'] }] },
  contact: { icon: '✉️', title: 'Say hello', sub: 'Jeeva S U · Software Engineer', blocks: [], contact: [['📞', '+91 75388 81377', 'tel:+917538881377'], ['✉️', 'jeev102003@gmail.com', 'mailto:jeev102003@gmail.com']] },
  portfolio: { icon: '👋', title: 'Jeeva S U', sub: 'Software Engineer · Chennai, India', description: 'I build secure authentication systems and backend services. My work spans enterprise identity, authentication flows, Java, Spring Boot and Keycloak.', blocks: [
    { h: 'What I bring', items: ['End-to-end delivery, from understanding requirements through deployment and production support.', 'A security-first approach to identity, authentication and user access.', 'Experience working with product, QA and DevOps teams.'] }] },
  projects: { icon: '🧩', title: 'Selected Projects', sub: 'Authentication · Identity · Citizen services', blocks: [
    { h: 'IBM PKV · Accessible authentication', items: ['Added ARIA accessibility support to IBM authentication experiences.', 'Implemented secure key management using Hardware Security Modules, notification triggers and external video-identification integrations.'] },
    { h: 'Istanbul Senin · City app', items: ['Delivered secure, scalable features and resolved authentication and access issues.', 'Worked across the feature lifecycle, from requirements to deployment and support.'] },
    { h: 'CityApp · Worms municipal services', items: ['Built centralized consent management with an on-demand authenticator, aligned with GDPR and municipal data-protection requirements.', 'Integrated Keycloak with backend services through OAuth 2.0 and OpenID Connect.'] }] },
  keerthi: { icon: '☕', title: 'Keerthi', sub: 'Software engineer · Chai and strength training', description: 'Keerthi is 23 and enjoys a strong cup of chai and time at the gym. Explore his portfolio and selected work.', links: [
    ['Open Keerthi’s portfolio', 'https://keerthivibisan.com/'], ['About · sample link', 'https://keerthivibisan.com/#about'], ['Projects · sample link', 'https://keerthivibisan.com/#projects'], ['Contact · sample link', 'https://keerthivibisan.com/#contact'] ] },
  dhanush: { icon: '💻', title: 'Dhanush', sub: 'Software engineer · Strong coffee, small commits', description: 'Dhanush keeps the coffee strong and the commits small. Visit his portfolio for a preview of his work and projects.', links: [
    ['Open Dhanush’s portfolio', 'https://dhanushkarthik.com/'], ['About · sample link', 'https://dhanushkarthik.com/#about'], ['Projects · sample link', 'https://dhanushkarthik.com/#projects'], ['Contact · sample link', 'https://dhanushkarthik.com/#contact'] ] },
  bharath: { icon: '🧑🏾‍💻', title: 'Bharath', sub: 'Software engineer · Short in height, tall in deploys', description: 'Bharath brings a sense of humor to the team and likes getting software deployed. His portfolio details and sample links can be added here.', portfolioPending: true },
};
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function openFolio(id) {
  const d = FOLIO[id]; if (!d) return;
  let h = `<div class="fhead">${d.photo ? '<img class="mePhoto" src="assets/me.jpg" alt="" onerror="this.remove()">' : ''}<div class="ficon">${d.icon}</div><div><h2>${esc(d.title)}</h2><p>${esc(d.sub)}</p></div></div>`;
  if (d.description) h += `<div class="fblock"><p>${esc(d.description)}</p></div>`;
  for (const b of d.blocks || []) h += `<div class="fblock">${b.h ? `<h3>${esc(b.h)}</h3>` : ''}${b.meta ? `<small>${esc(b.meta)}</small>` : ''}<ul>${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
  if (d.chips) h += d.chips.map(([k, v]) => `<div class="fblock"><h3>${k}</h3><div class="chips">${v.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>`).join('');
  if (d.links) h += `<div class="fblock"><h3>Portfolio links</h3>${d.links.map(([label, url], i) => `<a class="clink" href="${url}" target="_blank" rel="noopener noreferrer">${i ? '↗' : '🌐'} ${esc(label)}</a>`).join('')}</div>`;
  if (d.portfolioPending) h += '<div class="fblock"><h3>Portfolio links</h3><p>Coming soon</p><ul><li>About · sample link</li><li>Projects · sample link</li><li>Contact · sample link</li></ul></div>';
  if (d.contact) h += '<div class="fblock">' + d.contact.map(([e, t, u]) => `<a class="clink" href="${u}">${e} ${esc(t)}</a>`).join('') + '</div>';
  $('folioBody').innerHTML = h; $('folio').hidden = false; $('folioBody').scrollTop = 0; state.mode = 'folio'; chime();
  if (!save.visited.includes(id)) { save.visited.push(id); save.xp += 40; persist(); refreshHud(); }
}
function closeFolio() { if (state.mode !== 'folio') return; $('folio').hidden = true; state.mode = 'explore'; beep(440, .05); if (typeof afterFolio === 'function') afterFolio(); }
$('folioClose').onclick = closeFolio;
$('folio').addEventListener('pointerdown', e => { if (e.target === $('folio')) closeFolio(); });


/* ================================================================ ACTS, HUD, GAMEPLAY */
const ACTS = [
  { name: 'Cricket', emoji: '🏏', title: 'The Gully', hint: 'Find Ravi at the cricket pitch and bat six balls.', need: ['ravi'] },
  { name: 'Chess', emoji: '♟️', title: 'Thatha\'s Board', hint: 'Thatha is playing chess under the banyan tree. Pull up a chair.', need: ['thatha'] },
  { name: 'College', emoji: '🎓', title: 'B.I.T.', hint: 'Visit the campus gate and the Hackathon Hall of Fame.', need: ['edu', 'ach'], folio: true },
  { name: 'Work', emoji: '💼', title: 'The Working Street', hint: 'Park outside Grootan Technologies, walk in and present the projects.', need: ['exp', 'ibm', 'ibb', 'city', 'skills'], folio: true },
  { name: 'AI', emoji: '✨', title: 'The Big Picture', hint: 'A tower of light stands at the end of the road. Walk up to it.', need: ['ai'] },
];
const CARDS = [
  ['🏏', 'Last Ball, Last Over', 'Evenings ran on one rule: the game ends when someone\'s mother calls from the balcony. First lesson: timing is everything.', 'Chapter 1'],
  ['♟️', 'Thatha\'s Gambit', 'A chipped board and a grandfather who taught me to think two moves ahead. Patience became a habit.', 'Chapter 2'],
  ['🎓', 'B.I.T., 2020 – 2024', 'B.E. in Information Science and Engineering, CGPA 8.3, and a BIT Hackathon finalist for innovative problem-solving.', 'Chapter 3'],
  ['💼', 'Grootan Technologies', 'Intern in June 2023, Software Engineer Level 1 since May 2024: secure authentication for banks in Europe, IBM, and a city in Germany.', 'Chapter 4'],
];
const curAct = () => { for (let i = 0; i < ACTS.length; i++) if (!save.done.includes(i)) return i; return ACTS.length; };
const stationDone = s => s.kind === 'term' ? (save.terms || []).includes(s.id) : s.kind === 'folio' ? save.visited.includes(s.id) : save.done.includes(s.act);
const $q = id => document.getElementById(id);
let toastT = 0;
function toast(head, text) { $('toast').innerHTML = `<b>${head}</b>${text}`; $('toast').hidden = false; toastT = 4.5; beep(900, .2, 'sine', .05); }
function refreshHud() {
  const c = curAct(), a = ACTS[c];
  $('qChapter').textContent = a ? `Chapter ${c + 1} of ${ACTS.length}` : 'The road goes on';
  $('qTitle').textContent = a ? a.title : 'Challenge accepted';
  const left = a ? a.need.filter(id => !save.visited.includes(id) && !save.done.includes(c)).length : .07;
  $('qText').textContent = a ? a.hint + (a.folio ? `  (${a.need.length - left}/${a.need.length})` : '') : 'Roam freely, or open the portfolio town.';
}
function afterFolio() {
  if (busy) return;
  ACTS.forEach((a, i) => { if (a.folio && !save.done.includes(i) && !busy && a.need.every(id => save.visited.includes(id))) completeAct(i); });
  refreshHud();
}
let busy = false;
async function completeAct(i) {
  if (busy || save.done.includes(i)) return; busy = true;
  save.done.push(i); persist(); refreshHud(); chime();
  if (i < 4) {
    const nc = curAct(); applyLook(nc); refreshHud();
    await wait(300);
    await showCard(...CARDS[i]);
    if (ACTS[nc]) toast('Chapter done', 'Explore anywhere. ' + ACTS[nc].title + ' is still waiting.');
  }
  busy = false;
}

/* ---- games (reused) */
async function playCricket() {
  state.mode = 'cricket'; $('hud').hidden = true;
  const res = await window.runCricket({ T, scene, camera, player, bowler: ravi.p, fielders, cx: PITCH.cx, cz: PITCH.cz, R: PITCH.R, stumps: stumpMeshes, beep, chime, keys, joy, setTicker: f => { ticker = f; }, hideVehicle, target: 12 });
  state.mode = 'explore'; $('hud').hidden = false;
  const p = player.g.position; camera.position.set(p.x, 12.5, p.z + 15);
  return res;
}
async function cricketLoop() {
  let won = false, played = false;
  while (true) {
    const r = await playCricket();
    if (r.quit) { await say([A('Ravi', 'Leaving already? The wicket will wait for you.')]); break; }
    played = true; if (r.won) won = true;
    const pick = await say([{ who: 'Ravi', text: r.won ? `${r.runs} runs! Cracking shots. Fancy another over?` : `${r.runs} runs. So close! Another over?`, choices: [
      { label: 'Another over', reply: [A('Ravi', 'Bowling!')] },
      { label: 'That is enough', reply: [A('Ravi', r.won ? 'Go on, the road is waiting.' : 'Fine, fine. The road is waiting.')] }] }]);
    if (pick === 1) break;
  }
  return { won, played };
}
async function playChess() {
  state.mode = 'chess'; $('hud').hidden = true; ChessGame.resize(innerWidth, innerHeight);
  const res = await ChessGame.play();
  state.mode = 'explore'; $('hud').hidden = false;
  return res;
}
const runStory = {
  async ravi() {
    busy = true;
    await say([A('Ravi', 'Six balls, one over. Beat 12 runs or the Gandhi Street gang will never let us forget it.'), A('Ravi', 'You bat, I bowl. Press SPACE just as the ball reaches your bat. Perfect timing is a six! Hold A or D to aim. Press Esc any time to walk off.')]);
    const out = await cricketLoop();
    busy = false; if (out.won || out.played) await completeAct(0);
  },
  async thatha() {
    busy = true;
    await say([A('Thatha', 'Sit. Today we play a real game.'), A('Thatha', 'You have White, the cream pieces. Click a piece, then a green square. To castle, click your king and then the square two steps toward your rook. Offer a draw if you dare, but I only accept when I am not winning. Use Hint if you are stuck. I will go easy on you. A little.')]);
    const res = await playChess();
    if (res === 'win') await say([A('Thatha', 'Hm. Hm! Well played. Do not tell your grandmother I lost.')]);
    else if (res === 'draw') await say([A('Thatha', 'A draw. That is how you know a worthy opponent.')]);
    else await say([A('Thatha', 'The back rank, always the back rank. Next time, hmm? Go on, your road is waiting.')]);
    busy = false; await completeAct(1);
  },
  async ai() {
    busy = true;
    const seen = (save.terms || []).length;
    await say([
      NAR('The road ends at a tower of light. Words drift around it like fireflies: CLAUDE CODE. CODEX. ASTRA. AUTOMATION. CHANGES.'),
      NAR('Not long ago, building software meant typing every line yourself. Now agents read the codebase, plan, write, test and open the pull request while you watch.'),
      ...(seen < AGENTS.length ? [NAR(`You looked into ${seen} of the ${AGENTS.length} agent desks on the way in. The rest are still humming behind you.`)] : [NAR('You opened every desk on the way in. The terminal, the parallel tasks, the night-shift agents, the pipeline. The tower noticed.')]),
      { who: '', text: 'So where does that leave the engineer?', choices: [
        { label: 'Replaced?', reply: [NAR('No. Typing gets cheaper. Knowing what to build, and what must never break, gets more valuable.')] },
        { label: 'Promoted.', reply: [NAR('Exactly. From writing every line to directing the work: framing the problem, reviewing every diff, owning the security.')] }] },
      NAR('Banks still need keys that never leak. A city still needs an app that does not go down at 2 a.m. The tools changed. The responsibility did not.'),
      { who: '', text: 'Every road so far began with something I did not know how to do. A bat. A chessboard. A classroom. A production incident. This is the next one.', choices: [
        { label: 'Challenge accepted.', reply: [NAR('Then walk into the light.')] }] },
    ]);
    await finale();
  },
};
function on(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
let boostT = 0;
// ---- drift: skid marks and dust; random stunts on the bike
const SKIDS = [], DUST = [], _w = new T.Vector3();
{ const g = new T.PlaneGeometry(.22, .5); for (let i = 0; i < 160; i++) { const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0x3b2a22, transparent: true, opacity: 0, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); SKIDS.push({ m, t: 9 }); }
  for (let i = 0; i < 40; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xd9bd8a, transparent: true, opacity: 0, depthWrite: false })); s.visible = false; scene.add(s); DUST.push({ s, t: 9, life: 1 }); } }
let skidI = 0, dustI = 0, skidAcc = 0, stunt = null, stuntCool = 4, stuntCount = 0;
const STUNTS = { wheelie: ['Wheelie!', 1.8], nohands: ['No hands!', 1.5], tabletop: ['Tabletop!', 1], whip: ['Whip!', 1], superman: ['Superman!', 1], flip: ['BACKFLIP!', 1] };
const AIR_TYPES = ['tabletop', 'whip', 'superman', 'nohands', 'flip'], GRAV = 20; let camShake = 0;
const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
function startStunt(type, opt = {}) {
  if (type === 'jump') type = 'tabletop';
  stunt = { type, t: 0, air: !!opt.vy, arena: !!opt.arena, dur: STUNTS[type][1] }; stuntCool = 5 + Math.random() * 5; stuntCount++;
  if (stunt.air) { stunt.vy = opt.vy; stunt.y0 = player.g.position.y; stunt.T = Math.max(.4, (stunt.vy + Math.sqrt(stunt.vy * stunt.vy + 2 * GRAV * Math.max(0, stunt.y0 - .23))) / GRAV); stunt.dur = stunt.T; }
  const el = $('stuntTxt'); el.textContent = STUNTS[type][0]; el.hidden = false; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); beep(660, .1, 'triangle', .04); setTimeout(() => beep(990, .12, 'triangle', .04), 90);
}
// photo moment at the top of an arena jump: shutter sound, flash, and the captured frame as a polaroid
let snapReq = null, snapTimer = 0;
function snapSound() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const click = (at, vol, hp) => {
      const n = Math.floor(ac.sampleRate * .07), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain(); s.buffer = b; f.type = 'highpass'; f.frequency.value = hp; gn.gain.value = vol; s.connect(f); f.connect(gn); gn.connect(ac.destination); s.start(ac.currentTime + at);
    };
    click(0, .7, 1500); click(.075, .5, 900); beep(2400, .03, 'square', .03); setTimeout(() => beep(160, .05, 'square', .05), 70);
  } catch (e) { }
}
function snapShot(label) {
  snapSound(); snapReq = label;
  const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
}
function snapGrab() {
  const label = snapReq; snapReq = null; let url = '';
  try { url = renderer.domElement.toDataURL('image/jpeg', .85); } catch (e) { }
  if (!url) return;
  $('snapImg').src = url; $('snapCap').textContent = label.replace(/!$/, '') + ' · caught mid-air';
  const el = $('snap'); el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(snapTimer); snapTimer = setTimeout(() => { el.hidden = true; }, 1100);
}
function landStunt() {
  const p = player.g.position, s = stunt, slip = Math.abs(player.slip || 0), clean = slip < .5; stunt = null;
  player.body.rotation.x = 0; player.body.rotation.z = 0; $('stuntTxt').hidden = true; camShake = clean ? .35 : .8; poof(p.x, p.z, 0xd9bd8a);
  for (let k = 0; k < 3; k++) { const D = DUST[dustI++ % DUST.length]; D.s.position.set(p.x + (Math.random() - .5), .3, p.z + (Math.random() - .5)); D.t = 0; D.life = .6; D.s.visible = true; }
  beep(clean ? 180 : 110, .12, 'square', .04);
  if (!clean) player.v *= .55;
  if (s && s.arena) { if (clean) { ARENA.cheerT = 2; ARENA.combo++; ARENA.score += 100 * ARENA.combo + 50; arenaTrick(); if (ARENA.combo % 3 === 0) toast('Arena combo x' + ARENA.combo, 'Score ' + ARENA.score); } else { ARENA.combo = 0; toast('Sketchy landing', 'No points. Land straight to score.'); } }
}
function driftFx(dt, len, dh) {
  const V = player.veh, p = player.g.position, isMoto = V.type === 'moto' && !player.onFoot, slip = player.slip || 0;
  // skid marks + dust while sliding
  if (isMoto && Math.abs(slip) > .26 && player.v > 4 && !stunt) {
    skidAcc += dt; while (skidAcc > .025) { skidAcc -= .025;
      _w.set(0, .02, -.86 * player.g.scale.x); _w.applyAxisAngle(new T.Vector3(0, 1, 0), player.heading); _w.add(p);
      const S = SKIDS[skidI++ % SKIDS.length]; S.m.position.set(_w.x, .085, _w.z); S.m.rotation.z = -player.vdir; S.t = 0; S.m.visible = true;
      if (Math.random() < .5) { const D = DUST[dustI++ % DUST.length]; D.s.position.set(_w.x, .3, _w.z); D.t = 0; D.life = .7 + Math.random() * .5; D.s.visible = true; } }
    if (Math.abs(slip) > .35 && Math.random() < dt * 3) beep(140 + Math.random() * 40, .08, 'sawtooth', .015);
  }
  for (const S of SKIDS) { if (!S.m.visible) continue; S.t += dt; S.m.material.opacity = .42 * Math.max(0, 1 - S.t / 5); if (S.t > 5) S.m.visible = false; }
  for (const D of DUST) { if (!D.s.visible) continue; D.t += dt; const k = D.t / D.life; D.s.position.y += dt * .5; D.s.scale.setScalar(.4 + k * 1.6); D.s.material.opacity = .5 * (1 - k); if (k >= 1) D.s.visible = false; }
  // stunts
  stuntCool -= dt;
  if (isMoto && !stunt && state.mode === 'explore' && !busy && stuntCool <= 0 && player.v > V.cfg.max * .65 && Math.abs(slip) < .12 && Math.random() < dt * .35) startStunt(Math.random() < .6 ? 'wheelie' : 'nohands');
  player.g.rotation.order = 'YXZ'; let pitch = 0, roll = 0, yaw = 0;
  const rh = state.mode === 'explore' || state.mode === 'cut' ? rampH(p) : 0; let yy = .07 + rh;
  if (isMoto && !stunt && rh > .17) { const f = .8, h2 = rampH({ x: p.x + Math.sin(player.heading) * f, z: p.z + Math.cos(player.heading) * f }); pitch = -Math.atan((h2 - rh) / f); }
  if (stunt) {
    stunt.t += dt; const k = Math.min(1, stunt.t / stunt.dur), env = sstep(0, .2, k) * sstep(1, .8, k), bell = Math.sin(Math.PI * k);
    if (stunt.air) {
      const vyT = stunt.vy - GRAV * stunt.t, Y = stunt.y0 + stunt.vy * stunt.t - .5 * GRAV * stunt.t * stunt.t;
      if (stunt.arena && !stunt.snapped && stunt.t >= stunt.T * .5) { stunt.snapped = true; snapShot(STUNTS[stunt.type][0]); }
      pitch = clamp(-Math.atan2(vyT, Math.max(3, player.v + 2)), -.55, .5) * (1 - env * .6);
      if (stunt.type === 'tabletop') { roll = -1.4 * env; player.body.rotation.z = -.25 * env; pitch -= .12 * env; }
      else if (stunt.type === 'whip') { roll = -.7 * env; yaw = .85 * Math.sin(Math.PI * k) * sstep(0, .3, k); player.body.rotation.z = -.2 * env; }
      else if (stunt.type === 'superman') { const s = env; player.legs[0].rotation.x = player.legs[1].rotation.x = -1.15 + 2.3 * s; player.body.rotation.x = -.45 * s; player.arms[0].rotation.x = player.arms[1].rotation.x = -1 - .9 * s; pitch -= .1 * env; }
      else if (stunt.type === 'nohands') { player.arms[0].rotation.x = player.arms[1].rotation.x = -1 - 1.9 * Math.min(1, env * 1.6); roll = Math.sin(stunt.t * 7) * .12 * env; }
      else if (stunt.type === 'flip') { pitch = -Math.PI * 2 * sstep(.08, .92, k); player.arms[0].rotation.x = player.arms[1].rotation.x = -.6; }
      if (stunt.t > .1 && Y <= yy && vyT < 0) { landStunt(); } else if (stunt.t > stunt.T + 1.4) { landStunt(); } else yy = Math.max(Y, yy);
    } else {
      if (stunt.type === 'wheelie') { pitch = -.5 * Math.min(1, bell * 1.6); yy += .86 * Math.sin(-pitch) * player.g.scale.x; }
      else if (stunt.type === 'nohands') { player.arms[0].rotation.x = player.arms[1].rotation.x = -1 - 1.9 * Math.min(1, bell * 2); }
      if (k >= 1) { stunt = null; $('stuntTxt').hidden = true; }
    }
  }
  if (isMoto || player.g.rotation.x) { player.g.rotation.x = stunt && stunt.type === 'flip' ? pitch : lerp(player.g.rotation.x, pitch, Math.min(1, dt * 14)); player.g.position.y = yy; V.d.g.rotation.z += roll; V.d.g.rotation.y = lerp(V.d.g.rotation.y || 0, yaw, Math.min(1, dt * 12)); }
}
function lifeStep(t, dt) {
  const pp = player.g.position;
  if (document.body.classList.contains('inOffice') !== !!player.inside) document.body.classList.toggle('inOffice', !!player.inside);
  for (const f of AMB) f(t, dt, pp);
  if (boostT > 0) boostT -= dt;
  if (state.mode !== 'explore') return;
  for (const P of PADS) { P.cool -= dt; if (P.cool <= 0 && Math.hypot(P.x - pp.x, P.z - pp.z) < 2.1) { P.cool = 2; boostT = 1.6; player.v = Math.max(player.v, player.veh.cfg.max * 1.5); beep(520, .08, 'triangle', .05); setTimeout(() => beep(880, .12, 'triangle', .05), 70); poof(pp.x, pp.z, 0xffc24a); } }
  save.orbs = save.orbs || [];
  for (const O of ORBS) { if (O.got) continue; if (Math.hypot(O.x - pp.x, O.z - pp.z) < 1.9) { O.got = true; O.g.visible = false; if (!save.orbs.includes(O.i)) save.orbs.push(O.i); persist(); poof(O.x, O.z, 0xffe9a8); chime(); toast(`Memory ${save.orbs.length} of ${ORBS.length}`, MEMS[O.i]); } }
}
// ---- realistic map: bake a top-down render of the world once
const MAPB = { X0: -85, X1: 112, Z0: -400, Z1: 105, k: 3.5, img: null };
function bakeMap() {
  try {
    const W = Math.round((MAPB.X1 - MAPB.X0) * MAPB.k), H = Math.round((MAPB.Z1 - MAPB.Z0) * MAPB.k);
    const cx = (MAPB.X0 + MAPB.X1) / 2, cz = (MAPB.Z0 + MAPB.Z1) / 2, hw = (MAPB.X1 - MAPB.X0) / 2, hh = (MAPB.Z1 - MAPB.Z0) / 2;
    const cam = new T.OrthographicCamera(-hw, hw, hh, -hh, 1, 400); cam.position.set(cx, 220, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.updateProjectionMatrix();
    const rt = new T.WebGLRenderTarget(W, H); rt.texture.colorSpace = T.SRGBColorSpace;
    const hidden = []; scene.traverse(o => { if ((o.isSprite || o.isLine || o.isPoints) && o.visible) { o.visible = false; hidden.push(o); } });
    for (const o of [far, player.g, ...ORBS.map(O => O.g)]) if (o.visible) { o.visible = false; hidden.push(o); }
    const fn = scene.fog.near, ff = scene.fog.far; scene.fog.near = 1e4; scene.fog.far = 2e4;
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
    scene.fog.near = fn; scene.fog.far = ff; hidden.forEach(o => o.visible = true);
    const px = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, px); rt.dispose();
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), id = x.createImageData(W, H);
    for (let y = 0; y < H; y++) id.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    x.putImageData(id, 0, 0);
    // a soft painted finish
    x.globalCompositeOperation = 'multiply'; x.fillStyle = '#f3e6c8'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
    MAPB.img = c;
  } catch (e) { MAPB.img = null; }
}
let printT = -1, resumeGuide = false, away = null;
// ---- exhaust smoke
const SMOKE = [], smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.5, 'rgba(235,235,235,.45)'); g.addColorStop(1, 'rgba(235,235,235,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c); })();
for (let i = 0; i < 48; i++) { const s = new T.Sprite(new T.SpriteMaterial({ map: smokeTex, color: 0xb4afa6, transparent: true, opacity: 0, depthWrite: false })); s.visible = false; scene.add(s); SMOKE.push({ s, t: 9, life: 1 }); }
let smokeAcc = 0, smokeI = 0; const _ex = new T.Vector3();
function smokeStep(dt) {
  const V = player.veh;
  if (V && V.type === 'moto' && V.d.exhaust && player.g.visible !== false && (state.mode === 'explore' || state.mode === 'cut')) {
    const r = player.v / V.cfg.max; smokeAcc += dt * (3 + r * 22);
    while (smokeAcc >= 1) { smokeAcc -= 1; const P = SMOKE[smokeI++ % SMOKE.length]; _ex.copy(V.d.exhaust); V.d.g.localToWorld(_ex); P.s.position.copy(_ex); P.t = 0; P.life = .9 + Math.random() * .6; P.vx = (Math.random() - .5) * .4 - Math.sin(player.heading) * player.v * .15; P.vz = (Math.random() - .5) * .4 - Math.cos(player.heading) * player.v * .15; P.s.visible = true; }
  }
  for (const P of SMOKE) { if (P.t >= P.life) { if (P.s.visible) P.s.visible = false; continue; } P.t += dt; const k = P.t / P.life; P.s.position.x += P.vx * dt; P.s.position.z += P.vz * dt; P.s.position.y += dt * .7; P.s.scale.setScalar(.25 + k * 1.1); P.s.material.opacity = .55 * (1 - k); }
}
// ---- map
const MAPN = { ravi: 'Cricket · Ravi', thatha: 'Chess · Thatha', edu: 'B.I.T.', ach: 'Hackathon Hall', office: 'Grootan Office', printer: 'Resume printer', portfolio: 'Jeeva · Portfolio', claude: 'Claude Code', codex: 'Codex', astra: 'Astra', auto: 'Automation', ai: 'The AI tower', rayappan: 'Beedi Rayappan · crab training' };
let mapBig = false, mapAcc = 0;
function drawMap(cv, big) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, pp = player.g.position;
  // big map: road runs left to right (u = -z, v = x). minimap: north-up around the player (u = x, v = z).
  const U = big ? (wx, wz) => -wz : (wx, wz) => wx, Vv = big ? (wx, wz) => wx : (wx, wz) => wz;
  let u0, u1, v0, v1;
  if (big) { u0 = -105; u1 = 380; v0 = -82; v1 = 108; } else { const R = 55; u0 = pp.x - R; u1 = pp.x + R; v0 = pp.z - R; v1 = pp.z + R; }
  const sc = Math.min(W / (u1 - u0), H / (v1 - v0)), ou = (W - (u1 - u0) * sc) / 2, ov = (H - (v1 - v0) * sc) / 2;
  const X = (wx, wz) => ou + (U(wx, wz) - u0) * sc, Y = (wx, wz) => ov + (Vv(wx, wz) - v0) * sc;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.fillStyle = '#7fae5c'; x.fillRect(0, 0, W, H);
  x.lineCap = x.lineJoin = 'round';
  if (MAPB.img) {
    const k = MAPB.k, X0 = MAPB.X0, Z0 = MAPB.Z0, e = X(X0, Z0), f = Y(X0, Z0);
    x.save(); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.setTransform(X(X0 + 1 / k, Z0) - e, Y(X0 + 1 / k, Z0) - f, X(X0, Z0 + 1 / k) - e, Y(X0, Z0 + 1 / k) - f, e, f); x.drawImage(MAPB.img, 0, 0); x.restore();
  } else {
    x.beginPath(); PATH.forEach(([a, b], i) => i ? x.lineTo(X(a, b), Y(a, b)) : x.moveTo(X(a, b), Y(a, b)));
    x.strokeStyle = '#7a5a3a66'; x.lineWidth = Math.max(5, 6 * sc); x.stroke(); x.strokeStyle = '#e8c88f'; x.lineWidth = Math.max(3, 4.4 * sc); x.stroke();
  }
  { const gr = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .7); gr.addColorStop(0, '#0000'); gr.addColorStop(1, '#3b2a2255'); x.fillStyle = gr; x.fillRect(0, 0, W, H); }
  if (big) for (const O of ORBS) if (!O.got) { x.fillStyle = '#ffe9a8'; x.strokeStyle = '#8a6a2a'; x.lineWidth = 1; x.beginPath(); const ox = X(O.x, O.z), oy = Y(O.x, O.z); x.moveTo(ox, oy - 4); x.lineTo(ox + 3, oy); x.lineTo(ox, oy + 4); x.lineTo(ox - 3, oy); x.closePath(); x.fill(); x.stroke(); }
  const cur = curAct(), a = ACTS[cur];
  for (const s of STN) {
    const done = stationDone(s), want = a && a.need.includes(s.id) && !done;
    const col = s.kind === 'hologram' ? '#35caff' : s.kind === 'side' ? '#ff8a2a' : s.kind === 'term' ? '#8f7cff' : s.kind === 'print' ? '#2fb8a0' : s.kind === 'folio' ? '#e8a33d' : '#d8402a';
    const sx = X(s.x, s.z), sy = Y(s.x, s.z), r = big ? 5.5 : 3.5;
    x.fillStyle = done ? '#ffffffaa' : col; x.strokeStyle = '#3b2a22'; x.lineWidth = 1.5; x.beginPath(); x.arc(sx, sy, want ? r + 2 : r, 0, 7); x.fill(); x.stroke();
    if (want) { x.strokeStyle = '#ffffff'; x.lineWidth = 2; x.beginPath(); x.arc(sx, sy, r + 5 + Math.sin(performance.now() / 200) * 1.5, 0, 7); x.stroke(); }
    if (big && MAPN[s.id]) {
      x.font = '600 13px system-ui, sans-serif'; x.fillStyle = '#2b1d16';
      const n = pathNear(s.x, s.z), nx = X(n.px, n.pz), ny = Y(n.px, n.pz), dx = sx - nx, dy = sy - ny;
      if (s.kind === 'term') { const first = s.z > -303; x.textAlign = first ? 'right' : 'left'; x.fillText(MAPN[s.id], sx + (first ? -9 : 9), sy + (dy < 0 ? -9 : 15)); }
      else if (s.id === 'ai') { x.textAlign = 'left'; x.fillText(MAPN[s.id], X(0, -334) + 12, sy + 4); }
      else if (Math.abs(dx) > Math.abs(dy)) { x.textAlign = dx < 0 ? 'right' : 'left'; x.fillText(MAPN[s.id], sx + (dx < 0 ? -10 : 10), sy + 4); }
      else { x.textAlign = 'center'; x.fillText(MAPN[s.id], sx, sy + (dy < 0 ? -11 : 20)); }
    }
  }
  for (const [P, nm, col, ch] of [[ARENA.center, 'Stunt Arena', '#ff7a2a', '\u2605']]) {
    if (!P) continue; const sx = X(P.x, P.z), sy = Y(P.x, P.z), r = big ? 8 : 5;
    x.fillStyle = col; x.strokeStyle = '#ffffff'; x.lineWidth = 2; x.beginPath(); x.arc(sx, sy, r, 0, 7); x.fill(); x.stroke();
    x.fillStyle = '#ffffff'; x.font = '700 ' + (big ? 11 : 8) + 'px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText(ch, sx, sy + (big ? 4 : 3));
    if (big) { x.fillStyle = '#2b1d16'; x.font = '600 13px system-ui, sans-serif'; x.textAlign = nm === 'Iron Gym' ? 'left' : 'center'; x.fillText(nm, nm === 'Iron Gym' ? sx + 12 : sx, nm === 'Iron Gym' ? sy + 4 : sy + 40); }
  }
  const h = player.heading, px = X(pp.x, pp.z), pz = Y(pp.x, pp.z), L = big ? 12 : 9;
  const fx_ = Math.sin(h), fz_ = Math.cos(h), du = big ? -fz_ : fx_, dv = big ? fx_ : fz_;
  x.save(); x.translate(px, pz); x.rotate(Math.atan2(du, -dv)); x.fillStyle = '#ffffff'; x.strokeStyle = '#d8402a'; x.lineWidth = 2.5;
  x.beginPath(); x.moveTo(0, -L); x.lineTo(L * .65, L * .7); x.lineTo(0, L * .35); x.lineTo(-L * .65, L * .7); x.closePath(); x.fill(); x.stroke(); x.restore();
  if (!big) { x.strokeStyle = '#3b2a22'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, W - 3, H - 3); }
}
function toggleMap(on) {
  mapBig = on === undefined ? !mapBig : on; $('mapBig').hidden = !mapBig;
  if (mapBig) { state.mode = 'map'; drawMap($('mapBigCv'), true); } else if (state.mode === 'map') state.mode = 'explore';
}
const SESS = {
  claude: { title: 'claude — ~/consent-auth', lines: [
    ['cmd', '$ claude'], ['dim', '✻ Claude Code · ready in ~/consent-auth'],
    ['cmd', '> add key rotation to the HSM service and cover it with tests'],
    ['out', '● Reading src/hsm/client.ts, src/keys/store.ts …'],
    ['out', '● Plan: 1. rotate on schedule  2. keep the old key for a grace period  3. tests'],
    ['del', '- // TODO: key rotation'],
    ['add', '+ export async function rotateKey(id: string) {'],
    ['add', '+   const next = await hsm.generate(id);'],
    ['add', '+   await store.promote(next, { graceMs: DAY });'],
    ['add', '+ }'],
    ['out', '● Running the test suite …'], ['ok', '✓ 42 passed · 0 failed'],
    ['note', 'It writes the first draft. I still read every diff, because the keys are mine to protect.']] },
  codex: { title: 'codex — task board', lines: [
    ['cmd', '$ codex'], ['dim', 'running 3 tasks in parallel'],
    ['out', '[1] fix the flaky login test ........ done'],
    ['out', '[2] move config to env variables .... done'],
    ['out', '[3] write docs for the consent API .. done'],
    ['ok', '✓ 3 pull requests ready for review'],
    ['cmd', '> open PR #3'], ['add', '+ docs/consent-api.md   (+214 lines)'],
    ['note', 'Many hands, working at once. One reviewer who knows what “done” means.']] },
  astra: { title: 'astra — agent desk', lines: [
    ['cmd', '$ astra status'], ['dim', 'night shift · watching builds, logs and the support queue'],
    ['out', '02:14  spike in 401s on /token'],
    ['out', '02:15  traced to an expired client certificate'],
    ['out', '02:16  drafted a fix and a rollback plan · paged a human'],
    ['ok', '✓ human approved · incident closed in 9 minutes'],
    ['note', 'Agents can keep watch all night. A human still holds the keys.']] },
  auto: { title: 'pipeline — main', lines: [
    ['cmd', '$ git push origin main'],
    ['out', '→ lint ................ ok'], ['out', '→ unit tests .......... ok'],
    ['out', '→ security scan ....... ok'], ['out', '→ build ............... ok'],
    ['out', '→ deploy .............. ok'], ['ok', '✓ live in 41 seconds'],
    ['note', 'The boring parts run themselves now. That frees my hours for the hard parts.']] },
};
let term = null;
function openTerm(id) {
  const S = SESS[id]; if (!S) return;
  state.mode = 'term'; $('hud').hidden = true; $('termTitle').textContent = S.title; $('termBody').innerHTML = ''; $('term').hidden = false;
  term = { id, S, li: 0, ci: 0, acc: 0, el: null, done: false }; beep(440, .05, 'triangle', .03);
}
function termAddLine(L) { const d = document.createElement('div'); d.className = 't-' + L[0]; $('termBody').appendChild(d); return d; }
function termStep(dt) {
  if (!term || term.done) return;
  term.acc += dt * (term.S.lines[term.li][0] === 'cmd' ? 38 : 120);
  while (term.acc >= 1 && !term.done) {
    term.acc -= 1; const L = term.S.lines[term.li];
    if (!term.el) term.el = termAddLine(L);
    term.ci++; term.el.textContent = L[1].slice(0, term.ci);
    if (term.ci >= L[1].length) { term.li++; term.ci = 0; term.el = null; term.acc -= L[0] === 'cmd' ? 8 : 3; if (term.li >= term.S.lines.length) { term.done = true; $('termHint').textContent = 'E · close'; } }
  }
  $('termBody').scrollTop = 1e6;
}
function termKey() {
  if (!term) return;
  if (!term.done) { $('termBody').innerHTML = ''; for (const L of term.S.lines) termAddLine(L).textContent = L[1]; term.done = true; $('termHint').textContent = 'E · close'; $('termBody').scrollTop = 1e6; return; }
  $('term').hidden = true; $('hud').hidden = false; $('termHint').textContent = 'E · skip'; state.mode = 'explore';
  const id = term.id; term = null; save.terms = save.terms || [];
  if (!save.terms.includes(id)) { save.terms.push(id); persist(); const n = save.terms.length; if (n === AGENTS.length) toast('The tower is listening', 'You opened every agent desk. Walk up to the tower.'); else toast('Agent desk', `${n} of ${AGENTS.length} desks opened.`); }
}
const fx = [];
function poof(x, z, col = 0x9be8ff) {
  const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: col, transparent: true, opacity: .9, depthWrite: false })); sp.position.set(x, 1.1, z); sp.scale.set(1, 1, 1); scene.add(sp); fx.push({ sp, t: 0 });
}
async function portal(midFn) {
  const el = $('fade'); el.classList.add('on'); await wait(650);
  midFn(); await wait(250); el.classList.remove('on'); await wait(600);
}
function swapVehicle(v, silent) {
  if (player.veh.type === v || player.onFoot || player.inside) return;
  setVehicle(v); player.g.scale.setScalar(targetScale * .8); poof(player.g.position.x, player.g.position.z, 0xffe9a8);
  if (!silent) toast('New wheels', 'You swapped up to ' + VEHNAME[v] + '.');
}
async function resumePortal() {
  if (state.mode !== 'explore' || busy) return;
  const p = player.g.position;
  if (away) { // portal back where we came from
    if (Math.hypot(p.x - PRINTER.stn.x, p.z - PRINTER.stn.z) > 14 || true) await returnFromPrinter();
    return;
  }
  busy = true;
  away = { x: p.x, z: p.z, h: player.heading, veh: player.veh.type, cx: camera.position.x, cz: camera.position.z };
  await portal(() => {
    player.g.position.set(PRINTER.stn.x, .07, PRINTER.stn.z); player.heading = Math.PI; player.v = 0; player.g.rotation.y = Math.PI;
    camera.position.set(PRINTER.stn.x, 12.5 * (.62 + .38 * targetScale), PRINTER.stn.z + 15 * (.62 + .38 * targetScale));
    setVehicle('moto'); player.g.scale.setScalar(targetScale);
  });
  toast('Grootan Technologies', 'You are at the printer. Press E to print your resume. Click Resume again to head back.');
  busy = false;
}
async function returnFromPrinter() {
  if (!away) return; busy = true; const a = away;
  await portal(() => {
    player.g.position.set(a.x, .07, a.z); player.heading = a.h; player.g.rotation.y = a.h; player.v = 0;
    camera.position.set(a.cx, camera.position.y, a.cz);
    setVehicle(a.veh); player.g.scale.setScalar(targetScale);
  });
  away = null; busy = false;
}
async function printResume() {
  busy = true; printT = 0; PRINTER.paper.visible = true; PRINTER.paper.position.z = .3;
  for (let i = 0; i < 5; i++) { beep(300 + (i % 2) * 90, .12, 'square', .03); await wait(260); }
  PRINTER.led.material.color.set(0xffd36a); await wait(500);
  const a = document.createElement('a'); a.href = 'assets/Jeeva_S_U_Resume.pdf'; a.download = 'Jeeva_S_U_Resume.pdf'; document.body.appendChild(a); a.click(); a.remove();
  chime(); toast('Resume printed', 'Your copy of the resume is downloading. Thanks for stopping by!');
  await wait(1200); PRINTER.led.material.color.set(0x6fe3c1); printT = -1; PRINTER.paper.visible = false; busy = false;
  await wait(900); if (away) await returnFromPrinter();
}

/* ---- side quest: Beedi Rayappan's crab training (first person, along the beach) */
function mkCrab(sc = 1) {
  const g = new T.Group(), shell = 0xe0502e, dark = 0xa8321c, legs = [], claws = [];
  const body = add(g, new T.SphereGeometry(.2, 12, 8), mat(shell), 0, .16, 0, false); body.scale.set(1.35, .55, 1); outline(body, 1.08);
  const top = add(g, new T.SphereGeometry(.14, 10, 6), mat(0xf27a4a), 0, .24, -.01, false); top.scale.set(1.3, .45, .9);
  for (const s of [-1, 1]) {
    add(g, new T.CylinderGeometry(.015, .015, .1, 5), mat(dark), s * .08, .3, .15, false); add(g, new T.SphereGeometry(.035, 8, 6), new T.MeshBasicMaterial({ color: 0x15100d }), s * .08, .36, .15, false);
    const arm = new T.Group(); arm.position.set(s * .27, .2, .13); g.add(arm); const up = add(arm, new T.CylinderGeometry(.022, .022, .18, 5), mat(dark), s * .06, .03, .08, false); up.rotation.z = s * -1.0; up.rotation.x = .5;
    const cl = new T.Group(); cl.position.set(s * .12, .08, .17); arm.add(cl); const palm = add(cl, new T.SphereGeometry(.075, 8, 6), mat(shell), 0, 0, 0, false); palm.scale.set(1, .8, 1.1);
    for (const p of [-1, 1]) { const pin = add(cl, new T.BoxGeometry(.03, .03, .1), mat(dark), p * .03, 0, .08, false); pin.rotation.y = -p * .25; }
    claws.push(arm);
    for (let k = 0; k < 3; k++) { const lp = new T.Group(); lp.position.set(s * .22, .14, -.07 + k * .08); g.add(lp); const lg = add(lp, new T.CylinderGeometry(.012, .012, .22, 4), mat(dark), s * .1, -.02, 0, false); lg.rotation.z = s * -1.2; legs.push({ g: lp, s, k }); }
  }
  g.scale.setScalar(sc); g.userData = { legs, claws }; return g;
}
let crabCtl = null;
const lockPtr = cv => { try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (er) { } };
function crabQuit() { if (crabCtl) crabCtl.end(false, true); }
function crabGrab() { if (crabCtl) crabCtl.grab(); }
function crabGame() {
  return new Promise(resolve => {
    const C = RAY.camp, GOAL = 3, LIMIT = 60, canvas = renderer.domElement;
    const pg = player.g, saved = { pos: pg.position.clone(), vis: pg.visible, fov: camera.fov, near: camera.near, zoom: camera.zoom, order: camera.rotation.order };
    const sx0 = RAY.npc.p.g.position.x + C.ux * 3.2 + C.uz * 1.4, sz0 = RAY.npc.p.g.position.z + C.uz * 3.2 - C.ux * 1.4;
    const P = { x: sx0, z: sz0, yaw: Math.atan2(-C.ux, -C.uz), pitch: -.12, vx: 0, vz: 0, step: 0, stam: 1, lock: 0 };
    state.mode = 'crab'; busy = true; $('hud').hidden = true; $('crabHud').hidden = false; $('prompt').hidden = true;
    pg.visible = false; camera.fov = 72; camera.zoom = 1; camera.near = .05; camera.updateProjectionMatrix(); camera.rotation.order = 'YXZ'; scene.add(camera);
    // Jeeva's gloved hands (Rayappan lent them for training)
    const hands = new T.Group(); camera.add(hands); const hand = [];
    for (const s of [-1, 1]) {
      const h = new T.Group(); h.position.set(s * .3, -.42, -.72); h.rotation.y = -s * .14; hands.add(h);
      const fa = add(h, new T.CylinderGeometry(.05, .06, .55, 8), mat(0xf0b98a), 0, 0, .32, false); fa.rotation.x = Math.PI / 2;
      add(h, new T.CylinderGeometry(.075, .075, .14, 10), mat(0xf4f0e6), 0, 0, .08, false).rotation.x = Math.PI / 2;
      const gl = add(h, new T.SphereGeometry(.13, 12, 10), mat(0xd8202a), 0, 0, -.06, false); gl.scale.set(1, .9, 1.15); add(h, new T.SphereGeometry(.07, 8, 6), mat(0xd8202a), s * -.1, .03, -.02, false);
      hand.push(h);
    }
    // crabs scuttling along the sand
    const crabs = [], tangent = { x: C.uz, z: -C.ux };
    const bandPoint = () => { for (let k = 0; k < 60; k++) { const off = (Math.random() - .5) * 40, bx = C.x + tangent.x * off + C.ux * 4, bz = C.z + tangent.z * off + C.uz * 4, n = pathNear(bx, bz); if (n.d < 1) continue;
      const d = 49 + Math.random() * 6, ux = (bx - n.px) / n.d, uz = (bz - n.pz) / n.d, x = n.px + ux * d, z = n.pz + uz * d;
      if (rounds.some(r => Math.hypot(r.x - x, r.z - z) < r.r + 1) || Math.hypot(x - P.x, z - P.z) < 9) continue; return { x, z }; } return { x: C.x + C.ux * 6, z: C.z + C.uz * 6 }; };
    for (let i = 0; i < GOAL + 1; i++) { const p = bandPoint(), g = mkCrab(.65); g.position.set(p.x, BY_SAND, p.z); scene.add(g); crabs.push({ g, x: p.x, z: p.z, side: 1, jit: 0, pause: 0, spook: 0, ph: Math.random() * 6, dead: 0, dir: { x: 0, z: 0 }, sp: 0 }); }
    const st = { t: 0, caught: 0, grabCd: 0, grabT: 1, msgT: 0, done: false };
    const msg = (txt, col = '#fff') => { const m = $('cbMsg'); m.textContent = txt; m.style.color = col; m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop'); };
    const onMove = e => { const lock = document.pointerLockElement === canvas; if (lock || (e.buttons & 1)) { P.yaw -= (e.movementX || 0) * .0023; P.pitch = clamp(P.pitch - (e.movementY || 0) * .0023, -1.25, 1.25); } };
    const onDown = e => { if (e.pointerType === 'touch') return; if (document.pointerLockElement !== canvas) lockPtr(canvas); else crabGrab(); };
    let tx = null; const onTS = e => { if (e.pointerType === 'touch' && e.clientX > innerWidth * .4) tx = { x: e.clientX, y: e.clientY }; }, onTM = e => { if (tx && e.pointerType === 'touch') { P.yaw -= (e.clientX - tx.x) * .006; P.pitch = clamp(P.pitch - (e.clientY - tx.y) * .004, -1.25, 1.25); tx = { x: e.clientX, y: e.clientY }; } }, onTE = () => { tx = null; };
    addEventListener('mousemove', onMove); canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerdown', onTS); addEventListener('pointermove', onTM); addEventListener('pointerup', onTE);
    lockPtr(canvas);
    msg('Catch ' + GOAL + ' crabs!', '#ffd36a'); beep(660, .12, 'triangle', .05);
    crabCtl = {
      crabs, P,
      grab() {
        if (st.done || st.grabCd > 0) return; st.grabCd = .55; st.grabT = 0;
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw); let best = null, bd = 2.2;
        for (const c of crabs) { if (c.dead) continue; const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz); if (d < bd && (dx * fx + dz * fz) / (d || 1) > .5) { bd = d; best = c; } }
        if (best) { best.dead = .001; st.caught++; chime(); msg('CAUGHT! ' + st.caught + ' / ' + GOAL, '#9ff0b0'); poof(best.x, best.z, 0xffd36a); if (st.caught >= GOAL) this.end(true); }
        else { beep(180, .09, 'square', .04); msg('Missed! Get closer, face the crab.', '#ffb0a0'); for (const c of crabs) if (!c.dead && Math.hypot(c.x - P.x, c.z - P.z) < 5) c.spook = 1.2; }
      },
      end(won, quit) {
        if (st.done) return; st.done = true; crabCtl = null;
        removeEventListener('mousemove', onMove); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerdown', onTS); removeEventListener('pointermove', onTM); removeEventListener('pointerup', onTE);
        try { document.exitPointerLock(); } catch (er) { }
        ticker = null; crabs.forEach(c => scene.remove(c.g)); camera.remove(hands); scene.remove(camera);
        camera.fov = saved.fov; camera.near = saved.near; camera.zoom = saved.zoom; camera.rotation.order = saved.order; camera.updateProjectionMatrix();
        pg.visible = saved.vis; pg.position.set(RAY.stn.x, saved.pos.y, RAY.stn.z); player.v = 0; player.heading = Math.atan2(RAY.npc.p.g.position.x - RAY.stn.x, RAY.npc.p.g.position.z - RAY.stn.z); player.vdir = player.heading; pg.rotation.y = player.heading;
        $('crabHud').hidden = true; $('hud').hidden = false; state.mode = 'explore';
        resolve({ won: !!won, quit: !!quit, caught: st.caught, time: st.t });
      },
    };
    $('cbExit').onclick = () => crabQuit();
    ticker = dt => {
      if (st.done) return; st.t += dt; st.grabCd -= dt; st.grabT = Math.min(1, st.grabT + dt / .32);
      // look + move
      const turn = (keys.has('ArrowRight') ? -1 : 0) + (keys.has('ArrowLeft') ? 1 : 0); P.yaw += turn * 2.2 * dt;
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - joy.z, str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + joy.x;
      const sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && P.stam > 0 && P.lock <= 0 && (fwd || str);
      if (sprint) { P.stam = Math.max(0, P.stam - dt / 3); if (P.stam <= 0) P.lock = 1.2; } else P.stam = Math.min(1, P.stam + dt * .45); P.lock -= dt;
      const sp = sprint ? 7.4 : 4.4, ml = Math.hypot(fwd, str) || 1, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      const wx = (fx * fwd + rx * str) / Math.max(1, ml) * sp, wz = (fz * fwd + rz * str) / Math.max(1, ml) * sp, k = Math.min(1, dt * 9);
      P.vx += (wx - P.vx) * k; P.vz += (wz - P.vz) * k;
      P.x += P.vx * dt; P.z += P.vz * dt;
      for (const r of rounds) { const dx = P.x - r.x, dz = P.z - r.z, d = Math.hypot(dx, dz), m = r.r + .5; if (d < m && d > 1e-4) { P.x = r.x + dx / d * m; P.z = r.z + dz / d * m; } }
      const n = pathNear(P.x, P.z); if (n.d > 56.2) { P.x = n.px + (P.x - n.px) / n.d * 56.2; P.z = n.pz + (P.z - n.pz) / n.d * 56.2; } else if (n.d < 38) { P.x = n.px + (P.x - n.px) / n.d * 38; P.z = n.pz + (P.z - n.pz) / n.d * 38; }
      const spd = Math.hypot(P.vx, P.vz); P.step += spd * dt; if (spd > 1 && Math.sin(P.step * 2.2) > .98) beep(90 + Math.random() * 30, .03, 'triangle', .02);
      const bob = Math.sin(P.step * 2.2) * .035 * Math.min(1, spd / 4.4), eye = 1.62 + bob;
      pg.position.set(P.x, saved.pos.y, P.z);
      camera.position.set(P.x, BY_SAND + eye, P.z); camera.rotation.set(P.pitch, P.yaw, 0);
      // hands: sway, and a quick thrust forward when grabbing
      const ex = Math.sin(Math.PI * st.grabT) * (st.grabT < 1 ? 1 : 0);
      hand.forEach((h, i) => { const s = i ? 1 : -1; h.position.set(s * (.3 - ex * .1), -.42 + Math.sin(P.step * 2.2 + i * 1.6) * .012 * Math.min(1, spd / 4) + ex * .05, -.72 - ex * .62); h.rotation.x = -ex * .5 + P.pitch * -.0; });
      // crabs
      let near = null, nd = 1e9;
      for (const c of crabs) {
        if (c.dead) { c.dead += dt; c.g.scale.setScalar(Math.max(.001, .65 * (1 - c.dead * 4))); c.g.position.y = BY_SAND + c.dead * 2; if (c.dead > .3) { c.g.visible = false; } continue; }
        const dx = c.x - P.x, dz = c.z - P.z, dist = Math.hypot(dx, dz) || .01; c.spook -= dt; c.jit -= dt; c.pause -= dt;
        const nn = pathNear(c.x, c.z), ux = (c.x - nn.px) / (nn.d || 1), uz = (c.z - nn.pz) / (nn.d || 1);
        let mx = 0, mz = 0, speed = 0;
        if (dist < 8.5 + (c.spook > 0 ? 3 : 0)) {
          if (c.jit <= 0) { c.jit = .3 + Math.random() * .5; c.pause = Math.random() < .12 ? .2 + Math.random() * .25 : 0; if (Math.random() < .35) c.side *= -1; }
          if (c.pause <= 0) {
            const ax = dx / dist, az = dz / dist; let t1 = uz, t2 = -ux; const sg = (t1 * ax + t2 * az) >= 0 ? 1 : -1; t1 *= sg * c.side; t2 *= sg * c.side;
            let vx = ax * .5 + t1 * 1.0, vz = az * .5 + t2 * 1.0;
            if (nn.d > 55.4) { vx -= ux * 1.4; vz -= uz * 1.4; } else if (nn.d < 47.5) { vx += ux * 1.0; vz += uz * 1.0; }
            const cd = Math.hypot(c.x - C.x, c.z - C.z); if (cd > 36) { vx += (C.x - c.x) / cd * 1.6; vz += (C.z - c.z) / cd * 1.6; }
            const vl = Math.hypot(vx, vz) || 1; mx = vx / vl; mz = vz / vl; speed = 7.2 + (c.spook > 0 ? 1.4 : 0) + (dist < 2.6 ? 1.1 : 0);
          }
        } else if (c.jit <= 0) { c.jit = 1 + Math.random() * 2; c.side = Math.random() < .5 ? -1 : 1; c.pause = Math.random() < .5 ? 1.5 : 0; }
        if (speed === 0 && dist >= 8.5 && c.pause <= 0) { mx = uz * c.side; mz = -ux * c.side; speed = .5; }
        c.x += mx * speed * dt; c.z += mz * speed * dt;
        for (const r of rounds) { const ddx = c.x - r.x, ddz = c.z - r.z, d = Math.hypot(ddx, ddz), m = r.r + .4; if (d < m && d > 1e-4) { c.x = r.x + ddx / d * m; c.z = r.z + ddz / d * m; } }
        const n2 = pathNear(c.x, c.z); if (n2.d > 57) { c.x = n2.px + (c.x - n2.px) / n2.d * 57; c.z = n2.pz + (c.z - n2.pz) / n2.d * 57; }
        c.sp += (speed - c.sp) * Math.min(1, dt * 12);
        c.g.position.set(c.x, BY_SAND, c.z); c.g.rotation.y = Math.atan2(P.x - c.x, P.z - c.z);
        const U = c.g.userData; U.legs.forEach(l => { l.g.rotation.z = Math.sin(t0 + st.t * 42 * (.2 + c.sp * .3) + l.k * 1.9 + l.s) * .35 * Math.min(1, c.sp); }); U.claws.forEach((a, i) => { a.rotation.x = -.35 + Math.sin(st.t * (c.sp > 0 ? 9 : 2.5) + i * 2 + c.ph) * .2; });
        if (c.sp > 1 && Math.random() < dt * 4) poof(c.x, c.z, 0xe8d4a0);
        if (dist < nd) { nd = dist; near = c; }
      }
      // HUD
      const left = Math.max(0, Math.ceil(LIMIT - st.t));
      $('cbCount').textContent = st.caught + ' / ' + GOAL; $('cbTime').textContent = left + 's'; $('cbStam').style.width = (P.stam * 100) + '%'; $('cbStam').style.background = P.lock > 0 ? '#d8402a' : '#7fe8a0';
      if (near) { const vx = near.x - P.x, vz = near.z - P.z, ang = Math.atan2(vx * rx_(P.yaw) + vz * rz_(P.yaw), vx * -Math.sin(P.yaw) + vz * -Math.cos(P.yaw)); $('cbArrow').style.transform = `rotate(${ang}rad)`; $('cbDist').textContent = Math.round(nd) + ' m'; $('cbCompass').hidden = false;
        const f = (vx * -Math.sin(P.yaw) + vz * -Math.cos(P.yaw)) / (nd || 1); $('cbCross').classList.toggle('hot', nd < 2.2 && f > .5); } else $('cbCompass').hidden = true;
      if (st.t >= LIMIT && !st.done) crabCtl.end(false);
    };
  });
}
const rx_ = y => Math.cos(y), rz_ = y => -Math.sin(y), t0 = 0, BY_SAND = .07;
async function runRayappan() {
  busy = true; const R = 'Beedi Rayappan', best = save.crab && save.crab.best;
  const first = !save.crab;
  const pick = await say([
    A(R, first ? 'Hey, thambi! Come here. Beedi Rayappan, that is me. Forty years I have trained fighters on this sand. The knees are old now, but the eyes still see everything.' : 'Back again? Good. In my days, a boy who stopped training was just a man with big hands.'),
    A(R, 'Boxing is not about hitting hard. It is quick hands and sharper eyes. See those little crabs? Faster than any opponent I ever corner-coached in North Madras.'),
    { who: R, text: 'Catch three of them in one minute with your bare gloves, and I will call you a fighter. Ready?', choices: [{ label: 'Start training', reply: [A(R, 'Hmm! Gloves up. Eyes open. Go, go, go!')] }, { label: 'Spar with Vembuli (uses your camera)', reply: [A(R, 'Vembuli? That big bull from the other gym? Hmm, brave. Two rounds, forty seconds each. Switch on your camera, thambi. Your fists are the gloves, I will teach you the moves first.')] }, { label: 'Spar with Conor (uses your camera)', reply: [A(R, 'Conor? The loud one with the quick hands? Hmm. He talks a lot, but he does not fall easy. Two rounds, forty seconds each. Switch on your camera, thambi, and watch his glove before the swing.')] }, { label: 'Maybe later', reply: [A(R, 'Crabs are patient. Come when your hands are ready.')] }] },
  ]);
  if (pick === 1 || pick === 2) { await runSpar(R, pick === 1 ? 'vembuli' : 'conor'); busy = false; return; }
  if (pick !== 0) { busy = false; return; }
  const r = await crabGame();
  if (r.quit) { await say([A(R, 'Running away from a crab? Hmm. Come back when you are serious.')]); }
  else if (r.won) {
    const t = Math.round(r.time * 10) / 10; save.crab = { best: Math.min(best || 1e9, t), done: true }; persist();
    await say([A(R, 'Ayyo! ' + t + ' seconds! Not bad at all, thambi. Quick hands, sharp eyes.'), A(R, 'Remember it: in the ring, in code, in life, the one who keeps getting up wins. Now go, the road is waiting.')]);
    toast('Side quest complete', 'Crab training done in ' + t + 's. Beedi Rayappan approves.');
  } else await say([A(R, 'Adei! Even the crabs are laughing at you. Only ' + r.caught + ' of 3. Again, again!')]);
  busy = false;
}

/* ---- side quest: spar with Vembuli or Conor (first person, hand-gesture punches via webcam) */
let boxCtl = null;
function boxQuit() { if (boxCtl) boxCtl.quit(); }
function boxGame(opp) {
  return new Promise(resolve => {
    const pg = player.g, saved = { pos: pg.position.clone(), vis: pg.visible, fov: camera.fov, near: camera.near, zoom: camera.zoom, order: camera.rotation.order };
    state.mode = 'box'; busy = true; $('hud').hidden = true; $('prompt').hidden = true;
    pg.visible = false; camera.fov = 74; camera.zoom = 1; camera.near = .05; camera.updateProjectionMatrix(); camera.rotation.order = 'YXZ'; scene.add(camera);
    $('bxExit').onclick = () => boxQuit();
    boxCtl = runBoxing({ opp, T, scene, camera, g: RAY.g, ring: RAY.ring, mat, outline, add, beep, chime, setTicker: f => { ticker = f; } });
    boxCtl.promise.then(res => {
      boxCtl = null; scene.remove(camera);
      camera.fov = saved.fov; camera.near = saved.near; camera.zoom = saved.zoom; camera.rotation.order = saved.order; camera.updateProjectionMatrix();
      pg.visible = saved.vis; pg.position.set(RAY.stn.x, saved.pos.y, RAY.stn.z); player.v = 0; player.heading = Math.atan2(RAY.npc.p.g.position.x - RAY.stn.x, RAY.npc.p.g.position.z - RAY.stn.z); player.vdir = player.heading; pg.rotation.y = player.heading;
      $('hud').hidden = false; state.mode = 'explore'; resolve(res);
    });
  });
}
async function runSpar(R, opp) {
  const r = await boxGame(opp), conor = opp === 'conor', W = conor ? 'Conor' : 'Vembuli';
  if (r.nocam) { await say([A(R, 'Without the camera I cannot see your hands, and a boxer with no hands is just a man in shorts. Allow the camera for this page and come back, thambi.')]); return; }
  if (r.quit) { await say([A(R, 'Throwing the towel before the bell? Hmm. Come back when your heart is ready.')]); return; }
  if (r.won) {
    save.spar = Object.assign(save.spar || {}, { won: true, ko: r.ko, [opp]: { won: true, ko: r.ko } }); persist();
    await say([A(W, conor ? (r.ko ? 'Okay... okay. Nobody puts me down. Except you, apparently. Good punch, kid.' : 'Fine. You take it on points. Respect. Rematch, though.') : (r.ko ? 'Ayyo... my head is still ringing. You hit like a lorry, thambi.' : 'Fine. You win on points. Next time I will not go easy.')), A(R, 'Hmm! Hands up, eyes sharp, and the heart bigger than the opponent. That is boxing. That is also life.')]);
    toast('Side quest complete', 'You beat ' + W + (r.ko ? ' by knockout!' : ' on points!') + (r.camera ? ' Every punch was your own hands.' : ''));
  } else await say([A(W, conor ? (r.lost ? 'Told you. Precision beats power. Go practise.' : 'A draw? Cute. I will take it.') : (r.lost ? 'Stay down, little boy. Boxing is not a college exam.' : 'Hmph. Draw? I will take it.')), A(R, r.lost ? 'You dropped your hands. Show your open palm when his glove turns red, then counter!' : 'Close, thambi. Land the clean ones and block when his glove turns red. Again!')]);
}

async function interactStation(s) {
  if (s.kind === 'side') { await runRayappan(); return; }
  if (s.kind === 'hologram') { openFolio('portfolio'); return; }
  if (s.kind === 'portfolio') { if (s.url) { window.open(s.url, '_blank', 'noopener,noreferrer'); } else toast('Portfolio coming soon', 'Bharath’s portfolio link is not available yet.'); return; }
  if (s.kind === 'chat') { const c = INT.chat[s.id]; busy = true; await say(c.slice(1).map(t => A(c[0], t))); busy = false; return; }
  if (s.kind === 'print') { await printResume(); return; }
  if (s.kind === 'term') { openTerm(s.id); return; }
  if (s.kind === 'door') { await enterOffice(); return; }
  if (s.kind === 'exit') { await leaveOffice(); return; }
  if (s.kind === 'folio') { openFolio(s.id); return; }
  if (save.done.includes(s.act) && s.id !== 'ai') {
    if (s.id === 'ravi') {
      busy = true;
      const pick = await say([{ who: 'Ravi', text: 'Back for a rematch? Six balls, same rules. No crying this time.', choices: [{ label: 'Play again', reply: [A('Ravi', 'Bowling!')] }, { label: 'Not now', reply: [A('Ravi', 'Any time. The wicket is yours.')] }] }]);
      if (pick === 0) await cricketLoop();
      busy = false;
    }
    else if (s.id === 'thatha') await say([A('Thatha', '"Chess is just patience wearing a costume."')]);
    return;
  }
  await runStory[s.id]();
}

/* ---- finale: challenge accepted */
const CAPS = [[.4, 'CLAUDE CODE', 'plans, edits and tests, right in the terminal'], [2.0, 'CODEX', 'many coding tasks, running at once'], [3.6, 'ASTRA', 'agents keeping watch on the night shift'], [5.2, 'AUTOMATION', 'pipelines that build, test and ship themselves'], [6.8, 'CHANGES', 'the job moves up a level: from typing to directing'], [8.6, 'CHALLENGE ACCEPTED', 'Jeeva S U · software engineer, still learning']];
let capI = -1;
function caption(t) {
  let i = -1; for (let k = 0; k < CAPS.length; k++) if (t >= CAPS[k][0]) i = k;
  if (i !== capI) { capI = i; if (i < 0) { $('cap').hidden = true; return; } $('capH').textContent = CAPS[i][1]; $('capP').textContent = CAPS[i][2]; $('cap').hidden = false; const c = $('cap'); c.classList.remove('in'); void c.offsetWidth; c.classList.add('in'); beep(500 + i * 70, .12, 'sine', .03); }
}
/* ---------------------------------------------------------- stunt arena challenge */
function arSync() { $('arCount').textContent = AR.tricks + ' / ' + AR.goal; $('arTime').textContent = Math.max(0, Math.ceil(AR.limit - AR.t)) + 's'; $('arScore').textContent = ARENA.score; }
function arBanner(txt, sub, ms) { const b = $('arBanner'); b.innerHTML = txt + (sub ? '<small>' + sub + '</small>' : ''); b.hidden = false; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); if (ms) setTimeout(() => { b.hidden = true; }, ms); }
function arenaTrick() { if (!AR.active) return; AR.tricks++; arSync(); if (AR.tricks >= AR.goal) arenaWin(); }
function arenaCancel(msg) { if (!AR.active) return; AR.active = false; AR.cd = 12; $('arHud').hidden = true; ARENA.combo = 0; if (msg) toast('Stunt arena', msg); }
async function arenaEnter() {
  busy = true; const pick = await say([{ who: 'Arena', text: 'STUNT CHALLENGE. Take the curve, hit the orange kicker fast and land the jump clean within 25 seconds. Press Esc any time to quit.', choices: [{ label: 'Start the challenge', reply: [NAR('Engines on!')] }, { label: 'Just ride through', reply: [NAR('Free ride. The kicker always works.')] }] }]);
  busy = false; if (pick !== 0) { AR.cd = 20; return; }
  await arenaIntro(); ARENA.score = 0; ARENA.combo = 0; AR.t = 0; AR.tricks = 0; AR.active = true; $('arHud').hidden = false; arSync(); arBanner('GO!', 'land the jump · 25 s', 1400); beep(880, .2, 'triangle', .06);
}
async function arenaIntro() {
  state.mode = 'cut'; busy = true; AR.skip = false; player.v = 0; const c = ARENA.center; let tt = 0; arBanner('STUNT LANE', 'press any key to skip');
  await new Promise(res => { ticker = dt => { tt += dt; const k = clamp(tt / 4.6, 0, 1), e = k * k * (3 - 2 * k), a = 4.2 - e * 1.5, R = lerp(52, 24, e), H = lerp(34, 12, e);
    camera.position.set(c.x + Math.cos(a) * R, H, c.z + Math.sin(a) * R); camera.lookAt(c.x, 1.5, c.z);
    if (tt > 1.8 && tt < 1.9) arBanner('ONE JUMP', 'land it clean'); if (tt >= 4.6 || AR.skip) { ticker = null; res(); } }; });
  $('arBanner').hidden = true; state.mode = 'explore'; busy = false;
}
function arenaWin() {
  ARENA.best = Math.max(ARENA.best || 0, ARENA.score); ARENA.cheerT = 4; AR.active = false; AR.cd = 30; $('arHud').hidden = true; chime();
  toast('Jump landed', 'Score ' + ARENA.score + '. Ride the lane again to take the challenge again.');
}
function arenaStep(dt, pp, t) {
  for (let i = AR.parts.length - 1; i >= 0; i--) { const q = AR.parts[i]; q.life -= dt; q.vy -= 5 * dt; q.sp.position.x += q.vx * dt; q.sp.position.y += q.vy * dt; q.sp.position.z += q.vz * dt; q.sp.material.opacity = Math.max(0, q.life / 1.2); if (q.life <= 0) { scene.remove(q.sp); AR.parts.splice(i, 1); } }
  AR.cd -= dt;
  if (AR.active) {
    if (state.mode === 'explore') { AR.t += dt; arSync(); if (Math.hypot(pp.x - ARENA.center.x, pp.z - ARENA.center.z) > 40) arenaCancel('You left the lane. Challenge ended.'); else if ((pp.x - ARENA.fins[AR.dir].x) * ARENA.fins[AR.dir].dx + (pp.z - ARENA.fins[AR.dir].z) * ARENA.fins[AR.dir].dz > 0) arenaCancel('Missed the landing. Ride the lane again.'); else if (AR.t >= AR.limit) { arenaCancel(null); chime(); arBanner('TIME UP', AR.tricks + ' / ' + AR.goal + ' tricks', 2200); toast('So close', 'Ride the lane again to try again.'); } }
    return;
  }
  if (AR.cd <= 0 && state.mode === 'explore' && !busy && !away && ARENA.gates) { const gi = ARENA.gates.findIndex(G => Math.hypot(pp.x - G.x, pp.z - G.z) < 2.8); if (gi >= 0) { AR.dir = gi; arenaEnter(); } }
}
addEventListener('keydown', e => { if (e.code === 'Escape') { if (AR.active) arenaCancel('Challenge ended. Free ride.'); } if (state.mode === 'cut' && !e.repeat) AR.skip = true; });
$('arExit').addEventListener('click', () => arenaCancel('Challenge ended. Free ride.'));


/* ---------------------------------------------------------- Grootan office: park, walk in, slideshows */
const FOOT = { max: 3.6, acc: 10, turn: 9, type: 'foot' }, INSIDE_IDS = ['ibm', 'ibb', 'city', 'skills', 'exp'];
function walkAnim(dt, v) {
  const sp = Math.min(1, v / 2.2); player.walkPh = (player.walkPh || 0) + dt * (2 + v * 2.4);
  const s = Math.sin(player.walkPh) * .75 * sp; player.legs[0].rotation.x = s; player.legs[1].rotation.x = -s; player.arms[0].rotation.x = -s * .7; player.arms[1].rotation.x = s * .7;
  player.body.position.y = Math.abs(Math.sin(player.walkPh)) * .035 * sp; player.body.rotation.z = Math.sin(player.walkPh) * .03 * sp;
}
function camFollow(dt) {
  const pp = player.g.position, k = .62 + .38 * player.g.scale.x, wx = pp.x, wz = pp.z + 15 * k, f = 1 - Math.exp(-dt * 4);
  camera.position.x = lerp(camera.position.x, wx, f); camera.position.z = lerp(camera.position.z, wz, f); camera.position.y = lerp(camera.position.y, 12.5 * k, f); camera.lookAt(camera.position.x, 1.2, camera.position.z - 14.5 * k);
}
function walkTo(x, z, speed) {
  return new Promise(res => { ticker = dt => {
    const p = player.g.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < .2) { ticker = null; player.v = 0; res(); return; }
    player.heading = Math.atan2(dx, dz); const st = Math.min(d, speed * dt); p.x += dx / d * st; p.z += dz / d * st; player.v = speed; player.g.rotation.y = player.heading;
    rideAnim(dt, speed); camFollow(dt); }; });
}
let parkedBike = null;
async function enterOffice() {
  busy = true; state.mode = 'cut'; const B = OFFICE.bay, Dr = OFFICE.door, vt = player.veh.type; OFFICE.veh = vt;
  toast('Grootan Technologies', 'Parking the bike. Time to walk in.');
  await walkTo(B.x + 1.6, B.z + 1.8, 7); await walkTo(B.x, B.z, 3);
  player.heading = Math.PI; player.g.rotation.y = Math.PI; player.v = 0; await wait(250);
  // park the bike on the bay and step off
  parkedBike = VEH[vt].build(); parkedBike.g.position.set(B.x, .07, B.z); parkedBike.g.rotation.y = Math.PI; parkedBike.g.scale.setScalar(player.g.scale.x); world.add(parkedBike.g); poof(B.x, B.z, 0xffe9a8);
  player.onFoot = true; hideVehicle(true); beep(320, .1, 'triangle', .04);
  await walkTo(B.x - 2.4, Dr.z + .6, 2.8); await walkTo(Dr.x, Dr.z, 2.8);
  await portal(() => {
    player.g.position.set(INT.spawn.x, .11, INT.spawn.z); player.heading = Math.PI; player.g.rotation.y = Math.PI; player.v = 0; player.inside = true;
    const k = .62 + .38 * player.g.scale.x; camera.position.set(INT.spawn.x, 12.5 * k, INT.spawn.z + 15 * k); camera.lookAt(camera.position.x, 1.2, camera.position.z - 14.5 * k);
  });
  state.mode = 'explore'; busy = false; chime();
  toast('Welcome to Grootan', 'Walk to each glowing spot and press E. The big screens hold the project slides.');
}
async function leaveOffice() {
  busy = true; state.mode = 'cut'; const B = OFFICE.bay, Dr = OFFICE.door;
  await portal(() => {
    player.inside = false; player.g.position.set(Dr.x, .07, Dr.z + .8); player.heading = 0; player.g.rotation.y = 0; player.v = 0;
    const k = .62 + .38 * player.g.scale.x; camera.position.set(Dr.x, 12.5 * k, Dr.z + .8 + 15 * k); camera.lookAt(camera.position.x, 1.2, camera.position.z - 14.5 * k);
  });
  await walkTo(B.x - 1.6, B.z, 2.8); await walkTo(B.x, B.z, 2.4); await wait(200);
  if (parkedBike) { world.remove(parkedBike.g); parkedBike = null; }
  { const want = VBYRANK[Math.max(VRANK[OFFICE.veh] || 0, save.vrank || 0)]; player.onFoot = false; setVehicle(want); }
  hideVehicle(false); player.legs.forEach(l => l.rotation.x = 0); player.arms.forEach(a => a.rotation.x = 0); player.heading = Math.PI * .5 + .3; player.g.rotation.y = player.heading; player.v = 0; poof(B.x, B.z, 0xffe9a8);
  state.mode = 'explore'; busy = false; beep(520, .1, 'triangle', .05); toast('Back on the road', 'Ride on. The road still has a way to go.');
}
/* ---- project folios as slideshows */
const SL = { slides: [], i: 0 };
const DECK = ['exp', 'ibm', 'ibb', 'city', 'skills'];
const FULL_DECK = ['portfolio', 'edu', 'ach', 'exp', 'projects', 'skills', 'contact'];
function slidesFor(id) {
  const d = FOLIO[id], out = []; if (!d) return out;
  out.push({ id, html: `<div class="slideCover">${d.photo ? '<img class="mePhoto" src="assets/me.jpg" alt="" onerror="this.remove()">' : ''}<div class="ficon big">${d.icon}</div><h2>${esc(d.title)}</h2><p>${esc(d.sub)}</p></div>` });
  if (d.description) out.push({ id, html: `<div class="slideBody"><div class="sTag">${d.icon} ${esc(d.title)}</div><p>${esc(d.description)}</p></div>` });
  for (const b of d.blocks || []) out.push({ id, html: `<div class="slideBody"><div class="sTag">${d.icon} ${esc(d.title)}</div>${b.h ? `<h3>${esc(b.h)}</h3>` : ''}${b.meta ? `<small>${esc(b.meta)}</small>` : ''}<ul>${(b.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>` });
  if (d.chips) out.push({ id, html: `<div class="slideBody"><div class="sTag">${d.icon} ${esc(d.title)}</div>${d.chips.map(([k, v]) => `<h3>${k}</h3><div class="chips">${v.map(x => `<span>${esc(x)}</span>`).join('')}</div>`).join('')}</div>` });
  if (d.links) out.push({ id, html: `<div class="slideBody"><div class="sTag">${d.icon} ${esc(d.title)}</div><h3>Portfolio links</h3>${d.links.map(([label, url]) => `<a class="clink" href="${url}" target="_blank" rel="noopener noreferrer">↗ ${esc(label)}</a>`).join('')}</div>` });
  if (d.portfolioPending) out.push({ id, html: `<div class="slideBody"><div class="sTag">${d.icon} ${esc(d.title)}</div><h3>Portfolio links</h3><p>Coming soon</p></div>` });
  if (d.contact) out.push({ id, html: '<div class="slideBody"><div class="sTag">' + d.icon + ' ' + esc(d.title) + '</div>' + d.contact.map(([e, t, u]) => `<a class="clink" href="${u}">${e} ${esc(t)}</a>`).join('') + '</div>' });
  return out;
}
function openFolio(id) {
  if (!FOLIO[id]) return; SL.slides = []; SL.i = 0;
  if (id === 'portfolio') SL.slides = FULL_DECK.flatMap(slidesFor);
  else if (DECK.includes(id)) { for (const k of DECK) { if (k === id) SL.i = SL.slides.length; SL.slides.push(...slidesFor(k)); } }  // the whole Grootan deck, opened at this section
  else SL.slides = slidesFor(id);
  $('folio').hidden = false; state.mode = 'folio'; chime(); showSlide(SL.i);
}
function showSlide(n) {
  SL.i = clamp(n, 0, SL.slides.length - 1); const S = SL.slides[SL.i], b = $('folioBody'); b.innerHTML = S.html; b.classList.remove('slideIn'); void b.offsetWidth; b.classList.add('slideIn'); b.scrollTop = 0;
  if (!save.visited.includes(S.id)) { save.visited.push(S.id); save.xp += 40; persist(); refreshHud(); }
  $('fDots').innerHTML = SL.slides.map((x, k) => `<i class="${k === SL.i ? 'on' : (k < SL.i ? 'seen' : '')}"></i>`).join(''); $('fCount').textContent = (SL.i + 1) + ' / ' + SL.slides.length;
  $('fPrev').disabled = SL.i === 0; $('fNext').textContent = SL.i === SL.slides.length - 1 ? 'Done' : 'Next ›'; beep(520 + (SL.i % 8) * 40, .04, 'sine', .03);
}
function slideNext() { if (SL.i >= SL.slides.length - 1) closeFolio(); else showSlide(SL.i + 1); }
$('fPrev').onclick = () => showSlide(SL.i - 1); $('fNext').onclick = slideNext;

async function finale() { capI = -1;
  state.mode = 'cut'; $('hud').hidden = true; busy = true;
  const p0 = player.g.position.clone(), cam0 = camera.position.clone(); let t = 0;
  player.v = 0; player.heading = Math.PI; player.g.rotation.y = Math.PI; player.legs.forEach(l => l.rotation.x = 0);
  await new Promise(resolve => {
    ticker = dt => {
      t += dt; const k = clamp(t / 9, 0, 1), e = k * k * (3 - 2 * k); caption(t);
      SPIRE.awaken = e;
      const tx = lerp(cam0.x, 0, e), ty = lerp(cam0.y, 19, e), tz = lerp(cam0.z, p0.z + 32, e);
      camera.position.set(tx, ty, tz); camera.lookAt(0, lerp(1.2, 21, e), lerp(p0.z - 14, -334, e));
      player.arms[0].rotation.x = player.arms[1].rotation.x = -lerp(.2, 3.0, clamp(t / 2.5, 0, 1));
      player.body.position.y = Math.abs(Math.sin(t * 6)) * .05 * (1 - e); player.g.position.y = e > .5 ? .07 + Math.sin((e - .5) * 3) * .02 : .07;
      if (t >= 10.5) { ticker = null; $('cap').hidden = true; resolve(); }
    };
  });
  state.mode = 'end'; $('finale').hidden = false; chime();
  const done = save.done.includes(4); if (!done) { save.done.push(4); persist(); }
  refreshHud();
}
$('fnWalk').onclick = () => { $('finale').hidden = true; $('hud').hidden = false; state.mode = 'explore'; busy = false; player.arms[0].rotation.x = player.arms[1].rotation.x = 0; player.body.position.y = 0; const p = player.g.position; camera.position.set(p.x, 12.5, p.z + 15); toast('Challenge accepted', 'Walk back along the road any time.'); };
$('fnHello').onclick = () => { $('finale').hidden = true; state.mode = 'explore'; openFolio('contact'); const t = setInterval(() => { if (state.mode === 'explore') { clearInterval(t); $('finale').hidden = false; state.mode = 'end'; } }, 150); };

/* ---- explore */
function nearestInteract() {
  const p = player.g.position; let best = null, bd = 4.6;
  for (const s of STN) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
  return best;
}
function movePlayer(dt) {
  const V = player.veh, cfg = player.onFoot ? FOOT : V.cfg, p = player.g.position;
  const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
  const iz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + joy.z;
  const len = Math.hypot(ix, iz), drive = state.mode === 'explore' && !busy;
  const max = cfg.max * (boostT > 0 ? 1.7 : 1);
  let target = 0, dh = 0;
  if (drive && len > .1) {
    const k = Math.min(1, len); let da = Math.atan2(ix, iz) - player.heading; da = Math.atan2(Math.sin(da), Math.cos(da));
    const sp0 = Math.min(1, player.v / cfg.max), moto0 = V.type === 'moto' && !player.onFoot,
      // a bike can't swing its nose round at speed: yaw rate falls off with speed (about what the tyres can hold)
      tr = moto0 ? Math.min(cfg.turn * (1.3 - .75 * sp0), 22 / Math.max(player.v, 4)) : cfg.turn * (1.6 - .8 * sp0), step = clamp(da, -tr * dt, tr * dt);
    player.heading += step; dh = step / Math.max(dt, 1e-4); target = max * k * (Math.abs(da) > 1.8 ? .4 : 1);
  }
  player.v += (target - player.v) * Math.min(1, dt * (target > player.v ? cfg.acc : cfg.acc * 1.8));
  if (target === 0 && player.v < .05) player.v = 0;
  const isMoto = V.type === 'moto' && !player.onFoot;
  if (player.vdir === undefined || !isMoto) player.vdir = player.heading;
  let slip = Math.atan2(Math.sin(player.heading - player.vdir), Math.cos(player.heading - player.vdir));
  if (isMoto) { const sp = Math.min(1, player.v / cfg.max), grip = 7 + 6 * (1 - sp) + (len < .1 ? 3 : 0); player.vdir += slip * Math.min(1, dt * grip);
    { const ms = .4, sl = Math.atan2(Math.sin(player.heading - player.vdir), Math.cos(player.heading - player.vdir)); if (Math.abs(sl) > ms) player.vdir = player.heading - Math.sign(sl) * ms; } /* never slide more than ~23 degrees */  slip = Math.atan2(Math.sin(player.heading - player.vdir), Math.cos(player.heading - player.vdir)); player.v *= 1 - Math.min(.5, Math.abs(slip)) * dt * .35; }
  player.slip = slip;
  const px = p.x, pz = p.z; p.x += Math.sin(player.vdir) * player.v * dt; p.z += Math.cos(player.vdir) * player.v * dt;
  const R = .5 * player.g.scale.x + .3;
  for (const w of walls) { const cx = clamp(p.x, w.x0, w.x1), cz = clamp(p.z, w.z0, w.z1), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz); if (d < R) { if (d > 1e-4) { p.x = cx + dx / d * R; p.z = cz + dz / d * R; } else p.x = w.x0 - R; } }
  for (const r of rounds) { if (r.ground && stunt && stunt.air) continue; const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz), m = r.r + R; if (d < m && d > 1e-4) { p.x = r.x + dx / d * m; p.z = r.z + dz / d * m; } }
  if (player.inside) { p.y = .11; p.x = clamp(p.x, INT.x - INT.W / 2 + 1, INT.x + INT.W / 2 - 1); p.z = clamp(p.z, INT.z - INT.D / 2 + 1.2, INT.z + INT.D / 2 - .9); }
  const n = pathNear(p.x, p.z); if (!player.inside && n.d > CORR) { p.x = n.px + (p.x - n.px) / n.d * CORR; p.z = n.pz + (p.z - n.pz) / n.d * CORR; }
  if (Math.hypot(p.x - px, p.z - pz) > .02 + player.v * dt * .9 && player.v > 0) player.v *= .85;
  player.g.rotation.y = player.heading;
  player.lean = lerp(player.lean, clamp(-dh * .1 * (player.v / cfg.max), -.35, .35), Math.min(1, dt * 8));
  V.d.g.rotation.z = player.lean; player.body.rotation.z = player.lean * .6;
  rideAnim(dt, player.v);
  driftFx(dt, len, dh);
}
const clock = new T.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  if (state.mode === 'chess') { ChessGame.update(dt); draw(ChessGame.scene, ChessGame.camera); return; }
  if (dlg && !dlg.full) { dlg.pos += dt * 55; const l = dlg.q[dlg.i]; const n = Math.floor(dlg.pos); $('dlgText').textContent = l.text.slice(0, n); if (n % 3 === 0) beep(300 + (n % 5) * 20, .02, 'square', .012); if (n >= l.text.length) finishText(); }
  if (state.mode === 'explore' && player.veh && !away) { const n = pathNear(player.g.position.x, player.g.position.z); if (n.d < 45 && n.s > (save.reach || 0)) { save.reach = n.s; const v = stageVeh(); if (v !== player.veh.type) { swapVehicle(v); persist(); } } }
  const sc = lerp(player.g.scale.x, player.inside ? Math.max(targetScale, 1) : targetScale, 1 - Math.exp(-dt * 8)); player.g.scale.setScalar(sc);
  if (ticker) ticker(dt); else movePlayer(dt);
  const pp = player.g.position;
  const nr = pathNear(pp.x, pp.z), prog = nr.s / TOTAL;
  if (!ticker || state.mode === 'cricket') for (const n of NPCS) {
    const d = Math.hypot(pp.x - n.p.g.position.x, pp.z - n.p.g.position.z);
    if (state.mode === 'cricket') break;
    n.p.body.position.y = Math.sin(t * 1.6 + n.ph) * .015;
    if (d < 9) { const ta = Math.atan2(pp.x - n.p.g.position.x, pp.z - n.p.g.position.z); let da = ta - n.p.g.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); n.p.g.rotation.y += da * Math.min(1, dt * 4); }
    n.p.arms[0].rotation.x = Math.sin(t * 1.3 + n.ph) * .06;
  }
  // station rings
  const cur = curAct();
  for (const s of STN) { const active = s.kind === 'folio' ? !save.visited.includes(s.id) : !save.done.includes(s.act); s.ring.material.opacity = active ? .75 + .2 * Math.sin(t * 3) : .28; s.glow.material.opacity = active ? .42 + .14 * Math.sin(t * 3) : .12; s.ring.rotation.z = t * .4; }
  // dots
  if (DOTS.im) { const im = DOTS.im, c0 = new T.Color(0xfff1b8), c1 = new T.Color(0x9a8a60); for (let i = 0; i < DOTS.length; i += 1) im.setColorAt(i, DOTS[i] < nr.s - 2 ? c1 : c0); im.instanceColor.needsUpdate = true; }
  // gates
  for (const G of GATES) if (G.open && G.t < 1) { G.t += dt * 1.2; G.g.position.y = -G.t * 3.2; if (G.t >= 1) G.g.visible = false; }
  // spire
  { const a = SPIRE.awaken, sp = 1 + a * 3;
    SPIRE.core.rotation.y = t * .4 * sp; SPIRE.core.scale.setScalar(1 + a * .25);
    SPIRE.rings.forEach((r, i) => { r.rotation.z = t * (.25 + i * .12) * sp * (i % 2 ? -1 : 1); r.scale.setScalar(1 + a * .3); });
    SPIRE.shards.forEach(s => { const u = s.userData; u.a += dt * u.sp * sp; s.position.set(Math.cos(u.a) * u.r, u.h + Math.sin(t * 1.4 + u.a) * .5 + a * 4, Math.sin(u.a) * u.r); s.rotation.y += dt * 2; });
    SPIRE.halo.material.opacity = .5 + .3 * Math.sin(t * 1.5) + a * .3; SPIRE.halo.scale.setScalar(50 + a * 35); SPIRE.light.intensity = 40 + a * 160;
    SPIRE.clouds.forEach((c, i) => { const u = c.userData; u.a += dt * .05 * (1 - a * .6); c.position.set(Math.cos(u.a) * (u.r + a * 14), u.y + a * 8, Math.sin(u.a) * (u.r + a * 14) - 6); c.material.opacity = .95 * (1 - a * .75); c.material.color.set(a > .5 ? '#ffd9c0' : '#7a6aa0'); });
  }
  envStep(dt, t, SPIRE.awaken);
  far.position.set(pp.x, 0, pp.z);
  clouds.forEach((c, i) => { c.position.x += dt * (1 + i * .1); if (c.position.x > 180) c.position.x = -180; });
  const mp = motes.geometry.attributes.position; for (let i = 0; i < mp.count; i++) { mp.array[i * 3 + 1] += Math.sin(t + i) * .004 + .004; mp.array[i * 3] += Math.sin(t * .3 + i) * .004; if (mp.array[i * 3 + 1] > 10) mp.array[i * 3 + 1] = 0; }
  mp.needsUpdate = true; motes.position.set(pp.x, 0, pp.z);
  motes.visible = !player.inside;   // the drifting pollen glitters like sparkles indoors
  if (!ticker) {
    const k = .62 + .38 * sc, wantX = pp.x + Math.sin(player.heading) * player.v * .25, wantZ = pp.z + 15 * k + Math.cos(player.heading) * player.v * .25;
    camera.position.x = lerp(camera.position.x, wantX, 1 - Math.exp(-dt * 4)); camera.position.z = lerp(camera.position.z, wantZ, 1 - Math.exp(-dt * 4)); camera.position.y = lerp(camera.position.y, 12.5 * k, 1 - Math.exp(-dt * 4));
    if (camShake > .01) { camera.position.x += (Math.random() - .5) * camShake; camera.position.y += (Math.random() - .5) * camShake * .6; camShake *= .86; }
    camera.lookAt(camera.position.x, 1.2, camera.position.z - 14.5 * k);
  }
  sun.target.position.set(pp.x, 0, pp.z);
  if (state.mode === 'explore' && !busy) { const it = nearestInteract(); $('prompt').hidden = !it; if (it) $('prompt').textContent = 'E · ' + it.label; } else $('prompt').hidden = true;
  termStep(dt); smokeStep(dt); lifeStep(t, dt);
  mapAcc += dt; if (mapAcc > .1) { mapAcc = 0; if (!$('hud').hidden) drawMap($('miniMap'), false); if (mapBig) drawMap($('mapBigCv'), true); }
  { const pz = player.g.position.z, near = clamp((-pz - 262) / 30, 0, 1), aw = SPIRE.awaken || 0;
    for (const s of GLYPHS) { const u = s.userData; u.y += dt * u.sp; if (u.y > 14) u.y = 0; s.position.set(u.x + Math.sin(t * .5 + u.z) * .4, u.y, u.z); s.material.opacity = (near * .75 + aw * .25) * Math.min(1, u.y / 2) * Math.min(1, (14 - u.y) / 3); }
    for (const w of SPIRE.words) { const u = w.userData, a = u.a + t * (.18 + aw * .5), r = 9.5 + aw * 3; w.position.set(Math.cos(a) * r, u.y + Math.sin(t + u.a) * .6 + aw * 3, Math.sin(a) * r); w.material.opacity = .35 + near * .35 + aw * .3; const sc = 1 + aw * .6; w.scale.set(8 * sc, 2 * sc, 1); } }
  for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t += dt; const k = f.t / .8; f.sp.scale.setScalar(1 + k * 7); f.sp.material.opacity = Math.max(0, .9 * (1 - k)); if (k >= 1) { scene.remove(f.sp); fx.splice(i, 1); } }
  if (printT >= 0) { printT += dt; PRINTER.paper.position.z = Math.min(1.25, .3 + printT * .22); PRINTER.paper.position.y = .56 + Math.sin(printT * 9) * .004; }
  if (state.mode === 'explore') {
    const a = ACTS[cur]; let tg = null, bd = 1e9;
    if (a) for (const s of STN) { let ok = a.need.includes(s.id) && !stationDone(s); if (INSIDE_IDS.includes(s.id)) { if (!player.inside) ok = false; } else if (s.id === 'office') ok = !player.inside && cur === 3 && !a.need.every(id => save.visited.includes(id)); if (!ok) continue; const d = Math.hypot(s.x - pp.x, s.z - pp.z); if (d < bd) { bd = d; tg = [s.x, s.z]; } }
    if (tg) { const dx = tg[0] - pp.x, dz = tg[1] - pp.z; $('qArrow').style.transform = `rotate(${Math.atan2(dx, -dz)}rad)`; $('qDist').textContent = `${Math.round(Math.hypot(dx, dz))} m away`; $('qArrowRow').hidden = false; } else $('qArrowRow').hidden = true;
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').hidden = true; }
  draw(scene, camera);
  if (snapReq) snapGrab();
}

/* ---- input */
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (state.mode === 'folio') { if (['Escape', 'KeyE'].includes(e.code)) closeFolio(); else if (['ArrowRight', 'KeyD', 'Space', 'Enter'].includes(e.code)) slideNext(); else if (['ArrowLeft', 'KeyA'].includes(e.code)) showSlide(SL.i - 1); return; }
  if (state.mode === 'box') { if (e.code === 'Escape') boxQuit(); return; }
  if (state.mode === 'crab') { if (e.code === 'Escape') crabQuit(); else if (['KeyE', 'Space', 'Enter'].includes(e.code)) crabGrab(); return; }
  if (state.mode === 'map') { if (['Escape', 'KeyM', 'KeyE', 'Space', 'Enter'].includes(e.code)) toggleMap(false); return; }
  if (state.mode === 'explore' && !busy && !player.inside && e.code === 'KeyM') { toggleMap(true); return; }
  if (state.mode === 'term') { if (['Escape', 'KeyE', 'Space', 'Enter'].includes(e.code)) termKey(); return; }
  if (state.mode === 'dialog') { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') advance(); else if (/^Digit[1-4]$/.test(e.code)) pick(+e.code.slice(5) - 1); }
  else if (state.mode === 'explore' && !busy) { if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') interact(); else if (e.code === 'KeyC') envNext(); else if (e.code === 'KeyT') { ENV.hour = (ENV.hour + 3) % 24; toast('🕒 Time skips ahead', 'Three hours later.'); } }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('pointerdown', e => { if (state.mode === 'chess') ChessGame.pointer(e.clientX, e.clientY, innerWidth, innerHeight); });
$('dlg').addEventListener('click', () => advance());
async function interact() { if (state.mode !== 'explore' || busy) return; const s = nearestInteract(); if (s) await interactStation(s); }
$('actBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (state.mode === 'explore') interact(); else if (state.mode === 'term') termKey(); else if (state.mode === 'folio') closeFolio(); else if (state.mode === 'dialog') advance(); else if (state.mode === 'crab') crabGrab(); });
{
  const stick = $('stick'), knob = $('knob'); let id = null;
  const set = e => { const r = stick.getBoundingClientRect(), x = (e.clientX - r.left - 60) / 60, z = (e.clientY - r.top - 60) / 60, l = Math.hypot(x, z) || 1, k = Math.min(1, l); joy.x = x / l * k; joy.z = z / l * k; knob.style.transform = `translate(${joy.x * 35}px,${joy.z * 35}px)`; };
  stick.addEventListener('pointerdown', e => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === id) set(e); });
  const end = () => { id = null; joy.x = joy.z = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) $('touch').hidden = false;
}

/* ---- start */
function placeAtAct(i) {
  const spots = [[0, 40], [20, -30], [-14, -80], [-6, -150], [-18, -216]]; // fallbacks only used when resuming
  const s = spots[Math.min(i, 4)]; player.g.position.set(s[0], .07, s[1]);
}
async function begin(fresh) {
  try { if (ac && ac.state === 'suspended') ac.resume(); beep(520, .05); } catch (e) { }
  if (fresh) { resetSave(); save.reach = 0; save.vrank = 0; save.terms = []; save.orbs = []; }
  $('fade').classList.add('on'); await wait(500);
  $('title').hidden = true; $('hud').hidden = false; state.mode = 'explore';
  GATES.forEach((G, k) => { if (save.done.includes(k)) { openGate(k); G.t = 1; G.g.visible = false; } });
  if (save.done.includes(1)) save.reach = Math.max(save.reach || 0, S_CHESS + 1); if (save.done.includes(2)) save.reach = Math.max(save.reach || 0, S_COLLEGE + 1);
  save.orbs = save.orbs || []; for (const O of ORBS) { O.got = save.orbs.includes(O.i); O.g.visible = !O.got; }
  const c = curAct(); applyLook(c); player.g.scale.setScalar(targetScale); placeAtAct(c);
  player.v = 0; player.heading = Math.PI; camera.position.set(player.g.position.x, 12.5, player.g.position.z + 15);
  refreshHud(); if (!MAPB.img) bakeMap();
  $('fade').classList.remove('on'); await wait(500);
  if (c === 0 && fresh) { toast('A gully, a taped tennis ball', 'Every road starts somewhere small. Explore anywhere. Press E at glowing rings.'); toastT = 9; }
}
try { loadSave(); } catch (e) { }
if (save.done.length || save.visited.length) $('btnCont').hidden = false;
on('tabResume', e => { e.preventDefault(); resumePortal(); });
on('tabMap', e => { e.preventDefault(); if (state.mode === 'explore' && !busy) toggleMap(true); });
on('miniMap', () => { if (state.mode === 'explore' && !busy) toggleMap(true); });
on('mapBig', () => toggleMap(false));
$('btnNew').onclick = () => begin(true);
$('btnCont').onclick = () => begin(false);
{ const m = /act=(\d)/.exec(location.hash); if (m) { const n = +m[1]; save.done = [...Array(n).keys()]; if (n >= 3) save.visited.push('edu', 'ach'); if (n >= 4) save.visited.push('exp', 'ibm', 'ibb', 'city', 'skills'); window.__start = () => begin(false); } }
window.__j = { ENV, RAY, crabGame, runRayappan, get crabCtl() { return crabCtl; }, get stunt() { return stunt; }, setVehicle, enterOffice, leaveOffice, openFolio, OFFICE, INT, get AR() { return AR; }, arenaTrick, ARENA, pointAt, CUM, startStunt, playCricket, state, save, player, camera, STN, GATES, SPIRE, interact, completeAct, get busy() { return busy; }, pathNear, TOTAL };
refreshHud();
animate();
})();

