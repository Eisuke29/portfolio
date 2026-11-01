// 実データの動き（mocap_data.js）を再生する：時刻 → ポーズ。誇張の倍率もここで掛ける。
// made with Claude Opus 5.5
'use strict';

const EXAGGERATION = 3;   // 誇張の倍率（ユーザーが比較ページで選んだ値）

// 動きごとの角度の平均（ふり幅を広げる中心）
const MOCAP_MEAN = {};
for (const name in MOCAP) {
  const f = MOCAP[name].frames, m = MOCAP_KEYS.map(function () { return 0; });
  f.forEach(function (row) { row.forEach(function (v, i) { m[i] += v / f.length; }); });
  MOCAP_MEAN[name] = m;
}
const KI = {};
MOCAP_KEYS.forEach(function (k, i) { KI[k] = i; });

function mocapLength(name) { return MOCAP[name].frames.length / MOCAP[name].fps; }

// 時刻 time（秒）のデータの行（前後のコマを混ぜる）。くり返す動きは周期で回し、進んだ距離は周回ぶん足す
function mocapRow(name, time) {
  const c = MOCAP[name], f = c.frames, len = f.length / c.fps;
  let t = time, laps = 0;
  if (c.loop) { laps = Math.floor(t / len); t -= laps * len; } else t = Math.min(Math.max(t, 0), len - 1e-6);
  const xf = t * c.fps, i = Math.floor(xf), u = xf - i;
  const a = f[i % f.length], b = c.loop ? f[(i + 1) % f.length] : f[Math.min(i + 1, f.length - 1)];
  const row = a.map(function (v, k) { return v + (b[k] - v) * u; });
  if (c.loop && laps) row[KI.x] += laps * (f[f.length - 1][KI.x] - f[0][KI.x]);
  return row;
}

// データの行 → 棒人間のポーズ（誇張つき）。x,y は進んだ距離と腰の高さ（身長比）
function mocapPose(name, time, k) {
  k = k || EXAGGERATION;
  const row = mocapRow(name, time), m = MOCAP_MEAN[name], limb = 1 + (k - 1) * 0.5;
  const p = { dx: 0, rot: 0 };
  MOCAP_KEYS.forEach(function (key, i) {
    // 上半身：小さい傾き（走る前傾など）は k 倍、大きい曲げ（踏み切り・起き上がる）ほど 1 倍に近づける
    if (key === 't') p.t = row[i] * (1 + (k - 1) * Math.exp(-Math.pow(row[i] / 30, 2)));
    else if (key === 'dy') p.dy = row[i] * k;
    else if (key === 'x' || key === 'y') p[key] = row[i];
    else p[key] = m[i] + (row[i] - m[i]) * limb;
  });
  p.kB = Math.min(165, p.kB); p.kF = Math.min(165, p.kF);
  return p;
}

// 腕だけを別の動きから重ねる（腕の角度は上半身が基準なので、胴と足の動きと組み合わせても崩れない）
// 例：mocapLayered('run', t, 'wave', t) → 足と胴は「走る」、腕は「手を振る」。w は重ねる強さ（0〜1）
const ARM_KEYS = ['aB', 'eB', 'aF', 'eF'];
function mocapLayered(bodyName, bodyTime, armName, armTime, w) {
  const p = mocapPose(bodyName, bodyTime);
  if (!armName) return p;
  const a = mocapPose(armName, armTime);
  const k = w === undefined ? 1 : w;
  ARM_KEYS.forEach(function (key) { p[key] = p[key] + (a[key] - p[key]) * k; });
  return p;
}
// 決まった腕の形（数値で指定）を重ねる：組体操で「両手を上に」「腕を横に」など
function withArms(p, arms, w) {
  const k = w === undefined ? 1 : w;
  ARM_KEYS.forEach(function (key) { if (arms[key] !== undefined) p[key] = p[key] + (arms[key] - p[key]) * k; });
  return p;
}
