// 棒人間の骨組み：関節の角度（ポーズ）から各関節の位置を計算し、手描き風の黒い線で描く。
// made with Claude Opus 5.5
'use strict';

// 体の各部分の長さ（身長 h に対する割合）
const BONE = { torso: 0.30, neck: 0.05, head: 0.075, upper: 0.15, fore: 0.14, thigh: 0.22, shin: 0.22 };
// 立ったとき：腰から足の裏まで 0.44h、腰から肩まで 0.30h
const HIP_TO_FOOT = BONE.thigh + BONE.shin;
const SHOULDER_FROM_FOOT = HIP_TO_FOOT + BONE.torso;

// ポーズの項目（角度は度。0＝真下、＋＝向いている方向へ回す）
// t：上半身の傾き／hd：頭／aB,eB：奥の腕（肩・ひじ）／aF,eF：手前の腕／
// lB,kB：奥の足（もも・ひざ）／lF,kF：手前の足／dy：腰の上下（h単位、＋で下）／dx：腰の前後／rot：体全体の回転
const POSE_KEYS = ['t', 'hd', 'aB', 'eB', 'aF', 'eF', 'lB', 'kB', 'lF', 'kF', 'dy', 'dx', 'rot'];
const NEUTRAL = { t: 0, hd: 0, aB: 8, eB: 6, aF: -8, eF: 6, lB: 3, kB: 0, lF: -3, kF: 0, dy: 0, dx: 0, rot: 0 };

function pose(p) { return Object.assign({}, NEUTRAL, p); }

function lerpPose(a, b, k) {
  const r = {};
  for (const key of POSE_KEYS) r[key] = a[key] + (b[key] - a[key]) * k;
  return r;
}

const RAD = Math.PI / 180;
// 角度 deg（0＝下）と向き f から、画面上の向き（y は下が正）
function dirOf(deg, f) { return [Math.sin(deg * RAD) * f, Math.cos(deg * RAD)]; }

// 関節の位置を計算する。x,y は腰の位置、h は身長、f は向き（1＝右、-1＝左）
function solve(p, x, y, h, f) {
  const hip = [x + p.dx * h * f, y + p.dy * h];
  // 上半身：t＞0 で首が前へ（上向きの線を前に倒す）
  const up = dirOf(180 - p.t, f);
  const neck = [hip[0] + up[0] * BONE.torso * h, hip[1] + up[1] * BONE.torso * h];
  const hdir = dirOf(180 - (p.t + p.hd), f);
  const head = [neck[0] + hdir[0] * (BONE.neck + BONE.head) * h, neck[1] + hdir[1] * (BONE.neck + BONE.head) * h];
  const sh = [neck[0] - up[0] * 0.02 * h, neck[1] - up[1] * 0.02 * h];
  const arm = function (a, e) {
    // 腕の角度 a は「上半身の下向き（＝ -t）」からの角度
    const d1 = dirOf(a - p.t, f), d2 = dirOf(a - p.t + e, f);
    const el = [sh[0] + d1[0] * BONE.upper * h, sh[1] + d1[1] * BONE.upper * h];
    return [el, [el[0] + d2[0] * BONE.fore * h, el[1] + d2[1] * BONE.fore * h]];
  };
  const leg = function (l, k) {
    const d1 = dirOf(l, f), d2 = dirOf(l - k, f);
    const kn = [hip[0] + d1[0] * BONE.thigh * h, hip[1] + d1[1] * BONE.thigh * h];
    return [kn, [kn[0] + d2[0] * BONE.shin * h, kn[1] + d2[1] * BONE.shin * h]];
  };
  const [elB, haB] = arm(p.aB, p.eB), [elF, haF] = arm(p.aF, p.eF);
  const [knB, ftB] = leg(p.lB, p.kB), [knF, ftF] = leg(p.lF, p.kF);
  const pts = { hip, neck, head, sh, elB, haB, elF, haF, knB, ftB, knF, ftF };
  // 体全体の回転（宙返り・倒立など）は腰を中心に
  if (p.rot) {
    const c = Math.cos(p.rot * RAD * f), s = Math.sin(p.rot * RAD * f);
    for (const k in pts) {
      if (k === 'hip') continue;
      const v = pts[k], dx = v[0] - hip[0], dy = v[1] - hip[1];
      pts[k] = [hip[0] + dx * c - dy * s, hip[1] + dx * s + dy * c];
    }
  }
  return pts;
}

// 手描き風のゆれ：3コマに1回だけ変わる、人ごとに違う小さなずれ
function wobble(seed, frame, k) {
  const v = Math.sin(seed * 12.9898 + Math.floor(frame / 3) * 78.233 + k * 37.719) * 43758.5453;
  return (v - Math.floor(v)) - 0.5;
}

// 描く（線は呼び出し側でまとめて stroke する。頭は heads にまとめて fill）
function drawFigure(ctx, heads, pts, h, seed, frame) {
  const j = h * 0.012;
  const P = function (v, k) { return [v[0] + wobble(seed, frame, k) * j, v[1] + wobble(seed, frame, k + 50) * j]; };
  const seg = function (a, b, k) { const p1 = P(a, k), p2 = P(b, k + 1); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); };
  const hip = P(pts.hip, 1), neck = P(pts.neck, 2), sh = P(pts.sh, 3);
  ctx.moveTo(hip[0], hip[1]); ctx.lineTo(neck[0], neck[1]);
  // 腕と足（関節で折れる線）
  const limb = function (root, mid, end, k) {
    const m = P(mid, k), e = P(end, k + 1);
    ctx.moveTo(root[0], root[1]); ctx.lineTo(m[0], m[1]); ctx.lineTo(e[0], e[1]);
  };
  limb(sh, pts.elB, pts.haB, 10); limb(sh, pts.elF, pts.haF, 20);
  limb(hip, pts.knB, pts.ftB, 30); limb(hip, pts.knF, pts.ftF, 40);
  const hd = P(pts.head, 60), r = BONE.head * h;
  heads.moveTo(hd[0] + r, hd[1]);
  heads.arc(hd[0], hd[1], r, 0, Math.PI * 2);
}
