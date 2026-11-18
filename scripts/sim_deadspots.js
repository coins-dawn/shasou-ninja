// 確認用: 「どう押しても落ちる・置いていかれる」場所を探す（ブラウザの中で、ゲームの step() をそのまま使う）
// 屋根の上の状態から、押す時刻・長押し・空中ジャンプの組み合わせを総当たりし、生き残れる続きを深さ優先でたどる。
// どの続きもだめなら少し戻ってやり直し、それでもだめなら「詰む場所」として記録し、上から降ろして先へ進む。
// scripts/sim_deadspots.py から読みこむ。
(function () {
  const DT = 1 / 120, TMAX = 2.6;
  const WAITS = []; for (let t = 0; t <= 1.6 + 1e-9; t += 0.08) WAITS.push(+t.toFixed(2));
  const HOLDS = [0.06, 0.35], DOUBLES = [0.2, 0.35, 0.5, 0.7, 0.9, 1.2];
  const STRATS = [{ none: true }];
  for (const t0 of WAITS) for (const h of HOLDS) {
    STRATS.push({ t0, h });
    for (const d of DOUBLES) for (const h2 of HOLDS) if (d > h + 0.05) STRATS.push({ t0, h, d, h2 });
  }
  const pressAt = (s, t) => !s.none && ((t >= s.t0 && t < s.t0 + s.h) || (s.d !== undefined && t >= s.t0 + s.d && t < s.t0 + s.d + s.h2));

  const snap = () => structuredClone(G);
  const load = (g) => { G = structuredClone(g); pressed = false; };
  let lastKind = '';
  window.die = (kind) => { lastKind = kind; G.state = kind === 'goal' ? 'goal' : 'dead'; };
  window.paxStation = null;

  function run(root, s) {
    load(root); G.parts = [];
    const bid0 = G.bid; let t = 0;
    while (t < TMAX) {
      const want = pressAt(s, t) || G.wall; // 壁では押しっぱなし（人もそうする）
      if (want && !pressed) { pressed = true; G.buffer = P.BUFFER; } else if (!want && pressed) release();
      step(DT); t += DT;
      if (G.state === 'goal') return { goal: true };
      if (G.state !== 'play') return { dead: lastKind };
      if (!G.skip && G.onGround && t > 0.1 && G.bid !== bid0 && !pressed) return { g: snap(), t };
    }
    // まだ空中: 押さずに（壁では押して）降りきるまで見る（高い屋根からの風呂敷はゆっくり）
    while (t < TMAX + 10) {
      const want = G.wall;
      if (want && !pressed) { pressed = true; G.buffer = P.BUFFER; } else if (!want && pressed) release();
      step(DT); t += DT;
      if (G.state === 'goal') return { goal: true };
      if (G.state !== 'play') return { dead: lastKind };
      if (!G.skip && G.onGround && !pressed) return { g: snap(), t };
    }
    return { dead: 'air' };
  }
  // ある状態から: 全部の押し方を試し、生き残れた続き（ちがう屋根ごとに 1 つ、前のほう・置いていかれていないほうを優先）
  function expand(root) {
    const outs = new Map(); let alive = 0; const why = {}; const okT = new Set(); let noneOk = false;
    for (const s of STRATS) {
      const r = run(root, s);
      if (r.goal) return { goal: true, alive: 1, n: STRATS.length };
      if (r.dead) { why[r.dead] = (why[r.dead] || 0) + 1; continue; }
      alive++; if (s.none) noneOk = true; else okT.add(s.t0);
      const g = r.g, key = `${g.bid}:${g.layer}`;
      const sc = g.S + g.off + g.off * 0.5; // 前へ・遅れが少ないほど良い
      const o = outs.get(key);
      if (!o || sc > o.sc) outs.set(key, { g, sc });
    }
    const list = [...outs.values()].sort((a, b) => b.sc - a.sc).slice(0, 4).map((o) => o.g);
    return { list, alive, n: STRATS.length, why, win: noneOk ? 9 : +(okT.size * 0.08).toFixed(2) }; // win: 助かる押す時刻の幅 [秒]（押さなくてよければ 9）
  }
  function rescue(g) { // 確認用の「上から降ろす」（god と同じ）。押さずに降りて屋根に着くまで
    load(g); G.off = 0; G.y = roofUnder(G.S) + 8; G.vy = 0; G.glide = true;
    for (let t = 0; t < 30; t += DT) {
      if (pressed) release();
      step(DT);
      if (G.state !== 'play') { if (G.state === 'goal') return null; G.state = 'play'; G.y = roofUnder(G.S) + 8; G.glide = true; }
      if (G.onGround && !G.skip && !G.glide) return snap();
    }
    return snap();
  }
  const where = (g) => { const G0 = G; G = g; const w = whereNow(); G = G0; return w; };

  window.SIM = {
    init(from) {
      newGame(from || 0); G.state = 'play';
      this.stack = [{ g: snap(), kids: null, i: 0 }];
      this.best = -Infinity; this.bestNode = null; this.dead = []; this.path = []; this.nodes = 0; this.done = false; this.backs = 0; this.log = []; this.sent = 0;
      this.idle = snap(); this.idle.state = 'title';
    },
    chunk(ms) {
      const t0 = performance.now();
      while (!this.done && performance.now() - t0 < ms) {
        const top = this.stack[this.stack.length - 1];
        if (!top) { this.done = true; break; }
        if (!top.kids) {
          const e = expand(top.g); this.nodes++;
          top.alive = e.alive; top.n = e.n; top.why = e.why; top.win = e.win;
          this.log.push({ S: Math.round(top.g.S), x: Math.round(top.g.S + top.g.off), ok: +(e.alive / e.n).toFixed(3), win: e.win, v: +(trainSpeed(top.g.S).v * top.g.pace).toFixed(1), why: e.why, where: where(top.g), y: +top.g.y.toFixed(1) });
          if (e.goal) { this.done = true; this.goal = true; break; }
          top.kids = e.list; top.i = 0;
          const x = top.g.S + top.g.off;
          if (x >= this.best) { this.best = x; this.bestNode = top; this.backs = 0; }
        }
        if (top.i < top.kids.length) { this.stack.push({ g: top.kids[top.i++], kids: null, i: 0 }); continue; }
        // 行き止まり: 戻る。最前から 8 段以上戻ったら「詰む場所」
        this.stack.pop(); this.backs++;
        if (this.backs > 8 || !this.stack.length) {
          const b = this.bestNode.g;
          this.dead.push({ S: Math.round(b.S), x: Math.round(b.S + b.off), where: where(b), pace: +b.pace.toFixed(2), why: this.bestNode.why,
            roof: +roofUnder(b.S + b.off).toFixed(1) });
          const r = rescue(b);
          if (!r) { this.done = true; this.goal = true; break; }
          this.stack = [{ g: r, kids: null, i: 0 }]; this.best = -Infinity; this.bestNode = null; this.backs = 0;
        }
      }
      // 試した状態ごとの余裕（押し方のうち、生き残れた割合）は log に。前回から増えた分だけ返す
      const out = { done: this.done, goal: !!this.goal, nodes: this.nodes, best: Math.round(this.best), dead: this.dead, depth: this.stack.length,
        log: this.log.slice(this.sent) };
      this.sent = this.log.length;
      G = structuredClone(this.idle); // 画面の更新で進まないように
      return out;
    },
  };
})();
