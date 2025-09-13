// ========================= editor.js =========================
// Endast editor-UI: toolbar, fonter, färger, bild/ljud, m.m.
// Ingen CRUD / autosave här – det sköts av app.js

/* Helpers */
const $ = (id) => document.getElementById(id);
const ED = () => $('editor');

const execCmd = (cmd, val = null) => {
  try { document.execCommand('styleWithCSS', false, true); } catch {}
  document.execCommand(cmd, false, val ?? null);
};

// Signalera till app.js att innehållet ändrats (triggar autosave via lyssnare där)
function signalChange() {
  const ed = ED();
  if (!ed) return;
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}

/* =================== Fonter & storlek =================== */

function populateFonts() {
  const sel = $('fontFamily');
  if (!sel || !window.FONT_DB) return;

  sel.innerHTML = '';
  window.FONT_DB.forEach(f => {
    // se till att fontens CSS laddas
    window.loadFontCSS?.(f.css);

    const o = document.createElement('option');
    o.value = f.stack;
    o.textContent = f.name;
    o.dataset.css = f.css;
    o.style.fontFamily = f.stack;
    sel.appendChild(o);
  });

  // default till första posten
  if (sel.options.length) sel.value = sel.options[0].value;

  sel.onchange = () => {
    const opt = sel.selectedOptions[0];
    if (!opt) return;
    window.loadFontCSS?.(opt.dataset.css);
    // sätt basfont i editorn
    const ed = ED(); if (ed) ed.style.fontFamily = opt.value;
    // och på markerad text
    execCmd('fontName', opt.value);
    signalChange();
  };
}

function applyFontSize(px) {
  const size = String(px).endsWith('px') ? px : (px + 'px');

  // Bas-stil i editorn
  const ed = ED();
  if (ed) ed.style.fontSize = size;

  // För markerat innehåll: använd fontSize + ersätt <font size=...> med <span style="font-size">
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '4'); // lägger in <font size="4"> som vi byter ut nedan

  ed?.querySelectorAll('font[size]').forEach(f => {
    const span = document.createElement('span');
    span.style.fontSize = size;
    span.innerHTML = f.innerHTML;
    f.parentNode.replaceChild(span, f);
  });

  signalChange();
}

/* =================== Bild & ljud =================== */

function fileToScaledDataURL(file, maxW = 1600, maxH = 1600, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const cw = Math.round(img.width * scale);
        const ch = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
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

  const im = document.createElement('img');
  im.src = src;
  im.alt = captionText || '';

  const cap = document.createElement('figcaption');
  cap.textContent = captionText;

  fig.appendChild(im);
  fig.appendChild(cap);

  const sel = window.getSelection();
  const ed = ED();

  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(fig);
    r.setStartAfter(fig);
    r.setEndAfter(fig);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    ed?.appendChild(fig);
  }

  // markera bilden visuellt (för resize)
  window.AppState = window.AppState || {};
  if (window.AppState.selectedImg) window.AppState.selectedImg.classList?.remove('selected');
  im.classList.add('selected');
  window.AppState.selectedImg = im;

  signalChange();
}

function pickAndInsertImage() {
  const input = $('imgFile');
  if (!input) return alert('imgFile saknas i HTML.');
  input.click();
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToScaledDataURL(file, 1600, 1600, 0.88);
      insertImageFigure(dataUrl, '');
    } catch {
      alert('Kunde inte läsa bilden.');
    }
  };
}

function pickAndInsertAudio() {
  const input = $('audioFile');
  if (!input) return alert('audioFile saknas i HTML.');
  input.click();
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    input.value = '';
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      execCmd('insertHTML', `<audio controls src="${fr.result}"></audio>`);
      signalChange();
    };
    fr.readAsDataURL(file);
  };
}

// markera bild när man klickar
ED()?.addEventListener('click', (e) => {
  window.AppState = window.AppState || {};
  if (window.AppState.selectedImg) window.AppState.selectedImg.classList.remove('selected');
  window.AppState.selectedImg = (e.target && e.target.tagName === 'IMG') ? e.target : null;
  if (window.AppState.selectedImg) window.AppState.selectedImg.classList.add('selected');
});

function resizeSelectedImg(delta) {
  const img = window.AppState?.selectedImg;
  if (!img) return alert('Markera en bild först.');
  const cur = parseInt(img.style.width || '100', 10);
  const next = Math.max(10, Math.min(200, (isNaN(cur) ? 100 : cur) + delta));
  img.style.width = next + '%';
  signalChange();
}

/* =================== Toolbar-bindningar =================== */

function wireToolbar() {
  // textformat
  $('boldBtn')      ?.addEventListener('click', () => execCmd('bold'));
  $('italicBtn')    ?.addEventListener('click', () => execCmd('italic'));
  $('underlineBtn') ?.addEventListener('click', () => execCmd('underline'));
  $('strikeBtn')    ?.addEventListener('click', () => execCmd('strikeThrough'));
  $('clearFmtBtn')  ?.addEventListener('click', () => {
    execCmd('removeFormat'); execCmd('unlink'); execCmd('formatBlock', 'P'); signalChange();
  });

  // block/listor/align
  $('blockSelect')  ?.addEventListener('change', (e) => { execCmd('formatBlock', e.target.value); signalChange(); });
  $('ulBtn')        ?.addEventListener('click', () => { execCmd('insertUnorderedList'); signalChange(); });
  $('olBtn')        ?.addEventListener('click', () => { execCmd('insertOrderedList'); signalChange(); });
  $('leftBtn')      ?.addEventListener('click', () => execCmd('justifyLeft'));
  $('centerBtn')    ?.addEventListener('click', () => execCmd('justifyCenter'));
  $('rightBtn')     ?.addEventListener('click', () => execCmd('justifyRight'));
  $('justifyBtn')   ?.addEventListener('click', () => execCmd('justifyFull'));
  $('hrBtn')        ?.addEventListener('click', () => { execCmd('insertHorizontalRule'); signalChange(); });
  $('undoBtn')      ?.addEventListener('click', () => execCmd('undo'));
  $('redoBtn')      ?.addEventListener('click', () => execCmd('redo'));

  // färg
  $('foreColor')    ?.addEventListener('input', (e) => { execCmd('foreColor',   e.target.value); signalChange(); });
  $('hiliteColor')  ?.addEventListener('input', (e) => { execCmd('hiliteColor', e.target.value); signalChange(); });
  $('blockBg')      ?.addEventListener('input', (e) => { execCmd('backColor',   e.target.value); signalChange(); });

  // fonter
  populateFonts();
  $('fontSize')     ?.addEventListener('change', (e) => applyFontSize(e.target.value));

  // länkar
  $('linkBtn')      ?.addEventListener('click', () => {
    const url = prompt('Länkadress (https://…)');
    if (url) { execCmd('createLink', url); signalChange(); }
  });
  $('unlinkBtn')    ?.addEventListener('click', () => { execCmd('unlink'); signalChange(); });

  // media
  $('btnImage')     ?.addEventListener('click', pickAndInsertImage);
  $('btnImgSmaller')?.addEventListener('click', () => resizeSelectedImg(-10));
  $('btnImgBigger') ?.addEventListener('click', () => resizeSelectedImg(10));
  $('btnAudio')     ?.addEventListener('click', pickAndInsertAudio);

  // extra
  $('emojiBtn')     ?.addEventListener('click', () => {
    const e = prompt('Emoji/symbol (t.ex. 🕯️🕊️❤️):');
    if (e) { execCmd('insertText', e); signalChange(); }
  });
  $('stampBtn')     ?.addEventListener('click', () => { execCmd('insertText', new Date().toLocaleString()); signalChange(); });
  $('copyBtn')      ?.addEventListener('click', async () => {
    try { const t = window.getSelection()?.toString(); if (t) await navigator.clipboard.writeText(t); } catch {}
  });
  $('pasteBtn')     ?.addEventListener('click', async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { execCmd('insertText', t); signalChange(); } }
    catch { alert('Tillåt urklipp för att klistra in.'); }
  });
  $('ttsBtn')       ?.addEventListener('click', () => {
    const t = window.getSelection()?.toString() || ED()?.innerText || '';
    if (!t) return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = (localStorage.getItem('lang') === 'en') ? 'en-US' : 'sv-SE';
    speechSynthesis.speak(u);
  });

  // OBS: Inga editor/titleInput 'input'-lyssnare här.
  // Det görs i app.js så att autosave är på ett ställe.
}

/* Exponera för app.js (och ev. global användning) */
window.populateFonts = populateFonts;
window.applyFontSize = applyFontSize;
window.wireToolbar   = wireToolbar;

// Auto-binda om filen laddas fristående (ofarligt om app.js också kallar)
document.addEventListener('DOMContentLoaded', () => {
  try { wireToolbar(); } catch {}
});
