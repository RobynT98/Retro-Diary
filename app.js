/* ===================== Helpers ===================== */
const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

function bufToHex(buf){
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function hexToBuf(hex){
  const a = new Uint8Array(hex.length/2);
  for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16);
  return a.buffer;
}
const passEl = () => byId('passInput');

function setStatus(s){ const el = byId('status'); if(el) el.textContent = s||''; }

/* ===================== IndexedDB ===================== */
let _db;
function openDB(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const req = indexedDB.open('retro-diary',1);
    req.onupgradeneeded = e=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('entries'))
        db.createObjectStore('entries',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta',{keyPath:'k'});
    };
    req.onsuccess = e=>{ _db=e.target.result; res(_db); };
    req.onerror = e=>rej(e);
  });
}
async function dbPut(store, obj){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = ()=>res();
    tx.onerror = e=>rej(e);
  });
}
async function dbGet(store, key){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store);
    const r  = tx.objectStore(store).get(key);
    r.onsuccess = ()=>res(r.result);
    r.onerror   = e=>rej(e);
  });
}
async function dbAll(store){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store);
    const r  = tx.objectStore(store).getAll();
    r.onsuccess = ()=>res(r.result||[]);
    r.onerror   = e=>rej(e);
  });
}
async function dbDel(store, key){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = ()=>res();
    tx.onerror = e=>rej(e);
  });
}
async function dbClearAll(){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(['entries','meta'],'readwrite');
    tx.objectStore('entries').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete = ()=>res();
    tx.onerror = e=>rej(e);
  });
}

/* ===================== Crypto ===================== */
async function deriveKey(pass, saltBuf, usages=['encrypt','decrypt']){
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: saltBuf, iterations: 200000, hash:'SHA-256'},
    base,
    {name:'AES-GCM', length:256},
    false,
    usages
  );
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: bufToHex(iv), ct: bufToHex(ct) };
}
async function decObj(key, wrap){
  const iv = hexToBuf(wrap.iv);
  const ct = hexToBuf(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ===================== Wrap-meta ===================== */
async function setWrapMeta(w){ await dbPut('meta',{k:'wrap',salt:w.salt,test:w.test}); }
async function getWrapMeta(){ return await dbGet('meta','wrap'); }

/* ===================== UI Lock/Unlock ===================== */
function showLock(){ document.body.classList.add('locked'); byId('book').style.display='none'; byId('lockscreen').style.display='flex'; }
function hideLock(){ document.body.classList.remove('locked'); byId('lockscreen').style.display='none'; byId('book').style.display='flex'; }

async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, hexToBuf(salt));
    const test = await encObj(key,{ok:true});
    await setWrapMeta({salt,test});
    window._cryptoKey = key;
    setStatus('Lösen satt ✔');
    hideLock();
    await renderList();
  }catch(e){
    console.error('setInitialPass',e);
    setStatus('Kunde inte sätta lösen.');
  }
}

async function unlockDiary(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta = await getWrapMeta();
    if(!meta){ setStatus('Inget lösen valt än. Klicka “Sätt nytt lösen”.'); return; }
    setStatus('Kontrollerar…');
    const key = await deriveKey(pass, hexToBuf(meta.salt), ['decrypt']);
    const probe = await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');

    window._cryptoKey = key;
    setStatus('');
    hideLock();                 // ← Viktigt: växla UI läge
    await renderList();
    console.log('DEBUG: unlock OK');
  }catch(e){
    console.error('unlock',e);
    setStatus('Fel lösenord.');
  }
}

function lock(){
  window._cryptoKey = null;
  byId('editor').innerHTML = '';
  byId('dateLine').textContent = '';
  showLock();
  setTimeout(()=>passEl()?.focus(), 50);
}

/* ===================== Entries ===================== */
function titleFrom(html){
  const t = document.createElement('div'); t.innerHTML = html||'';
  const s = (t.textContent||'').trim();
  return s.split(/\n/)[0].slice(0,80) || 'Anteckning';
}

async function saveEntry(){
  const key = window._cryptoKey;
  if(!key) return alert('Lås upp först.');
  const id  = window._currentId || Date.now();
  const obj = { id, html: byId('editor').innerHTML, date: new Date().toLocaleString(), title: titleFrom(byId('editor').innerHTML) };
  const wrap = await encObj(key, obj);
  await dbPut('entries', { id, wrap, updated: Date.now() });
  window._currentId = id;
  await renderList();
}

async function renderList(){
  const key = window._cryptoKey;
  const list = byId('entries'); if(!list) return;
  list.innerHTML = '';
  const all = (await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li = document.createElement('li');
    li.textContent = new Date(e.updated||e.id).toLocaleString();
    li.addEventListener('click', async ()=>{
      const dec = await decObj(key, e.wrap);
      window._currentId = dec.id;
      byId('editor').innerHTML = dec.html;
      byId('dateLine').textContent = dec.date;
      byId('editor').focus();
    });
    list.appendChild(li);
  }
}

async function delEntry(){
  const key = window._cryptoKey;
  if(!key || !window._currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', window._currentId);
  window._currentId = null;
  byId('editor').innerHTML=''; byId('dateLine').textContent='';
  await renderList();
}

/* ===================== Export/Import/Wipe ===================== */
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries})], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt = await file.text();
  const data = JSON.parse(txt);
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll();
  window._cryptoKey=null; window._currentId=null;
  byId('editor').innerHTML=''; byId('dateLine').textContent='';
  showLock(); setStatus('Allt rensat.');
}

/* ===================== Menu / Toolbar / Force update ===================== */
function toggleMenu(){
  const m = byId('menu');
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open') ? 'false':'true');
}
function execCmd(cmd, val=null){ document.execCommand(cmd,false,val); }

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
    alert('Appen uppdateras – laddar om...');
    location.reload();
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
});

/* ===================== Wire up ===================== */
window.addEventListener('load', ()=>{
  // Låsskärm
  byId('setPassBtn').addEventListener('click', ()=>setInitialPass(passEl().value));
  byId('unlockBtn' ).addEventListener('click', ()=>unlockDiary(passEl().value));
  byId('wipeLocalOnLock').addEventListener('click', wipeAll);

  // Editor / CRUD
  byId('newBtn').addEventListener('click', ()=>{ window._currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent=''; byId('editor').focus(); });
  byId('saveBtn').addEventListener('click', saveEntry);
  byId('deleteBtn').addEventListener('click', delEntry);
  byId('lockBtn').addEventListener('click', lock);

  // Toolbar
  byId('boldBtn').addEventListener('click', ()=>execCmd('bold'));
  byId('italicBtn').addEventListener('click', ()=>execCmd('italic'));
  byId('underlineBtn').addEventListener('click', ()=>execCmd('underline'));
  byId('colorBtn').addEventListener('input', e=>execCmd('foreColor', e.target.value));

  // Meny
  byId('menuToggle').addEventListener('click', toggleMenu);
  byId('exportBtn').addEventListener('click', exportAll);
  byId('importBtn').addEventListener('click', ()=>byId('importInput').click());
  byId('importInput').addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn').addEventListener('click', wipeAll);

  // Start i låst läge (säker)
  showLock();
  setTimeout(()=>passEl()?.focus(), 60);
});
