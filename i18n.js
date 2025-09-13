/* ========== Ordböcker ========== */
window.I18N = {
  sv: {
    app_title: "Retro Diary",
    contents: "Innehåll",
    editor: "Editor",
    menu: "Meny",
    about: "Om appen",
    help: "Hjälp",
    privacy: "Sekretess",
    copyright: "© Conri Turesson",
    search: "Sök",
    clear: "Rensa",
    new_page: "Ny sida",
    save: "Spara",
    delete: "Radera",
    lock: "Lås",
    export: "Exportera (.json)",
    import: "Importera (.json)",
    switch_user: "Byt användare",
    memory_mode: "Minnesläge",
    theme: "Tema",
    theme_light: "Ljust",
    theme_dark: "Mörkt",
    language: "Språk",
    lock_title: "🔒 Retro Diary",
    set_pass: "Sätt nytt lösen",
    unlock: "Lås upp",
    wipe_all: "Rensa ALL lokal data",
    search_ph: "Sök titel/text…",
    title_ph: "Titel…",
    username_ph: "Användarnamn",
    password_ph: "Dagbokens lösenord",
    t_link_insert: "Infoga länk",
    t_link_remove: "Ta bort länk",
    t_img_insert: "Infoga bild",
    t_img_smaller: "Mindre bild",
    t_img_bigger: "Större bild",
    t_audio_insert: "Infoga ljud",
    t_emoji: "Emoji",
    t_stamp: "Infoga datum/tid",
    t_copy: "Kopiera",
    t_paste: "Klistra in",
    t_tts: "Läs upp",
    t_favorite: "Favorit",
    t_quick_theme: "Tema snabbväxling"
  },
  en: {
    app_title: "Retro Diary",
    contents: "Contents",
    editor: "Editor",
    menu: "Menu",
    about: "About",
    help: "Help",
    privacy: "Privacy",
    copyright: "© Conri Turesson",
    search: "Search",
    clear: "Clear",
    new_page: "New page",
    save: "Save",
    delete: "Delete",
    lock: "Lock",
    export: "Export (.json)",
    import: "Import (.json)",
    switch_user: "Switch user",
    memory_mode: "Memory mode",
    theme: "Theme",
    theme_light: "Light",
    theme_dark: "Dark",
    language: "Language",
    lock_title: "🔒 Retro Diary",
    set_pass: "Set new password",
    unlock: "Unlock",
    wipe_all: "Wipe ALL local data",
    search_ph: "Search title/text…",
    title_ph: "Title…",
    username_ph: "Username",
    password_ph: "Diary password",
    t_link_insert: "Insert link",
    t_link_remove: "Remove link",
    t_img_insert: "Insert image",
    t_img_smaller: "Smaller image",
    t_img_bigger: "Larger image",
    t_audio_insert: "Insert audio",
    t_emoji: "Emoji",
    t_stamp: "Insert date/time",
    t_copy: "Copy",
    t_paste: "Paste",
    t_tts: "Read aloud",
    t_favorite: "Favorite",
    t_quick_theme: "Quick theme toggle"
  }
};

/* ========== Hjälpare ========== */
function t(key){
  const lang = localStorage.getItem('lang') || document.documentElement.lang || 'sv';
  const dict = window.I18N[lang] || window.I18N.sv;
  return (dict && dict[key]) || key;
}

/* ========== Applicera språk ========== */
window.applyLang = function(lang){
  const dict = window.I18N[lang] || window.I18N.sv;
  document.documentElement.setAttribute('lang', lang);
  localStorage.setItem('lang', lang);

  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.dataset.i18n;
    if (dict[key] != null) el.textContent = dict[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
    const key = el.dataset.i18nPlaceholder;
    if (dict[key] != null) el.placeholder = dict[key];
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el=>{
    const key = el.dataset.i18nTitle;
    if (dict[key] != null) el.title = dict[key];
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(el=>{
    const key = el.dataset.i18nAriaLabel;
    if (dict[key] != null) el.setAttribute('aria-label', dict[key]);
  });

  if (dict.app_title) document.title = dict.app_title;

  const lockSel = document.getElementById('langSelectLock');
  const menuSel = document.getElementById('langSelectMenu');
  if (lockSel) lockSel.value = lang;
  if (menuSel) menuSel.value = lang;
};

/* ========== Init ========== */
document.addEventListener('DOMContentLoaded', ()=>{
  const startLang = localStorage.getItem('lang') || 'sv';
  applyLang(startLang);

  document.getElementById('langSelectLock')?.addEventListener('change', e => applyLang(e.target.value));
  document.getElementById('langSelectMenu')?.addEventListener('change', e => applyLang(e.target.value));
});

window.t = t;
