/* UNSPOKEN：発表ポスターの WORK OVERVIEW を3枚の図で示す。
   自動で DEFINE → TEACH → USE。押した段階で切り替えを止める。 */
(() => {
  const box = document.querySelector('[data-demo="unspoken-overview"]');
  if (!box) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const drawings = [
    `<svg viewBox="0 0 250 150" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="78" cy="102" r="29"/>
        <circle cx="68" cy="97" r="2" fill="currentColor" stroke="none"/>
        <circle cx="88" cy="97" r="2" fill="currentColor" stroke="none"/>
        <path d="M70 113 Q78 117 86 113"/>
        <circle cx="108" cy="76" r="3"/><circle cx="116" cy="67" r="4"/>
        <g class="overview-thought">
          <path d="M130 68 C111 63 114 39 130 37 C130 22 156 20 164 31 C184 22 201 41 191 55 C196 74 166 83 156 71 C143 80 131 76 130 68Z"/>
          <circle cx="156" cy="42" r="5"/>
          <path d="M156 48 L151 60 L164 62 L169 71 M153 56 L144 64 M153 51 L164 48 M151 60 L143 72"/>
        </g>
      </g>
    </svg>`,
    `<svg viewBox="0 0 250 150" aria-hidden="true">
      <g fill="currentColor" transform="translate(2 2)">
        <path d="M50 128 C36 114 31 98 25 86 C21 77 29 72 35 80 L43 91 L30 58 C27 49 35 45 39 54 L52 80 L45 37 C44 29 53 27 55 36 L64 78 L65 27 C65 19 75 19 75 28 L76 78 L87 36 C90 28 99 31 96 40 L85 91 L99 72 C105 64 113 71 107 79 L91 108 L89 130Z"/>
      </g>
      <path d="M119 66 L130 76 L119 86 M131 66 L142 76 L131 86" fill="none" stroke="currentColor" stroke-width="2"/>
      <rect x="155" y="15" width="83" height="121" rx="3" fill="var(--bg)" stroke="var(--line-strong)"/>
      <g class="overview-skeleton" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M202 122 L181 94 L166 71 M181 94 L183 74 L178 46 M202 122 L192 82 L190 34 M202 122 L205 80 L208 30 M202 122 L216 89 L226 52 M181 94 L192 82 L205 80 L216 89"/>
        <g fill="var(--accent)" stroke="none"><circle cx="202" cy="122" r="3"/><circle cx="181" cy="94" r="2.5"/><circle cx="192" cy="82" r="2.5"/><circle cx="205" cy="80" r="2.5"/><circle cx="216" cy="89" r="2.5"/><circle cx="166" cy="71" r="2.5"/><circle cx="178" cy="46" r="2.5"/><circle cx="190" cy="34" r="2.5"/><circle cx="208" cy="30" r="2.5"/><circle cx="226" cy="52" r="2.5"/></g>
      </g>
    </svg>`,
    `<svg viewBox="0 0 250 150" aria-hidden="true">
      <!-- NUL は発表ポスターの PDF に入っている元のドット絵（背景透過）を拡大。黒い背景に溶けないよう、絵に細い明るい縁を付けてある -->
      <g class="overview-nul">
        <image href="images/work5_nul.png?v=2" x="95" y="18" width="62" height="112" style="image-rendering:pixelated"/>
      </g>
      <text class="overview-ok" x="40" y="40" fill="var(--hit)" font-size="20" font-weight="700" transform="rotate(-12 40 40)">OK!</text>
    </svg>`
  ];
  // 文言は発表ポスターから、そのまま使う。
  const steps = [
    ['DEFINE', 'ユーザーが合図を考える'],
    ['TEACH', 'システムに対応関係を教える'],
    ['USE', '形成した合図でNULへ伝える']
  ];
  box.innerHTML = `<ol class="overview-steps">${steps.map(([title, caption], i) =>
    `<li><button type="button" class="overview-step" data-overview-step="${i}" aria-pressed="false">
      <span class="overview-picture">${drawings[i]}</span>
      <span class="overview-copy"><b>${title}</b><span>${caption}</span></span>
    </button></li>`).join('')}</ol>`;

  const buttons = [...box.querySelectorAll('[data-overview-step]')];
  const autoButton = box.closest('[data-dg]').querySelector('[data-overview-auto]');
  let selected = 0;
  let auto = !reduce.matches;
  let seen = false;
  let timer = 0;

  function select(i) {
    selected = i;
    box.dataset.overviewPhase = steps[i][0];
    buttons.forEach((button, n) => {
      button.setAttribute('aria-pressed', String(n === i));
      button.classList.toggle('is-current', n === i);
    });
  }
  function sync() {
    clearInterval(timer);
    autoButton.setAttribute('aria-pressed', String(auto));
    box.classList.toggle('is-visible', seen && !document.hidden);
    if (auto && seen && !document.hidden) timer = setInterval(() => select((selected + 1) % steps.length), 3000);
  }
  buttons.forEach((button, i) => button.addEventListener('click', () => {
    auto = false;
    select(i);
    sync();
  }));
  autoButton.addEventListener('click', () => { auto = !auto; sync(); });
  new IntersectionObserver(([entry]) => { seen = entry.isIntersecting; sync(); }).observe(box);
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener('change', () => { if (reduce.matches) { auto = false; sync(); } });
  window.addEventListener('pagehide', () => clearInterval(timer));
  select(0);
  sync();
})();
