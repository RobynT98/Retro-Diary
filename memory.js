// memory.js — robust toggling + persistence för Minnesläge

const MEM_KEY = 'memoryMode';      // "on" | "off"
const THEME_KEY = 'theme';         // "light" | "dark"  (matchar din themes.js)

function applyMemoryMode(isOn) {
  const body = document.body;
  if (isOn) body.classList.add('memory-mode');
  else body.classList.remove('memory-mode');

  // låt minnesläget respektera nuvarande tema
  const theme = localStorage.getItem(THEME_KEY) || 
                (body.classList.contains('theme-dark') ? 'dark' : 'light');
  body.classList.toggle('theme-dark', theme === 'dark');
  body.classList.toggle('theme-light', theme === 'light');

  // spegla ev. checkbox/knapp-status (om du visar ett state)
  const btn = document.getElementById('memoryBtn');
  if (btn) btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
}

// Init när DOM är redo (eller om scriptet laddas sist med defer)
function initMemoryMode() {
  // 1) Återställ sparat läge
  applyMemoryMode(localStorage.getItem(MEM_KEY) === 'on');

  // 2) Event delegation: funkar även om menyn/knappen renderas senare
  document.addEventListener('click', (e) => {
    const t = e.target.closest('#memoryBtn');
    if (!t) return;
    const isOn = !document.body.classList.contains('memory-mode');
    localStorage.setItem(MEM_KEY, isOn ? 'on' : 'off');
    applyMemoryMode(isOn);
  });

  // 3) Om temat ändras via en <select id="themeSelect">, synka minnesläget
  const sel = document.getElementById('themeSelect');
  if (sel) {
    sel.addEventListener('change', () => {
      const v = sel.value === 'Mörkt' || sel.value === 'dark' ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, v);
      applyMemoryMode(localStorage.getItem(MEM_KEY) === 'on');
    });
  }

  // 4) Safety log
  console.debug('[memory] ready; mode =', localStorage.getItem(MEM_KEY));
}

// Kör både direkt (om filen ligger sist med defer) och på DOMContentLoaded (fallback)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMemoryMode);
} else {
  initMemoryMode();
}
