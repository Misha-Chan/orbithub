let me = null;
(async function bootstrap() {
  me = await requireAuthPageAsync(); // يجرّب oauth.hostaka.fun بصمت ثم /chat كـ fallback
  if (me) init();
})();

let activeChat = null; // {type:'dm', username, displayName, otherId} | {type:'group', id, name, myRole}
let pollTimer = null;
let typingPollTimer = null;
let typingSendTimer = null;
let replyTo = null;
let encryptionEnabled = false;
let openMsgId = null; // id الرسالة المفتوحة حالياً (تفاعلات/خيارات ظاهرة لها فقط)

function init() {
  document.getElementById('meBox').innerHTML =
    `<div class="avatar">${me.avatar ? `<img src="${escapeHtml(me.avatar)}">` : avatarInitial(me.display_name || me.username)}</div><span>${escapeHtml(me.display_name || me.username)}</span>`;

  document.getElementById('logoutBtn').onclick = () => { Api.clearSession(); location.href = 'https://hostaka.fun'; };

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  document.getElementById('newChatBtn').onclick = startNewChatFromInput;
  document.getElementById('newChatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); startNewChatFromInput(); }
  });

  document.getElementById('newGroupBtn').onclick = () => toggleModal('groupModal', true);
  document.getElementById('groupCancel').onclick = () => toggleModal('groupModal', false);
  document.getElementById('groupConfirm').onclick = createGroup;

  document.getElementById('composerForm').addEventListener('submit', onSend);
  document.getElementById('messageInput').addEventListener('input', onTypingInput);
  document.getElementById('backToListBtn').onclick = () => closeThread();
  document.getElementById('attachImageBtn').onclick = () => document.getElementById('imageFileInput').click();
  document.getElementById('imageFileInput').addEventListener('change', onImageFileChosen);

  // منتقي الإيموجي (حزمة Fluent Emoji نفسها المستخدمة بـ Hostaka) — نفس
  // استدعاء EmojiFluent.attachButton الموجود هناك بالضبط.
  if (window.EmojiFluent) {
    EmojiFluent.attachButton(document.getElementById('chatEmojiBtn'), document.getElementById('messageInput'));
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.EmojiFluent) EmojiFluent.attachButton(document.getElementById('chatEmojiBtn'), document.getElementById('messageInput'));
    });
  }
  document.getElementById('cancelReply').onclick = () => setReply(null);
  document.getElementById('deleteConvBtn').onclick = onDeleteConversation;
  document.getElementById('groupMembersBtn').onclick = openMembersModal;
  document.getElementById('membersClose').onclick = () => toggleModal('membersModal', false);
  document.getElementById('addMemberBtn').onclick = addMemberToGroup;
  document.getElementById('threadTitleClickable').onclick = (e) => openChatMenu(e);
  document.getElementById('chatMenuBackdrop').onclick = closeChatMenu;
  document.getElementById('mediaClose').onclick = () => toggleModal('mediaModal', false);
  document.getElementById('lightboxClose').onclick = closeImageLightbox;
  document.querySelector('#imageLightbox .lightbox-backdrop').onclick = closeImageLightbox;

  document.getElementById('encryptToggle').addEventListener('change', onEncryptToggle);
  document.getElementById('pinCancel').onclick = () => toggleModal('pinModal', false);
  document.getElementById('pinConfirm').onclick = onPinConfirm;

  loadConversations();
  loadGroups();
  MsgCrypto.ensureKeysRegistered().catch(() => {});
  // رابط مخصّص لكل محادثة (/chat/<username> أو /chat/g/<id>): نفتح المحادثة
  // المذكورة بالرابط مباشرة عند تحميل الصفحة، ونتفاعل مع أزرار الرجوع/التقدم.
  openFromUrl();
  window.addEventListener('popstate', openFromUrl);
}

// ================= روابط المحادثات (Deep Links) =================
// كل محادثة صار إلها مسار خاص فيها بدل ما تكون كلها /chat: الروابط صارت
// قابلة للحفظ وللمشاركة مع الأطراف المشاركة بالمحادثة نفسها.
function chatPathFor() {
  if (!activeChat) return '/chat';
  if (activeChat.type === 'group') return '/chat/g/' + activeChat.id;
  return '/chat/' + encodeURIComponent(activeChat.username);
}

/** يحدّث شريط العنوان ليطابق المحادثة المفتوحة حالياً (pushState للإضافة لسجل
 *  المتصفح حتى يشتغل زر الرجوع، replaceState للتصحيح بدون إضافة سطر). */
function syncChatUrl(push) {
  const path = chatPathFor();
  if (location.pathname === path) return;
  try {
    history[push ? 'pushState' : 'replaceState']({ chat: path }, '', path);
  } catch (e) { /* تجاهل */ }
}

/** يفكّك المسار الحالي ويفتح المحادثة المطابقة — يُستدعى عند التحميل وعند
 *  التنقل بزر الرجوع/التقدم في المتصفح. */
function openFromUrl() {
  const parts = location.pathname.split('/').filter(Boolean); // ['chat', ...]
  if (parts[0] !== 'chat') return;
  if (parts[1] === 'g' && parts[2]) {
    switchTab('groups');
    openGroup(Number(parts[2]));
  } else if (parts[1]) {
    switchTab('dms');
    openDM(decodeURIComponent(parts[1]), null);
  } else if (activeChat) {
    closeThread(false);
  }
}

/** يرجع لقائمة المحادثات ويزيل رابط المحادثة من شريط العنوان. */
function closeThread(updateUrl = true) {
  stopPolling();
  activeChat = null;
  document.getElementById('threadView').style.display = 'none';
  document.getElementById('emptyState').style.display = 'flex';
  document.querySelector('.app').classList.remove('chat-open');
  if (updateUrl && location.pathname !== '/chat') {
    try { history.pushState({}, '', '/chat'); } catch (e) {}
  }
}

/** ينسخ رابط المحادثة المفتوحة حالياً (مسارها الخاص) للحافظة. */
function copyChatLink() {
  if (!activeChat) return;
  const url = location.origin + chatPathFor();
  const done = () => showToast(t('menu.link_copied', 'تم نسخ رابط المحادثة'));
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
  } else {
    fallbackCopy(url, done);
  }
}

function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  } catch (e) {
    showToast(text);
  }
}

function avatarInitial(name) { return `<img src="/default-avatar.jpg" alt="">`; }
function showToast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function toggleModal(id, show) { document.getElementById(id).style.display = show ? 'flex' : 'none'; }

// ================= Sidebar: tabs + lists =================
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('dmList').style.display = tab === 'dms' ? 'block' : 'none';
  document.getElementById('groupList').style.display = tab === 'groups' ? 'block' : 'none';
  document.getElementById('newGroupBtn').style.display = tab === 'groups' ? 'block' : 'none';
}

async function loadConversations() {
  const list = document.getElementById('dmList');
  try {
    const convs = await Api.get('/messages/conversations');
    if (!convs.length) { list.innerHTML = `<div class="empty-list">${t('toast.no_messages_yet', 'لا محادثات بعد')}</div>`; return; }
    list.innerHTML = convs.map((c) => {
      const preview = c.last_image && !c.last_content
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> ${t('composer.image_short', 'صورة')}`
        : escapeHtml(c.last_content || '');
      const prefix = Number(c.last_from_id) === me.id
        ? `<span class="conv-you">${escapeHtml(t('composer.you_prefix', 'أنت: '))}</span>` : '';
      const time = c.last_at ? `<div class="conv-time">${timeAgo(c.last_at)}</div>` : '';
      return `
      <div class="conv-item${c.unread ? ' unread' : ''}" data-username="${escapeHtml(c.username)}" data-otherid="${c.id}">
        <div class="avatar">${c.avatar ? `<img src="${escapeHtml(c.avatar)}">` : avatarInitial(c.display_name || c.username)}</div>
        <div class="conv-meta">
          <div class="conv-row-top">
            <div class="conv-name">${escapeHtml(c.display_name || c.username)}</div>
            ${time}
          </div>
          <div class="conv-last">${prefix}${preview}</div>
        </div>
        ${c.unread ? `<span class="conv-unread">${c.unread}</span>` : ''}
      </div>`;
    }).join('');
    list.querySelectorAll('.conv-item').forEach((el) => {
      el.onclick = () => openDM(el.dataset.username, Number(el.dataset.otherid));
    });
  } catch (e) {
    list.innerHTML = `<div class="empty-list">${t('errors.load_conversations', 'تعذر تحميل المحادثات')}</div>`;
  }
}

async function loadGroups() {
  const list = document.getElementById('groupList');
  try {
    const groups = await Api.get('/groups');
    if (!groups.length) { list.innerHTML = `<div class="empty-list">${t('groups.none_yet', 'لا مجموعات بعد')}</div>`; return; }
    list.innerHTML = groups.map((g) => `
      <div class="group-item" data-id="${g.id}">
        <div class="avatar">${g.avatar ? `<img src="${escapeHtml(g.avatar)}">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`}</div>
        <div class="conv-meta">
          <div class="conv-name">${escapeHtml(g.name)}</div>
          <div class="conv-last">${escapeHtml(g.description || '')}</div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.group-item').forEach((el) => {
      el.onclick = () => openGroup(Number(el.dataset.id));
    });
  } catch (e) {
    list.innerHTML = `<div class="empty-list">${t('errors.load_groups', 'تعذر تحميل المجموعات')}</div>`;
  }
}

async function startNewChatFromInput() {
  const input = document.getElementById('newChatInput');
  const username = input.value.trim();
  if (!username) return;
  try {
    const user = await Api.get('/users/' + encodeURIComponent(username));
    input.value = '';
    switchTab('dms');
    openDM(user.username, user.id);
  } catch (e) {
    showToast(e.message, true);
  }
}

// ================= Opening a thread =================
function highlightActive(selector, matchFn) {
  document.querySelectorAll(selector).forEach((el) => el.classList.toggle('active', matchFn(el)));
}

async function openDM(username, otherId) {
  stopPolling();
  openMsgId = null;
  lastRenderSig = null;
  activeChat = { type: 'dm', username, otherId, displayName: username };
  highlightActive('.conv-item', (el) => el.dataset.username === username);
  syncChatUrl(true);

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('threadView').style.display = 'flex';
  document.querySelector('.app').classList.add('chat-open');
  document.getElementById('encryptToggleWrap').style.display = 'flex';
  document.getElementById('groupMembersBtn').style.display = 'none';
  document.getElementById('threadAvatar').innerHTML = avatarInitial(username);
  document.getElementById('threadName').textContent = username;
  document.getElementById('threadSub').textContent = t('chat.private_conv', 'محادثة خاصة');
  setReply(null);

  try {
    const profile = await Api.get('/users/' + encodeURIComponent(username));
    activeChat.otherId = profile.id;
    activeChat.displayName = profile.display_name || profile.username;
    document.getElementById('threadName').textContent = activeChat.displayName;
    document.getElementById('threadAvatar').innerHTML = profile.avatar
      ? `<img src="${escapeHtml(profile.avatar)}">` : avatarInitial(activeChat.displayName);
  } catch { /* تجاهل، خلي الاسم كما هو */ }

  await refreshDM(true);
  startPolling(refreshDM, 2500);
  startTypingPolling();
}

async function openGroup(id) {
  stopPolling();
  openMsgId = null;
  lastRenderSig = null;
  try {
    const group = await Api.get('/groups/' + id);
    activeChat = { type: 'group', id, name: group.name, myRole: group.myRole, members: group.members };

    highlightActive('.group-item', (el) => Number(el.dataset.id) === id);
    syncChatUrl(true);
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('threadView').style.display = 'flex';
    document.querySelector('.app').classList.add('chat-open');
    document.getElementById('encryptToggleWrap').style.display = 'none';
    document.getElementById('groupMembersBtn').style.display = 'inline-block';
    document.getElementById('threadAvatar').innerHTML = group.avatar
      ? `<img src="${escapeHtml(group.avatar)}">`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    document.getElementById('threadName').textContent = group.name;
    document.getElementById('threadSub').textContent = `${group.members.length} ${t('members.count_suffix', 'أعضاء')}`;
    setReply(null);

    await refreshGroup(true);
    startPolling(refreshGroup, 2500);
    startTypingPolling();
  } catch (e) {
    showToast(e.message, true);
  }
}

function startPolling(fn, ms) { pollTimer = setInterval(fn, ms); }
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (typingPollTimer) clearInterval(typingPollTimer);
  pollTimer = null; typingPollTimer = null;
}

function chatKey() {
  if (!activeChat) return null;
  if (activeChat.type === 'group') return 'group_' + activeChat.id;
  const ids = [me.id, activeChat.otherId].sort((a, b) => a - b);
  return `dm_${ids[0]}_${ids[1]}`;
}

// ================= Rendering messages =================
async function refreshDM(showErrors) {
  if (!activeChat || activeChat.type !== 'dm') return;
  try {
    const msgs = await Api.get('/messages/' + encodeURIComponent(activeChat.username));
    await renderMessages(msgs, 'dm');
    loadConversations();
  } catch (e) {
    // كنا نبلع أي خطأ هون بصمت (حتى بالتحميل الأول لفتح المحادثة، مو بس
    // الاستطلاع الدوري) — فلو فشل الطلب (504 مثلاً) ما يظهر أي أثر
    // للمستخدم، تبان الرسائل "مو موجودة" وهي فعلياً موجودة بس الطلب فشل.
    // نعرض الخطأ الحقيقي الآن (توست + كونسول) بدل الإخفاء الكامل.
    console.error('[orbithub] فشل تحميل الرسائل:', e);
    if (showErrors) showToast('تعذر تحميل الرسائل: ' + e.message, true);
  }
}

async function refreshGroup(showErrors) {
  if (!activeChat || activeChat.type !== 'group') return;
  try {
    const msgs = await Api.get(`/groups/${activeChat.id}/messages`);
    await renderMessages(msgs, 'group');
  } catch (e) {
    console.error('[orbithub] فشل تحميل رسائل المجموعة:', e);
    if (showErrors) showToast('تعذر تحميل الرسائل: ' + e.message, true);
  }
}

let lastRenderSig = null; // بصمة آخر رسم فعلي، لتجنّب إعادة رسم كاملة بلا داعي بكل استطلاع دوري

async function renderMessages(msgs, type) {
  const el = document.getElementById('messagesEl');

  // "إعادة التحميل الخفية": كنا نرسم كل الرسائل من الصفر كل 2.5 ثانية
  // (الاستطلاع الدوري) حتى لو ما تغيّر ولا رسالة — هذا يفقد مكان القراءة
  // ويكسر تجربة قراءة الرسائل القديمة. الحل: نقارن "بصمة" بسيطة للرسائل
  // (id + هل معدّلة + طول المحتوى + وجود صورة)، ولو نفسها زي آخر مرة،
  // نتجاهل إعادة رسم الرسائل نفسها بالكامل — بدون أي تأثير مرئي، الصفحة
  // تضل ثابتة تمامًا. عدّاد التفاعلات يستمر يتحدّث دايماً بكل الحالات
  // (تحته)، لأنه ممكن يتغيّر بدون ما تتغيّر بصمة الرسائل نفسها.
  const sig = msgs.map((m) => `${m.id}:${m.edited ? 1 : 0}:${(m.content || '').length}:${m.image ? 1 : 0}`).join('|');
  const contentChanged = sig !== lastRenderSig;

  if (contentChanged) {
    lastRenderSig = sig;

    const wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    const prevScrollTop = el.scrollTop;
    const prevScrollHeight = el.scrollHeight;

    const rendered = await Promise.all(msgs.map((m) => renderOneMessage(m, type)));
    el.innerHTML = rendered.join('');

    el.querySelectorAll('[data-react]').forEach((btn) => {
      btn.onclick = () => reactTo(Number(btn.dataset.id), btn.dataset.emoji, type);
    });
    el.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => startEdit(Number(btn.dataset.id), type);
    });
    el.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.onclick = () => deleteMsg(Number(btn.dataset.id), type);
    });
    el.querySelectorAll('[data-reply]').forEach((btn) => {
      btn.onclick = () => setReply({ id: Number(btn.dataset.id), preview: btn.dataset.preview });
    });

    // الخيارات (التفاعلات + رد/تعديل/حذف) ما تظهر إلا لما المستخدم يضغط
    // على الرسالة نفسها — مو دايماً ظاهرة ولا hover (اللي أصلاً ما يشتغل
    // باللمس بالجوال). ضغطة ثانية على نفس الرسالة أو بأي مكان ثاني تسكّرها.
    el.querySelectorAll('.msg-content').forEach((bubble) => {
      bubble.onclick = (e) => {
        e.stopPropagation();
        const id = Number(bubble.closest('.msg-row').dataset.msgid);
        openMsgId = (openMsgId === id) ? null : id;
        applyOpenMsgState(el);
      };
      const msgId = Number(bubble.closest('.msg-row').dataset.msgid);
      const msgObj = msgs.find((mm) => mm.id === msgId);
      if (msgObj) bindMsgContextTrigger(bubble, msgObj, type);
    });
    el.querySelectorAll('.msg-image').forEach((img) => {
      img.onclick = (e) => {
        e.stopPropagation(); // ما نخلي هذا يفتح/يسكّر التفاعلات كمان — بس يفتح نافذة الصورة
        openImageLightbox(img.dataset.full);
      };
    });
    applyOpenMsgState(el);

    // حفظ موضع القراءة بدقة: لو كان بالأسفل، خلّيه بالأسفل (رسالة جديدة
    // وصلت). لو كان بمنتصف/أعلى المحادثة يقرا رسائل قديمة، نعوّض فرق
    // الارتفاع الناتج عن إعادة الرسم بدل ما نخليه يرجع للأسفل أو يتصفّر —
    // هذا بالضبط اللي كان "يخربط" القراءة.
    if (wasAtBottom) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop = prevScrollTop + (el.scrollHeight - prevScrollHeight);
    }
  }

  // عدّاد التفاعلات (❤️👍...) يتحدّث دايماً بكل استطلاع، حتى لو تجاهلنا
  // إعادة رسم الرسائل نفسها فوق — التفاعل ممكن يتغيّر بدون ما يتغيّر نص
  // أي رسالة.
  await applyReactionCounts(msgs.map((m) => m.id), type);
  if (contentChanged) applyLinkPreviews();
}

/** رابط http/https أول موجود بنص الرسالة (بعد فك التشفير)، أو null */
function extractFirstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[.,!?)\]]+$/, '') : null;
}

const linkPreviewCache = new Map(); // url -> {title,description,image,siteName} بالجهاز نفسه، يفضى عند تحديث الصفحة

/** يجلب معاينة Open Graph لكل رابط بأول رسالة تحتويه، ويملأ بطاقة تحته */
async function applyLinkPreviews() {
  const slots = document.querySelectorAll('[data-link-preview-for]');
  for (const slot of slots) {
    const url = slot.dataset.linkUrl;
    if (!url) continue;
    try {
      let data = linkPreviewCache.get(url);
      if (!data) {
        data = await Api.get(`/link-preview?url=${encodeURIComponent(url)}`);
        linkPreviewCache.set(url, data);
      }
      if (!data || (!data.title && !data.image)) continue; // ما فيه شي نعرضه — يبقى الرابط نص عادي
      let domain = data.siteName || '';
      try { domain = domain || new URL(url).hostname; } catch (e) { /* تجاهل */ }
      slot.innerHTML = `
        <a class="link-preview-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
          ${data.image ? `<img class="link-preview-img" src="${escapeHtml(data.image)}" loading="lazy" onerror="this.remove()">` : ''}
          <div class="link-preview-body">
            ${data.title ? `<div class="link-preview-title">${escapeHtml(data.title)}</div>` : ''}
            ${data.description ? `<div class="link-preview-desc">${escapeHtml(data.description)}</div>` : ''}
            <div class="link-preview-domain">${escapeHtml(domain)}</div>
          </div>
        </a>`;
    } catch (e) {
      console.error('link-preview fetch failed for', url, e);
    }
  }
}

/** يطبّق حالة "الرسالة المفتوحة" (openMsgId) على كل صفوف الرسائل بعد الرسم */
function applyOpenMsgState(el) {
  el.querySelectorAll('.msg-row').forEach((row) => {
    row.classList.toggle('msg-open', Number(row.dataset.msgid) === openMsgId);
  });
}

// أي ضغطة بره فقاعة أي رسالة تسكّر الخيارات المفتوحة حالياً (مرة وحدة،
// مو بكل رسم — عشان ما نكرر المستمع مع كل تحديث/استطلاع دوري).
document.addEventListener('click', (e) => {
  if (openMsgId !== null && !e.target.closest('.msg-content')) {
    openMsgId = null;
    const el = document.getElementById('messagesEl');
    if (el) applyOpenMsgState(el);
  }
});

async function decryptIfNeeded(m) {
  if (!m.encrypted) return m.content;
  try {
    const key = await MsgCrypto.getSharedKeyFor(activeChat.username);
    // ما نقدر نجيب مفتاح مشترك: إما هذا الجهاز يحتاج استعادة الهوية عبر
    // PIN (فيه نسخة احتياطية على السيرفر ما استُعيدت هون بعد)، أو الطرف
    // الآخر نفسه بنفس الحالة. هذا لا يعني أي طرف "غير مفعّل للتشفير" —
    // التشفير شغّال دايمًا لكل الحسابات — بس نعرض نص توعوي بدل قفل مبهم.
    if (!key) return t('chat.encrypted_pending', 'الرسائل مشفرة بين الطرفين، يرجى التأكد من PIN');
    return await MsgCrypto.decryptText(key, m.content, m.iv);
  } catch {
    return '🔒 تعذر فك تشفير هذه الرسالة';
  }
}

/** هل النص يتكوّن من إيموجي فقط (بدون حروف/أرقام)؟ نستخدمه لعرض الإيموجي
 *  بالحجم الكبير خارج بطاقة الرسالة (نمط واتساب/تلغرام). */
let _emojiOnlyRe = null; // نبنيها كسولاً داخل try لتفادي أي خطأ صياغة بمحركات قديمة
function isEmojiOnly(text) {
  const s = String(text || '').replace(/\s/g, '');
  if (!s || s.length > 12) return false;
  if (_emojiOnlyRe === null) {
    try {
      _emojiOnlyRe = new RegExp('^[\\p{Extended_Pictographic}\\uFE0F\\u200D\\u20E3\\u{1F3FB}-\\u{1F3FF}]+$', 'u');
    } catch (e) {
      _emojiOnlyRe = false;
    }
  }
  return _emojiOnlyRe ? _emojiOnlyRe.test(s) : false;
}

async function renderOneMessage(m, type) {
  const mine = type === 'group' ? m.user_id === me.id : m.from_id === me.id;
  const senderName = type === 'group' ? m.from_name : (mine ? '' : activeChat.displayName);
  const rawContent = type === 'dm' ? await decryptIfNeeded(m) : m.content;
  // ننتظر جهوزية قائمة الإيموجي قبل الرسم — وإلا تُرسم الرموز كنص يونيكود خام
  // (يظهر مربع فارغ على بعض الأجهزة بدل الإيموجي). loadCatalog تخزّن وعدها
  // وتعيده، فما فيه طلب إضافي بعد أول مرة.
  if (window.EmojiFluent && EmojiFluent.loadCatalog) {
    try { await EmojiFluent.loadCatalog(); } catch (e) { /* تجاهل */ }
  }
  const content = window.EmojiFluent ? EmojiFluent.render(escapeHtml(rawContent)) : escapeHtml(rawContent);
  const bigEmoji = !m.image && content && isEmojiOnly(rawContent);
  const previewUrl = extractFirstUrl(rawContent);
  // ملاحظة: التفاعلات (عدد كل نوع + تفاعل المستخدم الحالي) تُحمَّل وتُحدَّث
  // بشكل منفصل بعد الرسم عبر applyReactionCounts() (تبحث عن
  // data-reactions-for بالـ DOM وتملأها) — مو من هون. كان فيه سطر ميت هنا
  // يستدعي groupReactions() اللي أصلاً مو معرّفة بأي مكان بالمشروع (خطأ
  // ReferenceError كان يوقف رسم كل الرسائل بصمت لأن الخطأ يرفض الـ
  // Promise.all كامل بـ renderMessages، وrefreshDM كانت تبلعه). حذفته.

  return `
    <div class="msg-row ${mine ? 'mine' : 'theirs'}" data-msgid="${m.id}">
      ${type === 'group' && !mine ? `<div class="conv-last" style="margin-bottom:2px">${escapeHtml(senderName)}</div>` : ''}
      <div class="msg-content">
        ${bigEmoji
          ? `<div class="msg-emoji-only">${content}</div>`
          : (content ? `<div class="msg-bubble">${content}</div>` : '')}
        ${previewUrl ? `<div class="link-preview-slot" data-link-preview-for="${m.id}" data-link-url="${escapeHtml(previewUrl)}"></div>` : ''}
        ${m.image ? `<img class="msg-image" src="${escapeHtml(m.image)}" data-full="${escapeHtml(m.image)}">` : ''}
      </div>
      <div class="msg-meta">
        ${timeAgo(m.created_at)} ${m.edited ? '· ' + t('msg.edited', 'مُعدّلة') : ''}
      </div>
      <div class="msg-reactions" data-reactions-for="${m.id}">
        ${['heart', 'like', '😂', '😮'].map((emoji) => `<span class="msg-reaction" data-react data-id="${m.id}" data-emoji="${emoji}">${emojiIcon(emoji)}</span>`).join('')}
      </div>
      <div class="msg-actions">
        <button data-reply data-id="${m.id}" data-preview="${escapeHtml((m.content || '').slice(0, 60))}">${t('msg.reply', 'رد')}</button>
        ${mine ? `<button data-edit data-id="${m.id}">${t('msg.edit', 'تعديل')}</button><button data-delete data-id="${m.id}">${t('msg.delete', 'حذف')}</button>` : ''}
      </div>
    </div>
  `;
}

function emojiIcon(key) {
  const glyph = { heart: '❤️', like: '👍', '😂': '😂', '😮': '😮' }[key] || key;
  // نفس نمط Hostaka بالضبط: window.EmojiFluent?.render(...) لعرض صورة Fluent
  // متسقة الشكل بدل الاعتماد على خط الإيموجي المدمج بكل جهاز/متصفح.
  return window.EmojiFluent ? EmojiFluent.render(glyph) : glyph;
}

/** يجلب عدد كل تفاعل + تفاعل المستخدم الحالي لمجموعة رسائل ويحدّث الواجهة */
async function applyReactionCounts(ids, type) {
  if (!ids.length) return;
  try {
    const path = type === 'dm'
      ? `/messages/reactions?ids=${ids.join(',')}`
      : `/groups/${activeChat.id}/messages/reactions?ids=${ids.join(',')}`;
    const map = await Api.get(path);
    Object.entries(map).forEach(([msgId, info]) => {
      const wrap = document.querySelector(`[data-reactions-for="${msgId}"]`);
      if (!wrap) return;
      const counts = {};
      info.reactions.forEach((r) => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });
      wrap.querySelectorAll('.msg-reaction').forEach((el) => {
        const emoji = el.dataset.emoji;
        const count = counts[emoji] || 0;
        el.textContent = count ? `${emojiIcon(emoji)} ${count}` : emojiIcon(emoji);
        el.classList.toggle('mine', info.userReaction === emoji);
        el.style.opacity = count || info.userReaction === emoji ? '1' : '.5';
      });
    });
  } catch { /* تجاهل فشل الاستطلاع */ }
}

// ================= Sending =================
let pendingImageFile = null;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function onImageFileChosen(e) {
  const file = e.target.files[0];
  const nameEl = document.getElementById('imagePreviewName');
  if (!file) { pendingImageFile = null; nameEl.textContent = ''; return; }
  if (!file.type.startsWith('image/')) {
    showToast(t('toast.not_an_image', 'الملف المختار ليس صورة'), true);
    e.target.value = '';
    pendingImageFile = null; nameEl.textContent = '';
    return;
  }
  pendingImageFile = file;
  nameEl.textContent = file.name;
}

/** يرفع الصورة المرفقة (إن وُجدت) عبر ImgBB ويرجّع رابطها، أو '' لو ما فيه صورة */
async function uploadPendingImage() {
  if (!pendingImageFile) return '';
  const base64 = await fileToBase64(pendingImageFile);
  const { url } = await Api.post('/upload', { image: base64 });
  return url;
}

function clearPendingImage() {
  pendingImageFile = null;
  document.getElementById('imageFileInput').value = '';
  document.getElementById('imagePreviewName').textContent = '';
}

function setReply(r) {
  replyTo = r;
  const bar = document.getElementById('replyBar');
  if (!r) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('replyText').textContent = 'رد على: ' + r.preview;
}

async function onSend(e) {
  e.preventDefault();
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text && !pendingImageFile) return;

  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  try {
    let image = '';
    try {
      image = await uploadPendingImage();
    } catch (uploadErr) {
      showToast('تعذر رفع الصورة: ' + uploadErr.message, true);
      sendBtn.disabled = false;
      return;
    }

    if (activeChat.type === 'dm') {
      let payload = { content: text, image, reply_to: replyTo?.id || null };
      if (encryptionEnabled && text) {
        const key = await MsgCrypto.getSharedKeyFor(activeChat.username);
        if (key) {
          const { ciphertext, iv } = await MsgCrypto.encryptText(key, text);
          payload = { content: ciphertext, iv, image, reply_to: replyTo?.id || null, encrypted: true };
        }
        // ملاحظة: لو ما فيه key (الطرف الآخر ما سجّل مفتاحه بعد) نرسل بدون
        // تشفير طبيعياً — هذا لم يعد يحصل عملياً بعد إصلاح توليد المفاتيح
        // التلقائي في المرحلة 3 (كل حساب يسجّل مفتاحه من أول تحميل للصفحة
        // بغض النظر هل فعّل PIN أو لأ).
      }
      await Api.post('/messages/' + encodeURIComponent(activeChat.username), payload);
      await refreshDM();
    } else {
      await Api.post(`/groups/${activeChat.id}/messages`, { content: text, image });
      await refreshGroup();
    }
    input.value = '';
    clearPendingImage();
    setReply(null);
    stopTyping();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    sendBtn.disabled = false;
  }
}

async function reactTo(id, emoji, type) {
  try {
    if (type === 'dm') {
      await Api.post(`/messages/react/${id}`, { emoji });
      await refreshDM();
    } else {
      await Api.post(`/groups/${activeChat.id}/messages/${id}/react`, { emoji });
      await refreshGroup();
    }
  } catch (e) { showToast(e.message, true); }
}

async function reportMsg(id, type, m) {
  const reason = prompt(t('prompts.report_message_reason', 'سبب الإبلاغ عن هذه الرسالة:'));
  if (reason === null || !reason.trim()) return;
  try {
    const ownerUsername = type === 'dm'
      ? (m.from_id === me.id ? me.username : activeChat.username)
      : null; // بالمجموعات ما عندنا username المرسل مباشرة بصف الرسالة، نتركها فاضية (حقل اختياري بجدول Hostaka)
    await Api.post('/reports', {
      target_id: id,
      target_owner_username: ownerUsername,
      subject: type === 'dm' ? `رسالة من محادثة مع ${activeChat.displayName || activeChat.username}` : `رسالة بمجموعة ${activeChat.name}`,
      reason: reason.trim(),
    });
    showToast(t('toast.report_sent', 'تم إرسال البلاغ، شكراً لك'));
  } catch (e) { showToast(e.message, true); }
}

// ================= قائمة خيارات الرسالة (ضغط مطوّل/ضغطتين) =================
function closeMsgMenu() {
  document.getElementById('msgMenu').style.display = 'none';
  document.getElementById('msgMenuBackdrop').style.display = 'none';
}

function openMsgMenu(m, type, x, y) {
  const mine = type === 'group' ? m.user_id === me.id : m.from_id === me.id;
  const menu = document.getElementById('msgMenu');
  const backdrop = document.getElementById('msgMenuBackdrop');

  const icons = {
    reply: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
    edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    delete: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    flag: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  };

  const items = [];
  items.push(`<button data-act="reply">${icons.reply}${t('msg.reply', 'رد')}</button>`);
  if (mine) {
    items.push(`<button data-act="edit">${icons.edit}${t('msg.edit', 'تعديل')}</button>`);
    items.push(`<button data-act="delete" class="danger">${icons.delete}${t('msg.delete', 'حذف')}</button>`);
  } else {
    items.push(`<button data-act="report" class="danger">${icons.flag}${t('msg.report', 'إبلاغ')}</button>`);
  }
  menu.innerHTML = items.join('<hr>');

  backdrop.style.display = 'block';
  menu.style.display = 'block';
  // نموضعها بعد ما تُعرض عشان نعرف أبعادها الفعلية، ونخليها ما تطلع بره الشاشة
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - menuRect.width / 2), window.innerWidth - menuRect.width - 8);
  const top = Math.min(Math.max(8, y), window.innerHeight - menuRect.height - 8);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  menu.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.onclick = () => {
      closeMsgMenu();
      const act = btn.dataset.act;
      if (act === 'reply') setReply({ id: m.id, preview: (m.content || '').slice(0, 60) });
      else if (act === 'edit') startEdit(m.id, type);
      else if (act === 'delete') deleteMsg(m.id, type);
      else if (act === 'report') reportMsg(m.id, type, m);
    };
  });
}

document.getElementById('msgMenuBackdrop').onclick = closeMsgMenu;

/**
 * يربط ضغط مطوّل (باللمس، ~500ms) أو ضغطتين متتاليتين (بالماوس) بفقاعة
 * رسالة لفتح قائمة الخيارات (رد/تعديل/حذف/إبلاغ) كنافذة منبثقة قرب موضع
 * الضغط. الضغطة العادية (tap/click) القصيرة تبقى تفتح/تسكّر التفاعلات
 * السريعة تحت الرسالة (سلوك موجود أصلاً)، فما نبطّلها — بس نمنع فتح
 * القائمة المنبثقة بالخطأ أثناء سحب/تمرير عادي.
 */
function bindMsgContextTrigger(bubble, m, type) {
  let pressTimer = null;
  let longPressFired = false;
  let touchStart = null;

  bubble.addEventListener('touchstart', (e) => {
    longPressFired = false;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
    pressTimer = setTimeout(() => {
      longPressFired = true;
      openMsgMenu(m, type, t.clientX, t.clientY);
    }, 500);
  }, { passive: true });

  bubble.addEventListener('touchmove', (e) => {
    if (!touchStart) return;
    const t = e.touches[0];
    // لو تحرّك الإصبع أكتر من شوي، هذا سحب/تمرير عادي، مو ضغط مطوّل
    if (Math.abs(t.clientX - touchStart.x) > 10 || Math.abs(t.clientY - touchStart.y) > 10) {
      clearTimeout(pressTimer);
    }
  }, { passive: true });

  bubble.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
    // لو فتحنا القائمة بالضغط المطوّل، نمنع click العادي اللي بعده يسكّرها فورًا
    if (longPressFired) {
      const blockNextClick = (e) => { e.stopPropagation(); bubble.removeEventListener('click', blockNextClick, true); };
      bubble.addEventListener('click', blockNextClick, true);
    }
  });

  bubble.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    openMsgMenu(m, type, e.clientX, e.clientY);
  });
}


async function startEdit(id, type) {
  const newContent = prompt(t('prompts.edit_message', 'عدّل الرسالة:'));
  if (newContent === null || !newContent.trim()) return;
  try {
    if (type === 'dm') {
      await Api.put('/messages/' + id, { content: newContent.trim() });
      await refreshDM();
    } else {
      await Api.put(`/groups/${activeChat.id}/messages/${id}`, { content: newContent.trim() });
      await refreshGroup();
    }
  } catch (e) { showToast(e.message, true); }
}

async function deleteMsg(id, type) {
  if (!confirm('حذف هذه الرسالة؟')) return;
  try {
    if (type === 'dm') {
      await Api.del('/messages/' + id);
      await refreshDM();
    } else {
      await Api.del(`/groups/${activeChat.id}/messages/${id}`);
      await refreshGroup();
    }
  } catch (e) { showToast(e.message, true); }
}

async function onDeleteConversation() {
  if (!activeChat) return;
  if (!confirm(t('prompts.delete_conv_confirm', 'حذف المحادثة بالكامل؟ لا يمكن التراجع.'))) return;
  try {
    if (activeChat.type === 'dm') {
      await Api.del('/messages/' + encodeURIComponent(activeChat.username));
      loadConversations();
    } else {
      if (activeChat.myRole !== 'owner') { showToast('فقط مالك المجموعة يقدر يحذفها', true); return; }
      await Api.del('/groups/' + activeChat.id);
      loadGroups();
    }
    stopPolling();
    closeThread();
  } catch (e) { showToast(e.message, true); }
}

// ================= Typing indicator =================
function onTypingInput() {
  if (!activeChat) return;
  clearTimeout(typingSendTimer);
  Api.post('/typing', { chat_key: chatKey(), stop: false }).catch(() => {});
  typingSendTimer = setTimeout(stopTyping, 3000);
}
function stopTyping() {
  if (!activeChat) return;
  Api.post('/typing', { chat_key: chatKey(), stop: true }).catch(() => {});
}
function startTypingPolling() {
  typingPollTimer = setInterval(async () => {
    if (!activeChat) return;
    try {
      const { typing } = await Api.get('/typing/' + encodeURIComponent(chatKey()));
      const el = document.getElementById('typingEl');
      el.textContent = typing.length ? `${typing.map((t) => t.display_name || t.username).join('، ')} يكتب الآن...` : '';
    } catch { /* تجاهل */ }
  }, 1800);
}

// ================= Encryption toggle + PIN flow =================
async function onEncryptToggle(e) {
  const checked = e.target.checked;
  if (!checked) { encryptionEnabled = false; return; }

  try {
    const status = await MsgCrypto.getIdentityStatus();
    if (status.status === 'ready') { encryptionEnabled = true; return; }
    e.target.checked = false;
    openPinModal(status.status === 'needs_setup' ? 'setup' : 'unlock', status);
  } catch (err) {
    e.target.checked = false;
    showToast(err.message, true);
  }
}

let pinMode = 'setup';
function openPinModal(mode, status) {
  pinMode = mode;
  document.getElementById('pinTitle').textContent = mode === 'setup' ? 'إنشاء رمز PIN للتشفير' : 'إدخال رمز PIN لفتح التشفير';
  document.getElementById('pinDesc').textContent = mode === 'setup'
    ? 'اختر رمزاً من 6 أرقام. يُستخدم لحماية مفتاح التشفير الخاص بك، ولن يصل للسيرفر أبداً بصيغة قابلة للقراءة.'
    : 'أدخل رمز PIN الذي أنشأته سابقاً على هذا الحساب لاستعادة مفتاح التشفير.';
  document.getElementById('pinInput').value = '';
  document.getElementById('pinErr').textContent = status?.locked ? 'الحساب مقفل مؤقتاً بسبب محاولات خاطئة متكررة' : '';
  toggleModal('pinModal', true);
}

async function onPinConfirm() {
  const pin = document.getElementById('pinInput').value.trim();
  const errEl = document.getElementById('pinErr');
  errEl.textContent = '';
  try {
    if (pinMode === 'setup') {
      await MsgCrypto.setupPin(pin);
      showToast('تم تفعيل التشفير');
    } else {
      const ok = await MsgCrypto.unlockWithPin(pin);
      if (!ok) { errEl.textContent = 'رمز PIN غير صحيح'; return; }
      showToast('تم فتح التشفير');
    }
    encryptionEnabled = true;
    document.getElementById('encryptToggle').checked = true;
    toggleModal('pinModal', false);
  } catch (err) {
    errEl.textContent = err.locked ? 'تم القفل المؤقت، حاول لاحقاً' : err.message;
  }
}

// ================= Groups: create + members =================
async function createGroup() {
  const name = document.getElementById('groupNameInput').value.trim();
  const description = document.getElementById('groupDescInput').value.trim();
  const errEl = document.getElementById('groupErr');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'اسم المجموعة مطلوب'; return; }
  try {
    const group = await Api.post('/groups', { name, description });
    toggleModal('groupModal', false);
    document.getElementById('groupNameInput').value = '';
    document.getElementById('groupDescInput').value = '';
    await loadGroups();
    switchTab('groups');
    openGroup(group.id);
  } catch (e) { errEl.textContent = e.message; }
}

async function openMembersModal() {
  if (!activeChat || activeChat.type !== 'group') return;
  try {
    const group = await Api.get('/groups/' + activeChat.id);
    activeChat.members = group.members;
    activeChat.myRole = group.myRole;
    renderMembers(group.members);
    toggleModal('membersModal', true);
  } catch (e) { showToast(e.message, true); }
}

function renderMembers(members) {
  const canManage = ['owner', 'admin'].includes(activeChat.myRole);
  const kebabSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';

  document.getElementById('membersList').innerHTML = members.map((m) => `
    <div class="member-row" data-uid="${m.user_id}">
      <div class="avatar member-avatar" style="width:28px;height:28px;font-size:12px" data-username="${escapeHtml(m.username)}">${m.avatar ? `<img src="${escapeHtml(m.avatar)}">` : avatarInitial(m.display_name || m.username)}</div>
      <span class="member-name" data-username="${escapeHtml(m.username)}">${escapeHtml(m.nickname || m.display_name || m.username)}</span>
      <span class="member-role">${roleLabel(m.role)}</span>
      <button class="member-kebab" data-kebab="${m.user_id}" title="خيارات">${kebabSvg}</button>
    </div>
  `).join('');

  document.querySelectorAll('.member-avatar, .member-name').forEach((el) => {
    el.onclick = () => viewProfile(el.dataset.username);
  });

  document.querySelectorAll('[data-kebab]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const uid = Number(btn.dataset.kebab);
      const m = members.find((mm) => mm.user_id === uid);
      openMemberSubmenu(btn, m, canManage);
    };
  });
}

function openMemberSubmenu(anchorBtn, m, canManage) {
  document.querySelectorAll('.member-submenu').forEach((el) => el.remove());
  const isSelf = m.user_id === me.id;
  const isOwner = m.role === 'owner';
  const items = [];

  if (isSelf || canManage) {
    items.push(`<button data-sub="nick">${t('members.set_nickname', 'تعيين كنية')}</button>`);
  }
  if (canManage && !isOwner && !isSelf) {
    items.push(m.role === 'admin'
      ? `<button data-sub="demote">${t('members.demote', 'إزالة الإشراف')}</button>`
      : `<button data-sub="promote">${t('members.promote', 'تعيين كمشرف')}</button>`);
    items.push(`<button data-sub="kick" class="danger">${t('members.kick', 'طرد من المجموعة')}</button>`);
  }
  if (!items.length) return;

  const menu = document.createElement('div');
  menu.className = 'member-submenu';
  menu.innerHTML = items.join('');
  anchorBtn.closest('.member-row').appendChild(menu);

  menu.querySelectorAll('button[data-sub]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      menu.remove();
      if (b.dataset.sub === 'nick') await setGroupMemberNicknamePrompt(m);
      else if (b.dataset.sub === 'promote') await setGroupMemberRole(m.user_id, 'admin');
      else if (b.dataset.sub === 'demote') await setGroupMemberRole(m.user_id, 'member');
      else if (b.dataset.sub === 'kick') await removeMember(m.user_id);
    };
  });

  setTimeout(() => {
    document.addEventListener('click', function closeOnce() {
      menu.remove();
      document.removeEventListener('click', closeOnce);
    }, { once: true });
  }, 0);
}

async function setGroupMemberNicknamePrompt(m) {
  const nickname = prompt(t('prompts.group_nickname', 'كنية {name} (تظهر عند جميع أعضاء المجموعة):').replace('{name}', m.display_name || m.username), m.nickname || '');
  if (nickname === null) return;
  try {
    await Api.put(`/groups/${activeChat.id}/members/${m.user_id}/nickname`, { nickname: nickname.trim() });
    const group = await Api.get('/groups/' + activeChat.id);
    renderMembers(group.members);
  } catch (e) { showToast(e.message, true); }
}

async function setGroupMemberRole(userId, role) {
  try {
    await Api.put(`/groups/${activeChat.id}/members/${userId}/role`, { role });
    const group = await Api.get('/groups/' + activeChat.id);
    activeChat.myRole = group.myRole;
    renderMembers(group.members);
    showToast(role === 'admin' ? t('members.promote', 'تم تعيينه كمشرف') : t('members.demote', 'تم إزالة الإشراف'));
  } catch (e) { showToast(e.message, true); }
}
function roleLabel(r) { return { owner: t('members.owner', 'مالك'), admin: t('members.admin', 'مشرف'), member: t('members.member', 'عضو') }[r] || r; }

// ================= قائمة خيارات رأس المحادثة =================
function closeChatMenu() {
  document.getElementById('chatMenu').style.display = 'none';
  document.getElementById('chatMenuBackdrop').style.display = 'none';
}

function openChatMenu(e) {
  if (!activeChat) return;
  const icons = {
    nick: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    profile: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    block: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
    flag: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    media: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    delete: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    members: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    addMember: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>',
    link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  };

  const items = [];
  if (activeChat.type === 'dm') {
    items.push(`<button data-act="nick">${icons.nick}${t('menu.nickname', 'تعيين الكنية')}</button>`);
    items.push(`<button data-act="profile">${icons.profile}${t('menu.profile', 'عرض الملف الشخصي')}</button>`);
    items.push(`<button data-act="media">${icons.media}${t('menu.media', 'عرض الوسائط')}</button>`);
    items.push(`<button data-act="copylink">${icons.link}${t('menu.copy_link', 'نسخ رابط المحادثة')}</button>`);
    items.push('<hr>');
    items.push(`<button data-act="block" class="danger">${icons.block}${t('menu.block', 'حظر المستخدم')}</button>`);
    items.push(`<button data-act="report" class="danger">${icons.flag}${t('menu.report_conv', 'الإبلاغ عن المحادثة')}</button>`);
  } else {
    items.push(`<button data-act="members">${icons.members}${t('menu.members_nick', 'عرض الأعضاء وتعيين الكنيات')}</button>`);
    items.push(`<button data-act="addmember">${icons.addMember}${t('menu.add_member', 'إضافة عضو')}</button>`);
    items.push(`<button data-act="media">${icons.media}${t('menu.media', 'عرض الوسائط')}</button>`);
    items.push(`<button data-act="copylink">${icons.link}${t('menu.copy_link', 'نسخ رابط المحادثة')}</button>`);
    items.push('<hr>');
    items.push(`<button data-act="report" class="danger">${icons.flag}${t('menu.report_conv', 'الإبلاغ عن المحادثة')}</button>`);
    items.push(`<button data-act="delete" class="danger">${icons.delete}${t('menu.delete_conv', 'حذف المحادثة')}</button>`);
  }

  const menu = document.getElementById('chatMenu');
  const backdrop = document.getElementById('chatMenuBackdrop');
  menu.innerHTML = items.join('');
  backdrop.style.display = 'block';
  menu.style.display = 'block';

  const anchor = document.getElementById('threadTitleClickable').getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(anchor.left, window.innerWidth - menuRect.width - 8);
  const top = Math.min(anchor.bottom + 6, window.innerHeight - menuRect.height - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = top + 'px';

  menu.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.onclick = () => {
      closeChatMenu();
      const act = btn.dataset.act;
      if (act === 'nick') setDmNicknamePrompt();
      else if (act === 'profile') viewProfile(activeChat.username);
      else if (act === 'block') blockCurrentDmUser();
      else if (act === 'report') reportConversation();
      else if (act === 'media') openMediaGallery();
      else if (act === 'members') openMembersModal();
      else if (act === 'addmember') { openMembersModal().then(() => document.getElementById('addMemberInput')?.focus()); }
      else if (act === 'copylink') copyChatLink();
      else if (act === 'delete') onDeleteConversation();
    };
  });
}

function viewProfile(username) {
  window.open('https://hostaka.fun/profile?u=' + encodeURIComponent(username), '_blank');
}

async function setDmNicknamePrompt() {
  if (!activeChat || activeChat.type !== 'dm') return;
  try {
    const current = await Api.get('/messages/' + encodeURIComponent(activeChat.username) + '/nickname');
    const nickname = prompt(t('prompts.dm_nickname', 'الكنية (تظهر عندك وعند صديقك بهذه المحادثة):'), current.nickname || '');
    if (nickname === null) return;
    await Api.put('/messages/' + encodeURIComponent(activeChat.username) + '/nickname', { nickname: nickname.trim() });
    document.getElementById('threadName').textContent = nickname.trim() || activeChat.displayName;
    showToast(t('toast.nickname_updated', 'تم تحديث الكنية'));
  } catch (e) { showToast(e.message, true); }
}

async function blockCurrentDmUser() {
  if (!activeChat || activeChat.type !== 'dm') return;
  if (!confirm(t('prompts.block_confirm', 'حظر {name}؟ لن يقدر يراسلك بعدها.').replace('{name}', activeChat.displayName || activeChat.username))) return;
  try {
    await Api.post('/settings/block/' + encodeURIComponent(activeChat.username));
    showToast(t('toast.user_blocked', 'تم حظر المستخدم'));
  } catch (e) { showToast(e.message, true); }
}

async function reportConversation() {
  const reason = prompt(t('prompts.report_conv_reason', 'سبب الإبلاغ عن هذه المحادثة:'));
  if (reason === null || !reason.trim()) return;
  try {
    const payload = activeChat.type === 'dm'
      ? {
          target_id: activeChat.otherId || null,
          target_owner_username: activeChat.username,
          subject: `محادثة مع ${activeChat.displayName || activeChat.username}`,
          reason: reason.trim(),
        }
      : {
          target_id: activeChat.id,
          target_owner_username: null,
          subject: `مجموعة: ${activeChat.name}`,
          reason: reason.trim(),
        };
    await Api.post('/reports', payload);
    showToast('تم إرسال البلاغ، شكراً لك');
  } catch (e) { showToast(e.message, true); }
}

function openImageLightbox(url) {
  document.getElementById('lightboxImg').src = url;
  document.getElementById('imageLightbox').style.display = 'flex';
  document.getElementById('lightboxDownload').onclick = async (e) => {
    e.preventDefault();
    // الصور مستضافة على ImgBB (نطاق مختلف)، وسمة download بالرابط وحدها
    // ما تفرض التحميل الفعلي على روابط cross-origin (المتصفح يفتحها بس
    // بتبويب جديد). نجيب الصورة كـ blob ونحمّلها من رابط محلي مؤقت، وهذا
    // يفرض التحميل الحقيقي بغض النظر عن مصدر الصورة.
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'image-' + Date.now() + '.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    } catch {
      window.open(url, '_blank'); // فشل الجلب (مثلاً CORS)؟ نفتحها بتبويب جديد كحل بديل
    }
  };
}
function closeImageLightbox() {
  document.getElementById('imageLightbox').style.display = 'none';
  document.getElementById('lightboxImg').src = '';
}

async function openMediaGallery() {
  if (!activeChat) return;
  try {
    const media = activeChat.type === 'dm'
      ? await Api.get('/messages/' + encodeURIComponent(activeChat.username) + '/media')
      : await Api.get(`/groups/${activeChat.id}/media`);
    const grid = document.getElementById('mediaGrid');
    grid.innerHTML = media.length
      ? media.map((m) => `<img src="${escapeHtml(m.image)}" loading="lazy">`).join('')
      : `<div class="media-empty">${t('media.empty', 'ما فيه صور مشتركة بهذه المحادثة بعد')}</div>`;
    grid.querySelectorAll('img').forEach((img) => { img.onclick = () => openImageLightbox(img.src); });
    toggleModal('mediaModal', true);
  } catch (e) { showToast(e.message, true); }
}

async function addMemberToGroup() {
  const input = document.getElementById('addMemberInput');
  const username = input.value.trim();
  if (!username) return;
  try {
    await Api.post(`/groups/${activeChat.id}/members`, { username });
    input.value = '';
    const group = await Api.get('/groups/' + activeChat.id);
    renderMembers(group.members);
    document.getElementById('threadSub').textContent = `${group.members.length} ${t('members.count_suffix', 'أعضاء')}`;
  } catch (e) { showToast(e.message, true); }
}

async function removeMember(userId) {
  if (!confirm('إزالة هذا العضو من المجموعة؟')) return;
  try {
    await Api.del(`/groups/${activeChat.id}/members/${userId}`);
    const group = await Api.get('/groups/' + activeChat.id);
    renderMembers(group.members);
  } catch (e) { showToast(e.message, true); }
}
