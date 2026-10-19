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
const camera = new T.PerspectiveCamera(48, 1, .1, 500);
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
{
  const g = new T.Group(); g.position.set(PITCH.cx, 0, PITCH.cz); world.add(g);
  add(g, new T.CylinderGeometry(PITCH.R, PITCH.R, .06, 56), mat(0x7fc15a), 0, .03, 0, false);
  add(g, new T.CylinderGeometry(PITCH.R * .7, PITCH.R * .7, .07, 48), mat(0x97d368), 0, .035, 0, false);
  const rope = add(g, new T.TorusGeometry(PITCH.R, .09, 6, 72), mat(0xfdf6e3), 0, .1, 0, false); rope.rotation.x = Math.PI / 2;
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; cyl(g, .05, .05, .5, 0xd8402a, Math.cos(a) * PITCH.R, .3, Math.sin(a) * PITCH.R, 5); }
  box(g, 3, .06, 12.8, 0xd9bd8a, 0, .1, 0, false);
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
{ const sg = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xfff1c0, transparent: true, opacity: .95, fog: false, depthWrite: false })); sg.scale.set(90, 90, 1); sg.position.set(-70, 80, -200); far.add(sg);
  const sc = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffffff, transparent: true, opacity: 1, fog: false, depthWrite: false })); sc.scale.set(30, 30, 1); sc.position.set(-70, 80, -199); far.add(sc); }
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
  g.scale.setScalar(o.scale || 1);
  return { g, body, legs, arms, torsoMat, legMat, head, setAge };
}
function walkAnim(p, phase, amt) {
  const s = Math.sin(phase) * .8 * amt;
  p.legs[0].rotation.x = s; p.legs[1].rotation.x = -s; p.arms[0].rotation.x = -s; p.arms[1].rotation.x = s;
  p.body.position.y = Math.abs(Math.sin(phase)) * .07 * amt;
}


/* ================================================================ THE JOURNEY */
const PATH = [[0, 44], [0, 0], [24, -14], [10, -44], [-14, -76], [-22, -100], [-6, -130], [-8, -160], [46, -160], [52, -190], [50, -215], [-20, -215], [-20, -250], [0, -285], [0, -318]];
const CUM = [0]; for (let i = 1; i < PATH.length; i++) CUM.push(CUM[i - 1] + Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]));
const TOTAL = CUM[CUM.length - 1], CORR = 60;
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
// dirt road
for (let i = 0; i < PATH.length - 1; i++) {
  const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], L = CUM[i + 1] - CUM[i];
  const t = dirtTex.clone(); t.needsUpdate = true; t.repeat.set(L / 5, 1);
  const m = add(world, new T.BoxGeometry(L, .06, 4.6), new T.MeshToonMaterial({ map: t, gradientMap: toonGrad }), (ax + bx) / 2, .03, (az + bz) / 2, false);
  m.rotation.y = -Math.atan2(bz - az, bx - ax); m.castShadow = false;
}
for (const [x, z] of PATH) add(world, new T.CylinderGeometry(2.3, 2.3, .06, 20), new T.MeshToonMaterial({ map: dirtTex, gradientMap: toonGrad }), x, .03, z, false).castShadow = false;
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
  cyl(g, .08, .08, 8, 0xdddddd, 13, 4, 5, 6); box(g, 2, 1.2, .05, 0xff9933, 14, 7.2, 5, false); box(g, 2, .4, .05, 0xffffff, 14, 6.6, 5, false); box(g, 2, .4, .05, 0x2e9a44, 14, 6.2, 5, false);
  walls.push({ x0: 0, x1: 24, z0: -174, z1: -164.4 });
  const r = ringAt(12, -162.4); STN.push({ id: 'edu', x: 12, z: -162.4, label: 'Visit · Bannari Amman Institute of Technology', kind: 'folio', act: 2, ...r });
}
// ---- landmarks: hackathon hall (college) and the working street
const ST0 = PORT.length;
landmark('ach', 36, -168, { title: 'HALL OF FAME', sub: 'BIT Hackathon', label: 'Hall of Fame · BIT Hackathon', wall: 0xf3e2b8, roof: 0xc4573a, w: 8, d: 6,
  prop: (g, w, d) => { cyl(g, .55, .7, .8, 0xd9d2c0, w / 2 + 1.4, .4, d / 2 - 1, 10); cyl(g, .38, .12, .55, 0xf2c14e, w / 2 + 1.4, 1.1, d / 2 - 1, 12); cyl(g, .08, .08, .4, 0xf2c14e, w / 2 + 1.4, 1.0, d / 2 - 1, 6); sph(g, .08, 0xf2c14e, w / 2 + 1.4, 1.5, d / 2 - 1); } });
landmark('exp', 42, -223, { title: 'GROOTAN TECH', sub: 'Experience', label: 'Grootan Technologies', wall: 0xcfe0f0, roof: 0x4f6fa8, tower: true, w: 8, d: 6,
  prop: (g, w, d) => { box(g, .1, 4, .1, 0x5a4a3a, -w / 2 + .6, 5.5, d / 2 - .4, false); box(g, 1.4, .8, .05, 0xe8a33d, -w / 2 + 1.3, 7, d / 2 - .4, false); } });
landmark('ibm', 28, -223, { title: 'IBM PKV', sub: 'Insurance · HSM keys', label: 'IBM PKV', wall: 0xf1d9a8, roof: 0x3f7a8a, w: 8, d: 6,
  prop: (g, w, d) => { const v = cyl(g, .9, .9, .25, 0xb8bcc4, w / 2 + .1, 1.5, 0, 22); v.rotation.z = Math.PI / 2; for (let k = 0; k < 6; k++) { const sp = box(g, .08, .08, 1.5, 0x8a8e96, w / 2 + .3, 1.5, 0, false); sp.rotation.x = k * Math.PI / 6; } sph(g, .25, 0xe8c25a, w / 2 + .35, 1.5, 0); } });
landmark('ibb', 14, -223, { title: 'IBB · ISTANBUL', sub: 'Istanbul Senin', label: 'IBB Istanbul Senin', wall: 0xf4e3d3, roof: 0x3a8a9a, dome: true, w: 8, d: 6,
  prop: (g, w, d) => { cyl(g, .22, .26, 6.5, 0xf4e3d3, -w / 2 - .5, 3.25, -d / 2, 10); const t = new T.Mesh(new T.ConeGeometry(.4, 1.4, 10), mat(0x3a8a9a)); t.position.set(-w / 2 - .5, 7.2, -d / 2); g.add(t); } });
landmark('city', 0, -223, { title: 'CITYAPP · WORMS', sub: 'Nibelungenstadt', label: 'CityApp · Worms', wall: 0xfaf0dc, roof: 0xb5532b, timber: true, w: 8, d: 6 });
landmark('skills', -14, -223, { title: 'TOOL SHED', sub: 'Skills', label: 'The Tool Shed', wall: 0xc9a46c, roof: 0x6b8f4a, w: 8, d: 6,
  prop: (g, w, d) => { const gr = new T.Mesh(new T.TorusGeometry(.9, .24, 8, 10), mat(0xb8bcc4)); gr.position.set(-w / 2 - .1, 2.2, 1); gr.rotation.y = Math.PI / 2; g.add(gr); for (let k = 0; k < 8; k++) { const tt = box(g, .3, .36, .3, 0xb8bcc4, -w / 2 - .1, 2.2 + Math.sin(k * .785) * 1.15, 1 + Math.cos(k * .785) * 1.15, false); tt.rotation.x = -k * .785; } for (let k = 0; k < 3; k++) box(g, 1.6, .1, .5, 0x7a4a2c, w / 2 + .9, .6 + k * .6, -1, false); } });
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
  const blocked = (x, z) => walls.some(w => x > w.x0 - 4 && x < w.x1 + 4 && z > w.z0 - 4 && z < w.z1 + 4) || rounds.some(r => Math.hypot(r.x - x, r.z - z) < r.r + 3.5 && !r.gate) || stn.some(([a, b]) => Math.hypot(a - x, b - z) < 5) || Math.hypot(x - PITCH.cx, z - PITCH.cz) < PITCH.R + 4 || Math.hypot(x, z + 334) < 16;
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
  trike: { max: 8.4, acc: 8, turn: 5, seat: { y: -.1, z: -.2, lean: 0 }, build() {
    const g = new T.Group(), red = 0xd94e47, gold = 0xf1ca68;
    const front = wheelOf(g, .3, .07, .6), rl = wheelOf(g, .27, .07, -.5), rr = wheelOf(g, .27, .07, -.5); rl.position.x = -.32; rr.position.x = .32;
    barOf(g, [0, .62, -.45], [0, .6, .1], .05, red); barOf(g, [0, .6, .1], [0, .35, .6], .05, red);
    barOf(g, [-.32, .27, -.5], [0, .62, -.45], .04, gold); barOf(g, [.32, .27, -.5], [0, .62, -.45], .04, gold);
    barOf(g, [0, .35, .6], [0, 1.0, .5], .05, red); barOf(g, [-.3, 1.0, .5], [.3, 1.0, .5], .05, gold);
    box(g, .46, .1, .34, 0x4b6d79, 0, .66, -.25);
    for (const sd of [-1, 1]) { const p = box(g, .09, .05, .16, gold, 0, 0, 0, false); front.add(p); p.position.set(sd * .22, sd * .13, 0); }
    return { g, wheels: [front, rl, rr], front };
  } },
  bike: { max: 8.6, acc: 3.2, turn: 4, seat: { y: .27, z: -.2, lean: .3 }, build() {
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
  moto: { max: 12, acc: 3, turn: 3.4, seat: { y: .3, z: -.42, lean: .12 }, build() {
    const g = new T.Group(), RED = 0xd8402f, BLK = 0x2b2b30, WHT = 0xf3efe4, GRY = 0xb8bcc4, GOLD = 0xd9a441;
    const fw = wheelOf(g, .46, .1, .9, 0x2a2420, 22), rw = wheelOf(g, .42, .12, -.86, 0x2a2420, 22);
    for (const w of [fw, rw]) { const rim = new T.Mesh(new T.TorusGeometry(w.userData.r * .8, .022, 6, 28), mat(GRY)); rim.rotation.y = Math.PI / 2; w.add(rim); }
    box(g, .34, .4, .66, 0x3a3a42, 0, .55, 0); box(g, .3, .22, .3, 0x4a4a54, 0, .82, -.05);
    barOf(g, [0, .95, .42], [0, .55, .12], .05, BLK); barOf(g, [0, .55, .12], [0, .45, -.2], .05, BLK); barOf(g, [0, .9, .4], [0, .95, -.3], .05, BLK);
    sph(g, .3, RED, 0, 1.02, .18, .9, .72, 1.45);
    for (const sg of [-1, 1]) { const sh = box(g, .08, .3, .52, WHT, sg * .23, .94, .12); sh.rotation.x = .1; }
    box(g, .3, .09, .82, BLK, 0, 1.0, -.52); const tail = box(g, .26, .08, .46, BLK, 0, 1.07, -1.0); tail.rotation.x = .2;
    barOf(g, [0, .55, -.1], [0, .43, -.86], .045, BLK); barOf(g, [0, .92, -.5], [0, .6, -.4], .04, GOLD);
    for (const sg of [-1, 1]) { barOf(g, [sg * .11, 1.3, .55], [sg * .11, .48, .9], .045, 0x2a2a2a); barOf(g, [sg * .11, .95, .7], [sg * .11, .55, .86], .06, GOLD); }
    const fm = box(g, .2, .05, .64, WHT, 0, .93, .98); fm.rotation.x = -.18; box(g, .2, .05, .12, RED, 0, .98, 1.3).rotation.x = -.5;
    const nose = box(g, .4, .34, .2, WHT, 0, 1.34, .68); nose.rotation.x = -.25;
    add(g, new T.SphereGeometry(.13, 12, 9), new T.MeshBasicMaterial({ color: new T.Color(0xfff0a8).multiplyScalar(1.4) }), 0, 1.3, .8, false);
    const ws = new T.Mesh(new T.BoxGeometry(.36, .4, .02), new T.MeshToonMaterial({ color: 0xaedcf0, gradientMap: toonGrad, transparent: true, opacity: .55 })); ws.position.set(0, 1.66, .6); ws.rotation.x = -.5; g.add(ws);
    barOf(g, [0, 1.24, .5], [0, 1.32, .5], .04, BLK); barOf(g, [-.47, 1.34, .5], [.47, 1.34, .5], .03, BLK);
    for (const sg of [-1, 1]) { box(g, .06, .2, .14, RED, sg * .5, 1.38, .56); sph(g, .05, 0x222222, sg * .46, 1.34, .5); }
    const ex = cyl(g, .075, .09, .85, 0xc8ccd4, .3, .76, -.5, 10); ex.rotation.x = 1.3; box(g, .05, .1, .5, BLK, .36, .72, -.5).rotation.x = .25;
    barOf(g, [.2, .5, .1], [.3, .62, -.15], .05, GRY);
    for (const sg of [-1, 1]) box(g, .08, .04, .16, GRY, sg * .3, .42, -.18, false);
    box(g, .12, .06, .05, 0xff3030, 0, 1.12, -1.24, false); box(g, .32, .03, .5, BLK, 0, 1.12, -1.15);
    return { g, wheels: [fw, rw] };
  } },
};
function setSeat() { const s = player.veh.cfg.seat; player.body.position.set(0, s.y, s.z); player.body.rotation.set(s.lean, 0, 0); }
function setVehicle(type) {
  if (player.veh && player.veh.type === type) return;
  if (player.veh) player.veh.d.g.visible = false;
  player.vehCache = player.vehCache || {};
  if (!player.vehCache[type]) { const d = VEH[type].build(); player.g.add(d.g); player.vehCache[type] = { type, d, cfg: VEH[type] }; }
  player.veh = player.vehCache[type]; player.veh.d.g.visible = true; setSeat();
}
function hideVehicle(on) {
  player.veh.d.g.visible = !on;
  if (on) { player.body.position.set(0, 0, 0); player.body.rotation.set(0, 0, 0); } else setSeat();
}
function rideAnim(dt, v) {
  const V = player.veh, d = V.d;
  for (const w of d.wheels) w.rotation.x += v * dt / w.userData.r;
  if (V.type === 'trike') { const ph = d.front.rotation.x; player.legs[0].rotation.x = -1.0 + Math.sin(ph) * .4; player.legs[1].rotation.x = -1.0 - Math.sin(ph) * .4; player.arms[0].rotation.x = player.arms[1].rotation.x = -1.0; }
  else if (V.type === 'bike') { d.crank.rotation.x += v * dt * 2.2; const ph = d.crank.rotation.x; player.legs[0].rotation.x = -.6 + Math.sin(ph) * .5; player.legs[1].rotation.x = -.6 - Math.sin(ph) * .5; player.arms[0].rotation.x = player.arms[1].rotation.x = -.95; }
  else { player.legs[0].rotation.x = player.legs[1].rotation.x = -1.15; player.arms[0].rotation.x = player.arms[1].rotation.x = -1.0; }
}
const vehicleFor = i => i < 1 ? 'trike' : i < 4 ? 'bike' : 'moto';



const LOOKS = [[0xf0a44b, 0xeadcc0, .62, 'kid', 'trike'], [0xb7a2dc, 0x2b3a6b, .74, 'kid', 'bike'], [0xf4f0e6, 0x3a3a48, .9, 'teen', 'bike'], [0x7a2d3f, 0xc9b48a, 1, 'adult', 'moto'], [0x7a2d3f, 0xc9b48a, 1, 'adult', 'moto']];
const VEHNAME = { trike: 'a red tricycle', bike: 'a cycle', moto: 'an XPulse-style adventure bike' };
let targetScale = .62;
setVehicle('trike');
function applyLook(i) { const L = LOOKS[Math.min(i, 4)]; player.torsoMat.color.setHex(L[0]); player.legMat.color.setHex(L[1]); targetScale = L[2]; player.setAge(L[3]); setVehicle(stageVeh()); }
const S_CHESS = pathNear(-22.2, -88.8).s + 8, S_COLLEGE = pathNear(12, -162.4).s + 8;
function stageVeh() { const r = save.reach || 0; return r > S_COLLEGE ? 'moto' : r > S_CHESS ? 'bike' : 'trike'; }
// ---- sky / light progression
const SKY = { day: ['#3f86d8', '#7fbbea', '#cfe6ee', '#f6ecd0'], gold: ['#4a7fd0', '#a8c8e8', '#f9dfb0', '#ffd9a0'], storm: ['#2a3a78', '#6a6aa8', '#d49ab0', '#ffd09a'], dawn: ['#2e5fae', '#f2a8b8', '#ffd7a0', '#fff3c4'] };
const mixHex = (a, b, t) => '#' + new T.Color(a).lerp(new T.Color(b), t).getHexString();
function skyFor(p, aw) {
  let A, B, t;
  if (p < .35) { A = SKY.day; B = SKY.day; t = 0; } else if (p < .62) { A = SKY.day; B = SKY.gold; t = (p - .35) / .27; } else if (p < .82) { A = SKY.gold; B = SKY.storm; t = (p - .62) / .2; } else { A = SKY.storm; B = SKY.storm; t = 0; }
  return A.map((c, i) => mixHex(mixHex(c, B[i], t), SKY.dawn[i], aw));
}
let skyKey = '';
function paintSky(p, aw) {
  const key = Math.round(p * 60) + ':' + Math.round(aw * 40); if (key === skyKey) return; skyKey = key;
  const st = skyFor(p, aw), x = skyCanvas.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, st[0]); g.addColorStop(.45, st[1]); g.addColorStop(.8, st[2]); g.addColorStop(1, st[3]); x.fillStyle = g; x.fillRect(0, 0, 2, 256); skyTex.needsUpdate = true;
  scene.fog.color.set(st[3]); hemi.color.set(st[1]); hemi.intensity = 1.05 - .1 * clamp((p - .7) / .3, 0, 1) * (1 - aw);
  sun.color.set(p < .55 ? '#fff0cf' : mixHex('#fff0cf', '#ffd0a0', clamp((p - .55) / .35, 0, 1))); sun.color.lerp(new T.Color('#ffe3b8'), aw); sun.intensity = 2.5 - .35 * clamp((p - .7) / .3, 0, 1) * (1 - aw);
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
  if (!dlg || !dlg.waitingChoice) return;
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
    const onKey = e => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') done(); };
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
  ibm: { icon: '🔐', title: 'IBM PKV', sub: 'Insurance Provider', blocks: [{ items: [
    'Designed and implemented secure key management with Hardware Security Modules (HSMs) to protect cryptographic keys from extraction or misuse.',
    'Wrote data validation and cleanup scripts for production and pre-production environments.',
    'Implemented notification triggers based on authentication events, user actions and insurance workflow status.',
    'Integrated external video identification (Video-Ident) providers for secure remote identity verification.'] }] },
  ibb: { icon: '🕌', title: 'IBB · Istanbul Senin', sub: 'Istanbul city app', blocks: [{ items: [
    'Worked closely with product, QA and DevOps teams to deliver secure and scalable features.',
    'Debugged and resolved production issues across authentication, database queries and user access.',
    'Owned features end to end, from requirement understanding to deployment and post-release support.'] }] },
  city: { icon: '🏰', title: 'CityApp · Nibelungenstadt Worms', sub: 'Municipal citizen app', blocks: [{ items: [
    'Designed and implemented a centralized consent management system to capture, store and validate user consents, in line with GDPR and municipal data protection policies.',
    'Integrated Keycloak with backend services using OAuth 2.0 / OpenID Connect for secure token-based communication.'] }] },
  skills: { icon: '🧰', title: 'The Tool Shed', sub: 'Technical skills', blocks: [], chips: [
    ['Languages', ['Java', 'JPA', 'JDBC', 'JavaScript']], ['Frameworks', ['Spring Boot', 'ReactJS']], ['Database', ['PostgreSQL', 'MySQL']], ['Tools', ['Git', 'Docker', 'Keycloak']]] },
  ach: { icon: '🏆', title: 'Hall of Fame', sub: 'Achievements', blocks: [{ h: 'BIT Hackathon · Finalist', items: ['Finalist in a highly competitive hackathon conducted by BIT, for innovative problem-solving.'] }] },
  edu: { icon: '🎓', title: 'Bannari Amman Institute of Technology', sub: 'Sathyamangalam, India', blocks: [{ h: 'Bachelor of Engineering · Information Science and Engineering', meta: '2020 – 2024', items: ['CGPA: 8.3'] }] },
  contact: { icon: '✉️', title: 'Say hello', sub: 'Jeeva S U · Software Engineer', blocks: [], contact: [['📞', '+91 75388 81377', 'tel:+917538881377'], ['✉️', 'jeev102003@gmail.com', 'mailto:jeev102003@gmail.com']] },
};
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function openFolio(id) {
  const d = FOLIO[id]; if (!d) return;
  let h = `<div class="fhead">${d.photo ? '<img class="mePhoto" src="assets/me.jpg" alt="" onerror="this.remove()">' : ''}<div class="ficon">${d.icon}</div><div><h2>${esc(d.title)}</h2><p>${esc(d.sub)}</p></div></div>`;
  for (const b of d.blocks) h += `<div class="fblock">${b.h ? `<h3>${esc(b.h)}</h3>` : ''}${b.meta ? `<small>${esc(b.meta)}</small>` : ''}<ul>${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
  if (d.chips) h += d.chips.map(([k, v]) => `<div class="fblock"><h3>${k}</h3><div class="chips">${v.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>`).join('');
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
  { name: 'Work', emoji: '💼', title: 'The Working Street', hint: 'Walk the street: Grootan Technologies, three projects and the tool shed.', need: ['exp', 'ibm', 'ibb', 'city', 'skills'], folio: true },
  { name: 'AI', emoji: '✨', title: 'The Big Picture', hint: 'A tower of light stands at the end of the road. Walk up to it.', need: ['ai'] },
];
const CARDS = [
  ['🏏', 'Last Ball, Last Over', 'Evenings ran on one rule: the game ends when someone\'s mother calls from the balcony. First lesson: timing is everything.', 'Chapter 1'],
  ['♟️', 'Thatha\'s Gambit', 'A chipped board and a grandfather who taught me to think two moves ahead. Patience became a habit.', 'Chapter 2'],
  ['🎓', 'B.I.T., 2020 – 2024', 'B.E. in Information Science and Engineering, CGPA 8.3, and a BIT Hackathon finalist for innovative problem-solving.', 'Chapter 3'],
  ['💼', 'Grootan Technologies', 'Intern in June 2023, Software Engineer Level 1 since May 2024: secure authentication for banks in Europe, IBM, and a city in Germany.', 'Chapter 4'],
];
const curAct = () => { for (let i = 0; i < ACTS.length; i++) if (!save.done.includes(i)) return i; return ACTS.length; };
const stationDone = s => s.kind === 'folio' ? save.visited.includes(s.id) : save.done.includes(s.act);
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
async function playChess() {
  state.mode = 'chess'; $('hud').hidden = true; ChessGame.resize(innerWidth, innerHeight);
  const res = await ChessGame.play();
  state.mode = 'explore'; $('hud').hidden = false;
  return res;
}
const runStory = {
  async ravi() {
    busy = true;
    await say([A('Ravi', 'Six balls, one over. Beat 12 runs or the Gandhi Street gang will never let us forget it.'), A('Ravi', 'You bat, I bowl. Press SPACE just as the ball reaches your bat. Perfect timing is a six! Hold A or D to aim.')]);
    let tries = 0, r;
    while (true) { r = await playCricket(); tries++; if (r.won || tries >= 3) break; await say([A('Ravi', `${r.runs} runs. So close! Everyone gets another over. Rules are for grown-ups.`)]); }
    await say([A('Ravi', r.won ? 'Cracking six! Go on, the road is waiting.' : 'Fine, fine, you earned it. Go on, the road is waiting.')]);
    busy = false; await completeAct(0);
  },
  async thatha() {
    busy = true;
    await say([A('Thatha', 'Sit. Today we play a real game.'), A('Thatha', 'You have White, the cream pieces. Click a piece, then a green square. Use Hint if you are stuck. I will go easy on you. A little.')]);
    const res = await playChess();
    if (res === 'win') await say([A('Thatha', 'Hm. Hm! Well played. Do not tell your grandmother I lost.')]);
    else if (res === 'draw') await say([A('Thatha', 'A draw. That is how you know a worthy opponent.')]);
    else await say([A('Thatha', 'The back rank, always the back rank. Next time, hmm? Go on, your road is waiting.')]);
    busy = false; await completeAct(1);
  },
  async ai() {
    busy = true;
    await say([
      NAR('The road ends at a tower of light, humming somewhere above the clouds.'),
      NAR('Machines that write code, answer questions and change how software gets built. Everything on this road is about to change.'),
      { who: '', text: 'Every road so far started with something I did not know how to do. What about this one?', choices: [
        { label: 'It is a lot.', reply: [NAR('A lot is just a challenge with the volume turned up.')] },
        { label: 'Challenge accepted.', reply: [NAR('Good. Walk into the light.')] }] },
    ]);
    await finale();
  },
};
let printT = -1, resumeGuide = false, away = null;
const fx = [];
function poof(x, z, col = 0x9be8ff) {
  const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: col, transparent: true, opacity: .9, depthWrite: false })); sp.position.set(x, 1.1, z); sp.scale.set(1, 1, 1); scene.add(sp); fx.push({ sp, t: 0 });
}
async function portal(midFn) {
  const el = $('fade'); el.classList.add('on'); await wait(650);
  midFn(); await wait(250); el.classList.remove('on'); await wait(600);
}
function swapVehicle(v, silent) {
  if (player.veh.type === v) return;
  setVehicle(v); player.g.scale.setScalar(.01); poof(player.g.position.x, player.g.position.z, 0xffe9a8);
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
    setVehicle('moto'); player.g.scale.setScalar(.01);
  });
  toast('Grootan Technologies', 'You are at the printer. Press E to print your resume. Click Resume again to head back.');
  busy = false;
}
async function returnFromPrinter() {
  if (!away) return; busy = true; const a = away;
  await portal(() => {
    player.g.position.set(a.x, .07, a.z); player.heading = a.h; player.g.rotation.y = a.h; player.v = 0;
    camera.position.set(a.cx, camera.position.y, a.cz);
    setVehicle(a.veh); player.g.scale.setScalar(.01);
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
async function interactStation(s) {
  if (s.kind === 'print') { await printResume(); return; }
  if (s.kind === 'folio') { openFolio(s.id); return; }
  if (save.done.includes(s.act) && s.id !== 'ai') {
    if (s.id === 'ravi') await say([A('Ravi', '"Another over? Fine, but no crying this time."')]);
    else if (s.id === 'thatha') await say([A('Thatha', '"Chess is just patience wearing a costume."')]);
    return;
  }
  await runStory[s.id]();
}

/* ---- finale: challenge accepted */
async function finale() {
  state.mode = 'cut'; $('hud').hidden = true; busy = true;
  const p0 = player.g.position.clone(), cam0 = camera.position.clone(); let t = 0;
  player.v = 0; player.heading = Math.PI; player.g.rotation.y = Math.PI; player.legs.forEach(l => l.rotation.x = 0);
  await new Promise(resolve => {
    ticker = dt => {
      t += dt; const k = clamp(t / 7, 0, 1), e = k * k * (3 - 2 * k);
      SPIRE.awaken = e;
      const tx = lerp(cam0.x, 0, e), ty = lerp(cam0.y, 19, e), tz = lerp(cam0.z, p0.z + 32, e);
      camera.position.set(tx, ty, tz); camera.lookAt(0, lerp(1.2, 21, e), lerp(p0.z - 14, -334, e));
      player.arms[0].rotation.x = player.arms[1].rotation.x = -lerp(.2, 3.0, clamp(t / 2.5, 0, 1));
      player.body.position.y = Math.abs(Math.sin(t * 6)) * .05 * (1 - e); player.g.position.y = e > .5 ? .07 + Math.sin((e - .5) * 3) * .02 : .07;
      if (t >= 7.5) { ticker = null; resolve(); }
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
  const V = player.veh, cfg = V.cfg, p = player.g.position;
  const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
  const iz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + joy.z;
  const len = Math.hypot(ix, iz), drive = state.mode === 'explore' && !busy;
  const max = cfg.max;
  let target = 0, dh = 0;
  if (drive && len > .1) {
    const k = Math.min(1, len); let da = Math.atan2(ix, iz) - player.heading; da = Math.atan2(Math.sin(da), Math.cos(da));
    const tr = cfg.turn * (1.6 - .8 * Math.min(1, player.v / cfg.max)), step = clamp(da, -tr * dt, tr * dt);
    player.heading += step; dh = step / Math.max(dt, 1e-4); target = max * k * (Math.abs(da) > 1.8 ? .4 : 1);
  }
  player.v += (target - player.v) * Math.min(1, dt * (target > player.v ? cfg.acc : cfg.acc * 1.8));
  if (target === 0 && player.v < .05) player.v = 0;
  const px = p.x, pz = p.z; p.x += Math.sin(player.heading) * player.v * dt; p.z += Math.cos(player.heading) * player.v * dt;
  const R = .5 * player.g.scale.x + .3;
  for (const w of walls) { const cx = clamp(p.x, w.x0, w.x1), cz = clamp(p.z, w.z0, w.z1), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz); if (d < R) { if (d > 1e-4) { p.x = cx + dx / d * R; p.z = cz + dz / d * R; } else p.x = w.x0 - R; } }
  for (const r of rounds) { const dx = p.x - r.x, dz = p.z - r.z, d = Math.hypot(dx, dz), m = r.r + R; if (d < m && d > 1e-4) { p.x = r.x + dx / d * m; p.z = r.z + dz / d * m; } }
  const n = pathNear(p.x, p.z); if (n.d > CORR) { p.x = n.px + (p.x - n.px) / n.d * CORR; p.z = n.pz + (p.z - n.pz) / n.d * CORR; }
  if (Math.hypot(p.x - px, p.z - pz) > .02 + player.v * dt * .9 && player.v > 0) player.v *= .85;
  player.g.rotation.y = player.heading;
  player.lean = lerp(player.lean, clamp(-dh * .1 * (player.v / cfg.max), -.35, .35), Math.min(1, dt * 8));
  V.d.g.rotation.z = player.lean; player.body.rotation.z = player.lean * .6;
  rideAnim(dt, player.v);
}
const clock = new T.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  if (state.mode === 'chess') { ChessGame.update(dt); draw(ChessGame.scene, ChessGame.camera); return; }
  if (dlg && !dlg.full) { dlg.pos += dt * 55; const l = dlg.q[dlg.i]; const n = Math.floor(dlg.pos); $('dlgText').textContent = l.text.slice(0, n); if (n % 3 === 0) beep(300 + (n % 5) * 20, .02, 'square', .012); if (n >= l.text.length) finishText(); }
  if (state.mode === 'explore' && player.veh && !away) { const n = pathNear(player.g.position.x, player.g.position.z); if (n.d < 25 && n.s > (save.reach || 0)) { save.reach = n.s; const v = stageVeh(); if (v !== player.veh.type) { swapVehicle(v); persist(); } } }
  const sc = lerp(player.g.scale.x, targetScale, 1 - Math.exp(-dt * 3)); player.g.scale.setScalar(sc);
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
  paintSky(prog, SPIRE.awaken);
  far.position.set(pp.x, 0, pp.z);
  clouds.forEach((c, i) => { c.position.x += dt * (1 + i * .1); if (c.position.x > 180) c.position.x = -180; });
  const mp = motes.geometry.attributes.position; for (let i = 0; i < mp.count; i++) { mp.array[i * 3 + 1] += Math.sin(t + i) * .004 + .004; mp.array[i * 3] += Math.sin(t * .3 + i) * .004; if (mp.array[i * 3 + 1] > 10) mp.array[i * 3 + 1] = 0; }
  mp.needsUpdate = true; motes.position.set(pp.x, 0, pp.z);
  if (!ticker) {
    const k = .62 + .38 * sc, wantX = pp.x + Math.sin(player.heading) * player.v * .25, wantZ = pp.z + 15 * k + Math.cos(player.heading) * player.v * .25;
    camera.position.x = lerp(camera.position.x, wantX, 1 - Math.exp(-dt * 4)); camera.position.z = lerp(camera.position.z, wantZ, 1 - Math.exp(-dt * 4)); camera.position.y = lerp(camera.position.y, 12.5 * k, 1 - Math.exp(-dt * 4));
    camera.lookAt(camera.position.x, 1.2, camera.position.z - 14.5 * k);
  }
  sun.position.set(pp.x - 22, 34, pp.z + 14); sun.target.position.set(pp.x, 0, pp.z);
  if (state.mode === 'explore' && !busy) { const it = nearestInteract(); $('prompt').hidden = !it; if (it) $('prompt').textContent = 'E · ' + it.label; } else $('prompt').hidden = true;
  for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t += dt; const k = f.t / .8; f.sp.scale.setScalar(1 + k * 7); f.sp.material.opacity = Math.max(0, .9 * (1 - k)); if (k >= 1) { scene.remove(f.sp); fx.splice(i, 1); } }
  if (printT >= 0) { printT += dt; PRINTER.paper.position.z = Math.min(1.25, .3 + printT * .22); PRINTER.paper.position.y = .56 + Math.sin(printT * 9) * .004; }
  if (state.mode === 'explore') {
    const a = ACTS[cur]; let tg = null, bd = 1e9;
    if (a) for (const s of STN) { if (!a.need.includes(s.id) || stationDone(s)) continue; const d = Math.hypot(s.x - pp.x, s.z - pp.z); if (d < bd) { bd = d; tg = [s.x, s.z]; } }
    if (tg) { const dx = tg[0] - pp.x, dz = tg[1] - pp.z; $('qArrow').style.transform = `rotate(${Math.atan2(dx, -dz)}rad)`; $('qDist').textContent = `${Math.round(Math.hypot(dx, dz))} m away`; $('qArrowRow').hidden = false; } else $('qArrowRow').hidden = true;
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').hidden = true; }
  draw(scene, camera);
}

/* ---- input */
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (state.mode === 'folio') { if (['Escape', 'KeyE', 'Space', 'Enter'].includes(e.code)) closeFolio(); return; }
  if (state.mode === 'dialog') { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') advance(); else if (/^Digit[1-4]$/.test(e.code)) pick(+e.code.slice(5) - 1); }
  else if (state.mode === 'explore' && !busy) { if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') interact(); }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('pointerdown', e => { if (state.mode === 'chess') ChessGame.pointer(e.clientX, e.clientY, innerWidth, innerHeight); });
$('dlg').addEventListener('click', () => advance());
async function interact() { if (state.mode !== 'explore' || busy) return; const s = nearestInteract(); if (s) await interactStation(s); }
$('actBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (state.mode === 'explore') interact(); else if (state.mode === 'folio') closeFolio(); else if (state.mode === 'dialog') advance(); });
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
  if (fresh) { resetSave(); save.reach = 0; }
  $('fade').classList.add('on'); await wait(500);
  $('title').hidden = true; $('hud').hidden = false; state.mode = 'explore';
  GATES.forEach((G, k) => { if (save.done.includes(k)) { openGate(k); G.t = 1; G.g.visible = false; } });
  if (save.done.includes(1)) save.reach = Math.max(save.reach || 0, S_CHESS + 1); if (save.done.includes(2)) save.reach = Math.max(save.reach || 0, S_COLLEGE + 1);
  const c = curAct(); applyLook(c); player.g.scale.setScalar(targetScale); placeAtAct(c);
  player.v = 0; player.heading = Math.PI; camera.position.set(player.g.position.x, 12.5, player.g.position.z + 15);
  refreshHud();
  $('fade').classList.remove('on'); await wait(500);
  if (c === 0 && fresh) { toast('A gully, a taped tennis ball', 'Every road starts somewhere small. Explore anywhere. Press E at glowing rings.'); toastT = 9; }
}
try { loadSave(); } catch (e) { }
if (save.done.length || save.visited.length) $('btnCont').hidden = false;
$('tabResume').onclick = e => { e.preventDefault(); resumePortal(); };
$('btnNew').onclick = () => begin(true);
$('btnCont').onclick = () => begin(false);
{ const m = /act=(\d)/.exec(location.hash); if (m) { const n = +m[1]; save.done = [...Array(n).keys()]; if (n >= 3) save.visited.push('edu', 'ach'); if (n >= 4) save.visited.push('exp', 'ibm', 'ibb', 'city', 'skills'); window.__start = () => begin(false); } }
window.__j = { playCricket, state, save, player, camera, STN, GATES, SPIRE, interact, completeAct, get busy() { return busy; }, pathNear, TOTAL };
refreshHud();
animate();
})();
