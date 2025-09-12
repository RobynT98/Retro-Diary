// ===== Helpers =====
const $ = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const editor = byId('editor');
const titleInput = byId('titleInput');
const dateLine = byId('dateLine');

const state = { key:null, currentId:null, saveTimer:null, currentTags:[] };

const debounce = (fn,ms)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
const autosave = debounce(()=>saveEntry(false), 800);

function setStatus(t){ byId('status').textContent = t||''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

// ===== Tema =====
function applyTheme(mode){ document.body.classList.toggle('light', mode==='light'); localStorage.setItem('rd_theme', mode); }
function toggleTheme(){ const m = localStorage.getItem('rd_theme')==='light'?'dark':'light'; applyTheme(m); }
function applyEditorColors(){
  const paper = localStorage.getItem('rd_paper') || '';
  const ink   = localStorage.getItem('rd_ink')   || '';
  if(paper) document.documentElement.style.setProperty('--paper', paper);
  if(ink)   document.documentElement.style.setProperty('--ink',   ink);
}
function resetEditorColors(){
  localStorage.removeItem('rd_paper'); localStorage.removeItem('rd_ink');
  location.reload();
}

// ===== IndexedDB (fallback) =====
let idb=null;
function dbOpen(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('retro-diary',2);
    r.onupgradeneeded = e=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'k'});
      if(!db.objectStoreNames.contains('entries')) db.createObjectStore('entries',{keyPath:'id'});
    };
    r.onsuccess = ()=>{ idb = r.result; res(); };
    r.onerror = ()=>rej(r.error);
  });
}
async function dbPut(store,obj){ if(!idb) await dbOpen(); return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function dbGet(store,key){ if(!idb) await dbOpen(); return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readonly'); const q=tx.objectStore(store).get(key); q.onsuccess=()=>res(q.result||null); q.onerror=()=>rej(q.error); }); }
async function dbAll(store){ if(!idb) await dbOpen(); return new Promise((res,rej)=>{ const out=[]; const tx=idb.transaction(store,'readonly'); const c=tx.objectStore(store).openCursor(); c.onsuccess=()=>{ const cur=c.result; if(cur){ out.push(cur.value); cur.continue(); } else res(out); }; c.onerror=()=>rej(c.error); }); }
async function dbDel(store,key){ if(!idb) await dbOpen(); return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function dbClearAll(){ if(!idb) await dbOpen(); return new Promise((res,rej)=>{ const tx=idb.transaction(['meta','entries'],'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('entries').clear(); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }

// ===== Crypto =====
function hex2buf(h){ const a=new Uint8Array(h.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(h.substr(i*2,2),16); return a; }
function buf2hex(b){ return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
async function deriveKey(pass, saltHex){
  const enc = new TextEncoder();
  const salt = hex2buf(saltHex);
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'}, baseKey, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
async function encObj(key, obj){ const iv = crypto.getRandomValues(new Uint8Array(12)); const data = new TextEncoder().encode(JSON.stringify(obj)); const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data); return { iv: buf2hex(iv), ct: buf2hex(ct) }; }
async function decObj(key, w){ const iv=hex2buf(w.iv), ct=hex2buf(w.ct); const buf=await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct); return JSON.parse(new TextDecoder().decode(buf)); }

// wrap-meta + fallback
async function setWrapMeta(w){ await dbPut('meta', {k:'wrap', salt:w.salt, test:w.test}); localStorage.setItem('wrap', JSON.stringify(w)); }
async function getWrapMeta(){ try{ const m=await dbGet('meta','wrap'); if(m) return m; }catch{} const r=localStorage.getItem('wrap'); return r?JSON.parse(r):null; }

// ===== Lösenord =====
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim(); if(!pass) return setStatus('Skriv ett lösenord.');
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({salt,test}); state.key=key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch{ setStatus('Kunde inte sätta lösen.'); }
}
async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim(); if(!pass) return setStatus('Skriv ditt lösenord.');
    const meta = await getWrapMeta(); if(!meta?.salt||!meta?.test) return setStatus('Välj “Sätt nytt lösen” först.');
    setStatus('Kontrollerar…'); const key = await deriveKey(pass, meta.salt); const probe = await decObj(key, meta.test);
    if(!probe?.ok) throw new Error(); state.key=key; setStatus(''); hideLock(); await renderList();
  }catch{ setStatus('Fel lösenord.'); }
}
function lock(){ state.key=null; state.currentId=null; editor.innerHTML=''; titleInput.value=''; dateLine.textContent=''; state.currentTags=[]; renderTags(); showLock(); setStatus(''); setTimeout(()=>byId('passInput')?.focus(),50); }

// ===== Taggar =====
function renderTags(){
  const c = byId('tagChips'); c.innerHTML='';
  state.currentTags.forEach((t,i)=>{
    const el=document.createElement('span'); el.className='chip'; el.innerHTML=`#${t} <span class="x" title="ta bort">×</span>`;
    el.querySelector('.x').onclick=()=>{ state.currentTags.splice(i,1); renderTags(); autosave(); };
    c.appendChild(el);
  });
}
function ensureTagsInFilter(allEntries){
  const set=new Set(); allEntries.forEach(e=>{ (e.tags||[]).forEach(t=>set.add(t)); });
  const sel=byId('tagFilter'); const cur=sel.value; sel.innerHTML='<option value="">Alla taggar</option>' + [...set].sort().map(t=>`<option>${t}</option>`).join('');
  sel.value=cur||'';
}

// ===== CRUD =====
function entryTitle(){
  const t = (titleInput.value||'').trim();
  if(t) return t.slice(0,80);
  const tmp=document.createElement('div'); tmp.innerHTML=editor.innerHTML||'';
  return (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
}
async function saveEntry(manual){
  if(!state.key) return;
  const id = state.currentId || Date.now();
  const data = {
    id,
    title: entryTitle(),
    date: new Date().toLocaleString(),
    html: editor.innerHTML,
    tags: state.currentTags.slice()
  };
  const wrap = await encObj(state.key, data);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId = id;
  if(manual){ await renderList(); }
}
async function newEntry(){
  state.currentId=null; editor.innerHTML=''; titleInput.value=''; dateLine.textContent='';
  state.currentTags=[]; renderTags(); editor.focus();
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  await newEntry(); await renderList();
}
async function renderList(){
  const list = byId('entries'); list.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=> (b.updated||b.id)-(a.updated||a.id));
  ensureTagsInFilter(all);
  const q = (byId('searchInput').value||'').toLowerCase();
  const tf = (byId('tagFilter').value||'').trim();

  for(const e of all){
    let obj;
    try{ obj = await decObj(state.key, e.wrap); }catch{ continue; }

    // sök & tagfilter
    if(q){
      const hay = (obj.title+' '+obj.html.replace(/<[^>]+>/g,' ')).toLowerCase();
      if(!hay.includes(q)) continue;
    }
    if(tf && !(obj.tags||[]).includes(tf)) continue;

    const li=document.createElement('li');
    li.innerHTML = `<div><strong>${obj.title||'(utan titel)'}</strong></div>
                    <div style="opacity:.75">${obj.date}</div>`;
    li.onclick = ()=>{
      state.currentId = obj.id;
      editor.innerHTML = obj.html;
      titleInput.value = obj.title||'';
      dateLine.textContent = obj.date;
      state.currentTags = (obj.tags||[]).slice();
      renderTags();
      editor.focus();
    };
    list.appendChild(li);
  }
}

// ===== Export/Import/Wipe =====
async function exportAll(){
  const entries = await dbAll('entries'); const meta = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries})], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download='retro-diary.json'; a.click(); URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt = await file.text(); const data=JSON.parse(txt);
  if(!data.meta||!data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll(); localStorage.removeItem('wrap');
  state.key=null; await newEntry(); await renderList(); showLock(); setStatus('Allt rensat.');
}

// ===== Toolbar / redigering =====
function exec(cmd, val=null){ document.execCommand(cmd, false, val); editor.focus(); }
function applyHeading(tag){ exec('formatBlock', tag.toUpperCase()); }
function createLink(){ const url=prompt('Länk (inkl. https://):','https://'); if(url) exec('createLink', url); }
function insertHR(){ document.execCommand('insertHorizontalRule',false,null); }
function insertImage(){
  const choice = prompt('Skriv URL eller lämna tomt för att välja en bildfil:','');
  if(choice){ exec('insertImage', choice); return; }
  const input=document.createElement('input'); input.type='file'; input.accept='image/*';
  input.onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    const reader=new FileReader(); reader.onload=()=>exec('insertImage', reader.result); reader.readAsDataURL(f);
  };
  input.click();
}
function insertSymbol(){
  const preset = "• — – — ★ ✿ ❦ ♥ ☙ ☾ ☼ ✨ ☘ ♫ § ¶ † ‡ ∞ → ← ↑ ↓ ✓ ❧ ❝ ❞";
  const s = prompt("Skriv/klistra in symbol/emoji (tips):\n"+preset+"\n","★");
  if(s){ document.execCommand('insertText',false,s); }
}

function populateFontSelect(){
  const sel = byId('fontSelect'); sel.innerHTML = window.FONT_DB.map(f=>`<option value="${f.css}">${f.label}</option>`).join('');
  const saved = localStorage.getItem('rd_font_css') || window.FONT_DB[0].css;
  sel.value = saved; editor.style.fontFamily = saved;
  sel.addEventListener('change', e=>{ const css=e.target.value; editor.style.fontFamily=css; localStorage.setItem('rd_font_css', css); editor.focus(); });
}
function initToolbar(){
  byId('boldBtn')     .addEventListener('click', ()=>exec('bold'));
  byId('italicBtn')   .addEventListener('click', ()=>exec('italic'));
  byId('underlineBtn').addEventListener('click', ()=>exec('underline'));
  byId('strikeBtn')   .addEventListener('click', ()=>exec('strikeThrough'));

  byId('alignLeftBtn')  .addEventListener('click', ()=>exec('justifyLeft'));
  byId('alignCenterBtn').addEventListener('click', ()=>exec('justifyCenter'));
  byId('alignRightBtn') .addEventListener('click', ()=>exec('justifyRight'));

  byId('headingSel').addEventListener('change', e=>applyHeading(e.target.value));
  byId('ulBtn').addEventListener('click', ()=>exec('insertUnorderedList'));
  byId('olBtn').addEventListener('click', ()=>exec('insertOrderedList'));
  byId('hrBtn').addEventListener('click', insertHR);

  byId('colorBtn').addEventListener('input', e=>exec('foreColor', e.target.value));
  byId('bgBtn')   .addEventListener('input', e=>exec('hiliteColor', e.target.value));

  byId('linkBtn').addEventListener('click', createLink);
  byId('imgBtn') .addEventListener('click', insertImage);
  byId('symBtn') .addEventListener('click', insertSymbol);

  byId('undoBtn').addEventListener('click', ()=>exec('undo'));
  byId('redoBtn').addEventListener('click', ()=>exec('redo'));

  populateFontSelect();
}

// ===== Meny / uppdatering =====
function toggleMenu(){
  const m=byId('menu'); m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
async function forceUpdate(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const names=await caches.keys(); await Promise.all(names.map(n=>caches.delete(n)));
    }
    alert('Appen uppdateras – laddar om…'); location.reload();
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
}

// ===== Wire up =====
window.addEventListener('load', ()=>{
  // Tema
  applyTheme(localStorage.getItem('rd_theme')||'dark');
  applyEditorColors();
  byId('themeToggle').addEventListener('click', toggleTheme);
  byId('paperColor').addEventListener('input', e=>{ localStorage.setItem('rd_paper', e.target.value); document.documentElement.style.setProperty('--paper', e.target.value); });
  byId('inkColor').addEventListener('input',   e=>{ localStorage.setItem('rd_ink',   e.target.value); document.documentElement.style.setProperty('--ink',   e.target.value); });
  byId('themeReset').addEventListener('click', resetEditorColors);

  // Lås
  byId('setPassBtn').addEventListener('click', ()=>setInitialPass(byId('passInput').value));
  byId('unlockBtn') .addEventListener('click', ()=>unlock(byId('passInput').value));
  byId('wipeLocalOnLock').addEventListener('click', wipeAll);

  // Editor/CRUD
  byId('newBtn').addEventListener('click', newEntry);
  byId('saveBtn').addEventListener('click', ()=>saveEntry(true));
  byId('deleteBtn').addEventListener('click', delEntry);
  byId('lockBtn').addEventListener('click', lock);
  editor.addEventListener('input', autosave);
  titleInput.addEventListener('input', autosave);

  // Taggar
  byId('tagInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){
      const v=e.target.value.trim(); if(v && !state.currentTags.includes(v)){ state.currentTags.push(v); renderTags(); autosave(); }
      e.target.value='';
    }
  });

  // Toolbar
  initToolbar();

  // Meny
  byId('menuToggle').addEventListener('click', toggleMenu);
  byId('exportBtn').addEventListener('click', exportAll);
  byId('importBtn').addEventListener('click', ()=>byId('importInput').click());
  byId('importInput').addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn').addEventListener('click', wipeAll);
  byId('forceUpdateBtn').addEventListener('click', forceUpdate);

  // Sök & tagfilter
  byId('searchInput').addEventListener('input', renderList);
  byId('tagFilter').addEventListener('change', renderList);

  // Start
  showLock();
});
