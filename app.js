const $ = (id)=>document.getElementById(id);
const state = {
  key:null, currentId:null, autosaveTimer:null,
  memorial:false, selectedImg:null
};

/* ---------- Helpers ---------- */
function setStatus(t){ const el=$('status'); if(el) el.textContent=t||''; }
function showLock(){ $('lockscreen').style.display='flex'; }
function hideLock(){ $('lockscreen').style.display='none'; }
function toggleMenu(){
  const m=$('menu'); m.classList.toggle('open');
  m.setAttribute('aria-hidden', m.classList.contains('open')?'false':'true');
}
function execCmd(cmd,val){ document.execCommand(cmd,false,val||null); }
function titleFrom(html){
  const div=document.createElement('div'); div.innerHTML=html||'';
  return (div.textContent||'').trim().split(/\n/)[0].slice(0,80)||'Anteckning';
}
function scheduleAutosave(){
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer=setTimeout(()=>saveEntry().catch(()=>{}),1500);
}

/* ---------- IndexedDB + fallback ---------- */
const DB_NAME='retro-diary', DB_VER=2; // v2: assets store
let idb=null;

function idbReady(){
  return new Promise((res)=>{
    if(!('indexedDB' in window)) return res(null);
    const req=indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded=(e)=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains('meta'))    db.createObjectStore('meta',{keyPath:'k'});
      if(!db.objectStoreNames.contains('entries')) db.createObjectStore('entries',{keyPath:'id'});
      if(!db.objectStoreNames.contains('assets'))  db.createObjectStore('assets',{keyPath:'id'});
    };
    req.onsuccess=()=>{ idb=req.result; res(idb); };
    req.onerror =()=>res(null);
  });
}
async function dbPut(store,obj){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
  const k=store==='meta'?obj.k:obj.id; localStorage.setItem(store+':'+k, JSON.stringify(obj));
}
async function dbGet(store,key){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readonly'); const r=tx.objectStore(store).get(key); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); }); }
  const raw=localStorage.getItem(store+':'+key); return raw?JSON.parse(raw):null;
}
async function dbAll(store){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readonly'); const r=tx.objectStore(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
  const out=[]; for(const k in localStorage){ if(k.startsWith(store+':')){ try{ out.push(JSON.parse(localStorage.getItem(k))); }catch{} } } return out;
}
async function dbDel(store,key){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
  localStorage.removeItem(store+':'+key);
}
async function dbClearAll(){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(['meta','entries','assets'],'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('entries').clear(); tx.objectStore('assets').clear(); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
  Object.keys(localStorage).forEach(k=>{ if(/^meta:|^entries:|^assets:|^wrap$/.test(k)) localStorage.removeItem(k); });
}

/* ---------- Crypto ---------- */
const te=new TextEncoder(), td=new TextDecoder();
const hex=b=>Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');
const dehex=s=>Uint8Array.from(s.match(/.{1,2}/g).map(h=>parseInt(h,16)));
async function deriveKey(pass, saltHex){
  const base=await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:dehex(saltHex), iterations:120000, hash:'SHA-256'},
    base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=te.encode(JSON.stringify(obj));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data));
  return {iv:hex(iv), ct:hex(ct)};
}
async function decObj(key, wrap){
  const iv=dehex(wrap.iv), ct=dehex(wrap.ct);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(td.decode(new Uint8Array(pt)));
}

/* ---------- wrap meta ---------- */
async function setWrapMeta(w){ await dbPut('meta',{k:'wrap',salt:w.salt,test:w.test}); localStorage.setItem('wrap',JSON.stringify(w)); }
async function getWrapMeta(){ const m=await dbGet('meta','wrap'); if(m) return m; const raw=localStorage.getItem('wrap'); return raw?JSON.parse(raw):null; }

/* ---------- Assets (galleri) ---------- */
async function addAsset(type, name, dataUrl, mime){
  const id=Date.now()+Math.random(); await dbPut('assets',{id,type,name,dataUrl,mime,created:Date.now()}); return id;
}
async function listAssets(){ return (await dbAll('assets')).sort((a,b)=>b.created-a.created); }

/* ---------- Editor/lista ---------- */
function applyTitle(t){ $('titleInput').value=t||''; }
async function renderList(){
  const ul=$('entries'); if(!ul) return;
  ul.innerHTML='';
  const all=(await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent=new Date(e.updated||e.id).toLocaleString();
    li.onclick=async ()=>{
      const dec=await decObj(state.key, e.wrap);
      state.currentId=dec.id; $('editor').innerHTML=dec.html; applyTitle(dec.title);
      $('dateLine').textContent=dec.date; $('editor').focus();
    };
    ul.appendChild(li);
  }
}
async function saveEntry(){
  if(!state.key){ alert('Lås upp först.'); return; }
  const id=state.currentId || Date.now();
  const obj={
    id,
    title: $('titleInput').value.trim() || titleFrom($('editor').innerHTML),
    html: $('editor').innerHTML,
    date: new Date().toLocaleString()
  };
  const wrap=await encObj(state.key,obj);
  await dbPut('entries',{id,wrap,updated:Date.now()});
  state.currentId=id; await renderList();
}
async function delEntry(){
  if(!state.key || !state.currentId) return;
  if(!confirm('Radera den här sidan?')) return;
  await dbDel('entries', state.currentId);
  state.currentId=null; $('editor').innerHTML=''; applyTitle(''); $('dateLine').textContent='';
  await renderList();
}
function lock(){
  state.key=null; state.currentId=null;
  $('editor').innerHTML=''; applyTitle(''); $('dateLine').textContent='';
  showLock(); setStatus(''); setTimeout(()=>$('passInput')?.focus(),60);
}

/* ---------- Export/Import ---------- */
async function exportAll(){
  const entries=await dbAll('entries'); const meta=await getWrapMeta(); const assets=await dbAll('assets');
  const blob=new Blob([JSON.stringify({meta,entries,assets})],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='retro-diary.json'; a.click(); URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt=await file.text(); const data=JSON.parse(txt);
  if(!data.meta || !data.entries) return alert('Felaktig fil.');
  await setWrapMeta(data.meta);
  for(const e of data.entries) await dbPut('entries',e);
  if(Array.isArray(data.assets)) for(const a of data.assets) await dbPut('assets',a);
  alert('Importerad.'); await renderList();
}
async function wipeAll(){
  if(!confirm('Rensa ALL lokal data?')) return;
  await dbClearAll(); state.key=null; state.currentId=null;
  $('editor').innerHTML=''; applyTitle(''); $('dateLine').textContent='';
  await renderList(); showLock(); setStatus('Allt rensat.');
}

/* ---------- Lösenord ---------- */
async function setInitialPass(passRaw){
  try{
    const pass=String(passRaw||'').trim(); if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt=crypto.getRandomValues(new Uint8Array(16)); const saltHex=Array.from(salt).map(b=>b.toString(16).padStart(2,'0')).join('');
    const key=await deriveKey(pass,saltHex); const test=await encObj(key,{ok:true});
    await setWrapMeta({k:'wrap',salt:saltHex,test}); state.key=key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); console.error(e); }
}
async function unlock(passRaw){
  try{
    const pass=String(passRaw||'').trim(); if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta=await getWrapMeta(); if(!meta || !meta.salt || !meta.test){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    setStatus('Kontrollerar…');
    const key=await deriveKey(pass, meta.salt);
    const probe=await decObj(key, meta.test); if(!probe || probe.ok!==true) throw new Error('Fel lösen');
    state.key=key; setStatus(''); hideLock(); await renderList();
  }catch(e){ setStatus('Upplåsning misslyckades'); console.error(e); }
}

/* ---------- Update ---------- */
async function forceUpdate(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){ const names=await caches.keys(); await Promise.all(names.map(n=>caches.delete(n))); }
    alert('Appen uppdateras – laddar om…'); location.reload(true);
  }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)); }
}

/* ---------- Fonts ---------- */
function populateFonts(){
  const sel=$('fontFamily'); sel.innerHTML='';
  (window.FONT_DB||[]).forEach(f=>{ const o=document.createElement('option'); o.textContent=f.name; o.value=f.css; o.style.fontFamily=f.css; sel.appendChild(o); });
  sel.addEventListener('change',()=>{ execCmd('fontName', sel.value); scheduleAutosave(); });
}

/* ---------- Toolbar bind ---------- */
function wireToolbar(){
  $('boldBtn').onclick=()=>execCmd('bold');
  $('italicBtn').onclick=()=>execCmd('italic');
  $('underlineBtn').onclick=()=>execCmd('underline');

  $('alignLeftBtn').onclick =()=>execCmd('justifyLeft');
  $('alignCenterBtn').onclick=()=>execCmd('justifyCenter');
  $('alignRightBtn').onclick =()=>execCmd('justifyRight');
  $('justifyBtn').onclick    =()=>execCmd('justifyFull');

  $('ulBtn').onclick=()=>execCmd('insertUnorderedList');
  $('olBtn').onclick=()=>execCmd('insertOrderedList');

  $('linkBtn').onclick=()=>{ const url=prompt('Länk (https://…):'); if(url) execCmd('createLink',url); };

  $('imageBtn').onclick=()=>{ const url=prompt('Bild-URL eller data:'); if(url) insertImage(url); };
  $('uploadImgBtn').onclick=()=>$('imgFileInput').click();
  $('imgFileInput').addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const data=await fileToDataURL(f); await addAsset('image', f.name, data, f.type); insertImage(data);
    e.target.value='';
  });

  $('audioBtn').onclick=()=>{ const url=prompt('Ljud-URL eller data:'); if(url) insertAudio(url); };
  $('uploadAudioBtn').onclick=()=>$('audioFileInput').click();
  $('audioFileInput').addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const data=await fileToDataURL(f); await addAsset('audio', f.name, data, f.type); insertAudio(data);
    e.target.value='';
  });

  $('galleryBtn').onclick=openGallery;

  $('emojiBtn').onclick=()=>{ const e=prompt('Emoji/symbol (🕊️ 🕯️ ❤️ …):'); if(e) document.execCommand('insertText',false,e); };

  $('fgBtn').oninput=e=>execCmd('foreColor', e.target.value);
  $('bgBtn').oninput=e=>execCmd('hiliteColor', e.target.value);

  $('fontSize').onchange=()=>execCmd('fontSize', $('fontSize').value);

  $('undoBtn').onclick=()=>execCmd('undo');
  $('redoBtn').onclick=()=>execCmd('redo');
  $('hrBtn').onclick  =()=>execCmd('insertHorizontalRule');

  $('imgSmallerBtn').onclick=()=>resizeSelectedImg(-10);
  $('imgLargerBtn').onclick =()=>resizeSelectedImg(+10);

  $('themeBtn').onclick=()=>{
    const b=document.body; b.dataset.theme = b.dataset.theme==='dark' ? 'parchment' : 'dark';
  };

  $('memorialBtn').onclick=()=>{
    state.memorial=!state.memorial;
    if(state.memorial){
      $('editor').style.filter='grayscale(0.35)';
      document.body.dataset.theme='dark';
    }else{
      $('editor').style.filter='';
    }
  };
}
/* ---------- Image/audio helpers ---------- */

// Skala bild → DataURL (JPEG) för mindre lagring
function fileToScaledDataURL(file, maxW=1600, maxH=1600, quality=0.88){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width:w, height:h } = img;
        const scale = Math.min(1, maxW/w, maxH/h);
        const cw = Math.round(w*scale), ch = Math.round(h*scale);

        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Ogiltig bild'));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// Infoga figure+img+figcaption och markera bilden
function insertImageFigure(src, captionText=''){
  const fig = document.createElement('figure');
  const im  = document.createElement('img');
  im.src = src; im.alt = captionText || '';
  im.classList.add('resizable', 'selected');
  const cap = document.createElement('figcaption');
  cap.textContent = captionText;

  fig.appendChild(im); fig.appendChild(cap);

  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(fig);
    range.setStartAfter(fig); range.setEndAfter(fig);
    sel.removeAllRanges(); sel.addRange(range);
  } else {
    $('editor').appendChild(fig);
  }

  if(state.selectedImg) state.selectedImg.classList.remove('selected');
  state.selectedImg = im;
  scheduleAutosave?.();
}

// Öppna filväljare → skala → infoga
async function pickAndInsertImage(){
  const input = document.getElementById('imgFile');
  if(!input) return alert('imgFile saknas i HTML');

  input.click();
  input.onchange = async (e)=>{
    const file = e.target.files && e.target.files[0];
    input.value = ''; // tillåt samma fil igen
    if(!file) return;
    try{
      const dataUrl = await fileToScaledDataURL(file, 1600, 1600, 0.88);
      insertImageFigure(dataUrl, '');
      setTimeout(()=>scheduleAutosave?.(), 300);
    }catch(err){
      console.error(err);
      alert('Kunde inte läsa bilden: ' + (err?.message || err));
    }
  };
}

// Ljud: använd ObjectURL (snålar minne)
function insertAudioObjectURL(file){
  const url = URL.createObjectURL(file);
  const html = `<audio controls src="${url}"></audio>`;
  document.execCommand('insertHTML', false, html);
  scheduleAutosave?.();
}
function pickAndInsertAudio(){
  const input = document.getElementById('audioFile');
  if(!input) return alert('audioFile saknas i HTML');

  input.click();
  input.onchange = (e)=>{
    const file = e.target.files && e.target.files[0];
    input.value = '';
    if(!file) return;
    insertAudioObjectURL(file);
    setTimeout(()=>scheduleAutosave?.(), 300);
  };
}

// Markering/resize på klick i editorn
$('editor')?.addEventListener('click', (e)=>{
  if(state.selectedImg) state.selectedImg.classList.remove('selected');
  state.selectedImg = (e.target && e.target.tagName==='IMG') ? e.target : null;
  if(state.selectedImg){ state.selectedImg.classList.add('selected'); }
});
function resizeSelectedImg(delta){
  const img = state.selectedImg; 
  if(!img) return alert('Markera en bild först.');
  const cur = parseInt(img.style.width || '100', 10);
  const next = Math.max(10, Math.min(200, (isNaN(cur)?100:cur) + delta));
  img.style.width = next + '%';
  scheduleAutosave?.();
}

/* ---------- Galleri modal ---------- */
function openGallery(){
  const modal = $('galleryModal');
  if(!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  renderGallery();
}
$('closeGallery')?.addEventListener('click', ()=>{
  const m=$('galleryModal'); if(!m) return;
  m.classList.remove('show');
  m.setAttribute('aria-hidden','true');
});

async function renderGallery(){
  const grid = $('galleryGrid'); if(!grid) return;
  grid.innerHTML = 'Laddar…';
  const items = await listAssets(); // förutsätter att du har assets-lagring
  grid.innerHTML = '';
  if(!items.length){
    grid.innerHTML = '<p class="meta">Inga uppladdade filer än.</p>';
    return;
  }
  for(const a of items){
    const d = document.createElement('div'); 
    d.className = 'thumb';

    if(a.type==='image'){
      const img = document.createElement('img'); 
      img.src = a.dataUrl; 
      d.appendChild(img);
    }else{
      const place = document.createElement('div'); 
      place.style.height='100px';
      place.style.display='grid';
      place.style.placeItems='center';
      place.textContent='🎵';
      d.appendChild(place);
    }

    const meta = document.createElement('div'); 
    meta.className='meta'; 
    meta.textContent = a.name || a.type;

    const row = document.createElement('div'); 
    row.style.display='flex'; 
    row.style.gap='6px';

    const ins = document.createElement('button'); 
    ins.textContent='Infoga'; 
    ins.onclick = ()=>{
      if(a.type==='image') insertImageFigure(a.dataUrl);
      else document.execCommand('insertHTML', false, `<audio controls src="${a.dataUrl}"></audio>`);
      scheduleAutosave?.();
    };

    const del = document.createElement('button'); 
    del.textContent='Radera'; 
    del.onclick = async ()=>{ await dbDel('assets', a.id); renderGallery(); };

    row.appendChild(ins); 
    row.appendChild(del);

    d.appendChild(meta); 
    d.appendChild(row);
    grid.appendChild(d);
  }
}

/* ---------- Bind och init ---------- */
document.addEventListener('DOMContentLoaded', async ()=>{
  await idbReady?.();                 // öppna DB (eller fallback)
  setTimeout(populateFonts?.bind(window), 100); // vänta in fonts_db

  // Editor input → autosave
  $('editor')?.addEventListener('input', scheduleAutosave);
  $('titleInput')?.addEventListener('input', scheduleAutosave);

  // Toolbar
  wireToolbar?.();

  // CRUD
  $('newBtn')   ?.addEventListener('click', ()=>{
    state.currentId=null; 
    $('editor').innerHTML=''; 
    applyTitle?.(''); 
    $('dateLine').textContent='';
    $('editor').focus();
  });
  $('saveBtn')  ?.addEventListener('click', saveEntry);
  $('deleteBtn')?.addEventListener('click', delEntry);

  // Lås / upplås
  $('lockBtn')      ?.addEventListener('click', lock);
  $('unlockBtn')    ?.addEventListener('click', ()=>unlock($('passInput')?.value||''));
  $('setPassBtn')   ?.addEventListener('click', ()=>setInitialPass($('passInput')?.value||''));
  $('wipeLocalOnLock')?.addEventListener('click', wipeAll);

  // Meny
  $('menuToggle')?.addEventListener('click', toggleMenu);
  $('exportBtn') ?.addEventListener('click', exportAll);
  $('importBtn') ?.addEventListener('click', ()=>$('importInput')?.click());
  $('importInput')?.addEventListener('change', e=>{
    const f=e.target.files?.[0]; if(f) importAll(f);
  });
  $('wipeBtn')   ?.addEventListener('click', wipeAll);

  // Bild/ljud
  $('btnImage')      ?.addEventListener('click', pickAndInsertImage);
  $('btnAudio')      ?.addEventListener('click', pickAndInsertAudio);
  $('btnImgSmaller') ?.addEventListener('click', ()=>resizeSelectedImg(-10));
  $('btnImgBigger')  ?.addEventListener('click', ()=>resizeSelectedImg(10));

  // Galleri
  $('openGalleryBtn')?.addEventListener('click', openGallery);

  // Force update (fungerar även låst)
  $('forceUpdateBtn')?.addEventListener('click', async ()=>{
    try{
      if('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
      if('caches' in window){
        const names = await caches.keys();
        await Promise.all(names.map(n=>caches.delete(n)));
      }
      alert('Appen uppdateras – laddar om…');
      location.reload(true);
    }catch(e){ alert('Kunde inte uppdatera: ' + (e?.message||e)); }
  });

  // Start i låst läge
  showLock?.();
  setTimeout(()=>$('passInput')?.focus(), 50);
  console.log('✅ app.js – helpers & wiring klara');
});
```0
