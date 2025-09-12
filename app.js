// ---- Helpers ----
const $ = s => document.querySelector(s);
const byId = s => document.getElementById(s);
const enc = new TextEncoder(); const dec = new TextDecoder();
const passField = ()=> byId('passInput') || byId('pass');

function setStatus(msg){ const el=byId('status'); if(el) el.textContent = msg||''; }
function debug(msg){
  let el = byId('debugBar'); if(!el){ el=document.createElement('pre'); el.id='debugBar';
    el.style.cssText='position:fixed;left:0;right:0;bottom:0;margin:0;background:#300;color:#fdd;padding:4px 8px;font:12px monospace;z-index:99999';
    document.body.appendChild(el);
  }
  el.textContent = 'DEBUG: ' + msg;
}

// ---- Hex/U8 ----
const buf2hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
function hex2u8(hex){ const a=new Uint8Array(hex.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a; }

// ---- DB (IndexedDB med localStorage-fallback) ----
let _db;
function dbOpen(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const r = indexedDB.open('retro-diary', 1);
    r.onupgradeneeded = e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta',{keyPath:'k'});
      if(!d.objectStoreNames.contains('entries')) d.createObjectStore('entries',{keyPath:'id'});
    };
    r.onsuccess=e=>{ _db=e.target.result; res(_db); };
    r.onerror = ()=>rej(r.error);
  });
}
async function dbPut(store,obj){
  try{
    const db = await dbOpen();
    await new Promise((res,rej)=>{
      const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(obj);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }catch{
    if(store==='meta') localStorage.setItem(obj.k, JSON.stringify(obj));
    if(store==='entries') localStorage.setItem('e:'+obj.id, JSON.stringify(obj));
  }
}
async function dbGet(store,key){
  try{
    const db = await dbOpen();
    return await new Promise((res,rej)=>{
      const tx=db.transaction(store,'readonly'); const rq=tx.objectStore(store).get(key);
      rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error);
    });
  }catch{
    if(store==='meta'){ const raw=localStorage.getItem(key); return raw?JSON.parse(raw):null; }
    if(store==='entries'){ const raw=localStorage.getItem('e:'+key); return raw?JSON.parse(raw):null; }
    return null;
  }
}
async function dbAll(store){
  try{
    const db = await dbOpen();
    return await new Promise((res,rej)=>{
      const tx=db.transaction(store,'readonly'); const rq=tx.objectStore(store).getAll();
      rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error);
    });
  }catch{
    const out=[];
    if(store==='entries'){
      for(const k of Object.keys(localStorage)){
        if(k.startsWith('e:')) try{ out.push(JSON.parse(localStorage.getItem(k))); }catch{}
      }
    }
    return out;
  }
}
async function dbDel(store,key){
  try{
    const db = await dbOpen();
    await new Promise((res,rej)=>{
      const tx=db.transaction(store,'readwrite'); tx.objectStore(store).delete(key);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }catch{
    if(store==='entries') localStorage.removeItem('e:'+key);
  }
}
async function dbClearAll(){
  try{
    const db = await dbOpen();
    await new Promise((res,rej)=>{
      const tx=db.transaction(['meta','entries'],'readwrite');
      tx.objectStore('meta').clear(); tx.objectStore('entries').clear();
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }catch{
    Object.keys(localStorage).forEach(k=>{ if(k==='wrap'||k.startsWith('e:')) localStorage.removeItem(k); });
  }
}

// ---- Crypto ----
async function deriveKey(pass, saltHex){
  const mat = await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: hex2u8(saltHex), iterations:200000, hash:'SHA-256'},
    mat, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv: buf2hex(iv), ct: buf2hex(ct) };
}
async function decObj(key, wrap){
  const ivU8 = hex2u8(wrap.iv); const ctU8 = hex2u8(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv: ivU8}, key, ctU8.buffer);
  return JSON.parse(dec.decode(pt));
}

// ---- Wrap-meta ----
async function setWrapMeta(w){ await dbPut('meta', {k:'wrap', salt:w.salt, test:w.test}); localStorage.setItem('wrap', JSON.stringify(w)); }
async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw ? JSON.parse(raw) : null;
}

// ---- UI lock toggling via body.locked ----
function showLock(){ document.body.classList.add('locked'); setStatus(''); setTimeout(()=>passField()?.focus(),50); }
function hideLock(){ document.body.classList.remove('locked'); setStatus(''); }

// ---- State ----
const state = { key:null, currentId:null };

// ---- Lösen ----
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({salt, test});
    state.key = key;
    setStatus('Lösen satt ✔');
    hideLock(); await renderList();
    debug(`wrap sparad. salt=${salt.length/2} iv=${(test.iv||'').length/2} ct=${(test.ct||'').length/2}`);
  }catch(e){ setStatus('Kunde inte sätta lösen.'); debug('setInitialPass ERROR: '+(e?.message||e)); }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta = await getWrapMeta();
    if(!meta || !meta.salt || !meta.test){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    setStatus('Kontrollerar…');
    const key = await deriveKey(pass, meta.salt);
    const probe = await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');
    state.key = key;
    setStatus('');
    hideLock(); await renderList();
    $('#editor')?.focus();
    debug('unlock OK');
  }catch(e){ setStatus('Fel lösenord.'); debug('unlock ERROR: '+(e?.message||e)); }
}

function lock(){
  state.key=null; state.currentId=null;
  $('#editor') && ($('#editor').innerHTML=''); $('#dateLine') && ($('#dateLine').textContent='');
  showLock(); debug('locked');
}

// ---- Entries ----
function titleFrom(html){ const d=document.createElement('div'); d.innerHTML=html||''; return (d.textContent||'').trim().split(/\n/)[0].slice(0,80)||'Anteckning'; }
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id = state.currentId || Date.now();
  const obj = { id, html: $('#editor').innerHTML, date:new Date().toLocaleString('sv-SE'), title:titleFrom($('#editor').innerHTML) };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId=id; await renderList();
}
async function renderList(){
  const list=$('#entries'); if(!list) return;
  list.innerHTML=''; const all=(await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent = new Date(e.updated||e.id).toLocaleString('sv-SE');
    li.addEventListener('click', async ()=>{
      const decd = await decObj(state.key, e.wrap);
      state.currentId = decd.id;
      $('#editor').innerHTML = decd.html;
      $('#dateLine').textContent = decd.date;
      $('#editor').focus();
    });
    list.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; $('#editor').innerHTML=''; $('#dateLine').textContent='';
  await renderList();
}

// ---- Export / Import / Wipe ----
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries})], {type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='retro-diary.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
async function importAll(file){
  const txt = await file.text(); const data = JSON.parse(txt||'{}');
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Import klar.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll(); localStorage.removeItem('wrap');
  state.key=null; state.currentId=null; $('#editor').innerHTML=''; $('#dateLine').textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

// ---- Meny & verktyg ----
function toggleMenu(){
  const m = byId('menu'); if(!m) return;
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open') ? 'false' : 'true');
}
function execCmd(cmd,val=null){ document.execCommand(cmd,false,val); }

// SW/Cache force update
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
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
});

// ---- Wire up ----
window.addEventListener('load', ()=>{
  byId('setPassBtn')     ?.addEventListener('click', ()=>setInitialPass(passField()?.value||''));
  byId('unlockBtn')      ?.addEventListener('click', ()=>unlock(passField()?.value||''));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  byId('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; $('#editor').innerHTML=''; $('#dateLine').textContent=''; $('#editor').focus(); });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  byId('boldBtn')     ?.addEventListener('click', ()=>execCmd('bold'));
  byId('italicBtn')   ?.addEventListener('click', ()=>execCmd('italic'));
  byId('underlineBtn')?.addEventListener('click', ()=>execCmd('underline'));
  byId('colorBtn')    ?.addEventListener('input', e=>execCmd('foreColor', e.target.value));

  byId('menuToggle')?.addEventListener('click', toggleMenu);
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Font endast editor
  const fs = byId('fontSelect');
  if(fs){
    const saved = localStorage.getItem('rd_font');
    if(saved){ byId('editor').style.fontFamily = saved; fs.value=saved; }
    fs.addEventListener('change', e=>{
      const f = e.target.value;
      byId('editor').style.fontFamily = f;
      localStorage.setItem('rd_font', f);
    });
  }

  // börja låst
  document.body.classList.add('locked');
  passField()?.focus();
});
