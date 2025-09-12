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
/* Gemensamt för minnesläge */
body.memory-mode{
  background: url("stars.jpg") center/cover fixed #05060c;
}

/* Minnesläge + mörkt */
body.memory-mode.theme-dark #editor{
  background: rgba(0,0,0,.72); color:#f5f2e9;
  box-shadow: 0 0 0 1px rgba(255,255,255,.06) inset, 0 10px 26px rgba(0,0,0,.45);
}

/* Minnesläge + ljust */
body.memory-mode.theme-light #editor{
  background: url("paper_faded.jpg") center/cover #fffdf8;
  color:#2b2b2b;
  box-shadow: 0 0 0 1px rgba(255,255,255,.6) inset, 0 10px 26px rgba(0,0,0,.18);
}

/* Mjukare UI i minnesläge */
body.memory-mode button,
body.memory-mode select,
body.memory-mode input{
  border-radius: 10px;
  opacity: .97;
    }
