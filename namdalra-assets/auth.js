'use strict';
const GRADES={e1:'초등 1학년',e2:'초등 2학년',e3:'초등 3학년',e4:'초등 4학년',e5:'초등 5학년',e6:'초등 6학년',m1:'중등 1학년',m2:'중등 2학년',m3:'중등 3학년'};
let account=null,csrfToken='',authMode='login',authBusy=false,authEpoch=0,progressDirty=false,progressTimer=0,progressFlight=null,progressSnapshot='',lastWordSnapshot={};
let pendingAccountChange=null;
let curriculumBooks=[],curriculumAssignment={bookIds:[],revision:0},currentBook=null,curriculumBusy=false;
const deferredBookProgress=new Map();
async function flushBeforeScopeChange(){
 try{await flushProgress();return null;}catch(error){
  if(error.status!==403||!currentBook||!account)throw error;
  const owner=account.id,epoch=authEpoch,bookId=currentBook.id;
  const curriculum=await accountAPI('/api/curriculum');
  if(account?.id!==owner||authEpoch!==epoch||curriculum.assignment.bookIds.includes(bookId))throw error;
  deferredBookProgress.set(owner+':'+bookId,JSON.parse(JSON.stringify(saved)));
  clearTimeout(progressTimer);progressDirty=false;
  return curriculum;
 }
}
function restoreDeferredBookProgress(){
 const key=account?.id+':'+currentBook?.id,previous=deferredBookProgress.get(key);
 if(!previous||!currentBook)return;
 for(const [id,word]of Object.entries(previous.words))if(!saved.words[id]||word.updatedAt>=saved.words[id].updatedAt)saved.words[id]=word;
 for(const [day,ids]of Object.entries(previous.days))saved.days[day]=[...new Set([...(saved.days[day]||[]),...ids])];
 for(const speed of ['easy','normal','fast'])saved.gameBest[speed]=Math.max(saved.gameBest[speed],previous.gameBest[speed]||0);
 deferredBookProgress.delete(key);queueProgress();
}
function progressPath(){return '/api/progress'+(currentBook?'?book='+encodeURIComponent(currentBook.id):'');}
function installProgress(progress){saved=normalizeProgress(progress);progressDirty=false;lastWordSnapshot={};for(const [id,w]of Object.entries(saved.words))lastWordSnapshot[id]=JSON.stringify({...w,updatedAt:undefined});progressSnapshot=JSON.stringify(saved);}
function installBook(book){
 currentBook=book;
 WORDS=book?book.words.map(w=>({...w,level:account?.level||'sprout',category:'everyday',emoji:w.emoji||window.NamdalraPictures?.lookup(w.en,w.ko)||BUILTIN_WORDS.find(b=>b.en.toLowerCase()===w.en.toLowerCase())?.emoji||'📘'})):BUILTIN_WORDS;
 validIds.clear();for(const word of WORDS)validIds.add(word.id);
}
async function fetchLearningScope(id){
 if(id){const [data,progress]=await Promise.all([accountAPI('/api/books/'+encodeURIComponent(id)),accountAPI('/api/progress?book='+encodeURIComponent(id))]);return {book:data.book,progress:progress.progress};}
 return {book:null,progress:(await accountAPI('/api/progress')).progress};
}
async function changeLearningBook(id,refresh=false){
 if(!account||curriculumBusy||authBusy)return;
 if((session&&!session.done)||(rainGame&&!rainGame.done)){toast('진행 중인 테스트나 게임을 마친 뒤 단어장을 바꿔 주세요.');return;}
 curriculumBusy=true;authBusy=true;document.body.classList.add('learning-busy');
 const owner=account.id,epoch=authEpoch;
 try{
  const recovered=await flushBeforeScopeChange();
  let books=curriculumBooks,assignment=curriculumAssignment;
  if(refresh||recovered){const data=recovered||await accountAPI('/api/curriculum');books=data.books;assignment=data.assignment;if(!assignment.bookIds.includes(id))id=assignment.bookIds[0]||'';}
  if(id&&!assignment.bookIds.includes(id))throw new Error('배정된 단어장을 선택해 주세요.');
  if(!id&&assignment.bookIds.length)id=assignment.bookIds[0];
  const scope=await fetchLearningScope(id);
  if(account?.id!==owner||authEpoch!==epoch)return;
  curriculumBooks=books;curriculumAssignment=assignment;installBook(scope.book);installProgress(scope.progress);
  restoreDeferredBookProgress();stopSpeech();resetRainGame();session=null;practiceReview=false;resetPractice();render();markSync(progressDirty?'저장 중…':'모든 기록 저장됨');toast(recovered?'배정이 바뀌었어요. 이전 단어장의 마지막 미저장 기록은 이 창에 임시로 보관해요.':refresh?'단어장 배정을 새로 불러왔어요.':'선택한 단어장으로 바뀌었어요.');
 }catch(error){if(account?.id===owner&&authEpoch===epoch){toast(error.message);render();}}
 finally{curriculumBusy=false;authBusy=false;document.body.classList.remove('learning-busy');drainPendingAccountChange();}
}
const emptyProgress=()=>({words:{},days:{},gameBest:{easy:0,normal:0,fast:0},level:'sprout',category:'everyday'});
const authEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const authEl=id=>document.getElementById(id);
async function accountAPI(path,options={}){
 const requestEpoch=authEpoch,requestOwner=account?.id;
 let data,response;
 try{data=await window.NamdalraCloud.request(path,options);response={ok:true,status:200};}
 catch(error){data={error:error.message};response={ok:false,status:error.status||400};}
 if(requestEpoch!==authEpoch)throw new Error('접속 계정이 변경되었어요. 다시 시도해 주세요.');
 if(data.csrfToken)csrfToken=data.csrfToken;
 if(!response.ok){
  const error=new Error(data.error||'요청을 처리할 수 없어요.');error.status=response.status;
  if(response.status===401&&account&&path!=='/api/change-password')showSignedOut('로그인이 만료되었어요. 다시 로그인해 주세요.');
  else if(response.status===403&&requestOwner&&path!=='/api/session'){
   try{const current=await accountAPI('/api/session');if(requestEpoch===authEpoch&&current.user?.id!==requestOwner)showSignedOut('접속 상태가 변경되었어요. 다시 로그인해 주세요.',current.csrfToken);}catch{}
  }
  throw error;
 }
 return data;
}
window.NamdalraAuth={get user(){return account;},api:accountAPI,escape:authEscape,notify:message=>toast(message),view:()=>view,queueProgress};
function passwordField(name,label,autocomplete='new-password',min=8){return `<label class="auth-field">${label}<span class="auth-password"><input type="password" name="${name}" required minlength="${min}" maxlength="128" autocomplete="${autocomplete}" placeholder="${autocomplete==='current-password'?'비밀번호를 입력해 주세요':'8자 이상 입력해 주세요'}"><button type="button" data-auth="toggle-password" aria-label="${label} 표시">표시</button></span></label>`;}
function renderAuth(mode=authMode,message=''){
 authMode=mode;const card=authEl('authCard');const gradeOptions=Object.entries(GRADES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
 if(mode==='change'){card.innerHTML=`<h2>새 비밀번호를 정해 주세요</h2><p class="auth-description">임시 비밀번호 대신 사용할 비밀번호를 설정하면 학습을 시작할 수 있어요.</p><div id="authMessage" class="auth-message" ${message?'':'hidden'}>${authEscape(message)}</div><form class="auth-form" id="requiredPasswordForm">${passwordField('currentPassword','임시 비밀번호','current-password',1)}${passwordField('newPassword','새 비밀번호')}${passwordField('confirmPassword','새 비밀번호 확인')}<button class="btn btn-primary wide" type="submit">비밀번호 변경하고 시작하기</button></form><button class="auth-change-back" data-auth="logout">로그아웃</button>`;return;}
 card.innerHTML=`<div class="auth-tabs" role="tablist" aria-label="계정 접속"><button class="auth-tab ${mode==='login'?'active':''}" data-auth="login-tab" role="tab" aria-selected="${mode==='login'}">로그인</button><button class="auth-tab ${mode==='register'?'active':''}" data-auth="register-tab" role="tab" aria-selected="${mode==='register'}">회원가입</button></div><h2>${mode==='login'?'다시 만나서 반가워요!':'나만의 영어 숲을 시작해요'}</h2><p class="auth-description">${mode==='login'?'이메일과 비밀번호로 이어서 공부해요.':'학년에 맞는 단어와 게임을 준비해 드릴게요.'}</p><div class="auth-message" id="authMessage" ${message?'':'hidden'} role="alert">${authEscape(message)}</div>${mode==='login'?`<form class="auth-form" id="loginForm"><label class="auth-field">이메일<input type="email" name="email" required maxlength="254" autocomplete="username" inputmode="email" placeholder="이메일을 입력해 주세요"></label>${passwordField('password','비밀번호','current-password',1)}<button class="btn btn-primary wide" type="submit">로그인하기</button></form><p class="auth-footer">비밀번호를 잊었다면 담당 관리자에게 문의해 주세요.</p><p class="auth-privacy">학습 지도와 회원 관리를 위해 진도와 로그인 시각이 저장되며, 담당 관리자가 확인할 수 있어요.</p>`:`<form class="auth-form" id="registerForm"><div class="auth-pair"><label class="auth-field">이름<input name="name" required minlength="2" maxlength="50" autocomplete="name" placeholder="이름"></label><label class="auth-field">연락처<input type="tel" name="phone" required minlength="9" maxlength="20" autocomplete="tel" placeholder="010-0000-0000"></label></div><label class="auth-field">주소<input name="address" required minlength="5" maxlength="200" autocomplete="street-address" placeholder="주소를 입력해 주세요"></label><div class="auth-pair"><label class="auth-field">학교<input name="school" required minlength="2" maxlength="100" autocomplete="organization" placeholder="학교 이름"></label><label class="auth-field">학년<select name="grade" required><option value="">학년 선택</option>${gradeOptions}</select></label></div><label class="auth-field">이메일<input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="hello@example.com"></label>${passwordField('password','비밀번호')}${passwordField('confirmPassword','비밀번호 확인')}<div class="auth-privacy">입력한 정보와 학습 기록은 회원 관리와 학년별 학습 제공을 위해 저장돼요. 담당 관리자는 학습 진도와 로그인 시각을 확인할 수 있어요. 어린 학생은 보호자와 함께 가입해 주세요.</div><button class="btn btn-primary wide" type="submit">회원가입하고 시작하기</button></form>`}`;
}
function authMessage(message,success=false,target='authMessage'){const el=authEl(target);if(!el)return;el.textContent=message;el.hidden=!message;el.classList.toggle('success',success);}
function lockForm(form,locked){form.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=locked;});}
function markSync(text,failed=false){const el=authEl('syncStatus');if(el){el.textContent=text;el.classList.toggle('failed',failed);}if(authEl('storageNote'))authEl('storageNote').textContent=failed?'저장하지 못한 기록이 있어요. 인터넷 연결을 확인해 주세요.':'학습 기록은 내 계정에 저장돼요.';}
function queueProgress(){if(!account||account.mustChangePassword)return;
 for(const [id,w]of Object.entries(saved.words)){const comparable=JSON.stringify({...w,updatedAt:undefined});if(lastWordSnapshot[id]!==comparable){w.updatedAt=Date.now();lastWordSnapshot[id]=comparable;}}
 progressDirty=true;clearTimeout(progressTimer);markSync('저장 중…');progressTimer=setTimeout(()=>flushProgress().catch(()=>{}),400);
}
async function flushProgress(){clearTimeout(progressTimer);if(progressFlight)return progressFlight;if(!account||!progressDirty)return;
 const owner=account.id,epoch=authEpoch,path=progressPath();progressFlight=(async()=>{try{while(progressDirty&&account?.id===owner&&epoch===authEpoch&&path===progressPath()){progressDirty=false;const snapshot=JSON.stringify(saved);await accountAPI(path,{method:'PUT',body:{progress:JSON.parse(snapshot)}});if(account?.id!==owner||epoch!==authEpoch)return;progressSnapshot=snapshot;}markSync('모든 기록 저장됨');}catch(e){if(account?.id===owner){progressDirty=true;markSync('저장 실패 · 다시 연결하면 재시도해요',true);}throw e;}finally{progressFlight=null;}})();return progressFlight;
}
function normalizeProgress(progress){const clean=emptyProgress();if(progress&&typeof progress==='object'){if(progress.words&&typeof progress.words==='object')for(const [id,w]of Object.entries(progress.words)){if(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)&&w&&typeof w==='object')clean.words[id]={known:!!w.known,wrong:!!w.wrong,starred:!!w.starred,mistakes:Math.max(0,Number(w.mistakes)||0),attempts:Math.max(0,Number(w.attempts)||0),updatedAt:Number(w.updatedAt)||0};}if(progress.days&&typeof progress.days==='object')for(const [d,ids]of Object.entries(progress.days)){if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&Array.isArray(ids))clean.days[d]=[...new Set(ids.filter(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)))];}for(const k of ['easy','normal','fast'])clean.gameBest[k]=Math.max(0,Number(progress.gameBest?.[k])||0);if(LEVELS[progress.level])clean.level=progress.level;if(CATEGORIES[progress.category])clean.category=progress.category;}
 if(account?.role==='member')clean.level=account.level||account.recommendedLevel||'sprout';return clean;
}
function showSignedOut(message='',nextToken=''){
 window.NamdalraAdmin?.destroy();deferredBookProgress.clear();curriculumBooks=[];curriculumAssignment={bookIds:[],revision:0};installBook(null);pendingAccountChange=null;authEpoch++;clearTimeout(progressTimer);progressDirty=false;account=null;csrfToken=nextToken;stopSpeech();resetRainGame();session=null;saved=emptyProgress();lastWordSnapshot={};view='practice';
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());
 document.querySelectorAll('#profileDialog,.admin-dialog').forEach(d=>d.remove());
 for(const id of ['workspace','wordShelf','memberStrip'])if(authEl(id))authEl(id).replaceChildren();
 document.body.classList.add('signed-out');authEl('authGate').hidden=false;authEl('memberStrip').hidden=true;renderAuth('login',message);
 if(!nextToken&&location.protocol!=='file:')accountAPI('/api/session').catch(()=>{});
}
async function enterAccount(user){
 account=user;authEpoch++;if(user.mustChangePassword){document.body.classList.add('signed-out');authEl('authGate').hidden=false;renderAuth('change');return;}
 const epoch=authEpoch;const curriculum=await accountAPI('/api/curriculum');if(epoch!==authEpoch)return;const scope=await fetchLearningScope(curriculum.assignment.bookIds[0]||'');if(epoch!==authEpoch)return;curriculumBooks=curriculum.books;curriculumAssignment=curriculum.assignment;installBook(scope.book);installProgress(scope.progress);
 authEl('authCard').replaceChildren();document.body.classList.remove('signed-out');authEl('authGate').hidden=true;authEl('memberStrip').hidden=false;renderMemberStrip();practiceReview=false;resetPractice();view=user.role==='admin'?'admin':'practice';render();markSync('모든 기록 저장됨');
}
function renderMemberStrip(){authEl('memberStrip').innerHTML=`<div class="member-strip-inner"><div class="member-welcome"><strong>${authEscape(account.name)}${account.role==='admin'?(account.name.endsWith('관리자')?'':' 관리자'):' 님'}</strong><span class="member-level">${account.role==='admin'?'회원 관리':authEscape(GRADES[account.grade]||'학년별 학습')}</span></div><div class="member-tools"><span class="sync-status" id="syncStatus">모든 기록 저장됨</span>${account.role==='admin'?'<button class="admin-link" data-action="nav" data-view="admin">회원 관리</button>':''}<button data-auth="profile">내 정보</button><button data-auth="logout">로그아웃</button></div></div>`;}
async function logoutAccount(){if(authBusy)return;authBusy=true;try{const revoked=await flushBeforeScopeChange();const hasDeferred=revoked||deferredBookProgress.size;const data=await accountAPI('/api/logout',{method:'POST',body:{}});showSignedOut(hasDeferred?'로그아웃했어요. 배정 해제 후 저장하지 못한 마지막 기록은 반영되지 않았어요.':'',data.csrfToken);}catch(e){if(account)toast('로그아웃하지 못했어요. '+e.message);}finally{authBusy=false;drainPendingAccountChange();}}
function openProfile(){if(!account)return;let d=authEl('profileDialog');if(!d){d=document.createElement('dialog');d.id='profileDialog';d.className='auth-profile-dialog';document.body.appendChild(d);}d.innerHTML=`<div class="dialog-header"><h2>내 정보</h2><button class="icon-btn" data-auth="close-profile" aria-label="내 정보 닫기">✕</button></div><div class="profile-fields"><div><small>이름</small>${authEscape(account.name)}</div><div><small>학년</small>${account.role==='admin'?'관리자':authEscape(GRADES[account.grade])}</div><div><small>학교</small>${authEscape(account.school||'—')}</div><div><small>연락처</small>${authEscape(account.phone||'—')}</div><div class="full"><small>이메일 / 아이디</small>${authEscape(account.email)}</div><div class="full"><small>주소</small>${authEscape(account.address||'—')}</div></div><p class="auth-note">${account.role==='member'?'회원 정보 수정은 관리자에게 요청해 주세요.':''}</p><details><summary>비밀번호 변경</summary><div class="auth-message" id="profileMessage" hidden role="alert"></div><form class="auth-form" id="profilePasswordForm">${passwordField('currentPassword','현재 비밀번호','current-password',1)}${passwordField('newPassword','새 비밀번호')}${passwordField('confirmPassword','새 비밀번호 확인')}<button class="btn btn-primary wide" type="submit">비밀번호 변경</button></form></details>`;d.showModal();}
document.addEventListener('click',e=>{const b=e.target.closest('[data-auth]');if(!b)return;switch(b.dataset.auth){case'login-tab':renderAuth('login');break;case'register-tab':renderAuth('register');break;case'toggle-password':{const input=b.previousElementSibling;input.type=input.type==='password'?'text':'password';b.textContent=input.type==='password'?'표시':'숨김';b.setAttribute('aria-label',input.type==='password'?'비밀번호 표시':'비밀번호 숨김');break;}case'logout':logoutAccount();break;case'profile':pauseRainGame();openProfile();break;case'close-profile':authEl('profileDialog').close();break;case'retry-connect':bootstrapAccount();break;}});
document.addEventListener('submit',async e=>{
 const form=e.target;if(!['loginForm','registerForm','requiredPasswordForm','profilePasswordForm'].includes(form.id))return;e.preventDefault();if(authBusy)return;authBusy=true;lockForm(form,true);const values=Object.fromEntries(new FormData(form));const messageTarget=form.id==='profilePasswordForm'?'profileMessage':'authMessage';authMessage('',false,messageTarget);
 try{if(form.id==='loginForm'){const data=await accountAPI('/api/login',{method:'POST',body:{email:values.email.trim(),password:values.password}});await enterAccount(data.user);}else if(form.id==='registerForm'){if(values.password!==values.confirmPassword)throw new Error('비밀번호 확인이 일치하지 않아요.');delete values.confirmPassword;const data=await accountAPI('/api/register',{method:'POST',body:values});await enterAccount(data.user);}else{if(values.newPassword!==values.confirmPassword)throw new Error('새 비밀번호 확인이 일치하지 않아요.');const data=await accountAPI('/api/change-password',{method:'POST',body:{currentPassword:values.currentPassword,newPassword:values.newPassword}});if(form.id==='requiredPasswordForm')await enterAccount(data.user);else{handleAccountChange(data.user||account);form.reset();authMessage('비밀번호를 변경했어요.',true,messageTarget);}}}catch(error){authMessage(error.message,false,messageTarget);}finally{authBusy=false;lockForm(form,false);drainPendingAccountChange();}
});
window.addEventListener('online',()=>{if(account&&progressDirty)flushProgress().catch(()=>{});});
async function bootstrapAccount(){
 authEl('authLogo').src=document.querySelector('.brand-logo').src;
 if(location.protocol==='file:'){authEl('authCard').innerHTML='<h2>온라인으로 접속해 주세요</h2><p class="auth-description">회원가입과 로그인은 남달라 홈페이지 주소에서 이용할 수 있어요.</p><a class="btn btn-primary" href="https://hyuncchul.github.io/ipqc-app/namdalra.html">남달라 홈페이지 열기</a>';return;}
 authEl('authCard').innerHTML='<p class="auth-loading">🌱 접속을 확인하고 있어요.</p>';
 try{const data=await accountAPI('/api/session');csrfToken=data.csrfToken;if(data.user)await enterAccount(data.user);else renderAuth('login');}catch(e){authEl('authCard').innerHTML=`<h2>연결을 확인해 주세요</h2><p class="auth-description">서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.</p><button class="btn btn-primary wide" data-auth="retry-connect">다시 연결하기</button>`;}
}

function handleAccountChange(user){
 if(!account)return;
 // Revocation and sign-out cannot wait for an in-flight password/login request.
 if(!user||user.id!==account.id){showSignedOut('접속 상태가 변경되었어요. 다시 로그인해 주세요.');return;}
 pendingAccountChange={user,epoch:authEpoch};
 if(!authBusy)drainPendingAccountChange();
}
function drainPendingAccountChange(){
 if(authBusy||!pendingAccountChange)return;
 const pending=pendingAccountChange;pendingAccountChange=null;
 if(!account||pending.epoch!==authEpoch||pending.user.id!==account.id)return;
 void applyAccountProfile(pending.user,pending.epoch);
}
async function applyAccountProfile(user,expectedEpoch){
 if(!account||expectedEpoch!==authEpoch||user.id!==account.id)return;
 if(user.grade!==account.grade||user.role!==account.role){
  clearTimeout(progressTimer);progressDirty=false;
  const refresh=enterAccount(user),refreshEpoch=authEpoch;
  try{await refresh;}catch{
   // A failed older refresh must not sign out a newer login or profile refresh.
   if(refreshEpoch===authEpoch&&account?.id===user.id)showSignedOut('회원 정보가 변경되었어요. 다시 로그인해 주세요.');
  }
 }else{account=user;renderMemberStrip();}
}
window.addEventListener('namdalra-account-changed',event=>handleAccountChange(event.detail?.user));
