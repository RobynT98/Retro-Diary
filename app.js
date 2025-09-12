// app.js – Retro Diary (med separat FONT_DB)

// ===== Helpers =====
const $ = sel => document.querySelector(sel);
const byId = id => document.getElementById(id);

// hex <-> buf
function buf2hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hex2buf(hex){ const u8=new Uint8Array(hex.length/2); for(let i=0;i<u8.length;i++) u8[i]=parseInt(hex.substr(i*2,2),16); return u8.buffer; }

// ===== IndexedDB (entries, meta) =====
let _db;
function idb(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const req = indexedDB.open('retro-diary', 1);
    req.onupgradeneeded = e=>{
      const db=e.target.result;
      db.createObjectStore('entries',{keyPath:'id'});
      db.createObjectStore('meta',{keyPath:'k'});
    };
    req.onsuccess = e=>{ _db=e.target.result; res(_db); };
    req.onerror = e=>rej(e);
  });
}
async function dbPut(store,obj){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e); }); }
async function dbGet(store,key){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(store); const rq=tx.objectStore(store).get(key); rq.onsuccess=()=>res(rq.result); rq.onerror=e=>rej(e); }); }
async function dbAll(store){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(store); const rq=tx.objectStore(store).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=e=>rej(e); }); }
async function dbDel(store,key){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e); }); }
async function dbClearAll(){ const db=await idb(); return new Promise((res,rej)=>{ const tx=db.transaction(['entries','meta'],'readwrite'); tx.objectStore('entries').clear(); tx.objectStore('meta').clear(); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e); }); }

// ===== Crypto (PBKDF2 + AES-GCM) =====
async function deriveKey(pass,saltHex){
  const enc=new TextEncoder();
  const keyMat=await crypto.subtle.importKey('raw',enc.encode(pass),{name:'PBKDF2'},false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:hex2buf(saltHex), iterations:200000, hash:'SHA-256'},
    keyMat,
    {name:'AES-GCM', length:256},
    false, ['encrypt','decrypt']
  );
}
async function encObj(key,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new TextEncoder().encode(JSON.stringify(obj));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
  return { iv: buf2hex(iv), ct: buf2hex(ct) };
}
async function decObj(key,wrap){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:hex2buf(wrap.iv)}, key, hex2buf(wrap.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ===== State =====
const state = { key:null, currentId:null };

function setStatus(msg){ const s=byId('status'); if(s) s.textContent=msg||''; }

// ===== Wrap-meta (lösen) =====
async function setWrapMeta(w){ await dbPut('meta',{k:'wrap',salt:w.salt,test:w.test}); }
async function getWrapMeta(){ const m=await dbGet('meta','wrap'); return m||null; }

function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

// ===== Lock / Unlock =====
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }

    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});

    await setWrapMeta({salt,test});
    state.key=key;
    setStatus('Lösen satt ✔');
    hideLock();
    await renderList();
  }catch(e){
    setStatus('Kunde inte sätta lösen.');
    console.error(e);
  }
}

async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta = await getWrapMeta();
    if(!meta){ setStatus('Välj “Sätt nytt lösen” först.'); return; }

    setStatus('Kontrollerar…');
    const key = await deriveKey(pass, meta.salt);
    const probe = await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');

    state.key=key; setStatus('');
    hideLock(); await renderList();
  }catch(e){
    setStatus('Fel lösenord.');
    console.error(e);
  }
}

function lock(){
  state.key=null; state.currentId=null;
  const ed=byId('editor'); if(ed) ed.innerHTML='';
  const dl=byId('dateLine'); if(dl) dl.textContent='';
  showLock(); setStatus('');
  setTimeout(()=>byId('passInput')?.focus(), 30);
}

// ===== Entries =====
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const first=(tmp.textContent||'').trim().split(/\n/)[0].slice(0,80);
  return first || new Date().toLocaleString();
}
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id  = state.currentId || Date.now();
  const obj = { id, html:byId('editor').innerHTML, date:new Date().toLocaleString(), title:titleFrom(byId('editor').innerHTML) };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  state.currentId=id; await renderList();
}
async function renderList(){
  const list=byId('entries'); if(!list) return;
  list.innerHTML='';
  const all=(await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent = new Date(e.updated||e.id).toLocaleString();
    li.tabIndex=0;
    li.addEventListener('click', async ()=>{
      const dec=await decObj(state.key,e.wrap);
      state.currentId=dec.id;
      byId('editor').innerHTML=dec.html;
      byId('dateLine').textContent=dec.date;
      byId('editor').focus();
    });
    list.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent='';
  await renderList();
}

// ===== Export/Import/Wipe =====
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries})], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click(); URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt=await file.text();
  const data=JSON.parse(txt);
  if(!data.meta || !data.entries){ alert('Felaktig fil.'); return; }
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries',e);
  alert('Importerad.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll();
  state.key=null; state.currentId=null; byId('editor').innerHTML=''; byId('entries').innerHTML='';
  showLock(); setStatus('Allt rensat.');
}

// ===== Toolbar =====
function execCmd(cmd,val=null){ document.execCommand(cmd,false,val); }

// ===== Menu & font-select =====
function toggleMenu(){
  if(document.body.classList.contains('locked')) return;
  const m=byId('menu'); m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
function initFontSelect(){
  const sel = byId('fontSelect'); if(!sel) return;
  sel.innerHTML = '';
  FONT_DB.forEach(f=>{
    const opt=document.createElement('option');
    opt.value=f.value; opt.textContent=f.label;
    sel.appendChild(opt);
  });
  const saved = localStorage.getItem('rd_font');
  if(saved){ byId('editor').style.fontFamily=saved; sel.value=saved; }
  sel.addEventListener('change', e=>{
    const font=e.target.value;
    byId('editor').style.fontFamily=font;
    localStorage.setItem('rd_font', font);
  });
}

// ===== Force update (rensar SW + Cache) =====
byId('forceUpdateBtn')?.addEventListener('click', async ()=>{
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const names=await caches.keys();
      await Promise.all(names.map(n=>caches.delete(n)));
    }
    alert('Appen uppdateras – laddar om…');
    location.reload(true);
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
});

// ===== Wire up =====
window.addEventListener('load', ()=>{
  // lock
  byId('setPassBtn')    ?.addEventListener('click', ()=>setInitialPass(byId('passInput').value));
  byId('unlockBtn')     ?.addEventListener('click', ()=>unlock(byId('passInput').value));
  byId('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // editor
  byId('newBtn')   ?.addEventListener('click', ()=>{ state.currentId=null; byId('editor').innerHTML=''; byId('dateLine').textContent=''; byId('editor').focus(); });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  // toolbar
  byId('boldBtn')     ?.addEventListener('click', ()=>execCmd('bold'));
  byId('italicBtn')   ?.addEventListener('click', ()=>execCmd('italic'));
  byId('underlineBtn')?.addEventListener('click', ()=>execCmd('underline'));
  byId('colorBtn')    ?.addEventListener('input', e=>execCmd('foreColor', e.target.value));

  // menu
  byId('menuToggle')?.addEventListener('click', toggleMenu);
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn')   ?.addEventListener('click', wipeAll);

  initFontSelect();
  showLock(); // start i låst läge
});
