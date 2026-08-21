/*
 * E2E encryption helper (Web Crypto API) for direct messages.
 *
 * Design:
 *  - Each ACCOUNT has exactly ONE P-256 ECDH keypair ("identity"), cached in
 *    this browser origin's IndexedDB. It is created once (first-ever setup)
 *    or restored from an encrypted PIN backup on any other device/origin —
 *    NEVER silently regenerated. Regenerating per-origin is what causes an
 *    account to end up with multiple different "identities" over time,
 *    which permanently breaks decryption of anything encrypted under an
 *    identity that's no longer reachable. Prevention, not a "fix", is the
 *    only real solution to that class of bug, so this module simply never
 *    takes the shortcut of auto-generating a fresh key when none is found
 *    locally — it throws and asks the caller to run PIN setup/unlock.
 *  - The public key is uploaded to the server so others can derive a shared
 *    secret with you. Public keys are not secret (that's the point of
 *    asymmetric crypto), so only login is required to fetch one.
 *  - Per conversation, both sides derive the SAME AES-256-GCM key via
 *    ECDH(myPrivateKey, theirPublicKey) + the browser's key derivation.
 *    This is a static shared key per pair (no forward secrecy/ratcheting
 *    like Signal — that needs a much larger key-management system). The
 *    server only ever sees ciphertext for encrypted messages.
 *  - Scope: 1:1 messages only. Group messages are not covered — group E2E
 *    needs per-member key wrapping and is a separate, larger feature.
 *
 * PIN-protected key backup:
 *  The private key is wrapped client-side with an AES-256-GCM key derived
 *  from a 6-digit PIN (PBKDF2-SHA256, 600k iterations, random per-user
 *  salt) and stored server-side as ciphertext only — the server never sees
 *  the PIN or the unwrapped key. A "verifier" (one-way tag of the derived
 *  key) lets the server confirm a PIN attempt before releasing the wrapped
 *  blob, and the server rate-limits/locks after repeated failures.
 *  Honest limit: a 6-digit PIN has only 1,000,000 possible values. The slow
 *  KDF + server-side lockout make online guessing impractical, but a full
 *  database compromise plus enough offline compute could still eventually
 *  brute-force one user's PIN. That's an inherent property of short PINs.
 *
 * Public API:
 *   MsgCrypto.ensureKeysRegistered()
 *   MsgCrypto.getSharedKeyFor(username)        -> CryptoKey | null
 *   MsgCrypto.encryptText(sharedKey, text)     -> { ciphertext, iv } (base64)
 *   MsgCrypto.decryptText(sharedKey, ciphertext, iv) -> string
 *   MsgCrypto.getIdentityStatus()              -> { status: 'ready'|'needs_setup'|'needs_unlock', locked?, lockedUntil? }
 *   MsgCrypto.setupPin(pin)                    -> true
 *   MsgCrypto.unlockWithPin(pin)               -> true | false (throws {locked} if rate-limited)
 */
(function () {
  if (window.MsgCrypto) return;

  const DB_NAME = 'msgsys_keys';
  const STORE = 'keypair';
  const KEY_ID = 'device';
  const PIN_KDF_ITERATIONS = 600000;

  const b64FromBuf = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const bufFromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
  const authToken = () => localStorage.getItem('msgsys_token') || '';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbGet(db, key) {
    return new Promise((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  function idbSet(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  let _identityPromise = null;
  async function getLocalIdentity() {
    if (_identityPromise) return _identityPromise;
    const db = await openDb();
    const existing = await idbGet(db, KEY_ID);
    if (existing?.publicKey && existing?.privateKey) {
      _identityPromise = Promise.resolve(existing);
      return existing;
    }
    return null;
  }
  const hasLocalIdentity = async () => !!(await getLocalIdentity());

  async function generateNewLocalIdentity() {
    const db = await openDb();
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const rec = { publicKey: pair.publicKey, privateKey: pair.privateKey };
    await idbSet(db, KEY_ID, rec);
    _identityPromise = Promise.resolve(rec);
    return rec;
  }

  async function storeRestoredIdentity(publicKey, privateKey) {
    const db = await openDb();
    const rec = { publicKey, privateKey };
    await idbSet(db, KEY_ID, rec);
    _identityPromise = Promise.resolve(rec);
    return rec;
  }

  async function requireLocalIdentity() {
    const id = await getLocalIdentity();
    if (!id) {
      const e = new Error('لا يوجد مفتاح تشفير محلي بعد — يلزم إعداد أو إدخال رمز PIN أولاً');
      e.needsIdentitySetup = true;
      throw e;
    }
    return id;
  }

  async function getMyPublicKeyBase64() {
    const kp = await requireLocalIdentity();
    return b64FromBuf(await crypto.subtle.exportKey('raw', kp.publicKey));
  }

  let _registered = false;
  async function ensureKeysRegistered() {
    if (_registered) return;
    try {
      const b64 = await getMyPublicKeyBase64();
      if (sessionStorage.getItem('msgsys_pubkey_registered') === b64) { _registered = true; return; }
      await fetch('/api/keys/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken() },
        body: JSON.stringify({ publicKey: b64 }),
      });
      sessionStorage.setItem('msgsys_pubkey_registered', b64);
      _registered = true;
    } catch (e) {
      if (!e.needsIdentitySetup) console.error('MsgCrypto: failed to register public key', e);
    }
  }

  let _peerKeyCache = {};
  async function getSharedKeyFor(username) {
    if (Object.prototype.hasOwnProperty.call(_peerKeyCache, username)) return _peerKeyCache[username];
    try {
      const res = await fetch('/api/keys/public/' + encodeURIComponent(username), {
        headers: { Authorization: 'Bearer ' + authToken() },
      });
      if (!res.ok) { _peerKeyCache[username] = null; return null; }
      const data = await res.json();
      if (!data.publicKey) { _peerKeyCache[username] = null; return null; }

      const kp = await requireLocalIdentity();
      const theirPublicKey = await crypto.subtle.importKey(
        'raw', bufFromB64(data.publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []
      );
      const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirPublicKey }, kp.privateKey,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      );
      _peerKeyCache[username] = sharedKey;
      return sharedKey;
    } catch (e) {
      if (!e.needsIdentitySetup) console.error('MsgCrypto: failed to derive shared key for', username, e);
      _peerKeyCache[username] = null;
      return null;
    }
  }

  async function encryptText(sharedKey, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, sharedKey, new TextEncoder().encode(text)
    );
    return { ciphertext: b64FromBuf(ciphertext), iv: b64FromBuf(iv.buffer) };
  }

  async function decryptText(sharedKey, ciphertextB64, ivB64) {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(bufFromB64(ivB64)) }, sharedKey, bufFromB64(ciphertextB64)
    );
    return new TextDecoder().decode(plainBuf);
  }

  // ================= PIN-protected identity backup =================

  async function deriveKeyFromPin(pin, saltB64, iterations) {
    const salt = new Uint8Array(bufFromB64(saltB64));
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
  }

  function concatBuf(a, b) {
    const au = new Uint8Array(a), bu = new Uint8Array(b);
    const out = new Uint8Array(au.length + bu.length);
    out.set(au, 0); out.set(bu, au.length);
    return out.buffer;
  }

  async function computeVerifier(aesKey) {
    const raw = await crypto.subtle.exportKey('raw', aesKey);
    const tag = await crypto.subtle.digest('SHA-256', concatBuf(raw, new TextEncoder().encode('msgsys-pin-verify-v1')));
    return b64FromBuf(tag);
  }

  function assertValidPin(pin) {
    if (!/^\d{6}$/.test(String(pin || ''))) throw new Error('رمز PIN يجب أن يتكوّن من 6 أرقام بالضبط');
  }

  async function pinStatus() {
    const res = await fetch('/api/keys/backup/status', { headers: { Authorization: 'Bearer ' + authToken() } });
    if (!res.ok) return { hasBackup: false };
    return res.json();
  }

  async function setupPin(pin) {
    assertValidPin(pin);
    const kp = (await getLocalIdentity()) || (await generateNewLocalIdentity());

    const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
    const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
    const bundle = JSON.stringify({ priv: b64FromBuf(pkcs8), pub: b64FromBuf(pubRaw) });

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const aesKey = await deriveKeyFromPin(pin, b64FromBuf(salt.buffer), PIN_KDF_ITERATIONS);
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(bundle));
    const verifier = await computeVerifier(aesKey);

    const res = await fetch('/api/keys/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken() },
      body: JSON.stringify({
        salt: b64FromBuf(salt.buffer), iv: b64FromBuf(iv.buffer),
        wrappedKey: b64FromBuf(wrapped), iterations: PIN_KDF_ITERATIONS, verifier,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'تعذر حفظ رمز PIN على السيرفر');
    }

    _registered = false;
    sessionStorage.removeItem('msgsys_pubkey_registered');
    await ensureKeysRegistered();
    return true;
  }

  async function unlockWithPin(pin) {
    assertValidPin(pin);
    const status = await pinStatus();
    if (!status?.hasBackup) {
      const e = new Error('لا يوجد نسخة احتياطية محفوظة بهذا الحساب بعد');
      e.noBackup = true;
      throw e;
    }
    if (status.locked) {
      const e = new Error('تم تجاوز عدد المحاولات المسموحة، حاول لاحقاً');
      e.locked = true;
      e.lockedUntil = status.lockedUntil || null;
      throw e;
    }

    const aesKey = await deriveKeyFromPin(pin, status.salt, status.iterations);
    const verifier = await computeVerifier(aesKey);

    const res = await fetch('/api/keys/backup/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken() },
      body: JSON.stringify({ verifier }),
    });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const e = new Error(data.error || 'تم تجاوز عدد المحاولات المسموحة، حاول لاحقاً');
      e.locked = true;
      e.lockedUntil = data.lockedUntil || null;
      throw e;
    }
    if (res.status === 401) return false;
    if (!res.ok) throw new Error('تعذر التحقق من رمز PIN، حاول لاحقاً');

    const data = await res.json(); // { wrappedKey, iv }
    let plainBuf;
    try {
      plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(bufFromB64(data.iv)) }, aesKey, bufFromB64(data.wrappedKey)
      );
    } catch {
      throw new Error('تعذّرت استعادة المفتاح — البيانات المخزّنة تالفة، يلزم إعادة إعداد PIN جديد');
    }

    const bundle = JSON.parse(new TextDecoder().decode(plainBuf));
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', bufFromB64(bundle.priv), { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
    );
    const publicKey = await crypto.subtle.importKey(
      'raw', bufFromB64(bundle.pub), { name: 'ECDH', namedCurve: 'P-256' }, true, []
    );
    await storeRestoredIdentity(publicKey, privateKey);

    _peerKeyCache = {};
    _registered = false;
    sessionStorage.removeItem('msgsys_pubkey_registered');
    await ensureKeysRegistered();
    return true;
  }

  async function getIdentityStatus() {
    if (await hasLocalIdentity()) return { status: 'ready' };
    const ps = await pinStatus();
    if (ps?.hasBackup) return { status: 'needs_unlock', locked: !!ps.locked, lockedUntil: ps.lockedUntil || null };
    return { status: 'needs_setup' };
  }

  window.MsgCrypto = {
    getMyPublicKeyBase64, ensureKeysRegistered, getSharedKeyFor, encryptText, decryptText,
    hasLocalIdentity, getIdentityStatus, setupPin, unlockWithPin,
  };
})();
