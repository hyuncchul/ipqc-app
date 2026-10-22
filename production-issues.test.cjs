const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {filterRecords, group, translate} = require('./production-issues.js');

const rows = [
  {id:'new', equipmentId:'A07', sapPN:'123', description:'Lens module', lotCardNo:'LTC-100', process:'FOL', defect:'Scratch', inspectorName:'홍길동', status:'registered'},
  {id:'review', equipmentId:'B13', sapPN:'456', process:'EOL', defect:'Dust', status:'quality_review', method:'Sorting'},
  {id:'done', equipmentId:'A07', sapPN:'123', process:'OQC', status:'completed'},
  {id:'legacy', equipmentId:'', sapPN:'789', process:'FOL', status:'production_pending'}
];
test('status counts group production pending and registered together', () => {
  assert.deepEqual(rows.map(group), ['pending','quality','completed','pending']);
  assert.deepEqual(filterRecords(rows,{status:'pending'}).map(r=>r.id), ['new','legacy']);
});
test('machine shortcut does not assign records with no equipment ID', () => {
  assert.deepEqual(filterRecords(rows,{machine:'A07'}).map(r=>r.id), ['new','done']);
});
test('search is case insensitive and matches card, description and inspector', () => {
  for (const query of ['  ltc-100  ', 'MODULE', '홍길동']) assert.equal(filterRecords(rows,{query})[0].id, 'new');
  assert.equal(filterRecords(rows,{query:'sorting'})[0].id, 'review');
});
test('status, machine, process and search filters combine without altering source rows', () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(filterRecords(rows,{machine:'A07',process:'OQC',status:'completed',query:'123'}).map(r=>r.id), ['done']);
  assert.deepEqual(filterRecords(rows,{machine:'A07',process:'EOL'}), []);
  assert.equal(JSON.stringify(rows),before);
});
test('every supported production locale has list and count translations', () => {
  for (const locale of ['ko-KR','en-US','zh-TW','vi-VN','id-ID']) {
    assert.notEqual(translate('title',locale),'title');
    assert.match(translate('count',locale,{count:2,total:3}),/2/);
    assert.match(translate('count',locale,{count:2,total:3}),/3/);
  }
  assert.equal(translate('title','unsupported'),'불량 등록 현황');
});
test('bundled production script parses and the replacement never calls the legacy incidents API', () => {
  const source = fs.readFileSync(__dirname+'/production.html','utf8');
  const script = source.slice(source.indexOf('<script>"use strict";')+8,source.lastIndexOf('</script>'));
  new vm.Script(script);
  assert.equal(script.includes('/api/incidents'),false);
  assert.match(script,/ProductionIssues\.mount/);
  assert.match(script,/view\.current\?\.destroy\(\)/);
  assert.match(source,/production-issues-data\.js/);
  assert.match(source,/production-issues\.css/);
});
