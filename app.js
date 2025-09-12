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
function setStatus(msg){ document.getElementById('status').textContent = msg || ''; }
function showLock(){ document.getElementById('lockscreen').classList.add('lock'); }
function hideLock(){ document.getElementById('lockscreen').classList.remove('lock'); }

async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw || '').trim();
    if (pass.length < 1){ setStatus('Skriv ett lösenord.'); return; }

    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, { ok:true });

    await dbPut('meta', { k:'wrap', salt, test });
    state.key = key;

    setStatus('Lösen satt ✔');
    hideLock();
    await renderList();
  }catch(err){
    console.error('setInitialPass error:', err);
    setStatus('Kunde inte sätta lösen.');
  }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw || '').trim();
    if (pass.length < 1){ setStatus('Skriv ditt lösenord.'); return; }

    const meta = await dbGet('meta','wrap');
    if (!meta){ setStatus('Inget lösen valt ännu. Välj “Sätt nytt lösen”.'); return; }

    const key = await deriveKey(pass, meta.salt);
    await decObj(key, meta.test); // verifiera

    state.key = key;
    setStatus('');
    hideLock();
    await renderList();
  }catch(err){
    console.error('unlock error:', err);
    setStatus('Fel lösenord.');
  }
}

/* ---------- Wire up (på load) ---------- */
window.addEventListener('load', () => {
  const passEl = document.getElementById('pass');

  // Låsskärm
  document.getElementById('setPassBtn').onclick = () => setInitialPass(passEl.value);
  document.getElementById('unlockBtn').onclick  = () => unlock(passEl.value);
  document.getElementById('wipeLocalOnLock').onclick = async () => {
    if (confirm('Rensa all lokal data?')){
      await dbClearAll();
      alert('Allt rensat.');
      setStatus('');
      showLock();
    }
  };

  // Editor/CRUD
  document.getElementById('newBtn').onclick    = () => { state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus(); };
  document.getElementById('saveBtn').onclick   = saveEntry;
  document.getElementById('deleteBtn').onclick = delEntry;
  document.getElementById('lockBtn').onclick   = lock;

  // Toolbar
  document.getElementById('boldBtn').onclick      = () => document.execCommand('bold', false, null);
  document.getElementById('italicBtn').onclick    = () => document.execCommand('italic', false, null);
  document.getElementById('underlineBtn').onclick = () => document.execCommand('underline', false, null);
  document.getElementById('colorBtn').oninput     = e => document.execCommand('foreColor', false, e.target.value);

  // Meny
  document.getElementById('menuToggle').onclick = () => {
    const m = document.getElementById('menu');
    m.classList.toggle('open');
    m.setAttribute('aria-hidden', m.classList.contains('open') ? 'false' : 'true');
  };
  document.getElementById('exportBtn').onclick  = exportAll;
  document.getElementById('importBtn').onclick  = () => document.getElementById('importInput').click();
  document.getElementById('importInput').onchange = e => { if (e.target.files[0]) importAll(e.target.files[0]); };
  document.getElementById('wipeBtn').onclick    = async () => {
    if (confirm('Rensa all lokal data?')){
      await dbClearAll();
      state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
      await renderList();
      showLock();
      setStatus('Allt rensat.');
    }
  };

  // Font
  const fontSel = document.getElementById('fontSelect');
  const savedFont = localStorage.getItem('rd_font');
  if (savedFont){ editor.style.fontFamily = savedFont; fontSel.value = savedFont; }
  fontSel.onchange = e => { editor.style.fontFamily = e.target.value; localStorage.setItem('rd_font', e.target.value); };

  // Start i låst läge
  showLock();
});
