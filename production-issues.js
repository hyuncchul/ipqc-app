/* Read-only DIPQC list used by the production app's Issue tab. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductionIssues = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const WORDS = {
    title: ['불량 등록 현황', 'Defect registration status', '不良登錄現況', 'Tình trạng đăng ký lỗi', 'Status pencatatan cacat'],
    subtitle: ['DIPQC에 등록된 팀 공통 불량 이력을 실시간으로 확인합니다.', 'Live shared defect records registered in DIPQC.', '即時查看 DIPQC 團隊共用不良紀錄。', 'Theo dõi trực tiếp hồ sơ lỗi chung của nhóm trong DIPQC.', 'Lihat catatan cacat bersama tim di DIPQC secara langsung.'],
    open: ['DIPQC 열기', 'Open DIPQC', '開啟 DIPQC', 'Mở DIPQC', 'Buka DIPQC'],
    refresh: ['새로고침', 'Refresh', '重新整理', 'Làm mới', 'Segarkan'],
    login: ['Google 로그인', 'Sign in with Google', '使用 Google 登入', 'Đăng nhập Google', 'Masuk dengan Google'],
    changeAccount: ['Google 계정 변경', 'Change Google account', '切換 Google 帳號', 'Đổi tài khoản Google', 'Ganti akun Google'],
    loginHint: ['DIPQC에서 승인된 Google 팀 계정으로 로그인해 주세요.', 'Sign in with a Google team account approved in DIPQC.', '請使用已獲 DIPQC 核准的 Google 團隊帳號登入。', 'Đăng nhập bằng tài khoản Google nhóm đã được phê duyệt trong DIPQC.', 'Masuk dengan akun Google tim yang disetujui di DIPQC.'],
    accessHint: ['팀 조회 권한이 필요합니다. DIPQC의 등록 메뉴에서 관리자에게 승인을 요청해 주세요.', 'Team access is required. Request approval in the Registration menu in DIPQC.', '需要團隊查閱權限，請在 DIPQC「登錄」選單申請管理員核准。', 'Cần quyền truy cập nhóm. Yêu cầu phê duyệt trong mục Đăng ký của DIPQC.', 'Akses tim diperlukan. Minta persetujuan di menu Pendaftaran DIPQC.'],
    loading: ['불량 이력을 불러오는 중입니다…', 'Loading defect records…', '正在載入不良紀錄…', 'Đang tải hồ sơ lỗi…', 'Memuat catatan cacat…'],
    failure: ['불량 이력을 불러오지 못했습니다. 연결과 팀 권한을 확인한 뒤 새로고침해 주세요.', 'Could not load defect records. Check your connection and team access, then refresh.', '無法載入不良紀錄。請確認連線及團隊權限後重新整理。', 'Không thể tải hồ sơ lỗi. Kiểm tra kết nối và quyền nhóm rồi làm mới.', 'Tidak dapat memuat catatan cacat. Periksa koneksi dan akses tim, lalu segarkan.'],
    stale: ['연결이 끊겼습니다. 아래 목록은 마지막 조회 내용이며 최신 상태가 아닐 수 있습니다.', 'Connection lost. The list shows the last received records and may be out of date.', '連線中斷。以下為上次取得的紀錄，可能不是最新狀態。', 'Mất kết nối. Danh sách là dữ liệu lần tải cuối và có thể chưa cập nhật.', 'Koneksi terputus. Daftar menampilkan catatan terakhir dan mungkin belum terbaru.'],
    live: ['실시간 연결', 'Live', '即時連線', 'Trực tiếp', 'Terhubung langsung'],
    all: ['전체', 'All', '全部', 'Tất cả', 'Semua'],
    pending: ['생산팀 처리 대기', 'Awaiting production', '待生產處理', 'Chờ sản xuất xử lý', 'Menunggu produksi'],
    quality: ['품질 재검사 대기', 'Awaiting quality review', '待品質複驗', 'Chờ chất lượng kiểm tra lại', 'Menunggu pemeriksaan kualitas'],
    completed: ['처리 완료', 'Completed', '處理完成', 'Hoàn tất', 'Selesai'],
    returned: ['재처리 요청', 'Reprocessing requested', '要求重新處理', 'Yêu cầu xử lý lại', 'Diminta proses ulang'],
    search: ['불량 이력 검색', 'Search defect records', '搜尋不良紀錄', 'Tìm hồ sơ lỗi', 'Cari catatan cacat'],
    searchHint: ['설비, 품번, 카드 번호, 불량 내용, 검사자', 'Machine, part, card number, defect, inspector', '設備、料號、卡號、不良內容、檢驗員', 'Máy, mã hàng, số thẻ, lỗi, người kiểm tra', 'Mesin, nomor komponen, kartu, cacat, pemeriksa'],
    machine: ['설비', 'Machine', '設備', 'Máy', 'Mesin'],
    process: ['공정', 'Process', '製程', 'Công đoạn', 'Proses'],
    reset: ['초기화', 'Reset filters', '重設篩選', 'Đặt lại bộ lọc', 'Atur ulang filter'],
    date: ['불량 등록일', 'Registered', '不良登錄日', 'Ngày đăng ký lỗi', 'Tanggal pencatatan'],
    part: ['SAP PN / Description', 'SAP PN / Description', 'SAP PN / 品名', 'SAP PN / Mô tả', 'SAP PN / Deskripsi'],
    card: ['LOT CARD NO.', 'LOT CARD NO.', 'LOT CARD NO.', 'LOT CARD NO.', 'LOT CARD NO.'],
    defect: ['불량 내용', 'Defect', '不良內容', 'Nội dung lỗi', 'Detail cacat'],
    quantity: ['불량 수량', 'Defect quantity', '不良數量', 'Số lượng lỗi', 'Jumlah cacat'],
    inspector: ['검사자', 'Inspector', '檢驗員', 'Người kiểm tra', 'Pemeriksa'],
    method: ['검사 방법', 'Inspection method', '檢驗方式', 'Phương pháp kiểm tra', 'Metode pemeriksaan'],
    reinspection: ['재검사', 'Reinspection', '複驗', 'Kiểm tra lại', 'Pemeriksaan ulang'],
    rework: ['재작업', 'Rework', '重工', 'Làm lại', 'Pengerjaan ulang'],
    other: ['기타', 'Other', '其他', 'Khác', 'Lainnya'],
    status: ['처리 상태', 'Status', '處理狀態', 'Trạng thái', 'Status'],
    noMachine: ['설비 미지정', 'No machine assigned', '未指定設備', 'Chưa chỉ định máy', 'Mesin belum ditentukan'],
    empty: ['등록된 불량 이력이 없습니다.', 'No defect records have been registered.', '尚無不良登錄紀錄。', 'Chưa có hồ sơ lỗi nào được đăng ký.', 'Belum ada catatan cacat terdaftar.'],
    noMatch: ['검색 조건에 맞는 불량 이력이 없습니다.', 'No defect records match these filters.', '沒有符合篩選條件的不良紀錄。', 'Không có hồ sơ lỗi phù hợp bộ lọc.', 'Tidak ada catatan cacat yang sesuai filter.'],
    count: ['전체 {total}건 중 {count}건', '{count} of {total} records', '共 {total} 筆，顯示 {count} 筆', '{count} / {total} hồ sơ', '{count} dari {total} catatan'],
    page: ['{page} / {pages} 페이지', 'Page {page} of {pages}', '第 {page} / {pages} 頁', 'Trang {page} / {pages}', 'Halaman {page} dari {pages}'],
    previous: ['이전', 'Previous', '上一頁', 'Trước', 'Sebelumnya'],
    next: ['다음', 'Next', '下一頁', 'Tiếp', 'Berikutnya'],
    readOnly: ['불량 등록·생산팀 처리·품질 판정은 DIPQC에서 진행해 주세요.', 'Register defects, enter production results and complete quality reviews in DIPQC.', '請在 DIPQC 登錄不良、輸入生產處理結果及完成品質判定。', 'Đăng ký lỗi, nhập kết quả sản xuất và đánh giá chất lượng trong DIPQC.', 'Catat cacat, masukkan hasil produksi dan lakukan penilaian kualitas di DIPQC.']
  };
  const languages = ['ko', 'en', 'zh', 'vi', 'id'];
  function translate(key, locale, params = {}) {
    const index = Math.max(0, languages.indexOf(String(locale || 'ko').split('-')[0]));
    return (WORDS[key]?.[index] || key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
  }
  function group(row) {
    return row.status === 'completed' ? 'completed' : row.status === 'quality_review' ? 'quality' : 'pending';
  }
  function filterRecords(rows, filters) {
    const query = String(filters.query || '').trim().toLocaleLowerCase();
    return rows.filter(row => (!filters.status || group(row) === filters.status) &&
      (!filters.machine || row.equipmentId === filters.machine) &&
      (!filters.process || row.process === filters.process) &&
      (!query || [row.id, row.equipmentId, row.sapPN, row.description, row.lotCardNo,
        row.defect, row.inspectorName, row.inspector, row.method, row.customMethod].join(' ').toLocaleLowerCase().includes(query)));
  }
  function mount(container, options = {}) {
    const doc = container.ownerDocument;
    const service = options.service || root.ProductionIssuesData.create();
    let locale = options.locale || 'ko-KR', rows = [], status = service.getStatus?.() || {loading: true};
    let filters = {query: '', machine: '', process: '', status: ''}, page = 1, signingIn = false, actionError = false;
    let destroyed = false;
    const pageSize = 30;
    const t = (key, params) => translate(key, locale, params);
    const el = (tag, cls, value) => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (value !== undefined) node.textContent = String(value);
      return node;
    };
    const button = (key, handler, cls = 'secondary') => {
      const node = el('button', cls); node.type = 'button'; node.dataset.label = key;
      node.addEventListener('click', handler); return node;
    };
    const link = el('a', 'secondary dipqc-open-link'); link.href = 'dipqc.html'; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const heading = el('h2'), subtitle = el('p', 'help');
    const refresh = button('refresh', async () => {actionError = false; try {await service.retry();} catch (_) {actionError = true;} if (!destroyed) render();});
    const titleRow = el('div', 'dipqc-issue-heading'); titleRow.append(heading, refresh, link);
    const connection = el('div', 'dipqc-issue-connection');
    const connectionText = el('span'); connectionText.setAttribute('role', 'status');
    const login = button('login', async () => {
      if (signingIn) return; signingIn = true; actionError = false; render();
      try {await service.signIn();} catch (_) {actionError = true;}
      finally {signingIn = false; if (!destroyed) render();}
    });
    connection.append(connectionText, login);
    const notice = el('p', 'dipqc-issue-notice'); notice.setAttribute('role', 'alert');
    const content = el('div', 'dipqc-issue-content');
    const summary = el('div', 'dipqc-issue-summary'); summary.setAttribute('role', 'group');
    const summaryButtons = ['', 'pending', 'quality', 'completed'].map(value => {
      const node = button(value || 'all', () => {filters.status = value; page = 1; render();}, 'dipqc-issue-stat');
      summary.append(node); return {node, value};
    });
    const filterBar = el('div', 'dipqc-issue-filters');
    const searchLabel = el('label', 'dipqc-issue-search'), searchCaption = el('span');
    const search = el('input'); search.type = 'search'; search.maxLength = 200;
    search.addEventListener('input', () => {filters.query = search.value; page = 1; renderRows();});
    searchLabel.append(searchCaption, search);
    const machineLabel = el('label'), machineCaption = el('span'), machine = el('select');
    machine.addEventListener('change', () => {filters.machine = machine.value; page = 1; renderRows();}); machineLabel.append(machineCaption, machine);
    const processLabel = el('label'), processCaption = el('span'), process = el('select');
    process.addEventListener('change', () => {filters.process = process.value; page = 1; renderRows();}); processLabel.append(processCaption, process);
    const reset = button('reset', () => {filters = {query: '', machine: '', process: '', status: ''}; page = 1; render();});
    filterBar.append(searchLabel, machineLabel, processLabel, reset);
    const count = el('p', 'help'); count.setAttribute('role', 'status');
    const tableWrap = el('div', 'dipqc-issue-table-scroll'), table = el('table', 'dipqc-issue-table');
    const head = el('thead'), body = el('tbody'); table.append(head, body); tableWrap.append(table);
    const empty = el('p', 'dipqc-issue-empty'); empty.setAttribute('role', 'status');
    const paging = el('div', 'dipqc-issue-paging'), pageText = el('span');
    const previous = button('previous', () => {page--; renderRows();}), next = button('next', () => {page++; renderRows();});
    paging.append(previous, pageText, next);
    const footer = el('p', 'help'); content.append(summary, filterBar, count, tableWrap, empty, paging, footer);
    container.replaceChildren(titleRow, subtitle, connection, notice, content);
    const columns = ['date', 'machine', 'part', 'card', 'process', 'defect', 'quantity', 'inspector', 'method', 'status'];
    function fillSelect(select, values, selected, emptyKey = 'all') {
      select.replaceChildren();
      for (const value of ['', ...values]) {
        const option = el('option', '', value || t(emptyKey)); option.value = value; select.append(option);
      }
      select.value = selected;
    }
    function renderRows() {
      if (destroyed) return;
      const filtered = filterRecords(rows, filters), pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      page = Math.max(1, Math.min(page, pages));
      count.textContent = t('count', {total: rows.length, count: filtered.length});
      head.replaceChildren(); const headingRow = el('tr');
      for (const key of columns) {const th = el('th', '', t(key)); th.scope = 'col'; headingRow.append(th);} head.append(headingRow);
      body.replaceChildren();
      for (const row of filtered.slice((page - 1) * pageSize, page * pageSize)) {
        const tr = el('tr');
        const values = [row.scanDate, row.equipmentId || t('noMachine'), row.sapPN, row.lotCardNo,
          row.process, row.defect, Number.isFinite(row.quantity) ? row.quantity.toLocaleString(locale) + ' PCS' : '',
          row.inspectorName || row.inspector,
          row.method === 'Other' ? row.customMethod || t('other') :
            row.method === 'Reinspection' ? t('reinspection') : row.method === 'Rework' ? t('rework') : row.method, ''];
        columns.forEach((key, index) => {
          const td = el('td'); td.dataset.label = t(key);
          if (key === 'status') {
            td.append(el('span', 'dipqc-issue-badge is-' + group(row), t(row.reworkRequested ? 'returned' : group(row))));
            if (row.finalResult) td.append(el('small', '', row.finalResult));
          } else {
            td.append(el(key === 'part' ? 'strong' : 'span', '', values[index] || '—'));
            if (key === 'part' && row.description) td.append(el('small', '', row.description));
          }
          tr.append(td);
        });
        body.append(tr);
      }
      tableWrap.hidden = !filtered.length; empty.hidden = !!filtered.length;
      empty.textContent = t(rows.length ? 'noMatch' : 'empty');
      paging.hidden = filtered.length <= pageSize;
      previous.disabled = page === 1; next.disabled = page === pages;
      pageText.textContent = t('page', {page, pages});
    }
    function render() {
      if (destroyed) return;
      container.querySelectorAll('[data-label]').forEach(node => {
        if (node.tagName === 'BUTTON') node.textContent = t(node.dataset.label);
      });
      heading.textContent = t('title'); subtitle.textContent = t('subtitle'); link.textContent = t('open'); footer.textContent = t('readOnly');
      login.textContent = t(status.signedIn ? 'changeAccount' : 'login'); login.disabled = signingIn;
      refresh.disabled = !!status.loading || signingIn;
      const authorized = !!status.role && status.signedIn;
      connectionText.textContent = status.loading && !status.recordsReady ? t('loading') :
        !status.signedIn ? t('loginHint') : !status.role ? t('accessHint') :
        (status.displayName || status.email || '') + (status.stale || !status.online ? '' : ' · ' + t('live'));
      connection.classList.toggle('is-connected', authorized && !status.stale && status.online);
      content.hidden = !authorized || !status.recordsReady;
      const hasError = actionError || !!status.error;
      notice.hidden = !hasError && !status.stale;
      notice.textContent = t(status.stale && rows.length ? 'stale' : 'failure');
      summary.setAttribute('aria-label', t('status'));
      summaryButtons.forEach(({node, value}) => {
        const total = value ? rows.filter(row => group(row) === value).length : rows.length;
        node.replaceChildren(el('span', '', t(value || 'all')), el('strong', '', total.toLocaleString(locale)));
        node.setAttribute('aria-pressed', String(filters.status === value));
      });
      searchCaption.textContent = t('search'); search.placeholder = t('searchHint'); search.value = filters.query;
      machineCaption.textContent = t('machine'); processCaption.textContent = t('process');
      machine.setAttribute('aria-label', t('machine')); process.setAttribute('aria-label', t('process'));
      const machines = [...new Set([...rows.map(row => row.equipmentId).filter(Boolean), ...(filters.machine ? [filters.machine] : [])])].sort((a, b) => a.localeCompare(b, locale, {numeric: true}));
      fillSelect(machine, machines, filters.machine); fillSelect(process, ['FOL', 'EOL', 'OQC'], filters.process);
      renderRows();
    }
    render();
    const stopStatus = service.onStatus(value => {status = value; render();});
    const stopRecords = service.subscribe(value => {rows = value; actionError = false; render();}, () => render());
    return {
      setLocale(value) {locale = value || 'ko-KR'; render();},
      setMachine(value) {filters.machine = String(value || ''); page = 1; render();},
      destroy() {destroyed = true; stopRecords?.(); stopStatus?.(); service.destroy(); container.replaceChildren();}
    };
  }
  return Object.freeze({mount, filterRecords, group, translate});
});
