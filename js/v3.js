/* =========================================================
   v3 追加スクリプト（v2-motion.js のあとに読み込む）
   1. メールアドレス：迷惑メール対策で HTML には分けて書き、ここで組み立てる
   2. History：スクロールに合わせて線が伸び、通り過ぎた点が光る／乗せると作品の絵が浮かぶ
   3. 外部のプロトタイプ（Figma）：押したときに初めて読み込む（ページを重くしない）
   ========================================================= */

(() => {
  /* ---------- 1. メールアドレス ---------- */
  document.querySelectorAll("[data-mail]").forEach((box) => {
    const addr = `${box.dataset.user}@${box.dataset.domain}`;
    const link = box.querySelector("[data-mail-link]");
    const copy = box.querySelector("[data-mail-copy]");
    link.href = `mailto:${addr}`;
    link.textContent = addr;
    if (!copy || !navigator.clipboard) return;
    copy.hidden = false;
    let timer = 0;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(addr);
        copy.textContent = "コピーしました";
      } catch (e) {
        copy.textContent = "コピーできませんでした";
      }
      clearTimeout(timer);
      timer = setTimeout(() => (copy.textContent = "アドレスをコピー"), 2200);
    });
  });

  /* ---------- 2. History ---------- */
  const history = document.querySelector("[data-history]");
  if (history) {
    const bar = document.createElement("span");
    bar.className = "history-progress";
    bar.setAttribute("aria-hidden", "true");
    history.prepend(bar);
    const items = [...history.querySelectorAll(".history-item")];
    const update = () => {
      const r = history.getBoundingClientRect();
      const line = innerHeight * 0.6; // 画面の上から6割の所まで来たら「通り過ぎた」
      const p = Math.min(1, Math.max(0, (line - r.top) / r.height));
      history.style.setProperty("--hp", p.toFixed(4));
      items.forEach((li) => li.classList.toggle("is-lit", li.getBoundingClientRect().top < line));
    };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();

    // マウスのときだけ：作品の行に乗せると、その作品の絵がカーソルの上に浮かぶ
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const peek = document.createElement("div");
      peek.className = "history-peek";
      peek.setAttribute("aria-hidden", "true");
      document.body.appendChild(peek);
      history.querySelectorAll("[data-peek]").forEach((row) => {
        row.addEventListener("pointerenter", () => {
          peek.style.backgroundImage = `url("${row.dataset.peek}")`;
          peek.classList.add("is-on");
        });
        row.addEventListener("pointerleave", () => peek.classList.remove("is-on"));
        row.addEventListener("pointermove", (e) => {
          peek.style.left = e.clientX + "px";
          peek.style.top = e.clientY + "px";
        });
      });
    }
  }

  /* ---------- 3. 外部のプロトタイプ ---------- */
  document.querySelectorAll("[data-embed-src]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const box = document.querySelector(btn.dataset.embedTarget);
      if (!box || box.classList.contains("is-live")) return;
      const frame = document.createElement("iframe");
      frame.src = btn.dataset.embedSrc;
      frame.title = btn.dataset.embedTitle || "";
      frame.allowFullscreen = true;
      box.replaceChildren(frame);
      box.classList.add("is-live");
      btn.querySelector("b").textContent = "読み込み中…";
      btn.querySelector("small").textContent = "表示されたら、右の画面を操作できます";
      frame.addEventListener("load", () => { btn.querySelector("b").textContent = "右の画面を触ってください"; }, { once: true });
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
})();
