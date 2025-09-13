// app.js — wire-up mellan UI och moduler
import { idbReady, dbAllEntries, dbPutEntry, dbGetEntry, dbDelEntry } from './storage.js';
import { App, initLock, setInitialPass, unlock, showLock, hideLock, wipeCurrentUser } from './lock.js';
import { encObj, decObj } from './crypto.js';

const $ = id => document.getElementById(id);

// autosave
let _deb=null;
function scheduleAutosave(){ clearTimeout(_deb); _deb = setTimeout(saveEntry, 600); }

// titel
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t=(tmp.textContent||'').trim().split(/\n/)[0];
  return (t||'Anteckning').slice(0,80);
}

// CRUD
async function renderList(filter=''){
  const ul=$('entries'); if(!ul) return;
  ul.innerHTML='';
  const rows=await dbAllEntries();
  for(const r of rows){
    let title=''; try{
      if(App.key){ const dec=await decObj(App.key, r.wrap); title=dec.title||''; }
    }catch{}
    const li=document.createElement('li');
    li.textContent = (title?title+' — ':'') + new Date(r.updated||r.id).toLocaleString('sv-SE');
    if(filter && !li.textContent.toLowerCase().includes(filter.toLowerCase())) continue;
    li.onclick = ()=>openEntry(r.id);
    ul.appendChild(li);
  }
}

async function saveEntry(){
  if(!App.key) { alert('Lås upp först.'); return; }
  const id = window.AppState?.currentId || Date.now();
  const html = $('editor').innerHTML;
  const obj = { id, html, date:new Date().toLocaleString('sv-SE'), title: ($('titleInput').value || titleFrom(html)) };
  const wrap = await encObj(App.key, obj);
  await dbPutEntry({ id, wrap, updated: Date.now() });
  window.AppState = { ...(window.AppState||{}), currentId:id };
  renderList();
}
async function openEntry(id){
  if(!App.key) return;
  const row = await dbGetEntry(id); if(!row) return;
  try{
    const dec = await decObj(App.key, row.wrap);
    window.AppState = { ...(window.AppState||{}), currentId: dec.id };
    $('editor').innerHTML = dec.html;
    $('titleInput').value = dec.title||'';
    $('dateLine').textContent = dec.date||'';
    $('editor').focus();
  }catch{ alert('Kunde inte dekryptera posten.'); }
}
async function delEntry(){
  if(!App.key || !window.AppState?.currentId) return;
  if(!confirm('Radera sidan?')) return;
  await dbDelEntry(window.AppState.currentId);
  window.AppState.currentId=null; $('editor').innerHTML=''; $('titleInput').value=''; $('dateLine').textContent='';
  renderList();
}

// init UI
document.addEventListener('DOMContentLoaded', async ()=>{
  await idbReady();
  await initLock();

  // Låsskärm
  $('setPassBtn')?.addEventListener('click', ()=>setInitialPass($('userInput').value, $('passInput').value));
  $('unlockBtn') ?.addEventListener('click', ()=>unlock($('userInput').value, $('passInput').value));
  $('wipeLocalOnLock')?.addEventListener('click', wipeCurrentUser);

  // Meny: byt användare
  $('switchUserBtn')?.addEventListener('click', ()=>{
    // visa låsskärmen och låt användaren skriva nytt namn + låsa upp
    showLock();
    $('passInput')?.focus();
  });

  // editor
  $('editor')?.addEventListener('input', scheduleAutosave);
  $('titleInput')?.addEventListener('input', scheduleAutosave);
  $('saveBtn')?.addEventListener('click', saveEntry);
  $('newBtn') ?.addEventListener('click', ()=>{ window.AppState={currentId:null}; $('editor').innerHTML=''; $('titleInput').value=''; $('dateLine').textContent=''; $('editor').focus(); });
  $('deleteBtn')?.addEventListener('click', delEntry);
  $('lockBtn')?.addEventListener('click', ()=>{ App.key=null; showLock(); });

  // sök
  $('searchBtn')?.addEventListener('click', ()=>renderList(($('searchInput').value||'').trim()));
  $('clearSearchBtn')?.addEventListener('click', ()=>{ $('searchInput').value=''; renderList(''); });

  // första gång list
  renderList();
});
