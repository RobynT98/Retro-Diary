// 16 fonter som passar retro/pergament
window.FONT_DB = [
  {label:"Special Elite",      css:"'Special Elite', cursive",         gf:"Special+Elite"},
  {label:"IM Fell English",    css:"'IM Fell English', serif",         gf:"IM+Fell+English:ital@0;1"},
  {label:"Dancing Script",     css:"'Dancing Script', cursive",        gf:"Dancing+Script"},
  {label:"Roboto Slab",        css:"'Roboto Slab', serif",             gf:"Roboto+Slab:wght@400;700"},
  {label:"Merriweather",       css:"'Merriweather', serif",            gf:"Merriweather:ital,wght@0,400;0,700;1,400"},
  {label:"Cormorant Garamond", css:"'Cormorant Garamond', serif",      gf:"Cormorant+Garamond:wght@400;700"},
  {label:"Old Standard TT",    css:"'Old Standard TT', serif",         gf:"Old+Standard+TT:ital,wght@0,400;0,700;1,400"},
  {label:"Playfair Display",   css:"'Playfair Display', serif",        gf:"Playfair+Display:ital,wght@0,400;0,700;1,400"},
  {label:"Crimson Pro",        css:"'Crimson Pro', serif",             gf:"Crimson+Pro:wght@400;700"},
  {label:"Spectral",           css:"'Spectral', serif",                gf:"Spectral:ital,wght@0,400;0,600;1,400"},
  {label:"Noto Serif",         css:"'Noto Serif', serif",              gf:"Noto+Serif:ital,wght@0,400;0,700;1,400"},
  {label:"EB Garamond",        css:"'EB Garamond', serif",             gf:"EB+Garamond:wght@400;700"},
  {label:"Lora",               css:"'Lora', serif",                    gf:"Lora:ital,wght@0,400;0,700;1,400"},
  {label:"PT Serif",           css:"'PT Serif', serif",                gf:"PT+Serif:ital,wght@0,400;0,700;1,400"},
  {label:"Caveat (hand)",      css:"'Caveat', cursive",                gf:"Caveat:wght@400;700"},
  {label:"Cutive Mono (skriv)",css:"'Cutive Mono', monospace",         gf:"Cutive+Mono"}
];

(function injectGoogleFonts(){
  const href = 'https://fonts.googleapis.com/css2?'
    + [...new Set(window.FONT_DB.map(f=>f.gf))].map(x=>'family='+x).join('&')
    + '&display=swap';
  const link = document.createElement('link');
  link.rel='stylesheet'; link.href=href; link.id='rd-google-fonts';
  document.head.appendChild(link);
})();
