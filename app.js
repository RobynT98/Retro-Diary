// ============================================================
// Retro Diary - “book13” – säker lokal dagbok med Word-verktyg
// ============================================================

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const byId = id => document.getElementById(id);

const enc = new TextEncoder();
const dec = new TextDecoder();

function buf2hex(buf){
  return Array.prototype.map.call(new Uint8Array(buf), x=>x.toString(16).padStart(2,"0")).join('');
}
function hex2buf(hex){
  const bytes = new Uint8Array(hex.length/2);
  for(let i=0;i<bytes.length;i++) bytes[i]=parseInt(hex.substr(i*2,2),16);
  return bytes.buffer;
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* ---------- IndexedDB (fail-safe till localStorage) ---------- */
let _db;
function idb(){
  if(_db) return Promise.resolve(_db);
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open("retro-diary",1);
    req.onupgradeneeded = e=>{
      const d = e.target.result;
      d.createObjectStore("entries",{keyPath:"id"});
      d.createObjectStore("meta",{keyPath:"k"});
    };
    req.onsuccess = e=>{ _db = e.target.result; resolve(_db); };
    req.onerror = e=>reject(e);
  });
}
async function dbPut(store,obj){
  try{
    const d = await idb();
    await new Promise((res,rej)=>{
      const tx=d.transaction(store,"readwrite");
      tx.objectStore(store).put(obj);
      tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);
    });
  }catch{ /* no-op */ }
}
async function dbGet(store,key){
  try{
    const d=await idb();
    return await new Promise((res,rej)=>{
      const tx=d.transaction(store);
      const rq=tx.objectStore(store).get(key);
      rq.onsuccess=()=>res(rq.result);
      rq.onerror=e=>rej(e);
    });
  }catch{ return null; }
}
async function dbAll(store){
  try{
    const d=await idb();
    return await new Promise((res,rej)=>{
      const tx=d.transaction(store);
      const rq=tx.objectStore(store).getAll();
      rq.onsuccess=()=>res(rq.result||[]);
      rq.onerror=e=>rej(e);
    });
  }catch{ return []; }
}
async function dbDel(store,key){
  try{
    const d=await idb();
    await new Promise((res,rej)=>{
      const tx=d.transaction(store,"readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);
    });
  }catch{}
}
async function dbClearAll(){
  try{
    const d=await idb();
    await new Promise((res,rej)=>{
      const tx=d.transaction(["entries","meta"],"readwrite");
      tx.objectStore("entries").clear();
      tx.objectStore("meta").clear();
      tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);
    });
  }catch{}
}

/* ---------- Crypto ---------- */
async function deriveKey(pass, saltHex){
  const keyMat=await crypto.subtle.importKey("raw", enc.encode(pass), {name:"PBKDF2"}, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2", salt:hex2buf(saltHex), iterations:200000, hash:"SHA-256"},
    keyMat,
    {name:"AES-GCM", length:256},
    false,
    ["encrypt","decrypt"]
  );
}
async function encObj(key,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, enc.encode(JSON.stringify(obj)));
  return { iv:buf2hex(iv), ct:buf2hex(ct) };
}
async function decObj(key,wrap){
  const pt=await crypto.subtle.decrypt({name:"AES-GCM", iv:hex2buf(wrap.iv)}, key, hex2buf(wrap.ct));
  return JSON.parse(dec.decode(pt));
}

/* ---------- Wrap-meta (fail-safe i localStorage) ---------- */
async function setWrapMeta(w){
  await dbPut('meta', {k:'wrap', salt:w.salt, test:w.test});
  localStorage.setItem('wrap', JSON.stringify(w));
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

/* ---------- State ---------- */
const state={ key:null, currentId:null, dirty:false, saveTimer:null };
const editor   = byId('editor');
const dateLine = byId('dateLine');
const saveOkEl = byId('saveStatus');

/* ---------- Lock/Unlock ---------- */
function setStatus(msg){ byId('status').textContent = msg || ''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({salt,test});
    state.key = key;
    setStatus('Lösen satt ✓'); hideLock(); renderList();
  }catch(e){
    setStatus('Kunde inte sätta lösen.');
  }
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
    if(!probe || probe.ok!==true) throw new Error('fel');
    state.key = key; setStatus(''); hideLock(); renderList();
  }catch{ setStatus('Fel lösenord.'); }
}
function lock(){
  state.key=null; state.currentId=null; state.dirty=false;
  editor.innerHTML=''; dateLine.textContent='';
  showLock(); setStatus(''); byId('passInput')?.focus();
}

/* ---------- Entries ---------- */
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  return (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
}
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id  = state.currentId || Date.now();
  const obj = { id, html:editor.innerHTML, date:new Date().toLocaleString(), title:titleFrom(editor.innerHTML) };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId = id; state.dirty=false;
  showSaved(); renderList();
}
async function renderList(){
  const list=$('#entries'); if(!list) return;
  list.innerHTML='';
  const all=(await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent=new Date(e.updated||e.id).toLocaleString();
    li.onclick = async ()=>{
      const decd=await decObj(state.key, e.wrap);
      state.currentId=decd.id;
      editor.innerHTML=decd.html;
      dateLine.textContent=decd.date;
      editor.focus(); state.dirty=false;
    };
    list.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  renderList();
}

/* ---------- Export/Import/Wipe ---------- */
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
  const txt = await file.text();
  const data = JSON.parse(txt);
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await clearWrapMeta();
  state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  renderList(); showLock(); setStatus('Allt rensat.');
}

/* ---------- Menu & Toolbar ---------- */
function toggleMenu(){
  const m = byId('menu'); if(!m) return;
  if(document.body.classList.contains('locked')) return;
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
function exec(cmd,val=null){ document.execCommand(cmd,false,val); }

function showSaved(){
  saveOkEl.hidden=false;
  clearTimeout(saveOkEl._t);
  saveOkEl._t=setTimeout(()=>{ saveOkEl.hidden=true; }, 1500);
}

/* ---------- Autosave ---------- */
function markDirty(){
  if(!state.key) return;
  state.dirty = true;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(()=>{ if(state.dirty) saveEntry(); }, 1200);
}

/* ---------- Force Update ---------- */
byId('forceUpdateBtn')?.addEventListener('click', async ()=>{
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n=>caches.delete(n)));
    }
    alert('Appen uppdateras – laddar om...');
    location.reload(true);
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
});

/* ---------- Wire up ---------- */
window.addEventListener('load', ()=>{
  // Lås
  byId('setPassBtn')    ?.addEventListener('click', ()=>setInitialPass(byId('passInput').value));
  byId('unlockBtn')     ?.addEventListener('click', ()=>unlock(byId('passInput').value));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // CRUD
  byId('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus(); state.dirty=false; });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  // Menu
  byId('menuToggle')?.addEventListener('click', toggleMenu);
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Toolbar actions
  byId('h1Btn')?.addEventListener('click', ()=>exec('formatBlock', '<h1>'));
  byId('h2Btn')?.addEventListener('click', ()=>exec('formatBlock', '<h2>'));
  byId('pBtn') ?.addEventListener('click', ()=>exec('formatBlock', '<p>'));

  byId('boldBtn')     ?.addEventListener('click', ()=>exec('bold'));
  byId('italicBtn')   ?.addEventListener('click', ()=>exec('italic'));
  byId('underlineBtn')?.addEventListener('click', ()=>exec('underline'));
  byId('clearBtn')    ?.addEventListener('click', ()=>{ exec('removeFormat'); exec('unlink'); });

  byId('ulBtn')   ?.addEventListener('click', ()=>exec('insertUnorderedList'));
  byId('olBtn')   ?.addEventListener('click', ()=>exec('insertOrderedList'));
  byId('quoteBtn')?.addEventListener('click', ()=>exec('formatBlock', '<blockquote>'));

  byId('leftBtn')  ?.addEventListener('click', ()=>exec('justifyLeft'));
  byId('centerBtn')?.addEventListener('click', ()=>exec('justifyCenter'));
  byId('rightBtn') ?.addEventListener('click', ()=>exec('justifyRight'));

  byId('colorBtn')?.addEventListener('input', e=>exec('foreColor', e.target.value));

  byId('linkBtn')  ?.addEventListener('click', ()=>{
    let url = prompt('Länkadress (https://…)');
    if(!url) return;
    if(!/^https?:\/\//i.test(url)) url = 'https://' + url;
    exec('createLink', url);
  });
  byId('unlinkBtn')?.addEventListener('click', ()=>exec('unlink'));

  byId('undoBtn')?.addEventListener('click', ()=>exec('undo'));
  byId('redoBtn')?.addEventListener('click', ()=>exec('redo'));

  // Font + Tema
  const fontSel = byId('fontSelect');
  if (fontSel){
    const saved = localStorage.getItem('rd_font');
    if(saved){ editor.style.fontFamily = saved; fontSel.value = saved; }
    fontSel.addEventListener('change', e=>{
      const f = e.target.value;
      editor.style.fontFamily = f;
      localStorage.setItem('rd_font', f);
    });
  }
  const themeT = byId('themeToggle');
  if(themeT){
    const t = localStorage.getItem('rd_theme') || 'dark';
    document.documentElement.dataset.theme = t;
    themeT.checked = t === 'dark';
    themeT.addEventListener('change', ()=>{
      const next = themeT.checked ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('rd_theme', next);
    });
  }

  // Autosave
  editor.addEventListener('input', markDirty);

  // Start
  showLock();
});
