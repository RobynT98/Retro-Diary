// app.js — central ESM-wire-up (ren & stabil)
console.log('✅ app.js loaded');

// Side-effects som binder toolbar/minnesläge
import './editor.js';
import './memory.js';

import { idbReady, dbAllEntries, dbPutEntry, dbGetEntry, dbDelEntry } from './storage.js';
import { App, initLock, showLock, hideLock, wipeCurrentUser } from './lock.js';
import { encObj, decObj } from './crypto.js';

const $ = id => document.getElementById(id);

// =============== Tema ===============
function setTheme(val){
  document.body.classList.remove('theme-light','theme-dark');
  document.body.classList.add(val === 'dark' ? 'theme-dark' : 'theme-light');
  const link = $('themeLink');
  if (link) link.href = (val === 'dark') ? 'theme_dark.css' : 'theme_light.css';
  localStorage.setItem('theme', val);
}

// =============== Autosave ===============
let _deb=null;
function scheduleAutosave(){ clearTimeout(_deb); _deb = setTimeout(saveEntry, 600); }

// =============== Hjälp: titel från innehåll ===============
function titleFrom(html){
  const tmp=document.createElement('div'); tmp.innerHTML=html||'';
  const t=(tmp.textContent||'').trim().split(/\n/)[0];
  return (t||'Anteckning').slice(0,80);
}

// =============== CRUD ===============
async function renderList(filter=''){
  const ul=$('entries'); if(!ul) return;
  ul.innerHTML='';
  const rows=await dbAllEntries();

  for(const r of rows){
    let title='';
    try{ if(App.key){ const dec=await decObj(App.key, r.wrap); title=dec.title||''; } }catch{}
    const text = (title?title+' — ':'') + new Date(r.updated||r.id).toLocaleString('sv-SE');
    if(filter && !text.toLowerCase().includes(filter.toLowerCase())) continue;

    const li=document.createElement('li');
    li.textContent = text;
    li.onclick = ()=>openEntry(r.id);
    ul.appendChild(li);
  }
}

async function saveEntry(){
  if(!App.key) { alert('Lås upp först.'); return; }
  const id   = window.AppState?.currentId || Date.now();
  const html = $('editor').innerHTML;
  const obj  = { id, html, date:new Date().toLocaleString('sv-SE'), title: ($('titleInput').value || titleFrom(html)) };
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
    $('editor').innerHTML     = dec.html;
    $('titleInput').value     = dec.title||'';
    $('dateLine').textContent = dec.date||'';
    $('editor').focus();
  }catch{ alert('Kunde inte dekryptera posten.'); }
}

async function delEntry(){
  if(!App.key || !window.AppState?.currentId) return;
  if(!confirm('Radera sidan?')) return;
  await dbDelEntry(window.AppState.currentId);
  window.AppState.currentId=null;
  $('editor').innerHTML=''; $('titleInput').value=''; $('dateLine').textContent='';
  renderList();
}

// =============== Init UI ===============
document.addEventListener('DOMContentLoaded', async ()=>{
  await idbReady();
  await initLock();               // 🔐 lock.js binder låsskärms-knapparna själv

  // ----- Meny (öppna/stäng + lås scroll)
  const menu   = $('menu');
  const toggle = $('menuToggle');

  toggle?.addEventListener('click', (e)=>{
    if (document.body.classList.contains('locked')) return;
    e.stopPropagation();
    const opened = menu.classList.toggle('open');
    document.body.classList.toggle('menu-open', opened);
    if (opened) menu.querySelector('button,select,input')?.focus?.();
  });

  document.addEventListener('click', (e)=>{
    if (!menu?.classList.contains('open')) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    menu.classList.remove('open');
    document.body.classList.remove('menu-open');
  });

  // ----- Editor
  $('editor')?.addEventListener('input', scheduleAutosave);
  $('titleInput')?.addEventListener('input', scheduleAutosave);
  $('saveBtn')?.addEventListener('click', saveEntry);
  $('newBtn') ?.addEventListener('click', ()=>{
    window.AppState={currentId:null};
    $('editor').innerHTML=''; $('titleInput').value=''; $('dateLine').textContent='';
    $('editor').focus();
  });
  $('deleteBtn')?.addEventListener('click', delEntry);
  $('lockBtn')?.addEventListener('click', ()=>{ App.key=null; showLock(); });

  // ----- Sök
  $('searchBtn')?.addEventListener('click', ()=>renderList(($('searchInput').value||'').trim()));
  $('clearSearchBtn')?.addEventListener('click', ()=>{ $('searchInput').value=''; renderList(''); });

  // ----- Tema
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);
  $('themeSelect')?.addEventListener('change', e=>setTheme(e.target.value));
  $('quickThemeBtn')?.addEventListener('click', ()=>{
    const next = (localStorage.getItem('theme')==='dark') ? 'light' : 'dark';
    setTheme(next);
    if ($('themeSelect')) $('themeSelect').value = next;
  });

  // ----- Språk
  const savedLang = localStorage.getItem('lang') || 'sv';
  window.applyLang?.(savedLang);
  $('langSelectLock')?.value  = savedLang;
  $('langSelectMenu')?.value  = savedLang;
  $('langSelectLock')?.addEventListener('change', e => window.applyLang?.(e.target.value));
  $('langSelectMenu')?.addEventListener('change', e => window.applyLang?.(e.target.value));

  // ----- Wipe + Force update
  $('wipeBtn')?.addEventListener('click', wipeCurrentUser);
  $('forceUpdateBtn')?.addEventListener('click', async ()=>{
    try{
      if('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
      if('caches' in window){
        const names = await caches.keys();
        await Promise.all(names.map(n=>caches.delete(n)));
      }
      alert('Appen uppdateras – laddar om…');
      location.reload(true);
    }catch{ alert('Kunde inte uppdatera.'); }
  });

  // Ingen renderList här; den körs när du väl låst upp & sparar etc.
});

// Exponera vid behov
window.renderList = renderList;
window.saveEntry  = saveEntry;
window.openEntry  = openEntry;
window.delEntry   = delEntry;
