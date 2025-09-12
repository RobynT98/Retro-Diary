// ========================= editor.js =========================
// Samlad editorlogik: toolbar, fonter, bild/ljud, autosave, CRUD-lista

// ---- Lokalt state + helpers
const S = { debounce: null };
const $id = (x) => document.getElementById(x);
const execCmd = (cmd, val = null) => {
  // Skriv inline-CSS där det passar bättre (fontSize etc)
  try { document.execCommand('styleWithCSS', false, true); } catch {}
  document.execCommand(cmd, false, val ?? null);
};
function scheduleAutosave() {
  clearTimeout(S.debounce);
  S.debounce = setTimeout(() => { saveEntry(); }, 600);
}
function titleFrom(html) {
  const tmp = document.createElement('div'); tmp.innerHTML = html || '';
  const t = (tmp.textContent || '').trim().split(/\n/)[0].slice(0, 80);
  return t || 'Anteckning';
}

// ---- CRUD (kräver AppState + crypto + storage)
async function saveEntry() {
  const st = window.AppState || {};
  if (!st.key) { alert('Lås upp först.'); return; }
  const id = st.currentId || Date.now();
  const html = $id('editor').innerHTML;
  const title = ($id('titleInput')?.value || titleFrom(html));
  const obj = { id, html, date: new Date().toLocaleString(), title };
  const wrap = await encObj(st.key, obj);
  await dbPut('entries', { id, wrap, updated: Date.now() });
  st.currentId = id;
  await renderList();
}
async function openEntry(id) {
  const st = window.AppState || {};
  const row = await dbGet('entries', id);
  if (!row || !st.key) return;
  try {
    const dec = await decObj(st.key, row.wrap);
    st.currentId = dec.id;
    $id('editor').innerHTML = dec.html;
    if ($id('titleInput')) $id('titleInput').value = dec.title || '';
    $id('dateLine').textContent = dec.date || '';
    $id('editor').focus();
  } catch { alert('Kunde inte dekryptera.'); }
}
async function delEntry() {
  const st = window.AppState || {};
  if (!st.key || !st.currentId) return;
  if (!confirm('Radera den här sidan?')) return;
  await dbDel('entries', st.currentId);
  st.currentId = null;
  if ($id('editor')) $id('editor').innerHTML = '';
  if ($id('dateLine')) $id('dateLine').textContent = '';
  if ($id('titleInput')) $id('titleInput').value = '';
  await renderList();
}
async function renderList(filter = '') {
  const ul = $id('entries'); if (!ul) return;
  ul.innerHTML = '';
  const all = (await dbAll('entries')).sort((a, b) => (b.updated || b.id) - (a.updated || a.id));

  // För listan visar vi title + datum. Om låst eller decrypt fail — visa bara datum.
  const st = window.AppState || {};
  for (const e of all) {
    let title = '';
    if (st.key) {
      try {
        const dec = await decObj(st.key, e.wrap);
        title = dec?.title || '';
      } catch {}
    }
    const row = document.createElement('li');
    row.textContent = (title ? title + ' — ' : '') + new Date(e.updated || e.id).toLocaleString('sv-SE');
    if (filter) {
      const lc = (row.textContent || '').toLowerCase();
      if (!lc.includes(filter.toLowerCase())) continue;
    }
    row.addEventListener('click', () => openEntry(e.id));
    ul.appendChild(row);
  }
}
function applyTitle(v) { if ($id('titleInput')) $id('titleInput').value = v || ''; }

// ---- Bild & ljud
function fileToScaledDataURL(file, maxW = 1600, maxH = 1600, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Ogiltig bild'));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function insertImageFigure(src, captionText = '') {
  const fig = document.createElement('figure');
  const im = document.createElement('img'); im.src = src; im.alt = captionText || '';
  const cap = document.createElement('figcaption'); cap.textContent = captionText;

  fig.appendChild(im); fig.appendChild(cap);

  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(fig);
    r.setStartAfter(fig); r.setEndAfter(fig); sel.removeAllRanges(); sel.addRange(r);
  } else {
    $id('editor').appendChild(fig);
  }

  // markera
  const st = window.AppState || {};
  if (st.selectedImg) st.selectedImg.classList?.remove('selected');
  im.classList.add('selected'); st.selectedImg = im;
  scheduleAutosave();
}
function pickAndInsertImage() {
  const input = $id('imgFile'); if (!input) return alert('imgFile saknas i HTML');
  input.click();
  input.onchange = async (e) => {
    const file = e.target.files?.[0]; input.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToScaledDataURL(file, 1600, 1600, 0.88);
      insertImageFigure(dataUrl, '');
      setTimeout(scheduleAutosave, 300);
    } catch { alert('Kunde inte läsa bilden.'); }
  };
}
function pickAndInsertAudio() {
  const input = $id('audioFile'); if (!input) return alert('audioFile saknas i HTML');
  input.click();
  input.onchange = async (e) => {
    const file = e.target.files?.[0]; input.value = '';
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => { document.execCommand('insertHTML', false, `<audio controls src="${fr.result}"></audio>`); scheduleAutosave(); };
    fr.readAsDataURL(file);
  };
}
// markera bild för resize
$id('editor')?.addEventListener('click', (e) => {
  const st = window.AppState || {};
  if (st.selectedImg) st.selectedImg.classList.remove('selected');
  st.selectedImg = (e.target && e.target.tagName === 'IMG') ? e.target : null;
  if (st.selectedImg) st.selectedImg.classList.add('selected');
});
function resizeSelectedImg(delta) {
  const st = window.AppState || {}; const img = st.selectedImg; if (!img) return alert('Markera en bild först.');
  const cur = parseInt(img.style.width || '100', 10);
  const next = Math.max(10, Math.min(200, (isNaN(cur) ? 100 : cur) + delta));
  img.style.width = next + '%'; scheduleAutosave();
}

// ---- Fonterna (från fonts_db.js)
function populateFonts() {
  const sel = $id('fontFamily'); if (!sel || !window.FONT_DB) return;
  sel.innerHTML = '';
  window.FONT_DB.forEach(f => {
    // ladda CSS
    window.loadFontCSS?.(f.css);
    // option
    const o = document.createElement('option');
    o.value = f.stack; o.textContent = f.name; o.dataset.css = f.css; o.style.fontFamily = f.stack;
    sel.appendChild(o);
  });
  // set default om vill
  if (sel.options.length) sel.value = sel.options[0].value;

  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    if (!opt) return;
    window.loadFontCSS?.(opt.dataset.css);
    // sätt base-style i editor
    $id('editor').style.fontFamily = opt.value;
    // och även på markerad text
    execCmd('fontName', opt.value);
  };
}
function applyFontSize(px) {
  const size = String(px).endsWith('px') ? px : (px + 'px');
  // Kombo: styling i editor + försök på markerat
  $id('editor').style.fontSize = size;
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '4'); // ersätts nedan
  const ed = $id('editor');
  ed.querySelectorAll('font[size]').forEach(f => {
    const span = document.createElement('span');
    span.style.fontSize = size;
    span.innerHTML = f.innerHTML;
    f.parentNode.replaceChild(span, f);
  });
}

// ---- Toolbar-bindningar
function wireToolbar() {
  // textformat
  $id('boldBtn')      ?.addEventListener('click', () => execCmd('bold'));
  $id('italicBtn')    ?.addEventListener('click', () => execCmd('italic'));
  $id('underlineBtn') ?.addEventListener('click', () => execCmd('underline'));
  $id('strikeBtn')    ?.addEventListener('click', () => execCmd('strikeThrough'));
  $id('clearFmtBtn')  ?.addEventListener('click', () => { execCmd('removeFormat'); execCmd('unlink'); execCmd('formatBlock', 'P'); });

  // block / listor / align
  $id('blockSelect')  ?.addEventListener('change', (e) => execCmd('formatBlock', e.target.value));
  $id('ulBtn')        ?.addEventListener('click', () => execCmd('insertUnorderedList'));
  $id('olBtn')        ?.addEventListener('click', () => execCmd('insertOrderedList'));
  $id('leftBtn')      ?.addEventListener('click', () => execCmd('justifyLeft'));
  $id('centerBtn')    ?.addEventListener('click', () => execCmd('justifyCenter'));
  $id('rightBtn')     ?.addEventListener('click', () => execCmd('justifyRight'));
  $id('justifyBtn')   ?.addEventListener('click', () => execCmd('justifyFull'));
  $id('hrBtn')        ?.addEventListener('click', () => execCmd('insertHorizontalRule'));
  $id('undoBtn')      ?.addEventListener('click', () => execCmd('undo'));
  $id('redoBtn')      ?.addEventListener('click', () => execCmd('redo'));

  // färg
  $id('foreColor')    ?.addEventListener('input', (e) => execCmd('foreColor', e.target.value));
  $id('hiliteColor')  ?.addEventListener('input', (e) => execCmd('hiliteColor', e.target.value));
  $id('blockBg')      ?.addEventListener('input', (e) => execCmd('backColor', e.target.value));

  // font
  populateFonts();
  $id('fontSize')     ?.addEventListener('change', (e) => applyFontSize(e.target.value));

  // länkar
  $id('linkBtn')      ?.addEventListener('click', () => {
    const url = prompt('Länkadress (https://…)'); if (url) execCmd('createLink', url);
  });
  $id('unlinkBtn')    ?.addEventListener('click', () => execCmd('unlink'));

  // media
  $id('btnImage')     ?.addEventListener('click', pickAndInsertImage);
  $id('btnImgSmaller')?.addEventListener('click', () => resizeSelectedImg(-10));
  $id('btnImgBigger') ?.addEventListener('click', () => resizeSelectedImg(10));
  $id('btnAudio')     ?.addEventListener('click', pickAndInsertAudio);

  // extra
  $id('emojiBtn')     ?.addEventListener('click', () => {
    const e = prompt('Emoji/symbol (t.ex. 🕯️🕊️❤️):'); if (!e) return; execCmd('insertText', e);
  });
  $id('stampBtn')     ?.addEventListener('click', () => execCmd('insertText', new Date().toLocaleString()));
  $id('copyBtn')      ?.addEventListener('click', async () => {
    try { const t = window.getSelection()?.toString(); if (t) await navigator.clipboard.writeText(t); } catch {}
  });
  $id('pasteBtn')     ?.addEventListener('click', async () => {
    try { const t = await navigator.clipboard.readText(); if (t) execCmd('insertText', t); } catch { alert('Tillåt urklipp för att klistra in.'); }
  });
  $id('ttsBtn')       ?.addEventListener('click', () => {
    const t = window.getSelection()?.toString() || $id('editor').innerText; if (!t) return;
    const u = new SpeechSynthesisUtterance(t); u.lang = 'sv-SE'; speechSynthesis.speak(u);
  });

  // editor input → autosave
  $id('editor')     ?.addEventListener('input', scheduleAutosave);
  $id('titleInput') ?.addEventListener('input', scheduleAutosave);
}

// ---- Exportera några funktioner globalt (används av app.js)
window.saveEntry     = saveEntry;
window.openEntry     = openEntry;
window.delEntry      = delEntry;
window.renderList    = renderList;
window.scheduleAutosave = scheduleAutosave;
window.populateFonts = populateFonts;
window.wireToolbar   = wireToolbar;

// ---- Init (om du vill auto-binda här; annars kalla från app.js)
document.addEventListener('DOMContentLoaded', () => {
  try { wireToolbar(); } catch {}
});
