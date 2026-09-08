/*
 * Aloula's public embed mode, advertised by its live pages (og:video).
 * Keep the official player: it obtains/refreshes its own stream URLs.
 * Never hard-code a signed HLS URL, proxy a broadcast, or load both channels.
 */
(function () {
  'use strict';

  const channels = Object.freeze({
    quran: {
      url: 'https://aloula.sba.sa/live/quran',
      logo: 'icons/tv-quran.png',
      ar: 'قناة القرآن الكريم — مكة المكرمة',
      en: 'Quran TV — Makkah'
    },
    sunna: {
      url: 'https://aloula.sba.sa/live/sunna',
      logo: 'icons/tv-sunna.png',
      ar: 'قناة السنة النبوية — المدينة المنورة',
      en: 'Sunnah TV — Madinah'
    }
  });

  const messages = {
    ar: {
      heading: 'البث المباشر للحرمين', provider: 'عبر منصة الأولى',
      makkah: 'مكة المكرمة', madinah: 'المدينة المنورة',
      quran: 'قناة القرآن الكريم', sunna: 'قناة السنة النبوية', live: 'بث مباشر',
      reload: 'إعادة التحميل', fullscreen: 'ملء الشاشة', stop: 'إيقاف البث',
      source: 'المصدر: منصة الأولى ↗',
      loading: 'جارٍ فتح المشغّل الرسمي…',
      ready: 'مشغّل منصة الأولى',
      slow: 'التحميل يستغرق وقتًا أطول من المعتاد',
      error: 'تعذّر تحميل المشغّل الرسمي',
      offline: 'انقطع الاتصال بالإنترنت',
      reconnected: 'عاد الاتصال بالإنترنت',
      help: 'إن ظهرت رسالة إشعارات، يمكنك اختيار «كلا» للمتابعة دون تفعيلها. اضغط ▶ داخل الفيديو للتشغيل، وتحكّم بالصوت والجودة من أزراره. البث يحتاج الإنترنت.',
      slowHelp: 'التحميل يستغرق وقتًا. جرّب «إعادة التحميل»، أو افتح المصدر الرسمي إذا استمرت المشكلة.',
      errorHelp: 'تعذّر فتح البث. تحقّق من الاتصال واضغط «إعادة التحميل». يمكنك أيضًا فتح المصدر الرسمي.',
      offlineHelp: 'لا يوجد اتصال بالإنترنت. عند عودة الشبكة اضغط «إعادة التحميل» لاستئناف البث.',
      reconnectedHelp: 'عاد الاتصال. إذا لم يستأنف البث تلقائيًا، اضغط «إعادة التحميل».',
      fullscreenHelp: 'استخدم زر ملء الشاشة داخل الفيديو على هذا المتصفح.',
      offlineToast: '⚠️ البث المباشر يحتاج اتصالًا بالإنترنت'
    },
    en: {
      heading: 'Haramain live TV', provider: 'Via Aloula',
      makkah: 'Makkah', madinah: 'Madinah',
      quran: 'Quran TV', sunna: 'Sunnah TV', live: 'LIVE',
      reload: 'Reload', fullscreen: 'Full screen', stop: 'Stop live TV',
      source: 'Source: Aloula ↗',
      loading: 'Opening the official player…',
      ready: 'Official Aloula player',
      slow: 'The player is taking longer to load',
      error: 'Could not load the official player',
      offline: 'Internet connection lost',
      reconnected: 'Internet connection restored',
      help: 'If Aloula asks to enable notifications, choose No to continue without enabling them. Press ▶ in the video to play; use its controls for sound and quality. An internet connection is required.',
      slowHelp: 'Loading is taking a while. Try Reload, or open the official source if the problem continues.',
      errorHelp: 'Could not open the stream. Check your connection and press Reload, or open the official source.',
      offlineHelp: 'No internet connection. When you are back online, press Reload to resume.',
      reconnectedHelp: 'You are back online. If the stream does not resume, press Reload.',
      fullscreenHelp: 'Use the full-screen button inside the video on this browser.',
      offlineToast: '⚠️ Live TV requires an internet connection'
    }
  };

  const panel = document.getElementById('liveTVPanel');
  const stage = document.getElementById('liveTVStage');
  const container = document.getElementById('globalAudioPlayerContainer');
  const hint = document.getElementById('liveTVHint');
  const source = document.getElementById('liveTVSource');
  const buttons = Array.from(document.querySelectorAll('[data-live-channel]'));
  let active = null;
  let language = 'ar';
  let state = 'ready';
  let loadId = 0;
  let loadTimer = null;

  function text(key) { return messages[language][key]; }

  function renderState() {
    if (!active) return;
    // An iframe load event does NOT prove that video is playing.
    // Playback/autoplay errors remain visible in the official player itself.
    window.setPlayerStatus(text(state));
    const warning = ['slow', 'error', 'offline', 'reconnected'].includes(state);
    hint.classList.toggle('is-warning', warning);
    hint.textContent = text(warning ? state + 'Help' : 'help');
  }

  function setLanguage(lang) {
    language = lang === 'en' ? 'en' : 'ar';
    document.querySelectorAll('[data-live-i18n]').forEach(function (el) {
      el.textContent = text(el.dataset.liveI18n);
    });
    buttons.forEach(function (button) {
      button.setAttribute('aria-label', channels[button.dataset.liveChannel][language]);
    });
    if (!active) return;
    const name = channels[active][language];
    document.getElementById('globalPlayerStationName').textContent = name;
    document.getElementById('stationName').textContent = name;
    const frame = stage.querySelector('iframe');
    if (frame) frame.title = name;
    renderState();
  }

  // Detaching the iframe is essential: hiding it would leave its audio playing.
  function stop() {
    const wasActive = active !== null;
    active = null;
    loadId++;
    clearTimeout(loadTimer);
    loadTimer = null;
    const frame = stage.querySelector('iframe');
    if (frame) {
      frame.onload = null;
      frame.onerror = null;
      frame.src = 'about:blank';
    }
    stage.replaceChildren();
    stage.setAttribute('aria-busy', 'false');
    panel.hidden = true;
    container.classList.remove('is-tv');
    buttons.forEach(function (button) { button.setAttribute('aria-pressed', 'false'); });
    return wasActive;
  }

  function scrollToPlayer() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  function play(key, forceReload) {
    if (!Object.prototype.hasOwnProperty.call(channels, key)) return;
    if (navigator.onLine === false) {
      window.showToast(text('offlineToast'));
      return;
    }
    if (active === key && !forceReload && stage.querySelector('iframe')) {
      scrollToPlayer();
      return;
    }

    // One active player: cancel radio retries, unload its source, detach old TV.
    window.stopRadio(true);
    active = key;
    const channel = channels[key];
    const ticket = ++loadId;
    state = 'loading';
    container.classList.add('is-tv');
    panel.hidden = false;
    stage.setAttribute('aria-busy', 'true');
    buttons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.liveChannel === key));
    });
    document.getElementById('globalPlayerArt').src = channel.logo;
    source.href = channel.url;
    setLanguage(language);

    const frame = document.createElement('iframe');
    frame.id = 'liveTVFrame';
    frame.title = channel[language];
    frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; screen-wake-lock';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = channel.url + '?embed=true';
    frame.onload = function () {
      if (ticket !== loadId || active !== key) return;
      clearTimeout(loadTimer);
      loadTimer = null;
      stage.setAttribute('aria-busy', 'false');
      state = navigator.onLine === false ? 'offline' : 'ready';
      renderState();
    };
    frame.onerror = function () {
      if (ticket !== loadId) return;
      clearTimeout(loadTimer);
      loadTimer = null;
      stage.setAttribute('aria-busy', 'false');
      state = 'error';
      renderState();
    };
    loadTimer = setTimeout(function () {
      if (ticket !== loadId) return;
      state = navigator.onLine === false ? 'offline' : 'slow';
      renderState();
    }, 25000);
    stage.replaceChildren(frame);
    // No copied stream tokens, API credentials, HLS library or extra video.
    window.requestWakeLock();
    scrollToPlayer();
  }

  function reload() { if (active) play(active, true); }

  async function fullscreen() {
    if (!active) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
      else window.showToast(text('fullscreenHelp'));
    } catch (e) { window.showToast(text('fullscreenHelp')); }
  }

  window.LiveTV = Object.freeze({
    play: play, stop: stop, reload: reload, fullscreen: fullscreen,
    setLanguage: setLanguage, isActive: function () { return active !== null; }
  });

  window.addEventListener('offline', function () {
    if (active) { state = 'offline'; renderState(); }
  });
  window.addEventListener('online', function () {
    if (active && state === 'offline') { state = 'reconnected'; renderState(); }
  });
  // Do not silently restart a possibly paused video after reconnecting.
  // The retry button remains available, as does the official source link.
  window.addEventListener('pagehide', function () {
    if (active) window.stopRadio(true);
  });
  source.addEventListener('click', function () {
    if (active) window.stopRadio(true);
  });
})();
