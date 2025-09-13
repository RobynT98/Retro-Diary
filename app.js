// ==============================
// Retro Diary - app.js (clean)
// ==============================

// Globalt state
window.AppState = { key: null, currentId: null, selectedImg: null };

// ------------------------------
// Tema
function setTheme(val) {
  const b = document.body;
  b.classList.remove('theme-light', 'theme-dark');
  b.classList.add(val === 'dark' ? 'theme-dark' : 'theme-light');

  const link = document.getElementById('themeLink');
  if (link) link.href = (val === 'dark') ? 'theme_dark.css' : 'theme_light.css';

  localStorage.setItem('theme', val);
}

// ------------------------------
// Init
document.addEventListener('DOMContentLoaded', async () => {
  await idbReady();

  // ----- Lås-skärm
  document.getElementById('setPassBtn')?.addEventListener('click', () =>
    setInitialPass(document.getElementById('passInput').value)
  );
  document.getElementById('unlockBtn')?.addEventListener('click', () =>
    unlock(document.getElementById('passInput').value)
  );
  document.getElementById('wipeLocalOnLock')?.addEventListener('click', async () => {
    if (!confirm('Rensa ALL lokal data?')) return;
    await dbClearAll();
    localStorage.removeItem('wrap');
    lock();
    alert('Allt rensat.');
  });

  // ----- CRUD
  document.getElementById('newBtn')?.addEventListener('click', () => {
    AppState.currentId = null;
    document.getElementById('editor').innerHTML = '';
    document.getElementById('titleInput').value = '';
    document.getElementById('dateLine').textContent = '';
    document.getElementById('editor').focus();
  });
  document.getElementById('saveBtn')?.addEventListener('click', saveEntry);
  document.getElementById('deleteBtn')?.addEventListener('click', delEntry);
  document.getElementById('lockBtn')?.addEventListener('click', lock);

  // ----- Editor autosave
  document.getElementById('editor')?.addEventListener('input', scheduleAutosave);
  document.getElementById('titleInput')?.addEventListener('input', scheduleAutosave);

  // ----- Toolbar
  wireToolbar();

  // ----- Sök
  document.getElementById('searchBtn')?.addEventListener('click', () => {
    const q = document.getElementById('searchInput').value.trim();
    renderList(q);
  });
  document.getElementById('clearSearchBtn')?.addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    renderList('');
  });

  // ----- Meny (hamburger)
  const menu = document.getElementById('menu');
  const toggle = document.getElementById('menuToggle');

  toggle?.addEventListener('click', (e) => {
    if (document.body.classList.contains('locked')) return;
    e.stopPropagation();
    const opened = menu.classList.toggle('open');
    document.body.classList.toggle('menu-open', opened);
    // focus in menu for a11y
    if (opened) menu.querySelector('button,select,input')?.focus?.();
  });

  // stäng när man klickar utanför
  document.addEventListener('click', (e) => {
    if (!menu?.classList.contains('open')) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    menu.classList.remove('open');
    document.body.classList.remove('menu-open');
  });

  // ----- Export/Import
  document.getElementById('exportBtn')?.addEventListener('click', async () => {
    const entries = await dbAll('entries');
    const meta = await getWrapMeta();
    const blob = new Blob([JSON.stringify({ meta, entries })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'retro-diary.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importBtn')?.addEventListener('click', () =>
    document.getElementById('importInput').click()
  );

  document.getElementById('importInput')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    const data = JSON.parse(txt);
    if (!data.meta || !data.entries) return alert('Felaktig fil.');
    await setWrapMeta(data.meta);
    for (const row of data.entries) await dbPut('entries', row);
    alert('Importerad.');
    renderList();
  });

  // ----- Tema (init + select)
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);

  const themeSel = document.getElementById('themeSelect');
  if (themeSel) {
    themeSel.value = savedTheme;
    themeSel.addEventListener('change', (e) => setTheme(e.target.value));
  }

  // ----- Minnesläge (init + toggle)
  if (localStorage.getItem('memoryMode') === 'on') {
    document.body.classList.add('memory-mode');
  }
  document.getElementById('memoryBtn')?.addEventListener('click', () => {
    document.body.classList.toggle('memory-mode');
    const on = document.body.classList.contains('memory-mode');
    localStorage.setItem('memoryMode', on ? 'on' : 'off');
  });

  // ----- Force-update
  document.getElementById('forceUpdateBtn')?.addEventListener('click', async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      alert('Appen uppdateras – laddar om…');
      location.reload(true);
    } catch (e) {
      alert('Kunde inte uppdatera.');
    }
  });

  // ----- Start i låst läge
  showLock();
  setTimeout(() => document.getElementById('passInput')?.focus(), 50);

  console.log('✅ init klar');
});
