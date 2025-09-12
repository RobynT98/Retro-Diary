// fonts.js — separat fontdatabas för Retro Diary
// Lägg till fler genom att stoppa in ett objekt med label, value, google
// "google" = namnet som används i Google Fonts URL (utan mellanslag, + mellan ord)
// "value" = CSS font-family du vill sätta i editor (fallback ingår)

const FONT_DB = [
  { label: 'Special Elite (skrivmaskin)', value: "'Special Elite', cursive", google: 'Special+Elite' },
  { label: 'IM Fell English (gammaldags)', value: "'IM Fell English', serif", google: 'IM+Fell+English' },
  { label: 'Dancing Script', value: "'Dancing Script', cursive", google: 'Dancing+Script' },
  { label: 'Merriweather', value: "'Merriweather', serif", google: 'Merriweather' },
  { label: 'Roboto Slab', value: "'Roboto Slab', serif", google: 'Roboto+Slab' },
  { label: 'Cinzel', value: "'Cinzel', serif", google: 'Cinzel' },
  { label: 'Cormorant Garamond', value: "'Cormorant Garamond', serif", google: 'Cormorant+Garamond' },
  { label: 'Libre Baskerville', value: "'Libre Baskerville', serif", google: 'Libre+Baskerville' },
  { label: 'Playfair Display', value: "'Playfair Display', serif", google: 'Playfair+Display' },
  { label: 'Lora', value: "'Lora', serif", google: 'Lora' },
  { label: 'Crimson Pro', value: "'Crimson Pro', serif", google: 'Crimson+Pro' },
  { label: 'Spectral', value: "'Spectral', serif", google: 'Spectral' },
  { label: 'PT Serif', value: "'PT Serif', serif", google: 'PT+Serif' },
  { label: 'Noto Serif', value: "'Noto Serif', serif", google: 'Noto+Serif' },
  { label: 'Alegreya', value: "'Alegreya', serif", google: 'Alegreya' },
  { label: 'EB Garamond', value: "'EB Garamond', serif", google: 'EB+Garamond' },
  // lätta sans/fun:
  { label: 'Inter', value: "'Inter', sans-serif", google: 'Inter:opsz,wght@14..32,400;14..32,600' },
  { label: 'Montserrat', value: "'Montserrat', sans-serif", google: 'Montserrat' }
];

// Utility för att få Google Fonts URL med alla familjer i FONT_DB
function buildGoogleFontsHref(list = FONT_DB){
  const fams = list.map(f => `family=${f.google}`).join('&');
  return `https://fonts.googleapis.com/css2?${fams}&display=swap`;
}
