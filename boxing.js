/* First-person sparring against Vembuli in Beedi Rayappan's ring.
   Punches come from the webcam: MediaPipe Hand Landmarker finds both hands, a fist that rushes toward the lens is a straight,
   a fast sideways sweep is a hook, a fast upward swipe is an uppercut, and two fists held up by the face is a guard.
   Video never leaves the browser. Keyboard / mouse fallback: J K straight, U hook, I uppercut, Space or S guard, A D dodge. */
(() => {
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const DMG = { straight: 4, hook: 7, upper: 9 };
  const ROUND_T = 40, ROUNDS = 2, HIS_HP = 220, MY_HP = 100;
  const TAUNT = ['Come on, little boy!', 'Is that all you have?', 'My grandmother hits harder!', 'Hands up. Or go home.', 'Hm. Tickling me?', 'Stand still!'];
  const CORNER = ['Hands up, thambi!', 'Watch his shoulder before the swing!', 'Counter! He is open!', 'Keep moving. Breathe!', 'Hook, hook! Sweep your hand!'];

  /* ---------------------------------------------------------- hand tracking */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function makeSlot() { return { vis: false, x: .5, y: .6, s: .12, fist: false, hist: [], lastPunch: -9, seen: -9 }; }
  async function openCamera(video, say) {
    say('Allow the camera so Rayappan can see your punches…');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video.srcObject = stream; await video.play();
    say('Loading hand tracking…');
    const vis = await import(MP + '/vision_bundle.mjs'), fs = await vis.FilesetResolver.forVisionTasks(MP + '/wasm');
    let lm;
    for (const delegate of ['GPU', 'CPU']) {
      try { lm = await vis.HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .5, minTrackingConfidence: .5 }); break; } catch (er) { if (delegate === 'CPU') throw er; }
    }
    return { stream, lm };
  }
  /* turns landmarks into two slots [left, right] (as the player sees themselves, mirrored) and reports punches */
  function readHands(lm, video, slots, now, onPunch) {
    const res = lm.detectForVideo(video, now * 1000), hands = (res.landmarks || []).map(L => {
      const w = L[0], palm = Math.hypot((L[5].x - L[17].x) * 4 / 3, L[5].y - L[17].y);
      const curled = [[8, 5], [12, 9], [16, 13], [20, 17]].filter(([t, m]) => dist(L[t], w) < dist(L[m], w) * 1.2).length;
      return { x: 1 - (L[0].x + L[5].x + L[9].x + L[17].x) / 4, y: (L[0].y + L[5].y + L[9].y + L[17].y) / 4, s: palm, fist: curled >= 3, L };
    }).sort((a, b) => a.x - b.x);
    const assign = [null, null];
    if (hands.length >= 2) { assign[0] = hands[0]; assign[1] = hands[hands.length - 1]; }
    else if (hands.length === 1) { const h = hands[0], d0 = slots[0].vis ? Math.abs(slots[0].x - h.x) : 9, d1 = slots[1].vis ? Math.abs(slots[1].x - h.x) : 9; assign[d0 === 9 && d1 === 9 ? (h.x < .5 ? 0 : 1) : d0 <= d1 ? 0 : 1] = h; }
    slots.forEach((sl, i) => {
      const h = assign[i];
      if (!h) { if (now - sl.seen > .4) { sl.vis = false; sl.hist.length = 0; } return; }
      const k = sl.vis ? .55 : 1; sl.vis = true; sl.seen = now; sl.fist = h.fist;
      sl.x = lerp(sl.x, h.x, k); sl.y = lerp(sl.y, h.y, k); sl.s = lerp(sl.s, h.s, k); sl.L = h.L;
      sl.hist.push({ t: now, s: h.s, x: h.x, y: h.y }); while (sl.hist.length && now - sl.hist[0].t > .35) sl.hist.shift();
      const ref = sl.hist.find(p => now - p.t >= .08 && now - p.t <= .26);
      if (!ref || now - sl.lastPunch < .4) return;
      const grow = (h.s - ref.s) / ref.s, dx = h.x - ref.x, dy = h.y - ref.y;
      let kind = null;
      if (grow > .24) kind = 'straight'; else if (Math.abs(dx) > .2 && grow < .2) kind = 'hook'; else if (dy < -.2 && grow < .2) kind = 'upper';
      if (kind && h.fist) { sl.lastPunch = now; sl.hist.length = 0; onPunch(kind, i); } else if (kind && !h.fist && !sl.hinted) { sl.hinted = true; onPunch('open', i); }
    });
    return hands.length;
  }
  function drawPreview(cv, slots) {
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
    for (const sl of slots) if (sl.vis && sl.L) { c.fillStyle = sl.fist ? '#ffd36a' : '#7fe8ff'; for (const p of sl.L) { c.beginPath(); c.arc((1 - p.x) * cv.width, p.y * cv.height, 3, 0, 7); c.fill(); } }
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
    const skull = add(head, new T.SphereGeometry(.3, 16, 12), mat(SKIN), 0, 0, 0, false); skull.scale.set(1, 1.1, 1.04); outline(skull, 1.05);
    add(head, new T.BoxGeometry(.4, .17, .26), mat(DARK), 0, -.17, .12, false); add(head, new T.BoxGeometry(.26, .05, .06), mat(DARK), 0, -.07, .29, false);
    for (const s of [-1, 1]) { add(head, new T.SphereGeometry(.05, 8, 6), mat(0xf4f0e6), s * .1, .06, .27, false); add(head, new T.SphereGeometry(.025, 6, 6), mat(DARK), s * .1, .06, .31, false); const br = add(head, new T.BoxGeometry(.14, .04, .05), mat(DARK), s * .1, .14, .29, false); br.rotation.z = s * .35; add(head, new T.SphereGeometry(.06, 8, 6), mat(SKIN), s * .31, 0, 0, false); }
    add(head, new T.SphereGeometry(.05, 8, 6), mat(SKIN), 0, -.02, .31, false);
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
    return { root, hips, torso, head, arms };
  }
  function armTarget(name, s, t) {   // s = -1 left arm, +1 right arm of Vembuli (his own left / right, seen mirrored by us)
    const lead = s === -1;
    switch (name) {
      case 'windup': return lead ? { sx: .5, sz: 0, ex: -1.5 } : { sx: .7, sz: 0, ex: -1.6 };
      case 'strike': return lead ? { sx: -1.5, sz: -s * .1, ex: -.1 } : { sx: -1.5, sz: -s * .18, ex: -.1 };
      case 'hookwind': return lead ? { sx: -.9, sz: -s * 1.4, ex: -1.5 } : { sx: -.9, sz: -s * .2, ex: -2.0 };
      case 'hookstrike': return lead ? { sx: -1.0, sz: -s * .3, ex: -1.5 } : { sx: -.9, sz: -s * .2, ex: -2.0 };
      case 'guard': return { sx: -.95, sz: -s * .3, ex: -2.3 };
      case 'stagger': return { sx: .1, sz: s * .5, ex: -.6 };
      default: return { sx: -.7 + Math.sin(t * 3 + s) * .05, sz: -s * .12, ex: -2.0 + Math.sin(t * 3 + s) * .08 };
    }
  }

  /* ------------------------------------------------------------------- game */
  window.runBoxing = function (env) {
    const { T, scene, camera, g, ring, beep, chime, keys } = env;
    let resolveFn; const promise = new Promise(r => { resolveFn = r; });
    const hud = $('boxHud'), video = $('bxVideo'), pv = $('bxCanvas');
    const canvas = env.canvas;
    const V = buildVembuli(env); g.add(V.root);
    const vx0 = ring.x, vz0 = ring.z - .3;
    V.root.position.set(vx0, ring.top, vz0);
    const me = { hp: MY_HP, guard: false, dodgeT: 0, dodgeCd: 0, off: 0, offT: 0, shake: 0, flash: 0, kb: { l: 0, r: 0 } };
    const him = { hp: HIS_HP, state: 'idle', t: 0, think: 1.2, atk: null, lat: 0, latT: 0, hit: 0, combo: 0, comboT: 0, strikeDone: false, chain: 0 };
    const st = { phase: 'intro', t: 0, round: 1, clock: ROUND_T, done: false, bigT: 0, subT: 0, tauntT: 4, hands: 0, camOk: false, thrust: [0, 0], punches: 0, landed: 0 };
    const slots = [makeSlot(), makeSlot()];
    let tracker = null, lastVid = -1, closed = false;

    // my gloves (attached to the camera)
    const gloves = []; const rig = new T.Group(); camera.add(rig);
    for (const s of [-1, 1]) {
      const h = new T.Group(); rig.add(h);
      const fa = env.add(h, new T.CylinderGeometry(.05, .065, .6, 8), env.mat(0xf0b98a), 0, 0, .34, false); fa.rotation.x = Math.PI / 2;
      env.add(h, new T.CylinderGeometry(.08, .08, .15, 10), env.mat(0xf4f0e6), 0, 0, .06, false).rotation.x = Math.PI / 2;
      const gl = env.add(h, new T.SphereGeometry(.14, 12, 10), env.mat(0xd8202a), 0, 0, -.08, false); gl.scale.set(1, .9, 1.15);
      env.add(h, new T.SphereGeometry(.075, 8, 6), env.mat(0xd8202a), s * -.11, .03, -.03, false);
      gloves.push({ h, s, x: s * .3, y: -.4, z: -.75 });
    }

    const msg = (big, ms = 900, col = '#fff') => { const b = $('bxBig'); b.textContent = big; b.style.color = col; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); st.bigT = ms / 1000; };
    const sub = (who, text, ms = 2200) => { $('bxSub').innerHTML = `<b>${who}</b> ${text}`; $('bxSub').classList.add('show'); st.subT = ms / 1000; };
    const camMsg = t => { $('bxCamMsg').textContent = t; };
    const setBars = () => { $('bxMe').style.width = clamp(me.hp / MY_HP, 0, 1) * 100 + '%'; $('bxHim').style.width = clamp(him.hp / HIS_HP, 0, 1) * 100 + '%'; };

    /* ----- combat */
    function landPunch(kind) {
      if (st.phase !== 'fight' || him.state === 'down') return;
      st.punches++;
      let mult = 1, tag = '';
      if (him.state === 'guard') { mult = .25; tag = 'BLOCKED'; } else if (him.state === 'recover') { mult = 1.6; tag = 'COUNTER!'; }
      him.comboT > 0 ? him.combo++ : (him.combo = 0); him.comboT = 1.1;
      const dmg = (DMG[kind] + Math.min(2, Math.floor(him.combo / 2))) * mult;
      him.hp -= dmg; him.hit = .2; st.landed++;
      beep(mult < 1 ? 160 : 100, .09, 'square', .07); if (mult > 1 || kind !== 'straight') beep(60, .16, 'sawtooth', .05);
      if (tag) msg(tag, 600, mult < 1 ? '#a9d8ff' : '#ffd36a'); else if (him.combo >= 3) msg(him.combo + 1 + ' HIT COMBO', 700, '#ffd36a');
      if (him.state === 'windup' && kind === 'upper' && Math.random() < .5) { him.state = 'stagger'; him.t = .4; }
      else if (him.combo >= 3 && (him.state === 'idle' || him.state === 'recover') && Math.random() < .6) { him.state = 'guard'; him.t = .9; him.combo = 0; }
      setBars();
      if (him.hp <= 0) endFight('ko');
    }
    function hisStrike() {
      const heavy = him.atk.heavy;
      if (me.dodgeT > 0) { msg('DODGED', 600, '#9ff0b0'); beep(520, .06, 'triangle', .04); return; }
      const dmg = him.atk.dmg * (me.guard ? .25 : 1);
      me.hp -= dmg; me.shake = heavy ? .45 : .25; me.flash = me.guard ? .35 : 1;
      beep(heavy ? 70 : 90, .14, 'sawtooth', .07); setBars();
      if (me.guard) msg('BLOCKED', 500, '#a9d8ff');
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
      closed = true; env.setTicker(null); removeEventListener('keydown', onKey); removeEventListener('keyup', onKeyUp); canvas.removeEventListener('pointerdown', onPtr); canvas.removeEventListener('contextmenu', noCtx);
      if (tracker) { try { tracker.stream.getTracks().forEach(t => t.stop()); tracker.lm.close(); } catch (er) { } } video.srcObject = null;
      camera.remove(rig); g.remove(V.root); hud.hidden = true; resolveFn(res);
    }
    function startRound() { st.phase = 'fight'; st.clock = ROUND_T; him.state = 'idle'; him.think = 1; msg(st.round === 1 ? 'FIGHT!' : 'ROUND 2', 1000, '#ffd36a'); beep(880, .25, 'triangle', .08); $('bxRound').textContent = 'ROUND ' + st.round; sub('Rayappan', pick(CORNER)); }

    /* ----- input */
    const doPunch = (kind, side) => { if (st.t - lastP[side] < .45) return; lastP[side] = st.t; st.thrust[side] = 1; landPunch(kind); };
    function onKey(e) {
      if (e.repeat) return;
      if (e.code === 'KeyJ') doPunch('straight', 0); else if (e.code === 'KeyK') doPunch('straight', 1); else if (e.code === 'KeyU') doPunch('hook', 0); else if (e.code === 'KeyI') doPunch('upper', 1);
      else if ((e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') && me.dodgeCd <= 0 && st.phase === 'fight') { me.dodgeT = .45; me.dodgeCd = .9; me.offT = (e.code === 'KeyA' || e.code === 'ArrowLeft' ? -1 : 1) * .8; beep(420, .05, 'triangle', .03); }
    }
    const onKeyUp = () => { };
    const onPtr = e => { const side = e.pointerType === 'touch' ? (e.clientX < innerWidth / 2 ? 0 : 1) : (e.button === 2 ? 1 : 0); if (e.pointerType !== 'touch' && e.button > 2) return; doPunch('straight', side); };
    const noCtx = e => e.preventDefault();
    addEventListener('keydown', onKey); addEventListener('keyup', onKeyUp); canvas.addEventListener('pointerdown', onPtr); canvas.addEventListener('contextmenu', noCtx);
    const onTrackPunch = (kind, side) => {
      if (kind === 'open') { camMsg('Make a fist to punch'); return; }
      doPunch(kind, side);
    };

    /* ----- camera setup (runs while the intro countdown waits) */
    hud.hidden = false; $('bxCam').classList.remove('off'); setBars(); camMsg('Starting camera…');
    const camReady = (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera api');
      const tr = await openCamera(video, camMsg);
      if (closed) { tr.stream.getTracks().forEach(t => t.stop()); tr.lm.close(); return; }
      tracker = tr; st.camOk = true; camMsg('Show both hands, make a fist, punch at the screen');
    })().catch(er => { st.camOk = false; tracker = null; $('bxCam').classList.add('off'); camMsg('No camera · keyboard mode: J K punch, U hook, I uppercut, Space guard, A D dodge'); });
    // the fight never waits on the camera for long; tracking joins mid-fight if it arrives late
    const introWait = Promise.race([camReady, new Promise(r => setTimeout(r, 10000))]);

    /* ----- per frame */
    let cd = 0, started = false; const lastP = [-9, -9];
    introWait.then(() => { started = true; cd = 3.2; msg('Gloves up!', 1100, '#ffd36a'); sub('Rayappan', 'Eyes on him, thambi. Fists forward to punch, both fists up to block.', 3000); });
    env.setTicker(dt => {
      st.t += dt; const now = st.t;
      // hands
      if (tracker && video.readyState >= 2 && video.currentTime !== lastVid) {
        lastVid = video.currentTime;
        try { st.hands = readHands(tracker.lm, video, slots, performance.now() / 1000, onTrackPunch); drawPreview(pv, slots); } catch (er) { }
        if (st.phase !== 'intro' || started) camMsg(st.hands ? 'Tracking ' + st.hands + (st.hands > 1 ? ' hands' : ' hand') : 'Show your hands to the camera');
      }
      const both = slots[0].vis && slots[1].vis && slots[0].y < .5 && slots[1].y < .5 && !st.thrust[0] && !st.thrust[1];
      me.guard = both || keys.has('Space') || keys.has('KeyS');
      // timers
      st.bigT > 0 && (st.bigT -= dt); st.subT > 0 && (st.subT -= dt, st.subT <= 0 && $('bxSub').classList.remove('show'));
      me.dodgeT = Math.max(0, me.dodgeT - dt); me.dodgeCd = Math.max(0, me.dodgeCd - dt); me.shake = Math.max(0, me.shake - dt); me.flash = Math.max(0, me.flash - dt * 2.4);
      me.offT = me.dodgeT > 0 ? me.offT : lerp(me.offT, 0, Math.min(1, dt * 6)); me.off = lerp(me.off, me.offT, Math.min(1, dt * 14));
      him.hit = Math.max(0, him.hit - dt); him.comboT -= dt;
      if (st.phase === 'intro' && started) { cd -= dt; if (cd <= 0) startRound(); else if (Math.ceil(cd) !== Math.ceil(cd + dt) && cd < 3) { msg(String(Math.ceil(cd)), 700, '#fff'); beep(520, .1, 'triangle', .05); } }
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
      V.root.position.z = lerp(V.root.position.z, vz0 + advance + (him.state === 'down' ? -.1 : 0), Math.min(1, dt * 12));
      const k = Math.min(1, dt * 14), name = him.state;
      V.arms.forEach(a => {
        const lead = a.s === -1; let pose = name;
        if ((name === 'windup' || name === 'strike') && him.atk && ((him.atk.arm === 0) !== lead)) pose = 'idle';
        if ((name === 'hookwind' || name === 'hookstrike') && him.atk && ((him.atk.arm === 0) !== lead)) pose = 'idle';
        if (name === 'recover') pose = 'idle';
        const tg = armTarget(pose === 'down' || pose === 'win' ? 'idle' : pose, a.s, now);
        a.sh.rotation.x = lerp(a.sh.rotation.x, tg.sx, k); a.sh.rotation.z = lerp(a.sh.rotation.z, tg.sz, k); a.el.rotation.x = lerp(a.el.rotation.x, tg.ex, k);
        const glow = (name === 'windup' || name === 'hookwind') && ((him.atk.arm === 0) === lead) ? 1 : 0;
        a.gl.material.color.setHex(glow ? 0xff3a2a : 0x1a1a1f);
      });
      const twist = name === 'windup' ? -.35 : name === 'strike' ? .3 : name === 'hookwind' ? (him.atk.arm ? .5 : -.5) : name === 'hookstrike' ? (him.atk.arm ? -.45 : .45) : 0;
      V.torso.rotation.y = lerp(V.torso.rotation.y, twist, k); V.torso.rotation.x = lerp(V.torso.rotation.x, name === 'down' ? .9 : name === 'guard' ? .12 : him.hit > 0 ? -.12 : .04 + Math.sin(now * 2.4) * .02, k);
      V.head.rotation.x = him.hit > 0 ? -.35 : 0; V.root.rotation.y = him.hit > 0 ? Math.sin(now * 60) * .04 : 0;
      V.root.position.y = ring.top + (name === 'down' ? -.35 : Math.abs(Math.sin(now * 4.4)) * .03);
      // camera: first person at the ring edge
      const sh = me.shake > 0 ? me.shake * .06 : 0;
      g.updateWorldMatrix(true, false);
      const wp = g.localToWorld(new T.Vector3(ring.x + me.off + (Math.random() - .5) * sh, ring.top + 1.66 + Math.sin(now * 2.4) * .012 + (Math.random() - .5) * sh, ring.z + 1.7));
      camera.position.copy(wp); camera.rotation.set(.07 + (me.dodgeT > 0 ? .04 : 0), g.rotation.y + me.off * -.12, me.off * -.05);
      // my gloves
      gloves.forEach((gl, i) => {
        const sl = slots[i], t = st.thrust[i]; st.thrust[i] = Math.max(0, t - dt * 4.5);
        let tx = gl.s * .3, ty = -.4 + Math.sin(now * 2.2 + i) * .01, tz = -.75;
        if (me.guard) { tx = gl.s * .16; ty = -.06; tz = -.62; }
        else if (sl.vis) { tx = (sl.x - .5) * 1.3; ty = -(sl.y - .5) * 1.0 - .2; tz = -.95 + clamp((sl.s - .08) / .22, 0, 1) * .4; }
        const e = Math.sin(Math.PI * clamp(t, 0, 1)), kk = Math.min(1, dt * 16);
        gl.x = lerp(gl.x, tx, kk); gl.y = lerp(gl.y, ty, kk); gl.z = lerp(gl.z, tz, kk);
        gl.h.position.set(gl.x * (1 - e * .5), gl.y + e * .12, gl.z - e * .75); gl.h.rotation.set(-e * .35, -gl.s * .14, 0);
      });
      // hud
      $('bxHit').style.opacity = me.flash * .55; $('bxCam').classList.toggle('guard', me.guard);
    });
    return { promise, quit: () => endFight('time', true), state: () => ({ me, him, st }) };
  };
})();
