// ================= Retro Diary - app.js (Pages/Mobile Safe) =================

// ---------- Små helpers ----------
const $ = s => document.querySelector(s);
const byId = s => document.getElementById(s);
const enc = new TextEncoder();
const dec = new TextDecoder();

function passEl(){ return byId('passInput') || byId('pass'); }
function entriesEl(){ return byId('entries') || byId('entriesList'); }

function setStatus(msg){ const el = byId('status'); if(el) el.textContent = msg || ''; }
function showLock(){ byId('lockscreen')?.classList.add('lock'); document.body.classList.add('locked'); }
function hideLock(){ byId('lockscreen')?.classList.remove('lock'); document.body.classList.remove('locked'); }

// Uint8Array <-> hex
function buf2hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hex2u8(hex){ const a=new Uint8Array(hex.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a; }

// Debugbanderoll + timeout
function debugBanner(msg){
  let el = document.getElementById('rd-debug');
  if(!el){
    el = document.createElement('div');
    el.id = 'rd-debug';
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#300;color:#fdd;padding:.4rem .6rem;font:12px monospace';
    document.body.appendChild(el);
  }
  el.textContent = 'DEBUG: ' + msg;
}
function withTimeout(promise, ms, label='op'){
  let t; const timeout = new Promise((_,rej)=> t=setTimeout(()=>rej(new Error(label+' timeout')), ms));
  return Promise.race([promise.finally(()=>clearTimeout(t)), timeout]);
}
function isHex(str){ return typeof str==='string' && /^[0-9a-fA-F]+$/.test(str); }

// ---------- IndexedDB ----------
let _db;
function openDB(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const r = indexedDB.open('retro-diary', 1);
    r.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('meta'))    d.createObjectStore('meta',{keyPath:'k'});
      if(!d.objectStoreNames.contains('entries')) d.createObjectStore('entries',{keyPath:'id'});
    };
    r.onsuccess = e=>{ _db=e.target.result; res(_db); };
    r.onerror   = ()=>rej(r.error);
  });
}
async function dbPut(store,obj){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readwrite'); tx.objectStore(store).put(obj);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}
async function dbGet(store,key){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readonly'); const rq=tx.objectStore(store).get(key);
    rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error);
  });
}
async function dbAll(store){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readonly'); const rq=tx.objectStore(store).getAll();
    rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error);
  });
}
async function dbDel(store,key){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readwrite'); tx.objectStore(store).delete(key);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}
async function dbClearAll(){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(['meta','entries'],'readwrite');
    tx.objectStore('meta').clear(); tx.objectStore('entries').clear();
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}

// ---------- Crypto (PBKDF2 + AES-GCM) ----------
async function deriveKey(pass, saltHex){
  const mat = await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:hex2u8(saltHex), iterations:200000, hash:'SHA-256'},
    mat,
    {name:'AES-GCM', length:256},
    false,
    ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const ct   = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv: buf2hex(iv), ct: buf2hex(ct) };
}
// Viktigt för mobil/webviews: skicka ArrayBuffer till decrypt
async function decObj(key, wrap){
  if(!wrap || !wrap.iv || !wrap.ct) throw new Error('Ogiltig wrap');
  const ivU8 = hex2u8(wrap.iv);
  const ctU8 = hex2u8(wrap.ct);
  const pt   = await crypto.subtle.decrypt({name:'AES-GCM', iv: ivU8}, key, ctU8.buffer);
  return JSON.parse(dec.decode(pt));
}

// ---------- Wrap/Meta (fallback) ----------
async function setWrapMeta(obj){
  try { await dbPut('meta', { k:'wrap', salt: obj.salt, test: obj.test }); }
  catch { localStorage.setItem('wrap', JSON.stringify({ k:'wrap', salt: obj.salt, test: obj.test })); }
}
async function getWrapMeta(){
  try{ const m = await dbGet('meta','wrap'); if(m && m.salt && m.test) return m; }catch{}
  const raw = localStorage.getItem('wrap'); if(!raw) return null;
  try{ const m = JSON.parse(raw); return (m && m.salt && m.test) ? m : null; }catch{ return null; }
}
function normalizeWrap(meta){
  if(!meta) return null;
  if(meta.test && meta.test.cipher && !meta.test.ct){ meta.test.ct = meta.test.cipher; delete meta.test.cipher; }
  return meta;
}
function validateWrap(meta){
  if(!meta) return 'saknar wrap';
  if(!meta.salt || !isHex(meta.salt) || meta.salt.length < 16) return 'felaktig salt';
  if(!meta.test || !isHex(meta.test.iv||'') || !isHex(meta.test.ct||'')) return 'felaktigt test';
  return null;
}

// ---------- State ----------
const state = { key:null, currentId:null };

// ---------- Lås / lås upp ----------
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, { ok:true, v:'book11' });
    await setWrapMeta({ salt, test });
    state.key = key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
    debugBanner(`wrap sparad: salt=${salt.length} iv=${test.iv.length} ct=${test.ct.length}`);
  }catch(e){
    setStatus('Kunde inte sätta lösen. ' + (e?.message||e));
    debugBanner('setInitialPass ERROR: '+(e?.message||e));
    console.error('setInitialPass', e);
  }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }

    let meta = await getWrapMeta();
    meta = normalizeWrap(meta);
    const vErr = validateWrap(meta);
    if(vErr){ setStatus('Välj “Sätt nytt lösen” först.'); debugBanner('wrap problem: '+vErr); return; }

    setStatus('Kontrollerar…'); debugBanner('deriveKey start');
    const key = await withTimeout(deriveKey(pass, meta.salt), 8000, 'deriveKey');

    debugBanner('decObj test start');
    const probe = await withTimeout(decObj(key, meta.test), 8000, 'decrypt');
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');

    state.key = key;
    setStatus(''); hideLock(); await renderList();
    debugBanner('unlock OK');
  }catch(e){
    const msg = (e && e.message) ? e.message : String(e);
    setStatus('Upplåsning misslyckades: ' + msg);
    debugBanner('unlock ERROR: ' + msg);
    console.error('unlock', e);
  }
}

function lock(){
  state.key=null; state.currentId=null;
  const ed = byId('editor'); if(ed) ed.innerHTML='';
  const dl = byId('dateLine'); if(dl) dl.textContent='';
  showLock(); setStatus('');
  setTimeout(()=>passEl()?.focus(), 50);
}

// ---------- Entries ----------
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  return (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
}
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const ed = byId('editor'); const dl = byId('dateLine');
  const id   = state.currentId || Date.now();
  const obj  = { id, html: ed.innerHTML, date: new Date().toLocaleString('sv-SE'), title: titleFrom(ed.innerHTML) };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated: Date.now() });
  state.currentId = id;
  if(dl) dl.textContent = obj.date;
  await renderList();
}
async function renderList(){
  const list = entriesEl(); if(!list) return;
  const ed = byId('editor'), dl = byId('dateLine');
  list.innerHTML = '';
  const all = (await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    try{
      if(state.key){
        const peek = await decObj(state.key, e.wrap);
        li.textContent = `${new Date(e.updated||e.id).toLocaleDateString('sv-SE')} — ${peek.title}`;
        li.addEventListener('click', async ()=>{
          const decd = await decObj(state.key, e.wrap);
          state.currentId = decd.id;
          if(ed) ed.innerHTML = decd.html;
          if(dl) dl.textContent = decd.date;
          ed?.focus();
        });
      }else{
        li.textContent = new Date(e.updated||e.id).toLocaleString('sv-SE');
        li.style.opacity = '.7';
      }
    }catch{
      li.textContent = new Date(e.updated||e.id).toLocaleString('sv-SE');
      li.style.opacity = '.7';
    }
    list.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent='';
  await renderList();
}

// ---------- Export / Import / Wipe ----------
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta, entries})], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt  = await file.text();
  const data = JSON.parse(txt);
  if(!data?.meta || !data?.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Import klar.');
  await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll(); localStorage.removeItem('wrap');
  state.key=null; state.currentId=null;
  const ed = byId('editor'), dl = byId('dateLine');
  if(ed) ed.innerHTML=''; if(dl) dl.textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

// ---------- Meny & toolbar ----------
function toggleMenu(){
  const m = byId('menu'); if(!m) return;
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open') ? 'false' : 'true');
}
function execCmd(cmd,val=null){ document.execCommand(cmd,false,val); }

// ---------- Force update (SW + cache) ----------
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
  // Låsskärm
  byId('setPassBtn')     ?.addEventListener('click', ()=>setInitialPass(passEl()?.value||''));
  byId('unlockBtn')      ?.addEventListener('click', ()=>unlock(passEl()?.value||''));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // CRUD
  byId('newBtn')   ?.addEventListener('click', ()=>{
    state.currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent=''; byId('editor').focus();
  });
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

  // Font (endast editor)
  const fs = byId('fontSelect');
  if(fs){
    const saved = localStorage.getItem('rd_font');
    if(saved){ byId('editor').style.fontFamily = saved; fs.value = saved; }
    fs.addEventListener('change', e=>{
      const f = e.target.value;
      byId('editor').style.fontFamily = f;
      localStorage.setItem('rd_font', f);
    });
  }

  // Start i låst läge
  showLock();
  setTimeout(()=>passEl()?.focus(), 60);
  console.log('✅ app.js init');
});
