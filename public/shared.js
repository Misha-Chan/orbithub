// طبقة اتصال موحّدة بالـ API + إدارة الجلسة. كل الصفحات تستخدم هذا الملف
// بدل ما يكرر كل ملف منطق fetch/token الخاص فيه.
const Api = (() => {
  function token() { return localStorage.getItem('msgsys_token') || ''; }
  function setSession(token_, user) {
    localStorage.setItem('msgsys_token', token_);
    localStorage.setItem('msgsys_user', JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem('msgsys_token');
    localStorage.removeItem('msgsys_user');
  }
  function currentUser() {
    try { return JSON.parse(localStorage.getItem('msgsys_user') || 'null'); } catch { return null; }
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
    token, setSession, clearSession, currentUser,
  };
})();

/** يحمي صفحة تحتاج تسجيل دخول — يحوّل لصفحة الدخول لو ما فيه جلسة */
function requireAuthPage() {
  if (!Api.token()) {
    location.href = '/login.html';
    return null;
  }
  return Api.currentUser();
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
