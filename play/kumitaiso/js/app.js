// 画面の進行：カウントダウン → 撮影 → 撮った写真を貼る → 計算 → 組み替え → 完成 → また次のカウントダウン（くり返し）
'use strict';

(function () {
  const $ = function (id) { return document.getElementById(id); };
  window.addEventListener('error', function (e) { $('status').textContent = 'エラー：' + e.message; });
  window.addEventListener('unhandledrejection', function (e) { $('status').textContent = 'エラー：' + (e.reason && e.reason.message || e.reason); });

  const LOOP = { countdown: 5, hold: 2 };      // カウントダウンの秒数／完成してから次のカウントダウンまでの秒数
  const cv = $('stage'), ctx = cv.getContext('2d');
  const video = $('video'), sampleView = $('sampleView'), photo = $('photo');
  const photoBig = document.createElement('canvas'); photoBig.width = PHOTO_W; photoBig.height = PHOTO_H;

  let stage = makeStage();
  let source = 'loading';      // 'camera' | 'sample'
  let phase = 'guide';         // 'guide' | 'idle' | 'countdown' | 'shoot' | 'build' | 'done' | 'paused'
  let left = LOOP.countdown, hold = 0, paused = false, debug = false, deadline = 0, holdEnd = 0;
  let frame = 0, last = performance.now(), scale = 1;
  let sampleIndex = 0, lastWhole = -1;
  const samples = [];          // 見本の形：{ name, label, mask }

  /* ===== 大きさ ===== */
  function fit() {
    const box = cv.parentElement.getBoundingClientRect();
    const w = box.width - 20, h = box.height - 20;
    scale = Math.max(0.1, Math.min(w / STAGE_W, h / STAGE_H));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = Math.round(STAGE_W * scale) + 'px';
    cv.style.height = Math.round(STAGE_H * scale) + 'px';
    cv.width = Math.round(STAGE_W * scale * dpr);
    cv.height = Math.round(STAGE_H * scale * dpr);
    cv.dataset.dpr = dpr;
  }
  window.addEventListener('resize', fit);

  /* ===== 表示の部品 ===== */
  function setStatus(t) { $('status').textContent = t; }
  function setStep(n) {
    document.querySelectorAll('#steps li').forEach(function (li) {
      const k = +li.dataset.step;
      li.classList.toggle('on', k === n);
      li.classList.toggle('done', k < n);
    });
  }
  let toastTimer = 0;
  function toast(t) {
    const el = $('toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function setProgress(v) {
    $('progress').classList.toggle('on', v !== null);
    if (v !== null) $('progressBar').style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%';
  }
  function maskCanvas(mask, rgb, alpha, bg) {
    const t = document.createElement('canvas'); t.width = MASK_W; t.height = MASK_H;
    const g = t.getContext('2d'), img = g.createImageData(MASK_W, MASK_H);
    for (let i = 0; i < mask.length; i++) {
      const on = mask[i] > 0.5;
      if (on) { img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = alpha; }
      else if (bg) { img.data[i * 4] = bg[0]; img.data[i * 4 + 1] = bg[1]; img.data[i * 4 + 2] = bg[2]; img.data[i * 4 + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    return t;
  }
  // 見本の形を「写真」として描く（灰色の人の形）
  function drawSample(canvas, mask) {
    canvas.getContext('2d').drawImage(maskCanvas(mask, [70, 74, 86], 255, [246, 247, 251]), 0, 0, canvas.width, canvas.height);
  }
  // 撮った写真に、人と判断した所を色で重ねて、写真の札に貼る
  function showPhoto(src, mask) {
    const g = photo.getContext('2d');
    g.drawImage(src, 0, 0, photo.width, photo.height);
    g.drawImage(maskCanvas(mask, [76, 125, 255], 95, null), 0, 0, photo.width, photo.height);
    $('photoEmpty').hidden = true;
    const card = $('photoCard');
    card.classList.remove('arrive'); void card.offsetWidth; card.classList.add('arrive');
  }

  // 計算中は、舞台のまん中に大きく「〇〇%」を出す
  function showPct(v) {
    const b = $('bigCount');
    if (v === null) { if (b.classList.contains('pct')) { b.classList.remove('pct'); b.textContent = ''; } return; }
    b.classList.remove('tick'); b.classList.add('pct'); b.textContent = v + '%';
  }

  /* ===== 撮影 ===== */
  async function shoot() {
    phase = 'shoot'; setStep(2);
    $('liveCard').classList.remove('focus');
    $('bigCount').classList.remove('tick');
    const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    setStatus('撮影しました。形を読み取っています…');
    let mask;
    if (source === 'camera' && video.videoWidth) {
      drawPhoto(photoBig, video, video.videoWidth, video.videoHeight, true);
      mask = await segmentPhoto(photoBig);
      $('photoNote').textContent = 'この形を組体操で作ります';
    } else {
      const s = samples[sampleIndex % samples.length];
      sampleIndex++;
      mask = s.mask;
      drawSample(photoBig, mask);
      $('photoNote').textContent = '見本：' + s.label;
    }
    showPhoto(photoBig, mask);
    const r = stage.capture(mask);
    if (r === 'small') { toast('人が見つかりませんでした。体の下の端が画面の下に届くように立ってください'); startCountdown(); return; }
    if (r === 'same') { toast('形がほとんど変わっていないので、このままにします'); phase = 'done'; holdEnd = performance.now() + 1000; setStep(4); setStatus('変化なし'); return; }
    if (r === 'busy') { startCountdown(); return; }
    phase = 'build';
  }
  function startCountdown() {
    if (paused) { phase = 'paused'; setStep(0); setStatus('一時停止中'); return; }
    phase = 'countdown'; left = LOOP.countdown; lastWhole = -1;
    deadline = performance.now() + LOOP.countdown * 1000;      // 時計で数える（画面が重くても5秒は5秒）
    setStep(1);
    $('liveCard').classList.add('focus');
    if (source === 'sample' && samples.length) drawSample(sampleView, samples[sampleIndex % samples.length].mask);
  }

  /* ===== 毎コマ ===== */
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now; frame++;
    try {
      stage.update(null, dt);
      if (phase === 'countdown') {
        left = (deadline - now) / 1000;
        const whole = Math.max(1, Math.ceil(left));
        $('count').textContent = left > 0 ? whole : '';
        $('ringBar').style.strokeDashoffset = String(276.5 * (1 - Math.max(0, left) / LOOP.countdown));
        if (whole !== lastWhole && left > 0) {
          lastWhole = whole;
          const b = $('bigCount'); b.textContent = whole; b.classList.remove('tick'); void b.offsetWidth; b.classList.add('tick');
        }
        setStatus('あと ' + whole + ' 秒で撮影します。ポーズをとってください');
        setProgress(null);
        if (left <= 0) shoot();
      } else if (phase === 'build') {
        const ph = stage.phase(), pr = stage.progress();
        if (ph === 'compute') { setStep(3); setStatus('どう組むか計算中… ' + pr.pct + '%（' + pr.count + '人）'); setProgress(pr.pct / 100); showPct(pr.pct); }
        else if (ph === 'move') { showPct(null); setStep(4); setStatus('組み替え中…（' + pr.moving + '人が移動中）'); setProgress(pr.total ? 1 - pr.moving / pr.total : 1); }
        else {
          showPct(null);
          phase = 'done'; hold = LOOP.hold; holdEnd = now + LOOP.hold * 1000;
          document.querySelectorAll('#steps li').forEach(function (li) { li.classList.add('done'); li.classList.remove('on'); });
          const m = stage.metrics;
          setStatus('完成！' + (m && m.moved ? '（' + m.moved + '人が組み替わりました）' : '（' + stage.people.filter(function (p) { return p.fig !== null; }).length + '人）'));
          setProgress(null);
        }
      } else if (phase === 'done') {
        if (now >= holdEnd) startCountdown();
      }
      draw();
      if (debug) showDebug();
    } catch (e) { setStatus('エラー：' + e.message); }
    requestAnimationFrame(loop);
  }
  function draw() {
    const dpr = +cv.dataset.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    stage.draw(ctx, scale, frame, debug);
  }
  function showDebug() {
    const m = stage.metrics;
    const lines = [
      '入力：' + (source === 'camera' ? 'カメラ' : '見本の形'),
      '人数（顔ぶれ）：' + stage.people.length + '／組体操に参加：' + stage.people.filter(function (p) { return p.fig !== null; }).length,
      '移動中：' + stage.people.filter(function (p) { return !p.placed; }).length,
      '接触の違反（この瞬間）：' + stage.checkContacts()
    ];
    if (m) lines.push('最後の組み直し：外した ' + m.removed + '人／動いた ' + m.moved + '人／計算 ' + m.computeMs + 'ms' + (m.catchUp !== undefined ? '／撮影から ' + m.catchUp.toFixed(1) + '秒で完成' : ''));
    lines.push('青：撮った形　赤い点：支えの接触');
    $('debug').textContent = lines.join('\n');
  }

  /* ===== 入力（カメラ／見本） ===== */
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('このブラウザではカメラが使えません');
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = s;
    await video.play();
    setSource('camera');
  }
  function setSource(src) {
    if (src !== source) stage = makeStage();
    source = src;
    video.hidden = src !== 'camera';
    sampleView.hidden = src === 'camera';
    $('liveTitle').textContent = src === 'camera' ? '次に撮る場面（カメラ）' : '次に使う形（見本）';
    $('btnSource').querySelector('.lbl').textContent = src === 'camera' ? '見本の形にする' : 'カメラにする';
    $('photoEmpty').hidden = false;
    photo.getContext('2d').clearRect(0, 0, photo.width, photo.height);
    if (phase !== 'guide') startCountdown();
  }
  function stopCamera() { if (video.srcObject) { video.srcObject.getTracks().forEach(function (t) { t.stop(); }); video.srcObject = null; } }

  /* ===== ボタン ===== */
  $('btnInfo').addEventListener('click', function () { $('info').hidden = false; });
  $('btnInfoClose').addEventListener('click', function () { $('info').hidden = true; });
  $('btnPause').addEventListener('click', function () {
    paused = !paused;
    $('btnPause').querySelector('.ico').textContent = paused ? '▶' : '⏸';
    $('btnPause').querySelector('.lbl').textContent = paused ? '再開' : '一時停止';
    if (!paused && phase === 'paused') startCountdown();
    if (paused && phase === 'countdown') { phase = 'paused'; $('liveCard').classList.remove('focus'); setStep(0); setStatus('一時停止中'); }
  });
  $('btnShoot').addEventListener('click', function () { if (phase === 'countdown' || phase === 'paused' || phase === 'done') shoot(); });
  $('btnSource').addEventListener('click', function () {
    if (source === 'camera') { stopCamera(); setSource('sample'); }
    else startCamera().catch(function (e) { toast('カメラが使えません：' + e.message); });
  });
  $('btnDebug').addEventListener('click', function () {
    debug = !debug;
    $('btnDebug').setAttribute('aria-pressed', String(debug));
    $('debug').hidden = !debug;
  });

  /* ===== 起動 ===== */
  fit();
  setStep(0);
  // 読み込みの間も、ベンチで待つ棒人間を描いておく
  last = performance.now();
  requestAnimationFrame(loop);
  (async function () {
    setStatus('準備中…（モデルを読み込んでいます）');
    // 読み込み中の画面：今読んでいる行を回し、終わった行に ✓ を付ける
    const items = document.querySelectorAll('#lsteps li');
    const mark = function (i, n) {
      items.forEach(function (li, k) { li.classList.toggle('ok', k < i); li.classList.toggle('now', k === i); });
      const pct = Math.round(100 * i / n);
      $('lbar').style.width = pct + '%'; $('lpct').textContent = pct + '%';
    };
    await loadModels(mark);
    for (const n of ['armsOut', 'oneArm', 'armsUp', 'akimbo', 'legsApart']) samples.push({ name: n, label: TEST_SHAPES[n].label, mask: testMask(n) });
    mark(5, 5);
    setTimeout(function () { $('loading').classList.add('done'); }, 400);
    // すぐに始める：カメラを使う（許可されなければ見本の形）
    phase = 'idle';
    setStatus('カメラの使用を許可してください（ベンチの棒人間が待っています）');
    startCamera().catch(function () { toast('カメラが使えないので、見本の形で動かします'); setSource('sample'); });
  })().catch(function (e) { setStatus('読み込みに失敗しました：' + e.message); $('lpct').textContent = '読み込みに失敗しました：' + e.message; });
})();
