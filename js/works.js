/* =========================================================
   作品一覧ページ（works.html）の操作
   ・種類のボタンで絞り込む／キーワードで探す／並べ替える／タイルとリストを切り替える
   ・カードが動くときは、元の位置から新しい位置へなめらかに移動させる（FLIP という方法）
   ========================================================= */

const grid = document.getElementById("grid");
const cards = [...grid.querySelectorAll(".work-card")];
const filterBox = document.getElementById("filters");
const filterBtns = [...filterBox.querySelectorAll("button")];
const pill = filterBox.querySelector(".pill");
const search = document.getElementById("search");
const sortSel = document.getElementById("sort");
const shown = document.getElementById("shown");
const empty = document.getElementById("empty");

let filter = "all";
const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("ja").trim();
// 検索のたびに全カードの文章を読み直さず、最初に一度まとめる。
const searchText = new Map(cards.map(c => [c, normalize(c.textContent + " " + c.dataset.filter)]));

function saveState() {
  const url = new URL(location.href);
  url.hash = filter === "all" ? "" : filter;
  for (const [key, value, fallback] of [["q", search.value, ""], ["sort", sortSel.value, "no"], ["view", grid.classList.contains("is-list") ? "list" : "grid", "grid"]]) {
    if (value === fallback) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  // URLをコピーしても、作品詳細から戻っても、同じ条件で見られる。
  try { history.replaceState(null, "", url); } catch (_) { /* file:// でも絞り込みは使える */ }
}

// 1. 選んでいるボタンの後ろに、色のついた丸（pill）を移動させる
function movePill() {
  const btn = filterBox.querySelector('[aria-pressed="true"]');
  pill.style.left = `${btn.offsetLeft}px`;
  pill.style.top = `${btn.offsetTop}px`;
  pill.style.width = `${btn.offsetWidth}px`;
  pill.style.height = `${btn.offsetHeight}px`;
}

// 2. FLIP：変える前の位置を覚える → 変える → ずれた分だけ戻してから、0 へアニメーション
function flip(change) {
  cards.forEach(c => c.getAnimations().forEach(a => a.cancel()));
  if (reduceMotion) { change(); return; }
  const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
  change();
  cards.forEach((c) => {
    if (c.classList.contains("is-hidden")) return;
    const a = before.get(c);
    const b = c.getBoundingClientRect();
    if (!a.width) {
      // 隠れていたカードが出てくるとき：小さく透明な状態から出す
      c.animate([{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: "cubic-bezier(.22,1,.36,1)" });
      return;
    }
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    const sx = a.width / b.width;
    if (dx || dy || sx !== 1) {
      c.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${sx})`, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }],
        { duration: 600, easing: "cubic-bezier(.22,1,.36,1)" }
      );
    }
  });
}

// 3. 絞り込み・キーワード・並べ替えをまとめて画面に反映する
function apply() {
  const words = normalize(search.value).split(/\s+/).filter(Boolean);
  let count = 0;

  cards.forEach((c) => {
    const okFilter = filter === "all" || c.dataset.filter.split(" ").includes(filter);
    const okWord = words.every(word => searchText.get(c).includes(word));
    const visible = okFilter && okWord;
    c.classList.toggle("is-hidden", !visible);
    // スクロールで出す前のカードでも、絞り込みで出したときは見えるようにする
    if (visible) c.classList.add("is-in");
    if (visible) count++;
  });

  const order = [...cards].sort((a, b) => {
    // 制作時期が未確認の作品は、日付順では最後に置く。
    if (sortSel.value !== "no" && (!a.dataset.date || !b.dataset.date)) {
      return Number(!a.dataset.date) - Number(!b.dataset.date) || a.dataset.no - b.dataset.no;
    }
    if (sortSel.value === "new") return b.dataset.date.localeCompare(a.dataset.date);
    if (sortSel.value === "old") return a.dataset.date.localeCompare(b.dataset.date);
    return a.dataset.no - b.dataset.no;
  });
  order.forEach((c) => grid.appendChild(c));

  shown.textContent = count;
  empty.classList.toggle("is-shown", count === 0);
}

// 4. ボタン・入力にイベントをつなぐ
filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.setAttribute("aria-pressed", b === btn));
    filter = btn.dataset.f;
    movePill();
    flip(apply);
    saveState();
  });
});

search.addEventListener("input", (event) => {
  if (event.isComposing) return;
  flip(apply); saveState();
});
search.addEventListener("compositionend", () => { flip(apply); saveState(); });
sortSel.addEventListener("change", () => { flip(apply); saveState(); });

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b === btn));
    flip(() => grid.classList.toggle("is-list", btn.dataset.view === "list"));
    saveState();
  });
});

// URL に #game などがついていたら、その種類で絞り込んだ状態で開く
function restoreState() {
  const params = new URLSearchParams(location.search);
  filter = filterBtns.find(b => `#${b.dataset.f}` === location.hash)?.dataset.f || "all";
  filterBtns.forEach(b => b.setAttribute("aria-pressed", b.dataset.f === filter));
  search.value = params.get("q") || "";
  sortSel.value = ["new", "old"].includes(params.get("sort")) ? params.get("sort") : "no";
  const list = params.get("view") === "list";
  grid.classList.toggle("is-list", list);
  document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === (list ? "list" : "grid")));
  apply(); movePill();
}
document.getElementById("resetWorks").addEventListener("click", () => {
  filter = "all"; search.value = ""; sortSel.value = "no";
  filterBtns.forEach(b => b.setAttribute("aria-pressed", b.dataset.f === filter));
  flip(apply); movePill(); saveState(); search.focus();
});
addEventListener("hashchange", restoreState);
addEventListener("popstate", restoreState);
restoreState();

addEventListener("resize", movePill);
document.fonts.ready.then(movePill);
movePill();
