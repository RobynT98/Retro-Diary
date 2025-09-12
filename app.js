/* ====== Helpers & DB & Crypto (samma som tidigare – oförändrat där det inte nämns) ====== */
const $ = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const debounce = (fn,ms=400)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
function setStatus(m){const s=byId('status'); if(s) s.textContent=m||''}
function showLock(){document.body.classList.add('locked')}
function hideLock(){document.body.classList.remove('locked')}

const DB_NAME='retro-diary', DB_VER=1; let db;
function dbOpen(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VER);r.onupgradeneeded=e=>{const d=e.target.result;d.createObjectStore('meta',{keyPath:'k'});d.createObjectStore('entries',{keyPath:'id'})};r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)})}
function dbPut(s,o){return new Promise((res,rej)=>{const tx=db.transaction(s,'readwrite');tx.objectStore(s).put(o).onsuccess=()=>res();tx.onerror=()=>rej(tx.error)})}
function dbGet(s,k){return new Promise((res,rej)=>{const tx=db.transaction(s,'readonly');const q=tx.objectStore(s).get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
function dbDel(s,k){return new Promise((res,rej)=>{const tx=db.transaction(s,'readwrite');tx.objectStore(s).delete(k).onsuccess=()=>res();tx.onerror=()=>rej(tx.error)})}
function dbAll(s){return new Promise((res,rej)=>{const tx=db.transaction(s,'readonly');const q=tx.objectStore(s).getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error)})}
function dbClearAll(){return new Promise((res,rej)=>{const tx=db.transaction(['meta','entries'],'readwrite');tx.objectStore('meta').clear();tx.objectStore('entries').clear();tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

/* crypto */
const str2buf=s=>new TextEncoder().encode(s);
const hex2buf=h=>{const a=new Uint8Array(h.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(h.substr(i*2,2),16);return a}
const buf2hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')
async function deriveKey(pass,saltHex){
  const base=await crypto.subtle.importKey('raw',str2buf(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:hex2buf(saltHex),iterations:120000,hash:'SHA-256'},
    base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}
async function encObj(key,obj){const iv=crypto.getRandomValues(new Uint8Array(12));const data=str2buf(JSON.stringify(obj));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);return{iv:buf2hex(iv),ct:buf2hex(new Uint8Array(ct))}}
async function decObj(key,w){const iv=hex2buf(w.iv);const ct=hex2buf(w.ct);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);return JSON.parse(new TextDecoder().decode(pt))}
async function setWrapMeta(w){await dbPut('meta',{k:'wrap',salt:w.salt,test:w.test});localStorage.setItem('wrap',JSON.stringify(w))}
async function getWrapMeta(){const m=await dbGet('meta','wrap'); if(m) return m; const raw=localStorage.getItem('wrap'); return raw?JSON.parse(raw):null}
function normalizeWrap(w){if(!w)return null; if(!w.salt&&w.s)w.salt=w.s; return w}
function validateWrap(w){if(!w)return'no-wrap'; if(!w.salt||!w.test)return'bad-wrap'; return null}

/* ====== Editor & State ====== */
const editor=byId('editor'), dateLine=byId('dateLine');
const state={key:null,currentId:null};
const YT_RE=/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w\-]+)/i;
const IMG_EXT=/\.(png|jpe?g|gif|webp|svg)$/i; const AUD_EXT=/\.(mp3|m4a|aac|ogg|wav|flac)$/i;

function titleFrom(html){const d=document.createElement('div');d.innerHTML=html||'';const t=(d.textContent||'').trim().split(/\n/)[0].slice(0,80);return t||'Anteckning'}
function insertHTML(html){document.execCommand('insertHTML',false,html)}

const toEmbedYouTube=url=>{const m=url.match(YT_RE);return m?`https://www.youtube.com/embed/${m[1]}`:null}
function insertYouTube(url){const src=toEmbedYouTube(url);if(!src) return insertLink(url);insertHTML(`<iframe src="${src}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`)}
const insertLink=url=>insertHTML(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
const insertImageDataURL=(d,alt='')=>insertHTML(`<img class="rd-img size-m" src="${d}" alt="${alt}">`)
const insertAudioDataURL=d=>insertHTML(`<audio controls preload="metadata" src="${d}"></audio>`)
function fileToDataURL(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(f)})}
function insertFromUrl(u){if(toEmbedYouTube(u))return insertYouTube(u); if(IMG_EXT.test(u))return insertImageDataURL(u); if(AUD_EXT.test(u))return insertAudioDataURL(u); return insertLink(u)}

/* klick på bild → cykla storlek */
editor.addEventListener('click',e=>{
  const img=e.target.closest('img.rd-img'); if(!img) return;
  if(img.classList.contains('size-m')){img.classList.replace('size-m','size-f')}
  else if(img.classList.contains('size-f')){img.classList.replace('size-f','size-s')}
  else {img.classList.remove('size-s'); img.classList.add('size-m')}
});

/* paste bild/ljud */
editor.addEventListener('paste', async e=>{
  const items=e.clipboardData?.items||[];
  for(const it of items){
    if(it.type.startsWith('image/')){e.preventDefault();const f=it.getAsFile();const d=await fileToDataURL(f);insertImageDataURL(d);return}
    if(it.type.startsWith('audio/')){e.preventDefault();const f=it.getAsFile();const d=await fileToDataURL(f);insertAudioDataURL(d);return}
  }
});

/* ====== Galleri ====== */
const modal=$('#galleryModal'), grid=$('#galleryGrid');
let selectedImg=null;

function getImages(){ return [...editor.querySelectorAll('img.rd-img')]; }

function openGallery(){
  grid.innerHTML='';
  selectedImg=null;
  for(const img of getImages()){
    const div=document.createElement('div'); div.className='thumb';
    const t=document.createElement('img'); t.src=img.src; div.appendChild(t);
    div.onclick=()=>{ grid.querySelectorAll('.thumb').forEach(x=>x.classList.remove('active')); div.classList.add('active'); selectedImg=img; syncSizeSel(); };
    grid.appendChild(div);
  }
  modal.setAttribute('aria-hidden','false');
}
function closeGallery(){ modal.setAttribute('aria-hidden','true') }
function syncSizeSel(){
  if(!selectedImg) return;
  const sel=$('#galSize');
  if(selectedImg.classList.contains('size-s')) sel.value='size-s';
  else if(selectedImg.classList.contains('size-f')) sel.value='size-f';
  else sel.value='size-m';
}
async function scaleDownDataURL(dataUrl, maxW=1600, quality=0.9){
  const img=new Image(); img.src=dataUrl; await new Promise(r=>img.onload=r);
  if(img.width<=maxW) return dataUrl;
  const scale=maxW/img.width; const w=maxW, h=Math.round(img.height*scale);
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  return c.toDataURL('image/jpeg', quality);
}

/* ====== CRUD ====== */
async function saveEntry(){
  if(!state.key){alert('Lås upp först.');return}
  const id=state.currentId||Date.now();
  const obj={id,html:editor.innerHTML,date:new Date().toLocaleString(),title:titleFrom(editor.innerHTML)};
  const wrap=await encObj(state.key,obj);
  await dbPut('entries',{id,wrap,updated:Date.now()});
  state.currentId=id; await renderList();
}
const autosave=debounce(saveEntry,800);
editor.addEventListener('input',()=>autosave());

async function renderList(){
  const ul=byId('entries'); ul.innerHTML='';
  const all=(await dbAll('entries')).sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
  for(const e of all){
    const li=document.createElement('li');
    li.textContent=new Date(e.updated||e.id).toLocaleString();
    li.onclick=async()=>{const dec=await decObj(state.key,e.wrap);state.currentId=dec.id;editor.innerHTML=dec.html;dateLine.textContent=dec.date;editor.focus()};
    ul.appendChild(li);
  }
}
async function delEntry(){ if(!state.key||!state.currentId) return; if(!confirm('Radera den här sidan?'))return; await dbDel('entries',state.currentId); state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; await renderList(); }
async function exportAll(){ const entries=await dbAll('entries'); const meta=await getWrapMeta(); const blob=new Blob([JSON.stringify({meta,entries})],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download='retro-diary.json';a.click();URL.revokeObjectURL(url); }
async function importAll(f){ const txt=await f.text(); const data=JSON.parse(txt); if(!data.meta||!data.entries){alert('Felaktig fil.');return} await setWrapMeta(data.meta); for(const e of data.entries) await dbPut('entries',e); alert('Importerad.'); await renderList(); }
async function wipeAll(){ if(!confirm('Rensa ALL lokal data?'))return; await dbClearAll(); localStorage.removeItem('wrap'); state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; await renderList(); showLock(); setStatus('Allt rensat.') }

/* ====== Lock ====== */
async function setInitialPass(p){ try{ p=String(p||'').trim(); if(!p){setStatus('Skriv ett lösenord.');return} const salt=buf2hex(crypto.getRandomValues(new Uint8Array(16))); const key=await deriveKey(p,salt); const test=await encObj(key,{ok:true}); await setWrapMeta({salt,test}); state.key=key; setStatus('Lösen satt ✔'); hideLock(); await renderList(); }catch(e){ setStatus('Kunde inte sätta lösen.'); console.error(e)}}
async function unlock(p){ try{ p=String(p||'').trim(); if(!p){setStatus('Skriv ditt lösenord.');return} let meta=await getWrapMeta(); meta=normalizeWrap(meta); const v=validateWrap(meta); if(v){setStatus('Välj “Sätt nytt lösen” först.');return} setStatus('Kontrollerar…'); const key=await deriveKey(p,meta.salt); const probe=await decObj(key,meta.test); if(!probe||probe.ok!==true) throw new Error('Bad pass'); state.key=key; setStatus(''); hideLock(); await renderList(); }catch(e){ setStatus('Fel lösenord.'); console.error(e)}}
function lock(){ state.key=null; state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; showLock(); setStatus(''); setTimeout(()=>byId('passInput')?.focus(),50) }

/* ====== Toolbar wiring & Init ====== */
function execCmd(cmd,val=null){ document.execCommand(cmd,false,val); editor.focus(); }

window.addEventListener('load', async ()=>{
  await dbOpen();

  const passEl=byId('passInput');

  $('#toolbar').addEventListener('click',e=>{
    const btn=e.target.closest('button[data-cmd]'); if(btn) execCmd(btn.dataset.cmd);
  });
  byId('alignLeftBtn').onclick = ()=>execCmd('justifyLeft');
  byId('alignCenterBtn').onclick = ()=>execCmd('justifyCenter');
  byId('alignRightBtn').onclick = ()=>execCmd('justifyRight');
  byId('ulBtn').onclick=()=>execCmd('insertUnorderedList');
  byId('olBtn').onclick=()=>execCmd('insertOrderedList');
  byId('colorBtn').oninput=e=>execCmd('foreColor',e.target.value);
  byId('bgBtn').oninput=e=>execCmd('hiliteColor',e.target.value);
  byId('hrBtn').onclick=()=>insertHTML('<hr>');
  byId('undoBtn').onclick=()=>document.execCommand('undo');
  byId('redoBtn').onclick=()=>document.execCommand('redo');

  byId('blockType').onchange=e=>{
    const tag=e.target.value;
    if(tag==='p') execCmd('formatBlock','P'); else execCmd('formatBlock',tag.toUpperCase());
  };

  byId('linkBtn').onclick=()=>{ const url=prompt('Klistra in länk (bild/ljud/YouTube/länk):'); if(!url) return; insertFromUrl(url.trim()); };

  byId('imgBtn').onclick=()=>byId('pickImage').click();
  byId('audBtn').onclick=()=>byId('pickAudio').click();

  byId('pickImage').addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const d=await fileToDataURL(f);
    const alt=prompt('Alt-text (beskrivning):','')||'';
    insertImageDataURL(d,alt); e.target.value='';
  });
  byId('pickAudio').addEventListener('change', async e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const d=await fileToDataURL(f); insertAudioDataURL(d); e.target.value='';
  });

  // Fonts
  const sel=byId('fontSelect');
  if(window.FONT_DB) sel.innerHTML=window.FONT_DB.map(f=>`<option value="${f.css}">${f.label}</option>`).join('');
  sel.onchange=e=>{ editor.style.fontFamily=e.target.value; localStorage.setItem('rd_font',e.target.value) };
  const savedFont=localStorage.getItem('rd_font'); if(savedFont){ editor.style.fontFamily=savedFont; sel.value=savedFont }

  // CRUD btns
  byId('newBtn').onclick=()=>{state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; editor.focus()};
  byId('saveBtn').onclick=saveEntry;
  byId('deleteBtn').onclick=delEntry;
  byId('lockBtn').onclick=lock;

  // Meny
  byId('menuToggle').onclick=()=>{const m=byId('menu'); m.classList.toggle('open'); m.setAttribute('aria-hidden',m.classList.contains('open')?'false':'true')};
  byId('exportBtn').onclick=exportAll;
  byId('importBtn').onclick=()=>byId('importInput').click();
  byId('importInput').addEventListener('change',e=>{if(e.target.files[0]) importAll(e.target.files[0])});
  byId('wipeBtn').onclick=wipeAll;

  // Lock
  byId('setPassBtn').onclick=()=>setInitialPass(passEl.value);
  byId('unlockBtn').onclick=()=>unlock(passEl.value);
  byId('wipeLocalOnLock').onclick=wipeAll;

  // Force update
  byId('forceUpdateBtn')?.addEventListener('click', async ()=>{
    try{
      if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister()))}
      if('caches' in window){const names=await caches.keys(); await Promise.all(names.map(n=>caches.delete(n)))}
      alert('Appen uppdateras – laddar om...'); location.reload();
    }catch(e){ alert('Kunde inte uppdatera: '+(e?.message||e)) }
  });

  /* ====== Galleri wiring ====== */
  byId('galleryBtn').onclick=openGallery;
  byId('galleryClose').onclick=closeGallery;
  byId('galAdd').onclick=()=>byId('pickImage').click();
  byId('galApply').onclick=()=>{ if(!selectedImg) return alert('Välj en bild.'); selectedImg.classList.remove('size-s','size-m','size-f'); selectedImg.classList.add(byId('galSize').value); };
  byId('galDelete').onclick=()=>{ if(!selectedImg) return; if(!confirm('Radera vald bild?'))return; selectedImg.remove(); selectedImg=null; openGallery(); };
  byId('galScale').onclick=async()=>{
    if(!selectedImg) return alert('Välj en bild.');
    const max=parseInt(prompt('Maxbredd i px (t.ex. 1600):','1600')||'0',10);
    if(!max||max<200) return;
    const newUrl=await scaleDownDataURL(selectedImg.src,max,0.9);
    selectedImg.src=newUrl;
    openGallery();
  };

  showLock();
});
