const assert=require('node:assert/strict');
const XLSX=require('./NPI_Lens_xlsx.min.js');
const C=require('./Checkcoc-excel-core.js');
function book(rows){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Test');return wb}
function inspect(rows){return C.inspectWorkbook(book(rows),XLSX)}
const header=['ITEM','LSL','USL','1','2','MEAN','MAX','MIN'];
let a=inspect([header,['A',0,10,0,10,5,10,0]]);assert.equal(a.status,'pass');
a=inspect([header,['A',0,10,-.1,10,4.95,10,-.1]]);assert(a.issues.some(x=>x.kind==='측정값 규격 이탈'&&x.cell==='D2'));
a=inspect([header,['A',0,10,2,4,8,4,2]]);assert(a.issues.some(x=>x.kind==='통계 계산 불일치'&&x.cell==='F2'));
a=inspect([header,['A',0,10,2,null,2,2,2]]);assert.equal(a.status,'review');
a=inspect([['Item','Upper Limit','Lower Limit','INSPECT_VALUE1','INSPECT_VALUE2'],['A',5,1,2,3]]);assert.equal(a.status,'pass');assert.equal(a.checks.length,1);
a=inspect([['ITEM','SPEC LIMIT(mm)','#1','#2','MIN','MAX','AVG'],['A','10 +0.25/-0.13',10,10.2,10,10.2,10.1]]);assert.equal(a.status,'pass');
a=inspect([['ITEM','CRITERIA (MM)','RESULT','DATA'],['','','',1,2],['A','>15','P',15,16]]);assert(a.issues.some(x=>x.kind==='測定値規格逸脱'||x.kind==='측정값 규격 이탈'));
let wb=book([header,['A',0,10,2,4,3,4,2]]);wb.Sheets.Test.D2={t:'e',v:7,w:'#DIV/0!'};a=C.inspectWorkbook(wb,XLSX);assert.equal(a.status,'review');
wb=book([header,['A',0,10,2,4,3,4,2]]);wb.Sheets.Test.D2={t:'n',f:'SOME_FUNCTION()'};a=C.inspectWorkbook(wb,XLSX);assert(a.issues.some(x=>x.message.includes('저장값')));
assert.equal(C.parseSpec('0.305 -0.076 / +0').low,.229);
assert.equal(C.parseSpec('25 MIL Max').high,25);
assert(C.outside(15,C.parseSpec('>15KG')));assert(!C.outside(15,C.parseSpec('>=15KG')));
assert.equal(C.numeric({t:'s',v:'106'},true),1e6);assert.equal(C.numeric({t:'s',v:'106'},false),106);
wb=book([header,['A',0,10,2,4,3,4,2]]);wb.Sheets.Test.I1={t:'s',v:'LSL'};wb.Sheets.Test.I2={t:'n',v:100};wb.Sheets.Test['!cols']=Array.from({length:9},(_,i)=>({hidden:i===8}));a=C.inspectWorkbook(wb,XLSX);assert.equal(a.status,'pass');
assert.equal(inspect([['title only']]).status,'unread');
console.log('Checkcoc Excel: bounds, all-cell checks, formula caches, aliases, tolerances, hidden helpers and unrecognized formats passed');
a=inspect([header,['A',0,10,null,null,3,4,2]]);assert.equal(a.status,'review');assert(a.issues.some(x=>x.kind==='측정값 누락'));
a=inspect([header,['A',0,10,2,4,null,4,2]]);assert.equal(a.status,'review');assert(a.issues.some(x=>x.kind==='통계값 누락'));
console.log('Empty measurement rows and missing statistics are held for review');
a=inspect([['1.2 POCKET PITCH DIMENSIONAL:'],['X',165,1],['',165.01]]);assert.equal(a.status,'review');assert(a.issues.some(x=>x.kind==='허용 규격 미정'));
console.log('Nominal-only pocket pitch is not silently accepted');
