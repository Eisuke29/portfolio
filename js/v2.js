/* =========================================================
   v2 追加スクリプト（近未来の管制室）
   main.js のあとに読み込む。ページにある図だけを動かす
   1. 共通の道具   2. ステータスバー   3. タブ
   4. システム構成図   5. 作品ごとの図   6. トップのつながり図
   ========================================================= */

(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SVG_NS = "http://www.w3.org/2000/svg";

  /* ---------- 1. 共通の道具 ---------- */
  // SVG の要素を作って親に入れる
  function make(tag, attrs = {}, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  // 入れ物の中に、指定した大きさの SVG を作る
  function stage(container, w, h, label) {
    const svg = make("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": label });
    container.appendChild(svg);
    return svg;
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 画面に見えていて、かつタブが開いているときだけ動かす
  function whenActive(el, onStart, onStop) {
    let seen = false;
    const pane = el.closest(".dg-pane");
    const check = () => {
      const open = !pane || !pane.hidden;
      if (seen && open) onStart();
      else onStop();
    };
    new IntersectionObserver((entries) => {
      seen = entries[0].isIntersecting;
      check();
    }).observe(el);
    if (pane) pane.addEventListener("dg:toggle", check);
  }

  // 図が「今さわっている図」かどうか（キー操作を受け取るか）
  function isLive(el) {
    const pane = el.closest(".dg-pane");
    if (pane && pane.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  }

  // ボタンの押された状態をそろえる
  function press(group, btn) {
    group.querySelectorAll("[aria-pressed]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  }

  // 繰り返し描く（requestAnimationFrame）を開始・停止できる形にする
  function loop(step) {
    let id = 0;
    let last = 0;
    const frame = (now) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      step(dt);
      id = requestAnimationFrame(frame);
    };
    return {
      start() { if (!id) { last = 0; id = requestAnimationFrame(frame); } },
      stop() { cancelAnimationFrame(id); id = 0; },
    };
  }

  /* ---------- 2. ステータスバー（v3 で廃止：見た目の軸を1つにするため） ---------- */
  // 図の操作を記録していた欄はなくなったので、呼び出しだけ残して何もしない
  function log() {}

  /* ---------- 3. タブ ---------- */
  document.querySelectorAll("[data-dg]").forEach((dg) => {
    const tabs = [...dg.querySelectorAll('[role="tab"]')];
    const show = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        const pane = document.getElementById(t.getAttribute("aria-controls"));
        pane.hidden = !on;
        pane.dispatchEvent(new Event("dg:toggle"));
      });
      log("view: " + tab.textContent.trim().replace(/\s+/g, " "));
    };
    tabs.forEach((t, i) => {
      t.tabIndex = i === 0 ? 0 : -1;
      t.addEventListener("click", () => show(t));
      t.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        const next = tabs[(i + d + tabs.length) % tabs.length];
        next.focus();
        show(next);
      });
    });
  });

  /* ---------- 4. システム構成図 ---------- */
  // 四角（node）と線（link）のデータから図を描き、線の上に小さな点（データ）を流す
  const FLOWS = {
    chambara: {
      size: [560, 300],
      nodes: [
        { id: "ca", x: 20, y: 20, w: 160, h: 64, k: "INPUT · 担当", t: "剣型コントローラー", s: "Arduino ＋ MPU-6050",
          d: "Arduino と6軸センサ（MPU-6050）で作った、剣のように構えるコントローラー。私が入力とデバイス制御を担当しました。" },
        { id: "pa", x: 20, y: 206, w: 160, h: 64, k: "TERMINAL", t: "PC（Processing）", s: "プレイヤー1",
          d: "Processing で動く対戦画面。serial ライブラリでコントローラーからの入力を受け取り、net ライブラリで通信します。" },
        { id: "sv", x: 200, y: 110, w: 160, h: 76, k: "SERVER", t: "サーバー", s: "勝敗の判定を集約",
          d: "勝敗の判定をサーバーに集約し、結果を両方の端末へ送って画面を同期します。" },
        { id: "pb", x: 380, y: 206, w: 160, h: 64, k: "TERMINAL", t: "PC（Processing）", s: "プレイヤー2",
          d: "もう1人のプレイヤーの画面。同じ仕組みで、コントローラーの入力を受け取ってサーバーとやり取りします。" },
        { id: "cb", x: 380, y: 20, w: 160, h: 64, k: "INPUT", t: "剣型コントローラー", s: "Arduino ＋ MPU-6050",
          d: "2人目のコントローラー。2人それぞれが剣を構えて対戦します。" },
      ],
      links: [
        { a: "ca", b: "pa", label: "シリアル" },
        { a: "pa", b: "sv", label: "ネットワーク", both: true, lx: 104, ly: 186 },
        { a: "pb", b: "sv", label: "ネットワーク", both: true },
        { a: "cb", b: "pb", label: "シリアル" },
      ],
    },
    scrum: {
      size: [560, 310],
      groups: [
        { x: 10, y: 6, w: 540, h: 118, label: "描画モード" },
        { x: 10, y: 172, w: 540, h: 128, label: "再生モード" },
      ],
      nodes: [
        { id: "s1", x: 24, y: 40, w: 156, h: 64, k: "STEP 1", t: "スクラムを選ぶ", s: "左・右・センター",
          d: "3パターンのスクラムから始めます。" },
        { id: "s2", x: 202, y: 40, w: 156, h: 64, k: "STEP 2", t: "走路を描く", s: "各選手の走るコース",
          d: "各選手の走路をマウスで描きます。" },
        { id: "s3", x: 380, y: 40, w: 156, h: 64, k: "STEP 3", t: "パスを描く", s: "順番・出す位置・受ける位置",
          d: "パスの順番と、パスを出す位置・受ける位置をマウスで指定します。" },
        { id: "s4", x: 380, y: 208, w: 156, h: 64, k: "PLAY", t: "3Dで再生", s: "視点を自由に動かす",
          d: "指定が終わると再生モードに切り替わり、3Dで視点を自由に動かしながら動きを確認できます。" },
        { id: "s5", x: 202, y: 208, w: 156, h: 64, k: "REVIEW", t: "見直す", s: "シークバー・マーカー",
          d: "シークバーやパスのタイミングを示すマーカーを使って、好きな時点から見直せます。" },
        { id: "s6", x: 24, y: 208, w: 156, h: 64, k: "AI", t: "守備の反応", s: "マークを切り替え",
          d: "守備側は簡易的なAIとして、攻撃側の動きに合わせてマークする相手を切り替えながら、ラインを保って動きます。" },
      ],
      links: [
        { a: "s1", b: "s2" }, { a: "s2", b: "s3" }, { a: "s3", b: "s4", label: "切り替え" },
        { a: "s4", b: "s5" }, { a: "s6", b: "s5", label: "反応", both: true },
      ],
    },
    chromatic: {
      size: [560, 300],
      nodes: [
        { id: "i1", x: 20, y: 40, w: 150, h: 70, k: "INPUT", t: "右ドラッグ", s: "左上=赤 右上=青 下=黄",
          d: "マウスの右ボタンを押したまま動かす向きで色を選びます。左上が赤、右上が青、下が黄です。" },
        { id: "i2", x: 20, y: 190, w: 150, h: 70, k: "INPUT", t: "数字キー", s: "1・2・3（補助）",
          d: "キーボードの 1・2・3 でも色を切り替えられます。" },
        { id: "bg", x: 205, y: 115, w: 150, h: 70, k: "WORLD", t: "背景色を切り替え", s: "3色から1つ",
          d: "世界の背景色を3色の中から自由に切り替えます。" },
        { id: "hide", x: 390, y: 40, w: 150, h: 70, k: "SAME COLOR", t: "同じ色は消える", s: "背景に同化",
          d: "背景色と同じ色のオブジェクトは背景に同化して消えます。足元の床が消えると落ちてしまいます。" },
        { id: "keep", x: 390, y: 190, w: 150, h: 70, k: "OTHER COLOR", t: "違う色は残る", s: "足場・障害物",
          d: "違う色のオブジェクトや障害物だけが残ります。これを足場にして、三人称視点でゴールを目指します。" },
      ],
      links: [
        { a: "i1", b: "bg" }, { a: "i2", b: "bg" }, { a: "bg", b: "hide" }, { a: "bg", b: "keep" },
      ],
    },
    driftwalk: {
      size: [640, 300],
      nodes: [
        { id: "g", x: 10, y: 14, w: 132, h: 64, k: "INFO", t: "目的地・経路", s: "",
          d: "どこへ向かうか、どの道を通るか。" },
        { id: "w", x: 10, y: 118, w: 132, h: 64, k: "INFO", t: "歩行状態", s: "ユーザーの歩き方",
          d: "ユーザーが今どのように歩いているか。" },
        { id: "o", x: 10, y: 222, w: 132, h: 64, k: "INFO", t: "周囲の障害物", s: "",
          d: "まわりにある障害物。" },
        { id: "p", x: 178, y: 112, w: 132, h: 76, k: "PLAN", t: "誘導の計画", s: "情報から立てる",
          d: "目的地や経路、歩行状態、周囲の障害物などの情報から、誘導の計画を立てます。" },
        { id: "r", x: 346, y: 40, w: 132, h: 76, k: "RDW", t: "前をずらす", s: "HMD内のスクリーン",
          d: "Redirected Walking。HMD内のスクリーンが作る「前」の向きを少しずつずらします。" },
        { id: "v", x: 346, y: 186, w: 132, h: 76, k: "GVS", t: "方向感覚を補助", s: "耳の後ろの電極",
          d: "前庭電気刺激。耳の後ろの電極から微弱な刺激を与えて、方向感覚を補助します。" },
        { id: "out", x: 498, y: 112, w: 132, h: 76, k: "OUTPUT", t: "歩く向き", s: "まっすぐの感覚のまま",
          d: "本人はまっすぐ歩いている感覚のまま、目的地へ誘導されます。" },
      ],
      links: [
        { a: "g", b: "p" }, { a: "w", b: "p" }, { a: "o", b: "p" },
        { a: "p", b: "r" }, { a: "p", b: "v" }, { a: "r", b: "out" }, { a: "v", b: "out" },
      ],
    },
    unspoken: {
      size: [560, 300],
      nodes: [
        { id: "cam", x: 20, y: 30, w: 150, h: 70, k: "INPUT", t: "PCのカメラ", s: "手を映す",
          d: "PCのカメラで、ユーザーの手を映します。" },
        { id: "mp", x: 205, y: 30, w: 150, h: 70, k: "PROCESS", t: "MediaPipe", s: "別プロセスで手を認識",
          d: "MediaPipe が別プロセスで手を認識し、結果を Unity へ送ります。" },
        { id: "un", x: 390, y: 30, w: 150, h: 70, k: "GAME", t: "Unity", s: "合図を見分ける",
          d: "Unity 側で、教えられた対応関係をもとに、どの合図かを見分けます。" },
        { id: "tc", x: 205, y: 200, w: 150, h: 70, k: "TEACH", t: "対応関係を教える", s: "合図 → 行動",
          d: "ユーザーが自分で考えた合図と行動の対応関係を、システムに教えます。" },
        { id: "nul", x: 390, y: 200, w: 150, h: 70, k: "OUTPUT", t: "NUL が動く", s: "ジャンプ・停止・しゃがむ",
          d: "機械キャラクター「NUL」が、伝わった合図に合わせて行動します。" },
      ],
      links: [
        { a: "cam", b: "mp" }, { a: "mp", b: "un", label: "送信" }, { a: "tc", b: "un" }, { a: "un", b: "nul" },
      ],
    },
  };

  function buildFlow(container) {
    const data = FLOWS[container.dataset.flow];
    if (!data) return;
    const [W, H] = data.size;
    const svg = stage(container, W, H, "システム構成図");
    const detail = container.closest(".dg-grid").querySelector('[data-role="detail"]');
    const byId = Object.fromEntries(data.nodes.map((n) => [n.id, n]));
    const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];

    (data.groups || []).forEach((g) => {
      make("rect", { x: g.x, y: g.y, width: g.w, height: g.h, rx: 8, class: "s-faint", "stroke-dasharray": "4 5" }, svg);
      make("text", { x: g.x + 12, y: g.y + 20, class: "mono f-muted", text: g.label }, svg);
    });

    // 線（四角の中心どうしを結ぶ。四角が上に重なるので端から出ているように見える）
    const links = data.links.map((l) => {
      const [x1, y1] = center(byId[l.a]);
      const [x2, y2] = center(byId[l.b]);
      const line = make("line", { x1, y1, x2, y2, class: "flow-link" }, svg);
      if (l.label) {
        make("text", { x: l.lx ?? (x1 + x2) / 2 + 6, y: l.ly ?? (y1 + y2) / 2 - 6, class: "flow-label", text: l.label }, svg);
      }
      return { ...l, line, x1, y1, x2, y2 };
    });

    // データの点
    const packets = links.map((l, i) => ({ l, t: i / links.length, dot: make("circle", { r: 3.5, class: "flow-packet" }, svg) }));

    const nodes = data.nodes.map((n) => {
      const g = make("g", { class: "flow-node", tabindex: 0, role: "button", "aria-label": `${n.t}：${n.d}` }, svg);
      make("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 6 }, g);
      make("text", { x: n.x + 10, y: n.y + 17, class: "k", text: n.k }, g);
      make("text", { x: n.x + 10, y: n.y + (n.s ? 38 : 44), class: "t", text: n.t }, g);
      if (n.s) make("text", { x: n.x + 10, y: n.y + 56, class: "s", text: n.s }, g);
      const pick = () => {
        nodes.forEach((o) => o.g.classList.toggle("is-on", o.n === n));
        links.forEach((l) => l.line.classList.toggle("is-on", l.a === n.id || l.b === n.id));
        if (detail) detail.innerHTML = `<span class="k">${n.k}</span><p><b>${n.t}</b><br>${n.d}</p>`;
        log(`node: ${n.t}`);
      };
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
      return { n, g };
    });

    const place = () => packets.forEach((p) => {
      // 双方向の線は、行って戻る
      let t = p.t;
      if (p.l.both) t = t < 0.5 ? t * 2 : 2 - t * 2;
      p.dot.setAttribute("cx", lerp(p.l.x1, p.l.x2, t));
      p.dot.setAttribute("cy", lerp(p.l.y1, p.l.y2, t));
    });
    place();
    if (reduce) return;
    const anim = loop((dt) => {
      packets.forEach((p) => { p.t = (p.t + dt * (p.l.both ? 0.25 : 0.45)) % 1; });
      place();
    });
    whenActive(container, anim.start, anim.stop);
  }
  document.querySelectorAll("[data-flow]").forEach(buildFlow);

  /* ---------- 5. 作品ごとの図 ---------- */
  const DEMOS = {};

  /* 5-1. チャンバラ：剣の角度と押し出し（自分と相手の構えを選ぶと、結果の矢印が変わる） */
  DEMOS["chambara-angle"] = (box) => {
    const side = box.closest(".dg-grid");
    const svg = stage(box, 400, 240, "自分の剣と相手の剣の角度と、押し出しの強さ");
    // 元の DIR_DEG と同じ。剣先は上半分、中央は縦。両端は左右の水平。
    const ANGLES = [-90, -45, 0, 45, 90];
    const NAMES = ["左水平", "左斜め", "縦", "右斜め", "右水平"];
    const STAGES = ANGLES.length;
    const angleOf = (s) => ANGLES[s];
    make("circle", { cx: 120, cy: 120, r: 92, class: "s-faint" }, svg);
    // 大きい図とボタンに、同じ3本の線（刀身・鍔・柄）を使う。
    const sword = (parent, cls, x, y) => {
      const g = make("g", { class: cls, "stroke-linecap": "round" }, parent);
      make("line", { x1: x, y1: y - 80, x2: x, y2: y + 52, "data-sword-part": "blade", style: "stroke-width:7" }, g);
      make("line", { x1: x - 16, y1: y + 52, x2: x + 16, y2: y + 52, "data-sword-part": "guard", style: "stroke-width:6" }, g);
      make("line", { x1: x, y1: y + 52, x2: x, y2: y + 80, "data-sword-part": "grip", style: "stroke-width:10" }, g);
      return g;
    };
    const cpuSword = sword(svg, "sword-cpu", 120, 120);
    const meSword = sword(svg, "sword-me", 120, 120);
    cpuSword.style.transformOrigin = meSword.style.transformOrigin = "120px 120px";
    make("text", { x: 30, y: 232, class: "mono f-acc", text: "■ 自分" }, svg);
    make("text", { x: 100, y: 232, class: "mono", fill: "var(--hit)", text: "■ 相手" }, svg);
    // 押し出しは相手の方へだけ。PARRY は押し返さず、攻撃した側が300ms動けなくなる。
    const farLabel = make("text", { x: 310, y: 22, "text-anchor": "middle", class: "mono f-muted", text: "奥（相手）" }, svg);
    const nearLabel = make("text", { x: 310, y: 214, "text-anchor": "middle", class: "mono f-muted", text: "手前（自分）" }, svg);
    const arrow = make("polygon", { "data-push-arrow": "" }, svg);
    const blocked = make("g", { "data-parry": "", fill: "none", stroke: "var(--hit)", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
    make("path", { d: "M310 76 L339 88 L335 117 Q331 136 310 147 Q289 136 285 117 L281 88 Z" }, blocked);
    make("path", { d: "M298 99 L322 123 M322 99 L298 123 M267 90 L258 84 M353 90 L362 84 M272 120 L261 124 M348 120 L359 124" }, blocked);
    make("text", { x: 310, y: 178, "text-anchor": "middle", fill: "var(--hit)", stroke: "none", text: "攻撃側が一瞬止まる" }, blocked);
    const label = make("text", { x: 310, y: 238, "text-anchor": "middle", "font-size": 20, "font-weight": 700, text: "" }, svg);
    let me = 2, cpu = 0;
    const RESULT = [
      { code: "HIT", text: "大きく押し出す", color: "var(--ok)", push: 22, len: 160 },
      { code: "GLANCE", text: "少し押す", color: "var(--warn)", push: 12, len: 160 * 12 / 22 },
      { code: "PARRY", text: "防がれる", color: "var(--hit)", push: 0, len: 0 },
    ];
    // 遠いほど細く、近いほど太く描く（遠近法）
    const NEAR = 196, FAR = 36, CX = 310;
    const half = (y) => lerp(7, 24, clamp((y - FAR) / (NEAR - FAR), 0, 1));
    function arrowPoints(r) {
      const tip = NEAR - r.len;
      const tail = NEAR;
      const headBase = tip + r.len * 0.32;
      const hb = half(headBase), hw = hb * 2.1;
      const t = half(tail);
      return [[CX - t, tail], [CX - hb, headBase], [CX - hw, headBase], [CX, tip], [CX + hw, headBase], [CX + hb, headBase], [CX + t, tail]]
        .map((q) => q.join(",")).join(" ");
    }
    // 元の判定：角度の差が 0 → 大きく押し出す、90 → 防がれる、それ以外 → 少し押す
    const diff = () => { const d = Math.abs(angleOf(me) - angleOf(cpu)); return d === 0 ? 0 : d === 90 ? 2 : 1; };
    function draw() {
      // 同じ構えでも2本とも見えるよう、刀身と直角の方向に少しだけ離す。
      const offset = me === cpu ? 4 : 0;
      meSword.style.transform = `rotate(${angleOf(me)}deg) translateX(${offset}px)`;
      cpuSword.style.transform = `rotate(${angleOf(cpu)}deg) translateX(${-offset}px)`;
      const r = RESULT[diff()];
      box.dataset.result = r.code;
      box.dataset.push = String(r.push);
      arrow.setAttribute("points", arrowPoints(r));
      arrow.setAttribute("fill", r.color);
      const parry = r.code === "PARRY";
      arrow.style.display = farLabel.style.display = nearLabel.style.display = parry ? "none" : "";
      blocked.style.display = parry ? "" : "none";
      label.textContent = r.text;
      label.setAttribute("fill", r.color);
    }
    const group = (role, get, set) => {
      const row = side.querySelector(`[data-role="${role}"]`);
      const name = role === "me" ? "自分" : "相手";
      const tag = document.createElement("span");
      tag.className = "dg-hint";
      tag.textContent = name;
      tag.style.alignSelf = "center";
      row.appendChild(tag);
      const btns = [];
      for (let s = 0; s < STAGES; s++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dg-btn";
        b.setAttribute("aria-label", `${name}の構え：${NAMES[s]}`);
        b.dataset.angle = String(angleOf(s));
        const icon = make("svg", { viewBox: "-100 -100 200 200", "aria-hidden": "true", focusable: "false", stroke: "currentColor" }, b);
        const turn = make("g", { transform: `rotate(${angleOf(s)})` }, icon);
        sword(turn, "", 0, 0);
        b.addEventListener("click", () => { set(s); sync(); draw(); log(`${role}.stance = ${s + 1} → ${RESULT[diff()].text}`); });
        row.appendChild(b);
        btns.push(b);
      }
      const sync = () => btns.forEach((b, i) => b.setAttribute("aria-pressed", String(i === get())));
      sync();
    };
    group("me", () => me, (v) => { me = v; });
    group("cpu", () => cpu, (v) => { cpu = v; });
    draw();
  };

  /* 5-2. チャンバラ：行きと帰りで閾値に差をつける */
  DEMOS["chambara-hysteresis"] = (box) => {
    const side = box.closest(".dg-grid");
    const out = (k) => side.querySelector(`[data-out="${k}"]`);
    const W = 400, H = 240, N = 160;
    const svg = stage(box, W, H, "センサーの角度と、判定した構えの変化");
    const top = 20, bottom = 170, B = 95; // B＝段階の境目（図の上の高さ）
    const GAP = 20; // 行きと帰りの差
    make("text", { x: 10, y: 14, class: "mono f-muted", text: "SENSOR ANGLE" }, svg);
    const band = make("rect", { x: 0, y: B - GAP, width: W, height: GAP * 2, class: "f-acc", opacity: 0.12 }, svg);
    make("line", { x1: 0, y1: B, x2: W, y2: B, class: "s-line", "stroke-dasharray": "5 5" }, svg);
    make("text", { x: W - 6, y: B - 4, "text-anchor": "end", class: "mono f-muted", text: "境目" }, svg);
    const upT = make("line", { x1: 0, x2: W, class: "s-acc", "stroke-dasharray": "2 4" }, svg);
    const dnT = make("line", { x1: 0, x2: W, class: "s-acc", "stroke-dasharray": "2 4" }, svg);
    const wave = make("polyline", { class: "s-fg", fill: "none", stroke: "var(--fg)", "stroke-width": 1.6 }, svg);
    make("text", { x: 10, y: 194, class: "mono f-muted", text: "STANCE" }, svg);
    const strip = make("g", {}, svg);
    const cells = [];
    for (let i = 0; i < N; i++) cells.push(make("rect", { x: (i * W) / N, y: 202, width: W / N + 0.5, height: 26 }, strip));

    let hys = true, t = 0, flips = 0, cur = 0;
    const samples = [];
    // 境目のまわりで揺れる値（説明用）
    const noise = (x) => Math.sin(x * 12.9898) * 43758.5453 % 1;
    const sense = (x) => B + Math.sin(x * 0.3) * 22 + Math.sin(x * 2.3) * 8 + noise(x) * 12;
    const judge = (v, prev) => {
      // 上ほど値が小さい（画面の座標）。上に行く＝段階 B 側
      if (!hys) return v < B ? 1 : 0;
      if (prev === 0 && v < B - GAP) return 1;
      if (prev === 1 && v > B + GAP) return 0;
      return prev;
    };
    function fill() {
      samples.length = 0;
      cur = 0;
      for (let i = 0; i < N; i++) push(true);
    }
    function push(silent) {
      t += 0.12;
      const v = clamp(sense(t), top, bottom);
      const next = judge(v, cur);
      if (next !== cur && !silent) flips++;
      cur = next;
      samples.push({ v, s: cur });
      if (samples.length > N) samples.shift();
    }
    function draw() {
      wave.setAttribute("points", samples.map((p, i) => `${((i * W) / (N - 1)).toFixed(1)},${p.v.toFixed(1)}`).join(" "));
      samples.forEach((p, i) => cells[i].setAttribute("fill", p.s ? "var(--accent)" : "var(--line-strong)"));
      band.setAttribute("opacity", hys ? 0.12 : 0);
      [upT, dnT].forEach((l, i) => {
        const y = B + (i ? GAP : -GAP);
        l.setAttribute("y1", y);
        l.setAttribute("y2", y);
        l.setAttribute("opacity", hys ? 1 : 0);
      });
      out("stage").textContent = cur ? "構え B" : "構え A";
      out("flips").textContent = String(flips);
      out("flips").className = hys ? "is-ok" : flips > 3 ? "is-hit" : "";
    }
    const btn = side.querySelector('[data-role="hys"]');
    btn.addEventListener("click", () => {
      hys = !hys;
      btn.setAttribute("aria-pressed", String(hys));
      btn.textContent = `行きと帰りで差をつける：${hys ? "ON" : "OFF"}`;
      flips = 0;
      fill();
      draw();
      log(`threshold.hysteresis = ${hys ? "ON" : "OFF"}`);
    });
    fill();
    draw();
    if (reduce) return;
    let acc = 0;
    const anim = loop((dt) => {
      acc += dt;
      while (acc > 0.05) { push(false); acc -= 0.05; }
      draw();
    });
    whenActive(box, anim.start, anim.stop);
  };

  /* 5-3. ScrumCanvas：守備の反応（攻撃の並びが変わると、マークが入れ替わる） */
  DEMOS["scrum-defense"] = (box) => {
    const side = box.closest(".dg-grid");
    const out = (k) => side.querySelector(`[data-out="${k}"]`);
    const W = 400, H = 240;
    const svg = stage(box, W, H, "攻撃の選手を動かすと、守備がマークする相手を切り替える図");
    make("rect", { x: 10, y: 10, width: W - 20, height: H - 20, class: "s-line" }, svg);
    make("text", { x: 20, y: 30, class: "mono f-muted", text: "ATTACK ↑" }, svg);
    make("line", { x1: 10, y1: 90, x2: W - 10, y2: 90, class: "s-faint", "stroke-dasharray": "6 6" }, svg);
    make("text", { x: W - 18, y: 84, "text-anchor": "end", class: "mono f-muted", text: "DEFENSE LINE" }, svg);
    const links = make("g", {}, svg);
    const atk = [{ n: "10", x: 90 }, { n: "12", x: 170 }, { n: "13", x: 250 }, { n: "11", x: 330 }];
    const def = atk.map((a) => ({ x: a.x, target: a }));
    def.forEach((d) => { d.el = make("circle", { r: 11, class: "f-hit" }, svg); });
    atk.forEach((a) => {
      a.el = make("g", { tabindex: 0, role: "slider", "aria-label": `${a.n}番の位置（左右キーでも動く）`, style: "cursor:grab" }, svg);
      make("circle", { r: 15, class: "f-acc" }, a.el);
      make("text", { y: 5, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: "var(--bg)", text: a.n }, a.el);
    });
    let swaps = 0, order = atk.map((a) => a.n).join();
    function assign() {
      // 守備は左から順に、攻撃の左から順の選手をマークする
      const sorted = atk.slice().sort((p, q) => p.x - q.x);
      const now = sorted.map((a) => a.n).join();
      if (now !== order) { swaps++; order = now; log(`mark switch: ${now.replace(/,/g, " ")}`); }
      def.forEach((d, i) => { d.target = sorted[i]; });
      out("swaps").textContent = `${swaps} 回`;
    }
    function draw() {
      atk.forEach((a) => a.el.setAttribute("transform", `translate(${a.x} 180)`));
      links.innerHTML = "";
      def.forEach((d) => {
        d.el.setAttribute("cx", d.x);
        d.el.setAttribute("cy", 90);
        make("line", { x1: d.x, y1: 101, x2: d.target.x, y2: 165, stroke: "var(--hit)", "stroke-dasharray": "3 4", opacity: 0.6 }, links);
      });
    }
    assign();
    // ドラッグで攻撃の選手を左右に動かす
    let drag = null;
    const toX = (e) => { const r = svg.getBoundingClientRect(); return clamp(((e.clientX - r.left) / r.width) * W, 30, W - 30); };
    atk.forEach((a) => {
      a.el.addEventListener("pointerdown", (e) => { drag = a; a.el.setPointerCapture(e.pointerId); });
      a.el.addEventListener("pointermove", (e) => { if (drag === a) { a.x = toX(e); assign(); } });
      a.el.addEventListener("pointerup", () => { drag = null; });
      a.el.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0;
        if (d) { e.preventDefault(); a.x = clamp(a.x + d, 30, W - 30); assign(); }
      });
    });
    svg.style.touchAction = "none";
    draw();
    if (reduce) {
      setInterval(() => { def.forEach((d) => { d.x = d.target.x; }); draw(); }, 200);
      return;
    }
    // 守備はマークした相手の前へ、少し遅れて動く
    const anim = loop((dt) => {
      def.forEach((d) => { d.x += (d.target.x - d.x) * Math.min(1, dt * 4); });
      draw();
    });
    whenActive(box, anim.start, anim.stop);
  };

  /* 5-4. CHROMATIC SHIFT：同じ色は消える（背景を選ぶと、同じ色のものが消える） */
  DEMOS["chromatic-rule"] = (box) => {
    const side = box.closest(".dg-grid");
    const COL = { red: "#e5484d", blue: "#3b82f6", yellow: "#f5c518" };
    const svg = stage(box, 400, 230, "背景色と同じ色のものが消える図");
    const bgRect = make("rect", { x: 0, y: 0, width: 400, height: 230 }, svg);
    const OBJ = [
      { x: 20, y: 170, w: 100, h: 18, c: "red" }, { x: 140, y: 140, w: 90, h: 18, c: "blue" },
      { x: 250, y: 110, w: 100, h: 18, c: "yellow" }, { x: 60, y: 110, w: 34, h: 34, c: "blue" },
      { x: 180, y: 60, w: 34, h: 80, c: "red" }, { x: 300, y: 40, w: 34, h: 34, c: "red" },
      { x: 320, y: 160, w: 60, h: 18, c: "blue" },
    ].map((o) => ({ ...o, el: make("rect", { x: o.x, y: o.y, width: o.w, height: o.h, rx: 2 }, svg) }));
    let bg = "yellow";
    function paint() {
      bgRect.setAttribute("fill", COL[bg]);
      OBJ.forEach((o) => {
        const gone = o.c === bg;
        o.el.setAttribute("fill", gone ? "none" : COL[o.c]);
        o.el.setAttribute("stroke", gone ? "rgba(0,0,0,.35)" : "#111");
        o.el.setAttribute("stroke-width", gone ? 1.2 : 2);
        o.el.setAttribute("stroke-dasharray", gone ? "4 4" : "");
      });
    }
    side.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => {
      bg = b.dataset.color;
      press(b.parentElement, b);
      paint();
      log(`background = ${bg}`);
    }));
    paint();
  };

  /* 5-4b. CHROMATIC SHIFT：人が走り抜けると、背景と同じ色のブロックだけ通り抜けられる */
  DEMOS["chromatic-run"] = (box) => {
    const side = box.closest(".dg-grid");
    const out = (k) => side.querySelector(`[data-out="${k}"]`);
    const COL = { red: "#e5484d", blue: "#3b82f6", yellow: "#f5c518" };
    const NAME = { red: "赤", blue: "青", yellow: "黄" };
    const W = 400, H = 230, GROUND = 180;
    const svg = stage(box, W, H, "人が走って、背景と同じ色のブロックを通り抜ける図");
    const bgRect = make("rect", { x: 0, y: 0, width: W, height: H }, svg);
    make("rect", { x: 0, y: GROUND, width: W, height: H - GROUND, fill: "#2a2f3a" }, svg);
    const WALLS = [{ x: 110, c: "red" }, { x: 200, c: "blue" }, { x: 290, c: "yellow" }].map((w) => ({
      ...w, el: make("rect", { x: w.x, y: GROUND - 90, width: 22, height: 90, rx: 2 }, svg),
    }));
    make("line", { x1: 372, y1: GROUND, x2: 372, y2: GROUND - 56, stroke: "#111", "stroke-width": 3 }, svg);
    make("path", { d: `M372 ${GROUND - 56} l24 8 -24 8 z`, fill: "#fff", stroke: "#111", "stroke-width": 1.5 }, svg);
    const runner = make("g", {}, svg);
    make("circle", { cx: 0, cy: -40, r: 8, fill: "#fff", stroke: "#111", "stroke-width": 2 }, runner);
    make("path", { d: "M0 -32 L0 -14 M0 -14 L-7 0 M0 -14 L7 0 M0 -26 L-8 -18 M0 -26 L8 -20", stroke: "#111", "stroke-width": 3, "stroke-linecap": "round", fill: "none" }, runner);
    const flash = make("text", { x: W / 2, y: 36, "text-anchor": "middle", "font-size": 18, "font-weight": 700, fill: "#111", text: "" }, svg);
    let bg = "red", x = 24, running = false;
    function paint() {
      bgRect.setAttribute("fill", COL[bg]);
      WALLS.forEach((w) => {
        const gone = w.c === bg;
        w.el.setAttribute("fill", gone ? "none" : COL[w.c]);
        w.el.setAttribute("stroke", gone ? "rgba(0,0,0,.4)" : "#111");
        w.el.setAttribute("stroke-width", gone ? 1.4 : 2);
        w.el.setAttribute("stroke-dasharray", gone ? "4 4" : "");
      });
      out("bg").textContent = NAME[bg];
    }
    function place() { runner.setAttribute("transform", `translate(${x} ${GROUND})`); }
    function stop(text, cls) {
      running = false;
      flash.textContent = text;
      out("state").textContent = text;
      out("state").className = cls;
      log(`run: ${text}`);
    }
    function step(dt) {
      if (!running) return;
      const nx = x + 70 * dt;
      // 見えている（背景と違う色の）ブロックにはぶつかって止まる
      const hit = WALLS.find((w) => w.c !== bg && x + 9 <= w.x && nx + 9 > w.x);
      if (hit) { x = hit.x - 9; place(); stop(`${NAME[hit.c]}のブロックにぶつかった`, "is-hit"); return; }
      const pass = WALLS.find((w) => w.c === bg && x < w.x + 11 && nx >= w.x + 11);
      if (pass) { flash.textContent = `${NAME[pass.c]}のブロックをすり抜けた`; log(`pass through ${pass.c}`); }
      x = nx;
      if (x >= 368) { x = 368; stop("ゴール", "is-ok"); }
      place();
    }
    side.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => {
      bg = b.dataset.color;
      press(b.parentElement, b);
      paint();
    }));
    side.querySelector('[data-role="run"]').addEventListener("click", () => {
      x = 24; running = true; flash.textContent = "";
      out("state").textContent = "走っている";
      out("state").className = "";
      place();
      if (reduce) { while (running) step(0.05); }
    });
    paint();
    place();
    const anim = loop(step);
    whenActive(box, anim.start, anim.stop);
  };

  /* 5-5. DriftWalk Theater：横から人が来ても、まっすぐの感覚のまま、よけて目的地へ */
  DEMOS.driftwalk = (box) => {
    const side = box.closest(".dg-grid");
    const out = (k) => side.querySelector(`[data-out="${k}"]`);
    const W = 400, H = 270;
    const svg = stage(box, 540, H, "上から見た歩く道と、HMD の中の画面。横から人が歩いてくる");
    const S = [170, 250], GOAL = [320, 50];
    // 横から歩いてくる人（説明用の動き）：右から左へ
    const PED = { x0: 320, v: 60, y: 130 };
    make("line", { x1: S[0], y1: S[1], x2: S[0], y2: 20, class: "s-line", "stroke-dasharray": "5 6" }, svg);
    make("text", { x: S[0] - 6, y: 34, "text-anchor": "end", class: "mono f-muted", text: "本人の感覚：まっすぐ" }, svg);
    make("line", { x1: W, y1: PED.y, x2: 0, y2: PED.y, stroke: "var(--hit)", "stroke-dasharray": "2 5", opacity: 0.5 }, svg);
    make("circle", { cx: GOAL[0], cy: GOAL[1], r: 16, class: "s-acc", "stroke-width": 2 }, svg);
    make("circle", { cx: GOAL[0], cy: GOAL[1], r: 5, class: "f-acc" }, svg);
    make("text", { x: GOAL[0], y: GOAL[1] - 24, "text-anchor": "middle", class: "mono f-acc", text: "GOAL" }, svg);
    const trail = make("polyline", { fill: "none", stroke: "var(--fg)", "stroke-width": 2.2 }, svg);
    const ped = make("g", {}, svg);
    make("circle", { r: 8, class: "f-hit" }, ped);
    make("path", { d: "M-16 0 l7 -5 v10 z", class: "f-hit" }, ped);
    const walker = make("g", {}, svg);
    make("circle", { r: 8, class: "f-fg" }, walker);
    make("path", { d: "M0 -16 l5 7 h-10 z", class: "f-acc" }, walker);
    const pulse = make("circle", { r: 12, fill: "none", stroke: "var(--ok)", "stroke-width": 2, opacity: 0 }, walker);
    const bump = make("circle", { r: 22, fill: "none", stroke: "var(--hit)", "stroke-width": 3, opacity: 0 }, svg);

    // 右：HMD の中を上から見た図。画面（青い弧）が先に回り、頭（体の向き）があとからついていく
    const HX = 470, HY = 150;
    const hmd = make("g", {}, svg);
    make("rect", { x: 412, y: 20, width: 116, height: 230, rx: 8, class: "f-bg2 s-line" }, hmd);
    make("text", { x: HX, y: 40, "text-anchor": "middle", class: "mono f-muted", text: "HMD（上から）" }, hmd);
    make("line", { x1: HX, y1: HY, x2: HX, y2: HY - 70, class: "s-faint", "stroke-dasharray": "3 4" }, hmd);
    make("text", { x: HX, y: 222, "text-anchor": "middle", class: "f-muted", "font-size": 10, text: "点線＝最初の向き" }, hmd);
    make("text", { x: HX, y: 62, "text-anchor": "middle", class: "f-acc", "font-size": 10, text: "青＝画面の「前」" }, hmd);
    const scr = make("g", {}, hmd);
    make("path", { d: `M${HX - 26} ${HY - 40} Q${HX} ${HY - 54} ${HX + 26} ${HY - 40}`, stroke: "var(--accent)", "stroke-width": 6, "stroke-linecap": "round", fill: "none" }, scr);
    const head = make("g", {}, hmd);
    make("circle", { cx: HX, cy: HY, r: 16, class: "f-fg" }, head);
    make("path", { d: `M${HX} ${HY - 26} l6 9 h-12 z`, class: "f-fg" }, head);
    make("text", { x: HX, y: HY + 34, "text-anchor": "middle", class: "f-muted", "font-size": 11, text: "体の向き" }, hmd);
    let lead = 0;

    let mode = "guide", t = 0, playing = false, pts = [], p = S.slice(), heading = 0, minD = Infinity;
    const pedAt = (time) => [PED.x0 - PED.v * time, PED.y];
    function reset() {
      t = 0; p = S.slice(); heading = 0; lead = 0; pts = [S.slice()]; minD = Infinity;
      bump.setAttribute("opacity", 0);
      out("result").textContent = "—";
      out("result").className = "";
      draw();
    }
    function draw() {
      trail.setAttribute("points", pts.map((q) => q.join(",")).join(" "));
      walker.setAttribute("transform", `translate(${p[0]} ${p[1]}) rotate(${heading})`);
      const [px, py] = pedAt(t);
      ped.setAttribute("transform", `translate(${px} ${py})`);
      // 画面は体より少し先に回る（それを追って体が向きを変える）
      scr.setAttribute("transform", `rotate(${heading + lead} ${HX} ${HY})`);
      head.setAttribute("transform", `rotate(${heading} ${HX} ${HY})`);
      out("shift").textContent = `${Math.round(heading)}°`;
    }
    function finish(text, cls) {
      playing = false;
      pulse.setAttribute("opacity", 0);
      out("result").textContent = text;
      out("result").className = cls;
      playBtn.textContent = "▶ もう一度";
      log(`walk: ${text}`);
    }
    function step(dt) {
      if (!playing) return;
      t += dt;
      if (mode === "guide") {
        // 目的地への向きに、近づいてくる人から離れる向きを足して、少しずつ曲がる
        let gx = GOAL[0] - p[0], gy = GOAL[1] - p[1];
        const gl = Math.hypot(gx, gy); gx /= gl; gy /= gl;
        const fut = pedAt(t + 0.5);
        const rx = p[0] - fut[0], ry = p[1] - fut[1], rd = Math.hypot(rx, ry);
        const k = rd < 90 ? (3 * (90 - rd)) / 90 : 0;
        const want = (Math.atan2(gx + (k * rx) / rd, -(gy + (k * ry) / rd)) * 180) / Math.PI;
        const turn = clamp(want - heading, -40 * dt, 40 * dt);
        heading += turn;
        lead += ((dt > 0 ? (turn / dt) * 0.35 : 0) - lead) * 0.2;
        pulse.setAttribute("opacity", (Math.sin(t * 10) + 1) * 0.3);
      }
      const r = (heading * Math.PI) / 180;
      p = [p[0] + Math.sin(r) * 48 * dt, p[1] - Math.cos(r) * 48 * dt];
      pts.push(p.slice());
      const [px, py] = pedAt(t);
      const d = Math.hypot(p[0] - px, p[1] - py);
      minD = Math.min(minD, d);
      if (d < 16) {
        bump.setAttribute("cx", (p[0] + px) / 2);
        bump.setAttribute("cy", (p[1] + py) / 2);
        bump.setAttribute("opacity", 1);
        draw();
        finish("人とぶつかる", "is-hit");
        return;
      }
      if (Math.hypot(p[0] - GOAL[0], p[1] - GOAL[1]) < 14) { draw(); finish("人をよけて到着", "is-ok"); return; }
      if (p[1] < 18) { draw(); finish("目的地を通り過ぎた", "is-hit"); return; }
      draw();
    }
    const playBtn = side.querySelector('[data-role="play"]');
    playBtn.addEventListener("click", () => {
      reset();
      playing = true;
      playBtn.textContent = "歩いています…";
      if (reduce) { while (playing) step(0.05); }
    });
    side.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.mode;
      press(b.parentElement, b);
      playing = false;
      playBtn.textContent = "▶ 歩く";
      reset();
    }));
    reset();
    const anim = loop(step);
    whenActive(box, anim.start, anim.stop);
  };

  /* 5-7. UNSPOKEN：覚えるのは誰か */
  DEMOS["unspoken-idea"] = (box) => {
    const side = box.closest(".dg-grid");
    const svg = stage(box, 400, 220, "ジェスチャの対応関係を、誰が決めて誰が覚えるかの図");
    const node = (x, label, sub) => {
      make("rect", { x, y: 70, width: 110, height: 70, rx: 10, class: "f-bg s-line", "stroke-width": 1.4 }, svg);
      make("text", { x: x + 55, y: 101, "text-anchor": "middle", class: "f-fg", "font-weight": 700, text: label }, svg);
      return make("text", { x: x + 55, y: 122, "text-anchor": "middle", class: "f-muted", "font-size": 11, text: sub }, svg);
    };
    const subU = node(14, "ユーザー", "");
    const subS = node(276, "システム", "");
    make("text", { x: 200, y: 58, "text-anchor": "middle", class: "mono f-muted", text: "GESTURE → MEANING" }, svg);
    make("rect", { x: 150, y: 86, width: 100, height: 38, rx: 19, class: "f-bg2 s-acc" }, svg);
    make("text", { x: 200, y: 110, "text-anchor": "middle", "font-size": 15, text: "✋ → 停止" }, svg);
    const arrow1 = make("path", { class: "s-acc", "stroke-width": 2.5, "marker-end": "url(#uarr)" }, svg);
    const arrow2 = make("path", { class: "s-acc", "stroke-width": 2.5, "marker-end": "url(#uarr)" }, svg);
    const defs = make("defs", {}, svg);
    const m = make("marker", { id: "uarr", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    make("path", { d: "M0 0 L10 5 L0 10 z", class: "f-acc" }, m);
    const l1 = make("text", { x: 200, y: 172, "text-anchor": "middle", class: "f-fg", "font-size": 12, text: "" }, svg);
    const l2 = make("text", { x: 200, y: 192, "text-anchor": "middle", class: "f-muted", "font-size": 12, text: "" }, svg);
    function set(idea) {
      if (idea === "old") {
        arrow1.setAttribute("d", "M276 105 L254 105");
        arrow2.setAttribute("d", "M150 105 L128 105");
        subU.textContent = "覚える";
        subS.textContent = "決める";
        l1.textContent = "システムが動作を決め、ユーザーが覚える";
        l2.textContent = "（従来のジェスチャ操作）";
      } else {
        arrow1.setAttribute("d", "M124 105 L146 105");
        arrow2.setAttribute("d", "M250 105 L272 105");
        subU.textContent = "決める";
        subS.textContent = "学習する";
        l1.textContent = "ユーザーが身体表現を決め、システムが学習する";
        l2.textContent = "（UNSPOKEN）";
      }
    }
    side.querySelectorAll("[data-idea]").forEach((b) => b.addEventListener("click", () => {
      press(b.parentElement, b);
      set(b.dataset.idea);
      log(`idea = ${b.dataset.idea === "old" ? "conventional" : "UNSPOKEN"}`);
    }));
    set("new");
  };

  document.querySelectorAll("[data-demo]").forEach((box) => {
    const fn = DEMOS[box.dataset.demo];
    if (fn) fn(box);
  });

  /* ScrumCanvas：お手本の再生に合わせて「ループ」の場面を光らせる（同じサイトのページなので中の状態を読める） */
  const signFlow = document.querySelector("[data-sign-flow]");
  if (signFlow) {
    const items = [...signFlow.querySelectorAll("li")];
    let last = -2;
    // ふだんは収納しておき、お手本のときだけ出す。
    // ページのボタンでも、ゲームの中の「お手本を見る」でも出るように、ゲームの状態を直接見る：
    //   お手本を動かしている最中、またはお手本のパス順（9→10→12→10→11→15→14）が残っている間 → 表示
    //   全リセットなどで別のプレーになったら → 収納
    signFlow.hidden = true;
    setInterval(() => {
      const frame = document.querySelector(".play-frame iframe");
      let i = -1, demo = false;
      try {
        const w = frame && frame.contentWindow;
        if (w && w.eval("typeof demoRunning") !== "undefined") {
          // 全リセットはパス順を残すので、パスの位置（6本）が残っているかも見る
          demo = w.eval("demoRunning") || (w.eval("passQueue.join()") === "9,0,2,0,1,5,4" && w.eval("passMarkers.length") === 6);
          if (demo && w.eval("tPlay > 0")) i = w.eval("loopPhase()");
        }
      } catch (e) { /* 読み込み中 */ }
      if (signFlow.hidden === demo) {
        signFlow.hidden = !demo;
        signFlow.classList.add("is-in");
      }
      if (i === last) return;
      last = i;
      items.forEach((li, k) => {
        li.classList.toggle("is-now", k === i);
        li.classList.toggle("is-done", i >= 0 && k < i);
      });
      if (i >= 0) log(`sign: ${items[i].querySelector("b").textContent}`);
    }, 300);
  }

  /* ScrumCanvas：発表のお手本（起動して、自動で描いて再生する） */
  document.querySelectorAll("[data-scrum-demo]").forEach((btn) => btn.addEventListener("click", () => {
    const frameBox = document.querySelector(".play-frame");
    const launchBtn = frameBox.querySelector("[data-play-src]");
    if (launchBtn) {
      launchBtn.dataset.playSrc += (launchBtn.dataset.playSrc.includes("?") ? "&" : "?") + "demo=1";
      launchBtn.click();
    } else {
      try { frameBox.querySelector("iframe").contentWindow.runDemo(); } catch (e) { /* 読み込み中 */ }
    }
    frameBox.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    log("demo: presentation loop");
  }));

})();
