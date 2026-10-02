/* Workbook data stays in the browser until an administrator confirms saving. */
(function (root) {
  'use strict';
  const base = typeof document !== 'undefined' ? document.currentScript.src : '';
  const limits = {en: 120, ko: 300, pos: 40, emoji: 16, example: 500, translation: 500};
  const clean = value => String(value ?? '').normalize('NFC').trim();
  const key = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const validId = value => typeof value === 'string' && /^w_[a-f0-9]{32}$/.test(value);
  function prepareWords(rows, previousWords = []) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) throw new Error('단어는 단어장마다 1~1,000개로 입력해 주세요.');
    const previous = Array.isArray(previousWords) ? previousWords : [];
    const used = new Set();
    const reserved = new Set(rows.map(row => row.id).filter(id => previous.some(w => w.id === id)));
    const exact = row => previous.find(w => !used.has(w.id) && !reserved.has(w.id) && key(w.en) === key(row.en) && key(w.ko) === key(row.ko));
    const words = rows.map((row, index) => {
      const word = {};
      for (const [field, max] of Object.entries(limits)) {
        const value = clean(row[field]);
        if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${index + 1}번째 단어의 ${field} 내용이 너무 길거나 잘못되었어요.`);
        word[field] = value;
      }
      if (!word.emoji) word.emoji = root.NamdalraPictures?.lookup(word.en, word.ko) || '📘';
      if (!word.en || !/[a-z]/i.test(word.en)) throw new Error(`${index + 1}번째 영어 단어를 확인해 주세요.`);
      let match = validId(row.id) && previous.find(w => w.id === row.id && !used.has(w.id));
      if (!match) match = exact(word);
      // Only an unambiguous spelling can retain identity after a meaning correction.
      if (!match) {
        const candidates = previous.filter(w => !used.has(w.id) && !reserved.has(w.id) && key(w.en) === key(word.en));
        if (candidates.length === 1 && rows.filter(w => key(w.en) === key(word.en)).length === 1) match = candidates[0];
      }
      word.id = match?.id || 'w_' + crypto.randomUUID().replace(/-/g, '');
      used.add(word.id);
      return word;
    });
    return words;
  }
  const headers = {
    en: ['단어', '영어', '영어단어', '영단어', 'word', 'english', 'en', 'vocabulary'],
    ko: ['뜻', '의미', '한글', '한국어', 'meaning', 'korean', 'ko'],
    pos: ['품사', 'pos'], emoji: ['그림', '이모지', 'emoji'],
    example: ['예문', '영어예문', 'example'], translation: ['예문해석', '해석', 'translation']
  };
  function parseWorkbook(workbook, sourceName, XLSX) {
    const rows = [], warnings = [];
    let title = sourceName.replace(/\.(xlsx|xls)$/i, '').replace(/_1column$/i, '').replace(/_/g, ' ');
    let matchedSheets = 0;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet?.['!ref']) continue;
      const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
      if (range.e.r > 10003 || range.e.c > 50) throw new Error(`${name}: 사용 범위가 너무 넓어요. 단어 표만 남긴 파일로 첨부해 주세요.`);
      const table = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: '', raw: false, blankrows: true, range: {s: {r: 0, c: 0}, e: XLSX.utils.decode_range(sheet['!ref']).e}});
      let start = -1, columns = {};
      for (let r = 0; r < Math.min(30, table.length); r++) {
        const found = {};
        table[r].forEach((value, c) => {
          const normalized = key(value).replace(/[\s_]/g, '');
          for (const [field, labels] of Object.entries(headers)) if (labels.includes(normalized)) found[field] = c;
        });
        if (found.en !== undefined) { start = r + 1; columns = found; break; }
      }
      if (start < 0) { warnings.push(`${name}: '단어' 머리글이 없어 제외했어요.`); continue; }
      matchedSheets++;
      const first = clean(table[0]?.[0]);
      if (matchedSheets === 1 && start > 1 && first && first.length <= 120) title = first.replace(/\s*\|\s*단어장\s*$/, '').trim();
      let missing = 0, blankEnglish = 0;
      for (let r = start; r < table.length; r++) {
        const en = clean(table[r][columns.en]);
        if (!en) {
          if (columns.ko !== undefined && clean(table[r][columns.ko])) blankEnglish++;
          continue;
        }
        if (key(en) === key(table[start - 1][columns.en]) && columns.ko !== undefined && key(table[r][columns.ko]) === key(table[start - 1][columns.ko])) continue;
        const row = {};
        for (const field of Object.keys(limits)) {
          const col = columns[field];
          const cell = col === undefined ? null : sheet[XLSX.utils.encode_cell({r, c: col})];
          if (cell?.f || cell?.t === 'e') throw new Error(`${name} ${r + 1}행: 수식이나 오류 대신 단어와 뜻을 값으로 입력해 주세요.`);
          row[field] = col === undefined ? '' : clean(table[r][col]);
        }
        if (!row.ko) missing++;
        rows.push(row);
        if (rows.length > 1000) throw new Error('한 단어장에는 최대 1,000개를 넣을 수 있어요. 파일을 나누어 주세요.');
      }
      if (missing) warnings.push(`${name}: 뜻이 없는 ${missing}개는 발음 듣기·듣고 쓰기·게임으로 연습할 수 있어요.`);
      if (blankEnglish) warnings.push(`${name}: 영어가 비어 있는 ${blankEnglish}행을 제외했어요.`);
    }
    if (!matchedSheets || !rows.length) throw new Error("단어를 찾지 못했어요. 첫 30행 안에 '단어'와 '뜻' 머리글을 넣어 주세요.");
    const duplicateCount = rows.length - new Set(rows.map(w => key(w.en) + '\u0000' + key(w.ko))).size;
    if (duplicateCount) warnings.push(`영어와 뜻이 같은 중복 ${duplicateCount}개도 원본 순서대로 유지했어요.`);
    return {title, sourceName, words: prepareWords(rows), warnings};
  }
  async function parseFile(file) {
    if (!file || !/\.(xlsx|xls)$/i.test(file.name)) throw new Error('.xlsx 또는 .xls 엑셀 파일을 첨부해 주세요.');
    if (file.size > 5 * 1024 * 1024) throw new Error('파일은 5MB 이하로 첨부해 주세요.');
    const data = await file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('book-import-worker.js', base));
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('파일 분석 시간이 길어요. 단어 표만 남겨 다시 첨부해 주세요.')); }, 20000);
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      worker.onmessage = event => { finish(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
      worker.onerror = () => { finish(); reject(new Error('엑셀 파일을 읽지 못했어요. 파일 형식을 확인해 주세요.')); };
      worker.postMessage({data, sourceName: file.name}, [data]);
    });
  }
  root.NamdalraBooks = Object.freeze({parseFile, prepareWords, parseWorkbook});
})(typeof window === 'undefined' ? self : window);
