// 車窓ニンジャ — 動きの計算（画面にもサーバーにも依存しない部分）
// ブラウザでは game.js より先に読みこむ。ランキングのサーバーも同じこのファイルで、押した記録から点数を計算しなおす。
'use strict';
const CORE_VER = '20261120a'; // 動きが変わったら上げる（サーバーはこの版のファイルを取りに来て、くらべる）
const DT = 1 / 240;          // 1 回の計算で進める時間（いつも同じ刻み。押した時刻は刻みの番号で記録する）

// ---- 調整用の値（単位は m と 秒） ----
const P = {
  G: 46,            // 重力
  HOLD_G: 0.4,      // 長押しの間の重力の倍率
  HOLD_T: 0.3,
  JUMP_V: 17.5,
  DOUBLE_V: 15.5,   // 空中ジャンプ
  CUT: 0.35,        // 短く押して離したら、上昇をここまで弱める（短押しと長押しの差）
  WALL_SLIDE: -5,   // 壁にはりついたときの落ちる速さ
  WALL_RUN: 30,     // 押しっぱなしで壁を駆け上がる速さ
  HOOK_T: 0.2,      // 高い壁は鉤縄でたぐり上がる: 残りの高さを この秒数で詰める速さ（上に近づくと WALL_RUN に戻る）
  HOOK_VMAX: 120,   // そのときの速さの上限
  SPRING_VMAX: 80,  // しなり竹ではね上げる速さの上限（58m の屋根まで届く）
  STEP: 0.8,        // これ以下の段差は走って上がれる
  FOOT: 0.5,        // 足の幅（半分）
  CATCHUP: 7,       // 置いていかれたとき、追いつく速さ
  CATCHUP_AIR: 4,
  BIG_GAP: 42,      // これより広い隙間は「ひとっとび」
  DOOR_W: 36,       // ドアの窓から見える幅 [m]（高さは窓の形で決まる。上下には動かさない）
  NINJA_AT: 0.3,    // 窓の左から何割の位置に忍者がいるか
  PACE0: 0.95,      // 実際の電車に対する速さの倍率（はじめ）
  PACE_UP: 0.05,
  PACE_MAX: 2.0,
  ACC: 1.0,         // 電車の加速・減速 [m/s^2]
  VMAX: 16.7,       // 最高 60km/h
  DWELL: 1.1,       // 停車（ゲーム内の秒）
  COYOTE: 0.08,
  MOMO_G: 0.45,     // 風呂敷を広げて落ちるときの重力の倍率
  MOMO_VMAX: -11,   // そのときの落ちる速さの上限
  BUFFER: 0.12,
};

const CROWD_MULT = { low: 1, grow: 1.5, high: 2 };
const optMult = (o) => (o.diff === 'hard' ? 2 : 1) * (CROWD_MULT[o.crowd] || 1); // ポイントの倍率

let SC = null;
// ---- 走る面（乗れる屋根の高さ）と、駅・速さ ----
function preparePhys(sc, places) {
  sc.prof = Float32Array.from(sc.prof, (v) => v / 10);
  sc.prof2 = Float32Array.from(sc.prof2, (v) => v / 10);
  sectionProfiles(sc);
  // 終点の手前（最後の屋根から終点まで）は、最後の屋根の高さのまま走れるようにする（駅のホームの屋根）
  let last = sc.prof.length - 1;
  while (last > 0 && sc.prof[last] === 0) last--;
  for (let k = last + 1; k < sc.prof.length; k++) { sc.prof[k] = sc.prof[last]; sc.pb[k] = sc.pb[last]; }
  // 駅間の巡航速度：GTFS の所要時間から台形の速度曲線を逆算
  const sts = sc.stations.map((s) => ({ name: s.name, s: s.s, run: s.run, dwell: s.dwell || 0, code: s.code || '', en: s.en || '', xfer: s.xfer || [] }));
  for (let i = 0; i < sts.length - 1; i++) {
    const D = sts[i + 1].s - sts[i].s, T = sts[i].run || 60, a = P.ACC;
    const disc = a * a * T * T - 4 * a * D;
    const v = disc > 0 ? (a * T - Math.sqrt(disc)) / 2 : a * T / 2;
    sts[i].vmax = Math.min(P.VMAX, Math.max(6, v));
  }
  sc.sts = sts;
  sc.dest = sts[sts.length - 1].name;
  sc.places = places.map((p) => ({ s0: p[0], s1: p[1], name: p[2], kind: p[3] }));
  buildSprings(sc);
}

function sectionProfiles(sc) {
  const n = sc.prof.length, st = sc.step;
  const p1 = new Float32Array(n), p2 = new Float32Array(n);
  const b1 = new Int32Array(n).fill(-1), b2 = new Int32Array(n).fill(-1);
  const solid = new Set(sc.solid);
  const topAt = (b, s) => {
    if (!b.faces) return b.h;
    let t = 0;
    for (const [k, q] of b.faces) for (let i = 0; i < q.length; i++) {
      const a = q[i], c = q[(i + 1) % q.length];
      if ((a[0] - s) * (c[0] - s) > 0 || a[0] === c[0]) continue;
      t = Math.max(t, a[2] + (c[2] - a[2]) * (s - a[0]) / (c[0] - a[0]));
    }
    return t;
  };
  for (const b of sc.near) {
    const ss = b.fp.map((p) => p[0]);
    const s0 = Math.min(...ss), s1 = Math.max(...ss);
    const isSolid = solid.has(b.i);
    if (!isSolid && b.d > 45) continue;
    for (let k = Math.ceil(s0 / st); k <= Math.floor(s1 / st) && k < n; k++) {
      if (k < 0) continue;
      const t = topAt(b, k * st);
      if (isSolid) { if (t > p1[k]) { p1[k] = t; b1[k] = b.i; } }
      else if (t > p2[k]) { p2[k] = t; b2[k] = b.i; }
    }
  }
  sc.prof = p1; sc.pb = Array.from(b1); sc.prof2 = p2; sc.pb2 = Array.from(b2);
}

function profAt(x) {
  const k = Math.round(x / SC.step);
  return k >= 0 && k < SC.prof.length ? SC.prof[k] : 0;
}
function roofUnder(x) {
  let h = 0;
  for (let dx = -P.FOOT; dx <= P.FOOT + 1e-6; dx += SC.step) h = Math.max(h, profAt(x + dx));
  return h;
}
// 2 層目（後ろの建物の屋根。上から着地だけできる）
function roof2Under(x) {
  let h = 0;
  for (let dx = -P.FOOT; dx <= P.FOOT + 1e-6; dx += SC.step) {
    const k = Math.round((x + dx) / SC.step);
    if (k >= 0 && k < SC.prof2.length) h = Math.max(h, SC.prof2[k]);
  }
  return h;
}
function bldgAt(x) {
  const k = Math.round(x / SC.step);
  return k >= 0 && k < SC.pb.length ? SC.pb[k] : -1;
}
function gapAround(x) {
  if (profAt(x) > 0) return null;
  let a = Math.round(x / SC.step), b = a;
  while (a > 0 && SC.prof[a - 1] === 0) a--;
  while (b < SC.prof.length - 1 && SC.prof[b + 1] === 0) b++;
  return { s0: a * SC.step, s1: (b + 1) * SC.step, w: (b - a + 1) * SC.step, nextTop: profAt((b + 1) * SC.step + 1.5) };
}
function placeIn(s0, s1) {
  let best = null, ov = 0;
  for (const p of SC.places) {
    const o = Math.min(s1, p.s1) - Math.max(s0, p.s0);
    if (o > ov) { ov = o; best = p; }
  }
  return best;
}

// ---- 届かない隙間に「しなり竹」 ----
// 長押し＋空中ジャンプをいちばんよい間合いで使ったときの、高さ y0 から地面までの滞空時間 [s]
function maxAirTime(y0) { // 高さ y0 から跳んで（空中ジャンプも最適に使って）、高さ 0 まで下りてくるまでの秒数。y0 は負でもよい（上の屋根へ）
  const dt = 1 / 120;
  const sim = (td) => {
    let y = y0, vy = P.JUMP_V, hold = 0, t = 0, used = false, above = y0 > 0;
    for (let i = 0; i < 2000; i++) {
      if (!used && t >= td) { vy = P.DOUBLE_V; hold = 0; used = true; }
      let g = P.G;
      if (vy > 0 && hold < P.HOLD_T) { g *= P.HOLD_G; hold += dt; }
      vy = Math.max(-30, vy - g * dt); y += vy * dt; t += dt;
      if (y > 0) above = true;
      if (y <= 0 && vy < 0) return above ? t : 0; // 一度も高さ 0 の上に出られなければ届かない
    }
    return t;
  };
  let best = 0;
  for (let td = 0; td < 3; td += 0.02) best = Math.max(best, sim(td));
  return best;
}
// 隙間ごとに、日暮里から乗ったときの速さ（いちばん遅い）で渡れるかを調べ、渡れないところの地面に竹を置く
// 竹は [a, b] の範囲（m）、高さ SPRING_H。上から落ちてきたら、向こうの屋根まで届く勢いではね上げる
const SPRING_H = 2.5;
function buildSprings(sc) {
  const st = sc.step, n = sc.prof.length;
  const top = (k) => Math.max(sc.prof[k] || 0, (sc.prof2 && sc.prof2[k]) || 0);
  const memo = new Map();
  const air = (y0) => { const key = Math.round(y0 * 2) / 2; if (!memo.has(key)) memo.set(key, maxAirTime(key)); return memo.get(key); };
  // 向こうが 2 列目（奥）の建物だけのところは、その前の地面も隙間（壁にならない）。竹はそこまで続ける
  const front2 = (j) => { let q = j; while (q < n && !((sc.prof[q] || 0) > 0) && top(q) > 0) q++; return q; };
  sc.springs = [];
  for (let k = 1; k < n;) {
    if (top(k) > 0) { k++; continue; }
    let j = k; while (j < n && top(j) <= 0) j++;
    const s0 = k * st, s1 = j * st, w = s1 - s0;
    const afterSt = sc.sts.some((st) => s0 >= st.s - 3 && s0 <= st.s + 40);
    if (afterSt) { k = j; continue; } // 駅を出てすぐは下でまとめて
    if (j < n && w >= 6 && w <= P.BIG_GAP) {
      const ts = trainSpeed(s0 + w / 2), i = sc.sts.indexOf(ts.prev);
      const v = ts.v * Math.min(P.PACE_MAX, P.PACE0 + P.PACE_UP * Math.max(0, i));
      // 向こうの屋根に乗る（高い屋根は壁の下のほう 2.5m までに取りつけば、鉤縄で登れる）まで空中にいられる時間で、届く距離を見る
      // 向こうが 1 列目の建物なら壁に取りついて登れる。2 列目（奥）だけなら壁にならないので、屋根の高さまで跳べないと乗れない
      const y0 = top(k - 1), y1 = top(j), y1L = sc.prof[j] || 0;
      const ht = y1L > 0 ? Math.min(y1L, 2.5) : y1, reach = v * air(y0 - ht);
      // 踏み切る屋根の長さ（同じくらいの高さが続くところ）。短い屋根は、降りたとたんに跳ぶことになり間合いが取れない
      let i0 = k - 1; while (i0 > 0 && top(i0 - 1) > 0 && Math.abs(top(i0 - 1) - y0) < 1.5) i0--;
      const L0 = (k - i0) * st;
      // 最適な間合いの 55%（踏み切りが短い屋根なら 50%）を超える隙間は、人の操作ではまず渡れない
      // （人に近い押し方のシミュレーション scripts/sim_human で落ちたのは、低い屋根から 55% を超える隙間。もとの 7 割では竹がなかった）
      if (w > reach * (L0 < v * 0.6 ? 0.5 : 0.55)) {
        const drop = v * Math.sqrt((2 * y0) / P.G); // 何もせず屋根のはしから落ちたときに地面に着くところ
        const a = Math.min(s1 - 4, s0 + Math.max(2, drop * 0.7)), b = Math.max(s1 - 1.5, front2(j) * st - 1.5);
        if (b - a >= 2) sc.springs.push({ a, b, s0, s1, w: Math.round(w), y1: top(j), reach: Math.round(reach), t: 0 });
      }
    }
    k = j;
  }
  // 駅を出てすぐ（40m 以内）の隙間: 電車がまだ遅く、停まったところが屋根のはしだと、出発したとたんに落ちてしまう（谷在家・江北など）。
  // 1 列目の屋根だけで見る（奥の建物の前も、立っていれば落ちる）
  for (const sta of sc.sts) {
    const k0 = Math.max(1, Math.ceil((sta.s - 3) / st)), k1 = Math.min(n - 1, Math.floor((sta.s + 40) / st));
    for (let k = k0; k <= k1;) {
      if ((sc.prof[k] || 0) > 0 || !((sc.prof[k - 1] || 0) > 0 || k === k0)) { k++; continue; }
      let j = k; while (j < n && !((sc.prof[j] || 0) > 0)) j++;
      const s0 = k * st, s1 = j * st, w = s1 - s0;
      if (j < n && w >= 3 && w <= P.BIG_GAP && !sc.springs.some((q) => q.s1 > s0 && q.s0 < s1))
        sc.springs.push({ a: s0 + 0.5, b: s1 - 0.5, s0, s1, w: Math.round(w), y1: top(j), reach: 0, t: 0, station: true });
      k = j;
    }
  }
  sc.springs.sort((p, q) => p.s0 - q.s0);
}
function springAt(x) {
  for (const sp of SC.springs) if (x >= sp.a && x <= sp.b) return sp;
  return null;
}

// ---- 電車の速さ ----
function trainSpeed(s) {
  const st = SC.sts;
  let i = 0;
  while (i < st.length - 2 && st[i + 1].s <= s) i++;
  const a = st[i], b = st[i + 1];
  const v = Math.min(a.vmax, Math.sqrt(2 * P.ACC * Math.max(0, s - a.s)) + 1.2,
    Math.sqrt(2 * P.ACC * Math.max(0, b.s - s)) + 0.6);
  return { v: Math.max(0.6, v), next: b, prev: a };
}

function wardOf(addr) { const m = (addr || '').match(/^(.+?[区市町村])/); return m ? m[1] : ''; }

let G = null;
// from: 乗る駅の番号、opts: { diff, crowd }（大きさ・カメラは見た目だけなので、ここには入れなくてよい）
function startGame(from, opts) {
  const st = SC.sts[from];
  G = {
    state: 'play', t: 0, S: st.s + 5, off: 0, pace: Math.min(P.PACE_MAX, P.PACE0 + P.PACE_UP * from), from,
    y: 30, vy: 0, onGround: false, jumps: 1, wall: false, holdT: 0, coyote: 0, buffer: 0,
    glide: true, dwell: 0, stopAt: -1, stationsPassed: 0, dist: 0, msg: null, msgT: 0,
    skip: null, runPhase: 0, speed: 0, dead: null, landT: 0, flip: 0,
    bid: -1, wallBid: -1, ward: '', banner: null, parts: [], dustT: 0, camUp: 0, layer: 1,
    tick: 0, winL: 30, leftDie: 31, // 計算した回数 / 窓の左はしまでの距離・置いていかれる距離 [m]（画面の割り付けで決まる）
  };
  G.stopAt = st.s; // 乗った駅にはもう止まらない
  G.opts = Object.assign({}, opts);
  // 最初からビルの屋根の上に立たせる: 忍者の位置（少し後ろまで）に屋根があればそこへ、なければ前で最初の屋根まで電車を進めておく
  // 高い屋根でもよい（窓の上に出るときはカメラを上げる）。忍者の横の位置はつり革の輪の間なので、輪とは重ならない
  const ok = (x) => roofUnder(x) > 0;
  let at = null;
  for (let x = G.S; x >= G.S - 10; x -= SC.step) if (ok(x)) { at = x; break; }
  if (at === null) for (let x = G.S; x <= G.S + 300; x += SC.step) if (ok(x) && ok(x + 2)) { at = x + 1; G.S = at; break; }
  if (at === null) {
    for (let x = G.S; x >= G.S - 10; x -= SC.step) if (roofUnder(x) > 0) { at = x; break; }
    if (at === null) for (let x = G.S; x <= G.S + 80; x += SC.step) if (roofUnder(x) > 0 && roofUnder(x + 2) > 0) { at = x + 1; G.S = at; break; }
  }
  if (at !== null) {
    G.off = at - G.S; G.y = roofUnder(at); G.vy = 0; G.onGround = true; G.glide = false;
    G.bid = bldgAt(at);
  }
}

// ---- 押す・離す（遊んでいるあいだに起きたものは、刻みの番号といっしょに記録する） ----
let pressed = false;
const IN = { PRESS: 1, RELEASE: 0, CLEAR: 2, LEFT: 3 };
function applyInput(type, a, b) {
  if (type === IN.PRESS) { pressed = true; G.buffer = P.BUFFER; }
  else if (type === IN.RELEASE) {
    pressed = false;
    // 上昇中に離したら上昇を打ち切る（短押し＝小ジャンプ）
    if (G && G.state === 'play' && G.vy > 0 && !G.wall && !G.skip && !G.glide && G.holdT < P.HOLD_T) {
      G.vy *= P.CUT; G.holdT = P.HOLD_T;
    }
  } else if (type === IN.CLEAR) pressed = false;                   // 一時停止など（上昇は打ち切らない）
  else if (type === IN.LEFT) { G.winL = a; G.leftDie = b; } // 画面の割り付けが変わった（窓の左はしまで a m、b m 遅れたら置いていかれる）
}

function tryJump() {
  if (G.buffer <= 0) return;
  if (G.glide) { G.buffer = 0; return; }
  if (G.onGround || G.coyote > 0) {
    G.vy = P.JUMP_V; G.onGround = false; G.coyote = 0; G.holdT = 0; G.jumps = 1;
    puff(G.S + G.off, G.y, 3);
  } else if (G.wall) {
    G.vy = Math.max(G.vy, P.JUMP_V * 0.9); G.holdT = 0; G.jumps = 1;
  } else if (G.jumps > 0) {
    G.vy = P.DOUBLE_V; G.jumps--; G.holdT = 0; G.flip = 0.36;
    puff(G.S + G.off, G.y, 4, '#ffffff');
  } else return;
  G.buffer = 0;
}

function puff(s, h, n, col) {
  for (let i = 0; i < n; i++) {
    G.parts.push({ s, h: h + 0.2, vs: (Math.random() - 0.7) * 6, vh: Math.random() * 3 + 1,
      life: 0.35 + Math.random() * 0.2, col: col || '#efe8d6' });
  }
}

function step(dt) {
  G.t += dt;
  if (G.msgT > 0) G.msgT -= dt;
  if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
  if (G.landT > 0) G.landT -= dt;
  for (const p of G.parts) { p.s += p.vs * dt; p.h += p.vh * dt; p.vh -= 6 * dt; p.life -= dt; }
  G.parts = G.parts.filter((p) => p.life > 0);
  for (const sp of SC.springs) if (sp.t > 0) sp.t = Math.max(0, sp.t - dt);
  if (G.state !== 'play') return;
  if (G.auto) autoPilot();
  G.buffer = Math.max(0, G.buffer - dt);
  G.coyote = Math.max(0, G.coyote - dt);
  if (G.flip) G.flip = Math.max(0, G.flip - dt);

  // 電車
  const tsp = trainSpeed(G.S);
  let v = tsp.v * G.pace;
  const nextS = tsp.next.s;
  if (G.dwell > 0) {
    v = 0; G.dwell -= dt;
    if (G.dwell <= 0 && tsp.next === SC.sts[SC.sts.length - 1] && G.S >= nextS - 0.5) return goal(tsp.next.name);
  } else if (!G.skip && G.S + v * dt >= nextS - 0.3 && G.stopAt !== nextS) {
    G.S = nextS; v = 0; G.dwell = P.DWELL; G.stopAt = nextS;
    G.stationsPassed++;
    if (typeof window !== 'undefined' && window.paxStation) window.paxStation(SC.sts.indexOf(tsp.next)); // 乗り降り（絵だけ）
    if (tsp.next === SC.sts[SC.sts.length - 1]) return goal(tsp.next.name);
    G.pace = Math.min(P.PACE_MAX, G.pace + P.PACE_UP);
    say(`${tsp.next.name}`);
  }
  if (G.skip) v = Math.max(v, G.skip.v);
  if (G.dwell <= 0 && G.S >= nextS - 0.3 && G.stopAt === nextS) G.S = nextS + 0.31;
  G.speed = v;
  G.S += v * dt;
  G.dist += v * dt;
  if (G.skip && G.S >= nextS && G.stopAt !== nextS) {
    G.stopAt = nextS; G.stationsPassed++;
    G.pace = Math.min(P.PACE_MAX, G.pace + P.PACE_UP);
  }

  // ひとっとび（川は水面を走る）
  if (G.skip) {
    const k = G.skip;
    G.off += (0 - G.off) * Math.min(1, dt * 4);
    const nx = G.S + G.off;
    const u = Math.min(1, (nx - k.x0) / (k.x1 - k.x0));
    k.u = u; // 絵のためだけ（こちらへ跳んで窓に貼りつく演出）
    const prevY = G.y;
    if (u < 0.25) { const t = u / 0.25; G.y = k.y0 + (k.low - k.y0) * t + Math.sin(Math.PI * t) * 4; }
    else if (u > 0.8) { const t = (u - 0.8) / 0.2; G.y = k.low + (k.y1 - k.low) * t + Math.sin(Math.PI * t) * 3; }
    else G.y = k.low;
    k.mid = u >= 0.25 && u <= 0.8;
    if (k.mid) {
      G.runPhase += v * dt * 0.12;
      G.dustT -= dt;
      if (G.dustT <= 0) { G.dustT = 0.05; puff(nx - 0.5, k.low, 2, k.water ? '#cfe6fb' : undefined); }
    }
    G.vy = (G.y - prevY) / Math.max(dt, 1e-4);
    if (u >= 1) { G.skip = null; G.y = k.y1; G.vy = 0; G.onGround = true; G.jumps = 1; G.landT = 0.12; puff(nx, G.y, 6); }
    return;
  }

  // 横の動き（壁にぶつかると置いていかれる）
  const prevX = G.S - v * dt + G.off;
  let off = G.off;
  if (off < 0) off = Math.min(0, off + (G.onGround ? P.CATCHUP : P.CATCHUP_AIR) * dt);
  let nx = G.S + off;
  const front = roofUnder(nx);
  G.wall = false;
  if (front > G.y + P.STEP && front > roofUnder(prevX) + 0.01) {
    G.wallBid = bldgAt(nx + P.FOOT); G.wallTop = front;
    nx = prevX; G.wall = true;
  }
  G.off = nx - G.S;

  // 縦の動き
  let g = P.G;
  // 高いところから落ちるときは風呂敷を広げて、ふわっと落ちる（重力を半分弱・落ちる速さは 11m/s まで）
  const below = G.y - roofUnder(nx);
  if (G.onGround || G.wall || G.vy > 0 || below < 1.5) G.momo = false;
  else if (!G.momo && G.vy < -5 && below > 5 && G.opts.diff !== 'hard') G.momo = true; // むずかしいは風呂敷なし
  if (G.glide) { g = 0; G.vy = -9; }
  else if (pressed && G.vy > 0 && G.holdT < P.HOLD_T) { g *= P.HOLD_G; G.holdT += dt; }
  else if (G.momo) g *= P.MOMO_G;
  G.vy = Math.max(G.momo ? P.MOMO_VMAX : -30, G.vy - g * dt);
  tryJump();
  // 壁を駆け上がる。高い壁は鉤縄でぐいっとたぐり上がる（登っているあいだに電車に置いていかれないように）
  if (G.wall && pressed) {
    const target = Math.max(P.WALL_RUN, Math.min(P.HOOK_VMAX, ((G.wallTop || 0) + 1 - G.y) / P.HOOK_T));
    G.vy = G.climbing ? target : Math.max(G.vy, target); G.climbing = true;
  } else {
    if (!G.wall) G.climbing = false;
    if (G.wall && G.vy < P.WALL_SLIDE) G.vy = P.WALL_SLIDE;
  }
  const under = roofUnder(nx);
  const prevY = G.y;
  G.y += G.vy * dt;
  const wasGround = G.onGround;
  G.onGround = false;
  // 着地できる面: 1 層目と 2 層目のうち、上から降りてきて届くいちばん高いもの
  const under2 = roof2Under(nx);
  let land = -1, layer = 0;
  for (const [u, l] of [[under, 1], [under2, 2]]) {
    if (u > 0 && G.vy <= 0 && G.y <= u && prevY >= u - P.STEP && u > land) { land = u; layer = l; }
  }
  if (land > 0) {
    if (!wasGround && prevY - land > 1.5) { G.landT = 0.12; puff(nx, land, 4); }
    G.y = land; G.vy = 0; G.onGround = true; G.jumps = 1; G.glide = false; G.layer = layer;
  } else if (wasGround) {
    G.coyote = P.COYOTE;
  }
  // しなり竹: 上から落ちてきたら、向こうの屋根に届く勢いではね上げる（高すぎる屋根は壁を駆け上がる）
  const sp = land > 0 ? null : springAt(nx);
  if (sp && G.vy < 0 && G.y <= SPRING_H && prevY >= SPRING_H - 1) {
    const t = Math.max(0.35, (sp.s1 + 1 - nx) / Math.max(3, v));
    const want = Math.max(Math.sqrt(2 * P.G * (sp.y1 + 1.5)), (sp.y1 + 1.5) / t + (P.G * t) / 2); // 向こうの屋根の高さまで（高い屋根でも）
    G.y = SPRING_H; G.vy = Math.max(20, Math.min(P.SPRING_VMAX, want)); G.jumps = 1; G.holdT = P.HOLD_T; G.glide = false;
    sp.t = 0.4; puff(nx, SPRING_H, 6, '#d9f0a0');
    say('しなり竹！');
  }
  if (G.glide && under === 0) G.y = Math.max(G.y, 30); // 降りる屋根が来るまで浮いている
  if (G.onGround) {
    G.runPhase += v * dt;
    G.dustT -= dt;
    if (v > 8 && G.dustT <= 0) { G.dustT = 0.18; puff(nx - 0.3, G.y, 1); }
    const k2 = Math.round(nx / SC.step);
    const bi = G.layer === 2 && SC.pb2[k2] >= 0 ? SC.pb2[k2] : bldgAt(nx);
    if (bi >= 0 && bi !== G.bid) {
      G.bid = bi;
      const w = wardOf(SC.near[bi].addr);
      if (w && w !== G.ward) { if (G.ward) G.banner = { text: w, t: 2.6 }; G.ward = w; }
    }
  }

  // 大きな隙間は自動でひとっとび
  if (!G.onGround) {
    const gap = gapAround(nx);
    if (gap && gap.w > P.BIG_GAP && gap.s1 < SC.length - 5) {
      const pl = placeIn(gap.s0, gap.s1);
      const water = !!pl && pl.kind === 'water';
      G.skip = { v: Math.max(30, gap.w / 2.4), x0: nx, x1: gap.s1 + 2, y0: G.y, y1: gap.nextTop,
        low: water ? 1.4 : 3, water, place: pl }; // 水面は 1.4m（窓の下のふちのすぐ上に見える）
      G.glide = false;
      say(pl ? (water ? `${pl.name}を 水面走り！` : `${pl.name}を ひとっとび！`) : 'ひとっとび！');
      return;
    }
  }

  // オート実行中は落ちない: 地面の手前でけり上がる。窓の左はしより外へは出さない
  if (G.auto) {
    if (!G.onGround && G.vy <= 0 && G.y < 1.2 && !springAt(nx)) {
      G.y = Math.max(G.y, 1.2); G.vy = 26; G.jumps = 1; G.holdT = P.HOLD_T; puff(nx, G.y, 5, '#ffffff');
      G.autoSaves = (G.autoSaves || 0) + 1;
    }
    const lim = -G.winL + 0.5;
    if (G.off < lim) G.off = lim;
  }
  // おしまい
  if (G.y <= 0.01 && !G.glide) return die('fall');
  if (G.off < -G.leftDie) return die('left'); // 側窓の左はしより外
}

function say(t) { G.msg = t; G.msgT = 1.8; }

function whereNow() {
  const sp = trainSpeed(G.S);
  if (G.S >= sp.next.s - 30) return `${sp.next.name}駅のあたり`;
  if (G.S <= sp.prev.s + 30) return `${sp.prev.name}駅のあたり`;
  return `${sp.prev.name}〜${sp.next.name}`;
}

function goal(name) { return die('goal', `${name}に到着（${G.stationsPassed}駅）`); }

// ---- 押した記録から、もう一度走らせる（ランキングのサーバーで点数を計算しなおす。手元の確かめにも使う） ----
// run: { from, opts: { diff, crowd }, ev: [[刻みの番号, 種類, 値], ...], T: 終わった刻みの番号 }
// die(kind) はゲームの側で定義する。ここでは呼ぶだけ（サーバーでは結果を残す関数を渡す）
function replayRun(run, maxExtra) {
  startGame(run.from, run.opts);
  pressed = false;
  const ev = run.ev || [];
  let i = 0;
  const end = (run.T || 0) + (maxExtra === undefined ? 240 * 20 : maxExtra);
  while (G.state === 'play' && G.tick < end) {
    while (i < ev.length && ev[i][0] <= G.tick) { applyInput(ev[i][1], ev[i][2], ev[i][3]); i++; }
    G.tick++;
    step(DT);
    G.parts = [];
  }
  return { state: G.state, tick: G.tick, dist: G.dist, pts: Math.round(Math.round(G.dist) * optMult(G.opts)), mult: optMult(G.opts),
    where: whereNow(), stations: G.stationsPassed };
}
