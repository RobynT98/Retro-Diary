// Enkel "databas" över Google Fonts (namn, css-param och stack)
window.FONT_DB = [
  {name:"IM Fell English", css:"IM+Fell+English", stack:"'IM Fell English', serif"},
  {name:"Special Elite", css:"Special+Elite", stack:"'Special Elite', cursive"},
  {name:"Dancing Script", css:"Dancing+Script", stack:"'Dancing Script', cursive"},
  {name:"Roboto Slab", css:"Roboto+Slab:wght@400;700", stack:"'Roboto Slab', serif"},
  {name:"Alegreya", css:"Alegreya:ital,wght@0,400;0,700;1,400;1,700", stack:"'Alegreya', serif"},
  {name:"EB Garamond", css:"EB+Garamond:ital@0;1", stack:"'EB Garamond', serif"},
  {name:"Cormorant Garamond", css:"Cormorant+Garamond:wght@400;700", stack:"'Cormorant Garamond', serif"},
  {name:"Merriweather", css:"Merriweather:ital,wght@0,400;0,700;1,400", stack:"'Merriweather', serif"},
  {name:"Lora", css:"Lora:ital,wght@0,400;0,700;1,400", stack:"'Lora', serif"},
  {name:"Playfair Display", css:"Playfair+Display:ital,wght@0,400;0,700;1,400", stack:"'Playfair Display', serif"},
  {name:"Spectral", css:"Spectral:ital,wght@0,400;0,700;1,400", stack:"'Spectral', serif"},
  {name:"Cinzel", css:"Cinzel:wght@400;700", stack:"'Cinzel', serif"},
  {name:"Crimson Pro", css:"Crimson+Pro:wght@400;700", stack:"'Crimson Pro', serif"},
  {name:"Noto Serif", css:"Noto+Serif:ital,wght@0,400;0,700;1,400", stack:"'Noto Serif', serif"},
  {name:"Satisfy", css:"Satisfy", stack:"'Satisfy', cursive"},
  {name:"Cormorant", css:"Cormorant:wght@400;700", stack:"'Cormorant', serif"},
  {name:"Taviraj", css:"Taviraj:ital,wght@0,400;0,700;1,400", stack:"'Taviraj', serif"},
  {name:"Bitter", css:"Bitter:wght@400;700", stack:"'Bitter', serif"},
  {name:"Cardo", css:"Cardo", stack:"'Cardo', serif"},
  {name:"Gloock", css:"Gloock", stack:"'Gloock', serif"},
  {name:"Vollkorn", css:"Vollkorn:ital,wght@0,400;0,700;1,400", stack:"'Vollkorn', serif"},
  {name:"Quattrocento", css:"Quattrocento:wght@400;700", stack:"'Quattrocento', serif"},
  {name:"PT Serif", css:"PT+Serif:ital,wght@0,400;0,700;1,700", stack:"'PT Serif', serif"},
  {name:"Old Standard TT", css:"Old+Standard+TT:ital@0;1", stack:"'Old Standard TT', serif"},
  {name:"Newsreader", css:"Newsreader:opsz,wght@6..72,400;6..72,700", stack:"'Newsreader', serif"},
  {name:"Libre Baskerville", css:"Libre+Baskerville:ital,wght@0,400;0,700;1,400", stack:"'Libre Baskerville', serif"},
  {name:"Nanum Myeongjo", css:"Nanum+Myeongjo:wght@400;700", stack:"'Nanum Myeongjo', serif"},
  {name:"Caveat", css:"Caveat:wght@400;600", stack:"'Caveat', cursive"},
  {name:"Amatic SC", css:"Amatic+SC:wght@400;700", stack:"'Amatic SC', cursive"},
  {name:"Shadows Into Light", css:"Shadows+Into+Light", stack:"'Shadows Into Light', cursive"},
  {name:"Patrick Hand", css:"Patrick+Hand", stack:"'Patrick Hand', cursive"},
  {name:"Great Vibes", css:"Great+Vibes", stack:"'Great Vibes', cursive"},
  {name:"Parisienne", css:"Parisienne", stack:"'Parisienne', cursive"},
  {name:"Italiana", css:"Italiana", stack:"'Italiana', serif"},
  {name:"Cedarville Cursive", css:"Cedarville+Cursive", stack:"'Cedarville Cursive', cursive"},
  {name:"Homemade Apple", css:"Homemade+Apple", stack:"'Homemade Apple', cursive"},
  {name:"Gloria Hallelujah", css:"Gloria+Hallelujah", stack:"'Gloria Hallelujah', cursive"},
  {name:"Marcellus", css:"Marcellus", stack:"'Marcellus', serif"},
  {name:"Abhaya Libre", css:"Abhaya+Libre:wght@400;700", stack:"'Abhaya Libre', serif"},
  {name:"Prata", css:"Prata", stack:"'Prata', serif"},
  {name:"DM Serif Text", css:"DM+Serif+Text:ital@0;1", stack:"'DM Serif Text', serif"}
];

// Ladda CSS för en font vid behov
window.loadFontCSS = (cssName)=>{
  if(!cssName) return;
  if(document.querySelector(`link[data-font="${cssName}"]`)) return;
  const l=document.createElement('link');
  l.rel='stylesheet';
  l.href=`https://fonts.googleapis.com/css2?family=${cssName}&display=swap`;
  l.setAttribute('data-font', cssName);
  document.head.appendChild(l);
};
