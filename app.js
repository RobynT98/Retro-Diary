/* ============ Små hjälpare ============ */
const $ = (sel, parent=document) => parent.querySelector(sel);
const $$ = (sel, parent=document) => [...parent.querySelectorAll(sel)];
const byId = id => document.getElementById(id);
const passEl = () => byId('passInput');
const editor = byId('editor');
const dateLine = byId('dateLine');

/* ============ State ============ */
const state = {
  key:null,
  currentId:null,              // id på aktiv sida
  autoSaveTimer:null,
  symbols: "🕯️ 🕊️ ❤️ ⭐ 🌿 🌸 ✨ ☀️ 🌙 🖤".split(' ')
};

/* ============ IndexedDB wrapper ============ */
const DB_NAME='retro-diary';
const DB_VER =1;

function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = ()=>{
      const db=r.result;
      db.createObjectStore('meta',   {keyPath:'k'});
      db.createObjectStore('entries',{keyPath:'id'});
    };
    r.onsuccess=()=>res(r.result);
    r.onerror =()=>rej(r.error);
  });
}
async function dbPut(store, obj){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(obj);
    tx.oncomplete=res; tx.onerror=()=>rej(tx.error);
  });
  db.close();
}
async function dbGet(store, key){
  const db = await openDB();
  const val = await new Promise((res,rej)=>{
    const tx=db.transaction(store,'readonly');
    const req=tx.objectStore(store).get(key);
    req.onsuccess=()=>res(req.result);
    req.onerror =()=>rej(req.error);
  });
  db.close(); return val;
}
async function dbAll(store){
  const db = await openDB();
  const out = await new Promise((res,rej)=>{
    const tx=db.transaction(store,'readonly');
    const req=tx.objectStore(store).getAll();
    req.onsuccess=()=>res(req.result||[]);
    req.onerror =()=>rej(req.error);
  });
  db.close(); return out;
}
async function dbDel(store, key){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete=res; tx.onerror=()=>rej(tx.error);
  });
  db.close();
}
async function dbClearAll(){
  const db = await openDB();
  await new Promise((res,rej)=>{
    const tx=db.transaction(['meta','entries'],'readwrite');
    tx.objectStore('meta').clear(); tx.objectStore('entries').clear();
    tx.oncomplete=res; tx.onerror=()=>rej(tx.error);
  });
  db.close();
}

/* ============ Kryptering ============ */
const enc = new TextEncoder(); const dec = new TextDecoder();
function buf2hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hex2buf(str){ return new Uint8Array(str.match(/.{1,2}/g).map(b=>parseInt(b,16))).buffer; }

async function deriveKey(pass, saltHex){
  const salt = hex2buf(saltHex);
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'},
    baseKey,
    {name:'AES-GCM', length:256},
    false, ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(JSON.stringify(obj)));
  return {iv:buf2hex(iv), ct:buf2hex(ct)};
}
async function decObj(key, wrap){
  const iv = hex2buf(wrap.iv), data=hex2buf(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:new Uint8Array(iv)}, key, data);
  return JSON.parse(dec.decode(pt));
}

/* Wrap meta (salt + test) i både IDB + LS */
async function setWrapMeta(w){ await dbPut('meta', {k:'wrap', salt:w.salt, test:w.test}); localStorage.setItem('wrap', JSON.stringify(w)); }
async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw ? JSON.parse(raw) : null;
}
async function clearWrapMeta(){ await dbClearAll(); localStorage.removeItem('wrap'); }

/* ============ UI hjälp ============ */
function setStatus(msg){ byId('status').textContent=msg||''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

/* ============ Lösen ============ */
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
  }catch(e){ setStatus('Kunde inte sätta lösen.'); alert('Fel setInitialPass: '+(e?.message||e)); }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta = await getWrapMeta();
    if(!meta){ setStatus('Välj “Sätt nytt lösen”.'); return; }
    const key = await deriveKey(pass, meta.salt);
    await decObj(key, meta.test); // verifiering
    state.key = key; setStatus(''); hideLock(); await renderList();
  }catch(e){ setStatus('Upplåsning misslyckades.'); alert('Fel unlock: '+(e?.message||e)); }
}

function lock(){
  state.key=null; state.currentId=null;
  editor.innerHTML=''; dateLine.textContent=''; byId('titleInput').value='';
  showLock(); setStatus(''); setTimeout(()=>passEl()?.focus(), 50);
}

/* ============ Autospara ============ */
function scheduleAutoSave(){
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer=setTimeout(()=>saveEntry(true), 1200);
}

/* ============ Entry CRUD ============ */
function titleFrom(html, fallback='Anteckning'){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t = (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80);
  return t || fallback;
}
function collectTags(){
  const tags=[];
  if(byId('tagMem').checked) tags.push('minnesdag');
  if(byId('tagFav').checked) tags.push('favorit');
  if(byId('tagImp').checked) tags.push('viktigt');
  return tags;
}
function applyTagsUI(tags=[]){
  byId('tagMem').checked = tags.includes('minnesdag');
  byId('tagFav').checked = tags.includes('favorit');
  byId('tagImp').checked = tags.includes('viktigt');
}

async function saveEntry(isAuto=false){
  if(!state.key){ if(!isAuto) alert('Lås upp först.'); return; }
  const id  = state.currentId || Date.now();
  const obj = {
    id,
    title: byId('titleInput').value.trim() || titleFrom(editor.innerHTML),
    html: editor.innerHTML,
    date: new Date().toLocaleString(),
    tags: collectTags(),
    updated: Date.now()
  };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:obj.updated, title:obj.title, tags:obj.tags });
  state.currentId = id;
  if(!isAuto) alert('Sparat.');
  await renderList();
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; byId('titleInput').value='';
  await renderList();
}

async function renderList(){
  const list = byId('entriesList'); if(!list) return;
  list.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));

  // filtrering
  const q = byId('searchInput').value.trim().toLowerCase();
  const t = byId('tagFilter').value;

  for(const e of all){
    let title=e.title||new Date(e.updated||e.id).toLocaleString();
    if(q && !title.toLowerCase().includes(q)) continue;
    if(t && !(e.tags||[]).includes(t)) continue;

    const li=document.createElement('li');
    li.innerHTML = `<span>${title}</span> <span class="tags">${(e.tags||[]).join(', ')}</span>`;
    li.onclick = async ()=>{
      const decd = await decObj(state.key, e.wrap);
      state.currentId = decd.id;
      editor.innerHTML = decd.html;
      dateLine.textContent = decd.date;
      byId('titleInput').value = decd.title || '';
      applyTagsUI(decd.tags||[]);
      editor.focus();
    };
    list.appendChild(li);
  }
}

/* ============ Export/Import/Wipe ============ */
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

/* ============ Rich actions ============ */
function exec(cmd, val=null){ document.execCommand(cmd, false, val); editor.focus(); }

function setBlock(tag){
  // Byt blocktyp kring caret / markering
  exec('formatBlock', tag);
}

function setAlign(which){
  const map={L:'justifyLeft', C:'justifyCenter', R:'justifyRight', J:'justifyFull'};
  exec(map[which]);
}

function setColor(input, isBg=false){
  const v=input.value;
  exec(isBg ? 'hiliteColor' : 'foreColor', v);
}

function insertLink(){
  const url = prompt('Länk (https://…):');
  if(!url) return;
  exec('createLink', url);
}

function insertImage(){
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='image/*';
  inp.onchange = ()=>{
    const f = inp.files[0]; if(!f) return;
    const url = URL.createObjectURL(f);
    const img = document.createElement('img');
    img.src=url; img.className='img-m center';
    const sel = window.getSelection(); const r=sel.getRangeAt(0);
    r.insertNode(img); r.collapse(false);
    scheduleAutoSave();
  };
  inp.click();
}

function insertAudio(){
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='audio/*';
  inp.onchange = ()=>{
    const f = inp.files[0]; if(!f) return;
    const url = URL.createObjectURL(f);
    const el = document.createElement('audio');
    el.controls=true; el.src=url;
    const sel = window.getSelection(); const r=sel.getRangeAt(0);
    r.insertNode(el); r.collapse(false);
    scheduleAutoSave();
  };
  inp.click();
}

function symbolPalette(){
  const menu = document.createElement('div');
  menu.style.position='absolute'; menu.style.zIndex=2000;
  menu.style.background='#fff'; menu.style.border='1px solid #aaa';
  menu.style.borderRadius='8px'; menu.style.padding='6px';
  menu.style.boxShadow='0 4px 16px rgba(0,0,0,.20)';
  state.symbols.forEach(s=>{
    const b=document.createElement('button');
    b.textContent=s; b.className='btn small';
    b.onclick=()=>{ exec('insertText', s+' '); menu.remove(); };
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const rect = byId('symBtn').getBoundingClientRect();
  menu.style.left = (rect.left)+'px';
  menu.style.top  = (rect.bottom+4)+'px';
  document.addEventListener('click', ()=>menu.remove(), {once:true});
}

function setImgSize(cls){
  const img = editor.querySelector('img:is(:focus, .selected)') || getClosestImageAtSelection();
  if(!img) return alert('Markera/klicka på bilden först.');
  img.classList.remove('img-s','img-m','img-l');
  img.classList.add(cls);
}
function centerImg(){
  const img = editor.querySelector('img:is(:focus, .selected)') || getClosestImageAtSelection();
  if(!img) return alert('Markera/klicka på bilden först.');
  img.classList.toggle('center');
}
function getClosestImageAtSelection(){
  const sel=window.getSelection(); if(!sel.rangeCount) return null;
  let node=sel.anchorNode; if(node?.nodeType===3) node=node.parentElement;
  return node?.closest('img');
}

/* ============ Tema + font ============ */
function applyTheme(themeCls){
  document.body.classList.remove('theme-dark','theme-light');
  document.body.classList.add(themeCls);
  localStorage.setItem('rd_theme', themeCls);
}
function populateFonts(){
  const sel = byId('fontSelect'); sel.innerHTML='';
  (window.FONT_DB||[]).forEach(f=>{
    const o=document.createElement('option'); o.value=f.stack; o.textContent=f.name; sel.appendChild(o);
    window.loadFontCSS(f.css);
  });
  const saved = localStorage.getItem('rd_font');
  if(saved){ editor.style.fontFamily=saved; sel.value=saved; }
}

/* ============ Wire up ============ */
window.addEventListener('load', ()=>{
  // toolbar basic
  $$('#toolbar [data-cmd]').forEach(b=> b.addEventListener('click', ()=>exec(b.dataset.cmd)));
  byId('alignL').onclick=()=>setAlign('L');
  byId('alignC').onclick=()=>setAlign('C');
  byId('alignR').onclick=()=>setAlign('R');
  byId('justify').onclick=()=>setAlign('J');
  byId('blockType').onchange=e=>setBlock(e.target.value);
  byId('ulBtn').onclick=()=>exec('insertUnorderedList');
  byId('olBtn').onclick=()=>exec('insertOrderedList');
  byId('colorBtn').oninput=e=>setColor(e.target,false);
  byId('hlBtn').oninput=e=>setColor(e.target,true);
  byId('linkBtn').onclick=insertLink;
  byId('imgBtn').onclick=insertImage;
  byId('audioBtn').onclick=insertAudio;
  byId('symBtn').onclick=symbolPalette;
  byId('undoBtn').onclick=()=>exec('undo');
  byId('redoBtn').onclick=()=>exec('redo');
  byId('clearFormat').onclick=()=>exec('removeFormat');

  byId('imgSize').onchange=e=>setImgSize(e.target.value);
  byId('imgCenter').onclick=centerImg;

  // CRUD
  byId('newBtn').onclick=()=>{ state.currentId=null; editor.innerHTML=''; byId('titleInput').value=''; dateLine.textContent=''; editor.focus(); };
  byId('saveBtn').onclick=()=>saveEntry(false);
  byId('deleteBtn').onclick=delEntry;
  byId('lockBtn').onclick=lock;

  // Meny
  byId('menuToggle').onclick=()=>{ const m=byId('menu'); m.classList.toggle('open'); m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true'); };
  byId('exportBtn').onclick=exportAll;
  byId('importBtn').onclick=()=>byId('importInput').click();
  byId('importInput').addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn').onclick=wipeAll;

  // Sök/filtrera
  byId('searchInput').oninput=renderList;
  byId('tagFilter').onchange=renderList;

  // Tema
  const savedTheme = localStorage.getItem('rd_theme') || 'theme-dark';
  applyTheme(savedTheme);
  byId('themeSelect').value=savedTheme;
  byId('themeSelect').onchange=e=>applyTheme(e.target.value);

  // Font
  populateFonts();
  byId('fontSelect').onchange=e=>{
    editor.style.fontFamily = e.target.value;
    localStorage.setItem('rd_font', e.target.value);
  };

  // Autospara
  editor.addEventListener('input', scheduleAutoSave);
  byId('titleInput').addEventListener('input', scheduleAutoSave);
  $$('input[type=checkbox]', byId('rightPage')).forEach(c=>c.addEventListener('change', scheduleAutoSave));

  // Lås
  byId('setPassBtn').onclick = ()=>setInitialPass(passEl().value);
  byId('unlockBtn').onclick  = ()=>unlock(passEl().value);
  byId('wipeLocalOnLock').onclick = wipeAll;

  // Force update
  byId('forceUpdateBtn').addEventListener('click', async ()=>{
    try{
      if('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
      if('caches' in window){
        const names=await caches.keys();
        await Promise.all(names.map(n=>caches.delete(n)));
      }
      alert('Appen uppdateras – laddar om…'); location.reload(true);
    }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
  });

  // Start
  showLock();
});
