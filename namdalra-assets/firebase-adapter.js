// Firebase modular browser SDK version verified against firebase.google.com/docs/web/setup.
// This file contains no administrator password, private key, or privileged credential.
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, setPersistence, browserSessionPersistence, onAuthStateChanged, getIdTokenResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, deleteUser,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, doc, collection, getDocFromServer, getDocsFromServer,
  setDoc, updateDoc, serverTimestamp, runTransaction, query, orderBy, limit, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const GRADES = new Set(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3']);
const LEVELS = new Set(['sprout', 'leaf', 'tree', 'forest']);
const CATEGORIES = new Set(['everyday', 'school', 'nature', 'people', 'world']);
const MEMBER_FIELDS = new Set(['name', 'phone', 'address', 'school', 'grade', 'status']);
const AUTH_MUTATIONS = new Set(['/api/login', '/api/register', '/api/logout', '/api/change-password']);
const LOGIN_HISTORY_LIMIT = 30;
const MAX_BOOKS = 200;
const MAX_BOOK_WORDS = 1000;
const MAX_ASSIGNED_BOOKS = 20;
const MAX_DOCUMENT_BYTES = 750 * 1024;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validBookId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validWordId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);

function apiError(status, message) { return Object.assign(new Error(message), { status }); }
function fail(status, message) { throw apiError(status, message); }
function levelForGrade(grade) {
  if (['e5', 'e6'].includes(grade)) return 'leaf';
  if (grade === 'm1') return 'tree';
  if (['m2', 'm3'].includes(grade)) return 'forest';
  return 'sprout';
}
function textField(value, label, min, max) {
  if (typeof value !== 'string') fail(400, `${label}을(를) 입력해 주세요.`);
  const text = value.trim();
  if (text.length < min || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) fail(400, `${label}은(는) ${min}~${max}자로 입력해 주세요.`);
  return text;
}
function emailField(value) {
  const email = textField(value, '이메일', 5, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, '이메일 주소를 확인해 주세요.');
  return email;
}
function passwordField(value, label = '비밀번호') {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, `${label}는 8~128자로 입력해 주세요.`);
  return value;
}
function profileFields(body, partial = false) {
  if (!plainObject(body)) fail(400, '회원 정보 형식을 확인해 주세요.');
  const fields = {};
  for (const [key, label, min, max] of [['name', '이름', 2, 50], ['address', '주소', 5, 200], ['school', '학교', 2, 100]]) {
    if (!partial || Object.hasOwn(body, key)) fields[key] = textField(body[key], label, min, max);
  }
  if (!partial || Object.hasOwn(body, 'phone')) {
    if (typeof body.phone !== 'string' || !/^[0-9+()\s-]+$/.test(body.phone)) fail(400, '연락처를 숫자로 입력해 주세요.');
    fields.phone = body.phone.replace(/[^0-9]/g, '');
    if (!/^[0-9]{9,15}$/.test(fields.phone)) fail(400, '연락처는 9~15자리 숫자로 입력해 주세요.');
  }
  if (!partial || Object.hasOwn(body, 'grade')) {
    if (!GRADES.has(body.grade)) fail(400, '학년을 선택해 주세요.');
    fields.grade = body.grade;
  }
  if (!partial) fields.email = emailField(body.email);
  if (partial && Object.hasOwn(body, 'status')) {
    if (!['active', 'suspended'].includes(body.status)) fail(400, '회원 상태를 확인해 주세요.');
    fields.status = body.status;
  }
  return fields;
}
function timestampText(value) {
  try {
    const date = typeof value?.toDate === 'function' ? value.toDate() : typeof value === 'string' ? new Date(value) : null;
    return date && Number.isFinite(date.valueOf()) ? date.toISOString() : '';
  } catch { return ''; }
}
function boundedText(value, label, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') fail(400, `${label} 형식을 확인해 주세요.`);
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail(400, `${label}은(는) ${required ? '1' : '0'}~${max}자로 입력해 주세요.`);
  return text;
}
function requireByteLimit(value, message) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_DOCUMENT_BYTES) fail(413, message);
}
function bookWord(raw) {
  if (!plainObject(raw) || !validWordId(raw.id)) fail(400, '단어 ID 형식을 확인해 주세요.');
  const word = { id: raw.id };
  for (const [key, label, max] of [['en', '영어 단어', 120], ['ko', '한글 뜻', 300], ['pos', '품사', 40], ['emoji', '그림', 16], ['example', '예문', 500], ['translation', '예문 해석', 500]]) word[key] = boundedText(raw[key], label, max, key === 'en');
  return word;
}
function bookFields(raw) {
  if (!plainObject(raw) || !Array.isArray(raw.words) || raw.words.length < 1 || raw.words.length > MAX_BOOK_WORDS) fail(400, `단어장은 1~${MAX_BOOK_WORDS}개 단어로 저장해 주세요.`);
  const words = raw.words.map(bookWord);
  if (new Set(words.map(word => word.id)).size !== words.length) fail(400, '단어장 안의 단어 ID가 중복되었어요. 다시 불러와 주세요.');
  const fields = { title: boundedText(raw.title, '단어장 이름', 120, true), description: boundedText(raw.description, '설명', 2000), sourceName: boundedText(raw.sourceName, '원본 파일 이름', 200), words, wordCount: words.length };
  requireByteLimit(fields, '단어장 크기는 750KiB 이하여야 해요. 단어장을 나눠 주세요.');
  return fields;
}
function publicBook(id, data, full = false) {
  const source = plainObject(data) ? data : {};
  const seen = new Set();
  const words = (Array.isArray(source.words) ? source.words : []).slice(0, MAX_BOOK_WORDS).flatMap(raw => {
    try {
      const word = bookWord(raw);
      if (seen.has(word.id)) return [];
      seen.add(word.id);
      return [word];
    } catch { return []; }
  });
  const text = (key, max) => typeof source[key] === 'string' ? source[key].slice(0, max) : '';
  return { id, title: text('title', 120), description: text('description', 2000), sourceName: text('sourceName', 200), wordCount: words.length, revision: Number.isSafeInteger(source.revision) && source.revision > 0 ? source.revision : 0, createdAt: timestampText(source.createdAt), updatedAt: timestampText(source.updatedAt), ...(full ? { words } : {}) };
}
function publicAssignment(data) {
  const source = plainObject(data) ? data : {};
  return { bookIds: [...new Set((Array.isArray(source.bookIds) ? source.bookIds : []).filter(validBookId))].slice(0, MAX_ASSIGNED_BOOKS), revision: Number.isSafeInteger(source.revision) && source.revision > 0 ? source.revision : 0 };
}
function usableBook(data, book) {
  return Array.isArray(data?.words) && book.wordCount > 0 && book.wordCount === data.words.length && book.wordCount === data.wordCount && book.revision > 0 && Boolean(book.title.trim());
}
function assignmentFields(raw) {
  if (!plainObject(raw) || !Array.isArray(raw.bookIds) || raw.bookIds.length > MAX_ASSIGNED_BOOKS || raw.bookIds.some(id => !validBookId(id)) || new Set(raw.bookIds).size !== raw.bookIds.length) fail(400, '배정할 단어장은 중복 없이 최대 20개까지 선택해 주세요.');
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) fail(400, '배정 정보를 새로고침한 뒤 다시 저장해 주세요.');
  return { bookIds: [...raw.bookIds], revision: raw.revision };
}
function requireWordCapacity(raw) {
  if (plainObject(raw?.words) && Object.keys(raw.words).length > MAX_BOOK_WORDS) fail(413, '보관할 단어 기록이 1,000개를 초과했어요. 기존 기록은 그대로 유지됩니다. 관리자에게 문의해 주세요.');
  if (plainObject(raw?.days)) {
    if (Object.keys(raw.days).length > 730 || Object.values(raw.days).some(ids => Array.isArray(ids) && new Set(ids.filter(validWordId)).size > MAX_BOOK_WORDS)) fail(413, '날짜별 학습 기록의 보관 한도를 초과했어요. 기존 기록은 그대로 유지됩니다. 관리자에게 문의해 주세요.');
  }
}
function publicUser(id, profile, isAdmin = false, authUser = null) {
  const data = plainObject(profile) ? profile : {};
  const string = key => typeof data[key] === 'string' ? data[key] : '';
  const level = levelForGrade(data.grade);
  return {
    id, name: string('name') || (isAdmin ? '남달라 관리자' : ''), phone: string('phone'),
    address: string('address'), school: string('school'), grade: GRADES.has(data.grade) ? data.grade : '',
    email: string('email') || authUser?.email || '', role: isAdmin ? 'admin' : 'member',
    status: isAdmin ? 'active' : data.status === 'active' ? 'active' : 'suspended', mustChangePassword: false,
    createdAt: timestampText(data.createdAt), updatedAt: timestampText(data.updatedAt),
    level, recommendedLevel: level,
  };
}
function accountFromSnapshots(authUser, profileSnapshot, adminSnapshot) {
  const isAdmin = adminSnapshot.exists() && adminSnapshot.data().enabled === true;
  const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
  if (!profile && !isAdmin) fail(403, '회원 정보가 없어요. 관리자에게 계정 확인을 요청해 주세요.');
  if (!isAdmin && profile.status !== 'active') fail(403, '사용이 정지된 계정이에요. 관리자에게 문의해 주세요.');
  if (!isAdmin && !GRADES.has(profile.grade)) fail(403, '학년 정보가 올바르지 않아요. 관리자에게 문의해 주세요.');
  return publicUser(authUser.uid, profile, isAdmin, authUser);
}
function normalizeError(error) {
  if (Number.isInteger(error?.status)) return error;
  const messages = {
    'auth/invalid-credential': [401, '이메일 또는 비밀번호를 확인해 주세요.'],
    'auth/invalid-login-credentials': [401, '이메일 또는 비밀번호를 확인해 주세요.'],
    'auth/wrong-password': [401, '이메일 또는 비밀번호를 확인해 주세요.'],
    'auth/user-not-found': [401, '이메일 또는 비밀번호를 확인해 주세요.'],
    'auth/invalid-email': [400, '이메일 주소를 확인해 주세요.'],
    'auth/email-already-in-use': [409, '이미 가입된 이메일이에요. 로그인해 주세요.'],
    'auth/weak-password': [400, '비밀번호가 너무 쉬워요. 8자 이상으로 다시 정해 주세요.'],
    'auth/password-does-not-meet-requirements': [400, '비밀번호 보안 조건을 확인해 주세요.'],
    'auth/too-many-requests': [429, '시도 횟수가 많아요. 잠시 후 다시 시도해 주세요.'],
    'auth/user-disabled': [403, '사용이 정지된 계정이에요. 관리자에게 문의해 주세요.'],
    'auth/requires-recent-login': [401, '안전한 변경을 위해 다시 로그인해 주세요.'],
    'auth/user-token-expired': [401, '로그인이 만료되었어요. 다시 로그인해 주세요.'],
    'auth/network-request-failed': [503, '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'],
    'auth/operation-not-allowed': [503, '관리자가 Firebase에서 이메일·비밀번호 로그인을 켜야 해요.'],
    'auth/unauthorized-domain': [503, '관리자가 Firebase 승인 도메인에 현재 웹사이트를 추가해야 해요.'],
    'auth/invalid-api-key': [503, 'Firebase 연결 설정을 확인해 주세요.'],
    'auth/configuration-not-found': [503, 'Firebase Authentication 설정을 확인해 주세요.'],
    'permission-denied': [403, '접근 권한이 없거나 계정이 정지되었어요. 관리자에게 문의해 주세요.'],
    'unauthenticated': [401, '로그인이 만료되었어요. 다시 로그인해 주세요.'],
    'unavailable': [503, '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'],
    'resource-exhausted': [429, '현재 사용량이 많아요. 잠시 후 다시 시도해 주세요.'],
    'failed-precondition': [503, '관리자가 Firebase 데이터베이스 설정을 확인해야 해요.'],
  };
  const [status, message] = messages[error?.code] || [500, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'];
  return apiError(status, message);
}
function sanitizeProgress(raw, account) {
  if (!plainObject(raw)) fail(400, '학습 기록 형식이 올바르지 않아요.');
  const progress = {
    words: {}, days: {}, gameBest: {},
    level: account.role === 'admin' && LEVELS.has(raw.level) ? raw.level : levelForGrade(account.grade),
    category: CATEGORIES.has(raw.category) ? raw.category : 'everyday',
  };
  const validId = validWordId;
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1000000, Math.floor(Number(value)))) : 0;
  if (plainObject(raw.words)) for (const [id, value] of Object.entries(raw.words).slice(0, 1000)) {
    if (!validId(id) || !plainObject(value)) continue;
    progress.words[id] = {
      known: value.known === true, wrong: value.wrong === true, starred: value.starred === true,
      mistakes: count(value.mistakes), attempts: count(value.attempts),
      updatedAt: Number.isFinite(Number(value.updatedAt)) ? Math.max(0, Math.min(Date.now() + 60000, Math.floor(Number(value.updatedAt)))) : 0,
    };
  }
  if (plainObject(raw.days)) for (const [day, ids] of Object.entries(raw.days).sort().slice(-730)) {
    const date = new Date(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== day || !Array.isArray(ids)) continue;
    progress.days[day] = [...new Set(ids.filter(validId))].slice(0, 1000);
  }
  for (const speed of ['easy', 'normal', 'fast']) progress.gameBest[speed] = Math.min(100000, count(raw.gameBest?.[speed]));
  return progress;
}
function mergeProgress(stored, incoming, account) {
  requireWordCapacity(stored);
  requireWordCapacity(incoming);
  const previous = sanitizeProgress(plainObject(stored) ? stored : {}, account);
  const next = sanitizeProgress(incoming, account);
  const merged = { ...next, words: { ...previous.words }, days: { ...previous.days }, gameBest: { ...previous.gameBest } };
  for (const [id, word] of Object.entries(next.words)) if (!merged.words[id] || word.updatedAt >= merged.words[id].updatedAt) merged.words[id] = word;
  for (const [day, ids] of Object.entries(next.days)) merged.days[day] = [...new Set([...(merged.days[day] || []), ...ids])];
  for (const speed of ['easy', 'normal', 'fast']) merged.gameBest[speed] = Math.max(merged.gameBest[speed], next.gameBest[speed]);
  requireWordCapacity(merged);
  const result = sanitizeProgress(merged, account);
  requireByteLimit(result, '학습 기록 크기가 750KiB를 초과했어요. 기존 기록은 그대로 유지됩니다. 관리자에게 문의해 주세요.');
  return result;
}

export function createFirebaseAdapter(config) {
  if (!plainObject(config) || !config.apiKey || !config.authDomain || !config.projectId || !config.appId) fail(503, '관리자가 Firebase 웹 앱 연결 설정을 입력해야 해요.');
  const appName = `namdalra-${config.projectId}`;
  const app = getApps().find(candidate => candidate.name === appName) || initializeApp({
    apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId,
    appId: config.appId, ...(config.messagingSenderId ? { messagingSenderId: config.messagingSenderId } : {}),
  }, appName);
  const auth = getAuth(app);
  const db = getFirestore(app);
  auth.languageCode = 'ko';
  const ready = (async () => { await setPersistence(auth, browserSessionPersistence); await auth.authStateReady(); })();
  ready.catch(() => {});
  let activeAccount = null;
  let accountSignature = '';
  let intentionalAuth = 0;
  let intentionalBaseline = null;
  let pendingAccountChange = null;
  let disposed = false;
  let watchEpoch = 0;
  let watches = [];
  const memberRef = uid => doc(db, 'namdalraMembers', uid);
  const adminRef = uid => doc(db, 'namdalraAdmins', uid);
  const progressRef = (uid, bookId = null) => bookId ? doc(db, 'namdalraProgress', uid, 'books', bookId) : doc(db, 'namdalraProgress', uid);
  const bookCollection = collection(db, 'namdalraBooks');
  const bookRef = id => doc(bookCollection, id);
  const assignmentRef = uid => doc(db, 'namdalraAssignments', uid);
  const loginCollection = uid => collection(db, 'namdalraMembers', uid, 'logins');
  function ensureIdentity(firebaseUser) {
    if (!firebaseUser || auth.currentUser?.uid !== firebaseUser.uid) fail(401, '접속 계정이 변경되었어요. 다시 로그인해 주세요.');
  }
  function signature(user) { return JSON.stringify(user); }
  function acceptAccount(user) { activeAccount = user; accountSignature = signature(user); return { user, csrfToken: '' }; }
  function notifyAccount(user, reason, force = false) {
    if (disposed) return;
    if (intentionalAuth) {
      if (intentionalBaseline && ['profile-changed', 'account-unavailable'].includes(reason)) {
        pendingAccountChange = signature(user) === intentionalBaseline.signature ? null
          : { user, reason, uid: intentionalBaseline.id, epoch: watchEpoch };
      }
      return;
    }
    if (!activeAccount || (!force && signature(user) === accountSignature)) return;
    activeAccount = user;
    accountSignature = signature(user);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('namdalra-account-changed', { detail: { user, reason } }));
  }
  function attachWatches(firebaseUser) {
    const epoch = ++watchEpoch;
    for (const unsubscribe of watches) unsubscribe();
    watches = [];
    if (!firebaseUser) { notifyAccount(null, 'signed-out'); return; }
    if (activeAccount && activeAccount.id !== firebaseUser.uid) notifyAccount(null, 'account-switched');
    let profileSnapshot = null; let adminSnapshot = null;
    const changed = () => {
      if (disposed || epoch !== watchEpoch || !profileSnapshot || !adminSnapshot) return;
      try { notifyAccount(accountFromSnapshots(firebaseUser, profileSnapshot, adminSnapshot), 'profile-changed'); }
      catch { notifyAccount(null, 'account-unavailable'); }
    };
    const listenerError = error => {
      if (epoch === watchEpoch && ['permission-denied', 'unauthenticated'].includes(error.code)) notifyAccount(null, 'account-unavailable');
    };
    watches.push(onSnapshot(memberRef(firebaseUser.uid), snapshot => { profileSnapshot = snapshot; changed(); }, listenerError));
    watches.push(onSnapshot(adminRef(firebaseUser.uid), snapshot => { adminSnapshot = snapshot; changed(); }, listenerError));
  }
  const unsubscribeAuth = onAuthStateChanged(auth, attachWatches);
  async function loadAccount(firebaseUser) {
    const [profile, admin] = await Promise.all([getDocFromServer(memberRef(firebaseUser.uid)), getDocFromServer(adminRef(firebaseUser.uid))]);
    if (auth.currentUser?.uid !== firebaseUser.uid) fail(401, '접속 계정이 변경되었어요. 다시 로그인해 주세요.');
    return accountFromSnapshots(firebaseUser, profile, admin);
  }
  async function requireAccount(admin = false) {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) fail(401, '로그인이 필요해요. 다시 로그인해 주세요.');
    const account = await loadAccount(firebaseUser);
    if (admin && account.role !== 'admin') fail(403, '관리자만 사용할 수 있어요.');
    return { firebaseUser, account };
  }
  async function recordSuccessfulLogin(firebaseUser, account, kind) {
    if (account.role !== 'member') return;
    try {
      const { claims } = await getIdTokenResult(firebaseUser);
      const authTime = claims.auth_time;
      // Firestore rules validate the signed auth_time against trusted server time.
      if (!Number.isSafeInteger(authTime) || authTime <= 0 || auth.currentUser?.uid !== firebaseUser.uid) throw new Error('invalid-auth-time');
      const eventRef = doc(loginCollection(firebaseUser.uid), String(authTime));
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(eventRef);
        if (!existing.exists()) transaction.set(eventRef, { userId: firebaseUser.uid, kind, createdAt: serverTimestamp(), authTime });
      });
    } catch {
      // History is best effort; never print credentials, email, UID, or SDK error details.
      console.warn('남달라: 로그인 이력을 저장하지 못했어요.');
    }
  }
  async function finishAuthentication(firebaseUser, kind) {
    try {
      const account = await loadAccount(firebaseUser);
      await recordSuccessfulLogin(firebaseUser, account, kind);
      return acceptAccount(await loadAccount(firebaseUser));
    } catch (error) {
      if (auth.currentUser?.uid === firebaseUser.uid) {
        await signOut(auth);
        if (!auth.currentUser) acceptAccount(null);
      }
      throw error;
    }
  }
  async function targetMember(id, firebaseUser = auth.currentUser) {
    if (id === auth.currentUser?.uid) fail(403, '관리자 본인의 계정은 회원 목록에서 변경할 수 없어요.');
    const [snapshot, protectedAdmin] = await Promise.all([getDocFromServer(memberRef(id)), getDocFromServer(adminRef(id))]);
    ensureIdentity(firebaseUser);
    if (protectedAdmin.exists() && protectedAdmin.data().enabled === true) fail(403, '관리자 계정은 회원 관리에서 조회하거나 변경할 수 없어요.');
    if (!snapshot.exists()) fail(404, '회원을 찾을 수 없어요.');
    return snapshot.data();
  }
  async function readAssignment(uid, firebaseUser, includeProgress = null) {
    const snapshot = await getDocFromServer(assignmentRef(uid));
    ensureIdentity(firebaseUser);
    const assignment = publicAssignment(snapshot.exists() ? snapshot.data() : null);
    const books = []; const unavailableBookIds = [];
    for (let offset = 0; offset < assignment.bookIds.length; offset += 5) {
      const batch = await Promise.all(assignment.bookIds.slice(offset, offset + 5).map(async id => {
        const [book, saved] = await Promise.all([getDocFromServer(bookRef(id)), includeProgress ? getDocFromServer(progressRef(uid, id)) : Promise.resolve(null)]);
        if (!book.exists()) return { missing: id };
        const result = publicBook(id, book.data(), Boolean(includeProgress));
        if (!usableBook(book.data(), result)) return { missing: id };
        if (includeProgress) {
          const stored = saved.exists() ? saved.data() : {};
          result.progress = sanitizeProgress(plainObject(stored.payload) ? stored.payload : {}, includeProgress);
          result.progressUpdatedAt = timestampText(stored.updatedAt);
        }
        return { book: result };
      }));
      ensureIdentity(firebaseUser);
      for (const item of batch) if (item.missing) unavailableBookIds.push(item.missing); else books.push(item.book);
    }
    return { assignment, books, unavailableBookIds };
  }
  async function requireBook(id, firebaseUser, account) {
    if (!validBookId(id)) fail(400, '단어장 선택을 확인해 주세요.');
    if (account.role !== 'admin') {
      const assignment = await getDocFromServer(assignmentRef(firebaseUser.uid));
      ensureIdentity(firebaseUser);
      if (!publicAssignment(assignment.exists() ? assignment.data() : null).bookIds.includes(id)) fail(403, '현재 배정되지 않은 단어장이에요. 단어장 목록을 새로고침해 주세요.');
    }
    const snapshot = await getDocFromServer(bookRef(id));
    ensureIdentity(firebaseUser);
    if (!snapshot.exists()) fail(404, '단어장을 찾을 수 없어요. 관리자에게 문의해 주세요.');
    const book = publicBook(id, snapshot.data(), true);
    if (!usableBook(snapshot.data(), book)) fail(422, '단어장 내용에 문제가 있어요. 관리자에게 다시 저장을 요청해 주세요.');
    return book;
  }
  async function route(path, { method = 'GET', body } = {}) {
    const url = new URL(path, 'https://namdalra.invalid');
    method = method.toUpperCase();
    const pathname = url.pathname;
    if (pathname === '/api/session' && method === 'GET') {
      if (!auth.currentUser) return acceptAccount(null);
      try { return acceptAccount(await loadAccount(auth.currentUser)); }
      catch (error) { if (error.status === 403) { await signOut(auth); acceptAccount(null); } throw error; }
    }
    if (pathname === '/api/register' && method === 'POST') {
      const fields = profileFields(body);
      const password = passwordField(body.password);
      const credential = await createUserWithEmailAndPassword(auth, fields.email, password);
      try {
        await setDoc(memberRef(credential.user.uid), { ...fields, role: 'member', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } catch (error) {
        try { await deleteUser(credential.user); } catch { if (auth.currentUser?.uid === credential.user.uid) await signOut(auth).catch(() => {}); }
        throw error;
      }
      return finishAuthentication(credential.user, 'signup');
    }
    if (pathname === '/api/login' && method === 'POST') {
      let email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (email === 'admin') {
        if (!config.adminEmail) fail(400, '관리자 이메일 주소로 로그인해 주세요.');
        email = emailField(config.adminEmail);
      } else email = emailField(email);
      if (typeof body?.password !== 'string' || !body.password.length || body.password.length > 128) fail(401, '이메일 또는 비밀번호를 확인해 주세요.');
      const credential = await signInWithEmailAndPassword(auth, email, body.password);
      return finishAuthentication(credential.user, 'login');
    }
    if (pathname === '/api/logout' && method === 'POST') { await signOut(auth); return acceptAccount(null); }
    if (pathname === '/api/change-password' && method === 'POST') {
      const { firebaseUser } = await requireAccount();
      const password = passwordField(body?.newPassword, '새 비밀번호');
      if (typeof body?.currentPassword !== 'string' || !body.currentPassword.length || body.currentPassword.length > 128) fail(400, '현재 비밀번호를 입력해 주세요.');
      if (password === body.currentPassword) fail(400, '현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.');
      await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(firebaseUser.email, body.currentPassword));
      await updatePassword(firebaseUser, password);
      return acceptAccount(await loadAccount(firebaseUser));
    }
    if (pathname === '/api/books' && ['GET', 'POST'].includes(method)) {
      const { firebaseUser } = await requireAccount(true);
      if (method === 'GET') {
        const snapshot = await getDocsFromServer(query(bookCollection, orderBy('updatedAt', 'desc'), limit(MAX_BOOKS)));
        ensureIdentity(firebaseUser);
        const books = snapshot.docs.map(item => {
          const book = publicBook(item.id, item.data());
          return { ...book, ...(!usableBook(item.data(), book) ? { unavailable: true } : {}) };
        });
        books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, 'ko'));
        return { books, limitReached: snapshot.size === MAX_BOOKS, limit: MAX_BOOKS };
      }
      const fields = bookFields(body);
      const reference = doc(bookCollection);
      ensureIdentity(firebaseUser);
      await setDoc(reference, { ...fields, revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      ensureIdentity(firebaseUser);
      const snapshot = await getDocFromServer(reference);
      ensureIdentity(firebaseUser);
      return { book: publicBook(snapshot.id, snapshot.data(), true) };
    }
    const selectedBook = pathname.match(/^\/api\/books\/([A-Za-z0-9_-]{1,128})$/);
    if (selectedBook && ['GET', 'PUT'].includes(method)) {
      const { firebaseUser, account } = await requireAccount(method === 'PUT');
      if (method === 'GET') return { book: await requireBook(selectedBook[1], firebaseUser, account) };
      const fields = bookFields(body);
      if (!Number.isSafeInteger(body.revision) || body.revision < 1 || body.revision >= Number.MAX_SAFE_INTEGER) fail(400, '단어장 정보를 새로고침한 뒤 다시 저장해 주세요.');
      const reference = bookRef(selectedBook[1]);
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        ensureIdentity(firebaseUser);
        if (!snapshot.exists()) fail(404, '단어장을 찾을 수 없어요.');
        if (snapshot.data().revision !== body.revision) fail(409, '다른 곳에서 단어장을 수정했어요. 새로고침한 뒤 다시 저장해 주세요.');
        transaction.update(reference, { ...fields, revision: body.revision + 1, updatedAt: serverTimestamp() });
      });
      ensureIdentity(firebaseUser);
      const snapshot = await getDocFromServer(reference);
      ensureIdentity(firebaseUser);
      return { book: publicBook(snapshot.id, snapshot.data(), true) };
    }
    const assignedMember = pathname.match(/^\/api\/members\/([A-Za-z0-9_-]{1,128})\/assignments$/);
    if (assignedMember && ['GET', 'PUT'].includes(method)) {
      const { firebaseUser } = await requireAccount(true);
      const uid = assignedMember[1];
      await targetMember(uid, firebaseUser);
      if (method === 'GET') return readAssignment(uid, firebaseUser);
      const fields = assignmentFields(body);
      if (fields.revision >= Number.MAX_SAFE_INTEGER) fail(400, '배정 정보를 확인해 주세요.');
      const result = await runTransaction(db, async transaction => {
        const [saved, member, protectedAdmin, ...books] = await Promise.all([
          transaction.get(assignmentRef(uid)), transaction.get(memberRef(uid)), transaction.get(adminRef(uid)),
          ...fields.bookIds.map(id => transaction.get(bookRef(id))),
        ]);
        ensureIdentity(firebaseUser);
        if (!member.exists()) fail(404, '회원을 찾을 수 없어요.');
        if (protectedAdmin.exists() && protectedAdmin.data().enabled === true) fail(403, '관리자 계정에는 학생 단어장을 배정할 수 없어요.');
        const revision = saved.exists() ? saved.data().revision : 0;
        if (revision !== fields.revision) fail(409, '다른 곳에서 배정을 수정했어요. 새로고침한 뒤 다시 저장해 주세요.');
        if (books.some(book => !book.exists())) fail(404, '선택한 단어장 중 찾을 수 없는 항목이 있어요. 목록을 새로고침해 주세요.');
        if (books.some(book => !usableBook(book.data(), publicBook(book.id, book.data())))) fail(422, '선택한 단어장 내용에 문제가 있어요. 다시 저장한 뒤 배정해 주세요.');
        const assignment = { bookIds: fields.bookIds, revision: revision + 1 };
        transaction.set(assignmentRef(uid), { userId: uid, ...assignment, updatedAt: serverTimestamp() });
        return { assignment, books: books.map(book => publicBook(book.id, book.data())), unavailableBookIds: [] };
      });
      ensureIdentity(firebaseUser);
      return result;
    }
    if (pathname === '/api/curriculum' && method === 'GET') {
      const { firebaseUser } = await requireAccount();
      return readAssignment(firebaseUser.uid, firebaseUser);
    }
    if (pathname === '/api/progress' && ['GET', 'PUT'].includes(method)) {
      const { firebaseUser, account } = await requireAccount();
      const bookId = url.searchParams.has('book') ? url.searchParams.get('book') : null;
      if (bookId !== null && !validBookId(bookId)) fail(400, '단어장 선택을 확인해 주세요.');
      const reference = progressRef(firebaseUser.uid, bookId);
      if (method === 'GET') {
        if (bookId) await requireBook(bookId, firebaseUser, account);
        const snapshot = await getDocFromServer(reference);
        ensureIdentity(firebaseUser);
        const payload = snapshot.exists() ? snapshot.data().payload : null;
        return { progress: sanitizeProgress(plainObject(payload) ? payload : {}, account) };
      }
      if (!plainObject(body?.progress)) fail(400, '학습 기록 형식이 올바르지 않아요.');
      requireByteLimit(body.progress, '학습 기록 크기가 750KiB를 초과했어요. 기존 기록은 그대로 유지됩니다. 관리자에게 문의해 주세요.');
      requireWordCapacity(body.progress);
      const progress = await runTransaction(db, async transaction => {
        const [saved, member, admin, assignment, book] = await Promise.all([
          transaction.get(reference), transaction.get(memberRef(firebaseUser.uid)), transaction.get(adminRef(firebaseUser.uid)),
          bookId ? transaction.get(assignmentRef(firebaseUser.uid)) : Promise.resolve(null),
          bookId ? transaction.get(bookRef(bookId)) : Promise.resolve(null),
        ]);
        ensureIdentity(firebaseUser);
        const currentAccount = accountFromSnapshots(firebaseUser, member, admin);
        if (bookId) {
          if (!book.exists()) fail(404, '단어장을 찾을 수 없어요. 단어장 목록을 새로고침해 주세요.');
          if (currentAccount.role !== 'admin' && !publicAssignment(assignment.exists() ? assignment.data() : null).bookIds.includes(bookId)) fail(403, '현재 배정되지 않은 단어장이에요. 단어장 목록을 새로고침해 주세요.');
        }
        const merged = mergeProgress(saved.exists() ? saved.data().payload : {}, body.progress, currentAccount);
        transaction.set(reference, { userId: firebaseUser.uid, level: merged.level, payload: merged, updatedAt: serverTimestamp() });
        return merged;
      });
      ensureIdentity(firebaseUser);
      return { progress };
    }
    if (pathname === '/api/members' && method === 'GET') {
      const { account } = await requireAccount(true);
      const snapshot = await getDocsFromServer(query(collection(db, 'namdalraMembers'), limit(1000)));
      const search = (url.searchParams.get('query') || '').trim().toLowerCase().slice(0, 100);
      const grade = url.searchParams.get('grade') || '';
      const status = url.searchParams.get('status') || '';
      const profiles = snapshot.docs.filter(item => item.id !== account.id);
      const classified = [];
      for (let offset = 0; offset < profiles.length; offset += 10) {
        classified.push(...await Promise.all(profiles.slice(offset, offset + 10).map(async item => {
          const protectedAdmin = await getDocFromServer(adminRef(item.id));
          return publicUser(item.id, item.data(), protectedAdmin.exists() && protectedAdmin.data().enabled === true);
        })));
      }
      const members = classified.filter(user => (!grade || user.grade === grade) && (!status || user.status === status) && (!search || [user.name, user.email, user.phone, user.school].some(value => value.toLowerCase().includes(search))));
      members.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { members };
    }
    const activity = pathname.match(/^\/api\/members\/([A-Za-z0-9_-]{1,128})\/activity$/);
    if (activity && method === 'GET') {
      const { firebaseUser } = await requireAccount(true);
      const member = publicUser(activity[1], await targetMember(activity[1], firebaseUser));
      const [saved, history, curriculum] = await Promise.all([
        getDocFromServer(progressRef(member.id)),
        getDocsFromServer(query(loginCollection(member.id), orderBy('createdAt', 'desc'), limit(LOGIN_HISTORY_LIMIT))),
        readAssignment(member.id, firebaseUser, member),
      ]);
      if (auth.currentUser?.uid !== firebaseUser.uid) fail(401, '접속 계정이 변경되었어요. 다시 로그인해 주세요.');
      const stored = saved.exists() ? saved.data() : {};
      const logins = history.docs.flatMap(item => {
        const event = item.data();
        const createdAt = timestampText(event.createdAt);
        return event.userId === member.id && ['login', 'signup'].includes(event.kind) && Number.isSafeInteger(event.authTime) && event.authTime > 0 && item.id === String(event.authTime) && createdAt
          ? [{ id: item.id, createdAt, kind: event.kind }] : [];
      });
      return {
        member, progress: sanitizeProgress(plainObject(stored.payload) ? stored.payload : {}, member),
        progressUpdatedAt: timestampText(stored.updatedAt), logins, loginHistoryLimit: LOGIN_HISTORY_LIMIT, ...curriculum,
      };
    }
    const target = pathname.match(/^\/api\/members\/([A-Za-z0-9_-]{1,128})(\/reset-password)?$/);
    if (target && ['PATCH', 'POST'].includes(method)) {
      const { firebaseUser } = await requireAccount(true);
      const member = await targetMember(target[1], firebaseUser);
      if (method === 'POST' && target[2]) {
        await sendPasswordResetEmail(auth, member.email);
        return { resetEmailSent: true };
      }
      if (method === 'PATCH' && !target[2]) {
        if (!plainObject(body) || Object.keys(body).some(key => !MEMBER_FIELDS.has(key))) fail(400, '이메일과 권한은 이 화면에서 변경할 수 없어요.');
        const fields = profileFields(body, true);
        if (!Object.keys(fields).length) fail(400, '수정할 내용을 입력해 주세요.');
        await updateDoc(memberRef(target[1]), { ...fields, updatedAt: serverTimestamp() });
        const updated = await getDocFromServer(memberRef(target[1]));
        return { user: publicUser(target[1], updated.data()) };
      }
    }
    fail(404, '요청한 기능을 찾을 수 없어요.');
  }
  return {
    ready,
    async request(path, options = {}) {
      if (disposed) fail(503, '학습 연결이 닫혔어요. 페이지를 새로고침해 주세요.');
      const intentional = AUTH_MUTATIONS.has(new URL(path, 'https://namdalra.invalid').pathname);
      if (intentional) {
        if (!intentionalAuth) { intentionalBaseline = activeAccount ? { id: activeAccount.id, signature: accountSignature } : null; pendingAccountChange = null; }
        intentionalAuth++;
      }
      try {
        await ready;
        const uid = auth.currentUser?.uid;
        const result = await route(path, options);
        if (!intentional && uid !== auth.currentUser?.uid) fail(401, '접속 계정이 변경되었어요. 다시 로그인해 주세요.');
        return result;
      }
      catch (error) { throw normalizeError(error); }
      finally {
        if (intentional && --intentionalAuth === 0) {
          const pending = pendingAccountChange;
          intentionalBaseline = null;
          pendingAccountChange = null;
          if (pending && activeAccount && pending.epoch === watchEpoch && auth.currentUser?.uid === pending.uid) notifyAccount(pending.user, pending.reason, true);
        }
      }
    },
    dispose() { disposed = true; unsubscribeAuth(); for (const unsubscribe of watches) unsubscribe(); watches = []; activeAccount = null; },
  };
}
