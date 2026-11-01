// 形に似せる組体操づくり（局所探索）。
//   1. 床につながった構造から、足場（床・肩・背中・もも・手）に1人ずつ「静止ポーズの型」で置き足していく。
//      候補は、実際に描く線（頭の円・胴・腕・脚・線の太さ）を塗って、入力の形との点数（raster.js）が一番よくなるものを選ぶ。
//   2. 置いた後で、誤差の大きい所の人について、取り除く・別の足場や型に置き直す・自由な手足の角度を変える・2〜4人の組を組み直す を試し、
//      点数がよくなるものだけ採用する。
//   3. どの段階でも、骨組み（関節の範囲）・接触（線の表面どうしの一致）・床までたどれること を満たさない配置は採用しない。
// made with Claude Opus 5.5
'use strict';

const SIZE_STEPS = [0.82, 1, 1.22];          // 体の大きさは3種類だけ（極端な大小や際限のない小型化をしない）

function Sculptor(mask, opt) {
  opt = opt || {};
  const H0 = opt.H0 || 48;
  const sizes = SIZE_STEPS.map(function (k) { return H0 * k; });
  // 採用の下限：1人の効き目は細かさの2乗に反比例して小さくなるので、下限もそれに合わせる
  const EPS = 1e-4 / (RES * RES), EPS5 = 1e-5 / (RES * RES);
  const budget = opt.budget || 150;
  const board = makeBoard(mask, H0, { budget: budget, weights: Object.assign({ contour: 4.5, over: 7 }, opt.weights || {}), targetDensity: opt.targetDensity || 0.18 });
  const figs = [];                        // 番号＝添字。取り除いた人は null
  let rng = opt.seed || 1;
  const rand = function () { rng = (rng * 16807) % 2147483647; return rng / 2147483647; };
  const stats = { evals: 0, added: 0, removed: 0, moved: 0, limbs: 0, groups: 0 };

  // 前の配置から引き継ぐ人（番号・姿勢・接触をそのまま）。部分的な組み替えのときに使う
  if (opt.initial) opt.initial.forEach(function (o) {
    if (!o) return;
    const fig = { id: o.id, h: o.h, f: o.f, tpl: o.tpl, v: o.v, pose: Object.assign({}, o.pose), hx: o.hx, hy: o.hy, contacts: o.contacts.map(function (c) { return Object.assign({}, c); }), seed: o.seed };
    fig.pts = solve(fig.pose, fig.hx, fig.hy, fig.h, fig.f);
    figs[fig.id] = fig;
  });
  for (let i = 0; i < figs.length; i++) if (figs[i] === undefined) figs[i] = null;
  figs.forEach(function (fig) { if (fig) { fig.r = rasterFigure(fig.pts, fig.h, board.tau, fig.contacts.filter(function (c) { return c.host !== -1; }).map(function (c) { const P = fig.pts[c.limb]; return [P[0], P[1], fig.h * 0.22]; }), board.bt); board.add(fig.r); } });

  // 形の下の端（床に立てる範囲）
  const floorXs = [];
  for (let x = 0; x < STAGE_W; x += 1) {
    let on = false;
    for (let y = FLOOR_Y - Math.round(H0 * 0.5); y < FLOOR_Y; y++) if (mask[y * STAGE_W + x]) { on = true; break; }
    if (on) floorXs.push(x);
  }

  /* ----- 人1人の情報 ----- */
  // 触れている所の近く（重なりを罰しない円）：支え・ぶら下がりの手足の先から 0.22h
  function zonesOf(fig) {
    return fig.contacts.filter(function (c) { return c.host !== -1; }).map(function (c) { const P = fig.pts[c.limb]; return [P[0], P[1], fig.h * 0.22]; });
  }
  function ras(fig) { return rasterFigure(fig.pts, fig.h, board.tau, zonesOf(fig), board.bt); }
  function build(spec) {
    const fig = { id: spec.id, h: spec.h, f: spec.f, tpl: spec.tpl, v: spec.v, pose: spec.pose, hx: spec.hx, hy: spec.hy, contacts: spec.contacts, seed: spec.seed || Math.floor(rand() * 1000) };
    fig.pts = solve(fig.pose, fig.hx, fig.hy, fig.h, fig.f);
    return fig;
  }
  function limbUsed(fig) {
    const u = {};
    fig.contacts.forEach(function (c) { if (c.kind !== 'hold') u[c.limb] = true; });
    return u;
  }
  // だれがだれのどこに触れているかの索引（人を置く・外すたびに作り直す。毎回全員を調べ直さないため）
  let version = 0, idxVer = -1, idx = null;
  function touched() { version++; }
  // 足場の「行き止まり」の記録：その足場から良くなる候補がなかったら覚えておき、近く（升目 H0）で人の出入りがあるまで試さない
  const TT = H0, ttw = Math.ceil(STAGE_W / TT), tth = Math.ceil(STAGE_H / TT), tileVer = new Int32Array(ttw * tth);
  let tileClock = 0;
  const dead = new Map();
  function bumpTiles(fig) {
    tileClock++;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k in fig.pts) { x0 = Math.min(x0, fig.pts[k][0]); x1 = Math.max(x1, fig.pts[k][0]); y0 = Math.min(y0, fig.pts[k][1]); y1 = Math.max(y1, fig.pts[k][1]); }
    const a = Math.max(0, Math.floor((x0 - H0) / TT)), b = Math.min(ttw - 1, Math.floor((x1 + H0) / TT));
    const c = Math.max(0, Math.floor((y0 - H0) / TT)), d = Math.min(tth - 1, Math.floor((y1 + H0) / TT));
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) tileVer[y * ttw + x] = tileClock;
  }
  function siteKey(s) { return s.host + ':' + s.part + ':' + Math.round(s.pt[0]) + ':' + Math.round(s.pt[1]); }
  function tileOf(s) { const x = Math.min(ttw - 1, Math.max(0, Math.floor(s.pt[0] / TT))), y = Math.min(tth - 1, Math.max(0, Math.floor(s.pt[1] / TT))); return y * ttw + x; }
  function isDead(s) { const v = dead.get(siteKey(s)); return v !== undefined && v >= tileVer[tileOf(s)]; }
  function markDead(s) { dead.set(siteKey(s), tileClock); }
  function hostIndex() {
    if (idxVer === version && idx) return idx;
    idx = {};
    figs.forEach(function (o) { if (o) o.contacts.forEach(function (c) { if (c.host >= 0 && c.kind !== 'hold') (idx[c.host] = idx[c.host] || []).push({ part: c.part, guest: o.id, P: o.pts[c.limb] }); }); });
    idxVer = version;
    return idx;
  }
  // 他の人に使われている部位（host 側）
  function hostedParts(id) {
    const u = {};
    (hostIndex()[id] || []).forEach(function (e) { u[e.part] = (u[e.part] || 0) + 1; });
    return u;
  }
  function dependents(id) {
    const out = [];
    (hostIndex()[id] || []).forEach(function (e) { if (out.indexOf(e.guest) < 0) out.push(e.guest); });
    return out;
  }
  function refreshFree(fig) {
    const used = limbUsed(fig), hosted = hostedParts(fig.id);
    fig.freeLimb = { haF: !used.haF && !hosted.haF, haB: !used.haB && !hosted.haB };
    fig.used = hosted;
  }

  /* ----- 足場 ----- */
  function siteCapacityOK(site) {
    if (site.host === -1) return true;
    let n = 0;
    const cap = site.part === 'sh' ? 2 : 1;
    const host = figs[site.host];
    (hostIndex()[site.host] || []).forEach(function (e) {
      if (e.part !== site.part) return;
      if ((site.part === 'torso' || site.part.indexOf('thigh') === 0) && Math.hypot(e.P[0] - site.pt[0], e.P[1] - site.pt[1]) > host.h * 0.12) return;
      n++;
    });
    // 同じ人の足が2本のっているのは1人分と数える
    return n / (site.part === 'sh' ? 1 : 2) < cap || (site.part !== 'sh' && n === 0);
  }
  function allSites(region) {
    const out = [];
    const step = Math.max(2, H0 * 0.1);
    let last = -1e9;
    floorXs.forEach(function (x) { if (x - last >= step) { last = x; if (!region || inRegion(region, x, FLOOR_Y - H0 * 0.5)) out.push(floorSite(x)); } });
    figs.forEach(function (fig) {
      if (!fig) return;
      refreshFree(fig);
      sitesOf(fig).forEach(function (s) { if ((!region || inRegion(region, s.pt[0], s.pt[1])) && siteCapacityOK(s)) out.push(s); });
    });
    return out;
  }
  function inRegion(region, x, y) {
    if (!region) return true;
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= STAGE_W || yi >= STAGE_H) return false;
    return region[yi * STAGE_W + xi] > 0;
  }
  function siteNeed(s) {
    if (s.cls === 'ankle') return Math.max(board.need(s.pt[0] + s.dir * H0 * 0.6, s.pt[1], H0 * 0.55), board.need(s.pt[0], s.pt[1] + H0 * 0.6, H0 * 0.55)) * 1.3;   // 横（旗）と下（ぶら下がり）
    if (s.cls === 'hand') {
      // 手をつなぐ足場：つないだ人の体が来る、腕の先のさらに外（左右・斜め上）の足りなさ
      let m = 0;
      [0, Math.PI, -0.7, Math.PI + 0.7].forEach(function (a) {
        const x = s.pt[0] + Math.cos(a) * (s.R + H0 * 0.45), y = s.pt[1] + Math.sin(a) * (s.R + H0 * 0.45);
        m = Math.max(m, board.need(x, y, H0 * 0.5));
      });
      return m * 1.3;
    }
    const up = board.need(s.pt[0], s.pt[1] - H0 * 0.45, H0 * 0.6) + board.need(s.pt[0], s.pt[1] - H0 * 0.1, H0 * 0.35);
    if (s.cls !== 'sh') return up;
    // 肩：上だけでなく、横（肩につかまって横へ伸びる人）の足りなさも見る
    const side = Math.max(board.need(s.pt[0] + H0 * 0.7, s.pt[1], H0 * 0.5), board.need(s.pt[0] - H0 * 0.7, s.pt[1], H0 * 0.5));
    return Math.max(up, side * 1.3);
  }

  /* ----- 速い下見：描く線の上の点だけで、よくなりそうかを見積もる（全部を塗って採点する前に、候補を絞る） ----- */
  const g0 = board.grids[0];
  function quickScore(fig) {
    let v = 0;
    const p = fig.pts, step = Math.max(2, lineW(fig.h) * 2.5);
    const at = function (x, y) {
      const xi = x | 0, yi = y | 0;
      if (xi < 0 || yi < 0 || xi >= STAGE_W || yi >= STAGE_H) { v -= 3; return; }
      const i = yi * STAGE_W + xi;
      if (!board.mask[i]) { v -= 1 + board.dIn[i] / board.tau; return; }
      const k = g0.map[i];
      v += (board.D * g0.m[k] - g0.b[k] / g0.A[k]) > 0 ? 1 : 0.15;
      if (board.cnt[i]) v -= 0.6;
      if (board.dOut[i] < board.tau + lineW(fig.h)) v += Math.min(4, board.ub[k] * 0.25);   // まだ届いていない輪郭を優先
    };
    for (const sg of FIG_SEGS) {
      const a = p[sg[0]], b = p[sg[1]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j <= n; j++) at(a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n);
    }
    at(p.head[0], p.head[1]); at(p.head[0], p.head[1]);
    return v;
  }
  // 候補を下見して、上位 M 個だけ残す
  function prescreen(cands, id, M, sizeOK) {
    const list = [];
    cands.forEach(function (c) {
      if (sizeOK && !sizeOK(c.h)) return;
      const f = build({ id: id, h: c.h, f: c.f, tpl: c.tpl, v: c.v, pose: c.res.pose, hx: c.res.hx, hy: c.res.hy, contacts: c.res.contacts });
      if (quickReject(f)) return;
      list.push({ c: c, q: quickScore(f) });
    });
    list.sort(function (a, b) { return b.q - a.q; });
    return list.slice(0, M).map(function (o) { return o.c; });
  }

  /* ----- 候補づくり ----- */
  function classOK(list, s) {
    if (s.cls === 'ankle') return list.indexOf('ankle') >= 0;
    if (s.cls === 'thigh') return list.indexOf('thigh') >= 0;
    if (s.cls === 'hand') return list.indexOf('hand') >= 0;
    return list.indexOf(s.cls) >= 0;
  }
  function sizesFor(s) {
    // その場所の太さに合う大きさを優先（太さ＝輪郭までの距離×2）。3種類のうち2つを試す
    const x = Math.round(s.pt[0]), y = Math.round(s.pt[1] - H0 * 0.5);
    const t = (x >= 0 && y >= 0 && x < STAGE_W && y < STAGE_H) ? board.dOut[y * STAGE_W + x] * 2 : H0 * 0.5;
    const want = Math.max(sizes[0], Math.min(sizes[2], t / 0.45));
    const order = sizes.slice().sort(function (a, b) { return Math.abs(a - want) - Math.abs(b - want); });
    return order.slice(0, 2);
  }
  function quickReject(fig) {
    // 明らかに形から遠い所に体の中心や頭がある候補は、塗る前に捨てる（最終判断は塗った画素で行う）
    const far = H0 * 0.35;
    for (const k of ['hip', 'neck', 'head']) {
      const x = Math.round(fig.pts[k][0]), y = Math.round(fig.pts[k][1]);
      if (x < 0 || y < 0 || x >= STAGE_W || y >= STAGE_H) return true;
      if (board.dIn[y * STAGE_W + x] > far) return true;
    }
    return false;
  }
  function rankSites(sites) {
    const ranked = sites.map(function (s) { return { s: s, n: siteNeed(s) }; }).filter(function (o) { return o.n > 1; });
    ranked.sort(function (a, b) { return b.n - a.n; });
    return ranked.map(function (o) { return o.s; });
  }
  // top：足りなさの大きい順に並べた足場のうち、今回ためす分
  function makeCandidates(sites, region, K, top) {
    top = top || rankSites(sites).slice(0, K);
    const out = [];
    // 2人にまたがる候補は、近くの足場だけを調べる。全舞台の足場との総当たりを避ける。
    const cell = sizes[2] * 1.05, sw = Math.ceil(STAGE_W / cell), bins = new Map();
    sites.forEach(function (s) {
      const k = Math.floor(s.pt[1] / cell) * sw + Math.floor(s.pt[0] / cell);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(s);
    });
    let src = null;
    const push = function (tpl, v, h, f, res) { if (res) out.push({ tpl: tpl, v: v, h: h, f: f, res: res, src: src }); };
    top.forEach(function (S) {
      src = S;
      const h0 = sizesFor(S);
      h0.forEach(function (h) {
        for (const name in TEMPLATES) {
          const T = TEMPLATES[name];
          if (!classOK(T.sites, S)) continue;
          T.variants.forEach(function (v) { [1, -1].forEach(function (f) { push(name, v, h, f, T.one(S, h, f, v)); }); });
        }
      });
      // 2か所の型：S と近くの足場 T の組
      const near = [], sx = Math.floor(S.pt[0] / cell), sy = Math.floor(S.pt[1] / cell);
      for (let y = sy - 1; y <= sy + 1; y++) for (let x = sx - 1; x <= sx + 1; x++) {
        if (x < 0 || x >= sw || y < 0) continue;
        const bin = bins.get(y * sw + x);
        if (bin) near.push.apply(near, bin);
      }
      near.forEach(function (T) {
        if (T === S || (T.host === S.host && T.part === S.part && T.host !== -1)) return;
        const d = Math.hypot(T.pt[0] - S.pt[0], T.pt[1] - S.pt[1]);
        if (d > sizes[2] * 1.05 || d < H0 * 0.08) return;
        if (S.host === -1 && T.host === -1 && Math.abs(T.pt[0] - S.pt[0]) > sizes[2]) return;
        for (const name in TEMPLATES2) {
          const T2 = TEMPLATES2[name];
          [[S, T], [T, S]].forEach(function (pr) {
            if (!classOK(T2.a, pr[0]) || !classOK(T2.b, pr[1])) return;
            h0.forEach(function (h) { T2.variants.forEach(function (v) { [1, -1].forEach(function (f) { push(name, v, h, f, T2.two(pr[0], pr[1], h, f, v)); }); }); });
          });
        }
      });
    });
    return out;
  }
  // 手をつながれる相手（host）の腕を、つなぐ点 Q まで伸ばした姿を作る
  function modHost(mod) {
    const X = figs[mod.host];
    if (!X) return null;
    if (!armReach(X.pts.sh, mod.Q, X.h)) return null;
    const p2 = Object.assign({}, X.pose);
    armTo(p2, X.pts.sh, mod.Q, X.h, X.f, mod.side);
    if (!jointsOK(p2)) return null;
    const X2 = Object.assign({}, X, { pose: p2 });
    X2.pts = solve(p2, X.hx, X.hy, X.h, X.f);
    if (figureOK(X2, figs)) return null;
    X2.r = ras(X2);
    return X2;
  }
  // 盤と figs の中で、同じ番号の人を入れかえる。入れかえ前の人を返す
  // 試しに置く（手をつながれる相手の腕の変化も）。元に戻す関数を返す
  function tempPlace(X) {
    const old = X.mod ? swapIn(X.mod) : null;
    board.add(X.r); figs[X.id] = X; touched();
    return function () { board.remove(X.r); figs[X.id] = undefined; touched(); if (old) swapIn(old); };
  }
  function swapIn(X2) { const X = figs[X2.id]; board.remove(X.r); board.add(X2.r); figs[X2.id] = X2; touched(); return X; }
  // 候補を評価：骨組み・接触を確かめ、塗って点数の変化を返す（手をつながれる相手の腕の変化も含める）
  function evaluate(c, id) {
    const fig = build({ id: id, h: c.h, f: c.f, tpl: c.tpl, v: c.v, pose: c.res.pose, hx: c.res.hx, hy: c.res.hy, contacts: c.res.contacts });
    if (quickReject(fig)) return null;
    let X2 = null, X = null, dMod = 0;
    if (c.res.mod) {
      X2 = modHost(c.res.mod);
      if (!X2) return null;
      const X0 = figs[X2.id];
      dMod = board.delta(X0.r, -1);
      board.remove(X0.r); dMod += board.delta(X2.r, 1); board.add(X0.r);
      X = swapIn(X2);
    }
    figs[id] = fig;
    const bad = figureOK(fig, figs);
    let deep = 0;
    if (!bad && (fig.tpl === 'hang' || fig.tpl === 'flag' || fig.tpl === 'lean' || fig.tpl === 'plank')) deep = overhang(fig, figs);
    figs[id] = undefined;
    if (!bad && deep <= MAX_OVERHANG) {
      stats.evals++;
      fig.r = ras(fig);
      fig.d = board.delta(fig.r, 1) + dMod;
    }
    if (X) { swapIn(X); fig.mod = X2; fig.dMod = dMod; }
    if (bad || deep > MAX_OVERHANG) return null;
    return fig;
  }

  /* ----- 自由な手足を、形に合わせて選ぶ ----- */
  // 自由な腕・脚は、読みやすい身ぶり（下ろす・前・横・斜め上・上・後ろ上）の中から選ぶ。ひじ・ひざは軽く曲げるまで
  const ARM_OPT = [];
  [-20, 15, 50, 90, 130, 170, 205].forEach(function (a) { [0, 35].forEach(function (e) { ARM_OPT.push([a, e]); }); });
  const LEG_OPT = [];
  [-40, -10, 20, 50, 90, 140, 180, 220].forEach(function (l) { [0, 50].forEach(function (k) { LEG_OPT.push([l, k]); }); });
  function freeLimbsOf(fig) {
    const used = limbUsed(fig), hosted = hostedParts(fig.id);
    const out = [];
    if (!used.haF && !hosted.haF) out.push('F_arm');
    if (!used.haB && !hosted.haB) out.push('B_arm');
    const legBusy = function (s) { return used['ft' + s] || used['kn' + s] || hosted['thigh' + s] || hosted['ft' + s]; };   // 足首をつかまれている脚も動かさない
    if (!legBusy('F') && !used.hip) out.push('F_leg');
    if (!legBusy('B') && !used.hip) out.push('B_leg');
    if (used.hip && !legBusy('F') && fig.contacts.every(function (c) { return c.limb !== 'ftF'; })) out.push('F_leg');
    if (used.hip && !legBusy('B') && fig.contacts.every(function (c) { return c.limb !== 'ftB'; })) out.push('B_leg');
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }
  // fig は盤に「のっていない」状態で渡す。最良の手足の角度に書きかえ、点数の変化を返す
  function optimizeLimbs(fig) {
    let X = null;
    if (fig.mod) X = swapIn(fig.mod);
    const dMod = fig.dMod || 0;
    fig.d -= dMod;
    const limbs = freeLimbsOf(fig);
    let bestD = fig.d;
    limbs.forEach(function (L) {
      const side = L[0], isArm = L.indexOf('arm') > 0;
      const k1 = isArm ? 'a' + side : 'l' + side, k2 = isArm ? 'e' + side : 'k' + side;
      const orig = [fig.pose[k1], fig.pose[k2]];
      let best = orig.slice();
      // 角度の候補を速い下見で絞り、上位3つだけ塗って採点する
      const opts = [];
      (isArm ? ARM_OPT : LEG_OPT).forEach(function (o) {
        fig.pose[k1] = o[0]; fig.pose[k2] = o[1];
        if (!jointsOK(fig.pose)) return;
        fig.pts = solve(fig.pose, fig.hx, fig.hy, fig.h, fig.f);
        const lw = lineW(fig.h);
        for (const k in fig.pts) if (fig.pts[k][1] > FLOOR_Y - lw / 2 + CONTACT_TOL) return;
        if (figureOK(fig, figs)) return;
        opts.push({ o: o, q: quickScore(fig) });
      });
      opts.sort(function (a, b) { return b.q - a.q; });
      opts.slice(0, 3).forEach(function (oo) {
        const o = oo.o;
        fig.pose[k1] = o[0]; fig.pose[k2] = o[1];
        fig.pts = solve(fig.pose, fig.hx, fig.hy, fig.h, fig.f);
        const r = ras(fig);
        stats.evals++;
        const d = board.delta(r, 1);
        if (d < bestD - 1e-9) { bestD = d; best = [fig.pose[k1], fig.pose[k2]]; }
      });
      fig.pose[k1] = best[0]; fig.pose[k2] = best[1];
      fig.pts = solve(fig.pose, fig.hx, fig.hy, fig.h, fig.f);
    });
    fig.r = ras(fig);
    fig.d = board.delta(fig.r, 1) + dMod;
    if (X) swapIn(X);
    return fig.d;
  }

  /* ----- 盤への出し入れ ----- */
  function place(fig) {
    if (fig.mod) { swapIn(fig.mod); fig.mod = null; fig.dMod = 0; }
    fig.id = fig.id === undefined ? figs.length : fig.id;
    if (!fig.r) fig.r = ras(fig);
    board.add(fig.r);
    figs[fig.id] = fig;
    touched(); bumpTiles(fig);
    stats.added++;
    return fig;
  }
  function unplace(fig) {
    board.remove(fig.r);
    figs[fig.id] = null;
    touched(); bumpTiles(fig);
    // この人の足首をつかんでいた手（見た目だけの hold）は放す
    figs.forEach(function (o) { if (o) o.contacts = o.contacts.filter(function (c) { return !(c.kind === 'hold' && c.host === fig.id); }); });
  }
  function nextId() { for (let i = 0; i < figs.length; i++) if (!figs[i]) return i; return figs.length; }
  function count() { let n = 0; figs.forEach(function (f) { if (f) n++; }); return n; }

  /* ----- 1. 置き足す ----- */
  // 1人分：最良の候補（手足の調整後）が点数をよくするなら置く。置いた人を返す
  function growOne(region, K, sizeOK, deadline) {
    stats.growPending = false;
    if (count() >= budget) return null;
    const sites = allSites(region);
    const id = nextId();
    const ranked = rankSites(sites).filter(function (s) { return !isDead(s); });
    K = K || 10;
    let best = null, lastScored = null;
    // 足りなさの大きい足場から K 個ずつ試し、よくなる候補が見つかるまで次の K 個へ（最大 4 回）
    for (let start = 0; start < ranked.length && start < K * (opt.maxBatches || 40) && !(best && best.v < -EPS); start += K) {
      if (start && deadline && performance.now() >= deadline) { stats.growPending = true; break; }
      const batch = ranked.slice(start, start + K);
      const cands = prescreen(makeCandidates(sites, region, K, batch), id, opt.screen || 70, sizeOK);
      const scored = [];
      const good = new Set();
      cands.forEach(function (c) {
        const fig = evaluate(c, id);
        if (fig) { scored.push(fig); if (fig.d < -EPS) good.add(c.src); }
      });
      // 下見で残った候補が1つも良くならなかった足場は「行き止まり」として覚える（先読みで良くなるものは下で救う）
      const deadNow = batch.filter(function (S) { return !good.has(S); });
      scored.sort(function (a, b) { return a.d - b.d; });
      lastScored = scored;
      scored.slice(0, 3).forEach(function (fig) {
        optimizeLimbs(fig);
        fig.v = fig.d;
        if (!best || fig.v < best.v) best = fig;
      });
      // 1手先読み：その人の体が新しい足場になって、次に置ける人がどれだけよくするか（足場を作る人を選べるように）
      // 先読みなしでよくなる候補がある時は省く（計算を減らす）
      if (opt.lookahead !== false && !(best && best.d < -EPS) && (!deadline || performance.now() < deadline)) {
        const ahead = scored.slice(0, typeof opt.lookahead === 'number' ? opt.lookahead : 5);
        ahead.forEach(function (X) {
          if (deadline && performance.now() >= deadline) return;
          if (X.v === undefined) X.v = X.d;
          const undo = tempPlace(X);
          refreshFree(X);
          const own = sitesOf(X).filter(siteCapacityOK);
          let dy = 0;
          if (own.length) {
            const idY = nextId();
            prescreen(makeCandidates(allSites(region), region, own.length, own), idY, 16, sizeOK).forEach(function (c) {
              const Y = evaluate(c, idY);
              if (Y && Y.d < dy) dy = Y.d;
            });
          }
          undo();
          X.v = X.d + 0.8 * dy;
          if (!best || X.v < best.v) best = X;
        });
      }
      deadNow.forEach(function (S) { if (!(best && best.v < -EPS && scored.some(function (g) { return g === best; }))) markDead(S); });
    }
    if (!best || best.v > -EPS) return null;
    const placed = place(best);
    // 同じ回の候補のうち、ほかにもよくなるものを続けて置く（足場や体が重ならないもの。置く直前に確かめ直す）
    if (opt.batch !== 0 && lastScored) {
      const box = function (f) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const k in f.pts) { x0 = Math.min(x0, f.pts[k][0]); x1 = Math.max(x1, f.pts[k][0]); y0 = Math.min(y0, f.pts[k][1]); y1 = Math.max(y1, f.pts[k][1]); } return [x0, y0, x1, y1]; };
      const boxes = [box(placed)];
      let extra = 0;
      for (const g of lastScored) {
        if (extra >= (opt.batch || 5) || count() >= budget) break;
        if (g === best || g.mod || g.d > -EPS) continue;
        if (sizeOK && !sizeOK(g.h)) continue;
        const b = box(g);
        if (boxes.some(function (q) { return b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]; })) continue;
        g.id = nextId();
        if (figureOK(g, figs)) continue;
        // 足場がまだ空いているか
        if (g.contacts.some(function (c) { return c.host >= 0 && !siteCapacityOK({ host: c.host, part: c.part, pt: g.pts[c.limb], lw: 0 }); })) continue;
        g.r = ras(g);
        if (board.delta(g.r, 1) > -EPS) continue;
        place(g); boxes.push(b); extra++;
      }
    }
    return placed;
  }
  function grow(maxAdd, region, sizeOK, timeLimit) {
    const t0 = performance.now();
    let n = 0;
    while (n < maxAdd && (!timeLimit || performance.now() - t0 < timeLimit)) {
      if (!growOne(region, 10, sizeOK, timeLimit ? t0 + timeLimit : null)) break;
      n++;
    }
    return n;
  }

  /* ----- 0. 骨組みの段（読みやすい規則的な土台） -----
     床の上に間隔をそろえて立ち、その上に段ごとに「1人の肩に立つ／2人の肩にまたがる／離れた2人に板（うつぶせ）をかけ、その背中に立つ」を
     並べる。どの置き方を選ぶかは、それぞれ塗った画素の点数（よくなる量）で決め、重ならない組み合わせを左から順の動的計画法で選ぶ。 */
  function scaffold(maxRows, sizeOK) {
    const t0 = performance.now();
    // 1段目：床に接する区間ごとに、大きさを選んで間隔をそろえて立つ
    const runs = [];
    floorXs.forEach(function (x) { const r = runs[runs.length - 1]; if (r && x - r[1] <= 2) r[1] = x; else runs.push([x, x]); });
    let row = [];
    runs.forEach(function (run) {
      const w = run[1] - run[0] + 1;
      let bestSet = null, bestSum = 0;
      sizes.forEach(function (h) {
        if (sizeOK && !sizeOK(h)) return;
        const n = Math.max(1, Math.floor(w / (0.62 * h)));
        const set = [];
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const x = run[0] + (i + 0.5) * w / n, f = i % 2 ? 1 : -1;
          const res = TEMPLATES.stand.one(floorSite(x), h, f, 0);
          if (!res) continue;
          res.pose.aF = 65; res.pose.aB = -65;
          const g = evaluate({ tpl: 'stand', v: 0, h: h, f: f, res: res }, nextId() + i);
          if (g) { set.push(g); sum += g.d; }
        }
        if (sum < bestSum) { bestSum = sum; bestSet = set; }
      });
      (bestSet || []).forEach(function (g) {
        if (count() >= budget) return;
        if (sizeOK && !sizeOK(g.h)) return;                 // その大きさの人がもういない
        g.id = nextId();
        const d = board.delta(g.r, 1);
        if (d < 0) row.push(place(g));
      });
    });
    for (let r = 1; r < (maxRows || 30) && row.length; r++) {
      row.forEach(refreshFree);
      const sup = [];
      row.forEach(function (o) { sitesOf(o).forEach(function (s) { if (s.cls !== 'hand' && siteCapacityOK(s)) sup.push(s); }); });
      sup.sort(function (a, b) { return a.pt[0] - b.pt[0]; });
      const cands = [];
      const tmp = nextId();
      const tryC = function (tpl, v, h, f, res, x0, x1) {
        if (!res) return;
        const g = evaluate({ tpl: tpl, v: v, h: h, f: f, res: res }, tmp);
        if (g && g.d < 0) { g.x0 = x0; g.x1 = x1; cands.push(g); }
      };
      sup.forEach(function (S, i) {
        const f = (r + i) % 2 ? 1 : -1;
        sizes.forEach(function (h) {
          if (sizeOK && !sizeOK(h)) return;
          const standing = TEMPLATES.stand.one(S, h, f, 0);
          if (standing) { standing.pose.aF = 65; standing.pose.aB = -65; }
          tryC('stand', 0, h, f, standing, S.pt[0] - 0.29 * h, S.pt[0] + 0.29 * h);
          [1, -1].forEach(function (ff) {
            TEMPLATES.step.variants.forEach(function (v) {
              const res = TEMPLATES.step.one(S, h, ff, v);
              if (res) tryC('step', v, h, ff, res, Math.min(S.pt[0], res.hx) - 0.18 * h, Math.max(S.pt[0], res.hx) + 0.18 * h);
            });
          });
          const T = sup[i + 1];
          if (!T || T.host === S.host) return;
          tryC('straddle', 0, h, f, TEMPLATES2.straddle.two(S, T, h, f, 0), S.pt[0] + 0.02 * h, T.pt[0] - 0.02 * h);
          [1, -1].forEach(function (ff) {
            const A = ff === 1 ? T : S, B = ff === 1 ? S : T;
            tryC('plank', 0, h, ff, TEMPLATES2.plank.two(A, B, h, ff, 0), S.pt[0], T.pt[0]);
          });
        });
      });
      // 重ならない組（区間 [x0,x1] が重ならない）で、よくなる量の合計が最大のもの
      cands.sort(function (a, b) { return a.x1 - b.x1; });
      const best = cands.map(function () { return null; });
      cands.forEach(function (c, i) {
        let prev = { v: 0, list: [] };
        for (let j = 0; j < i; j++) if (cands[j].x1 <= c.x0 + 0.5 && best[j].v > prev.v) prev = best[j];
        best[i] = { v: prev.v - c.d, list: prev.list.concat([c]) };
      });
      let pick = { v: 0, list: [] };
      best.forEach(function (b) { if (b.v > pick.v) pick = b; });
      const next = [];
      pick.list.forEach(function (g) {
        if (count() >= budget) return;
        // 前に置いた人で状況が変わったので、置く直前に確かめ直す
        g.id = nextId();
        if (sizeOK && !sizeOK(g.h)) return;
        if (figureOK(g, figs)) return;
        g.r = ras(g);
        const d = board.delta(g.r, 1) + (g.dMod || 0);
        if (d < 0) next.push(place(g));
      });
      row = next;
    }
    stats.scaffoldMs = Math.round(performance.now() - t0);
  }

  /* ----- 2. 局所の改善 ----- */
  function localError(fig) {
    const c = fig.pts.hip;
    return board.need(c[0], c[1], H0 * 0.8);
  }
  function tryRemove(fig) {
    if (dependents(fig.id).length) return false;
    const d = board.delta(fig.r, -1);
    if (d < -EPS5) { unplace(fig); stats.removed++; return true; }
    return false;
  }
  function tryLimbs(fig) {
    if (!freeLimbsOf(fig).length) return false;
    unplace(fig);
    const before = { pose: Object.assign({}, fig.pose), pts: fig.pts, r: fig.r };
    fig.d = board.delta(fig.r, 1);
    const d0 = fig.d;
    optimizeLimbs(fig);
    const ok = fig.d < d0 - EPS5 && !figureOK(fig, figs);
    if (!ok) { fig.pose = before.pose; fig.pts = before.pts; fig.r = before.r; }
    else stats.limbs++;
    figs[fig.id] = fig; board.add(fig.r); touched();
    // 自分に触れている人の接触が崩れていないか（手をつかまれている腕は動かしていないので通常は崩れない）
    return ok;
  }
  function tryMove(fig) {
    if (dependents(fig.id).length) return false;
    const d0 = board.delta(fig.r, -1);           // 取り除いたときの変化
    unplace(fig);
    const near = new Uint8Array(NPIX);
    const R = H0 * 1.6, cx = fig.pts.hip[0], cy = fig.pts.hip[1];
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(STAGE_H, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(STAGE_W, cx + R); x++) near[y * STAGE_W + x] = 1;
    const sites = allSites(near).filter(function (s) { return s.host !== fig.id; });
    const cands = prescreen(makeCandidates(sites, near, 6), fig.id, 24, function (h) { return Math.abs(h - fig.h) < 0.01; });
    let best = null;
    cands.forEach(function (c) {
      if (Math.abs(c.h - fig.h) > 0.01) return;                 // 同じ人（同じ身長）の置き直し
      const g = evaluate(c, fig.id);
      if (g && (!best || g.d < best.d)) best = g;
    });
    if (best) optimizeLimbs(best);
    // 置き直しの得：（取り除く）＋（新しく置く） が 0 より十分小さければ採用
    if (best && d0 + best.d < -EPS) { best.seed = fig.seed; place(best); stats.moved++; return true; }
    figs[fig.id] = fig; board.add(fig.r); touched();
    return false;
  }
  // 2〜4人の小さな組（ある人と、その人だけに支えられている人たち）を外して、その周りに組み直す
  function subtree(id) {
    const out = [id];
    for (let i = 0; i < out.length; i++) dependents(out[i]).forEach(function (d) { if (out.indexOf(d) < 0) out.push(d); });
    return out;
  }
  // 全員の今の状態を覚え、あとで丸ごと戻せるようにする（手をつながれて腕が変わった人も戻る）
  function snapshot() { return figs.map(function (f) { return f ? { f: f, c: f.contacts } : null; }); }
  function restore(snap) {
    const n = Math.max(snap.length, figs.length);
    for (let i = 0; i < n; i++) {
      const cur = figs[i] || null, old = snap[i] ? snap[i].f : null;
      if (cur !== old) { if (cur) board.remove(cur.r); if (old) board.add(old.r); figs[i] = old; }
      if (old) old.contacts = snap[i].c;
    }
    touched();
  }
  function tryGroup(fig, sizeOK) {
    const ids = subtree(fig.id);
    if (ids.length < 2 || ids.length > 4) return false;
    const snap = snapshot();
    const saved = ids.map(function (i) { return figs[i]; });
    let dRemove = 0;
    // 上の人から外す
    for (let k = saved.length - 1; k >= 0; k--) { dRemove += board.delta(saved[k].r, -1); unplace(saved[k]); }
    const near = new Uint8Array(NPIX);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    saved.forEach(function (g) { for (const k in g.pts) { x0 = Math.min(x0, g.pts[k][0]); x1 = Math.max(x1, g.pts[k][0]); y0 = Math.min(y0, g.pts[k][1]); y1 = Math.max(y1, g.pts[k][1]); } });
    const m = H0 * 0.8;
    for (let y = Math.max(0, Math.floor(y0 - m)); y < Math.min(STAGE_H, y1 + m); y++) for (let x = Math.max(0, Math.floor(x0 - m)); x < Math.min(STAGE_W, x1 + m); x++) near[y * STAGE_W + x] = 1;
    const added = [];
    let dAdd = 0;
    for (let k = 0; k < ids.length + 1; k++) { const g = growOne(near, 8, sizeOK); if (!g) break; added.push(g); dAdd += g.d; }
    const gain = -(dRemove + dAdd);              // 外した変化＋置き直した変化（どちらも人数の項を含む）
    if (gain > EPS) { stats.groups++; return true; }
    restore(snap);                                // 元に戻す
    return false;
  }
  function improve(timeLimit, region, sizeOK, maxRounds) {
    const t0 = performance.now();
    let rounds = 0;
    while (performance.now() - t0 < timeLimit && rounds < (maxRounds || Infinity)) {
      const list = figs.filter(function (f) { return f && (!region || inRegion(region, f.pts.hip[0], f.pts.hip[1])); });
      if (!list.length) break;
      list.sort(function (a, b) { return localError(b) - localError(a); });
      let any = false;
      for (const fig of list) {
        if (performance.now() - t0 > timeLimit) break;
        if (figs[fig.id] !== fig) continue;            // 置き直されて別の人になった枠は飛ばす
        if (tryRemove(fig)) { any = true; continue; }
        if (tryLimbs(fig)) any = true;
        if (figs[fig.id] === fig && rand() < 0.5 && tryMove(fig)) any = true;
        if (figs[fig.id] === fig && rand() < 0.25 && tryGroup(fig, sizeOK)) any = true;
      }
      if (grow(6, region, sizeOK, Math.min(200, timeLimit))) any = true;
      rounds++;
      if (!any) break;
    }
    return rounds;
  }

  /* ----- 欠けた輪郭の修復（数人をまとめて置く） -----
     線が届いていない輪郭をかたまりごとに調べ、その近くの足場から「かたまりへ近づく」人を1人ずつ置いていく（最大 8 人）。
     途中の1人は点数が少し悪くなってもよい。最後に全体でよくなっていて、かたまりの半分以上に線が届いたら採用、だめなら全部元に戻す。 */
  function gapComponents() {
    const un = board.uncovered();
    const seen = new Uint8Array(NPIX), mark = new Uint8Array(NPIX);
    for (const i of un) mark[i] = 1;
    const comps = [];
    for (const s0 of un) {
      if (seen[s0]) continue;
      const q = [s0]; seen[s0] = 1;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % STAGE_W, y = (i - x) / STAGE_W;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= STAGE_W || yy >= STAGE_H) continue;
          const j = yy * STAGE_W + xx;
          // 長い欠けを一度に直そうとせず、身長1.5人分の区画に分けて進める。
          const span = H0 * 1.5;
          if (Math.floor(xx / span) !== Math.floor((s0 % STAGE_W) / span) || Math.floor(yy / span) !== Math.floor(Math.floor(s0 / STAGE_W) / span)) continue;
          if (mark[j] && !seen[j]) { seen[j] = 1; q.push(j); }
        }
      }
      let w = 0, cx = 0, cy = 0;
      for (const i of q) { w += board.bw[i]; cx += i % STAGE_W; cy += Math.floor(i / STAGE_W); }
      comps.push({ px: q, w: w, c: [cx / q.length, cy / q.length] });
    }
    return comps.filter(function (c) { return c.px.length >= 6; }).sort(function (a, b) { return b.w - a.w; });
  }
  function coveredFrac(comp) { let n = 0; for (const i of comp.px) if (board.nearCnt[i]) n++; return n / comp.px.length; }
  // 人の線のどこかが、点 G にどれだけ近いか
  function figDist(f, G) {
    let m = Infinity;
    for (const sg of FIG_SEGS) {
      const cl = closestOnSeg(G, f.pts[sg[0]], f.pts[sg[1]]);
      m = Math.min(m, Math.hypot(cl.q[0] - G[0], cl.q[1] - G[1]));
    }
    return Math.min(m, Math.hypot(f.pts.head[0] - G[0], f.pts.head[1] - G[1]) - BONE.head * f.h);
  }
  const triedGaps = new Set();
  function repairGaps(timeLimit, region, sizeOK, maxComps) {
    const t0 = performance.now();
    let fixed = 0, done = 0;
    const comps = gapComponents().filter(function (c) {
      return (!region || inRegion(region, c.c[0], c.c[1])) && !triedGaps.has(Math.round(c.c[0] / 8) + ':' + Math.round(c.c[1] / 8));
    });
    if (!comps.length) return -1;                       // もう試すかたまりがない
    for (const comp of comps.slice(0, 40)) {
      if (performance.now() - t0 > timeLimit || done >= (maxComps || Infinity)) break;
      done++;
      triedGaps.add(Math.round(comp.c[0] / 8) + ':' + Math.round(comp.c[1] / 8));
      // ゴール：かたまりの中で、いちばん近い既存の人から遠い点（先端）
      let G = null, gd = -1;
      for (let k = 0; k < comp.px.length; k += Math.max(1, Math.floor(comp.px.length / 30))) {
        const i = comp.px[k], P = [i % STAGE_W + 0.5, Math.floor(i / STAGE_W) + 0.5];
        const d = board.dIn[i] === 0 ? board.dOut[i] : 0;
        let near = Infinity;
        figs.forEach(function (f) { if (f) near = Math.min(near, Math.abs(f.pts.hip[0] - P[0]) + Math.abs(f.pts.hip[1] - P[1])); });
        if (near + d > gd) { gd = near + d; G = P; }
      }
      if (!G) continue;
      const before = coveredFrac(comp);
      const snap = snapshot();
      let total = 0, n = 0, best = Infinity;
      for (let depth = 0; depth < 8; depth++) {
        if (count() >= budget || performance.now() - t0 > timeLimit) break;
        const all = allSites(null);
        // ゴールに近い足場 12 個から候補を作る
        const near = all.slice().sort(function (a, b) { return Math.hypot(a.pt[0] - G[0], a.pt[1] - G[1]) - Math.hypot(b.pt[0] - G[0], b.pt[1] - G[1]); }).slice(0, 12);
        const id = nextId();
        // 候補は、まず「ゴールへの近さ」だけで絞り（塗らずに計算できる）、近い 20 個だけ塗って採点する
        const cands = makeCandidates(all, null, 12, near).filter(function (c) { return !sizeOK || sizeOK(c.h); }).map(function (c) {
          const f0 = build({ id: id, h: c.h, f: c.f, tpl: c.tpl, v: c.v, pose: c.res.pose, hx: c.res.hx, hy: c.res.hy, contacts: c.res.contacts });
          return { c: c, g: quickReject(f0) ? Infinity : figDist(f0, G) };
        }).filter(function (o) { return o.g < Infinity && (o.g < best - H0 * 0.15 || o.g <= board.tau); })
          .sort(function (a, b) { return a.g - b.g; }).slice(0, 20).map(function (o) { return o.c; });
        let pick = null, pk = Infinity;
        cands.forEach(function (c) {
          const f = evaluate(c, id);
          if (!f) return;
          const gdist = figDist(f, G);
          if (gdist > best - H0 * 0.15 && gdist > board.tau) return;         // ゴールへ近づかない人は使わない
          const key = Math.round(gdist / (H0 * 0.25)) * 1e6 + f.d * 1e3;       // まず近さ、同じくらいなら点数
          if (key < pk) { pk = key; pick = f; }
        });
        if (!pick) break;
        optimizeLimbs(pick);
        const gd2 = figDist(pick, G);
        total += pick.d; n++;
        place(pick);
        best = Math.min(best, gd2);
        if (gd2 <= board.tau * 1.5 || coveredFrac(comp) > 0.7) break;
      }
      const after = coveredFrac(comp);
      const tol = board.weights.count / budget * 1.5;
      if (n && after >= Math.max(0.5, before + 0.3) && total < tol) { fixed++; stats.repairs = (stats.repairs || 0) + 1; }
      else if (n) restore(snap);
    }
    return fixed;
  }

  /* ----- 支える人が、上の人の足首をつかむ（見た目。点数が大きく悪くならない時だけ） ----- */
  function addHolds(region) {
    figs.forEach(function (fig) {
      if (!fig || (region && !inRegion(region, fig.pts.hip[0], fig.pts.hip[1]))) return;
      const deps = dependents(fig.id).map(function (i) { return figs[i]; }).filter(function (o) { return o && o.contacts.some(function (c) { return c.host === fig.id && (c.limb === 'ftF' || c.limb === 'ftB'); }); });
      if (!deps.length) return;
      ['F', 'B'].forEach(function (side) {
        const limbs = freeLimbsOf(fig);
        if (limbs.indexOf(side + '_arm') < 0) return;
        for (const o of deps) for (const ft of ['ftF', 'ftB']) {
          const P = o.pts[ft];
          if (!armReach(fig.pts.sh, P, fig.h)) continue;
          if (fig.contacts.some(function (c) { return c.kind === 'hold' && c.host === o.id && c.part === ft; })) continue;
          unplace(fig);
          const keep = { pose: Object.assign({}, fig.pose), pts: fig.pts, r: fig.r };
          const d0 = board.delta(fig.r, 1);
          armTo(fig.pose, fig.pts.sh, P, fig.h, fig.f, side);
          fig.pts = solve(fig.pose, fig.hx, fig.hy, fig.h, fig.f);
          fig.contacts.push({ limb: 'ha' + side, host: o.id, part: ft, kind: 'hold' });
          let ok = jointsOK(fig.pose) && !figureOK(fig, figs);
          if (ok) { fig.r = ras(fig); ok = board.delta(fig.r, 1) - d0 < board.weights.count / budget * 0.6; }
          if (!ok) { fig.pose = keep.pose; fig.pts = keep.pts; fig.r = keep.r; fig.contacts.pop(); }
          figs[fig.id] = fig; board.add(fig.r); touched();
          if (ok) return;
        }
      });
    });
  }

  /* ----- 確認 ----- */
  function verifyAll() { return verify(); }
  function verify() {
    const bad = [];
    figs.forEach(function (f) { if (f) { const e = figureOK(f, figs); if (e) bad.push(f.id + ':' + e); } });
    const floating = ungrounded(figs);
    let maxErr = 0;
    figs.forEach(function (f) { if (f) f.contacts.forEach(function (c) { maxErr = Math.max(maxErr, contactError(c, f, figs)); }); });
    const deep = figs.filter(Boolean).map(function (f) { return overhang(f, figs); });
    return { violations: bad, floating: floating, maxContactError: maxErr, maxOverhang: Math.max.apply(null, deep.concat([0])) };
  }

  return {
    H0: H0, sizes: sizes, board: board, figs: figs, stats: stats, budget: budget,
    grow: grow, improve: improve, scaffold: scaffold, repairGaps: repairGaps, gapComponents: gapComponents, addHolds: addHolds, verify: verify, count: count,
    place: place, unplace: unplace, inRegion: inRegion,
    // 自由な腕だけを形に合わせ直す（部分的な組み直しで、腕だけが変わった所にかかった人）
    retuneLimbs: function (id) { const f = figs[id]; return f ? tryLimbs(f) : false; },
    sizeCount: function (h) { let n = 0; figs.forEach(function (f) { if (f && Math.abs(f.h - h) < 0.01) n++; }); return n; }, dependents: dependents, subtree: subtree, allSites: allSites,
    // 一度に全部：置き足す → 改善 → 足首をつかむ
    solveAll: function (timeLimit) {
      const t0 = performance.now();
      if (opt.scaffold !== false) scaffold();
      grow(budget, null, null, timeLimit * 0.55);
      improve(Math.max(50, (timeLimit - (performance.now() - t0)) * 0.5));
      repairGaps(Math.max(50, timeLimit - (performance.now() - t0) - 50));
      addHolds();
      return performance.now() - t0;
    }
  };
}
