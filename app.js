// helpers
const $ = sel => document.querySelector(sel);
const encoder = new TextEncoder(), decoder = new TextDecoder();

let state = { key:null, entries:[], currentId:null };

function showStatus(msg){ $('#status').textContent = msg; }
function showLock(){
  document.body.classList.add('locked');
  $('#lockscreen').style.display = 'flex';
  $('#app').hidden = true;
}
function hideLock(){
  document.body.classList.remove('locked');
  $('#lockscreen').style.display = 'none';
  $('#app').hidden = false;
}

// crypto
async function deriveKey(pass,salt){
  const keyMat = await crypto.subtle.importKey("raw", encoder.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"}, keyMat, {name:"AES-GCM",length:256}, false, ["encrypt","decrypt"]);
}
async function encObj(key,obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, encoder.encode(JSON.stringify(obj)));
  return {iv:Array.from(iv),ct:Array.from(new Uint8Array(ct))};
}
async function decObj(key,wrap){
  const iv = new Uint8Array(wrap.iv), ct = new Uint8Array(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:"AES-GCM",iv}, key, ct);
  return JSON.parse(decoder.decode(pt));
}

// wrap-meta
async function setWrapMeta(meta){
  localStorage.setItem("wrap-meta", JSON.stringify(meta));
}
async function getWrapMeta(){
  const raw = localStorage.getItem("wrap-meta");
  return raw ? JSON.parse(raw) : null;
}
async function clearAll(){
  localStorage.clear();
  state={key:null,entries:[],currentId:null};
  showLock();
}

// lock/unlock
async function setPass(){
  const pass = $('#pass').value.trim();
  if(!pass) return showStatus("Måste ange lösenord");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  state.key = await deriveKey(pass,salt);
  const test = await encObj(state.key,{t:"ok"});
  await setWrapMeta({salt:Array.from(salt),test});
  hideLock();
  renderList();
}
async function unlock(){
  const pass = $('#pass').value.trim();
  const meta = await getWrapMeta();
  if(!meta) return showStatus("Inget lösen satt");
  const key = await deriveKey(pass,new Uint8Array(meta.salt));
  try{
    await decObj(key,meta.test);
    state.key = key;
    hideLock();
    renderList();
  }catch(e){ showStatus("Fel lösen"); }
}
function lock(){ state.key=null; showLock(); }

// entries
function renderList(){
  const list = $('#entries');
  list.innerHTML = "<h2>Innehåll</h2>"+state.entries.map(e=>`<div>${e.title}</div>`).join("");
}
function newEntry(){ state.currentId = Date.now(); $('#editor').innerHTML=""; }
async function saveEntry(){
  if(!state.key) return;
  const id = state.currentId || Date.now();
  const content = $('#editor').innerHTML;
  const title = content.slice(0,20);
  const wrap = await encObj(state.key,{id,content});
  state.entries.push({id,title,wrap});
  renderList();
}
function deleteEntry(){
  state.entries = state.entries.filter(e=>e.id!==state.currentId);
  $('#editor').innerHTML="";
  renderList();
}

// ui events
window.addEventListener('load',()=>{
  $('#setPassBtn').onclick=setPass;
  $('#unlockBtn').onclick=unlock;
  $('#wipeBtn').onclick=clearAll;
  $('#newBtn').onclick=newEntry;
  $('#saveBtn').onclick=saveEntry;
  $('#deleteBtn').onclick=deleteEntry;
  $('#lockBtn').onclick=lock;
  $('#forceUpdateBtn').onclick=()=>{
    caches.keys().then(keys=>keys.forEach(k=>caches.delete(k)));
    if(navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r=>r&&r.unregister());
    location.reload(true);
  };

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js?v=book13');
  }
  showLock();
});
