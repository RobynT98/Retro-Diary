// ===== Helpers =====
const $ = sel => document.querySelector(sel);
const deU8 = buf => new TextDecoder().decode(buf);
const enU8 = str => new TextEncoder().encode(str);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function toHex(u8){ return Array.from(u8).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function fromHex(str){ const a=new Uint8Array(str.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(str.substr(i*2,2),16); return a; }
function b64u(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function randBytes(n){ const a=new Uint8Array(n); crypto.getRandomValues(a); return a; }
function uuid(){ return crypto.randomUUID(); }

// ===== IndexedDB (entries/meta) =====
const DB = (() => {
  const ENTRIES='entries', META='meta';
  let db;
  function open(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open('retro-diary',3);
      req.onupgradeneeded = e=>{
        const d = e.target.result;
        if(!d.objectStoreNames.contains(ENTRIES)) d.createObjectStore(ENTRIES,{keyPath:'id'});
        if(!d.objectStoreNames.contains(META)) d.createObjectStore(META,{keyPath:'k'});
      };
      req.onsuccess = e=>{ db=e.target.result; resolve(db); };
      req.onerror = ()=>reject(req.error);
    });
  }
  async function put(store, value){
    if(!db) await open();
    if(!db){
      if(store===META) localStorage.setItem(value.k, JSON.stringify(value.v));
      else localStorage.setItem(value.id, JSON.stringify(value));
      return;
    }
    return new Promise((res,rej)=>{
      const tx = db.transaction(store,'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = ()=>res();
      tx.onerror = ()=>rej(tx.error);
    });
  }
  async function get(store, key){
    if(!db) await open();
    if(!db){
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }
    return new Promise((res,rej)=>{
      const tx = db.transaction(store,'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = ()=>res(req.result || null);
      req.onerror = ()=>rej(req.error);
    });
  }
  async function all(){
    if(!db) await open();
    if(!db){
      const items=[];
      for(const k of Object.keys(localStorage)){
        try{ const o=JSON.parse(localStorage.getItem(k)); if(o && o.id && o.cipher) items.push(o); }catch{}
      }
      return items;
    }
    return new Promise((res,rej)=>{
      const tx = db.transaction(ENTRIES,'readonly');
      const req = tx.objectStore(ENTRIES).getAll();
      req.onsuccess = ()=>res(req.result || []);
      req.onerror = ()=>rej(req.error);
    });
  }
  async function del(id){
    if(!db) await open();
    if(!db) return localStorage.removeItem(id);
    return new Promise((res,rej)=>{
      const tx = db.transaction(ENTRIES,'readwrite');
      tx.objectStore(ENTRIES).delete(id);
      tx.oncomplete = ()=>res();
      tx.onerror = ()=>rej(tx.error);
    });
  }
  return {open, put, get, all, del, putMeta:(k,v)=>put('meta',{k,v}), getMeta:(k)=>get('meta',k)};
})();

// ===== Crypto primitives =====
const CryptoBox = (() => {
  async function pbkdf2(pass, salt, iter=150000){
    const base = await crypto.subtle.importKey('raw', enU8(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      {name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'},
      base,
      {name:'AES-GCM', length:256},
      false,
      ['encrypt','decrypt']
    );
  }
  async function aesEncryptRaw(key, bytes){
    const iv = randBytes(12);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, bytes));
    return {iv: toHex(iv), cipher: toHex(cipher)};
  }
  async function aesDecryptRaw(key, payload){
    const iv = fromHex(payload.iv);
    const cipher = fromHex(payload.cipher);
    const buf = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, cipher);
    return new Uint8Array(buf);
  }
  return {pbkdf2, aesEncryptRaw, aesDecryptRaw};
})();

// ===== State =====
const state = { pass:null, dek:null, currentId:null, entries:[], bio:{ credId:null } };

// ===== UI refs =====
const listEl = $('#list');
const editor = $('#editor');
const dateLine = $('#dateLine');
const stamp = $('#stamp');
const lockscreen = $('#lockscreen');
const statusEl = $('#status');

// ===== Render helpers =====
function fmtDate(d){ return d.toLocaleString('sv-SE',{dateStyle:'full', timeStyle:'short'}); }
function firstLineAsTitle(html){
  // Plocka första text-raden (strippar HTML) som titel
  const tmp = document.createElement('div'); tmp.innerHTML = html || '';
  const text = (tmp.textContent || '').trim();
  return (text.split(/\n/)[0] || 'Omdirigerad tanke').slice(0,80);
}
function renderList(){
  listEl.innerHTML = '';
  const sorted = [...state.entries].sort((a,b)=>(b.updated||0)-(a.updated||0));
  for(const e of sorted){
    const div = document.createElement('div');
    div.className = 'entry-item';
    div.innerHTML = `
      <div>
        <div>${e.title || 'Omdirigerad tanke'}</div>
        <small>${new Date(e.updated||e.created).toLocaleString('sv-SE')}</small>
      </div>
      <button data-id="${e.id}" class="ghost">Öppna</button>
    `;
    div.querySelector('button').onclick = ()=>openEntry(e.id);
    listEl.appendChild(div);
  }
}
function setCurrentMeta({title, created, updated}){
  dateLine.textContent = title ? `${title}` : '';
  stamp.textContent = `${created ? 'Skapad: '+fmtDate(new Date(created)) : ''}${updated ? ' · Senast sparad: '+fmtDate(new Date(updated)) : ''}`;
}

// ===== DEK wrap / recovery =====
async function ensureDEKInitialized(pass){
  const wrap = await DB.getMeta('wrap_pass');
  if (wrap) return;

  const dek = randBytes(32);
  // pass-wrap
  const saltP = randBytes(16);
  const kP = await CryptoBox.pbkdf2(pass, saltP);
  const encP = await CryptoBox.aesEncryptRaw(kP, dek);
  await DB.putMeta('wrap_pass', { saltHex: toHex(saltP), payload: encP });

  // recovery
  const rc = makeRecoveryCode();
  const saltR = randBytes(16);
  const kR = await CryptoBox.pbkdf2(rc, saltR);
  const encR = await CryptoBox.aesEncryptRaw(kR, dek);
  await DB.putMeta('wrap_recovery', { saltHex: toHex(saltR), payload: encR });
  await DB.putMeta('recovery_code', rc);
  showRecovery(rc);
}
function makeRecoveryCode(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<16;i++) s += alphabet[Math.floor(Math.random()*alphabet.length)];
  return `${s.slice(0,4)}-${s.slice(4,8)}-${s.slice(8,12)}-${s.slice(12,16)}`;
}
async function loadDEK_withPass(pass){
  const wrap = await DB.getMeta('wrap_pass'); if(!wrap) throw new Error('wrap_pass saknas');
  const k = await CryptoBox.pbkdf2(pass, fromHex(wrap.saltHex));
  return CryptoBox.aesDecryptRaw(k, wrap.payload);
}
async function loadDEK_withRecovery(rc){
  const wrap = await DB.getMeta('wrap_recovery'); if(!wrap) throw new Error('wrap_recovery saknas');
  const k = await CryptoBox.pbkdf2(rc, fromHex(wrap.saltHex));
  return CryptoBox.aesDecryptRaw(k, wrap.payload);
}
async function rewrapPass(newPass, dek){
  const salt = randBytes(16);
  const k = await CryptoBox.pbkdf2(newPass, salt);
  const enc = await CryptoBox.aesEncryptRaw(k, dek);
  await DB.putMeta('wrap_pass', { saltHex: toHex(salt), payload: enc });
}
async function regenRecoveryWrap(dek){
  const rc = makeRecoveryCode();
  const salt = randBytes(16);
  const k = await CryptoBox.pbkdf2(rc, salt);
  const enc = await CryptoBox.aesEncryptRaw(k, dek);
  await DB.putMeta('wrap_recovery', { saltHex: toHex(salt), payload: enc });
  await DB.putMeta('recovery_code', rc);
  return rc;
}

// ===== Entry crypto with DEK =====
async function encryptWithDEK(plainU8){
  const key = await crypto.subtle.importKey('raw', state.dek, 'AES-GCM', false, ['encrypt']);
  const iv = randBytes(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, plainU8));
  return {iv: toHex(iv), cipher: toHex(cipher)};
}
async function decryptWithDEK(payload){
  const key = await crypto.subtle.importKey('raw', state.dek, 'AES-GCM', false, ['decrypt']);
  const iv = fromHex(payload.iv);
  const data = fromHex(payload.cipher);
  const buf = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, data);
  return new Uint8Array(buf);
}

// ===== CRUD entries (HTML in/out) =====
async function openEntry(id){
  const rec = state.entries.find(x=>x.id===id) || await DB.get('entries', id);
  if(!rec) return;
  try{
    const plain = await decryptWithDEK(rec.cipher);
    state.currentId = id;
    editor.innerHTML = deU8(plain);
    setCurrentMeta(rec);
  }catch{ alert('Kunde inte dekryptera.'); }
}
async function saveCurrent(){
  if(!state.dek){ alert('Dagboken är låst.'); return; }
  if(!state.currentId) state.currentId = uuid();
  const html = editor.innerHTML;
  const title = firstLineAsTitle(html);
  const created = (state.entries.find(e=>e.id===state.currentId)?.created) || Date.now();
  const cipher = await encryptWithDEK(enU8(html));
  const rec = { id: state.currentId, title, created, updated: Date.now(), cipher };
  await DB.put('entries', rec);
  const idx = state.entries.findIndex(e=>e.id===rec.id);
  if(idx>=0) state.entries[idx]=rec; else state.entries.push(rec);
  setCurrentMeta(rec); renderList();
}
async function deleteCurrent(){
  if(!state.currentId) return;
  if(!confirm('Radera den här sidan? Detta går inte att ångra.')) return;
  await DB.del(state.currentId);
  state.entries = state.entries.filter(e=>e.id!==state.currentId);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; stamp.textContent=''; renderList();
}

// ===== Lock / unlock =====
async function lock(){ state.pass=null; state.dek=null; lockscreen.hidden=false; editor.innerHTML=''; }
async function unlockWithPass(pass){
  statusEl.textContent='Låser upp...';
  try{
    await ensureDEKInitialized(pass);
    state.dek = await loadDEK_withPass(pass);
    state.pass = pass;
    state.entries = await DB.all();
    renderList(); lockscreen.hidden = true; statusEl.textContent='';
    if(!state.entries.length) newEntry();
  }catch(err){ statusEl.textContent = err.message || 'Fel lösenord.'; }
}
function newEntry(){
  state.currentId=null; editor.innerHTML='';
  const now = new Date();
  dateLine.textContent = now.toLocaleDateString('sv-SE',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  stamp.textContent='Ej sparad'; editor.focus();
}

// ===== Export / Import =====
async function exportAll(){
  if(!state.dek){ alert('Lås upp först.'); return; }
  const payload = {
    meta: {
      wrap_pass: await DB.getMeta('wrap_pass'),
      wrap_recovery: await DB.getMeta('wrap_recovery')
    },
    entries: state.entries
  };
  const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `retro-diary-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}
async function importAll(file){
  const text = await file.text();
  const json = JSON.parse(text);
  if(!json || !json.entries || !json.meta) return alert('Ogiltig fil.');
  await DB.putMeta('wrap_pass', json.meta.wrap_pass);
  await DB.putMeta('wrap_recovery', json.meta.wrap_recovery);
  for(const e of json.entries){ await DB.put('entries', e); }
  state.entries = await DB.all(); renderList();
  alert('Import klart.');
}

// ===== Recovery dialogs =====
function showRecovery(rc){ $('#recoveryCode').value = rc; $('#recoveryDialog').showModal(); }
async function getOrCreateRecovery(){
  let rc = await DB.getMeta('recovery_code');
  if(!rc){ if(!state.dek) return alert('Lås upp först.'); rc = await regenRecoveryWrap(state.dek); }
  showRecovery(rc);
}
async function openReset(){
  $('#rcInput').value=''; $('#newPass1').value=''; $('#newPass2').value=''; $('#resetStatus').textContent='';
  $('#resetDialog').showModal();
}
async function applyReset(){
  const rc=$('#rcInput').value.trim(), p1=$('#newPass1').value, p2=$('#newPass2').value;
  const out=$('#resetStatus');
  if(!rc || !p1 || p1!==p2){ out.textContent='Kontrollera fälten.'; return; }
  try{
    const dek = await loadDEK_withRecovery(rc);
    await rewrapPass(p1, dek);
    state.dek = dek; state.pass=p1; out.textContent='Lösenord uppdaterat.';
  }catch{ out.textContent='Fel återställningskod.'; }
}

// ===== Biometri (lokal bekvämlighet) =====
async function bioAvailable(){ return !!(window.PublicKeyCredential && navigator.credentials); }
async function bioRegister(){
  if(!(await bioAvailable())) return alert('Biometri/WebAuthn stöds inte här.');
  if(!state.dek) return alert('Lås upp först för att aktivera biometri.');
  const challenge = randBytes(32);
  const cred = await navigator.credentials.create({
    publicKey:{
      challenge,
      rp:{ name:'Retro Diary', id: location.hostname },
      user:{ id: randBytes(16), name:'user@retrodiary', displayName:'Retro Diary' },
      pubKeyCredParams:[{type:'public-key', alg:-7}],
      authenticatorSelection:{ authenticatorAttachment:'platform', userVerification:'required', residentKey:'preferred' },
      timeout:60000
    }
  });
  const credId = b64u(cred.rawId);
  await DB.putMeta('bio_cred', credId);
  await DB.putMeta('bio_enabled', true);

  // lokal kapsel
  const bioKeyRaw = randBytes(32);
  const key = await crypto.subtle.importKey('raw', bioKeyRaw, 'AES-GCM', false, ['encrypt','decrypt']);
  const iv = randBytes(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, state.dek));
  localStorage.setItem('bio_capsule', JSON.stringify({iv: toHex(iv), cipher: toHex(cipher)}));
  localStorage.setItem('bio_key', toHex(bioKeyRaw));
  alert('Biometrisk upplåsning aktiverad på denna enhet.');
}
async function bioDisable(){
  await DB.putMeta('bio_enabled', false);
  await DB.putMeta('bio_cred', null);
  localStorage.removeItem('bio_capsule'); localStorage.removeItem('bio_key');
  alert('Biometri avstängd.');
}
async function bioUnlock(){
  const enabled = await DB.getMeta('bio_enabled');
  const credId = await DB.getMeta('bio_cred');
  if(!enabled || !credId) return alert('Biometri ej aktiverad.');
  try{
    const allow=[{type:'public-key', id: Uint8Array.from(atob(credId.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0)) }];
    await navigator.credentials.get({ publicKey:{ challenge: randBytes(32), allowCredentials: allow, userVerification:'required', timeout:30000 }});
    const cap = localStorage.getItem('bio_capsule'); const khex=localStorage.getItem('bio_key');
    if(!cap || !khex) return alert('Ingen lokal bio-kapsel. Lås upp med lösenord och aktivera igen.');
    const key = await crypto.subtle.importKey('raw', fromHex(khex), 'AES-GCM', false, ['decrypt']);
    const obj = JSON.parse(cap);
    const dekBuf = await crypto.subtle.decrypt({name:'AES-GCM', iv: fromHex(obj.iv)}, key, fromHex(obj.cipher));
    state.dek = new Uint8Array(dekBuf); state.pass=null;
    state.entries = await DB.all(); renderList(); lockscreen.hidden=true; statusEl.textContent='';
    if(!state.entries.length) newEntry();
  }catch{ statusEl.textContent='Biometrisk upplåsning avbröts/misslyckades.'; }
}

// ===== RTF actions =====
function applyFormat(cmd, value=null){
  document.execCommand(cmd, false, value);
  editor.focus();
}
function setBlock(tag){
  document.execCommand('formatBlock', false, tag);
  editor.focus();
}
function insertLink(){
  const url = prompt('Länk (https://...)'); if(!url) return;
  document.execCommand('createLink', false, url);
  editor.focus();
}
function clearFormat(){
  document.execCommand('removeFormat', false, null);
  // ta bort länkar men behåll text
  const sel = window.getSelection(); if(!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType===1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  (ancestor || editor).querySelectorAll('a').forEach(a=>{
    const t = document.createTextNode(a.textContent || '');
    a.parentNode.replaceChild(t, a);
  });
  editor.focus();
}
function openIconPalette(){
  const dlg = $('#iconDialog');
  const grid = $('#iconGrid');
  if(!grid.dataset.loaded){
    const icons = "⭐️✨🔥💧🌿🌙☀️⚡️🧭📌📎📝📖💎🔒🔑🕯️🧿🎴🪄🏷️💬❤️🧠🌟🎯📅🗂️📍🧩🛡️⚙️🔗✅❌➕➖➡️⬅️⏳⌛️⏰🧭📷🎵🎧💡".split('');
    icons.forEach(ch=>{
      const b=document.createElement('button'); b.textContent=ch;
      b.onclick=()=>{ document.execCommand('insertText', false, ch); dlg.close(); editor.focus(); };
      grid.appendChild(b);
    });
    grid.dataset.loaded = '1';
  }
  dlg.showModal();
}

// ===== Events =====
document.addEventListener('DOMContentLoaded', ()=>{
  // unlock/lock
  $('#unlockBtn').onclick = ()=>unlockWithPass($('#pass').value);
  $('#bioUnlockBtn').onclick = bioUnlock;
  $('#lockBtn').onclick = lock;

  // CRUD
  $('#newEntryBtn').onclick = newEntry;
  $('#saveBtn').onclick = saveCurrent;
  $('#deleteBtn').onclick = deleteCurrent;

  // export/import/recovery
  $('#exportBtn')?.addEventListener('click', exportAll);
  $('#importFile')?.addEventListener('change', e=>importAll(e.target.files[0]));
  $('#showRecoveryBtn')?.addEventListener('click', getOrCreateRecovery);
  $('#resetPasswordBtn')?.addEventListener('click', openReset);
  $('#applyReset')?.addEventListener('click', applyReset);
  $('#cancelReset')?.addEventListener('click', ()=>$('#resetDialog').close());
  $('#copyRecovery')?.addEventListener('click', ()=>navigator.clipboard.writeText($('#recoveryCode').value));
  $('#regenRecovery')?.addEventListener('click', async ()=>{ if(!state.dek) return alert('Lås upp först.'); const rc=await regenRecoveryWrap(state.dek); $('#recoveryCode').value=rc; alert('Ny återställningskod skapad.'); });
  $('#closeRecovery')?.addEventListener('click', ()=>$('#recoveryDialog').close());

  // menu
  $('#menuBtn')?.addEventListener('click', ()=>{ const d=$('#menuDrop'); d.hidden = !d.hidden; });
  document.body.addEventListener('click', e=>{ if(e.target.id==='menuBtn' || e.target.closest('.dropdown')) return; $('#menuDrop')?.setAttribute('hidden',''); });

  // RTF bar
  document.querySelectorAll('[data-cmd]').forEach(b=>b.addEventListener('click', ()=>applyFormat(b.dataset.cmd, b.dataset.value||null)));
  document.querySelectorAll('[data-block]').forEach(b=>b.addEventListener('click', ()=>setBlock(b.dataset.block)));
  $('#insertLinkBtn').addEventListener('click', insertLink);
  $('#clearFormatBtn').addEventListener('click', clearFormat);
  $('#insertIconBtn').addEventListener('click', openIconPalette);
  $('#applyForeColor').addEventListener('click', ()=>applyFormat('foreColor', $('#foreColor').value));
  $('#applyHiliteColor').addEventListener('click', ()=>applyFormat('hiliteColor', $('#hiliteColor').value));
  $('#closeIconDlg').addEventListener('click', ()=>$('#iconDialog').close());

  // autosave
  setInterval(()=>{ if(state.dek && editor.innerHTML.trim()) saveCurrent(); }, 20000);

  lock(); // visa låsskärmen
});
