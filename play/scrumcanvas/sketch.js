/* =========================================================
   ScrumCanvas（Web版）
   Processing 版（ep_2_9_final.pde）を p5.js に書き直したもの。
   関数名・変数名・数値は元のコードにそろえてある。
   違うところ：
   ・文字（HUD）は 3D の上に重ねた 2D のキャンバス（hud）に描く
   ・screenX/screenY が p5.js に無いので、カメラの計算を toScreen() で自前で行う
   ・スマホ用に、キー操作と同じことができるボタンを画面の下に置く（index.html）
   ========================================================= */

// ---------- 設定 ----------
const PLAYER_COUNT = 7;                 // 9〜15の7人
const JERSEY = [9, 10, 11, 12, 13, 14, 15];
const FRIEND_BLUE = "#1E90FF";          // 味方は青で統一
const BALL_R = 5;                       // 選手球の半径

let paths;   // 各選手の軌道（点列）
let cums;    // 各選手の累積距離テーブル
let totals;  // 各選手の総距離
// 読み込みに時間がかかっても、配列と描画の準備が終わるまでお手本を始めない。
let markSketchReady;
const sketchReady = new Promise((resolve) => { markSketchReady = resolve; });

let isPlaying = false;   // 再生中か
let playSpeed = 0.5;     // 1フレームあたり進む距離（px/frame）
let distAlong = 0;       // 軌道上の再生位置（距離）
let totalLen = 0;        // 軌道の総距離

// ★ モード：true=描画フェーズ / false=再生(鑑賞)フェーズ
let drawMode = true;
// ★ 選択中の選手（描画対象）
let currentPlayer = 0;

// ★ オービットカメラ用（再生フェーズのみ使用）
let cx = 400, cz = 200, cy = 40;  // 注視点（地面中央ちょい上）
let yaw = Math.PI / 2;            // 左右回転
let pitch = -Math.PI / 6;         // 上下回転（下向きがマイナス）
let radius = 400;                 // 注視点からの距離
let pmx = 0, pmy = 0;             // 直前のマウス座標（回転用）
const playerHoverY = -BALL_R;     // 表示用の高さ（球を常に浮かせる）

let formation = 0;                // 0=Left, 1=Right, 2=Center
const FORM_NAME = ["Left Scrum", "Right Scrum", "Center Scrum"];

// ラベル用スクリーン座標（毎フレーム更新）
const labelSX = new Array(PLAYER_COUNT).fill(0);
const labelSY = new Array(PLAYER_COUNT).fill(0);

// --- Ball & Pass ---
let ballOwner = 0;        // 初期保持者：9番
let ballInAir = false;    // 空中パス中か
let passTarget = -1;      // 受け手のインデックス
let passT = 0;            // パス進行 0→1
const passSpeed = 0.06;   // パスの速さ（tの増分/フレーム）
const passArc = 20;       // 放物線の高さ（px）
let passStart = null;     // 投げ始め位置

// ボールの見た目
const BALL_SPHERE_R = 3;
const BALL_COLOR = [255, 240, 200];

// --- Pass queue (manual trigger) ---
let passQueue = [];       // 受け手の下1桁列（例: 9→0→2→5）
let passIdx = 0;          // 次に投げるキュー位置

let shiftHeld = false;    // Shiftが押されているか（スマホでは「初期位置」ボタン）
let passEditMode = false; // オートパス編集モードか（REC）

let playEnded = false;    // ★ 再生が最後まで到達したか

function findPlayerByLastDigit(d) {
  for (let i = 0; i < PLAYER_COUNT; i++) if (JERSEY[i] % 10 === d) return i;
  return -1;
}

// スクラブ用
let userScrubbing = false;
let scrubT = 0;
let tlX = 0, tlY = 0, tlW = 0, tlH = 0;   // タイムラインの矩形（毎フレーム更新）

const BEATS = 8;          // 区間数
let timeMode = true;
let tPlay = 0;            // 現在のビート時刻[0..BEATS]
let tSpeed = 0.03;        // 1フレームで進むビート量（＝再生速度）

let markers;              // 各選手の時間マーカー（距離sを格納）長さ=BEATS+1

// ★ マーカー編集（元のコードでも無効化されている）
let markerEdit = false;
let selBeat = -1;

// ---- Pass Marker 状態 ----
let passMarkerEdit = false;   // PでON/OFF
let passPlan = [];            // [passer, receiver] の列
let passMarkerIdx = 0;
let passMarkers = [];

// 攻撃方向（XZ平面、+X=右方向をデフォルト）
let ATTACK_DIR;

// HUDメッセージ（簡易トースト）
let hudMsg = "";
let hudMsgTimer = 0;
function showMsg(m) { hudMsg = m; hudMsgTimer = 90; }

// --- Ball flight (beats-synced) ---
const BALL_PX_PER_BEAT = 240;

let passStartBeat = 0;
let passFlightBeats = 0;
let plannedCatchPos = null;

const forwardRuleEnabled = false;   // ← 一時的にオフ（元のコードと同じ）

let basePos;   // 各選手のフォーメーション初期位置

// --- Mouse pick (player sphere / label) ---
const PICK_R = 5;
const pickSX = new Array(PLAYER_COUNT).fill(0);
const pickSY = new Array(PLAYER_COUNT).fill(0);
const labelW = new Array(PLAYER_COUNT).fill(0);
const labelH = new Array(PLAYER_COUNT).fill(0);

// --- Queue RECトグル（HUD上の小ボタン） ---
let recX = 0, recY = 0, recW = 44, recH = 20;

const TL_TICK_HIT = 8;
const TL_EVENT_HIT = 9;

const DRAG_THRESH = 6;
let canDrawDrag = false;
let isDrawingDrag = false;

// ===== パス基準：データ構造 =====
class PassNode {
  constructor(sender, receiver, pos, t, isDummy) {
    this.sender = sender;
    this.receiver = receiver;
    this.pos = pos.copy();
    this.t = t;
    this.isDummy = isDummy;
    this.sSend = 0;        // 投げ距離
    this.sRecv = 0;        // 受け距離
    this.flightBeats = 0;  // 飛行時間[beats]
    this.tThrow = 0;       // 投げる時刻[beats]
  }
  isRealPass() { return !this.isDummy && this.sender >= 0 && this.receiver >= 0; }
}

// === Defense (opponent) ===
const ENEMY_RED = "#E64A4A";
const DEFENDER_IDX = [0, 1, 3, 4, 5];
const OPP_COUNT = DEFENDER_IDX.length;

let oppPos;
let markTo;

const DEF_LINE_Z = 160;
const DEF_SEP_X = 36;
const DEF_SPEED = 65;
const DEF_SPEED_SCRUB_SNAP_BEATS = 0.25;

const SHOW_BACKFIELD = true;
const BACK_IDX = [2, 6];
let backPos;
const BACKFIELD_Z = 30;
const BACK_SPEED = 80;

let prevTPlay = 0;

const DEF_LINE_COUNT = 5;
const SHOW_DEF_BACK11 = true;
const SHOW_DEF_BACK15 = true;
const BACK11_Z_OFFSET = 130;
const BACK15_Z_OFFSET = 150;

const defPos = new Array(DEF_LINE_COUNT).fill(null);
const defX = new Array(DEF_LINE_COUNT).fill(0);
const defMark = new Array(DEF_LINE_COUNT).fill(-1);

let defBack11;
let defBack15;

// 到着アンカー（時刻 t と 距離 s）
class Anchor { constructor(t, s) { this.t = t; this.s = s; } }
const BY_TIME = (a, b) => a.t - b.t;

// パスマーカー：1本のパスに対し、投げ位置と受け位置の両方を持つ
class PassMarker {
  constructor(passIndex, passer, receiver) {
    this.passIndex = passIndex;
    this.passer = passer;
    this.receiver = receiver;
    this.sThrow = null;
    this.sCatch = null;
  }
  ready() { return this.sThrow !== null && this.sCatch !== null; }
}

let nodes = [];
let anchors;
let playbackPassIdx = 0;

let waitingThrowClick = false;
let waitingCatchClick = false;

const PASS_LINE_HIT_PX = 10;
const PASS_BACK_ONLY = true;
const PASS_Z_EPS = 1.0;

function isLineEligible(idx) { return JERSEY[idx] !== 11; }

// --- FB15（フルバック）追従のチューニング ---
const FB15_CENTER_X = 400;
const FB15_CENTRAL_BIAS = 0.35;
const FB15_DEADBAND = 40;
const FB15_MIN_X = 240;
const FB15_MAX_X = 560;
const FB15_LEAD_X = 20;
const FB15_SPEED_SCALE = 0.70;

// --- Scrum marker ---
let SCRUM_X = 200, SCRUM_Z = 200;
const SCRUM_RX = 15, SCRUM_RZ = 15;

const defZ = new Array(DEF_LINE_COUNT).fill(DEF_LINE_Z);
let back11ZOffset = 0;
let back15ZOffset = 0;

const DEF_Z_FOLLOW = 0.25;
const DEF_Z_DRIFT_MAX = 22;
const DEF_Z_SPEED = 45;
const BACK_Z_FOLLOW = 0.35;
const BACK_Z_DRIFT_MAX = 40;
const BACK_Z_SPEED = 60;
const DEF_LINE_SAFE_MARGIN = 6;

let backMark11 = -1;
let backMark15 = -1;

// HUD（文字を描く 2D のキャンバス）
let hud;
const HUD_FONT = "'Noto Sans JP', sans-serif";

// ★ Web版：右ボタンの状態（p5 の mouseButton はタッチだと LEFT になるため自前で持つ）
let rightDown = false;

/* ---------- カメラの計算（screenX / screenY の代わり） ---------- */
// draw() の中で camera() に渡したのと同じ値を覚えておき、3D の点を画面の位置に直す
const FOV = Math.PI / 3;
let camE = [0, 0, 0], camC = [0, 0, 0], camU = [0, 1, 0];

function applyCam(ex, ey, ez, tx, ty, tz, ux, uy, uz) {
  camera(ex, ey, ez, tx, ty, tz, ux, uy, uz);
  camE = [ex, ey, ez];
  camC = [tx, ty, tz];
  camU = [ux, uy, uz];
}

function toScreen(x, y, z) {
  // カメラの向き（z 軸＝目→注視点の逆、x 軸、y 軸）を作る
  let zx = camE[0] - camC[0], zy = camE[1] - camC[1], zz = camE[2] - camC[2];
  let zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
  let xx = camU[1] * zz - camU[2] * zy, xy = camU[2] * zx - camU[0] * zz, xz = camU[0] * zy - camU[1] * zx;
  let xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  // 点をカメラから見た座標に直す
  const px = x - camE[0], py = y - camE[1], pz = z - camE[2];
  const ex = px * xx + py * xy + pz * xz;
  const ey = px * yx + py * yy + pz * yz;
  const ez = px * zx + py * zy + pz * zz;
  // 遠近法で画面に映す（遠いほど中央に寄る）
  const f = 1 / Math.tan(FOV / 2);
  const aspect = width / height;
  return {
    x: (1 + (f / aspect) * ex / -ez) / 2 * width,
    y: (1 + f * ey / -ez) / 2 * height,
  };
}

/* ---------- setup / draw ---------- */
function setup() {
  const cnv = createCanvas(800, 400, WEBGL);
  cnv.parent("stage");
  cnv.elt.tabIndex = 0;
  cnv.elt.setAttribute("aria-label", "ScrumCanvas のフィールド。選手を選んでコースを描きます");
  cnv.elt.addEventListener("pointerdown", () => cnv.elt.focus({ preventScroll: true }));
  let stageVisible = true;
  const syncDrawing = () => document.hidden || !stageVisible ? noLoop() : loop();
  document.addEventListener("visibilitychange", syncDrawing);
  new IntersectionObserver(([entry]) => { stageVisible = entry.isIntersecting; syncDrawing(); }).observe(cnv.elt);
  perspective(FOV, width / height, 1, 5000);

  // 文字用の 2D キャンバスを作って、3D の上に重ねる
  hud = createGraphics(800, 400);
  hud.parent("stage");
  hud.elt.style.display = "block";
  hud.elt.classList.add("hud");

  ATTACK_DIR = createVector(1, 0, 0);
  defBack11 = createVector(400, -1.5, DEF_LINE_Z - BACK11_Z_OFFSET);
  defBack15 = createVector(400, -1.5, DEF_LINE_Z - BACK15_Z_OFFSET);

  paths = [];
  cums = new Array(PLAYER_COUNT).fill(null);
  totals = new Array(PLAYER_COUNT).fill(0);
  markers = new Array(PLAYER_COUNT).fill(null);
  anchors = new Array(PLAYER_COUNT).fill(null);
  basePos = new Array(PLAYER_COUNT).fill(null);
  for (let i = 0; i < PLAYER_COUNT; i++) paths[i] = [];

  applyFormation(formation);

  oppPos = new Array(OPP_COUNT);
  markTo = new Array(OPP_COUNT);
  initOpponents();

  ballOwner = chooseInitialOwnerFromQueue();
  ballInAir = false;
  passTarget = -1;

  // 右クリックのメニューを出さない（右ドラッグで回転するため）
  document.getElementById("stage").addEventListener("contextmenu", (e) => e.preventDefault());
  markSketchReady();
}

function draw() {
  background(200, 220, 255);
  hud.clear();

  // カメラ
  if (drawMode) {
    applyCam(400, -350, 200, 400, 0, 200, 0, 0, 1);   // 俯瞰（up=Z）
  } else {
    pitch = constrain(pitch, -PI / 2 + 0.1, -0.05);
    radius = constrain(radius, 250, 1200);
    const ex = cx + radius * cos(pitch) * cos(yaw);
    const ey = cy + radius * sin(pitch);
    const ez = cz + radius * cos(pitch) * sin(yaw);
    applyCam(ex, ey, ez, cx, 0, cz, 0, 1, 0);
  }

  ambientLight(80, 80, 80);
  directionalLight(220, 220, 220, -0.5, -1, -0.3);
  pointLight(255, 255, 200, 400, -300, 200);

  // 地面
  push();
  translate(400, 0, 200);
  fill(50, 180, 70);
  noStroke();
  box(800, 1, 400);
  pop();

  drawScrumMarker();

  // 走路の線
  noFill();
  strokeWeight(3);
  stroke(30, 144, 255, 220);
  for (let k = 0; k < PLAYER_COUNT; k++) {
    if (paths[k].length < 2) continue;
    beginShape();
    for (const p of paths[k]) vertex(p.x, p.y - 0.5, p.z);
    endShape();
  }
  if (paths[currentPlayer].length > 1) {
    strokeWeight(5);
    beginShape();
    for (const p of paths[currentPlayer]) vertex(p.x, p.y - 0.6, p.z);
    endShape();
  }

  let anyPlayable = false;
  for (let k = 0; k < PLAYER_COUNT; k++) {
    if (paths[k].length >= 2) { anyPlayable = true; break; }
  }

  if (isPlaying && anyPlayable) {
    tPlay += tSpeed;
    if (tPlay > BEATS) {
      tPlay = BEATS;
      isPlaying = false;
      playEnded = true;
      if (ballInAir) { ballInAir = false; ballOwner = passTarget; passTarget = -1; }
    }
  }

  // 時間に基づく自動パス開始（nodesに基づく）
  if (isPlaying && !ballInAir && playbackPassIdx < nodes.length) {
    const nd = nodes[playbackPassIdx];
    const sPos = posAt(nd.sender, nd.sSend);
    const rPos = posAt(nd.receiver, nd.sRecv);
    const tThrow = nd.tThrow;
    const flightBeats = max(1e-4, nd.flightBeats);
    if (tPlay >= tThrow) {
      ballOwner = nd.sender;
      passTarget = nd.receiver;
      ballInAir = true;
      passStart = sPos.copy();
      plannedCatchPos = rPos.copy();
      passStartBeat = tThrow;
      passFlightBeats = flightBeats;
      passT = 0;
      playbackPassIdx++;
    }
  }

  // 味方の選手
  for (let k = 0; k < PLAYER_COUNT; k++) {
    const pos = currentDisplayPos(k);

    push();
    translate(pos.x, playerHoverY, pos.z);
    noStroke();
    fill(FRIEND_BLUE);
    sphere(BALL_R, 16, 12);
    pop();

    const l = toScreen(pos.x, playerHoverY - (BALL_R + 14), pos.z);
    labelSX[k] = l.x;
    labelSY[k] = l.y;
    const c = toScreen(pos.x, playerHoverY, pos.z);
    pickSX[k] = c.x;
    pickSY[k] = c.y;

    // ★保持者の足元にパルスするリング
    if (k === ballOwner) {
      const pulse = 1.0 + 0.25 * sin(frameCount * 0.15);
      push();
      translate(pos.x, -1.5, pos.z);
      rotateX(HALF_PI);
      noFill();
      stroke(255, 210, 0, 220);
      strokeWeight(2);
      ellipse(0, 0, BALL_R * 5 * pulse, BALL_R * 5 * pulse, 32);
      pop();
    }
  }
  drawJerseyLabels();

  updateDefense(isPlaying ? tSpeed : 0);
  drawDefense();

  // --- Ball: 位置更新と描画 ---
  const ownerPos = currentDisplayPos(ballOwner);
  let ballPos;
  if (ballInAir) {
    if (plannedCatchPos !== null && passFlightBeats > 0) {
      const u = constrain((tPlay - passStartBeat) / passFlightBeats, 0, 1);
      const flat = p5.Vector.lerp(passStart, plannedCatchPos, u);
      const lift = -passArc * 4 * u * (1 - u);
      ballPos = createVector(flat.x, playerHoverY + lift, flat.z);
      if (u >= 1.0) {
        ballInAir = false;
        ballOwner = passTarget;
        passTarget = -1;
        ballPos = createVector(plannedCatchPos.x, playerHoverY, plannedCatchPos.z);
        plannedCatchPos = null;
        passFlightBeats = 0;
      }
    } else {
      const recvPos = currentDisplayPos(passTarget);
      const flat = p5.Vector.lerp(passStart, recvPos, passT);
      const lift = -passArc * 4 * passT * (1 - passT);
      ballPos = createVector(flat.x, playerHoverY + lift, flat.z);
      passT += passSpeed;
      if (passT >= 1.0) {
        ballInAir = false;
        ballOwner = passTarget;
        passTarget = -1;
        ballPos = createVector(recvPos.x, playerHoverY, recvPos.z);
      }
    }
  } else {
    ballPos = createVector(ownerPos.x, playerHoverY, ownerPos.z);
  }

  push();
  translate(ballPos.x, ballPos.y, ballPos.z);
  noStroke();
  fill(...BALL_COLOR);
  sphere(BALL_SPHERE_R, 12, 8);
  pop();

  // ★ 設置済みパスマーカーの可視化（投げ=紫 / 受け=オレンジ）
  for (const pm of passMarkers) {
    if (!pm) continue;
    if (pm.sThrow !== null) {
      if (cums[pm.passer] === null) ensureTablesFor(pm.passer);
      const p = posAt(pm.passer, pm.sThrow);
      push(); translate(p.x, playerHoverY, p.z); noStroke(); fill(255, 0, 255); sphere(3, 10, 8); pop();
    }
    if (pm.sCatch !== null) {
      if (cums[pm.receiver] === null) ensureTablesFor(pm.receiver);
      const q = posAt(pm.receiver, pm.sCatch);
      push(); translate(q.x, playerHoverY, q.z); noStroke(); fill(255, 140, 0); sphere(3, 10, 8); pop();
    }
  }

  // 画面上のヘルプ表示
  hintText();
  updateButtons();
}

/* ---------- マウス ---------- */
function inCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
}

function mousePressed(e) {
  if (!inCanvas()) return;
  rightDown = e && e.button === 2;
  pmx = mouseX;
  pmy = mouseY;

  // パスマーカー編集中：クリックで1個設置
  if (passMarkerEdit) {
    placePassMarkerWithClick(mouseX, mouseY);
    return false;
  }

  if (mouseX >= recX && mouseX <= recX + recW && mouseY >= recY && mouseY <= recY + recH) {
    passEditMode = !passEditMode;
    showMsg(passEditMode ? "Queue REC: ON" : "Queue REC: OFF");
    canDrawDrag = false;
    isDrawingDrag = false;
    return false;
  }

  const hit = pickPlayerAt(mouseX, mouseY);
  if (hit !== -1) {
    if (passEditMode) {
      passQueue.push(JERSEY[hit] % 10);
      showMsg("Queue += " + JERSEY[hit]);
    }
    if (drawMode && shiftHeld) {
      currentPlayer = hit;
      canDrawDrag = true;
      isDrawingDrag = false;
      return false;
    }
    currentPlayer = hit;
    showMsg("Select: " + JERSEY[hit]);
    canDrawDrag = false;
    isDrawingDrag = false;
    return false;
  }

  if (hitTimeline(mouseX, mouseY)) {
    // 1) 投げイベントマーカー（tThrow）にヒット？
    let tHit = NaN;
    for (let i = 0; i < nodes.length; i++) {
      const x = Math.floor(tlX + tlW * (nodes[i].tThrow / BEATS));
      if (abs(mouseX - x) <= TL_EVENT_HIT) { tHit = nodes[i].tThrow; break; }
    }
    // 2) 見つからなければ BEAT 目盛りにヒット？
    if (Number.isNaN(tHit)) {
      for (let b = 0; b <= BEATS; b++) {
        const x = Math.floor(tlX + tlW * (b / BEATS));
        if (abs(mouseX - x) <= TL_TICK_HIT) { tHit = b; break; }
      }
    }
    // 3) いずれかにヒット → ジャンプして自動再生
    if (!Number.isNaN(tHit)) {
      tPlay = constrain(tHit, 0, BEATS);
      recalcPlaybackStateFromTime(tPlay);
      isPlaying = true;
      canDrawDrag = false;
      isDrawingDrag = false;
      return false;
    }
    // 4) ヒットなし → スクラブ開始
    userScrubbing = true;
    setScrubFromMouse(mouseX);
    canDrawDrag = false;
    isDrawingDrag = false;
    return false;
  }

  canDrawDrag = drawMode;
  isDrawingDrag = false;
  return false;
}

function mouseDragged() {
  // 鑑賞モード：右ドラッグ（スマホは1本指ドラッグ）で回転
  if (!drawMode && (rightDown || !canDrawDrag) && !userScrubbing) {
    const dx = mouseX - pmx;
    const dy = mouseY - pmy;
    yaw += dx * 0.01;
    pitch += dy * 0.01;
    pmx = mouseX; pmy = mouseY;
    return false;
  }

  if (userScrubbing) {
    setScrubFromMouse(mouseX);
    return false;
  }

  if (passMarkerEdit) return false;

  // ★ここから「描画ドラッグ」のガード
  if (!canDrawDrag) return false;
  if (!isDrawingDrag) {
    if (dist(mouseX, mouseY, pmx, pmy) < DRAG_THRESH) return false;
    isDrawingDrag = true;
  }

  if (drawMode) {
    if (shiftHeld) {
      if (JERSEY[currentPlayer] === 9) {
        showMsg("9番はShiftドラッグで初期位置を動かせません");
        return false;
      }
      const p = createVector(mouseX, -1.5, mouseY);
      if (paths[currentPlayer].length === 0) paths[currentPlayer].push(p);
      else paths[currentPlayer][0] = p;
    } else {
      paths[currentPlayer].push(createVector(mouseX, -1.5, mouseY));
    }
    cums[currentPlayer] = null;
    totals[currentPlayer] = 0;
    markers[currentPlayer] = null;
  }
  return false;
}

function mouseReleased() {
  if (userScrubbing) userScrubbing = false;
  if (markerEdit) selBeat = -1;
  canDrawDrag = false;
  isDrawingDrag = false;
  rightDown = false;
}

// マウスホイールでもズーム（Web版で追加）
function mouseWheel(e) {
  if (!inCanvas() || drawMode) return;
  radius += e.delta * 0.3;
  return false;
}

/* ---------- キーボード ---------- */
function keyPressed() {
  // ボタン上ではブラウザ標準の Enter / Space / Tab を使う。
  if (document.activeElement.matches("button, a, input, select, textarea") || keyCode === TAB) return;
  if (key === "m" || key === "M") return handleKey("TAB", TAB);
  if (keyCode === SHIFT) { shiftHeld = true; return false; }
  return handleKey(key, keyCode);
}

function keyReleased() {
  if (keyCode === SHIFT) shiftHeld = false;
}

// キーとボタンの両方から呼ぶ
function handleKey(k, code) {
  if (k === "r" || k === "R") { clearAll(); return false; }

  if (k === " ") {
    // 再生中なら一時停止、止まっていれば再生（Web版：スペースで一時停止もできる）
    if (!drawMode && tPlay > 0 && tPlay < BEATS && nodes.length > 0) {
      isPlaying = !isPlaying;
      return false;
    }
    if (passMarkers.length !== passPlan.length) {
      showMsg("先に P でパス位置を決めてください");
      return false;
    }
    for (const pm of passMarkers) { if (!pm || !pm.ready()) return false; }

    buildCumulativeAll();
    ballInAir = false; passTarget = -1;
    ballOwner = chooseInitialOwnerFromQueue();
    buildNodesFromPassMarkers();
    rebuildAnchorsFromNodes();
    addTempoAnchorsForPassersOnly();
    resetDefenseForReplay();

    playbackPassIdx = 0;
    tPlay = 0;
    isPlaying = true;
    drawMode = false;
    plannedCatchPos = null;
    passFlightBeats = 0;
    return false;
  }

  if (k === "+" || k === "=") { tSpeed = min(0.12, tSpeed + 0.01); return false; }
  if (k === "-" || k === "_") { tSpeed = max(0.01, tSpeed - 0.01); return false; }
  if (code === TAB) { drawMode = !drawMode; return false; }
  if (k === "[") { radius += 30; return false; }
  if (k === "]") { radius -= 30; return false; }

  // --- 鑑賞カメラ角度（矢印キー） ---
  if (code === LEFT_ARROW) { yaw -= 0.05; return false; }
  if (code === RIGHT_ARROW) { yaw += 0.05; return false; }
  if (code === UP_ARROW) { pitch -= 0.04; return false; }
  if (code === DOWN_ARROW) { pitch += 0.04; return false; }

  // --- 初期配置：Left/Right/Center 直接指定 ---
  if (k === "l" || k === "L") { applyFormation(0); return false; }
  if (k === "v" || k === "V") { applyFormation(1); return false; }
  if (k === "c" || k === "C") { applyFormation(2); return false; }

  if (code === BACKSPACE || code === DELETE) {
    if (passEditMode) {
      if (passMarkers.length) passMarkers.pop();
      else if (passQueue.length) passQueue.pop();
    } else {
      const kk = currentPlayer;
      paths[kk] = [];
      paths[kk].push(basePos[kk] ? basePos[kk].copy() : createVector(400, -1.5, 200));
      cums[kk] = null;
      totals[kk] = 0;
      markers[kk] = null;
      showMsg("走路をクリア：初期位置は維持");
    }
    return false;
  }

  // ★ T：キューの次に投げる（再生中＆空中でない時のみ）
  if (k === "t" || k === "T") {
    if (!isPlaying || ballInAir) return false;
    let targetIdx = -1;
    while (passIdx < passQueue.length) {
      const idx = findPlayerByLastDigit(passQueue[passIdx]);
      if (idx === -1 || idx === ballOwner) { passIdx++; continue; }
      targetIdx = idx;
      break;
    }
    if (targetIdx === -1 && currentPlayer !== ballOwner) targetIdx = currentPlayer;
    if (targetIdx !== -1 && paths[targetIdx].length > 0) {
      startPassTo(targetIdx);
      if (passIdx < passQueue.length) passIdx++;
    }
    return false;
  }

  if (code === ENTER) {
    passIdx = 0;
    if (passEditMode) passEditMode = false;
    return false;
  }

  if (k === "p" || k === "P") {
    passMarkerEdit = !passMarkerEdit;
    if (passMarkerEdit) {
      passEditMode = false;
      buildPassPlanFromQueue();
      buildCumulativeAll();
      passMarkerIdx = 0;
      passMarkers = [];
      nodes = [];
      waitingThrowClick = true;
      waitingCatchClick = false;
      if (passPlan.length) {
        const sIdx = passPlan[0][0];
        showMsg("PASS-MARKER: 投げ位置をクリック（" + JERSEY[sIdx] + " の線上）");
      } else {
        showMsg("キューが空です。RECでキュー編集→Pでマーカー");
      }
    }
    return false;
  }
  return true;
}

function hitTimeline(mx, my) {
  return mx >= tlX && mx <= tlX + tlW && my >= tlY - 6 && my <= tlY + tlH + 6;
}

function setScrubFromMouse(mx) {
  scrubT = constrain(map(mx, tlX, tlX + tlW, 0, 1), 0, 1);
  tPlay = scrubT * BEATS;
  isPlaying = false;
  recalcPlaybackStateFromTime(tPlay);
}

/* ---------- 走路の距離テーブル ---------- */
function buildCumulativeAll() {
  totalLen = 0;
  for (let k = 0; k < PLAYER_COUNT; k++) {
    const n = paths[k].length;
    if (n < 2) { cums[k] = null; totals[k] = 0; continue; }
    cums[k] = new Array(n);
    cums[k][0] = 0;
    for (let i = 1; i < n; i++) {
      cums[k][i] = cums[k][i - 1] + p5.Vector.dist(paths[k][i - 1], paths[k][i]);
    }
    totals[k] = cums[k][n - 1];
    if (totals[k] > totalLen) totalLen = totals[k];
  }
  buildMarkersAll();
}

function buildMarkersAll() {
  for (let k = 0; k < PLAYER_COUNT; k++) {
    const m = BEATS + 1;
    if (paths[k].length < 2) { markers[k] = null; continue; }
    if (markers[k] === null || markers[k].length !== m) {
      markers[k] = new Array(m);
      const L = totals[k];
      for (let i = 0; i < m; i++) markers[k][i] = L * i / (m - 1);
      markers[k][0] = 0;
      markers[k][m - 1] = totals[k];
    } else {
      const oldMax = markers[k][m - 1];
      const newMax = totals[k];
      if (oldMax > 0 && newMax > 0 && abs(oldMax - newMax) > 1e-3) {
        const sf = newMax / oldMax;
        for (let i = 0; i < m; i++) markers[k][i] *= sf;
      }
    }
  }
}

function ensureTablesFor(k) {
  if (paths[k].length < 2) return;
  const n = paths[k].length;
  if (cums[k] === null || cums[k].length !== n) {
    cums[k] = new Array(n);
    cums[k][0] = 0;
    for (let i = 1; i < n; i++) cums[k][i] = cums[k][i - 1] + p5.Vector.dist(paths[k][i - 1], paths[k][i]);
    totals[k] = cums[k][n - 1];
  }
  const m = BEATS + 1;
  if (markers[k] === null || markers[k].length !== m) {
    markers[k] = new Array(m);
    const L = totals[k];
    for (let i = 0; i < m; i++) markers[k][i] = L * i / (m - 1);
  }
}

// 指定選手kの距離dに対応する位置（線形補間）
function posAt(k, d) {
  const path = paths[k];
  const cum = cums[k];
  const total = totals[k];
  if (path.length === 0) return createVector(400, 0, 200);
  if (path.length === 1 || cum === null) return path[0].copy();
  if (d <= 0) return path[0].copy();
  if (d >= total) return path[path.length - 1].copy();
  let i = 1;
  while (i < cum.length && cum[i] < d) i++;
  const segStartDist = cum[i - 1];
  const segLen = cum[i] - segStartDist;
  const t = segLen === 0 ? 0 : (d - segStartDist) / segLen;
  return p5.Vector.lerp(path[i - 1], path[i], t);
}

// index k の「いま表示している位置」を返す
function currentDisplayPos(k) {
  if (k < 0) return createVector(400, 0, 200);
  if (paths[k].length >= 2) {
    if (cums[k] === null) ensureTablesFor(k);
    const t = constrain(tPlay, 0, BEATS);
    // 1) パスマーカーから生成されたアンカーがあれば最優先
    if (anchors[k] && anchors[k].length >= 2) {
      const s = constrain(sAtTimeUsingAnchors(k, t), 0, totals[k]);
      return posAt(k, s);
    }
    // 2) ビートマーカー
    if (markers[k] !== null) {
      const seg = constrain(Math.floor(t), 0, BEATS - 1);
      const a = t - seg;
      return posAt(k, lerp(markers[k][seg], markers[k][seg + 1], a));
    }
    // 3) 等速
    return posAt(k, totals[k] * (t / BEATS));
  }
  if (paths[k].length > 0) return paths[k][paths[k].length - 1].copy();
  return createVector(400, 0, 200);
}

function startPassTo(targetIdx) {
  if (targetIdx < 0 || targetIdx >= PLAYER_COUNT || targetIdx === ballOwner) return;
  const sPos = currentDisplayPos(ballOwner);
  const rPos = currentDisplayPos(targetIdx);
  if (isForwardPass(sPos, rPos)) { showMsg("FORWARD PASS — blocked"); return; }
  passTarget = targetIdx;
  ballInAir = true;
  passT = 0;
  passStart = sPos.copy();
}

function clearAll() {
  for (let i = 0; i < PLAYER_COUNT; i++) { paths[i] = []; cums[i] = null; totals[i] = 0; }
  isPlaying = false;
  distAlong = 0;
  totalLen = 0;
  drawMode = true;
  tPlay = 0;
  applyFormation(formation);

  ballOwner = chooseInitialOwnerFromQueue();
  ballInAir = false;
  passTarget = -1;
  passIdx = 0;
  playEnded = false;

  passMarkers = [];
  passPlan = [];
  nodes = [];
  playbackPassIdx = 0;
  passMarkerIdx = 0;
  passMarkerEdit = false;
  anchors = new Array(PLAYER_COUNT).fill(null);
}

function applyFormation(mode) {
  formation = mode;
  if (mode === 0) { SCRUM_X = 150; SCRUM_Z = 200; }
  else if (mode === 1) { SCRUM_X = 650; SCRUM_Z = 200; }
  else { SCRUM_X = 400; SCRUM_Z = 200; }

  // 座標系：X(0..800) 左→右、Z(0..400) 上→下。Y=0が地面、高さは-値で上方向。
  const left = new Array(PLAYER_COUNT);
  const scrumX = 200, scrumZ = 200;
  // インデックス: 0:9, 1:10, 2:11, 3:12, 4:13, 5:14, 6:15
  left[0] = createVector(scrumX - 50, -1.5, scrumZ + 20);
  left[1] = createVector(scrumX + 50, -1.5, scrumZ + 75);
  left[3] = createVector(scrumX + 150, -1.5, scrumZ + 100);
  left[4] = createVector(scrumX + 250, -1.5, scrumZ + 100);
  left[2] = createVector(scrumX + 100, -1.5, scrumZ + 150);
  left[5] = createVector(scrumX + 450, -1.5, scrumZ + 150);
  left[6] = createVector(scrumX + 350, -1.5, scrumZ + 150);

  const pos = new Array(PLAYER_COUNT);
  if (mode === 0) {
    for (let k = 0; k < PLAYER_COUNT; k++) pos[k] = left[k].copy();
  } else if (mode === 1) {
    for (let k = 0; k < PLAYER_COUNT; k++) pos[k] = createVector(800 - left[k].x, -1.5, left[k].z);
  } else {
    const cx0 = 400, cz0 = 200;
    pos[0] = createVector(cx0, -1.5, cz0 + 20);
    pos[1] = createVector(cx0 - 100, -1.5, cz0 + 50);
    pos[3] = createVector(cx0 + 250, -1.5, cz0 + 100);
    pos[4] = createVector(cx0 - 200, -1.5, cz0 + 100);
    pos[2] = createVector(cx0, -1.5, cz0 + 150);
    pos[5] = createVector(cx0 - 300, -1.5, cz0 + 100);
    pos[6] = createVector(cx0 + 100, -1.5, cz0 + 50);
  }

  for (let k = 0; k < PLAYER_COUNT; k++) {
    basePos[k] = pos[k].copy();
    paths[k] = [pos[k]];
    cums[k] = null; totals[k] = 0;
    markers[k] = null;
  }

  if (formation === 1) ATTACK_DIR.set(-1, 0, 0);
  else ATTACK_DIR.set(1, 0, 0);

  initOpponents();
  if (formation === 0) initDefenseForScrum(+1);
  else if (formation === 1) initDefenseForScrum(-1);
  else initDefenseForCenter();
  shiftClosestDefenseZ(+20);
  prevTPlay = tPlay;
}

function drawJerseyLabels() {
  hud.push();
  hud.textFont(HUD_FONT);
  hud.textSize(12);
  hud.textAlign(CENTER, CENTER);
  hud.rectMode(CENTER);
  for (let k = 0; k < PLAYER_COUNT; k++) {
    const t = String(JERSEY[k]);
    const w = max(18, hud.textWidth(t) + 8);
    hud.noStroke();
    if (k === ballOwner) hud.fill(255, 200, 0, 220);
    else hud.fill(0, 170);
    hud.rect(labelSX[k], labelSY[k], w, 18, 6);
    hud.fill(255);
    hud.text(t, labelSX[k], labelSY[k] + 0.5);
    labelW[k] = w;
    labelH[k] = 18;
  }
  hud.pop();
}

function chooseInitialOwnerFromQueue() {
  for (let i = 0; i < passQueue.length; i++) {
    const idx = findPlayerByLastDigit(passQueue[i]);
    if (idx !== -1) return idx;
  }
  return 0;
}

function passerFor(i) {
  if (i === 0) return chooseInitialOwnerFromQueue();
  return findPlayerByLastDigit(passQueue[i - 1]);
}

function receiverFor(i) { return findPlayerByLastDigit(passQueue[i]); }

// nodes -> anchors を構築
function rebuildAnchorsFromNodes() {
  for (let k = 0; k < PLAYER_COUNT; k++) {
    anchors[k] = [];
    if (paths[k].length >= 2) {
      ensureTablesFor(k);
      anchors[k].push(new Anchor(0, 0));
      anchors[k].push(new Anchor(BEATS, totals[k]));
    }
  }
  for (const nd of nodes) {
    if (nd.sender >= 0 && paths[nd.sender].length >= 2) anchors[nd.sender].push(new Anchor(nd.tThrow, nd.sSend));
    if (nd.receiver >= 0 && paths[nd.receiver].length >= 2) anchors[nd.receiver].push(new Anchor(nd.t, nd.sRecv));
  }
  // ソート・端点保証・単調化
  for (let k = 0; k < PLAYER_COUNT; k++) {
    const ak = anchors[k];
    if (!ak || ak.length === 0) continue;
    ak.sort(BY_TIME);
    if (abs(ak[0].t) > 1e-6) ak.unshift(new Anchor(0, 0));
    if (abs(ak[ak.length - 1].t - BEATS) > 1e-6) ak.push(new Anchor(BEATS, totals[k]));
    ak.sort(BY_TIME);
    ak[0].s = 0;
    for (let i = 1; i < ak.length; i++) {
      ak[i].s = max(ak[i].s, ak[i - 1].s + 0.1);
      ak[i].s = min(ak[i].s, totals[k]);
    }
    ak[ak.length - 1].s = totals[k];
  }
}

// アンカーから s(t) を補間
function sAtTimeUsingAnchors(k, t) {
  const a = anchors[k];
  if (!a || a.length === 0) return 0;
  if (a.length === 1) return a[0].s;
  if (t <= a[0].t) return a[0].s;
  if (t >= a[a.length - 1].t) return a[a.length - 1].s;
  for (let i = 1; i < a.length; i++) {
    const L = a[i - 1], R = a[i];
    if (t <= R.t) {
      const u = R.t === L.t ? 0 : (t - L.t) / (R.t - L.t);
      return lerp(L.s, R.s, u);
    }
  }
  return a[a.length - 1].s;
}

// ユーザーのパスマーカー → nodes（パス時刻は等分で割り当て）
function buildNodesFromPassMarkers() {
  nodes = [];
  const K = passPlan.length;
  if (K === 0) return;
  for (let i = 0; i < K; i++) {
    if (i >= passMarkers.length) break;
    const pm = passMarkers[i];
    if (!pm || !pm.ready()) continue;
    const passer = pm.passer;
    const recv = pm.receiver;
    const sP = pm.sThrow;
    const sR = pm.sCatch;
    const t_i = (i + 1) * (BEATS / (K + 1));   // キャッチ時刻

    const pThrow = posAt(passer, sP);
    const pCatch = posAt(recv, sR);
    const flight = dist(pThrow.x, pThrow.z, pCatch.x, pCatch.z) / BALL_PX_PER_BEAT;

    const nd = new PassNode(passer, recv, createVector(pThrow.x, -1.5, pThrow.z), t_i, false);
    nd.sSend = sP;
    nd.sRecv = sR;
    nd.flightBeats = flight;
    nd.tThrow = max(0, t_i - flight);
    nodes.push(nd);
  }
}

// クリック1回＝現在のパス(step)のパスマーカーを設置
function placePassMarkerWithClick(mx, my) {
  if (passMarkerIdx >= passPlan.length) return;
  const sender = passPlan[passMarkerIdx][0];
  const receiver = passPlan[passMarkerIdx][1];
  if (paths[sender].length < 2 || paths[receiver].length < 2) {
    showMsg("両者の走路が必要です");
    return;
  }

  let pm;
  if (passMarkers.length <= passMarkerIdx) {
    pm = new PassMarker(passMarkerIdx, sender, receiver);
    passMarkers.push(pm);
    waitingThrowClick = true;
    waitingCatchClick = false;
  } else {
    pm = passMarkers[passMarkerIdx];
  }

  const click = createVector(mx, -1.5, my);

  if (waitingThrowClick || (!pm.ready() && pm.sThrow === null)) {
    const d = [0];
    const sSend = projectPointToPathS_andDist(sender, click, d);
    if (d[0] > PASS_LINE_HIT_PX) {
      showMsg("線上のみ: ±" + PASS_LINE_HIT_PX + "px");
      return;
    }
    pm.sThrow = sSend;
    waitingThrowClick = false;
    waitingCatchClick = true;
    showMsg("受け位置をクリック（" + JERSEY[receiver] + " の線上）");
    return;
  }

  if (waitingCatchClick || (!pm.ready() && pm.sCatch === null)) {
    const d2 = [0];
    const sRecv = projectPointToPathS_andDist(receiver, click, d2);
    if (d2[0] > PASS_LINE_HIT_PX) {
      showMsg("線上のみ: ±" + PASS_LINE_HIT_PX + "px");
      return;
    }
    const throwPos = posAt(sender, pm.sThrow);
    const catchPos = posAt(receiver, sRecv);
    if (PASS_BACK_ONLY && catchPos.z < throwPos.z - PASS_Z_EPS) {
      showMsg("FORWARD禁止: 受けはZ≦投げ");
      return;
    }
    pm.sCatch = sRecv;
    waitingCatchClick = false;

    buildNodesFromPassMarkers();
    rebuildAnchorsFromNodes();
    addTempoAnchorsForPassersOnly();

    passMarkerIdx++;
    if (passMarkerIdx < passPlan.length) {
      waitingThrowClick = true;
      showMsg("次の投げ位置をクリック（" + JERSEY[passPlan[passMarkerIdx][0]] + "）");
    } else {
      passMarkerEdit = false;
      showMsg("全パス設定OK。SPACEで再生");
    }
  }
}

// パス順（sender→receiverの列）を passQueue から構築
function buildPassPlanFromQueue() {
  passPlan = [];
  if (passQueue.length === 0) return;
  let cur = chooseInitialOwnerFromQueue();
  ballOwner = cur;
  for (let i = 0; i < passQueue.length; i++) {
    const idx = findPlayerByLastDigit(passQueue[i]);
    if (idx === -1 || idx === cur) continue;
    passPlan.push([cur, idx]);
    cur = idx;
  }
}

function isForwardPass(from, to) {
  if (!forwardRuleEnabled) return false;
  const v = p5.Vector.sub(to, from);
  v.y = 0;
  const d = ATTACK_DIR.copy();
  if (d.magSq() === 0) return false;
  d.normalize();
  return v.dot(d) > 1e-3;
}

function addTempoAnchorsForPassersOnly() { /* 元のコードでも空 */ }

function pickPlayerAt(mx, my) {
  // 1) 先にラベル矩形ヒット
  for (let k = PLAYER_COUNT - 1; k >= 0; k--) {
    const x = labelSX[k] - labelW[k] / 2;
    const y = labelSY[k] - labelH[k] / 2;
    if (mx >= x && mx <= x + labelW[k] && my >= y && my <= y + labelH[k]) return k;
  }
  // 2) 次に球の円ヒット（指でも押しやすいよう少し広め）
  const r = PICK_R + 4;
  for (let k = PLAYER_COUNT - 1; k >= 0; k--) {
    const dx = mx - pickSX[k], dy = my - pickSY[k];
    if (dx * dx + dy * dy <= r * r) return k;
  }
  return -1;
}

// tPlay を直接変更したとき、パス進行の内部状態を整合させる
function recalcPlaybackStateFromTime(t) {
  let owner = chooseInitialOwnerFromQueue();
  ballInAir = false;
  passTarget = -1;
  plannedCatchPos = null;
  passFlightBeats = 0;
  playbackPassIdx = 0;
  if (nodes.length === 0) { ballOwner = owner; return; }

  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const tThrow = nd.tThrow;
    const tCatch = nd.t;
    if (t >= tCatch) { owner = nd.receiver; playbackPassIdx = i + 1; continue; }
    if (t >= tThrow && t < tCatch) {
      ballOwner = nd.sender;
      passTarget = nd.receiver;
      ballInAir = true;
      passStartBeat = tThrow;
      passFlightBeats = max(1e-4, nd.flightBeats);
      passStart = posAt(nd.sender, nd.sSend);
      plannedCatchPos = posAt(nd.receiver, nd.sRecv);
      playbackPassIdx = i + 1;
      return;
    }
    if (t < tThrow) { ballOwner = owner; playbackPassIdx = i; return; }
  }
  ballOwner = owner;
}

// クリック点を選手kの走路に射影。距離sと最近点までの距離[px]を返す
function projectPointToPathS_andDist(k, pos, outDist) {
  const path = paths[k];
  if (path.length < 2) { if (outDist) outDist[0] = 1e9; return 0; }
  let bestD2 = 1e12, bestS = 0, acc = 0;
  for (let i = 1; i < path.length; i++) {
    const A = path[i - 1], B = path[i];
    const vx = B.x - A.x, vz = B.z - A.z;
    const segLen2 = vx * vx + vz * vz;
    if (segLen2 === 0) continue;
    const t = constrain(((pos.x - A.x) * vx + (pos.z - A.z) * vz) / segLen2, 0, 1);
    const px = A.x + vx * t, pz = A.z + vz * t;
    const d2 = sq(pos.x - px) + sq(pos.z - pz);
    if (d2 < bestD2) { bestD2 = d2; bestS = acc + Math.sqrt(segLen2) * t; }
    acc += Math.sqrt(segLen2);
  }
  if (outDist) outDist[0] = Math.sqrt(bestD2);
  return bestS;
}

/* ---------- 守備（相手チーム） ---------- */
function initOpponents() {
  if (!oppPos) oppPos = new Array(OPP_COUNT);
  if (!markTo) markTo = new Array(OPP_COUNT);
  if (!backPos) backPos = new Array(BACK_IDX.length);
  for (let i = 0; i < OPP_COUNT; i++) markTo[i] = DEFENDER_IDX[i];
  let idx15 = JERSEY.indexOf(15);
  if (idx15 === -1) idx15 = findPlayerByLastDigit(5);
  markTo[4] = idx15;
  for (let i = 0; i < OPP_COUNT; i++) {
    const a = currentDisplayPos(markTo[i]);
    oppPos[i] = createVector(a.x, -BALL_R, DEF_LINE_Z);
  }
  for (let i = 0; i < BACK_IDX.length; i++) {
    const a = currentDisplayPos(BACK_IDX[i]);
    backPos[i] = createVector(a.x, -BALL_R, BACKFIELD_Z);
  }
}

function countLeftAttackers() { let c = 0; for (let i = 0; i < PLAYER_COUNT; i++) if (basePos[i].x < 400) c++; return c; }
function countRightAttackers() { let c = 0; for (let i = 0; i < PLAYER_COUNT; i++) if (basePos[i].x > 400) c++; return c; }

function moveXWithCap(p, tx, tz, maxStep) {
  let dx = tx - p.x;
  if (abs(dx) > maxStep) dx = dx > 0 ? maxStep : -maxStep;
  p.x += dx; p.z = tz;
}

// 後方11を誰に付けるか（元のコードの選び方：#11 を除いた残りから、弱い側の一番外）
function pickBack11(rest, pivot, weakRight) {
  let mark = -1;
  if (weakRight) {
    let best = -1e9;
    for (const idx of rest) if (basePos[idx].x > pivot && basePos[idx].x > best) { best = basePos[idx].x; mark = idx; }
  } else {
    let best = 1e9;
    for (const idx of rest) if (basePos[idx].x < pivot && basePos[idx].x < best) { best = basePos[idx].x; mark = idx; }
  }
  if (mark === -1 && rest.length) {
    let pick = rest[0];
    for (const idx of rest) if (abs(basePos[idx].x - pivot) > abs(basePos[pick].x - pivot)) pick = idx;
    mark = pick;
  }
  return mark;
}

function initDefenseForCenter() {
  const idx9 = findPlayerByLastDigit(9);
  const pivot = idx9 !== -1 ? basePos[idx9].x : FB15_CENTER_X;
  for (let i = 0; i < DEF_LINE_COUNT; i++) { defMark[i] = -1; defPos[i] = null; defX[i] = 0; }

  const cand = [];
  for (let i = 0; i < PLAYER_COUNT; i++) if (paths[i].length > 0 && isLineEligible(i)) cand.push(i);
  cand.sort((a, b) => abs(basePos[a].x - pivot) - abs(basePos[b].x - pivot));
  const picked = [];
  for (let i = 0; i < cand.length && picked.length < DEF_LINE_COUNT; i++) picked.push(cand[i]);

  // #9 を必ず含める
  if (idx9 !== -1 && !picked.includes(idx9)) {
    if (picked.length === 0 && cand.length) picked.push(cand[0]);
    let farIdx = 0, farDist = -1;
    for (let i = 0; i < picked.length; i++) {
      const d = abs(basePos[picked[i]].x - pivot);
      if (d > farDist) { farDist = d; farIdx = i; }
    }
    picked[farIdx] = idx9;
  }
  if (picked.length < DEF_LINE_COUNT) {
    const rest = cand.filter((i) => !picked.includes(i)).sort((a, b) => basePos[a].x - basePos[b].x);
    for (let i = 0; i < rest.length && picked.length < DEF_LINE_COUNT; i++) picked.push(rest[i]);
  }
  picked.sort((a, b) => basePos[a].x - basePos[b].x);
  for (let i = 0; i < picked.length && i < DEF_LINE_COUNT; i++) {
    const atk = picked[i];
    defMark[i] = atk;
    defX[i] = basePos[atk].x;
    defPos[i] = createVector(defX[i], -1.5, DEF_LINE_Z);
    defZ[i] = DEF_LINE_Z;
  }

  const lineSet = new Set(defMark);
  const rest = [];
  for (let i = 0; i < PLAYER_COUNT; i++) if (!lineSet.has(i)) rest.push(i);
  let cntL = 0, cntR = 0;
  for (let i = 0; i < DEF_LINE_COUNT; i++) { if (basePos[defMark[i]].x < pivot) cntL++; else cntR++; }
  const weakRight = cntR < cntL;

  // 元のコードでは、#11 を除いて選んだあと、全員から選び直している（後の方が有効）
  backMark11 = pickBack11(rest, pivot, weakRight);

  backMark15 = -1;
  for (const idx of rest) { if (JERSEY[idx] === 15 && idx !== backMark11) { backMark15 = idx; break; } }

  const z11 = DEF_LINE_Z - BACK11_Z_OFFSET;
  const z15 = DEF_LINE_Z - BACK15_Z_OFFSET;
  defBack11.set(backMark11 >= 0 ? basePos[backMark11].x : (weakRight ? pivot + 110 : pivot - 110), -1.5, z11);
  defBack15.set(FB15_CENTER_X, -1.5, z15);
  back11ZOffset = 0;
  back15ZOffset = 0;
}

// openDir: +1 = +X 側がオープン（左スクラム） / -1 = -X 側がオープン（右スクラム）
function initDefenseForScrum(openDir) {
  const pivot = openDir > 0 ? 200 : 600;
  const cand = [];
  for (let i = 0; i < PLAYER_COUNT; i++) if (paths[i].length > 0 && isLineEligible(i)) cand.push(i);

  const L = [], R = [];
  for (const idx of cand) { if (basePos[idx].x < pivot) L.push(idx); else R.push(idx); }
  R.sort((a, b) => (basePos[a].x - pivot) - (basePos[b].x - pivot));
  L.sort((a, b) => (pivot - basePos[a].x) - (pivot - basePos[b].x));

  const line = [];
  const first = openDir > 0 ? L : R;
  const second = openDir > 0 ? R : L;
  for (const idx of first) if (line.length < DEF_LINE_COUNT) line.push(idx);
  for (const idx of second) if (line.length < DEF_LINE_COUNT) line.push(idx);

  line.sort((a, b) => basePos[a].x - basePos[b].x);
  for (let i = 0; i < DEF_LINE_COUNT; i++) {
    const atk = line[i];
    defMark[i] = atk;
    defX[i] = basePos[atk].x;
    defPos[i] = createVector(defX[i], -1.5, DEF_LINE_Z);
    defZ[i] = DEF_LINE_Z;
  }

  const lineSet = new Set(line);
  const rest = [];
  for (let i = 0; i < PLAYER_COUNT; i++) if (!lineSet.has(i)) rest.push(i);
  const restNo11 = rest.filter((idx) => JERSEY[idx] !== 11);

  let cntL = 0, cntR = 0;
  for (const idx of line) { if (basePos[idx].x < pivot) cntL++; else cntR++; }
  const weakRight = cntR < cntL;

  backMark11 = pickBack11(restNo11, pivot, weakRight);

  backMark15 = -1;
  for (const idx of rest) { if (JERSEY[idx] === 15 && idx !== backMark11) { backMark15 = idx; break; } }

  const z11 = DEF_LINE_Z - BACK11_Z_OFFSET;
  const z15 = DEF_LINE_Z - BACK15_Z_OFFSET;
  defBack11.set(backMark11 >= 0 ? basePos[backMark11].x : (weakRight ? pivot + 110 : pivot - 110), -1.5, z11);
  defBack15.set(FB15_CENTER_X, -1.5, z15);
  back11ZOffset = 0;
  back15ZOffset = 0;
}

function updateDefense(dtBeats) {
  if (defPos[0] === null) return;

  // ★ スクラブ（大きく時間が飛んだ）かどうかを判定
  const snapToTime = userScrubbing || abs(tPlay - prevTPlay) >= DEF_SPEED_SCRUB_SNAP_BEATS;

  // 1) ラインDFの目標X（担当アタッカーの現在X）を取得し、左→右で間隔を確保
  const target = [];
  for (let i = 0; i < DEF_LINE_COUNT; i++) target[i] = currentDisplayPos(defMark[i]).x;
  target.sort((a, b) => a - b);
  for (let i = 1; i < DEF_LINE_COUNT; i++) {
    if (target[i] - target[i - 1] < DEF_SEP_X) target[i] = target[i - 1] + DEF_SEP_X;
  }

  // 2) スナップ or 速度制限追従
  const step = DEF_SPEED * dtBeats;
  for (let i = 0; i < DEF_LINE_COUNT; i++) {
    if (snapToTime) {
      defX[i] = target[i];
    } else {
      let dx = target[i] - defX[i];
      if (abs(dx) > step) dx = dx > 0 ? step : -step;
      defX[i] += dx;
    }
    defPos[i].x = defX[i];

    // Z の微追従
    const baseZ = defZ[i];
    const markZ = currentDisplayPos(defMark[i]).z;
    const drift = constrain((markZ - baseZ) * DEF_Z_FOLLOW, -DEF_Z_DRIFT_MAX, DEF_Z_DRIFT_MAX);
    const zTarget = max(baseZ + drift, baseZ - DEF_LINE_SAFE_MARGIN);
    if (snapToTime) {
      defPos[i].z = zTarget;
    } else {
      const stepZ = DEF_Z_SPEED * dtBeats;
      let dz = zTarget - defPos[i].z;
      if (abs(dz) > stepZ) dz = dz > 0 ? stepZ : -stepZ;
      defPos[i].z += dz;
    }
  }

  // 3) 後方11
  if (SHOW_DEF_BACK11) {
    const tz11 = DEF_LINE_Z - BACK11_Z_OFFSET + back11ZOffset;
    const tx11 = backMark11 >= 0
      ? currentDisplayPos(backMark11).x
      : (countRightAttackers() < countLeftAttackers() ? 400 + 110 : 400 - 110);
    if (snapToTime) { defBack11.x = tx11; defBack11.z = tz11; }
    else moveXWithCap(defBack11, tx11, tz11, BACK_SPEED * dtBeats);
  }

  // 4) 後方15
  if (SHOW_DEF_BACK15) {
    const tz15 = DEF_LINE_Z - BACK15_Z_OFFSET + back15ZOffset;
    const bx = currentBallXForDefense();
    let tx = abs(bx - FB15_CENTER_X) < FB15_DEADBAND ? FB15_CENTER_X : bx;
    tx = lerp(FB15_CENTER_X, tx, 1.0 - FB15_CENTRAL_BIAS);
    tx += FB15_LEAD_X * ATTACK_DIR.x;
    tx = constrain(tx, FB15_MIN_X, FB15_MAX_X);
    if (snapToTime) { defBack15.x = tx; defBack15.z = tz15; }
    else moveXWithCap(defBack15, tx, tz15, BACK_SPEED * FB15_SPEED_SCALE * dtBeats);
  }

  prevTPlay = tPlay;
}

function drawDefense() {
  push();
  noStroke();
  fill(ENEMY_RED);
  for (let i = 0; i < DEF_LINE_COUNT; i++) {
    if (defPos[i] === null) continue;
    push(); translate(defPos[i].x, playerHoverY, defPos[i].z); sphere(BALL_R, 16, 12); pop();
  }
  if (SHOW_DEF_BACK11) { push(); translate(defBack11.x, playerHoverY, defBack11.z); sphere(BALL_R, 16, 12); pop(); }
  if (SHOW_DEF_BACK15) { push(); translate(defBack15.x, playerHoverY, defBack15.z); sphere(BALL_R, 16, 12); pop(); }
  pop();
}

function currentBallXForDefense() {
  if (ballInAir) {
    if (plannedCatchPos !== null && passFlightBeats > 0) {
      const u = constrain((tPlay - passStartBeat) / passFlightBeats, 0, 1);
      return lerp(passStart.x, plannedCatchPos.x, u);
    } else if (passTarget >= 0) {
      return lerp(passStart.x, currentDisplayPos(passTarget).x, passT);
    }
    return passStart !== null ? passStart.x : currentDisplayPos(ballOwner).x;
  }
  return currentDisplayPos(ballOwner).x;
}

function drawScrumMarker() {
  // 3D: 地面に円
  push();
  translate(SCRUM_X, -1.5, SCRUM_Z);
  rotateX(HALF_PI);
  noStroke();
  fill(255, 255, 255, 70);
  ellipse(0, 0, SCRUM_RX * 2, SCRUM_RZ * 2, 32);
  noFill();
  stroke(255, 230);
  strokeWeight(2);
  ellipse(0, 0, SCRUM_RX * 2, SCRUM_RZ * 2, 32);
  pop();

  // HUD: 「SCRUM」のラベル
  const s = toScreen(SCRUM_X, -1.5, SCRUM_Z);
  const sx = s.x, sy = s.y - 18;
  hud.push();
  hud.textFont(HUD_FONT);
  hud.textSize(12);
  hud.textAlign(CENTER, CENTER);
  hud.rectMode(CENTER);
  const w = max(40, hud.textWidth("SCRUM"));
  hud.noStroke(); hud.fill(0, 150);
  hud.rect(sx, sy + 15, w, 16, 6);
  hud.fill(255);
  hud.text("SCRUM", sx, sy + 15);
  hud.pop();
}

// スクラムに最も近いディフェンス1人のZを +dz
function shiftClosestDefenseZ(dz) {
  let best = 1e12, bestType = -1, bestIdx = -1;
  for (let i = 0; i < DEF_LINE_COUNT; i++) {
    if (defPos[i] === null) continue;
    const d2 = sq(defPos[i].x - SCRUM_X) + sq(defPos[i].z - SCRUM_Z);
    if (d2 < best) { best = d2; bestType = 0; bestIdx = i; }
  }
  if (SHOW_DEF_BACK11) {
    const d2 = sq(defBack11.x - SCRUM_X) + sq(defBack11.z - SCRUM_Z);
    if (d2 < best) { best = d2; bestType = 1; }
  }
  if (SHOW_DEF_BACK15) {
    const d2 = sq(defBack15.x - SCRUM_X) + sq(defBack15.z - SCRUM_Z);
    if (d2 < best) { best = d2; bestType = 2; }
  }
  if (bestType === 0 && bestIdx >= 0) defZ[bestIdx] += dz;
  else if (bestType === 1) back11ZOffset += dz;
  else if (bestType === 2) back15ZOffset += dz;

  for (let i = 0; i < DEF_LINE_COUNT; i++) if (defPos[i] !== null) defPos[i].z = defZ[i];
  defBack11.z = DEF_LINE_Z - BACK11_Z_OFFSET + back11ZOffset;
  defBack15.z = DEF_LINE_Z - BACK15_Z_OFFSET + back15ZOffset;
}

function resetDefenseForReplay() {
  if (formation === 0) initDefenseForScrum(+1);
  else if (formation === 1) initDefenseForScrum(-1);
  else initDefenseForCenter();
  shiftClosestDefenseZ(+20);
}

/* ---------- 画面上の文字（HUD） ---------- */
function hintText() {
  const h = hud;
  h.push();
  h.textFont(HUD_FONT);
  h.rectMode(CORNER);

  const PAD = 8, GAP_S = 4, GAP_M = 6;
  const H_TOP = 18, H_CTRL = 16, H_QUEUE = 16, H_TL = 8;
  const FS_TOP = 10, FS_BODY = 9, FS_TOAST = 10;
  const margin = 10;
  const x = 10;
  let y = 10;
  const wFull = width - 20;

  // ===== 1) ステータス帯 =====
  const modeChip = drawMode ? "DRAW" : "VIEW";
  const leftInfo = drawMode
    ? "  ドラッグ=走路  /  Shift+ドラッグ=初期位置  /  選手クリック=選択  "
    : "  右ドラッグ=回転  /  ←→↑↓=角度  /  [ ]・ホイール=ズーム  ";

  let nextStr = "-";
  if (passIdx < passQueue.length) {
    const d = passQueue[passIdx];
    const idx = findPlayerByLastDigit(d);
    nextStr = idx === -1 ? String(d) : String(JERSEY[idx]);
  }
  const rightInfo = "Sel:" + JERSEY[currentPlayer] + "   Ball:" + JERSEY[ballOwner] + "   Next:" + nextStr + "   Form:" + FORM_NAME[formation];

  h.textSize(FS_TOP);
  const chipW = h.textWidth(modeChip) + 14;
  const leftBarW = PAD + chipW + 6 + h.textWidth(leftInfo) + PAD;
  h.noStroke(); h.fill(0, 170);
  h.rect(x, y, leftBarW, H_TOP, 7);
  if (drawMode) h.fill(60, 180, 90, 230); else h.fill(60, 140, 220, 230);
  h.rect(x + PAD - 6, y + 3, chipW, H_TOP - 6, 9);
  h.fill(255); h.textAlign(LEFT, CENTER);
  h.text(modeChip, x + PAD, y + H_TOP / 2);
  h.text(leftInfo, x + PAD + chipW + 6, y + H_TOP / 2);

  const rW = h.textWidth(rightInfo) + PAD * 1.5;
  h.fill(0, 145);
  h.rect(width - margin - rW, y, rW, H_TOP, 7);
  h.fill(255); h.textAlign(RIGHT, CENTER);
  h.text(rightInfo, width - margin - PAD * 0.75, y + H_TOP / 2);

  // ===== 2) 操作ガイド帯 =====
  y += H_TOP + GAP_S;
  const controls = "SPACE=再生/一時停止   T=次に投げる(キュー)   M=描画↔鑑賞   P=PASS-MARKER編集   R=全リセット   L/V/C=配置";
  h.textSize(FS_BODY);
  const ctrlW = h.textWidth(controls) + PAD * 2;
  h.fill(0, 155); h.rect(x, y, ctrlW, H_CTRL, 7);
  h.fill(255); h.textAlign(LEFT, CENTER);
  h.text(controls, x + PAD, y + H_CTRL / 2);

  // ===== 3) パスキュー帯（REC付き） =====
  y += H_CTRL + GAP_S;
  let q = (passEditMode ? "[REC:編集中]  " : (passQueue.length ? "[REC:ON]  " : "[REC:OFF]  ")) + "Queue: ";
  for (let i = 0; i < passQueue.length; i++) {
    let piece = String(passQueue[i]);
    if (i === passIdx) piece = ">" + piece + "<";
    q += piece;
    if (i < passQueue.length - 1) q += " → ";
  }
  h.textSize(FS_BODY);
  const boxW = h.textWidth(q) + PAD * 2;
  h.fill(0, 155); h.rect(x, y, boxW, H_QUEUE, 7);
  h.fill(255); h.textAlign(LEFT, CENTER);
  h.text(q, x + PAD, y + H_QUEUE / 2);

  // RECボタン
  recX = x + boxW + 6;
  recY = y; recW = 44; recH = H_QUEUE;
  h.noStroke();
  if (passEditMode) h.fill(220, 60, 60, 210); else h.fill(90, 90, 90, 210);
  h.rect(recX, recY, recW, recH, 7);
  h.fill(255); h.textAlign(CENTER, CENTER);
  h.text("REC", recX + recW / 2, recY + recH / 2);

  // 再生情報
  const playInfo = nf(tPlay, 1, 2) + " / " + BEATS + " beats    speed:" + nf(tSpeed, 1, 2);
  const pW = h.textWidth(playInfo) + PAD * 2;
  h.fill(0, 140); h.rect(width - margin - pW, y, pW, H_QUEUE, 7);
  h.fill(255); h.textAlign(RIGHT, CENTER);
  h.text(playInfo, width - margin - PAD, y + H_QUEUE / 2);

  // ===== 4) タイムライン =====
  y += H_QUEUE + GAP_M;
  tlX = x; tlY = y; tlW = wFull; tlH = H_TL;
  h.noStroke(); h.fill(0, 110); h.rect(tlX, tlY, tlW, tlH, 5);
  const prog = constrain(tPlay / BEATS, 0, 1);
  h.fill(255, 200, 0); h.rect(tlX, tlY, tlW * prog, tlH, 5);
  h.stroke(255, 210); h.strokeWeight(1.25);
  for (let b = 0; b <= BEATS; b++) {
    const tx = tlX + tlW * (b / BEATS);
    h.line(tx, tlY - 4, tx, tlY + tlH + 4);
  }
  h.noStroke();
  for (const nd of nodes) {
    const tx = tlX + tlW * (nd.tThrow / BEATS);
    const y0 = tlY - 10, y1 = tlY - 2;
    h.fill(255, 210, 0); h.triangle(tx, y0, tx - 4.5, y1, tx + 4.5, y1);
  }

  // ===== 5) パスマーカー編集ガイド（ON時のみ） =====
  if (passMarkerEdit) {
    const info = "PASS-MARKER: [線上±" + PASS_LINE_HIT_PX + "px" + (PASS_BACK_ONLY ? " / 前方禁止" : "") + "]  "
      + (passMarkerIdx < passPlan.length
        ? "投げ位置→受け位置をクリック (" + (passMarkerIdx + 1) + "/" + passPlan.length + ")"
        : "全パス設定OK：SPACEで再生");
    h.textSize(FS_BODY);
    const infoW = h.textWidth(info) + PAD * 2;
    y += tlH + GAP_S;
    h.fill(0, 155); h.rect(x, y, infoW, 18, 7);
    h.fill(255); h.textAlign(LEFT, CENTER);
    h.text(info, x + PAD, y + 9);
    const pm = "Markers " + passMarkers.length + " / " + passPlan.length;
    const pmW = h.textWidth(pm) + PAD * 2;
    h.fill(0, 140); h.rect(width - margin - pmW, y, pmW, 18, 7);
    h.fill(255); h.textAlign(RIGHT, CENTER);
    h.text(pm, width - margin - PAD, y + 9);
  }

  // ===== 6) トースト =====
  if (hudMsgTimer > 0) {
    h.textSize(FS_TOAST);
    const pad2 = 12;
    const wm = h.textWidth(hudMsg) + pad2 * 2;
    const xm = width / 2 - wm / 2;
    const ym = tlY + tlH + 30;
    h.noStroke(); h.fill(0, 175); h.rect(xm, ym, wm, 22, 7);
    h.fill(255); h.textAlign(CENTER, CENTER);
    h.text(hudMsg, xm + wm / 2, ym + 11);
    hudMsgTimer--;
  }
  h.pop();
}

/* ---------- 画面の下のボタン（キーと同じ操作） ---------- */
function updateButtons() {
  const set = (id, on) => {
    const b = document.getElementById(id);
    if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
  };
  set("bShift", shiftHeld);
  set("bRec", passEditMode);
  set("bPass", passMarkerEdit);
  set("bMode", !drawMode);
  updateSteps();
}

// 遊び方の手順：どこまでできたかを調べて、今やる手順と次に押すボタンを光らせる
function updateSteps() {
  const drawn = paths.filter((p) => p.length >= 2).length;
  const done1 = drawn >= 2;
  const done2 = done1 && passQueue.length >= 2 && !passEditMode;
  const done3 = done2 && passPlan.length > 0 && passMarkers.length === passPlan.length && passMarkers.every((m) => m && m.ready());
  const done4 = done3 && !drawMode && nodes.length > 0 && tPlay > 0;
  const done = [done1, done2, done3, done4];
  const now = done.indexOf(false);
  for (let i = 0; i < 4; i++) {
    const li = document.getElementById("s" + (i + 1));
    if (!li) continue;
    li.classList.toggle("done", done[i]);
    li.classList.toggle("now", i === now);
  }

  let msg = "";
  let hintId = "";
  if (now === 0) msg = drawn === 0 ? "まず選手を1人押して選び、フィールドをなぞってコースを描きましょう" : "あと " + (2 - drawn) + " 人、コースを描きましょう（別の選手を押してから、なぞる）";
  else if (now === 1) {
    if (!passEditMode) { msg = "「パス順を記録」を押して、パスの順番を決めましょう"; hintId = "bRec"; }
    else if (passQueue.length < 2) msg = "ボールが渡る順に、フィールドの選手を押していきます（今 " + passQueue.length + " 人）";
    else { msg = "順番を決め終わったら、もう一度「パス順を記録」を押して終わります"; hintId = "bRec"; }
  } else if (now === 2) {
    if (!passMarkerEdit) { msg = "「パス位置」を押して、投げる所と受ける所を決めましょう"; hintId = "bPass"; }
    else if (passMarkerIdx < passPlan.length) {
      const [s, r] = passPlan[passMarkerIdx];
      msg = waitingCatchClick ? JERSEY[r] + "番の線の上で、ボールを受ける所を押します" : JERSEY[s] + "番の線の上で、ボールを投げる所を押します";
    }
  } else if (now === 3) { msg = "「再生」を押して、3Dで見てみましょう"; hintId = "bPlay"; }
  else msg = "ドラッグで視点を回せます。上のバーを押すと好きな時点に戻れます。「全リセット」で最初から";

  if (demoRunning) msg = "お手本を自動で操作しています… " + msg;
  const next = document.getElementById("next");
  if (next && next.textContent !== msg) next.textContent = msg;
  document.querySelectorAll(".keys button").forEach((b) => b.classList.toggle("hint", !!hintId && b.id === hintId));

  // 「今やること」の大きなボタン：光らせたボタンと同じ働きをする
  const bigBtn = document.getElementById("bNow");
  if (bigBtn) {
    const target = hintId && document.getElementById(hintId);
    bigBtn.hidden = !target || demoRunning;
    if (target) {
      const label = (passEditMode && hintId === "bRec") ? "記録を終わる" : target.childNodes[0].textContent.trim();
      if (bigBtn.textContent !== label) bigBtn.textContent = label;
      bigBtn.dataset.target = hintId;
    }
  }
}

/* ---------- お手本：自動で4つの手順を操作して見せる ---------- */
let demoRunning = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runDemo() {
  if (demoRunning) return;
  demoRunning = true;
  document.body.classList.add("demo");
  try {
    await sketchReady;
    clearAll();
    applyFormation(0);
    passQueue = [];
    passEditMode = false;
    shiftHeld = false;
    showMsg("お手本：発表で見せたサインプレー「ループ」");
    // 発表（EP演習 成果発表）で描いた走路を、そのまま描き直す。座標はフィールド上の位置（発表の画面から読み取り）
    const routes = [
      [9, [[149.3, 220.0], [160.6, 214.3], [172.5, 205.5], [180.2, 197.8], [187.9, 183.8], [193.1, 169.4], [200.8, 138.4]]],
      [10, [[250.9, 275.7], [262.7, 263.3], [275.6, 251.0], [288.5, 237.5], [309.2, 220.0], [327.2, 201.9], [329.8, 215.8], [337.5, 232.4], [349.9, 238.0], [365.9, 229.8], [383.9, 213.3], [402.0, 195.7], [422.6, 171.9], [448.4, 144.6], [485.6, 98.1]]],
      [12, [[350.4, 299.5], [365.9, 267.5], [376.7, 245.3], [365.9, 231.3], [359.2, 217.4], [348.9, 193.6], [340.1, 174.5], [322.0, 141.0], [305.0, 105.8]]],
      [13, [[449.5, 299.5], [458.7, 272.6], [466.5, 241.7], [469.1, 232.4], [456.2, 215.8], [445.8, 195.2], [438.1, 171.9], [427.8, 153.9], [412.3, 125.5], [400.5, 97.1]]],
      [11, [[299.9, 350.1], [327.2, 337.2], [353.0, 330.5], [378.8, 314.0], [399.4, 303.6], [422.6, 285.6], [445.8, 259.7], [461.3, 236.5], [470.6, 217.4], [479.4, 200.3], [492.3, 164.2], [505.2, 133.2], [512.4, 119.8], [520.6, 98.1]]],
      [15, [[550.5, 350.1], [552.6, 308.8], [555.7, 257.2], [556.2, 205.5], [556.2, 153.9], [556.2, 125.0], [552.6, 86.7], [550.5, 52.1], [547.5, 19.6]]],
      [14, [[649.6, 350.1], [653.7, 329.4], [650.6, 288.1], [644.4, 231.3], [636.7, 179.7], [631.5, 128.1], [630.0, 91.9], [639.3, 76.4], [647.5, 67.1], [670.2, 45.4], [701.2, 22.2], [716.6, 13.4]]],
    ];
    for (const [jersey, pts] of routes) {
      const k = JERSEY.indexOf(jersey);
      currentPlayer = k;
      showMsg("Select: " + jersey);
      await wait(200);
      // 最初の点は選手の位置そのものなので、2点目から足す
      for (let i = 1; i < pts.length; i++) {
        for (let t = 1 / 4; t <= 1.0001; t += 1 / 4) {
          const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
          const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
          paths[k].push(createVector(x, -1.5, y));
          cums[k] = null; totals[k] = 0; markers[k] = null;
          await wait(14);
        }
      }
    }
    // ② パスの順番：9 → 10 → 12 → 10（ループ）→ 11 → 15 → 14
    passEditMode = true;
    showMsg("Queue REC: ON");
    await wait(500);
    for (const d of [9, 0, 2, 0, 1, 5, 4]) { passQueue.push(d); showMsg("Queue += " + JERSEY[findPlayerByLastDigit(d)]); await wait(380); }
    passEditMode = false;
    showMsg("Queue REC: OFF");
    await wait(500);
    // ③ パスの位置：投げる所 → 受ける所 を6本分
    handleKey("p", 80);
    await wait(500);
    const marks = [[160.6, 214.3], [262.7, 263.3], [327.2, 201.9], [359.2, 217.4], [348.9, 193.6], [349.9, 238.0],
      [402.0, 195.7], [470.6, 217.4], [512.4, 119.8], [556.2, 125.0], [550.5, 52.1], [647.5, 67.1]];
    for (const [x, y] of marks) { placePassMarkerWithClick(x, y); await wait(350); }
    // ④ 再生：発表の台本と同じ3つの場面を、ボールを持っている選手に合わせて一言で出す
    await wait(400);
    handleKey(" ", 32);
    watchLoopPhases();
  } finally {
    demoRunning = false;
    document.body.classList.remove("demo");
  }
}

// 発表の台本：①ループ（10と12）→ ②ゲイン（13の裏から11）→ ③展開（15と14で外へ）
const LOOP_PHASES = [
  { owners: [9, 10, 12], text: "① ループ：10 と 12 のループパスで、敵を引きつける" },
  { owners: [11], text: "② ゲイン：13 にパスすると見せて、裏の 11 へ" },
  { owners: [15, 14], text: "③ 展開：内側に敵が集まり、空いた外へ 15 → 14" },
];
function loopPhase() {
  const owner = JERSEY[ballInAir && passTarget >= 0 ? passTarget : ballOwner];
  return LOOP_PHASES.findIndex((ph) => ph.owners.includes(owner));
}
function watchLoopPhases() {
  const timer = setInterval(() => {
    const i = loopPhase();
    if (i >= 0) showMsg(LOOP_PHASES[i].text);
    if (playEnded || !isPlaying) clearInterval(timer);
  }, 400);
}

function openIntro(show) {
  const intro = document.getElementById("intro");
  if (intro) intro.hidden = !show;
  if (!show) {
    try { localStorage.setItem("scrumIntroSeen", "1"); } catch (e) { /* 覚えられなくても遊べる */ }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // 初めて開いた人には「使い方」を出す
  let seen = null;
  try { seen = localStorage.getItem("scrumIntroSeen"); } catch (e) { seen = null; }
  // 作品ページの「発表のお手本を見る」から開いたときは、案内を出さずにお手本を始める
  if (new URLSearchParams(location.search).has("demo")) {
    openIntro(false);
    setTimeout(runDemo, 600);
  } else {
    openIntro(!seen);
  }
  document.getElementById("bHelp").addEventListener("click", () => openIntro(true));
  document.getElementById("bIntroClose").addEventListener("click", () => openIntro(false));
  document.getElementById("bIntroDemo").addEventListener("click", () => { openIntro(false); runDemo(); });
  document.getElementById("bDemo").addEventListener("click", () => { openIntro(false); runDemo(); });
  document.getElementById("bNow").addEventListener("click", (e) => {
    const t = document.getElementById(e.currentTarget.dataset.target);
    if (t) t.click();
  });

  document.querySelectorAll("[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.blur();
      const k = btn.dataset.key;
      if (k === "SHIFT") { shiftHeld = !shiftHeld; return; }
      if (k === "REC") { passEditMode = !passEditMode; showMsg(passEditMode ? "Queue REC: ON" : "Queue REC: OFF"); return; }
      const codes = { TAB: TAB, BACKSPACE: BACKSPACE, ENTER: ENTER };
      handleKey(codes[k] ? "" : k, codes[k] || 0);
    });
  });
});
