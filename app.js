// ================= Retro Diary – app.js =================

// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const byId = s => document.getElementById(s);

const editor   = byId('editor');
const dateLine = byId('dateLine');

const state = { key: null, currentId: null };

function setStatus(msg){ const el = byId('status'); if(el) el.textContent = msg || ''; }
function showLock(){ byId('lockscreen')?.classList.add('lock'); }
function hideLock(){ byId('lockscreen')?.classList.remove('lock'); }

// Uint8Array <-> hex
function buf2hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hex2u8(hex){ const a=new Uint8Array(hex.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a; }

// ---------- IndexedDB ----------
let db;
function idb(){
  if(db) return Promise.resolve(db);
  return new Promise((res,rej)=>{
    const r = indexedDB.open('retro-diary',1);
    r.onupgradeneeded = e=>{
      const d = e.target.result;
      d.createObjectStore('entries',{keyPath:'id'});
      d.createObjectStore('meta',{keyPath:'k'});
    };
    r.onsuccess = e=>{ db=e.target.result; res(db); };
    r.onerror   = ()=>rej(r.error);
  });
}
async function dbPut(store, obj){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx = d.transaction(store,'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete=()=>res();
    tx.onerror  =()=>rej(tx.error);
  });
}
async function dbGet(store,key){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx = d.transaction(store);
    const r  = tx.objectStore(store).get(key);
    r.onsuccess=()=>res(r.result||null);
    r.onerror  =()=>rej(r.error);
  });
}
async function dbAll(store){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx = d.transaction(store);
    const r  = tx.objectStore(store).getAll();
    r.onsuccess=()=>res(r.result||[]);
    r.onerror  =()=>rej(r.error);
  });
}
async function dbDel(store,key){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx = d.transaction(store,'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete=()=>res();
    tx.onerror  =()=>rej(tx.error);
  });
}
async function dbClearAll(){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx = d.transaction(['entries','meta'],'readwrite');
    tx.objectStore('entries').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete=()=>res();
    tx.onerror  =()=>rej(tx.error);
  });
}

// ---------- Crypto ----------
async function deriveKey(pass, saltHex){
  const enc  = new TextEncoder();
  const salt = hex2u8(saltHex);
  const mat  = await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:200000, hash:'SHA-256'},
    mat,
    {name:'AES-GCM', length:256},
    false,
    ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct   = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv: buf2hex(iv), ct: buf2hex(ct) };
}
async function decObj(key, wrap){
  const iv = hex2u8(wrap.iv);
  const ct = hex2u8(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---------- Wrap/Meta (med localStorage-fallback) ----------
async function setWrapMeta(obj){
  try { await dbPut('meta', obj); }
  catch { localStorage.setItem('wrap', JSON.stringify(obj)); }
}
async function getWrapMeta(){
  try { const m = await dbGet('meta','wrap'); if(m) return m; } catch {}
  const raw = localStorage.getItem('wrap');
  return raw ? JSON.parse(raw) : null;
}
async function clearWrapMeta(){
  try{ await dbClearAll(); }catch{}
  localStorage.removeItem('wrap');
}

// ---------- Lås / lås upp ----------
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }

    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});

    await setWrapMeta({ k:'wrap', salt, test });
    state.key = key;

    setStatus('Lösen satt ✔');
    hideLock();
    await renderList();
  }catch(e){
    setStatus('Kunde inte sätta lösen.');
    console.error(e);
  }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }

    const meta = await getWrapMeta();
    if(!meta){ setStatus('Inget lösen valt ännu. Välj “Sätt nytt lösen”.'); return; }

    const key = await deriveKey(pass, meta.salt);
    await decObj(key, meta.test); // verifiera

    state.key = key;
    setStatus('');
    hideLock();
    await renderList();
  }catch(e){
    setStatus('Fel lösenord.');
    console.error('unlock error:', e);
  }
}

function lock(){
  state.key = null; state.currentId = null;
  editor.innerHTML=''; dateLine.textContent='';
  showLock(); setStatus('');
  setTimeout(()=>byId('pass')?.focus(), 30);
}

// ---------- Poster ----------
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  return (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
}

async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id   = state.currentId || Date.now();
  const obj  = { id, html: editor.innerHTML, date: new Date().toLocaleString(), title: titleFrom(editor.innerHTML) };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated: Date.now() });
  state.currentId = id;
  await renderList();
}

async function renderList(){
  const list = byId('entriesList'); // <— matchar index.html
  if(!list) return;
  list.innerHTML = '';
  const all = (await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li = document.createElement('li');
    li.textContent = new Date(e.updated||e.id).toLocaleString();
    li.addEventListener('click', async ()=>{
      const dec = await decObj(state.key, e.wrap);
      state.currentId    = dec.id;
      editor.innerHTML   = dec.html;
      dateLine.textContent = dec.date;
      editor.focus();
    });
    list.appendChild(li);
  }
}

async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList();
}

// ---------- Export / import / wipe ----------
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta, entries})], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt  = await file.text();
  const data = JSON.parse(txt);
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.');
  await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll();
  localStorage.removeItem('wrap');
  state.key=null; state.currentId=null;
  editor.innerHTML=''; dateLine.textContent='';
  await renderList();
  showLock(); setStatus('Allt rensat.');
}

// ---------- Meny & toolbar ----------
function toggleMenu(){
  const m = byId('menu'); if(!m) return;
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
function execCmd(cmd,val=null){ document.execCommand(cmd,false,val); }

// ---------- Service worker force update ----------
byId('forceUpdateBtn')?.addEventListener('click', async ()=>{
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const names = await caches.keys();
      await Promise.all(names.map(n=>caches.delete(n)));
    }
    alert('Appen uppdateras – laddar om…');
    location.reload(true);
  }catch(e){
    alert('Kunde inte uppdatera: ' + (e?.message||e));
  }
});

// ---------- Wire up ----------
window.addEventListener('load', ()=>{
  const passEl = byId('pass');

  // Låsskärm
  byId('setPassBtn')    ?.addEventListener('click', ()=>setInitialPass(passEl.value));
  byId('unlockBtn')     ?.addEventListener('click', ()=>unlock(passEl.value));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // CRUD
  byId('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus(); });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  // Toolbar
  byId('boldBtn')     ?.addEventListener('click', ()=>execCmd('bold'));
  byId('italicBtn')   ?.addEventListener('click', ()=>execCmd('italic'));
  byId('underlineBtn')?.addEventListener('click', ()=>execCmd('underline'));
  byId('colorBtn')    ?.addEventListener('input', e=>execCmd('foreColor', e.target.value));

  // Meny & import/export
  byId('menuToggle')?.addEventListener('click', toggleMenu);
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Fontval (bara editor)
  const fontSel = byId('fontSelect');
  if(fontSel){
    const saved = localStorage.getItem('rd_font');
    if(saved){ editor.style.fontFamily = saved; fontSel.value = saved; }
    fontSel.addEventListener('change', e=>{
      editor.style.fontFamily = e.target.value;
      localStorage.setItem('rd_font', e.target.value);
    });
  }

  // Start
  showLock();
  console.log('✅ app.js init');
});
