const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Data = require('./production-issues-data.js');

const flush = () => new Promise(resolve => setImmediate(resolve));
const USER = { uid: 'user-a', email: 'member@example.com', displayName: 'Team Member' };
const baseRecord = overrides => ({ id: 'record-a', scanDate: '2026-10-22', createdAt: '2026-10-22T04:00:00.000Z',
  sapPN: '17001', description: 'Product A', lotCardNo: 'LOT-001', equipmentId: 'A07', process: 'FOL',
  defect: 'Scratch', quantity: 30, inspector: 'Q01', inspectorName: 'Quality Member', ...overrides });
const cycle = overrides => ({ number: 1, disposition: 'Sorting', assignedDate: '2026-10-22', ...overrides });
const workflow = (status, current, extra = {}) => ({ version: 2, status, cycle: 1, cycles: [cycle(current)], ...extra });
const wrapper = record => ({ id: record.id, data: () => ({ record, action: 'create', version: 1,
  updatedBy: 'user-a', updatedAt: { toMillis: () => Date.now() } }) });
const recordsSnapshot = (records, metadata = {}) => ({ docs: records.map(wrapper), metadata });
const memberSnapshot = (role = 'quality', extra = {}, metadata = {}) => ({
  exists: () => !!role, data: () => ({ email: USER.email, role, ...extra }), metadata
});

function harness({ user = USER, claims, existingApp = true } = {}) {
  const subscriptions = [], calls = [], status = [], records = [], errors = [];
  const auth = { currentUser: user, authStateReady: async () => {} };
  const app = { name: 'peak-inspection-parts-peak-inspection-parts', options: Data.CONFIG };
  let authListener, authError, popupResolve;
  const sdk = {
    getApps: () => existingApp ? [app] : [],
    initializeApp: (config, name) => { calls.push(['initializeApp', config, name]); return app; },
    getAuth: () => auth, getFirestore: () => ({}),
    onIdTokenChanged: (_, next, error) => {
      authListener = next; authError = error; queueMicrotask(() => next(auth.currentUser));
      return () => calls.push(['auth-unsubscribe']);
    },
    getIdTokenResult: async () => ({ claims: claims || { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }),
    doc: (_, collection, id) => ({ collection, id }), collection: (_, collection) => ({ collection }),
    onSnapshot: (ref, options, next, error) => {
      const listener = { ref, next, error, active: true }; subscriptions.push(listener);
      return () => { listener.active = false; };
    },
    getDocFromServer: async () => memberSnapshot(),
    getDocsFromServer: async () => recordsSnapshot([baseRecord()]),
    GoogleAuthProvider: class { setCustomParameters(parameters) { calls.push(['provider', parameters]); } },
    signInWithPopup: () => { calls.push(['popup']); return new Promise(resolve => { popupResolve = resolve; }); }
  };
  const service = Data.create({ loadSDK: async () => sdk });
  service.onStatus(value => status.push(value));
  service.subscribe(value => records.push(value), error => errors.push(error));
  const latest = collection => subscriptions.filter(listener => listener.ref.collection === collection && listener.active).at(-1);
  return { service, sdk, auth, calls, subscriptions, status, records, errors,
    latest, member: snapshot => latest('inspectionAccess').next(snapshot),
    send: snapshot => latest('inspectionRecords').next(snapshot),
    async authorize(role = 'quality') { await flush(); this.member(memberSnapshot(role)); await flush(); },
    async changeUser(next) { auth.currentUser = next; authListener(next); await flush(); },
    authFailure: error => authError(error), finishPopup: () => popupResolve({ user: USER }) };
}

test('Firebase config, app name and SDK version agree with DIPQC', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dipqc.html'), 'utf8');
  const match = source.match(/window\.PEAK_INSPECTION_CONFIG = Object\.freeze\((\{[^\n]+\})\);/);
  assert.ok(match); assert.deepEqual(Data.CONFIG, JSON.parse(match[1]).teamRecords.firebase);
  assert.ok(source.includes(`const SDK_VERSION='${Data.SDK_VERSION}'`));
  assert.ok(source.includes('name=`peak-inspection-parts-${settings.projectId}`'));
});

test('new record uses registration date and keeps missing equipment unassigned', () => {
  const row = Data.normalizeRecord(baseRecord({ equipmentId: undefined, issueDate: '2020-01-01' }));
  assert.equal(row.scanDate, '2026-10-22'); assert.equal(row.equipmentId, '');
  assert.equal(row.status, 'registered'); assert.equal(row.reworkRequested, false);
  assert.equal(row.statusLabel, '생산팀 처리 대기'); assert.equal(row.quantity, 30);
});

test('every workflow state follows DIPQC cycle decisions', async t => {
  const cases = [
    ['legacy production wait', workflow('production_pending', {}, { version: 1 }), 'production_pending', false, ''],
    ['production finished', workflow('quality_review', { production: { method: 'Sorting' } }), 'quality_review', false, ''],
    ['quality rejected', workflow('registered', { production: { method: 'Reinspection' }, quality: { result: 'NG' } }), 'registered', true, ''],
    ['quality passed', workflow('completed', { production: { method: 'Sorting' }, quality: { result: 'Pass', reinspectionDate: '2026-10-22' } }, { finalResult: 'Pass' }), 'completed', false, 'Pass'],
    ['legacy scrap', workflow('completed', { disposition: 'Scrap' }, { version: 1, finalResult: 'Scrap' }), 'completed', false, 'Scrap']
  ];
  for (const [name, value, state, rework, result] of cases) await t.test(name, () => {
    const row = Data.normalizeRecord(baseRecord({ workflow: value }));
    assert.equal(row.status, state); assert.equal(row.reworkRequested, rework); assert.equal(row.finalResult, result);
  });
});

test('legacy resolutions including NG are completed, preserving DIPQC historical semantics', () => {
  for (const result of ['Pass', 'Waive', 'MRB', 'NG', '기타']) {
    const row = Data.normalizeRecord(baseRecord({ resolution: { result, reinspectionDate: '2026-10-22', completedAt: '2026-10-22T05:00:00.000Z' } }));
    assert.equal(row.status, 'completed'); assert.equal(row.finalResult, result);
  }
});

test('custom method is preserved and private photo/barcode fields are omitted', () => {
  const row = Data.normalizeRecord(baseRecord({ qrRaw: 'secret QR', beforePhotos: [{ driveFileId: 'private' }],
    workflow: workflow('quality_review', { disposition: 'Other', production: { method: 'Other', customMethod: 'Deburr' } }) }));
  assert.equal(row.customMethod, 'Deburr'); assert.equal(row.method, 'Other');
  assert.equal(row.qrRaw, undefined); assert.equal(row.beforePhotos, undefined); assert.equal(row.workflow, undefined);
});

test('corrupt or contradictory states cannot be presented as completed', () => {
  for (const record of [baseRecord({ workflow: workflow('completed', { production: { method: 'Sorting' } }, { finalResult: 'Pass' }) }),
    baseRecord({ workflow: workflow('registered', { production: { method: 'Sorting' }, quality: { result: 'Pass' } }) }),
    baseRecord({ workflow: workflow('completed', { disposition: 'Scrap', production: {} }, { version: 1, finalResult: 'Scrap' }) }),
    baseRecord({ resolution: null }), baseRecord({ quantity: -1 }), baseRecord({ scanDate: '2026-02-30' })]) {
    assert.throws(() => Data.normalizeRecord(record), /확인/);
  }
});

test('list is newest first and rejects duplicate registration ids', () => {
  const rows = Data.normalizeRecords([baseRecord({ id: 'old', createdAt: '2026-10-20T01:00:00.000Z' }), baseRecord()]);
  assert.equal(rows[0].id, 'record-a'); assert.throws(() => Data.normalizeRecords([baseRecord(), baseRecord()]));
});

test('existing DIPQC Firebase app is reused and initial status stays loading until trusted data', async () => {
  const h = harness(); await h.authorize();
  assert.equal(h.calls.filter(call => call[0] === 'initializeApp').length, 0);
  assert.equal(h.service.getStatus().loading, true);
  h.send(recordsSnapshot([baseRecord()]));
  assert.equal(h.service.getStatus().loading, false); assert.equal(h.service.getStatus().online, true);
  assert.equal(h.records.at(-1).length, 1); h.service.destroy();
});

test('signed-out and unapproved users never subscribe to private records', async () => {
  const signedOut = harness({ user: null }); await flush();
  assert.equal(signedOut.service.getStatus().signedIn, false); assert.equal(signedOut.service.getStatus().loading, false);
  assert.equal(signedOut.subscriptions.length, 0); signedOut.service.destroy();
  const unapproved = harness(); await unapproved.authorize('');
  assert.equal(unapproved.latest('inspectionRecords'), undefined); assert.equal(unapproved.service.getStatus().role, '');
  assert.equal(unapproved.service.getStatus().loading, false); unapproved.service.destroy();
});

test('all approved roles may read; absent alias remains compatible with DIPQC read access', async () => {
  for (const role of Data.ROLES) {
    const h = harness(); await h.authorize(role);
    assert.ok(h.latest('inspectionRecords')); assert.equal(h.service.getStatus().role, role); h.service.destroy();
  }
});

test('Google verified-email claims are required before checking membership', async () => {
  for (const claims of [{ email_verified: false, firebase: { sign_in_provider: 'google.com' } },
    { email_verified: true, firebase: { sign_in_provider: 'password' } }]) {
    const h = harness({ claims }); await flush();
    assert.equal(h.subscriptions.length, 0); assert.match(h.service.getStatus().error.code, /auth-required/); h.service.destroy();
  }
});

test('member validation exactly rejects malformed alias, email and production manager roles', async () => {
  for (const extra of [{ alias: '' }, { alias: ' Q01' }, { alias: 'Q\n01' }, { email: 'wrong@example.com' }, { productionManager: true }, { productionManager: 'true' }]) {
    const h = harness(); await flush(); h.member(memberSnapshot('quality', extra));
    assert.equal(h.latest('inspectionRecords'), undefined); assert.match(h.service.getStatus().error.code, /permission-denied/); h.service.destroy();
  }
});

test('account changes clear private rows immediately and ignore delayed old snapshots', async () => {
  const h = harness(); await h.authorize(); h.send(recordsSnapshot([baseRecord()]));
  const old = h.latest('inspectionRecords');
  await h.changeUser({ uid: 'user-b', email: 'other@example.com' });
  assert.deepEqual(h.records.at(-1), []); assert.equal(old.active, false);
  old.next(recordsSnapshot([baseRecord()])); assert.deepEqual(h.records.at(-1), []); h.service.destroy();
});

test('revocation and logout clear data and ignore late record responses', async () => {
  const h = harness(); await h.authorize(); h.send(recordsSnapshot([baseRecord()]));
  const old = h.latest('inspectionRecords'); h.member(memberSnapshot(''));
  assert.deepEqual(h.records.at(-1), []); assert.equal(h.service.getStatus().role, '');
  old.next(recordsSnapshot([baseRecord()])); assert.deepEqual(h.records.at(-1), []);
  await h.changeUser(null); assert.equal(h.service.getStatus().signedIn, false); assert.deepEqual(h.records.at(-1), []); h.service.destroy();
});

test('cache-only snapshots never become trusted data; disconnection marks previous server rows stale', async () => {
  const h = harness(); await h.authorize();
  h.send(recordsSnapshot([baseRecord()], { fromCache: true }));
  assert.deepEqual(h.records.at(-1), []); assert.equal(h.service.getStatus().online, false);
  h.send(recordsSnapshot([baseRecord()]));
  h.send(recordsSnapshot([], { fromCache: true }));
  assert.equal(h.records.at(-1).length, 1); assert.equal(h.service.getStatus().stale, true);
  h.send(recordsSnapshot([])); assert.equal(h.records.at(-1).length, 0); assert.equal(h.service.getStatus().stale, false); h.service.destroy();
});

test('cached membership suspends private subscription, then trusted membership reconnects once', async () => {
  const h = harness(); await h.authorize(); h.send(recordsSnapshot([baseRecord()]));
  h.member(memberSnapshot('quality', {}, { fromCache: true }));
  assert.equal(h.latest('inspectionRecords'), undefined); assert.equal(h.service.getStatus().stale, true);
  h.member(memberSnapshot()); h.member(memberSnapshot());
  assert.equal(h.subscriptions.filter(value => value.active && value.ref.collection === 'inspectionRecords').length, 1); h.service.destroy();
});

test('permission-denied stream errors clear private rows and authority', async () => {
  const h = harness(); await h.authorize(); h.send(recordsSnapshot([baseRecord()]));
  h.latest('inspectionRecords').error(Object.assign(new Error('Denied'), { code: 'permission-denied' }));
  assert.deepEqual(h.records.at(-1), []); assert.equal(h.service.getStatus().role, ''); assert.equal(h.service.getStatus().stale, false); h.service.destroy();
});

test('malformed server envelope is not exposed as a successful list', async () => {
  const h = harness(); await h.authorize();
  h.send({ docs: [{ id: 'record-a', data: () => ({ record: baseRecord() }) }], metadata: {} });
  assert.deepEqual(h.records.at(-1), []); assert.match(h.service.getStatus().error.code, /invalid-data/); h.service.destroy();
});

test('retry replaces subscriptions and destroy releases every active listener', async () => {
  const h = harness(); await h.authorize();
  for (let i = 0; i < 3; i++) { await h.service.retry(); h.member(memberSnapshot()); }
  assert.equal(h.subscriptions.filter(value => value.active && value.ref.collection === 'inspectionAccess').length, 1);
  assert.equal(h.subscriptions.filter(value => value.active && value.ref.collection === 'inspectionRecords').length, 1);
  h.service.destroy(); assert.equal(h.subscriptions.filter(value => value.active).length, 0);
  assert.ok(h.calls.some(call => call[0] === 'auth-unsubscribe')); await assert.rejects(h.service.retry(), /종료/);
});

test('Google login launches once per pending attempt without any Firestore writes', async () => {
  const h = harness({ user: null }); await flush();
  const first = h.service.signIn(), second = h.service.signIn();
  assert.equal(first, second); assert.equal(h.calls.filter(call => call[0] === 'popup').length, 1);
  h.finishPopup(); await first; assert.deepEqual(h.calls.find(call => call[0] === 'provider')[1], { prompt: 'select_account' }); h.service.destroy();
});

test('explicit reads require server membership and server records', async () => {
  const h = harness(); await h.authorize();
  const result = await h.service.read(); assert.equal(result.length, 1);
  h.sdk.getDocFromServer = async () => memberSnapshot(''); await assert.rejects(h.service.read(), /권한/);
  h.sdk.getDocFromServer = async () => memberSnapshot(); h.sdk.getDocsFromServer = async () => recordsSnapshot([], { fromCache: true });
  await assert.rejects(h.service.read(), /서버 연결/); h.service.destroy();
});

test('revocation while an explicit server read is pending prevents late data disclosure', async () => {
  const h = harness(); await h.authorize(); let resolve;
  h.sdk.getDocsFromServer = () => new Promise(value => { resolve = value; });
  const request = h.service.read(); await flush(); h.member(memberSnapshot(''));
  resolve(recordsSnapshot([baseRecord()])); await assert.rejects(request, /권한이 변경/);
  assert.deepEqual(h.records.at(-1), []); h.service.destroy();
});

test('recordsReady distinguishes a confirmed empty list from loading, errors and signed-out state', async () => {
  const h = harness(); await h.authorize();
  assert.equal(h.service.getStatus().recordsReady, false);
  h.send(recordsSnapshot([])); assert.equal(h.service.getStatus().recordsReady, true);
  h.send(recordsSnapshot([], { fromCache: true })); assert.equal(h.service.getStatus().recordsReady, true);
  await h.changeUser(null); assert.equal(h.service.getStatus().recordsReady, false); h.service.destroy();
});

test('failed explicit authorization immediately removes previously displayed private rows', async () => {
  const h = harness(); await h.authorize(); h.send(recordsSnapshot([baseRecord()]));
  h.sdk.getDocFromServer = async () => memberSnapshot('');
  await assert.rejects(h.service.read(), /권한/);
  assert.deepEqual(h.records.at(-1), []); assert.equal(h.service.getStatus().recordsReady, false); h.service.destroy();
});

test('revocation while membership read is pending cannot revive stale permission', async () => {
  const h = harness(); await h.authorize(); let resolve, recordReads = 0;
  h.sdk.getDocFromServer = () => new Promise(value => { resolve = value; });
  h.sdk.getDocsFromServer = async () => { recordReads++; return recordsSnapshot([baseRecord()]); };
  const request = h.service.read(); await flush(); h.member(memberSnapshot(''));
  resolve(memberSnapshot()); await assert.rejects(request, /권한이 변경/);
  assert.equal(recordReads, 0); assert.deepEqual(h.records.at(-1), []); h.service.destroy();
});

test('destroy during SDK loading cannot create a Firebase session or listener later', async () => {
  let resolve, calls = 0;
  const service = Data.create({ loadSDK: () => new Promise(value => { resolve = value; }) });
  service.onStatus(() => calls++); service.subscribe(() => calls++);
  service.destroy(); resolve({ getApps() { throw new Error('SDK was used after destroy'); } });
  await flush(); assert.equal(calls, 0); await assert.rejects(service.signIn(), /종료/);
});

test('destroy during token verification prevents delayed membership subscription', async () => {
  const h = harness(); let resolve;
  h.sdk.getIdTokenResult = () => new Promise(value => { resolve = value; });
  await flush(); h.service.destroy();
  resolve({ claims: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
  await flush(); assert.equal(h.subscriptions.length, 0);
});
