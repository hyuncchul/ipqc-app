/* Read-only DIPQC issue feed. The Firebase identity and team access rules are shared with dipqc.html. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionIssuesData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const SDK_VERSION = '12.19.0';
  const CONFIG = Object.freeze({
    apiKey: 'AIzaSyDLWS1ondgxY8bHnJOe-uq-pnT6d0RRa2w',
    authDomain: 'peak-inspection-parts.firebaseapp.com',
    projectId: 'peak-inspection-parts',
    storageBucket: 'peak-inspection-parts.firebasestorage.app',
    messagingSenderId: '35985365252',
    appId: '1:35985365252:web:bedd9660e37130990e9851'
  });
  const COLLECTION = 'inspectionRecords';
  const ROLES = Object.freeze(['admin', 'quality', 'production']);
  const STATUSES = Object.freeze(['registered', 'production_pending', 'quality_review', 'completed']);
  const LABELS = Object.freeze({ registered: '생산팀 처리 대기', production_pending: '생산팀 처리 대기', quality_review: '품질 재검사 대기', completed: '처리 완료' });
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const email = value => String(value || '').trim().toLowerCase();
  const validEmail = value => typeof value === 'string' && value === email(value) && value.length <= 254 && /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(value);
  const validAlias = value => typeof value === 'string' && value.length > 0 && value.length <= 80 && value === value.trim() && !/[\r\n\t]/.test(value);
  const fail = (code, message) => Object.assign(new Error(message), { code: `production-issues/${code}` });
  const text = (value, maximum = 10000) => typeof value === 'string' && value.length <= maximum ? value : '';
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && timestamp(value) && new Date(value).toISOString().slice(0, 10) === value;

  // Only display fields are projected; photos, tokens and raw barcode payloads are never cached here.
  function normalizeRecord(record) {
    if (!object(record) || typeof record.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(record.id) ||
        !validDate(record.scanDate) || !timestamp(record.createdAt) ||
        !['sapPN', 'description', 'lotCardNo', 'defect'].every(key => text(record[key]).trim()) ||
        !['FOL', 'EOL', 'OQC'].includes(record.process) || !Number.isSafeInteger(record.quantity) ||
        record.quantity < 1 || record.quantity > 999999999) throw fail('invalid-data', '공유 불량 기록 형식을 확인해 주세요.');
    let status = 'registered', cycle = null, finalResult = '', completedDate = '';
    if (record.workflow !== undefined) {
      const workflow = record.workflow;
      if (!object(workflow) || ![1, 2].includes(workflow.version) || !STATUSES.includes(workflow.status) ||
          !Array.isArray(workflow.cycles) || workflow.cycles.length < 1 || workflow.cycles.length > 100 ||
          workflow.cycle !== workflow.cycles.length || record.resolution !== undefined) throw fail('invalid-data', '불량 처리 상태를 확인해 주세요.');
      cycle = workflow.cycles.at(-1);
      if (!object(cycle) || cycle.number !== workflow.cycle ||
          !['Rework', 'Reinspection', 'Sorting', 'Scrap', 'Other'].includes(cycle.disposition) ||
          (cycle.production !== undefined && !object(cycle.production)) ||
          (cycle.quality !== undefined && (!object(cycle.quality) || !cycle.production || !['Pass', 'NG'].includes(cycle.quality.result))) ||
          (workflow.version === 2 && !['Reinspection', 'Sorting', 'Scrap', 'Other'].includes(cycle.production?.method))) throw fail('invalid-data', '불량 처리 상태를 확인해 주세요.');
      const legacyScrap = cycle.disposition === 'Scrap' && !cycle.production?.method;
      if (legacyScrap && (cycle.production !== undefined || cycle.quality !== undefined)) throw fail('invalid-data', '불량 처리 상태를 확인해 주세요.');
      const expected = legacyScrap ? 'completed' : cycle.quality ? (cycle.quality.result === 'Pass' ? 'completed' : 'registered') : cycle.production ? 'quality_review' : 'production_pending';
      const expectedResult = legacyScrap ? 'Scrap' : cycle.quality?.result === 'Pass' ? 'Pass' : undefined;
      if (workflow.status !== expected || workflow.finalResult !== expectedResult) throw fail('invalid-data', '불량 처리 상태를 확인해 주세요.');
      status = workflow.status;
      finalResult = workflow.finalResult || '';
      completedDate = status === 'completed' ? text(cycle.quality?.reinspectionDate || cycle.assignedDate, 10) : '';
    } else if (record.resolution !== undefined) {
      const resolution = record.resolution;
      if (!object(resolution) || !['Pass', 'Waive', 'MRB', 'NG', '기타'].includes(resolution.result) ||
          !validDate(resolution.reinspectionDate) || !timestamp(resolution.completedAt)) throw fail('invalid-data', '불량 처리 결과를 확인해 주세요.');
      status = 'completed'; finalResult = resolution.result; completedDate = resolution.reinspectionDate;
    }
    const reworkRequested = status === 'registered' && record.workflow !== undefined;
    return Object.freeze({
      id: record.id, scanDate: record.scanDate, createdAt: record.createdAt,
      equipmentId: text(record.equipmentId, 80).trim(), sapPN: record.sapPN,
      description: record.description, lotCardNo: record.lotCardNo, process: record.process,
      defect: record.defect, quantity: record.quantity,
      inspector: text(record.inspector, 80), inspectorName: text(record.inspectorName, 120),
      status, statusLabel: reworkRequested ? '재처리 요청' : LABELS[status], reworkRequested,
      method: text(cycle?.production?.method || cycle?.disposition, 120),
      customMethod: text(cycle?.production?.customMethod, 120),
      cycle: record.workflow?.cycle || 0, finalResult, completedDate
    });
  }
  function normalizeRecords(records) {
    if (!Array.isArray(records)) throw fail('invalid-data', '공유 불량 목록 형식을 확인해 주세요.');
    const list = records.map(normalizeRecord);
    if (new Set(list.map(record => record.id)).size !== list.length) throw fail('invalid-data', '중복된 불량 등록 번호를 확인해 주세요.');
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  function memberFrom(snapshot, address) {
    if (!snapshot.exists()) return null;
    const value = snapshot.data();
    if (!object(value) || value.email !== address || !ROLES.includes(value.role) ||
        ('alias' in value && !validAlias(value.alias)) ||
        ('productionManager' in value && (typeof value.productionManager !== 'boolean' || value.productionManager && !['admin', 'production'].includes(value.role)))) throw fail('permission-denied', '검사 기록 사용 권한을 확인해 주세요.');
    return value;
  }
  function unwrap(snapshot) {
    const value = snapshot.data();
    if (!object(value) || Object.keys(value).sort().join(',') !== 'action,record,updatedAt,updatedBy,version' ||
        !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.updatedBy !== 'string' ||
        typeof value.updatedAt?.toMillis !== 'function' || !['create', 'import', 'production', 'review', 'reassign'].includes(value.action) ||
        value.record?.id !== snapshot.id) throw fail('invalid-data', '공유 불량 기록을 확인할 수 없습니다.');
    return value.record;
  }
  let sdkPromise;
  function loadDefault() {
    if (!sdkPromise) sdkPromise = Promise.all(['app', 'auth', 'firestore'].map(name =>
      import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${name}.js`)
    )).then(modules => Object.assign({}, ...modules)).catch(error => { sdkPromise = null; throw error; });
    return sdkPromise;
  }

  function create({ config = CONFIG, loadSDK = loadDefault } = {}) {
    let env, initialization, destroyed = false, authGeneration = 0, recordGeneration = 0;
    let authStop, memberStop, recordsStop, signInPromise;
    let rows = [], hasServerRows = false;
    let status = Object.freeze({ ready: false, recordsReady: false, signedIn: false, email: '', displayName: '', role: '', online: false, stale: false, loading: true, error: null });
    const statusListeners = new Set(), listeners = new Set();
    function emitStatus(patch) {
      if (destroyed) return;
      status = Object.freeze({ ...status, ...patch });
      for (const listener of statusListeners) { try { listener(status); } catch (_) {} }
    }
    function emitRows(next) {
      rows = Object.freeze(next.slice());
      for (const listener of listeners) { try { listener.next(rows.slice()); } catch (_) {} }
    }
    function emitError(error) {
      for (const listener of listeners) { try { listener.error(error); } catch (_) {} }
    }
    function stopRecords() { recordGeneration++; recordsStop?.(); recordsStop = null; }
    function clearRecords() { stopRecords(); hasServerRows = false; emitRows([]); }
    function current(user, generation) {
      return !destroyed && generation === authGeneration && env?.auth.currentUser?.uid === user?.uid && email(env?.auth.currentUser?.email) === email(user?.email);
    }
    function server(snapshot) {
      if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) throw fail('offline', '서버 연결이 끊어졌습니다. 마지막 확인 목록을 표시합니다.');
    }
    function connectionError(error, clear = false) {
      if (clear) clearRecords();
      emitStatus({ ready: true, online: false, loading: false, stale: hasServerRows, error, ...(clear ? { role: '', recordsReady: false } : {}) });
      emitError(error);
    }
    async function verified(user) {
      if (!user || !validEmail(email(user.email))) throw fail('auth-required', 'Google 계정으로 로그인해 주세요.');
      const token = await env.sdk.getIdTokenResult(user);
      if (token.claims?.email_verified !== true || token.claims?.firebase?.sign_in_provider !== 'google.com') throw fail('auth-required', '이메일이 확인된 Google 계정으로 로그인해 주세요.');
    }
    function startRecords(user, generation) {
      stopRecords();
      const revision = recordGeneration;
      recordsStop = env.sdk.onSnapshot(env.sdk.collection(env.db, COLLECTION), { includeMetadataChanges: true }, snapshot => {
        if (!current(user, generation) || revision !== recordGeneration || !status.role) return;
        if (snapshot.metadata?.hasPendingWrites) return;
        if (snapshot.metadata?.fromCache) { connectionError(fail('offline', '서버 연결이 끊어졌습니다. 마지막 확인 목록을 표시합니다.')); return; }
        try {
          const next = normalizeRecords(snapshot.docs.map(unwrap));
          hasServerRows = true; emitRows(next);
          emitStatus({ ready: true, recordsReady: true, online: true, loading: false, stale: false, error: null });
        } catch (error) { connectionError(error); }
      }, error => {
        if (!current(user, generation) || revision !== recordGeneration) return;
        stopRecords();
        connectionError(error, /permission-denied|unauthenticated/.test(error.code || ''));
      });
    }
    async function authChanged(user) {
      if (destroyed) return;
      const generation = ++authGeneration;
      memberStop?.(); memberStop = null;
      // Recheck authority on every token change. Private rows cannot cross identities.
      clearRecords();
      emitStatus({ ready: !user, recordsReady: false, signedIn: !!user, email: email(user?.email), displayName: user?.displayName || '', role: '', online: false, stale: false, loading: !!user, error: null });
      if (!user) return;
      try {
        await verified(user);
        if (!current(user, generation)) return;
        memberStop = env.sdk.onSnapshot(env.sdk.doc(env.db, 'inspectionAccess', email(user.email)), { includeMetadataChanges: true }, snapshot => {
          if (!current(user, generation)) return;
          if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) {
            stopRecords(); connectionError(fail('offline', '서버 연결을 확인해 주세요.')); return;
          }
          try {
            const member = memberFrom(snapshot, email(user.email));
            if (!member) {
              clearRecords();
              emitStatus({ ready: true, recordsReady: false, role: '', online: true, stale: false, loading: false, error: null }); return;
            }
            const changed = status.role !== member.role;
            emitStatus({ ready: true, role: member.role, online: true, stale: hasServerRows && status.stale, loading: !hasServerRows, error: null });
            if (changed || !recordsStop) startRecords(user, generation);
          } catch (error) { connectionError(error, true); }
        }, error => { if (current(user, generation)) connectionError(error, true); });
      } catch (error) { if (current(user, generation)) connectionError(error, true); }
    }
    function init() {
      if (destroyed) return Promise.reject(fail('destroyed', '목록 연결이 종료되었습니다.'));
      if (!initialization) initialization = (async () => {
        const sdk = await loadSDK();
        if (destroyed) throw fail('destroyed', '목록 연결이 종료되었습니다.');
        const name = `peak-inspection-parts-${config.projectId}`;
        const app = sdk.getApps().find(value => value.name === name) || sdk.initializeApp(config, name);
        if (app.options?.projectId !== config.projectId) throw fail('configuration', '공유 검사 기록 연결 설정을 확인해 주세요.');
        env = { sdk, app, auth: sdk.getAuth(app), db: sdk.getFirestore(app) };
        authStop = sdk.onIdTokenChanged(env.auth, authChanged, error => connectionError(error, true));
        return env;
      })().catch(error => {
        initialization = null;
        if (!destroyed) connectionError(error, true);
        throw error;
      });
      return initialization;
    }
    function onStatus(listener) {
      statusListeners.add(listener);
      queueMicrotask(() => { if (!destroyed && statusListeners.has(listener)) listener(status); });
      init().catch(() => {});
      return () => statusListeners.delete(listener);
    }
    function subscribe(next, error = () => {}) {
      const listener = { next, error }; listeners.add(listener);
      queueMicrotask(() => { if (!destroyed && listeners.has(listener)) next(rows.slice()); });
      init().catch(() => {});
      return () => listeners.delete(listener);
    }
    async function read() {
      const environment = await init();
      if (typeof environment.auth.authStateReady === 'function') await environment.auth.authStateReady();
      const user = environment.auth.currentUser, generation = authGeneration, revision = recordGeneration;
      try {
        await verified(user);
        const assertCurrent = () => {
          if (!current(user, generation)) throw fail('auth-changed', '로그인 상태가 변경되었습니다. 다시 조회해 주세요.');
          if (revision !== recordGeneration) throw fail('auth-changed', '검사 기록 권한이 변경되었습니다. 다시 조회해 주세요.');
        };
        assertCurrent();
        const member = await environment.sdk.getDocFromServer(environment.sdk.doc(environment.db, 'inspectionAccess', email(user.email)));
        assertCurrent(); server(member);
        const access = memberFrom(member, email(user.email));
        if (!access) throw fail('permission-denied', '관리자가 승인한 담당 업무 권한이 필요합니다.');
        const snapshot = await environment.sdk.getDocsFromServer(environment.sdk.collection(environment.db, COLLECTION));
        assertCurrent(); server(snapshot);
        const next = normalizeRecords(snapshot.docs.map(unwrap));
        hasServerRows = true; emitRows(next);
        emitStatus({ ready: true, recordsReady: true, role: access.role, online: true, loading: false, stale: false, error: null });
        return next;
      } catch (error) {
        if (current(user, generation) && !/auth-changed/.test(error.code || '')) connectionError(error, /permission-denied|unauthenticated|auth-required/.test(error.code || ''));
        throw error;
      }
    }
    async function retry() {
      const environment = await init();
      if (typeof environment.auth.authStateReady === 'function') await environment.auth.authStateReady();
      return authChanged(environment.auth.currentUser);
    }
    function signIn() {
      if (destroyed) return Promise.reject(fail('destroyed', '목록 연결이 종료되었습니다.'));
      if (signInPromise) return signInPromise;
      const launch = environment => {
        const provider = new environment.sdk.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return environment.sdk.signInWithPopup(environment.auth, provider);
      };
      let attempt;
      try { attempt = env ? launch(env) : init().then(launch); } catch (error) { return Promise.reject(error); }
      signInPromise = Promise.resolve(attempt).finally(() => { signInPromise = null; });
      return signInPromise;
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; authGeneration++; stopRecords(); memberStop?.(); authStop?.();
      memberStop = null; authStop = null; rows = []; hasServerRows = false;
      statusListeners.clear(); listeners.clear();
    }
    return Object.freeze({ onStatus, subscribe, getStatus: () => status, read, retry, signIn, destroy });
  }
  return Object.freeze({ CONFIG, SDK_VERSION, COLLECTION, ROLES, STATUSES, create, normalizeRecord, normalizeRecords });
});
