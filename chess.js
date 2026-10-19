/* Chess for Gully Days: small rules engine + gentle AI + 3D board (Three.js).
   Rules: all piece moves, check/checkmate/stalemate, pawn double-step, auto-queen promotion.
   Not included: castling, en passant, repetition draws. */
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
    nb[m.to[0]][m.to[1]] = m.promo ? { t: 'Q', c: p.c } : p; nb[m.from[0]][m.from[1]] = null; return nb;
  }
  const legal = (b, color) => pseudo(b, color).filter(m => !inCheck(apply(b, m), color));
  function evaluate(b, color) {
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c]; if (!p) continue;
      let v = VAL[p.t];
      const cen = 3.5 - Math.hypot(r - 3.5, c - 3.5) * .5;
      if (p.t === 'N' || p.t === 'B') v += cen * 8; else if (p.t === 'P') v += cen * 3 + (p.c === 'w' ? 6 - r : r - 1) * 5; else if (p.t === 'Q') v += cen * 2;
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
  const bestMove = (b, color) => { const sc = scored(b, color); return sc.length ? sc[0].m : null; };

  /* ------------------------------------------------------------ 3D view */
  const scene = new T.Scene(); scene.background = new T.Color(0x9fc9a4); scene.fog = new T.Fog(0xb9d6b0, 24, 60);
  const camera = new T.PerspectiveCamera(38, 1, .1, 100); camera.position.set(0, 10.4, 8.8); camera.lookAt(0, 0, .5);
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

  /* --------------------------------------------------------------- game */
  let G = null, ui = null;
  const $ = id => document.getElementById(id);
  function setStatus(t) { $('chessStatus').textContent = t; }

  function clearMarks() { while (markers.children.length) markers.remove(markers.children[0]); }
  function mark(r, c, material, ring) {
    const m = new T.Mesh(ring ? new T.RingGeometry(.36, .46, 24) : new T.CircleGeometry(.16, 18), material);
    m.rotation.x = -Math.PI / 2; m.position.set(c - 3.5, .07, r - 3.5); markers.add(m);
  }
  function refreshMarks() {
    clearMarks();
    if (G.hint) { mark(G.hint.from[0], G.hint.from[1], hintMat, true); mark(G.hint.to[0], G.hint.to[1], hintMat, true); }
    if (G.sel) { mark(G.sel[0], G.sel[1], hiMat, true); for (const m of G.selMoves) mark(m.to[0], m.to[1], m.cap ? hiMat : dotMat, !!m.cap); }
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
    G = { board: newBoard(), turn: 'w', sel: null, selMoves: [], busy: false, over: false, hint: null, meshes: Array.from({ length: 8 }, () => Array(8).fill(null)), anims: [], resolve: null };
    buildPieces(); refreshMarks(); setStatus('Your move, you are White (cream).');
  }
  function select(r, c) { G.sel = [r, c]; G.selMoves = legal(G.board, 'w').filter(m => m.from[0] === r && m.from[1] === c); G.hint = null; refreshMarks(); }
  function clearSel() { G.sel = null; G.selMoves = []; refreshMarks(); }

  function doMove(m, after) {
    G.busy = true; clearSel(); G.hint = null;
    const mesh = G.meshes[m.from[0]][m.from[1]], victim = G.meshes[m.to[0]][m.to[1]];
    const from = mesh.position.clone(), to = sqPos(m.to[0], m.to[1]);
    const knight = G.board[m.from[0]][m.from[1]].t === 'N';
    G.anims.push({ t: 0, dur: .5, run(u) { mesh.position.lerpVectors(from, to, u); mesh.position.y = .05 + Math.sin(u * Math.PI) * (knight ? .9 : .35); if (victim && u > .8) victim.scale.setScalar(Math.max(.01, 1 - (u - .8) * 5)); },
      done() {
        if (victim) scene.remove(victim);
        G.meshes[m.from[0]][m.from[1]] = null; G.meshes[m.to[0]][m.to[1]] = mesh; mesh.position.copy(to);
        G.board = apply(G.board, m);
        if (m.promo) { scene.remove(mesh); const q = makePiece('Q', G.turn); q.position.copy(to); scene.add(q); G.meshes[m.to[0]][m.to[1]] = q; }
        G.turn = opp(G.turn); G.busy = false; after && after();
      } });
  }
  function afterMove() {
    const ms = legal(G.board, G.turn), chk = inCheck(G.board, G.turn);
    if (!ms.length) { G.over = true; const res = chk ? (G.turn === 'b' ? 'win' : 'lose') : 'draw'; setStatus(res === 'win' ? 'Checkmate! You beat Thatha!' : res === 'lose' ? 'Checkmate. Thatha wins this one.' : 'Stalemate. A draw!'); setTimeout(() => G.resolve(res), 2200); return; }
    if (G.turn === 'b') { setStatus(chk ? 'Check! Thatha is thinking...' : 'Thatha is thinking...'); setTimeout(() => { if (G.over) return; const m = gentleMove(G.board, 'b'); doMove(m, afterMove); }, 650); }
    else setStatus(chk ? 'Check! Protect your king.' : 'Your move.');
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
  function update(dt) {
    if (!G) return;
    for (let i = G.anims.length - 1; i >= 0; i--) { const a = G.anims[i]; a.t += dt; const u = Math.min(1, a.t / a.dur); a.run(u * u * (3 - 2 * u)); if (u >= 1) { G.anims.splice(i, 1); a.done(); } }
    markers.children.forEach((m, i) => { m.position.y = .07 + Math.sin(performance.now() / 250 + i) * .01; });
  }
  function resize(w, h) { camera.aspect = w / h; camera.fov = w / h < 1 ? 55 : 38; camera.updateProjectionMatrix(); }

  function play() {
    return new Promise(resolve => {
      ui = $('chessUI'); ui.hidden = false; startGame(); G.resolve = res => { ui.hidden = true; G = null; resolve(res); };
      $('chessHint').onclick = () => { if (G.over || G.busy || G.turn !== 'w') return; const m = bestMove(G.board, 'w'); if (m) { G.hint = m; clearSel(); refreshMarks(); setStatus('Thatha whispers: "Try the orange squares..."'); } };
      $('chessSkip').onclick = () => { if (!G || G.over) return; G.over = true; G.resolve('skip'); };
      afterMoveStartCheck();
    });
  }
  function afterMoveStartCheck() { /* white starts */ }
  window.ChessGame = { scene, camera, play, update, pointer, resize, _engine: { newBoard, legal, inCheck, apply, gentleMove, bestMove, evaluate } };
})();
