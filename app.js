// ================= Helpers =================
const $ = s => document.querySelector(s);

// tiny debug banner (bottom)
function debug(msg){ 
  const id='__dbg'; let n=document.getElementById(id);
  if(!n){ n=document.createElement('div'); n.id=id; n.style.cssText='position:fixed;left:0;right:0;bottom:0;background:#400;color:#fff;padding:3px 6px;font:12px monospace;z-index:99999'; document.body.appendChild(n); }
  n.textContent = 'DEBUG: ' + msg;
}

// Hex/buffer
function buf2hex(buf){ return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function hex2buf(hex){ const b=new Uint8Array(hex.length/2); for(let i=0;i<b.length;i++) b[i]=parseInt(hex.substr(i*2,2),16); return b.buffer; }

// IndexedDB (entries + meta)
let _db;
function idb(){ return new Promise((res,rej)=>{
  if(_db) return res(_db);
  const r = indexedDB.open('retro-diary', 1);
  r.onupgradeneeded = e=>{
    const d = e.target.result;
    if(!d.objectStoreNames.contains('entries')) d.createObjectStore('entries',{keyPath:'id'});
    if(!d.objectStoreNames.contains('meta'))    d.createObjectStore('meta',{keyPath:'k'});
  };
  r.onsuccess = e=>{ _db=e.target.result; res(_db); };
  r.onerror   = e=>rej(e);
});}
async function dbPut(store,obj){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store,'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete=res; tx.onerror=rej; });}
async function dbGet(store,key){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store); const q=tx.objectStore(store).get(key); q.onsuccess=()=>res(q.result||null); q.onerror=rej; });}
async function dbAll(store){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store); const q=tx.objectStore(store).getAll(); q.onsuccess=()=>res(q.result||[]); q.onerror=rej; });}
async function dbDel(store,key){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=res; tx.onerror=rej; });}
async function dbClear(){ const d=await idb(); return new Promise((res,rej)=>{ const tx=d.transaction(['entries','meta'],'readwrite'); tx.objectStore('entries').clear(); tx.objectStore('meta').clear(); tx.oncomplete=res; tx.onerror=rej; });}

// ================= Crypto (AES-GCM via PBKDF2) =================
async function deriveKey(pass, saltHex){
  const enc=new TextEncoder();
  const keyMat=await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: hex2buf(saltHex), iterations:200000, hash:'SHA-256'},
    keyMat, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
}
async function encObj(key,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new TextEncoder().encode(JSON.stringify(obj));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
  return {iv:buf2hex(iv), ct:buf2hex(ct)};
}
async function decObj(key,wrap){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:hex2buf(wrap.iv)}, key, hex2buf(wrap.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ================= Fonts DB (laddas dynamiskt) =================
/** Lätt att utöka – lägg till fler familjer här. */
const FONT_DB = [
  {label:'Special Elite (skrivmaskin)', value:"'Special Elite', cursive", google:'Special+Elite'},
  {label:'IM Fell English',           value:"'IM Fell English', serif",   google:'IM+Fell+English'},
  {label:'Dancing Script',            value:"'Dancing Script', cursive",  google:'Dancing+Script'},
  {label:'Merriweather',              value:"'Merriweather', serif",      google:'Merriweather'},
  {label:'Roboto Slab',               value:"'Roboto Slab', serif",       google:'Roboto+Slab'},
  {label:'Cinzel',                    value:"'Cinzel', serif",            google:'Cinzel'},
  {label:'Cormorant Garamond',        value:"'Cormorant Garamond', serif",google:'Cormorant+Garamond'},
  {label:'Libre Baskerville',         value:"'Libre Baskerville', serif", google:'Libre+Baskerville'},
  {label:'Playfair Display',          value:"'Playfair Display', serif",  google:'Playfair+Display'},
  {label:'Lora',                      value:"'Lora', serif",              google:'Lora'},
  {label:'Crimson Pro',               value:"'Crimson Pro', serif",       google:'Crimson+Pro'},
  {label:'Spectral',                  value:"'Spectral', serif",          google:'Spectral'},
  {label:'PT Serif',                  value:"'PT Serif', serif",          google:'PT+Serif'},
  {label:'Noto Serif',                value:"'Noto Serif', serif",        google:'Noto+Serif'},
  {label:'Alegreya',                  value:"'Alegreya', serif",          google:'Alegreya'},
  {label:'EB Garamond',               value:"'EB Garamond', serif",       google:'EB+Garamond'}
];

function populateFontSelect(){
  const sel = $('#fontSelect');
  sel.innerHTML = FONT_DB.map(f=>`<option value="${f.value}" data-google="${f.google}">${f.label}</option>`).join('');
  const saved = localStorage.getItem('rd_font');
  if(saved){ sel.value = saved; applyFont(saved); }
}

function ensureGoogleFont(googleName){
  const id = 'gfont_'+googleName;
  if(document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${googleName}&display=swap`;
  document.head.appendChild(link);
}
function applyFont(value){
  $('#editor').style.fontFamily = value;
  $('#titleInput').style.fontFamily = value;
}

// ================= State =================
const state = { key:null, currentId:null };
const passEl = ()=>$('#passInput');

// ================= Lock / Unlock =================
async function setWrapMeta(w){ await dbPut('meta',{k:'wrap',salt:w.salt,test:w.test}); localStorage.setItem('wrap',JSON.stringify(w)); }
async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw?JSON.parse(raw):null;
}

function setStatus(t){ $('#status').textContent=t||''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

async function setInitialPass(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = buf2hex(crypto.getRandomValues(new Uint8Array(16)));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({salt,test});
    state.key = key; setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); }
}
async function unlock(passRaw){
  try{
    const pass = String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta = await getWrapMeta();
    if(!meta){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    const key = await deriveKey(pass, meta.salt);
    await decObj(key, meta.test);
    state.key = key; setStatus(''); hideLock(); await renderList();
  }catch(e){ setStatus('Fel lösenord.'); }
}
function lock(){
  state.key=null; state.currentId=null;
  $('#editor').innerHTML=''; $('#titleInput').value=''; $('#dateLine').textContent='';
  showLock(); setStatus('');
  setTimeout(()=>passEl()?.focus(), 30);
}

// ================= Entries =================
function makeTitle(){
  const t = $('#titleInput').value.trim();
  if(t) return t;
  // Fallback: första raden i editor
  const tmp=document.createElement('div'); tmp.innerHTML=$('#editor').innerHTML;
  const first = (tmp.textContent||'').trim().split(/\n/)[0];
  return first.slice(0,80) || new Date().toISOString().replace('T',' ').slice(0,19);
}

async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id = state.currentId || Date.now();
  const obj = {
    id,
    title: makeTitle(),
    html: $('#editor').innerHTML,
    date: new Date().toISOString().replace('T',' ').slice(0,19),
    updated: Date.now()
  };
  const wrap = await encObj(state.key, obj);
  await dbPut('entries',{id,wrap,updated:obj.updated});
  state.currentId = id;
  await renderList();
}

async function renderList(filter=''){
  const list = $('#entries'); list.innerHTML='';
  const all = (await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    // ev. filtera via decrypt title snabbsteg
    let match = true, title = '', dateStr='';
    try{
      const dec = await decObj(state.key, e.wrap);
      title = dec.title || '(utan titel)';
      dateStr = dec.date || '';
      if(filter){
        const hay = (title + ' ' + (dec.html||'')).toLowerCase();
        match = hay.includes(filter.toLowerCase());
      }
      if(!match) continue;

      const li = document.createElement('li');
      li.innerHTML = `<span class="t">${escapeHtml(title)}</span><span class="d">${escapeHtml(dateStr)}</span>`;
      li.addEventListener('click', async ()=>{
        const d = await decObj(state.key, e.wrap);
        state.currentId = d.id;
        $('#editor').innerHTML = d.html;
        $('#titleInput').value = d.title || '';
        $('#dateLine').textContent = d.date || '';
        closeMenu();
        // säkra fokus
        $('#editor').focus({preventScroll:false});
        $('#editor').scrollIntoView({block:'nearest'});
      });
      // long-press för att byta namn
      li.addEventListener('contextmenu', ev=>{
        ev.preventDefault();
        const nt = prompt('Ny titel:', title);
        if(nt!==null){ $('#titleInput').value = nt; saveEntry(); }
      });
      list.appendChild(li);
    }catch(_){}
  }
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; $('#editor').innerHTML=''; $('#titleInput').value=''; $('#dateLine').textContent='';
  await renderList();
}

// ================= Export / Import / Wipe =================
async function exportAll(){
  const entries = await dbAll('entries');
  const meta    = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries})], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt = await file.text(); const data = JSON.parse(txt);
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClear(); state.key=null; state.currentId=null;
  $('#editor').innerHTML=''; $('#titleInput').value=''; $('#dateLine').textContent='';
  showLock(); setStatus('Allt rensat.');
}

// ================= Meny/tema =================
function closeMenu(){ $('#menu').classList.remove('open'); $('#menu').setAttribute('aria-hidden','true'); }
function toggleMenu(){ $('#menu').classList.toggle('open'); $('#menu').setAttribute('aria-hidden',$('#menu').classList.contains('open')?'false':'true'); }

// ================= Wire up =================
window.addEventListener('load', ()=>{
  // fonts
  populateFontSelect();
  $('#fontSelect').addEventListener('change', e=>{
    const val = e.target.value;
    const google = e.target.options[e.target.selectedIndex].dataset.google;
    if(google) ensureGoogleFont(google);
    applyFont(val);
    localStorage.setItem('rd_font', val);
  });

  // tema
  const themeSel = $('#themeSelect');
  const savedTheme = localStorage.getItem('rd_theme') || 'parchment';
  themeSel.value = savedTheme; document.body.classList.remove('theme-parchment','theme-leather-dark'); document.body.classList.add('theme-'+savedTheme);
  themeSel.addEventListener('change', e=>{
    const v=e.target.value; localStorage.setItem('rd_theme', v);
    document.body.classList.remove('theme-parchment','theme-leather-dark');
    document.body.classList.add('theme-'+v);
  });

  // låsflöde
  $('#setPassBtn').addEventListener('click', ()=>setInitialPass($('#passInput').value));
  $('#unlockBtn').addEventListener('click', ()=>unlock($('#passInput').value));
  $('#wipeLocalOnLock').addEventListener('click', wipeAll);

  // CRUD
  $('#saveBtn').addEventListener('click', saveEntry);
  $('#deleteBtn').addEventListener('click', delEntry);
  $('#lockBtn').addEventListener('click', lock);
  $('#newBtnSmall').addEventListener('click', ()=>{ state.currentId=null; $('#titleInput').value=''; $('#editor').innerHTML=''; $('#dateLine').textContent=''; $('#editor').focus(); });

  // Toolbar
  $('#boldBtn').addEventListener('click', ()=>document.execCommand('bold'));
  $('#italicBtn').addEventListener('click', ()=>document.execCommand('italic'));
  $('#underlineBtn').addEventListener('click', ()=>document.execCommand('underline'));
  $('#colorBtn').addEventListener('input', e=>document.execCommand('foreColor',false,e.target.value));
  $('#alignSelect').addEventListener('change', e=>document.execCommand('justify' + (e.target.value==='left'?'Left':e.target.value.charAt(0).toUpperCase()+e.target.value.slice(1))));

  // meny
  $('#menuToggle').addEventListener('click', toggleMenu);
  $('#exportBtn').addEventListener('click', exportAll);
  $('#importBtn').addEventListener('click', ()=>$('#importInput').click());
  $('#importInput').addEventListener('change', e=>{ if(e.target.files[0]) importAll(e.target.files[0]); });
  $('#wipeBtn').addEventListener('click', wipeAll);

  // sök
  $('#searchInput').addEventListener('input', e=>renderList(e.target.value));

  // force update
  $('#forceUpdateBtn').addEventListener('click', async ()=>{
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
      location.reload(true);
    }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
  });

  // start – låsskärm
  showLock();
});
