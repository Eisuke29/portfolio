// 手足の角度の計算（2関節の逆運動学）：腰から足、肩から手を、決めた点にぴったり届かせる角度を求める。
'use strict';

const RAD2 = Math.PI / 180;

/* ===== 2関節の逆運動学：根元 root から先 target へ、長さ L1・L2 の2本で届く角度 =====
   返り値：[1本目の向き, 2本目の向き]（度。0＝真下、＋＝向いている方向 f へ）。bend：曲げる側（+1 前／-1 後ろ） */
function ik2(root, target, L1, L2, f, bend) {
  const dx = (target[0] - root[0]) * f, dy = target[1] - root[1];
  let d = Math.hypot(dx, dy);
  d = Math.min(d, (L1 + L2) * 0.999);
  const base = Math.atan2(dx, dy) / RAD2;                       // 真下から前へ
  const c1 = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const a1 = Math.acos(Math.max(-1, Math.min(1, c1))) / RAD2;
  const c2 = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
  const a2 = 180 - Math.acos(Math.max(-1, Math.min(1, c2))) / RAD2;
  const first = base + bend * a1;
  return [first, first - bend * a2];
}
// 脚を足の位置に合わせる（ひざは前に出る）
function legTo(p, hip, foot, h, f, which) {
  const [th, sh] = ik2(hip, foot, BONE.thigh * h, BONE.shin * h, f, 1);
  p['l' + which] = th; p['k' + which] = th - sh;
}
// 腕を手の位置に合わせる（ひじは下・後ろに出る）
function armTo(p, shoulder, hand, h, f, which) {
  const [ua, fa] = ik2(shoulder, hand, BONE.upper * h, BONE.fore * h, f, -1);
  p['a' + which] = ua + p.t; p['e' + which] = fa - ua;
}
