/* =========================================================
   チャンバラ -RING OUT-（Web版・スマホ専用）
   チームで作った Processing 版（chambara_client.pde のローカルモード）を p5.js に書き直したもの。
   本来の作品との違い：
   ・剣型コントローラー（Arduino＋MPU-6050）の代わりに、スマホの加速度・ジャイロを使う
     （傾きの段階分けと振りの判定は、Arduino のプログラムと同じ考え方・同じ数値）
   ・ネットワーク対戦の代わりに、コンピューター（CPU）と対戦する
   ・スマホを傾けても、画面の中の世界が地面に対してまっすぐ見えるように、画面を逆に回す
     （「剣だけ傾く」に切り替えると画面は回さない。2つの見え方を比べるための試作）
   ・斬る操作は、画面の「斬る」ボタン（連打防止の待ち時間つき）か、スマホを振る方式を選べる
   ========================================================= */

// ---------- ルール・見た目の数値（元のコードと同じ） ----------
const P1 = 1;               // あなた
const P2 = 2;               // コンピューター
const WINDUP_MS = 80;       // 攻撃してから判定されるまでの時間
const RING_Y = 180;         // 床のY位置
const RING_HALF_PX = 140;   // リングの半径基準
const PUSH_HIT = 34;        // HIT の押し量
const PUSH_GLANCE = 15;     // GLANCE の押し量
const SWORD_LEN = 520;      // 剣の長さ
const SWORD_R = 16;         // 剣の半径
const LERP_K = 0.25;        // ガード角度の追従率
const ATTACK_DURATION_MS = 160;
const ATTACK_MAX_DEG = 60;
const ATTACK_PUSH = 180;
const BASE_MY_Z = 230;
const BASE_ENEMY_Z = -140;
const WORLD_SHIFT_Z = 450;
const DIRS = ["L", "UL", "U", "UR", "R"];
const DIR_DEG = [-90, -45, 0, 45, 90];
const ENEMY_SCALE = 1.1;
const ENEMY_HIP_Y = 60;
const ENEMY_LEG_H = 80;
const WIN_TARGET = 2;                   // 先に2勝すれば勝ち
const MAX_ROUNDS = WIN_TARGET * 2 - 1;  // 3本勝負
const ROUND_PAUSE_MS = 1200;
const COUNTDOWN_MS = [800, 800, 800, 800];   // 3・2・1・はじめ

// 元の画面（1100×700）を基準に配置を計算する
const VW = 1100;
const VH = 700;

// ---------- Arduino（MPU-6050）と同じ判定の数値 ----------
const ATK_START_DPS = 200;   // 攻撃開始とみなす角速度（度/秒）
const ATK_END_DPS = 80;      // 攻撃終了とみなす角速度
const ATK_MIN_MS = 60;       // 攻撃とみなす最小時間
const COOLDOWN_MS = 220;     // 次の攻撃までの待機時間
const V_TO_D = 25;           // 縦→斜め
const D_TO_V = 20;           // 斜め→縦
const D_TO_H = 70;           // 斜め→横
const H_TO_D = 65;           // 横→斜め

// ---------- コンピューターの強さ ----------
const CPU_LEVELS = {
  easy:   { react: [650, 1000], guardSmart: 0.45, attackGap: [1500, 2600], aim: 0.45, tell: 420 },
  normal: { react: [420, 700],  guardSmart: 0.65, attackGap: [1100, 2000], aim: 0.6,  tell: 320 },
  hard:   { react: [260, 450],  guardSmart: 0.8,  attackGap: [800, 1500],  aim: 0.75, tell: 240 },
};
let cpu = CPU_LEVELS.normal;

// ---------- 状態 ----------
class Player {
  constructor(name) {
    this.name = name;
    this.guardIdx = 2;        // 現在のガード方向（0〜4）
    this.targetDeg = 0;
    this.drawDeg = 0;
    this.stunUntil = 0;
    this.attacking = false;
    this.attackStartMs = 0;
    this.attackTiltDeg = 0;
    this.attackPush = 0;
    this.levelLock = false;
    this.lockedDeg = 0;
    this.falling = false;
    this.fallProgress = 0;
    this.fallY = 0;
    this.fallRot = 0;
  }
}

const STATE_HOME = 0;
const STATE_READY = 2;
const STATE_PLAYING = 3;
const STATE_GAMEOVER = 4;
const STATE_COUNTDOWN = 5;

let gameState = STATE_HOME;
let prevState = -1;
let p1, p2;
let centerX = 0;       // ＋ならあなた（P1）が押している
let centerXVis = 0;    // 表示用に滑らかにした centerX
let centerV = 0;
let gameOver = false;
let winner = "";
let p1Wins = 0;
let p2Wins = 0;
let roundWinner = new Array(MAX_ROUNDS).fill(0);
let nextRoundAt = 0;
let matchOver = false;
let countdownStartMs = 0;
let played = [false, false, false, false];
let localQueue = [];

// 色（あなた＝赤、相手＝青。元のコードの P1 視点と同じ）
let colMeBlade, colMeHandle, colEnemyBlade, colEnemyHandle, colEnemyBody;

// センサー
let sensorOn = false;
let gSign = 1;            // 端末によって重力の向きの符号が逆なので、構えたときの向きで合わせる
let thetaDeg = 0;         // 剣（スマホ）の傾き（時計回りが＋）
let level = 0;            // 0=縦 1=斜め 2=横
let dispOut = 0;          // 段階に丸めた角度（0, ±45, ±90）
let atkState = "IDLE";    // IDLE / FORWARD / COOLDOWN
let atkStartMs = 0;
let cooldownStartMs = 0;
let lockedDisp = 0;
let viewRot = 0;          // 画面を逆に回す角度（なめらかにした傾き）
let flipTilt = false;     // 左右が逆に感じるときの切り替え
let inputMode = "button"; // 斬り方：button=ボタン / swing=スマホを振る
let viewMode = "level";   // 見え方：level=世界をまっすぐ保つ / sword=剣だけ傾く
const SLASH_COOLDOWN_MS = 700;   // 一度斬ったら、次に斬れるまでの時間（連打防止）
let lastSlashMs = -99999;
const keyMode = new URLSearchParams(location.search).has("keys");   // 開発用：キーボードで操作

// CPU の予定
let cpuNextGuardAt = 0;
let cpuNextAttackAt = 0;
let cpuAttackAt = 0;

// 画面の要素
const $ = (id) => document.getElementById(id);
let sound = {};

/* ---------- p5.js ---------- */
function setup() {
  // p5.js が自動で付けるスマホの傾き・動きの受け口を外す（このゲームは自前の onMotion を使う。
  // 端末が acceleration を null で送ると p5.js 側でエラーになるため）
  const inst = window.p5 && p5.instance;
  if (inst && inst._events) {
    for (const k of ["devicemotion", "deviceorientation"]) {
      if (typeof inst._events[k] === "function") window.removeEventListener(k, inst._events[k]);
    }
  }
  const s = stageSize();
  const cnv = createCanvas(s, s, WEBGL);
  cnv.parent("world");
  pixelDensity(Math.min(window.devicePixelRatio || 1, 1.5));
  perspective(PI / 3, 1, 10, 6000);

  p1 = new Player("P1");
  p2 = new Player("P2");
  updateViewPalette();
  setupUI();
}

// 画面の対角線の長さの正方形にする（回しても四隅が空かないように）
function stageSize() {
  return Math.ceil(Math.hypot(window.innerWidth, window.innerHeight)) + 4;
}

function windowResized() {
  const s = stageSize();
  resizeCanvas(s, s);
  perspective(PI / 3, 1, 10, 6000);
}

function draw() {
  const now = millis();
  localStep(now);

  if (gameState !== prevState) {
    onStateChanged(prevState, gameState);
    prevState = gameState;
  }

  if (gameState === STATE_COUNTDOWN) {
    updateCountdown(now);
  }
  if (gameState === STATE_PLAYING) {
    cpuStep(now);
  }

  drawGame(now);
  updateHud();
  applyViewRotation();
}

/* ---------- 3D の描画（元の drawGame） ---------- */
function drawGame(now) {
  background(12);
  ambientLight(128);
  directionalLight(128, 128, 128, 0, 0, -1);

  updatePlayerAnim(p1, now);
  updatePlayerAnim(p2, now);

  // ノックバック：ばねのように目標位置へ近づける
  const k = 0.26;
  const damp = 0.72;
  centerV += (centerX - centerXVis) * k;
  centerV *= damp;
  centerXVis += centerV;

  camera(VW / 2, VH * 0.65, 720, VW / 2, VH * 0.45, 0, 0, 1, 0);

  drawRing3D();
  drawEnemyBodyAndSword(p2);
  drawMySword(p1);
}

function updatePlayerAnim(p, now) {
  p.targetDeg = p.levelLock ? p.lockedDeg : DIR_DEG[p.guardIdx];
  p.drawDeg += (p.targetDeg - p.drawDeg) * LERP_K;
  if (p.attacking) {
    // 0→1→0 の sin で、傾きと突き出しを一往復させる
    const prog = constrain((now - p.attackStartMs) / ATTACK_DURATION_MS, 0, 1);
    p.attackTiltDeg = sin(prog * PI) * ATTACK_MAX_DEG;
    p.attackPush = sin(prog * PI) * ATTACK_PUSH;
    if (prog >= 1) {
      p.attacking = false;
      p.levelLock = false;
      p.attackTiltDeg = 0;
      p.attackPush = 0;
    }
  } else {
    p.attackTiltDeg = 0;
    p.attackPush = 0;
  }
}

function groundY() { return VH / 2 + RING_Y; }

// あなたが押しているほど、世界全体を奥へずらす
function worldShiftZ() {
  return constrain(centerXVis / RING_HALF_PX, -1, 1) * WORLD_SHIFT_Z;
}

function drawRing3D() {
  push();
  translate(VW / 2, groundY(), worldShiftZ());
  rotateX(HALF_PI);
  stroke(0, 255, 0);
  noFill();
  strokeWeight(3);
  arc(0, 0, 360 * 3, 360 * 1.3 * 2, PI, TWO_PI, OPEN, 48);
  arc(0, 0, 360 * 3, 360 * 2.5 * 2, 0, PI, OPEN, 48);
  pop();
}

function drawEnemyBodyAndSword(enemy) {
  let fallY = 0;
  let rot = 0;
  const baseY = groundY() - (ENEMY_HIP_Y + ENEMY_LEG_H / 2) * ENEMY_SCALE;
  if (enemy.falling) {
    enemy.fallProgress += 0.05;
    enemy.fallY += 6;
    enemy.fallRot += PI / 60;
    fallY = enemy.fallY;
    rot = enemy.fallRot;
  }
  push();
  translate(VW / 2, baseY + fallY, BASE_ENEMY_Z);
  rotateZ(rot);
  scale(ENEMY_SCALE);
  noStroke();
  fill(colEnemyBody);
  box(80, 120, 50);
  push(); translate(0, -90, 0); fill(220); sphere(26, 20, 14); pop();
  fill(colEnemyBody);
  push(); translate(-18, ENEMY_HIP_Y, 0); box(22, ENEMY_LEG_H, 22); pop();
  push(); translate(18, ENEMY_HIP_Y, 0); box(22, ENEMY_LEG_H, 22); pop();
  push(); translate(0, -100, 100); drawSwordActor(enemy, false); pop();
  pop();
}

function drawMySword(me) {
  let fallY = 0;
  let rot = 0;
  if (me.falling) {
    me.fallProgress += 0.05;
    me.fallY += 6;
    me.fallRot -= PI / 60;
    fallY = me.fallY;
    rot = me.fallRot;
  }
  push();
  translate(VW / 2, VH * 0.48 + fallY, BASE_MY_Z);
  rotateZ(rot);
  drawSwordActor(me, true);
  pop();
}

function updateViewPalette() {
  colMeBlade = color(175, 27, 27, 100);
  colMeHandle = color(134, 19, 19, 100);
  colEnemyBlade = color(44, 124, 227);
  colEnemyHandle = color(26, 49, 80);
  colEnemyBody = color(14, 58, 113);
}

// 剣の配置と回転（回転の中心はグリップ）
function drawSwordActor(p, isMe) {
  push();
  rotateZ(radians(isMe ? p.drawDeg : -p.drawDeg));   // 敵だけ左右反転
  const half = SWORD_LEN / 2 + 50;
  translate(0, half, 0);
  if (isMe) {
    translate(0, 0, -p.attackPush);
    rotateX(radians(p.attackTiltDeg));
    translate(0, 0, p.attackPush);
  } else {
    translate(0, 0, p.attackPush);
    rotateX(radians(-p.attackTiltDeg));
    translate(0, 0, -p.attackPush);
  }
  translate(0, -half, 0);
  if (isMe) drawSwordCenteredColored(SWORD_LEN, SWORD_R, colMeBlade, colMeHandle);
  else drawSwordCenteredColored(SWORD_LEN, SWORD_R, colEnemyBlade, colEnemyHandle);
  pop();
}

function drawSwordCenteredColored(len, r, bladeCol, handleCol) {
  const half = len / 2;
  noStroke();
  // 刃
  push(); translate(0, -len * 0.15, 0); fill(bladeCol); cylinder(r, len * 0.75, 24, 1); pop();
  // 先端
  push(); translate(0, -half * 0.95, 0); fill(bladeCol); sphere(r * 1.05, 16, 12); pop();
  // つば
  push(); translate(0, len * 0.10, 0); fill(handleCol); cylinder(r * 2.2, r * 0.5, 24, 1); pop();
  // 柄
  push(); translate(0, len * 0.22, 0); fill(handleCol); cylinder(r * 1.2, len * 0.25, 24, 1); pop();
  // 柄のリング
  for (let i = 0; i < 5; i++) {
    push(); translate(0, len * 0.15 + i * r * 0.8, 0); fill(handleCol); cylinder(r * 1.35, r * 0.3, 24, 1); pop();
  }
}

/* ---------- ゲームの進行（元の localStep / localJudge など） ---------- */
function localStep(now) {
  // ラウンドが終わり、マッチが続くなら次のラウンドへ
  if (gameOver && !matchOver && nextRoundAt > 0 && now >= nextRoundAt) {
    nextRoundAt = 0;
    resetMatchLocal();
    beginRoundCountdown();
    gameState = STATE_COUNTDOWN;
    return;
  }
  // 時間が来た攻撃を判定する
  for (let i = localQueue.length - 1; i >= 0; i--) {
    if (now >= localQueue[i].resolveTime) {
      localJudge(localQueue[i]);
      localQueue.splice(i, 1);
    }
  }
  if (!gameOver && gameState === STATE_PLAYING) localCheckRingOut(now);
}

function requestAttack(pid) {
  if (gameState !== STATE_PLAYING || gameOver) return;
  const attacker = pid === P1 ? p1 : p2;
  localAttack(pid, DIRS[attacker.guardIdx]);
}

function localAttack(attackerPid, dir) {
  triggerAttackAnim(attackerPid === P1 ? p1 : p2, DIRS.indexOf(dir));
  localQueue.push({ attackerPid, atkDir: dir, resolveTime: millis() + WINDUP_MS });
}

function triggerAttackAnim(attacker, atkIdx) {
  attacker.attacking = true;
  attacker.attackStartMs = millis();
  attacker.levelLock = true;
  attacker.lockedDeg = DIR_DEG[atkIdx];
}

// 攻撃の向きと、相手の構えの角度の差で結果が決まる
//  差 0°（平行）→ 大きく押し出す ／ 45° → 少し押し出す ／ 90°（直交）→ 防がれて押し返される
function localJudge(e) {
  const attackerPid = e.attackerPid;
  const atkDeg = dirToWorldDeg(e.atkDir, attackerPid);
  const defender = attackerPid === P1 ? p2 : p1;
  let gdDeg = DIR_DEG[defender.guardIdx];
  if (attackerPid === P1) gdDeg = -gdDeg;   // P2 は左右反転させて比較する
  const diff = angleDiffLineDeg(atkDeg, gdDeg);

  if (diff === 0) {
    localPushCenter(attackerPid, PUSH_HIT);
    playSe("hit");
    flash("big", attackerPid);
  } else if (diff === 45) {
    localPushCenter(attackerPid, PUSH_GLANCE);
    playSe("hit");
    flash("small", attackerPid);
  } else {
    centerX += attackerPid === P1 ? -PUSH_GLANCE : PUSH_GLANCE;
    playSe("parry");
    flash("block", attackerPid);
  }
  centerX = constrain(centerX, -RING_HALF_PX * 1.5, RING_HALF_PX * 1.5);
}

function localPushCenter(attackerPid, amount) {
  centerX += attackerPid === P1 ? amount : -amount;
  centerX = constrain(centerX, -RING_HALF_PX * 1.5, RING_HALF_PX * 1.5);
}

function localCheckRingOut(now) {
  let w = 0;
  if (centerX > RING_HALF_PX + PUSH_GLANCE) w = P1;
  if (centerX < -RING_HALF_PX - PUSH_GLANCE) w = P2;
  if (!w) return;

  gameOver = true;
  (w === P1 ? p2 : p1).falling = true;
  if (w === P1) p1Wins++; else p2Wins++;
  const idx = p1Wins + p2Wins - 1;
  if (idx >= 0 && idx < MAX_ROUNDS) roundWinner[idx] = w;

  const finished = (w === P1 ? p1Wins : p2Wins) >= WIN_TARGET;
  matchOver = finished;
  if (finished) {
    winner = w === P1 ? "あなたの勝利！" : "コンピューターの勝利";
    nextRoundAt = 0;
  } else {
    winner = w === P1 ? "あなたが一本！" : "一本取られた…";
    nextRoundAt = now + ROUND_PAUSE_MS;
  }
  onGameEnd(w === P1);
  gameState = STATE_GAMEOVER;
}

function dirToWorldDeg(dir, pid) {
  const deg = DIR_DEG[DIRS.indexOf(dir)];
  return pid === P2 ? -deg : deg;
}

function angleDiffLineDeg(a, b) {
  let diff = Math.abs(a - b) % 180;
  if (diff > 90) diff = 180 - diff;
  return diff;
}

function setGuard(p, idx) {
  if (millis() < p.stunUntil || p.levelLock) return;
  p.guardIdx = idx;
}

function resetMatchLocal() {
  centerX = 0;
  centerXVis = 0;
  centerV = 0;
  gameOver = false;
  winner = "";
  localQueue = [];
  for (const p of [p1, p2]) {
    p.guardIdx = 2;
    p.targetDeg = p.drawDeg = 0;
    p.stunUntil = 0;
    p.attacking = false;
    p.levelLock = false;
    p.falling = false;
    p.fallY = p.fallProgress = p.fallRot = 0;
  }
}

function resetMatchAll() {
  p1Wins = 0;
  p2Wins = 0;
  roundWinner = new Array(MAX_ROUNDS).fill(0);
  matchOver = false;
  nextRoundAt = 0;
  resetMatchLocal();
}

function beginRoundCountdown() {
  countdownStartMs = millis();
  played = [false, false, false, false];
  stopAllBgm();
}

function updateCountdown(now) {
  const t = now - countdownStartMs;
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    acc += COUNTDOWN_MS[i];
    if (t < acc) {
      if (!played[i]) {
        played[i] = true;
        playSe(i < 3 ? "taiko" : "hajime");
        showBig(i < 3 ? String(3 - i) : "はじめ！");
      }
      return;
    }
  }
  showBig("");
  gameState = STATE_PLAYING;
}

function onStateChanged(from, to) {
  if (to === STATE_PLAYING) {
    stopAllBgm();
    playBgm("battle", true);
    const now = millis();
    cpuNextGuardAt = now + random(...cpu.react);
    cpuNextAttackAt = now + random(...cpu.attackGap);
    cpuAttackAt = 0;
  }
  document.body.dataset.state = ["home", "", "ready", "playing", "gameover", "countdown"][to];
}

function onGameEnd(p1Win) {
  stopAllBgm();
  playBgm(p1Win ? "win" : "lose", false);
}

/* ---------- コンピューター（P2）の動き ---------- */
function cpuStep(now) {
  if (gameOver) return;

  // 1) 構えを変える：あなたの今の構えに対して「直交」になる向きを選べば防げる
  if (now >= cpuNextGuardAt && !cpuAttackAt) {
    if (random() < cpu.guardSmart) setGuard(p2, cpuIdxForDiff(p1.guardIdx, 90, P1));
    else setGuard(p2, floor(random(5)));
    cpuNextGuardAt = now + random(...cpu.react);
  }

  // 2) 攻撃の予告：先に構えを「平行」に合わせ、少し間をおいてから振る（あなたが見て反応できるように）
  if (!cpuAttackAt && now >= cpuNextAttackAt) {
    const idx = random() < cpu.aim ? cpuIdxForDiff(p1.guardIdx, 0, P2) : floor(random(5));
    setGuard(p2, idx);
    cpuAttackAt = now + cpu.tell;
  }
  if (cpuAttackAt && now >= cpuAttackAt) {
    requestAttack(P2);
    cpuAttackAt = 0;
    cpuNextAttackAt = now + random(...cpu.attackGap);
    cpuNextGuardAt = now + random(...cpu.react);
  }
}

// あなた（P1）の構え playerIdx に対して、角度の差が diff になる CPU の構えを探す
//  attacker = P1 のとき：あなたの攻撃をどう受けるか ／ attacker = P2 のとき：CPU の攻撃をどう当てるか
function cpuIdxForDiff(playerIdx, diff, attacker) {
  const cands = [];
  for (let i = 0; i < 5; i++) {
    const d = attacker === P1
      ? angleDiffLineDeg(DIR_DEG[playerIdx], -DIR_DEG[i])
      : angleDiffLineDeg(-DIR_DEG[i], DIR_DEG[playerIdx]);
    if (d === diff) cands.push(i);
  }
  return cands.length ? random(cands) : floor(random(5));
}

/* ---------- スマホのセンサー（Arduino の代わり） ---------- */
function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (g && g.x !== null && g.y !== null) {
    // 重力の向きから、剣（スマホ）の傾きを求める（Arduino の atan2(gZ, gY) と同じ考え方）
    let t = degrees(Math.atan2(-gSign * g.x, gSign * g.y));
    if (flipTilt) t = -t;
    thetaDeg = constrain(t, -90, 90);
  }
  const r = e.rotationRate;
  const w = r && r.beta !== null ? Math.abs(r.beta) : 0;   // 前に振る回転の速さ（度/秒）
  updateSword(w, performance.now());
}

// Arduino の loop() と同じ：傾きを3段階（縦・斜め・横）に分け、境目では行き帰りで閾値を変えてブレを防ぐ
function updateSword(w, nowMs) {
  const a = Math.abs(thetaDeg);
  const sgn = thetaDeg >= 0 ? 1 : -1;
  const lockDir = atkState !== "IDLE";   // 攻撃中・クールダウン中は向きを変えない

  if (!lockDir) {
    if (level === 0) { if (a > V_TO_D) level = 1; }
    else if (level === 1) { if (a < D_TO_V) level = 0; else if (a > D_TO_H) level = 2; }
    else if (a < H_TO_D) level = 1;
    dispOut = level === 0 ? 0 : level === 1 ? 45 * sgn : 90 * sgn;
    viewRot += (thetaDeg - viewRot) * 0.25;
  }

  if (atkState === "IDLE") {
    if (w > ATK_START_DPS) {
      atkState = "FORWARD";
      atkStartMs = nowMs;
      lockedDisp = dispOut;
    }
  } else if (atkState === "FORWARD") {
    if (nowMs - atkStartMs >= ATK_MIN_MS && w < ATK_END_DPS) {
      if (inputMode === "swing") onSwordSwing(lockedDisp);
      atkState = "COOLDOWN";
      cooldownStartMs = nowMs;
    }
  } else if (nowMs - cooldownStartMs >= COOLDOWN_MS) {
    atkState = "IDLE";
  }

  // 構えをゲームに反映する（元の serialEvent の S 行と同じ）
  if (gameState === STATE_PLAYING && !gameOver) setGuard(p1, DIRS.indexOf(dispToDir(atkState === "IDLE" ? dispOut : lockedDisp)));
  updateTiltMeter();
}

function onSwordSwing(disp) {
  if (gameState !== STATE_PLAYING) return;
  // 連打防止：前に斬ってから SLASH_COOLDOWN_MS たつまでは斬れない
  const now = performance.now();
  if (now - lastSlashMs < SLASH_COOLDOWN_MS) return;
  lastSlashMs = now;
  setGuardForce(p1, DIRS.indexOf(dispToDir(disp)));
  requestAttack(P1);
}

function setGuardForce(p, idx) {
  if (!p.levelLock) p.guardIdx = idx;
}

function dispToDir(disp) {
  const a = Math.abs(disp);
  if (a < 22.5) return "U";
  if (a < 67.5) return disp < 0 ? "UL" : "UR";
  return disp < 0 ? "L" : "R";
}

async function enableSensors() {
  try {
    if (!isSecureContext || typeof DeviceMotionEvent === "undefined") return false;
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") throw new Error("denied");
    }
    // 構えたときの重力の向き（符号）を最初に一度だけ決めてから、毎回 onMotion に渡す。
    // p5.js にも同じイベントの受け口があり、端末が acceleration を null で送るとエラーになるため、
    // ここで先に受け取って p5.js 側には渡さない（このゲームは p5.js のモーション機能を使わない）
    let signFixed = false;
    window.addEventListener("devicemotion", (e) => {
      const g = e.accelerationIncludingGravity;
      if (!signFixed && g && g.y !== null && Math.abs(g.y) > 3) {
        gSign = g.y >= 0 ? 1 : -1;
        signFixed = true;
      }
      onMotion(e);
      e.stopImmediatePropagation();
    }, true);
    sensorOn = true;
    return true;
  } catch (err) {
    return false;
  }
}

// 画面全体（3D の世界）をスマホの傾きと逆に回して、地面に対してまっすぐ見せる
function applyViewRotation() {
  const el = $("world");
  const rot = sensorOn && gameState !== STATE_HOME && viewMode === "level" ? -viewRot : 0;
  el.style.transform = `translate(-50%, -50%) rotate(${rot.toFixed(2)}deg)`;
}

/* ---------- 開発用：キーボード（?keys をつけたとき）と画面タップ ---------- */
function keyPressed() {
  if (!keyMode || gameState !== STATE_PLAYING) return;
  const map = { q: 0, a: 1, w: 2, d: 3, e: 4 };
  const k = key.toLowerCase();
  if (k in map) setGuard(p1, map[k]);
  if (k === "s") requestAttack(P1);
}

/* ---------- 音 ---------- */
function loadSounds() {
  const files = { hit: "se_hit", parry: "se_parry", taiko: "taiko", hajime: "hajime", battle: "bgm_battle", win: "bgm_win", lose: "bgm_lose" };
  const vol = { hit: 1, parry: 0.9, taiko: 1, hajime: 1, battle: 0.5, win: 0.7, lose: 0.7 };
  for (const [k, f] of Object.entries(files)) {
    const a = new Audio(`sound/${f}.mp3`);
    a.preload = "none";
    a.volume = vol[k];
    sound[k] = a;
  }
}

// iPhone は、ボタンを押したときに一度鳴らしておかないと、あとで音が出ない
function unlockSounds() {
  for (const a of Object.values(sound)) {
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  }
}

function playSe(k) {
  const a = sound[k];
  if (!a) return;
  const c = a.cloneNode();
  c.volume = a.volume;
  c.play().catch(() => {});
}

function playBgm(k, loop) {
  const a = sound[k];
  if (!a) return;
  a.loop = loop;
  a.currentTime = 0;
  a.play().catch(() => {});
}

function stopAllBgm() {
  for (const k of ["battle", "win", "lose"]) if (sound[k]) sound[k].pause();
}

/* ---------- 画面の文字・ボタン（HTML） ---------- */
function setupUI() {
  loadSounds();
  const touch = matchMedia("(pointer: coarse)").matches;
  if (!touch && !keyMode) document.body.classList.add("pc");

  $("btnStart").addEventListener("click", async () => {
    unlockSounds();
    resetMatchAll();
    gameState = STATE_READY;
    // iPhone の許可はクリック直後に要求する（全画面の await より先）。
    const sensorPermission = keyMode ? Promise.resolve(true) : enableSensors();
    try {
      if (document.documentElement.requestFullscreen && touch) await document.documentElement.requestFullscreen();
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("portrait");
    } catch (e) {
      // 全画面や向きの固定ができない端末もある（その場合は端末側で向きを固定してもらう）
    }
    const ok = await sensorPermission;
    $("sensorMsg").textContent = ok ? "" : (!isSecureContext ? "センサーを使うには HTTPS のページで開いてください。" : "センサーを使えませんでした。設定でモーションと画面の向きのアクセスを許可してください。");
  });

  document.querySelectorAll("[data-level]").forEach((b) => {
    b.addEventListener("click", () => {
      cpu = CPU_LEVELS[b.dataset.level];
      document.querySelectorAll("[data-level]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    });
  });

  $("btnFlip").addEventListener("click", () => {
    flipTilt = !flipTilt;
    $("btnFlip").setAttribute("aria-pressed", flipTilt);
  });

  $("btnReady").addEventListener("click", () => {
    resetMatchAll();
    beginRoundCountdown();
    gameState = STATE_COUNTDOWN;
  });

  $("btnHome").addEventListener("click", () => {
    resetMatchAll();
    stopAllBgm();
    gameState = STATE_READY;
  });

  // 斬るボタン（押した瞬間に斬る。待ち時間中は onSwordSwing の中で無視される）
  $("slash").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    onSwordSwing(atkState === "IDLE" ? dispOut : lockedDisp);
  });

  // 斬り方・見え方の切り替え（選んだものはブラウザに覚えておく）
  const setInput = (m) => {
    inputMode = m;
    document.body.dataset.input = m;
    document.querySelectorAll("[data-input]").forEach((x) => x.tagName === "BUTTON" && x.setAttribute("aria-pressed", x.dataset.input === m));
    savePref("chambaraInput", m);
  };
  const setView = (m) => {
    viewMode = m;
    document.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.view === m));
    $("viewToggle").textContent = m === "level" ? "世界まっすぐ" : "剣だけ傾く";
    savePref("chambaraView", m);
  };
  document.querySelectorAll("button[data-input]").forEach((b) => b.addEventListener("click", () => setInput(b.dataset.input)));
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $("viewToggle").addEventListener("click", () => setView(viewMode === "level" ? "sword" : "level"));
  setInput(loadPref("chambaraInput") === "swing" ? "swing" : "button");
  setView(loadPref("chambaraView") === "sword" ? "sword" : "level");
}

function loadPref(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function savePref(k, v) {
  try { localStorage.setItem(k, v); } catch (e) { /* 覚えられなくても遊べる */ }
}

// タブを離れたら音を止める。戻った後は試合を準備からやり直せる。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAllBgm();
    if (gameState !== STATE_HOME) gameState = STATE_READY;
    if (typeof noLoop === "function") noLoop();
  } else if (typeof loop === "function") loop();
});
addEventListener("pagehide", stopAllBgm);

let flashTimer = 0;
function flash(type, attackerPid) {
  const el = $("flash");
  const mine = attackerPid === P1;
  const text = { big: mine ? "会心！" : "大きく押された！", small: mine ? "当たった" : "押された", block: mine ? "防がれた" : "防いだ！" }[type];
  el.textContent = text;
  el.className = `flash show ${type} ${mine ? "me" : "cpu"}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.className = "flash"), 500);
}

function showBig(t) {
  $("big").textContent = t;
}

function updateHud() {
  // スコアの丸
  const dots = $("dots").children;
  for (let i = 0; i < MAX_ROUNDS; i++) dots[i].dataset.w = roundWinner[i];

  // ミニマップ：土俵の上での2人の位置（上が相手側）
  const t = constrain(centerX, -RING_HALF_PX, RING_HALF_PX) / RING_HALF_PX;
  $("mapMe").style.transform = `translateY(${(-t * 40 + 18 + (p1.falling ? p1.fallY : 0)).toFixed(1)}px)`;
  $("mapCpu").style.transform = `translateY(${(-t * 40 - 18 + (p2.falling ? p2.fallY : 0)).toFixed(1)}px)`;

  // 今斬ったらどうなるか（あなたの構えと、相手の構えの角度の差）
  const adv = $("advice");
  if (gameState === STATE_PLAYING && !gameOver) {
    const diff = angleDiffLineDeg(DIR_DEG[p1.guardIdx], -DIR_DEG[p2.guardIdx]);
    const text = { 0: "今斬ると：大きく押せる！", 45: "今斬ると：少し押せる", 90: "今斬ると：防がれる → 傾きを変えよう" }[diff];
    if ($("adviceText").textContent !== text) $("adviceText").textContent = text;
    adv.dataset.k = diff;
    adv.style.display = "";
  } else {
    adv.style.display = "none";
  }

  $("result").textContent = gameState === STATE_GAMEOVER ? winner : "";
  $("resultSub").textContent = gameState === STATE_GAMEOVER ? (matchOver ? "マッチ終了" : "次のラウンドへ") : "";
  $("btnHome").hidden = !(gameState === STATE_GAMEOVER && matchOver);

  // 斬るボタン：待ち時間の進み具合を輪で表す（1 = 斬れる）
  const ready = Math.min((performance.now() - lastSlashMs) / SLASH_COOLDOWN_MS, 1);
  const btn = $("slash");
  btn.style.setProperty("--ready", ready.toFixed(3));
  btn.classList.toggle("ready", ready >= 1);
}

// 準備画面：今の傾きを表示して、センサーが動いているか確かめられるようにする
function updateTiltMeter() {
  const m = $("meterSword");
  if (m) m.style.transform = `rotate(${dispOut}deg)`;
  const v = $("meterVal");
  if (v) v.textContent = `${Math.round(thetaDeg)}° → ${dispToDir(dispOut)}`;
  const s = $("meterSwing");
  if (s && atkState === "FORWARD" && inputMode === "swing") {
    s.classList.remove("on");
    void s.offsetWidth;
    s.classList.add("on");
  }
}
