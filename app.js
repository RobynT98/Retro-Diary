// Globalt state
window.AppState = { key:null, currentId:null, selectedImg:null };

// Uppstart + wire-up
document.addEventListener('DOMContentLoaded', async ()=>{
  await idbReady();

  // Lås-skärm
  document.getElementById('setPassBtn')   ?.addEventListener('click', ()=>setInitialPass(document.getElementById('passInput').value));
  document.getElementById('unlockBtn')    ?.addEventListener('click', ()=>unlock(document.getElementById('passInput').value));
  document.getElementById('wipeLocalOnLock')?.addEventListener('click', async ()=>{
    if(!confirm('Rensa ALL lokal data?')) return;
    await dbClearAll(); localStorage.removeItem('wrap'); lock(); alert('Allt rensat.');
  });

  // CRUD
  document.getElementById('newBtn') ?.addEventListener('click', ()=>{ AppState.currentId=null; document.getElementById('editor').innerHTML=''; document.getElementById('titleInput').value=''; document.getElementById('dateLine').textContent=''; document.getElementById('editor').focus(); });
  document.getElementById('saveBtn')?.addEventListener('click', saveEntry);
  document.getElementById('deleteBtn')?.addEventListener('click', delEntry);
  document.getElementById('lockBtn')?.addEventListener('click', lock);

  // Editor autosave
  document.getElementById('editor')    ?.addEventListener('input', scheduleAutosave);
  document.getElementById('titleInput')?.addEventListener('input', scheduleAutosave);

  // Toolbar
  wireToolbar();

  // Sök
  document.getElementById('searchBtn')?.addEventListener('click', ()=>{
    const q=document.getElementById('searchInput').value.trim();
    renderList(q);
  });
  document.getElementById('clearSearchBtn')?.addEventListener('click', ()=>{
    document.getElementById('searchInput').value=''; renderList('');
  });

  // Meny
  document.getElementById('menuToggle')?.addEventListener('click', ()=>{
    if(document.body.classList.contains('locked')) return;
    const m=document.getElementById('menu'); m.classList.toggle('open');
  });
  document.body.addEventListener('click', (e)=>{
    const m=document.getElementById('menu');
    if(!m) return;
    if(e.target.id==='menuToggle' || m.contains(e.target)) return;
    m.classList.remove('open');
  });

  // Export/Import
  document.getElementById('exportBtn')?.addEventListener('click', async ()=>{
    const entries=await dbAll('entries');
    const meta=await getWrapMeta();
    const blob=new Blob([JSON.stringify({meta,entries})],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click(); URL.revokeObjectURL(url);
  });
  document.getElementById('importBtn')?.addEventListener('click', ()=>document.getElementById('importInput').click());
  document.getElementById('importInput')?.addEventListener('change', async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const txt=await f.text(); const data=JSON.parse(txt);
    if(!data.meta || !data.entries) return alert('Felaktig fil.');
    await setWrapMeta(data.meta);
    for(const row of data.entries) await dbPut('entries', row);
    alert('Importerad.'); renderList();
  });
// --- Tema ---
function setTheme(val) {
  const b = document.body;

  // växla klass (används bl.a. av theme_memory.css)
  b.classList.remove('theme-light', 'theme-dark');
  b.classList.add(val === 'dark' ? 'theme-dark' : 'theme-light');

  // växla CSS-fil via <link id="themeLink">
  const link = document.getElementById('themeLink');
  if (link) link.href = (val === 'dark') ? 'theme_dark.css' : 'theme_light.css';

  localStorage.setItem('theme', val);
}

document.addEventListener('DOMContentLoaded', () => {
  // 1) Init tema
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);

  const sel = document.getElementById('themeSelect');
  if (sel) {
    sel.value = savedTheme;
    sel.addEventListener('change', e => setTheme(e.target.value));
  }

  // 2) Minnesläge (läser & sparar)
  const memBtn = document.getElementById('memoryBtn');
  if (localStorage.getItem('memoryMode') === 'on') {
    document.body.classList.add('memory-mode');
  }
  memBtn?.addEventListener('click', () => {
    document.body.classList.toggle('memory-mode');
    const on = document.body.classList.contains('memory-mode');
    localStorage.setItem('memoryMode', on ? 'on' : 'off');
  });

  // 3) Force-update (måste bindas efter DOM finns)
  document.getElementById('forceUpdateBtn')?.addEventListener('click', async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
      alert('Appen uppdateras – laddar om…');
      location.reload(true);
    } catch (e) {
      alert('Kunde inte uppdatera.');
    }
  });

  // 4) Start i låst läge
  showLock();
  setTimeout(() => document.getElementById('passInput')?.focus(), 50);

  console.log('✅ init klar');
});
