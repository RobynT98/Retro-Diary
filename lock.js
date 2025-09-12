function $(id){ return document.getElementById(id); }

function setStatus(t){ const el=$('status'); if(el) el.textContent=t||''; }
function showLock(){ $('lockscreen')?.classList.add('show'); $('lockScreen')?.classList.add('show'); }
function hideLock(){ $('lockscreen')?.classList.remove('show'); $('lockScreen')?.classList.remove('show'); }

async function setInitialPass(passRaw){
  try{
    const pass=String(passRaw||'').trim(); if(!pass) return setStatus('Skriv ett lösenord.');
    const saltHex = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const key  = await deriveKey(pass, saltHex);
    const test = await encObj(key, {ok:true});
    await dbPut('meta', {k:'wrap', salt:saltHex, test});
    localStorage.setItem('wrap', JSON.stringify({k:'wrap', salt:saltHex, test}));
    window.AppState.key = key;
    setStatus('Lösen satt ✔'); hideLock();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); }
}

async function getWrapMeta(){
  const m = await dbGet('meta','wrap'); if(m) return m;
  const raw = localStorage.getItem('wrap'); return raw?JSON.parse(raw):null;
}

async function unlock(passRaw){
  try{
    const pass=String(passRaw||'').trim(); if(!pass) return setStatus('Skriv ditt lösenord.');
    const meta=await getWrapMeta(); if(!meta || !meta.salt || !meta.test) return setStatus('Välj “Sätt nytt lösen” först.');
    setStatus('Kontrollerar…');
    const key=await deriveKey(pass, meta.salt);
    const probe=await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Fel lösenord');
    window.AppState.key = key; setStatus(''); hideLock();
  }catch(e){ setStatus('Upplåsning misslyckades.'); }
}

function lock(){
  window.AppState.key=null; window.AppState.currentId=null;
  $('editor').innerHTML=''; $('titleInput').value=''; $('dateLine').textContent='';
  showLock(); setStatus('');
  setTimeout(()=>$('passInput')?.focus(), 50);
}
