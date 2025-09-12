// ===== Helper =====
const $ = sel => document.querySelector(sel);

// IndexedDB fallback till localStorage
const DB_NAME = 'retro-diary';
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      db = e.target.result;
      db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('meta');
    };
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror = e => reject(e);
  });
}
async function put(store, key, val) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}
async function get(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}
async function getAll(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}
async function del(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}
async function clear(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

// ===== Crypto =====
const enc = new TextEncoder();
const dec = new TextDecoder();

function buf2hex(buf) {
  return [...new Uint8Array(buf)]
    .map(x => x.toString(16).padStart(2, '0')).join('');
}
function hex2u8(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

async function deriveKey(pass, salt) {
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt','decrypt']
  );
}
async function encObj(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, data);
  return { iv: buf2hex(iv), ct: buf2hex(ct) };
}
async function decObj(key, wrap) {
  const iv = hex2u8(wrap.iv);
  const ct = hex2u8(wrap.ct);
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}

// ===== State =====
let currentKey = null;
let currentEntry = null;

// ===== Lock / Unlock =====
async function setInitialPass() {
  const pass = $('#pass').value.trim();
  if (!pass) return $('#status').textContent = 'Inget lösenord angivet.';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass, salt);
  const testWrap = await encObj(key, { test:'ok' });
  await put('meta','wrap',{ salt:buf2hex(salt), test:testWrap });
  currentKey = key;
  hideLock();
  renderList();
}

async function unlock() {
  const pass = $('#pass').value.trim();
  const meta = await get('meta','wrap');
  if (!meta) return $('#status').textContent = 'Inget lösen sparat.';
  try {
    const key = await deriveKey(pass, hex2u8(meta.salt));
    await decObj(key, meta.test);
    currentKey = key;
    hideLock();
    renderList();
  } catch(e) {
    $('#status').textContent = 'Fel lösenord.';
  }
}

function lock() {
  currentKey = null;
  $('#editor').innerHTML = '';
  $('#entriesList').innerHTML = '';
  showLock();
}

function showLock(){ $('#lockscreen').style.display='flex'; }
function hideLock(){ $('#lockscreen').style.display='none'; $('#app').hidden=false; }

// ===== Entries =====
async function renderList() {
  const list = $('#entriesList');
  list.innerHTML='';
  const entries = await getAll('entries');
  for(const e of entries){
    const li = document.createElement('li');
    li.textContent = e.title || 'Namnlös';
    li.onclick = async ()=>{
      currentEntry = e;
      const plain = await decObj(currentKey, e.wrap);
      $('#editor').innerHTML = plain.html;
    };
    list.appendChild(li);
  }
}

async function saveEntry() {
  const html = $('#editor').innerHTML;
  const title = html.replace(/<[^>]+>/g,'').slice(0,20);
  const wrap = await encObj(currentKey, { html });
  if(currentEntry){
    await put('entries', currentEntry.id, { ...currentEntry, title, wrap });
  } else {
    await put('entries', Date.now(), { id:Date.now(), title, wrap });
  }
  currentEntry = null;
  $('#editor').innerHTML='';
  renderList();
}
async function deleteEntry(){
  if(currentEntry){
    await del('entries', currentEntry.id);
    currentEntry=null;
    $('#editor').innerHTML='';
    renderList();
  }
}

// ===== Import / Export / Wipe =====
async function exportData(){
  const entries = await getAll('entries');
  const blob = new Blob([JSON.stringify(entries)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importData(file){
  const text = await file.text();
  const arr = JSON.parse(text);
  for(const e of arr){ await put('entries', e.id, e); }
  renderList();
}
async function wipeAll(){
  await clear('entries'); await clear('meta');
  location.reload();
}

// ===== UI Wiring =====
window.addEventListener('load', async ()=>{
  await openDB();

  $('#setPassBtn').onclick=setInitialPass;
  $('#unlockBtn').onclick=unlock;
  $('#lockBtn').onclick=lock;
  $('#saveBtn').onclick=saveEntry;
  $('#newBtn').onclick=()=>{ currentEntry=null; $('#editor').innerHTML=''; };
  $('#deleteBtn').onclick=deleteEntry;
  $('#exportBtn').onclick=exportData;
  $('#importBtn').onclick=()=>$('#importInput').click();
  $('#importInput').onchange=e=>importData(e.target.files[0]);
  $('#wipeBtn').onclick=wipeAll;
  $('#wipeLocalOnLock').onclick=wipeAll;

  $('#menuToggle').onclick=()=>$('#menu').classList.toggle('show');

  $('#fontSelect').onchange=e=>{
    $('#editor').style.fontFamily=e.target.value;
    localStorage.setItem('rd_font', e.target.value);
  };
  const savedFont=localStorage.getItem('rd_font');
  if(savedFont) $('#editor').style.fontFamily=savedFont;

  $('#forceUpdateBtn').onclick=async()=>{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      for(const r of regs) await r.unregister();
    }
    caches.keys().then(keys=>keys.forEach(k=>caches.delete(k)));
    location.reload(true);
  };
});
