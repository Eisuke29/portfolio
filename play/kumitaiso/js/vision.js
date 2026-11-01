// 学習済みモデル（TensorFlow.js）で、映像から「人の形」と「体の姿勢」を取る。
// モデルの重みは models/*.js に base64 で埋め込んであり、file:// でも読み込める。
// made with Claude Opus 5.5
'use strict';

const SEG_W = 256, SEG_H = 144;   // 人の切り抜きモデルの入力の大きさ
let segModel = null, poseModel = null, handModel = null, palmModel = null;

function base64ToBuffer(b) {
  const s = atob(b), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}
function loadEmbedded(M) {
  return tf.loadGraphModel(tf.io.fromMemory({
    modelTopology: M.modelTopology, weightSpecs: M.weightSpecs, weightData: base64ToBuffer(M.weightsBase64),
    format: M.format, signature: M.signature, userDefinedMetadata: M.userDefinedMetadata
  }));
}
// onStep(番号, 全体の数)：1つ読み終わるたびに呼ぶ（読み込み中の画面の進み具合）
async function loadModels(onStep) {
  const step = function (i) { if (onStep) onStep(i, 5); return new Promise(function (r) { setTimeout(r, 30); }); };   // 画面を描きかえる間をあける
  await step(0);
  await tf.ready(); await step(1);
  segModel = await loadEmbedded(SEG_MODEL); await step(2);
  if (typeof POSE_MODEL !== 'undefined') poseModel = await loadEmbedded(POSE_MODEL);
  await step(3);
  if (typeof HAND_MODEL !== 'undefined') handModel = await loadEmbedded(HAND_MODEL);
  if (typeof PALM_MODEL !== 'undefined') palmModel = await loadEmbedded(PALM_MODEL);
  await step(4);
  return tf.getBackend();
}

// canvas（SEG_W×SEG_H に描いたもの）から、人である確率（0〜1）の配列を返す
async function segment(canvas) {
  const out = tf.tidy(function () {
    const x = tf.browser.fromPixels(canvas).toFloat().div(255).expandDims(0);
    const y = segModel.predict(x);                       // [1,144,256,2]
    return y.slice([0, 0, 0, 1], [1, SEG_H, SEG_W, 1]);  // 2つ目＝人
  });
  const d = await out.data();
  out.dispose();
  return d;
}

// 体の17か所（MoveNet の順：鼻・目・耳・肩・ひじ・手首・腰・ひざ・足首）。x,y は 0〜1、s は確かさ
async function detectPose(canvas) {
  if (!poseModel) return null;
  const out = tf.tidy(function () {
    const x = tf.image.resizeBilinear(tf.browser.fromPixels(canvas), [192, 192]).toInt().expandDims(0);
    return poseModel.execute(x);
  });
  const d = await out.data();
  out.dispose();
  const k = [];
  for (let i = 0; i < 17; i++) k.push({ y: d[i * 3], x: d[i * 3 + 1], s: d[i * 3 + 2] });
  return k;
}

/* ===== 細かい切り抜き（写真1枚ごと） =====
   モデルの入力は 256×144 と粗いので、指先などの細い所が消えやすい。
   写真（1024×576 に描いたもの）を、全体で1回＋縦横2つずつ少し重ねた4枚に分けて切り抜き、512×288 の細かい形にまとめる。
   分けた画像だけで人と判断した所は、全体で見た形の近くに限る（背景の誤りを拾わないため）。 */
const MASK_W = SEG_W * 2, MASK_H = SEG_H * 2;
const PHOTO_W = 1024, PHOTO_H = 576;
async function segmentFine(photo) {
  const small = document.createElement('canvas'); small.width = SEG_W; small.height = SEG_H;
  const g = small.getContext('2d');
  const out = new Float32Array(MASK_W * MASK_H), wsum = new Float32Array(MASK_W * MASK_H);
  // 全体
  g.drawImage(photo, 0, 0, SEG_W, SEG_H);
  const full = await segment(small);
  const fullUp = new Float32Array(MASK_W * MASK_H);
  for (let y = 0; y < MASK_H; y++) for (let x = 0; x < MASK_W; x++) {
    const sx = Math.min(SEG_W - 1, (x + 0.5) / 2 - 0.5 < 0 ? 0 : (x + 0.5) / 2 - 0.5), sy = Math.min(SEG_H - 1, (y + 0.5) / 2 - 0.5 < 0 ? 0 : (y + 0.5) / 2 - 0.5);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(SEG_W - 1, x0 + 1), y1 = Math.min(SEG_H - 1, y0 + 1), tx = sx - x0, ty = sy - y0;
    fullUp[y * MASK_W + x] = (full[y0 * SEG_W + x0] * (1 - tx) + full[y0 * SEG_W + x1] * tx) * (1 - ty) + (full[y1 * SEG_W + x0] * (1 - tx) + full[y1 * SEG_W + x1] * tx) * ty;
  }
  // 4枚（16:9 のまま、少し重ねる）
  const tw = PHOTO_W * 0.5625, th = PHOTO_H * 0.5625;
  for (const ty0 of [0, PHOTO_H - th]) for (const tx0 of [0, PHOTO_W - tw]) {
    g.drawImage(photo, tx0, ty0, tw, th, 0, 0, SEG_W, SEG_H);
    const t = await segment(small);
    const mx0 = tx0 / 2, my0 = ty0 / 2, mw = tw / 2, mh = th / 2;     // 細かい形の座標での範囲
    for (let y = Math.floor(my0); y < Math.min(MASK_H, my0 + mh); y++) for (let x = Math.floor(mx0); x < Math.min(MASK_W, mx0 + mw); x++) {
      const u = (x + 0.5 - mx0) / mw, v = (y + 0.5 - my0) / mh;
      const sx = Math.min(SEG_W - 1, Math.max(0, Math.round(u * SEG_W - 0.5))), sy = Math.min(SEG_H - 1, Math.max(0, Math.round(v * SEG_H - 0.5)));
      // 端ほど軽く（重なる所をなめらかにつなぐ）
      const w = Math.max(0.05, Math.min(u, 1 - u, v, 1 - v));
      out[y * MASK_W + x] += t[sy * SEG_W + sx] * w; wsum[y * MASK_W + x] += w;
    }
  }
  // 全体で見た形の近く（ふくらませた範囲）だけを残し、全体の結果と混ぜる
  const near = new Uint8Array(MASK_W * MASK_H), R = 6;
  for (let y = 0; y < MASK_H; y++) for (let x = 0; x < MASK_W; x++) if (fullUp[y * MASK_W + x] > 0.3) {
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < MASK_W && yy < MASK_H) near[yy * MASK_W + xx] = 1; }
  }
  for (let i = 0; i < out.length; i++) {
    // 分けた画像は「足す」だけ（全体で人と判断した所は消さない）。足すのは全体の形の近くだけ
    const tile = wsum[i] ? out[i] / wsum[i] : 0;
    out[i] = Math.max(fullUp[i], near[i] ? tile : 0);
  }
  return out;
}
// 写真用のキャンバス（1024×576）に、映像や画像を 16:9 で切り取って描く（mirror：左右反転＝鏡のように）
function drawPhoto(canvas, src, sw, sh, mirror) {
  const g = canvas.getContext('2d');
  const want = PHOTO_W / PHOTO_H;
  let cw = sw, ch = sw / want;
  if (ch > sh) { ch = sh; cw = sh * want; }
  g.save();
  g.fillStyle = '#fff'; g.fillRect(0, 0, PHOTO_W, PHOTO_H);
  if (mirror) { g.translate(PHOTO_W, 0); g.scale(-1, 1); }
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, PHOTO_W, PHOTO_H);
  g.restore();
}

/* ===== 輪郭を写真の色に合わせる（色つきガイデッドフィルタ：He ら 2010） =====
   人である確率 p を、写真の色 I を手がかりに「局所的に I の一次式」で近似し直す。
   こうすると、確率がぼやけていた輪郭が写真の色の境目にそろい、確率が中くらいだった細い所（指先）も、
   まわりと色が違えば人の側に寄る。r：窓の半径、eps：なめらかさ。 */
function guidedRefine(p, photo, r, eps) {
  const W = MASK_W, H = MASK_H, N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(photo, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const I = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  for (let i = 0; i < N; i++) { I[0][i] = px[i * 4] / 255; I[1][i] = px[i * 4 + 1] / 255; I[2][i] = px[i * 4 + 2] / 255; }
  // 窓の平均（積分画像）
  const box = function (src) {
    const S = new Float64Array((W + 1) * (H + 1)), out = new Float32Array(N);
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      out[y * W + x] = (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    }
    return out;
  };
  const mul = function (a, b) { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = a[i] * b[i]; return o; };
  const mI = I.map(box), mp = box(p);
  const mIp = I.map(function (Ic) { return box(mul(Ic, p)); });
  const vv = {};                                   // 色の分散・共分散（3×3 の対称行列）
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) vv[a + '' + b] = box(mul(I[a], I[b]));
  const A = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const k = a <= b ? a + '' + b : b + '' + a; s.push(vv[k][i] - mI[a][i] * mI[b][i] + (a === b ? eps : 0)); }
    const cov = [mIp[0][i] - mI[0][i] * mp[i], mIp[1][i] - mI[1][i] * mp[i], mIp[2][i] - mI[2][i] * mp[i]];
    // 3×3 の逆行列
    const [a, b2, c2, d, e, f, gg, h, k] = s;
    const det = a * (e * k - f * h) - b2 * (d * k - f * gg) + c2 * (d * h - e * gg) || 1e-9;
    const inv = [(e * k - f * h) / det, (c2 * h - b2 * k) / det, (b2 * f - c2 * e) / det,
      (f * gg - d * k) / det, (a * k - c2 * gg) / det, (c2 * d - a * f) / det,
      (d * h - e * gg) / det, (b2 * gg - a * h) / det, (a * e - b2 * d) / det];
    for (let q = 0; q < 3; q++) A[q][i] = inv[q * 3] * cov[0] + inv[q * 3 + 1] * cov[1] + inv[q * 3 + 2] * cov[2];
    B[i] = mp[i] - A[0][i] * mI[0][i] - A[1][i] * mI[1][i] - A[2][i] * mI[2][i];
  }
  const mA = A.map(box), mB = box(B);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.max(0, Math.min(1, mA[0][i] * I[0][i] + mA[1][i] * I[1][i] + mA[2][i] * I[2][i] + mB[i]));
  return out;
}

/* ===== 手の拡大：姿勢推定（MoveNet）で手首を見つけ、手のまわりを大きく切り出してもう一度切り抜く ===== */
async function handZoom(p, photo) {
  if (typeof poseModel === 'undefined' || !poseModel) return p;
  // 正方形に余白を足して姿勢推定（ゆがませないため）
  const sq = document.createElement('canvas'); sq.width = sq.height = 256;
  const sg = sq.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, 256, 256);
  const ph = 256 * PHOTO_H / PHOTO_W, oy = (256 - ph) / 2;
  sg.drawImage(photo, 0, oy, 256, ph);
  const kp = await detectPose(sq);
  if (!kp) return p;
  const toPhoto = function (k) { return [k.x * 256 * PHOTO_W / 256, (k.y * 256 - oy) * PHOTO_W / 256]; };
  const small = document.createElement('canvas'); small.width = SEG_W; small.height = SEG_H;
  const g = small.getContext('2d');
  const out = Float32Array.from(p);
  // 足してよいのは、もとの形から 24 画素以内（手の先が少し欠けている所を補うため）
  const on = new Uint8Array(MASK_W * MASK_H);
  for (let i = 0; i < on.length; i++) on[i] = p[i] > 0.3 ? 1 : 0;
  const dist = distanceTo(on, MASK_W, MASK_H);
  for (const [wi, ei] of [[9, 7], [10, 8]]) {                    // 左右の手首とひじ
    const w = kp[wi], e = kp[ei];
    if (w.s < 0.25 || e.s < 0.2) continue;
    const W = toPhoto(w), E = toPhoto(e);
    const fore = Math.hypot(W[0] - E[0], W[1] - E[1]);
    if (fore < 8) continue;
    const C = [W[0] + (W[0] - E[0]) * 0.45, W[1] + (W[1] - E[1]) * 0.45];   // 手のひらの真ん中あたり
    const ch = Math.max(60, fore * 1.6), cw = ch * 16 / 9;
    const x0 = C[0] - cw / 2, y0 = C[1] - ch / 2;
    g.fillStyle = '#fff'; g.fillRect(0, 0, SEG_W, SEG_H);
    g.drawImage(photo, x0, y0, cw, ch, 0, 0, SEG_W, SEG_H);
    const t = await segment(small);
    // 細かい形（512×288）に戻して、もとの形とつながる所だけ足す（max）
    const mx0 = x0 / 2, my0 = y0 / 2, mw = cw / 2, mh = ch / 2;
    for (let y = Math.max(0, Math.floor(my0)); y < Math.min(MASK_H, my0 + mh); y++) for (let x = Math.max(0, Math.floor(mx0)); x < Math.min(MASK_W, mx0 + mw); x++) {
      const sx = Math.min(SEG_W - 1, Math.max(0, Math.floor((x + 0.5 - mx0) / mw * SEG_W))), sy = Math.min(SEG_H - 1, Math.max(0, Math.floor((y + 0.5 - my0) / mh * SEG_H)));
      const v = t[sy * SEG_W + sx], i = y * MASK_W + x;
      if (v > out[i] && dist[i] <= 24) out[i] = v;
    }
  }
  return out;
}
// 写真1枚から、細かく・輪郭を合わせた形を作る（4分割 → 手の拡大 → 色で輪郭合わせ → もとの形の近くだけ残す）
let lastHands = [];
async function segmentPhoto(photo) {
  const base = await segmentFine(photo);
  const withHands = await handZoom(base, photo);
  const refined = guidedRefine(withHands, photo, 3, 0.004);
  // 色合わせで遠くに出た誤り（背景の似た色）を除く：もとの形から 10 画素以内だけ
  const on = new Uint8Array(MASK_W * MASK_H);
  for (let i = 0; i < on.length; i++) on[i] = withHands[i] > 0.35 ? 1 : 0;
  const d = distanceTo(on, MASK_W, MASK_H);
  for (let i = 0; i < refined.length; i++) if (d[i] > 10) refined[i] = 0;
  // 手の21点が取れたら、指先まで形に塗り足す（指は切り抜きモデルでは細すぎて消えやすいので）。体から離れた手は使わない
  const kp = await poseOnPhoto(photo);
  lastHands = await findHands(photo, kp);
  lastHands.forEach(function (hd) {
    if (!hd.ok) return;
    const c = [Math.round(hd.pts[0][0] / 2), Math.round(hd.pts[0][1] / 2)];      // 手首
    const i = Math.min(MASK_H - 1, Math.max(0, c[1])) * MASK_W + Math.min(MASK_W - 1, Math.max(0, c[0]));
    if (d[i] > 20) hd.ok = false;
  });
  return paintHands(refined, lastHands);
}

/* ===== 手の21点（MediaPipe Hands の手の点のモデル） =====
   手首（MoveNet）とひじから手のある範囲を見積もり、指先が上を向くように回して 224×224 に切り出し、21点（手首・各指の関節・指先）を出す。
   出た点から範囲を作り直して、もう一度出す（MediaPipe と同じやり方）。点は写真（1024×576）の座標で返す。 */
const HAND_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
async function runHand(photo, cx, cy, size, ang) {
  const c = document.createElement('canvas'); c.width = c.height = 224;
  const g = c.getContext('2d');
  const k = 224 / size, phi = -Math.PI / 2 - ang;      // ang：指先の向き（写真の座標）→ 上向きに回す
  g.fillStyle = '#000'; g.fillRect(0, 0, 224, 224);
  g.translate(112, 112); g.scale(k, k); g.rotate(phi); g.translate(-cx, -cy);
  g.drawImage(photo, 0, 0);
  const outs = tf.tidy(function () {
    const x = tf.browser.fromPixels(c).toFloat().div(255).expandDims(0);
    return handModel.execute(x, ['Identity:0', 'Identity_1:0', 'Identity_2:0', 'Identity_3:0']);
  });
  const vals = [];
  for (const o of outs) { vals.push(Array.from(await o.data())); o.dispose(); }
  // 63個のうち、224の画素の座標になっている方が画像上の点（もう一方は3次元の点）
  const lmA = vals[2], lmB = vals[3];
  const spread = function (a) { let m = 0; for (let i = 0; i < 63; i += 3) m = Math.max(m, Math.abs(a[i])); return m; };
  const lm = spread(lmA) > spread(lmB) ? lmA : lmB;
  const cs = Math.cos(-phi), sn = Math.sin(-phi), pts = [];
  for (let i = 0; i < 21; i++) {
    const u = (lm[i * 3] - 112) / k, v = (lm[i * 3 + 1] - 112) / k;
    pts.push([cx + u * cs - v * sn, cy + u * sn + v * cs]);
  }
  return { pts: pts, s0: vals[0][0], s1: vals[1][0] };
}
// 手を見つけて21点を返す（見つからなければ空）。kp：MoveNet の17点（写真の座標に直したもの）
async function findHands(photo, kp) {
  if (!handModel) return [];
  const starts = [];
  // 1) 手のひら検出から：手首(0)→中指の付け根(2)の向き、枠を指の方へ半分ずらして2.6倍（MediaPipe と同じ）
  for (const pd of await palmDetect(photo)) {
    const ang = Math.atan2(pd.kp[2][1] - pd.kp[0][1], pd.kp[2][0] - pd.kp[0][0]);
    const sz = Math.max(pd.w, pd.h);
    starts.push({ cx: pd.c[0] + Math.cos(ang) * sz * 0.5, cy: pd.c[1] + Math.sin(ang) * sz * 0.5, size: sz * 2.6, ang: ang, from: 'palm' });
  }
  // 2) 見つからなかった手：MoveNet の手首とひじから
  if (kp) for (const [wi, ei] of [[9, 7], [10, 8]]) {
    const W = kp[wi], E = kp[ei];
    if (W.s < 0.3 || E.s < 0.2) continue;
    if (starts.some(function (s0) { return Math.hypot(s0.cx - W.x, s0.cy - W.y) < s0.size * 0.6; })) continue;
    const fore = Math.hypot(W.x - E.x, W.y - E.y);
    if (fore < 10) continue;
    const ang = Math.atan2(W.y - E.y, W.x - E.x);
    starts.push({ cx: W.x + Math.cos(ang) * fore * 0.45, cy: W.y + Math.sin(ang) * fore * 0.45, size: fore * 1.9, ang: ang, from: 'pose' });
  }
  const hands = [];
  for (const st0 of starts) {
    let cx = st0.cx, cy = st0.cy, size = st0.size, ang = st0.ang, r = null;
    for (let it = 0; it < 2; it++) {
      r = await runHand(photo, cx, cy, size, ang);
      const P = r.pts;
      ang = Math.atan2(P[9][1] - P[0][1], P[9][0] - P[0][0]);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const q of P) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; size = Math.max(x1 - x0, y1 - y0) * 1.6;
    }
    // 手があるかの点数（Identity_1）が 0.5 以上なら使う
    hands.push({ pts: r.pts, score: [r.s0, r.s1], ok: r.s1 > 0.5, from: st0.from });
  }
  return hands;
}
// 写真の姿勢（17点）を写真の座標で
async function poseOnPhoto(photo) {
  if (!poseModel) return null;
  const sq = document.createElement('canvas'); sq.width = sq.height = 256;
  const sg = sq.getContext('2d'); sg.fillStyle = '#000'; sg.fillRect(0, 0, 256, 256);
  const ph = 256 * PHOTO_H / PHOTO_W, oy = (256 - ph) / 2;
  sg.drawImage(photo, 0, oy, 256, ph);
  const kp = await detectPose(sq);
  if (!kp) return null;
  return kp.map(function (k) { return { x: k.x * PHOTO_W, y: (k.y * 256 - oy) * PHOTO_W / 256, s: k.s }; });
}
// 手の21点を、人の形（細かい形 512×288）に塗り足す：指は骨にそった太い線、手のひらは多角形
function paintHands(mask, hands) {
  const out = Float32Array.from(mask);
  for (const hd of hands) {
    if (!hd.ok) continue;
    const P = hd.pts.map(function (q) { return [q[0] / 2, q[1] / 2]; });       // 写真 → 細かい形
    const w = Math.max(1.5, Math.hypot(P[5][0] - P[9][0], P[5][1] - P[9][1]) * 0.42);   // 指の太さの半分
    const cap = function (a, b, r) {
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)), x1 = Math.min(MASK_W - 1, Math.ceil(Math.max(a[0], b[0]) + r));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.min(MASK_H - 1, Math.ceil(Math.max(a[1], b[1]) + r));
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let u = ((x + 0.5 - a[0]) * vx + (y + 0.5 - a[1]) * vy) / L2; u = Math.max(0, Math.min(1, u));
        const dx = x + 0.5 - a[0] - u * vx, dy = y + 0.5 - a[1] - u * vy;
        if (dx * dx + dy * dy <= r * r) out[y * MASK_W + x] = 1;
      }
    };
    for (const b of HAND_BONES) cap(P[b[0]], P[b[1]], w);
    // 手のひら：0-1-5-9-13-17 を塗りつぶす（三角形に分けて）
    const poly = [0, 1, 5, 9, 13, 17].map(function (i) { return P[i]; });
    for (let t = 1; t < poly.length - 1; t++) {
      const A = poly[0], B = poly[t], Cc = poly[t + 1];
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], Cc[0]))), x1 = Math.min(MASK_W - 1, Math.ceil(Math.max(A[0], B[0], Cc[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], Cc[1]))), y1 = Math.min(MASK_H - 1, Math.ceil(Math.max(A[1], B[1], Cc[1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const d1 = (B[0] - A[0]) * (py - A[1]) - (B[1] - A[1]) * (px - A[0]);
        const d2 = (Cc[0] - B[0]) * (py - B[1]) - (Cc[1] - B[1]) * (px - B[0]);
        const d3 = (A[0] - Cc[0]) * (py - Cc[1]) - (A[1] - Cc[1]) * (px - Cc[0]);
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) out[y * MASK_W + x] = 1;
      }
    }
  }
  return out;
}

/* ===== 手のひらを見つける（MediaPipe の手のひら検出。2016 個の候補の枠を、決まった並びの「アンカー」から読み解く） ===== */
let PALM_ANCHORS = null;
function palmAnchors() {
  if (PALM_ANCHORS) return PALM_ANCHORS;
  // 192×192 の入力：8 画素ごと（24×24）に 2 個、16 画素ごと（12×12）に 6 個（3層ぶん）
  const out = [];
  for (const [stride, per] of [[8, 2], [16, 6]]) {
    const n = Math.ceil(192 / stride);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let k = 0; k < per; k++) out.push([(x + 0.5) / n, (y + 0.5) / n]);
  }
  PALM_ANCHORS = out;                               // 1152 + 864 = 2016
  return out;
}
// 画像の一部（src の x0,y0,w,h）を 192×192 に余白つきで入れて検出し、写真の座標で返す
async function palmDetectIn(photo, x0, y0, w, h) {
  const c = document.createElement('canvas'); c.width = c.height = 192;
  const g = c.getContext('2d');
  const k = 192 / Math.max(w, h), dw = w * k, dh = h * k, ox = (192 - dw) / 2, oy = (192 - dh) / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, 192, 192);
  g.drawImage(photo, x0, y0, w, h, ox, oy, dw, dh);
  const out = tf.tidy(function () { return palmModel.predict(tf.browser.fromPixels(c).toFloat().div(255).expandDims(0)); });
  const d = await out.data(); out.dispose();
  const A = palmAnchors(), res = [];
  for (let i = 0; i < 2016; i++) {
    const r = d.subarray(i * 19, i * 19 + 19);
    const sc = 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, r[0]))));
    if (sc < 0.5) continue;
    const toP = function (nx, ny) { return [x0 + (nx * 192 - ox) / k, y0 + (ny * 192 - oy) / k]; };
    const cx = r[1] / 192 + A[i][0], cy = r[2] / 192 + A[i][1], bw = r[3] / 192, bh = r[4] / 192;
    const kp = [];
    for (let j = 0; j < 7; j++) kp.push(toP(r[5 + j * 2] / 192 + A[i][0], r[6 + j * 2] / 192 + A[i][1]));
    res.push({ score: sc, c: toP(cx, cy), w: bw * 192 / k, h: bh * 192 / k, kp: kp });
  }
  return res;
}
// 写真全体と、縦横2つずつの4枚で手のひらを探し、重なりを除いて返す（遠くの小さな手も見つけるため）
async function palmDetect(photo) {
  if (!palmModel) return [];
  let all = await palmDetectIn(photo, 0, 0, PHOTO_W, PHOTO_H);
  const tw = PHOTO_W * 0.56, th = PHOTO_H * 0.56;
  for (const y0 of [0, PHOTO_H - th]) for (const x0 of [0, PHOTO_W - tw]) all = all.concat(await palmDetectIn(photo, x0, y0, tw, th));
  all.sort(function (a, b) { return b.score - a.score; });
  const keep = [];
  for (const a of all) {
    if (keep.some(function (b) { return Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) < Math.max(a.w, b.w) * 0.6; })) continue;
    keep.push(a);
    if (keep.length >= 4) break;
  }
  return keep;
}
