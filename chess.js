/* Chess for Gully Days: small rules engine + gentle AI + 3D board (Three.js).
   Rules: all piece moves, castling, check/checkmate/stalemate, pawn double-step, auto-queen promotion,
   draws (agreement, threefold repetition, 50-move rule, insufficient material).
   Not included: en passant. Thatha sits opposite the board with hand gestures and trash talk. */
(() => {
  const T = THREE;
  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const START = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'];
  const newBoard = () => START.map(row => [...row].map(ch => ch === '.' ? null : { t: ch.toUpperCase(), c: ch === ch.toUpperCase() ? 'w' : 'b' }));
  const copy = b => b.map(r => r.slice());
  const opp = c => c === 'w' ? 'b' : 'w';
  const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function pseudo(b, color) {
    const out = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c]; if (!p || p.c !== color) continue;
      const push = (r2, c2) => out.push({ from: [r, c], to: [r2, c2], cap: b[r2][c2], promo: p.t === 'P' && (r2 === 0 || r2 === 7) });
      if (p.t === 'P') {
        const d = color === 'w' ? -1 : 1, st = color === 'w' ? 6 : 1, r1 = r + d;
        if (inb(r1, c) && !b[r1][c]) { push(r1, c); if (r === st && !b[r + 2 * d][c]) push(r + 2 * d, c); }
        for (const dc of [-1, 1]) { const cc = c + dc; if (inb(r1, cc) && b[r1][cc] && b[r1][cc].c !== color) push(r1, cc); }
      } else if (p.t === 'N' || p.t === 'K') {
        for (const [dr, dc] of p.t === 'N' ? KN : KG) { const r2 = r + dr, c2 = c + dc; if (inb(r2, c2) && (!b[r2][c2] || b[r2][c2].c !== color)) push(r2, c2); }
      } else {
        const dirs = p.t === 'B' ? DIAG : p.t === 'R' ? ORTH : DIAG.concat(ORTH);
        for (const [dr, dc] of dirs) { let r2 = r + dr, c2 = c + dc; while (inb(r2, c2)) { if (b[r2][c2]) { if (b[r2][c2].c !== color) push(r2, c2); break; } push(r2, c2); r2 += dr; c2 += dc; } }
      }
      if (p.t === 'K' && !p.moved && r === (color === 'w' ? 7 : 0) && c === 4 && !attacked(b, r, c, opp(color))) {
        for (const [rc, dir, gap] of [[7, 1, [5, 6]], [0, -1, [3, 2, 1]]]) {
          const rk = b[r][rc];
          if (!rk || rk.t !== 'R' || rk.c !== color || rk.moved || gap.some(x => b[r][x])) continue;
          if ([c + dir, c + 2 * dir].some(x => attacked(b, r, x, opp(color)))) continue;
          out.push({ from: [r, c], to: [r, c + 2 * dir], cap: null, promo: false, castle: { rf: rc, rt: c + dir } });
        }
      }
    }
    return out;
  }
  function attacked(b, r, c, by) {
    const d = by === 'w' ? 1 : -1; // white pawns attack upward (row-1), so a white pawn sits at row r+1
    for (const dc of [-1, 1]) { const p = inb(r + d, c + dc) && b[r + d][c + dc]; if (p && p.c === by && p.t === 'P') return true; }
    for (const [dr, dc] of KN) { const p = inb(r + dr, c + dc) && b[r + dr][c + dc]; if (p && p.c === by && p.t === 'N') return true; }
    for (const [dr, dc] of KG) { const p = inb(r + dr, c + dc) && b[r + dr][c + dc]; if (p && p.c === by && p.t === 'K') return true; }
    for (const [dirs, kinds] of [[DIAG, 'BQ'], [ORTH, 'RQ']]) for (const [dr, dc] of dirs) {
      let r2 = r + dr, c2 = c + dc;
      while (inb(r2, c2)) { const p = b[r2][c2]; if (p) { if (p.c === by && kinds.includes(p.t)) return true; break; } r2 += dr; c2 += dc; }
    }
    return false;
  }
  function kingPos(b, color) { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = b[r][c]; if (p && p.t === 'K' && p.c === color) return [r, c]; } return null; }
  const inCheck = (b, color) => { const k = kingPos(b, color); return k ? attacked(b, k[0], k[1], opp(color)) : false; };
  function apply(b, m) {
    const nb = copy(b), p = nb[m.from[0]][m.from[1]];
    nb[m.to[0]][m.to[1]] = { t: m.promo ? 'Q' : p.t, c: p.c, moved: true }; nb[m.from[0]][m.from[1]] = null;
    if (m.castle) { const r = m.from[0]; nb[r][m.castle.rt] = { t: 'R', c: p.c, moved: true }; nb[r][m.castle.rf] = null; }
    return nb;
  }
  const legal = (b, color) => pseudo(b, color).filter(m => !inCheck(apply(b, m), color));
  function evaluate(b, color) {
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c]; if (!p) continue;
      let v = VAL[p.t];
      const cen = 3.5 - Math.hypot(r - 3.5, c - 3.5) * .5;
      if (p.t === 'N' || p.t === 'B') v += cen * 8; else if (p.t === 'P') v += cen * 3 + (p.c === 'w' ? 6 - r : r - 1) * 5; else if (p.t === 'Q') v += cen * 2; else if (p.t === 'K' && r === (p.c === 'w' ? 7 : 0) && (c <= 2 || c >= 6)) v += 35;
      s += p.c === 'w' ? v : -v;
    }
    return color === 'w' ? s : -s;
  }
  function negamax(b, color, depth, alpha, beta) {
    if (depth === 0) return evaluate(b, color);
    const ms = legal(b, color);
    if (!ms.length) return inCheck(b, color) ? -99999 - depth : 0;
    ms.sort((x, y) => (y.cap ? VAL[y.cap.t] : 0) - (x.cap ? VAL[x.cap.t] : 0));
    let best = -Infinity;
    for (const m of ms) { const s = -negamax(apply(b, m), opp(color), depth - 1, -beta, -alpha); if (s > best) best = s; if (best > alpha) alpha = best; if (alpha >= beta) break; }
    return best;
  }
  function scored(b, color) { return legal(b, color).map(m => ({ m, s: -negamax(apply(b, m), opp(color), 1, -Infinity, Infinity) })).sort((x, y) => y.s - x.s); }
  function gentleMove(b, color) {
    const sc = scored(b, color); if (!sc.length) return null;
    if (sc[0].s > 90000) return sc[0].m;
    if (Math.random() < .22) return sc[Math.floor(Math.random() * Math.min(4, sc.length))].m; // Thatha sometimes plays like a grandfather
    const good = sc.filter(x => x.s >= sc[0].s - 25); return good[Math.floor(Math.random() * good.length)].m;
  }
  const posKey = (b, turn) => b.map(row => row.map(p => p ? (p.c === 'w' ? p.t : p.t.toLowerCase()) : '.').join('')).join('/') + turn
    + [[7, 7], [7, 0], [0, 7], [0, 0]].map(([r, c]) => { const k = b[r][4], rk = b[r][c]; return k && rk && k.t === 'K' && !k.moved && rk.t === 'R' && !rk.moved ? 1 : 0; }).join('');
  function deadDraw(b) { const rest = b.flat().filter(p => p && p.t !== 'K'); return !rest.length || (rest.length === 1 && (rest[0].t === 'B' || rest[0].t === 'N')); }
  const bestMove = (b, color) => { const sc = scored(b, color); return sc.length ? sc[0].m : null; };

  /* ------------------------------------------------------------ 3D view */
  const scene = new T.Scene(); scene.background = new T.Color(0x9fc9a4); scene.fog = new T.Fog(0xb9d6b0, 24, 60);
  const camera = new T.PerspectiveCamera(44, 1, .1, 100); camera.position.set(0, 11.8, 9.6); camera.lookAt(0, 0, -1.6);
  scene.add(new T.HemisphereLight(0xfff4d8, 0x6a8a58, 1.2));
  const dl = new T.DirectionalLight(0xffe9c0, 2.4); dl.position.set(-5, 11, 6); dl.castShadow = true; dl.shadow.mapSize.set(1024, 1024);
  Object.assign(dl.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 }); scene.add(dl);
  const lamp = new T.PointLight(0xffc27a, 40, 30, 2); lamp.position.set(0, 7, 1); scene.add(lamp);
  const glow = c => new T.MeshStandardMaterial({ color: new T.Color(c).multiplyScalar(.25), emissive: c, emissiveIntensity: .5, roughness: .35 });
  const mat = (c, r = .6) => new T.MeshStandardMaterial({ color: c, roughness: r });
  const table = new T.Mesh(new T.BoxGeometry(30, .6, 30), mat(0x7a5a3a, .9)); table.position.y = -.7; table.receiveShadow = true; scene.add(table);
  const base = new T.Mesh(new T.BoxGeometry(9.2, .4, 9.2), mat(0x5a3a22, .7)); base.position.y = -.2; base.receiveShadow = true; base.castShadow = true; scene.add(base);
  const sqMeshes = [];
  for (let r = 0; r < 8; r++) { sqMeshes[r] = []; for (let c = 0; c < 8; c++) { const m = new T.Mesh(new T.BoxGeometry(1, .1, 1), mat((r + c) % 2 ? 0x9a6a40 : 0xf0dcb0, .8)); m.position.set(c - 3.5, 0, r - 3.5); m.receiveShadow = true; m.userData.sq = [r, c]; scene.add(m); sqMeshes[r][c] = m; } }
  const hiMat = new T.MeshBasicMaterial({ color: 0xf0b84a, transparent: true, opacity: .75 });
  const dotMat = new T.MeshBasicMaterial({ color: 0x66d98a, transparent: true, opacity: .85 });
  const hintMat = new T.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: .8 });
  const markers = new T.Group(); scene.add(markers);
  const sqPos = (r, c) => new T.Vector3(c - 3.5, .05, r - 3.5);

  const MW = mat(0xf7ecd2, .5), MB = mat(0x4a2f1d, .5);
  const lathe = (pts, m) => new T.Mesh(new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), 16), m);
  function makePiece(type, color) {
    const m = color === 'w' ? MW : MB, g = new T.Group();
    const put = (mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };
    const ball = (r, y) => put(new T.Mesh(new T.SphereGeometry(r, 14, 10), m), 0, y, 0);
    const foot = [[0, 0], [.33, 0], [.35, .05], [.3, .1]];
    if (type === 'P') { put(lathe([...foot, [.17, .2], [.13, .4], [.2, .45], [.12, .5], [0, .5]], m)); ball(.17, .62); }
    else if (type === 'R') { put(lathe([...foot, [.24, .22], [.22, .5], [.31, .56], [.31, .74], [0, .74]], m)); for (let i = 0; i < 4; i++) put(new T.Mesh(new T.BoxGeometry(.13, .12, .13), m), Math.cos(i * 1.57 + .78) * .22, .8, Math.sin(i * 1.57 + .78) * .22); }
    else if (type === 'N') {
      put(lathe([...foot, [.26, .18], [.22, .3], [0, .3]], m));
      const body = put(new T.Mesh(new T.BoxGeometry(.3, .5, .32), m), 0, .55, 0); body.rotation.x = .12;
      const head = put(new T.Mesh(new T.BoxGeometry(.24, .26, .5), m), 0, .86, .14); head.rotation.x = -.35;
      put(new T.Mesh(new T.BoxGeometry(.2, .18, .22), m), 0, .78, .4);
      for (const s of [-1, 1]) put(new T.Mesh(new T.ConeGeometry(.05, .14, 6), m), s * .08, 1.04, -.04);
      g.rotation.y = color === 'w' ? Math.PI : 0;
    }
    else if (type === 'B') { put(lathe([...foot, [.2, .22], [.13, .5], [.22, .58], [.2, .74], [.07, .92], [0, .94]], m)); ball(.07, 1.0); }
    else if (type === 'Q') { put(lathe([...foot, [.24, .22], [.15, .55], [.26, .66], [.3, .86], [.18, .84], [0, .84]], m)); ball(.1, 1.0); for (let i = 0; i < 6; i++) put(new T.Mesh(new T.SphereGeometry(.05, 8, 6), m), Math.cos(i * 1.047) * .27, .9, Math.sin(i * 1.047) * .27); }
    else { put(lathe([...foot, [.25, .22], [.15, .6], [.27, .7], [.25, .9], [.12, .94], [0, .94]], m)); put(new T.Mesh(new T.BoxGeometry(.1, .34, .1), m), 0, 1.15, 0); put(new T.Mesh(new T.BoxGeometry(.3, .1, .1), m), 0, 1.15, 0); }
    g.traverse(o => { if (o.isMesh) o.userData.root = g; });
    return g;
  }

  /* ------------------------------------------------------ Thatha, opposite the board */
  const SKIN = mat(0xc79a6e, .7), WHITE = mat(0xfdfbf3, .9), DARK = mat(0x2a1a10, .6), ASH = mat(0xf4f1e8, .9), RED = mat(0xc0281c, .6);
  const thatha = (() => {
    const g = new T.Group(); g.position.set(0, -1.5, -7.4); g.scale.setScalar(1.3); scene.add(g);
    const add = (geo, m, x, y, z, parent = g) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
    add(new T.BoxGeometry(1.8, 2.1, .95), WHITE, 0, 1.05, 0);
    add(new T.CylinderGeometry(.2, .22, .3, 10), SKIN, 0, 2.2, 0);
    const head = new T.Group(); head.position.set(0, 2.6, 0); g.add(head);
    add(new T.SphereGeometry(.55, 20, 16), SKIN, 0, 0, 0, head);
    const brows = [], arms = [];
    for (const s of [-1, 1]) {
      add(new T.SphereGeometry(.12, 8, 6), SKIN, s * .55, 0, 0, head);
      add(new T.TorusGeometry(.15, .025, 6, 16), DARK, s * .22, .07, .54, head);
      add(new T.SphereGeometry(.045, 8, 6), DARK, s * .22, .07, .53, head);
      brows.push(add(new T.BoxGeometry(.22, .045, .05), ASH, s * .22, .27, .49, head));
    }
    add(new T.BoxGeometry(.1, .025, .025), DARK, 0, .07, .56, head);
    add(new T.SphereGeometry(.09, 8, 6), SKIN, 0, -.06, .55, head);
    add(new T.BoxGeometry(.44, .09, .12), ASH, 0, -.2, .51, head);
    const mouth = add(new T.BoxGeometry(.16, .04, .04), DARK, 0, -.32, .45, head);
    [[.3, .46], [.36, .415], [.42, .36]].forEach(([y, z]) => add(new T.BoxGeometry(.3, .025, .03), ASH, 0, y, z, head).rotation.x = -.3);
    add(new T.SphereGeometry(.035, 8, 6), RED, 0, .2, .52, head);
    for (const s of [-1, 1]) {
      const sh = new T.Group(); sh.position.set(s * 1.05, 1.8, 0); g.add(sh);
      add(new T.CylinderGeometry(.17, .15, 1, 10), WHITE, 0, -.5, 0, sh); add(new T.SphereGeometry(.18, 10, 8), WHITE, 0, 0, 0, sh);
      const el = new T.Group(); el.position.y = -1; sh.add(el);
      add(new T.CylinderGeometry(.14, .12, .9, 10), WHITE, 0, -.45, 0, el); add(new T.SphereGeometry(.15, 10, 8), SKIN, 0, -.98, 0, el);
      arms.push({ sh, el });
    }
    return { g, head, mouth, brows, L: arms[0], R: arms[1] };
  })();
  const REST = { lsx: -.7, lsz: 0, lex: -.7, rsx: -.7, rsz: 0, rex: -.7, hx: 0, hz: 0, lean: 0, brow: 0 };
  const cur = { ...REST };
  const POSES = {
    idle: () => ({}),
    think: () => ({ rsx: -1.2, rex: -2.3, hx: .15, hz: .12, brow: .05 }),
    shake: t => ({ rsx: -1.6, rex: -1, rsz: Math.sin(t * 11) * .35, hx: .1, brow: -.05 }),
    slam: t => t < .35 ? { lsx: -2.4, rsx: -2.4, lex: -.3, rex: -.3, lean: -.1, brow: -.06 } : { lsx: -.5, rsx: -.5, lex: -.3, rex: -.3, lean: .16, brow: -.06 },
    cheer: t => ({ lsx: -2.7 + Math.sin(t * 9) * .15, rsx: -2.7 + Math.sin(t * 9 + 1) * .15, lex: -.3, rex: -.3, lsz: -.3, rsz: .3, hx: -.2, brow: .08 }),
    shrug: () => ({ lsz: -.7, rsz: .7, lsx: -.4, rsx: -.4, lex: -1.6, rex: -1.6, hz: .2, brow: .08 }),
    wave: t => ({ rsx: -1.1, rex: -.5 + Math.sin(t * 9) * .5, hz: -.1 }),
    facepalm: () => ({ rsx: -1.3, rex: -2.5, hx: .35, brow: -.04 }),
    point: () => ({ rsx: -1.5, rex: -.15, hx: .05, brow: -.04 })
  };
  const LINES = {
    start: ['Sit, sit. Let us see what those college books taught you.', 'I taught you the rules, not the secrets. Begin.', 'White to move. Try not to cry before move ten.'],
    think: ['Hmm... hmm...', 'Let me think. Slowly. Like a grandfather.', 'Ah, I see your plan. It is a bad plan.'],
    take: ['Aiyo, your piece has gone on vacation!', 'Thank you for the gift. I will eat it with my evening tea.', 'Eat, eat! Free food today.', 'Did you see that coming? Of course not.'],
    lost: ['Hmph. Beginner\'s luck.', 'That piece was old. Time for retirement anyway.', 'Hm! Who taught you that? Oh. Me.', 'Enjoy it. It will be the last one.'],
    check: ['Check! Run, little king, run!', 'Your king is sweating, no?', 'Check. Breathe, kanna, breathe.'],
    gotCheck: ['Check?! You are cheeky today.', 'Hm. Even a blind squirrel finds a nut.'],
    castle: ['Castling? Hiding the king like a shy bridegroom.', 'King runs home to mummy. Smart, smart.'],
    myCastle: ['See? King in the fortress, tea in my hand.', 'Castling, kanna. Learn, learn.'],
    blunder: ['Aiyo Rama! What was that move?', 'Even my walking stick plays better.', 'Are you sleeping with your eyes open?', 'I will pretend I did not see that. Hahaha, no, I saw it.'],
    great: ['Hm. That one hurt a little.', 'Where did you learn that? Not from me.'],
    hint: ['Hint? Hint?! In my day we had one brain and no hints.', 'Cheating! I am telling your grandmother.'],
    idle: ['Today, please! My tea is getting cold.', 'Are you thinking or sleeping?', 'Move, kanna. The sun is setting.'],
    drawEarly: ['Draw already? We have not even warmed up!', 'Scared, is it? Play, play!'],
    drawNo: ['Draw? Never! I smell victory.', 'No, no. I am winning, why would I stop?', 'Draw? Only if you apologise first.'],
    drawYes: ['Hmm. Fine, fine. A draw. Respect, kanna.', 'Okay, okay, handshake. But next time I win.'],
    drawWait: ['You just asked! Let an old man breathe.'],
    win: ['Checkmate! Go home and read your books.', 'Hahaha! Do not tell your grandmother. Actually, tell her.'],
    lose: ['Hm. Hm! Well played. Do not tell your grandmother.', 'Beginner\'s luck... beginner\'s luck... I want a rematch.'],
    tie: ['A draw. That is how you know a worthy opponent.']
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];

  /* --------------------------------------------------------------- game */
  let G = null, ui = null, talkTimer = 0;
  const $ = id => document.getElementById(id);
  const tv = new T.Vector3();
  function setStatus(t) { $('chessStatus').textContent = t; }
  function gesture(name, dur = 1.4) { if (G) G.gest = { name, t: 0, dur }; }
  function talk(kind, gest, ms = 3400) {
    const text = Array.isArray(kind) ? pick(kind) : (LINES[kind] ? pick(LINES[kind]) : kind), el = $('chessTalk');
    el.textContent = text; el.classList.add('show'); if (gest) gesture(gest, Math.min(ms / 1000, 2.2));
    clearTimeout(talkTimer); talkTimer = setTimeout(() => { el.classList.remove('show'); if (G) G.talkUntil = 0; }, ms);
    if (G) G.talkUntil = performance.now() + ms;
  }
  const talking = () => G && G.talkUntil > performance.now();

  function clearMarks() { while (markers.children.length) markers.remove(markers.children[0]); }
  function mark(r, c, material, ring) {
    const m = new T.Mesh(ring ? new T.RingGeometry(.36, .46, 24) : new T.CircleGeometry(.16, 18), material);
    m.rotation.x = -Math.PI / 2; m.position.set(c - 3.5, .07, r - 3.5); markers.add(m);
  }
  function refreshMarks() {
    clearMarks();
    if (G.hint) { mark(G.hint.from[0], G.hint.from[1], hintMat, true); mark(G.hint.to[0], G.hint.to[1], hintMat, true); }
    if (G.sel) { mark(G.sel[0], G.sel[1], hiMat, true); for (const m of G.selMoves) mark(m.to[0], m.to[1], m.cap || m.castle ? hiMat : dotMat, !!(m.cap || m.castle)); }
  }
  function buildPieces() {
    for (const p of G.meshes.flat()) if (p) scene.remove(p);
    G.meshes = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = G.board[r][c]; if (!p) continue;
      const g = makePiece(p.t, p.c); g.position.copy(sqPos(r, c)); scene.add(g); G.meshes[r][c] = g;
    }
  }
  function startGame() {
    const board = newBoard();
    G = { board, turn: 'w', sel: null, selMoves: [], busy: false, over: false, hint: null, meshes: Array.from({ length: 8 }, () => Array(8).fill(null)), anims: [], resolve: null,
      ply: 0, half: 0, seen: { [posKey(board, 'w')]: 1 }, noDrawUntil: 0, last: null, evPrev: 0, gest: { name: 'point', t: 0, dur: 1.6 }, talkUntil: 0, lastActive: performance.now(), tick: 0 };
    Object.assign(cur, REST); G.evPrev = evaluate(board, 'w');
    buildPieces(); refreshMarks(); setStatus('Your move, you are White (cream).'); talk('start', 'point');
  }
  function select(r, c) { G.sel = [r, c]; G.selMoves = legal(G.board, 'w').filter(m => m.from[0] === r && m.from[1] === c); G.hint = null; refreshMarks(); }
  function clearSel() { G.sel = null; G.selMoves = []; refreshMarks(); }

  function doMove(m, after) {
    G.busy = true; clearSel(); G.hint = null; G.lastActive = performance.now();
    const mover = G.board[m.from[0]][m.from[1]];
    const mesh = G.meshes[m.from[0]][m.from[1]], victim = G.meshes[m.to[0]][m.to[1]];
    const from = mesh.position.clone(), to = sqPos(m.to[0], m.to[1]);
    const rk = m.castle && G.meshes[m.from[0]][m.castle.rf], rkFrom = rk && rk.position.clone(), rkTo = m.castle && sqPos(m.from[0], m.castle.rt);
    G.anims.push({ t: 0, dur: m.castle ? .75 : .5, run(u) {
        mesh.position.lerpVectors(from, to, u); mesh.position.y = .05 + Math.sin(u * Math.PI) * (mover.t === 'N' ? .9 : .35);
        if (rk) { rk.position.lerpVectors(rkFrom, rkTo, u); rk.position.y = .05 + Math.sin(u * Math.PI) * .3; }
        if (victim && u > .8) victim.scale.setScalar(Math.max(.01, 1 - (u - .8) * 5)); },
      done() {
        if (victim) scene.remove(victim);
        G.meshes[m.from[0]][m.from[1]] = null; G.meshes[m.to[0]][m.to[1]] = mesh; mesh.position.copy(to);
        if (rk) { G.meshes[m.from[0]][m.castle.rf] = null; G.meshes[m.from[0]][m.castle.rt] = rk; rk.position.copy(rkTo); }
        G.half = mover.t === 'P' || m.cap ? 0 : G.half + 1; G.ply++;
        G.board = apply(G.board, m);
        if (m.promo) { scene.remove(mesh); const q = makePiece('Q', mover.c); q.position.copy(to); scene.add(q); G.meshes[m.to[0]][m.to[1]] = q; }
        G.turn = opp(G.turn); G.busy = false; G.last = { m, by: mover.c };
        const k = posKey(G.board, G.turn); G.seen[k] = (G.seen[k] || 0) + 1; G.lastActive = performance.now();
        after && after();
      } });
  }
  function endGame(res, msg, line, gest) {
    G.over = true; setStatus(msg); talk(line, gest, 3000); setTimeout(() => G && G.resolve(res), 3200);
  }
  function chatter(chk) {
    const { m, by } = G.last || {}, ev = evaluate(G.board, 'w'), swing = ev - G.evPrev;
    if (by === 'w') {
      if (chk) talk('gotCheck', 'shrug'); else if (m.castle) talk('castle', 'wave');
      else if (m.cap && (VAL[m.cap.t] >= 300 || Math.random() < .4)) talk('lost', 'shrug');
      else if (Math.random() < .2) talk('think', 'think');
    } else if (by === 'b') {
      if (chk) talk('check', 'point');
      else if (swing <= -200) talk('blunder', 'cheer');
      else if (swing >= 200) talk('great', 'facepalm');
      else if (m.castle) talk('myCastle', 'wave');
      else if (m.cap) talk('take', 'slam');
      else if (Math.random() < .18) talk('idle', 'wave');
      G.evPrev = ev;
    }
  }
  function afterMove() {
    const ms = legal(G.board, G.turn), chk = inCheck(G.board, G.turn);
    if (!ms.length) {
      if (chk) return G.turn === 'b' ? endGame('win', 'Checkmate! You beat Thatha!', 'lose', 'facepalm') : endGame('lose', 'Checkmate. Thatha wins this one.', 'win', 'cheer');
      return endGame('draw', 'Stalemate. A draw!', 'tie', 'shrug');
    }
    if (deadDraw(G.board)) return endGame('draw', 'Draw: not enough pieces left to checkmate.', 'tie', 'shrug');
    if (G.seen[posKey(G.board, G.turn)] >= 3) return endGame('draw', 'Draw by threefold repetition.', 'tie', 'shrug');
    if (G.half >= 100) return endGame('draw', 'Draw by the 50-move rule.', 'tie', 'shrug');
    chatter(chk);
    if (G.turn === 'b') {
      setStatus(chk ? 'Check! Thatha is thinking...' : 'Thatha is thinking...');
      setTimeout(() => { if (!G || G.over) return; if (!talking()) gesture('think', 1.2); }, 150);
      setTimeout(() => { if (!G || G.over) return; doMove(gentleMove(G.board, 'b'), afterMove); }, 1100);
    } else setStatus(chk ? 'Check! Protect your king.' : 'Your move.');
  }
  function offerDraw() {
    if (!G || G.over || G.busy || G.turn !== 'w') return;
    G.lastActive = performance.now();
    if (G.ply < G.noDrawUntil) { setStatus('Thatha: "Not again so soon."'); return talk('drawWait', 'shake'); }
    G.noDrawUntil = G.ply + 10;
    if (G.ply < 20) { setStatus('Thatha refuses the draw.'); return talk('drawEarly', 'shake'); }
    if (evaluate(G.board, 'b') < 50) { clearSel(); return endGame('draw', 'Thatha accepts. Draw agreed!', 'drawYes', 'shrug'); }
    setStatus('Thatha refuses the draw.'); talk('drawNo', 'shake');
  }
  function click(r, c) {
    if (!G || G.over || G.busy || G.turn !== 'w') return;
    if (G.sel) { const m = G.selMoves.find(x => x.to[0] === r && x.to[1] === c); if (m) { doMove(m, afterMove); return; } }
    const p = G.board[r][c]; if (p && p.c === 'w') select(r, c); else clearSel();
  }
  const ray = new T.Raycaster(), v2 = new T.Vector2();
  function pointer(x, y, w, h) {
    if (!G) return; v2.set(x / w * 2 - 1, -(y / h) * 2 + 1); ray.setFromCamera(v2, camera);
    const objs = [...sqMeshes.flat(), ...G.meshes.flat().filter(Boolean)];
    const hit = ray.intersectObjects(objs, true)[0]; if (!hit) return;
    let o = hit.object; if (o.userData.sq) return click(...o.userData.sq);
    const root = o.userData.root; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (G.meshes[r][c] === root) return click(r, c);
  }
  function animateThatha(dt) {
    const now = performance.now() / 1000, gs = G.gest;
    gs.t += dt; if (gs.t > gs.dur && gs.name !== 'idle') { gs.name = 'idle'; gs.t = 0; }
    const tgt = { ...REST, ...POSES[gs.name](gs.t) }, k = Math.min(1, dt * 8);
    tgt.lean += Math.sin(now * 1.6) * .012; tgt.hz += Math.sin(now * .9) * .03;
    for (const key in cur) cur[key] += (tgt[key] - cur[key]) * k;
    const { L, R, head, mouth, brows, g } = thatha;
    L.sh.rotation.x = cur.lsx; L.sh.rotation.z = cur.lsz; L.el.rotation.x = cur.lex;
    R.sh.rotation.x = cur.rsx; R.sh.rotation.z = cur.rsz; R.el.rotation.x = cur.rex;
    head.rotation.x = cur.hx; head.rotation.z = cur.hz; g.rotation.x = cur.lean;
    brows.forEach((b, i) => { b.position.y = .27 + cur.brow; b.rotation.z = (i ? -1 : 1) * cur.brow * 3; });
    mouth.scale.y = talking() ? 1 + Math.abs(Math.sin(now * 18)) * 2.5 : 1;
    head.getWorldPosition(tv); tv.y += .9; tv.project(camera);
    const w = innerWidth, h = innerHeight, el = $('chessTalk'), narrow = w < 700;
    const x = (tv.x * .5 + .5) * w + (narrow ? 0 : 210), y = (-tv.y * .5 + .5) * h + (narrow ? 70 : -20);
    el.style.left = Math.max(130, Math.min(w - 130, x)) + 'px'; el.style.top = Math.max(8, y) + 'px';
  }
  function update(dt) {
    if (!G) return;
    for (let i = G.anims.length - 1; i >= 0; i--) { const a = G.anims[i]; a.t += dt; const u = Math.min(1, a.t / a.dur); a.run(u * u * (3 - 2 * u)); if (u >= 1) { G.anims.splice(i, 1); a.done(); } }
    markers.children.forEach((m, i) => { m.position.y = .07 + Math.sin(performance.now() / 250 + i) * .01; });
    if (!G) return;
    animateThatha(dt);
    if (!G.over && !G.busy && G.turn === 'w' && !talking() && performance.now() - G.lastActive > 14000) { G.lastActive = performance.now(); talk('idle', 'wave'); }
  }
  function resize(w, h) { camera.aspect = w / h; camera.fov = w / h < 1 ? 62 : 44; camera.updateProjectionMatrix(); }

  function play() {
    return new Promise(resolve => {
      ui = $('chessUI'); ui.hidden = false; startGame();
      G.resolve = res => { clearTimeout(talkTimer); $('chessTalk').classList.remove('show'); ui.hidden = true; G = null; resolve(res); };
      $('chessHint').onclick = () => { if (G.over || G.busy || G.turn !== 'w') return; const m = bestMove(G.board, 'w'); if (m) { G.hint = m; G.lastActive = performance.now(); clearSel(); refreshMarks(); setStatus('Orange squares are the hint.'); talk('hint', 'shake'); } };
      $('chessDraw').onclick = offerDraw;
      $('chessSkip').onclick = () => { if (!G || G.over) return; G.over = true; G.resolve('skip'); };
    });
  }
  window.ChessGame = { scene, camera, play, update, pointer, resize, _engine: { posKey, deadDraw, newBoard, legal, inCheck, apply, gentleMove, bestMove, evaluate } };
})();
