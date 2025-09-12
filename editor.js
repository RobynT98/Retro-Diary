const S = { autosave:null };
const $id = (x)=>document.getElementById(x);
const exec = (cmd,val=null)=>document.execCommand(cmd,false,val);

// ---- Autosave ----
function scheduleAutosave(){
  clearTimeout(S.autosave);
  S.autosave = setTimeout(()=>{ saveEntry(); }, 700);
}

// ---- Titlar ----
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t=(tmp.textContent||'').trim().split(/\n/)[0].slice(0,80);
  return t || 'Anteckning';
}
function applyTitle(v){ $id('titleInput').value=v||''; }

// ---- Media helpers ----
function fileToScaledDataURL(file, maxW=1600, maxH=1600, quality=0.9){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const s=Math.min(1, maxW/img.width, maxH/img.height);
        const w=Math.round(img.width*s), h=Math.round(img.height*s);
        const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror=()=>reject(new Error('Ogiltig bild'));
      img.src=fr.result;
    };
    fr.onerror=()=>reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function insertImageFigure(src, caption=''){
  const fig=document.createElement('figure');
  const im=document.createElement('img'); im.src=src; im.alt=caption; im.classList.add('resizable','selected');
  const cap=document.createElement('figcaption'); cap.textContent=caption;
  fig.appendChild(im); fig.appendChild(cap);

  const sel=window.getSelection();
  if(sel && sel.rangeCount){
    const r=sel.getRangeAt(0); r.deleteContents(); r.insertNode(fig);
    r.setStartAfter(fig); r.setEndAfter(fig); sel.removeAllRanges(); sel.addRange(r);
  }else $id('editor').appendChild(fig);
  scheduleAutosave();
}
function pickAndInsertImage(){
  const input=$id('imgFile'); if(!input) return;
  input.onchange=async (e)=>{
    const f=e.target.files?.[0]; input.value='';
    if(!f) return;
    try{ const url=await fileToScaledDataURL(f); insertImageFigure(url,''); }catch(err){ alert('Kunde inte läsa bilden.'); }
  };
  input.click();
}
function pickAndInsertAudio(){
  const input=$id('audioFile'); if(!input) return;
  input.onchange = (e)=>{
    const f=e.target.files?.[0]; input.value='';
    if(!f) return;
    const fr=new FileReader();
    fr.onload=()=>{ document.execCommand('insertHTML', false, `<audio controls src="${fr.result}"></audio>`); scheduleAutosave(); };
    fr.readAsDataURL(f);
  };
  input.click();
}

// ---- Bild-resize (markera och +/-) ----
document.getElementById('editor')?.addEventListener('click',(e)=>{
  document.querySelectorAll('#editor img.selected').forEach(i=>i.classList.remove('selected'));
  if(e.target && e.target.tagName==='IMG') e.target.classList.add('selected');
});
function resizeSelectedImg(delta){
  const img = document.querySelector('#editor img.selected');
  if(!img) return alert('Markera en bild i editorn först.');
  const cur = parseInt(img.style.width||'100',10);
  const next = Math.max(10, Math.min(200, cur+delta));
  img.style.width = next + '%';
  scheduleAutosave();
}

// ---- Text-to-speech (för vald text eller hela) ----
function speakSelection(){
  const t = window.getSelection()?.toString() || $id('editor').innerText;
  if(!t) return;
  const u=new SpeechSynthesisUtterance(t); u.lang='sv-SE'; speechSynthesis.speak(u);
}

// ---- Clipboard helpers ----
async function copySelection(){
  const t=window.getSelection()?.toString(); if(!t) return;
  try{ await navigator.clipboard.writeText(t); }catch{}
}
async function pasteClipboard(){
  try{
    const t=await navigator.clipboard.readText();
    if(t) document.execCommand('insertText', false, t);
  }catch{ alert('Tillåt urklipp för att klistra in.'); }
}

// ---- Rensa format & blockbakgrund ----
function clearFormatting(){
  exec('removeFormat'); exec('unlink'); exec('formatBlock','P');
}
function setBlockBg(color){ exec('backColor', color); }

// ---- Fonter ----
function populateFonts(){
  const sel=$id('fontFamily'); if(!sel || !window.FONT_DB) return;
  sel.innerHTML='';
  window.FONT_DB.forEach(f=>{
    const o=document.createElement('option');
    o.textContent=f.name; o.value=f.stack; o.dataset.css=f.css; o.style.fontFamily=f.stack;
    sel.appendChild(o); window.loadFontCSS?.(f.css);
  });
  sel.addEventListener('change', ()=>{
    const opt=sel.selectedOptions[0]; window.loadFontCSS?.(opt.dataset.css);
    exec('fontName', opt.value);
    $id('editor').style.fontFamily = opt.value;
    scheduleAutosave();
  });
}
function applyFontSize(px){
  const size = String(px).endsWith('px') ? px : px+'px';
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '4'); // browsers hack
  // valfritt: låt det vara så; moderna browsers renderar ok.
}

// ---- Wire toolbar ----
function wireToolbar(){
  // Stil
  $id('boldBtn')    ?.addEventListener('click', ()=>exec('bold'));
  $id('italicBtn')  ?.addEventListener('click', ()=>exec('italic'));
  $id('underlineBtn')?.addEventListener('click', ()=>exec('underline'));
  $id('strikeBtn')  ?.addEventListener('click', ()=>exec('strikeThrough'));
  $id('clearFmtBtn')?.addEventListener('click', clearFormatting);

  // Block/justering/listor
  $id('blockSelect')?.addEventListener('change', e=>exec('formatBlock', e.target.value));
  $id('leftBtn')    ?.addEventListener('click', ()=>exec('justifyLeft'));
  $id('centerBtn')  ?.addEventListener('click', ()=>exec('justifyCenter'));
  $id('rightBtn')   ?.addEventListener('click', ()=>exec('justifyRight'));
  $id('justifyBtn') ?.addEventListener('click', ()=>exec('justifyFull'));
  $id('ulBtn')      ?.addEventListener('click', ()=>exec('insertUnorderedList'));
  $id('olBtn')      ?.addEventListener('click', ()=>exec('insertOrderedList'));
  $id('hrBtn')      ?.addEventListener('click', ()=>exec('insertHorizontalRule'));
  $id('undoBtn')    ?.addEventListener('click', ()=>exec('undo'));
  $id('redoBtn')    ?.addEventListener('click', ()=>exec('redo'));

  // Färg/font
  $id('foreColor')  ?.addEventListener('input', e=>exec('foreColor', e.target.value));
  $id('hiliteColor')?.addEventListener('input', e=>exec('hiliteColor', e.target.value));
  $id('blockBg')    ?.addEventListener('input', e=>setBlockBg(e.target.value));
  populateFonts();
  $id('fontSize')   ?.addEventListener('change', e=>applyFontSize(e.target.value));

  // Länk + insätt
  $id('linkBtn')    ?.addEventListener('click', ()=>{ const url=prompt('Länk (https://...)'); if(url) exec('createLink', url); });
  $id('unlinkBtn')  ?.addEventListener('click', ()=>exec('unlink'));
  $id('emojiBtn')   ?.addEventListener('click', ()=>{ const ch=prompt('Emoji/symbol (t.ex. 🕯️🕊️❤️)'); if(ch) exec('insertText', ch); });
  $id('stampBtn')   ?.addEventListener('click', ()=>exec('insertText', new Date().toLocaleString()));
  $id('copyBtn')    ?.addEventListener('click', copySelection);
  $id('pasteBtn')   ?.addEventListener('click', pasteClipboard);
  $id('ttsBtn')     ?.addEventListener('click', speakSelection);

  // Media
  $id('btnImage')   ?.addEventListener('click', pickAndInsertImage);
  $id('btnAudio')   ?.addEventListener('click', pickAndInsertAudio);
  $id('btnImgSmaller')?.addEventListener('click', ()=>resizeSelectedImg(-10));
  $id('btnImgBigger') ?.addEventListener('click', ()=>resizeSelectedImg(+10));

  // Editor input -> autosave
  $id('editor')?.addEventListener('input', scheduleAutosave);
  $id('titleInput')?.addEventListener('input', scheduleAutosave);
}

document.addEventListener('DOMContentLoaded', wireToolbar);
