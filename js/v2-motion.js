/* =========================================================
   v2 の動き：どの要素を動かすかの印を付け、画面に入ったら m-in を付ける
   見た目と動きそのものは css/v2-motion.css に書いてある
   ========================================================= */

(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 1. 画像・動画の入れ物に「幕が上がる」印
  document.querySelectorAll(".zoomable, .tutorial-video, .player, .play-launch").forEach((el) => {
    if (el.querySelector(":scope > img, :scope > video, :scope > .yt-facade")) el.classList.add("m-mask");
  });

  // 3. 中身を順番に出す入れ物（子どもに番号を振る）
  document.querySelectorAll(".prose, .gallery, .meta-grid, .slides-pair, .about-method, .sign-flow ol").forEach((box) => {
    box.classList.add("m-stagger");
    [...box.children].forEach((child, i) => child.style.setProperty("--i", i));
  });

  // 画面に入ったら一度だけ m-in を付ける
  const targets = document.querySelectorAll(".m-mask, .m-stagger, .detail-section, .dg, .prose.about");
  if (reduce || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("m-in"));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("m-in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    targets.forEach((el) => io.observe(el));
  }

  // 6. 作品ページの先頭：スクロールすると題名が少し沈んで薄くなる
  const heroWrap = document.querySelector(".detail-hero .wrap");
  if (heroWrap && !reduce) {
    const hero = heroWrap.parentElement;
    let ticking = false;
    addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const p = Math.min(1, scrollY / hero.offsetHeight);
        heroWrap.style.transform = `translateY(${p * 60}px)`;
        heroWrap.style.opacity = String(1 - p * 0.9);
        ticking = false;
      });
    }, { passive: true });
  }
})();
