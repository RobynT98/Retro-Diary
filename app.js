/* ========== Helpers ========== */
const $ = s => document.querySelector(s);
const deU8 = buf => new TextDecoder().decode(buf);
const enU8 = str => new TextEncoder().encode(str);
const randBytes = n => (crypto.getRandomValues(new Uint8Array(n)));
const toHex = u8 => Array.from(u8).map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex = s => { if(!s) return new Uint8Array(); const a=new Uint8Array(s.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(s.substr(i*2,2),16); return a; };
const uuid = () => crypto.randomUUID();

/* ========== IndexedDB (entries + meta) ========== */
const DB = (()=> {
  let db;
  const ENTRIES='entries', META='meta';
  function open(){ return new Promise((res,rej)=>{
    if(!('indexedDB' in window)) return res(null);
    const req = indexedDB.open('retro-diary-lite',1);
    req.onupgradeneeded = e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(ENTRIES)) d.createObjectStore(ENTRIES,{keyPath:'id'});
      if(!d.objectStoreNames.contains(META)) d.createObjectStore(META,{keyPath:'k'});
    };
    req.onsuccess = e=>{ db=e.target.result; res(db); };
    req.onerror = ()=>rej(req.error);
  });}
  async function put(store, value){
    if(!db) await open();
    return new Promise((res,rej)=>{
      const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(value);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }
  async function get(store, key){
    if(!db) await open();
    return new Promise((res,rej)=>{
      const tx=db.transaction(store,'readonly'); const req=tx.objectStore(store).get(key);
      req.onsuccess=()=>res(req.result||null); req.onerror=()=>rej(req.error);
    });
  }
  async function getAll(){
    if(!db) await open();
    return new Promise((res,rej)=>{
      const tx=db.transaction(ENTRIES,'readonly'); const req=tx.objectStore(ENTRIES).getAll();
      req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error);
    });
  }
  async function del(id){
    if(!db) await open();
    return new Promise((res,rej)=>{
      const tx=db.transaction(ENTRIES,'readwrite'); tx.objectStore(ENTRIES).delete(id);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }
  return { putEntry:(e)=>put(ENTRIES,e), getEntry:(id)=>get(ENTRIES,id), all:getAll, del:del,
           putMeta:(k,v)=>put(META,{k,v}), getMeta:(k)=>get(META,k), open };
})();

/* ========== Crypto (PBKDF2 + AES-GCM) ========== */
const CryptoLite = (()=> {
  async function deriveKey(pass, salt, iter=150000){
    const base = await crypto.subtle.importKey('raw', enU8(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base,
      { name:'AES-GCM', length: 256 },
      false,
      ['encrypt','decrypt']
    );
  }
  async function enc(key, plainU8){
    const iv = randBytes(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, plainU8));
    return { iv: toHex(iv), cipher: toHex(ct) };
  }
  async function dec(key, payload){
    const iv = fromHex(payload.iv);
    const data = fromHex(payload.cipher);
    const buf = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, data);
    return new Uint8Array(buf);
  }
  return { deriveKey, enc, dec };
})();

/* ========== State & render ========== */
const state = { key:null, currentId:null, entries:[] };
const listEl = $('#list'), editor = $('#editor'), dateLine=$('#dateLine'), stamp=$('#stamp'), lockscreen=$('#lockscreen'), statusEl=$('#status');

function renderList(){
  listEl.innerHTML='';
  [...state.entries].sort((a,b)=>(b.updated||0)-(a.updated||0)).forEach(e=>{
    const div=document.createElement('div'); div.className='entry-item';
    div.innerHTML = `<div><div>${e.title||'(utan titel)'}</div><small>${new Date(e.updated||e.created).toLocaleString('sv-SE')}</small></div><button class="ghost" data-id="${e.id}">Öppna</button>`;
    div.querySelector('button').onclick = ()=>openEntry(e.id);
    listEl.appendChild(div);
  });
}
function fmtDate(d){ return d.toLocaleString('sv-SE',{dateStyle:'full', timeStyle:'short'}); }
function firstLine(html){ const tmp=document.createElement('div'); tmp.innerHTML=html||''; const t=(tmp.textContent||'').trim(); return (t.split(/\n/)[0]||'Ny sida').slice(0,80); }

/* ========== Lock / Unlock – enkel modell ========== */
// Global salt för nyckelderivering (sparas i meta)
async function ensureKey(pass){
  let meta = await DB.getMeta('global_salt');
  let salt;
  if (meta && meta.v){ salt = fromHex(meta.v); }
  else {
    salt = randBytes(16);
    await DB.putMeta('global_salt', toHex(salt));
  }
  state.key = await CryptoLite.deriveKey(pass, salt);
}

async function lock(){
  state.key = null;
  state.currentId = null;
  editor.innerHTML = '';
  dateLine.textContent = '';
  stamp.textContent = '';
  lockscreen.hidden = false;
  document.body.classList.add('locked');
  closeMenu();
  setTimeout(()=>$('#pass')?.focus(), 30);
}

async function unlock(){
  const pass = ($('#pass')?.value || '').trim();
  if(!pass){ statusEl.textContent='Skriv ett lösenord.'; return; }
  statusEl.textContent='Låser upp...';
  try{
    await ensureKey(pass);
    state.entries = await DB.all();
    renderList();
    statusEl.textContent='';
    lockscreen.hidden = true;
    document.body.classList.remove('locked');
    if(!state.entries.length) newEntry();
  }catch(e){
    statusEl.textContent = 'Kunde inte låsa upp.';
  }
}
function lock() {
  document.body.classList.add('locked');
  currentId = null;
  $('#editor').innerHTML = '';
  $('#entries').innerHTML = '';
  $('#status').textContent = '';

  // Viktigt: fokusera lösenordsfältet när låst
  setTimeout(()=>$('#pass')?.focus(), 50);
}

/* ========== CRUD ========== */
function newEntry(){
  state.currentId=null;
  editor.innerHTML='';
  const now = new Date();
  dateLine.textContent = now.toLocaleDateString('sv-SE',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  stamp.textContent='Ej sparad';
  editor.focus();
}

async function openEntry(id){
  const rec = state.entries.find(x=>x.id===id) || await DB.getEntry(id);
  if(!rec || !state.key) return;
  try{
    const plain = await CryptoLite.dec(state.key, rec.cipher);
    editor.innerHTML = deU8(plain);
    state.currentId = id;
    dateLine.textContent = rec.title || '';
    stamp.textContent = `Skapad: ${fmtDate(new Date(rec.created))} · Senast sparad: ${fmtDate(new Date(rec.updated))}`;
  }catch{
    alert('Fel lösenord för denna data. (Eller skadad post.)');
  }
}

async function saveCurrent(){
  if(!state.key){ alert('Dagboken är låst.'); return; }
  if(!state.currentId) state.currentId = uuid();

  const html = editor.innerHTML;
  const title = firstLine(html);
  const created = (state.entries.find(e=>e.id===state.currentId)?.created) || Date.now();
  const cipher  = await CryptoLite.enc(state.key, enU8(html));
  const rec = { id: state.currentId, title, created, updated: Date.now(), cipher };

  await DB.putEntry(rec);
  const i = state.entries.findIndex(e=>e.id===rec.id);
  if(i>=0) state.entries[i]=rec; else state.entries.push(rec);

  dateLine.textContent = title;
  stamp.textContent = `Skapad: ${fmtDate(new Date(created))} · Senast sparad: ${fmtDate(new Date(rec.updated))}`;
  renderList();
}

async function deleteCurrent(){
  if(!state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  const id = state.currentId;
  await DB.del(id);
  state.entries = state.entries.filter(e=>e.id!==id);
  state.currentId = null;
  editor.innerHTML=''; dateLine.textContent=''; stamp.textContent='';
  renderList();
}

/* ========== Export / Import ========== */
async function exportAll(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const payload = {
    meta: { global_salt: await DB.getMeta('global_salt')?.v || await DB.getMeta('global_salt') },
    entries: state.entries
  };
  const blob = new Blob([JSON.stringify(payload)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `retro-diary-lite-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

async function importAll(file){
  const txt = await file.text();
  let json;
  try{ json = JSON.parse(txt); }catch{ return alert('Ogiltig fil.'); }
  if(!json || !json.entries) return alert('Ogiltig fil.');

  // meta (global salt)
  const gs = json.meta?.global_salt;
  if (gs) await DB.putMeta('global_salt', typeof gs==='string' ? gs : gs.v);

  for(const e of json.entries){ await DB.putEntry(e); }
  state.entries = await DB.all();
  renderList();
  alert('Import klart.');
}

/* ========== Wipe (nollställ denna enhet) ========== */
async function wipeLocal(){
  if(!confirm('Rensa ALL lokal data på den här enheten?')) return;
  if('indexedDB' in window){
    await new Promise(r=>{
      const req=indexedDB.deleteDatabase('retro-diary-lite');
      req.onsuccess=req.onerror=req.onblocked=()=>r();
    });
  }
  localStorage.clear();
  location.reload();
}
/* ========== Meny / UI ========== */
function closeMenu(){ $('#menuDrop')?.setAttribute('hidden',''); }

/* ========== RTF-verktyg ========== */
document.addEventListener('click', e=>{
  if(e.target.matches('[data-cmd]')){
    document.execCommand(e.target.dataset.cmd, false, e.target.dataset.value||null);
    editor.focus();
  }
  if(e.target.matches('[data-block]')){
    document.execCommand('formatBlock', false, e.target.dataset.block);
    editor.focus();
  }
});
$('#insertLinkBtn')?.addEventListener('click', ()=>{
  const url=prompt('Länk (https://...)'); if(!url) return;
  document.execCommand('createLink', false, url); editor.focus();
});
$('#clearFormatBtn')?.addEventListener('click', ()=>{
  document.execCommand('removeFormat',false,null);
  const sel=window.getSelection(); if(!sel.rangeCount) return;
  (sel.getRangeAt(0).commonAncestorContainer.parentElement||editor)
    .querySelectorAll('a').forEach(a=>{
      const t=document.createTextNode(a.textContent||''); a.parentNode.replaceChild(t,a);
    });
  editor.focus();
});
$('#applyForeColor')?.addEventListener('click', ()=>document.execCommand('foreColor',false,$('#foreColor').value));
$('#applyHiliteColor')?.addEventListener('click', ()=>document.execCommand('hiliteColor',false,$('#hiliteColor').value));

/* ========== Event wiring ========== */
window.addEventListener('load', async ()=>{
  // Knappkopplingar
  $('#unlockBtn').onclick = unlock;
  $('#lockBtn').onclick = lock;

  $('#newEntryBtn').onclick = newEntry;
  $('#saveBtn').onclick = saveCurrent;
  $('#deleteBtn').onclick = deleteCurrent;

  $('#exportBtn')?.addEventListener('click', exportAll);
  $('#importFile')?.addEventListener('change', e=>importAll(e.target.files[0]));
  $('#wipeLocalBtn')?.addEventListener('click', wipeLocal);

  $('#menuBtn')?.addEventListener('click', ()=>{
  if (document.body.classList.contains('locked')) return; // blockera när låst
  const d = $('#menuDrop'); d.hidden = !d.hidden;
});
    const d=$('#menuDrop'); d.hidden = !d.hidden;
 $('#wipeLocalOnLock')?.addEventListener('click', wipeLocal);
  });
  document.body.addEventListener('click', e=>{
    if(e.target.id==='menuBtn' || e.target.closest('.dropdown')) return;
    closeMenu();
  });

  // Lås direkt vid start
  lock();
});
