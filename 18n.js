<!-- i18n.js -->
<script>
window.I18N = {
  sv: {
    app_title: "Retro Diary",
    lock_title: "🔒 Retro Diary",
    lock_placeholder: "Dagbokens lösenord",
    set_pass: "Sätt nytt lösen",
    unlock: "Lås upp",
    wipe_all: "Rensa ALL lokal data",
    menu: "Meny",
    search: "Sök",
    clear: "Rensa",
    new_page: "Ny sida",
    save: "Spara",
    delete: "Radera",
    lock: "Lås",
    memory_mode: "Minnesläge",
    theme: "Tema",
    theme_light: "Ljust",
    theme_dark: "Mörkt",
    about: "Om appen",
    help: "Hjälp",
    privacy: "Sekretess",
    copyright: "© Conri Turesson",
    about_head: "Om Retro Diary",
    about_p1: "En privat, lokalt krypterad dagbok med retro-känsla.",
    help_head: "Hjälp",
    help_p1: "Välj ett lösenord, skriv, spara. Allt lagras lokalt och krypteras.",
    privacy_head: "Sekretess",
    privacy_p1: "Inget lämnar din enhet om du inte exporterar själv."
  },
  en: {
    app_title: "Retro Diary",
    lock_title: "🔒 Retro Diary",
    lock_placeholder: "Diary password",
    set_pass: "Set new password",
    unlock: "Unlock",
    wipe_all: "Wipe ALL local data",
    menu: "Menu",
    search: "Search",
    clear: "Clear",
    new_page: "New page",
    save: "Save",
    delete: "Delete",
    lock: "Lock",
    memory_mode: "Memory mode",
    theme: "Theme",
    theme_light: "Light",
    theme_dark: "Dark",
    about: "About",
    help: "Help",
    privacy: "Privacy",
    copyright: "© Conri Turesson",
    about_head: "About Retro Diary",
    about_p1: "A private, locally encrypted diary with a retro feel.",
    help_head: "Help",
    help_p1: "Choose a password, write, save. Everything is local & encrypted.",
    privacy_head: "Privacy",
    privacy_p1: "Nothing leaves your device unless you export it yourself."
  }
};

// apply language to any element with data-i18n="key"
window.applyLang = function(lang){
  const dict = I18N[lang] || I18N.sv;
  document.documentElement.setAttribute('lang', lang);
  localStorage.setItem('lang', lang);
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    if(dict[key] != null){
      if(el.placeholder !== undefined && /placeholder/i.test(key)) {
        el.placeholder = dict[key];
      } else {
        el.textContent = dict[key];
      }
    }
  });
};
</script>
