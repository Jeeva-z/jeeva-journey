/* First-person sparring against Vembuli in Beedi Rayappan's ring.
   Punches come from the webcam: MediaPipe Hand Landmarker finds both hands, a fist pushed straight at the lens is a punch, and an open palm held up to the camera is a block.
   Waving, lifting or swinging a fist sideways never counts.
   Leaning your head sideways is a dodge (tracked with MediaPipe's face detector). Camera only: no keyboard or mouse actions. A short warm-up checks each gesture off as the camera sees it.
   Video never leaves the browser. */
(() => {
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const FACE = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const DMG = { straight: 5 };
  const ROUND_T = 40, ROUNDS = 2, HIS_HP = 240, MY_HP = 100;
  const TAUNT = ['Come on, little boy!', 'Is that all you have?', 'My grandmother hits harder!', 'Hands up. Or go home.', 'Hm. Tickling me?', 'Stand still!'];
  const CORNER = ['Palm up, thambi!', 'Watch his shoulder before the swing!', 'Counter! He is open!', 'Keep moving. Breathe!', 'Jab! Push it straight at him!'];

  /* ---------------------------------------------------------- hand tracking */
  const dist = (a, b) => Math.hypot((a.x - b.x) * 4 / 3, a.y - b.y, ((a.z || 0) - (b.z || 0)) * 4 / 3);   // x, y, z in the same units, so a hand pointing at the lens still measures true
  function makeSlot() { return { vis: false, x: .5, y: .6, s: .12, fist: false, open: false, fistT: -9, hist: [], lastPunch: -9, seen: -9, armed: true, peak: 0, born: -9, reach: 0, cand: null }; }
  async function openCamera(video, say) {
    say('Allow the camera so Rayappan can see your punches…');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream; await video.play();
    say('Loading hand tracking…');
    const vis = await import(MP + '/vision_bundle.mjs'), fs = await vis.FilesetResolver.forVisionTasks(MP + '/wasm');
    let lm;
    for (const delegate of ['GPU', 'CPU']) {
      try { lm = await vis.HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .45, minHandPresenceConfidence: .45, minTrackingConfidence: .45 }); break; } catch (er) { if (delegate === 'CPU') throw er; }
    }
    // the tracker is fed a mirrored copy (like a selfie), so x runs the way the player sees it and Left / Right labels are the player's own hands
    const feed = document.createElement('canvas'); feed.width = 480; feed.height = 360;
    let face = null;   // optional: if it fails to load, dodging falls back to a two-hand sideways sweep
    for (const delegate of ['GPU', 'CPU']) { try { face = await vis.FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: FACE, delegate }, runningMode: 'VIDEO', minDetectionConfidence: .5 }); break; } catch (er) { } }
    return { stream, lm, face, feed, fctx: feed.getContext('2d'), flip: true, swap: false };
  }
  const CAL_KEY = 'bxCal';
  function loadCal(tr) { try { const c = JSON.parse(localStorage.getItem(CAL_KEY)); if (c) { tr.flip = c.flip !== false; tr.swap = !!c.swap; tr.saved = true; } } catch (er) { } }
  function saveCal(tr) { try { localStorage.setItem(CAL_KEY, JSON.stringify({ flip: tr.flip !== false, swap: !!tr.swap })); tr.saved = true; } catch (er) { } }
  function grab(tr, video) { tr.fctx.setTransform(tr.flip === false ? 1 : -1, 0, 0, 1, tr.flip === false ? 0 : tr.feed.width, 0); tr.fctx.drawImage(video, 0, 0, tr.feed.width, tr.feed.height); return tr.feed; }
  /* turns landmarks into two slots [left, right] (what the player sees: left hand on the left of the screen) and reports punches the moment they start.
     opts.swap flips the Left/Right labels; it is learned in the warm-up because cameras and browsers disagree about mirroring */
  function readHands(lm, src, slots, now, onPunch, opts) {
    const swap = !!(opts && opts.swap), res = lm.detectForVideo(src, now * 1000), labels = res.handedness || res.handednesses || [];
    const hands = (res.landmarks || []).map((L, k) => {
      const d2 = (a, b) => Math.hypot((a.x - b.x) * 4 / 3, a.y - b.y), w = L[0], palm2 = (d2(L[5], L[17]) + d2(L[0], L[9]) + d2(L[0], L[5]) + d2(L[0], L[17])) / 4, palm = (dist(L[5], L[17]) + dist(L[0], L[9]) + dist(L[0], L[5]) + dist(L[0], L[17])) / 4;   // 3D, so turning the hand does not read as moving it closer
      const curled = [[8, 5], [12, 9], [16, 13], [20, 17]].filter(([t, m]) => dist(L[t], w) < dist(L[m], w) * 1.2).length;
      const straight = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([t, pp]) => dist(L[t], w) > dist(L[pp], w) * 1.08).length;
      const lab = labels[k] && labels[k][0] && labels[k][0].categoryName, raw = lab === 'Left' ? 0 : lab === 'Right' ? 1 : -1;
      return { x: (L[0].x + L[5].x + L[9].x + L[17].x) / 4, y: (L[0].y + L[5].y + L[9].y + L[17].y) / 4, s: palm, s2: palm2, fist: curled >= 3 && straight <= 1, open: straight >= 3 && curled <= 1, raw, side: raw === -1 ? -1 : swap ? 1 - raw : raw, L };
    });
    slots.raw = hands.map(h => ({ x: h.x, side: h.raw }));
    const assign = [null, null], recent = i => slots[i].vis && now - slots[i].seen < .3;
    if (hands.length >= 2) { hands.sort((a, b) => a.x - b.x); assign[0] = hands[0]; assign[1] = hands[hands.length - 1]; }   // two hands: the left one on screen is the left glove
    else if (hands.length === 1) {
      const h = hands[0], d0 = recent(0) ? Math.abs(slots[0].x - h.x) : 9, d1 = recent(1) ? Math.abs(slots[1].x - h.x) : 9;
      assign[d0 < 9 || d1 < 9 ? (d0 <= d1 ? 0 : 1) : h.side !== -1 ? h.side : h.x < .5 ? 0 : 1] = h;   // keep following the hand we already had, else trust the calibrated label
    }
    slots.forEach((sl, i) => {
      const h = assign[i];
      if (!h) { if (now - sl.seen > .25) sl.open = sl.fist = false; if (now - sl.seen > .6) { sl.vis = false; sl.hist.length = 0; } return; }   // a hand lost for a moment mid-punch is kept, so the next punch is not swallowed
      if (!sl.vis) sl.born = now;
      const k = sl.vis ? .7 : 1; sl.vis = true; sl.seen = now; sl.fist = h.fist; sl.open = h.open; if (h.fist) sl.fistT = now;
      sl.x = lerp(sl.x, h.x, k); sl.y = lerp(sl.y, h.y, k); sl.s = lerp(sl.s, h.s, k); sl.L = h.L;
      sl.hist.push({ t: now, s: h.s, s2: h.s2, x: h.x, y: h.y }); while (sl.hist.length && now - sl.hist[0].t > .5) sl.hist.shift();
      if (!sl.armed) { sl.peak = Math.max(sl.peak, h.s); if (h.s < sl.peak * .97 || now - sl.lastPunch > .9) sl.armed = true; }   // a hand re-arms once it pulls back, so one punch is never counted twice
      const prev = sl.hist[sl.hist.length - 2];
      { const r1 = sl.hist.find(p => now - p.t >= .05 && now - p.t <= .26); sl.reach = r1 ? Math.min(1.3, Math.max(0, Math.max(h.s / r1.s, h.s2 / r1.s2) - 1) / .13) : 0; }   // how close this hand is to throwing a punch (shown in the preview)
      const fire = r0 => { sl.lastPunch = now; sl.armed = false; sl.peak = h.s; sl.hist.length = 0; sl.cand = null; onPunch('straight', i, h.x - r0.x, now); };
      if (!sl.armed || !prev || now - sl.born < .35 || now - sl.lastPunch < .22 || !(h.fist || !h.open || now - sl.fistT < .3)) { sl.cand = null; return; }   // anything that is not an open palm can punch
      if (sl.cand) { const c = sl.cand; sl.cand = null; if (now - c.t < .2 && (h.s >= c.s * .93 || h.s2 >= c.s2 * .93)) { fire(c.ref); return; } }   // a one-frame jump counts once the bigger size is still there on the next frame
      // the fist swells (it is coming at the lens) without travelling far across the frame. Two looks: a quick one over the last quarter second, and a longer one that still catches a punch the tracker lost for a frame or two.
      for (const [lo, hi, need] of [[.05, .26, .13], [.2, .45, .24]]) {
        const r0 = sl.hist.find(p => now - p.t >= lo && now - p.t <= hi); if (!r0 || r0.t - sl.born < .25) continue;   // the baseline must come from a hand that was already steady in view
        const win = sl.hist.slice(sl.hist.indexOf(r0)); let stepS = 0; for (let j = 1; j < win.length; j++) stepS = Math.max(stepS, win[j].s - win[j - 1].s);
        const grow = Math.max((h.s - r0.s) / r0.s, (h.s2 - r0.s2) / r0.s2), drift = Math.hypot(h.x - r0.x, h.y - r0.y);
        if (grow > need && (h.s >= prev.s * .985 || h.s2 >= prev.s2 * .985) && drift < .18 + grow * .3) {
          if (win.length >= 3 && stepS < .8 * (h.s - r0.s)) fire(r0);   // swelled over several frames
          else sl.cand = { t: now, s: h.s, s2: h.s2, ref: r0 };          // swelled in a single frame: a very fast punch, or a tracker spike; the next frame decides
          break;
        }
      }
    });
    return hands.length;
  }
  const slotDx = (sl, now) => { const r = sl.vis && sl.hist.find(p => now - p.t >= .05 && now - p.t <= .26); return r ? sl.x - r.x : 0; };
  function drawPreview(cv, slots, st) {
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.font = '700 16px system-ui,sans-serif'; c.textAlign = 'center';
    if (st && st.headSeen) {
      const hx = st.headX * cv.width, hy = st.headY * cv.height; c.strokeStyle = Math.abs(st.headX - st.base) > .07 ? '#9ff0b0' : '#ffffffaa'; c.lineWidth = 2;
      c.beginPath(); c.arc(hx, hy, 15, 0, 7); c.stroke(); c.setLineDash([4, 4]); c.beginPath(); c.moveTo(st.base * cv.width, 4); c.lineTo(st.base * cv.width, cv.height - 4); c.stroke(); c.setLineDash([]);
    }
    slots.forEach((sl, i) => {   // reach meters along the bottom: fill past the line = punch
      const bw = cv.width / 2 - 14, bx = 7 + i * (cv.width / 2); c.fillStyle = '#0008'; c.fillRect(bx, cv.height - 12, bw, 7);
      c.fillStyle = sl.reach >= 1 ? '#9ff0b0' : '#ffd36a'; c.fillRect(bx, cv.height - 12, bw * Math.min(1, sl.reach / 1.3), 7); c.fillStyle = '#fff'; c.fillRect(bx + bw / 1.3, cv.height - 14, 2, 11);
    });
    slots.forEach((sl, i) => {
      if (!sl.vis || !sl.L) return; c.fillStyle = sl.fist ? '#ffd36a' : sl.open ? '#7fe8a0' : '#7fe8ff';
      for (const p of sl.L) { c.beginPath(); c.arc(p.x * cv.width, p.y * cv.height, 3, 0, 7); c.fill(); }
      c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3; const punched = st && st.hn - sl.lastPunch < .35, tx = sl.x * cv.width, ty = Math.max(16, sl.y * cv.height - 40) + (i ? 0 : 18), t = punched ? 'PUNCH!' : (i ? 'RIGHT ' : 'LEFT ') + (sl.fist ? 'fist' : sl.open ? 'palm' : '');
      c.strokeText(t, tx, ty); c.fillText(t, tx, ty);
    });
  }

  /* ---------------------------------------------------------------- Vembuli */
  function buildVembuli(env) {
    const { T, mat, add, outline } = env, SKIN = 0x7a4e32, DARK = 0x1b1410, TRUNK = 0xc4251c;
    const root = new T.Group(), hips = new T.Group(); hips.position.y = .95; root.add(hips);
    for (const s of [-1, 1]) { add(root, new T.CylinderGeometry(.2, .17, .95, 10), mat(SKIN), s * .22, .5, 0, false); add(root, new T.BoxGeometry(.3, .14, .45), mat(0x20222a), s * .22, .07, .08, false); }
    add(hips, new T.CylinderGeometry(.5, .46, .42, 14), mat(TRUNK), 0, .05, 0, false); add(hips, new T.CylinderGeometry(.52, .52, .09, 14), mat(0xf4f0e6), 0, .27, 0, false);
    const torso = new T.Group(); torso.position.y = .3; hips.add(torso);
    const chest = add(torso, new T.SphereGeometry(.62, 16, 12), mat(SKIN), 0, .6, 0, false); chest.scale.set(1.2, .95, .8); outline(chest, 1.04);
    const belly = add(torso, new T.SphereGeometry(.5, 14, 10), mat(SKIN), 0, .15, .08, false); belly.scale.set(1.05, .9, .85);
    add(torso, new T.CylinderGeometry(.2, .25, .22, 10), mat(SKIN), 0, 1.2, 0, false);
    const head = new T.Group(); head.position.y = 1.5; torso.add(head);
    const skull = add(head, new T.SphereGeometry(.3, 16, 12), mat(SKIN).clone(), 0, 0, 0, false); skull.scale.set(1, 1.1, 1.04); outline(skull, 1.05);
    const whites = [], pupils = [];
    add(head, new T.BoxGeometry(.4, .17, .26), mat(DARK), 0, -.17, .12, false); add(head, new T.BoxGeometry(.26, .05, .06), mat(DARK), 0, -.07, .29, false);
    for (const s of [-1, 1]) { whites.push(add(head, new T.SphereGeometry(.05, 8, 6), mat(0xf4f0e6), s * .1, .06, .27, false)); pupils.push(add(head, new T.SphereGeometry(.025, 6, 6), mat(DARK), s * .1, .06, .31, false)); const br = add(head, new T.BoxGeometry(.14, .04, .05), mat(DARK), s * .1, .14, .29, false); br.rotation.z = s * .35; add(head, new T.SphereGeometry(.06, 8, 6), mat(SKIN), s * .31, 0, 0, false); }
    add(head, new T.SphereGeometry(.05, 8, 6), mat(SKIN), 0, -.02, .31, false);
    // damage: lumps that grow from nothing as he takes punches (eyes first, then cheeks, brows and lip)
    const puff = (c, r, x, y, z) => { const m = add(head, new T.SphereGeometry(r, 10, 8), mat(c), x, y, z, false); m.scale.setScalar(.001); return m; };
    const swell = { skull, whites, pupils, eye: [puff(0x6b2f5c, .085, -.1, .07, .29), puff(0x6b2f5c, .085, .1, .07, .29)], cheek: [puff(0xb85a52, .1, -.17, -.08, .24), puff(0xb85a52, .1, .17, -.08, .24)],
      brow: [puff(0x7d3a4a, .06, -.1, .17, .27), puff(0x7d3a4a, .06, .1, .17, .27)], lip: puff(0xc23a3a, .07, 0, -.2, .285) };
    const stars = new T.Group(); stars.position.y = .5; stars.visible = false; head.add(stars);
    for (let i = 0; i < 4; i++) { const star = add(stars, new T.SphereGeometry(.035, 6, 5), new T.MeshBasicMaterial({ color: 0xffe27a }), Math.cos(i * 1.571) * .3, 0, Math.sin(i * 1.571) * .3, false); star.userData.i = i; }
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new T.Group(); sh.position.set(s * .78, 1.0, 0); torso.add(sh);
      add(sh, new T.SphereGeometry(.24, 10, 8), mat(SKIN), 0, 0, 0, false);
      add(sh, new T.CylinderGeometry(.17, .15, .55, 10), mat(SKIN), 0, -.28, 0, false);
      const el = new T.Group(); el.position.y = -.55; sh.add(el);
      add(el, new T.CylinderGeometry(.14, .12, .5, 10), mat(SKIN), 0, -.25, 0, false);
      const gl = add(el, new T.SphereGeometry(.2, 12, 10), mat(0x1a1a1f).clone(), 0, -.6, 0, false); gl.scale.set(1, .95, 1.1); outline(gl, 1.06);
      arms.push({ sh, el, gl, s });
    }
    root.scale.setScalar(.8);
    return { root, hips, torso, head, arms, swell, stars };
  }
  function armTarget(name, s, t) {   // s = -1 left arm, +1 right arm of Vembuli (his own left / right, seen mirrored by us)
    const lead = s === -1;
    switch (name) {
      case 'windup': return lead ? { sx: .5, sz: 0, ex: -1.5 } : { sx: .7, sz: 0, ex: -1.6 };   // straight: arm drawn back
      case 'strike': return lead ? { sx: -1.5, sz: -s * .1, ex: -.1 } : { sx: -1.5, sz: -s * .18, ex: -.1 };
      case 'hookwind': return { sx: 0, sy: s * .75, sz: s * 1.45, ex: -1.45 };      // elbow out at shoulder height, forearm cocked, whole arm drawn back
      case 'hookstrike': return { sx: 0, sy: -s * 1.05, sz: s * 1.45, ex: -1.45 };   // the arm swings forward and across, locked in a horizontal arc
      case 'guard': return { sx: -.95, sz: -s * .3, ex: -2.3 };
      case 'stagger': return { sx: .1, sz: s * .5, ex: -.6 };
      default: return { sx: -.7 + Math.sin(t * 3 + s) * .05, sz: -s * .12, ex: -2.0 + Math.sin(t * 3 + s) * .08 };
    }
  }

  /* ------------------------------------------------------------------- game */
  window.runBoxing = function (env) {
    const { T, scene, camera, g, ring, beep, chime } = env;
    let resolveFn; const promise = new Promise(r => { resolveFn = r; });
    const hud = $('boxHud'), video = $('bxVideo'), pv = $('bxCanvas');
    const V = buildVembuli(env); g.add(V.root);
    const vx0 = ring.x, vz0 = ring.z - .3;
    V.root.position.set(vx0, ring.top, vz0);
    const me = { hp: MY_HP, guard: false, gMeter: 100, gBroken: 0, slipCd: 0, dodgeT: 0, dodgeCd: 0, off: 0, offT: 0, shake: 0, flash: 0, kb: { l: 0, r: 0 } };
    const him = { swellNow: 0, faceW: 0, bump: 0, kick: 0, kickSide: 1, said: {}, hp: HIS_HP, state: 'idle', t: 0, think: 1.2, atk: null, lat: 0, latT: 0, hit: 0, combo: 0, comboT: 0, strikeDone: false, chain: 0 };
    const st = { phase: 'wait', palm: 0, step: 0, stepT: 0, evt: null, t: 0, round: 1, clock: ROUND_T, done: false, bigT: 0, subT: 0, tauntT: 4, hands: 0, camOk: false, hn: 0, thrust: [0, 0], aim: [false, false], pend: [], hold: 0, pk: 0, kind: ['straight', 'straight'], headSeen: false, headX: .5, headY: .4, base: null, wasLean: false, fc: 0, punches: 0, landed: 0 };
    const slots = [makeSlot(), makeSlot()];
    let tracker = null, lastVid = -1, closed = false;

    // my gloves (attached to the camera)
    const gloves = []; const rig = new T.Group(); camera.add(rig);
    for (const s of [-1, 1]) {
      const h = new T.Group(); rig.add(h);
      const gl = env.add(h, new T.SphereGeometry(.14, 12, 10), env.mat(0xd8202a), 0, 0, -.02, false); gl.scale.set(1, .9, 1.15);
      env.add(h, new T.SphereGeometry(.075, 8, 6), env.mat(0xd8202a), s * -.11, .03, .03, false);
      // the arm is one stretchy limb from a shoulder below the screen to the glove, so it always comes up from the bottom of the frame however far the punch travels
      const arm = env.add(rig, new T.CylinderGeometry(.06, .08, 1, 8), env.mat(0xf0b98a), 0, 0, 0, false), cuff = env.add(rig, new T.CylinderGeometry(.095, .095, 1, 10), env.mat(0xf4f0e6), 0, 0, 0, false);
      gloves.push({ h, s, arm, cuff, x: s * .3, y: -.4, z: -.75 });
    }
    const vA = new T.Vector3(), vB = new T.Vector3(), vC = new T.Vector3(), vUp = new T.Vector3(0, 1, 0);
    function layoutArm(gl) {
      vA.set(gl.s * .5, -1.0, .1); vB.copy(gl.h.position); vC.subVectors(vB, vA); const len = vC.length(); vC.divideScalar(len);
      const q = new T.Quaternion().setFromUnitVectors(vUp, vC), cufLen = .16, armLen = len - .1 - cufLen * .5;
      gl.arm.quaternion.copy(q); gl.arm.scale.set(1, armLen, 1); gl.arm.position.copy(vA).addScaledVector(vC, armLen / 2);
      gl.cuff.quaternion.copy(q); gl.cuff.scale.set(1, cufLen, 1); gl.cuff.position.copy(vA).addScaledVector(vC, armLen + cufLen / 2 - .02);
    }

    /* ----- impact effects: a starburst at the point of contact, a floating number, a camera nudge */
    const sparkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g2 = x.createRadialGradient(64, 64, 2, 64, 64, 62); g2.addColorStop(0, '#fff'); g2.addColorStop(.35, '#ffffffcc'); g2.addColorStop(1, '#ffffff00');
      x.fillStyle = g2; x.fillRect(0, 0, 128, 128); x.translate(64, 64); x.fillStyle = '#fff'; for (let i = 0; i < 8; i++) { x.rotate(Math.PI / 4); x.beginPath(); x.moveTo(0, -8); x.lineTo(4, -62); x.lineTo(-4, -62); x.closePath(); x.fill(); } return new T.CanvasTexture(c); })();
    const sparks = [0, 1, 2].map(() => { const sp = new T.Sprite(new T.SpriteMaterial({ map: sparkTex, transparent: true, depthTest: false, depthWrite: false })); sp.renderOrder = 20; sp.visible = false; sp.userData.t = -1; camera.add(sp); return sp; });
    const FLUSH = new T.Color(0xab4538);
    const FXCOL = { hit: 0xffe27a, block: 0x9fd0ff, counter: 0xff8a3a };
    const vtmp = new T.Vector3(), vtmp2 = new T.Vector3();
    /* where a punch ends up: just in front of his face (or chest), in camera space */
    function aimPt(face, out) {
      camera.updateMatrixWorld(); V.root.updateWorldMatrix(true, true);
      (face ? V.head : V.torso).localToWorld(vtmp.set(0, face ? 0 : .6, face ? .25 : .3)); camera.worldToLocal(vtmp);
      const len = vtmp.length(), k = Math.max(.3, (len - (face ? .12 : .22)) / len); return out.copy(vtmp).multiplyScalar(k);
    }
    function impact(side, face, fx) {
      const sp = sparks.find(q => q.userData.t < 0) || sparks[0], pt = aimPt(face, vtmp2);
      sp.position.set(pt.x + (side ? 1 : -1) * .07, pt.y, pt.z - .06); sp.material.color.setHex(FXCOL[fx.tag] || FXCOL.hit); sp.material.rotation = Math.random() * 6; sp.userData.t = 0; sp.visible = true;
      st.hold = .045; st.pk = 1;
      const n = $('bxNum'); if (fx.dmg > 0) {
        const wp = camera.localToWorld(vtmp2.clone()).project(camera); n.textContent = (face && fx.tag !== 'block' ? 'HEAD ' : '') + '−' + Math.round(fx.dmg); n.style.left = (wp.x * .5 + .5) * innerWidth + 'px'; n.style.top = (-wp.y * .5 + .5) * innerHeight - 24 + 'px';
        n.style.color = fx.tag === 'block' ? '#a9d8ff' : fx.tag === 'counter' ? '#ffb060' : '#ffe27a'; n.classList.remove('go'); void n.offsetWidth; n.classList.add('go');
      }
    }

    const msg = (big, ms = 900, col = '#fff') => { const b = $('bxBig'); b.textContent = big; b.style.color = col; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); st.bigT = ms / 1000; };
    const sub = (who, text, ms = 2200) => { $('bxSub').innerHTML = `<b>${who}</b> ${text}`; $('bxSub').classList.add('show'); st.subT = ms / 1000; };
    const camMsg = t => { $('bxCamMsg').textContent = t; };
    const setBars = () => { $('bxMe').style.width = clamp(me.hp / MY_HP, 0, 1) * 100 + '%'; $('bxHim').style.width = clamp(him.hp / HIS_HP, 0, 1) * 100 + '%'; };

    /* ----- combat */
    function landPunch(kind, face, side) {
      if (st.phase !== 'fight' || him.state === 'down') return null;
      st.punches++;
      let mult = 1, tag = 'hit', say = '';
      if (him.state === 'guard') { mult = .25; tag = 'block'; say = 'BLOCKED'; } else if (him.state === 'recover') { mult = 1.6; tag = 'counter'; say = 'COUNTER!'; } else if (face) mult = 1.15;   // clean shots to the head hurt more
      him.comboT > 0 ? him.combo++ : (him.combo = 0); him.comboT = 1.1;
      const dmg = (DMG[kind] + Math.min(2, Math.floor(him.combo / 2))) * mult;
      him.hp -= dmg; him.hit = .2; st.landed++;
      if (tag !== 'block') { him.kick = face ? 1 : .6; him.kickSide = side ? -1 : 1; if (face) { him.faceW = Math.min(.2, him.faceW + .012); him.bump = Math.min(.12, him.bump + .05); } else him.faceW = Math.min(.2, him.faceW + .004); }
      else him.kick = .25;
      beep(mult < 1 ? 160 : 100, .09, 'square', .07); if (mult > 1) beep(60, .16, 'sawtooth', .05);
      if (say) msg(say, 600, mult < 1 ? '#a9d8ff' : '#ffd36a'); else if (him.combo >= 3) msg(him.combo + 1 + ' HIT COMBO', 700, '#ffd36a');
      if (him.combo >= 3 && (him.state === 'idle' || him.state === 'recover') && Math.random() < .6) { him.state = 'guard'; him.t = .9; him.combo = 0; }
      setBars();
      if (him.hp <= 0) endFight('ko');
      return { tag, dmg };
    }
    function hisStrike() {
      const heavy = him.atk.heavy;
      if (me.dodgeT > 0 && me.slipCd <= 0) { me.slipCd = .9; msg('DODGED', 600, '#9ff0b0'); beep(520, .06, 'triangle', .04); return; }
      const blocked = me.guard; let mult = 1;
      if (blocked) { mult = heavy ? .15 : .08; me.gMeter -= heavy ? 45 : 30; if (me.gMeter <= 0) { me.gMeter = 0; me.gBroken = 1.4; me.guard = false; mult = .6; msg('GUARD BROKEN', 900, '#ff9a8a'); beep(120, .2, 'sawtooth', .06); } }
      const dmg = him.atk.dmg * mult;
      me.hp -= dmg; me.shake = me.guard ? .12 : heavy ? .45 : .25; me.flash = 1; me.flashBlue = blocked && me.gBroken <= 0;
      beep(heavy ? 70 : 90, .14, 'sawtooth', .07); setBars();
      if (blocked && me.guard) { msg('BLOCKED!', 700, '#a9d8ff'); beep(300, .08, 'triangle', .06); }
      if (me.hp <= 0) endFight('lose');
    }
    function chooseAction() {
      const r = Math.random(), hard = st.round === 2 ? .12 : 0;
      if (r < .6 + hard) {
        const k = Math.random(); him.atk = k < .4 ? { kind: 'jab', wind: .5, dmg: 7, arm: 0, heavy: false } : k < .75 ? { kind: 'cross', wind: .55, dmg: 9, arm: 1, heavy: false } : { kind: 'hook', wind: .78, dmg: 14, arm: Math.random() < .5 ? 0 : 1, heavy: true };
        him.state = him.atk.kind === 'hook' ? 'hookwind' : 'windup'; him.t = him.atk.wind * (st.round === 2 ? .88 : 1); him.strikeDone = false; beep(240, .08, 'triangle', .03);
      } else if (r < .85) { him.state = 'guard'; him.t = .9 + Math.random() * .5; if (Math.random() < .5) sub('Vembuli', pick(TAUNT)); }
      else { him.latT = .55; him.lat = (Math.random() < .5 ? -1 : 1) * .55; him.state = 'idle'; him.think = .5; }
    }

    /* ----- flow */
    function endFight(how, quit) {
      if (st.done) return; st.done = true; st.phase = 'end';
      const meFrac = me.hp / MY_HP, himFrac = him.hp / HIS_HP;
      const won = !quit && (how === 'ko' || (how === 'time' && himFrac < meFrac));
      const res = { won, ko: how === 'ko', quit: !!quit, lost: how === 'lose', draw: how === 'time' && himFrac === meFrac, landed: st.landed, punches: st.punches, camera: st.camOk, hp: Math.max(0, Math.round(me.hp)) };
      if (quit) return cleanup(res);
      msg(how === 'ko' ? 'K.O.!' : how === 'lose' ? 'DOWN!' : 'BELL!', 1800, how === 'lose' ? '#ff9a8a' : '#ffd36a'); chime();
      him.state = how === 'ko' ? 'down' : how === 'lose' ? 'win' : 'idle';
      setTimeout(() => cleanup(res), 2300);
    }
    function cleanup(res) {
      closed = true; env.setTicker(null);
      if (tracker) { try { tracker.stream.getTracks().forEach(t => t.stop()); tracker.lm.close(); } catch (er) { } } video.srcObject = null;
      camera.remove(rig); sparks.forEach(sp => camera.remove(sp)); g.remove(V.root); hud.hidden = true; resolveFn(res);
    }
    function startRound() { st.phase = 'fight'; st.clock = ROUND_T; him.state = 'idle'; him.think = 1; msg(st.round === 1 ? 'FIGHT!' : 'ROUND 2', 1000, '#ffd36a'); beep(880, .25, 'triangle', .08); $('bxRound').textContent = 'ROUND ' + st.round; sub('Rayappan', pick(CORNER)); }

    /* ----- input: tracked fists only */
    const doPunch = (kind, side) => {
      if (st.t - lastP[side] < .25) return; lastP[side] = st.t; st.thrust[side] = 1; st.kind[side] = kind;
      const face = slots[side].vis && slots[side].y < .5; st.aim[side] = face;   // a fist raised to face height goes for the head, a lower one for the body
      st.pend.push({ at: st.t + .09, side, face, kind });   // the hit happens when the glove arrives, not when the gesture is first seen
    };
    const dodge = dir => { if (me.dodgeCd > 0) return; me.dodgeT = .45; me.dodgeCd = .9; me.offT = dir * .8; beep(420, .05, 'triangle', .03); st.evt = 'dodge'; };
    const onTrackPunch = (kind, side) => { st.evt = kind; st.evtSide = side; doPunch(kind, side); };

    /* ----- warm-up: instructions follow what the camera sees */
    const STEPS = [
      { t: 'Raise your LEFT hand', p: () => st.cal && st.cal.flipped ? 'This camera was already mirrored, so the view is fixed. Keep your left hand up, off to your left.' : 'Hold up only your LEFT hand, out to your left, away from your face. If it shows on the RIGHT of the preview, press the Swap L/R button on the preview.', cal: true },
      { t: 'Both hands as fists', p: 'Now bring up both hands and close them. The preview labels each one LEFT or RIGHT, and dots turn gold on a fist.', ok: () => slots[0].fist && slots[1].fist, hold: .5 },
      { t: 'Punch with your LEFT fist', p: 'Push your left fist straight at the camera, like jabbing the screen. Lifting or waving a fist does not count.', ev: ['straight'], side: 0 },
      { t: 'Punch with your RIGHT fist', p: 'Now your right fist, straight at the camera.', ev: ['straight'], side: 1 },
      { t: 'Block with an open palm', p: 'Open one hand, fingers spread, palm to the camera, and hold.', ok: () => me.guard, hold: .4 },
      { t: 'Dodge', p: () => tracker && tracker.face ? 'Slip it: lean your head left or right, like ducking a punch. The ring on the preview is your head.' : 'No face tracking here: move both hands sideways together, quickly.', ev: ['dodge'] },
    ];
    /* learns, from your raised LEFT hand, (1) whether this camera's picture is already mirrored and (2) how it labels hands */
    function calibrate() {
      const c = st.cal || (st.cal = { n: 0, left: 0, lab: 0, flipped: false }), raw = slots.raw || [];
      if (raw.length !== 1 || (raw[0].x > .4 && raw[0].x < .6)) return false;   // exactly one hand, held out to the side
      c.n++; if (raw[0].x < .5) c.left++; if (raw[0].side === 0) c.lab++;
      if (c.n < 12) return false;
      if (c.left <= c.n / 2 && !c.flipped) {   // your left hand shows up on the RIGHT of the picture: the feed is already mirrored, so stop flipping it
        tracker.flip = tracker.flip === false; $('bxCam').classList.toggle('noflip', tracker.flip === false);
        st.cal = { n: 0, left: 0, lab: 0, flipped: true }; slots.forEach(sl => { sl.vis = false; sl.hist.length = 0; sl.fist = sl.open = false; }); drawCoach(); return false;
      }
      tracker.swap = c.lab <= c.n / 2;   // the raised LEFT hand was not labelled 'Left', so swap the labels
      saveCal(tracker); return true;
    }
    const coach = $('bxCoach');
    function drawCoach() {
      const done = st.step >= STEPS.length, cur = STEPS[Math.min(st.step, STEPS.length - 1)];
      $('bxCoachT').textContent = done ? 'Ready!' : `Step ${st.step + 1} of ${STEPS.length} · ${cur.t}`; $('bxCoachP').textContent = done ? 'Push a fist straight at the camera to punch. Palm blocks. Lean to dodge.' : typeof cur.p === 'function' ? cur.p() : cur.p;
      $('bxSteps').innerHTML = STEPS.map((x, i) => `<li class="${i < st.step ? 'ok' : i === st.step ? 'now' : ''}">${x.t}</li>`).join('');
    }
    function finishLearn() { st.phase = 'intro'; coach.hidden = true; $('bxCam').classList.remove('big'); cd = 3.2; msg('Gloves up!', 1100, '#ffd36a'); sub('Rayappan', 'Watch the red glove, then show your palm. Counter when he is open!', 3000); }
    function startLearn() { $('bxCam').classList.toggle('noflip', tracker.flip === false); st.phase = 'learn'; st.step = tracker.saved ? 1 : 0; st.stepT = 0; st.evt = null; st.cal = null; coach.hidden = false; $('bxCam').classList.add('big'); $('bxSkip').onclick = () => finishLearn(); drawCoach(); }
    function stepLearn(dt) {
      if (st.step >= STEPS.length) { if ((st.finT -= dt) <= 0) finishLearn(); return; }
      const stp = STEPS[st.step];
      const pass = stp.cal ? calibrate() : stp.ev ? stp.ev.includes(st.evt) && (stp.side === undefined || st.evtSide === stp.side) : (stp.ok() ? (st.stepT += dt) >= stp.hold : (st.stepT = 0, false));
      if (!pass) return;
      st.step++; st.stepT = 0; st.evt = null; st.cal = null; beep(740, .1, 'triangle', .05); drawCoach();
      if (st.step >= STEPS.length) st.finT = 1.2;
    }

    /* one click fixes "my left hand shows up as the right one": mirror the picture the tracker sees and the preview together */
    $('bxFlip').onclick = () => {
      if (!tracker) return;
      tracker.flip = tracker.flip === false; $('bxCam').classList.toggle('noflip', tracker.flip === false); saveCal(tracker);
      slots.forEach(sl => { sl.vis = false; sl.hist.length = 0; sl.fist = sl.open = false; }); st.cal = null; st.headSeen = false; st.base = null;
      camMsg(tracker.flip === false ? 'Left and right swapped (picture unmirrored)' : 'Left and right swapped (picture mirrored)');
    };

    /* ----- camera setup */
    hud.hidden = false; $('bxCam').classList.remove('off'); setBars(); camMsg('Starting camera…');
    const open = env.openCamera || openCamera;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera api');
      const tr = await open(video, camMsg);
      if (closed) { tr.stream.getTracks().forEach(t => t.stop()); tr.lm.close(); return; }
      loadCal(tr); tracker = tr; st.camOk = true; startLearn();
    })().catch(er => {
      if (closed) return; st.camOk = false; $('bxCam').classList.add('off'); camMsg('Camera unavailable');
      msg('No camera', 2200, '#ff9a8a'); sub('Rayappan', 'I cannot see your hands. Allow the camera for this page and come back, thambi.', 3000);
      setTimeout(() => { if (!st.done) { st.done = true; st.phase = 'end'; cleanup({ won: false, quit: true, nocam: true, camera: false }); } }, 3200);
    });

    /* ----- per frame */
    let cd = 0; const lastP = [-9, -9];
    env.setTicker(dt => {
      st.t += dt; const now = st.t;
      // hands
      if (tracker && (tracker.fake || (video.readyState >= 2 && video.currentTime !== lastVid))) {
        lastVid = video.currentTime;
        try { const src = tracker.fake ? null : grab(tracker, video);
          st.hn = tracker.fake ? now : performance.now() / 1000;
          st.hands = readHands(tracker.lm, src, slots, st.hn, onTrackPunch, tracker);
          if (tracker.face && (st.fc++ % 3) === 0) {
            const d = (tracker.face.detectForVideo(src, now * 1000).detections || [])[0];
            if (d) { const bb = d.boundingBox, f = tracker.feed || { width: 480, height: 360 }; st.headSeen = true; st.headX = (bb.originX + bb.width / 2) / f.width; st.headY = (bb.originY + bb.height / 2) / f.height; if (st.base === null) st.base = st.headX; } else st.headSeen = false;
          }
          drawPreview(pv, slots, st); } catch (er) { }
        camMsg(st.hands ? 'Tracking ' + st.hands + (st.hands > 1 ? ' hands' : ' hand') : 'Show your hands to the camera');
      }
      const palm = slots.some(sl => sl.vis && sl.open && st.hn - sl.lastPunch > .3);
      st.palm = palm ? Math.min(.4, st.palm + dt) : Math.max(0, st.palm - dt); me.guard = st.palm > .06;
      if (me.gBroken > 0) { me.gBroken -= dt; me.guard = false; }
      me.gMeter = Math.min(100, me.gMeter + dt * (me.guard ? 10 : 25));
      // punches whose gloves have arrived
      for (let j = st.pend.length - 1; j >= 0; j--) if (st.t >= st.pend[j].at) { const pd = st.pend.splice(j, 1)[0]; impact(pd.side, pd.face, landPunch(pd.kind, pd.face, pd.side) || { tag: 'hit', dmg: 0 }); }
      // timers
      st.bigT > 0 && (st.bigT -= dt); st.subT > 0 && (st.subT -= dt, st.subT <= 0 && $('bxSub').classList.remove('show'));
      me.slipCd = Math.max(0, me.slipCd - dt); me.dodgeT = Math.max(0, me.dodgeT - dt); me.dodgeCd = Math.max(0, me.dodgeCd - dt); me.shake = Math.max(0, me.shake - dt); me.flash = Math.max(0, me.flash - dt * 2.4);
      if (tracker && tracker.face) {   // the camera view leans with you; being out of the line when his glove lands is a dodge
        if (st.headSeen) st.base += (st.headX - st.base) * (1 - Math.exp(-dt / 3));   // the neutral head position slowly follows you, so a held lean fades
        const lean = st.headSeen ? st.headX - st.base : 0, on = Math.abs(lean) > .07;
        if (on) { if (!st.wasLean) { st.evt = 'dodge'; beep(420, .05, 'triangle', .03); } me.dodgeT = .3; } st.wasLean = on;
        me.offT = clamp(lean / .2, -1, 1) * .9;
      } else {
        const d0 = slotDx(slots[0], st.hn), d1 = slotDx(slots[1], st.hn);
        if (tracker && d0 * d1 > 0 && Math.abs(d0) > .14 && Math.abs(d1) > .14 && (st.phase === 'fight' || st.phase === 'learn')) dodge(Math.sign(d0));
        me.offT = me.dodgeT > 0 ? me.offT : lerp(me.offT, 0, Math.min(1, dt * 6));
      }
      me.off = lerp(me.off, me.offT, Math.min(1, dt * 14));
      him.hit = Math.max(0, him.hit - dt); him.comboT -= dt;
      if (st.phase === 'learn') stepLearn(dt);
      if (st.phase === 'intro') { cd -= dt; if (cd <= 0) startRound(); else if (Math.ceil(cd) !== Math.ceil(cd + dt) && cd < 3) { msg(String(Math.ceil(cd)), 700, '#fff'); beep(520, .1, 'triangle', .05); } }
      if (st.phase === 'fight') {
        st.clock -= dt; $('bxTime').textContent = Math.max(0, Math.ceil(st.clock));
        if (st.clock <= 0) { if (st.round < ROUNDS) { st.phase = 'break'; st.t2 = 2.6; msg('ROUND 1 OVER', 1500, '#ffd36a'); me.hp = Math.min(MY_HP, me.hp + 30); setBars(); him.state = 'idle'; sub('Rayappan', 'Water, breathe! Land clean ones, do not flail.', 2400); } else endFight('time'); }
        // Vembuli brain
        him.t -= dt; him.latT -= dt; st.tauntT -= dt;
        if (him.state === 'idle') { him.think -= dt; if (him.think <= 0) chooseAction(); }
        else if (him.state === 'windup' || him.state === 'hookwind') { if (him.t <= 0) { him.state = him.state === 'hookwind' ? 'hookstrike' : 'strike'; him.t = .16; him.strikeDone = false; } }
        else if (him.state === 'strike' || him.state === 'hookstrike') { if (!him.strikeDone && him.t < .09) { him.strikeDone = true; hisStrike(); } if (him.t <= 0) { him.state = 'recover'; him.t = him.atk.heavy ? .85 : .55; } }
        else if (him.state === 'recover') { if (him.t <= 0) { him.state = 'idle'; him.think = .35 + Math.random() * .7 - (st.round === 2 ? .15 : 0); } }
        else if (him.state === 'guard' || him.state === 'stagger') { if (him.t <= 0) { him.state = 'idle'; him.think = .4; } }
        if (st.tauntT <= 0 && st.phase === 'fight') { st.tauntT = 6 + Math.random() * 4; sub(Math.random() < .5 ? 'Vembuli' : 'Rayappan', pick(Math.random() < .5 ? TAUNT : CORNER)); }
      } else if (st.phase === 'break') { st.t2 -= dt; if (st.t2 <= 0) { st.round++; startRound(); } }
      // Vembuli pose
      const sway = Math.sin(now * 2.2) * .04, advance = him.state === 'windup' || him.state === 'hookwind' ? .12 : him.state === 'strike' || him.state === 'hookstrike' ? .45 : 0;
      V.root.position.x = lerp(V.root.position.x, vx0 + (him.latT > 0 ? him.lat : 0) + sway, Math.min(1, dt * 6));
      V.root.position.z = lerp(V.root.position.z, vz0 + advance + (him.state === 'down' ? -.1 : 0) - him.kick * him.kick * .16, Math.min(1, dt * 12));
      const k = Math.min(1, dt * 14), name = him.state;
      V.arms.forEach(a => {
        const lead = a.s === -1; let pose = name;
        if ((name === 'windup' || name === 'strike') && him.atk && ((him.atk.arm === 0) !== lead)) pose = 'idle';
        if ((name === 'hookwind' || name === 'hookstrike') && him.atk && ((him.atk.arm === 0) !== lead)) pose = 'idle';
        if (name === 'recover') pose = 'idle';
        const tg = armTarget(pose === 'down' || pose === 'win' ? 'idle' : pose, a.s, now);
        a.sh.rotation.y = lerp(a.sh.rotation.y, tg.sy || 0, k); a.sh.rotation.x = lerp(a.sh.rotation.x, tg.sx, k); a.sh.rotation.z = lerp(a.sh.rotation.z, tg.sz, k); a.el.rotation.x = lerp(a.el.rotation.x, tg.ex, k);
        const glow = (name === 'windup' || name === 'hookwind') && ((him.atk.arm === 0) === lead) ? 1 : 0;
        a.gl.material.color.setHex(glow ? 0xff3a2a : 0x1a1a1f);
      });
      const twist = name === 'windup' ? -.35 : name === 'strike' ? .3 : name === 'hookwind' ? (him.atk.arm ? .5 : -.5) : name === 'hookstrike' ? (him.atk.arm ? -.45 : .45) : 0;
      V.torso.rotation.y = lerp(V.torso.rotation.y, twist, k); V.torso.rotation.x = lerp(V.torso.rotation.x, (name === 'down' ? .9 : name === 'guard' ? .12 : .04 + Math.sin(now * 2.4) * .02) - him.kick * him.kick * .22, k);
      him.kick = Math.max(0, him.kick - dt * 4); const kk2 = him.kick * him.kick;
      V.head.rotation.x = -kk2 * .55; V.head.rotation.y = him.kickSide * kk2 * .75; V.head.rotation.z = him.kickSide * kk2 * .3; V.root.rotation.y = kk2 * Math.sin(now * 70) * .05;
      // his face takes the damage
      const target = clamp((1 - him.hp / HIS_HP) * .85 + him.faceW, 0, 1), sw = V.swell, ease = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
      him.swellNow += ((him.state === 'down' ? Math.max(.95, target) : target) + him.bump - him.swellNow) * Math.min(1, dt * 3); him.bump = Math.max(0, him.bump - dt * .5);
      const sn = him.swellNow, eR = ease((sn - .10) / .45), eL = ease((sn - .30) / .5), ch = ease((sn - .2) / .6), br = ease((sn - .35) / .5), lp = ease((sn - .45) / .45);
      sw.eye[0].scale.set(.001 + eR * 1.5, .001 + eR * 1.05, .001 + eR * .8); sw.eye[1].scale.set(.001 + eL * 1.5, .001 + eL * 1.05, .001 + eL * .8);
      sw.whites[0].scale.y = sw.pupils[0].scale.y = 1 - .85 * eR; sw.whites[1].scale.y = sw.pupils[1].scale.y = 1 - .85 * eL;
      sw.cheek.forEach(m => m.scale.setScalar(.001 + ch * 1.4)); sw.brow.forEach(m => m.scale.set(.001 + br * 1.5, .001 + br * .9, .001 + br * .9)); sw.lip.scale.set(.001 + lp * 1.9, .001 + lp * .8, .001 + lp * .9);
      sw.skull.material.color.setHex(0x7a4e32).lerp(FLUSH, clamp(sn * 1.1, 0, 1) * .5);
      V.stars.visible = him.state === 'down'; if (V.stars.visible) { V.stars.rotation.y = now * 5; V.stars.children.forEach(c => { c.position.y = Math.sin(now * 6 + c.userData.i * 1.6) * .05; }); }
      if (st.phase === 'fight') {
        if (sn > .3 && !him.said.a) { him.said.a = 1; sub('Rayappan', 'His eye is puffing up. Keep going for the head!'); }
        if (sn > .65 && !him.said.b) { him.said.b = 1; sub('Vembuli', 'I... I can barely see you!'); }
      }
      V.root.position.y = ring.top + (name === 'down' ? -.35 : Math.abs(Math.sin(now * 4.4)) * .03);
      // camera: first person at the ring edge
      const sh = me.shake > 0 ? me.shake * .06 : 0;
      g.updateWorldMatrix(true, false);
      const wp = g.localToWorld(new T.Vector3(ring.x + me.off + (Math.random() - .5) * sh, ring.top + 1.66 + Math.sin(now * 2.4) * .012 + (Math.random() - .5) * sh, ring.z + 1.7));
      camera.position.copy(wp); camera.rotation.set(.07 + (me.dodgeT > 0 ? .04 : 0), g.rotation.y + me.off * -.12, me.off * -.05);
      // my gloves
      st.hold = Math.max(0, st.hold - dt); st.pk = Math.max(0, st.pk - dt * 7);
      gloves.forEach((gl, i) => {
        const sl = slots[i], t = st.thrust[i]; if (st.hold <= 0) st.thrust[i] = Math.max(0, t - dt * 4.5);   // the glove freezes for a few frames on contact
        let tx = gl.s * .3, ty = -.4 + Math.sin(now * 2.2 + i) * .01, tz = -.75;
        if (me.guard && (!sl.vis || sl.open)) { tx = gl.s * .16; ty = -.06; tz = -.62; }
        else if (sl.vis) { tx = (sl.x - .5) * 1.3; ty = -(sl.y - .5) * 1.0 - .2; tz = -.95 + clamp((sl.s - .08) / .22, 0, 1) * .4; }
        const kk = Math.min(1, dt * 16);
        gl.x = lerp(gl.x, tx, kk); gl.y = lerp(gl.y, ty, kk); gl.z = lerp(gl.z, tz, kk);
        if (t > 0) {   // out to his face or chest, a beat on contact, then back
          const pr = 1 - t, out = clamp(pr / .4, 0, 1), back = clamp((pr - .55) / .45, 0, 1), amt = (1 - (1 - out) * (1 - out)) * (1 - back * back * (3 - 2 * back));
          const ct = aimPt(st.aim[i], vtmp2); ct.x += gl.s * .07;
          gl.h.position.set(lerp(gl.x, ct.x, amt), lerp(gl.y, ct.y, amt), lerp(gl.z, ct.z, amt));
          gl.h.rotation.set(-amt * .2, -gl.s * .14 * (1 - amt) + gl.s * amt * .25, gl.s * amt * .45); gl.h.scale.set(1 - amt * .06, 1 - amt * .06, 1 + amt * .18);
        } else { gl.h.scale.setScalar(1); gl.h.position.set(gl.x, gl.y, gl.z); gl.h.rotation.set(0, -gl.s * .14, 0); }
        layoutArm(gl);
      });
      sparks.forEach(sp => { if (sp.userData.t < 0) return; sp.userData.t += dt; const u = sp.userData.t / .24; if (u >= 1) { sp.userData.t = -1; sp.visible = false; return; } sp.scale.setScalar(.12 + .55 * Math.sqrt(u)); sp.material.opacity = 1 - u * u; });
      const fv = 74 - st.pk * 2.5; if (Math.abs(camera.fov - fv) > .05) { camera.fov = fv; camera.updateProjectionMatrix(); }
      // hud
      $('bxHit').style.opacity = me.flash * (me.flashBlue ? .5 : .55); $('bxHit').classList.toggle('blue', !!me.flashBlue); $('bxGuard').classList.toggle('on', me.guard); $('bxGuardBar').style.width = me.gMeter + '%'; $('bxGuard').classList.toggle('low', me.gMeter < 35); $('bxCam').classList.toggle('guard', me.guard);
    });
    return { promise, quit: () => endFight('time', true), state: () => ({ me, him, st }) };
  };
})();
