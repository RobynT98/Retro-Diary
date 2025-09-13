// lock.js — multi-user aware lock/unlock
import { idbReady, setCurrentUser, restoreLastUser, User,
         dbPutMeta, dbGetMeta, dbClearUser } from './storage.js';
import { deriveKey, encObj, decObj } from './crypto.js';

export const App = { key:null };

function qs(id){ return document.getElementById(id); }
function setStatus(t){ const el=qs('status'); if(el) el.textContent=t||''; }
export function showLock(){ document.body.classList.add('locked'); qs('lockscreen')?.setAttribute('aria-hidden','false'); }
export function hideLock(){ document.body.classList.remove('locked'); qs('lockscreen')?.setAttribute('aria-hidden','true'); }

async function getWrap(){
  return await dbGetMeta('wrap'); // {salt, test}
}
async function setWrap(obj){
  await dbPutMeta('wrap', obj);
}

// init (restore last user so låsskärm visar namnet)
export async function initLock(){
  await idbReady();
  restoreLastUser();
  const u = qs('userInput'); if(u) u.value = User.name;
  showLock();
  setTimeout(()=>qs('passInput')?.focus(), 60);
}

export async function setInitialPass(userName, pass){
  const name = (userName||'').trim();
  const p    = (pass||'').trim();
  if(!name){ setStatus('Skriv ett användarnamn.'); return; }
  if(!p){ setStatus('Skriv ett lösenord.'); return; }

  setCurrentUser(name);

  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const key  = await deriveKey(p, salt);
  const test = await encObj(key, {ok:true});
  await setWrap({salt, test});

  App.key = key;
  setStatus('Lösen satt ✔'); hideLock();
}

export async function unlock(userName, pass){
  const name = (userName||'').trim();
  const p    = (pass||'').trim();
  if(!name){ setStatus('Skriv ditt användarnamn.'); return; }
  if(!p){ setStatus('Skriv ditt lösenord.'); return; }

  setCurrentUser(name);
  const wrap = await getWrap();
  if(!wrap || !wrap.salt || !wrap.test){ setStatus('Ingen profil hittad. Välj “Sätt nytt lösen”.'); return; }

  try{
    const key = await deriveKey(p, wrap.salt);
    const probe = await decObj(key, wrap.test);
    if(!probe || probe.ok!==true) throw new Error('fel test');
    App.key = key;
    setStatus(''); hideLock();
  }catch{
    setStatus('Fel lösenord för användaren.');
  }
}

export async function wipeCurrentUser(){
  if(!confirm(`Rensa ALL lokal data för “${User.name}”?`)) return;
  await dbClearUser();
  setStatus('Allt rensat för användaren.');
  App.key = null;
  showLock();
}
