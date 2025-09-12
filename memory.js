// memory.js – överläggande "minnesläge" (lugnt tema + sparat val)
function enableMemoryMode() {
  document.body.classList.add("memory-mode");
  localStorage.setItem("rd_memory", "on");
  ensureMemoryStyles();
}
function disableMemoryMode() {
  document.body.classList.remove("memory-mode");
  localStorage.setItem("rd_memory", "off");
}
function toggleMemoryMode() {
  if (document.body.classList.contains("memory-mode")) disableMemoryMode();
  else enableMemoryMode();
}

// Ladda CSS bara en gång
function ensureMemoryStyles(){
  if (document.querySelector('link[data-memory-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'theme_memory.css';
  l.setAttribute('data-memory-css','1');
  document.head.appendChild(l);
}

document.addEventListener("DOMContentLoaded", ()=>{
  // återställ läge
  if ((localStorage.getItem("rd_memory")||"off")==="on") {
    enableMemoryMode();
  }
  // koppla knappen
  document.getElementById("memoryBtn")?.addEventListener("click", toggleMemoryMode);
});
