const assert=require('node:assert/strict'),I=require('./Checkcoc-i18n.js');
for(const [ko,row] of Object.entries(I.catalog)){for(const lang of ['en','zh-TW']){assert.equal(I.translate(ko,lang),row[lang],ko);assert(!/[가-힣]/.test(row[lang]),ko)}assert.equal(I.translate(ko,'ko'),ko)}
const examples=[
 '검사 완료 · 10개 파일을 각각 검사했습니다. 파일명을 누르면 상세 결과와 셀 위치를 확인할 수 있습니다.',
 '오류 발견 · 수치 항목 12개 · 저장된 실제 값 기준',
 '문서값 322.58 / 기준·재계산 322.675',
 'JH FC-BGA 35X35!I62에서 보기',
 '최솟값이 측정값으로 재계산한 결과와 다릅니다.',
 '시트 Cover: 자동 검사 가능한 수치 항목이 없습니다. 표지·정성 내용·미지원 표 구조는 별도 확인하세요.',
 '원본 2페이지',
 '오류가 있는 페이지부터 표시합니다 · 표시 순서: 2 → 1페이지 · 박스에 마우스를 올리면 설명이 표시됩니다.',
 '수치 검사 12개 행 · 오류 3건 · 확인 필요 0건 · EL, BSW · 문서 전체 합격을 의미하지 않습니다',
 'MIN 불일치: 문서 322.58 / 측정값 5개 재계산 322.68',
 'EL: MIN 불일치: 문서 322.58 / 측정값 5개 재계산 322.68',
 '통계 계산 불일치: 평균이 측정값으로 재계산한 결과와 다릅니다.',
 '2페이지 추출 완료. 숫자 열을 선택한 후 원문과 대조하세요.\n행마다 숫자 개수가 다를 수 있어 자동 열 정렬은 확인이 필요합니다.',
 '불합격 · 2개 측정값이 규격을 벗어났습니다'
];
for(const s of examples)for(const lang of ['en','zh-TW'])assert(!/[가-힣]/.test(I.translate(s,lang)),I.translate(s,lang));
assert.equal(I.translate('JH_COC_260929_wrong.xls','zh-TW'),'JH_COC_260929_wrong.xls');
assert.equal(I.translate('322.58','en'),'322.58');
console.log('Translation catalog, dynamic results, errors, PDF markers and unchanged file/numeric values passed');
for(const lang of ['en','zh-TW'])assert(!/[가-힣]/.test(I.translate('통계 계산 불일치: 최솟값이 측정값으로 재계산한 결과와 다릅니다.\n실제 값: 322.58',lang)));
assert.equal(I.translate('하한 없음 ~ 0.76','en'),'No lower limit ~ 0.76');
console.log('Multiline cell tooltips and generated limit labels passed');
