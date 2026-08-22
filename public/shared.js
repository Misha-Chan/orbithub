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
 */
function redirectToHostakaLogin() {
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
  if (!Api.token()) { redirectToHostakaLogin(); return null; }
  try {
    const me = await Api.get('/auth/me');
    Api.setCachedUser(me);
    return me;
  } catch (e) {
    if (e.status === 401) { redirectToHostakaLogin(); return null; }
    throw e;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function timeAgo(isoLike) {
  const d = new Date(String(isoLike).replace(' ', 'T') + 'Z');
  const diffSec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'الآن';
  if (diffSec < 3600) return Math.floor(diffSec / 60) + 'د';
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'س';
  return Math.floor(diffSec / 86400) + 'ي';
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
