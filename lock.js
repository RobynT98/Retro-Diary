// lock.js
import { idbReady, setCurrentUser, restoreLastUser, User,
         dbPutMeta, dbGetMeta, dbClearUser } from './storage.js';
import { deriveKey, encObj, decObj } from './crypto.js';

export const App = { key:null };

const $ = id => document.getElementById(id);
function setStatus(t){ const el=$('status'); if(el) el.textContent=t||''; }
export function showLock(){ document.body.classList.add('locked'); $('lockscreen')?.setAttribute('aria-hidden','false'); }
export function hideLock(){ document.body.classList.remove('locked'); $('lockscreen')?.setAttribute('aria-hidden','true'); }

async function getWrap(){ return await dbGetMeta('wrap'); }
async function setWrap(obj){ await dbPutMeta('wrap', obj); }

// 👉 NYTT: bind knapparna lokalt här
function wireLockUI(){
  $('setPassBtn')?.addEventListener('click', ()=>setInitialPass($('userInput').value, $('passInput').value));
  $('unlockBtn') ?.addEventListener('click', ()=>unlock($('userInput').value, $('passInput').value));
  $('wipeLocalOnLock')?.addEventListener('click', wipeCurrentUser);
}

export async function initLock(){
  await idbReady();
  restoreLastUser();
  const u = $('userInput'); if(u) u.value = User.name;
  showLock();
  wireLockUI();                             // 👈 bind här
  setTimeout(()=>$('passInput')?.focus(), 60);
}

export async function setInitialPass(userName, pass){
  const name=(userName||'').trim(), p=(pass||'').trim();
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
  const name=(userName||'').trim(), p=(pass||'').trim();
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
  }catch{ setStatus('Fel lösenord för användaren.'); }
}

export async function wipeCurrentUser(){
  if(!confirm(`Rensa ALL lokal data för “${User.name}”?`)) return;
  await dbClearUser();
  setStatus('Allt rensat för användaren.');
  App.key = null;
  showLock();
}    if (hasMetaAPI) return await dbPutMeta('wrap', obj);
    if (typeof dbPut === 'function')  return await dbPut('meta', { id:'wrap', ...obj });
  }catch(e){ log('setWrap fail (IDB path):', e); }
  // fallback localStorage
  localStorage.setItem(`rd:user:${User?.name||'default'}:wrap`, JSON.stringify(obj));
}

// ---- Init ----
export async function initLock(){
  await idbReady().catch(()=>{});
  try { restoreLastUser(); } catch {}
  if ($('userInput')) $('userInput').value = User?.name || '';
  showLock();
  setTimeout(()=>$('passInput')?.focus(), 60);
  log('initLock done. user =', User?.name);
}

// ---- Actions ----
export async function setInitialPass(userName, pass){
  try{
    const name = (userName||'').trim();
    const p    = (pass||'').trim();
    if(!name){ setStatus('Skriv ett användarnamn.'); return; }
    if(!p){    setStatus('Skriv ett lösenord.');     return; }

    setCurrentUser(name);
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const key  = await deriveKey(p, salt);
    const test = await encObj(key, { ok:true, user:name });

    await setWrap({ salt, test });
    App.key = key;

    setStatus('Lösen satt ✔');
    hideLock();
    log('setInitialPass OK for', name);
  }catch(err){
    log('setInitialPass ERROR', err);
    setStatus('Kunde inte sätta lösen (se konsolen).');
    alert('Kunde inte sätta lösen. Öppna konsolen för detaljer.');
  }
}

export async function unlock(userName, pass){
  try{
    const name = (userName||'').trim();
    const p    = (pass||'').trim();
    if(!name){ setStatus('Skriv ditt användarnamn.'); return; }
    if(!p){    setStatus('Skriv ditt lösenord.');     return; }

    setCurrentUser(name);
    const wrap = await getWrap();
    if(!wrap || !wrap.salt || !wrap.test){
      setStatus('Ingen profil hittad. Välj “Sätt nytt lösen”.');
      log('unlock: no profile for', name, 'wrap=', wrap);
      return;
    }

    const key   = await deriveKey(p, wrap.salt);
    const probe = await decObj(key, wrap.test);
    if(!probe || probe.ok !== true){
      setStatus('Fel lösenord för användaren.');
      log('unlock: probe failed', {probe});
      return;
    }

    App.key = key;
    setStatus('');
    hideLock();
    log('unlock OK for', name);
  }catch(err){
    log('unlock ERROR', err);
    setStatus('Kunde inte låsa upp (se konsolen).');
    alert('Kunde inte låsa upp. Öppna konsolen för detaljer.');
  }
}

export async function wipeCurrentUser(){
  try{
    if(!confirm(`Rensa ALL lokal data för “${User?.name||''}”?`)) return;
    if (typeof dbClearUser === 'function') await dbClearUser();
    // rensa även fallback
    localStorage.removeItem(`rd:user:${User?.name||'default'}:wrap`);
    App.key = null;
    setStatus('Allt rensat för användaren.');
    showLock();
    log('wipe done');
  }catch(e){
    log('wipe ERROR', e);
    alert('Kunde inte rensa lokala data.');
  }
}
