// 組体操の「静止ポーズ」と「触れ方」：形を作るときに使う姿勢の型（テンプレート）と、だれのどこに触れて支えられているか（接触）。
// 姿勢は skeleton.js の骨組み（骨の長さは固定）で表し、触れる手足は 2関節の逆運動学（stack.js の ik2・legTo・armTo）で
// 相手の体の線にぴったり合わせる。届かない時は「その置き方は無理」として捨てる（手足を伸ばして合わせることはしない）。
// made with Claude Opus 5.5
'use strict';

/* ===== 接触（だれの、どの部位に、どの手足で触れているか） =====
   { limb: 'ftF'|'ftB'|'knF'|'knB'|'haF'|'haB'|'hip', host: -1（床）か 相手の番号, part: 'floor'|'sh'|'torso'|'thighF'|'thighB'|'haF'|'haB', kind }
   kind：'support'＝体重をあずける（足・ひざ・手・お尻をのせる）／'hang'＝相手の手をつかんでぶら下がる・引っぱり合う／'hold'＝支える人が上の人の足首をつかむ（見た目だけ、支えには数えない）
   許す組み合わせ（表）：
     足  → 床・肩・背中（横になった胴）・もも（水平に近いもの）
     ひざ → 床・背中
     手  → 床・肩・背中・相手の手（つかむ）
     お尻 → 床・肩（肩車）・背中・もも
   見た目の一致：手足の線の端が、相手の体の線（または床）の表面に、線の太さの半分ずつ離れた位置にあること。許容誤差は CONTACT_TOL（作業用の画素）。 */
const LIMB_OK = {
  ftF: ['floor', 'sh', 'torso', 'thighF', 'thighB'], ftB: ['floor', 'sh', 'torso', 'thighF', 'thighB'],
  knF: ['floor', 'torso'], knB: ['floor', 'torso'],
  haF: ['floor', 'sh', 'torso', 'haF', 'haB'], haB: ['floor', 'sh', 'torso', 'haF', 'haB'],
  hip: ['floor', 'sh', 'torso', 'thighF', 'thighB']
};

// 相手の部位の「表面」：線分 [a,b] と、上向きの法線 n。手は点（つかむ）
function hostSurface(part, hp, hh) {
  if (part === 'sh') return { a: [hp.sh[0] - 0.1 * hh, hp.sh[1]], b: [hp.sh[0] + 0.1 * hh, hp.sh[1]], n: [0, -1] };   // 両肩（正面から見た幅）
  const seg = part === 'torso' ? [hp.hip, hp.neck] : part === 'thighF' ? [hp.hip, hp.knF] : part === 'thighB' ? [hp.hip, hp.knB] : null;
  if (!seg) return null;
  const vx = seg[1][0] - seg[0][0], vy = seg[1][1] - seg[0][1], L = Math.hypot(vx, vy) || 1;
  let n = [vy / L, -vx / L];
  if (n[1] > 0) n = [-n[0], -n[1]];
  return { a: seg[0], b: seg[1], n: n };
}
// 線分への最短点（u は 0〜1）
function closestOnSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9;
  let u = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2; u = Math.max(0, Math.min(1, u));
  return { u: u, q: [a[0] + u * vx, a[1] + u * vy] };
}
// 接触1つが画面上で成り立っているか。誤差（画素）を返す（Infinity は不成立）
function contactError(c, fig, figs) {
  const P = fig.pts[c.limb];
  const lwG = lineW(fig.h);
  if (c.host === -1) {
    const want = FLOOR_Y - lwG / 2;
    return Math.abs(P[1] - want);
  }
  const host = figs[c.host];
  if (!host || !host.pts) return Infinity;
  if (c.part === 'haF' || c.part === 'haB') {                       // つかむ：手と手（または手と足首）が重なる
    const q = host.pts[c.part];
    return Math.hypot(P[0] - q[0], P[1] - q[1]);
  }
  if (c.part === 'ftF' || c.part === 'ftB') {                       // 足首をつかむ（hold）
    const q = host.pts[c.part];
    return Math.hypot(P[0] - q[0], P[1] - q[1]);
  }
  const s = hostSurface(c.part, host.pts, host.h);
  if (!s) return Infinity;
  const cl = closestOnSeg(P, s.a, s.b);
  if ((cl.u <= 0.02 || cl.u >= 0.98) && c.part !== 'sh') return Infinity;   // 線の端から外れている
  const gap = (lineW(host.h) + lwG) / 2;
  const want = [cl.q[0] + s.n[0] * gap, cl.q[1] + s.n[1] * gap];
  return Math.hypot(P[0] - want[0], P[1] - want[1]);
}

/* ===== 関節の動く範囲 ===== */
function normDeg(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }
function jointsOK(p) {
  if (p.eF < -5 || p.eF > 155 || p.eB < -5 || p.eB > 155) return false;        // ひじ
  if (p.kF < -5 || p.kF > 160 || p.kB < -5 || p.kB > 160) return false;        // ひざ
  for (const a of [p.aF, p.aB]) { const n = normDeg(a); if (n < -80 && n > -140) return false; }   // 腕は背中側へは80°まで
  for (const l of [p.lF, p.lB]) { const fl = normDeg(l + p.t); if (fl < -45 || fl > 165) return false; }   // 股関節：後ろへ45°、前へ165°
  if (Math.abs(normDeg(p.lF - p.lB)) > 170) return false;
  return true;
}

/* ===== 置き方の部品 ===== */
// 姿勢 p の手足 limb の端が点 P に来るように、腰の位置を決める
function hipFor(p, h, f, limb, P) {
  const s = solve(p, 0, 0, h, f);
  return [P[0] - s[limb][0], P[1] - s[limb][1]];
}
// 足場（site）に limb を置くとき、その端が来るべき点（相手の線の表面から、線の太さの半分ずつ離す）
function contactPoint(site, h, along) {
  const gap = (site.lw + lineW(h)) / 2;
  const base = along === undefined ? site.pt : [site.pt[0] + site.t[0] * along, site.pt[1] + site.t[1] * along];
  return [base[0] + site.n[0] * gap, base[1] + site.n[1] * gap];
}
function ikReach(root, target, L1, L2) {
  const d = Math.hypot(target[0] - root[0], target[1] - root[1]);
  return d <= (L1 + L2) * 0.995 && d >= Math.abs(L1 - L2) + 0.02 * (L1 + L2);
}
function legReach(hip, foot, h) { return ikReach(hip, foot, BONE.thigh * h, BONE.shin * h); }
function armReach(sh, hand, h) { return ikReach(sh, hand, BONE.upper * h, BONE.fore * h); }
// 手をつなぐ点：自分の肩 a（届く長さ ra）と相手の肩 b（rb）の間で、それぞれの届く長さに比例した位置
function meetPoint(a, ra, b, rb) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d > (ra + rb) * 0.97 || d < Math.max(ra, rb) * 0.3) return null;
  const k = ra / (ra + rb);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
function C(limb, site, kind) { return { limb: limb, host: site.host, part: site.part, kind: kind || 'support' }; }

/* ===== 静止ポーズの型 =====
   どれも (足場, 身長 h, 向き f, 変化 v) → { pose, hx, hy, contacts } か null。
   1か所の足場に置く型（one）と、2か所にまたがる型（two）がある。
   向き f：1＝右向き、-1＝左向き。手足のうち接触に使わないもの（自由な手足）は、あとで形に合わせて角度を選ぶ。 */
const TEMPLATES = {
  // 肩から少し横へずれて立つ。斜めの脚や腕を、縦の塔で途切れさせずに追う。
  // 足は肩に残し、腰のずれは固定長の脚の逆運動学で吸収する。
  step: { sites: ['floor', 'sh', 'torso', 'thigh'], variants: [0.16, 0.28], one: function (S, h, f, v) {
    const P = contactPoint(S, h), sp = S.part === 'sh' ? Math.min(0.085 * S.hostH, 0.12 * h) : 0.035 * h;
    const dy = Math.sqrt(Math.max(0, Math.pow(HIP_TO_FOOT * h * 0.96, 2) - Math.pow(v * h + sp, 2)));
    const hip = [P[0] + f * v * h, P[1] - dy];
    const p = pose({ t: v > 0.2 ? 20 : 12, hd: -8, aF: 65, aB: -65 });
    const a = [P[0] + f * sp, P[1]], b = [P[0] - f * sp, P[1]];
    if (!legReach(hip, a, h) || !legReach(hip, b, h)) return null;
    legTo(p, hip, a, h, f, 'F'); legTo(p, hip, b, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('ftF', S), C('ftB', S)] };
  } },
  // 立つ（前傾・後傾つき）。足場：床・肩・背中・もも
  stand: { sites: ['floor', 'sh', 'torso', 'thigh'], variants: [0, 14, -12], one: function (S, h, f, v) {
    const p = pose({ t: v, hd: -v * 0.5 });
    const P = contactPoint(S, h);
    const hip = [P[0] - f * Math.sin(v * RAD) * 0.05 * h, P[1] - HIP_TO_FOOT * h * 0.965];
    // 肩の上では、両足を相手の左右の肩にのせる（相手の頭が足の間に見える）
    const sp = S.part === 'sh' ? Math.min(0.085 * S.hostH, 0.12 * h) : 0.035 * h;
    const fF = [P[0] + f * sp, P[1]], fB = [P[0] - f * sp, P[1]];
    if (!legReach(hip, fF, h) || !legReach(hip, fB, h)) return null;
    legTo(p, hip, fF, h, f, 'F'); legTo(p, hip, fB, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('ftF', S), C('ftB', S)] };
  } },
  // しゃがむ（ももが水平に近く、上に人を立たせられる＝サボテンの土台）
  squat: { sites: ['floor', 'torso'], variants: [0], one: function (S, h, f) {
    const p = pose({ t: 32, hd: -20 });
    const P = contactPoint(S, h);
    const hip = [P[0] - f * 0.17 * h, P[1] - 0.2 * h];
    const fF = [P[0] + f * 0.03 * h, P[1]], fB = [P[0] - f * 0.01 * h, P[1]];
    if (!legReach(hip, fF, h) || !legReach(hip, fB, h)) return null;
    legTo(p, hip, fF, h, f, 'F'); legTo(p, hip, fB, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('ftF', S), C('ftB', S)] };
  } },
  // ひざ立ち（ももは垂直、すねは後ろに水平）
  kneel: { sites: ['floor', 'torso'], variants: [0, 20], one: function (S, h, f, v) {
    const p = pose({ t: v, lF: 0, kF: 90, lB: 0, kB: 90 });
    const P = contactPoint(S, h);
    const hip = hipFor(p, h, f, 'knF', P);
    const c = [C('knF', S), C('knB', S)];
    if (S.part === 'floor') c.push(C('ftF', S), C('ftB', S));
    return { pose: p, hx: hip[0], hy: hip[1], contacts: c };
  } },
  // お尻をついて座る：脚を前に伸ばす（L字）／体育座り（ひざを立てる）
  sit: { sites: ['floor', 'sh', 'torso', 'thigh'], variants: [0, 1], one: function (S, h, f, v) {
    const P = contactPoint(S, h);
    if (v === 0) {
      const p = pose({ t: -8, lF: 88, kF: 0, lB: 86, kB: 0 });
      const c = [C('hip', S)];
      if (S.part === 'floor') c.push(C('ftF', S), C('ftB', S));
      if (S.part === 'sh') { p.lF = 70; p.kF = 75; p.lB = 64; p.kB = 80; }   // 肩車：脚は相手の胸の前に下ろす
      const hip = P;
      if (S.part === 'floor') {                                      // 床では脚も床に：かかとが床に着く角度に
        p.lF = p.lB = 90 - Math.asin(lineW(h) * 0 / h) / RAD;
      }
      return { pose: p, hx: hip[0], hy: hip[1], contacts: c };
    }
    if (S.part !== 'floor') return null;
    const p = pose({ t: 6, hd: 0 });
    const hip = P, fF = [P[0] + f * 0.3 * h, P[1]], fB = [P[0] + f * 0.27 * h, P[1]];
    if (!legReach(hip, fF, h) || !legReach(hip, fB, h)) return null;
    legTo(p, hip, fF, h, f, 'F'); legTo(p, hip, fB, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('hip', S), C('ftF', S), C('ftB', S)] };
  } },
  // 倒立（胴は逆さま。脚：そろえる・開く・大きく開く）。足場：床・肩・背中
  handstand: { sites: ['floor', 'sh', 'torso'], variants: [4, 35, 60], one: function (S, h, f, v) {
    const p = pose({ t: 180, hd: 0, aF: 180, eF: 0, aB: 180, eB: 0, lF: 180 + v, kF: 0, lB: 180 - v, kB: 0 });
    const P = contactPoint(S, h);
    const hF = [P[0] + f * 0.03 * h, P[1]], hB = [P[0] - f * 0.03 * h, P[1]];
    const hip = hipFor(p, h, f, 'haF', hF);
    const s = solve(p, hip[0], hip[1], h, f);
    if (!armReach(s.sh, hB, h)) return null;
    armTo(p, s.sh, hB, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('haF', S), C('haB', S)] };
  } },
  // ぶら下がる：相手の手を両手でつかむ（脚：まっすぐ・L字・開く）
  // ぶら下がる：相手の手を両手でつかむ。ぶら下がっている人の足首をつかんで、さらに下へつながる（垂れた腕の形）
  hang: { sites: ['hand', 'ankle'], variants: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], one: function (S, h, f, v) {
    const legs = [{ lF: 4, kF: 6, lB: -4, kB: 10 }, { lF: 85, kF: 0, lB: 80, kB: 0 }, { lF: 40, kF: 0, lB: -40, kB: 0 }][Math.floor(v / 4)];
    if (S.cls === 'ankle') {
      if (v % 4) return null;
      const p0 = pose(Object.assign({ t: 0, hd: 0, aF: 178, eF: 0, aB: 182, eB: 0 }, legs));
      const hip0 = hipFor(p0, h, f, 'haF', S.pt);
      return { pose: p0, hx: hip0[0], hy: hip0[1], contacts: [C('haF', S, 'hang'), C('haB', S, 'hang')], mod: null };
    }
    const ang = [0, 180, -40, -140][v % 4] * RAD;                   // 相手の肩から見た、つなぐ手の向き（横・横・斜め上・斜め上）
    const Q = [S.pt[0] + Math.cos(ang) * S.R * 0.88, S.pt[1] + Math.sin(ang) * S.R * 0.88];
    const p = pose(Object.assign({ t: 0, hd: 0, aF: 178, eF: 0, aB: 182, eB: 0 }, legs));
    const hip = hipFor(p, h, f, 'haF', Q);
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('haF', S, 'hang'), C('haB', S, 'hang')], mod: { host: S.host, side: S.side, Q: Q } };
  } },
  // 旗：相手の手を両手でつかみ、体を横に伸ばす（頭は相手の側、足は外。水平・少し上・少し下）
  flag: { sites: ['hand', 'ankle', 'sh'], variants: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], one: function (S, h, f0, v) {
    const ankle = S.cls === 'ankle', shoulder = S.cls === 'sh';   // 足首をつかむ／肩につかまる（相手の腕は動かさない）
    if ((ankle || shoulder) && v % 4 > 1) return null;
    const ang = (ankle ? (S.dir > 0 ? 0 : 180) : [0, 180, -40, -140][v % 4]) * RAD;
    const Q = ankle ? S.pt : shoulder ? contactPoint(S, h, Math.cos(ang) * 0.08 * S.hostH) : [S.pt[0] + Math.cos(ang) * S.R * 0.88, S.pt[1] + Math.sin(ang) * S.R * 0.88];
    const dir = Math.cos(ang) > 0 ? 1 : -1, al = [0, 20, -20][Math.floor(v / 4)];
    if (f0 !== -dir) return null;                                   // 相手の方を向く
    const f = -dir;
    const p = pose({ t: 90 + al, hd: 0, aF: 180, eF: 0, aB: 180, eB: 0, lF: -(90 + al) + 4, kF: 0, lB: -(90 + al) - 4, kB: 6 });
    const hip = hipFor(p, h, f, 'haF', Q);
    const s = solve(p, hip[0], hip[1], h, f);
    const QB = ankle ? Q : shoulder ? [Q[0] - Math.cos(ang) * 0.02 * h, Q[1]] : [Q[0], Q[1] + 0.012 * h];
    if (!armReach(s.sh, QB, h)) return null;
    armTo(p, s.sh, QB, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('haF', S, 'hang'), C('haB', S, 'hang')], mod: ankle || shoulder ? null : { host: S.host, side: S.side, Q: Q } };
  } }
};

// 2か所にまたがる型：(足場1, 足場2, h, f, v)
const TEMPLATES2 = {
  // 2人の肩（背中・もも）に片足ずつ
  straddle: { a: ['sh', 'torso', 'thigh', 'floor'], b: ['sh', 'torso', 'thigh', 'floor'], variants: [0], two: function (A, B, h, f) {
    if (A.part === 'floor' && B.part === 'floor') return null;
    const PA = contactPoint(A, h), PB = contactPoint(B, h);
    const d = Math.hypot(PB[0] - PA[0], PB[1] - PA[1]);
    if (d < 0.1 * h || d > 0.72 * h || Math.abs(PB[0] - PA[0]) < 0.08 * h) return null;
    const mid = [(PA[0] + PB[0]) / 2, Math.min(PA[1], PB[1])];
    const L = HIP_TO_FOOT * h * 0.95;
    const hip = [mid[0], mid[1] - Math.sqrt(Math.max(0, L * L - (d / 2) * (d / 2))) + Math.abs(PB[1] - PA[1]) * 0.5];
    const front = (PB[0] - PA[0]) * f > 0 ? [PB, B] : [PA, A], back = front[1] === A ? [PB, B] : [PA, A];
    if (!legReach(hip, front[0], h) || !legReach(hip, back[0], h)) return null;
    const p = pose({ t: 0 });
    legTo(p, hip, front[0], h, f, 'F'); legTo(p, hip, back[0], h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('ftF', front[1]), C('ftB', back[1])] };
  } },
  // 四つんばい：ひざを A（腰の下）、手を B（肩の下）に。腕ともも はできるだけ垂直、背中は平ら（静岡県教委の資料の条件）
  table: { a: ['floor', 'torso'], b: ['floor', 'torso', 'sh'], variants: [0], two: function (A, B, h, f) {
    const K = contactPoint(A, h), H = contactPoint(B, h);
    if ((H[0] - K[0]) * f < 0.15 * h) return null;
    const hip = [K[0], K[1] - BONE.thigh * h];
    const r = (BONE.torso - 0.02) * h, dx = H[0] - hip[0];
    if (Math.abs(dx) > r * 1.6) return null;
    let sx = Math.abs(dx) <= r ? H[0] : hip[0] + Math.sign(dx) * r * 0.97;
    let sy = hip[1] - Math.sqrt(Math.max(0, r * r - (sx - hip[0]) * (sx - hip[0])));
    if (sy < H[1] - (BONE.upper + BONE.fore) * h * 0.995) sy = H[1] - (BONE.upper + BONE.fore) * h * 0.99;
    const ux = (sx - hip[0]) / r, uy = (sy - hip[1]) / r;
    const t = Math.atan2(ux * f, -uy) / RAD;
    const p = pose({ t: t, hd: -25, lF: 0, kF: 90, lB: 0, kB: 90 });
    const s = solve(p, hip[0], hip[1], h, f);
    const hF = [H[0] + f * 0.015 * h, H[1]], hB = [H[0] - f * 0.015 * h, H[1]];
    if (!armReach(s.sh, hF, h) || !armReach(s.sh, hB, h)) return null;
    armTo(p, s.sh, hF, h, f, 'F'); armTo(p, s.sh, hB, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('knF', A), C('knB', A), C('haF', B), C('haB', B)] };
  } },
  // 板（うつぶせに体を伸ばし、手を A、足を B に）＝橋・腕立て。床の上では腕立て伏せ
  plank: { a: ['floor', 'sh', 'torso', 'thigh', 'hand'], b: ['floor', 'sh', 'torso', 'thigh'], variants: [0], two: function (A, B, h, f) {
    const gripA = A.cls === 'hand';
    const PB = contactPoint(B, h);
    const full = (BONE.upper + BONE.fore + BONE.torso - 0.02 + HIP_TO_FOOT) * h;
    let PA;
    if (gripA) {                                                   // 相手の肩の方へ体を伸ばし、相手の手とつなぐ
      const D = Math.hypot(A.pt[0] - PB[0], A.pt[1] - PB[1]);
      const dd = Math.max(full * 0.5, Math.min(full * 0.97, D - A.R * 0.7));
      PA = [PB[0] + (A.pt[0] - PB[0]) / D * dd, PB[1] + (A.pt[1] - PB[1]) / D * dd];
      const r = Math.hypot(PA[0] - A.pt[0], PA[1] - A.pt[1]);
      if (r > A.R || r < A.R * 0.3) return null;
    } else PA = contactPoint(A, h);
    if ((PA[0] - PB[0]) * f <= 0) return null;                       // 手の側を向く
    const d = Math.hypot(PA[0] - PB[0], PA[1] - PB[1]);
    if (d > full * 0.97 || d < full * 0.5) return null;
    if (Math.abs(PA[1] - PB[1]) > d * 0.6) return null;
    const slack = full - d;
    const armD = (BONE.upper + BONE.fore) * h - slack * 0.35, legD = HIP_TO_FOOT * h - slack * 0.65;
    const ux = (PA[0] - PB[0]) / d, uy = (PA[1] - PB[1]) / d;
    const sh = [PA[0] - ux * armD, PA[1] - uy * armD], hip = [sh[0] - ux * (BONE.torso - 0.02) * h, sh[1] - uy * (BONE.torso - 0.02) * h];
    const t = Math.atan2(ux * f, -uy) / RAD;
    const p = pose({ t: t, hd: -t * 0.6 });
    if (!legReach(hip, PB, h) || !armReach(sh, PA, h)) return null;
    legTo(p, hip, [PB[0] + f * 0.01 * h, PB[1]], h, f, 'F'); legTo(p, hip, [PB[0] - f * 0.01 * h, PB[1]], h, f, 'B');
    const s = solve(p, hip[0], hip[1], h, f);
    armTo(p, s.sh, PA, h, f, 'F'); armTo(p, s.sh, [PA[0] - f * 0.012 * h, PA[1]], h, f, 'B');
    const kind = gripA ? 'hang' : 'support';
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('haF', A, kind), C('haB', A, kind), C('ftF', B), C('ftB', B)], mod: gripA ? { host: A.host, side: A.side, Q: PA } : null };
  } },
  // 扇（体を外へ傾ける）：足を A に置き、片手で B（相手の手・肩）をつかむ／押す。傾きは v 度
  lean: { a: ['floor', 'sh', 'torso', 'thigh'], b: ['hand', 'sh'], variants: [30, 50, 70], two: function (A, B, h, f, v) {
    const P = contactPoint(A, h);
    const grip = B.cls === 'hand';
    const Qs = grip ? B.pt : contactPoint(B, h);
    // 体は、つかむ相手と反対側（外）へ倒れる：f は外向き
    if ((Qs[0] - P[0]) * f > 0.1 * h) return null;
    const p = pose({ t: v, hd: -v * 0.4, lF: -v + 4, lB: -v - 4, kF: 0, kB: 0 });
    const hip = [P[0] - Math.sin(-v * RAD) * f * HIP_TO_FOOT * h * 0.97, P[1] - Math.cos(v * RAD) * HIP_TO_FOOT * h * 0.97];
    const fF = [P[0] + f * 0.02 * h, P[1]], fB = [P[0] - f * 0.02 * h, P[1]];
    if (!legReach(hip, fF, h) || !legReach(hip, fB, h)) return null;
    legTo(p, hip, fF, h, f, 'F'); legTo(p, hip, fB, h, f, 'B');
    const s = solve(p, hip[0], hip[1], h, f);
    const Q = grip ? meetPoint(s.sh, (BONE.upper + BONE.fore) * h * 0.96, B.pt, B.R) : Qs;
    if (!Q || !armReach(s.sh, Q, h)) return null;
    armTo(p, s.sh, Q, h, f, 'B');
    return { pose: p, hx: hip[0], hy: hip[1], contacts: [C('ftF', A), C('ftB', A), C('haB', B, grip ? 'hang' : 'support')], mod: grip ? { host: B.host, side: B.side, Q: Q } : null };
  } }
};

/* ===== 足場（site）：今いる人の体のうち、ほかの人が触れられる所 =====
   { host, part, pt（表面の点）, n（上向きの法線）, t（表面に沿う向き）, lw（相手の線の太さ）, cls（stand 系：'floor'|'sh'|'torso'|'thigh'／つかむ：'hand'） } */
function sitesOf(fig) {
  const out = [], p = fig.pts, h = fig.h, lw = lineW(h);
  const upAng = Math.atan2(p.neck[0] - p.hip[0], -(p.neck[1] - p.hip[1])) / RAD;   // 胴の傾き（0＝まっすぐ上）
  if (Math.abs(upAng) <= 30) out.push({ host: fig.id, part: 'sh', pt: p.sh, n: [0, -1], t: [1, 0], lw: lw, cls: 'sh', hostH: h });
  const flat = function (a, b) { return Math.abs(Math.atan2(b[1] - a[1], Math.abs(b[0] - a[0])) / RAD) <= 32; };
  const segSites = function (part, a, b, us) {
    if (!flat(a, b)) return;
    const s = hostSurface(part, p, h);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), tv = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    us.forEach(function (u) { out.push({ host: fig.id, part: part, u: u, pt: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], n: s.n, t: tv, lw: lw, cls: part === 'torso' ? 'torso' : 'thigh' }); });
  };
  segSites('torso', p.hip, p.neck, [0.15, 0.5, 0.85]);
  if (!fig.used || !fig.used.thighF) segSites('thighF', p.hip, p.knF, [0.6, 0.9]);
  if (!fig.used || !fig.used.thighB) segSites('thighB', p.hip, p.knB, [0.6, 0.9]);
  // 旗・ぶら下がりの人の足首：次の人がつかんで、外へ続けられる（ただし張り出しの深さは 2 まで）
  if (fig.tpl === 'flag' || fig.tpl === 'hang') {
    const dir = Math.sign(p.hip[0] - p.neck[0]) || 1;
    ['ftF', 'ftB'].forEach(function (k) {
      if (!fig.used || !fig.used[k]) out.push({ host: fig.id, part: k, pt: p[k], dir: dir, lw: lw, n: [0, -1], t: [1, 0], cls: 'ankle' });
    });
  }
  // 手をつなぐ相手：自由な腕は、つかみに来た人の手まで伸ばす（届く範囲 R の中ならどこでも）
  ['F', 'B'].forEach(function (sd) {
    if (fig.freeLimb && fig.freeLimb['ha' + sd]) out.push({ host: fig.id, part: 'ha' + sd, side: sd, pt: p.sh, R: (BONE.upper + BONE.fore) * h * 0.96, lw: lw, n: [0, -1], t: [1, 0], cls: 'hand' });
  });
  return out;
}
function floorSite(x) { return { host: -1, part: 'floor', pt: [x, FLOOR_Y], n: [0, -1], t: [1, 0], lw: 0, cls: 'floor' }; }

/* ===== 確かめる ===== */
// 1人の骨組み・接触の確認：関節の範囲・床より下に出ない・接触の誤差
function figureOK(fig, figs) {
  if (!jointsOK(fig.pose)) return 'joint';
  const p = fig.pts, lw = lineW(fig.h);
  for (const k in p) if (p[k][1] > FLOOR_Y - lw / 2 + CONTACT_TOL || p[k][0] < 2 || p[k][0] > STAGE_W - 2 || p[k][1] < 2) return 'bounds';
  if (p.head[1] + BONE.head * fig.h > FLOOR_Y + CONTACT_TOL) return 'bounds';
  for (const c of fig.contacts) if (contactError(c, fig, figs) > CONTACT_TOL) return 'contact:' + c.limb + '>' + c.part;
  return null;
}
// 全員が床までたどれるか（support と hang の接触だけをたどる。hold は数えない）。たどれない人の番号を返す
function ungrounded(figs) {
  const ok = new Set(), list = figs.filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of list) {
      if (ok.has(f.id)) continue;
      if (f.contacts.some(function (c) { return c.kind !== 'hold' && (c.host === -1 || ok.has(c.host)); })) { ok.add(f.id); changed = true; }
    }
  }
  return list.filter(function (f) { return !ok.has(f.id); }).map(function (f) { return f.id; });
}
// 張り出しの深さ：足やひざ・お尻で立つ（座る）人は 0、手だけでつかまっている（ぶら下がり・扇）人は「つかんだ相手 +1」
function overhang(fig, figs, memo) {
  memo = memo || {};
  if (memo[fig.id] !== undefined) return memo[fig.id];
  memo[fig.id] = 9;
  const own = fig.contacts.filter(function (c) { return c.kind === 'support' && c.limb !== 'haF' && c.limb !== 'haB'; });
  const tpl = fig.tpl;
  let v;
  if (tpl === 'hang' || tpl === 'flag') v = 1 + Math.min.apply(null, fig.contacts.filter(function (c) { return c.kind === 'hang'; }).map(function (c) { return c.host === -1 ? 0 : overhang(figs[c.host], figs, memo); }));
  else if (tpl === 'lean') v = 1 + Math.min.apply(null, fig.contacts.filter(function (c) { return c.limb === 'haB'; }).map(function (c) { return c.host === -1 ? 0 : overhang(figs[c.host], figs, memo); }));
  else v = own.length || tpl === 'handstand' || tpl === 'table' || tpl === 'plank' ? 0 : 1;
  memo[fig.id] = v;
  return v;
}
