// طبقة اتصال موحّدة بالـ API + إدارة الجلسة.
//
// orbithub فرع مراسلات تابع لـ Hostaka وليس منتجاً مستقلاً — لا يوجد تسجيل
// دخول أو إنشاء حساب هنا إطلاقاً. مصدرين للجلسة، بالترتيب:
//   1) الوسيط المركزي oauth.hostaka.fun (نفس المستخدم فعلياً بـ
//      console/wiki/apps): كوكي httpOnly مشتركة حقيقية على .hostaka.fun.
//      عند التحميل، لو ما فيه توكن محلي، نسأل GET oauth.hostaka.fun/api/token
//      بصمت (credentials:include) — لو المستخدم مسجّل دخول بأي نطاق فرعي
//      تابع لـ Hostaka، يرجع التوكن فوراً بدون أي تحويل يشوفه المستخدم.
//   2) بوابة /chat على hostaka.fun (fallback أقدم، لسا شغّالة ومفيدة أول
//      زيارة إطلاقاً لأي نطاق فرعي قبل ما تتخزن الكوكي المشتركة أصلاً):
//      تمرّر التوكن يدوياً كـ ?token= بالرابط، نلتقطه هون ونخزّنه محلياً.
// بعد أي منهم، تُستخدم Authorization: Bearer عادي لكل طلبات API — تماماً
// متل باقي صفحات Hostaka.

const SESSION_KEY = 'hostaka_token';
const OAUTH_BASE = 'https://oauth.hostaka.fun';

/** يلتقط ?token= القادم من بوابة /chat في Hostaka، لو موجود، ويخزّنه */
(function captureTokenFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    const t = params.get('token');
    if (t) {
      localStorage.setItem(SESSION_KEY, t);
      params.delete('token');
      const rest = params.toString();
      history.replaceState({}, '', location.pathname + (rest ? '?' + rest : ''));
    }
  } catch (e) { /* تجاهل */ }
})();

/**
 * يسحب الجلسة بصمت من الوسيط المركزي oauth.hostaka.fun لو ما فيه توكن
 * محلي بعد. يُستدعى مرة وحدة عند بداية تحميل الصفحة، قبل أي قرار تحويل
 * لصفحة الدخول — عشان زيارة مباشرة لـ orbithub (بدون المرور ببوابة
 * /chat) ما توديه لفورم دخول وهو مسجّل دخول أصلاً بمكان تاني بالمنصة.
 */
async function pullSessionFromOauthRelay() {
  if (localStorage.getItem(SESSION_KEY)) return true; // فيه توكن محلي أصلاً
  try {
    const res = await fetch(OAUTH_BASE + '/api/token', { credentials: 'include' });
    if (!res.ok) return false; // 404 = ما فيه جلسة مشتركة مخزّنة
    const data = await res.json();
    if (data?.token) { localStorage.setItem(SESSION_KEY, data.token); return true; }
  } catch (e) { /* الوسيط غير متاح — نكمل بالـ fallback العادي بصمت */ }
  return false;
}

const Api = (() => {
  let cachedUser = null;

  function token() { return localStorage.getItem(SESSION_KEY) || ''; }

  function currentUser() { return cachedUser; }
  function setCachedUser(u) { cachedUser = u; }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    cachedUser = null;
    // نمسح الكوكي المشتركة كمان (تسجيل خروج فعلي من كل النطاقات الفرعية،
    // مو بس من orbithub) — طلب best-effort، ما نستنى عليه ولا نوقف شي
    // لو فشل (الوسيط غير متاح مثلاً).
    fetch(OAUTH_BASE + '/api/token', { method: 'DELETE', credentials: 'include' }).catch(() => {});
  }

  async function request(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* لا يوجد body */ }
    if (!res.ok) {
      const err = new Error(data?.error || `خطأ (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
    token, currentUser, setCachedUser, clearSession,
  };
})();

/**
 * يحوّل مباشرة لصفحة دخول Hostaka (وليس لبوابة /chat) عشان نتفادى حلقة
 * تحويل لا نهائية: لو رحنا لـ /chat مباشرة والمستخدم مو مسجّل دخول
 * بـ Hostaka أصلاً، /chat هناك بترجّعنا لـ orbithub بتوكن فاضي، وorbithub
 * بيرجّعنا هون تاني... وهكذا للأبد. بدل هيك: نروح لصفحة /login صراحة مع
 * ?next=/chat — لو المستخدم مسجّل دخول بـ Hostaka أصلاً، login.js هناك
 * يكتشف هذا فوراً (أول سطر بالملف) ويحوّله بصمت عبر /chat بدون ما يشوف
 * أي فورم؛ ولو مو مسجّل دخول فعلاً، يشوف فورم الدخول الحقيقي، وبعد
 * تسجيله يرجع تلقائياً لنفس البوابة.
 * (ملاحظة: هذا المسار صار نادر الحدوث فعلياً بعد تفعيل oauth.hostaka.fun
 * أعلاه — بيصير بس أول زيارة إطلاقاً لأي نطاق فرعي بمنصة Hostaka، قبل ما
 * تتخزن الكوكي المشتركة لأول مرة.)
 *
 * قاطع دائرة: لو صار عدة محاولات تحويل بفترة قصيرة (يعني في حلقة —
 * orbithub يفشل يتحقق من التوكن، يرجع لتسجيل الدخول، تسجيل الدخول يكتشف
 * جلسة موجودة ويرجّعه بصمت، ويفشل يتحقق تاني... للأبد)، نوقف التحويل
 * تماماً ونعرض رسالة خطأ واضحة بدل ما تضل الصفحة تلمع بين orbithub
 * وتسجيل الدخول بدون توقف. هذا **يوقف الحلقة**، لكن السبب الجذري غالباً
 * JWT_SECRET غير مطابق بالضبط بين orbithub وHostaka (أو TURSO_* لو فشل
 * بحساب "الحساب غير موجود") — راجع الكونسول لرسالة الخطأ الحقيقية.
 */
const REDIRECT_GUARD_KEY = 'orbithub_auth_redirect_count';
const REDIRECT_GUARD_WINDOW_MS = 15000; // 15 ثانية
const REDIRECT_GUARD_MAX = 3;

function showAuthLoopError(detail) {
  console.error('[orbithub] توقفت المصادقة بعد عدة محاولات متتالية فاشلة. السبب المُبلَّغ من السيرفر:', detail);
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:14px;font-family:system-ui,sans-serif;text-align:center;padding:24px;direction:rtl">
      <div style="font-size:40px">🐈💔</div>
      <h2 style="margin:0">تعذّر تأكيد تسجيل الدخول تلقائياً</h2>
      <p style="color:#888;max-width:420px;margin:0">
        صار في تحويل متكرر بين orbithub وصفحة الدخول بدون توقف — على الأغلب
        السيرفر يرفض التوكن (JWT_SECRET غير مطابق بين orbithub وHostaka
        بالضبط، أو قاعدة البيانات غير موصولة). افتح أدوات المطوّر (Console)
        بالمتصفح لرؤية رسالة الخطأ الحقيقية القادمة من السيرفر.
      </p>
      <button onclick="localStorage.removeItem('${SESSION_KEY}'); sessionStorage.removeItem('${REDIRECT_GUARD_KEY}'); location.href='https://hostaka.fun/login?next=' + encodeURIComponent('https://hostaka.fun/chat');"
        style="padding:10px 22px;border:none;border-radius:8px;background:#8b5e3c;color:#fff;font-size:14px;cursor:pointer">
        امسح الجلسة وحاول تسجيل الدخول من جديد
      </button>
    </div>`;
}

function redirectToHostakaLogin(reason) {
  let count = 0;
  try {
    const raw = JSON.parse(sessionStorage.getItem(REDIRECT_GUARD_KEY) || 'null');
    if (raw && Date.now() - raw.t < REDIRECT_GUARD_WINDOW_MS) count = raw.n;
  } catch (e) { /* تجاهل */ }
  count += 1;

  if (count > REDIRECT_GUARD_MAX) {
    showAuthLoopError(reason);
    return; // نوقف — ما في تحويل تاني
  }

  try { sessionStorage.setItem(REDIRECT_GUARD_KEY, JSON.stringify({ n: count, t: Date.now() })); } catch (e) {}
  const next = encodeURIComponent('https://hostaka.fun/chat');
  location.href = `https://hostaka.fun/login?next=${next}`;
}

/**
 * يتأكد من وجود جلسة صالحة قبل عرض الصفحة: يجرّب oauth.hostaka.fun بصمت
 * أولاً (لو ما فيه توكن محلي أصلاً)، وبعدين يتحقق فعلياً من صلاحية
 * التوكن عبر /api/auth/me. يحوّل لصفحة الدخول تلقائياً لو فشلت كل
 * المحاولات.
 */
async function requireAuthPageAsync() {
  await pullSessionFromOauthRelay();
  if (!Api.token()) { redirectToHostakaLogin('لا يوجد توكن محلي ولا بالوسيط المشترك'); return null; }
  try {
    const me = await Api.get('/auth/me');
    // نجح التحقق — نصفّر عدّاد الحلقة عشان لا يتراكم من محاولات قديمة فاشلة
    try { sessionStorage.removeItem(REDIRECT_GUARD_KEY); } catch (e) {}
    Api.setCachedUser(me);
    return me;
  } catch (e) {
    if (e.status === 401) {
      // توكن مرفوض من السيرفر — نمسحه محلياً عشان ما نعيد إرساله بنفس
      // الحلقة، ونسمح لمحاولة تالية (لو حصلت) تاخذ توكن جديد بدل القديم.
      Api.clearSession();
      redirectToHostakaLogin(e.data?.error || 'رفض 401 من /api/auth/me');
      return null;
    }
    throw e;
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(isoLike) {
  const d = new Date(String(isoLike).replace(' ', 'T') + 'Z');
  const diffSec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return window.t ? t('time.now', 'الآن') : 'الآن';
  if (diffSec < 3600) return Math.floor(diffSec / 60) + (window.t ? t('time.min', 'د') : 'د');
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + (window.t ? t('time.hour', 'س') : 'س');
  return Math.floor(diffSec / 86400) + (window.t ? t('time.day', 'ي') : 'ي');
}

/* هذا الجزء فقط (الثيم) قائم على آلية حقيقية موجودة أصلاً بمشروع Hostaka
 * (كوكي hostaka_theme على نطاق .hostaka.fun، راجع public/shared.js هناك) —
 * نقرأها هنا بس، ما نكتبها، عشان orbithub يفتح بنفس الوضع الليلي/النهاري
 * المختار بباقي المنصة من أول تحميل. */
(function () {
  try {
    const m = document.cookie.match(/(?:^|; )hostaka_theme=([^;]*)/);
    if (m) document.documentElement.setAttribute('data-theme', decodeURIComponent(m[1]));
  } catch (e) { /* تجاهل */ }
})();
