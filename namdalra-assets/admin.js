/* Namdalra Firebase member administration. No external dependencies. */
(function () {
  'use strict';

  const GRADES = {
    e1: '초등 1학년', e2: '초등 2학년', e3: '초등 3학년',
    e4: '초등 4학년', e5: '초등 5학년', e6: '초등 6학년',
    m1: '중등 1학년', m2: '중등 2학년', m3: '중등 3학년'
  };
  const state = {query: '', grade: '', status: '', tab: 'members', page: 1};
  let activeRoot = null;
  let activeOwner = null;
  let requestVersion = 0;
  let dialogNumber = 0;
  let searchTimer = null;
  let booksCleanup = null;

  const auth = () => window.NamdalraAuth;
  const escape = value => auth().escape(value == null ? '' : String(value));
  const memberId = member => String(member.id);
  const endpoint = member => '/api/members/' + encodeURIComponent(memberId(member));
  const protectedMember = member => member.role === 'admin' ||
    (auth().user && String(auth().user.id) === memberId(member));
  const authorized = user => Boolean(user && user.role === 'admin' && user.status === 'active');
  const current = root => Boolean(root && root === activeRoot && root.isConnected && auth() &&
    authorized(auth().user) && String(auth().user.id) === activeOwner && auth().view() === 'admin');
  const message = error => error && error.message ? error.message : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  const notify = text => auth().notify(text);

  function destroy() {
    booksCleanup?.(); booksCleanup = null; window.NamdalraWorkbookAdmin?.destroy();
    clearTimeout(searchTimer);
    requestVersion++;
    if (activeRoot) {
      activeRoot.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      activeRoot.remove();
    }
    activeRoot = null;
    activeOwner = null;
    state.query = ''; state.grade = ''; state.status = ''; state.tab = 'members'; state.page = 1;
    activityVersion++; pageActivities.clear(); members = []; membersReady = false; pumpActivity();
  }

  window.addEventListener('namdalra-account-changed', event => {
    const user = event.detail && event.detail.user;
    if (activeRoot && (!authorized(user) || String(user.id) !== activeOwner)) destroy();
  });

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function gradeOptions(selected, all) {
    return (all ? '<option value="">전체 학년</option>' : '<option value="">학년을 선택해 주세요</option>') +
      Object.entries(GRADES).map(([value, label]) =>
        '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + label + '</option>'
      ).join('');
  }

  function statusBadge(member) {
    return member.status === 'suspended'
      ? '<span class="admin-status admin-status-suspended">이용 정지</span>'
      : '<span class="admin-status admin-status-active">이용 중</span>';
  }

  const PAGE_SIZE = 8;
  const LEVEL_LABELS = {sprout: '초등 1–4학년', leaf: '초등 5–6학년', tree: '중등 1학년', forest: '중등 2–3학년'};
  const CATEGORY_LABELS = {everyday: ['☀️', '일상·생활'], school: ['✏️', '학교·배움'], nature: ['🌿', '자연·환경'], people: ['💛', '사람·마음'], world: ['🌏', '세상·문화']};
  let members = [];
  let membersReady = false;
  let activityVersion = 0;
  let activityRunning = 0;
  const activityQueue = [];
  const pageActivities = new Map();
  const gradeLevel = grade => /^e[1-4]$/.test(grade) ? 'sprout' : /^e[56]$/.test(grade) ? 'leaf' : grade === 'm1' ? 'tree' : /^m[23]$/.test(grade) ? 'forest' : '';
  const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
  const vocabulary = () => Array.isArray(window.NamdalraVocabulary) ? window.NamdalraVocabulary : [];
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) && Number.isFinite(new Date(value).getTime());
  const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && validDate(value) && new Date(value).toISOString().slice(0, 10) === value;
  function dayLabel(value) { return value ? value.replace(/-/g, '.') : '기록 없음'; }
  function timeLabel(value) {
    return validDate(value) ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(value)) : '기록 없음';
  }
  function activitySummary(result, member) {
    if (!result || !result.member || String(result.member.id) !== memberId(member)) throw new Error('회원 기록을 확인할 수 없어요. 다시 불러와 주세요.');
    const person = result.member;
    if (protectedMember(person)) throw new Error('관리자 계정의 학습 기록은 이 목록에서 조회하지 않아요.');
    const level = gradeLevel(person.grade);
    const assignmentIds = [...new Set((Array.isArray(result.assignment?.bookIds) ? result.assignment.bookIds : []).filter(id => typeof id === 'string' && id))];
    const assigned = assignmentIds.length > 0;
    const available = new Map((Array.isArray(result.books) ? result.books : []).filter(book => book && typeof book.id === 'string' && Array.isArray(book.words)).map(book => [book.id, book]));
    const missingBooks = assigned ? assignmentIds.filter(id => !available.has(id)) : [];
    const records = assigned ? assignmentIds.filter(id => available.has(id)).map(id => {
      const book = available.get(id); return {key:id,title:String(book.title || '배정 단어장'),words:book.words,progress:book.progress,updatedAt:book.progressUpdatedAt};
    }) : [{key:'builtin',title:LEVEL_LABELS[level] || '학년 확인 필요',words:vocabulary(),progress:result.progress,updatedAt:result.progressUpdatedAt}];
    let incomplete = (!assigned && (!vocabulary().length || !level)) || (result.logins !== undefined && !Array.isArray(result.logins));
    const known = [], wrong = [], starred = [], curriculum = [], categories = [], dayMap = new Map();
    const gameBest = {easy:null,normal:null,fast:null}; let curriculumKnown = 0, progressUpdatedAt = '';
    for (const record of records) {
      const words = record.words.filter(word => plainObject(word) && typeof word.id === 'string' && typeof word.en === 'string' && typeof word.ko === 'string');
      if (words.length !== record.words.length) incomplete = true;
      const ids = new Set(words.map(word => word.id));
      const progress = plainObject(record.progress) ? record.progress : {};
      const savedWords = plainObject(progress.words) ? progress.words : {};
      const savedDays = plainObject(progress.days) ? progress.days : {};
      if ((record.progress != null && !plainObject(record.progress)) || ['words','days','gameBest'].some(key => progress[key] !== undefined && !plainObject(progress[key]))) incomplete = true;
      for (const [id,value] of Object.entries(savedWords)) {
        // Old or removed word IDs remain legitimate history; they do not invalidate current content.
        if (ids.has(id) && (!plainObject(value) || ['known','wrong','starred'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean'))) incomplete = true;
      }
      const marked = flag => words.filter(word => plainObject(savedWords[word.id]) && savedWords[word.id][flag] === true);
      const recordKnown = marked('known'); const knownIds = new Set(recordKnown.map(word => word.id));
      known.push(...recordKnown); wrong.push(...marked('wrong')); starred.push(...marked('starred'));
      const target = assigned ? words : words.filter(word => word.level === level);
      const count = target.filter(word => knownIds.has(word.id)).length;
      curriculum.push(...target); curriculumKnown += count;
      if (assigned) categories.push({id:record.key,label:['📗',record.title],target:target.length,known:count});
      else categories.push(...Object.entries(CATEGORY_LABELS).map(([id,label]) => ({id,label,target:target.filter(word => word.category === id).length,known:target.filter(word => word.category === id && knownIds.has(word.id)).length})));
      for (const [day,value] of Object.entries(savedDays)) {
        if (!validDay(day) || !Array.isArray(value)) { incomplete = true; continue; }
        const historyIds = value.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id));
        if (historyIds.length !== value.length) incomplete = true;
        if (!historyIds.length) continue;
        if (!dayMap.has(day)) dayMap.set(day,new Set());
        historyIds.forEach(id => dayMap.get(day).add(record.key + ':' + id));
      }
      for (const mode of ['easy','normal','fast']) {
        const value = plainObject(progress.gameBest) ? progress.gameBest[mode] : undefined; const valid = number(value);
        if (value !== undefined && valid === null) incomplete = true;
        if (valid !== null) gameBest[mode] = gameBest[mode] === null ? valid : Math.max(gameBest[mode],valid);
      }
      if (validDate(record.updatedAt) && (!progressUpdatedAt || new Date(record.updatedAt) > new Date(progressUpdatedAt))) progressUpdatedAt = record.updatedAt;
    }
    const days = [...dayMap].map(([date,ids]) => ({date,count:ids.size})).sort((a,b) => b.date.localeCompare(a.date));
    const logins = (Array.isArray(result.logins) ? result.logins : []).filter(item => {
      const valid = plainObject(item) && validDate(item.createdAt) && ['login','signup'].includes(item.kind); if (!valid) incomplete = true; return valid;
    }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,30);
    return {member:person,level,assigned,assignmentIds,missingBooks,curriculum,known,wrong,starred,curriculumKnown,days,logins,gameBest,incomplete,categories,bookProgress:assigned ? categories : [],progressUpdatedAt,
      curriculumLabel:assigned ? (missingBooks.length ? '확인 가능한 배정 단어' : '배정 단어장') : '현재 학년 단어',
      curriculumTitle:assigned ? '배정 단어장 ' + records.length + '개' : (LEVEL_LABELS[level] || '학년 확인 필요') + ' 단어 학습',
      percent:curriculum.length ? Math.round(curriculumKnown / curriculum.length * 100) : 0};
  }
  function scheduleActivity(root, version, member) {
    return new Promise(resolve => { activityQueue.push({root, version, member, resolve}); pumpActivity(); });
  }
  function pumpActivity() {
    while (activityRunning < 3 && activityQueue.length) {
      const task = activityQueue.shift();
      if (!current(task.root) || task.version !== activityVersion) { task.resolve({cancelled: true}); continue; }
      activityRunning++;
      Promise.resolve().then(() => auth().api(endpoint(task.member) + '/activity')).then(
        result => task.resolve({result}), error => task.resolve({error})
      ).finally(() => { activityRunning--; pumpActivity(); });
    }
  }
  function filteredMembers() {
    const query = state.query.toLocaleLowerCase('ko-KR');
    return members.filter(member => (state.tab !== 'activity' || !protectedMember(member)) &&
      (!state.grade || member.grade === state.grade) && (!state.status || member.status === state.status) &&
      (!query || [member.name, member.email, member.school].some(value => String(value || '').toLocaleLowerCase('ko-KR').includes(query))));
  }
  async function render() {
    booksCleanup?.(); booksCleanup = null;
    clearTimeout(searchTimer);
    requestVersion++;
    activityVersion++;
    pageActivities.clear();
    members = []; membersReady = false;
    const workspace = document.getElementById('workspace');
    if (!workspace || !auth() || !authorized(auth().user) || auth().view() !== 'admin') { destroy(); return; }
    workspace.innerHTML = '<div class="admin-root">' +
      '<div class="admin-heading"><div><p class="admin-eyebrow">MEMBER GARDEN</p><h2>함께 자라는 영어 숲</h2><p class="admin-subtitle">회원 정보부터 한 단어씩 쌓인 배움까지, 한눈에 살펴보세요.</p></div><span class="admin-shield" aria-hidden="true">🌱</span></div>' +
      '<div class="admin-tabs" role="tablist" aria-label="회원 관리 화면"><button type="button" role="tab" id="admin-members-tab" data-admin-tab="members" aria-controls="admin-member-panel">회원 정보</button><button type="button" role="tab" id="admin-activity-tab" data-admin-tab="activity" aria-controls="admin-member-panel">학습 현황 <span aria-hidden="true">↗</span></button><button type="button" role="tab" id="admin-books-tab" data-admin-tab="books" aria-controls="admin-member-panel">단어장 <span aria-hidden="true">📚</span></button></div>' +
      '<div class="admin-stat-grid" aria-label="현재 필터로 조회한 회원 통계"><div class="admin-stat"><span>조회한 회원</span><strong data-stat="all">—</strong></div><div class="admin-stat"><span>이용 중</span><strong data-stat="active">—</strong></div><div class="admin-stat"><span>이용 정지</span><strong data-stat="suspended">—</strong></div></div>' +
      '<form class="admin-filters" role="search" aria-label="회원 찾기"><label class="admin-search"><span>이름 · 이메일 · 학교 검색</span><div class="admin-search-input"><span aria-hidden="true">⌕</span><input name="query" type="search" maxlength="200" value="' + escape(state.query) + '" placeholder="찾고 싶은 회원을 입력해 주세요" autocomplete="off"></div></label>' +
      '<label><span>학년</span><select name="grade">' + gradeOptions(state.grade, true) + '</select></label><label><span>이용 상태</span><select name="status"><option value="">전체 상태</option><option value="active"' + (state.status === 'active' ? ' selected' : '') + '>이용 중</option><option value="suspended"' + (state.status === 'suspended' ? ' selected' : '') + '>이용 정지</option></select></label><button class="btn btn-primary admin-search-button" type="submit">검색</button></form>' +
      '<div class="admin-list-heading"><p data-result-label role="status" aria-live="polite">회원 목록을 불러오고 있어요.</p><button class="admin-text-button" type="button" data-clear>필터 초기화</button></div><div id="admin-member-panel" role="tabpanel"><div class="admin-member-list" aria-busy="true"></div></div>' +
      '<p class="admin-footnote">회원 정보는 학습 운영을 위해 필요한 경우에만 확인해 주세요. 관리자 계정은 수정·학습 조회 대상에서 제외돼요.<span data-member-cap hidden> 한 번에 최대 1,000명의 회원을 조회해요.</span></p></div>';
    const root = workspace.querySelector('.admin-root');
    activeRoot = root; activeOwner = String(auth().user.id);
    const form = root.querySelector('.admin-filters');
    const applyFilters = () => {
      if (!current(root)) return;
      state.query = form.elements.query.value.trim(); state.grade = form.elements.grade.value; state.status = form.elements.status.value; state.page = 1;
      if (membersReady) showMembers(root);
    };
    form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); applyFilters(); });
    form.elements.query.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 250); });
    ['grade', 'status'].forEach(field => form.elements[field].addEventListener('change', () => { clearTimeout(searchTimer); applyFilters(); }));
    root.querySelector('[data-clear]').addEventListener('click', () => { clearTimeout(searchTimer); form.elements.query.value = ''; form.elements.grade.value = ''; form.elements.status.value = ''; applyFilters(); });
    const tabs = [...root.querySelectorAll('[data-admin-tab]')];
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => { if (!current(root)) return; if (window.NamdalraWorkbookAdmin?.isBusy()) { notify('저장이 끝난 뒤 화면을 바꿔 주세요.'); return; } if (state.tab !== button.dataset.adminTab) { booksCleanup?.(); booksCleanup = null; } state.tab = button.dataset.adminTab; state.page = 1; updateTabs(root); if (state.tab === 'books' || membersReady) showMembers(root); else loadMembers(root); });
      button.addEventListener('keydown', event => {
        let target;
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) target = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        else if (event.key === 'Home') target = tabs[0]; else if (event.key === 'End') target = tabs[tabs.length-1];
        if (target) { event.preventDefault(); target.click(); target.focus(); }
      });
    });
    updateTabs(root);
    if (state.tab === 'books') showMembers(root); else await loadMembers(root);
  }
  function updateTabs(root) {
    root.querySelectorAll('[data-admin-tab]').forEach(button => {
      const selected = button.dataset.adminTab === state.tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    root.querySelector('#admin-member-panel').setAttribute('aria-labelledby', 'admin-' + (state.tab === 'activity' ? 'activity' : state.tab === 'books' ? 'books' : 'members') + '-tab');
    root.querySelectorAll('.admin-stat-grid,.admin-filters,.admin-list-heading,.admin-footnote').forEach(element => { element.hidden = state.tab === 'books'; });
  }
  async function loadMembers(root) {
    if (!current(root)) return;
    const version = ++requestVersion; activityVersion++; pageActivities.clear(); membersReady = false;
    const list = root.querySelector('.admin-member-list');
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = '<div class="admin-loading" role="status"><span class="admin-loading-dot" aria-hidden="true"></span>회원 목록을 불러오고 있어요.</div>';
    try {
      const result = await auth().api('/api/members');
      if (!current(root) || version !== requestVersion) return;
      if (!result || !Array.isArray(result.members)) throw new Error('회원 목록의 형식을 확인할 수 없어요.');
      members = result.members.filter(member => plainObject(member) && member.id).slice(0, 1000);
      membersReady = true; root.querySelector('[data-member-cap]').hidden = members.length < 1000;
      showMembers(root);
    } catch (error) {
      if (!current(root) || version !== requestVersion) return;
      if (state.tab === 'books') return;
      list.setAttribute('aria-busy', 'false'); root.querySelector('[data-result-label]').textContent = '목록을 불러오지 못했어요.';
      list.innerHTML = '<div class="admin-empty admin-error-state"><span aria-hidden="true">🌧️</span><h3>회원 목록을 불러오지 못했어요</h3><p>' + escape(message(error)) + '</p><button type="button" class="btn btn-outline" data-retry>다시 불러오기</button></div>';
      list.querySelector('[data-retry]').addEventListener('click', () => loadMembers(root));
    }
  }
  function showMembers(root) {
    if (!current(root)) return;
    const version = ++activityVersion; pageActivities.clear();
    const list = root.querySelector('.admin-member-list');
    if (state.tab === 'books') {
      if (!booksCleanup) {
        list.setAttribute('aria-busy','false');
        if (!window.NamdalraWorkbookAdmin) { list.innerHTML = '<p class="admin-inline-error">단어장 관리 기능을 준비하지 못했어요. 화면을 새로고침해 주세요.</p>'; return; }
        booksCleanup = window.NamdalraWorkbookAdmin.mount(list,{isCurrent:() => current(root) && state.tab === 'books',onBusy:busy => root.querySelectorAll('[data-admin-tab]').forEach(button => { button.disabled = busy; })});
      }
      return;
    }
    const filtered = filteredMembers();
    root.querySelector('[data-stat="all"]').textContent = filtered.length.toLocaleString('ko-KR');
    root.querySelector('[data-stat="active"]').textContent = filtered.filter(member => member.status === 'active').length.toLocaleString('ko-KR');
    root.querySelector('[data-stat="suspended"]').textContent = filtered.filter(member => member.status === 'suspended').length.toLocaleString('ko-KR');
    root.querySelector('[data-result-label]').textContent = (state.grade ? GRADES[state.grade] + ' · ' : '') + '조회한 회원 ' + filtered.length.toLocaleString('ko-KR') + '명';
    list.setAttribute('aria-busy', 'false');
    if (!filtered.length) {
      list.innerHTML = '<div class="admin-empty"><span aria-hidden="true">🌿</span><h3>' + (members.length ? '조건에 맞는 회원이 없어요' : '아직 가입한 회원이 없어요') + '</h3><p>' + (members.length ? '검색어 또는 학년·이용 상태를 바꿔 보세요.' : '학생이 회원가입하면 이곳에서 확인할 수 있어요.') + '</p></div>'; return;
    }
    if (state.tab === 'activity') { showLearningPage(root, filtered, version); return; }
    list.innerHTML = '<div class="admin-table-head" aria-hidden="true"><span>회원</span><span>학교 · 학년</span><span>가입일</span><span>상태</span><span>관리</span></div>' + filtered.map((member, index) => '<article class="admin-member-card"><div class="admin-member-identity"><span class="admin-avatar" aria-hidden="true">' + escape(Array.from(member.name || '학')[0]) + '</span><div class="admin-identity-copy"><h3>' + escape(member.name) + '</h3><p>' + escape(member.email) + '</p></div></div><div class="admin-school"><strong>' + escape(member.school || '학교 미등록') + '</strong><span>' + escape(GRADES[member.grade] || (member.role === 'admin' ? '관리자' : '학년 미등록')) + '</span></div><div class="admin-date"><span class="admin-mobile-label">가입일 </span>' + escape(formatDate(member.createdAt)) + '</div><div class="admin-status-cell">' + statusBadge(member) + '</div><div class="admin-member-actions">' + (protectedMember(member) ? '<span class="admin-protected">관리자 · 보호됨</span>' : '<button class="btn btn-outline admin-detail-button" type="button" data-member-index="' + index + '" aria-label="' + escape(member.name + ' 회원 상세 정보') + '">상세 관리 <span aria-hidden="true">↗</span></button><button class="books-assign-button" type="button" data-member-assignment="' + index + '" aria-label="' + escape(member.name + ' 단어장 배정') + '">단어장 배정</button>') + '</div></article>').join('');
    list.querySelectorAll('[data-member-index]').forEach(button => button.addEventListener('click', () => { const member = filtered[Number(button.dataset.memberIndex)]; if (current(root) && member && !protectedMember(member)) openMember(root, member); }));
    list.querySelectorAll('[data-member-assignment]').forEach(button => button.addEventListener('click', () => { const member = filtered[Number(button.dataset.memberAssignment)]; if (!current(root) || !member || protectedMember(member)) return; if (!window.NamdalraWorkbookAdmin) { notify('단어장 기능을 준비하지 못했어요. 새로고침해 주세요.'); return; } window.NamdalraWorkbookAdmin.openAssignments(root,member,{isCurrent:() => current(root),onSaved:() => { if (current(root)) showMembers(root); }}); }));
  }
  function learningIdentity(member) {
    return '<div class="admin-learning-person"><span class="admin-avatar" aria-hidden="true">' + escape(Array.from(member.name || '학')[0]) + '</span><div><h4>' + escape(member.name || '이름 미등록') + '</h4><p>' + escape(GRADES[member.grade] || '학년 미등록') + ' · ' + escape(member.school || '학교 미등록') + '</p></div>' + statusBadge(member) + '</div>';
  }
  function showLearningPage(root, filtered, version) {
    const list = root.querySelector('.admin-member-list'); const pages = Math.ceil(filtered.length / PAGE_SIZE);
    state.page = Math.min(Math.max(1, state.page), pages);
    const offset = (state.page - 1) * PAGE_SIZE; const page = filtered.slice(offset, offset + PAGE_SIZE);
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = '<div class="admin-learning-intro"><div><span class="admin-eyebrow">LEARNING GARDEN</span><h3>' + escape(state.grade ? GRADES[state.grade] : '전체 학년') + ' 학습 현황</h3><p>배정된 단어장, 미배정 시 현재 학년 단어를 기준으로 보여 드려요.</p></div><span class="admin-learning-leaf" aria-hidden="true">🌿</span></div><div class="admin-learning-grid">' + page.map((member, index) => '<article class="admin-learning-card" data-activity-slot="' + index + '" aria-busy="true">' + learningIdentity(member) + '<div class="admin-activity-placeholder" role="status">학습 기록을 불러오고 있어요…</div></article>').join('') + '</div><nav class="admin-pagination" aria-label="학습 현황 페이지"><button type="button" class="btn btn-outline" data-previous-page ' + (state.page === 1 ? 'disabled' : '') + '>← 이전</button><p tabindex="-1" data-page-status><strong>' + state.page + '</strong> / ' + pages + '<span>' + (offset + 1) + '–' + (offset + page.length) + '명 · 총 ' + filtered.length + '명</span></p><button type="button" class="btn btn-outline" data-next-page ' + (state.page === pages ? 'disabled' : '') + '>다음 →</button></nav><p class="admin-report-note">로그인 기록은 이 기능 적용 후 저장된 성공 로그인·가입 기록이에요. 새로고침은 포함하지 않아요. 이전 기록은 복원되지 않으며, 현재 접속 여부나 학습 시간을 나타내지 않아요.</p>';
    for (const [selector, step] of [['[data-previous-page]', -1], ['[data-next-page]', 1]]) list.querySelector(selector).addEventListener('click', () => { if (!current(root)) return; state.page += step; showMembers(root); root.querySelector('[data-page-status]')?.focus({preventScroll: true}); });
    Promise.all(page.map((member, index) => loadActivityCard(root, version, member, index))).then(() => { if (current(root) && version === activityVersion) list.setAttribute('aria-busy', 'false'); });
  }
  async function loadActivityCard(root, version, member, index) {
    const card = root.querySelector('[data-activity-slot="' + index + '"]');
    if (!card || !current(root) || version !== activityVersion) return;
    card.setAttribute('aria-busy', 'true'); card.innerHTML = learningIdentity(member) + '<div class="admin-activity-placeholder" role="status">학습 기록을 불러오고 있어요…</div>';
    const response = await scheduleActivity(root, version, member);
    if (!current(root) || version !== activityVersion || response.cancelled) return;
    card.setAttribute('aria-busy', 'false');
    try {
      if (response.error) throw response.error;
      const summary = activitySummary(response.result, member); pageActivities.set(memberId(member), summary);
      card.innerHTML = learningIdentity(summary.member) + '<div class="admin-card-progress"><div><span>' + escape(summary.curriculumLabel) + ' · 기억한 단어</span><strong>' + summary.curriculumKnown + '<small> / ' + summary.curriculum.length + '개</small></strong></div><b>' + (summary.curriculum.length ? summary.percent + '%' : '—') + '</b></div><div class="admin-progress-track" role="progressbar" aria-label="학습 범위의 단어 완료율" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + summary.percent + '"><span style="width:' + summary.percent + '%"></span></div><dl class="admin-card-metrics"><div><dt>학습한 날</dt><dd>' + summary.days.length + '<small>일</small></dd></div><div><dt>마지막 학습</dt><dd class="admin-metric-date">' + dayLabel(summary.days[0]?.date) + '</dd></div><div><dt>최근 로그인·가입</dt><dd class="admin-metric-date">' + escape(timeLabel(summary.logins[0]?.createdAt)) + '</dd></div></dl>' + (summary.missingBooks.length ? '<p class="admin-data-note">배정된 단어장 ' + summary.missingBooks.length + '개를 확인할 수 없어요. 확인 가능한 배정 기록만 표시해요.</p>' : '') + (summary.incomplete ? '<p class="admin-data-note">확인할 수 있는 기록만 표시했어요.</p>' : '') + '<button class="admin-report-button" type="button" data-open-report aria-label="' + escape(summary.member.name + ' 학습 상세 보기') + '">학습 상세 보기 <span aria-hidden="true">↗</span></button>';
      card.querySelector('[data-open-report]').addEventListener('click', () => { if (current(root) && version === activityVersion) openLearningReport(root, summary); });
    } catch (error) {
      card.innerHTML = learningIdentity(member) + '<div class="admin-card-error"><p>' + escape(message(error)) + '</p><button type="button" class="btn btn-outline" data-retry-activity>다시 불러오기</button></div>';
      card.querySelector('[data-retry-activity]').addEventListener('click', () => loadActivityCard(root, version, member, index));
    }
  }
  function openLearningReport(root, summary) {
    if (!current(root) || protectedMember(summary.member)) return;
    const s = summary;
    const modal = createDialog(root, s.member.name + '의 학습 기록',
      '<div class="admin-report-profile"><span class="admin-profile-avatar" aria-hidden="true">' + escape(Array.from(s.member.name || '학')[0]) + '</span><div><strong>' + escape(s.member.name) + '</strong><p>' + escape(GRADES[s.member.grade] || '학년 미등록') + ' · ' + escape(s.member.school || '학교 미등록') + '</p><small>' + escape(s.member.email) + '</small></div>' + statusBadge(s.member) + '</div>' +
      (s.missingBooks.length ? '<p class="admin-data-note">배정된 단어장 ' + s.missingBooks.length + '개를 확인할 수 없어요. 아래 완료율은 확인 가능한 배정 단어장만 포함해요.</p>' : '') +
      (s.incomplete ? '<p class="admin-data-note">일부 기록의 형식을 확인할 수 없어, 확인 가능한 내용만 표시했어요.</p>' : '') +
      '<section class="admin-report-hero"><div><p class="admin-eyebrow">한 단어씩, 자라는 중</p><h3>' + escape(s.curriculumTitle) + '</h3><p><strong>' + s.curriculumKnown + '</strong> / ' + s.curriculum.length + '개를 기억하고 있어요.</p><small>현재 학습 범위의 단어 중 ‘외웠어요’로 기록된 상태예요.</small></div><div class="admin-completion-ring" style="--completion:' + s.percent + '%"><div><strong>' + (s.curriculum.length ? s.percent + '%' : '—') + '</strong><span>현재 완료율</span></div></div></section>' +
      '<dl class="admin-report-facts"><div><dt>학습한 날</dt><dd>' + s.days.length + '<small>일</small></dd></div><div><dt>마지막 학습일</dt><dd>' + dayLabel(s.days[0]?.date) + '</dd></div><div><dt>최근 로그인·가입</dt><dd>' + escape(timeLabel(s.logins[0]?.createdAt)) + '</dd></div></dl>' +
      '<section class="admin-report-section"><div class="admin-section-heading"><h3>' + (s.assigned ? '단어장별로 얼마나 익혔나요?' : '주제별로 얼마나 익혔나요?') + '</h3><span>' + (s.assigned ? '현재 배정 기준' : '현재 학년 기준') + '</span></div><div class="admin-category-progress">' + s.categories.map(category => '<div><span class="admin-category-icon" aria-hidden="true">' + escape(category.label[0]) + '</span><div><p><strong>' + escape(category.label[1]) + '</strong><span>' + category.known + ' / ' + category.target + '개</span></p><div class="admin-progress-track"><span style="width:' + (category.target ? Math.round(category.known / category.target * 100) : 0) + '%"></span></div></div></div>').join('') + '</div></section>' +
      '<section class="admin-report-section"><div class="admin-section-heading"><h3>지금의 단어 기록</h3><span>' + (s.assigned ? '현재 배정 단어장' : '모든 학년의 기본 단어 기록') + '</span></div><div class="admin-word-filters" role="group" aria-label="단어 기록 종류"><button type="button" data-word-kind="wrong" aria-pressed="true">다시 연습 <b>' + s.wrong.length + '</b></button><button type="button" data-word-kind="known" aria-pressed="false">기억한 단어 <b>' + s.known.length + '</b></button><button type="button" data-word-kind="starred" aria-pressed="false">별표 단어 <b>' + s.starred.length + '</b></button></div><div class="admin-report-words" data-report-words tabindex="0" aria-label="선택한 단어 기록" aria-live="polite"></div><p class="admin-report-note">다시 연습·기억한 단어·별표는 현재 저장 상태이며 서로 겹칠 수 있어요. 테스트 정답률을 뜻하지 않아요.</p></section>' +
      '<div class="admin-report-columns"><section class="admin-report-section"><div class="admin-section-heading"><h3>최근 학습한 날</h3><span>최근 14개 학습일</span></div>' + (s.days.length ? '<ol class="admin-study-days">' + s.days.slice(0, 14).map(day => '<li><time datetime="' + day.date + '">' + dayLabel(day.date) + '</time><span><b>' + day.count + '</b>개 단어</span></li>').join('') + '</ol>' : '<p class="admin-section-empty">아직 저장된 학습일이 없어요.<br>단어를 연습하거나 게임에서 만나면 쌓여요.</p>') + '<p class="admin-report-note">현재 학습 범위에 저장된 기록이에요. 같은 날 만난 단어는 한 번씩 세고, 바뀐 옛 단어와 게임 기록도 포함해요.</p></section><section class="admin-report-section"><div class="admin-section-heading"><h3>단어 톡톡! 최고 기록</h3><span>' + (s.assigned ? '배정 단어장 중 최고' : '속도별') + '</span></div><div class="admin-game-records">' + [['easy', '🌱', '천천히'], ['normal', '🌿', '보통'], ['fast', '⚡', '빠르게']].map(([mode, icon, title]) => '<div><span aria-hidden="true">' + icon + '</span><p>' + title + '</p><strong>' + (s.gameBest[mode] === null ? '기록 없음' : s.gameBest[mode].toLocaleString('ko-KR') + '<small>점</small>') + '</strong></div>').join('') + '</div><p class="admin-report-note">게임 점수는 단어 완료율과 별도로 저장돼요.</p></section></div>' +
      '<section class="admin-report-section"><div class="admin-section-heading"><h3>저장된 최근 로그인 기록</h3><span>최근 최대 30건 · 한국 시간</span></div>' + (s.logins.length ? '<ol class="admin-login-history">' + s.logins.map(login => '<li><span class="admin-login-dot" aria-hidden="true"></span><div><strong>' + (login.kind === 'signup' ? '회원가입 완료' : '로그인 성공') + '</strong><time datetime="' + escape(login.createdAt) + '">' + escape(timeLabel(login.createdAt)) + '</time></div></li>').join('') + '</ol>' : '<p class="admin-section-empty">아직 기록된 로그인이 없어요.<br>이 기능 적용 후 다음 로그인부터 표시돼요.</p>') + '<p class="admin-report-note">이 기능 적용 후 저장된 성공 로그인·가입 기록이며, 새로고침은 포함하지 않아요. 이전 기록은 복원하지 않으며, 현재 접속 상태나 학습 시간을 측정하지 않아요.</p></section>' +
      '<p class="admin-report-saved">학습 기록 마지막 저장: ' + escape(timeLabel(s.progressUpdatedAt)) + '</p>', 'admin-learning-dialog');
    const buttons = [...modal.element.querySelectorAll('[data-word-kind]')];
    const showWords = kind => {
      if (!modal.alive()) return;
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wordKind === kind)));
      modal.element.querySelector('[data-report-words]').innerHTML = s[kind].length ? s[kind].map(word => '<div class="admin-report-word"><span aria-hidden="true">' + escape(word.emoji) + '</span><div><strong lang="en">' + escape(word.en) + '</strong><small>' + escape(word.ko) + '</small></div></div>').join('') : '<p class="admin-section-empty">' + {wrong: '지금 다시 연습할 단어가 없어요.', known: '아직 기억한 단어가 기록되지 않았어요.', starred: '아직 별표를 담은 단어가 없어요.'}[kind] + '</p>';
    };
    buttons.forEach(button => button.addEventListener('click', () => showWords(button.dataset.wordKind)));
    showWords('wrong');
  }

  function createDialog(root, title, content, className) {
    const number = ++dialogNumber;
    const dialog = document.createElement('dialog');
    dialog.className = 'admin-dialog ' + (className || '');
    dialog.setAttribute('aria-labelledby', 'admin-dialog-title-' + number);
    dialog.innerHTML = '<div class="admin-dialog-header"><h2 id="admin-dialog-title-' + number + '">' + escape(title) + '</h2>' +
      '<button type="button" class="admin-close" aria-label="창 닫기" data-close>✕</button></div>' + content;
    let busy = false;
    const close = () => {
      if (busy) return;
      dialog.close();
      dialog.remove();
    };
    dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      close();
    });
    root.appendChild(dialog);
    dialog.showModal();
    return {
      element: dialog,
      close,
      setBusy(value) {
        busy = value;
        dialog.setAttribute('aria-busy', String(value));
        dialog.querySelectorAll('button, input, select, textarea').forEach(element => { element.disabled = value; });
      },
      isBusy() { return busy; },
      alive() { return current(root) && dialog.isConnected && dialog.open; }
    };
  }

  function errorBox(dialog, text) {
    const box = dialog.querySelector('[data-form-error]');
    if (!box) return;
    box.textContent = text || '';
    box.hidden = !text;
  }

  function field(name, label, member, attributes, wide) {
    return '<label class="admin-field' + (wide ? ' admin-field-wide' : '') + '"><span>' + label + ' <span aria-hidden="true">*</span></span>' +
      '<input name="' + name + '" value="' + escape(member[name]) + '" ' + attributes + ' required></label>';
  }

  function openMember(root, member) {
    if (!current(root) || protectedMember(member)) return;
    const modal = createDialog(root, '회원 상세 관리',
      '<div class="admin-profile-summary"><span class="admin-profile-avatar" aria-hidden="true">' + escape(Array.from(member.name || '학')[0]) + '</span>' +
      '<div><strong>' + escape(member.name) + '</strong><p>' + escape(member.email) + '</p></div>' + statusBadge(member) + '</div>' +
      '<form class="admin-edit-form"><p class="admin-form-intro">학생의 회원 정보를 수정할 수 있어요. 모든 항목을 입력해 주세요.</p>' +
      '<div class="admin-form-grid">' +
      field('name', '이름', member, 'autocomplete="off" minlength="2" maxlength="50"') +
      field('phone', '전화번호', member, 'type="tel" autocomplete="off" inputmode="tel" maxlength="30" placeholder="010-1234-5678"') +
      '<label class="admin-field admin-field-wide"><span>이메일</span><input name="email" type="email" value="' + escape(member.email) + '" readonly aria-describedby="admin-email-note"><small id="admin-email-note" class="admin-field-note">가입한 이메일은 여기서 변경할 수 없어요.</small></label>' +
      field('school', '학교', member, 'autocomplete="off" minlength="2" maxlength="100" placeholder="학교 이름"') +
      '<label class="admin-field"><span>학년 <span aria-hidden="true">*</span></span><select name="grade" required>' + gradeOptions(member.grade, false) + '</select></label>' +
      '<label class="admin-field admin-field-wide"><span>주소 <span aria-hidden="true">*</span></span><textarea name="address" autocomplete="off" minlength="5" maxlength="200" rows="2" required>' + escape(member.address) + '</textarea></label>' +
      '<label class="admin-field admin-field-wide"><span>이용 상태</span><select name="status" required><option value="active"' + (member.status === 'active' ? ' selected' : '') + '>이용 중</option><option value="suspended"' + (member.status === 'suspended' ? ' selected' : '') + '>이용 정지</option></select></label></div>' +
      '<div class="admin-inline-error" data-form-error role="alert" hidden></div>' +
      '<div class="admin-dialog-actions"><button type="button" class="btn btn-soft" data-close>닫기</button><button class="btn btn-primary" type="submit" data-save>변경 내용 저장</button></div></form>' +
      '<div class="admin-account-tools"><h3>계정 관리</h3><p class="admin-account-note">아래 작업은 회원 정보 저장과 별도로 바로 적용돼요.</p>' +
      '<div class="admin-account-row"><div><strong>비밀번호 재설정</strong><p>회원이 새 비밀번호를 설정할 수 있도록 가입한 이메일로 안내를 보내요.</p></div><button class="btn btn-outline" type="button" data-reset>비밀번호 재설정 이메일</button></div></div>' +
      '<p class="admin-metadata">가입일 ' + escape(formatDate(member.createdAt)) + ' · 마지막 변경 ' + escape(formatDate(member.updatedAt)) + '</p>', 'admin-edit-dialog');
    const form = modal.element.querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!modal.alive() || modal.isBusy()) return;
      errorBox(modal.element, '');
      const value = name => form.elements[name].value.trim();
      const payload = {
        name: value('name'), phone: value('phone').replace(/\D/g, ''),
        address: value('address'), school: value('school'), grade: value('grade'), status: value('status')
      };
      const errors = [
        ['name', payload.name.length >= 2 && payload.name.length <= 50, '이름은 2~50자로 입력해 주세요.'],
        ['phone', /^[0-9]{9,15}$/.test(payload.phone) && /^[0-9+()\s-]+$/.test(value('phone')), '전화번호는 숫자 9~15자리로 입력해 주세요. 하이픈과 공백을 사용할 수 있어요.'],
        ['school', payload.school.length >= 2 && payload.school.length <= 100, '학교 이름은 2~100자로 입력해 주세요.'],
        ['grade', Object.prototype.hasOwnProperty.call(GRADES, payload.grade), '학년을 선택해 주세요.'],
        ['address', payload.address.length >= 5 && payload.address.length <= 200, '주소는 5~200자로 입력해 주세요.'],
        ['status', ['active', 'suspended'].includes(payload.status), '이용 상태를 선택해 주세요.']
      ];
      const invalid = errors.find(item => !item[1]);
      if (invalid) {
        errorBox(modal.element, invalid[2]);
        form.elements[invalid[0]].focus();
        return;
      }
      const saveButton = modal.element.querySelector('[data-save]');
      modal.setBusy(true);
      saveButton.textContent = '저장 중…';
      try {
        await auth().api(endpoint(member), {method: 'PATCH', body: payload});
        if (!modal.alive()) return;
        modal.setBusy(false);
        modal.close();
        notify('회원 정보를 저장했어요.');
        await loadMembers(root);
      } catch (error) {
        if (!modal.alive()) return;
        modal.setBusy(false);
        saveButton.textContent = '변경 내용 저장';
        errorBox(modal.element, message(error));
      }
    });
    modal.element.querySelector('[data-reset]').addEventListener('click', () => openReset(root, member));
  }

  function identityNote(member) {
    return '<div class="admin-confirm-person"><strong>' + escape(member.name) + '</strong><span>' + escape(member.email) + '</span></div>';
  }

  function openReset(root, member) {
    if (!current(root) || protectedMember(member)) return;
    const modal = createDialog(root, '비밀번호 재설정 이메일',
      identityNote(member) + '<p class="admin-confirm-copy">위 회원의 이메일로 비밀번호 재설정 안내를 보낼까요? 회원이 이메일의 링크를 열어 새 비밀번호를 직접 설정할 수 있어요.</p>' +
      '<div class="admin-inline-error" data-form-error role="alert" hidden></div>' +
      '<div class="admin-dialog-actions"><button type="button" class="btn btn-soft" data-close>취소</button><button type="button" class="btn btn-primary" data-confirm-reset>이메일 보내기</button></div>', 'admin-confirm-dialog');
    const button = modal.element.querySelector('[data-confirm-reset]');
    button.addEventListener('click', async () => {
      if (!modal.alive() || modal.isBusy()) return;
      modal.setBusy(true);
      button.textContent = '보내는 중…';
      errorBox(modal.element, '');
      try {
        const result = await auth().api(endpoint(member) + '/reset-password', {method: 'POST'});
        if (!modal.alive()) return;
        if (!result || result.resetEmailSent !== true) throw new Error('이메일 발송을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.');
        modal.setBusy(false);
        modal.close();
        showResetSent(root, member);
      } catch (error) {
        if (!modal.alive()) return;
        modal.setBusy(false);
        button.textContent = '이메일 보내기';
        errorBox(modal.element, message(error));
      }
    });
  }

  function showResetSent(root, member) {
    if (!current(root)) return;
    createDialog(root, '재설정 이메일을 보냈어요',
      '<div class="admin-success-mark" aria-hidden="true">✓</div>' + identityNote(member) +
      '<p class="admin-confirm-copy" role="status">이메일의 링크를 열어 새 비밀번호를 설정하도록 안내해 주세요.</p>' +
      '<p class="admin-confirm-note">이메일이 보이지 않으면 스팸함도 확인해 주세요.</p>' +
      '<button class="btn btn-primary admin-dialog-full-button" type="button" data-close>확인</button>', 'admin-confirm-dialog');
  }

  window.NamdalraAdmin = Object.freeze({render, destroy});
})();
