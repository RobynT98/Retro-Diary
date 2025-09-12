/* Retro Diary – app.js v17
   - Word-like toolbar (many commands)
   - Encrypted local saving (localStorage)
   - Export/Import, Theme toggle, Drawer menu, Force update
*/

const $ = s => document.querySelector(s);
const enc = new TextEncoder(), dec = new TextDecoder();

let state = { key:null, entries:[], currentId:null };

// ========= UI helpers =========
function setStatus(msg){ const el=$('#status'); if(el) el.textContent=msg||''; }
function showLock(){ document.body.classList.add('locked'); $('#lockscreen').style.display='flex'; $('#app').hidden=true; }
function hideLock(){ document.body.classList.remove('locked'); $('#lockscreen').style.display='none'; $('#app').hidden=false; }
function toggleMenu(){ $('#menu')?.classList.toggle('open'); }
function setTheme(t){ document.documentElement.setAttribute('data-theme', t); localStorage.setItem('rd_theme', t); }

function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  return (tmp.textContent||'').trim().split(/\n/)[0].slice(0,80) || 'Anteckning';
}

// ========= Crypto =========
async function deriveKey(pass, saltBytes){
  const mat = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:saltBytes, iterations:120000, hash:'SHA-256' },
    mat,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}
async function encObj(key,obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(obj)));
  return {iv:Array.from(iv), ct:Array.from(new Uint8Array(ct))};
}
async function decObj(key,wrap){
  const iv = new Uint8Array(wrap.iv);
  const ct = new Uint8Array(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);
  return JSON.parse(dec.decode(pt));
}

// ========= Storage =========
const WRAP_KEY='rd_wrap_v1', ENTRIES_KEY='rd_entries_v1';

async function setWrapMeta(m){ localStorage.setItem(WRAP_KEY, JSON.stringify(m)); }
async function getWrapMeta(){ const r=localStorage.getItem(WRAP_KEY); return r?JSON.parse(r):null; }
async function clearAll(){ localStorage.removeItem(WRAP_KEY); localStorage.removeItem(ENTRIES_KEY); }

function saveEntriesStore(list){ localStorage.setItem(ENTRIES_KEY, JSON.stringify(list||[])); }
function loadEntriesStore(){ const r=localStorage.getItem(ENTRIES_KEY); return r?JSON.parse(r):[]; }

// ========= Lock / Unlock =========
async function setInitialPass(){
  try{
    const pass = ($('#pass')?.value||'').trim();
    if(!pass) return setStatus('Skriv ett lösenord.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key  = await deriveKey(pass, salt);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({salt:Array.from(salt), test});
    state.key=key;
    if(!localStorage.getItem(ENTRIES_KEY)) saveEntriesStore([]);
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); console.error(e); }
}
async function unlock(){
  try{
    const pass = ($('#pass')?.value||'').trim();
    if(!pass) return setStatus('Skriv ditt lösenord.');
    const meta = await getWrapMeta();
    if(!meta) return setStatus('Inget lösen satt ännu.');
    setStatus('Kontrollerar…');
    const key = await deriveKey(pass, new Uint8Array(meta.salt));
    const probe = await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Fel lösen');
    state.key = key; state.entries = loadEntriesStore(); setStatus('');
    hideLock(); await renderList();
  }catch(e){ setStatus('Fel lösenord.'); console.error(e); }
}
function lock(){
  state.key=null; state.currentId=null;
  $('#editor').innerHTML=''; $('#dateLine').textContent='';
  showLock(); setStatus(''); setTimeout(()=>$('#pass')?.focus(), 40);
}

// ========= Entries =========
async function saveEntry(){
  if(!state.key) return alert('Lås upp först.');
  const id = state.currentId || Date.now();
  const obj = { id, html:$('#editor').innerHTML, date:new Date().toLocaleString(), title:titleFrom($('#editor').innerHTML) };
  const wrap = await encObj(state.key, obj);
  const i = state.entries.findIndex(e=>e.id===id);
  if(i>=0) state.entries[i] = { id, title:obj.title, wrap };
  else state.entries.push({ id, title:obj.title, wrap });
  saveEntriesStore(state.entries);
  state.currentId=id;
  await renderList();
}
async function renderList(){
  const list=$('#entries'); if(!list) return;
  list.innerHTML='';
  const items=[...state.entries].sort((a,b)=>b.id-a.id);
  for(const e of items){
    const li=document.createElement('li');
    li.textContent=e.title || new Date(e.id).toLocaleString();
    li.onclick = async ()=>{
      try{
        const page = await decObj(state.key, e.wrap);
        state.currentId=page.id;
        $('#editor').innerHTML = page.html;
        $('#dateLine').textContent = page.date;
        $('#editor').focus();
      }catch(err){ alert('Kunde inte dekryptera sidan.'); }
    };
    list.appendChild(li);
  }
}
async function newEntry(){ state.currentId=null; $('#editor').innerHTML=''; $('#dateLine').textContent=''; $('#editor').focus(); }
async function deleteEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera denna sida?')) return;
  state.entries = state.entries.filter(e=>e.id!==state.currentId);
  saveEntriesStore(state.entries);
  state.currentId=null; $('#editor').innerHTML=''; $('#dateLine').textContent='';
  await renderList();
}

// ========= Export / Import =========
async function exportAll(){
  const meta = await getWrapMeta();
  const blob = new Blob([JSON.stringify({meta,entries:state.entries},null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  try{
    const txt=await file.text(); const data=JSON.parse(txt);
    if(!data.meta || !Array.isArray(data.entries)) return alert('Felaktig fil.');
    await setWrapMeta(data.meta); saveEntriesStore(data.entries);
    state.entries=data.entries; await renderList(); alert('Importerad.');
  }catch(e){ alert('Import misslyckades.'); }
}

// ========= Toolbar wiring =========
function exec(cmd, val=null){ document.execCommand(cmd, false, val); }
function setBlock(tag){ document.execCommand('formatBlock', false, tag); }

// text color / highlight via prompts (mobile-vänligt)
function askColor(defaultHex){ const v=prompt('Ange färg (#hex eller rgb(...))', defaultHex||'#4a2b18'); return v && v.trim(); }

function insertLink(){
  const url = prompt('Länkadress (https:// …):','https://');
  if(!url) return;
  if(document.getSelection().isCollapsed){
    const txt = prompt('Länktext:','länk');
    if(!txt) return;
    document.execCommand('insertHTML', false, `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`);
  }else{
    exec('createLink', url);
  }
}
function insertImage(){
  const i = document.createElement('input'); i.type='file'; i.accept='image/*';
  i.onchange = ()=>{
    const f=i.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=> document.execCommand('insertImage', false, r.result);
    r.readAsDataURL(f);
  };
  i.click();
}
function insertDate(){
  const now=new Date();
  const str = now.toLocaleDateString('sv-SE',{year:'numeric',month:'long',day:'numeric'}) +
              ' ' + now.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'});
  document.execCommand('insertText', false, str);
}

// ========= Force update =========
async function forceUpdate(){
  try{
    if('caches' in window){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); }
    if('serviceWorker' in navigator){ const reg=await navigator.serviceWorker.getRegistration(); if(reg) await reg.unregister(); }
  }finally{ location.reload(); }
}

// ========= Wire up =========
window.addEventListener('load', ()=>{
  // theme init
  const savedTheme = localStorage.getItem('rd_theme') || 'dark';
  setTheme(savedTheme);
  $('#themeToggle').textContent = savedTheme==='dark' ? '🌗' : '🌞';
  $('#themeToggle').addEventListener('click', ()=>{
    const next = (localStorage.getItem('rd_theme')||'dark')==='dark' ? 'light' : 'dark';
    setTheme(next);
    $('#themeToggle').textContent = next==='dark' ? '🌗' : '🌞';
  });

  // lock screen
  $('#setPassBtn')?.addEventListener('click', setInitialPass);
  $('#unlockBtn')?.addEventListener('click', unlock);
  $('#wipeLocalOnLock')?.addEventListener('click', async ()=>{
    if(confirm('Rensa ALL lokal data?')){ await clearAll(); showLock(); setStatus('Allt rensat.'); }
  });

  // editor actions
  $('#newBtn')?.addEventListener('click', newEntry);
  $('#saveBtn')?.addEventListener('click', saveEntry);
  $('#deleteBtn')?.addEventListener('click', deleteEntry);
  $('#lockBtn')?.addEventListener('click', lock);

  // toolbar generic commands
  $('#toolbar')?.addEventListener('click', e=>{
    const b=e.target.closest('button'); if(!b) return;
    const cmd=b.dataset.cmd, val=b.dataset.value, block=b.dataset.block;
    if(block){ setBlock(block); return; }
    if(cmd){ exec(cmd, val||null); return; }
  });
  $('#textColorBtn').addEventListener('click', ()=>{ const c=askColor('#4a2b18'); if(c) exec('foreColor', c); });
  $('#hiliteBtn').addEventListener('click', ()=>{ const c=askColor('#fff176'); if(c) exec('hiliteColor', c); });
  $('#linkBtn').addEventListener('click', insertLink);
  $('#imageBtn').addEventListener('click', insertImage);
  $('#insertDateBtn').addEventListener('click', insertDate);

  // menu
  $('#menuToggle')?.addEventListener('click', toggleMenu);
  $('#exportBtn')?.addEventListener('click', exportAll);
  $('#importBtn')?.addEventListener('click', ()=>$('#importInput').click());
  $('#importInput')?.addEventListener('change', e=>e.target.files[0] && importAll(e.target.files[0]));
  $('#wipeBtn')?.addEventListener('click', async ()=>{
    if(confirm('Rensa ALL lokal data?')){ await clearAll(); state={key:null,entries:[],currentId:null}; showLock(); setStatus('Allt rensat.'); }
  });

  // font for editor
  const fs=$('#fontSelect');
  if(fs){
    const saved = localStorage.getItem('rd_font'); if(saved){ $('#editor').style.fontFamily=saved; fs.value=saved; }
    fs.addEventListener('change', e=>{ const f=e.target.value; $('#editor').style.fontFamily=f; localStorage.setItem('rd_font',f); });
  }

  // force update
  $('#forceUpdateBtn')?.addEventListener('click', forceUpdate);

  // service worker (also in index)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js?v=rd17').catch(()=>{});
  }

  // start
  showLock();
});
