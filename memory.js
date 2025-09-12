function setTheme(name){
  const link = document.getElementById('themeLink');
  if(!link) return;
  link.href = name==='dark' ? 'theme_dark.css' : 'theme_light.css';
  document.body.classList.toggle('theme-dark', name==='dark');
  document.body.classList.toggle('theme-light', name!=='dark');
  localStorage.setItem('theme', name);
}

function toggleMemory(){
  document.body.classList.toggle('memory-mode');
  localStorage.setItem('memoryMode', document.body.classList.contains('memory-mode')?'1':'0');
}

// snabbknapp i toolbar (om du vill trigga därifrån)
document.getElementById('quickThemeBtn')?.addEventListener('click', ()=>{
  const sel=document.getElementById('themeSelect');
  if(!sel) return;
  sel.value = sel.value==='dark' ? 'light' : 'dark';
  sel.dispatchEvent(new Event('change'));
});
