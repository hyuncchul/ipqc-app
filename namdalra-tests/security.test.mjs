import {before, beforeEach, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {collection, collectionGroup, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy, limit, runTransaction, serverTimestamp, Timestamp, setLogLevel} from 'firebase/firestore';

// These tests only target a local demo emulator; no production credentials/project.
const PROJECT_ID = 'demo-namdalra-rules';
const members = 'namdalraMembers';
const admins = 'namdalraAdmins';
const progress = 'namdalraProgress';
const books = 'namdalraBooks';
const assignments = 'namdalraAssignments';
let environment;
const databaseCache = new Map();
setLogLevel('silent');
const email = uid => uid + '@example.test';
const db = (uid, claims = {}) => {
  const key = JSON.stringify([uid, claims]);
  if (!databaseCache.has(key)) databaseCache.set(key, environment.authenticatedContext(uid, {email: email(uid), ...claims}).firestore());
  return databaseCache.get(key);
};
const anonymous = () => {
  if (!databaseCache.has('anonymous')) databaseCache.set('anonymous', environment.unauthenticatedContext().firestore());
  return databaseCache.get('anonymous');
};
const ref = (database, group, uid) => doc(database, group, uid);
const fixedTime = () => Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
function profile(uid, overrides = {}, timestamps = true) {
  return {name: '테스트 학생', phone: '01012345678', address: '서울시 테스트로 123', school: '테스트초등학교', grade: 'e3',
    email: email(uid), role: 'member', status: 'active',
    createdAt: timestamps ? serverTimestamp() : fixedTime(), updatedAt: timestamps ? serverTimestamp() : fixedTime(), ...overrides};
}
function record(uid, level = 'sprout', overrides = {}) {
  return {userId: uid, level, payload: {words: {}, days: {}, gameBest: {easy: 0, normal: 0, fast: 0}, level, category: 'everyday'},
    updatedAt: serverTimestamp(), ...overrides};
}
async function seed(group, uid, value) {
  await environment.withSecurityRulesDisabled(context => setDoc(ref(context.firestore(), group, uid), value));
}
const authTimeNow = () => Math.floor(Date.now() / 1000) - 1;
const loginRef = (database, uid, authTime) => doc(database, members, uid, 'logins', String(authTime));
const loginCollection = (database, uid) => collection(database, members, uid, 'logins');
const loginRecord = (uid, authTime, overrides = {}) => ({userId: uid, kind: 'login', createdAt: serverTimestamp(), authTime, ...overrides});
async function seedLogin(uid, authTime = 1767225600) {
  await environment.withSecurityRulesDisabled(context => setDoc(loginRef(context.firestore(), uid, authTime), loginRecord(uid, authTime, {createdAt: fixedTime()})));
}
function book(overrides = {}, timestamps = true) {
  return {title:'테스트 단어장', description:'학년별 연습 단어', sourceName:'test.csv',
    words:[{id:'word-1', en:'apple', ko:'사과', pos:'명사', emoji:'🍎', example:'I like an apple.', translation:'나는 사과를 좋아해요.'}],
    wordCount:1, revision:1, createdAt:timestamps ? serverTimestamp() : fixedTime(), updatedAt:timestamps ? serverTimestamp() : fixedTime(), ...overrides};
}
const assignment = (uid, bookIds = ['book-one'], overrides = {}) => ({userId:uid, bookIds, revision:1, updatedAt:serverTimestamp(), ...overrides});
const bookProgressRef = (database, uid, bookId = 'book-one') => doc(database, progress, uid, 'books', bookId);
async function seedBookAccess() {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(ref(database, books, 'book-one'), book({}, false)),
      setDoc(ref(database, books, 'book-two'), book({title:'다른 단어장'}, false)),
      setDoc(ref(database, assignments, 'alice'), assignment('alice', ['book-one'], {updatedAt:fixedTime()})),
      setDoc(ref(database, assignments, 'bob'), assignment('bob', ['book-two'], {updatedAt:fixedTime()})),
      setDoc(ref(database, assignments, 'paused'), assignment('paused', ['book-one'], {updatedAt:fixedTime()})),
      setDoc(bookProgressRef(database, 'alice'), record('alice', 'sprout', {updatedAt:fixedTime()})),
      setDoc(bookProgressRef(database, 'paused'), record('paused', 'tree', {updatedAt:fixedTime()}))
    ]);
  });
}

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
  const [hostname, port] = host.split(':');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(hostname), 'Tests must use a local emulator');
  environment = await initializeTestEnvironment({projectId: PROJECT_ID, firestore: {
    host: hostname, port: Number(port), rules: readFileSync(new URL('../namdalra-firestore.rules', import.meta.url), 'utf8')
  }});
});

after(async () => { if (environment) await environment.cleanup(); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all([
      setDoc(ref(database, admins, 'owner'), {enabled: true}),
      setDoc(ref(database, admins, 'disabled-admin'), {enabled: false}),
      setDoc(ref(database, members, 'alice'), profile('alice', {}, false)),
      setDoc(ref(database, members, 'bob'), profile('bob', {grade: 'e5'}, false)),
      setDoc(ref(database, members, 'paused'), profile('paused', {status: 'suspended', grade: 'm1'}, false)),
      setDoc(ref(database, progress, 'alice'), record('alice', 'sprout', {updatedAt: fixedTime()})),
      setDoc(ref(database, progress, 'bob'), record('bob', 'leaf', {updatedAt: fixedTime()})),
      setDoc(ref(database, progress, 'paused'), record('paused', 'tree', {updatedAt: fixedTime()}))
    ]);
  });
});

test('unauthenticated clients cannot get/list any private collection or write profiles/progress', async () => {
  const database = anonymous();
  for (const group of [admins, members, progress]) {
    await assertFails(getDoc(ref(database, group, 'alice')));
    await assertFails(getDocs(query(collection(database, group), limit(10))));
  }
  await assertFails(setDoc(ref(database, members, 'new-student'), profile('new-student')));
  await assertFails(setDoc(ref(database, progress, 'alice'), record('alice')));
});

test('admin authority documents permit self get and administrator lookup but never listing', async () => {
  await assertSucceeds(getDoc(ref(db('owner'), admins, 'owner')));
  await assertSucceeds(getDoc(ref(db('alice'), admins, 'alice')));
  await assertSucceeds(getDoc(ref(db('disabled-admin'), admins, 'disabled-admin')));
  await assertSucceeds(getDoc(ref(db('owner'), admins, 'disabled-admin')));
  await assertSucceeds(getDoc(ref(db('owner'), admins, 'alice')));
  await assertFails(getDoc(ref(db('alice'), admins, 'owner')));
  await assertFails(getDoc(ref(db('disabled-admin'), admins, 'owner')));
  await assertFails(getDocs(collection(db('owner'), admins)));
});

test('no client can create, modify, or delete administrator authority documents', async () => {
  await assertFails(setDoc(ref(db('alice'), admins, 'alice'), {enabled: true}));
  await assertFails(setDoc(ref(db('owner'), admins, 'alice'), {enabled: true}));
  await assertFails(updateDoc(ref(db('owner'), admins, 'owner'), {enabled: false}));
  await assertFails(deleteDoc(ref(db('owner'), admins, 'owner')));
});

test('spoofed admin role and custom claims never confer administrator access', async () => {
  await seed(members, 'spoof', profile('spoof', {role: 'admin'}, false));
  const spoof = db('spoof', {admin: true, role: 'admin'});
  await assertFails(getDocs(query(collection(spoof, members), limit(10))));
  await assertFails(updateDoc(ref(spoof, members, 'alice'), {name: '변경 시도', updatedAt: serverTimestamp()}));
  await assertFails(setDoc(ref(spoof, progress, 'spoof'), record('spoof')));
});

test('a valid member can register only their own matching-email profile', async () => {
  await assertSucceeds(setDoc(ref(db('new-student'), members, 'new-student'), profile('new-student')));
  await assertFails(setDoc(ref(db('other-student'), members, 'target-student'), profile('other-student')));
  await assertFails(setDoc(ref(db('wrong-email'), members, 'wrong-email'), profile('wrong-email', {email: email('alice')})));
});

test('new profiles reject privilege/status spoofing, unexpected fields, and missing fields', async () => {
  const database = db('new-student');
  for (const mutation of [{role: 'admin'}, {status: 'suspended'}, {enabled: true}, {userId: 'alice'}, {mustChangePassword: true}]) {
    await assertFails(setDoc(ref(database, members, 'new-student'), profile('new-student', mutation)));
  }
  const missing = profile('new-student'); delete missing.school;
  await assertFails(setDoc(ref(database, members, 'new-student'), missing));
});

test('member fields enforce the agreed lengths, grade enumeration, email and normalized phone', async () => {
  const database = db('new-student');
  for (const mutation of [
    {name: '한'}, {name: '가'.repeat(51)}, {address: '짧음'}, {address: '가'.repeat(201)},
    {school: '교'}, {school: '가'.repeat(101)}, {phone: '12345678'}, {phone: '1'.repeat(16)},
    {phone: '010-1234-5678'}, {phone: '010abcdefgh'}, {grade: 'm4'}, {grade: 'admin'}, {email: 'invalid-email'}
  ]) await assertFails(setDoc(ref(database, members, 'new-student'), profile('new-student', mutation)));
});

test('registration timestamps must be server timestamps for the current request', async () => {
  await assertFails(setDoc(ref(db('new-student'), members, 'new-student'), profile('new-student', {}, false)));
  await assertFails(setDoc(ref(db('new-student'), members, 'new-student'), profile('new-student', {updatedAt: fixedTime()})));
});

test('members read only their own profile and cannot list members', async () => {
  await assertSucceeds(getDoc(ref(db('alice'), members, 'alice')));
  await assertFails(getDoc(ref(db('alice'), members, 'bob')));
  await assertFails(getDocs(query(collection(db('alice'), members), limit(10))));
});

test('members cannot self-edit fields, promote role, change grade, or reactivate themselves', async () => {
  for (const mutation of [{name: '바꾼 이름'}, {grade: 'm3'}, {email: email('someone')}, {role: 'admin'}, {status: 'suspended'}]) {
    await assertFails(updateDoc(ref(db('alice'), members, 'alice'), {...mutation, updatedAt: serverTimestamp()}));
  }
  await assertFails(updateDoc(ref(db('paused'), members, 'paused'), {status: 'active', updatedAt: serverTimestamp()}));
});

test('enabled administrators can get members and issue only bounded member-list queries', async () => {
  await assertSucceeds(getDoc(ref(db('owner'), members, 'alice')));
  await assertSucceeds(getDocs(query(collection(db('owner'), members), limit(1000))));
  await assertFails(getDocs(collection(db('owner'), members)));
  await assertFails(getDocs(query(collection(db('owner'), members), limit(1001))));
});

test('administrators can update the allowed member fields', async () => {
  await assertSucceeds(updateDoc(ref(db('owner'), members, 'alice'), {
    name: '수정한 학생', phone: '01098765432', address: '서울시 새주소 456', school: '새학교중학교',
    grade: 'm2', status: 'suspended', updatedAt: serverTimestamp()
  }));
  const snapshot = await assertSucceeds(getDoc(ref(db('owner'), members, 'alice')));
  assert.equal(snapshot.data().grade, 'm2');
});

test('enabled administrator profiles are protected from self-edit and edits by other admins', async () => {
  await seed(members, 'owner', profile('owner', {}, false));
  await seed(members, 'second-owner', profile('second-owner', {}, false));
  await seed(admins, 'second-owner', {enabled:true});
  await assertSucceeds(getDoc(ref(db('owner'), admins, 'second-owner')));
  for (const target of ['owner','second-owner']) {
    for (const mutation of [{name:'수정 시도'}, {grade:'m3'}, {status:'suspended'}]) {
      await assertFails(updateDoc(ref(db('owner'), members, target), {...mutation, updatedAt:serverTimestamp()}));
    }
  }
  await assertFails(updateDoc(ref(db('second-owner'), members, 'owner'), {status:'suspended', updatedAt:serverTimestamp()}));
  await seed(admins, 'second-owner', {enabled:false});
  await assertSucceeds(updateDoc(ref(db('owner'), members, 'second-owner'), {name:'일반 회원', updatedAt:serverTimestamp()}));
});

test('administrator updates cannot change email, role, identity, creation time, or add privilege fields', async () => {
  for (const mutation of [{email: email('different')}, {role: 'admin'}, {userId: 'different'}, {createdAt: serverTimestamp()}, {enabled: true}]) {
    await assertFails(updateDoc(ref(db('owner'), members, 'alice'), {...mutation, updatedAt: serverTimestamp()}));
  }
  await assertFails(updateDoc(ref(db('owner'), members, 'alice'), {name: '새 이름', updatedAt: fixedTime()}));
});

test('administrator clients cannot create another account profile or delete any member', async () => {
  await assertFails(setDoc(ref(db('owner'), members, 'new-student'), profile('new-student')));
  await assertFails(deleteDoc(ref(db('owner'), members, 'alice')));
  await assertFails(deleteDoc(ref(db('alice'), members, 'alice')));
});

test('disabled administrator documents confer no member-management privilege', async () => {
  await assertFails(getDocs(query(collection(db('disabled-admin'), members), limit(10))));
  await assertFails(updateDoc(ref(db('disabled-admin'), members, 'alice'), {name: '수정 시도', updatedAt: serverTimestamp()}));
});

test('admin revocation takes effect on the next protected request', async () => {
  const database = db('owner');
  await assertSucceeds(getDocs(query(collection(database, members), limit(10))));
  await seed(admins, 'owner', {enabled: false});
  await assertFails(getDocs(query(collection(database, members), limit(10))));
  await assertFails(setDoc(ref(database, progress, 'owner'), record('owner')));
});

test('an active member can read and update their own valid progress', async () => {
  await assertSucceeds(getDoc(ref(db('alice'), progress, 'alice')));
  await assertSucceeds(setDoc(ref(db('alice'), progress, 'alice'), record('alice')));
  await assertSucceeds(setDoc(ref(db('bob'), progress, 'bob'), record('bob', 'leaf')));
});

test('members cannot read or write another member progress or list progress documents', async () => {
  await assertFails(getDoc(ref(db('alice'), progress, 'bob')));
  await assertFails(setDoc(ref(db('alice'), progress, 'bob'), record('bob', 'leaf')));
  await assertFails(getDocs(query(collection(db('alice'), progress), limit(10))));
});

test('missing member profiles cannot access or create progress', async () => {
  await assertFails(getDoc(ref(db('no-profile'), progress, 'no-profile')));
  await assertFails(setDoc(ref(db('no-profile'), progress, 'no-profile'), record('no-profile')));
});

test('suspended members retain self-status access but lose all progress access', async () => {
  await assertSucceeds(getDoc(ref(db('paused'), members, 'paused')));
  await assertFails(getDoc(ref(db('paused'), progress, 'paused')));
  await assertFails(setDoc(ref(db('paused'), progress, 'paused'), record('paused', 'tree')));
});

test('admin suspension and restoration apply to progress immediately', async () => {
  const student = db('alice');
  await assertSucceeds(getDoc(ref(student, progress, 'alice')));
  await assertSucceeds(updateDoc(ref(db('owner'), members, 'alice'), {status: 'suspended', updatedAt: serverTimestamp()}));
  await assertFails(getDoc(ref(student, progress, 'alice')));
  await assertFails(setDoc(ref(student, progress, 'alice'), record('alice')));
  await assertSucceeds(updateDoc(ref(db('owner'), members, 'alice'), {status: 'active', updatedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(ref(student, progress, 'alice'), record('alice')));
});

test('students cannot escalate learning level or mismatch payload and envelope levels', async () => {
  await assertFails(setDoc(ref(db('alice'), progress, 'alice'), record('alice', 'forest')));
  const mismatch = record('alice'); mismatch.payload.level = 'forest';
  await assertFails(setDoc(ref(db('alice'), progress, 'alice'), mismatch));
});

test('all nine grades enforce their recommended level', async () => {
  for (const [grade, level] of Object.entries({e1:'sprout',e2:'sprout',e3:'sprout',e4:'sprout',e5:'leaf',e6:'leaf',m1:'tree',m2:'forest',m3:'forest'})) {
    await seed(members, 'by-grade', profile('by-grade', {grade}, false));
    await assertSucceeds(setDoc(ref(db('by-grade'), progress, 'by-grade'), record('by-grade', level)));
    await assertFails(setDoc(ref(db('by-grade'), progress, 'by-grade'), record('by-grade', level === 'forest' ? 'sprout' : 'forest')));
  }
});

test('an admin grade change rejects the old level and permits the new one', async () => {
  await assertSucceeds(updateDoc(ref(db('owner'), members, 'alice'), {grade: 'm1', updatedAt: serverTimestamp()}));
  await assertFails(setDoc(ref(db('alice'), progress, 'alice'), record('alice', 'sprout')));
  await assertSucceeds(setDoc(ref(db('alice'), progress, 'alice'), record('alice', 'tree')));
});

test('progress ownership and exact top-level schema cannot be forged', async () => {
  for (const mutation of [{userId: 'bob'}, {role: 'admin'}, {owner: 'bob'}, {updatedAt: fixedTime()}]) {
    await assertFails(setDoc(ref(db('alice'), progress, 'alice'), record('alice', 'sprout', mutation)));
  }
  const missing = record('alice'); delete missing.userId;
  await assertFails(setDoc(ref(db('alice'), progress, 'alice'), missing));
});

test('progress rejects malformed payload types, extra keys and invalid score values', async () => {
  for (const mutation of [{words: []}, {days: null}, {category: 'admin'}, {extra: true}, {gameBest: {easy:0,normal:0,fast:0,extra:1}},
    {gameBest: {easy:-1,normal:0,fast:0}}, {gameBest: {easy:100001,normal:0,fast:0}}, {gameBest: {easy:'10',normal:0,fast:0}}, {gameBest: {easy:1.5,normal:0,fast:0}}]) {
    const data = record('alice'); Object.assign(data.payload, mutation);
    await assertFails(setDoc(ref(db('alice'), progress, 'alice'), data));
  }
  const missing = record('alice'); delete missing.payload.words;
  await assertFails(setDoc(ref(db('alice'), progress, 'alice'), missing));
});

test('progress map size limits bound saved word/day collections', async () => {
  const words = record('alice'); words.payload.words = Object.fromEntries(Array.from({length:1001}, (_,i) => ['word'+i, {}]));
  await assertFails(setDoc(ref(db('alice'), progress, 'alice'), words));
  const days = record('alice'); days.payload.days = Object.fromEntries(Array.from({length:731}, (_,i) => ['day'+i, []]));
  await assertFails(setDoc(ref(db('alice'), progress, 'alice'), days));
});

test('admins may practice in their own document without a member profile', async () => {
  await assertSucceeds(setDoc(ref(db('owner'), progress, 'owner'), record('owner', 'forest')));
  await assertSucceeds(getDoc(ref(db('owner'), progress, 'owner')));
});

test('administrators may get individual active or suspended member reports but cannot list or write others progress', async () => {
  await assertSucceeds(getDoc(ref(db('owner'), progress, 'alice')));
  await assertSucceeds(getDoc(ref(db('owner'), progress, 'paused')));
  await assertSucceeds(getDoc(ref(db('owner'), progress, 'no-progress-yet')));
  await assertFails(setDoc(ref(db('owner'), progress, 'alice'), record('alice')));
  await assertFails(updateDoc(ref(db('owner'), progress, 'bob'), {level:'forest', updatedAt:serverTimestamp()}));
  await assertFails(setDoc(ref(db('owner'), progress, 'no-profile'), record('no-profile')));
  await assertFails(deleteDoc(ref(db('owner'), progress, 'alice')));
  await assertFails(getDocs(query(collection(db('owner'), progress), limit(10))));
});

test('report access rejects disabled admins, spoofed claims, and revoked administrators', async () => {
  await assertFails(getDoc(ref(db('disabled-admin'), progress, 'alice')));
  await assertFails(getDoc(ref(db('alice', {admin:true, role:'admin'}), progress, 'bob')));
  await assertSucceeds(getDoc(ref(db('owner'), progress, 'alice')));
  await seed(admins, 'owner', {enabled:false});
  await assertFails(getDoc(ref(db('owner'), progress, 'alice')));
});

test('active members and profile-free administrators can record their own fresh login or signup', async () => {
  for (const [uid, kind] of [['alice','login'], ['bob','signup'], ['owner','login']]) {
    const authTime = authTimeNow();
    const database = db(uid, {auth_time:authTime});
    await assertSucceeds(setDoc(loginRef(database, uid, authTime), loginRecord(uid, authTime, {kind})));
    const snapshot = await assertSucceeds(getDoc(loginRef(database, uid, authTime)));
    assert.equal(snapshot.data().authTime, authTime);
    assert.equal(snapshot.data().kind, kind);
    assert.ok(snapshot.data().createdAt instanceof Timestamp);
  }
});

test('login records are keyed by signed authentication time and cannot be replayed or duplicated', async () => {
  const authTime = authTimeNow();
  const database = db('alice', {auth_time:authTime});
  const location = loginRef(database, 'alice', authTime);
  await assertSucceeds(setDoc(location, loginRecord('alice', authTime)));
  await assertFails(setDoc(location, loginRecord('alice', authTime)));
  await assertFails(setDoc(loginRef(database, 'alice', authTime + 1), loginRecord('alice', authTime)));
  await assertFails(setDoc(loginRef(database, 'alice', '0' + authTime), loginRecord('alice', authTime)));
  await assertSucceeds(runTransaction(database, async transaction => {
    const existing = await transaction.get(location);
    assert.equal(existing.exists(), true);
  }));
});

test('a transaction may deduplicate an absent login and create exactly one event', async () => {
  const authTime = authTimeNow();
  const database = db('alice', {auth_time:authTime});
  const location = loginRef(database, 'alice', authTime);
  await assertSucceeds(runTransaction(database, async transaction => {
    const existing = await transaction.get(location);
    assert.equal(existing.exists(), false);
    transaction.set(location, loginRecord('alice', authTime));
  }));
});

test('login timestamps must match the signed claim and be from the preceding 300 seconds', async () => {
  const now = authTimeNow();
  await assertSucceeds(setDoc(loginRef(db('alice', {auth_time:now - 290}), 'alice', now - 290), loginRecord('alice', now - 290)));
  for (const authTime of [now - 301, now + 60, 0, -1]) {
    await assertFails(setDoc(loginRef(db('alice', {auth_time:authTime}), 'alice', authTime), loginRecord('alice', authTime)));
  }
  await assertFails(setDoc(loginRef(db('alice', {auth_time:now}), 'alice', now - 1), loginRecord('alice', now - 1)));
  await assertFails(setDoc(loginRef(db('alice', {auth_time:String(now)}), 'alice', now), loginRecord('alice', now)));
  await assertFails(setDoc(loginRef(db('alice', {auth_time:null}), 'alice', now), loginRecord('alice', now)));
});

test('login creation enforces exact fields, identity, kind, integer time and server timestamps', async () => {
  const authTime = authTimeNow();
  const database = db('alice', {auth_time:authTime});
  for (const mutation of [{userId:'bob'}, {kind:'admin'}, {kind:'logout'}, {authTime:String(authTime)}, {authTime:authTime + 0.5},
    {createdAt:fixedTime()}, {extra:true}, {email:email('alice')}]) {
    await assertFails(setDoc(loginRef(database, 'alice', authTime), loginRecord('alice', authTime, mutation)));
  }
  for (const key of ['userId','kind','createdAt','authTime']) {
    const data = loginRecord('alice', authTime); delete data[key];
    await assertFails(setDoc(loginRef(database, 'alice', authTime), data));
  }
});

test('unauthenticated clients cannot create, get or list login records', async () => {
  await seedLogin('alice');
  const database = anonymous();
  const authTime = authTimeNow();
  await assertFails(setDoc(loginRef(database, 'alice', authTime), loginRecord('alice', authTime)));
  await assertFails(getDoc(loginRef(database, 'alice', 1767225600)));
  await assertFails(getDocs(query(loginCollection(database, 'alice'), orderBy('createdAt','desc'), limit(30))));
});

test('members cannot create or get another member login or list their own history', async () => {
  await seedLogin('bob');
  const authTime = authTimeNow();
  const database = db('alice', {auth_time:authTime});
  await assertFails(setDoc(loginRef(database, 'bob', authTime), loginRecord('bob', authTime)));
  await assertFails(getDoc(loginRef(database, 'bob', 1767225600)));
  await assertFails(getDocs(query(loginCollection(database, 'alice'), orderBy('createdAt','desc'), limit(30))));
  await assertFails(getDocs(query(loginCollection(database, 'bob'), orderBy('createdAt','desc'), limit(30))));
});

test('suspended or unregistered users cannot record logins and cannot impersonate an administrator', async () => {
  const authTime = authTimeNow();
  for (const uid of ['paused','no-profile','disabled-admin']) {
    await assertFails(setDoc(loginRef(db(uid, {auth_time:authTime, admin:true}), uid, authTime), loginRecord(uid, authTime)));
  }
  await seed(members, 'spoof', profile('spoof', {role:'admin'}, false));
  await assertFails(setDoc(loginRef(db('spoof', {auth_time:authTime, role:'admin'}), 'spoof', authTime), loginRecord('spoof', authTime)));
  await seedLogin('paused');
  await assertSucceeds(getDoc(loginRef(db('paused'), 'paused', 1767225600)));
});

test('admin history reads allow get and bounded newest-first queries including suspended users', async () => {
  for (const uid of ['alice','paused']) {
    await seedLogin(uid);
    await assertSucceeds(getDoc(loginRef(db('owner'), uid, 1767225600)));
    const history = await assertSucceeds(getDocs(query(loginCollection(db('owner'), uid), orderBy('createdAt','desc'), limit(30))));
    assert.equal(history.size, 1);
  }
  await assertFails(getDocs(loginCollection(db('owner'), 'alice')));
  await assertFails(getDocs(query(loginCollection(db('owner'), 'alice'), orderBy('createdAt','desc'))));
  await assertFails(getDocs(query(loginCollection(db('owner'), 'alice'), orderBy('createdAt','desc'), limit(31))));
  await assertFails(getDocs(query(loginCollection(db('owner'), 'alice'), limit(30))));
  await assertFails(getDocs(query(loginCollection(db('owner'), 'alice'), orderBy('createdAt','asc'), limit(30))));
});

test('admin history privilege grants no cross-user creation, update, delete or collection-group enumeration', async () => {
  await seedLogin('alice');
  const authTime = authTimeNow();
  const database = db('owner', {auth_time:authTime});
  await assertFails(setDoc(loginRef(database, 'alice', authTime), loginRecord('alice', authTime)));
  for (const actor of [database, db('alice')]) {
    await assertFails(updateDoc(loginRef(actor, 'alice', 1767225600), {kind:'signup'}));
    await assertFails(deleteDoc(loginRef(actor, 'alice', 1767225600)));
  }
  await assertFails(getDocs(query(collectionGroup(database, 'logins'), orderBy('createdAt','desc'), limit(30))));
});

test('disabled, spoofed and revoked administrators cannot read or query other login histories', async () => {
  await seedLogin('alice');
  for (const actor of [db('disabled-admin'), db('bob', {admin:true, role:'admin'})]) {
    await assertFails(getDoc(loginRef(actor, 'alice', 1767225600)));
    await assertFails(getDocs(query(loginCollection(actor, 'alice'), orderBy('createdAt','desc'), limit(30))));
  }
  const owner = db('owner');
  await assertSucceeds(getDoc(loginRef(owner, 'alice', 1767225600)));
  await seed(admins, 'owner', {enabled:false});
  await assertFails(getDoc(loginRef(owner, 'alice', 1767225600)));
  await assertFails(getDocs(query(loginCollection(owner, 'alice'), orderBy('createdAt','desc'), limit(30))));
});

test('client progress deletion and unlisted/nested collection access are denied', async () => {
  await assertFails(deleteDoc(ref(db('alice'), progress, 'alice')));
  await assertFails(deleteDoc(ref(db('owner'), progress, 'owner')));
  await assertFails(setDoc(doc(db('owner'), 'unexpected', 'value'), {enabled:true}));
  await assertFails(setDoc(doc(db('alice'), members, 'alice', 'private', 'value'), {enabled:true}));
  await assertFails(getDoc(doc(db('owner'), 'unexpected', 'value')));
});

test('unauthenticated clients cannot access books, assignments or per-book progress', async () => {
  await seedBookAccess();
  const database = anonymous();
  for (const [group, id] of [[books,'book-one'], [assignments,'alice']]) {
    await assertFails(getDoc(ref(database, group, id)));
    await assertFails(getDocs(query(collection(database, group), limit(10))));
  }
  await assertFails(setDoc(ref(database, books, 'new-book'), book()));
  await assertFails(setDoc(ref(database, assignments, 'new-student'), assignment('new-student')));
  await assertFails(getDoc(bookProgressRef(database, 'alice')));
  await assertFails(setDoc(bookProgressRef(database, 'alice'), record('alice')));
});

test('only enabled administrators may create or update books and no clients may delete them', async () => {
  const admin = db('owner');
  await assertSucceeds(setDoc(ref(admin, books, 'new-book'), book()));
  await assertSucceeds(updateDoc(ref(admin, books, 'new-book'), {title:'수정한 단어장', revision:2, updatedAt:serverTimestamp()}));
  for (const actor of [db('alice'), db('disabled-admin'), db('bob', {admin:true})]) {
    await assertFails(setDoc(ref(actor, books, 'other-book'), book()));
    await assertFails(updateDoc(ref(actor, books, 'new-book'), {title:'권한 없는 변경', revision:3, updatedAt:serverTimestamp()}));
    await assertFails(deleteDoc(ref(actor, books, 'new-book')));
  }
  await assertFails(deleteDoc(ref(admin, books, 'new-book')));
});

test('book library listing is administrator-only and bounded to 200 documents', async () => {
  await seedBookAccess();
  await assertSucceeds(getDocs(query(collection(db('owner'), books), limit(200))));
  await assertFails(getDocs(collection(db('owner'), books)));
  await assertFails(getDocs(query(collection(db('owner'), books), limit(201))));
  for (const actor of [db('alice'), db('paused'), db('disabled-admin')]) {
    await assertFails(getDocs(query(collection(actor, books), limit(1))));
  }
});

test('book reads require a current assignment and active member or administrator status', async () => {
  await seedBookAccess();
  await assertSucceeds(getDoc(ref(db('alice'), books, 'book-one')));
  await assertSucceeds(getDoc(ref(db('bob'), books, 'book-two')));
  await assertSucceeds(getDoc(ref(db('owner'), books, 'book-two')));
  await assertFails(getDoc(ref(db('alice'), books, 'book-two')));
  await assertFails(getDoc(ref(db('bob'), books, 'book-one')));
  await assertFails(getDoc(ref(db('paused'), books, 'book-one')));
  await seed(assignments, 'no-profile', assignment('no-profile', ['book-one'], {updatedAt:fixedTime()}));
  await assertFails(getDoc(ref(db('no-profile'), books, 'book-one')));
});

test('book envelope rejects wrong metadata types, lengths, counts and unapproved fields', async () => {
  const admin = db('owner');
  for (const mutation of [{title:''}, {title:'가'.repeat(121)}, {title:3}, {description:'가'.repeat(2001)},
    {description:null}, {sourceName:'가'.repeat(201)}, {sourceName:[]}, {words:[]}, {words:{}},
    {wordCount:0}, {wordCount:2}, {wordCount:'1'}, {revision:0}, {revision:2}, {revision:'1'}, {owner:'alice'}]) {
    await assertFails(setDoc(ref(admin, books, 'bad-book'), book(mutation)));
  }
  for (const key of Object.keys(book())) {
    const value = book(); delete value[key];
    await assertFails(setDoc(ref(admin, books, 'bad-book'), value));
  }
  await assertFails(setDoc(ref(admin, books, 'book.with.dot'), book()));
  await assertFails(setDoc(ref(admin, books, 'b'.repeat(129)), book()));
  await assertSucceeds(setDoc(ref(admin, books, 'minimal-book'), book({description:'', sourceName:''})));
});

test('books accept at most 1000 words with matching count', async () => {
  const words = Array.from({length:1000}, (_,index) => ({...book().words[0], id:'word-' + index}));
  await assertSucceeds(setDoc(ref(db('owner'), books, 'large-book'), book({words, wordCount:1000})));
  await assertFails(setDoc(ref(db('owner'), books, 'oversized-book'), book({words:[...words, {...words[0], id:'word-1000'}], wordCount:1001})));
});

test('book timestamps and revision changes prevent stale overwrites and creation-time mutation', async () => {
  await seed(books, 'book-one', book({}, false));
  const location = ref(db('owner'), books, 'book-one');
  for (const revision of [0,1,3,2.5,'2']) {
    await assertFails(updateDoc(location, {title:'잘못된 버전', revision, updatedAt:serverTimestamp()}));
  }
  await assertFails(updateDoc(location, {revision:2, createdAt:serverTimestamp(), updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(location, {revision:2, updatedAt:fixedTime()}));
  await assertFails(setDoc(ref(db('owner'), books, 'new-book'), book({}, false)));
  await assertSucceeds(updateDoc(location, {title:'두 번째 버전', revision:2, updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(location, {title:'다른 관리자의 오래된 버전', revision:2, updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(location, {title:'세 번째 버전', revision:3, updatedAt:serverTimestamp()}));
});

test('assignments may be read only by their active owner or an administrator and never listed', async () => {
  await seedBookAccess();
  await assertSucceeds(getDoc(ref(db('alice'), assignments, 'alice')));
  await assertSucceeds(getDoc(ref(db('owner'), assignments, 'alice')));
  await assertSucceeds(getDoc(ref(db('owner'), assignments, 'paused')));
  await assertFails(getDoc(ref(db('alice'), assignments, 'bob')));
  await assertFails(getDoc(ref(db('paused'), assignments, 'paused')));
  for (const actor of [db('owner'), db('alice')]) {
    await assertFails(getDocs(query(collection(actor, assignments), limit(20))));
  }
});

test('only administrators can assign books, including to suspended members', async () => {
  await seedBookAccess();
  for (const actor of [db('alice'), db('bob'), db('disabled-admin'), db('alice', {admin:true})]) {
    await assertFails(updateDoc(ref(actor, assignments, 'alice'), {bookIds:['book-one','book-two'], revision:2, updatedAt:serverTimestamp()}));
    await assertFails(setDoc(ref(actor, assignments, 'no-assignment'), assignment('no-assignment')));
  }
  await assertSucceeds(updateDoc(ref(db('owner'), assignments, 'alice'), {bookIds:['book-one','book-two'], revision:2, updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(db('owner'), assignments, 'paused'), {bookIds:['book-two'], revision:2, updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(ref(db('owner'), assignments, 'alice')));
  await assertFails(deleteDoc(ref(db('alice'), assignments, 'alice')));
});

test('administrators cannot assign books to absent, spoofed or protected administrator profiles', async () => {
  await seed(members, 'owner', profile('owner', {}, false));
  await seed(members, 'second-owner', profile('second-owner', {}, false));
  await seed(admins, 'second-owner', {enabled:true});
  await seed(members, 'spoof', profile('spoof', {role:'admin'}, false));
  for (const uid of ['no-profile','owner','second-owner','spoof']) {
    await assertFails(setDoc(ref(db('owner'), assignments, uid), assignment(uid)));
    await seed(assignments, uid, assignment(uid, [], {updatedAt:fixedTime()}));
    await assertFails(updateDoc(ref(db('owner'), assignments, uid), {bookIds:['book-one'], revision:2, updatedAt:serverTimestamp()}));
  }
});

test('assignment schema enforces identity, unique at most 20 IDs, exact keys and current server timestamps', async () => {
  const location = ref(db('owner'), assignments, 'alice');
  for (const mutation of [{userId:'bob'}, {bookIds:'book-one'}, {bookIds:['book-one','book-one']},
    {bookIds:Array.from({length:21}, (_,i) => 'book-' + i)}, {revision:0}, {revision:2}, {revision:'1'},
    {updatedAt:fixedTime()}, {enabled:true}]) {
    await assertFails(setDoc(location, assignment('alice', ['book-one'], mutation)));
  }
  for (const key of Object.keys(assignment('alice'))) {
    const value = assignment('alice'); delete value[key];
    await assertFails(setDoc(location, value));
  }
  // Validate every slot, especially the 20th: no unchecked suffix can grant access.
  for (let index = 0; index < 20; index++) {
    const ids = Array.from({length:20}, (_,i) => 'book-' + i); ids[index] = index % 2 ? 42 : '../other-book';
    await assertFails(setDoc(location, assignment('alice', ids)));
  }
  await assertFails(setDoc(location, assignment('alice', [''])));
  await assertFails(setDoc(location, assignment('alice', ['b'.repeat(129)])));
});

test('twenty-book assignments and empty removal fit rule lookup limits', async () => {
  const ids = Array.from({length:20}, (_,i) => 'book-' + i);
  await environment.withSecurityRulesDisabled(context => Promise.all(ids.map(id => setDoc(ref(context.firestore(), books, id), book({}, false)))));
  const admin = db('owner');
  const location = ref(admin, assignments, 'alice');
  // The adapter checks selected books in the same transaction as the assignment.
  await assertSucceeds(runTransaction(admin, async transaction => {
    for (const id of ids) assert.equal((await transaction.get(ref(admin, books, id))).exists(), true);
    transaction.set(location, assignment('alice', ids));
  }));
  await assertSucceeds(getDoc(ref(db('alice'), books, ids[19])));
  await assertSucceeds(updateDoc(location, {bookIds:[], revision:2, updatedAt:serverTimestamp()}));
  await assertFails(getDoc(ref(db('alice'), books, ids[19])));
});

test('assignment revisions reject stale or skipped versions without changing user identity', async () => {
  await seedBookAccess();
  const location = ref(db('owner'), assignments, 'alice');
  for (const revision of [0,1,3,2.5,'2']) {
    await assertFails(updateDoc(location, {bookIds:[], revision, updatedAt:serverTimestamp()}));
  }
  await assertFails(updateDoc(location, {userId:'bob', revision:2, updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(location, {bookIds:['book-two'], revision:2, updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(location, {bookIds:['book-one'], revision:2, updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(location, {bookIds:[], revision:3, updatedAt:serverTimestamp()}));
});

test('assigned active members can read and write only their own per-book progress', async () => {
  await seedBookAccess();
  await assertSucceeds(getDoc(bookProgressRef(db('alice'), 'alice')));
  await assertSucceeds(setDoc(bookProgressRef(db('alice'), 'alice'), record('alice')));
  await assertSucceeds(setDoc(bookProgressRef(db('bob'), 'bob', 'book-two'), record('bob', 'leaf')));
  await assertFails(getDoc(bookProgressRef(db('alice'), 'bob', 'book-two')));
  await assertFails(setDoc(bookProgressRef(db('alice'), 'bob', 'book-two'), record('bob', 'leaf')));
  await assertFails(getDoc(bookProgressRef(db('alice'), 'alice', 'book-two')));
  await assertFails(setDoc(bookProgressRef(db('alice'), 'alice', 'book-two'), record('alice')));
});

test('per-book progress requires a real book, active profile and current assignment', async () => {
  await seedBookAccess();
  for (const uid of ['paused','no-profile','disabled-admin']) {
    await assertFails(getDoc(bookProgressRef(db(uid), uid)));
    await assertFails(setDoc(bookProgressRef(db(uid), uid), record(uid, uid === 'paused' ? 'tree' : 'sprout')));
  }
  await seed(assignments, 'alice', assignment('alice', ['missing-book'], {updatedAt:fixedTime()}));
  await assertFails(setDoc(bookProgressRef(db('alice'), 'alice', 'missing-book'), record('alice')));
  await assertFails(getDoc(bookProgressRef(db('alice'), 'alice', 'missing-book')));
  await assertFails(setDoc(bookProgressRef(db('owner'), 'owner', 'missing-book'), record('owner')));
});

test('removing a book assignment or suspending its member revokes existing book and progress access immediately', async () => {
  await seedBookAccess();
  const alice = db('alice'), admin = db('owner');
  await assertSucceeds(getDoc(ref(alice, books, 'book-one')));
  await assertSucceeds(getDoc(bookProgressRef(alice, 'alice')));
  await assertSucceeds(updateDoc(ref(admin, assignments, 'alice'), {bookIds:[], revision:2, updatedAt:serverTimestamp()}));
  await assertFails(getDoc(ref(alice, books, 'book-one')));
  await assertFails(getDoc(bookProgressRef(alice, 'alice')));
  await assertFails(setDoc(bookProgressRef(alice, 'alice'), record('alice')));
  await assertSucceeds(updateDoc(ref(admin, assignments, 'alice'), {bookIds:['book-one'], revision:3, updatedAt:serverTimestamp()}));
  await assertSucceeds(getDoc(bookProgressRef(alice, 'alice')));
  await assertSucceeds(updateDoc(ref(admin, members, 'alice'), {status:'suspended', updatedAt:serverTimestamp()}));
  await assertFails(getDoc(ref(alice, books, 'book-one')));
  await assertFails(getDoc(ref(alice, assignments, 'alice')));
  await assertFails(getDoc(bookProgressRef(alice, 'alice')));
  await assertFails(setDoc(bookProgressRef(alice, 'alice'), record('alice')));
  await assertSucceeds(getDoc(bookProgressRef(admin, 'alice')));
});

test('administrators may report any member book progress but write only their own', async () => {
  await seedBookAccess();
  const admin = db('owner');
  await assertSucceeds(getDoc(bookProgressRef(admin, 'alice')));
  await assertSucceeds(getDoc(bookProgressRef(admin, 'paused')));
  await assertSucceeds(setDoc(bookProgressRef(admin, 'owner'), record('owner', 'forest')));
  await assertSucceeds(getDoc(bookProgressRef(admin, 'owner')));
  await assertFails(setDoc(bookProgressRef(admin, 'alice'), record('alice')));
  await assertFails(updateDoc(bookProgressRef(admin, 'alice'), {updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(bookProgressRef(admin, 'alice')));
  await assertFails(deleteDoc(bookProgressRef(db('alice'), 'alice')));
});

test('per-book progress cannot be listed or enumerated via collection-group queries', async () => {
  await seedBookAccess();
  for (const actor of [db('owner'), db('alice')]) {
    await assertFails(getDocs(query(collection(actor, progress, 'alice', 'books'), limit(20))));
    await assertFails(getDocs(query(collectionGroup(actor, 'books'), limit(20))));
  }
});

test('per-book progress retains ownership, grade level, payload and server-timestamp validation', async () => {
  await seedBookAccess();
  const location = bookProgressRef(db('alice'), 'alice');
  await assertFails(setDoc(location, record('bob')));
  await assertFails(setDoc(location, record('alice', 'forest')));
  await assertFails(setDoc(location, record('alice', 'sprout', {updatedAt:fixedTime()})));
  await assertFails(setDoc(location, record('alice', 'sprout', {bookId:'book-two'})));
  const mismatch = record('alice'); mismatch.payload.level = 'leaf';
  await assertFails(setDoc(location, mismatch));
  const badScore = record('alice'); badScore.payload.gameBest.easy = -1;
  await assertFails(setDoc(location, badScore));
  const tooMany = record('alice'); tooMany.payload.words = Object.fromEntries(Array.from({length:1001}, (_,i) => ['word-' + i, {}]));
  await assertFails(setDoc(location, tooMany));
  await assertSucceeds(updateDoc(ref(db('owner'), members, 'alice'), {grade:'m1', updatedAt:serverTimestamp()}));
  await assertFails(setDoc(location, record('alice')));
  await assertSucceeds(setDoc(location, record('alice', 'tree')));
});

test('separate book documents support more than 1000 total word records without mixing progress', async () => {
  await seedBookAccess();
  await assertSucceeds(updateDoc(ref(db('owner'), assignments, 'alice'), {bookIds:['book-one','book-two'], revision:2, updatedAt:serverTimestamp()}));
  const first = record('alice'); first.payload.words = Object.fromEntries(Array.from({length:620}, (_,i) => ['a-' + i, {known:true}]));
  const second = record('alice'); second.payload.words = Object.fromEntries(Array.from({length:620}, (_,i) => ['b-' + i, {wrong:true}]));
  await assertSucceeds(setDoc(bookProgressRef(db('alice'), 'alice', 'book-one'), first));
  await assertSucceeds(setDoc(bookProgressRef(db('alice'), 'alice', 'book-two'), second));
  const a = await assertSucceeds(getDoc(bookProgressRef(db('alice'), 'alice', 'book-one')));
  const b = await assertSucceeds(getDoc(bookProgressRef(db('alice'), 'alice', 'book-two')));
  assert.equal(Object.keys(a.data().payload.words).length + Object.keys(b.data().payload.words).length, 1240);
  assert.equal(Object.hasOwn(a.data().payload.words, 'b-0'), false);
  assert.equal(Object.hasOwn(b.data().payload.words, 'a-0'), false);
});

test('administrator revocation immediately removes book publishing, assignment and reporting privileges', async () => {
  await seedBookAccess();
  const admin = db('owner');
  await assertSucceeds(getDoc(ref(admin, books, 'book-one')));
  await seed(admins, 'owner', {enabled:false});
  await assertFails(getDoc(ref(admin, books, 'book-one')));
  await assertFails(setDoc(ref(admin, books, 'new-book'), book()));
  await assertFails(updateDoc(ref(admin, assignments, 'alice'), {bookIds:[], revision:2, updatedAt:serverTimestamp()}));
  await assertFails(getDoc(bookProgressRef(admin, 'alice')));
});
