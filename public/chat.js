let me = requireAuthPage(); // تحقق أولي سريع (وجود كوكي الجلسة) قبل تأكيد فعلي من السيرفر
if (me) {
  initSession().then((confirmed) => {
    if (!confirmed) return; // initSession يحوّل تلقائياً لدخول Hostaka لو الجلسة غير صالحة
    me = confirmed;
    init();
  });
}

let activeChat = null; // {type:'dm', username, displayName, otherId} | {type:'group', id, name, myRole}
let pollTimer = null;
let typingPollTimer = null;
let typingSendTimer = null;
let replyTo = null;
let encryptionEnabled = false;

function init() {
  document.getElementById('meBox').innerHTML =
    `<div class="avatar">${avatarInitial(me.display_name || me.username)}</div><span>${escapeHtml(me.display_name || me.username)}</span>`;

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
  document.getElementById('backToListBtn').onclick = () => {
    stopPolling();
    activeChat = null;
    document.getElementById('threadView').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.querySelector('.app').classList.remove('chat-open');
  };
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

  document.getElementById('encryptToggle').addEventListener('change', onEncryptToggle);
  document.getElementById('pinCancel').onclick = () => toggleModal('pinModal', false);
  document.getElementById('pinConfirm').onclick = onPinConfirm;

  loadConversations();
  loadGroups();
  MsgCrypto.ensureKeysRegistered().catch(() => {});
}

function avatarInitial(name) { return escapeHtml((name || '?').trim().charAt(0).toUpperCase()); }
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
    if (!convs.length) { list.innerHTML = '<div class="empty-list">لا محادثات بعد</div>'; return; }
    list.innerHTML = convs.map((c) => `
      <div class="conv-item" data-username="${escapeHtml(c.username)}" data-otherid="${c.id}">
        <div class="avatar">${c.avatar ? `<img src="${escapeHtml(c.avatar)}">` : avatarInitial(c.display_name || c.username)}</div>
        <div class="conv-meta">
          <div class="conv-name">${escapeHtml(c.display_name || c.username)}</div>
          <div class="conv-last">${c.last_image && !c.last_content ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> صورة` : escapeHtml(c.last_content || '')}</div>
        </div>
        ${c.unread ? `<span class="conv-unread">${c.unread}</span>` : ''}
      </div>
    `).join('');
    list.querySelectorAll('.conv-item').forEach((el) => {
      el.onclick = () => openDM(el.dataset.username, Number(el.dataset.otherid));
    });
  } catch (e) {
    list.innerHTML = '<div class="empty-list">تعذر تحميل المحادثات</div>';
  }
}

async function loadGroups() {
  const list = document.getElementById('groupList');
  try {
    const groups = await Api.get('/groups');
    if (!groups.length) { list.innerHTML = '<div class="empty-list">لا مجموعات بعد</div>'; return; }
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
    list.innerHTML = '<div class="empty-list">تعذر تحميل المجموعات</div>';
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
  activeChat = { type: 'dm', username, otherId, displayName: username };
  highlightActive('.conv-item', (el) => el.dataset.username === username);

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('threadView').style.display = 'flex';
  document.querySelector('.app').classList.add('chat-open');
  document.getElementById('encryptToggleWrap').style.display = 'flex';
  document.getElementById('groupMembersBtn').style.display = 'none';
  document.getElementById('threadAvatar').innerHTML = avatarInitial(username);
  document.getElementById('threadName').textContent = username;
  document.getElementById('threadSub').textContent = 'محادثة خاصة';
  setReply(null);

  try {
    const profile = await Api.get('/users/' + encodeURIComponent(username));
    activeChat.otherId = profile.id;
    activeChat.displayName = profile.display_name || profile.username;
    document.getElementById('threadName').textContent = activeChat.displayName;
  } catch { /* تجاهل، خلي الاسم كما هو */ }

  await refreshDM();
  startPolling(refreshDM, 2500);
  startTypingPolling();
}

async function openGroup(id) {
  stopPolling();
  try {
    const group = await Api.get('/groups/' + id);
    activeChat = { type: 'group', id, name: group.name, myRole: group.myRole, members: group.members };

    highlightActive('.group-item', (el) => Number(el.dataset.id) === id);
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('threadView').style.display = 'flex';
    document.querySelector('.app').classList.add('chat-open');
    document.getElementById('encryptToggleWrap').style.display = 'none';
    document.getElementById('groupMembersBtn').style.display = 'inline-block';
    document.getElementById('threadAvatar').innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    document.getElementById('threadName').textContent = group.name;
    document.getElementById('threadSub').textContent = `${group.members.length} أعضاء`;
    setReply(null);

    await refreshGroup();
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
async function refreshDM() {
  if (!activeChat || activeChat.type !== 'dm') return;
  try {
    const msgs = await Api.get('/messages/' + encodeURIComponent(activeChat.username));
    await renderMessages(msgs, 'dm');
    loadConversations();
  } catch (e) { /* تجاهل أخطاء الاستطلاع الدوري */ }
}

async function refreshGroup() {
  if (!activeChat || activeChat.type !== 'group') return;
  try {
    const msgs = await Api.get(`/groups/${activeChat.id}/messages`);
    await renderMessages(msgs, 'group');
  } catch (e) { /* تجاهل */ }
}

async function renderMessages(msgs, type) {
  const el = document.getElementById('messagesEl');
  const wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;

  const rendered = await Promise.all(msgs.map((m) => renderOneMessage(m, type)));
  el.innerHTML = rendered.join('');

  await applyReactionCounts(msgs.map((m) => m.id), type);

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

  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

async function decryptIfNeeded(m) {
  if (!m.encrypted) return m.content;
  try {
    const key = await MsgCrypto.getSharedKeyFor(activeChat.username);
    // ما نقدر نجيب مفتاح مشترك: إما هذا الجهاز يحتاج استعادة الهوية عبر
    // PIN (فيه نسخة احتياطية على السيرفر ما استُعيدت هون بعد)، أو الطرف
    // الآخر نفسه بنفس الحالة. هذا لا يعني أي طرف "غير مفعّل للتشفير" —
    // التشفير شغّال دايمًا لكل الحسابات — بس نعرض نص توعوي بدل قفل مبهم.
    if (!key) return 'الرسائل مشفرة بين الطرفين، يرجى التأكد من PIN';
    return await MsgCrypto.decryptText(key, m.content, m.iv);
  } catch {
    return '🔒 تعذر فك تشفير هذه الرسالة';
  }
}

async function renderOneMessage(m, type) {
  const mine = type === 'group' ? m.user_id === me.id : m.from_id === me.id;
  const senderName = type === 'group' ? m.from_name : (mine ? '' : activeChat.displayName);
  const rawContent = type === 'dm' ? await decryptIfNeeded(m) : m.content;
  const content = window.EmojiFluent ? EmojiFluent.render(escapeHtml(rawContent)) : escapeHtml(rawContent);
  const reactions = groupReactions(m._reactions || []);

  return `
    <div class="msg-row ${mine ? 'mine' : 'theirs'}" data-msgid="${m.id}">
      ${type === 'group' && !mine ? `<div class="conv-last" style="margin-bottom:2px">${escapeHtml(senderName)}</div>` : ''}
      <div class="msg-bubble">
        ${content}
        ${m.image ? `<img src="${escapeHtml(m.image)}">` : ''}
      </div>
      <div class="msg-meta">
        ${timeAgo(m.created_at)} ${m.edited ? '· مُعدّلة' : ''}
      </div>
      <div class="msg-reactions" data-reactions-for="${m.id}">
        ${['heart', 'like', '😂', '😮'].map((emoji) => `<span class="msg-reaction" data-react data-id="${m.id}" data-emoji="${emoji}">${emojiIcon(emoji)}</span>`).join('')}
      </div>
      <div class="msg-actions">
        <button data-reply data-id="${m.id}" data-preview="${escapeHtml((m.content || '').slice(0, 60))}">رد</button>
        ${mine ? `<button data-edit data-id="${m.id}">تعديل</button><button data-delete data-id="${m.id}">حذف</button>` : ''}
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
    showToast('الملف المختار ليس صورة', true);
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

async function startEdit(id, type) {
  const newContent = prompt('عدّل الرسالة:');
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
  if (!confirm('حذف المحادثة بالكامل؟ لا يمكن التراجع.')) return;
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
    activeChat = null;
    document.getElementById('threadView').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.querySelector('.app').classList.remove('chat-open');
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
  document.getElementById('membersList').innerHTML = members.map((m) => `
    <div class="member-row">
      <div class="avatar" style="width:28px;height:28px;font-size:12px">${avatarInitial(m.display_name || m.username)}</div>
      <span>${escapeHtml(m.nickname || m.display_name || m.username)}</span>
      <span class="member-role">${roleLabel(m.role)}</span>
      ${canManage && m.role !== 'owner' && m.user_id !== me.id
        ? `<button class="icon-btn" data-remove="${m.user_id}" title="إزالة">✕</button>` : ''}
    </div>
  `).join('');
  document.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.onclick = () => removeMember(Number(btn.dataset.remove));
  });
}
function roleLabel(r) { return { owner: 'مالك', admin: 'مشرف', member: 'عضو' }[r] || r; }

async function addMemberToGroup() {
  const input = document.getElementById('addMemberInput');
  const username = input.value.trim();
  if (!username) return;
  try {
    await Api.post(`/groups/${activeChat.id}/members`, { username });
    input.value = '';
    const group = await Api.get('/groups/' + activeChat.id);
    renderMembers(group.members);
    document.getElementById('threadSub').textContent = `${group.members.length} أعضاء`;
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
