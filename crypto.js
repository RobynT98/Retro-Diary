// PBKDF2 + AES-GCM
const te = new TextEncoder(), td = new TextDecoder();

const hex = u8 => Array.from(u8).map(b=>b.toString(16).padStart(2,'0')).join('');
const dehex = s => Uint8Array.from((s||'').match(/.{1,2}/g).map(h=>parseInt(h,16)));

async function deriveKey(pass, saltHex){
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: dehex(saltHex), iterations:150000, hash:'SHA-256' },
    base, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
  );
}

async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = te.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data));
  return { iv: hex(iv), ct: hex(ct) };
}

async function decObj(key, wrap){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:dehex(wrap.iv)}, key, dehex(wrap.ct));
  return JSON.parse(td.decode(new Uint8Array(pt)));
}
