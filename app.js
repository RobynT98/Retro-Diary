/* ======= Helpers ======= */
const $  = sel => document.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const byId = id => document.getElementById(id);
const passEl = ()=> byId('passInput');
const setStatus = txt => { const el=byId('status'); if(el) el.textContent=txt||''; };

/* ======= IndexedDB ======= */
let db;
function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('retro-diary', 1);
    r.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('meta')){
        d.createObjectStore('meta', { keyPath:'k' });
      }
      if(!d.objectStoreNames.contains('entries')){
        const s = d.createObjectStore('entries', { keyPath:'id' });
        s.createIndex('updated','updated');
        s.createIndex('title','title');
      }
    };
    r.onsuccess = ()=>{ db=r.result; res(); };
    r.onerror = ()=> rej(r.error);
  });
}
function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }
function dbPut(store, val){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').put(val); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function dbGet(store, key){ return new Promise((res,rej)=>{ const r=tx(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function dbAll(store){ return new Promise((res,rej)=>{ const arr=[]; const r=tx(store).openCursor(); r.onsuccess=e=>{ const c=e.target.result; if(c){ arr.push(c.value); c.continue(); } else res(arr); }; r.onerror=()=>rej(r.error); }); }
function dbDel(store, key){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function dbClearAll(){
  return new Promise((res,rej)=>{
    const t = db.transaction(['meta','entries'],'readwrite');
    t.objectStore('meta').clear();
    t.objectStore('entries').clear();
    t.oncomplete = ()=>res();
    t.onerror = ()=>rej(t.error);
  });
}

/* ======= Crypto ======= */
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = buf => Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
const unhex = str => new Uint8Array(str.match(/../g).map(h=>parseInt(h,16))).buffer;

async function deriveKey(pass, saltHex){
  const salt = typeof saltHex==='string' ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16)).buffer;
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'},
    keyMaterial,
    {name:'AES-GCM', length:256},
    false, ['encrypt','decrypt']
  );
  return { key, saltHex: hex(salt) };
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv: hex(iv), ct: hex(ct) };
}
async function decObj(key, wrap){
  const iv = unhex(wrap.iv);
  const ct = unhex(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(dec.decode(pt));
}

/* ======= Wrap-meta ======= */
async function setWrapMeta(w){
  await dbPut('meta', {k:'wrap', salt:w.salt, test:w.test});
  localStorage.setItem('wrap', JSON.stringify(w));
}
async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw ? JSON.parse(raw) : null;
}
async function clearWrapMeta(){
  await dbClearAll(); localStorage.removeItem('wrap');
}

/* ======= State ======= */
const state = {
  key:null,
  currentId:null,
  theme: localStorage.getItem('rd_theme') || 'dark'
};

/* ======= UI ======= */
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }
function exec(cmd, val=null){ document.execCommand(cmd, false, val); scheduleAutoSave(); }
function setBlock(tag){ exec('formatBlock', tag==='div'?'p':tag); }
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  return (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
}

/* ======= Autospara ======= */
let autoTimer=null;
function scheduleAutoSave(){ clearTimeout(autoTimer); autoTimer=setTimeout(saveEntry, 1200); }

/* ======= CRUD ======= */
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id  = state.currentId || Date.now();
  const obj = {
    id,
    html: byId('editor').innerHTML,
    date: new Date().toLocaleString(),
    title: (byId('titleInput').value.trim() || titleFrom(byId('editor').innerHTML)),
    tags:  byId('tagsInput').value.trim()
  };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated: Date.now(), title: obj.title, tags: obj.tags });
  state.currentId = id;
  await renderList();
}
async function renderList(filter=''){
  const list = byId('entriesList'); if(!list) return;
  list.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const hay = (e.title||'')+' '+(e.tags||'');
    if(filter && !hay.toLowerCase().includes(filter.toLowerCase())) continue;

    const li=document.createElement('li');
    const dt = new Date(e.updated||e.id).toLocaleString();
    li.innerHTML = `<strong>${(e.title||'Anteckning')}</strong><span class="meta">${dt}${e.tags? ' • '+e.tags:''}</span>`;
    li.onclick = async ()=>{
      try{
        const decd = await decObj(state.key, e.wrap);
        state.currentId = decd.id;
        byId('editor').innerHTML = decd.html;
        byId('dateLine').textContent = decd.date;
        byId('titleInput').value = decd.title || '';
        byId('tagsInput').value  = decd.tags  || '';
        byId('editor').focus();
      }catch{ alert('Kunde inte öppna sidan. Felaktigt lösen?'); }
    };
    list.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent='';
  byId('titleInput').value=''; byId('tagsInput').value='';
  await renderList();
}

/* ======= Export / Import / Wipe ======= */
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries})], {type:'application/json'});
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
  await clearWrapMeta();
  state.key=null; state.currentId=null;
  byId('editor').innerHTML=''; byId('dateLine').textContent='';
  byId('titleInput').value=''; byId('tagsInput').value='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

/* ======= Lösenord ======= */
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const {key, saltHex} = await deriveKey(pass);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({ k:'wrap', salt:saltHex, test });
    state.key = key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); alert('Fel setInitialPass: '+(e?.message||e)); }
}
async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta = await getWrapMeta();
    if(!meta){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    setStatus('Kontrollerar…');
    const {key} = await deriveKey(pass, meta.salt);
    const probe = await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');
    state.key = key;
    setStatus(''); hideLock(); await renderList();
  }catch{ setStatus('Upplåsning misslyckades.'); }
}
function lock(){
  state.key=null; state.currentId=null;
  byId('editor').innerHTML=''; byId('dateLine').textContent='';
  byId('titleInput').value=''; byId('tagsInput').value='';
  showLock(); setStatus(''); setTimeout(()=>passEl()?.focus(), 50);
}

/* ======= Bild, Länk, Emoji ======= */
byId('imgBtn')?.addEventListener('click', ()=> byId('imgInput').click());
byId('imgInput')?.addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const url = URL.createObjectURL(f);
  exec('insertImage', url);
  setTimeout(()=>URL.revokeObjectURL(url), 15000);
});
byId('linkBtn')?.addEventListener('click', ()=>{
  const url = prompt('Klistra in länk (inkl. https://)');
  if(url) exec('createLink', url);
});
byId('emojiBtn')?.addEventListener('click', ()=>{
  const s = prompt('Emoji/symbol (t.ex. 🕯️ 🕊️ ❤️):');
  if(s) exec('insertText', s+' ');
});

/* ======= Ljud (fil & URL) ======= */
function insertAudioElement(src, caption=''){
  // figure + audio + figcaption (frivillig)
  const fig = document.createElement('figure');
  fig.style.textAlign = 'center';

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = src;
  audio.style.width = '100%';

  fig.appendChild(audio);

  if(caption){
    const fc = document.createElement('figcaption');
    fc.textContent = caption;
    fig.appendChild(fc);
  }

  const sel = window.getSelection();
  if(sel && sel.rangeCount){
    const r = sel.getRangeAt(0);
    r.insertNode(fig);
    r.collapse(false);
  }else{
    byId('editor').appendChild(fig);
  }
  scheduleAutoSave();
}

byId('audioBtn')?.addEventListener('click', ()=> byId('audioInput').click());
byId('audioInput')?.addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const url = URL.createObjectURL(f);
  const caption = prompt('Beskrivning (valfritt):') || '';
  insertAudioElement(url, caption);
  // behåll blob-URL; om vi återkallar den direkt slutar ljudet fungera efter reload.
  // (Vill du minska minne: spara base64 i texten. Det blir dock stora sidor.)
});

byId('audioUrlBtn')?.addEventListener('click', ()=>{
  const url = prompt('Klistra in ljud-URL (mp3/ogg/m4a…):');
  if(!url) return;
  const caption = prompt('Beskrivning (valfritt):') || '';
  insertAudioElement(url, caption);
});

/* ======= Tema ======= */
function applyTheme(){
  document.body.classList.toggle('theme-dark',  state.theme==='dark');
  document.body.classList.toggle('theme-light', state.theme==='light');
}
function toggleTheme(){
  state.theme = (state.theme==='dark' ? 'light' : 'dark');
  localStorage.setItem('rd_theme', state.theme);
  applyTheme();
}

/* ======= Meny / Force Update ======= */
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
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n=>caches.delete(n)));
    }
    alert('Appen uppdateras – laddar om...');
    location.reload();
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
});

/* ======= Wire up ======= */
window.addEventListener('load', async ()=>{
  await openDB();
  applyTheme();

  // Toolbar-kommando-knappar
  $$('#toolbar .t').forEach(b=>{
    const cmd=b.dataset.cmd;
    if(cmd) b.addEventListener('click', ()=> exec(cmd));
  });

  byId('ulBtn')?.addEventListener('click', ()=>exec('insertUnorderedList'));
  byId('olBtn')?.addEventListener('click', ()=>exec('insertOrderedList'));
  byId('blockSelect')?.addEventListener('change', e=>setBlock(e.target.value));
  byId('hrBtn')?.addEventListener('click', ()=>exec('insertHorizontalRule'));

  byId('foreColor')?.addEventListener('input', e=>exec('foreColor', e.target.value));
  byId('backColor')?.addEventListener('input', e=>exec('hiliteColor', e.target.value));

  byId('undoBtn')?.addEventListener('click', ()=>document.execCommand('undo'));
  byId('redoBtn')?.addEventListener('click', ()=>document.execCommand('redo'));

  // Editor ändrad => autospara
  byId('editor')?.addEventListener('input', scheduleAutoSave);
  byId('titleInput')?.addEventListener('input', scheduleAutoSave);
  byId('tagsInput') ?.addEventListener('input', scheduleAutoSave);

  // Sök
  byId('searchInput')?.addEventListener('input', e=>renderList(e.target.value.trim()));

  // Åtgärder
  byId('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent=''; byId('titleInput').value=''; byId('tagsInput').value=''; byId('editor').focus(); });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  // Meny
  byId('menuToggle')?.addEventListener('click', toggleMenu);
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Låsskärm
  byId('setPassBtn')   ?.addEventListener('click', ()=>setInitialPass(passEl().value));
  byId('unlockBtn')    ?.addEventListener('click', ()=>unlock(passEl().value));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // Start
  showLock();
});
