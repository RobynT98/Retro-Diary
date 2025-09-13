// crypto.js — oförändrad kryptografi, men wrap per user

const enc = new TextEncoder();
const dec = new TextDecoder();

const hex = u8 => Array.from(u8).map(b=>b.toString(16).padStart(2,'0')).join('');
const dehex = s => new Uint8Array(s.match(/.{1,2}/g).map(h=>parseInt(h,16)));

export async function deriveKey(pass, saltHex){
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt: dehex(saltHex), iterations:150_000, hash:'SHA-256'},
    base,
    {name:'AES-GCM', length:256},
    false,
    ['encrypt','decrypt']
  );
}
export async function encObj(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = enc.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, pt));
  return { iv: hex(iv), ct: hex(ct) };
}
export async function decObj(key, wrap){
  const iv = dehex(wrap.iv), ct = dehex(wrap.ct);
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  return JSON.parse(dec.decode(pt));
}
