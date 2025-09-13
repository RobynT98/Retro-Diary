// storage.js — multi-user aware IndexedDB + LocalStorage fallback

const DB_NAME = 'retro-diary';
const DB_VER  = 2; // bump för att skapa index på userId
let _db = null;

export const User = {
  id: null,   // "sluggad" userId, t.ex. "robyn"
  name: null, // visningsnamn
};

export function setCurrentUser(nameRaw){
  const name = String(nameRaw || '').trim();
  const slug = name.toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'default';
  User.id = slug;
  User.name = name || 'default';
  localStorage.setItem('rd_lastUser', JSON.stringify({id:User.id, name:User.name}));
}

export function restoreLastUser(){
  try{
    const raw = localStorage.getItem('rd_lastUser');
    if(!raw) { setCurrentUser('default'); return; }
    const {id,name} = JSON.parse(raw);
    User.id = id || 'default';
    User.name = name || 'default';
  }catch{
    setCurrentUser('default');
  }
}

/* ---------- IDB init ---------- */
export function idbReady(){
  return new Promise((res)=>{
    if(!('indexedDB' in window)) return res(null);
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('meta')){
        const os = db.createObjectStore('meta',{keyPath:['userId','k']});
        os.createIndex('userId','userId',{unique:false});
      }
      if(!db.objectStoreNames.contains('entries')){
        const os = db.createObjectStore('entries',{keyPath:['userId','id']});
        os.createIndex('userId','userId',{unique:false});
        os.createIndex('updated',['userId','updated'],{unique:false});
      }
      if(!db.objectStoreNames.contains('assets')){
        const os = db.createObjectStore('assets',{keyPath:['userId','id']});
        os.createIndex('userId','userId',{unique:false});
      }
    };
    req.onsuccess = e=>{ _db=e.target.result; res(_db); };
    req.onerror   = ()=>res(null);
  });
}

/* ---------- Helpers (IDB + fallback) ---------- */
async function _put(store, obj, key){
  if(_db){
    return new Promise((res,rej)=>{
      const tx=_db.transaction(store,'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  } else {
    localStorage.setItem(`${store}:${User.id}:${key}`, JSON.stringify(obj));
  }
}

async function _get(store, key){
  if(_db){
    return new Promise((res,rej)=>{
      const tx=_db.transaction(store,'readonly');
      tx.objectStore(store).get([User.id, key]).onsuccess = ev=>{
        res(ev.target.result || null);
      };
      tx.onerror=()=>rej(tx.error);
    });
  } else {
    const raw=localStorage.getItem(`${store}:${User.id}:${key}`);
    return raw?JSON.parse(raw):null;
  }
}

async function _getAll(store){
  if(_db){
    return new Promise((res,rej)=>{
      const out=[];
      const tx=_db.transaction(store,'readonly');
      const idx=tx.objectStore(store).index('userId');
      idx.openCursor(IDBKeyRange.only(User.id)).onsuccess = ev=>{
        const cur=ev.target.result;
        if(cur){ out.push(cur.value); cur.continue(); } else res(out);
      };
      tx.onerror=()=>rej(tx.error);
    });
  } else {
    const out=[];
    for(const k of Object.keys(localStorage)){
      if(k.startsWith(`${store}:${User.id}:`)){
        try{ out.push(JSON.parse(localStorage.getItem(k))); }catch{}
      }
    }
    return out;
  }
}

async function _del(store, key){
  if(_db){
    return new Promise((res,rej)=>{
      const tx=_db.transaction(store,'readwrite');
      tx.objectStore(store).delete([User.id,key]);
      tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
    });
  } else {
    localStorage.removeItem(`${store}:${User.id}:${key}`);
  }
}

/* ---------- Public API (per user) ---------- */
export async function dbPutMeta(k, v){
  return _put('meta', {userId:User.id, k, v}, k);
}
export async function dbGetMeta(k){
  const row = await _get('meta', k);
  return row ? row.v : null;
}
export async function dbPutEntry(obj){ // obj: {id, wrap, updated}
  return _put('entries', {userId:User.id, ...obj}, obj.id);
}
export async function dbGetEntry(id){
  return _get('entries', id);
}
export async function dbAllEntries(){
  const rows = await _getAll('entries');
  return rows.sort((a,b)=>(b.updated||b.id)-(a.updated||a.id));
}
export async function dbDelEntry(id){
  return _del('entries', id);
}
export async function dbClearUser(){
  // rensa allt för aktuell user
  if(_db){
    const tx=_db.transaction(['meta','entries','assets'],'readwrite');
    tx.objectStore('meta').index('userId').openCursor(IDBKeyRange.only(User.id)).onsuccess = e=>{
      const c=e.target.result; if(c){ c.delete(); c.continue(); }
    };
    tx.objectStore('entries').index('userId').openCursor(IDBKeyRange.only(User.id)).onsuccess = e=>{
      const c=e.target.result; if(c){ c.delete(); c.continue(); }
    };
    tx.objectStore('assets').index('userId').openCursor(IDBKeyRange.only(User.id)).onsuccess = e=>{
      const c=e.target.result; if(c){ c.delete(); c.continue(); }
    };
  } else {
    Object.keys(localStorage).forEach(k=>{
      if(k.startsWith(`meta:${User.id}:`)||k.startsWith(`entries:${User.id}:`)||k.startsWith(`assets:${User.id}:`)){
        localStorage.removeItem(k);
      }
    });
  }
}
