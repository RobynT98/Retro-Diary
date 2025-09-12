// IndexedDB + enkel fallback
const DB_NAME='retro-diary', DB_VER=1;
let idb=null;

function idbReady(){
  return new Promise((res)=>{
    if(!('indexedDB' in window)) return res(null);
    const req=indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains('meta'))    db.createObjectStore('meta',{keyPath:'k'});
      if(!db.objectStoreNames.contains('entries')) db.createObjectStore('entries',{keyPath:'id'});
    };
    req.onsuccess=()=>{ idb=req.result; res(idb); };
    req.onerror =()=>res(null);
  });
}
async function dbPut(store, obj){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });}
  const k = store==='meta' ? obj.k : obj.id; localStorage.setItem(store+':'+k, JSON.stringify(obj));
}
async function dbGet(store, key){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readonly'); const r=tx.objectStore(store).get(key); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });}
  const raw=localStorage.getItem(store+':'+key); return raw?JSON.parse(raw):null;
}
async function dbAll(store){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readonly'); const req=tx.objectStore(store).getAll(); req.onsuccess=()=>res(req.result||[]); req.onerror=()=>rej(req.error); });}
  const out=[]; for(const k in localStorage){ if(k.startsWith(store+':')){ try{ out.push(JSON.parse(localStorage.getItem(k))); }catch{} } } return out;
}
async function dbDel(store, key){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(store,'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });}
  localStorage.removeItem(store+':'+key);
}
async function dbClearAll(){
  if(idb){ return new Promise((res,rej)=>{ const tx=idb.transaction(['meta','entries'],'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('entries').clear(); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });}
  Object.keys(localStorage).forEach(k=>{ if(/^meta:|^entries:|^wrap$/.test(k)) localStorage.removeItem(k); });
}

// wrap-meta
async function setWrapMeta(obj){ await dbPut('meta',{k:'wrap', salt:obj.salt, test:obj.test}); localStorage.setItem('wrap', JSON.stringify(obj)); }
async function getWrapMeta(){ const m=await dbGet('meta','wrap'); if(m) return m; const raw=localStorage.getItem('wrap'); return raw?JSON.parse(raw):null; }
