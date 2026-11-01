// 舞台の進行：カメラの形を安定させる → 変わった所だけ組み直す（sculpt.js） → だれがどこへ行くか決める → 走る・跳ぶで移動 → 描く
// 人数・身長は最初に決めた「顔ぶれ」（プール）で固定。出番のない人は舞台の左右の端に座って待つ。
// made with Claude Opus 5.5
'use strict';

const STAGE_OPT = {
  H0: 48,                 // 基準の身長（舞台の座標）
  emaA: 0.5,              // 切り抜きの確率の時間方向のならし（1コマごとの新しい値の重み）
  onTh: 0.6, offTh: 0.4,  // ヒステリシス：人になるのは 0.6 を超えたとき、消えるのは 0.4 を下回ったとき
  minBlob: 96,            // これより小さい切れ端（細かい形の画素数）は捨てる
  changeFrac: 0.02,       // 今の配置の形との違いが、人の形の面積の 2% を超えたら「変わった」
  stillFrac: 0.006,       // 1コマ前との違いがこれ以下なら「止まっている」
  stillTime: 0.35,        // 止まっている時間がこれだけ続いたら組み直す（秒）
  growSlice: 14,          // 組み直しの計算を1コマで使う時間（ミリ秒）。描画を止めないように小分けにする
  firstBudget: 14000,     // 土台・置き足しの時間。仕上げを含めて約20秒以内を目安にする
  updateBudget: 5000,     // 部分的な組み直しの計算時間の上限（ミリ秒）
  runRate: 2.0,           // 走る動きの再生速度（誇張）
  hopTime: 0.3,          // 1回の跳び移り（かがむ＋空中＋着地）の時間（秒）
  settleTime: 0.18 / Math.sqrt(RES),       // 着地から持ち場の姿勢になるまで（秒）
  adjustTime: 0.4,        // 腕だけ動かす時間（秒）
  pool: [24, 40, 58],     // 顔ぶれ：小・中・大。RES=3 では1098人、撮り直しても人数と身長は変えない
  minArea: 6000           // 人の形とみなす最小の大きさ（細かい形の画素数。画面の約4%）
};

/* ===== 1. 入力の形を安定させる ===== */
function makeMaskFilter(firstTh) {
  const W = MASK_W, H = MASK_H, N = W * H, ema = new Float32Array(N), bin = new Uint8Array(N), lab = new Int32Array(N), q = new Int32Array(N);
  let first = true;
  return function (prob) {
    const a = first ? 1 : STAGE_OPT.emaA;
    first = false;
    for (let i = 0; i < N; i++) {
      ema[i] = ema[i] * (1 - a) + prob[i] * a;
      bin[i] = bin[i] ? (ema[i] > STAGE_OPT.offTh ? 1 : 0) : (ema[i] > (a === 1 && firstTh ? firstTh : STAGE_OPT.onTh) ? 1 : 0);
    }
    // 小さな切れ端を消す（脇や脚の間などの「穴」は埋めない）
    lab.fill(0);
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (!bin[s] || lab[s]) continue;
      id++;
      let h = 0, t = 0; q[t++] = s; lab[s] = id;
      while (h < t) {
        const i = q[h++], x = i % W, y = (i - x) / W;
        if (x > 0 && bin[i - 1] && !lab[i - 1]) { lab[i - 1] = id; q[t++] = i - 1; }
        if (x < W - 1 && bin[i + 1] && !lab[i + 1]) { lab[i + 1] = id; q[t++] = i + 1; }
        if (y > 0 && bin[i - W] && !lab[i - W]) { lab[i - W] = id; q[t++] = i - W; }
        if (y < H - 1 && bin[i + W] && !lab[i + W]) { lab[i + W] = id; q[t++] = i + W; }
      }
      if (t < STAGE_OPT.minBlob) for (let k = 0; k < t; k++) bin[q[k]] = 0;
    }
    return Float32Array.from(bin);
  };
}
function maskArea(m) { let n = 0; for (let i = 0; i < m.length; i++) n += m[i] > 0.5 ? 1 : 0; return n; }
function maskXor(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if ((a[i] > 0.5) !== (b[i] > 0.5)) n++; return n; }
// 形の「本当の変化」：相手の形から r 画素より離れた所の違いだけを数える（全体が1〜2画素ずれただけの揺れは数えない）
function maskChange(a, b, r) {
  const W = MASK_W, H = MASK_H, ia = new Uint8Array(W * H), ib = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { ia[i] = a[i] > 0.5 ? 1 : 0; ib[i] = b[i] > 0.5 ? 1 : 0; }
  const da = distanceTo(ia, W, H), db = distanceTo(ib, W, H);
  let n = 0;
  const diff = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if ((ia[i] && db[i] > r) || (ib[i] && da[i] > r)) { n++; diff[i] = 1; }
  return { n: n, diff: diff };
}

/* ===== 2. 動きの部品（実際の人の動きのデータ・誇張3倍） ===== */
const RUN_CYCLE = MOCAP.run.frames.length / MOCAP.run.fps;
const RUN_DX = MOCAP.run.frames[MOCAP.run.frames.length - 1][11] - MOCAP.run.frames[0][11];   // 1周期で進む距離（身長比）
function lowestOffset(p, h, f) {
  const s = solve(p, 0, 0, h, f);
  return Math.max(s.ftB[1], s.ftF[1], s.knB[1], s.knF[1], s.haB[1], s.haF[1], s.head[1] + BONE.head * h);
}
// 床の上の x に、いちばん低い所が床に着くように立たせる
function onFloor(p, x, h, f) { return { pose: p, hx: x, hy: FLOOR_Y - lineW(h) / 2 - lowestOffset(p, h, f) }; }
// 姿勢 p で、ref（'feet'＝両足の中点／'hands'＝両手の中点）が点 P に来る腰の位置
function hipAt(p, h, f, ref, P) {
  const s = solve(p, 0, 0, h, f);
  const a = ref === 'hands' ? [(s.haF[0] + s.haB[0]) / 2, (s.haF[1] + s.haB[1]) / 2] : [(s.ftF[0] + s.ftB[0]) / 2, (s.ftF[1] + s.ftB[1]) / 2];
  return [P[0] - a[0], P[1] - a[1]];
}
function figRef(fig) {
  // 持ち場に着くとき最初に触れる所：ぶら下がり・旗は手、それ以外は足（ひざ・お尻で触れる型は腰の下）
  if (fig.tpl === 'hang' || fig.tpl === 'flag') return 'hands';
  return 'feet';
}

/* ===== 3. 舞台 ===== */
function makeStage() {
  const H0 = STAGE_OPT.H0;
  const filter = makeMaskFilter();
  const st = {
    pool: STAGE_OPT.pool.map(function (n) { return Math.round(n * RES * RES); }),   // 細かさに合わせて人数を増やす
    people: [], layout: null, job: null, busy: false, time: 0,
    lastMask: null, stillFor: 0, changed: false, log: [], metrics: null, violations: 0, frames: 0, airFrames: 0,
    status: 'カメラを待っています'
  };

  // 予備の人の待つ場所（左右の端の床に座る）
  // 待つ場所：床の下のベンチ。前の列から順に、左右から真ん中へ座る（後ろの列ほど少し高い）
  function reserveSpot(k) {
    const cols = Math.floor((STAGE_W - 30) / 16);
    const row = Math.floor(k / cols), j = k % cols;
    const col = j % 2 ? cols - 1 - Math.floor(j / 2) : Math.floor(j / 2);
    const rows = Math.ceil(st.pool.reduce(function (a, b) { return a + b; }, 0) / cols);
    const pitch = Math.min(15, Math.max(1, (BENCH_H - 22) / Math.max(1, rows - 1)));
    return { x: 15 + col * 16 + (row % 2) * 8, y: BENCH_Y - row * pitch, f: col < cols / 2 ? 1 : -1 };
  }
  // 姿勢 p で、いちばん低い所が高さ y の面に着くように
  function onSpot(p, x, y, h, f) { return { pose: p, hx: x, hy: y - lineW(h) / 2 - lowestOffset(p, h, f) }; }
  function sitPose(h, f) { return pose({ t: 6, hd: 0, lF: 60, kF: 105, lB: 55, kB: 110, aF: 40, eF: 60, aB: 35, eB: 70 }); }

  /* --- 配置の計算（小分けにして、毎コマ少しずつ） --- */
  function startJob(mask, keep, region, budget) {
    const S = Sculptor(mask, { H0: H0, budget: st.pool.reduce(function (a, b) { return a + b; }, 0), seed: 11, initial: keep, scaffold: !keep, lookahead: keep ? 4 : 8 });   // 部分的な組み直しでは先読みの候補を減らして速くする
    let sizeOK = null;
    if (st.pool) sizeOK = function (h) {
      const k = SIZE_STEPS.findIndex(function (z) { return Math.abs(z * H0 - h) < 0.01; });
      return k >= 0 && S.sizeCount(h) < st.pool[k];
    };
    const job = { S: S, region: region, phase: keep ? 'grow' : 'scaffold', spent: 0, budget: budget, t0: performance.now(), steps: 0 };
    // 計算は時間（budget）と回数の両方で区切る（時計が進まない環境でも必ず終わるように）
    const maxSteps = keep ? 1500 : 3000;
    const improveMs = keep ? 400 : 1000;     // 置き足しが終わってからの改善の時間
    // 進み具合（0〜1）：置き足し 0〜70%（必要な人数の見積もりに対する割合）、改善 70〜80%、欠けの修復 80〜100%
    let area = 0; for (let i = 0; i < mask.length; i++) area += mask[i];
    const expected = Math.max(20, Math.min(S.budget || 1e9, area * 0.22 / (0.11 * H0 * H0)) - (keep ? keep.filter(Boolean).length : 0));
    const start = S.count();
    job.progress = function () {
      if (job.phase === 'scaffold' || job.phase === 'grow') return Math.min(0.7, 0.7 * (S.count() - start) / expected);
      if (job.phase === 'improve') return 0.7 + 0.1 * Math.min(1, (job.spent - job.growEnd) / improveMs);
      if (job.phase === 'repair') return 0.8 + 0.2 * Math.min(1, (job.spent - job.repairStart) / (keep ? 2500 : 5000));
      return 1;
    };
    job.step = function (ms) {
      const t0 = performance.now();
      job.steps++;
      if (job.phase === 'scaffold') { S.scaffold(30, sizeOK); job.phase = 'grow'; }
      else if (job.phase === 'grow') {
        const n = S.grow(3, region, sizeOK, ms);
        if ((n === 0 && !S.stats.growPending) || job.spent > budget || job.steps > maxSteps) { job.phase = 'improve'; job.growEnd = job.spent; job.growSteps = job.steps; }
      } else if (job.phase === 'improve') {
        S.improve(ms, region, sizeOK, 1);
        if (job.spent - job.growEnd > improveMs || job.steps - job.growSteps > 30) { job.phase = 'repair'; job.repairStart = job.spent; }
      } else if (job.phase === 'repair') {
        // 欠けた輪郭を、数人まとめて置いて直す（1コマに1かたまり）
        const r = S.repairGaps(ms * 4, region, sizeOK, 1);
        if (r < 0 || job.spent - job.repairStart > (keep ? 2500 : 5000)) job.phase = 'holds';
      } else if (job.phase === 'holds') {
        (job.retune || []).forEach(function (id) { S.retuneLimbs(id); });
        S.addHolds(region); job.phase = 'done';
      }
      job.spent += performance.now() - t0;
      if (!keep && job.phase !== 'done') st.status = '組体操を組み立て中…（' + S.count() + '人）';
      return job.phase === 'done';
    };
    return job;
  }

  /* --- 最初の配置：顔ぶれを決めて、全員を持ち場に置いた状態から始める --- */
  // 顔ぶれを作り、全員をベンチに座らせる（最初から見えるように）
  function initPeople() {
    let pid = 0;
    st.pool.forEach(function (n, si) {
      for (let i = 0; i < n; i++) {
        const h = SIZE_STEPS[si] * H0;
        const p = { pid: pid++, h: h, f: 1, pose: pose({}), hx: 0, hy: 0, seed: Math.floor(Math.random() * 1000), fig: null, plan: [], state: 'idle', placed: true, onOld: false, at: null };
        st.people.push(p);
        goReserveNow(p);
      }
    });
    st.byPid = {}; st.people.forEach(function (p) { st.byPid[p.pid] = p; });
  }
  function pidMap(figs) { const m = {}; st.people.forEach(function (p) { if (p.fig !== null) m[p.fig] = p.pid; }); return m; }
  function goReserveNow(p) {
    const r = freeReserve();
    p.reserve = r; p.fig = null; p.f = r.f;
    const o = onSpot(sitPose(p.h, r.f), r.x, r.y, p.h, r.f);
    p.pose = o.pose; p.hx = o.hx; p.hy = o.hy;
  }
  function freeReserve() {
    // 空いている待ち場所の番号
    const used = new Set();
    st.people.forEach(function (p) { if (p.reserve) used.add(p.reserve.k); if (p.reserveNext) used.add(p.reserveNext.k); });
    let k = 0; while (used.has(k)) k++;
    const r = reserveSpot(k); r.k = k; return r;
  }

  /* --- 部分的な組み直し：変わった所と、そこに支えられている人を外す --- */
  function startUpdate(seg) {
    const mask = stageMask(seg);
    const old = st.layout;
    // 変わった所（舞台の座標）を、基準の身長の半分だけ広げる
    const ch = maskChange(seg, old.seg, 4);
    const diff = stageMask(ch.diff);
    let any = 0;
    for (let i = 0; i < NPIX; i++) any += diff[i];
    if (!any) return;
    const dd = distanceTo(diff, STAGE_W, STAGE_H);
    const region = new Uint8Array(NPIX);
    for (let i = 0; i < NPIX; i++) region[i] = dd[i] <= H0 * 0.5 ? 1 : 0;
    // 置き足しに使える足場は、もう少し広く（変わった所のすぐ外にいる人の手や肩から伸ばせるように）
    const siteRegion = new Uint8Array(NPIX);
    for (let i = 0; i < NPIX; i++) siteRegion[i] = dd[i] <= H0 * 1.4 ? 1 : 0;
    // 外す人：体の線が変わった所にかかる人 ＋ その人に（たどって）支えられている人
    // 体（頭・胴・脚・使っている腕）がかかる人は外す。自由な腕だけがかかる人は残して、腕だけ合わせ直す
    const out = new Set(), retune = [];
    const hostedArm = {};
    old.figs.forEach(function (f) { if (f) f.contacts.forEach(function (c) { if (c.host >= 0 && (c.part === 'haF' || c.part === 'haB')) hostedArm[c.host + c.part] = true; }); });
    old.figs.forEach(function (f) {
      if (!f) return;
      const usedArm = function (sd) { return f.contacts.some(function (c) { return c.limb === 'ha' + sd && c.kind !== 'hold'; }) || hostedArm[f.id + 'ha' + sd]; };
      const core = Object.assign({}, f.pts);
      ['F', 'B'].forEach(function (sd) { if (!usedArm(sd)) { core['el' + sd] = f.pts.sh; core['ha' + sd] = f.pts.sh; } });
      const r = rasterFigure(core, f.h, 0);
      let hit = false;
      for (let j = 0; j < r.body.length; j++) if (region[r.body[j]]) { hit = true; break; }
      if (hit) { out.add(f.id); return; }
      const ra = rasterFigure(f.pts, f.h, 0);
      for (let j = 0; j < ra.body.length; j++) if (region[ra.body[j]]) { retune.push(f.id); break; }
    });
    let grew = true;
    while (grew) {
      grew = false;
      old.figs.forEach(function (f) { if (f && !out.has(f.id) && f.contacts.some(function (c) { return c.kind !== 'hold' && out.has(c.host); })) { out.add(f.id); grew = true; } });
    }
    // 残る人の「足首をつかむ」手は放す（つかまれる人がいなくなるかもしれないので）
    const keep = old.figs.map(function (f) {
      if (!f || out.has(f.id)) return null;
      return Object.assign({}, f, { contacts: f.contacts.filter(function (c) { return !(c.kind === 'hold' && out.has(c.host)); }) });
    });
    // 外した人のいた所も組み直しの範囲に入れる
    old.figs.forEach(function (f) {
      if (!f || !out.has(f.id)) return;
      for (const k in f.pts) {
        const x = Math.round(f.pts[k][0]), y = Math.round(f.pts[k][1]), R = Math.round(H0 * 0.4);
        for (let yy = Math.max(0, y - R); yy < Math.min(STAGE_H, y + R); yy++) for (let xx = Math.max(0, x - R); xx < Math.min(STAGE_W, x + R); xx++) region[yy * STAGE_W + xx] = 1;
      }
    });
    for (let i = 0; i < NPIX; i++) if (region[i]) siteRegion[i] = 1;
    st.job = startJob(mask, keep, siteRegion, STAGE_OPT.updateBudget);
    st.job.removed = out;
    st.job.retune = retune.filter(function (id) { return !out.has(id); });
    st.pendingSeg = seg;
    st.status = '組み直しを計算中（' + out.size + '人が動きます）';
  }

  /* --- 組み直しの結果を、人の動きの計画にする --- */
  function commitUpdate(job) {
    const old = st.layout, nf = job.S.figs;
    const byPid = {}; st.people.forEach(function (p) { byPid[p.pid] = p; });
    const assign = {};            // 新しい持ち場の番号 → 人
    const moving = new Set();
    // 1) 前と同じ番号の持ち場はその人のまま（姿勢が変わっていれば動く）
    nf.forEach(function (f) {
      if (!f) return;
      const pid = old.pidOf[f.id];
      const of = old.figs[f.id];
      if (pid !== undefined && of && !job.removed.has(f.id) && f.seed === of.seed && Math.abs(f.h - of.h) < 0.01) assign[f.id] = byPid[pid];
    });
    // 2) 新しい持ち場：同じ大きさの、空いている人のうち近い人（外された人・待っている人）
    const freeP = st.people.filter(function (p) { return !Object.values(assign).includes(p); });
    const newIds = nf.filter(function (f) { return f && !assign[f.id]; }).map(function (f) { return f.id; });
    // 支えの低い順（床に近い人から）に割り当てる
    newIds.sort(function (a, b) { return nf[b].pts.hip[1] - nf[a].pts.hip[1]; });
    newIds.forEach(function (id) {
      const f = nf[id];
      let best = -1, bd = Infinity;
      freeP.forEach(function (p, i) {
        if (Math.abs(p.h - f.h) > 0.01) return;
        const d = Math.abs(p.hx - f.hx) + Math.abs(p.hy - f.hy) * 0.5;
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) return;      // （大きさの制限で起きないはず）
      assign[id] = freeP.splice(best, 1)[0];
    });
    // 3) 計画づくり
    const newPidOf = {};
    for (const id in assign) newPidOf[id] = assign[id].pid;
    const oldFigOf = {}; st.people.forEach(function (p) { if (p.fig !== null) oldFigOf[p.pid] = p.fig; });
    const oldDeps = {}, armDeps = {};   // 前の配置で、その人の上にいた人／その人の手をつかんでいた人
    old.figs.forEach(function (f) { if (f) f.contacts.forEach(function (c) { if (c.host >= 0 && c.kind !== 'hold') { const hp = old.pidOf[c.host], dp = old.pidOf[f.id]; (oldDeps[hp] = oldDeps[hp] || []).push(dp); if (c.part === 'haF' || c.part === 'haB') (armDeps[hp] = armDeps[hp] || []).push(dp); } }); });
    const newHosts = {};          // 新しい配置で、その人を支える人
    nf.forEach(function (f) { if (f && assign[f.id]) f.contacts.forEach(function (c) { if (c.host >= 0 && c.kind !== 'hold' && assign[c.host]) (newHosts[assign[f.id].pid] = newHosts[assign[f.id].pid] || []).push(assign[c.host].pid); }); });
    // その場で腕だけ動かせるのは、自分の支点も支える相手も変わらない人だけ。
    // 腰の位置が同じでも、足場を交換した人は一度離れる。支えが移る人も上へ順に外す。
    const staying = new Set();
    nf.forEach(function (f) {
      if (!f || !assign[f.id]) return;
      const p = assign[f.id], of = old.figs[f.id];
      if (!of || p.fig !== f.id || Math.abs(f.hx - p.hx) > 0.01 || Math.abs(f.hy - p.hy) > 0.01 || f.f !== p.f) return;
      if (!['t', 'hd', 'lF', 'kF', 'lB', 'kB', 'dx', 'dy', 'rot'].every(function (k) { return Math.abs(f.pose[k] - p.pose[k]) < 0.01; })) return;
      const supports = f.contacts.filter(function (c) { return c.kind !== 'hold'; });
      const before = of.contacts.filter(function (c) { return c.kind !== 'hold'; });
      if (supports.length !== before.length || !supports.every(function (c) {
        return before.some(function (b) { return c.limb === b.limb && c.host === b.host && c.part === b.part && c.kind === b.kind; }) &&
          (c.host < 0 || assign[c.host] && assign[c.host].pid === old.pidOf[c.host]) &&
          Math.hypot(f.pts[c.limb][0] - of.pts[c.limb][0], f.pts[c.limb][1] - of.pts[c.limb][1]) < 0.01;
      })) return;
      staying.add(p.pid);
    });
    let changed = true;
    while (changed) {
      changed = false;
      staying.forEach(function (pid) {
        if ((newHosts[pid] || []).some(function (h) { return !staying.has(h); })) { staying.delete(pid); changed = true; }
      });
    }
    st.people.forEach(function (p) {
      const oldId = oldFigOf[p.pid];
      p.oldFig = oldId !== undefined ? old.figs[oldId] : null;
      p.oldHostPid = old.pidOf;
      const newId = Object.keys(assign).find(function (id) { return assign[id] === p; });
      const tf = newId !== undefined ? nf[newId] : null;
      p.newFig = undefined;
      p.oldDeps = (oldDeps[p.pid] || []).filter(function (q) { return q !== undefined; });
      p.newHosts = newHosts[p.pid] || [];
      p.plan = [];
      if (tf && staying.has(p.pid)) {
        // 同じ場所：姿勢（腕）だけ違えば動かす
        const same = POSE_KEYS.every(function (k) { return Math.abs((tf.pose[k] || 0) - (p.pose[k] || 0)) < 0.5; });
        p.fig = tf.id; p.at = 'new';
        // 腕だけ変わる人は、その手をつかんでいた人が離れるのを待てばよい（肩の上の人は待たない）
        if (!same) { p.placed = false; p.onOld = false; p.oldDeps = (armDeps[p.pid] || []).filter(function (q) { return q !== undefined; }); p.plan.push({ type: 'waitDeps' }, { type: 'adjust', to: tf, dur: STAGE_OPT.adjustTime }); moving.add(p.pid); }
        else { p.placed = true; p.onOld = false; }
        return;
      }
      if (!tf && p.fig === null) { p.placed = true; p.onOld = false; p.at = null; return; }   // 待っている人のまま
      moving.add(p.pid);
      p.placed = false;
      p.onOld = p.fig !== null;
      p.at = p.fig !== null ? 'old' : null;
      // 先に古い支えを離れ、それから新しい支えを待つ。古い組の上で待つと待ち合わせが循環する。
      // 前の持ち場を離れる（上の人が先）
      p.plan.push({ type: 'waitDeps' });
      if (p.fig !== null) p.plan.push({ type: 'leave' });
      else p.plan.push({ type: 'standUp', dur: 0.25 }, { type: 'benchUp' });
      if (tf) {
        p.plan.push({ type: 'runTo', target: tf });
        p.plan.push({ type: 'climb', target: tf });      // 支える人を待つ前に、動かない人の肩を踏み台にして近くまで登っておく
        p.plan.push({ type: 'waitHosts' });
        p.plan.push({ type: 'mount', target: tf });
        p.newFig = tf.id;
      } else {
        const r = freeReserve();
        p.reserveNext = r;
        p.plan.push({ type: 'runToX', x: r.x, f: r.f });
        p.plan.push({ type: 'benchDown', spot: r });
        p.plan.push({ type: 'sit', spot: r, dur: 0.35 });
      }
    });
    st.oldLayout = old;
    st.layout = { figs: nf.slice(), mask: job.S.board.mask, seg: st.pendingSeg, pidOf: newPidOf };
    st.moving = moving;
    st.busy = moving.size > 0;
    st.metrics = { removed: job.removed.size, moved: moving.size, computeMs: Math.round(job.spent), people: st.people.length, commitAt: st.time, stillAt: st.stillAt, stopAt: st.stopAt, changeAt: st.changeAt };
    st.status = st.busy ? (moving.size + '人が移動中') : '組み直し完了';
  }

  /* --- 人の動き（毎コマ） --- */
  function personStep(p, dt) {
    let guard = 0;
    while (p.plan.length && guard++ < 8) {
      const s = p.plan[0];
      if (s.t === undefined) s.t = 0;
      const byPid = st.byPid;
      if (s.type === 'waitDeps') {
        // 前の配置で自分の上にいた人が、全員離れるまで待つ
        if (p.oldDeps.every(function (q) { return !byPid[q].onOld || byPid[q].pid === p.pid; })) { p.plan.shift(); continue; }
        s.t += dt;
        if (s.t > 60) { st.forced = (st.forced || 0) + 1; p.plan.shift(); continue; }   // 安全弁（起きたら検証で数える）
        return;
      }
      if (s.type === 'waitHosts') {
        // 支える人が持ち場で姿勢を整え終わる時刻が、自分が跳んで着く時刻より前なら跳び始めてよい（支えが先、の順は守る）
        if (s.myHop === undefined) {
          const tf = p.plan[1] && p.plan[1].target;
          const ps = solve(p.pose, p.hx, p.hy, p.h, p.f);
          const L = tf ? (figRef(tf) === 'hands' ? tf.pts.haF : tf.pts.ftF) : ps.ftF;
          s.myHop = tf && !tf.contacts.every(function (c) { return c.host === -1; }) ? STAGE_OPT.hopTime + 0.05 * Math.max(0, (Math.max(ps.ftF[1], ps.ftB[1]) - L[1]) / p.h / RES) : 0;
        }
        if (p.newHosts.every(function (q) { return byPid[q].placed || etaPlaced(byPid[q]) < s.myHop * 0.7; })) { p.plan.shift(); continue; }
        s.t += dt;
        if (s.t > 60) { st.forced = (st.forced || 0) + 1; p.plan.shift(); continue; }   // 安全弁（起きたら検証で数える）
        s.t += dt;
        p.state = 'wait';
        return;
      }
      if (s.type === 'adjust') {
        if (!s.from) s.from = Object.assign({}, p.pose);
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        p.pose = lerpPose(s.from, s.to.pose, ease(k));
        p.state = 'adjust';
        if (k >= 1) { p.pose = Object.assign({}, s.to.pose); p.hx = s.to.hx; p.hy = s.to.hy; p.plan.shift(); p.placed = true; p.onOld = false; p.fig = s.to.id; p.state = 'idle'; continue; }
        return;
      }
      if (s.type === 'leave') {
        // 床にいる人はそのまま走り出す。高い所の人は外へ飛び降りる
        p.onOld = false; p.at = null;
        const pts = solve(p.pose, p.hx, p.hy, p.h, p.f);
        const low = Math.max(pts.ftF[1], pts.ftB[1]);
        p.fig = null;
        if (low > FLOOR_Y - lineW(p.h) * 0.5 - 2) { p.plan.shift(); continue; }
        const cx = st.centerX || STAGE_W / 2, side = p.hx < cx ? -1 : 1;
        const A = [(pts.ftF[0] + pts.ftB[0]) / 2, low];
        // 次の持ち場も高い所なら、床まで降りずに、動かない人の肩へ跳び移って待つ
        const nextT = p.plan.find(function (x) { return x.type === 'runTo'; });
        if (nextT && !nextT.target.contacts.every(function (c) { return c.host === -1; })) {
          const tf = nextT.target, L = figRef(tf) === 'hands' ? tf.pts.haF : tf.pts.ftF;
          let best = null, bd = Infinity;
          st.people.forEach(function (o) {
            if (o === p || !o.placed || o.fig === null || st.moving.has(o.pid) || o.stoneBy !== undefined) return;
            const op = solve(o.pose, o.hx, o.hy, o.h, o.f);
            if (Math.abs(op.neck[0] - op.hip[0]) > Math.abs(op.neck[1] - op.hip[1])) return;
            const P = [op.sh[0], op.sh[1] - lineW(o.h) / 2 - lineW(p.h) / 2];
            if (Math.hypot(P[0] - A[0], P[1] - A[1]) > p.h * 3.0 * RES || P[1] < L[1] - p.h * 0.2) return;
            const d = Math.hypot(P[0] - L[0], P[1] - L[1]);
            if (d < bd) { bd = d; best = { P: P, o: o }; }
          });
          if (best && bd < Math.hypot(L[0] - A[0], L[1] - FLOOR_Y) + p.h) {
            p.plan.splice(0, 1, { type: 'hop', A: A, B: best.P, clip: 'highjump', dur: STAGE_OPT.hopTime, t: 0, ref: 'feet', f: Math.sign(best.P[0] - A[0]) || p.f, stone: best.o.pid });
            // 走る・登るは省く
            p.plan = p.plan.filter(function (x) { return x.type !== 'runTo' && x.type !== 'climb'; });
            p.plan.unshift(p.plan.shift());
            continue;
          }
        }
        const B = [A[0] + side * p.h * 0.55, FLOOR_Y - lineW(p.h) / 2];
        p.plan[0] = { type: 'hop', A: A, B: B, clip: 'jumpDown', dur: 0.32 + 0.1 * Math.sqrt(Math.max(0, B[1] - A[1]) / p.h), t: 0, f: side, ref: 'feet', land: true };
        continue;
      }
      if (s.type === 'leaveTo') {
        p.onOld = false; p.fig = null; p.at = null;
        const tf = s.target, ref = figRef(tf);
        p.plan.splice(0, 1, { type: 'hop', A: s.A, B: s.L, clip: 'highjump', dur: STAGE_OPT.hopTime + 0.04 * Math.hypot(s.L[0] - s.A[0], s.L[1] - s.A[1]) / p.h / RES, t: 0, ref: ref, f: Math.sign(s.L[0] - s.A[0]) || tf.f, final: true },
          { type: 'settle', to: tf, dur: STAGE_OPT.settleTime, t: 0 });
        continue;
      }
      if (s.type === 'benchUp' || s.type === 'benchDown') {
        // ベンチと床の間は、ぴょんと跳んで上り下りする
        const lw = lineW(p.h);
        const A = s.type === 'benchUp' ? [p.hx, (p.reserve ? p.reserve.y : BENCH_Y) - lw / 2] : [p.hx, FLOOR_Y - lw / 2];
        const B = s.type === 'benchUp' ? [p.hx + (Math.random() - 0.5) * p.h * 0.3, FLOOR_Y - lw / 2] : [s.spot.x, s.spot.y - lw / 2];
        p.plan[0] = { type: 'hop', A: A, B: B, clip: 'highjump', dur: STAGE_OPT.hopTime, t: 0, ref: 'feet', f: p.f };
        if (s.type === 'benchUp') p.reserve = null;
        continue;
      }
      if (s.type === 'standUp') {
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        const o = onSpot(lerpPose(sitPose(p.h, p.f), mocapPose('balance', 0.5), ease(k)), p.hx, p.reserve ? p.reserve.y : FLOOR_Y, p.h, p.f);
        p.pose = o.pose; p.hy = o.hy; p.state = 'ground';
        if (k >= 1) { p.plan.shift(); continue; }
        return;
      }
      if (s.type === 'runTo' || s.type === 'runToX') {
        // 持ち場の真下近く（床）まで走る。距離が短ければ歩く
        if (s.x === undefined) {
          // 床に触れる持ち場はその真下へ。高い持ち場は、着く点の少し手前（来た側）へ
          const tf = s.target;
          if (tf.contacts.some(function (c) { return c.host === -1; })) s.x = tf.hx;
          else {
            const base = figRef(tf) === 'hands' ? (tf.pts.haF[0] + tf.pts.haB[0]) / 2 : (tf.pts.ftF[0] + tf.pts.ftB[0]) / 2;
            s.x = base + (p.hx < base ? -1 : 1) * p.h * 0.32;
          }
        }
        const dx = s.x - p.hx;
        if (Math.abs(dx) < 1) { p.plan.shift(); continue; }
        const dir = Math.sign(dx);
        const walk = Math.abs(dx) < p.h * 0.8;
        const clip = walk ? 'walk' : 'run';
        const rate = walk ? 1.2 : STAGE_OPT.runRate * (s.type === 'runToX' ? 1.3 : 1);
        const C = MOCAP[clip], cyc = C.frames.length / C.fps, cdx = C.frames[C.frames.length - 1][11] - C.frames[0][11];
        // 足がすべらない速さ（データの1周期で進む距離から）。細かくした舞台では人が画面上で小さいので、そのぶん動きを速く再生する
        const speed = cdx * p.h / cyc * rate * RES;
        p.clipT = (p.clipT || 0) + dt * rate * RES;
        const step = Math.min(Math.abs(dx), speed * dt);
        p.hx += dir * step; p.f = dir;
        const o = onFloor(mocapPose(clip, p.clipT), p.hx, p.h, p.f);
        p.pose = o.pose; p.hy = o.hy; p.state = 'ground';
        if (Math.abs(s.x - p.hx) < 0.5) { p.hx = s.x; p.plan.shift(); continue; }
        return;
      }
      if (s.type === 'climb' || s.type === 'mount') {
        const tf = s.target;
        const allFloor = tf.contacts.every(function (c) { return c.host === -1; });
        if (allFloor) {
          if (s.type === 'climb') { p.plan.shift(); continue; }
          p.plan[0] = { type: 'settle', to: tf, dur: STAGE_OPT.settleTime, t: 0 };
          continue;
        }
        const ref = figRef(tf);
        const L = ref === 'hands' ? [(tf.pts.haF[0] + tf.pts.haB[0]) / 2, (tf.pts.haF[1] + tf.pts.haB[1]) / 2 + p.h * 0.25] : [(tf.pts.ftF[0] + tf.pts.ftB[0]) / 2, Math.max(tf.pts.ftF[1], tf.pts.ftB[1])];
        const ps = solve(p.pose, p.hx, p.hy, p.h, p.f);
        const start = [(ps.ftF[0] + ps.ftB[0]) / 2, Math.max(ps.ftF[1], ps.ftB[1])];
        const hops = [];
        if (s.type === 'climb') {
          // 最後の跳び上がりが身長の1.6倍以下になるまで、動かない人の肩を踏み台に登る（1回に2.2倍まで）
          let cur = start, guard2 = 0;
          while (cur[1] - L[1] > p.h * 2.0 * RES && guard2++ < 8) {
            const wantY = Math.max(L[1] + p.h * 0.9, cur[1] - p.h * 3.0 * RES);
            const k = (start[1] - wantY) / Math.max(1, start[1] - L[1]);
            const want = [start[0] + (L[0] - start[0]) * k, wantY];
            let best = null, bd = p.h * 0.9 * RES;
            st.people.forEach(function (o) {
              if (o === p || !o.placed || o.fig === null || st.moving.has(o.pid) || o.stoneBy !== undefined) return;
              const op = solve(o.pose, o.hx, o.hy, o.h, o.f);
              if (Math.abs(op.neck[0] - op.hip[0]) > Math.abs(op.neck[1] - op.hip[1])) return;
              const P = [op.sh[0], op.sh[1] - lineW(o.h) / 2 - lineW(p.h) / 2];
              if (P[1] >= cur[1] - p.h * 0.3 || cur[1] - P[1] > p.h * 3.1 * RES) return;
              const d = Math.hypot(P[0] - want[0], (P[1] - want[1]) * 0.6);
              if (d < bd) { bd = d; best = { P: P, o: o }; }
            });
            if (!best) break;
            hops.push({ type: 'hop', A: cur, B: best.P, clip: 'highjump', dur: STAGE_OPT.hopTime + 0.05 * Math.max(0, (cur[1] - best.P[1]) / p.h / RES), t: 0, ref: 'feet', f: Math.sign(best.P[0] - cur[0]) || p.f, stone: best.o.pid });
            cur = best.P;
          }
        } else {
          const last = ref === 'hands' ? [L[0], L[1] - p.h * 0.25] : L;
          hops.push({ type: 'hop', A: start, B: last, clip: 'highjump', dur: STAGE_OPT.hopTime + 0.05 * Math.max(0, (start[1] - last[1]) / p.h / RES), t: 0, ref: ref, f: tf.f, final: true });
          hops.push({ type: 'settle', to: tf, dur: STAGE_OPT.settleTime, t: 0 });
        }
        p.plan.splice.apply(p.plan, [0, 1].concat(hops));
        continue;
      }
      if (s.type === 'hop') {
        // かがむ（20%）→ 空中（65%）→ 着地（15%）。空中の間だけ、どこにも触れていなくてよい
        if (s.t === 0 && p.onStone !== undefined) { byPid[p.onStone].stoneBy = undefined; p.onStone = undefined; }
        s.t += dt;
        const u = Math.min(1, s.t / s.dur);
        const C = s.clip === 'jumpDown' ? { c0: 0.15, c1: 0.25, a0: 0.3, a1: 0.68, l1: 0.85 } : { c0: 0.3, c1: 0.55, a0: 0.62, a1: 1.38, l1: 1.55 };
        let pz, ref, P;
        const H = Math.abs(s.A[1] - s.B[1]) / 2 + p.h * (s.clip === 'jumpDown' ? 0.12 : 0.3);
        if (u < 0.2) { pz = mocapPose(s.clip, C.c0 + (C.c1 - C.c0) * u / 0.2); P = s.A; p.state = 'ground'; }
        else if (u < 0.85) {
          const v = (u - 0.2) / 0.65;
          pz = mocapPose(s.clip, C.a0 + (C.a1 - C.a0) * v);
          P = [s.A[0] + (s.B[0] - s.A[0]) * v, s.A[1] + (s.B[1] - s.A[1]) * v - 4 * H * v * (1 - v)];
          p.state = 'air'; st.airFrames++;
        } else { pz = mocapPose(s.clip, C.a1 + (C.l1 - C.a1) * (u - 0.85) / 0.15); P = s.B; p.state = 'ground'; }
        if (s.ref === 'hands') pz = withArms(pz, { aF: 178, eF: 0, aB: 182, eB: 0 }, u < 0.2 ? u / 0.2 : 1);
        p.f = s.f;
        const hp = hipAt(pz, p.h, p.f, s.ref, P);
        p.pose = pz; p.hx = hp[0]; p.hy = hp[1];
        if (u >= 1) { if (s.stone !== undefined) { byPid[s.stone].stoneBy = p.pid; p.onStone = s.stone; } p.plan.shift(); continue; }
        return;
      }
      if (s.type === 'settle') {
        if (!s.from) s.from = { pose: Object.assign({}, p.pose), hx: p.hx, hy: p.hy, f: p.f };
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        const tf = s.to;
        if (s.from.f !== tf.f && k > 0.5) p.f = tf.f;
        p.pose = lerpPose(s.from.pose, tf.pose, ease(k));
        p.hx = s.from.hx + (tf.hx - s.from.hx) * ease(k);
        p.hy = s.from.hy + (tf.hy - s.from.hy) * ease(k);
        p.state = 'settle';
        if (k >= 1) {
          p.pose = Object.assign({}, tf.pose); p.hx = tf.hx; p.hy = tf.hy; p.f = tf.f; p.fig = tf.id; p.at = 'new';
          p.placed = true; p.state = 'idle'; p.plan.shift(); continue;
        }
        return;
      }
      if (s.type === 'sit') {
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        p.f = s.spot.f;
        const o = onSpot(lerpPose(mocapPose('balance', 0.5), sitPose(p.h, p.f), ease(k)), p.hx, s.spot.y, p.h, p.f);
        p.pose = o.pose; p.hy = o.hy; p.state = 'ground';
        if (k >= 1) { p.reserve = s.spot; p.reserveNext = null; p.fig = null; p.placed = true; p.state = 'idle'; p.plan.shift(); continue; }
        return;
      }
      p.plan.shift();
    }
    if (!p.plan.length && p.state !== 'idle') { p.state = 'idle'; p.placed = true; }
  }
  // 持ち場に着き終わるまでの残り時間（最後の跳躍・整える途中の人だけ。それ以外は無限大）
  function etaPlaced(o) {
    if (o.placed) return 0;
    let t = 0;
    for (let i = 0; i < o.plan.length; i++) {
      const x = o.plan[i];
      if (x.type === 'settle' || x.type === 'adjust') { t += x.dur - (x.t || 0); return t; }
      if (x.type === 'hop' && x.final) { t += x.dur - (x.t || 0); continue; }
      return Infinity;
    }
    return Infinity;
  }
  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }

  /* --- 確かめ：止まっている人の接触が、今の画面上（描く線の位置）で成り立っているか ---
     新しい持ち場にいる人（at='new'）は新しい配置の接触を、まだ前の持ち場にいる人（at='old'）は前の配置の接触を、
     相手の「今の」体の位置で確かめる。相手が持ち場にいない（移動中）なら違反。 */
  function checkContacts() {
    if (!st.layout) return 0;
    let bad = 0;
    st.people.forEach(function (p) { p.pts = solve(p.pose, p.hx, p.hy, p.h, p.f); });
    const check = function (layoutFigs, pidOf, side) {
      const live = layoutFigs.map(function (f) {
        if (!f) return null;
        const p = st.byPid[pidOf[f.id]];
        if (!p || p.fig !== f.id || p.at === null || p.at === undefined) return null;
        if (side === 'new' && p.at !== 'new') return null;
        return { id: f.id, h: p.h, pts: p.pts, contacts: f.contacts, at: p.at };
      });
      live.forEach(function (lf) {
        if (!lf || lf.at !== side) return;
        lf.contacts.forEach(function (c) {
          if (c.kind === 'hold') return;
          if (c.host >= 0 && !live[c.host]) { bad++; return; }
          const e = contactError(c, lf, live);
          if (e > CONTACT_TOL) { bad++; }
        });
      });
    };
    check(st.layout.figs, st.layout.pidOf, 'new');
    if (st.oldLayout) check(st.oldLayout.figs, st.oldLayout.pidOf, 'old');
    return bad;
  }

  /* --- 毎コマの更新 --- */
  st.update = function (seg, dt) {
    st.time += dt;
    st.frames++;
    st.byPid = st.byPid || {};
    st.people.forEach(function (p) { st.byPid[p.pid] = p; });
    if (seg) {
      const m = filter(seg);
      const area = maskArea(m);
      if (st.lastMask) {
        const x = maskChange(m, st.lastMask, 2).n;   // カメラのちらつき（輪郭の1〜2画素の揺れ）は動きに数えない
        st.stillFor = x <= Math.max(8, area * STAGE_OPT.stillFrac) ? st.stillFor + dt : 0;
      }
      st.lastMask = m;
      if (area > STAGE_OPT.minArea) {
        if (!st.layout && !st.job) {
          st.pendingSeg = m;
          st.job = startJob(stageMask(m), null, null, STAGE_OPT.firstBudget);
          st.job.first = true;
          st.status = '組体操を組み立て中…';
        } else if (st.layout && !st.job && !st.busy) {
          const d = maskChange(m, st.layout.seg, 4).n;
          if (d > Math.max(40, area * STAGE_OPT.changeFrac)) {
            if (!st.changeAt) st.changeAt = st.time;
            if (st.stillFor >= STAGE_OPT.stillTime) { st.stillAt = st.time; st.stopAt = st.time - st.stillFor; startUpdate(m); }
          } else st.changeAt = null;
        }
      }
    }
    if (st.job) {
      const done = st.job.step(STAGE_OPT.growSlice);
      if (done) {
        const job = st.job;
        st.job = null;
        if (job.first) {
          // 最初：ベンチの全員から、持ち場へ向かう（組み直しと同じしくみ）
          job.removed = new Set();
          st.layout = { figs: [], mask: new Uint8Array(NPIX), seg: new Float32Array(MASK_W * MASK_H), pidOf: {} };
          st.stopAt = st.time;
          commitUpdate(job);
          if (!job.S.figs.some(Boolean)) st.status = '形が画面の下の端（床）に届くように立ってください';
        }
        else commitUpdate(job);
        const c = { x: 0, n: 0 }; job.S.figs.forEach(function (f) { if (f) { c.x += f.hx; c.n++; } });
        st.centerX = c.n ? c.x / c.n : STAGE_W / 2;
      }
    }
    st.people.forEach(function (p) { personStep(p, dt); });
    // 新しい形の持ち場が全部うまった時刻（待ち場所へ戻る人は数えない）
    if (st.busy && st.metrics && st.metrics.filledAt === undefined && st.people.every(function (p) { return p.placed || p.newFig === undefined || p.fig === null && !p.plan.some(function (x) { return x.type === 'mount' || x.type === 'settle' || x.type === 'leaveTo' || x.type === 'hop'; }); })) {
      st.metrics.filledAt = st.time; st.metrics.catchUp = st.time - st.metrics.stopAt;
    }
    if (st.busy && st.people.every(function (p) { return !p.plan.length; })) {
      st.busy = false;
      // 組み直しの終わりに、持ち場にいる全員を計画どおりの姿勢・位置にそろえる（小さなずれを残さない）。そろえた量の最大を記録
      st.people.forEach(function (p) {
        if (p.fig === null || p.at !== 'new') return;
        const f = st.layout.figs[p.fig];
        if (!f || st.layout.pidOf[f.id] !== p.pid) return;
        const a = solve(p.pose, p.hx, p.hy, p.h, p.f), b = f.pts;
        let m = 0; for (const k in b) m = Math.max(m, Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]));
        st.maxSnap = Math.max(st.maxSnap || 0, m);
        p.pose = Object.assign({}, f.pose); p.hx = f.hx; p.hy = f.hy; p.f = f.f;
      });
      // 追いつくまでの時間：入力が止まった時刻から、全員が持ち場に着くまで（ならし・計算・移動をすべて含む）
      if (st.metrics) { st.metrics.doneAt = st.time; if (st.metrics.catchUp === undefined) st.metrics.catchUp = st.time - st.metrics.stopAt; st.metrics.allDone = st.time - st.metrics.stopAt; }
      st.status = '組み直し完了';
      st.log.push(Object.assign({}, st.metrics));
      st.changeAt = null;
    }
  };
  st.checkContacts = checkContacts;

  /* --- 写真1枚から組む（撮るたびに呼ぶ）。戻り値：'first'（最初の組み立て）／'update'（組み直し）／'same'（変化なし）／'small'（人が小さすぎる）／'busy' --- */
  st.capture = function (prob) {
    const m = makeMaskFilter(0.5)(prob);       // 新しいフィルタ＝ならさず、確率0.5で白黒にして小さな切れ端だけ消す（細い指先を残すため 0.6 より低く）
    const area = maskArea(m);
    st.lastMask = m;
    if (area < STAGE_OPT.minArea) return 'small';
    if (st.job || st.busy) return 'busy';
    if (!st.layout) {
      st.pendingSeg = m;
      st.job = startJob(stageMask(m), null, null, STAGE_OPT.firstBudget);
      st.job.first = true;
      st.status = '組体操を組み立て中…';
      return 'first';
    }
    const d = maskChange(m, st.layout.seg, 4).n;
    if (d <= Math.max(160, area * STAGE_OPT.changeFrac)) return 'same';
    st.changeAt = st.time; st.stillAt = st.time; st.stopAt = st.time;
    startUpdate(m);
    return 'update';
  };
  // 今の段階：'compute'（計算中）／'move'（移動中）／'idle'
  st.phase = function () { return st.job ? 'compute' : st.busy ? 'move' : 'idle'; };
  st.progress = function () {
    if (st.job) return { count: st.job.S.count(), first: !!st.job.first, pct: Math.round(100 * st.job.progress()) };
    const moving = st.people.filter(function (p) { return !p.placed; }).length;
    return { moving: moving, total: st.moving ? st.moving.size : 0 };
  };

  /* --- 組み上がった後の小さな動き：ぶら下がり・旗の人は、つかんだ手を中心にゆらゆら揺れる ---
     その人の上（足首）にだれもつかまっていない時だけ。手の位置は動かないので、接触は崩れない */
  function swayed(p) {
    const pts = solve(p.pose, p.hx, p.hy, p.h, p.f);
    if (!p.placed || p.fig === null || !st.layout || st.busy) return pts;
    const f = st.layout.figs[p.fig];
    if (!f || (f.tpl !== 'hang' && f.tpl !== 'flag')) return pts;
    if (p.swayOK === undefined || p.swayFor !== st.layout) {
      p.swayFor = st.layout;
      p.swayOK = !st.layout.figs.some(function (o) { return o && o.contacts.some(function (c) { return c.host === f.id && c.kind !== 'hold'; }); });
    }
    if (!p.swayOK) return pts;
    const c = [(pts.haF[0] + pts.haB[0]) / 2, (pts.haF[1] + pts.haB[1]) / 2];
    const amp = (f.tpl === 'hang' ? 4 : 2.5) * Math.PI / 180;
    const a = amp * Math.sin(st.time * (1.6 + (p.seed % 7) * 0.08) + p.seed);
    const cs = Math.cos(a), sn = Math.sin(a), out = {};
    for (const k in pts) { const dx = pts[k][0] - c[0], dy = pts[k][1] - c[1]; out[k] = [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs]; }
    // 脚は振り子と少しずらして、ぶらぶらさせる
    const kick = 0.05 * p.h * Math.sin(st.time * 2.3 + p.seed * 1.7);
    out.ftF = [out.ftF[0] + kick, out.ftF[1]]; out.ftB = [out.ftB[0] - kick, out.ftB[1]];
    return out;
  }

  /* --- 描く --- */
  st.draw = function (ctx, scale, frame, debug) {
    ctx.save();
    ctx.scale(scale, scale);
    if (debug && st.layout) {
      // 入力の形（薄く）
      if (!st._maskImg || st._maskFor !== st.layout) {
        const c = document.createElement('canvas'); c.width = STAGE_W; c.height = STAGE_H;
        const g = c.getContext('2d'), img = g.createImageData(STAGE_W, STAGE_H);
        for (let i = 0; i < NPIX; i++) if (st.layout.mask[i]) { img.data[i * 4] = 120; img.data[i * 4 + 1] = 170; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 70; }
        g.putImageData(img, 0, 0); st._maskImg = c; st._maskFor = st.layout;
      }
      ctx.drawImage(st._maskImg, 0, 0);
    }
    ctx.strokeStyle = '#d8d6cf'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, FLOOR_Y + 0.5); ctx.lineTo(STAGE_W, FLOOR_Y + 0.5); ctx.stroke();
    ctx.strokeStyle = '#141414'; ctx.fillStyle = '#141414'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 線の太さは身長で3種類だけなので、まとめて描く。出番を待って座っている人は薄い灰色（控え）
    [true, false].forEach(function (waiting) {
      ctx.strokeStyle = ctx.fillStyle = waiting ? '#c9ccd4' : '#141414';
      SIZE_STEPS.forEach(function (z) {
        const h = z * STAGE_OPT.H0;
        ctx.lineWidth = lineW(h);
        const heads = new Path2D();
        ctx.beginPath();
        st.people.forEach(function (p) {
          const w = p.fig === null && p.placed && !p.plan.length;
          if (w === waiting && Math.abs(p.h - h) < 0.01) drawFigure(ctx, heads, swayed(p), p.h, p.seed, frame);
        });
        ctx.stroke(); ctx.fill(heads);
      });
    });
    if (debug && st.layout) {
      // 支えの関係（赤い点：接触）
      ctx.fillStyle = 'rgba(220,40,40,0.8)';
      st.people.forEach(function (p) {
        if (!p.placed || p.fig === null) return;
        const f = st.layout.figs[p.fig]; if (!f) return;
        const pts = solve(p.pose, p.hx, p.hy, p.h, p.f);
        f.contacts.forEach(function (c) { if (c.host >= 0) { ctx.beginPath(); ctx.arc(pts[c.limb][0], pts[c.limb][1], 1.6, 0, 7); ctx.fill(); } });
      });
    }
    ctx.restore();
  };
  initPeople();
  return st;
}
