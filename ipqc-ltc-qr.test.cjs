const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

// Execute the actual page, replacing browser hardware APIs locally. No camera,
// network request, production data, or remote inspection record is accessed.
const html = readFileSync(resolve(__dirname, 'IPQC_inspector.html'), 'utf8');
const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes]) => !/\bsrc=/.test(attributes))
  .map(([, , body]) => body)
  .join('\n')
  .replace(/^\s*init\(\);\s*$/m, '');

function deferred() {
  let resolvePromise, rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function stream() {
  const track = { stops: 0, stop() { this.stops++; } };
  return { track, getTracks: () => [track] };
}

function page({ media } = {}) {
  const elements = new Map(), timers = new Map(), images = [], revoked = [], requested = [];
  const documentEvents = new Map(), windowEvents = new Map(), store = new Map();
  let nextTimer = 0, nextUrl = 0, focused = '', decodeValue = '';
  const el = id => {
    const events = new Map();
    const classes = new Set();
    const element = {
      id, value: '', textContent: '', innerHTML: '', open: false, style: {}, dataset: {}, children: [], options: [],
      readyState: 2, videoWidth: 1280, videoHeight: 720,
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name), toggle: name => classes.has(name) ? classes.delete(name) : classes.add(name),
      },
      addEventListener: (event, callback) => events.set(event, callback),
      emit: (event, payload = {}) => events.get(event)?.(payload),
      setAttribute() {}, removeAttribute() {}, querySelector() {}, querySelectorAll: () => [],
      appendChild(child) { this.children.push(child); },
      focus() { focused = id; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      pause() { this.pauses = (this.pauses || 0) + 1; },
      play: async () => {},
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({
          data: new Uint8ClampedArray(4),
          width: element.width, height: element.height,
        }),
      }),
    };
    return element;
  };
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) elements.set(id, el(id));
  const setElement = (id, value = '') => {
    if (!elements.has(id)) elements.set(id, el(id));
    elements.get(id).value = value;
    return elements.get(id);
  };
  const document = {
    hidden: false, activeElement: el('original-qr-button'),
    getElementById: id => elements.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el(''),
    addEventListener: (event, callback) => documentEvents.set(event, callback),
    documentElement: {}, body: el('body'), head: el('head'),
  };
  const localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
  const context = vm.createContext({
    document,
    window: {
      addEventListener: (event, callback) => windowEvents.set(event, callback),
      dispatchEvent() {}, devicePixelRatio: 1,
    },
    navigator: { mediaDevices: { getUserMedia: constraints => {
      requested.push(constraints);
      return media ? media(constraints) : Promise.resolve(stream());
    } } },
    localStorage, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URL: {
      createObjectURL: () => `blob:test-${++nextUrl}`,
      revokeObjectURL: url => revoked.push(url),
    },
    URLSearchParams, AbortController, Event, console,
    alert() {}, confirm: () => true,
    fetch: () => { throw new Error('Unexpected network request'); },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    Image: class {
      constructor() { this.naturalWidth = 2000; this.naturalHeight = 1000; images.push(this); }
      set src(value) { this.url = value; }
    },
    jsQR: () => decodeValue ? { data: decodeValue } : null,
  });
  vm.runInContext(script, context, { filename: 'IPQC_inspector.html' });
  const run = code => vm.runInContext(code, context);
  const read = code => JSON.parse(run(`JSON.stringify(${code})`));
  for (let m = 0; m < 2; m++) {
    setElement(`mname_${m}`);
    for (const field of ['desc', 'sap', 'customer', 'mold', 'datecode', 'visual', 'result', 'approval', 'material', 'ratio', 'sess']) {
      setElement(`mi_${m}_${field}`);
    }
    for (let r = 0; r < 3; r++) setElement(`ltc_${m}_${r}`);
  }
  run(`
    state.machineCount=2; state.roundCount=3; state.currentMachine=0;
    state.machineInfo=[
      {...emptyMachineInfo(),name:'A07',ltcRounds:['MANUAL-A1','MANUAL-A2','MANUAL-A3']},
      {...emptyMachineInfo(),name:'B13',ltcRounds:['MANUAL-B1','MANUAL-B2','MANUAL-B3']}
    ];
    state.machineInfo.forEach((_,index)=>applyMachineInfoToForm(index));
  `);
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  return {
    context, elements, timers, images, revoked, requested, localStorage, document, run, read, flush,
    decode: value => { decodeValue = value; },
    focus: () => focused,
    emitDocument: event => documentEvents.get(event)?.(),
    emitWindow: event => windowEvents.get(event)?.(),
    nextFrame() {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === 150);
      assert.ok(entry, 'camera must schedule another scan frame');
      timers.delete(entry[0]);
      entry[1].callback();
    },
    photo() {
      const input = elements.get('ltcQrPhoto');
      input.files = [{}];
      input.value = 'selected-photo.png';
      return run("readLtcQrPhoto(document.getElementById('ltcQrPhoto'))");
    },
  };
}

test('camera decoding fills only the target machine round and persists the result', async () => {
  const camera = stream();
  const app = page({ media: async () => camera });
  app.run('openLtcQr(1,1)');
  await app.flush();
  assert.equal(app.elements.get('ltcQrDialog').open, true);
  assert.equal(app.requested[0].audio, false);
  assert.equal(app.requested[0].video.facingMode.ideal, 'environment');
  app.decode('  LTC-QR-20261020  ');
  app.nextFrame();
  assert.deepEqual(app.read('state.machineInfo.map(info=>info.ltcRounds)'), [
    ['MANUAL-A1', 'MANUAL-A2', 'MANUAL-A3'],
    ['MANUAL-B1', 'LTC-QR-20261020', 'MANUAL-B3'],
  ]);
  assert.equal(app.elements.get('ltc_1_1').value, 'LTC-QR-20261020');
  const saved = JSON.parse(app.localStorage.getItem('ipqc_pad_v3'));
  assert.equal(saved.machineInfo[1].ltcRounds[1], 'LTC-QR-20261020');
  assert.equal(app.elements.get('ltcQrDialog').open, false);
  assert.equal(app.elements.get('ltcQrVideo').srcObject, null);
  assert.equal(camera.track.stops, 1);
  assert.equal(app.focus(), 'ltc_1_1');
  assert.equal(app.timers.size, 0);
});

test('blank QR content preserves manual values and the camera continues scanning', async () => {
  const app = page();
  app.decode('   ');
  app.run('openLtcQr(0,0)');
  await app.flush();
  assert.equal(app.elements.get('ltc_0_0').value, 'MANUAL-A1');
  assert.equal(app.localStorage.getItem('ipqc_pad_v3'), null);
  assert.equal(app.elements.get('ltcQrDialog').open, true);
  app.decode('LTC-NEXT-CODE');
  app.nextFrame();
  assert.equal(app.elements.get('ltc_0_0').value, 'LTC-NEXT-CODE');
});

test('closing before camera permission resolves stops the late stream without changing input', async () => {
  const pending = deferred(), camera = stream();
  const app = page({ media: () => pending.promise });
  app.run('openLtcQr(0,0); closeLtcQr()');
  pending.resolve(camera);
  await app.flush();
  assert.equal(camera.track.stops, 1);
  assert.equal(app.elements.get('ltcQrVideo').srcObject, null);
  assert.equal(app.elements.get('ltcQrDialog').open, false);
  assert.equal(app.elements.get('ltc_0_0').value, 'MANUAL-A1');
  assert.equal(app.timers.size, 0);
  assert.equal(app.focus(), 'original-qr-button');
});

test('camera permission and device errors show a useful status while preserving manual input', async () => {
  for (const [name, message] of [
    ['NotAllowedError', 'qrDenied'], ['SecurityError', 'qrDenied'],
    ['NotFoundError', 'qrUnavailable'], ['NotReadableError', 'qrError'],
  ]) {
    const app = page({ media: async () => { throw Object.assign(new Error(name), { name }); } });
    app.run('openLtcQr(0,0)');
    await app.flush();
    assert.equal(app.elements.get('ltcQrStatus').textContent, app.run(`tr('${message}')`));
    assert.equal(app.elements.get('ltc_0_0').value, 'MANUAL-A1');
    assert.equal(app.localStorage.getItem('ipqc_pad_v3'), null);
    assert.equal(app.timers.size, 0);
    assert.equal(app.elements.get('ltcQrDialog').open, true);
  }
});

test('unavailable camera or QR decoder permits manual input and never starts hardware', () => {
  for (const [setup, message] of [
    ['navigator.mediaDevices=undefined', 'qrUnavailable'],
    ['jsQR=undefined', 'qrLibrary'],
  ]) {
    const app = page();
    app.run(`${setup}; openLtcQr(0,0)`);
    assert.equal(app.elements.get('ltcQrStatus').textContent, app.run(`tr('${message}')`));
    assert.equal(app.requested.length, 0);
    assert.equal(app.elements.get('ltc_0_0').value, 'MANUAL-A1');
  }
});

test('retry stops the previous camera and ignores a superseded permission response', async () => {
  const first = deferred(), second = deferred();
  const firstStream = stream(), secondStream = stream();
  let calls = 0;
  const app = page({ media: () => ++calls === 1 ? first.promise : second.promise });
  app.run('openLtcQr(0,0); startLtcCamera()');
  second.resolve(secondStream);
  await app.flush();
  first.resolve(firstStream);
  await app.flush();
  assert.equal(firstStream.track.stops, 1);
  assert.equal(secondStream.track.stops, 0);
  assert.equal(app.elements.get('ltcQrVideo').srcObject, secondStream);
  app.run('closeLtcQr()');
  assert.equal(secondStream.track.stops, 1);
  assert.equal(app.timers.size, 0);
});

test('retry of a running camera releases its stream and starts a single new scan loop', async () => {
  const firstStream = stream(), secondStream = stream();
  let calls = 0;
  const app = page({ media: async () => ++calls === 1 ? firstStream : secondStream });
  app.run('openLtcQr(0,0)');
  await app.flush();
  await app.run('startLtcCamera()');
  assert.equal(firstStream.track.stops, 1);
  assert.equal(secondStream.track.stops, 0);
  assert.equal([...app.timers.values()].filter(timer => timer.delay === 150).length, 1);
});

test('hiding the page pauses the camera and pagehide closes it completely', async () => {
  const camera = stream();
  const app = page({ media: async () => camera });
  app.run('openLtcQr(0,0)');
  await app.flush();
  app.document.hidden = true;
  app.emitDocument('visibilitychange');
  assert.equal(camera.track.stops, 1);
  assert.equal(app.elements.get('ltcQrVideo').srcObject, null);
  assert.equal(app.elements.get('ltcQrStatus').textContent, app.run("tr('qrPaused')"));
  assert.equal(app.timers.size, 0);
  app.emitWindow('pagehide');
  assert.equal(app.elements.get('ltcQrDialog').open, false);
  assert.equal(app.run('ltcQrSession'), null);
});

test('dialog cancellation closes camera and restores focus', async () => {
  const camera = stream();
  const app = page({ media: async () => camera });
  app.run('openLtcQr(0,0)');
  await app.flush();
  let prevented = false;
  app.elements.get('ltcQrDialog').emit('cancel', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(camera.track.stops, 1);
  assert.equal(app.elements.get('ltcQrDialog').open, false);
  assert.equal(app.focus(), 'original-qr-button');
});

test('camera results cannot be written after the target machine or round changes', async () => {
  for (const change of [
    "state.machineInfo[0]={...emptyMachineInfo(),name:'C25'}",
    'state.roundCount=1',
  ]) {
    const camera = stream();
    const app = page({ media: async () => camera });
    app.run('openLtcQr(0,1)');
    await app.flush();
    app.run(change);
    app.decode('STALE-CODE');
    app.nextFrame();
    assert.equal(app.elements.get('ltc_0_1').value, 'MANUAL-A2');
    assert.equal(app.elements.get('ltcQrStatus').textContent, app.run("tr('qrTargetChanged')"));
    assert.equal(camera.track.stops, 1);
    assert.equal(app.localStorage.getItem('ipqc_pad_v3'), null);
  }
});

test('photo decoding stops camera, fills the selected round, and releases the photo URL', async () => {
  const camera = stream();
  const app = page({ media: async () => camera });
  app.run('openLtcQr(0,2)');
  await app.flush();
  const reading = app.photo();
  assert.equal(camera.track.stops, 1);
  assert.equal(app.elements.get('ltcQrPhoto').value, '');
  assert.equal(app.elements.get('ltcQrStatus').textContent, app.run("tr('qrReading')"));
  app.decode('LTC-FROM-PHOTO');
  app.images[0].onload();
  await reading;
  assert.deepEqual(app.read('state.machineInfo[0].ltcRounds'), ['MANUAL-A1', 'MANUAL-A2', 'LTC-FROM-PHOTO']);
  assert.equal(app.elements.get('ltcQrDialog').open, false);
  assert.ok(app.revoked.includes('blob:test-1'));
  assert.equal(app.elements.get('ltcQrCanvas').width, 0);
  assert.equal(app.elements.get('ltcQrCanvas').height, 0);
});

test('photos with no QR or loading errors preserve manual input and allow retry', async () => {
  for (const failedLoad of [false, true]) {
    const app = page();
    app.run('openLtcQr(0,0)');
    await app.flush();
    const reading = app.photo();
    app.decode(' ');
    if (failedLoad) app.images[0].onerror(new Error('Unsupported image'));
    else app.images[0].onload();
    await reading;
    assert.equal(app.elements.get('ltc_0_0').value, 'MANUAL-A1');
    assert.equal(app.localStorage.getItem('ipqc_pad_v3'), null);
    assert.equal(app.elements.get('ltcQrDialog').open, true);
    assert.equal(app.elements.get('ltcQrStatus').textContent, app.run(`tr('${failedLoad ? 'qrPhotoError' : 'qrNoCode'}')`));
    assert.ok(app.revoked.includes('blob:test-1'));
  }
});

test('a late photo is ignored after closing, retrying the camera, or opening another target', async () => {
  for (const nextAction of ['closeLtcQr()', 'startLtcCamera()', 'openLtcQr(1,1)']) {
    const app = page();
    app.run('openLtcQr(0,0)');
    await app.flush();
    const reading = app.photo();
    app.run(nextAction);
    await app.flush();
    app.decode('STALE-PHOTO');
    app.images[0].onload();
    await reading;
    assert.deepEqual(app.read('state.machineInfo.map(info=>info.ltcRounds)'), [
      ['MANUAL-A1', 'MANUAL-A2', 'MANUAL-A3'],
      ['MANUAL-B1', 'MANUAL-B2', 'MANUAL-B3'],
    ]);
    assert.equal(app.localStorage.getItem('ipqc_pad_v3'), null);
    assert.ok(app.revoked.includes('blob:test-1'));
  }
});

test('selecting a newer photo ignores an older decode and writes only the newest photo', async () => {
  const app = page();
  app.run('openLtcQr(0,0)');
  await app.flush();
  const first = app.photo(), second = app.photo();
  app.decode('OLD-PHOTO');
  app.images[0].onload();
  await first;
  assert.equal(app.elements.get('ltc_0_0').value, 'MANUAL-A1');
  app.decode('NEW-PHOTO');
  app.images[1].onload();
  await second;
  assert.equal(app.elements.get('ltc_0_0').value, 'NEW-PHOTO');
  assert.ok(app.revoked.includes('blob:test-1'));
  assert.ok(app.revoked.includes('blob:test-2'));
});
