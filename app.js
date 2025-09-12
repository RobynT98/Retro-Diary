window.AppState = { key:null, currentId:null };

function byId(x){ return document.getElementById(x); }

// ===== Entries =====
async function saveEntry(){
  const st=window.AppState;
  if(!st.key) return alert('Lås upp först.');
  const id   = st.currentId || Date.now();
  const html = byId('editor').innerHTML;
  const title= byId('titleInput').value || (html?html.replace(/<[^>]+>/g,'').trim().slice(0,80):'Anteckning');
  const obj  = { id, html, date:new Date().toLocaleString(), title };
  const wrap = await encObj(st.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  st.currentId = id;
  await renderList();
}

async function openEntry(id){
  const st=window.AppState;
  const row = await dbGet('entries', id);
  if(!row || !st.key) return;
  try{
    const dec=await decObj(st.key, row.wrap);
    st.currentId=dec.id;
    byId('editor').innerHTML=dec.html;
    byId('titleInput').value=dec.title||'';
    byId('dateLine').textContent=dec.date||'';
    byId('editor').focus();
  }catch{ alert('Kunde inte dekryptera.'); }
}

async function delEntry(){
  const st=window.AppState;
  if(!st.key || !st.currentId) return;
  if(!confirm('Radera sidan?')) return;
  await dbDel('entries', st.currentId);
  st.currentId=null; byId('editor').innerHTML=''; byId('titleInput').value=''; byId('dateLine').textContent='';
  await renderList();
}

async function renderList(filter=''){
  const ul=byId('entries'); if(!ul) return;
  ul.innerHTML='';
  const all=(await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  const st=window.AppState;
  for(const e of all){
    let t=''; try{ const dec=st.key?await decObj(st.key,e.wrap):null; t=dec?.title||''; }catch{}
    const li=document.createElement('div');
    li.className='entry-row';
    const text=((t?t+' — ':'') + new Date(e.updated||e.id).toLocaleString('sv-SE'));
    if(filter && !text.toLowerCase().includes(filter.toLowerCase())) continue;
    li.textContent=text;
    li.addEventListener('click', ()=>openEntry(e.id));
    ul.appendChild(li);
  }
}

// ===== Export/Import =====
async function exportAll(){
  const entries=await dbAll('entries');
  const meta   =await dbGet('meta','wrap') || JSON.parse(localStorage.getItem('wrap')||'null');
  const blob=new Blob([JSON.stringify({meta,entries})],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt=await file.text(); const data=JSON.parse(txt);
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await dbPut('meta', data.meta); localStorage.setItem('wrap', JSON.stringify(data.meta));
  for(const e of data.entries) await dbPut('entries', e);
  alert('Importerad.'); await renderList();
}

// ===== Sök =====
function doSearch(){
  const q = byId('searchInput').value.trim();
  renderList(q);
}

// ===== Force update (SW + cache) =====
async function forceUpdate(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const names=await caches.keys();
      await Promise.all(names.map(n=>caches.delete(n)));
    }
    alert('Appen uppdateras – laddar om…');
    location.reload(true);
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
}

// ===== Meny & Tema =====
function toggleMenu(){
  const m=byId('menu'); m.classList.toggle('open'); m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}

document.addEventListener('DOMContentLoaded', async ()=>{
  await idbReady();

  // Tema init
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);
  byId('themeSelect').value=savedTheme;
  byId('themeSelect').addEventListener('change', e=>setTheme(e.target.value));

  // Minnesläge init
  if(localStorage.getItem('memoryMode')==='1') document.body.classList.add('memory-mode');
  byId('memoryBtn')?.addEventListener('click', toggleMemory);

  // Lås/wire
  byId('setPassBtn')   ?.addEventListener('click', ()=>setInitialPass(byId('passInput').value));
  byId('unlockBtn')    ?.addEventListener('click', ()=>unlock(byId('passInput').value));
  byId('wipeLocalOnLock')?.addEventListener('click', async ()=>{ if(confirm('Rensa ALL lokal data?')){ await dbClearAll(); localStorage.removeItem('wrap'); location.reload(); } });

  // Meny
  byId('menuToggle')?.addEventListener('click', toggleMenu);

  // CRUD
  byId('newBtn')   ?.addEventListener('click', ()=>{ window.AppState.currentId=null; byId('editor').innerHTML=''; byId('titleInput').value=''; byId('dateLine').textContent=''; byId('editor').focus(); });
  byId('saveBtn')  ?.addEventListener('click', saveEntry);
  byId('deleteBtn')?.addEventListener('click', delEntry);
  byId('lockBtn')  ?.addEventListener('click', lock);

  // Export/import
  byId('exportBtn') ?.addEventListener('click', exportAll);
  byId('importBtn') ?.addEventListener('click', ()=>byId('importInput').click());
  byId('importInput')?.addEventListener('change', e=>{ if(e.target.files?.[0]) importAll(e.target.files[0]); });

  // Sök
  byId('searchBtn')     ?.addEventListener('click', doSearch);
  byId('clearSearchBtn')?.addEventListener('click', ()=>{ byId('searchInput').value=''; renderList(); });

  // Force update
  byId('forceUpdateBtn')?.addEventListener('click', forceUpdate);

  // Start: visa låsskärm och sätt fokus
  showLock();
  setTimeout(()=>byId('passInput')?.focus(),50);
});
