/* 3D batting minigame (6 balls, timing based, in the spirit of the Google cricket doodle). */
window.runCricket = function (env) {
  const { T, camera, player, bowler, fielders, cx, cz, R, stumps, beep, chime, keys, joy, setTicker, scene } = env;
  const TOTAL = 6, TARGET = env.target || 12;
  const $ = id => document.getElementById(id);
  const hud = $('cricketHud');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  return new Promise(resolve => {
    hud.hidden = false;
    const pg = player.g;
    const saved = { pos: pg.position.clone(), rot: pg.rotation.y, body: player.body.position.y, bpos: bowler.g.position.clone(), brot: bowler.g.rotation.y };
    const fieldSaved = fielders.map(f => ({ p: f.g.position.clone(), r: f.g.rotation.y }));
    const stumpSaved = stumps.map(s => ({ p: s.position.clone(), r: s.rotation.clone() }));
    env.hideVehicle(true);
    const zoom0 = camera.zoom; camera.zoom = 1.45; camera.updateProjectionMatrix();
    const bowlerScale0 = bowler.g.scale.clone(); bowler.g.scale.multiplyScalar(1.2);
    const bx = cx - 1.0, bz = cz + 5.15, zHit = bz + .1, stumpZ = cz + 5.95, z0 = cz - 5.2;
    pg.position.set(bx, .14, bz); pg.rotation.y = Math.PI * .74;
    player.body.position.y = 0;
        player.legs[0].rotation.x = .12; player.legs[1].rotation.x = -.12; player.arms[0].rotation.x = -1.0; player.arms[1].rotation.x = -1.1;

    // bat
    const bat = new T.Group(); bat.rotation.order = 'YXZ'; bat.position.set(.05, 1.3, .35); pg.add(bat);
    const wood = new T.MeshBasicMaterial({ color: 0xf6dc9a }), grip = new T.MeshToonMaterial({ color: 0xd8402a }), ink = new T.MeshBasicMaterial({ color: 0x2b1a10, side: T.BackSide });
    const blade = new T.Mesh(new T.BoxGeometry(.3, 1.0, .1), wood); blade.position.y = -.82; blade.castShadow = true; bat.add(blade);
    const bladeInk = new T.Mesh(blade.geometry, ink); bladeInk.scale.setScalar(1.08); bladeInk.position.copy(blade.position); bat.add(bladeInk);
    const spine = new T.Mesh(new T.BoxGeometry(.12, .9, .06), new T.MeshBasicMaterial({ color: 0xd9a050 })); spine.position.set(0, -.82, -.07); bat.add(spine);
    const handle = new T.Mesh(new T.CylinderGeometry(.045, .045, .42, 8), grip); handle.position.y = -.2; bat.add(handle);
    bat.scale.setScalar(1.15);
    const setBat = (yaw, pitch, roll = 0) => { bat.rotation.y = yaw; bat.rotation.x = pitch; bat.rotation.z = roll; };
    setBat(.9, -.55, -.85);

    // ball + shadow
    const ball = new T.Mesh(new T.SphereGeometry(.15, 16, 12), new T.MeshBasicMaterial({ color: 0xff3b2a })); ball.castShadow = true; ball.visible = false; scene.add(ball);
    const bshadow = new T.Mesh(new T.CircleGeometry(.13, 12), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35 })); bshadow.rotation.x = -Math.PI / 2; bshadow.visible = false; scene.add(bshadow);
    // landing marker on the pitch (subtle cue)
    const cue = new T.Mesh(new T.RingGeometry(.18, .28, 24), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7 })); cue.rotation.x = -Math.PI / 2; cue.visible = false; scene.add(cue);

    // state
    let bigShot = false, contactShot = null, st = 'ready', timer = 1.8, ballNo = 0, runs = 0, t = 0, Tflight = 1.2, line = 0, swung = false, swingT = -1, contact = null, shot = null, last = null, look = new T.Vector3(cx, 1, cz - 3), done = false, bowled = false, results = [];
    const phases = { run: 1.0 };
    const DELIVERIES = [
      { name: 'Fast ball', T: [1.0, 1.15], turn: 0, swing: 0, tip: 'Quick and straight. Drive it.' },
      { name: 'Outswinger', T: [1.05, 1.2], turn: 0, swing: .42, tip: 'It swings away in the air.' },
      { name: 'Inswinger', T: [1.05, 1.2], turn: 0, swing: -.42, tip: 'It swings in towards your pads.' },
      { name: 'Off spin', T: [1.45, 1.7], turn: -.62, swing: 0, tip: 'It will grip and turn in from the off.' },
      { name: 'Leg spin', T: [1.45, 1.7], turn: .62, swing: 0, tip: 'It will pitch and turn away from you.' },
      { name: 'Googly', T: [1.4, 1.6], turn: -.5, swing: .12, tip: 'Disguised. It turns the other way!' },
    ];
    let del = DELIVERIES[0], xb = cx, zb = cz;
    const pose = { bowlerA: 0 };

    function setHud(big, sub) {
      $('ckBalls').textContent = `Ball ${Math.min(ballNo + 1, TOTAL)} / ${TOTAL}`;
      $('ckRuns').textContent = `${runs}`; $('ckTarget').textContent = `Target ${TARGET}`;
      $('ckDots').innerHTML = Array.from({ length: TOTAL }, (_, i) => `<i class="${i < results.length ? (results[i] === 'W' ? 'w' : results[i] >= 4 ? 'b' : 'r') : ''}">${i < results.length ? results[i] : ''}</i>`).join('');
      if (big !== undefined) { $('ckBig').textContent = big; $('ckBig').classList.remove('pop'); void $('ckBig').offsetWidth; $('ckBig').classList.add('pop'); }
      if (sub !== undefined) $('ckSub').textContent = sub;
    }
    function resetBall() {
      for (let i = 0; i < 3; i++) { stumps[i].position.copy(stumpSaved[i].p); stumps[i].rotation.copy(stumpSaved[i].r); }
      fielders.forEach((f, i) => { f.g.position.copy(fieldSaved[i].p); f.g.position.y = .07; });
      ball.visible = false; bshadow.visible = false; cue.visible = false;
      bowler.g.position.set(cx, .14, cz - 10.2); bowler.g.rotation.y = 0; pose.bowlerA = 0;
      swung = false; swingT = -1; contact = null; contactShot = null; bigShot = false; shot = null; bowled = false; setBat(.9, -.55, -.85);
      line = (Math.random() - .5) * .4;
      del = DELIVERIES[Math.floor(Math.random() * DELIVERIES.length)];
      Tflight = del.T[0] + Math.random() * (del.T[1] - del.T[0]);
      xb = cx + line - del.turn; zb = z0 + (zHit - z0) * .6;
      st = 'run'; t = 0;
      setHud('', `${del.name} coming · ${del.tip}`);
    }
    function pickShot() {
      const k = c => keys.has(c);
      const left = k('KeyA') || k('ArrowLeft') || joy.x < -.35, right = k('KeyD') || k('ArrowRight') || joy.x > .35, up = k('KeyW') || k('ArrowUp') || joy.z < -.35, down = k('KeyS') || k('ArrowDown') || joy.z > .35;
      const spin = del.turn !== 0;
      if (down) return { id: 'block', name: 'Forward defence', base: 0, anim: 'block' };
      if (up && left) return { id: 'slog', name: 'Slog sweep', base: -.75, anim: 'sweep', loft: true };
      if (up && right) return { id: 'inout', name: 'Lofted cover drive', base: .7, anim: 'cover', loft: true };
      if (up) return { id: 'loft', name: 'Lofted straight hit', base: 0, anim: 'loft', loft: true };
      if (left) return spin ? { id: 'sweep', name: 'Sweep', base: -.85, anim: 'sweep' } : { id: 'pull', name: 'Pull shot', base: -.7, anim: 'pull' };
      if (right) return spin ? { id: 'cut', name: 'Late cut', base: .85, anim: 'cut' } : { id: 'cover', name: 'Cover drive', base: .65, anim: 'cover' };
      return { id: 'drive', name: 'Straight drive', base: 0, anim: 'drive' };
    }
    function swing() {
      if (done || st !== 'flight' || swung) return;
      swung = true; swingT = 0;
      const e = (t + .1) - Tflight; // negative = early
      const ae = Math.abs(e), sh = pickShot();
      let r = 0, label = 'MISSED', caught = false, block = false;
      if (sh.id === 'block') { block = ae < .22; label = 'DEFENDED'; r = 0; }
      else {
        if (ae < .045) { r = 6; label = 'SIX!'; } else if (ae < .085) { r = 4; label = 'FOUR!'; } else if (ae < .125) { r = 2; label = 'TWO'; } else if (ae < .175) { r = 1; label = 'SINGLE'; }
        if (sh.loft) { if (ae < .05) { r = 6; label = 'SIX!'; } else if (ae < .09) { r = 4; label = 'FOUR!'; } else if (ae < .2) { r = 0; caught = true; label = 'CAUGHT!'; } }
        else if (r === 6) { r = 4; label = 'FOUR!'; }
      }
      contact = { time: t + .1, e, r, label, shot: sh, caught, block }; contactShot = sh;
      beep(r || block ? 700 : 200, .08, r || block ? 'triangle' : 'sawtooth');
    }
    const onKey = ev => { if (ev.code === 'Escape') { ev.preventDefault(); quit(); return; } if (ev.code === 'Space' || ev.code === 'Enter' || ev.code === 'KeyE') { ev.preventDefault(); swing(); } };
    const exitBtn = $('ckExit'); const onExit = ev => { ev.preventDefault(); ev.stopPropagation(); quit(); };
    if (exitBtn) { exitBtn.addEventListener('pointerdown', ev => ev.stopPropagation()); exitBtn.addEventListener('click', onExit); }
    const onTap = ev => { ev.preventDefault(); swing(); };
    addEventListener('keydown', onKey); hud.addEventListener('pointerdown', onTap);

    function launch(c) {
      // direction: early = leg side (left on screen), late = off side (right), plus A/D aim
      const aim = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
      const th = clamp(c.shot.base + c.e * 5 + aim * .35, -1.25, 1.25);
      const d = new T.Vector3(Math.sin(th), 0, -Math.cos(th));
      const sp = ball.position.clone(); sp.y = .8;
      // distance to boundary rope along d
      const ox = sp.x - cx, oz = sp.z - cz, b = ox * d.x + oz * d.z, cc = ox * ox + oz * oz - R * R, L = -b + Math.sqrt(b * b - cc);
      let dist, dur, apex;
      if (c.caught) { dist = L * .42; dur = 1.25; apex = 5.5; }
      else if (c.r === 6) { dist = L + 4; dur = 1.9; apex = 7; }
      else if (c.r === 4) { dist = L; dur = 1.25; apex = .3; }
      else if (c.r === 2) { dist = L * .62; dur = 1.1; apex = 2.2; }
      else { dist = L * .33; dur = .9; apex = 1.3; }
      shot = { t: 0, dur, dist, d, sp, apex, r: c.r };
      const landing = sp.clone().addScaledVector(d, dist);
      let best = 0, bd = 1e9; fielders.forEach((f, i) => { const k = Math.hypot(f.g.position.x - landing.x, f.g.position.z - landing.z); if (k < bd) { bd = k; best = i; } });
      shot.fielder = fielders[best]; shot.fStart = shot.fielder.g.position.clone(); shot.landing = landing;
      st = 'shot'; runs += c.r; results.push(c.caught ? 'W' : c.r);
      const ms = Math.round(c.e * 1000);
      setHud(c.label, `${c.shot.name} · ${Math.abs(ms)} ms ${ms < 0 ? 'early' : ms > 0 ? 'late' : 'perfect'} · ${c.caught ? 'Skied it! Safe hands.' : ['Crack!', 'What a shot!', 'Right off the middle!', 'Sweet timing!'][Math.floor(Math.random() * 4)]}`);
      if (c.r >= 4) chime();
    }

    function ballPos(tt) {
      const speed = (zHit - z0) / Tflight, tb = .6 * Tflight;
      let x, y;
      if (tt <= tb) { const u = tt / tb; x = lerp(cx + .15, xb, u) + del.swing * Math.sin(Math.PI * u * .95) * (1 - .3 * u); y = .1 + 1.65 * (1 - u * u); }
      else { const u = clamp((tt - tb) / (Tflight - tb), 0, 1.5), e = u < 1 ? 1 - (1 - u) * (1 - u) : 1 + (u - 1) * .3; x = xb + del.turn * e; y = tt <= Tflight ? .1 + .72 * (1 - (1 - Math.min(1, u)) ** 2) : Math.max(.12, .82 - (tt - Tflight) * 1.4); }
      return new T.Vector3(x, y, z0 + speed * tt);
    }

    function finishBall(text, sub) {
      st = 'result'; timer = 1.7; bigShot = /SIX|FOUR/.test(text || '');
      ball.visible = false; bshadow.visible = false; cue.visible = false;
      if (text) setHud(text, sub);
      $('ckRuns').textContent = runs;
    }

    function update(dt) {
      if (done) return;
      // idle / bowler animation
      const walk = (p, ph, a) => { const s = Math.sin(ph) * .8 * a; p.legs[0].rotation.x = s; p.legs[1].rotation.x = -s; p.arms[0].rotation.x = -s; };
      if (st === 'ready') { timer -= dt; if (timer <= 0) { setHud('Play!', ''); resetBall(); } }
      else if (st === 'run') {
        t += dt; const u = clamp(t / phases.run, 0, 1);
        bowler.g.position.set(cx + .15 * u, .14, lerp(cz - 10.2, cz - 6.2, u)); walk(bowler, t * 14, 1);
        bowler.arms[1].rotation.x = u > .7 ? -(u - .7) / .3 * 3.0 : 0;
        ball.visible = true; ball.position.set(bowler.g.position.x + .25, 1.0 + (u > .7 ? (u - .7) / .3 * .9 : 0), bowler.g.position.z + .25); bshadow.visible = false;
        if (t >= phases.run) { st = 'flight'; t = 0; ball.visible = bshadow.visible = true; cue.visible = true; cue.position.set(xb, .03, zb); beep(330, .05, 'triangle'); bowler.arms[1].rotation.x = -3.1; }
      }
      else if (st === 'flight') {
        t += dt; if (window.__ckForce && !swung && t + .1 >= Tflight - .005) { const F = window.__ckForce; F.keys.forEach(k => keys.add(k)); swing(); F.keys.forEach(k => keys.delete(k)); if (F.once) window.__ckForce = null; }
        if (t > .12) bowler.arms[1].rotation.x = lerp(bowler.arms[1].rotation.x, 0, dt * 6);
        if (contact && t >= contact.time) { const c = contact; contact = null; if (c.block) { results.push(0); finishBall('DEFENDED!', c.shot.name + ' · solid, dead bat. No run, no wicket.'); ballNoNext(); } else if (c.r > 0 || c.caught) { ball.position.set(bx + .85, .8, zHit - .1); launch(c); } }
        else {
          const p = ballPos(t); ball.position.copy(p); ball.rotation.x += dt * 12; bshadow.position.set(p.x, .03, p.z); bshadow.scale.setScalar(clamp(1 - p.y * .25, .4, 1));
          if (t > Tflight + .02 && p.z >= stumpZ - .1) {
            const hitStumps = Math.abs(p.x - cx) < .2 && !(contact && contact.r);
            if (hitStumps) { stumps.forEach((s, i) => { s.rotation.x = .9 + i * .3; s.position.z += .5 + i * .2; s.position.x += (i - 1) * .25; }); beep(160, .3, 'sawtooth'); results.push('W'); finishBall('BOWLED!', 'Timber! The stumps went flying.'); }
            else { results.push(0); finishBall('MISSED!', swung ? (contact === null && swingT >= 0 ? 'You swung and missed.' : 'Dot ball.') : 'You never swung. Dot ball.'); }
            ballNoNext();
          }
        }
      }
      else if (st === 'shot') {
        shot.t += dt; const u = clamp(shot.t / shot.dur, 0, 1);
        const p = shot.sp.clone().addScaledVector(shot.d, shot.dist * u);
        p.y = shot.r === 4 ? .1 + Math.abs(Math.sin(u * Math.PI * 4)) * .3 * (1 - u) : .1 + shot.apex * 4 * u * (1 - u) + .8 * (1 - u);
        ball.position.copy(p); ball.rotation.x += dt * 10; bshadow.position.set(p.x, .03, p.z); bshadow.scale.setScalar(clamp(1 - p.y * .08, .4, 1));
        const f = shot.fielder; if (shot.r < 6) { const k = Math.min(1, shot.t / (shot.dur * .9)); f.g.position.x = lerp(shot.fStart.x, shot.landing.x, k); f.g.position.z = lerp(shot.fStart.z, shot.landing.z, k); f.g.rotation.y = Math.atan2(shot.landing.x - shot.fStart.x, shot.landing.z - shot.fStart.z); walk(f, performance.now() / 70, 1); }
        if (u >= 1) { finishBall(); ballNoNext(); }
      }
      else if (st === 'result') { timer -= dt; if (timer <= 0) { if (ballNo >= TOTAL) endGame(); else resetBall(); } }

      // batter animation (each shot has its own bat path and body turn)
      const ANIM = {
        drive: { y: [1.1, .15], p: [-.35, -1.5], b: [-.1, .35], roll: [-.5, 0], low: 0, ft: [-.9, -2.7, .3], hop: .06 },
        cover: { y: [1.3, -.9], p: [-.5, -1.45], b: [-.5, .75], roll: [-.6, 0], low: 0, ft: [-1.7, -2.6, .5], hop: .1, spin: .5 },
        cut: { y: [1.6, -1.2], p: [-1.0, -1.25], b: [-.9, .6], roll: [-1.0, 0], low: 0 },
        pull: { y: [2.5, -2.4], p: [-1.45, -1.45], b: [-1.0, 1.5], roll: [-.2, 0], low: .05, ft: [-3.0, -2.4, .6], hop: .14, spin: .8 },
        sweep: { y: [2.0, -1.8], p: [-1.5, -1.5], b: [-.6, 1.2], roll: [0, 0], low: .3, lean: .5 },
        loft: { y: [.9, -.1], p: [.1, -2.1], b: [-.1, .5], roll: [-.3, 0], low: 0, ft: [-.6, -3.0, .2], hop: .16, spin: .6 },
        block: { y: [.6, .4], p: [-.4, -.75], b: [-.1, .05], roll: [-.5, -.1], low: 0 },
      };
      if (swingT >= 0) {
        swingT += dt; const A = ANIM[(contactShot && contactShot.anim) || 'cover'], k = clamp(swingT / .22, 0, 1), ek = k * k * (3 - 2 * k);
        const fk = clamp((swingT - .22) / .38, 0, 1), fe = fk * fk * (3 - 2 * fk), F = A.ft || [A.y[1] - .5, A.p[1] + .5, 1.0];
        // swing through the ball, then a flowing follow-through over the shoulder
        setBat(lerp(lerp(A.y[0], A.y[1], ek), F[0], fe), lerp(lerp(A.p[0], A.p[1], ek), F[1], fe), lerp(lerp(A.roll[0], A.roll[1], ek), F[2], fe));
        player.body.rotation.y = lerp(A.b[0], A.b[1], ek) + (A.spin || 0) * fe;
        const pul = Math.sin(Math.PI * Math.min(1, swingT / .6));
        player.body.rotation.x = (A.lean || 0) * pul; player.body.position.y = -A.low * pul + (A.hop || 0) * Math.sin(Math.PI * clamp(swingT / .45, 0, 1));
        if (swingT > .6) { swingT = -1; player.body.rotation.x = 0; player.body.position.y = 0; }
      } else if (st === 'result' && bigShot) {
        // celebration: bat raised high, little bounce, slow spin
        const q = performance.now() / 1000; setBat(.4, -2.6 + Math.sin(q * 6) * .1, -.2);
        player.body.position.y = Math.abs(Math.sin(q * 5)) * .18; player.body.rotation.y += dt * 2.2;
      } else { player.body.position.y = lerp(player.body.position.y, 0, dt * 8); player.body.rotation.y = lerp(player.body.rotation.y, -.3, dt * 6); if (st !== 'result' && st !== 'shot') { const q = performance.now() / 1000, tap = Math.max(0, Math.sin(q * 3.1)); setBat(.9, -.45 + tap * .35 - Math.sin(q * 2.4) * .05, -.85 + tap * .1); } }

      // camera
      const ft = st === 'shot' && shot ? ball.position : null;
      const base = new T.Vector3(cx + 2.4, 2.4, bz + 6.0);
      camera.position.lerp(base, 1 - Math.exp(-dt * 3));
      const tgt = ft ? new T.Vector3(ft.x * .55 + cx * .45, 1.2 + ft.y * .25, ft.z * .55 + (cz - 3) * .45) : new T.Vector3(cx - .3, 1.0, cz - 2.5);
      look.lerp(tgt, 1 - Math.exp(-dt * 3)); camera.lookAt(look);
    }
    let counted = -1;
    function ballNoNext() { if (counted !== ballNo) { counted = ballNo; ballNo++; } }

    let finished = false;
    function finish(res) {
      if (finished) return; finished = true; done = true;
      removeEventListener('keydown', onKey); hud.removeEventListener('pointerdown', onTap); if (exitBtn) exitBtn.removeEventListener('click', onExit); hud.hidden = true;
      pg.remove(bat); scene.remove(ball, bshadow, cue); setTicker(null);
      pg.position.copy(saved.pos); pg.rotation.y = saved.rot; player.body.position.y = saved.body; player.body.rotation.y = 0;
      bowler.g.position.copy(saved.bpos); bowler.g.rotation.y = saved.brot; bowler.arms[1].rotation.x = 0; bowler.g.scale.copy(bowlerScale0); camera.zoom = zoom0; camera.updateProjectionMatrix();
      fielders.forEach((f, i) => { f.g.position.copy(fieldSaved[i].p); f.g.rotation.y = fieldSaved[i].r; });
      stumps.forEach((s, i) => { s.position.copy(stumpSaved[i].p); s.rotation.copy(stumpSaved[i].r); });
      env.hideVehicle(false);
      resolve(res);
    }
    function quit() { finish({ runs, won: false, quit: true }); }
    function endGame() {
      done = true; const won = runs >= TARGET;
      setHud(won ? `${runs} RUNS!` : `${runs} RUNS`, won ? 'Target chased. The whole gully is cheering!' : `Needed ${TARGET}. Ravi says: one more over?`);
      if (won) chime();
      setTimeout(() => finish({ runs, won }), 2600);
    }

    setTicker(update);
    env.debug = () => ({ st, t, Tflight, ballNo, runs, swung });
    window.__cricket = env.debug;
    camera.position.set(cx + 2.4, 2.4, bz + 6.0); look.set(cx - .3, 1.0, cz - 2.5); camera.lookAt(look);
    setHud('6 balls', `Target ${TARGET} runs · SPACE to swing as the ball reaches the bat · W / A / S / D choose the shot · Esc to exit`);
  });
};
