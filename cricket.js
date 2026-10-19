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
    let st = 'ready', timer = 1.8, ballNo = 0, runs = 0, t = 0, Tflight = 1.2, line = 0, swung = false, swingT = -1, contact = null, shot = null, last = null, look = new T.Vector3(cx, 1, cz - 3), done = false, bowled = false, results = [];
    const phases = { run: 1.0 };
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
      swung = false; swingT = -1; contact = null; shot = null; bowled = false; setBat(.9, -.55, -.85);
      line = (Math.random() - .5) * .5;
      Tflight = [1.3, 1.1, 1.45, 1.2, 1.0, 1.35][Math.floor(Math.random() * 6)] + (Math.random() - .5) * .1;
      st = 'run'; t = 0;
      setHud('', 'Watch the bowler... press SPACE when the ball reaches your bat');
    }
    function swing() {
      if (done || st !== 'flight' || swung) return;
      swung = true; swingT = 0;
      const e = (t + .1) - Tflight; // negative = early
      const ae = Math.abs(e);
      let r = 0, label = 'MISSED';
      if (ae < .045) { r = 6; label = 'SIX!'; } else if (ae < .085) { r = 4; label = 'FOUR!'; } else if (ae < .125) { r = 2; label = 'TWO'; } else if (ae < .175) { r = 1; label = 'SINGLE'; }
      contact = { time: t + .1, e, r, label };
      beep(r ? 700 : 200, .08, r ? 'triangle' : 'sawtooth');
    }
    const onKey = ev => { if (ev.code === 'Space' || ev.code === 'Enter' || ev.code === 'KeyE') { ev.preventDefault(); swing(); } };
    const onTap = ev => { ev.preventDefault(); swing(); };
    addEventListener('keydown', onKey); hud.addEventListener('pointerdown', onTap);

    function launch(c) {
      // direction: early = leg side (left on screen), late = off side (right), plus A/D aim
      const aim = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
      const th = clamp(c.e * 7 + aim * .7, -1.15, 1.15);
      const d = new T.Vector3(Math.sin(th), 0, -Math.cos(th));
      const sp = ball.position.clone(); sp.y = .8;
      // distance to boundary rope along d
      const ox = sp.x - cx, oz = sp.z - cz, b = ox * d.x + oz * d.z, cc = ox * ox + oz * oz - R * R, L = -b + Math.sqrt(b * b - cc);
      let dist, dur, apex;
      if (c.r === 6) { dist = L + 4; dur = 1.9; apex = 7; }
      else if (c.r === 4) { dist = L; dur = 1.25; apex = .3; }
      else if (c.r === 2) { dist = L * .62; dur = 1.1; apex = 2.2; }
      else { dist = L * .33; dur = .9; apex = 1.3; }
      shot = { t: 0, dur, dist, d, sp, apex, r: c.r };
      const landing = sp.clone().addScaledVector(d, dist);
      let best = 0, bd = 1e9; fielders.forEach((f, i) => { const k = Math.hypot(f.g.position.x - landing.x, f.g.position.z - landing.z); if (k < bd) { bd = k; best = i; } });
      shot.fielder = fielders[best]; shot.fStart = shot.fielder.g.position.clone(); shot.landing = landing;
      st = 'shot'; runs += c.r; results.push(c.r);
      const ms = Math.round(c.e * 1000);
      setHud(c.label, `${Math.abs(ms)} ms ${ms < 0 ? 'early' : ms > 0 ? 'late' : 'perfect'} · ${[ 'Crack!', 'What a shot!', 'Straight out of the sweet spot!', 'Right off the middle!'][Math.floor(Math.random() * 4)]}`);
      if (c.r >= 4) chime();
    }

    function ballPos(tt) {
      const u = tt / Tflight, xHit = cx + line, x0 = cx + .15;
      const speed = (zHit - z0) / Tflight, tb = .6 * Tflight;
      let y;
      if (tt <= tb) y = .1 + 1.65 * (1 - (tt / tb) ** 2);
      else if (tt <= Tflight) { const u2 = (tt - tb) / (Tflight - tb); y = .1 + .72 * (1 - (1 - u2) ** 2); }
      else y = Math.max(.12, .82 - (tt - Tflight) * 1.4);
      return new T.Vector3(lerp(x0, xHit, clamp(u, 0, 1.4)), y, z0 + speed * tt);
    }

    function finishBall(text, sub) {
      st = 'result'; timer = 1.7;
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
        if (t >= phases.run) { st = 'flight'; t = 0; ball.visible = bshadow.visible = true; cue.visible = true; cue.position.set(cx + line * .6, .03, lerp(z0, zHit, .6)); beep(330, .05, 'triangle'); bowler.arms[1].rotation.x = -3.1; }
      }
      else if (st === 'flight') {
        t += dt; if (t > .12) bowler.arms[1].rotation.x = lerp(bowler.arms[1].rotation.x, 0, dt * 6);
        if (contact && t >= contact.time) { const c = contact; contact = null; if (c.r > 0) { ball.position.set(bx + .85, .8, zHit - .1); launch(c); } }
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

      // batter animation
      if (swingT >= 0) {
        swingT += dt; const k = clamp(swingT / .2, 0, 1);
        setBat(lerp(2.0, -1.8, k), -1.25); player.body.rotation.y = lerp(-.5, .8, k);
        if (swingT > .6) { swingT = -1; }
      } else { player.body.rotation.y = lerp(player.body.rotation.y, -.3, dt * 6); if (st !== 'result' && st !== 'shot') setBat(.9, -.45 + Math.sin(performance.now() / 420) * .06, -.85); }

      // camera
      const ft = st === 'shot' && shot ? ball.position : null;
      const base = new T.Vector3(cx + 2.4, 2.4, bz + 6.0);
      camera.position.lerp(base, 1 - Math.exp(-dt * 3));
      const tgt = ft ? new T.Vector3(ft.x * .55 + cx * .45, 1.2 + ft.y * .25, ft.z * .55 + (cz - 3) * .45) : new T.Vector3(cx - .3, 1.0, cz - 2.5);
      look.lerp(tgt, 1 - Math.exp(-dt * 3)); camera.lookAt(look);
    }
    let counted = -1;
    function ballNoNext() { if (counted !== ballNo) { counted = ballNo; ballNo++; } }

    function endGame() {
      done = true; const won = runs >= TARGET;
      setHud(won ? `${runs} RUNS!` : `${runs} RUNS`, won ? 'Target chased. The whole gully is cheering!' : `Needed ${TARGET}. Ravi says: one more over?`);
      if (won) chime();
      setTimeout(() => {
        removeEventListener('keydown', onKey); hud.removeEventListener('pointerdown', onTap); hud.hidden = true;
        pg.remove(bat); scene.remove(ball, bshadow, cue); setTicker(null);
        pg.position.copy(saved.pos); pg.rotation.y = saved.rot; player.body.position.y = saved.body; player.body.rotation.y = 0;
        bowler.g.position.copy(saved.bpos); bowler.g.rotation.y = saved.brot; bowler.g.scale.copy(bowlerScale0); camera.zoom = zoom0; camera.updateProjectionMatrix(); bowler.arms[1].rotation.x = 0;
        fielders.forEach((f, i) => { f.g.position.copy(fieldSaved[i].p); f.g.rotation.y = fieldSaved[i].r; });
        stumps.forEach((s, i) => { s.position.copy(stumpSaved[i].p); s.rotation.copy(stumpSaved[i].r); });
        env.hideVehicle(false);
        resolve({ runs, won });
      }, 2600);
    }

    setTicker(update);
    env.debug = () => ({ st, t, Tflight, ballNo, runs, swung });
    window.__cricket = env.debug;
    camera.position.set(cx + 2.4, 2.4, bz + 6.0); look.set(cx - .3, 1.0, cz - 2.5); camera.lookAt(look);
    setHud('6 balls', `Target ${TARGET} runs · SPACE to swing as the ball reaches the bat · hold A/D to aim`);
  });
};
