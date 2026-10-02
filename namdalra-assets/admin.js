/* Namdalra Firebase member administration. No external dependencies. */
(function () {
  'use strict';

  const GRADES = {
    e1: '초등 1학년', e2: '초등 2학년', e3: '초등 3학년',
    e4: '초등 4학년', e5: '초등 5학년', e6: '초등 6학년',
    m1: '중등 1학년', m2: '중등 2학년', m3: '중등 3학년'
  };
  const state = {query: '', grade: '', status: ''};
  let activeRoot = null;
  let activeOwner = null;
  let requestVersion = 0;
  let dialogNumber = 0;
  let searchTimer = null;

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
    clearTimeout(searchTimer);
    requestVersion++;
    if (activeRoot) {
      activeRoot.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      activeRoot.remove();
    }
    activeRoot = null;
    activeOwner = null;
    state.query = ''; state.grade = ''; state.status = '';
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

  async function render() {
    clearTimeout(searchTimer);
    requestVersion++;
    const workspace = document.getElementById('workspace');
    if (!workspace || !auth() || !authorized(auth().user) || auth().view() !== 'admin') {
      destroy();
      return;
    }
    workspace.innerHTML = '<div class="admin-root">' +
      '<div class="admin-heading"><div><p class="admin-eyebrow">MEMBER GARDEN</p><h2>회원 관리</h2>' +
      '<p class="admin-subtitle">학생의 정보를 확인하고, 배움의 시작을 도와주세요.</p></div>' +
      '<span class="admin-shield" aria-hidden="true">🌱</span></div>' +
      '<div class="admin-stat-grid" aria-label="현재 조회한 회원 통계">' +
      '<div class="admin-stat"><span>조회한 회원</span><strong data-stat="all">—</strong></div>' +
      '<div class="admin-stat"><span>이용 중</span><strong data-stat="active">—</strong></div>' +
      '<div class="admin-stat"><span>이용 정지</span><strong data-stat="suspended">—</strong></div></div>' +
      '<form class="admin-filters" role="search" aria-label="회원 찾기">' +
      '<label class="admin-search"><span>이름 · 이메일 · 학교 검색</span><div class="admin-search-input">' +
      '<span aria-hidden="true">⌕</span><input name="query" type="search" maxlength="200" value="' + escape(state.query) + '" placeholder="찾고 싶은 회원을 입력해 주세요" autocomplete="off"></div></label>' +
      '<label><span>학년</span><select name="grade">' + gradeOptions(state.grade, true) + '</select></label>' +
      '<label><span>이용 상태</span><select name="status"><option value="">전체 상태</option>' +
      '<option value="active"' + (state.status === 'active' ? ' selected' : '') + '>이용 중</option>' +
      '<option value="suspended"' + (state.status === 'suspended' ? ' selected' : '') + '>이용 정지</option></select></label>' +
      '<button class="btn btn-primary admin-search-button" type="submit">검색</button></form>' +
      '<div class="admin-list-heading"><p data-result-label role="status" aria-live="polite">회원 목록을 불러오고 있어요.</p>' +
      '<button class="admin-text-button" type="button" data-clear>필터 초기화</button></div>' +
      '<div class="admin-member-list" aria-busy="true"></div>' +
      '<p class="admin-footnote">회원 정보는 학습 운영을 위해 필요한 경우에만 확인해 주세요. 관리자 계정은 이 목록에서 수정할 수 없어요.</p>' +
      '</div>';
    const root = workspace.querySelector('.admin-root');
    activeRoot = root;
    activeOwner = String(auth().user.id);
    const form = root.querySelector('.admin-filters');
    form.addEventListener('submit', event => {
      event.preventDefault();
      clearTimeout(searchTimer);
      state.query = form.elements.query.value.trim();
      state.grade = form.elements.grade.value;
      state.status = form.elements.status.value;
      loadMembers(root);
    });
    form.elements.query.addEventListener('input', () => {
      clearTimeout(searchTimer);
      requestVersion++;
      state.query = form.elements.query.value.trim();
      searchTimer = setTimeout(() => loadMembers(root), 300);
    });
    ['grade', 'status'].forEach(field => form.elements[field].addEventListener('change', () => {
      clearTimeout(searchTimer);
      state[field] = form.elements[field].value;
      state.query = form.elements.query.value.trim();
      loadMembers(root);
    }));
    root.querySelector('[data-clear]').addEventListener('click', () => {
      clearTimeout(searchTimer);
      state.query = ''; state.grade = ''; state.status = '';
      form.elements.query.value = ''; form.elements.grade.value = ''; form.elements.status.value = '';
      loadMembers(root);
    });
    await loadMembers(root);
  }

  async function loadMembers(root) {
    if (!current(root)) return;
    const version = ++requestVersion;
    const list = root.querySelector('.admin-member-list');
    const resultLabel = root.querySelector('[data-result-label]');
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = '<div class="admin-loading" role="status"><span class="admin-loading-dot" aria-hidden="true"></span>회원 목록을 불러오고 있어요.</div>';
    resultLabel.textContent = '회원 목록을 불러오고 있어요.';
    root.querySelectorAll('[data-stat]').forEach(item => { item.textContent = '—'; });
    const params = new URLSearchParams({query: state.query, grade: state.grade, status: state.status});
    try {
      const result = await auth().api('/api/members?' + params.toString());
      if (!current(root) || version !== requestVersion) return;
      const members = Array.isArray(result.members) ? result.members : [];
      root.querySelector('[data-stat="all"]').textContent = members.length.toLocaleString('ko-KR');
      root.querySelector('[data-stat="active"]').textContent = members.filter(member => member.status === 'active').length.toLocaleString('ko-KR');
      root.querySelector('[data-stat="suspended"]').textContent = members.filter(member => member.status === 'suspended').length.toLocaleString('ko-KR');
      resultLabel.textContent = (state.query || state.grade || state.status ? '검색 결과 ' : '전체 회원 ') + members.length.toLocaleString('ko-KR') + '명';
      list.setAttribute('aria-busy', 'false');
      if (!members.length) {
        list.innerHTML = '<div class="admin-empty"><span aria-hidden="true">🌿</span><h3>' +
          (state.query || state.grade || state.status ? '조건에 맞는 회원이 없어요' : '아직 가입한 회원이 없어요') +
          '</h3><p>' + (state.query || state.grade || state.status ? '검색어 또는 학년·이용 상태를 바꿔 보세요.' : '학생이 회원가입하면 이곳에서 확인할 수 있어요.') + '</p></div>';
        return;
      }
      list.innerHTML = '<div class="admin-table-head" aria-hidden="true"><span>회원</span><span>학교 · 학년</span><span>가입일</span><span>상태</span><span>관리</span></div>' +
        members.map((member, index) => '<article class="admin-member-card">' +
          '<div class="admin-member-identity"><span class="admin-avatar" aria-hidden="true">' + escape(Array.from(member.name || '학')[0]) + '</span>' +
          '<div class="admin-identity-copy"><h3>' + escape(member.name) + '</h3><p>' + escape(member.email) + '</p></div></div>' +
          '<div class="admin-school"><strong>' + escape(member.school || '학교 미등록') + '</strong><span>' + escape(GRADES[member.grade] || (member.role === 'admin' ? '관리자' : '학년 미등록')) + '</span></div>' +
          '<div class="admin-date"><span class="admin-mobile-label">가입일 </span>' + escape(formatDate(member.createdAt)) + '</div>' +
          '<div class="admin-status-cell">' + statusBadge(member) + '</div>' +
          '<div class="admin-member-actions">' + (protectedMember(member) ? '<span class="admin-protected">관리자 · 보호됨</span>' :
            '<button class="btn btn-outline admin-detail-button" type="button" data-member-index="' + index + '" aria-label="' + escape(member.name + ' 회원 상세 정보') + '">상세 관리 <span aria-hidden="true">↗</span></button>') + '</div></article>').join('');
      list.querySelectorAll('[data-member-index]').forEach(button => button.addEventListener('click', () => {
        const member = members[Number(button.dataset.memberIndex)];
        if (current(root) && member && !protectedMember(member)) openMember(root, member);
      }));
    } catch (error) {
      if (!current(root) || version !== requestVersion) return;
      list.setAttribute('aria-busy', 'false');
      resultLabel.textContent = '목록을 불러오지 못했어요.';
      list.innerHTML = '<div class="admin-empty admin-error-state"><span aria-hidden="true">🌧️</span><h3>회원 목록을 불러오지 못했어요</h3><p>' + escape(message(error)) + '</p><button type="button" class="btn btn-outline" data-retry>다시 불러오기</button></div>';
      list.querySelector('[data-retry]').addEventListener('click', () => loadMembers(root));
    }
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
