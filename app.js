/* ========================== Helpers ========================== */
const $ = sel => document.querySelector(sel);
const deU8 = buf => new TextDecoder().decode(buf);
const enU8 = str => new TextEncoder().encode(str);
function toHex(u8){ return Array.from(u8).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function fromHex(str){ if(!str) return new Uint8Array(); const a=new Uint8Array(str.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(str.substr(i*2,2),16); return a; }
function b64u(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function randBytes(n){ const a=new Uint8Array(n); crypto.getRandomValues(a); return a; }
function uuid(){ return crypto.randomUUID(); }
function closeMenu(){ $('#menuDrop')?.setAttribute('hidden',''); }
function isValidWrap(w){ return !!(w && typeof w.saltHex==='string' && w.payload && typeof w.payload.iv==='string' && typeof w.payload.cipher==='string'); }

/* (valfritt) Hjärtbult som visar att JS körs – kommentera bort sen */
(function(){ const b=document.createElement('div'); b.textContent='JS laddad ✓'; b.style.cssText='position:fixed;left:8px;bottom:8px;background:#1b3a2e;color:#dff;padding:6px 8px;border-radius:8px;z-index:99999;font:12px ui-monospace,monospace'; document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>b.remove(),1200)); document.body.appendChild(b); })();

/* ========================== Supabase ========================== */
const SUPABASE_URL = window.__env?.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.__env?.SUPABASE_ANON_KEY;

let supabase;
try{
  if(!window.supabase) throw new Error('supabase-js saknas');
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Saknar SUPABASE_URL/ANON_KEY');
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Supabase init OK');
}catch(err){
  console.warn('Supabase init problem:', err.message);
  // Minimal stub så appen funkar lokalt om env saknas
  supabase = {
    auth:{
      async signUp(){ return { error:{ message:'Supabase ej initierat' } } },
      async signInWithPassword(){ return { error:{ message:'Supabase ej initierat' } } },
      async signOut(){}, getSession: async ()=>({ data:{ session:null } })
    },
    from(){ return { select:async()=>({data:[],error:null}), upsert:async()=>({}), delete:async()=>({}) }; }
  };
}
let currentUser = null;

/* ========================== IndexedDB ========================== */
const DB = (() => {
  const ENTRIES='entries', META='meta';
  let db;
  function open(){ return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open('retro-diary',5);
    req.onupgradeneeded = e=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains(ENTRIES)) d.createObjectStore(ENTRIES,{keyPath:'id'});
      if(!d.objectStoreNames.contains(META)) d.createObjectStore(META,{keyPath:'k'});
      if(!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox',{keyPath:'id',autoIncrement:true});
    };
    req.onsuccess = e=>{ db=e.target.result; resolve(db); };
    req.onerror = ()=>reject(req.error);
  });}
  async function put(store, value){
    if(!db) await open();
    if(!db){ if(store==='meta') localStorage.setItem(value.k, JSON.stringify(value.v)); else localStorage.setItem(value.id, JSON.stringify(value)); return; }
    return new Promise((res,rej)=>{
      const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(value);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }
  async function get(store, key){
    if(!db) await open();
    if(!db){ const raw=localStorage.getItem(key); return raw?JSON.parse(raw):null; }
    return new Promise((res,rej)=>{
      const tx=db.transaction(store,'readonly'); const req=tx.objectStore(store).get(key);
      req.onsuccess=()=>res(req.result||null); req.onerror=()=>rej(req.error);
    });
  }
  async function all(){
    if(!db) await open();
    if(!db){
      const items=[]; for(const k of Object.keys(localStorage)){ try{ const o=JSON.parse(localStorage.getItem(k)); if(o&&o.id&&o.cipher) items.push(o);}catch{} }
      return items;
    }
    return new Promise((res,rej)=>{
      const tx=db.transaction(ENTRIES,'readonly'); const req=tx.objectStore(ENTRIES).getAll();
      req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error);
    });
  }
  async function del(id){
    if(!db) await open();
    if(!db) return localStorage.removeItem(id);
    return new Promise((res,rej)=>{
      const tx=db.transaction(ENTRIES,'readwrite'); tx.objectStore(ENTRIES).delete(id);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  }
  async function queue(op,payload){ if(!db) await open(); return new Promise((res,rej)=>{
    const tx=db.transaction('outbox','readwrite'); tx.objectStore('outbox').put({op,payload,ts:Date.now()});
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });}
  async function drainOutbox(handler){ if(!db) await open(); return new Promise((res,rej)=>{
    const tx=db.transaction('outbox','readwrite'); const st=tx.objectStore('outbox'); const getAll=st.getAll();
    getAll.onsuccess=async ()=>{ const rows=getAll.result||[]; for(const r of rows){ try{ await handler(r.op,r.payload); st.delete(r.id);}catch(e){} } res(); };
    getAll.onerror=()=>rej(getAll.error);
  });}
  return {open, put, get, all, del, putMeta:(k,v)=>put('meta',{k,v}), getMeta:(k)=>get('meta',k), queue, drainOutbox};
})();

/* ========================== Crypto ========================== */
const CryptoBox = (() => {
  async function pbkdf2(pass, salt, iter=150000){
    const base = await crypto.subtle.importKey('raw', enU8(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function aesEncryptRaw(key, bytes){ const iv=randBytes(12); const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes)); return {iv:toHex(iv), cipher:toHex(cipher)}; }
  async function aesDecryptRaw(key, payload){ const iv=fromHex(payload.iv); const data=fromHex(payload.cipher); const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data); return new Uint8Array(buf); }
  return {pbkdf2, aesEncryptRaw, aesDecryptRaw};
})();

/* ========================== State & UI refs ========================== */
const state = { pass:null, dek:null, currentId:null, entries:[], bio:{}, syncing:false };
const listEl = $('#list'), editor = $('#editor'), dateLine = $('#dateLine'), stamp = $('#stamp'), lockscreen = $('#lockscreen'), statusEl = $('#status');

/* ========================== Render helpers ========================== */
function fmtDate(d){ return d.toLocaleString('sv-SE',{dateStyle:'full',timeStyle:'short'}); }
function firstLineAsTitle(html){ const tmp=document.createElement('div'); tmp.innerHTML=html||''; const text=(tmp.textContent||'').trim(); return (text.split(/\n/)[0]||'Omdirigerad tanke').slice(0,80); }
function renderList(){
  listEl.innerHTML=''; [...state.entries].sort((a,b)=>(b.updated||0)-(a.updated||0)).forEach(e=>{
    const div=document.createElement('div'); div.className='entry-item';
    div.innerHTML=`<div><div>${e.title||'Omdirigerad tanke'}</div><small>${new Date(e.updated||e.created).toLocaleString('sv-SE')}</small></div><button data-id="${e.id}" class="ghost">Öppna</button>`;
    div.querySelector('button').onclick=()=>openEntry(e.id); listEl.appendChild(div);
  });
}
function setCurrentMeta({title,created,updated}){ dateLine.textContent=title||''; stamp.textContent=`${created?'Skapad: '+fmtDate(new Date(created)):''}${updated?' · Senast sparad: '+fmtDate(new Date(updated)):''}`; }

/* ========================== DEK & recovery wraps ========================== */
async function ensureDEKInitialized(pass){
  let wrap = await DB.getMeta('wrap_pass');
  if (!isValidWrap(wrap) && currentUser){
    const {data} = await supabase.from('meta').select('*').eq('user_id', currentUser.id).maybeSingle();
    if(data && data.wrap_pass){ await DB.putMeta('wrap_pass', data.wrap_pass); wrap = data.wrap_pass; }
    if(data && data.wrap_recovery){ await DB.putMeta('wrap_recovery', data.wrap_recovery); }
  }
  if (isValidWrap(wrap)) return;

  const dek = randBytes(32);
  const saltP = randBytes(16); const kP = await CryptoBox.pbkdf2(pass, saltP); const encP = await CryptoBox.aesEncryptRaw(kP, dek);
  await DB.putMeta('wrap_pass', { saltHex: toHex(saltP), payload: encP });

  const rc = makeRecoveryCode(); const saltR = randBytes(16); const kR = await CryptoBox.pbkdf2(rc, saltR); const encR = await CryptoBox.aesEncryptRaw(kR, dek);
  await DB.putMeta('wrap_recovery', { saltHex: toHex(saltR), payload: encR }); await DB.putMeta('recovery_code', rc);

  if(currentUser){ await supabase.from('meta').upsert({ user_id: currentUser.id, wrap_pass:{saltHex:toHex(saltP),payload:encP}, wrap_recovery:{saltHex:toHex(saltR),payload:encR} }); }
  showRecovery(rc);
}
function makeRecoveryCode(){ const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<16;i++) s+=alphabet[Math.floor(Math.random()*alphabet.length)]; return `${s.slice(0,4)}-${s.slice(4,8)}-${s.slice(8,12)}-${s.slice(12,16)}`; }
async function loadDEK_withPass(pass){ const wrap=await DB.getMeta('wrap_pass'); if(!isValidWrap(wrap)) throw new Error('Skadad nyckelmetadata (wrap_pass)'); const k=await CryptoBox.pbkdf2(pass, fromHex(wrap.saltHex)); return CryptoBox.aesDecryptRaw(k, wrap.payload); }
async function loadDEK_withRecovery(rc){ const wrap=await DB.getMeta('wrap_recovery'); if(!isValidWrap(wrap)) throw new Error('Skad nyckelmetadata (wrap_recovery)'); const k=await CryptoBox.pbkdf2(rc, fromHex(wrap.saltHex)); return CryptoBox.aesDecryptRaw(k, wrap.payload); }
async function rewrapPass(newPass, dek){ const salt=randBytes(16); const k=await CryptoBox.pbkdf2(newPass,salt); const enc=await CryptoBox.aesEncryptRaw(k,dek); await DB.putMeta('wrap_pass',{saltHex:toHex(salt),payload:enc}); if(currentUser){ await supabase.from('meta').upsert({ user_id: currentUser.id, wrap_pass:{saltHex:toHex(salt),payload:enc} }); } }
async function regenRecoveryWrap(dek){ const rc=makeRecoveryCode(); const salt=randBytes(16); const k=await CryptoBox.pbkdf2(rc,salt); const enc=await CryptoBox.aesEncryptRaw(k,dek); await DB.putMeta('wrap_recovery',{saltHex:toHex(salt),payload:enc}); await DB.putMeta('recovery_code', rc); if(currentUser){ await supabase.from('meta').upsert({ user_id: currentUser.id, wrap_recovery:{saltHex:toHex(salt),payload:enc} }); } return rc; }

/* ========================== Entry crypto ========================== */
async function encryptWithDEK(plainU8){ const key=await crypto.subtle.importKey('raw', state.dek,'AES-GCM',false,['encrypt']); const iv=randBytes(12); const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plainU8)); return {iv:toHex(iv), cipher:toHex(cipher)}; }
async function decryptWithDEK(payload){ const key=await crypto.subtle.importKey('raw', state.dek,'AES-GCM',false,['decrypt']); const iv=fromHex(payload.iv); const data=fromHex(payload.cipher); const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data); return new Uint8Array(buf); }

/* ========================== CRUD & sync ========================== */
async function openEntry(id){ const rec=state.entries.find(x=>x.id===id) || await DB.get('entries', id); if(!rec) return; try{ const plain=await decryptWithDEK(rec.cipher); state.currentId=id; editor.innerHTML=deU8(plain); setCurrentMeta(rec);}catch{ alert('Kunde inte dekryptera.'); } }
async function saveCurrent(){
  if(!state.dek){ alert('Dagboken är låst.'); return; }
  if(!state.currentId) state.currentId = uuid();
  const html = editor.innerHTML; const title = firstLineAsTitle(html);
  const created = (state.entries.find(e=>e.id===state.currentId)?.created) || Date.now();
  const cipher = await encryptWithDEK(enU8(html));
  const rec = { id: state.currentId, user_id: currentUser?.id||null, title, created, updated: Date.now(), cipher };
  await DB.put('entries', rec);
  const idx = state.entries.findIndex(e=>e.id===rec.id); if(idx>=0) state.entries[idx]=rec; else state.entries.push(rec);
  setCurrentMeta(rec); renderList();

  if(currentUser){
    try{ await supabase.from('entries').upsert({ id:rec.id, user_id:currentUser.id, title:rec.title, created:rec.created, updated:rec.updated, cipher:rec.cipher }); }
    catch{ await DB.queue('upsert', rec); }
  }
}
async function deleteCurrent(){
  if(!state.currentId) return; if(!confirm('Radera den här sidan?')) return;
  const id=state.currentId; await DB.del(id); state.entries=state.entries.filter(e=>e.id!==id);
  state.currentId=null; editor.innerHTML=''; dateLine.textContent=''; stamp.textContent=''; renderList();
  if(currentUser){ try{ await supabase.from('entries').delete().eq('id', id).eq('user_id', currentUser.id); } catch{ await DB.queue('delete', {id}); } }
}
async function handleOutbox(op,payload){
  if(!currentUser) return;
  if(op==='upsert') await supabase.from('entries').upsert({ ...payload, user_id: currentUser.id });
  if(op==='delete') await supabase.from('entries').delete().eq('id', payload.id).eq('user_id', currentUser.id);
}

/* ========================== Lock / unlock ========================== */
async function lock(){ state.pass=null; state.dek=null; lockscreen.hidden=false; document.body.classList.add('locked'); editor.innerHTML=''; closeMenu(); }
async function unlockWithPass(pass){
  statusEl.textContent='Låser upp...';
  try{
    await ensureDEKInitialized(pass);
    state.dek = await loadDEK_withPass(pass);
    state.pass = pass;

    state.entries = await DB.all();
    if(currentUser){
      const {data} = await supabase.from('entries').select('*').eq('user_id', currentUser.id);
      if(Array.isArray(data)){
        for(const s of data){
          const local = state.entries.find(e=>e.id===s.id);
          if(!local || (s.updated||0) > (local.updated||0)) await DB.put('entries', s);
        }
        state.entries = await DB.all();
      }
      await DB.drainOutbox(handleOutbox);
    }

    renderList(); lockscreen.hidden=true; statusEl.textContent=''; document.body.classList.remove('locked'); closeMenu();
    if(!state.entries.length) newEntry();
  }catch(err){
    const msg = String(err?.message||err||'');
    if(msg.includes('Skad')) statusEl.textContent='Nyckelmetadata skadad. Testa återställningskod eller rensa lokala data.';
    else statusEl.textContent=msg || 'Fel lösenord.';
  }
}
function newEntry(){ state.currentId=null; editor.innerHTML=''; const now=new Date(); dateLine.textContent=now.toLocaleDateString('sv-SE',{weekday:'long',year:'numeric',month:'long',day:'numeric'}); stamp.textContent='Ej sparad'; editor.focus(); }

/* ========================== Export / Import ========================== */
async function exportAll(){
  if(!state.dek){ alert('Lås upp först.'); return; }
  const payload = { meta:{ wrap_pass:await DB.getMeta('wrap_pass'), wrap_recovery:await DB.getMeta('wrap_recovery') }, entries: state.entries };
  const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`retro-diary-export-${new Date().toISOString().slice(0,10)}.json`; a.click();
}
async function importAll(file){
  const text=await file.text(); const json=JSON.parse(text);
  if(!json || !json.entries || !json.meta) return alert('Ogiltig fil.');
  await DB.putMeta('wrap_pass', json.meta.wrap_pass); await DB.putMeta('wrap_recovery', json.meta.wrap_recovery);
  for(const e of json.entries){ await DB.put('entries', e); if(currentUser){ try{ await supabase.from('entries').upsert({ ...e, user_id: currentUser.id }); }catch{ await DB.queue('upsert', e); } } }
  state.entries = await DB.all(); renderList(); alert('Import klart.');
}

/* ========================== Recovery ========================== */
function showRecovery(rc){ $('#recoveryCode').value=rc; $('#recoveryDialog').showModal(); }
async function getOrCreateRecovery(){ let rc=await DB.getMeta('recovery_code'); if(!rc){ if(!state.dek) return alert('Lås upp först.'); rc=await regenRecoveryWrap(state.dek); } showRecovery(rc); }
async function openReset(){ $('#rcInput').value=''; $('#newPass1').value=''; $('#newPass2').value=''; $('#resetStatus').textContent=''; $('#resetDialog').showModal(); }
async function applyReset(){
  const rc=$('#rcInput').value.trim(), p1=$('#newPass1').value, p2=$('#newPass2').value; const out=$('#resetStatus');
  if(!rc || !p1 || p1!==p2){ out.textContent='Kontrollera fälten.'; return; }
  try{ const dek=await loadDEK_withRecovery(rc); await rewrapPass(p1, dek); state.dek=dek; state.pass=p1; out.textContent='Dagbokslösen uppdaterat.'; }
  catch{ out.textContent='Fel återställningskod.'; }
}

/* ========================== Biometri ========================== */
async function bioAvailable(){ return !!(window.PublicKeyCredential && navigator.credentials); }
async function bioRegister(){
  if(!(await bioAvailable())) return alert('Biometri/WebAuthn stöds inte här.');
  if(!state.dek) return alert('Lås upp först för att aktivera biometri.');
  const challenge=randBytes(32);
  const cred=await navigator.credentials.create({
    publicKey:{ challenge, rp:{name:'Retro Diary', id:location.hostname}, user:{ id:randBytes(16), name:'user@retrodiary', displayName:'Retro Diary' }, pubKeyCredParams:[{type:'public-key',alg:-7}], authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'preferred'}, timeout:60000 }
  });
  const credId=b64u(cred.rawId); await DB.putMeta('bio_cred', credId); await DB.putMeta('bio_enabled', true);
  const bioKeyRaw=randBytes(32); const key=await crypto.subtle.importKey('raw', bioKeyRaw,'AES-GCM',false,['encrypt','decrypt']);
  const iv=randBytes(12); const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,state.dek));
  localStorage.setItem('bio_capsule', JSON.stringify({iv:toHex(iv), cipher:toHex(cipher)})); localStorage.setItem('bio_key', toHex(bioKeyRaw));
  alert('Biometrisk upplåsning aktiverad på denna enhet.');
}
async function bioDisable(){ await DB.putMeta('bio_enabled',false); await DB.putMeta('bio_cred',null); localStorage.removeItem('bio_capsule'); localStorage.removeItem('bio_key'); alert('Biometri avstängd.'); }
async function bioUnlock(){
  const enabled=await DB.getMeta('bio_enabled'); const credId=await DB.getMeta('bio_cred'); if(!enabled||!credId) return alert('Biometri ej aktiverad.');
  try{
    const allow=[{type:'public-key', id: Uint8Array.from(atob(credId.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0)) }];
    await navigator.credentials.get({ publicKey:{ challenge:randBytes(32), allowCredentials:allow, userVerification:'required', timeout:30000 }});
    const cap=localStorage.getItem('bio_capsule'), khex=localStorage.getItem('bio_key'); if(!cap||!khex) return alert('Ingen lokal bio-kapsel. Lås upp med lösenord och aktivera igen.');
    const key=await crypto.subtle.importKey('raw', fromHex(khex),'AES-GCM',false,['decrypt']); const obj=JSON.parse(cap);
    const dekBuf=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromHex(obj.iv)}, key, fromHex(obj.cipher));
    state.dek=new Uint8Array(dekBuf); state.pass=null; state.entries=await DB.all(); renderList(); lockscreen.hidden=true; statusEl.textContent=''; document.body.classList.remove('locked'); closeMenu(); if(!state.entries.length) newEntry();
  }catch{ statusEl.textContent='Biometrisk upplåsning avbröts/misslyckades.'; }
}

/* ========================== Ikon-palett med flikar ========================== */
const ICON_SETS = {
  Symboler:"⭐️✨💎🔒🔑🕯️🧿🎴🪄🏷️💬🧠🎯🛡️⚙️🔗📍🧩".split(''),
  Status:"✅❌➕➖➡️⬅️⏳⌛️⏰".split(''),
  Element:"🔥💧🌿⚡️".split(''),
  Himmel:"🌙☀️🌞🌝🌟🌈".split(''),
  Objekt:"🧭📌📎📝📖📅🗂️📷🎵🎧💡".split(''),
  Ansikten:"😃😉😀🤪😭🥳😍🥰😘🤧🥵🤯🥶🤮🤢😳☹️😔😊☺️🙂🫢🤫".split(''),
  Kärlek:"❤️💚❤️".split('')
};
function renderIconTab(tab){ const grid=$('#iconGrid'); grid.innerHTML=''; (ICON_SETS[tab]||[]).forEach(ch=>{ const b=document.createElement('button'); b.textContent=ch; b.onclick=()=>{ document.execCommand('insertText', false, ch); $('#iconDialog').close(); editor.focus(); }; grid.appendChild(b); }); }
function activateTab(btn){ document.querySelectorAll('#iconTabs .tab').forEach(t=>t.classList.remove('active')); btn.classList.add('active'); renderIconTab(btn.dataset.tab); }
function openIconPalette(){ const dlg=$('#iconDialog'); if(!dlg.dataset.ready){ document.querySelectorAll('#iconTabs .tab').forEach(b=>b.addEventListener('click', ()=>activateTab(b))); dlg.dataset.ready='1'; } const active=document.querySelector('#iconTabs .tab.active')||document.querySelector('#iconTabs .tab'); if(active) activateTab(active); dlg.showModal(); }

/* ========================== Konto (Supabase Auth) ========================== */
async function signUp(){ const email=$('#email').value.trim(), pwd=$('#acctPass').value; $('#authStatus').textContent='Skapar konto...'; const {error}=await supabase.auth.signUp({ email, password:pwd }); $('#authStatus').textContent = error?error.message:'Konto skapat. Kolla ev. verifikationsmail.'; }
async function signIn(){ const email=$('#email').value.trim(), pwd=$('#acctPass').value; $('#authStatus').textContent='Loggar in...'; const {data,error}=await supabase.auth.signInWithPassword({ email, password:pwd }); if(error){ $('#authStatus').textContent=error.message; return; } currentUser=data.user; $('#authStatus').textContent='Inloggad.'; }
async function signOut(){ await supabase.auth.signOut(); currentUser=null; alert('Utloggad.'); }

/* ========================== Event wiring ========================== */
window.addEventListener('load', async ()=>{
  // Unlock/lock
  $('#unlockBtn').onclick = ()=>unlockWithPass($('#pass').value);
  $('#bioUnlockBtn').onclick = bioUnlock;
  $('#lockBtn').onclick = lock;

  // Konto
  $('#signupBtn')?.addEventListener('click', signUp);
  $('#signinBtn')?.addEventListener('click', signIn);
  $('#logoutBtn')?.addEventListener('click', signOut);

  // CRUD
  $('#newEntryBtn').onclick = newEntry;
  $('#saveBtn').onclick = saveCurrent;
  $('#deleteBtn').onclick = deleteCurrent;

  // Export/import/recovery
  const requireUnlocked = ()=>{ if(!state.dek){ alert('Lås upp först.'); return false; } return true; };
  $('#exportBtn')?.addEventListener('click', ()=>{ if(!requireUnlocked()) return; exportAll(); });
  $('#importFile')?.addEventListener('change', e=>{ if(!requireUnlocked()) return; importAll(e.target.files[0]); });
  $('#showRecoveryBtn')?.addEventListener('click', ()=>{ if(!requireUnlocked()) return; getOrCreateRecovery(); });
  $('#resetPasswordBtn')?.addEventListener('click', ()=>{ if(!requireUnlocked()) return; openReset(); });

  // Recovery med återställningskod
  $('#useRecoveryBtn')?.addEventListener('click', openReset);
  $('#applyReset')?.addEventListener('click', applyReset);
  $('#cancelReset')?.addEventListener('click', ()=>$('#resetDialog').close());

  // Recovery-dialog knappar
  $('#copyRecovery')?.addEventListener('click', ()=>navigator.clipboard.writeText($('#recoveryCode').value));
  $('#regenRecovery')?.addEventListener('click', async ()=>{ 
    if(!requireUnlocked()) return; 
    const rc = await regenRecoveryWrap(state.dek); 
    $('#recoveryCode').value = rc; 
    alert('Ny återställningskod skapad.'); 
  });
  $('#closeRecovery')?.addEventListener('click', ()=>$('#recoveryDialog').close());

  // Meny (blockeras när låst)
  $('#menuBtn')?.addEventListener('click', ()=>{ 
    if (!state.dek) return; 
    const d = $('#menuDrop'); 
    d.hidden = !d.hidden; 
  });
  document.body.addEventListener('click', e=>{ 
    if(e.target.id==='menuBtn' || e.target.closest('.dropdown')) return; 
    closeMenu(); 
  });

  // RTF (rich text formatting)
  document.querySelectorAll('[data-cmd]').forEach(b=>b.addEventListener('click', ()=>document.execCommand(b.dataset.cmd,false,b.dataset.value||null)));
  document.querySelectorAll('[data-block]').forEach(b=>b.addEventListener('click', ()=>document.execCommand('formatBlock',false,b.dataset.block)));
  $('#insertLinkBtn').addEventListener('click', ()=>{ 
    const url=prompt('Länk (https://...)'); 
    if(!url) return; 
    document.execCommand('createLink',false,url); 
    editor.focus(); 
  });
  $('#clearFormatBtn').addEventListener('click', ()=>{ 
    document.execCommand('removeFormat',false,null); 
    const sel=window.getSelection(); 
    if(!sel.rangeCount) return; 
    (sel.getRangeAt(0).commonAncestorContainer.parentElement||editor)
      .querySelectorAll('a')
      .forEach(a=>{ 
        const t=document.createTextNode(a.textContent||''); 
        a.parentNode.replaceChild(t,a); 
      }); 
    editor.focus(); 
  });
  $('#insertIconBtn').addEventListener('click', openIconPalette);
  $('#applyForeColor').addEventListener('click', ()=>document.execCommand('foreColor',false,$('#foreColor').value));
  $('#applyHiliteColor').addEventListener('click', ()=>document.execCommand('hiliteColor',false,$('#hiliteColor').value));
  $('#closeIconDlg').addEventListener('click', ()=>$('#iconDialog').close());

  // Wipe lokal data
  $('#wipeLocalBtn')?.addEventListener('click', async ()=>{
    if(!confirm('Rensa ALL lokal data på den här enheten?')) return;
    if ('indexedDB' in window) {
      await new Promise(r=>{ 
        const req=indexedDB.deleteDatabase('retro-diary'); 
        req.onsuccess=req.onerror=req.onblocked=()=>r(); 
      });
    }
    localStorage.clear(); 
    location.reload();
  });

  // Supabase session (om inloggad sedan tidigare)
  const { data:{session} } = await supabase.auth.getSession();
  currentUser = session?.user || null;
  if($('#authStatus')) {
    $('#authStatus').textContent = currentUser ? 'Inloggad.' : 'Inte inloggad.';
  }

  // Start i låst läge
  lock();
});
