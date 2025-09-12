// ===== Helpers =====
const $ = s => document.querySelector(s);
const byId = id => document.getElementById(id);

function buf2hex(buf){ return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function hex2buf(hex){ const b=new Uint8Array(hex.length/2); for(let i=0;i<b.length;i++) b[i]=parseInt(hex.substr(i*2,2),16); return b.buffer; }

// ===== IndexedDB =====
let _db;
function openDB(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const req = indexedDB.open('retro-diary',1);
    req.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('entries')) d.createObjectStore('entries',{keyPath:'id'});
      if(!d.objectStoreNames.contains('meta'))    d.createObjectStore('meta',{keyPath:'k'});
    };
    req.onsuccess = e=>{ _db=e.target.result; res(_db); };
    req.onerror   = e=>rej(e);
  });
}
async function dbPut(store, obj){
  const d=await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readwrite'); tx.objectStore(store).put(obj);
    tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);
  });
}
async function dbGet(store,key){
  const d=await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readonly'); const r=tx.objectStore(store).get(key);
    r.onsuccess=()=>res(r.result); r.onerror=e=>rej(e);
  });
}
async function dbAll(store){
  const d=await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readonly'); const r=tx.objectStore(store).getAll();
    r.onsuccess=()=>res(r.result||[]); r.onerror=e=>rej(e);
  });
}
async function dbDel(store,key){
  const d=await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readwrite'); tx.objectStore(store).delete(key);
    tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);
  });
}
async function dbClearAll(){
  const d=await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(['entries','meta'],'readwrite');
    tx.objectStore('entries').clear(); tx.objectStore('meta').clear();
    tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);
  });
}

// ===== Crypto =====
async function deriveKey(pass, saltHex){
  const enc = new TextEncoder();
  const mat = await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:hex2buf(saltHex), iterations:200000, hash:'SHA-256'},
    mat, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv:buf2hex(iv), ct:buf2hex(ct) };
}
async function decObj(key, wrap){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:hex2buf(wrap.iv)}, key, hex2buf(wrap.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ===== Wrap-meta (första lösenordet) =====
async function setWrapMeta(w){ await dbPut('meta',{k:'wrap',salt:w.salt,test:w.test}); localStorage.setItem('wrap', JSON.stringify(w)); }
async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw ? JSON.parse(raw) : null;
}
async function clearWrapMeta(){ await dbClearAll(); localStorage.removeItem('wrap'); }

// ===== App-state =====
const state = { key:null, currentId:null };
const editor   = byId('editor');
const dateLine = byId('dateLine');
const entriesUl= byId('entries');

// ===== UI lock/unlock =====
function setStatus(msg){ byId('status').textContent = msg||''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({k:'wrap', salt, test});
    state.key = key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    let meta = await getWrapMeta();
    if(!meta || !meta.salt || !meta.test){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    setStatus('Kontrollerar…');
    const key = await deriveKey(pass, meta.salt);
    const probe = await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Fel kontroll');
    state.key = key; setStatus(''); hideLock(); await renderList();
  }catch(e){ setStatus('Fel lösenord.'); }
}

function lock(){
  state.key=null; state.currentId=null;
  editor.innerHTML=''; dateLine.textContent='';
  showLock(); setStatus('');
  setTimeout(()=>byId('passInput')?.focus(), 50);
}

// ===== Entries =====
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  return (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
}
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id  = state.currentId || Date.now();
  const obj = { id, html:editor.innerHTML, date:new Date(id).toISOString().replace('T',' ').slice(0,19), title:titleFrom(editor.innerHTML) };
  const wrap= await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId = id;
  await renderList();
}
async function renderList(){
  entriesUl.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li = document.createElement('li');
    li.textContent = new Date(e.id).toISOString().replace('T',' ').slice(0,19);
    li.addEventListener('click', async ()=>{
      const dec = await decObj(state.key, e.wrap);
      state.currentId = dec.id;
      editor.innerHTML = dec.html;
      dateLine.textContent = dec.date;
      editor.focus();
    });
    entriesUl.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList();
}

// ===== Export / Import / Wipe =====
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries},null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
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
  await dbClearAll(); localStorage.removeItem('wrap');
  state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

// ===== Meny & force update =====
function toggleMenu(){
  const m = byId('menu'); if(!m) return;
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
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

// ===== Toolbar-kommandon =====
function exec(cmd,val=null){ document.execCommand(cmd,false,val); }

byId('boldBtn')     ?.addEventListener('click', ()=>exec('bold'));
byId('italicBtn')   ?.addEventListener('click', ()=>exec('italic'));
byId('underlineBtn')?.addEventListener('click', ()=>exec('underline'));
byId('strikeBtn')   ?.addEventListener('click', ()=>exec('strikeThrough'));

byId('ulBtn')?.addEventListener('click', ()=>exec('insertUnorderedList'));
byId('olBtn')?.addEventListener('click', ()=>exec('insertOrderedList'));

byId('leftBtn')   ?.addEventListener('click', ()=>exec('justifyLeft'));
byId('centerBtn') ?.addEventListener('click', ()=>exec('justifyCenter'));
byId('rightBtn')  ?.addEventListener('click', ()=>exec('justifyRight'));
byId('justifyBtn')?.addEventListener('click', ()=>exec('justifyFull'));

byId('colorBtn') ?.addEventListener('input', e=>exec('foreColor', e.target.value));
byId('hiliteBtn')?.addEventListener('input', e=>exec('hiliteColor', e.target.value));

byId('linkBtn')?.addEventListener('click', ()=>{
  const url = prompt('Länkadress (https://...)');
  if(!url) return;
  if(window.getSelection().isCollapsed){
    exec('insertHTML', `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  }else{
    exec('createLink', url);
  }
});
byId('clearBtn')?.addEventListener('click', ()=>exec('removeFormat'));
byId('undoBtn') ?.addEventListener('click', ()=>exec('undo'));
byId('redoBtn') ?.addEventListener('click', ()=>exec('redo'));

const blockSelect = byId('blockSelect');
if(blockSelect){
  blockSelect.addEventListener('change', e=>{
    const tag = e.target.value;
    const map = {p:'P', h1:'H1', h2:'H2', h3:'H3', blockquote:'BLOCKQUOTE', pre:'PRE'};
    exec('formatBlock', map[tag] || 'P');
  });
}

// ===== Fonts (via fonts.js) =====
(function initFonts(){
  const sel = byId('fontSelect'); if(!sel || !window.FONTS) return;
  // fyll dropdown
  sel.innerHTML = '';
  for(const f of FONTS){
    const opt=document.createElement('option');
    opt.value=f.value; opt.textContent=f.label; opt.dataset.url=f.url||'';
    sel.appendChild(opt);
  }
  // last choice
  const saved = localStorage.getItem('rd_font');
  if(saved){ sel.value=saved; editor.style.fontFamily = saved; }
  // apply & lazy-load
  function ensureFont(url){
    if(!url) return;
    const id = 'gf-'+btoa(url).replace(/=/g,'');
    if(document.getElementById(id)) return;
    const l=document.createElement('link'); l.id=id; l.rel='stylesheet'; l.href=url;
    document.head.appendChild(l);
  }
  // preload current selected url
  const curUrl = sel.selectedOptions[0]?.dataset.url; ensureFont(curUrl);

  sel.addEventListener('change', e=>{
    const val = e.target.value;
    const url = e.target.selectedOptions[0]?.dataset.url;
    ensureFont(url);
    editor.style.fontFamily = val;
    localStorage.setItem('rd_font', val);
  });
})();

// ===== Wire up =====
window.addEventListener('load', ()=>{
  const passEl = byId('passInput');

  // Låsskärm
  byId('setPassBtn')    ?.addEventListener('click', ()=>setInitialPass(passEl.value));
  byId('unlockBtn')     ?.addEventListener('click', ()=>unlock(passEl.value));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // CRUD
  byId('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus(); });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  // Meny
  byId('menuToggle')?.addEventListener('click', toggleMenu);
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Start i låst läge
  showLock();
});
