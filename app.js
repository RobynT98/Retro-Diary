// Retro Diary - Book Lite

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();

function buf2hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hex2buf(hex){ const a=new Uint8Array(hex.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a.buffer; }

/* ---------- IndexedDB ---------- */
let _db;
function openDB(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const req = indexedDB.open('retro-diary-book',1);
    req.onupgradeneeded = e=>{
      const d=e.target.result;
      d.createObjectStore('meta',{keyPath:'k'});
      d.createObjectStore('entries',{keyPath:'id'});
    };
    req.onsuccess = e=>{ _db=e.target.result; res(_db); };
    req.onerror = e=>rej(e);
  });
}
async function dbPut(store, obj){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}
async function dbGet(store, key){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readonly');
    const r=tx.objectStore(store).get(key);
    r.onsuccess=()=>res(r.result||null);
    r.onerror=()=>rej(r.error);
  });
}
async function dbAll(store){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,'readonly');
    const r=tx.objectStore(store).getAll();
    r.onsuccess=()=>res(r.result||[]);
    r.onerror=()=>rej(r.error);
  });
}
async function dbClearAll(){
  const d = await openDB();
  return new Promise((res,rej)=>{
    const tx=d.transaction(['meta','entries'],'readwrite');
    tx.objectStore('meta').clear();
    tx.objectStore('entries').clear();
    tx.oncomplete=()=>res();
    tx.onerror=()=>rej(tx.error);
  });
}

/* ---------- Crypto ---------- */
async function deriveKey(pass, saltHex){
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:hex2buf(saltHex), iterations:200000, hash:'SHA-256' },
    keyMat,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(JSON.stringify(obj)));
  return { iv: buf2hex(iv), ct: buf2hex(ct) };
}
async function decObj(key, wrap){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:hex2buf(wrap.iv)}, key, hex2buf(wrap.ct));
  return JSON.parse(dec.decode(pt));
}

/* ---------- State ---------- */
const state = { key:null, currentId:null };
const editor = byId('editor');
const dateLine = byId('dateLine');
const listEl = byId('entriesList');

/* ---------- Lock / Unlock ---------- */
async function setInitialPass(pass){
  if(!pass) return setStatus('Ange ett nytt lösenord.');
  const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
  const key  = await deriveKey(pass, salt);
  const test = await encObj(key,{ok:true});
  await dbPut('meta',{k:'wrap', salt, test});
  state.key = key;
  hideLock();
  await renderList();
}
async function unlock(pass){
  const meta = await dbGet('meta','wrap');
  if(!meta) return setStatus('Inget lösen valt ännu. Sätt nytt först.');
  try{
    const key = await deriveKey(pass, meta.salt);
    await decObj(key, meta.test); // test decrypt
    state.key = key;
    hideLock();
    await renderList();
  }catch(e){
    setStatus('Fel lösenord.');
  }
}
function lock(){
  state.key=null; state.currentId=null;
  editor.innerHTML=''; dateLine.textContent='';
  showLock();
}

/* ---------- UI helpers ---------- */
function setStatus(msg){ byId('status').textContent = msg||''; }
function showLock(){ byId('lockscreen').classList.add('lock'); }
function hideLock(){ byId('lockscreen').classList.remove('lock'); }

/* ---------- Entries ---------- */
function firstTitle(html){
  const div=document.createElement('div'); div.innerHTML=html||'';
  const text = (div.textContent||'').trim();
  return (text.split(/\n/)[0]||'Ny sida').slice(0,80);
}
async function saveEntry(){
  if(!state.key) return alert('Lås upp först.');
  const id = state.currentId || Date.now();
  const html = editor.innerHTML;
  const rec = { id, title:firstTitle(html), date:new Date().toLocaleString('sv-SE'), html };
  const wrap = await encObj(state.key, rec);
  await dbPut('entries', { id, wrap });
  state.currentId = id;
  await renderList();
}
async function renderList(){
  listEl.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=>b.id-a.id);
  for(const e of all){
    const li = document.createElement('li');
    try{
      const item = await decObj(state.key, e.wrap);
      li.textContent = `${new Date(item.id).toLocaleDateString('sv-SE')} — ${item.title}`;
      li.onclick = async ()=>{
        const item2 = await decObj(state.key, e.wrap);
        state.currentId = item2.id;
        editor.innerHTML = item2.html;
        dateLine.textContent = item2.date;
      };
    }catch{
      li.textContent = '— krypterad sida (låst) —';
      li.style.opacity='.6';
    }
    listEl.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  const d = await openDB();
  await new Promise((res,rej)=>{
    const tx=d.transaction('entries','readwrite');
    tx.objectStore('entries').delete(state.currentId);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
  state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList();
}

/* ---------- Export / Import ---------- */
async function exportAll(){
  const meta = await dbGet('meta','wrap');
  const entries = await dbAll('entries');
  const blob = new Blob([JSON.stringify({meta,entries})],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt = await file.text();
  const data = JSON.parse(txt);
  if(!data || !data.meta || !data.entries) return alert('Ogiltig fil.');
  await dbPut('meta', data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Import klart.');
  await renderList();
}

/* ---------- Menu / Toolbar / Font ---------- */
function toggleMenu(){
  const m = byId('menu');
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open') ? 'false' : 'true');
}
function execCmd(cmd,val=null){ document.execCommand(cmd,false,val); }

/* ---------- Events ---------- */
window.addEventListener('load', ()=>{
  // låsskärm
  byId('setPassBtn').onclick = ()=>setInitialPass(byId('pass').value);
  byId('unlockBtn').onclick  = ()=>unlock(byId('pass').value);
  byId('wipeLocalOnLock').onclick = async()=>{ if(confirm('Rensa all lokal data?')){ await dbClearAll(); alert('Allt rensat.'); } };

  // editor/CRUD
  byId('newBtn').onclick    = ()=>{ state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus(); };
  byId('saveBtn').onclick   = saveEntry;
  byId('deleteBtn').onclick = delEntry;
  byId('lockBtn').onclick   = lock;

  // toolbar
  byId('boldBtn').onclick      = ()=>execCmd('bold');
  byId('italicBtn').onclick    = ()=>execCmd('italic');
  byId('underlineBtn').onclick = ()=>execCmd('underline');
  byId('colorBtn').oninput     = e=>execCmd('foreColor', e.target.value);

  // meny
  byId('menuToggle').onclick = toggleMenu;
  byId('exportBtn').onclick  = exportAll;
  byId('importBtn').onclick  = ()=>byId('importInput').click();
  byId('importInput').onchange = e=>{ if(e.target.files[0]) importAll(e.target.files[0]); };
  byId('wipeBtn').onclick    = async()=>{ if(confirm('Rensa all lokal data?')){ await dbClearAll(); state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; await renderList(); } };

  // font (endast editor)
  const fontSel = byId('fontSelect');
  const savedFont = localStorage.getItem('rd_font');
  if(savedFont){ editor.style.fontFamily = savedFont; fontSel.value = savedFont; }
  fontSel.onchange = e=>{ editor.style.fontFamily = e.target.value; localStorage.setItem('rd_font', e.target.value); };

  // start i låst läge (om wrap finns kan man låsa upp)
  showLock();
});
