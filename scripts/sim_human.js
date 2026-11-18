// 確認用: 人に近い押し方（反応の遅れ・押す長さのばらつき・見える範囲だけで判断）で何度も走らせ、
// 落ちた／置いていかれた場所と、その何秒前から「どう押しても助からなかったか」を調べる。scripts/sim_human.py から読みこむ。
(function () {
  const DT = 1 / 120;
  let lastKind = '';
  window.die = (kind) => { lastKind = kind; G.state = kind === 'goal' ? 'goal' : 'dead'; };
  window.paxStation = null;
  const snap = () => structuredClone(G);
  const load = (g) => { G = structuredClone(g); pressed = false; };
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  // 助かる押し方があるか（sim_deadspots と同じ総当たり。2.6 秒＋降りきるまで）
  const WAITS = []; for (let t = 0; t <= 1.6 + 1e-9; t += 0.08) WAITS.push(+t.toFixed(2));
  const STRATS = [{ none: true }];
  for (const t0 of WAITS) for (const h of [0.06, 0.35]) {
    STRATS.push({ t0, h });
    for (const d of [0.2, 0.35, 0.5, 0.7, 0.9, 1.2]) for (const h2 of [0.06, 0.35]) if (d > h + 0.05) STRATS.push({ t0, h, d, h2 });
  }
  const pressAt = (s, t) => !s.none && ((t >= s.t0 && t < s.t0 + s.h) || (s.d !== undefined && t >= s.t0 + s.d && t < s.t0 + s.d + s.h2));
  function survives(root) { // 生き残れる押し方の数
    let n = 0;
    for (const s of STRATS) {
      load(root); G.parts = []; let t = 0, ok = true;
      const bid0 = G.bid;
      while (t < 14) {
        const want = (t < 2.6 && pressAt(s, t)) || G.wall;
        if (want && !pressed) { pressed = true; G.buffer = P.BUFFER; } else if (!want && pressed) release();
        step(DT); t += DT;
        if (G.state === 'goal') break;
        if (G.state !== 'play') { ok = false; break; }
        if (t > 2.6 && G.onGround && !G.skip && !pressed && G.bid !== bid0) break;
      }
      if (ok) n++;
    }
    return n;
  }

  // 人に近い押し方
  function makePolicy() {
    const react = 0.18 + rnd() * 0.17;          // 反応の遅れ 0.18〜0.35 秒
    const look = 30 + rnd() * 20;               // 先読みできる距離（窓・ドアの窓に見える範囲）
    const careful = rnd();                      // 空中ジャンプをどれだけ使うか
    let queue = [], holdUntil = -1, t = 0, lastPress = -9;
    return function (dt) {
      t += dt;
      const x = G.S + G.off, v = Math.max(1, G.speed);
      let want = false, hold = 0.12 + rnd() * 0.25;
      if (!G.skip) {
        // 屋根のはしが反応の距離のうちに来る／高い屋根・壁が近い
        if (G.onGround) {
          for (let d = 0.5; d < Math.min(look, v * (react + 0.15)); d += 0.5) if (roofUnder(x + d) < roofUnder(x) - 0.5) { want = true; break; }
          for (let d = 0.5; d < Math.min(look, Math.max(4, v * 0.35)); d += 0.5) if (roofUnder(x + d) > G.y + 0.7) { want = true; hold = 0.35; break; }
        } else if (G.vy < -2 && G.jumps > 0 && rnd() < 0.02 + careful * 0.06) {
          const fut = x + v * 0.35;
          if (roofUnder(fut) < G.y - 2 && !springAt(fut)) { want = true; hold = 0.2 + rnd() * 0.15; }
        }
        if (G.wall) { want = true; hold = 0.4; }
      }
      if (want && t - lastPress > 0.25) { queue.push({ at: t + react, hold }); lastPress = t; }
      while (queue.length && queue[0].at <= t) { holdUntil = t + queue.shift().hold; if (!pressed) { pressed = true; G.buffer = P.BUFFER; } }
      const keep = t < holdUntil || (G.wall && pressed);
      if (!keep && pressed) release();
    };
  }

  window.HSIM = {
    run(from, s0, maxT) {
      seed = s0; newGame(from || 0); G.state = 'play'; pressed = false;
      const pol = makePolicy(), deaths = [], ring = [];
      let t = 0, last = 0;
      while (t < (maxT || 900)) {
        if (t - last >= 0.25) { ring.push({ t, g: snap() }); if (ring.length > 16) ring.shift(); last = t; }
        pol(DT); step(DT); t += DT;
        if (G.state === 'goal') break;
        if (G.state === 'dead') {
          const x = G.S + G.off, d = { x: Math.round(x), S: Math.round(G.S), kind: lastKind, t: +t.toFixed(1), pace: +G.pace.toFixed(2), where: whereNow() };
          // 何秒前から助からなかったか（0.5・1・2・3 秒前の状態で総当たり）
          d.doom = {}; const atDeath = snap();
          for (const back of [0.5, 1, 2, 3]) {
            const r = [...ring].reverse().find((q) => q.t <= t - back);
            if (r) { const n = survives(r.g); d.doom[back] = n; }
          }
          deaths.push(d); load(atDeath); pressed = false;
          // 上から降ろして続ける（god と同じ）
          G.state = 'play'; G.off = 0; G.y = roofUnder(G.S) + 8; G.vy = 0; G.glide = true; pressed = false; ring.length = 0;
        }
      }
      const out = { deaths, end: Math.round(G.S), t: Math.round(t) };
      G = snap(); G.state = 'title';
      return out;
    },
  };
})();
