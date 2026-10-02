/* Excel vocabulary administration. Parser and stable word IDs are supplied by NamdalraBooks. */
(function () {
  'use strict';
  const LIMIT = 1000, LIBRARY_LIMIT = 200, FILE_LIMIT = 5 * 1024 * 1024, ROWS = 12;
  const sessions = new Set();
  let sequence = 0, writes = 0;
  const auth = () => window.NamdalraAuth;
  const esc = value => auth().escape(String(value ?? ''));
  const message = error => error?.message || '요청을 처리하지 못했어요. 다시 시도해 주세요.';
  const protectedMember = member => !member || member.role === 'admin' || String(member.id) === String(auth()?.user?.id);
  const endpoint = id => '/api/books/' + encodeURIComponent(String(id));
  const conflict = error => Number(error?.status || error?.statusCode) === 409;
  function helper() {
    if (!window.NamdalraBooks?.parseFile || !window.NamdalraBooks?.prepareWords) throw new Error('엑셀 읽기 기능을 준비하지 못했어요. 화면을 새로고침해 주세요.');
    return window.NamdalraBooks;
  }
  function session(root, current) {
    const owner = String(auth()?.user?.id);
    const value = {root, owner, ended: false, dialogs: new Set(), alive() { return !value.ended && root.isConnected && current() && auth()?.user?.role === 'admin' && auth()?.user?.status === 'active' && String(auth().user.id) === owner; }, end() { value.ended = true; for (const dialog of value.dialogs) { if (dialog.open) dialog.close(); dialog.remove(); } value.dialogs.clear(); sessions.delete(value); }};
    sessions.add(value); return value;
  }
  function destroy() { for (const item of [...sessions]) item.end(); }
  window.addEventListener('namdalra-account-changed', event => {
    const user = event.detail?.user;
    for (const item of [...sessions]) if (!user || user.role !== 'admin' || user.status !== 'active' || String(user.id) !== item.owner) item.end();
  });
  async function write(owner, path, options) {
    if (!owner.alive()) throw new Error('관리자 화면을 다시 열어 주세요.');
    writes++;
    try { return await auth().api(path, options); } finally { writes--; }
  }
  function date(value) { const parsed = value ? new Date(value) : null; return parsed && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(parsed) : '—'; }
  function bookList(result) { if (!result || !Array.isArray(result.books)) throw new Error('단어장 목록을 확인할 수 없어요.'); return result.books.filter(book => book && typeof book.id === 'string'); }
  function validateFile(file) { if (!file || !/\.(xlsx|xls)$/i.test(file.name)) throw new Error('.xlsx 또는 .xls 엑셀 파일을 선택해 주세요.'); if (file.size > FILE_LIMIT) throw new Error('파일 한 개는 5MiB 이하로 선택해 주세요.'); }
  function prepare(rows, previous = []) { const words = helper().prepareWords(rows, previous); if (!Array.isArray(words) || !words.length || words.length > LIMIT) throw new Error('단어장에는 1~1,000개의 단어가 필요해요.'); return words; }
  function dialog(owner, title, html, className = '') {
    const element = document.createElement('dialog'); const id = ++sequence;
    element.className = 'admin-dialog books-dialog ' + className;
    element.setAttribute('aria-labelledby', 'books-dialog-' + id);
    element.innerHTML = '<div class="admin-dialog-header"><h2 id="books-dialog-' + id + '">' + esc(title) + '</h2><button class="admin-close" type="button" data-close aria-label="창 닫기">✕</button></div>' + html;
    let busy = false; const previous = new Map();
    const close = () => { if (busy) return; element.close(); element.remove(); owner.dialogs.delete(element); if (owner.oneShot) owner.end(); };
    element.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
    element.addEventListener('cancel', event => { event.preventDefault(); close(); });
    owner.root.appendChild(element); owner.dialogs.add(element); element.showModal();
    return {element, close, alive: () => owner.alive() && element.isConnected && element.open, isBusy: () => busy,
      setBusy(value) { busy = value; element.setAttribute('aria-busy', String(value)); if (value) { previous.clear(); element.querySelectorAll('button,input,textarea,select').forEach(control => { previous.set(control, control.disabled); control.disabled = true; }); } else { for (const [control, disabled] of previous) if (control.isConnected) control.disabled = disabled; previous.clear(); } }
    };
  }
  function inlineError(element, text, reload) {
    const box = element.querySelector('[data-book-error]'); if (!box) return;
    box.hidden = !text; box.innerHTML = text ? '<p>' + esc(text) + '</p>' + (reload ? '<button type="button" class="books-link" data-reload-conflict>최신 내용 다시 불러오기</button>' : '') : '';
    if (reload) box.querySelector('[data-reload-conflict]').addEventListener('click', reload);
  }
  function warningText(warnings) { return Array.isArray(warnings) ? warnings.map(value => typeof value === 'string' ? value : value?.message || String(value)).filter(Boolean) : []; }

  function mount(container, options) {
    const owner = session(container, options.isCurrent);
    let library = [], libraryReady = false, libraryVersion = 0, imports = [], parsing = false, saving = false, page = 1, query = '';
    container.innerHTML = '<div class="books-manager"><div class="books-heading"><div><p class="admin-eyebrow">MY WORD LIBRARY</p><h3>우리 반의 단어장을 모아요</h3><p>엑셀에서 가져와 다듬고, 학생에게 꼭 맞는 단어장을 배정하세요.</p></div><span aria-hidden="true">📚</span></div><div class="books-upload" data-drop><div class="books-upload-icon" aria-hidden="true">＋</div><div><strong>엑셀 파일을 여기에 놓아 주세요</strong><p>여러 파일을 한 번에 선택할 수 있어요.</p><small>.xlsx · .xls / 파일당 5MiB / 단어장당 최대 1,000단어</small></div><button type="button" class="btn btn-primary" data-pick>엑셀 파일 선택</button><input type="file" accept=".xlsx,.xls" multiple hidden data-files></div><div data-imports></div><div class="books-library-heading"><div><h3>저장된 단어장 <span data-book-count>—</span></h3><p>학생별 배정은 회원 정보의 ‘단어장 배정’에서 할 수 있어요.</p></div><label><span class="sr-only">단어장 제목 검색</span><input type="search" maxlength="200" data-book-search placeholder="단어장 제목 검색"></label></div><div data-library aria-live="polite"></div><p class="books-limit-note">단어장은 최대 200개까지 보관할 수 있어요. 엑셀을 선택한 뒤 미리보기를 확인하고 저장해 주세요.</p></div>';
    const filesInput = container.querySelector('[data-files]'); const drop = container.querySelector('[data-drop]');
    container.querySelector('[data-pick]').addEventListener('click', () => { if (owner.alive() && !parsing && !saving) filesInput.click(); });
    filesInput.addEventListener('change', () => { const selected = [...filesInput.files]; filesInput.value = ''; importFiles(selected); });
    drop.addEventListener('dragover', event => { event.preventDefault(); if (!parsing && !saving) drop.classList.add('is-dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
    drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('is-dragging'); if (!parsing && !saving) importFiles([...event.dataTransfer.files]); });
    container.querySelector('[data-book-search]').addEventListener('input', event => { query = event.target.value.trim().toLocaleLowerCase('ko-KR'); page = 1; renderLibrary(); });
    function controls() { container.querySelector('[data-pick]').disabled = parsing || saving || !libraryReady; drop.setAttribute('aria-busy', String(parsing || saving)); options.onBusy?.(saving); }
    function renderLibrary() {
      if (!owner.alive() || !libraryReady) return;
      const target = container.querySelector('[data-library]');
      const matches = library.filter(book => String(book.title || '').toLocaleLowerCase('ko-KR').includes(query)); const pages = Math.max(1, Math.ceil(matches.length / 9)); page = Math.min(page, pages);
      container.querySelector('[data-book-count]').textContent = library.length;
      target.innerHTML = matches.length ? '<div class="books-grid">' + matches.slice((page - 1) * 9, page * 9).map((book, index) => '<article class="books-card"><div class="books-card-cover"><span aria-hidden="true">' + ['📗','📙','📘'][index % 3] + '</span><small>' + (Number.isInteger(book.wordCount) ? book.wordCount : 0) + ' WORDS</small></div><h4>' + esc(book.title) + '</h4><p>' + esc(book.description || '설명을 추가하면 단어장을 쉽게 구분할 수 있어요.') + '</p><small class="books-source">' + esc(book.sourceName || '직접 편집한 단어장') + '</small><div class="books-card-bottom"><span>' + esc(date(book.updatedAt)) + ' 수정</span><button type="button" class="books-link" data-edit-book="' + ((page - 1) * 9 + index) + '">수정하기 ↗</button></div></article>').join('') + '</div><div class="books-pagination"><button type="button" class="btn btn-outline" data-books-previous ' + (page === 1 ? 'disabled' : '') + '>이전</button><span>' + page + ' / ' + pages + ' · ' + matches.length + '개</span><button type="button" class="btn btn-outline" data-books-next ' + (page === pages ? 'disabled' : '') + '>다음</button></div>' : '<div class="admin-empty"><span aria-hidden="true">📖</span><h3>' + (query ? '검색한 단어장이 없어요' : '첫 단어장을 가져와 볼까요?') + '</h3><p>' + (query ? '다른 제목으로 검색해 주세요.' : '엑셀 파일을 선택하면 단어와 뜻을 미리 확인할 수 있어요.') + '</p></div>';
      target.querySelectorAll('[data-edit-book]').forEach(button => button.addEventListener('click', () => !saving && openBook(owner, matches[Number(button.dataset.editBook)].id, loadLibrary)));
      for (const [selector, step] of [['[data-books-previous]', -1], ['[data-books-next]', 1]]) target.querySelector(selector)?.addEventListener('click', () => { page += step; renderLibrary(); });
    }
    async function loadLibrary() {
      if (!owner.alive()) return; const version = ++libraryVersion; libraryReady = false; controls();
      const target = container.querySelector('[data-library]'); target.innerHTML = '<div class="admin-loading" role="status">단어장을 불러오고 있어요…</div>';
      try { const result = await auth().api('/api/books'); if (!owner.alive() || version !== libraryVersion) return; library = bookList(result); container.querySelector('.books-limit-note').textContent=result.limitReached?'최근 수정한 200개 단어장을 표시하고 있어요. 새 단어장 추가 대신 기존 단어장을 수정해 주세요.':'엑셀을 선택한 뒤 미리보기를 확인하고 저장해 주세요. 한 번에 최대 200개 단어장을 관리해요.'; libraryReady = true; controls(); renderLibrary(); }
      catch (error) { if (!owner.alive() || version !== libraryVersion) return; target.innerHTML = '<div class="admin-empty"><h3>단어장을 불러오지 못했어요</h3><p>' + esc(message(error)) + '</p><button class="btn btn-outline" type="button" data-retry-books>다시 불러오기</button></div>'; target.querySelector('[data-retry-books]').addEventListener('click', loadLibrary); }
    }
    function renderImports() {
      if (!owner.alive()) return; const target = container.querySelector('[data-imports]'); if (!imports.length) { target.innerHTML = ''; return; }
      const ready = imports.filter(item => ['ready', 'failed'].includes(item.status)); const saved = imports.filter(item => item.status === 'saved').length;
      target.innerHTML = '<section class="books-import-panel"><div class="books-import-heading"><div><h3>가져올 단어장 미리보기</h3><p role="status">' + (parsing ? '엑셀 내용을 읽고 있어요…' : saving ? '차례대로 저장하고 있어요. ' + saved + ' / ' + imports.length + '개 완료' : '전체 ' + imports.length + '개 · 저장 완료 ' + saved + '개 · 저장 대기 ' + ready.length + '개') + '</p></div><button type="button" class="books-link" data-clear-imports ' + (parsing || saving ? 'disabled' : '') + '>미리보기 비우기</button></div><div class="books-import-list">' + imports.map((item, index) => '<article class="books-import-item"><span class="books-import-mark" aria-hidden="true">' + ({parsing:'◌',ready:'📗',saving:'◌',saved:'✓',failed:'!',error:'!'}[item.status]) + '</span><div><label><span class="sr-only">단어장 제목</span><input data-import-title="' + index + '" maxlength="120" value="' + esc(item.title || item.sourceName) + '" ' + (['parsing','saving','saved','error'].includes(item.status) || saving ? 'disabled' : '') + '></label><small>' + esc(item.sourceName) + (item.words ? ' · ' + item.words.length + '단어' : '') + '</small>' + (item.error ? '<p class="books-item-error" role="status">' + esc(item.error) + '</p>' : '') + (item.warnings?.length ? '<p class="books-item-warning">' + item.warnings.map(esc).join('<br>') + '</p>' : '') + '</div><div class="books-import-item-actions"><span>' + ({parsing:'읽는 중',ready:'저장 대기',saving:'저장 중',saved:'저장 완료',failed:'저장 실패',error:'파일 확인 필요'}[item.status]) + '</span>' + (item.words && !['saved','saving'].includes(item.status) ? '<button type="button" class="books-link" data-preview-import="' + index + '" ' + (saving || parsing ? 'disabled' : '') + '>내용 확인</button>' : '') + '</div></article>').join('') + '</div><div class="books-import-footer"><p>저장 완료된 파일은 다시 저장하지 않아요. 실패한 파일은 오류를 확인한 뒤 다시 시도할 수 있어요.</p><button class="btn btn-primary" type="button" data-save-imports ' + (!ready.length || parsing || saving || !libraryReady ? 'disabled' : '') + '>' + (saving ? '저장 중…' : '대기 중인 ' + ready.length + '개 저장') + '</button></div></section>';
      target.querySelector('[data-clear-imports]').addEventListener('click', () => { if (!saving && !parsing) { imports = []; renderImports(); } });
      target.querySelectorAll('[data-import-title]').forEach(input => input.addEventListener('input', () => { imports[Number(input.dataset.importTitle)].title = input.value; }));
      target.querySelectorAll('[data-preview-import]').forEach(button => button.addEventListener('click', () => { const item = imports[Number(button.dataset.previewImport)]; openEditor(owner, {...item, id: '', revision: 0}, async draft => { Object.assign(item, draft, {status:'ready',error:''}); renderImports(); }, true); }));
      target.querySelector('[data-save-imports]').addEventListener('click', saveImports);
    }
    async function importFiles(files) {
      if (!owner.alive() || parsing || saving || !libraryReady || !files.length) return;
      if (files.length > LIBRARY_LIMIT || library.length + imports.filter(item => item.status !== 'saved').length + files.length > LIBRARY_LIMIT) { auth().notify('보관 가능한 단어장은 최대 200개예요. 가져올 파일 수를 줄여 주세요.'); return; }
      parsing = true; controls();
      const added = files.map(file => ({file,sourceName:file.name,title:file.name.replace(/\.(xlsx|xls)$/i,''),description:'',status:'parsing',words:null,warnings:[],error:''})); imports.push(...added); renderImports();
      for (const item of added) {
        if (!owner.alive()) return;
        try { validateFile(item.file); const parsed = await helper().parseFile(item.file); if (!owner.alive()) return; Object.assign(item, {title:parsed.title || item.title,sourceName:parsed.sourceName || item.sourceName,words:prepare(parsed.words),warnings:warningText(parsed.warnings),status:'ready'}); if (library.some(book => book.sourceName === item.sourceName)) item.warnings.push('같은 이름의 파일로 만든 단어장이 있어요. 기존 단어장을 바꾸려면 수정하기에서 엑셀을 교체해 주세요.'); }
        catch (error) { if (!owner.alive()) return; item.status = 'error'; item.error = message(error); }
        item.file = null; renderImports();
      }
      parsing = false; controls(); renderImports();
    }
    async function saveImports() {
      if (!owner.alive() || saving || parsing || !libraryReady) return;
      const ready = imports.filter(item => ['ready','failed'].includes(item.status)); if (!ready.length) return;
      if (library.length + ready.length > LIBRARY_LIMIT) { auth().notify('저장 가능한 단어장 수를 초과했어요. 최대 200개까지 보관할 수 있어요.'); return; }
      saving = true; writes++; controls(); renderImports();
      try {
        for (const item of ready) {
          if (!owner.alive()) break;
          item.status = 'saving'; item.error = ''; renderImports();
          try {
            const title = item.title.trim(); if (!title) throw new Error('단어장 제목을 입력해 주세요.');
            const body = {title,description:item.description || '',sourceName:item.sourceName,words:prepare(item.words)};
            const result = await auth().api('/api/books', {method:'POST',body}); if (!owner.alive()) break;
            if (!result?.book?.id) throw new Error('저장 결과를 확인하지 못했어요. 단어장 목록을 확인해 주세요.');
            item.status = 'saved'; item.savedId = result.book.id; library.push(result.book);
          } catch (error) { if (!owner.alive()) break; item.status = 'failed'; item.error = message(error); }
          renderImports(); renderLibrary();
        }
      } finally { writes--; saving = false; if (owner.alive()) { controls(); renderImports(); renderLibrary(); } }
    }
    loadLibrary();
    return () => { owner.end(); options.onBusy?.(false); };
  }

  async function openBook(owner, id, onSaved) {
    if (!owner.alive()) return;
    const loading = dialog(owner, '단어장 불러오기', '<div class="admin-loading" role="status">단어를 불러오고 있어요…</div><div data-book-error class="admin-inline-error" hidden></div>');
    try { const result = await auth().api(endpoint(id)); if (!loading.alive()) return; if (!result?.book || !Array.isArray(result.book.words)) throw new Error('단어장 내용을 확인할 수 없어요.'); loading.close(); openEditor(owner, result.book, onSaved, false); }
    catch (error) { if (loading.alive()) { loading.element.querySelector('.admin-loading').remove(); inlineError(loading.element, message(error)); } }
  }
  function openEditor(owner, book, onSaved, draftOnly) {
    if (!owner.alive()) return;
    const original = {...book,words:(book.words || []).map(word => ({...word}))};
    const draft = {...book,description:book.description || '',sourceName:book.sourceName || '',words:original.words.map(word => ({...word}))};
    let page = 1, version = 0, locked = false, replacing = false;
    const modal = dialog(owner, draftOnly ? '가져올 단어장 확인' : '단어장 수정', '<div class="books-editor-fields"><label><span>단어장 제목</span><input data-title maxlength="120" value="' + esc(draft.title) + '"></label><label><span>설명 <small>선택</small></span><textarea data-description maxlength="2000" rows="2">' + esc(draft.description) + '</textarea></label></div><div class="books-editor-toolbar"><p><strong data-editor-count>' + draft.words.length + '</strong>단어 <span>· ' + esc(draft.sourceName || '직접 편집') + '</span></p><div><button class="btn btn-outline" type="button" data-replace>엑셀 파일 교체</button><input type="file" accept=".xlsx,.xls" hidden data-replacement-file><button class="btn btn-outline" type="button" data-add-word>＋ 단어 추가</button></div></div><div data-replacement-preview></div><div class="books-word-header" aria-hidden="true"><span>번호</span><span>영어 단어</span><span>우리말 뜻</span><span>관리</span></div><div data-word-rows></div><div data-word-pages></div><p class="books-edit-note">기존 단어의 식별자는 유지해 학습 기록을 이어가요. 삭제한 단어의 과거 학습 기록은 지우지 않아요.</p><div class="admin-inline-error" data-book-error role="alert" hidden></div><div class="admin-dialog-actions"><button type="button" class="btn btn-soft" data-close>닫기</button><button type="button" class="btn btn-primary" data-save-book>' + (draftOnly ? '미리보기에 반영' : '변경 내용 저장') + '</button></div>', 'books-editor-dialog');
    const save = modal.element.querySelector('[data-save-book]');
    const current = () => modal.alive() && !locked;
    modal.element.querySelector('[data-title]').addEventListener('input', event => { draft.title = event.target.value; });
    modal.element.querySelector('[data-description]').addEventListener('input', event => { draft.description = event.target.value; });
    function renderRows() {
      if (!modal.alive()) return; const total = Math.max(1, Math.ceil(draft.words.length / ROWS)); page = Math.min(Math.max(1,page),total);
      modal.element.querySelector('[data-editor-count]').textContent = draft.words.length;
      const target = modal.element.querySelector('[data-word-rows]');
      target.innerHTML = draft.words.slice((page - 1) * ROWS,page * ROWS).map((word,index) => { const row = (page - 1) * ROWS + index; return '<div class="books-word-row"><span class="books-row-number">' + (row + 1) + '<em aria-hidden="true" data-row-picture="' + row + '">' + esc(word.emoji || '📘') + '</em></span><label><span>영어 단어</span><input data-row="' + row + '" data-field="en" maxlength="120" value="' + esc(word.en) + '" aria-label="' + (row + 1) + '번 영어 단어"></label><label><span>우리말 뜻</span><input data-row="' + row + '" data-field="ko" maxlength="300" value="' + esc(word.ko) + '" aria-label="' + (row + 1) + '번 우리말 뜻"></label><button type="button" class="books-remove-row" data-remove-row="' + row + '" aria-label="' + (row + 1) + '번 단어 삭제">삭제</button><details class="books-word-extra"><summary>품사 · 그림 · 예문</summary><div>' + [['pos','품사',40],['emoji','그림(이모지)',16],['example','영어 예문',500],['translation','예문 해석',500]].map(([field,label,max]) => '<label><span>' + label + '</span><input data-row="' + row + '" data-field="' + field + '" maxlength="' + max + '" value="' + esc(word[field]) + '" aria-label="' + (row + 1) + '번 ' + label + '"></label>').join('') + '<button class="books-link" type="button" data-suggest-picture="' + row + '">그림 추천</button></div></details></div>'; }).join('') || '<p class="admin-section-empty">단어를 추가해 주세요.</p>';
      target.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => { draft.words[Number(input.dataset.row)][input.dataset.field] = input.value; }));
      target.querySelectorAll('[data-suggest-picture]').forEach(button => button.addEventListener('click', () => { if (!current() || modal.isBusy()) return; const index = Number(button.dataset.suggestPicture); const word = draft.words[index]; word.emoji = window.NamdalraPictures?.lookup(word.en,word.ko) || '📘'; const input = target.querySelector('[data-row="' + index + '"][data-field="emoji"]'); if (input) input.value = word.emoji; const picture = target.querySelector('[data-row-picture="' + index + '"]'); if (picture) picture.textContent = word.emoji; }));
      target.querySelectorAll('[data-remove-row]').forEach(button => button.addEventListener('click', () => { if (!current() || modal.isBusy()) return; draft.words.splice(Number(button.dataset.removeRow),1); renderRows(); }));
      const navigation = modal.element.querySelector('[data-word-pages]'); navigation.innerHTML = '<div class="books-pagination"><button class="btn btn-outline" type="button" data-prev ' + (page === 1 ? 'disabled' : '') + '>이전</button><span>' + page + ' / ' + total + '</span><button class="btn btn-outline" type="button" data-next ' + (page === total ? 'disabled' : '') + '>다음</button></div>';
      navigation.querySelector('[data-prev]').addEventListener('click', () => { page--; renderRows(); }); navigation.querySelector('[data-next]').addEventListener('click', () => { page++; renderRows(); });
      modal.element.querySelector('[data-add-word]').disabled = draft.words.length >= LIMIT || locked;
    }
    modal.element.querySelector('[data-add-word]').addEventListener('click', () => { if (!current() || modal.isBusy()) return; if (draft.words.length >= LIMIT) return; draft.words.push({id:'',en:'',ko:'',pos:'',emoji:'📖',example:'',translation:''}); page = Math.ceil(draft.words.length / ROWS); renderRows(); modal.element.querySelector('[data-row="' + (draft.words.length - 1) + '"][data-field="en"]')?.focus(); });
    const input = modal.element.querySelector('[data-replacement-file]');
    modal.element.querySelector('[data-replace]').addEventListener('click', () => { if (current() && !replacing && !modal.isBusy()) input.click(); });
    input.addEventListener('change', async () => {
      const file = input.files[0]; input.value = ''; if (!file || !current() || modal.isBusy()) return;
      const token = ++version; replacing = true; const target = modal.element.querySelector('[data-replacement-preview]'); target.innerHTML = '<p class="books-replacement" role="status">새 엑셀을 읽고 있어요…</p>'; save.disabled = true;
      try {
        validateFile(file); const parsed = await helper().parseFile(file); if (!current() || token !== version) return;
        const words = prepare(parsed.words,draft.words); const ids = new Set(draft.words.map(word => word.id).filter(Boolean)); const kept = words.filter(word => ids.has(word.id)).length;
        target.innerHTML = '<div class="books-replacement"><strong>' + esc(file.name) + '</strong><p>기존 ' + draft.words.length + '개 → 새 파일 ' + words.length + '개 · 학습 기록이 이어지는 단어 ' + kept + '개</p><p>단어장 제목과 설명을 유지하고, 아래 확인을 누르면 편집할 단어 목록을 바꿔요. 마지막 저장 버튼을 눌러야 적용돼요.</p>' + (warningText(parsed.warnings).length ? '<p class="books-item-warning">' + warningText(parsed.warnings).map(esc).join('<br>') + '</p>' : '') + '<div class="books-replacement-sample">' + words.slice(0,5).map(word => '<span><i aria-hidden="true">' + esc(word.emoji || '📘') + '</i> <b>' + esc(word.en) + '</b> · ' + esc(word.ko) + '</span>').join('') + '</div><div><button class="btn btn-outline" type="button" data-apply-replacement>이 목록으로 편집하기</button><button class="books-link" type="button" data-cancel-replacement>취소</button></div></div>';
        target.querySelector('[data-apply-replacement]').addEventListener('click', () => { if (!current() || modal.isBusy()) return; draft.words = words; draft.sourceName = parsed.sourceName || file.name; page = 1; target.innerHTML = ''; renderRows(); });
        target.querySelector('[data-cancel-replacement]').addEventListener('click', () => { target.innerHTML = ''; });
      } catch (error) { if (modal.alive() && token === version) target.innerHTML = '<p class="admin-inline-error" role="alert">' + esc(message(error)) + '</p>'; }
      finally { if (modal.alive() && token === version) { replacing = false; save.disabled = locked; } }
    });
    save.addEventListener('click', async () => {
      if (!current() || modal.isBusy() || replacing) return; inlineError(modal.element,'');
      let payload;
      try { const title = draft.title.trim(); if (!title) throw new Error('단어장 제목을 입력해 주세요.'); const words = prepare(draft.words,original.words); draft.words = words; payload = {title,description:draft.description.trim(),sourceName:draft.sourceName,words}; }
      catch (error) { inlineError(modal.element,message(error)); return; }
      modal.setBusy(true); save.textContent = draftOnly ? '반영 중…' : '저장 중…';
      try {
        if (draftOnly) { await onSaved({...draft,...payload}); if (!modal.alive()) return; modal.setBusy(false); modal.close(); return; }
        const result = await write(owner, endpoint(original.id), {method:'PUT',body:{...payload,revision:original.revision}});
        if (!modal.alive()) return; if (!result?.book?.id) throw new Error('저장 결과를 확인할 수 없어요.');
        modal.setBusy(false); modal.close(); auth().notify('단어장을 저장했어요.'); await onSaved?.();
      } catch (error) {
        if (!modal.alive()) return; modal.setBusy(false); save.textContent = draftOnly ? '미리보기에 반영' : '변경 내용 저장';
        if (conflict(error)) { locked = true; save.disabled = true; inlineError(modal.element,'다른 관리자가 단어장을 수정했어요. 지금 입력한 수정 대신 최신 내용을 다시 불러온 뒤 편집해 주세요.', () => { if (!modal.alive()) return; modal.close(); openBook(owner,original.id,onSaved); }); }
        else inlineError(modal.element,message(error));
      }
    });
    renderRows();
  }

  function openAssignments(root, member, options) {
    if (protectedMember(member) || !options.isCurrent()) return;
    const owner = session(root, options.isCurrent); owner.oneShot = true;
    const modal = dialog(owner, '학생에게 단어장 배정', '<div class="books-assignment-person"><strong>' + esc(member.name) + '</strong><p>단어장을 하나 이상 고르세요. 아무것도 고르지 않으면 현재 학년의 기본 단어를 공부해요.</p></div><div data-assignment-options><div class="admin-loading" role="status">배정 정보를 불러오고 있어요…</div></div><div class="admin-inline-error" data-book-error role="alert" hidden></div><div class="admin-dialog-actions"><button type="button" class="btn btn-soft" data-close>닫기</button><button type="button" class="btn btn-primary" data-save-assignment disabled>배정 저장</button></div>', 'books-assignment-dialog');
    const save = modal.element.querySelector('[data-save-assignment]'); let selected = new Set(), revision = 0, locked = false, token = 0;
    const path = '/api/members/' + encodeURIComponent(String(member.id)) + '/assignments';
    async function load() {
      const version = ++token; if (!modal.alive()) return; save.disabled = true; locked = false; inlineError(modal.element,'');
      modal.element.querySelector('[data-assignment-options]').innerHTML = '<div class="admin-loading" role="status">배정 정보를 불러오고 있어요…</div>';
      try {
        const [listed,result] = await Promise.all([auth().api('/api/books'),auth().api(path)]);
        if (!modal.alive() || version !== token) return;
        const library = bookList(listed); if (!result?.assignment || !Array.isArray(result.assignment.bookIds) || !Number.isInteger(result.assignment.revision)) throw new Error('배정 정보를 확인할 수 없어요.');
        revision = result.assignment.revision; selected = new Set(result.assignment.bookIds);
        for(const book of (result.books||[]))if(book?.id && !library.some(item=>item.id===book.id))library.push(book);
        const existing = new Set(library.map(book => book.id)); const missing = [...selected].filter(id => !existing.has(id));
        const books = [...library,...missing.map(id => ({id,title:'현재 확인할 수 없는 단어장',wordCount:null,unavailable:true}))];
        const target = modal.element.querySelector('[data-assignment-options]');
        target.innerHTML = '<div class="books-assignment-summary"><span data-assignment-count></span><button type="button" class="books-link" data-unassign>모두 해제 · 학년 기본 단어</button></div>' + (books.length ? '<div class="books-assignment-list">' + books.map((book,index) => '<label class="books-assignment-option"><input type="checkbox" data-book-choice="' + index + '" ' + (selected.has(book.id) ? 'checked' : '') + '><span class="books-check-icon" aria-hidden="true">📗</span><span><strong>' + esc(book.title) + '</strong><small>' + (book.unavailable ? '목록에서 확인할 수 없어요. 선택을 해제하면 배정에서 제외돼요.' : Number(book.wordCount || 0) + '단어' + (book.description ? ' · ' + esc(book.description) : '')) + '</small></span></label>').join('') + '</div>' : '<p class="admin-section-empty">아직 저장된 단어장이 없어요.<br>단어장 탭에서 엑셀을 가져온 뒤 배정할 수 있어요.</p>');
        function update() { target.querySelector('[data-assignment-count]').textContent = selected.size ? selected.size + ' / 20개 선택' : '현재 학년 기본 단어 사용'; target.querySelectorAll('[data-book-choice]').forEach(input => { input.disabled = !input.checked && (selected.size >= 20 || books[Number(input.dataset.bookChoice)].unavailable); }); save.disabled = locked || selected.size > 20 || books.some(book=>book.unavailable && selected.has(book.id)); }
        target.querySelectorAll('[data-book-choice]').forEach(input => input.addEventListener('change', () => { const book = books[Number(input.dataset.bookChoice)]; if (input.checked) selected.add(book.id); else selected.delete(book.id); update(); }));
        target.querySelector('[data-unassign]').addEventListener('click', () => { selected.clear(); target.querySelectorAll('[data-book-choice]').forEach(input => { input.checked = false; }); update(); }); update();
      } catch (error) { if (!modal.alive() || version !== token) return; modal.element.querySelector('[data-assignment-options]').innerHTML = ''; inlineError(modal.element,message(error),load); }
    }
    save.addEventListener('click', async () => {
      if (!modal.alive() || modal.isBusy() || locked || selected.size > 20) return; modal.setBusy(true); save.textContent = '저장 중…'; inlineError(modal.element,'');
      try { await write(owner,path,{method:'PUT',body:{bookIds:[...selected],revision}}); if (!modal.alive()) return; modal.setBusy(false); modal.close(); owner.end(); auth().notify(selected.size ? '학생의 단어장을 배정했어요.' : '현재 학년 기본 단어로 배정을 바꿨어요.'); await options.onSaved?.(); }
      catch (error) { if (!modal.alive()) return; modal.setBusy(false); save.textContent = '배정 저장'; if (conflict(error)) { locked = true; save.disabled = true; inlineError(modal.element,'다른 관리자가 배정을 변경했어요. 최신 배정을 다시 불러온 뒤 선택해 주세요.',load); } else inlineError(modal.element,message(error)); }
    });
    load();
  }
  window.NamdalraWorkbookAdmin = Object.freeze({mount,openAssignments,destroy,isBusy:() => writes > 0});
})();
