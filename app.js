/* ============================ Retro Diary – app.js ============================ */
/* --------------------------- Små hjälpare ----------------------------------- */
const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

function setStatus(msg){ const s=byId('status'); if(s) s.textContent=msg||''; }
function passEl(){ return byId('pass'); }

/* Debugbanner (syns längst ned) */
(function ensureDebugBar(){
  if(!byId('debugBar')){
    const pre=document.createElement('pre');
    pre.id='debugBar';
    pre.style.cssText='position:fixed;left:0;right:0;bottom:0;margin:0;background:#300;color:#fdd;padding:4px 8px;font:12px/1.2 monospace;z-index:99999;white-space:pre-wrap;max-height:25vh;overflow:auto';
    pre.textContent='DEBUG: …';
    document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(pre),{once:true});
  }
})();
function debugBanner(msg){
  const pre = byId('debugBar'); if(!pre) return;
  pre.textContent = String(msg||'');
}

/* Timeout wrapper för att inte fastna på vissa mobiler */
function withTimeout(promise, ms, label='op'){
  let t; const timer = new Promise((_,rej)=>{ t=setTimeout(()=>rej(new Error(label+' timeout')), ms);});
  return Promise.race([promise.finally(()=>clearTimeout(t)), timer]);
}

/* ============================ Crypto ======================================== */
function buf2hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hex2buf(hex){ const a=new Uint8Array(hex.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a.buffer; }

async function deriveKey(pass, saltHex){
  const salt = typeof saltHex==='string' ? hex2buf(saltHex) : saltHex;
  const enc = new TextEncoder();
  const mat = await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:200000, hash:'SHA-256'},
    mat,
    {name:'AES-GCM', length:256},
    false,
    ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv: buf2hex(iv), ct: buf2hex(ct) };
}
async function decObj(key, wrap){
  const iv = hex2buf(String(wrap.iv||'')); 
  const ct = hex2buf(String(wrap.ct||'')); 
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ============================ IndexedDB (med fallback) ======================= */
let _db;
function dbOpen(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const req = indexedDB.open('retro-diary', 1);
    req.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('entries')) d.createObjectStore('entries',{keyPath:'id'});
      if(!d.objectStoreNames.contains('meta'))    d.createObjectStore('meta',{keyPath:'k'});
    };
    req.onsuccess = e=>{ _db=e.target.result; res(_db); };
    req.onerror   = ()=>rej(req.error||new Error('IDB open error'));
  });
}
async function dbPut(store, obj){
  try{
    const db = await dbOpen();
    await new Promise((res,rej)=>{
      const tx=db.transaction(store,'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }catch{ // fallback localStorage
    if(store==='meta') localStorage.setItem(obj.k, JSON.stringify(obj));
    if(store==='entries') localStorage.setItem('e:'+obj.id, JSON.stringify(obj));
  }
}
async function dbGet(store, key){
  try{
    const db = await dbOpen();
    return await new Promise((res,rej)=>{
      const tx=db.transaction(store); const req=tx.objectStore(store).get(key);
      req.onsuccess=()=>res(req.result||null); req.onerror=()=>rej(req.error);
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
      const tx=db.transaction(store); const req=tx.objectStore(store).getAll();
      req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error);
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
async function dbDel(store, key){
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
      const tx=db.transaction(['entries','meta'],'readwrite');
      tx.objectStore('entries').clear();
      tx.objectStore('meta').clear();
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }catch{
    Object.keys(localStorage).forEach(k=>{ if(k==='wrap'||k.startsWith('e:')) localStorage.removeItem(k); });
  }
}

/* ============================ Wrap-meta (lösen) ============================= */
function normalizeWrap(m){
  if(!m) return null;
  // tillåt både {k:'wrap',salt,test:{iv,ct}} och {salt, test}
  if(m.k && m.k!=='wrap') return null;
  if(m.test && m.test.iv && m.test.ct && typeof m.salt==='string') return m;
  return null;
}
function validateWrap(m){
  if(!m) return 'saknas';
  if(typeof m.salt!=='string' || m.salt.length<32) return 'ogiltig salt';
  if(!m.test || typeof m.test.iv!=='string' || typeof m.test.ct!=='string') return 'ogiltig test';
  return null;
}
async function setWrapMeta(obj){
  await dbPut('meta', obj);            // IDB eller fallback sätter båda
}
async function getWrapMeta(){
  const m = await dbGet('meta','wrap');
  if(m) return m;
  const raw = localStorage.getItem('wrap');
  return raw ? JSON.parse(raw) : null;
}
async function clearWrapMeta(){
  await dbClearAll();
  localStorage.removeItem('wrap');
}

/* ============================ UI: låsskärm ================================== */
function showLock(){
  const l = byId('lockscreen'); if(!l) return;
  l.style.display='flex'; l.removeAttribute('aria-hidden');
}
function hideLock(){
  const l = byId('lockscreen'); if(!l) return;
  l.style.display='none'; l.setAttribute('aria-hidden','true');
}

/* ============================ State ========================================= */
const state = { key:null, currentId:null };

/* ============================ Lösen – sätt / lås upp ======================== */
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }

    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await withTimeout(deriveKey(pass, salt), 8000, 'deriveKey');
    const test = await withTimeout(encObj(key, {ok:true}), 8000, 'encrypt');

    const wrap = { k:'wrap', salt, test };
    await setWrapMeta(wrap);
    localStorage.setItem('wrap', JSON.stringify(wrap)); // dubbelspar för äldre mobiler

    state.key = key;
    setStatus('Lösen satt ✔');
    debugBanner(`DEBUG: wrap sparad: salt=${salt.length} iv=${test.iv.length} ct=${test.ct.length}`);
    hideLock();
    await renderList();
  }catch(e){
    setStatus('Kunde inte sätta lösen.');
    debugBanner('setInitialPass ERROR: '+(e?.message||e));
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
    setStatus('');
    hideLock();
    await renderList();
    $('#editor')?.focus();
    passEl()?.value='';
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
  setStatus('');
  showLock();
  setTimeout(()=>passEl()?.focus(), 50);
}

/* ============================ Sidor (CRUD) ================================== */
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t=(tmp.textContent||'').trim().split(/\n/)[0];
  return (t||'Anteckning').slice(0,80);
}
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const ed = byId('editor');
  const id  = state.currentId || Date.now();
  const obj = { id, html:ed.innerHTML, date:new Date().toLocaleString('sv-SE'), title:titleFrom(ed.innerHTML) };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId = id;
  await renderList();
}
async function renderList(){
  const list = byId('entriesList'); if(!list) return;
  list.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent = new Date(e.updated||e.id).toLocaleString('sv-SE');
    li.tabIndex = 0;
    li.addEventListener('click', async ()=>{
      const dec = await decObj(state.key, e.wrap);
      state.currentId = dec.id;
      byId('editor').innerHTML = dec.html;
      byId('dateLine').textContent = dec.date;
      byId('editor').focus();
    });
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

/* ============================ Export / Import ================================ */
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries})], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const text = await file.text();
  const data = JSON.parse(text||'{}');
  if(!data.meta || !data.entries) return alert('Ogiltig fil.');
  await setWrapMeta(data.meta);
  localStorage.setItem('wrap', JSON.stringify(data.meta)); // även lokalt
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); await renderList();
}

/* ============================ Wipe ========================================== */
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll(); localStorage.removeItem('wrap');
  state.key=null; state.currentId=null;
  byId('editor').innerHTML=''; byId('dateLine').textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

/* ============================ Meny & verktyg ================================= */
function toggleMenu(){
  const m = byId('menu'); if(!m) return;
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
function execCmd(cmd, val=null){ document.execCommand(cmd,false,val); }

/* Forcera uppdatering (SW + caches) */
async function forceUpdate(){
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
}

/* ============================ Event wiring ================================== */
window.addEventListener('load', ()=>{
  // Låsskärm
  byId('setPassBtn')   ?.addEventListener('click', ()=>setInitialPass(passEl().value));
  byId('unlockBtn')    ?.addEventListener('click', ()=>unlock(passEl().value));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // Editor/CRUD
  byId('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent=''; byId('editor').focus(); });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  // Toolbar
  byId('boldBtn')     ?.addEventListener('click', ()=>execCmd('bold'));
  byId('italicBtn')   ?.addEventListener('click', ()=>execCmd('italic'));
  byId('underlineBtn')?.addEventListener('click', ()=>execCmd('underline'));
  byId('colorBtn')    ?.addEventListener('input', e=>execCmd('foreColor', e.target.value));

  // Meny
  byId('menuToggle')?.addEventListener('click', toggleMenu);
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Font (bara editor)
  const fontSel = byId('fontSelect');
  if(fontSel){
    const saved = localStorage.getItem('rd_font');
    if(saved){ byId('editor').style.fontFamily = saved; fontSel.value = saved; }
    fontSel.addEventListener('change', e=>{
      byId('editor').style.fontFamily = e.target.value;
      localStorage.setItem('rd_font', e.target.value);
    });
  }

  // Uppdatera-app knapp
  byId('forceUpdateBtn')?.addEventListener('click', forceUpdate);

  // Börja i låst läge
  showLock();
  setTimeout(()=>passEl()?.focus(), 50);

  // Registrera service worker (om finns)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  debugBanner('READY');
});
/* ============================================================================ */
