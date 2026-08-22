// طبقة اتصال موحّدة بالـ API + إدارة الجلسة.
//
// orbithub فرع مراسلات تابع لـ Hostaka وليس منتجاً مستقلاً: لا يوجد تسجيل
// دخول أو إنشاء حساب هنا إطلاقاً. الجلسة تأتي حصراً من Hostaka نفسه عبر
// كوكي مشتركة على نطاق .hostaka.fun (hostaka_token) — بنفس أسلوب مزامنة
// hostaka_theme المستخدم أصلاً في Hostaka (راجع shared.js هناك). لو الكوكي
// غير موجودة، المستخدم يُحوَّل لصفحة دخول Hostaka وبعدها يرجع بجلسة جاهزة.

function readSharedCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

const Api = (() => {
  let cachedUser = null;

  function token() { return readSharedCookie('hostaka_token') || ''; }

  function currentUser() {
    if (cachedUser) return cachedUser;
    try {
      const raw = readSharedCookie('hostaka_user');
      cachedUser = raw ? JSON.parse(raw) : null;
    } catch { cachedUser = null; }
    return cachedUser;
  }

  function setCachedUser(u) { cachedUser = u; }

  /** يمسح الجلسة المشتركة بالكامل ويرجّع لصفحة دخول Hostaka */
  function clearSession() {
    const domain = /(^|\.)hostaka\.fun$/.test(location.hostname) ? '.hostaka.fun' : '';
    ['hostaka_token', 'hostaka_user', 'hostaka_role'].forEach((k) => {
      document.cookie = k + '=; Max-Age=0; Path=/;' + (domain ? ' Domain=' + domain + ';' : '');
    });
    cachedUser = null;
  }

  async function request(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
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

/** يحوّل لصفحة دخول Hostaka مع الرجوع لـ orbithub بعدها */
function redirectToHostakaLogin() {
  const next = encodeURIComponent(location.href);
  location.href = `https://hostaka.fun/login?next=${next}`;
}

/**
 * يحمي صفحة تحتاج تسجيل دخول. بما إن التوكن قد يكون صادر من حساب Hostaka
 * وما زلنا ما تأكدنا إنه ما زال صالح، الصفحات تستدعي initSession() (async)
 * لتأكيد الجلسة فعلياً من السيرفر؛ requireAuthPage() هنا فقط تعمل تحقّقاً
 * سريعاً أولياً (وجود الكوكي) عشان ما نعرض واجهة فاضية لحظة قبل التحويل.
 */
function requireAuthPage() {
  if (!Api.token()) {
    redirectToHostakaLogin();
    return null;
  }
  return Api.currentUser();
}

/** يجلب بيانات المستخدم الكاملة من السيرفر ويؤكد صلاحية الجلسة فعلياً */
async function initSession() {
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

/* ================= مزامنة الوضع الليلي/النهاري مع باقي Hostaka =================
 * نفس آلية hostaka_theme الموجودة أصلاً بمشروع Hostaka: كوكي مشتركة على
 * .hostaka.fun تُقرأ هنا فقط (orbithub ما يغيّرها، بس يحترم قيمتها) عشان
 * الثيم يكون نفسه دايماً بين hostaka.fun و orbithub.hostaka.fun.
 */
(function () {
  try {
    const theme = readSharedCookie('hostaka_theme');
    if (theme) document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* تجاهل */ }
})();
