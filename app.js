/* ================= Utilities ================= */
const $ = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const debounce = (fn, ms=400) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function setStatus(msg){ const s=byId('status'); if(s) s.textContent = msg||''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

/* ================= IndexedDB ================= */
const DB_NAME='retro-diary'; const DB_VER=1;
let db;
function dbOpen(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e=>{
      const d = e.target.result;
      d.createObjectStore('meta',{keyPath:'k'});
      d.createObjectStore('entries',{keyPath:'id'});
    };
    r.onsuccess = ()=>{ db=r.result; res(); };
    r.onerror   = ()=>rej(r.error);
  });
}
function dbPut(store, obj){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(obj).onsuccess=()=>res(); tx.onerror=()=>rej(tx.error); }); }
function dbGet(store, key){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readonly'); const req=tx.objectStore(store).get(key); req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
function dbDel(store, key){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).delete(key).onsuccess=()=>res(); tx.onerror=()=>rej(tx.error); }); }
function dbAll(store){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readonly'); const req=tx.objectStore(store).getAll(); req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error); }); }
function dbClearAll(){ return new Promise((res,rej)=>{ const tx=db.transaction(['meta','entries'],'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('entries').clear(); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }

/* ================= Crypto (PBKDF2 + AES-GCM) ================= */
async function sha256(buf){ return await crypto.subtle.digest('SHA-256', buf); }
function str2buf(str){ return new TextEncoder().encode(str); }
function hex2buf(hex){ const a=new Uint8Array(hex.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a; }
function buf2hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }

async function deriveKey(pass, saltHex){
  const base = await crypto.subtle.importKey('raw', str2buf(pass), 'PBKDF2', false, ['deriveKey']);
  const key  = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: hex2buf(saltHex), iterations:120000, hash:'SHA-256'},
    base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
  return key;
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = str2buf(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv: buf2hex(iv), ct: buf2hex(new Uint8Array(ct)) };
}
async function decObj(key, wrap){
  const iv = hex2buf(wrap.iv);
  const ct = hex2buf(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ================= Wrap-meta ================= */
async function setWrapMeta(w){ await dbPut('meta', {k:'wrap', salt:w.salt, test:w.test}); localStorage.setItem('wrap', JSON.stringify(w)); }
async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw ? JSON.parse(raw) : null;
}
function normalizeWrap(w){ if(!w) return null; if(!w.salt && w.s) w.salt=w.s; return w; }
function validateWrap(w){ if(!w) return 'no-wrap'; if(!w.salt||!w.test) return 'bad-wrap'; return null; }

/* ================= State ================= */
const state = { key:null, currentId:null };
const editor = byId('editor');
const dateLine = byId('dateLine');

/* ================= Helpers: content ================= */
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t=(tmp.textContent||'').trim().split(/\n/)[0].slice(0,80);
  return t || 'Anteckning';
}

/* Insert at caret */
function insertHTML(html){
  document.execCommand('insertHTML', false, html);
}

/* ================= Media detection/insert ================= */
const YT_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w\-]+)/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const AUD_EXT = /\.(mp3|m4a|aac|ogg|wav|flac)$/i;

function toEmbedYouTube(url){
  const m = url.match(YT_RE);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function insertYouTube(url){
  const src = toEmbedYouTube(url);
  if(!src) return insertLink(url);
  insertHTML(
    `<iframe src="${src}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
  );
}

function insertLink(url){
  insertHTML(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

function insertImageDataURL(dataUrl, alt=''){
  insertHTML(`<img class="rd-img size-m" src="${dataUrl}" alt="${alt}">`);
}

function insertAudioDataURL(dataUrl){
  insertHTML(`<audio controls preload="metadata" src="${dataUrl}"></audio>`);
}

/* File → dataURL (persisterar i HTML) */
function fileToDataURL(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=()=>rej(fr.error); fr.readAsDataURL(file); }); }

/* Public URL detector */
function insertFromUrl(url){
  if(toEmbedYouTube(url)) return insertYouTube(url);
  if(IMG_EXT.test(url))   return insertImageDataURL(url);
  if(AUD_EXT.test(url))   return insertAudioDataURL(url);
  return insertLink(url);
}

/* Paste (bild/ljud från urklipp) */
editor.addEventListener('paste', async (e)=>{
  const items = e.clipboardData?.items || [];
  for(const it of items){
    if(it.type.startsWith('image/')){ e.preventDefault(); const f=it.getAsFile(); const d=await fileToDataURL(f); insertImageDataURL(d); return; }
    if(it.type.startsWith('audio/')){ e.preventDefault(); const f=it.getAsFile(); const d=await fileToDataURL(f); insertAudioDataURL(d); return; }
  }
});

/* Bild: cykla storlek + sätt alt */
editor.addEventListener('click', (e)=>{
  const img = e.target.closest('img.rd-img');
  if(!img) return;
  if(img.classList.contains('size-m')){ img.classList.remove('size-m'); img.classList.add('size-f'); }
  else if(img.classList.contains('size-f')){ img.classList.remove('size-f'); img.classList.add('size-s'); }
  else { img.classList.remove('size-s'); img.classList.add('size-m'); }
});

/* ================= CRUD ================= */
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id  = state.currentId || Date.now();
  const obj = { id, html:editor.innerHTML, date:new Date().toLocaleString(), title:titleFrom(editor.innerHTML) };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId = id;
  await renderList();
}

const autosave = debounce(saveEntry, 800);
editor.addEventListener('input', ()=>autosave());

async function renderList(){
  const list = byId('entries'); if(!list) return;
  list.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent = new Date(e.updated||e.id).toLocaleString();
    li.onclick = async ()=>{
      const dec = await decObj(state.key, e.wrap);
      state.currentId = dec.id;
      editor.innerHTML = dec.html;
      dateLine.textContent = dec.date;
      editor.focus();
    };
    list.appendChild(li);
  }
}

async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList();
}

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
  alert('Importerad.'); await renderList();
}

async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll(); localStorage.removeItem('wrap');
  state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

/* ================= Lock / Unlock ================= */
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({ salt, test });
    state.key = key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); alert('Fel setInitialPass: ' + (e?.message||e)); }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    let meta = await getWrapMeta(); meta = normalizeWrap(meta);
    const vErr = validateWrap(meta);
    if(vErr){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    setStatus('Kontrollerar…');
    const key = await deriveKey(pass, meta.salt);
    const probe = await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');
    state.key = key; setStatus(''); hideLock(); await renderList();
  }catch(e){ setStatus('Fel lösenord.'); console.error('unlock', e); }
}

function lock(){
  state.key=null; state.currentId=null;
  editor.innerHTML=''; dateLine.textContent='';
  showLock(); setStatus('');
  setTimeout(()=>byId('passInput')?.focus(), 50);
}

/* ================= Toolbar wiring ================= */
function execCmd(cmd, value=null){ document.execCommand(cmd,false,value); editor.focus(); }

window.addEventListener('load', async ()=>{
  await dbOpen();

  const passEl = byId('passInput');

  // toolbar
  $('#toolbar').addEventListener('click', e=>{
    const btn = e.target.closest('button[data-cmd]');
    if(btn){ execCmd(btn.dataset.cmd); }
  });
  byId('alignLeftBtn').onclick   = ()=>execCmd('justifyLeft');
  byId('alignCenterBtn').onclick = ()=>execCmd('justifyCenter');
  byId('alignRightBtn').onclick  = ()=>execCmd('justifyRight');

  byId('ulBtn').onclick = ()=>execCmd('insertUnorderedList');
  byId('olBtn').onclick = ()=>execCmd('insertOrderedList');

  byId('colorBtn').oninput = e=>execCmd('foreColor', e.target.value);
  byId('bgBtn').oninput    = e=>execCmd('hiliteColor', e.target.value);

  byId('hrBtn').onclick = ()=>insertHTML('<hr>');

  byId('undoBtn').onclick = ()=>document.execCommand('undo');
  byId('redoBtn').onclick = ()=>document.execCommand('redo');

  byId('blockType').onchange = e=>{
    const tag = e.target.value;
    if(tag==='p') execCmd('formatBlock','P'); else execCmd('formatBlock', tag.toUpperCase());
  };

  byId('linkBtn').onclick = async ()=>{
    const url = prompt('Klistra in länk (bild/ljud/YouTube/länk):');
    if(!url) return;
    insertFromUrl(url.trim());
  };

  byId('imgBtn').onclick = ()=>byId('pickImage').click();
  byId('audBtn').onclick = ()=>byId('pickAudio').click();

  byId('pickImage').addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const d = await fileToDataURL(f);
    const alt = prompt('Alt-text (beskrivning):','');
    insertImageDataURL(d, alt||'');
    e.target.value='';
  });

  byId('pickAudio').addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const d = await fileToDataURL(f);
    insertAudioDataURL(d);
    e.target.value='';
  });

  // fonts (från fonts_db.js)
  const sel = byId('fontSelect');
  if (window.FONT_DB && Array.isArray(window.FONT_DB)){
    sel.innerHTML = window.FONT_DB.map(f=>`<option value="${f.css}">${f.label}</option>`).join('');
  }
  sel.onchange = e=>{ editor.style.fontFamily = e.target.value; localStorage.setItem('rd_font', e.target.value); };
  const savedFont = localStorage.getItem('rd_font'); if(savedFont){ editor.style.fontFamily=savedFont; sel.value=savedFont; }

  // CRUD
  byId('newBtn').onclick   = ()=>{ state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus(); };
  byId('saveBtn').onclick  = saveEntry;
  byId('deleteBtn').onclick= delEntry;
  byId('lockBtn').onclick  = lock;

  // Meny
  byId('menuToggle').onclick = ()=>{
    const m = byId('menu');
    m.classList.toggle('open');
    m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
  };
  byId('exportBtn').onclick = exportAll;
  byId('importBtn').onclick = ()=>byId('importInput').click();
  byId('importInput').addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn').onclick = wipeAll;

  // Lås
  byId('setPassBtn').onclick = ()=>setInitialPass(passEl.value);
  byId('unlockBtn').onclick  = ()=>unlock(passEl.value);
  byId('wipeLocalOnLock').onclick = wipeAll;

  // Force update
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

  // Start
  showLock();
});
