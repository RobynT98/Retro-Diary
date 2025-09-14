// lock.js — minimal & stabil
import {
  idbReady, setCurrentUser, restoreLastUser, User,
  dbPutMeta, dbGetMeta, dbClearUser
} from './storage.js';
import { deriveKey, encObj, decObj } from './crypto.js';

export const App = { key: null };
const $ = id => document.getElementById(id);

/* ---------- UI helpers ---------- */
function setStatus(t){
  const el = $('status');
  if (el) el.textContent = t || '';
}
export function showLock(){
  document.body.classList.add('locked');
  const lockscreen = $('lockscreen');
  if (lockscreen) {
    lockscreen.setAttribute('aria-hidden','false');
    lockscreen.style.display = 'flex';
    lockscreen.style.pointerEvents = 'auto';
  }
}
export function hideLock(){
  document.body.classList.remove('locked');
  const lockscreen = $('lockscreen');
  if (lockscreen) {
    lockscreen.setAttribute('aria-hidden','true');
    lockscreen.style.display = 'none';
    lockscreen.style.pointerEvents = 'none';
  }
}

/* ---------- Meta wrap (per user) ---------- */
async function getWrap(){ return await dbGetMeta('wrap'); }
async function setWrap(obj){ await dbPutMeta('wrap', obj); }

/* ---------- Init: körs vid start ---------- */
export async function initLock(){
  await idbReady().catch(()=>{});
  try { restoreLastUser(); } catch {}

  // Förifyll användarnamn på låsskärmen
  const u = $('userInput');
  if (u) u.value = User?.name || '';

  // Visa låsskärmen
  showLock();
  setStatus('🔓 Skriv användarnamn och lösenord.');

  // 🔁 BACKUP-BINDNINGAR (säkerställer att knapparna fungerar överallt)
  $('setPassBtn')?.addEventListener('click', () => {
    setStatus('⏳ Sätter nytt lösen …');
    setInitialPass($('userInput').value, $('passInput').value);
  });
  $('unlockBtn')?.addEventListener('click', () => {
    setStatus('⏳ Låser upp …');
    unlock($('userInput').value, $('passInput').value);
  });
  $('wipeLocalOnLock')?.addEventListener('click', () => {
    setStatus('⏳ Rensar lokal data …');
    wipeCurrentUser();
  });

  // Enter i lösenordsfältet → försök låsa upp
  $('passInput')?.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') {
      e.preventDefault();
      unlock($('userInput').value, $('passInput').value);
    }
  });

  // Fokus på lösenordsfältet
  setTimeout(() => $('passInput')?.focus(), 60);
}

/* ---------- Actions ---------- */
export async function setInitialPass(userName, pass){
  const name = (userName||'').trim();
  const p    = (pass||'').trim();
  if(!name){ setStatus('Skriv ett användarnamn.'); return; }
  if(!p){    setStatus('Skriv ett lösenord.');     return; }

  setCurrentUser(name);

  // Skapa salt + nyckel
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b=>b.toString(16).padStart(2,'0')).join('');
  const key  = await deriveKey(p, salt);

  // Test-wrap för att verifiera lösenord senare
  const test = await encObj(key, { ok:true, user:name });
  await setWrap({ salt, test });

  App.key = key;
  setStatus('Lösen satt ✔');
  hideLock();
}

export async function unlock(userName, pass){
  const name = (userName||'').trim();
  const p    = (pass||'').trim();
  if(!name){ setStatus('Skriv ditt användarnamn.'); return; }
  if(!p){    setStatus('Skriv ditt lösenord.');     return; }

  setCurrentUser(name);
  const wrap = await getWrap();
  if(!wrap || !wrap.salt || !wrap.test){
    setStatus('Ingen profil hittad. Välj “Sätt nytt lösen”.');
    return;
  }

  try{
    const key   = await deriveKey(p, wrap.salt);
    const probe = await decObj(key, wrap.test);
    if(!probe || probe.ok !== true) throw new Error('probe fail');

    App.key = key;
    setStatus('');
    hideLock();
  }catch{
    setStatus('Fel lösenord för användaren.');
  }
}

export async function wipeCurrentUser(){
  if(!confirm(`Rensa ALL lokal data för “${User?.name||''}”?`)) return;
  await dbClearUser();
  App.key = null;
  setStatus('Allt rensat för användaren.');
  showLock();
}

/* ---------- Exponera globalt för inline onclick (mobilvänligt) ---------- */
if (typeof window !== 'undefined') {
  window.Lock = { initLock, setInitialPass, unlock, wipeCurrentUser, showLock, hideLock, App };
}
