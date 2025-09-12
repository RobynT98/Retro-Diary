/* ===== Helpers ===== */
const $ = s => document.querySelector(s);
const byId = s => document.getElementById(s);

function buf2hex(buf){ return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function hex2buf(hex){ const a=new Uint8Array(hex.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16); return a.buffer; }
const textEnc = new TextEncoder(), textDec = new TextDecoder();

/* ===== IndexedDB ===== */
let _db=null;
function idb(){ if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const req = indexedDB.open('retro-diary',1);
    req.onupgradeneeded = e=>{
      const d=e.target.result;
      d.createObjectStore('entries',{keyPath:'id'});
      d.createObjectStore('meta',{keyPath:'k'});
    };
    req.onsuccess = e=>{ _db=e.target.result; res(_db); };
    req.onerror = e=>rej(e);
  });
}
async function dbPut(store,obj){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store,'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e); }); }
async function dbGet(store,key){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store); const rq=tx.objectStore(store).get(key); rq.onsuccess=()=>res(rq.result); rq.onerror=e=>rej(e); }); }
async function dbAll(store){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store); const rq=tx.objectStore(store).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=e=>rej(e); }); }
async function dbDel(store,key){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e); }); }
async function dbClearAll(){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(['entries','meta'],'readwrite'); tx.objectStore('entries').clear(); tx.objectStore('meta').clear(); tx.oncomplete=()=>res(); tx.onerror=e=>rej(e); }); }

/* ===== Crypto (PBKDF2 + AES-GCM) ===== */
async function deriveKey(pass,saltHex){
  const keyMat = await crypto.subtle.importKey('raw', textEnc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: hex2buf(saltHex), iterations: 200000, hash:'SHA-256'},
    keyMat, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
}
async function encObj(key,obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, textEnc.encode(JSON.stringify(obj)));
  return { iv:buf2hex(iv), ct:buf2hex(ct) };
}
async function decObj(key,wrap){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:hex2buf(wrap.iv)}, key, hex2buf(wrap.ct));
  return JSON.parse(textDec.decode(pt));
}

/* ===== State & refs ===== */
const state = { key:null, currentId:null };
const entriesUl = byId('entries');
const editor = byId('editor');
const dateLine = byId('dateLine');

let _autosaveTimer = null;

/* ===== Utils ===== */
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const firstLine=(tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
  return firstLine;
}
function previewFrom(html, max=80){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const txt=(tmp.textContent||'').replace(/\s+/g,' ').trim();
  return txt.slice(0,max)+(txt.length>max?'…':'');
}
function setStatus(msg){ byId('status').textContent = msg||''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

/* ===== Wrap-meta (salt + test) ===== */
async function setWrapMeta(obj){ await dbPut('meta', {k:'wrap', salt:obj.salt, test:obj.test}); }
async function getWrapMeta(){ return await dbGet('meta','wrap'); }

/* ===== Lock / Unlock ===== */
async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({salt,test});
    state.key=key; setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); }
}
async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta = await getWrapMeta();
    if(!meta){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    const key = await deriveKey(pass, meta.salt);
    await decObj(key, meta.test); // verifiering
    state.key=key; setStatus(''); hideLock(); await renderList();
  }catch(e){ setStatus('Fel lösenord.'); }
}
function lock(){
  state.key=null; state.currentId=null;
  editor.innerHTML=''; dateLine.textContent='';
  showLock(); setStatus('');
  setTimeout(()=>byId('passInput')?.focus(),50);
}

/* ===== CRUD ===== */
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id   = state.currentId || Date.now();
  const title= titleFrom(editor.innerHTML);
  const obj  = { id, html: editor.innerHTML, date:new Date(id).toISOString().replace('T',' ').slice(0,19), title };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now(), title }); // title för snabb lista
  state.currentId = id;
  await renderList();
}
async function renderList(){
  entriesUl.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    let title = e.title;
    let prev = '';
    let dateS = new Date(e.id).toISOString().replace('T',' ').slice(0,19);

    // saknas title? decrypta en gång -> spara tillbaka
    if(!title && state.key){
      try{
        const dec = await decObj(state.key, e.wrap);
        title = dec.title || titleFrom(dec.html);
        prev  = previewFrom(dec.html, 80);
        dateS = dec.date || dateS;
        e.title = title;
        await dbPut('entries', e);
      }catch{}
    }

    // Om vi inte hade decryptat ovan: försök få en snabb preview genom att decrypta men bara om vi har key
    if(!prev && state.key){
      try{ const dec = await decObj(state.key, e.wrap); prev = previewFrom(dec.html, 80); }catch{}
    }

    const li = document.createElement('li');
    li.innerHTML = `
      <div class="li-title">${title || '(Tom sida)'}</div>
      <div class="li-prev">${prev || ''}</div>
      <div class="li-sub">${dateS}</div>`;
    li.addEventListener('click', async ()=>{
      const dec = await decObj(state.key, e.wrap);
      state.currentId = dec.id;
      editor.innerHTML = dec.html;
      dateLine.textContent = dec.date;
      editor.focus();
    });
    entriesUl.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList();
}

/* ===== Import / Export / Wipe ===== */
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
  if(!data.meta || !data.entries){ alert('Felaktig fil.'); return; }
  await dbPut('meta', {k:'wrap', ...data.meta});
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll();
  state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

/* ===== Toolbar ===== */
function exec(cmd,val=null){ document.execCommand(cmd,false,val); editor.focus(); }
function makeLink(){
  const url = prompt('Länk (inkl. https://):');
  if(!url) return;
  exec('createLink', url);
}

/* ===== Fonts ===== */
function loadFontsToSelect(){
  const sel = byId('fontSelect');
  sel.innerHTML = '';
  (window.FONT_DB||[]).forEach(f=>{
    const opt=document.createElement('option');
    opt.value=f.value; opt.textContent=f.label;
    sel.appendChild(opt);
  });
  // Läs sparat val
  const saved = localStorage.getItem('rd_font');
  if(saved){ editor.style.fontFamily = saved; sel.value = saved; }
  sel.addEventListener('change', e=>{
    const ff = e.target.value;
    editor.style.fontFamily = ff;
    localStorage.setItem('rd_font', ff);
  });
}

/* ===== Menu ===== */
function toggleMenu(){
  const m = byId('menu');
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}

/* ===== Force Update (rensa SW + Cache) ===== */
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

/* ===== Wire up ===== */
window.addEventListener('load', ()=>{
  // Låsskärm
  byId('setPassBtn')   .addEventListener('click', ()=>setInitialPass(byId('passInput').value));
  byId('unlockBtn')    .addEventListener('click', ()=>unlock(byId('passInput').value));
  byId('wipeLocalOnLock').addEventListener('click', wipeAll);

  // CRUD
  byId('newBtn')   .addEventListener('click', ()=>{ state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus(); });
  byId('saveBtn')  .addEventListener('click', saveEntry);
  byId('deleteBtn').addEventListener('click', delEntry);
  byId('lockBtn')  .addEventListener('click', lock);

  // Toolbar kommandon
  $('#toolbar').addEventListener('click', e=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const c = btn.getAttribute('data-cmd');
    if(!c) return;
    exec(c);
  });
  byId('ulBtn').addEventListener('click', ()=>exec('insertUnorderedList'));
  byId('olBtn').addEventListener('click', ()=>exec('insertOrderedList'));
  byId('colorBtn').addEventListener('input', e=>exec('foreColor', e.target.value));
  byId('hiliteBtn').addEventListener('input', e=>exec('hiliteColor', e.target.value));
  byId('linkBtn').addEventListener('click', makeLink);

  // Meny
  byId('menuToggle').addEventListener('click', toggleMenu);
  byId('exportBtn').addEventListener('click', exportAll);
  byId('importBtn').addEventListener('click', ()=>byId('importInput').click());
  byId('importInput').addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  byId('wipeBtn').addEventListener('click', wipeAll);

  // Font-knapp
  loadFontsToSelect();

  // Autospara efter 3 sek utan input
  editor.addEventListener('input', ()=>{
    if(!state.key) return;
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(()=>{ saveEntry().catch(()=>{}); }, 3000);
  });
  // Spara när man försöker lämna
  window.addEventListener('beforeunload', ()=>{ if(state.key && editor.innerHTML) saveEntry(); });

  // Start i låst läge
  showLock();
});
