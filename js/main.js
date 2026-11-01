/* =========================================================
   ポートフォリオ 共通スクリプト
   どのページでも読み込む。ページにある要素だけを動かす
   （例：絞り込みは works.html にしかないので、他のページでは何もしない）
   ========================================================= */

// マウスで操作しているか（スマホ・タブレットでは false）
const isMouse = matchMedia("(hover: hover) and (pointer: fine)").matches;
// 「動きを減らす」設定になっているか
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
document.documentElement.classList.add("js-ready");

/* ---------- 1. ライト/ダーク切り替え ---------- */
// 選んだテーマはブラウザに覚えておく（覚えられない環境でも動くように try で囲む）
function loadTheme() {
  try {
    return localStorage.getItem("theme");
  } catch (e) {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch (e) {
    // 保存できなくても切り替え自体はできる
  }
}

document.documentElement.dataset.theme = loadTheme() === "light" ? "light" : "dark";

const themeBtn = document.getElementById("themeToggle");
if (themeBtn) {
  const labelTheme = () => {
    const light = document.documentElement.dataset.theme === "light";
    themeBtn.setAttribute("aria-label", light ? "ダークテーマに切り替える" : "ライトテーマに切り替える");
    themeBtn.setAttribute("aria-pressed", String(light));
  };
  labelTheme();
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    saveTheme(next);
    labelTheme();
    document.dispatchEvent(new Event("themechange"));
  });
}

/* ---------- 2. 幕（読み込み時に開き、別ページへ移るときに閉じる） ---------- */
const curtain = document.createElement("div");
curtain.className = "curtain";
curtain.innerHTML = "<span>Eisuke Kinoshita</span>";
document.body.prepend(curtain);

// 本文は画像・動画・外部フォントの完了を待たずに表示する。
requestAnimationFrame(() => {
  curtain.classList.add("is-open");
  // 幕が開いたら、見出しの文字を出し始める
  document.body.classList.add("is-loaded");
  document.querySelectorAll("[data-hero]").forEach((el) => el.classList.add("is-in"));
});

// 「戻る」でページに戻ってきたとき、幕が閉じたままにならないようにする
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    curtain.classList.remove("is-closing");
    curtain.classList.add("is-open");
  }
});

document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link || e.defaultPrevented || e.button !== 0 || link.hasAttribute("download") || (link.target && link.target !== "_self") || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || reduceMotion) return;
  const url = new URL(link.href, location.href);
  // 同じサイトの別ページへ移るときだけ幕を閉じる（ページ内の移動 #about などは除く）
  if (!/^(https?:|file:)$/.test(url.protocol) || url.origin !== location.origin || url.pathname === location.pathname) return;
  e.preventDefault();
  curtain.classList.remove("is-open");
  curtain.classList.add("is-closing");
  setTimeout(() => (location.href = link.href), 450);
});

/* ---------- 3. スマホのメニュー ---------- */
const menuBtn = document.getElementById("menuBtn");
const siteNav = document.getElementById("siteNav");
if (menuBtn && siteNav) {
  const mobileNav = matchMedia("(max-width: 720px)");
  const setMenu = (open) => {
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    siteNav.classList.toggle("is-open", open);
    siteNav.inert = mobileNav.matches && !open;
    document.body.classList.toggle("menu-open", open && mobileNav.matches);
    if (open) siteNav.querySelector("a").focus();
  };
  setMenu(false);
  mobileNav.addEventListener("change", () => setMenu(false));
  menuBtn.addEventListener("click", () => {
    const open = menuBtn.getAttribute("aria-expanded") !== "true";
    setMenu(open);
  });
  // メニューの中のリンクを押したら閉じる
  siteNav.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      setMenu(false);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!mobileNav.matches || menuBtn.getAttribute("aria-expanded") !== "true") return;
    if (e.key === "Escape") { setMenu(false); menuBtn.focus(); }
    if (e.key === "Tab") {
      const controls = [...siteNav.querySelectorAll("a"), themeBtn, menuBtn].filter(Boolean);
      const index = controls.indexOf(document.activeElement);
      e.preventDefault();
      controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
  });
}

/* ---------- 4. スクロールに合わせて動くもの ---------- */
// ・上のバー：どこまで読んだか
// ・ヘッダー：下へスクロールすると隠れ、上へ戻すと出る
// ・右下のボタン：少し下へ行ったら出る（輪の長さ＝読んだ量）
const progress = document.createElement("div");
progress.className = "progress";
document.body.prepend(progress);

const header = document.querySelector(".site-header");
const toTop = document.getElementById("toTop");
let lastY = scrollY;

function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 0 ? scrollY / max : 0;
  progress.style.transform = `scaleX(${p})`;

  if (header && !(siteNav && siteNav.classList.contains("is-open"))) {
    const hide = scrollY > lastY && scrollY > 200 && !header.contains(document.activeElement);
    header.classList.toggle("is-hidden", hide);
    document.body.classList.toggle("header-hidden", hide);
  }
  lastY = scrollY;

  if (toTop) {
    toTop.classList.toggle("is-shown", scrollY > innerHeight * 0.6);
    toTop.style.setProperty("--p", p.toFixed(3));
  }
}

let scrollQueued = false;
addEventListener("scroll", () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { onScroll(); scrollQueued = false; });
}, { passive: true });
header?.addEventListener("focusin", () => {
  header.classList.remove("is-hidden");
  document.body.classList.remove("header-hidden");
});
onScroll();

if (toTop) {
  toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: reduceMotion ? "instant" : "smooth" }));
}

/* ---------- 5. 見出しを1文字ずつ出す ---------- */
// data-split がついた要素の文字を <span class="char"> に分ける
// 文字ごとに --i（何文字目か）を入れて、CSS で少しずつ遅らせて出す
document.querySelectorAll("[data-split]").forEach((el) => {
  // 文字を分割しても、読み上げは元の見出しのまとまりを保つ。
  el.setAttribute("aria-label", el.textContent.trim());
  let i = 0;
  const wrapText = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // 単語（空白で区切ったまとまり）ごとに split-line で包み、単語の途中で改行しないようにする
      const frag = document.createDocumentFragment();
      for (const word of node.textContent.split(/(\s+)/)) {
        if (!word) continue;
        if (/^\s+$/.test(word)) {
          frag.appendChild(document.createTextNode(" "));
          continue;
        }
        const line = document.createElement("span");
        line.className = "split-line";
        for (const ch of word) {
          const span = document.createElement("span");
          span.className = "char";
          span.textContent = ch;
          span.style.setProperty("--i", i++);
          line.appendChild(span);
        }
        frag.appendChild(line);
      }
      node.replaceWith(frag);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("nw")) {
      // 改行しないまとまり（.nw）は、空白も含めて1つの行のかたまりにする
      const line = document.createElement("span");
      line.className = "split-line";
      for (const ch of node.textContent) {
        const span = document.createElement("span");
        span.className = "char";
        span.textContent = ch === " " ? " " : ch;
        span.style.setProperty("--i", i++);
        line.appendChild(span);
      }
      node.textContent = "";
      node.appendChild(line);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== "BR" && node.tagName !== "SMALL") {
      [...node.childNodes].forEach(wrapText);
    }
  };
  [...el.childNodes].forEach(wrapText);
  el.classList.add("split");
  el.querySelectorAll(".split-line").forEach((line) => line.setAttribute("aria-hidden", "true"));
});

/* ---------- 6. スクロールして画面に入ったら出す ---------- */
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.01, rootMargin: "0px 0px 20px 0px" }
);

function watchReveal() {
  document.querySelectorAll(".reveal:not(.is-in), .split:not(.is-in)").forEach((el) => {
    // 最初の画面にある見出しは、幕が開くのを待ってから出す
    if (el.dataset.hero !== undefined) return;
    io.observe(el);
  });
}

watchReveal();

window.addEventListener("load", () => {
  setTimeout(() => {
    document.querySelectorAll("[data-hero]").forEach((el) => el.classList.add("is-in"));
  }, 400);
});

/* ---------- 7. 数字を0から数え上げる ---------- */
const countIO = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const goal = Number(el.dataset.count);
    if (reduceMotion) { el.textContent = goal; countIO.unobserve(el); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / 1400, 1);
      // 最後はゆっくり止まる
      el.textContent = Math.round(goal * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    countIO.unobserve(el);
  });
});
document.querySelectorAll("[data-count]").forEach((el) => countIO.observe(el));

/* ---------- 8. 文字を打っては消す ---------- */
const typing = document.querySelector("[data-typing]");
if (typing) {
  const words = typing.dataset.typing.split("|");
  const out = typing.querySelector(".text");
  typing.setAttribute("aria-label", words.join(" / "));
  out.setAttribute("aria-hidden", "true");
  let w = 0;
  let c = 0;
  let deleting = false;
  const tick = () => {
    const word = words[w];
    c += deleting ? -1 : 1;
    out.textContent = word.slice(0, c);
    let wait = deleting ? 40 : 90;
    if (!deleting && c === word.length) {
      deleting = true;
      wait = 1600;
    } else if (deleting && c === 0) {
      deleting = false;
      w = (w + 1) % words.length;
      wait = 300;
    }
    setTimeout(tick, wait);
  };
  if (reduceMotion) out.textContent = words.join(" / ");
  else tick();
}

/* ---------- 9. マウスのカーソル ---------- */
// 輪（ゆっくり追いかける）と点（すぐ追いかける）の2つ。マウスのときだけ出す
if (isMouse && !reduceMotion) {
  const ring = document.createElement("div");
  ring.className = "cursor";
  const dot = document.createElement("div");
  dot.className = "cursor-dot";
  document.body.append(ring, dot);

  let mx = innerWidth / 2;
  let my = innerHeight / 2;
  let rx = mx;
  let ry = my;
  let cursorFrame = 0;
  addEventListener("pointermove", (e) => {
    mx = e.clientX;
    my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px)`;
    ring.hidden = dot.hidden = false;
    if (!cursorFrame) cursorFrame = requestAnimationFrame(follow);
  });

  const follow = () => {
    cursorFrame = 0;
    if (document.hidden) return;
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    if (Math.abs(mx - rx) + Math.abs(my - ry) > 0.15) cursorFrame = requestAnimationFrame(follow);
  };
  ring.hidden = dot.hidden = true;
  document.addEventListener("pointerleave", () => { ring.hidden = dot.hidden = true; });
  window.addEventListener("blur", () => { ring.hidden = dot.hidden = true; });

  // 上に乗ったものによって輪の形を変える
  document.addEventListener("pointerover", (e) => {
    const view = e.target.closest("[data-cursor]");
    const hover = e.target.closest("a, button, input, .zoomable");
    ring.classList.toggle("is-view", !!view);
    ring.classList.toggle("is-hover", !view && !!hover);
    ring.textContent = view ? view.dataset.cursor : "";
  });
}

/* ---------- 10. 吸いつくボタン ---------- */
// マウスを近づけると、ボタンがマウスの方へ少し寄る
if (isMouse && !reduceMotion) {
  document.querySelectorAll(".magnetic").forEach((btn) => {
    btn.addEventListener("pointermove", (e) => {
      const r = btn.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
    });
    btn.addEventListener("pointerleave", () => {
      btn.style.transform = "";
    });
  });
}

/* ---------- 11. 作品カード：傾き・光・動画の予告 ---------- */
document.querySelectorAll(".work-card").forEach((card) => {
  const video = card.querySelector("video");

  if (isMouse && !reduceMotion) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      // マウスの位置に合わせてカードを傾け、光の中心を動かす
      card.style.transform = `perspective(900px) rotateY(${(px - 0.5) * 8}deg) rotateX(${(0.5 - py) * 8}deg)`;
      card.style.setProperty("--mx", `${px * 100}%`);
      card.style.setProperty("--my", `${py * 100}%`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  }

  if (!video || reduceMotion || navigator.connection?.saveData) return;
  let wantsPreview = false;
  const play = () => {
    wantsPreview = true;
    if (!video.src) video.src = video.dataset.src;
    video.play().then(() => {
      if (wantsPreview && !document.hidden) card.classList.add("is-playing");
      else video.pause();
    }).catch(() => {});
  };
  const stop = () => {
    wantsPreview = false;
    video.pause();
    card.classList.remove("is-playing");
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) stop(); }).observe(card);

  if (isMouse) {
    // マウス：カードに乗せている間だけ再生
    card.addEventListener("pointerenter", play);
    card.addEventListener("pointerleave", stop);
  }
});

/* ---------- 12. 横スクロールの列（トップの作品） ---------- */
const rail = document.querySelector(".rail");
if (rail) {
  // マウスでつかんで横に動かせるようにする
  let down = false;
  let startX = 0;
  let startLeft = 0;
  let moved = false;
  rail.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    down = true;
    moved = false;
    startX = e.clientX;
    startLeft = rail.scrollLeft;
  });
  rail.addEventListener("dragstart", (e) => e.preventDefault());
  addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 5) {
      moved = true;
      rail.classList.add("is-drag");
    }
    rail.scrollLeft = startLeft - dx;
  });
  addEventListener("pointerup", () => {
    down = false;
    rail.classList.remove("is-drag");
  });
  addEventListener("pointercancel", () => { down = false; moved = false; rail.classList.remove("is-drag"); });
  addEventListener("blur", () => { down = false; moved = false; rail.classList.remove("is-drag"); });
  // つかんで動かしたときは、カードのリンクを開かない
  rail.addEventListener("click", (e) => {
    if (moved && e.detail !== 0) { e.preventDefault(); e.stopPropagation(); }
    moved = false;
  }, true);

  // ← → ボタン：カード1枚分ずつ動かす
  document.querySelectorAll("[data-rail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = rail.querySelector(".work-card");
      const step = card ? card.offsetWidth + parseFloat(getComputedStyle(rail).columnGap || 0) : 300;
      rail.scrollBy({ left: step * Number(btn.dataset.rail), behavior: reduceMotion ? "instant" : "smooth" });
    });
  });
  const updateRail = () => document.querySelectorAll("[data-rail]").forEach((btn) => {
    btn.disabled = Number(btn.dataset.rail) < 0 ? rail.scrollLeft <= 2 : rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2;
  });
  rail.addEventListener("scroll", updateRail, { passive: true });
  new ResizeObserver(updateRail).observe(rail);
  updateRail();
}

/* ---------- 13. 画像の拡大表示（ライトボックス） ---------- */
// .zoomable を押すと、同じページの .zoomable を順番にめくれる拡大画面を開く
const zoomables = [...document.querySelectorAll(".zoomable")];
if (zoomables.length) {
  const lb = document.createElement("dialog");
  lb.className = "lightbox";
  lb.setAttribute("role", "dialog");
  lb.setAttribute("aria-modal", "true");
  lb.setAttribute("aria-label", "画像の拡大表示");
  lb.innerHTML = `
    <span class="lb-count"></span>
    <img alt="">
    <p aria-live="polite"></p>
    <button type="button" class="icon-btn lb-btn lb-close" aria-label="閉じる">✕</button>
    <button type="button" class="icon-btn lb-btn lb-prev" aria-label="前の画像">←</button>
    <button type="button" class="icon-btn lb-btn lb-next" aria-label="次の画像">→</button>`;
  document.body.append(lb);

  const img = lb.querySelector("img");
  const cap = lb.querySelector("p");
  const count = lb.querySelector(".lb-count");
  let index = 0;
  let lastFocus = null;

  const show = (i) => {
    index = (i + zoomables.length) % zoomables.length;
    const src = zoomables[index].querySelector("img");
    const fig = zoomables[index].closest("figure");
    img.src = src.src;
    img.alt = src.alt;
    cap.textContent = fig && fig.querySelector("figcaption") ? fig.querySelector("figcaption").textContent : "";
    count.textContent = `${index + 1} / ${zoomables.length}`;
    lb.classList.remove("is-zoom");
  };

  const open = (i) => {
    lastFocus = zoomables[i];
    show(i);
    lb.classList.add("is-open");
    lb.showModal();
    document.body.style.overflow = "hidden";
    lb.querySelector(".lb-close").focus();
  };

  const close = () => {
    lb.classList.remove("is-open");
    lb.close();
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  };
  lb.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  lb.querySelector(".lb-prev").hidden = lb.querySelector(".lb-next").hidden = zoomables.length < 2;

  zoomables.forEach((z, i) => z.addEventListener("click", () => open(i)));
  lb.querySelector(".lb-close").addEventListener("click", close);
  lb.querySelector(".lb-prev").addEventListener("click", () => show(index - 1));
  lb.querySelector(".lb-next").addEventListener("click", () => show(index + 1));
  // 画像の外側を押したら閉じる、画像を押したら2倍に拡大
  lb.addEventListener("click", (e) => {
    if (e.target === lb) close();
  });
  img.addEventListener("click", () => lb.classList.toggle("is-zoom"));

  // キーボード：Esc で閉じる、← → でめくる
  addEventListener("keydown", (e) => {
    if (!lb.classList.contains("is-open")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") {
      const buttons = [...lb.querySelectorAll("button:not([hidden])")];
      const current = buttons.indexOf(document.activeElement);
      e.preventDefault();
      buttons[(current + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
    if (e.key === "ArrowLeft") { e.preventDefault(); show(index - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(index + 1); }
  });

  // スマホ：左右にスワイプでめくる
  let sx = null;
  lb.addEventListener("pointerdown", (e) => { if (!e.target.closest("button")) sx = e.clientX; });
  lb.addEventListener("pointercancel", () => { sx = null; });
  lb.addEventListener("pointerup", (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 60) show(index + (dx < 0 ? 1 : -1));
    sx = null;
  });
}

/* ---------- 14. YouTube：押されたときに初めて読み込む ---------- */
document.querySelectorAll(".yt-facade").forEach((btn) => {
  btn.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.id}?autoplay=1&rel=0`;
    iframe.title = btn.dataset.title || "YouTube 動画";
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    btn.replaceWith(iframe);
  });
});

/* ---------- 16. ツールのアイコン：押すと波が広がる ---------- */
document.querySelectorAll(".tool").forEach((t) => {
  t.addEventListener("pointerdown", () => {
    if (reduceMotion) return;
    const icon = t.querySelector(".tool-icon");
    const ring = document.createElement("span");
    ring.className = "tool-ripple";
    icon.appendChild(ring);
    ring.addEventListener("animationend", () => ring.remove());
  });
});

/* ---------- 17. 遊ぶときだけ作品を起動し、高さを中身に合わせる ---------- */
function fitPlayFrame(frame) {
  const fit = () => {
    try {
      const height = Math.ceil(frame.contentDocument.body.getBoundingClientRect().height);
      if (height > 0 && Math.abs(frame.clientHeight - height) > 1) frame.style.height = `${height}px`;
    } catch (e) {
      // 読めない場合は CSS の高さのまま
    }
  };
  frame.addEventListener("load", () => {
    fit();
    try {
      new ResizeObserver(fit).observe(frame.contentDocument.body);
    } catch (e) {
      // 古いブラウザでは最初の1回だけ合わせる
    }
  });
}
document.querySelectorAll(".play-frame iframe").forEach(fitPlayFrame);
document.querySelectorAll("[data-play-src]").forEach((button) => {
  button.addEventListener("click", () => {
    const frame = document.createElement("iframe");
    frame.src = button.dataset.playSrc;
    frame.title = button.dataset.playTitle;
    fitPlayFrame(frame);
    button.replaceWith(frame);
    frame.addEventListener("load", () => frame.focus(), { once: true });
  }, { once: true });
});

/* ---------- 15. 作品ページの背景をゆっくり動かす（パララックス） ---------- */
const heroBg = document.querySelector(".detail-hero .bg");
if (heroBg && !reduceMotion) {
  addEventListener("scroll", () => {
    if (scrollY < heroBg.parentElement.offsetHeight) heroBg.style.transform = `scale(1.1) translateY(${scrollY * 0.15}px)`;
  }, { passive: true });
}
