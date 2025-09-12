const S = { debounce:null };
const $id = (x)=>document.getElementById(x);

function execCmd(cmd,val){ document.execCommand('styleWithCSS', false, true); document.execCommand(cmd,false,val||null); }

function scheduleAutosave(){
  clearTimeout(S.debounce);
  S.debounce = setTimeout(()=>{ saveEntry(); }, 600);
}

function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t=(tmp.textContent||'').trim().split(/\n/)[0].slice(0,80);
  return t || 'Anteckning';
}

async function saveEntry(){
  const st=window.AppState||{};
  if(!st.key){ alert('Lås upp först.'); return; }
  const id = st.currentId || Date.now();
  const html = $id('editor').innerHTML;
  const title= ($id('titleInput').value || titleFrom(html));
  const obj = { id, html, date: new Date().toLocaleString(), title };
  const wrap = await encObj(st.key, obj);
  await dbPut('entries', { id, wrap, updated:Date.now() });
  st.currentId=id;
  await renderList();
}

async function openEntry(id){
  const st=window.AppState||{};
  const row = await dbGet('entries', id);
  if(!row || !st.key) return;
  try{
    const dec=await decObj(st.key, row.wrap);
    st.currentId=dec.id;
    $id('editor').innerHTML=dec.html;
    $id('titleInput').value=dec.title||'';
    $id('dateLine').textContent=dec.date||'';
    $id('editor').focus();
  }catch{ alert('Kunde inte dekryptera.'); }
}

async function delEntry(){
  const st=window.AppState||{};
  if(!st.key || !st.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', st.currentId);
  st.currentId=null; $id('editor').innerHTML=''; $id('dateLine').textContent=''; $id('titleInput').value='';
  await renderList();
}

async function renderList(filter=''){
  const ul=$id('entries'); if(!ul) return;
  ul.innerHTML='';
  const all=(await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  const st=window.AppState||{};
  for(const e of all){
    let t=''; try{ const dec=st.key?await decObj(st.key,e.wrap):null; t=dec?.title||''; }catch{}
    const row=document.createElement('li');
    row.textContent = (t ? t+' — ' : '') + new Date(e.updated||e.id).toLocaleString('sv-SE');
    row.addEventListener('click', ()=>openEntry(e.id));
    if(filter){
      const lc=(row.textContent||'').toLowerCase();
      if(!lc.includes(filter.toLowerCase())) continue;
    }
    ul.appendChild(row);
  }
}

function applyTitle(v){ $id('titleInput').value=v||''; }

function toggleMenu(){
  const m=$id('menu');
  m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}

/* ---------- Bild & ljud ---------- */
function fileToScaledDataURL(file, maxW=1600, maxH=1600, quality=0.88){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW/img.width, maxH/img.height);
        const cw = Math.round(img.width*scale), ch = Math.round(img.height*scale);
        const cv = document.createElement('canvas'); cv.width=cw; cv.height=ch;
        cv.getContext('2d').drawImage(img,0,0,cw,ch);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Ogiltig bild'));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function insertImageFigure(src, captionText=''){
  const fig=document.createElement('figure');
  const im=document.createElement('img'); im.src=src; im.alt=captionText||''; im.classList.add('resizable','selected');
  const cap=document.createElement('figcaption'); cap.textContent=captionText;
  fig.appendChild(im); fig.appendChild(cap);

  const sel=window.getSelection();
  if(sel && sel.rangeCount){ const r=sel.getRangeAt(0); r.deleteContents(); r.insertNode(fig); r.setStartAfter(fig); r.setEndAfter(fig); sel.removeAllRanges(); sel.addRange(r); }
  else { $id('editor').appendChild(fig); }

  const st=window.AppState||{};
  if(st.selectedImg) st.selectedImg.classList.remove('selected');
  st.selectedImg = im;
  scheduleAutosave();
}
function pickAndInsertImage(){
  const input=$id('imgFile'); if(!input) return alert('imgFile saknas i HTML');
  input.click();
  input.onchange = async (e)=>{
    const file=e.target.files?.[0]; input.value='';
    if(!file) return;
    try{ const dataUrl=await fileToScaledDataURL(file,1600,1600,0.88); insertImageFigure(dataUrl,''); setTimeout(scheduleAutosave,300); }
    catch(err){ alert('Kunde inte läsa bilden.'); }
  };
}
function pickAndInsertAudio(){
  const input=$id('audioFile'); if(!input) return alert('audioFile saknas i HTML');
  input.click();
  input.onchange = async (e)=>{
    const file=e.target.files?.[0]; input.value='';
    if(!file) return;
    const fr=new FileReader();
    fr.onload=()=>{ document.execCommand('insertHTML',false,`<audio controls src="${fr.result}"></audio>`); scheduleAutosave(); };
    fr.readAsDataURL(file);
  };
}
$id('editor')?.addEventListener('click',(e)=>{
  const st=window.AppState||{};
  if(st.selectedImg) st.selectedImg.classList.remove('selected');
  st.selectedImg = (e.target && e.target.tagName==='IMG') ? e.target : null;
  if(st.selectedImg) st.selectedImg.classList.add('selected');
});
function resizeSelectedImg(delta){
  const st=window.AppState||{}; const img=st.selectedImg; if(!img) return alert('Markera en bild först.');
  const cur=parseInt(img.style.width || '100',10);
  const next=Math.max(10,Math.min(200,(isNaN(cur)?100:cur)+delta));
  img.style.width=next+'%'; scheduleAutosave();
}

/* ---------- Font & typografi ---------- */
function populateFonts(){
  const sel=$id('fontFamily'); if(!sel || !window.FONT_DB) return;
  sel.innerHTML='';
  window.FONT_DB.forEach(f=>{
    const o=document.createElement('option');
    o.textContent=f.name; o.value=f.stack; o.dataset.css=f.css; o.style.fontFamily=f.stack;
    sel.appendChild(o);
  });
  // Ladda två populära direkt
  ['IM+Fell+English','Special+Elite'].forEach(css=>window.loadFontCSS?.(css));
  sel.addEventListener('change', ()=>{
    const opt=sel.selectedOptions[0]; window.loadFontCSS?.(opt.dataset.css);
    document.execCommand('fontName', false, opt.value);
    $id('editor').style.fontFamily = opt.value; // default i editorn
  });
}
function applyFontSize(px){
  const size = String(px).endsWith('px') ? px : (px+'px');
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '4'); // hack – ersätter vi strax
  // ersätt <font size> med span style
  const sel=window.getSelection(); if(!sel || !sel.rangeCount) return;
  const range=sel.getRangeAt(0);
  const el = range.commonAncestorContainer.parentElement;
  if(!el) return;
  el.querySelectorAll('font[size]').forEach(f=>{
    const span=document.createElement('span');
    span.style.fontSize=size;
    span.innerHTML=f.innerHTML;
    f.parentNode.replaceChild(span,f);
  });
}

function wireToolbar(){
  // textformat
  $id('boldBtn')    ?.addEventListener('click', ()=>execCmd('bold'));
  $id('italicBtn')  ?.addEventListener('click', ()=>execCmd('italic'));
  $id('underlineBtn')?.addEventListener('click', ()=>execCmd('underline'));
  // block
  $id('blockSelect')?.addEventListener('change', e=>execCmd('formatBlock', e.target.value));
  // färger
  $id('foreColor')  ?.addEventListener('input', e=>execCmd('foreColor', e.target.value));
  $id('hiliteColor')?.addEventListener('input', e=>execCmd('hiliteColor', e.target.value));
  // listor
  $id('ulBtn')      ?.addEventListener('click', ()=>execCmd('insertUnorderedList'));
  $id('olBtn')      ?.addEventListener('click', ()=>execCmd('insertOrderedList'));
  // align
  $id('leftBtn')    ?.addEventListener('click', ()=>execCmd('justifyLeft'));
  $id('centerBtn')  ?.addEventListener('click', ()=>execCmd('justifyCenter'));
  $id('rightBtn')   ?.addEventListener('click', ()=>execCmd('justifyRight'));
  // länkar
  $id('linkBtn')    ?.addEventListener('click', ()=>{
    const url=prompt('Länk (https://...)'); if(url) execCmd('createLink', url);
  });
  $id('unlinkBtn')  ?.addEventListener('click', ()=>execCmd('unlink'));
  // font
  populateFonts();
  $id('fontSize')   ?.addEventListener('change', e=>applyFontSize(e.target.value));
  // media
  $id('btnImage')   ?.addEventListener('click', pickAndInsertImage);
  $id('btnImgSmaller')?.addEventListener('click', ()=>resizeSelectedImg(-10));
  $id('btnImgBigger') ?.addEventListener('click', ()=>resizeSelectedImg(10));
  $id('btnAudio')   ?.addEventListener('click', pickAndInsertAudio);
  }
