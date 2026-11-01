/* =========================================================
   トップの演出（index.html だけで読み込む）
   ・名前「Eisuke Kinoshita」が1万〜2万の細かい光の粒でできている（書体：Gen Interface JP Display）。
     触れると渦を巻いて散り、ばねのように戻る。ときどき光の波が文字を横切る
   ・その後ろで、たくさんの光の粒が目に見えない「流れ」に沿って動き、線の跡を残す（前の版の演出）
   ・クリック・タップで波紋が広がり、名前の粒も弾ける
   ・スマホを傾けると、流れの向きが変わり、名前の粒が砂のように流れる
   ========================================================= */

const hero = document.querySelector(".hero");
const canvas = document.getElementById("heroCanvas");
const ctx = canvas.getContext("2d");
const nameEl = document.getElementById("heroName");
const hintEl = document.getElementById("heroHint");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouch = matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;

let w = 0;
let h = 0;
let dpr = 1;
let animation = 0;
let visible = true;
let previousFrame = 0;
let palette = {};
const pointer = { x: -9999, y: -9999 };
const tilt = { x: 0, y: 0 }; // スマホの傾き（-1〜1）
const ripples = [];         // クリック・タップでできた波紋 { x, y, r }
let flow = [];              // 背景の流れる粒
let parts = [];             // 名前の粒
let dot = 1;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function updatePalette() {
  palette = { bg: cssVar("--bg"), fg: cssVar("--fg"), accent: cssVar("--accent"), em: cssVar("--accent-2") };
}

/* ---------- 1. 名前の形から、粒の「帰る場所」を作る ---------- */
// 名前の文字を、画面と同じ位置・同じ書体で見えないキャンバスに描き、文字のある点を拾う。
// 単語ごとの位置は Range で測る（画面幅によって2行に折り返しても合う）
function buildName() {
  const off = document.createElement("canvas");
  off.width = Math.ceil(w);
  off.height = Math.ceil(h);
  const c = off.getContext("2d");
  const base = canvas.getBoundingClientRect();
  const walker = document.createTreeWalker(nameEl, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    const st = getComputedStyle(parent);
    const size = parseFloat(st.fontSize);
    c.font = `${st.fontWeight} ${size}px ${st.fontFamily}`;
    // 画面の文字と同じ字間にする（字間を詰めた書体でも、粒の文字がずれないように）
    if ("letterSpacing" in c) c.letterSpacing = st.letterSpacing === "normal" ? "0px" : st.letterSpacing;
    c.fillStyle = parent.tagName === "EM" ? palette.em : palette.fg;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(node.textContent))) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      const mt = c.measureText(m[0]);
      const asc = mt.fontBoundingBoxAscent ?? size * 0.8;
      const desc = mt.fontBoundingBoxDescent ?? size * 0.2;
      c.fillText(m[0], r.left - base.left, r.top - base.top + (r.height - (asc + desc)) / 2 + asc);
    }
  }

  const data = c.getImageData(0, 0, off.width, off.height).data;
  const size = parseFloat(getComputedStyle(nameEl).fontSize);
  // 粒の間隔：文字が大きいほど広く。数が多くなりすぎないようにする（v3：より細かく）
  let gap = Math.max(1.6, size / (isTouch ? 36 : 62));
  let count = 0;
  for (let i = 3; i < data.length; i += 4 * 3) if (data[i] > 140) count++;
  const limit = isTouch ? 7000 : 22000;
  if ((count * 3) / (gap * gap) > limit) gap = Math.sqrt((count * 3) / limit);

  const old = parts;
  parts = [];
  for (let gy = 0; gy < off.height; gy += gap) {
    for (let gx = 0; gx < off.width; gx += gap) {
      // 格子の目が見えないよう、拾う位置を少しずらす
      const x = Math.min(off.width - 1, Math.round(gx + (Math.random() - 0.5) * gap * 0.8));
      const y = Math.min(off.height - 1, Math.round(gy + (Math.random() - 0.5) * gap * 0.8));
      const i = (y * off.width + x) * 4;
      if (data[i + 3] <= 140) continue;
      const prev = old[parts.length];
      parts.push({
        tx: x, ty: y,
        x: prev ? prev.x : Math.random() * w,
        y: prev ? prev.y : h + Math.random() * 200,
        vx: 0, vy: 0,
        c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`,
        s: Math.random() < 0.06 ? 1.8 : 1,
        ph: Math.random() * Math.PI * 2, // ゆらぎの位相（粒ごとに少しずらす）
      });
    }
  }
  dot = Math.max(0.9, gap * 0.62);
  hero.classList.toggle("is-canvas-name", parts.length > 0);
}

/* ---------- 2. 背景の流れる粒 ---------- */
function newFlow() {
  return { x: Math.random() * w, y: Math.random() * h, life: Math.random() * 200, alt: Math.random() < 0.35 };
}

// 場所 (x, y) と時刻 t から「流れの向き」（角度）を決める。sin と cos を重ねるだけで、うねうねした流れになる
function angleAt(x, y, t) {
  const s = 0.0025;
  return Math.sin(x * s + t * 0.3) * 1.6 + Math.cos(y * s * 1.3 - t * 0.2) * 1.6
    + Math.atan2(tilt.y, tilt.x || 0.0001) * Math.hypot(tilt.x, tilt.y);
}

/* ---------- 3. 大きさが変わったら作り直す ---------- */
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  w = canvas.clientWidth;
  h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, w, h);
  // 画面が広いほど流れる粒を多くする（スマホは少なめ）
  flow = Array.from({ length: Math.min(700, Math.floor((w * h) / 2600)) }, newFlow);
  buildName();
}

/* ---------- 4. 毎フレーム ---------- */
function frame(time) {
  animation = 0;
  if (document.hidden || !visible) return;
  // 画面のリフレッシュレートが高くても、最大60fpsで同じ速さに動かす
  if (!still && time - previousFrame < 1000 / 60 - 1) { animation = requestAnimationFrame(frame); return; }
  const dt = previousFrame ? Math.min((time - previousFrame) / (1000 / 60), 2) : 1;
  previousFrame = time;
  const t = time / 1000;

  // 前の絵を少しだけ塗りつぶす（線の跡が残る）
  ctx.globalAlpha = still ? 1 : 0.14;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, w, h);

  // (a) 背景の流れる粒：流れに沿って動き、マウスと波紋からよける
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  for (const p of flow) {
    const a = angleAt(p.x, p.y, t);
    let vx = Math.cos(a) * 1.3;
    let vy = Math.sin(a) * 1.3;
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 140 * 140) {
      const d = Math.sqrt(d2) || 1;
      const f = (1 - d / 140) * 4;
      vx += (dx / d) * f;
      vy += (dy / d) * f;
    }
    for (const rp of ripples) {
      const ex = p.x - rp.x;
      const ey = p.y - rp.y;
      const dist = Math.hypot(ex, ey) || 1;
      const gapR = Math.abs(dist - rp.r);
      if (gapR < 40) {
        const f = (1 - gapR / 40) * 9 * (1 - rp.r / 700);
        vx += (ex / dist) * f;
        vy += (ey / dist) * f;
      }
    }
    ctx.strokeStyle = p.alt ? palette.em : palette.accent;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    p.x += vx * dt;
    p.y += vy * dt;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    p.life += dt;
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.life > 260) Object.assign(p, newFlow(), { life: 0 });
  }

  // (b) 波紋の輪を描いて、少しずつ広げる
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i];
    rp.r += 9 * dt;
    ctx.globalAlpha = Math.max(0, 1 - rp.r / 700) * 0.6;
    ctx.strokeStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
    ctx.stroke();
    if (rp.r > 700) ripples.splice(i, 1);
  }

  // (c) 名前の粒：ばねで帰る場所へ。傾きが大きいほど、ばねを弱め重力を強くする（砂のように流れる）
  ctx.globalAlpha = 1;
  const tiltAmt = Math.min(1, Math.hypot(tilt.x, tilt.y));
  const k = 0.05 * (1 - tiltAmt * 0.9);
  const gx = tilt.x * 0.9;
  const gy = tilt.y * 0.9;
  const R = isTouch ? 80 : 140;
  // 文字の上を、ゆっくり光の波が横切る（約6秒ごと）
  const wave = ((t * 0.17) % 1.4 - 0.2) * w;
  let lastColor = "";
  for (const p of parts) {
    p.vx += (p.tx - p.x) * k + gx + Math.sin(t * 1.6 + p.ph + p.ty * 0.05) * 0.05;
    p.vy += (p.ty - p.y) * k + gy + Math.cos(t * 1.3 + p.ph + p.tx * 0.05) * 0.05;
    const wd = p.tx - wave;
    if (wd > -60 && wd < 60) p.vy -= Math.cos((wd / 60) * Math.PI * 0.5) * 0.35;
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < R * R) {
      const d = Math.sqrt(d2) || 1;
      const f = (1 - d / R) * 6;
      // 押しのけつつ、少し渦を巻くように回す
      p.vx += (dx / d) * f - (dy / d) * f * 0.45;
      p.vy += (dy / d) * f + (dx / d) * f * 0.45;
    }
    p.vx *= 0.86;
    p.vy *= 0.86;
    p.x = Math.min(w - 1, Math.max(1, p.x + p.vx * dt));
    p.y = Math.min(h - 2, Math.max(1, p.y + p.vy * dt));
    if (p.c !== lastColor) { ctx.fillStyle = p.c; lastColor = p.c; }
    const s = dot * p.s;
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  if (still) {
    // 動きを減らす設定：粒を帰る場所に置いて1回だけ描く
    for (const p of parts) { ctx.fillStyle = p.c; ctx.fillRect(p.tx - dot / 2, p.ty - dot / 2, dot, dot); }
  }
  if (!still) animation = requestAnimationFrame(frame);
}

/* ---------- 5. マウス・指 ---------- */
hero.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.x = e.clientX - r.left;
  pointer.y = e.clientY - r.top;
});
hero.addEventListener("pointerleave", () => { pointer.x = pointer.y = -9999; });
hero.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") pointer.x = pointer.y = -9999; });

// ボタンやリンク以外の場所をクリック・タップすると、波紋が広がり、名前の粒が弾ける
hero.addEventListener("pointerdown", (e) => {
  if (e.target.closest("a, button") || still) return;
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  ripples.push({ x, y, r: 0 });
  if (ripples.length > 8) ripples.shift();
  for (const p of parts) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 260) {
      const f = (1 - d / 260) * 26;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
    }
  }
});

/* ---------- 6. スマホの傾き（beta：前後、gamma：左右） ---------- */
function onTilt(e) {
  if (e.beta === null) return;
  tilt.x = Math.max(-1, Math.min(1, e.gamma / 45));
  tilt.y = Math.max(-1, Math.min(1, (e.beta - 45) / 45));
}

const tiltBtn = document.getElementById("tiltBtn");
if (isTouch && !still && isSecureContext && typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
  // iPhone：ボタンを押して許可をもらってから受け取る
  tiltBtn.hidden = false;
  tiltBtn.addEventListener("click", async () => {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) === "granted") {
        addEventListener("deviceorientation", onTilt);
        tiltBtn.hidden = true;
      } else { tiltBtn.textContent = "傾きは許可されていません"; }
    } catch (err) {
      tiltBtn.textContent = "傾きを使えませんでした";
    }
  });
} else if (isTouch && !still && isSecureContext) {
  // Android など：許可なしで受け取れる
  addEventListener("deviceorientation", onTilt);
}

/* ---------- 7. 始める ---------- */
hintEl.textContent = isTouch ? "なぞると文字の粒が散り、タップで波紋。スマホを傾けると粒が流れます" : "マウスを近づけると文字の粒が散り、クリックで波紋が広がります";

function syncAnimation() {
  if (document.hidden || !visible) { cancelAnimationFrame(animation); animation = 0; }
  else if (!animation) { previousFrame = 0; animation = requestAnimationFrame(frame); }
}

// 大きさが変わったら（ウィンドウの拡大縮小・ブラウザのズーム・スマホの回転）作り直す。
// スマホはスクロールでアドレスバーが出入りして高さが少し変わるので、そのときは作り直さない
let lastW = 0;
let lastH = 0;
let resizeTimer = 0;
function redraw() { resize(); if (still) frame(performance.now()); }
new ResizeObserver(() => {
  if (canvas.clientWidth === lastW && Math.abs(canvas.clientHeight - lastH) < 120) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { lastW = canvas.clientWidth; lastH = canvas.clientHeight; redraw(); }, 120);
}).observe(canvas);
// ブラウザのズームは devicePixelRatio が変わる
addEventListener("resize", () => { if (Math.min(devicePixelRatio || 1, 2) !== dpr) redraw(); });

updatePalette();
lastW = canvas.clientWidth;
lastH = canvas.clientHeight;
resize();
// 書体の読み込みが終わってから、名前の形を取り直す
document.fonts?.ready.then(redraw);

document.addEventListener("visibilitychange", syncAnimation);
new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncAnimation(); }).observe(canvas);
document.addEventListener("themechange", () => { updatePalette(); redraw(); });
syncAnimation();
if (still) frame(performance.now());
