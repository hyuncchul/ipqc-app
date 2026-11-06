/* Checkcoc workbook inspection. No formulas or macros are executed. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CheckcocExcel=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clean=x=>String(x??'').replace(/[\r\n]+/g,' ').replace(/[−–—]/g,'-').replace(/\s+/g,' ').trim();
const norm=x=>clean(x).toUpperCase().replace(/[\s_.:()#]/g,'');
const plain=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const n='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
function text(cell){if(!cell)return '';if(cell.r&&typeof cell.r==='string'&&/superscript/.test(cell.r)){let t='';for(const m of cell.r.matchAll(/<r>([\s\S]*?)<\/r>/g)){const chunk=[...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join('');t+=(/superscript/.test(m[1])?'^':'')+chunk}if(t)return clean(t).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
return clean(cell.v)}
function numeric(cell,electrical=false,mode='raw'){
 if(!cell||cell.t==='e'||cell.v===undefined||cell.v===null||cell.v==='')return null;
 if(typeof cell.v==='number'&&Number.isFinite(cell.v)){if(mode==='display'&&plain.test(clean(cell.w)))return Number(clean(cell.w));return cell.v}
 let t=text(cell).replace(/,/g,'').replace(/\s+/g,'');let m;if(m=t.match(/^10\^([+-]?\d+)$/))return 10**Number(m[1]);
 if(electrical&&(m=t.match(/^10(\d{1,2})$/)))return 10**Number(m[1]);
 t=t.replace(/(?<=\d)(?:mm|mil|kgf?|ohms?|v)$/i,'');if(plain.test(t))return Number.isFinite(Number(t))?Number(t):null;return null;
}
function parseSpec(value,electrical=false){
 let s=clean(value).replace(/,/g,'').replace(/[～〜]/g,'~').replace(/≤/g,'<=').replace(/≥/g,'>=').replace(/\(\s*MAX\s*\)/ig,'MAX').replace(/\(\s*MIN\s*\)/ig,'MIN');
 if(!s||/^(?:N\/?A|[-.]+)$/i.test(s))return null;
 let ambiguous=false;
 s=s.replace(/(?:1(?:\.0+)?\s*[xX×]\s*)?10\s*\^\s*([+-]?\d+)/g,(_,e)=>String(10**Number(e)));
 if(electrical){s=s.replace(/(?:1(?:\.0+)?\s*[xX×]\s*)?10E(\d+)/ig,(_,e)=>{ambiguous=true;return String(10**Number(e))});s=s.replace(/\b10(\d{1,2})\b/g,(_,e)=>{ambiguous=true;return String(10**Number(e))})}
 const make=(low,high,loOpen=false,hiOpen=false)=>({low:low===null?null:Number(Number(low).toPrecision(14)),high:high===null?null:Number(Number(high).toPrecision(14)),loOpen,hiOpen,source:clean(value),ambiguous});
 let m;
 if(m=s.match(new RegExp('('+n+')\\s*(?:±|\\+\\s*/\\s*-)\\s*('+n+')','i'))){if(Number(m[2])<0)return null;return make(Number(m[1])-Number(m[2]),Number(m[1])+Number(m[2]))}
 if(m=s.match(new RegExp('('+n+')\\s*([+-]\\s*\\d+(?:\\.\\d*)?)\\s*/\\s*([+-]\\s*\\d+(?:\\.\\d*)?)','i'))){const a=Number(m[2].replace(/\s/g,'')),b=Number(m[3].replace(/\s/g,''));if(a*b>0)return null;return make(Number(m[1])+Math.min(a,b),Number(m[1])+Math.max(a,b))}
 if(m=s.match(new RegExp('\\(-\\)\\s*/\\s*\\(\\+\\)\\s*('+n+')','i')))return make(-Math.abs(Number(m[1])),Math.abs(Number(m[1])));
 const eng=s.match(new RegExp('(?:GREATER THAN|AT LEAST)\\s*('+n+')[\\s\\S]*?(?:LESS THAN|AT MOST)\\s*('+n+')','i'));if(eng)return {...make(eng[1],eng[2],!/EQUAL TO OR GREATER/i.test(s),!/EQUAL TO OR LESS/i.test(s)),ambiguous};
 if(m=s.match(new RegExp('('+n+')\\s*(?:mm|mil|kgf?|ohms?)?\\s*(?:~|TO|-)\\s*('+n+')','i')))return make(m[1],m[2]);
 if(m=s.match(new RegExp('(?:MAX(?:IMUM)?\\.?|DOES NOT EXCEED|NOT EXCEED)\\s*('+n+')','i')))return make(null,m[1]);
 if(m=s.match(new RegExp('('+n+')\\s*(?:MM|MIL|KGF?)?\\s*MAX\\b','i')))return make(null,m[1]);
 if(m=s.match(new RegExp('(?:MIN(?:IMUM)?\\.?)\\s*('+n+')','i')))return make(m[1],null);
 if(m=s.match(new RegExp('('+n+')\\s*(?:MM|MIL|KGF?)?\\s*MIN\\b','i')))return make(m[1],null);
 if(m=s.match(new RegExp('(<=|>=|<|>)\\s*('+n+')','i')))return m[1][0]==='<'?make(null,m[2],false,m[1]==='<'):make(m[2],null,m[1]==='>',false);
 // A pair of E-notation bounds used in legacy electrical specification cells.
 if(electrical&&/\s/.test(s)){const ts=s.split(/\s+/).filter(t=>plain.test(t));if(ts.length===2)return {...make(ts[0],ts[1]),ambiguous:true}}
 return null;
}
function outside(x,s){const eps=Number.EPSILON*32*Math.max(1,Math.abs(x),Math.abs(s.low||0),Math.abs(s.high||0));return (s.low!==null&&(s.loOpen?x<=s.low:x<s.low-eps))||(s.high!==null&&(s.hiOpen?x>=s.high:x>s.high+eps))}
function summary(v){let min=Infinity,max=-Infinity,mean=0;v.forEach((x,i)=>{min=Math.min(min,x);max=Math.max(max,x);mean+= (x-mean)/(i+1)});return {min,max,mean}}
function precision(cell){const z=String(cell?.z||'').split(';')[0].replace(/"[^"]*"/g,'').replace(/\[[^\]]*\]/g,'');const e=z.match(/\.([0#?]+)(?:E[+-]0+)?/i);if(e&&!/E[+-]/i.test(z))return e[1].length;if(/^[0#?,]+$/.test(z))return 0;const t=clean(cell?.w??cell?.v),m=t.match(/^[+-]?\d+\.(\d+)$/);return m?Math.min(m[1].length,12):null}
function inspectWorkbook(wb,XLSX,options={}){
 const mode=options.mode==='display'?'display':'raw',checks=[],issues=[],excluded=[],notes=new Set(),sheetInfo=[];const addr=(r,c)=>XLSX.utils.encode_cell({r,c});let formulaCount=0;
 for(const sn of wb.SheetNames){
 const sh=wb.Sheets[sn],all=Object.keys(sh).filter(a=>/^[A-Z]+\d+$/.test(a)&&sh[a].v!==undefined);if(!all.length){sheetInfo.push({name:sn,checks:0,issues:0});continue}
 const coords=all.map(a=>XLSX.utils.decode_cell(a)),lastRow=Math.max(...coords.map(p=>p.r)),lastCol=Math.max(...coords.map(p=>p.c));if(lastRow>20000||lastCol>500){issues.push({sheet:sn,cell:sh['!ref']||'A1',severity:'review',kind:'읽기 범위',item:'시트 크기',message:'검사 지원 범위(20,000행·501열)를 초과한 시트입니다.'});continue}
 const rows=new Map();all.forEach(a=>{const {r,c}=XLSX.utils.decode_cell(a);if(!rows.has(r))rows.set(r,[]);rows.get(r).push(c);if(sh[a].f)formulaCount++});for(const cols of rows.values())cols.sort((a,b)=>a-b);
 const visible=c=>!sh['!cols']?.[c]?.hidden;
 const cell=(r,c)=>c===undefined?undefined:sh[addr(r,c)];
 const anchor=(r,c)=>{const m=(sh['!merges']||[]).find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);return m?{r:m.s.r,c:m.s.c}:{r,c}};
 const merged=(r,c)=>{const a=anchor(r,c);return cell(a.r,a.c)};
 const value=(r,c)=>text(cell(r,c));
 const occupied=r=>(rows.get(r)||[]).filter(c=>visible(c)&&value(r,c));
 const rowString=r=>occupied(r).map(c=>value(r,c)).join(' | ');
 const electrical=t=>/RESIST|OHM|S\s*\/\s*R|\bSR\b|S\.R\b/i.test(t);
 const seen=new Set();let schema=null;
 const addIssue=(ctx,severity,kind,c,message,actual,expected)=>{issues.push({sheet:sn,cell:addr(ctx.r,c??ctx.first),severity,kind,item:ctx.name,message,actual,expected})};
 function run(r,name,spec,sampleCols,statsCols={},specCol=0,judgement,extra={}){
  const key=r+':'+sampleCols.join(',');if(seen.has(key))return;seen.add(key);const ctx={r,name,first:sampleCols[0]??specCol};
  const es=electrical(name+' '+extra.unit),samples=[],invalid=[];
  for(const c of sampleCols){const x=cell(r,c),num=numeric(x,es,mode);if(num===null)invalid.push(c);else samples.push({cell:addr(r,c),c,value:num,display:x?.w??text(x),raw:x?.v})}
  if(!spec){if(samples.length||invalid.some(c=>cell(r,c)?.f||cell(r,c)?.t==='e'))addIssue(ctx,'review','규격 미인식',specCol,'측정값은 있으나 규격을 해석하지 못했습니다.');else excluded.push({sheet:sn,row:r+1,item:name,reason:'숫자 규격·측정값이 없는 항목'});return}
  if((spec.low===null&&spec.high===null)||(spec.low!==null&&spec.high!==null&&spec.low>=spec.high)){addIssue(ctx,'error','규격 오류',specCol,'하한은 상한보다 작아야 합니다.');return}
  if(spec.ambiguous) addIssue(ctx,'review','지수 표기',specCol,'저항 규격의 105·10E5 같은 표기를 지수로 해석했습니다. 원본 지수 표기를 확인하세요.');
  for(const c of invalid){const x=cell(r,c);addIssue(ctx,'review','측정값 누락',c,x?.t==='e'?'엑셀 오류 값입니다.':x?.f?'수식의 마지막 저장값이 없습니다. Excel에서 계산·저장 후 다시 올리세요.':'숫자가 아니거나 측정값이 비어 있습니다.')}
  if(!samples.length)return;
  const calc=summary(samples.map(x=>x.value));const record={sheet:sn,row:r+1,item:name,spec,samples,min:calc.min,max:calc.max,mean:extra.summaryOnly?null:calc.mean,unit:extra.unit||'',complete:invalid.length===0};checks.push(record);
  let outCount=0;for(const x of samples)if(outside(x.value,spec)){outCount++;addIssue(ctx,'error','측정값 규격 이탈',x.c,'개별 측정값이 규격 범위를 벗어났습니다.',x.value,spec.source)}
  const names={mean:'평균',min:'최솟값',max:'최댓값'};
  for(const [k,c] of Object.entries(statsCols)){const x=cell(r,c);if(!x||x.v===undefined||x.v===''||/^N\/?A$/i.test(text(x))){if(!es)addIssue(ctx,'review','통계값 누락',c,names[k]+' 셀에 값 또는 수식 저장값이 없습니다.');continue;}const num=numeric(x,es,mode);if(num===null){addIssue(ctx,'review','통계값 해석 불가',c,'통계값 또는 수식 저장값을 읽을 수 없습니다.');continue}
   if(outside(num,spec))addIssue(ctx,'error','통계값 규격 이탈',c,names[k]+'이 규격 범위를 벗어났습니다.',num,spec.source);
   const p=precision(x),eps=1e-10*Math.max(1,Math.abs(calc[k]));const tol=p===null?eps:Math.max(eps,0.5*10**(-p)+eps);
   if(!invalid.length&&Math.abs(num-calc[k])>tol)addIssue(ctx,'error','통계 계산 불일치',c,names[k]+'이 측정값으로 재계산한 결과와 다릅니다.',num,calc[k]);
  }
  const j=judgement===undefined?'':norm(value(r,judgement));if(outCount&&['PASS','P','OK','ACC','ACCEPT','합격'].includes(j))addIssue(ctx,'error','합격 표시 모순',judgement,'측정값이 규격을 벗어나는데 합격으로 표시되어 있습니다.');
  if(es&&sampleCols.some(c=>/^10\d{1,2}$/.test(text(cell(r,c)))&&!cell(r,c)?.r))notes.add('XLS 저항값의 105·106 표기는 해당 저항 항목에서 10^5·10^6으로 해석합니다. 원본 위첨자 확인이 필요합니다.');
 }
 const statsHeader=t=>({MEAN:'mean',AVG:'mean',AVERAGE:'mean','평균':'mean',MIN:'min',MINIMUM:'min','최소값':'min',MAX:'max',MAXIMUM:'max','최대값':'max'})[norm(t)];
 const isSample=t=>/^(?:#?\d+|S\d+|DATA\d+|INSPECTVALUE\d+)$/.test(norm(t));
 function detect(r){
  const cs=occupied(r),texts=cs.map(c=>norm(value(r,c)));const sampleCs=cs.filter(c=>isSample(value(r,c)));let follow=[];
  if(sampleCs.length<2&&/\bDATA\b|CRITERIA|SPEC|RESULT/i.test(rowString(r)))follow=occupied(r+1).filter(c=>isSample(value(r+1,c)));
  const samples=sampleCs.length>=2?sampleCs:follow;if(samples.length<1)return null;
  const first=samples[0];let low=cs.find(c=>c<first&&['LSL','LOWERLIMIT','FROMLIMIT'].includes(norm(value(r,c)))),high=cs.find(c=>c<first&&['USL','UPPERLIMIT'].includes(norm(value(r,c))));
  let sc=cs.find(c=>c<first&&/^(SPECLIMIT|SPECRANGE|CRITERIA)/.test(norm(value(r,c))));
  if(sc!==undefined&&norm(value(r+1,sc))==='FROM'){low=sc;const to=occupied(r+1).find(c=>norm(value(r+1,c))==='TO');if(to!==undefined)high=to;sc=undefined}
  const stat={};for(const c of cs){const k=statsHeader(value(r,c));if(k&&c>first)stat[k]=c}
  const item=cs.filter(c=>c<Math.min(low??first,high??first,sc??first)&&/^(ITEM|DIMENSION|INSPECTIONITEM|PARAMETER)$/.test(norm(value(r,c)))).at(-1);
  let actualSamples=samples.filter(c=>{if(!/^DATA\d+$/i.test(norm(value(r,c))))return true;let nonempty=0,nums=0;for(let rr=r+1;rr<=Math.min(lastRow,r+40);rr++){const x=cell(rr,c);if(x?.v!==undefined&&x.v!==''){nonempty++;if(numeric(x,false)!==null)nums++}}return !nonempty||nums>0});
  if(!actualSamples.length)return null;
  if(sc===undefined&&low===undefined&&high===undefined)return null;
  return {header:r,start:r+(follow.length?2:1),samples:actualSamples,low,high,sc,stat,item,context:/RESISTIVITY|RESISTANCE/i.test(rowString(r-1))?rowString(r-1):'',nameCols:cs.filter(c=>c<Math.min(low??first,high??first,sc??first)),judge:cs.find(c=>/^(RESULT|DECISION|PASSFAIL)$/.test(norm(value(r,c))))};
 }
 for(let r=0;r<=lastRow;r++){
  const cs=occupied(r);if(!cs.length)continue;const rt=rowString(r);
  // Instrument reports embedded as fixed-width lines in a single cell.
  if(/Measurement\s+Nominal\s+Actual\s+Deviation/i.test(rt)){
   for(let rr=r+1;rr<=Math.min(lastRow,r+120);rr++){const c=occupied(rr)[0];if(c===undefined)break;const t=value(rr,c);if(/^-+/.test(t))continue;const m=t.match(new RegExp('^(.*?)\\s+('+n+')\\s+('+n+')\\s+('+n+')\\s+('+n+')\\s+('+n+')\\s+(Pass|Fail|P|F)\\s*$','i'));if(!m)break;const nominal=Number(m[2]),actual=Number(m[3]),deviation=Number(m[4]),lo=nominal+Number(m[5]),hi=nominal+Number(m[6]),spec={low:lo,high:hi,source:lo+' ~ '+hi};checks.push({sheet:sn,row:rr+1,item:m[1],spec,samples:[{cell:addr(rr,c),c,value:actual}],...summary([actual]),unit:'mm',complete:true});if(outside(actual,spec))addIssue({r:rr,name:m[1],first:c},'error','측정값 규격 이탈',c,'장비 보고서의 Actual이 규격을 벗어났습니다.',actual,spec.source);if(Math.abs(actual-nominal-deviation)>0.000500001)addIssue({r:rr,name:m[1],first:c},'error','편차 계산 불일치',c,'Deviation이 Actual - Nominal과 다릅니다.',deviation,actual-nominal)}continue;
  }
  if(/POCKET\s*PITCH\s*DIMENSIONAL/i.test(rt)){
   const following=Array.from({length:Math.min(7,lastRow-r)},(_,i)=>r+i+1);const explicit=following.some(rr=>/LSL|USL|±|SPEC LIMIT|SPEC RANGE/i.test(rowString(rr)));const measured=following.slice(1).some(rr=>occupied(rr).some(c=>numeric(cell(rr,c),false,mode)!==null));if(measured&&!explicit)addIssue({r,name:'POCKET PITCH',first:cs[0]},'review','허용 규격 미정',cs[0],'포켓 피치 측정값은 있으나 허용 공차나 LSL·USL을 확인할 수 없어 해당 부분의 판정을 보류했습니다.');schema=null;continue;
  }
  const detected=detect(r);if(detected){schema=detected;continue}
  if(cs.filter(c=>isSample(value(r,c))).length>=2&&/ITEM|SAMPLE|MARKING/i.test(rt)){schema=null;continue}
  if(/^\d+\.\s*(?:VISUAL|STACKING|SURFACE|MECHANICAL|LEANING)/i.test(rt)||/INSPECTED BY|APPROVED BY|FORM NO|^DATE:/i.test(rt)){schema=null;continue}
  // Column-oriented bake matrices: each column has its own specification.
  if(cs.some(c=>norm(value(r,c))==='SPEC')&&occupied(r+1).some(c=>/^#\d+$/.test(value(r+1,c)))){
   const sampleRows=[];for(let rr=r+1;rr<=lastRow&&occupied(rr).some(c=>/^#\d+$/.test(value(rr,c)));rr++)sampleRows.push(rr);
   for(const c of cs){if(norm(value(r,c))==='SPEC')continue;const label=text(merged(r-1,c));const es=electrical(label),sp=parseSpec(text(cell(r,c)),es);if(!sp)continue;const values=sampleRows.map(rr=>({rr,c,x:numeric(cell(rr,c),es,mode)}));const good=values.filter(x=>x.x!==null);const ctx={r,name:label||value(r,c),first:c};if(sp.ambiguous)addIssue(ctx,'review','지수 표기',c,'저항 규격의 지수 표기를 확인하세요.');for(const v of values)if(v.x===null)addIssue({r:v.rr,name:ctx.name,first:c},'review','측정값 누락',c,'숫자 또는 수식 저장값을 읽지 못했습니다.');if(good.length){checks.push({sheet:sn,row:r+1,item:(text(merged(r-2,c))+' · '+label).trim(),spec:sp,samples:good.map(v=>({cell:addr(v.rr,c),c,value:v.x})),...summary(good.map(v=>v.x)),complete:good.length===values.length});for(const v of good)if(outside(v.x,sp))addIssue({r:v.rr,name:ctx.name,first:c},'error','측정값 규격 이탈',c,'베이크 시험값이 해당 열의 규격을 벗어났습니다.',v.x,sp.source)}}
   schema=null;continue;
  }
  // SR min/max reading rows whose shared specification is printed underneath.
  if(/MIN\.?\s*Reading|MAX\.?\s*Reading/i.test(rt)){
   const hc=[r-1,r-2].map(rr=>occupied(rr).filter(c=>/^#\d+$/.test(value(rr,c)))).find(x=>x.length);let spec=null,sc=0;for(const rr of [r,r-1,r+1])for(const c of occupied(rr)){const p=parseSpec(value(rr,c),true);if(p&&p.low!==null&&p.high!==null){spec=p;sc=c;break}}if(hc)run(r,'SURFACE RESISTANCE · '+(/MIN/i.test(rt)?'MIN Reading':'MAX Reading'),spec,hc,{},sc);continue;
  }
  // Reported Min/Max pairs below a separately stated stacking specification.
  if(/\[SPEC:?\]/i.test(rt)){
   const sp=parseSpec(rt);const labels=occupied(r+1),mins=labels.find(c=>norm(value(r+1,c))==='MIN'),maxs=labels.find(c=>norm(value(r+1,c))==='MAX');
   if(sp&&mins!==undefined&&maxs!==undefined){run(r+2,'STACKING LEAN TEST · 보고된 Min/Max',sp,[mins,maxs],{},cs[0],undefined,{summaryOnly:true});continue}
  }
  if(!schema){const sc=cs.find(c=>/[<>]/.test(value(r,c))&&parseSpec(value(r,c)));if(sc!==undefined){const data=cs.filter(c=>c>sc&&numeric(cell(r,c),false,mode)!==null);if(data.length===1){run(r,value(r,sc),parseSpec(value(r,sc)),data,{},sc);continue}}}
  if(schema&&r>=schema.start){
   if(cs.length===1&&/INSPECTION|TEST|DIMENSION|RECOMMENDATION|SHIPP|STACKING|SURFACE|BEFORE BAKE|AFTER BAKE|POCKET PITCH/i.test(rt)){schema=null;continue}
   const samplePresent=schema.samples.filter(c=>cell(r,c)?.v!==undefined&&cell(r,c)?.v!=='');const numericPresent=samplePresent.filter(c=>numeric(cell(r,c),false,mode)!==null);
   const sc=schema.sc??schema.low??schema.high;let name=(schema.context||((schema.item!==undefined?value(r,schema.item):schema.nameCols.map(c=>value(r,c)).filter(Boolean).join(' · ')))||('행 '+(r+1)));let sp=null;
   if(schema.sc!==undefined){sp=parseSpec(text(merged(r,schema.sc)),electrical(name));if(!sp&&/^mm$/i.test(value(r,schema.sc)))sp=parseSpec(text(merged(r-1,schema.sc)),electrical(name));if(!sp&&/Before|After/i.test(rt)){for(let rr=r-1;rr>=Math.max(schema.header+1,r-2);rr--){sp=parseSpec(text(merged(rr,schema.sc)),electrical(name));if(sp)break}}}
   else{const lc=cell(r,schema.low),hc=cell(r,schema.high),lo=numeric(lc,electrical(name)),hi=numeric(hc,electrical(name));const lt=text(lc),ht=text(hc);const special=/[<>±]|\(-\)|\(\+\)/.test(lt+' '+ht)?parseSpec(lt+' '+ht,electrical(name)):null;if(special)sp=special;else if((lo!==null||hi!==null)&&!([lc,hc].some(x=>x?.f&&x.v===undefined))&&(lo!==null||!lt||/^(?:N\/?A|[-.]+)$/i.test(lt))&&(hi!==null||!ht||/^(?:N\/?A|[-.]+)$/i.test(ht)))sp={low:lo,high:hi,source:(lo===null?'하한 없음':lo)+' ~ '+(hi===null?'상한 없음':hi)};}
   if(!numericPresent.length&&!schema.samples.some(c=>cell(r,c)?.f||cell(r,c)?.t==='e')){if(sp){if(/MAX\s*-\s*MIN|STRAPPING|STUCK|JAM|NO BROKEN/i.test(rt)||/^행 \d+$/.test(name))continue;run(r,name,sp,schema.samples,schema.stat,sc,schema.judge);continue}if(samplePresent.length&&schema.samples.every(c=>/^(OK|PASS|ACC|P|N\/?A)$/i.test(value(r,c))||!value(r,c)))excluded.push({sheet:sn,row:r+1,item:name,reason:'정성 판정 / 적용 제외'});continue}
   if(numericPresent.length===1&&/MAX\s*-\s*MIN/i.test(value(r-1,numericPresent[0]))){run(r,value(r-1,schema.item??0)||'FLATNESS',sp,numericPresent,{},sc,schema.judge);continue}
   // If a labelled data column contains a metadata code on this row, hold it for review rather than accepting a partial sample.
   run(r,name,sp,schema.samples,schema.stat,sc,schema.judge,{unit:occupied(schema.header).find(c=>norm(value(schema.header,c))==='UNIT')!==undefined?value(r,occupied(schema.header).find(c=>norm(value(schema.header,c))==='UNIT')):''});
  }
 }
 const counted=checks.filter(x=>x.sheet===sn).length;sheetInfo.push({name:sn,checks:counted,issues:issues.filter(x=>x.sheet===sn).length});if(!counted)notes.add('시트 '+sn+': 자동 검사 가능한 수치 항목이 없습니다. 표지·정성 내용·미지원 표 구조는 별도 확인하세요.');
 }
 if(formulaCount)notes.add('수식은 실행하지 않고 파일의 마지막 저장값을 검사합니다. 통계값은 앱에서 독립적으로 재계산합니다.');
 notes.add('Cpk·서명·인증 문구·도면 적합성·정성 시험은 자동 검증 대상에서 제외됩니다.');
 return {checks,issues,excluded,sheets:sheetInfo,notes:[...notes],mode,formulaCount,status:issues.some(x=>x.severity==='error')?'error':issues.length?'review':checks.length?'pass':'unread'};
}
return {inspectWorkbook,parseSpec,numeric,summary,text,precision,outside};
});
