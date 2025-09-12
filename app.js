// Retro Diary Lite – app.js
// ==========================

// === Helpers ===
const $ = sel => document.querySelector(sel);

function buf2hex(buf){
  return Array.prototype.map.call(new Uint8Array(buf), x=>x.toString(16).padStart(2,"0")).join('');
}
function hex2buf(hex){
  const bytes = new Uint8Array(hex.length/2);
  for(let i=0;i<bytes.length;i++) bytes[i] = parseInt(hex.substr(i*2,2),16);
  return bytes.buffer;
}

// === IndexedDB ===
let db;
async function idb(){
  if(db) return db;
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open("retro-diary",1);
    req.onupgradeneeded = e=>{
      const d = e.target.result;
      d.createObjectStore("entries",{keyPath:"id"});
      d.createObjectStore("meta",{keyPath:"k"});
    };
    req.onsuccess = e=>{db=e.target.result; resolve(db);}
    req.onerror = e=>reject(e);
  });
}
async function idbPut(store,obj){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store,"readwrite");
    tx.objectStore(store).put(obj);
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}
async function idbGet(store,key){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store);
    const req=tx.objectStore(store).get(key);
    req.onsuccess=()=>res(req.result);
    req.onerror=e=>rej(e);
  });
}
async function idbGetAll(store){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx=d.transaction(store);
    const req=tx.objectStore(store).getAll();
    req.onsuccess=()=>res(req.result);
    req.onerror=e=>rej(e);
  });
}
async function idbClearAll(){
  const d = await idb();
  return new Promise((res,rej)=>{
    const tx=d.transaction(["entries","meta"],"readwrite");
    tx.objectStore("entries").clear();
    tx.objectStore("meta").clear();
    tx.oncomplete=()=>res();
    tx.onerror=e=>rej(e);
  });
}

// === Crypto ===
async function deriveKey(pass,saltHex){
  const enc=new TextEncoder();
  const salt=hex2buf(saltHex);
  const keyMat=await crypto.subtle.importKey("raw",enc.encode(pass),{name:"PBKDF2"},false,["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"},
    keyMat,
    {name:"AES-GCM",length:256},
    false,
    ["encrypt","decrypt"]
  );
}
async function encryptObj(key,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const enc=new TextEncoder();
  const data=enc.encode(JSON.stringify(obj));
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,data);
  return {iv:buf2hex(iv),ct:buf2hex(ct)};
}
async function decryptObj(key,wrap){
  const iv=hex2buf(wrap.iv), ct=hex2buf(wrap.ct);
  const dec=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ct);
  return JSON.parse(new TextDecoder().decode(dec));
}

// === State ===
const state={key:null,currentId:null};
const editor=$('#editor');
const dateLine=$('#dateLine');
const stamp=$('#stamp');
const lockscreen=$('#lockscreen');

// === Lock / Unlock ===
async function unlockWithPass(pass){
  const meta=await idbGet("meta","wrap");
  if(!meta){ $('#status').textContent="Inget lösenord valt än."; return; }
  try{
    const key=await deriveKey(pass,meta.salt);
    // Testa decrypt
    await decryptObj(key,meta.test);
    state.key=key;
    $('#status').textContent="Upplåst ✓";
    lockscreen.hidden=true;
    document.body.classList.remove('locked');
    renderEntries();
  }catch(e){
    $('#status').textContent="Fel lösenord.";
  }
}
async function setInitialPass(pass){
  const salt=buf2hex(crypto.getRandomValues(new Uint8Array(16)));
  const key=await deriveKey(pass,salt);
  // testobjekt
  const test=await encryptObj(key,{ok:true});
  await idbPut("meta",{k:"wrap",salt,test});
  state.key=key;
  lockscreen.hidden=true;
  document.body.classList.remove('locked');
  renderEntries();
}
async function lock(){
  state.key=null;
  state.currentId=null;
  editor.innerHTML='';
  dateLine.textContent='';
  stamp.textContent='';
  lockscreen.hidden=false;
  document.body.classList.add('locked');
  closeMenu();
  setTimeout(()=>$('#pass')?.focus(),30);
}

// === Entries ===
async function saveEntry(){
  if(!state.key){alert("Lås upp först.");return;}
  const html=editor.innerHTML;
  const obj={id:state.currentId||Date.now(),html,date:new Date().toLocaleString()};
  const enc=await encryptObj(state.key,obj);
  await idbPut("entries",{id:obj.id,wrap:enc});
  state.currentId=obj.id;
  renderEntries();
}
async function renderEntries(){
  const list=$('#entries');
  list.innerHTML='';
  const all=await idbGetAll("entries");
  for(const e of all.sort((a,b)=>b.id-a.id)){
    const li=document.createElement('li');
    li.textContent=new Date(e.id).toLocaleString();
    li.onclick=async()=>{
      const dec=await decryptObj(state.key,e.wrap);
      state.currentId=dec.id;
      editor.innerHTML=dec.html;
      dateLine.textContent=dec.date;
    };
    list.appendChild(li);
  }
}
async function delEntry(){
  if(!state.key||!state.currentId) return;
  const d=await idb();
  return new Promise(res=>{
    const tx=d.transaction("entries","readwrite");
    tx.objectStore("entries").delete(state.currentId);
    tx.oncomplete=()=>{state.currentId=null;editor.innerHTML='';renderEntries();res();}
  });
}

// === Export / Import ===
async function exportAll(){
  const all=await idbGetAll("entries");
  const meta=await idbGet("meta","wrap");
  const data={meta,entries:all};
  const blob=new Blob([JSON.stringify(data)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download="retro-diary.json"; a.click();
  URL.revokeObjectURL(url);
}
async function importAll(file){
  const txt=await file.text();
  const data=JSON.parse(txt);
  if(!data.meta||!data.entries){alert("Felaktig fil");return;}
  await idbPut("meta",data.meta);
  for(const e of data.entries) await idbPut("entries",e);
  alert("Importerad.");
}

// === Wipe ===
async function wipeLocal(){
  if(confirm("Rensa all lokal data?")){
    await idbClearAll();
    state.key=null; state.currentId=null;
    editor.innerHTML=''; $('#entries').innerHTML='';
    alert("Allt rensat.");
    lock();
  }
}

// === Menu ===
function closeMenu(){ $('#menu').style.display="none"; }
function toggleMenu(){
  if(document.body.classList.contains('locked')) return;
  const m=$('#menu');
  m.style.display=(m.style.display=="block"?"none":"block");
}

// === Toolbar ===
function exec(cmd,val=null){ document.execCommand(cmd,false,val); }

// === Events ===
window.addEventListener('load',()=>{
  // Lås upp / välj lösen
  $('#unlockBtn').onclick=()=>unlockWithPass($('#pass').value);
  $('#setPassBtn').onclick=()=>setInitialPass($('#pass').value);
  $('#wipeLocalOnLock').onclick=()=>wipeLocal();

  // CRUD
  $('#saveBtn').onclick=saveEntry;
  $('#delBtn').onclick=delEntry;
  $('#newEntryBtn').onclick=()=>{state.currentId=null;editor.innerHTML='';dateLine.textContent='';};
  $('#lockBtn').onclick=lock;

  // Export/Import
  $('#exportBtn').onclick=exportAll;
  $('#importFile').onchange=e=>importAll(e.target.files[0]);
  $('#wipeLocalBtn').onclick=()=>wipeLocal();

  // Menu
  $('#menuBtn').onclick=toggleMenu;
  document.body.addEventListener('click',e=>{
    if(!$('#menu').contains(e.target) && e.target.id!=="menuBtn") closeMenu();
  });

  // Toolbar
  $('#boldBtn').onclick=()=>exec("bold");
  $('#italicBtn').onclick=()=>exec("italic");
  $('#underlineBtn').onclick=()=>exec("underline");
  $('#colorBtn').oninput=e=>exec("foreColor",e.target.value);
});
