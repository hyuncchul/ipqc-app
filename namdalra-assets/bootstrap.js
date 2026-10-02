import {firebaseConfig} from './firebase-config.js';
const card=document.getElementById('authCard');
document.getElementById('authLogo').src=document.querySelector('.brand-logo').src;
function notice(title,message){card.replaceChildren();const heading=document.createElement('h2'),description=document.createElement('p');heading.textContent=title;description.className='auth-description';description.textContent=message;card.append(heading,description);}
if(!firebaseConfig.apiKey||!firebaseConfig.projectId||!firebaseConfig.authDomain||!firebaseConfig.appId){
 notice('남달라 영어 교실을 준비하고 있어요','회원 서비스를 연결하는 중이에요. 담당 선생님의 안내를 기다려 주세요.');
}else{
 try{
  const {createFirebaseAdapter}=await import('./firebase-adapter.js');
  window.NamdalraCloud=createFirebaseAdapter(firebaseConfig);
  for(const name of ['auth.js','admin.js','app.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(name,import.meta.url);script.onload=resolve;script.onerror=reject;document.body.appendChild(script);});
 }catch{notice('연결을 확인해 주세요','회원 서비스에 연결하지 못했어요. 인터넷 연결을 확인하고 페이지를 새로고침해 주세요.');}
}
