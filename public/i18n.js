/*
 * orbithub i18n — نفس نمط i18n.js بمشروع Hostaka بالضبط (data-i18n +
 * t(key, fallback))، بس مصدر اللغة هنا القراءة فقط من الكوكي المشتركة
 * hostaka_lang (Domain=.hostaka.fun، تُكتب من صفحات Hostaka نفسها —
 * راجع public/shared.js هناك). orbithub ما يغيّر اللغة بنفسه، بس يتبع
 * أي لغة مختارة بباقي المنصة؛ الافتراضي عند غياب الكوكي كلياً: الإنجليزية.
 */
(function () {
  var dict = { en: null, ar: null };
  var loaded = { en: false, ar: false };

  function readSharedCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getLang() {
    var v = readSharedCookie('hostaka_lang') || localStorage.getItem('hostaka_lang');
    return (v === 'ar' || v === 'en') ? v : 'en'; // الإنجليزية افتراضياً
  }
  var lang = getLang();
  window.currentLang = lang;

  function t(key, fallback) {
    var parts = key.split('.');
    function lookup(d) {
      var node = d;
      for (var i = 0; i < parts.length; i++) {
        if (node && typeof node === 'object' && parts[i] in node) node = node[parts[i]];
        else return undefined;
      }
      return typeof node === 'string' ? node : undefined;
    }
    var v = dict[lang] ? lookup(dict[lang]) : undefined;
    if (v === undefined && lang !== 'en' && dict.en) v = lookup(dict.en);
    if (v !== undefined) return v;
    return fallback !== undefined ? fallback : key;
  }
  window.t = t;

  function applyTranslations(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (el.dataset.i18nFallback === undefined) el.dataset.i18nFallback = el.textContent;
      el.textContent = t(key, el.dataset.i18nFallback);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (el.dataset.i18nPlaceholderFallback === undefined) el.dataset.i18nPlaceholderFallback = el.getAttribute('placeholder') || '';
      el.setAttribute('placeholder', t(key, el.dataset.i18nPlaceholderFallback));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (el.dataset.i18nTitleFallback === undefined) el.dataset.i18nTitleFallback = el.getAttribute('title') || '';
      el.setAttribute('title', t(key, el.dataset.i18nTitleFallback));
    });
  }
  window.applyTranslations = applyTranslations;

  function applyDocumentDirection() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }

  // نطبّق الاتجاه فوراً (متزامن) قبل أي رسم، عشان ما تصير وميضة RTL->LTR
  applyDocumentDirection();

  function applyWhenReady() {
    if (document.body) applyTranslations();
    else document.addEventListener('DOMContentLoaded', function () { applyTranslations(); });
  }

  function loadDict(l) {
    if (loaded[l]) return Promise.resolve();
    return fetch('/translations/' + l + '.json')
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) { dict[l] = data; loaded[l] = true; })
      .catch(function () { dict[l] = dict[l] || {}; loaded[l] = true; });
  }

  loadDict(lang).then(function () {
    applyWhenReady();
    // نجهّز en كـ fallback ثاني بالخلفية (لو اللغة الحالية عربي ونقص مفتاح)
    if (lang !== 'en') loadDict('en');
  });
})();
