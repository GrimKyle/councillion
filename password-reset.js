/* Owner password recovery. Recovery tokens stay in memory, never in site storage. */
(function(root){
 'use strict';
 function recovery(hash){const p=new URLSearchParams(String(hash||'').replace(/^#/,''));return {token:p.get('type')==='recovery'?p.get('access_token'):null,error:p.get('error_description')||p.get('error')||''};}
 function createClient(config,fetcher){
  const url=new URL(config?.url||'');
  if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('The website needs a valid Supabase project URL.');
  const key=String(config?.key||'');let publicKey=key.startsWith('sb_publishable_');
  if(!publicKey){try{publicKey=JSON.parse(root.atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch(_){}}
  if(!publicKey)throw Error('The website needs its public Supabase key.');
  async function request(path,method,body,token){const response=await fetcher(url.origin+'/auth/v1/'+path,{method,headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json().catch(()=>({}));if(!response.ok)throw Error(value.msg||value.message||value.error_description||'The request failed. Request a fresh recovery email and try again.');return value;}
  return {
   send(email,redirect){const target=new URL(redirect);if(target.protocol!=='https:'||target.hash||target.username||target.password)throw Error('Use the hosted HTTPS recovery page.');return request('recover?redirect_to='+encodeURIComponent(target.href),'POST',{email});},
   verify(token){if(!token)throw Error('Request a fresh recovery email first.');return request('user','GET',null,token);},
   update(token,password,confirmation){if(!token)throw Error('Request a fresh recovery email first.');if(password.length<8)throw Error('Use at least 8 characters.');if(password!==confirmation)throw Error('The passwords do not match.');return request('user','PUT',{password},token);}
  };
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={recovery,createClient};
 if(!root.document)return;
 const status=root.document.getElementById('reset-status'),emailForm=root.document.getElementById('reset-email-form'),passwordForm=root.document.getElementById('reset-password-form');
 const state=recovery(root.location.hash);let token=state.token,client;
 root.history.replaceState(null,'',root.location.pathname+root.location.search);
 function message(value,error=false){status.textContent=value;status.classList.toggle('error-message',error);}
 try{client=createClient(root.COUNCIL_CONFIG,root.fetch.bind(root));}catch(error){message(error.message,true);emailForm.hidden=true;return;}
 async function action(form,task){const button=form.querySelector('button');button.disabled=true;try{await task();}catch(error){message(error.message,true);}finally{button.disabled=false;}}
 emailForm.addEventListener('submit',event=>{event.preventDefault();action(emailForm,async()=>{await client.send(emailForm.elements.email.value.trim(),new URL('reset-password.html',root.location.href).href);message('If that account exists, a new reset link is on its way. Open the newest email.');});});
 passwordForm.addEventListener('submit',event=>{event.preventDefault();action(passwordForm,async()=>{await client.update(token,passwordForm.elements.password.value,passwordForm.elements.confirmation.value);token=null;passwordForm.reset();passwordForm.hidden=true;try{root.localStorage.removeItem('councillion.admin.session.v1');}catch(_){}message('Password updated. Return to Councillion, open Game Master, and sign in with your new password.');});});
 if(state.error){message('The link could not be used. Request a fresh recovery email below.',true);return;}
 if(token){emailForm.hidden=true;message('Checking your recovery link…');client.verify(token).then(()=>{passwordForm.hidden=false;message('Choose a new password for your account.');}).catch(()=>{token=null;emailForm.hidden=false;message('This link is expired or invalid. Request a fresh recovery email below.',true);});}
})(typeof window!=='undefined'?window:globalThis);
