// PBKDF2 + AES-GCM (enkelt och modernt)
const te = new TextEncoder(), td = new TextDecoder();

const hex = (buf)=>Array.from(buf).map(b=>b.toString(16).padStart(2,'0')).join('');
const dehex = (s)=>Uint8Array.from(s.match(/.{1,2}/g).map(h=>parseInt(h,16)));

async function deriveKey(password, saltHex){
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: dehex(saltHex), iterations:150000, hash:'SHA-256'},
    base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
}
async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = te.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, pt));
  return { iv: hex(iv), ct: hex(ct) };
}
async function decObj(key, wrap){
  const iv = dehex(wrap.iv), ct = dehex(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(td.decode(new Uint8Array(pt)));
}
