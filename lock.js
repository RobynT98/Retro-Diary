function setStatus(t){ const el=document.getElementById('status'); if(el) el.textContent=t||''; }
function showLock(){ document.body.classList.add('locked'); }
function hideLock(){ document.body.classList.remove('locked'); }

async function setInitialPass(passRaw){
  try{
    const pass=String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ett lösenord.'); return; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map(b=>b.toString(16).padStart(2,'0')).join('');
    const key  = await deriveKey(pass, saltHex);
    const test = await encObj(key, {ok:true});
    await setWrapMeta({k:'wrap', salt:saltHex, test});
    window.AppState.key=key;
    setStatus('Lösen satt ✔'); hideLock(); await renderList();
  }catch(e){ setStatus('Kunde inte sätta lösen.'); }
}

async function unlock(passRaw){
  try{
    const pass=String(passRaw||'').trim();
    if(!pass){ setStatus('Skriv ditt lösenord.'); return; }
    const meta=await getWrapMeta();
    if(!meta || !meta.salt || !meta.test){ setStatus('Välj “Sätt nytt lösen” först.'); return; }
    setStatus('Kontrollerar…');
    const key=await deriveKey(pass, meta.salt);
    const probe=await decObj(key, meta.test);
    if(!probe || probe.ok!==true) throw new Error('Test-decrypt misslyckades');
    window.AppState.key=key; setStatus(''); hideLock(); await renderList();
  }catch(e){ setStatus('Upplåsning misslyckades.'); }
}

function lock(){
  const st=window.AppState||{};
  st.key=null; st.currentId=null;
  const ed=document.getElementById('editor'), dl=document.getElementById('dateLine');
  if(ed) ed.innerHTML=''; if(dl) dl.textContent='';
  showLock(); setStatus('');
  setTimeout(()=>document.getElementById('passInput')?.focus(), 50);
}
