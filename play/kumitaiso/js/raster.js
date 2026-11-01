// 評価のための「ものさし」：棒人間を、画面に描くのと同じ形（線の太さ・頭の円）で作業用の格子に塗り、
// 入力の人の形（マスク）と比べて、輪郭・はみ出し・密度・重なりを別々に点数にする。
// 座標はすべて「舞台」の座標（STAGE_W×STAGE_H、1単位＝作業用の1画素）。描くときは画面に合わせて拡大するだけ。
// made with Claude Opus 5.5
'use strict';

/* ===== 舞台（固定の座標系） =====
   カメラの映像（切り抜きモデルの 256×144）を、中央の 640×360 にそのまま 2.5 倍で置く（倍率は固定。人が腕を伸ばしても変わらない）。
   左右の 80 ずつは、出番を待つ人の控え場所。床は映像の下の端（y=360）。 */
// RES：細かさ。棒人間の大きさ（画素）はそのままで、舞台を RES 倍に細かくする → 人数はおよそ RES² 倍
const RES = (typeof WP_RES !== 'undefined') ? WP_RES : 2;
const CAM_SCALE = 2.5 * RES, CAM_X = 80 * RES, STAGE_W = 800 * RES, FLOOR_Y = 360 * RES;
// 床の下に、出番を待つ人が座るベンチの帯（舞台の一番下）。BENCH_Y：ベンチの座面
const BENCH_H = 30 * RES, STAGE_H = FLOOR_Y + 12 + BENCH_H, BENCH_Y = STAGE_H - 4;
// 手だけでつかまる張り出しの深さの上限（細かくした分だけ長く伸ばせる）
const MAX_OVERHANG = Math.max(2, Math.round(3 * RES));
const CAM_W = SEG_W * CAM_SCALE, CAM_H = SEG_H * CAM_SCALE;
// 細かい形（512×288）の1画素が、舞台の何画素か
const MASK_SCALE = CAM_SCALE * SEG_W / MASK_W;

// 線の太さ（描く時も同じ値）と、接触とみなす許容誤差（作業用の画素。線の太さの半分程度）
function lineW(h) { return h * 0.05; }
const CONTACT_TOL = 1.6;

// 描く線分（skeleton.js の drawFigure と同じ組み合わせ。首から頭の円の間は描かない）
const FIG_SEGS = [['hip', 'neck'], ['sh', 'elB'], ['elB', 'haB'], ['sh', 'elF'], ['elF', 'haF'], ['hip', 'knB'], ['knB', 'ftB'], ['hip', 'knF'], ['knF', 'ftF']];

const NPIX = STAGE_W * STAGE_H;
const STAMP = new Int32Array(NPIX);
let stampGen = 1;

// 棒人間1人を塗る：body＝黒くなる画素（重複なし）、head＝そのうち頭の円の画素の印、
// near＝輪郭の画素のうち、線から pad 以内にあるもの（bt：輪郭の画素を升目に分けた表。無ければ空）、
// ex＝body のうち「触れている所」の近く（zones：[x, y, 半径] の円の中）の画素。支え合う2人の線が重なるのは当然なので、重なりの罰から外す
// 線（丸い端の太い線分）は、横1行ごとに「その行で線に入る x の区間」を計算して塗る（四角い範囲を全部調べるより速い）
function capsuleRows(a, b, rr, cb) {
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - rr)), y1 = Math.min(STAGE_H - 1, Math.ceil(Math.max(a[1], b[1]) + rr));
  const vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy);
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    // 両端の円
    for (const c of [a, b]) {
      const dy = py - c[1], q = rr * rr - dy * dy;
      if (q >= 0) { const w = Math.sqrt(q); lo = Math.min(lo, c[0] - w); hi = Math.max(hi, c[0] + w); }
    }
    // 間の帯：線分への射影 u が 0〜1 で、線からの距離が rr 以下
    if (L > 1e-6) {
      const ux = vx / L, uy = vy / L;
      // 距離 |(x - ax) * uy - (py - ay) * ux| <= rr、射影 0 <= (x - ax) * ux + (py - ay) * uy <= L
      let l2 = -Infinity, h2 = Infinity;
      const lin = function (k, c0, lo0, hi0) {      // lo0 <= k * x + c0 <= hi0 を x の区間に
        if (Math.abs(k) < 1e-9) { if (c0 < lo0 || c0 > hi0) { l2 = Infinity; } return; }
        let A = (lo0 - c0) / k, B = (hi0 - c0) / k; if (A > B) { const t = A; A = B; B = t; }
        l2 = Math.max(l2, A); h2 = Math.min(h2, B);
      };
      lin(uy, -a[0] * uy - (py - a[1]) * ux, -rr, rr);
      lin(ux, -a[0] * ux + (py - a[1]) * uy, 0, L);
      if (l2 <= h2) { lo = Math.min(lo, l2); hi = Math.max(hi, h2); }
    }
    if (lo > hi) continue;
    const xa = Math.max(0, Math.ceil(lo - 0.5)), xb = Math.min(STAGE_W - 1, Math.floor(hi - 0.5));
    if (xa <= xb) cb(y, xa, xb);
  }
}
function rasterFigure(pts, h, pad, zones, bt) {
  const r = lineW(h) / 2, hr = BONE.head * h;
  const body = [], head = [], near = [];
  const g = ++stampGen;
  const put = function (y, xa, xb) { const row = y * STAGE_W; for (let x = xa; x <= xb; x++) { const i = row + x; if (STAMP[i] !== g) { STAMP[i] = g; body.push(i); } } };
  capsuleRows(pts.head, pts.head, hr, function (y, xa, xb) { const row = y * STAGE_W; for (let x = xa; x <= xb; x++) { const i = row + x; head.push(i); if (STAMP[i] !== g) { STAMP[i] = g; body.push(i); } } });
  for (const sg of FIG_SEGS) capsuleRows(pts[sg[0]], pts[sg[1]], r, put);
  // 輪郭の近く：輪郭の画素だけを調べる
  if (bt && pad > 0) {
    const g2 = ++stampGen;
    const test = function (a, b, rr) {
      const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - rr) / bt.T)), x1 = Math.min(bt.tw - 1, Math.floor((Math.max(a[0], b[0]) + rr) / bt.T));
      const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - rr) / bt.T)), y1 = Math.min(bt.th - 1, Math.floor((Math.max(a[1], b[1]) + rr) / bt.T));
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9, r2 = rr * rr;
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const list = bt.lists[ty * bt.tw + tx];
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const i = list[j];
          if (STAMP[i] === g2) continue;
          const px = i % STAGE_W + 0.5 - a[0], py = Math.floor(i / STAGE_W) + 0.5 - a[1];
          let u = (px * vx + py * vy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = px - u * vx, dy = py - u * vy;
          if (dx * dx + dy * dy <= r2) { STAMP[i] = g2; near.push(i); }
        }
      }
    };
    test(pts.head, pts.head, hr + pad);
    for (const sg of FIG_SEGS) test(pts[sg[0]], pts[sg[1]], r + pad);
  }
  const ex = [];
  if (zones && zones.length) for (const i of body) {
    const x = i % STAGE_W + 0.5, y = Math.floor(i / STAGE_W) + 0.5;
    for (const z of zones) if ((x - z[0]) * (x - z[0]) + (y - z[1]) * (y - z[1]) <= z[2] * z[2]) { ex.push(i); break; }
  }
  return { body: Int32Array.from(body), head: Int32Array.from(head), near: Int32Array.from(near), ex: Int32Array.from(ex) };
}

/* ===== 距離場（Felzenszwalb の厳密なユークリッド距離変換） ===== */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// on[i] が真の画素までの距離
function distanceTo(on, W, H) {
  const INF = 1e12, g = new Float64Array(W * H), n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = on[y * W + x] ? 0 : INF;
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}

/* ===== 入力の形を舞台に置く ===== */
// prob：人である確率（細かい形 MASK_W×MASK_H）。戻り値：舞台の画素ごとの 0/1
function stageMask(prob) {
  const m = new Uint8Array(NPIX), W = MASK_W, H = MASK_H, k = MASK_SCALE;
  for (let y = 0; y < Math.min(STAGE_H, CAM_H); y++) {
    const sy = (y + 0.5) / k - 0.5, y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(H - 1, y0 + 1), ty = Math.min(1, Math.max(0, sy - y0));
    for (let x = CAM_X; x < CAM_X + CAM_W; x++) {
      const sx = (x - CAM_X + 0.5) / k - 0.5, x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(W - 1, x0 + 1), tx = Math.min(1, Math.max(0, sx - x0));
      const a = prob[y0 * W + x0], b = prob[y0 * W + x1], c = prob[y1 * W + x0], d = prob[y1 * W + x1];
      const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      if (v > 0.5) m[y * STAGE_W + x] = 1;
    }
  }
  return m;
}

/* ===== 評価の盤 =====
   入力 M と、棒人間だけを塗った R（画素ごとに何人の線が乗っているか）を持ち、1人を足す・除くときの点数の変化をその人の画素だけで計算する。
   点数（小さいほど良い。各項は形の大きさで割って、画面の大きさや人数に左右されにくくしてある）：
   contour 輪郭の不足：輪郭の画素のうち、近く（tau 以内）に線が来ていない割合。細い所・先端の輪郭は重く数える
   over    はみ出し：形の外に塗った画素。形から遠いほど重い。脇・脚の間などの「くぼみ」はさらに重い
   density 密度の偏り：2つの大きさの升目ごとに、黒の割合と目標（形の中は D、外は 0）の差の2乗
   overlap 重なり：同じ画素に2人以上の線（頭に他人の線が重なるのは別に重く）
   count   人数（予算に対する割合） */
function makeBoard(mask, H0, opt) {
  opt = opt || {};
  const W = Object.assign({ contour: 3, over: 3, density: 2, overlap: 5, headOverlap: 10, count: 0.25 }, opt.weights || {});
  const D = opt.targetDensity || 0.2;
  const tau = Math.max(2, H0 * 0.07);
  const budget = opt.budget || 150;
  // 輪郭の画素と重み：周り（半径 rho）に形が少ない所＝先端・細い所ほど重い
  let area = 0;
  for (let i = 0; i < NPIX; i++) area += mask[i];
  const outside = new Uint8Array(NPIX);
  for (let i = 0; i < NPIX; i++) outside[i] = mask[i] ? 0 : 1;
  const dIn = distanceTo(mask, STAGE_W, STAGE_H);        // 形の外の画素：形までの距離
  const dOut = distanceTo(outside, STAGE_W, STAGE_H);    // 形の中の画素：外までの距離（＝その場所の太さの半分）
  const bw = new Float32Array(NPIX), border = [];
  const rho = Math.round(H0 * 0.25);
  const integ = new Int32Array((STAGE_W + 1) * (STAGE_H + 1));
  for (let y = 0; y < STAGE_H; y++) for (let x = 0; x < STAGE_W; x++)
    integ[(y + 1) * (STAGE_W + 1) + x + 1] = mask[y * STAGE_W + x] + integ[y * (STAGE_W + 1) + x + 1] + integ[(y + 1) * (STAGE_W + 1) + x] - integ[y * (STAGE_W + 1) + x];
  const boxSum = function (x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(STAGE_W, x1); y1 = Math.min(STAGE_H, y1);
    if (x1 <= x0 || y1 <= y0) return 0;
    const S = STAGE_W + 1;
    return integ[y1 * S + x1] - integ[y0 * S + x1] - integ[y1 * S + x0] + integ[y0 * S + x0];
  };
  let bwSum = 0;
  for (let y = 0; y < STAGE_H; y++) for (let x = 0; x < STAGE_W; x++) {
    const i = y * STAGE_W + x;
    if (!mask[i]) continue;
    // 床に接する下の端は輪郭に数えない（床の線と同じ）
    const edge = (x > 0 && !mask[i - 1]) || (x < STAGE_W - 1 && !mask[i + 1]) || (y > 0 && !mask[i - STAGE_W]) || (y < STAGE_H - 1 && !mask[i + STAGE_W] && y < FLOOR_Y - 1);
    if (!edge) continue;
    const frac = boxSum(x - rho, y - rho, x + rho + 1, y + rho + 1) / ((2 * rho + 1) * (2 * rho + 1));
    const w = 1 + 2.5 * Math.max(0, 0.55 - frac) / 0.55;     // 平らな輪郭は約半分が形 → 1。先端・細い所ほど最大 3.5
    bw[i] = w; bwSum += w; border.push(i);
  }
  // 輪郭の画素を 16×16 の升目ごとにまとめた表（棒人間の近くの輪郭だけを調べるため）
  const T = 16, tw = Math.ceil(STAGE_W / T), th = Math.ceil(STAGE_H / T), tl = [];
  for (const i of border) { const k = Math.floor(Math.floor(i / STAGE_W) / T) * tw + Math.floor((i % STAGE_W) / T); (tl[k] = tl[k] || []).push(i); }
  const bt = { T: T, tw: tw, th: th, lists: tl.map(function (l) { return l ? Int32Array.from(l) : null; }) };
  // くぼみ（脇・脚の間・腕と頭の間）：形を半径 rc で閉じたときに埋まる、形の外の画素
  const rc = H0 * 0.35;
  const gap = new Uint8Array(NPIX);
  const closed = new Uint8Array(NPIX);
  for (let i = 0; i < NPIX; i++) closed[i] = dIn[i] <= rc ? 1 : 0;           // ふくらませる
  const notClosed = new Uint8Array(NPIX);
  for (let i = 0; i < NPIX; i++) notClosed[i] = closed[i] ? 0 : 1;
  const dBack = distanceTo(notClosed, STAGE_W, STAGE_H);
  let gapArea = 0;
  for (let i = 0; i < NPIX; i++) if (!mask[i] && dBack[i] > rc) { gap[i] = 1; gapArea++; }   // 縮め戻しても残る外の画素＝くぼみ
  // はみ出しの重み（画素ごと）
  const ow = new Float32Array(NPIX);
  for (let i = 0; i < NPIX; i++) if (!mask[i]) ow[i] = (1 + dIn[i] / tau) * (gap[i] ? 2.5 : 1);
  // 密度の升目（2つの大きさ）
  const cellSizes = [Math.max(8, Math.round(H0 * 0.35)), Math.max(16, Math.round(H0 * 0.8))];
  const grids = cellSizes.map(function (c) {
    const gw = Math.ceil(STAGE_W / c), gh = Math.ceil(STAGE_H / c);
    const m = new Float32Array(gw * gh), A = new Float32Array(gw * gh), b = new Int32Array(gw * gh);
    for (let y = 0; y < STAGE_H; y++) for (let x = 0; x < STAGE_W; x++) { const k = Math.floor(y / c) * gw + Math.floor(x / c); A[k]++; m[k] += mask[y * STAGE_W + x]; }
    for (let k = 0; k < m.length; k++) m[k] /= A[k];
    const map = new Int32Array(NPIX);
    for (let y = 0; y < STAGE_H; y++) for (let x = 0; x < STAGE_W; x++) map[y * STAGE_W + x] = Math.floor(y / c) * gw + Math.floor(x / c);
    return { c: c, gw: gw, gh: gh, m: m, A: A, b: b, map: map, inc: new Int32Array(gw * gh), touched: [] };
  });
  // 正規化の分母
  const normC = bwSum || 1, normO = Math.max(1, area * D), normD = Math.max(1, area * D * D), normV = Math.max(1, area * D);
  const cnt = new Uint16Array(NPIX), hc = new Uint16Array(NPIX), nearCnt = new Uint16Array(NPIX), exc = new Uint16Array(NPIX);
  const kC = W.contour / normC, kO = W.over / normO, kV = W.overlap / normV, kH = W.headOverlap / normV, kD = W.density / normD / grids.length;
  const pix = function (i, c, h, e) {
    if (!c) return 0;
    let v = ow[i] * kO;
    const o = Math.max(0, c - 1 - e);                    // 触れている所の重なりは数えない
    if (o > 0) { v += o * kV; if (h > 0) v += kH; }
    return v;
  };
  const cellCost = function (g, k, b) { const r = b / g.A[k] - D * g.m[k]; return r * r * g.A[k] * kD; };
  const HEAD = new Uint8Array(NPIX), EX = new Uint8Array(NPIX);
  // 升目ごとの「線が届いていない輪郭」の重み（足りなさの見積もりに使う）
  const ub = new Float32Array(grids[0].gw * grids[0].gh);
  for (const i of border) ub[grids[0].map[i]] += bw[i];
  // 1人を足す（sign=+1）／除く（sign=-1）ときの点数の変化。apply が真なら実際に盤を書きかえる
  function change(r, sign, apply) {
    let d = 0;
    for (let j = 0; j < r.head.length; j++) HEAD[r.head[j]] = 1;
    const rex = r.ex || [];
    for (let j = 0; j < rex.length; j++) EX[rex[j]] = 1;
    for (const g of grids) g.touched.length = 0;
    for (let j = 0; j < r.body.length; j++) {
      const i = r.body[j], c = cnt[i], h = hc[i], e = exc[i], c2 = c + sign, h2 = h + (HEAD[i] ? sign : 0), e2 = e + (EX[i] ? sign : 0);
      d += pix(i, c2, h2, e2) - pix(i, c, h, e);
      if ((c === 0) !== (c2 === 0)) for (const g of grids) { const k = g.map[i]; if (!g.inc[k]) g.touched.push(k); g.inc[k] += sign; }
      if (apply) { cnt[i] = c2; hc[i] = h2; exc[i] = e2; }
    }
    for (let j = 0; j < r.head.length; j++) HEAD[r.head[j]] = 0;
    for (let j = 0; j < rex.length; j++) EX[rex[j]] = 0;
    for (const g of grids) {
      for (const k of g.touched) { if (g.inc[k]) { d += cellCost(g, k, g.b[k] + g.inc[k]) - cellCost(g, k, g.b[k]); if (apply) g.b[k] += g.inc[k]; } g.inc[k] = 0; }
    }
    for (let j = 0; j < r.near.length; j++) {
      const i = r.near[j];
      if (bw[i]) {
        const n = nearCnt[i], n2 = n + sign;
        if (n === 0 && n2 > 0) { d -= bw[i] * kC; if (apply) ub[grids[0].map[i]] -= bw[i]; }
        else if (n > 0 && n2 === 0) { d += bw[i] * kC; if (apply) ub[grids[0].map[i]] += bw[i]; }
      }
      if (apply) nearCnt[i] += sign;
    }
    d += sign * W.count / budget;
    return d;
  }
  // 全体の点数（項目別）。報告と確認用に全部の画素から数え直す
  function breakdown(nFigs) {
    let c = 0, o = 0, v = 0, hv = 0, dsum = 0, gapHit = 0, inkIn = 0, ink = 0;
    for (const i of border) if (!nearCnt[i]) c += bw[i];
    for (let i = 0; i < NPIX; i++) {
      if (!cnt[i]) continue;
      ink++;
      if (mask[i]) inkIn++; else o += ow[i];
      if (gap[i]) gapHit++;
      const ov = Math.max(0, cnt[i] - 1 - exc[i]);
      if (ov > 0) { v += ov; if (hc[i] > 0) hv++; }
    }
    for (const g of grids) for (let k = 0; k < g.b.length; k++) { const r = g.b[k] / g.A[k] - D * g.m[k]; dsum += r * r * g.A[k]; }
    const parts = {
      contour: c / normC, over: o / normO, density: dsum / normD / grids.length, overlap: v / normV, headOverlap: hv / normV, count: (nFigs || 0) / budget
    };
    let total = 0;
    for (const k in parts) total += parts[k] * W[k];
    return {
      total: total, parts: parts,
      // 読みやすい指標
      contourCovered: 1 - c / normC,                         // 輪郭のうち線が近くに来ている割合（重みつき）
      inkInside: ink ? inkIn / ink : 0,                       // 塗った画素のうち形の中の割合
      inkDensity: area ? inkIn / area : 0,                    // 形の中の黒の割合（目標 D）
      gapIntrusion: gapArea ? gapHit / gapArea : 0,           // くぼみのうち塗ってしまった割合
      ink: ink, area: area
    };
  }
  return {
    mask: mask, H0: H0, D: D, tau: tau, bt: bt, weights: W, budget: budget, area: area,
    dIn: dIn, dOut: dOut, bw: bw, border: border, gap: gap, ow: ow, grids: grids,
    cnt: cnt, hc: hc, nearCnt: nearCnt, ub: ub,
    delta: function (r, sign) { return change(r, sign, false); },
    add: function (r) { return change(r, 1, true); },
    remove: function (r) { return change(r, -1, true); },
    breakdown: breakdown,
    // 局所の「足りなさ」：升目ごとに 目標の黒 − 今の黒（＋）と、届いていない輪郭の重み
    need: function (x, y, rad) {
      const g = grids[0];
      let s = 0;
      const k0x = Math.max(0, Math.floor((x - rad) / g.c)), k1x = Math.min(g.gw - 1, Math.floor((x + rad) / g.c));
      const k0y = Math.max(0, Math.floor((y - rad) / g.c)), k1y = Math.min(g.gh - 1, Math.floor((y + rad) / g.c));
      for (let ky = k0y; ky <= k1y; ky++) for (let kx = k0x; kx <= k1x; kx++) {
        const k = ky * g.gw + kx;
        // 密度の足りなさ（黒の画素数）＋ 線が届いていない輪郭（1画素あたり、黒 3 画素分として数える）
        s += Math.max(0, D * g.m[k] - g.b[k] / g.A[k]) * g.A[k] + 3 * ub[k];
      }
      return s;
    },
    // 線が届いていない輪郭の画素（重み・位置）の一覧
    uncovered: function () { const out = []; for (const i of border) if (!nearCnt[i]) out.push(i); return out; }
  };
}
