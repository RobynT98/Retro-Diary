// Enkel "databas" över fonter (Google Fonts). Lägg till fler här.
window.FONT_DB = [
  {name: "IM Fell English", css: "IM+Fell+English", stack: "'IM Fell English', serif"},
  {name: "Special Elite",   css: "Special+Elite",   stack: "'Special Elite', cursive"},
  {name: "Dancing Script",  css: "Dancing+Script",  stack: "'Dancing Script', cursive"},
  {name: "Roboto Slab",     css: "Roboto+Slab",     stack: "'Roboto Slab', serif"},
  {name: "Alegreya",        css: "Alegreya:ital,wght@0,400;0,700;1,400;1,700", stack:"'Alegreya', serif"},
  {name: "EB Garamond",     css: "EB+Garamond:ital@0;1", stack:"'EB Garamond', serif"},
  {name: "Cormorant",       css: "Cormorant+Garamond", stack:"'Cormorant Garamond', serif"},
  {name: "Merriweather",    css: "Merriweather:ital,wght@0,400;0,700;1,400", stack:"'Merriweather', serif"},
  {name: "Lora",            css: "Lora:ital,wght@0,400;0,700;1,400", stack:"'Lora', serif"},
  {name: "Playfair Display",css: "Playfair+Display:ital,wght@0,400;0,700;1,400", stack:"'Playfair Display', serif"},
  {name: "Spectral",        css: "Spectral:ital,wght@0,400;0,700;1,400", stack:"'Spectral', serif"},
  {name: "Cinzel",          css: "Cinzel:wght@400;700", stack:"'Cinzel', serif"},
  {name: "Crimson Pro",     css: "Crimson+Pro:wght@400;700", stack:"'Crimson Pro', serif"},
  {name: "Noto Serif",      css: "Noto+Serif:ital,wght@0,400;0,700;1,400", stack:"'Noto Serif', serif"},
  {name: "Satisfy",         css: "Satisfy", stack:"'Satisfy', cursive"}
];

// Ladda in som <link> dynamiskt (kallas från app.js)
window.loadFontCSS = (cssName)=>{
  if(document.querySelector('link[data-font="'+cssName+'"]')) return;
  const l=document.createElement('link');
  l.rel='stylesheet';
  l.href=`https://fonts.googleapis.com/css2?family=${cssName}&display=swap`;
  l.setAttribute('data-font', cssName);
  document.head.appendChild(l);
};
