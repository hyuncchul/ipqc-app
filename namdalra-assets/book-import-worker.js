'use strict';
importScripts('xlsx.full.min.js', 'word-pictures.js', 'books.js');
self.onmessage = event => {
  try {
    const workbook = XLSX.read(event.data.data, {type: 'array', cellFormula: true, cellHTML: false, cellStyles: false, sheetRows: 10005});
    self.postMessage({result: NamdalraBooks.parseWorkbook(workbook, event.data.sourceName, XLSX)});
  } catch (error) {
    self.postMessage({error: error?.message || '엑셀 내용을 확인해 주세요.'});
  }
};
