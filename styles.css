// ===== Markör: app.js laddad =====
window.__APP_WIRED__ = false;

// ===== Hjälpare =====
const $ = (id)=>document.getElementById(id);
const state = { key:null, currentId:null };

function setStatus(t){ const el=$('status'); if(el) el.textContent=t||''; }
function passEl(){ return $('passInput'); }
function showLock(){ $('lockscreen').style.display='flex'; }
function hideLock(){ $('lockscreen').style.display='none'; }
function toggleMenu(){
  const m=$('menu');
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
function execCmd(cmd,val){ document.execCommand(cmd,false,val||null); }

// ===== IndexedDB (med LocalStorage-fallback) =====
const DB_NAME='retro-diary', DB_VER=1;
let idb=null;

function idbReady(){
  return new Promise((res,rej)=>{
    if(!('indexedDB' in window)) return res(null);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains('meta'))    db.createObjectStore('meta',{keyPath:'k'});
      if(!db.objectStoreNames.contains('entries')) db.createObjectStore('entries',{keyPath:'id'});
    };
    req.onsuccess = ()=>{ idb=req.result; res(idb); };
    req.onerror   = ()=>res(null);
  });
}
async function dbPut(store, obj){
  if(idb){ return new Promise((res,rej)=>{
    const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).put(obj);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });}
  // Fallback
  const k = store==='meta' ? obj.k : obj.id;
  localStorage.setItem(store+':'+k, JSON.stringify(obj));
}
async function dbGet(store, key){
  if(idb){ return new Promise((res,rej)=>{
    const tx=idb.transaction(store,'readonly'); const r=tx.objectStore(store).get(key);
    r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error);
  });}
  const raw=localStorage.getItem(store+':'+key); return raw?JSON.parse(raw):null;
}
async function dbAll(store){
  if(idb){ return new Promise((res,rej)=>{
    const tx=idb.transaction(store,'readonly'); const req=tx.objectStore(store).getAll();
    req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error);
  });}
  const out=[];
  for(const k in localStorage){
    if(k && k.startsWith(store+':')){
      try{ out.push(JSON.parse(localStorage.getItem(k))); }catch{}
    }
  }
  return out;
}
async function dbDel(store, key){
  if(idb){ return new Promise((res,rej)=>{
    const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).delete(key);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });}
  localStorage.removeItem(store+':'+key);
}
async function dbClearAll(){
  if(idb){ return new Promise((res,rej)=>{
    const tx=idb.transaction(['meta','entries'],'readwrite');
    tx.objectStore('meta').clear(); tx.objectStore('entries').clear();
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });}
  Object.keys(localStorage).forEach(k=>{
    if(k.startsWith('meta:')||k.startsWith('entries:')||k==='wrap') localStorage.removeItem(k);
  });
}

// ===== Kryptering (PBKDF2 + AES-GCM) =====
const textEncoder = new TextEncoder(), textDecoder = new TextDecoder();
const hex = (buf)=>Array.from(buf).map(b=>b.toString(16).padStart(2,'0')).join('');
const dehex = (s)=>Uint8Array.from(s.match(/.{1,2}/g).map(h=>parseInt(h,16)));

async function deriveKey(pass, saltHex){
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: dehex(saltHex), iterations:120000, hash:'SHA-256'},
    baseKey, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
  return key;
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = textEncoder.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data));
  return { iv: hex(iv), ct: hex(ct) };
}
async function decObj(key, wrap){
  const iv = dehex(wrap.iv), ct = dehex(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(textDecoder.decode(new Uint8Array(pt)));
}

// ---- Wrap-meta ----
async function setWrapMeta(w){ await dbPut('meta', {k:'wrap', salt:w.salt, test:w.test}); localStorage.setItem('wrap', JSON.stringify(w)); }
async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw ? JSON.parse(raw) : null;
}
function normalizeWrap(m){
  if(!m) return null;
  if(m.k!=='wrap'){ m={k:'wrap', salt:m.salt, test:m.test}; }
  return m;
}
function validateWrap(m){
  if(!m) return 'saknas';
  if(!m.salt || !m.test || !m.test.iv || !m.test.ct) return 'ofullständig';
  if(typeof m.salt!=='string') return 'salt typ';
  return null;
}

// ===== UI-funktioner =====
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t=(tmp.textContent||'').trim().split(/\n/)[0].slice(0,80);
  return t || 'Anteckning';
}

async function renderList(){
  const list=$('entries'); if(!list) return;
  list.innerHTML='';
  const all=(await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent=new Date(e.updated||e.id).toLocaleString();
    li.onclick=async ()=>{
      const dec=await decObj(state.key, e.wrap);
      state.currentId=dec.id;
      $('editor').innerHTML=dec.html;
      $('dateLine').textContent=dec.date;
      $('editor').focus();
    };
    list.appendChild(li);
  }
}

async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id=state.currentId || Date.now();
  const obj={ id, html:$('editor').innerHTML, date:new Date().toLocaleString(), title:titleFrom($('editor').innerHTML) };
  const wrap=await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId=id;
  await renderList();
}

async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; $('editor').innerHTML=''; $('dateLine').textContent='';
  await renderList();
}

function lock(){
  state.key=null; state.currentId=null;
  $('editor').innerHTML=''; $('dateLine').textContent='';
  showLock(); setStatus('');
  setTimeout(()=>passEl()?.focus(), 60);
}

async function exportAll(){
  const entries=await dbAll('entries');
  const meta=await getWrapMeta();
  const blob=new Blob([JSON.stringify({meta,entries})],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt=await file.text(); const data=JSON.parse(txt);
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll(); state.key=null; state.currentId=null; $('editor').innerHTML=''; $('dateLine').textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

// ===== Lösen/nyckel =====
async function setInitialPass(passRaw){
  try{
    const pass=String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b=>b.toString(16).padStart(2,'0')).join('');
    const key  = await deriveKey(pass, saltHex);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({ k:'wrap', salt:saltHex, test });
    state.key=key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); alert('Fel setInitialPass: '+(e?.message||e)); }
}

async function unlock(passRaw){
  try{
    const pass=String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    let meta=await getWrapMeta(); meta=normalizeWrap(meta);
    const vErr=validateWrap(meta);
    if(vErr){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    setStatus('Kontrollerar…');
    const key=await deriveKey(pass, meta.salt);
    const probe=await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');
    state.key=key; setStatus(''); hideLock(); await renderList();
  }catch(e){
    const msg=(e&&e.message)?e.message:String(e);
    setStatus('Upplåsning misslyckades: '+msg);
    console.error('unlock', e);
  }
}

// ===== Force update (tillgänglig även låst) =====
async function forceUpdate(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const names=await caches.keys();
      await Promise.all(names.map(n=>caches.delete(n)));
    }
    alert('Appen uppdateras – laddar om…');
    location.reload(true);
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
}

// ===== Wire up =====
document.addEventListener('DOMContentLoaded', async ()=>{
  await idbReady(); // öppna DB (eller fallback)
  const p = passEl();

  // Lås
  $('setPassBtn')    ?.addEventListener('click', ()=>setInitialPass(p.value));
  $('unlockBtn')     ?.addEventListener('click', ()=>unlock(p.value));
  $('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // Editor/CRUD
  $('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; $('editor').innerHTML=''; $('dateLine').textContent=''; $('editor').focus(); });
  $('saveBtn')  ?.addEventListener('click', saveEntry);
  $('deleteBtn')?.addEventListener('click', delEntry);
  $('lockBtn')  ?.addEventListener('click', lock);

  // Toolbar
  $('boldBtn')     ?.addEventListener('click', ()=>execCmd('bold'));
  $('italicBtn')   ?.addEventListener('click', ()=>execCmd('italic'));
  $('underlineBtn')?.addEventListener('click', ()=>execCmd('underline'));
  $('colorBtn')    ?.addEventListener('input', e=>execCmd('foreColor', e.target.value));

  // Meny
  $('menuToggle')?.addEventListener('click', toggleMenu);
  $('exportBtn') ?.addEventListener('click', exportAll);
  $('importBtn') ?.addEventListener('click', ()=>$('importInput').click());
  $('importInput')?.addEventListener('change', e=>{ if(e.target.files?.[0]) importAll(e.target.files[0]); });
  $('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Force update
  $('forceUpdateBtn')?.addEventListener('click', forceUpdate);

  // Start i låst läge
  showLock();
  setTimeout(()=>p?.focus(), 50);
  console.log('✅ app.js init'); window.__APP_WIRED__ = true;
});
