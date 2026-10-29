 'use strict';
const cfg=window.ASTERIUM_CONFIG;const sessionKey='asterium-cloud-session';let session=null;
let refreshTask=null;
function readSession(){try{return JSON.parse(localStorage.getItem(sessionKey)||'null');}catch{return null;}}
function saveSession(value){session=value;localStorage.setItem(sessionKey,JSON.stringify(value));}
session=readSession();
const msg=t=>document.querySelector('#login-msg').textContent=t;
function loginVisible(visible){document.querySelector('#login-form').hidden=!visible;}
async function rawRequest(path,options={}){
 const h={apikey:cfg.key,...options.headers};
 if(session?.access_token&&!path.startsWith('/auth/v1/token')&&!path.startsWith('/auth/v1/verify'))h.Authorization='Bearer '+session.access_token;
 const r=await fetch(cfg.url+path,{cache:'no-store',...options,headers:h});const d=await r.json().catch(()=>({}));
 if(!r.ok){const error=new Error(d.msg||d.message||d.error_description||d.error||'Não foi possível concluir ('+r.status+').');error.status=r.status;error.authExpired=path.includes('grant_type=refresh_token')&&(r.status===400||r.status===401);throw error;}return d;
}
async function keepSession(force=false,rejectedToken=null){
 if(refreshTask)return refreshTask;
 const refresh=async()=>{
  session=readSession()||session;
  if(!session?.refresh_token){const error=new Error('Entre para continuar.');error.authExpired=true;throw error;}
  if((!force||session.access_token!==rejectedToken)&&(session.expires_at||0)>Date.now()/1000+120)return;
  const updated=await rawRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
  updated.expires_at=updated.expires_at||Date.now()/1000+updated.expires_in;saveSession(updated);
 };
 refreshTask=(navigator.locks?navigator.locks.request('asterium-session-refresh',refresh):refresh());
 try{await refreshTask;}finally{refreshTask=null;}
}
async function request(path,options={}){
 const usedToken=session?.access_token;
 try{return await rawRequest(path,options);}catch(error){
  if(error.status!==401||path.startsWith('/auth/v1/token')||path.startsWith('/auth/v1/verify')||path.startsWith('/auth/v1/logout')||!session?.refresh_token)throw error;
  await keepSession(true,usedToken);return rawRequest(path,options);
 }
}
function restoreFailed(error){
 if(error.authExpired){localStorage.removeItem(sessionKey);session=null;if(!document.querySelector('#review-app').hidden){location.reload();return;}loginVisible(true);msg('Sua sessão expirou. Entre novamente para continuar.');}
 else{loginVisible(false);msg('Não foi possível abrir a revisão agora. Seu login foi mantido. '+error.message);const retry=document.querySelector('#retry-session');if(retry)retry.hidden=false;}
}
window.addEventListener('storage',event=>{if(event.key!==sessionKey)return;session=readSession();if(!session)location.reload();});
window.addEventListener('focus',()=>{if(session)keepSession().catch(restoreFailed);});
setInterval(()=>{if(session&&document.visibilityState==='visible')keepSession().catch(restoreFailed);},60000);
window.asteriumDecisionApi=async(method,data)=>{await keepSession();if(method==='GET'){const rows=await request('/rest/v1/asterium_decisions?select=*');return {itens:Object.fromEntries(rows.map(x=>[x.id,x]))};}const row={id:data.id,sha256:data.sha256,status:data.status,comentario:data.comentario,atualizado_em:new Date().toISOString()};const d=await request('/rest/v1/asterium_decisions?on_conflict=id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)});return {salvo:true,avaliacao:d[0]};};
async function openReview(){msg('Carregando seus vídeos…');await keepSession();const user=await request('/auth/v1/user');const allowed=await request('/rest/v1/asterium_reviewers?select=email');if(!allowed.length)throw new Error('Seu e-mail ainda não está autorizado para esta revisão.');const data=await request('/storage/v1/object/authenticated/'+cfg.bucket+'/data/catalogo.json');const paths=[...new Set([...data.videos.flatMap(v=>[v.src,v.poster]),...data.groups.map(g=>g.cover)])];const urls={};for(let i=0;i<paths.length;i+=100){const signs=await request('/storage/v1/object/sign/'+cfg.bucket,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:paths.slice(i,i+100),expiresIn:21600})});for(const s of signs){const val=s.signedURL||s.signedUrl;if(s.error||!val)throw new Error('Falha ao abrir mídia privada.');urls[s.path]=val.startsWith('http')?val:cfg.url+'/storage/v1'+val;}}
for(const v of data.videos){v.src=urls[v.src];v.poster=urls[v.poster];}for(const g of data.groups)g.cover=urls[g.cover];data.api={url:'',token:''};data.decisions=(await window.asteriumDecisionApi('GET')).itens;document.querySelector('#asterium-data').textContent=JSON.stringify(data);document.querySelector('#login').hidden=true;document.querySelector('#review-app').hidden=false;document.querySelector('#logout').onclick=async()=>{await request('/auth/v1/logout?scope=local',{method:'POST'}).catch(()=>{});localStorage.removeItem(sessionKey);location.reload();};const s=document.createElement('script');s.src='revisao.js';document.body.append(s);}
document.querySelector('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{session=null;session=await request('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value.trim(),password:document.querySelector('#password').value})});session.expires_at=session.expires_at||Date.now()/1000+session.expires_in;saveSession(session);document.querySelector('#password').value='';await openReview();}catch(err){msg(err.message);}finally{b.disabled=false;}};
document.querySelector('#code-form').onsubmit=async e=>{e.preventDefault();try{session=await request('/auth/v1/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value.trim(),token:document.querySelector('#code').value.trim(),type:'email'})});session.expires_at=session.expires_at||Date.now()/1000+session.expires_in;saveSession(session);await openReview();}catch(err){msg(err.message);}};
const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('access_token')){session={access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_at:Date.now()/1000+Number(hash.get('expires_in')||3600)};localStorage.setItem(sessionKey,JSON.stringify(session));history.replaceState(null,'',location.pathname+'#home');}
const retryButton=document.querySelector('#retry-session');if(retryButton)retryButton.onclick=()=>{retryButton.hidden=true;openReview().catch(restoreFailed);};
if(session){loginVisible(false);msg('Recuperando seu acesso…');openReview().catch(restoreFailed);}
