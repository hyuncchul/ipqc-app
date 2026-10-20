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

test('production data includes only running equipment with a part, and maps its information', () => {
  const app = page();
  app.context.payload = {
    machines: [
      machine(' A07 ', { part: ' PART-7 ', description: ' Product seven ', material: ' Resin ', mold: ' M-7 ', customer: ' ACME ' }),
      machine('B13', { status: 'stopped' }),
      machine('C25', { status: 'maintenance' }),
      machine('A08', { part: '   ' }),
      machine('A09', { part: null }),
    ],
  };
  const result = app.read('normalizeProductionMachines(payload)');
  assert.equal(result.length, 1);
  assert.deepEqual(
    Object.fromEntries(['machine', 'sap', 'desc', 'material', 'mold', 'customer'].map(key => [key, result[0][key]])),
    { machine: 'A07', sap: 'PART-7', desc: 'Product seven', material: 'Resin', mold: 'M-7', customer: 'ACME' },
  );
  assert.equal(typeof result[0].productionKey, 'string');
  assert.ok(result[0].productionKey);
});

test('missing production fields stay empty for manual input, including placeholder values', () => {
  const app = page();
  for (const value of [undefined, null, '', '   ', '-', '—', '미등록']) {
    app.context.value = value;
    assert.equal(app.run('productionText(value)'), '', `placeholder: ${String(value)}`);
  }
  app.context.payload = { machines: [machine('A07', { description: null, material: '—', mold: '미등록', customer: ' ' })] };
  const [result] = app.read('normalizeProductionMachines(payload)');
  assert.deepEqual(
    { desc: result.desc, material: result.material, mold: result.mold, customer: result.customer },
    { desc: '', material: '', mold: '', customer: '' },
  );
  app.context.value = 0;
  assert.equal(app.run('productionText(value)'), '0');
});

test('production material splits a trailing numeric ratio from its name', () => {
  const app = page();
  for (const [source, material, ratio] of [
    ['Resin(30%)', 'Resin', '30%'],
    [' Resin ( 30 % ) ', 'Resin', '30%'],
    ['Resin（30％）', 'Resin', '30%'],
    ['Resin（３０％）', 'Resin', '30%'],
    ['Resin (70:30)', 'Resin', '70:30'],
    ['Resin (70% : 30%)', 'Resin', '70%:30%'],
    ['Resin (70 / 30)', 'Resin', '70/30'],
    ['Resin (70 + 30)', 'Resin', '70+30'],
    ['Resin (30)', 'Resin', '30'],
    ['Resin (12.5%)', 'Resin', '12.5%'],
    ['Resin (0%)', 'Resin', '0%'],
    ['Resin (A130) (30%)', 'Resin (A130)', '30%'],
  ]) {
    app.context.source = source;
    assert.deepEqual(app.read('splitProductionMaterial(source)'), { material, ratio }, source);
  }
});

test('material names without a numeric ratio remain intact and leave ratio available for manual input', () => {
  const app = page();
  for (const source of ['Resin', 'Resin (BLACK)', 'Resin (A130)', 'Resin (30% glass fiber)', 'Resin (30%) grade']) {
    app.context.source = source;
    assert.deepEqual(app.read('splitProductionMaterial(source)'), { material: source, ratio: '' }, source);
  }
  for (const source of [undefined, null, '', '—', '미등록']) {
    app.context.source = source;
    assert.deepEqual(app.read('splitProductionMaterial(source)'), { material: '', ratio: '' });
  }
});

test('normalizing material and ratio preserves the original production identity', () => {
  const app = page();
  const source = machine('A07', { material: 'Resin (30%)', card_date: '2026-10-20', order_no: 'ORDER-7', version: 3 });
  app.context.payload = { machines: [source] };
  const [result] = app.read('normalizeProductionMachines(payload)');
  assert.equal(result.material, 'Resin');
  assert.equal(result.ratio, '30%');
  assert.equal(result.productionKey, JSON.stringify([
    source.id, source.part, source.mold, source.material, source.card_date, source.order_no, source.version,
  ]));
});

test('completing equipment selection fills separate material and ratio fields and saves both', () => {
  const app = page();
  inspectionForm(app);
  app.context.nextMachinesForTest = [machine('A07', { material: 'Resin (30%)' })];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  const info = app.read('state.machineInfo[0]');
  assert.equal(info.material, 'Resin');
  assert.equal(info.ratio, '30%');
  assert.equal(info.productionFields.material, 'Resin');
  assert.equal(info.productionFields.ratio, '30%');
  assert.equal(app.elements.get('mi_0_material').value, 'Resin');
  assert.equal(app.elements.get('mi_0_ratio').value, '30%');
  const saved = JSON.parse(app.localStorage.getItem('ipqc_pad_v3'));
  assert.equal(saved.machineInfo[0].material, 'Resin');
  assert.equal(saved.machineInfo[0].ratio, '30%');
});

test('new inspection decisions stay blank in the form, saved draft, and export row until selected', () => {
  const app = page();
  inspectionForm(app);
  app.context.nextMachinesForTest = [machine('A07')];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  const markup = app.run('buildMachineContent(0)');
  for (const field of ['visual', 'result']) {
    assert.equal(app.read('emptyMachineInfo()')[field], '');
    assert.equal(app.elements.get(`mi_0_${field}`).value, '');
    assert.equal(app.read('state.machineInfo[0]')[field], '');
    assert.equal(JSON.parse(app.localStorage.getItem('ipqc_pad_v3')).machineInfo[0][field], '');
    const options = markup.match(new RegExp(`<select id="mi_0_${field}"[^>]*>([\\s\\S]*?)</select>`))[1];
    assert.match(options, /^\s*<option selected><\/option>/);
  }
  const row = app.read('buildDataRow(state.machineInfo[0], 0, 0)');
  assert.equal(row[11], '');
  assert.equal(row[20], '');
});

test('explicit inspection decisions survive save, same-production selection, and reload', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')]);
  app.setElement('mi_0_visual', 'OK');
  app.setElement('mi_0_result', 'PASS');
  app.context.nextMachinesForTest = [machine('A07')];
  app.run(`
    save();
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  initializeWithoutLayout(app);
  assert.equal(app.read('state.machineInfo[0]').visual, 'OK');
  assert.equal(app.read('state.machineInfo[0]').result, 'PASS');
  const markup = app.run('buildMachineContent(0)');
  assert.match(markup, /<option selected>OK<\/option>/);
  assert.match(markup, /<option selected>PASS<\/option>/);
});

test('clearing a chosen inspection decision persists an empty value', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')]);
  app.setElement('mi_0_visual', 'NG');
  app.setElement('mi_0_result', 'FAIL');
  app.run('save()');
  app.setElement('mi_0_visual', '');
  app.setElement('mi_0_result', '');
  app.run('save()');
  initializeWithoutLayout(app);
  const info = app.read('state.machineInfo[0]');
  assert.equal(info.visual, '');
  assert.equal(info.result, '');
});

test('history editing keeps empty decisions blank and preserves existing chosen decisions', async () => {
  for (const [visual, result] of [['', ''], ['OK', 'PASS'], ['NG', 'FAIL']]) {
    const app = page();
    const history = [{
      id: 'local-history-test', docId: 'local-history-test',
      inspector: 'Test QC', date: '2026-10-20', time: '08:00',
      machineCount: 1, roundCount: 1,
      machineInfo: [{ name: 'A07', visual, result, ltcRounds: [''] }],
      common: { date: '2026-10-20', time: '08:00', shift: 'Day' },
      values: {},
    }];
    app.localStorage.setItem('ipqc_submit_history_v2', JSON.stringify(history));
    app.run('openHistModal(0)');
    const markup = app.elements.get('he_machines_container').children[0].innerHTML;
    for (const [field, chosen] of [['visual', visual], ['result', result]]) {
      const options = markup.match(new RegExp(`<select id="hem_${field}_0"[^>]*>([\\s\\S]*?)</select>`))[1];
      assert.match(options, new RegExp(`<option selected>${chosen}</option>`));
      assert.match(options, /<option(?: selected)?><\/option>/);
      app.setElement(`hem_${field}_0`, chosen);
    }
    app.setElement('hem_name_0', 'A07');
    app.run(`
      ensureSheetWebAppUrl = function(){ return true; };
      var historyPayloadForTest = null;
      postToSheet = async function(action, payload) {
        historyPayloadForTest = payload;
      };
      renderHistory = function(){};
    `);
    await app.run('saveHistEdit()');
    const saved = JSON.parse(app.localStorage.getItem('ipqc_submit_history_v2'))[0];
    assert.equal(saved.machineInfo[0].visual, visual);
    assert.equal(saved.machineInfo[0].result, result);
    assert.equal(app.read('historyPayloadForTest').machineInfo[0].visual, visual);
    assert.equal(app.read('historyPayloadForTest').machineInfo[0].result, result);
    assert.equal(app.requests.length, 0, 'history tests must never contact the actual sheet service');
  }
});

test('same-production reselection preserves manually entered or corrected material ratios', () => {
  for (const material of ['Resin', 'Resin (30%)']) {
    const app = page();
    inspectionForm(app);
    previousInspection(app, [machine('A07', { material })], { '0|0|0': '12.34' });
    assert.equal(app.elements.get('mi_0_ratio').value, material === 'Resin' ? '' : '30%');
    app.setElement('mi_0_ratio', '25');
    app.context.nextMachinesForTest = [machine('A07', { material })];
    app.run(`
      planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
      selectedPlanIdx = new Set([0]);
      productionPhase = 'ready';
      applyPlanSelection();
    `);
    assert.equal(app.read('state.machineInfo[0]').ratio, '25', material);
    assert.equal(app.elements.get('mi_0_ratio').value, '25', material);
    assert.deepEqual(app.read('state.values'), { '0|0|0': '12.34' });
  }
});

test('same-production reselection refills an empty ratio from production material', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07', { material: 'Resin (30%)' })], { '0|0|0': '12.34' });
  app.setElement('mi_0_ratio', '');
  app.context.nextMachinesForTest = [machine('A07', { material: 'Resin (30%)' })];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  assert.equal(app.read('state.machineInfo[0]').ratio, '30%');
  assert.equal(app.elements.get('mi_0_ratio').value, '30%');
  assert.deepEqual(app.read('state.values'), { '0|0|0': '12.34' });
});

test('reselecting a legacy draft splits its imported material while retaining manual ratios and measurements', () => {
  for (const manualRatio of ['', '25']) {
    const app = page();
    inspectionForm(app);
    previousInspection(app, [machine('A07', { material: 'Resin (30%)' })], { '0|0|0': '12.34' });
    // Recreate a draft saved before ratios were imported separately.
    app.context.manualRatio = manualRatio;
    app.run(`
      state.machineInfo[0].material = 'Resin (30%)';
      state.machineInfo[0].ratio = manualRatio;
      state.machineInfo[0].productionFields.material = 'Resin (30%)';
      delete state.machineInfo[0].productionFields.ratio;
      renderAll();
    `);
    const previousKey = app.run('state.machineInfo[0].productionKey');
    app.context.nextMachinesForTest = [machine('A07', { material: 'Resin (30%)' })];
    app.run(`
      planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
      selectedPlanIdx = new Set([0]);
      productionPhase = 'ready';
      applyPlanSelection();
    `);
    const info = app.read('state.machineInfo[0]');
    assert.equal(info.material, 'Resin');
    assert.equal(info.ratio, manualRatio || '30%');
    assert.equal(info.productionFields.material, 'Resin');
    assert.equal(info.productionFields.ratio, '30%');
    assert.equal(info.productionKey, previousKey);
    assert.deepEqual(app.read('state.values'), { '0|0|0': '12.34' });
    assert.equal(app.localStorage.getItem('ipqc_pad_v3_equipment_backup'), null);
  }
});

test('malformed production responses are rejected rather than treated as an empty list', () => {
  const app = page();
  for (const payload of [null, {}, { machines: null }, { machines: {} }, { machines: 'A07' }]) {
    app.context.payload = payload;
    assert.throws(() => app.run('normalizeProductionMachines(payload)'));
  }
  app.context.payload = { machines: [] };
  assert.deepEqual(app.read('normalizeProductionMachines(payload)'), []);
});

test('equipment cards escape production text before adding it to HTML', () => {
  const app = page();
  app.context.payload = { machines: [machine('A07<script>', {
    part: 'PART<img src=x onerror=alert(1)>',
    description: '<svg onload=alert(1)>',
    material: '" & resin',
    mold: '<MOLD>',
    customer: '<Customer>',
  })] };
  app.run('planMachines = normalizeProductionMachines(payload); renderMachGrid()');
  const cards = app.elements.get('machGrid').innerHTML;
  assert.doesNotMatch(cards, /<script>|<img|<svg|<Customer>/);
  assert.match(cards, /A07&lt;script&gt;/);
  assert.match(cards, /PART&lt;img/);
  assert.match(cards, /&lt;Customer&gt;/);
});

test('reselection remaps measurements by production identity and preserves unsaved manual input', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07'), machine('B13', { material: null })], {
    '0|0|0': 'removed equipment value',
    '0|1|0': '12.34',
    'remark|1|2': 'Retain this round note',
  });
  app.run('state.currentMachine = 1');
  app.setElement('mi_1_datecode', '261020');
  app.setElement('mi_1_material', 'Manually entered resin');
  app.setElement('mi_1_approval', 'Inspector Kim');
  app.setElement('ltc_1_0', 'LOT-B13');
  app.context.nextMachinesForTest = [machine('B13', { material: null }), machine('C25')];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0, 1]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  const state = app.read('state');
  assert.deepEqual(state.machineInfo.map(info => info.name), ['B13', 'C25']);
  assert.equal(state.machineInfo[0].datecode, '261020');
  assert.equal(state.machineInfo[0].material, 'Manually entered resin');
  assert.equal(state.machineInfo[0].approval, 'Inspector Kim');
  assert.equal(state.machineInfo[0].ltcRounds[0], 'LOT-B13');
  assert.equal(state.machineInfo[1].datecode, '');
  assert.equal(state.machineInfo[1].ltcRounds[0] || '', '');
  assert.deepEqual(state.values, { '0|0|0': '12.34', 'remark|0|2': 'Retain this round note' });
  assert.equal(state.currentMachine, 0);
  const saved = JSON.parse(app.localStorage.getItem('ipqc_pad_v3'));
  assert.deepEqual(saved.machineInfo, state.machineInfo);
  assert.deepEqual(saved.values, state.values);
  const events = app.read('testEvents');
  assert.ok(events.indexOf('render') < events.indexOf('save'), 'new forms must render before save collects them');
});

test('a different production job on the same machine clears old measurements and manual fields', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': 'old job measurement' });
  app.setElement('mi_0_datecode', 'old datecode');
  app.setElement('mi_0_approval', 'old approval');
  app.setElement('ltc_0_0', 'old lot');
  app.context.nextMachinesForTest = [machine('A07', { part: 'NEW-PART', description: 'New product', mold: 'NEW-MOLD' })];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  const state = app.read('state');
  assert.equal(state.machineInfo[0].name, 'A07');
  assert.equal(state.machineInfo[0].sap, 'NEW-PART');
  assert.equal(state.machineInfo[0].mold, 'NEW-MOLD');
  assert.equal(state.machineInfo[0].datecode, '');
  assert.equal(state.machineInfo[0].approval, '');
  assert.equal(state.machineInfo[0].ltcRounds[0] || '', '');
  assert.deepEqual(state.values, {});
  const saved = JSON.parse(app.localStorage.getItem('ipqc_pad_v3'));
  assert.equal(saved.machineInfo[0].sap, 'NEW-PART', 'old displayed product must not overwrite the newly selected product');
});

test('a new production version cannot reuse measurements even when the part and mold are unchanged', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07', { version: 1 })], { '0|0|0': 'previous version value' });
  app.context.nextMachinesForTest = [machine('A07', { version: 2 })];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  assert.deepEqual(app.read('state.values'), {});
});

test('same-production refresh updates source fields, keeps manual corrections, and removes deleted rounds', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], {
    '0|0|0': '12.34',
    '0|0|2': 'deleted round',
  });
  app.setElement('mi_0_desc', 'Operator corrected description');
  app.setElement('roundCount', '2');
  app.context.nextMachinesForTest = [machine('A07', {
    description: 'Updated production description',
    customer: 'Updated customer',
  })];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  const state = app.read('state');
  assert.equal(state.machineInfo[0].desc, 'Operator corrected description');
  assert.equal(state.machineInfo[0].customer, 'Updated customer');
  assert.equal(state.machineInfo[0].productionFields.desc, 'Updated production description');
  assert.deepEqual(state.values, { '0|0|0': '12.34' });
  assert.equal(state.roundCount, 2);
  assert.equal(state.machineInfo[0].ltcRounds.length, 2);
});

test('orphan measurements without saved equipment identity cannot attach to new equipment', () => {
  const app = page();
  inspectionForm(app);
  app.context.nextMachinesForTest = [machine('B13')];
  app.run(`
    state.machineInfo = [];
    state.machineCount = 0;
    state.values = { '0|0|0': 'unidentified old value' };
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  assert.deepEqual(app.read('state.values'), {});
  assert.equal(app.read('state.machineInfo')[0].name, 'B13');
});

test('completing an empty selection leaves inspection data unchanged', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': '12.34' });
  const before = app.read('state');
  app.run("productionPhase = 'ready'; selectedPlanIdx = new Set(); updateSelCount(); applyPlanSelection()");
  assert.deepEqual(app.read('state'), before);
  assert.equal(app.elements.get('planApplyBtn').disabled, true);
});

test('cancelling equipment replacement keeps prior measurements and unsaved manual input', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': '12.34' });
  app.setElement('mi_0_datecode', 'unsaved datecode');
  let confirmations = 0;
  app.context.confirm = () => { confirmations++; return false; };
  app.context.nextMachinesForTest = [machine('B13')];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  assert.equal(confirmations, 1);
  assert.deepEqual(app.read('state.values'), { '0|0|0': '12.34' });
  assert.equal(app.read('state.machineInfo')[0].name, 'A07');
  assert.equal(app.read('state.machineInfo')[0].datecode, 'unsaved datecode');
  assert.equal(app.localStorage.getItem('ipqc_pad_v3_equipment_backup'), null);
  assert.deepEqual(app.read('testEvents'), []);
});

test('confirmed replacement backs up the complete previous inspection before applying new equipment', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': '12.34' });
  app.setElement('mi_0_datecode', 'unsaved datecode');
  app.setElement('ltc_0_0', 'previous production lot');
  app.context.nextMachinesForTest = [machine('B13')];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  const backup = JSON.parse(app.localStorage.getItem('ipqc_pad_v3_equipment_backup'));
  assert.deepEqual(backup.values, { '0|0|0': '12.34' });
  assert.equal(backup.machineInfo[0].name, 'A07');
  assert.equal(backup.machineInfo[0].datecode, 'unsaved datecode');
  assert.equal(backup.machineInfo[0].ltcRounds[0], 'previous production lot');
  assert.equal(backup.machineCount, 1);
  assert.equal(app.read('state.machineInfo')[0].name, 'B13');
  assert.deepEqual(app.read('state.values'), {});
  assert.equal(app.elements.get('productionBackupBtn').style.display, '');
});

test('backup storage failure cancels equipment replacement and retains prior input', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': '12.34' });
  const originalSetItem = app.localStorage.setItem;
  app.localStorage.setItem = (key, value) => {
    if (key === 'ipqc_pad_v3_equipment_backup') throw new Error('Storage quota exceeded');
    originalSetItem(key, value);
  };
  app.context.nextMachinesForTest = [machine('B13')];
  app.run(`
    planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
    selectedPlanIdx = new Set([0]);
    productionPhase = 'ready';
    applyPlanSelection();
  `);
  assert.equal(app.read('state.machineInfo')[0].name, 'A07');
  assert.deepEqual(app.read('state.values'), { '0|0|0': '12.34' });
  assert.deepEqual(app.read('testEvents'), []);
  assert.equal(app.alerts.length, 1);
  assert.equal(app.alerts[0], app.run("tr('productionBackupFailed')"));
});

test('replacing a draft with any chosen visual or result still backs up that inspection', () => {
  for (const [field, value] of [['visual', 'OK'], ['visual', 'NG'], ['result', 'PASS'], ['result', 'FAIL']]) {
    const app = page();
    inspectionForm(app);
    previousInspection(app, [machine('A07')]);
    app.setElement(`mi_0_${field}`, value);
    app.context.nextMachinesForTest = [machine('B13')];
    app.run(`
      planMachines = normalizeProductionMachines({ machines: nextMachinesForTest });
      selectedPlanIdx = new Set([0]);
      productionPhase = 'ready';
      applyPlanSelection();
    `);
    const backup = JSON.parse(app.localStorage.getItem('ipqc_pad_v3_equipment_backup'));
    assert.ok(backup, `${field} alone must trigger backup`);
    assert.equal(backup.machineInfo[0].name, 'A07');
    assert.equal(backup.machineInfo[0][field], value);
    assert.deepEqual(backup.values, {});
    assert.equal(app.read('state.machineInfo')[0].name, 'B13');
  }
});

test('importing a backup renders its restored fields before saving over the current equipment', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': 'restored measurement' });
  const backup = app.read('state');
  backup.common = { date: '2026-10-18', time: '08:10', shift: 'Day', inspector: 'Restored QC' };
  backup.machineInfo[0].datecode = 'restored datecode';
  backup.machineInfo[0].ltcRounds = ['restored lot', '', ''];
  previousInspection(app, [machine('B13')], { '0|0|0': 'current B13 measurement' });
  app.setElement('mi_0_datecode', 'old B13 datecode');
  app.setElement('inspector', 'Old visible inspector');
  app.setElement('date', '2026-10-20');
  app.context.FileReader = class {
    readAsText(file) { this.result = file.text; this.onload(); }
  };
  app.context.importEvent = { target: { files: [{ text: JSON.stringify(backup) }] } };
  app.run(`
    applyLanguage = function(){};
    saveTimer = setTimeout(function(){}, 300);
    importJson(importEvent);
  `);
  assert.deepEqual(app.read('state'), backup);
  assert.deepEqual(JSON.parse(app.localStorage.getItem('ipqc_pad_v3')), backup);
  assert.equal(app.elements.get('mname_0').value, 'A07');
  assert.equal(app.elements.get('mi_0_sap').value, 'PART-A07');
  assert.equal(app.elements.get('mi_0_datecode').value, 'restored datecode');
  assert.equal(app.elements.get('inspector').value, 'Restored QC');
  assert.equal(app.elements.get('date').value, '2026-10-18');
  assert.equal(app.run('productionPhase'), 'idle');
  assert.equal(app.timers.size, 0, 'the previous delayed save must be cancelled');
  assert.equal(app.alerts.at(-1), app.run("tr('importOk')"));
});

test('invalid JSON backups leave the current inspection unchanged', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': 'keep this measurement' });
  const before = app.read('state');
  app.context.FileReader = class {
    readAsText(file) { this.result = file.text; this.onload(); }
  };
  for (const text of [
    '{invalid JSON',
    JSON.stringify({ ...before, machineInfo: null }),
    JSON.stringify({ ...before, common: null }),
    JSON.stringify({ ...before, values: null }),
    JSON.stringify({ ...before, machineCount: 2 }),
    JSON.stringify({ ...before, machineCount: -1 }),
    JSON.stringify({ ...before, roundCount: 0 }),
    JSON.stringify({ ...before, roundCount: 6 }),
  ]) {
    app.context.importEvent = { target: { files: [{ text }] } };
    app.run('importJson(importEvent)');
    assert.deepEqual(app.read('state'), before);
    assert.equal(app.alerts.at(-1), app.run("tr('importFail')"));
  }
  assert.deepEqual(app.read('testEvents'), []);
});

test('reload migrates legacy zero-machine drafts without attaching orphan values to an unnamed machine', () => {
  const app = page();
  const legacy = app.read('state');
  legacy.machineCount = 0;
  legacy.machineInfo = [app.read('emptyMachineInfo()')];
  legacy.values = { '0|0|0': 'legacy orphan value' };
  app.localStorage.setItem('ipqc_pad_v3', JSON.stringify(legacy));
  initializeWithoutLayout(app);
  assert.equal(app.run('state.machineCount'), 0);
  assert.deepEqual(app.read('state.machineInfo'), []);
  assert.deepEqual(app.read('state.values'), {});
  const backup = JSON.parse(app.localStorage.getItem('ipqc_pad_v3_equipment_backup'));
  assert.deepEqual(backup, legacy);
  assert.equal(app.elements.get('productionBackupBtn').style.display, '');
});

test('migration stops without discarding orphan values when their backup cannot be stored', () => {
  const app = page();
  const legacy = app.read('state');
  legacy.machineInfo = [app.read('emptyMachineInfo()')];
  legacy.values = { '0|0|0': 'legacy orphan value' };
  const raw = JSON.stringify(legacy);
  app.localStorage.setItem('ipqc_pad_v3', raw);
  app.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
  initializeWithoutLayout(app);
  assert.equal(app.localStorage.getItem('ipqc_pad_v3'), raw);
  assert.deepEqual(app.read('state.values'), legacy.values);
  assert.equal(app.alerts.length, 1);
});

test('reload preserves a valid saved draft together with its machine identity and date', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07')], { '0|0|0': '12.34' });
  const draft = app.read('state');
  draft.common = { date: '2026-10-19', time: '23:00', shift: 'Night', inspector: 'QC test' };
  draft.currentMachine = 4;
  app.localStorage.setItem('ipqc_pad_v3', JSON.stringify(draft));
  initializeWithoutLayout(app);
  assert.equal(app.run('state.machineCount'), 1);
  assert.deepEqual(app.read('state.machineInfo'), draft.machineInfo);
  assert.deepEqual(app.read('state.values'), draft.values);
  assert.deepEqual(app.read('state.common'), draft.common);
  assert.equal(app.run('state.currentMachine'), 0);
  assert.equal(app.localStorage.getItem('ipqc_pad_v3_equipment_backup'), null);
});

test('reload separates legacy imported material and ratio without changing measurements or manual ratios', () => {
  for (const manualRatio of ['', '25']) {
    const app = page();
    inspectionForm(app);
    previousInspection(app, [machine('A07', { material: 'Resin (30%)' })], { '0|0|0': '12.34' });
    const draft = app.read('state');
    const info = draft.machineInfo[0];
    info.material = 'Resin (30%)';
    info.ratio = manualRatio;
    info.productionFields.material = 'Resin (30%)';
    delete info.productionFields.ratio;
    app.localStorage.setItem('ipqc_pad_v3', JSON.stringify(draft));
    initializeWithoutLayout(app);
    const restored = app.read('state.machineInfo[0]');
    assert.equal(restored.material, 'Resin');
    assert.equal(restored.ratio, manualRatio || '30%');
    assert.equal(restored.productionFields.material, 'Resin');
    assert.equal(restored.productionFields.ratio, '30%');
    assert.equal(restored.productionKey, info.productionKey);
    assert.deepEqual(app.read('state.values'), draft.values);
    assert.equal(app.localStorage.getItem('ipqc_pad_v3_equipment_backup'), null);
  }
});

test('reload does not split manually edited material or infer a ratio from an obsolete imported name', () => {
  const app = page();
  inspectionForm(app);
  previousInspection(app, [machine('A07', { material: 'Original resin (30%)' })], { '0|0|0': '12.34' });
  const draft = app.read('state');
  const info = draft.machineInfo[0];
  info.material = 'Operator resin (BLACK)';
  info.ratio = '';
  info.productionFields.material = 'Original resin (30%)';
  delete info.productionFields.ratio;
  app.localStorage.setItem('ipqc_pad_v3', JSON.stringify(draft));
  initializeWithoutLayout(app);
  assert.deepEqual(app.read('state.machineInfo[0]'), info);
  assert.deepEqual(app.read('state.values'), draft.values);
});

test('missing, expired, or malformed sessions open inline login without contacting the API', async () => {
  for (const session of [null, '{not json', JSON.stringify({ token: 'expired', expires: Date.now() - 1000 })]) {
    const app = page();
    if (session !== null) app.sessionStorage.setItem(SESSION_KEY, session);
    await app.run('selectEquipment()');
    assert.equal(app.requests.length, 0);
    assert.equal(app.run('productionPhase'), 'login');
    assert.equal(app.elements.get('productionLogin').hidden, false);
    assert.equal(app.elements.get('planApplyBtn').disabled, true);
    assert.equal(app.elements.get('equipmentSelectBtn').disabled, false);
  }
});

test('authenticated loading disables completion and restores selected running equipment', async () => {
  const pending = deferred();
  const app = page({ fetch: () => pending.promise });
  app.session();
  app.run("state.machineInfo = [{name:'B13'}]; state.machineCount = 1");
  const loading = app.run('selectEquipment()');
  assert.equal(app.run('productionPhase'), 'loading');
  assert.equal(app.elements.get('equipmentSelectBtn').disabled, true);
  assert.equal(app.elements.get('planApplyBtn').disabled, true);
  assert.equal(app.requests[0][0], `${API_BASE}/api/production`);
  assert.equal(app.requests[0][1].headers.Authorization, 'Bearer test-session-token');
  assert.equal(app.requests[0][1].cache, 'no-store');
  pending.resolve(response({ machines: [machine('B13'), machine('A07'), machine('C25', { status: 'stopped' })] }));
  await loading;
  assert.equal(app.run('productionPhase'), 'ready');
  assert.deepEqual(app.read('planMachines.map(machine => machine.machine)'), ['A07', 'B13']);
  assert.deepEqual(app.read('[...selectedPlanIdx]'), [1]);
  assert.equal(app.elements.get('equipmentSelectBtn').disabled, false);
  assert.equal(app.elements.get('planApplyBtn').disabled, false);
  assert.equal(app.elements.get('productionLogin').hidden, true);
  assert.equal(app.timers.size, 0);
});

test('unauthorized production requests invalidate the session and show login', async () => {
  const app = page({ fetch: () => response({ error: 'unauthorized' }, 401) });
  app.session();
  await app.run('selectEquipment()');
  assert.equal(app.sessionStorage.getItem(SESSION_KEY), null);
  assert.equal(app.run('productionPhase'), 'login');
  assert.equal(app.elements.get('productionLogin').hidden, false);
  assert.equal(app.elements.get('planSelector').classList.contains('show'), false);
  assert.equal(app.elements.get('planApplyBtn').disabled, true);
});

test('failed production loads clear the selectable list and allow a retry', async () => {
  for (const failingResponse of [
    () => response({ error: 'unavailable' }, 503),
    () => response({ unexpected: 'shape' }),
    () => Promise.reject(new TypeError('Failed to fetch')),
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON'); } }),
  ]) {
    const app = page({ fetch: failingResponse });
    app.session();
    app.context.oldPayload = { machines: [machine('A07')] };
    app.run("planMachines = normalizeProductionMachines(oldPayload); selectedPlanIdx = new Set([0]); productionPhase = 'ready'");
    await app.run('selectEquipment()');
    assert.equal(app.run('productionPhase'), 'error');
    assert.deepEqual(app.read('planMachines'), []);
    assert.equal(app.elements.get('planApplyBtn').disabled, true);
    assert.equal(app.elements.get('equipmentSelectBtn').disabled, false);
    assert.ok(app.elements.get('productionStatus').textContent);
  }
});

test('no running equipment has an explicit empty state and cannot be applied', async () => {
  const app = page({ fetch: () => response({ machines: [machine('A07', { status: 'stopped' })] }) });
  app.session();
  await app.run('selectEquipment()');
  assert.equal(app.run('productionPhase'), 'empty');
  assert.deepEqual(app.read('planMachines'), []);
  assert.equal(app.elements.get('planApplyBtn').disabled, true);
  assert.equal(app.elements.get('productionStatus').textContent, app.run("tr('productionEmpty')"));
});

test('a stale response cannot replace a newer equipment list', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const app = page({ fetch: () => ++calls === 1 ? first.promise : second.promise });
  app.session();
  const firstLoad = app.run('selectEquipment()');
  const secondLoad = app.run('selectEquipment()');
  assert.equal(app.requests[0][1].signal.aborted, true);
  second.resolve(response({ machines: [machine('B13')] }));
  await secondLoad;
  first.resolve(response({ machines: [machine('A07')] }));
  await firstLoad;
  assert.equal(app.run('productionPhase'), 'ready');
  assert.deepEqual(app.read('planMachines.map(machine => machine.machine)'), ['B13']);
});

test('clearing selection while a response body is loading prevents a late list from reopening', async () => {
  const body = deferred();
  const bodyRequested = deferred();
  const app = page({ fetch: () => ({
    ok: true, status: 200,
    json() { bodyRequested.resolve(); return body.promise; },
  }) });
  app.session();
  const loading = app.run('selectEquipment()');
  // Let fetch resolve so cancellation occurs specifically during JSON loading.
  await bodyRequested.promise;
  app.run('clearPlan()');
  body.resolve({ machines: [machine('A07')] });
  await loading;
  assert.equal(app.requests[0][1].signal.aborted, true);
  assert.equal(app.run('productionPhase'), 'idle');
  assert.deepEqual(app.read('planMachines'), []);
  assert.equal(app.elements.get('planSelector').classList.contains('show'), false);
});

test('request timeout aborts loading, displays an error, and enables retry', async () => {
  const app = page({ fetch: (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }) });
  app.session();
  const loading = app.run('selectEquipment()');
  const timeout = [...app.timers.values()].find(timer => timer.delay === 15000);
  assert.ok(timeout, 'production request must have a timeout');
  timeout.callback();
  await loading;
  assert.equal(app.requests[0][1].signal.aborted, true);
  assert.equal(app.run('productionPhase'), 'error');
  assert.equal(app.elements.get('equipmentSelectBtn').disabled, false);
  assert.equal(app.elements.get('planApplyBtn').disabled, true);
});

test('successful inline login keeps credentials out of storage and then loads production', async () => {
  const expires = Date.now() + 60_000;
  const app = page({ fetch: url => url.endsWith('/api/auth')
    ? response({ token: 'new-test-token', expires, user: { username: 'qc-test' } })
    : response({ machines: [machine('A07')] }),
  });
  app.setElement('productionUsername', ' qc-test ');
  app.setElement('productionPassword', 'test-only-password');
  let prevented = false;
  app.context.loginEvent = { preventDefault() { prevented = true; } };
  await app.run('loginProduction(loginEvent)');
  assert.equal(prevented, true);
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[0][0], `${API_BASE}/api/auth`);
  assert.equal(app.requests[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(app.requests[0][1].body), {
    action: 'login', username: 'qc-test', password: 'test-only-password',
  });
  assert.equal(app.requests[1][0], `${API_BASE}/api/production`);
  assert.equal(app.requests[1][1].headers.Authorization, 'Bearer new-test-token');
  const stored = JSON.parse(app.sessionStorage.getItem(SESSION_KEY));
  assert.equal(stored.token, 'new-test-token');
  assert.equal(stored.expires, expires);
  assert.doesNotMatch(JSON.stringify(app.sessionStorage.entries()), /test-only-password/);
  assert.deepEqual(app.localStorage.entries(), []);
  assert.equal(app.elements.get('productionPassword').value, '');
  assert.deepEqual(app.events, ['ltc-auth-changed']);
  assert.equal(app.run('productionPhase'), 'ready');
});

test('failed login clears the password and permits retry without loading production', async () => {
  const app = page({ fetch: () => response({ error: 'Invalid credentials' }, 401) });
  app.setElement('productionUsername', 'qc-test');
  app.setElement('productionPassword', 'wrong-test-password');
  await app.run('loginProduction({preventDefault(){}})');
  assert.equal(app.requests.length, 1);
  assert.equal(app.run('productionPhase'), 'loginError');
  assert.equal(app.elements.get('productionLogin').hidden, false);
  assert.equal(app.elements.get('productionPassword').value, '');
  assert.equal(app.elements.get('productionLoginBtn').disabled, false);
  assert.equal(app.sessionStorage.getItem(SESSION_KEY), null);
  assert.deepEqual(app.localStorage.entries(), []);
});

test('cancelled login cannot install a late session or reopen equipment selection', async () => {
  const pending = deferred();
  const app = page({ fetch: () => pending.promise });
  app.setElement('productionUsername', 'qc-test');
  app.setElement('productionPassword', 'test-only-password');
  const login = app.run('loginProduction({preventDefault(){}})');
  app.run('clearPlan()');
  pending.resolve(response({ token: 'late-test-token', expires: Date.now() + 60_000 }));
  await login;
  assert.equal(app.run('productionPhase'), 'idle');
  assert.equal(app.sessionStorage.getItem(SESSION_KEY), null);
  assert.equal(app.requests.length, 1);
  assert.equal(app.elements.get('productionLogin').hidden, true);
});
