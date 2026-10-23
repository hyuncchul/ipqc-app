const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

// Execute the page's real inline code, with network and browser APIs replaced
// locally. These tests never contact the production service.
const html = readFileSync(resolve(__dirname, 'IPQC_inspector.html'), 'utf8');
const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes]) => !/\bsrc=/.test(attributes))
  .map(([, , body]) => body)
  .join('\n')
  .replace(/^\s*init\(\);\s*$/m, '');
const API_BASE = 'https://ltc-equipment-monitor.pwjwx2rg6w.chatgpt.site';
const SESSION_KEY = `ltc-login-session:${API_BASE}`;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear(),
    entries: () => [...values.entries()],
  };
}

function element(id = '', attributes = '') {
  const classes = new Set((attributes.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean));
  const style = {};
  for (const rule of (attributes.match(/\bstyle="([^"]*)"/)?.[1] || '').split(';')) {
    const [key, value] = rule.split(':');
    if (key && value) style[key.trim()] = value.trim();
  }
  return {
    id, style, dataset: {}, value: '', innerHTML: '', textContent: '',
    disabled: /\bdisabled\b/.test(attributes), hidden: /\bhidden\b/.test(attributes),
    children: [], options: [], attributes: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, force = !classes.has(name)) {
        force ? classes.add(name) : classes.delete(name);
        return force;
      },
    },
    addEventListener() {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    scrollIntoView() {},
    focus() {},
    remove() {},
  };
}

function page({ fetch: fetchImplementation } = {}) {
  const elements = new Map();
  for (const [, attributes, id] of html.matchAll(/<[a-z][\w-]*\b([^<>]*\bid="([^"]+)"[^<>]*)>/gi)) {
    elements.set(id, element(id, attributes));
  }
  elements.get('roundCount').value = '3';
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  const requests = [];
  const alerts = [];
  const events = [];
  const timers = new Map();
  let nextTimer = 1;
  const context = vm.createContext({
    document: {
      getElementById: id => elements.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => element(),
      addEventListener() {},
      documentElement: {},
      body: element(),
      head: element(),
    },
    window: { addEventListener() {}, dispatchEvent: event => events.push(event.type), devicePixelRatio: 1 },
    localStorage, sessionStorage,
    alert: message => alerts.push(message),
    confirm: () => true,
    AbortController, Event, URL, URLSearchParams, console,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    fetch: async (...args) => {
      requests.push(args);
      if (!fetchImplementation) throw new Error('Unexpected request in offline test');
      return fetchImplementation(...args);
    },
  });
  vm.runInContext(script, context, { filename: 'IPQC_inspector.html' });
  const run = code => vm.runInContext(code, context);
  const read = code => JSON.parse(run(`JSON.stringify(${code})`));
  const setElement = (id, value = '') => {
    if (!elements.has(id)) elements.set(id, element(id));
    elements.get(id).value = value;
    return elements.get(id);
  };
  const session = (overrides = {}) => sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    token: 'test-session-token',
    expires: Date.now() + 60_000,
    ...overrides,
  }));
  return { context, run, read, setElement, elements, localStorage, sessionStorage, session, requests, alerts, events, timers };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function machine(id, overrides = {}) {
  return {
    id, status: 'running', part: `PART-${id}`, description: `Product ${id}`,
    material: 'Material A', mold: `MOLD-${id}`, customer: 'Customer A',
    ...overrides,
  };
}

function inspectionForm(app) {
  for (let index = 0; index < 4; index++) {
    app.setElement(`mname_${index}`);
    for (const field of ['desc', 'sap', 'customer', 'mold', 'datecode', 'visual', 'result', 'approval', 'material', 'ratio', 'sess']) {
      app.setElement(`mi_${index}_${field}`);
    }
    for (let round = 0; round < 3; round++) app.setElement(`ltc_${index}_${round}`);
  }
  // Model the browser replacing input values during render, while retaining the
  // page's real collection and persistence functions. A save before rendering
  // would incorrectly copy the previous equipment's displayed form.
  app.run(`
    var testEvents = [];
    var originalSaveForTest = save;
    save = function() {
      testEvents.push('save');
      return originalSaveForTest();
    };
    renderAll = function() {
      testEvents.push('render');
      state.machineInfo.forEach((_, index) => applyMachineInfoToForm(index));
    };
  `);
}

function previousInspection(app, machines, values = {}) {
  app.context.previousMachinesForTest = machines;
  app.context.previousValuesForTest = values;
  app.run(`
    state.machineInfo = normalizeProductionMachines({ machines: previousMachinesForTest }).map(machine => ({
      ...emptyMachineInfo(), name: machine.machine, sap: machine.sap,
      desc: machine.desc, material: machine.material, ratio: machine.ratio, mold: machine.mold,
      customer: machine.customer, productionKey: machine.productionKey,
      productionFields: Object.fromEntries(PRODUCTION_FIELDS.map(field => [field, machine[field]])),
    }));
    state.machineCount = state.machineInfo.length;
    state.values = previousValuesForTest;
    state.currentMachine = 0;
    renderAll();
    testEvents = [];
  `);
}

function initializeWithoutLayout(app) {
  // Exercise the actual init/load/migration flow; only unrelated visual
  // rendering is replaced because this harness does not implement a browser.
  app.run(`
    renderAll = function(){};
    applyLanguage = function(){};
    renderHistory = function(){};
    renderPnSection = function(){};
    initIpqcTrend = function(){};
    init();
  `);
}

function patrolApp(){const app=page();app.run(`state.machineCount=2;state.roundCount=3;state.machineInfo=[{...emptyMachineInfo(),name:'A07',ltcRounds:['L-A1','L-A2','L-A3']},{...emptyMachineInfo(),name:'A08',ltcRounds:['L-B1','L-B2','L-B3']}];state.values={};patrol.round=0;patrol.row=0;patrol.item=0;patrol.open=true;patrolRender=function(){};patrolFocus=function(){};`);return app;}
test('patrol does not infer PASS and requires measurement plus scanned lot',()=>{const a=patrolApp();a.run(`patrolJudge('PASS',0)`);assert.equal(a.read('state.machineInfo[0].patrolRounds||null'),null);a.run(`patrolInput(0,'315.00');patrolJudge('PASS',0)`);assert.equal(a.read('patrolComplete(patrolItem(),0,0)'),true);a.run(`state.machineInfo[0].ltcRounds[0]=''`);assert.equal(a.read('patrolComplete(patrolItem(),0,0)'),false);});
test('judgments and explanations are independent by round machine and item',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.30');patrolNote('OL location defect');patrolJudge('FAIL',0);patrol.round=1;patrolInput(0,'315.01');patrolJudge('PASS',0)`);assert.equal(a.read('state.machineInfo[0].patrolRounds[0].items[0].judge'),'FAIL');assert.equal(a.read('state.machineInfo[0].patrolRounds[1].items[0].judge'),'PASS');assert.equal(a.read('state.machineInfo[0].patrolRounds[0].items[0].notes'),'OL location defect');assert.equal(a.read('state.machineInfo[1].patrolRounds||null'),null);});
test('editing a measured value clears judgment and requires a fresh selection',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.00');patrolJudge('PASS',0);patrolInput(0,'315.40')`);assert.equal(a.read('patrolComplete(patrolItem(),0,0)'),false);assert.equal(a.read('state.machineInfo[0].patrolRounds[0].items[0].judge'),'');});
test('N/A is explicit and does not require a fabricated measurement',()=>{const a=patrolApp();a.run(`patrolJudge('N/A',0)`);assert.equal(a.read('patrolComplete(patrolItem(),0,0)'),true);assert.equal(a.read('state.values["0|0|0"]||""'),'');});
test('next tray is blocked without judgment and progresses after judgment',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.00');patrolNext()`);assert.equal(a.read('patrol.row'),0);a.run(`patrolJudge('PASS',0);patrolNext()`);assert.equal(a.read('patrol.row'),1);});
test('round export keeps item judgment in Remark and preserves manual final RESULT',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.40');patrolNote('too long');patrolJudge('FAIL',0);state.values['8|0|0']='HOLD'`);const rows=a.read('buildSheetRows()');assert.equal(rows.length,1);assert.equal(rows[0][10],'L-A1');assert.equal(rows[0][12],'315.40');assert.equal(rows[0][20],'HOLD');assert.match(rows[0][34],/FAIL.*too long/);});
test('server payload and restored record retain round judgment details',()=>{const a=patrolApp();a.run(`state.common.inspector='Tester';patrolInput(0,'315.40');patrolJudge('FAIL',0);var payload=buildServerPayload('demo');state.machineInfo=[];renderAll=function(){};applyServerRecordToState(payload)`);assert.equal(a.read('state.machineInfo[0].patrolRounds[0].items[0].judge'),'FAIL');assert.equal(a.read('state.values["0|0|0"]'),'315.40');});
test('stale lot and stale measurements cannot leak into exported verdicts',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.40');patrolJudge('FAIL',0);state.values['0|0|0']='315.00'`);assert.equal(a.read('buildSheetRows()[0][34]'),'');a.run(`state.machineInfo[0].ltcRounds[0]='NEW-LOT'`);assert.equal(a.read('buildPatrolLedger(state.machineInfo,state.values,3).length'),1);});
test('changing lot clears only that machine and round after explicit app confirmation',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.40');patrolJudge('FAIL',0);state.values['0|0|1']='314.99';state.values['0|1|0']='315.01';patrolSetLtc(0,0,'NEW')`);assert.equal(a.read('state.values["0|0|0"]||null'),null);assert.equal(a.read('state.values["0|0|1"]'),'314.99');assert.equal(a.read('state.values["0|1|0"]'),'315.01');});
test('Visual Dimension including Other exports per-round with notes and judgment',()=>{const a=patrolApp();a.run(`patrol.item=PATROL_ITEMS.findIndex(it=>it.key==='visual');patrolVisual('Dimension');var draft=patrolDraft(0,0,patrolItem());draft.dimensions=['OL','Other'];patrolSetChoice('Dimension (OL, Other)');patrolNote('edge');patrolJudge('FAIL',0)`);const row=a.read('buildSheetRows()[0]');assert.equal(row[11],'Dimension (OL, Other)\nedge');assert.match(row[34],/VISUAL: FAIL/);});
test('final lot judgment remains empty until explicitly set in RESULT',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.00');patrolJudge('PASS',0)`);assert.equal(a.read('buildSheetRows()[0][20]'),'');});
test('five language labels and complete controls have no missing translations',()=>{const a=patrolApp();for(const lang of ['ko','en','zh','vi','id']){a.run(`state.lang='${lang}'`);for(const key of ['judgment','notes','recordNext','needJudge','needLtc','manualLtc'])assert.notEqual(a.run(`ptr('${key}')`),key);}});
test('superseded continuous scan callback cannot overwrite the current lot',()=>{const a=patrolApp();a.run(`var old={pos:0,last:'',lastAt:0};patrol.scan=null;patrolScanHit(old,'WRONG')`);assert.equal(a.read('state.machineInfo[0].ltcRounds[0]'),'L-A1');});
test('Section 03 contains the primary patrol workspace rather than a floating modal',()=>{assert.ok(html.indexOf('id="measurementSection"')<html.indexOf('id="patrol"'));assert.ok(html.indexOf('id="patrol"')<html.indexOf('id="saveSection"'));assert.doesNotMatch(html,/<div id="patrol" role="dialog"/);assert.match(html,/id="legacyMeasurementGrid" hidden/);});
test('summary includes per-round Visual, item judgment, notes and lot identity',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.40');patrolNote('<location>');patrolJudge('FAIL',0);openMeasureSummary()`);const content=a.elements.get('measureSummaryTable').innerHTML;assert.match(content,/FAIL/);assert.match(content,/&lt;location&gt;/);assert.match(content,/L-A1/);assert.match(content,/VISUAL/);});
test('refresh clamps removed rounds without discarding retained measurements',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.40');patrolJudge('FAIL',0);patrol.round=2;state.roundCount=1;patrolRefresh()`);assert.equal(a.read('patrol.round'),0);assert.equal(a.read('state.values["0|0|0"]'),'315.40');assert.equal(a.read('state.machineInfo[0].patrolRounds[0].items[0].judge'),'FAIL');});
test('history ledger escapes notes while exposing the same stored verdict',()=>{const a=patrolApp();a.run(`patrolInput(0,'315.40');patrolNote('<img onerror=evil>');patrolJudge('FAIL',0)`);const content=a.run(`patrolLedgerHtml(state.machineInfo,state.values,3)`);assert.match(content,/FAIL/);assert.match(content,/&lt;img/);assert.doesNotMatch(content,/<img/);});
