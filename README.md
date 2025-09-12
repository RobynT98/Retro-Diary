# Retro Diary

En **krypterad retro-dagbok (PWA)** med pergament/läderkänsla.  
All text sparas **lokalt** i din webbläsare och krypteras med **AES-GCM** (nyckel från ditt lösenord via PBKDF2).  
Fungerar offline, kan installeras som app, och låter dig exportera/importera allt som `.json`.



## ✨ Funktioner

- 🔐 **Lås/Lås upp** med eget lösenord (sätts första gången).
- 📝 **Rich text**: rubriker H1–H3, fet/kursiv/understrykning/överstrykning, citat, kod, listor (• / 1.), textjustering (vänster/center/höger), horisontell linje.
- 🔗 **Länkar** (lägg till/ta bort).
- 🎨 **Färg & markering**, förbättrade färgval.
- 🖼️ **Infoga bild** (URL eller fil), emoji/symbol-stöd.
- 🧷 **Taggar** per inlägg + **sök** (titel, text, tagg) + tagg-filter.
- 🧠 **Autospara** (0,8 s efter inmatning) + manuell spara/ny/radera.
- 🔤 **Fontväljare** (16 förinstallerade) + **fontdatabas** för att enkelt lägga till fler.
- 🌗 **Dark/Light** och pappers/ink-teman (tema sparas lokalt).
- ⤴️ **Export/Import (.json)** – säkerhetskopia av allt (krypterat).
- 📱 **PWA**: offline, ”Lägg till på hemskärmen”.
- ♻️ **⟳ Uppdatera app** – rensar service worker & cache när du uppdaterar koden.



## 🚀 Kom igång

1. **Klona** repo:t eller ladda ned ZIP och lägg allt i en statisk webbserver (GitHub Pages funkar direkt).
2. Öppna `index.html` → klicka **Sätt nytt lösen** och välj ett lösenord.
3. Börja skriva. **Autospara** körs automatiskt.  
   Du kan alltid **Exportera** från menyn för extra backup.

> **Tips:** Efter att du uppdaterat filer i repo:t, klicka **⟳ Uppdatera app** nere till höger för att tvinga in ny cache.


## 📁 Filstruktur
```
/ (rot) ├─ index.html ├─ styles.css ├─ app.js ├─ fonts_db.js        ← fontkatalog (lägg till egna fonter här) ├─ sw.js              ← service worker för cache/offline ├─ manifest.json      ← PWA-manifest ├─ leather.jpg        ← bakgrund (läder) ├─ parchment.jpg      ← bakgrund (pergament) ├─ icon-192.png ├─ icon-512.png └─ README.md
```

## 🔐 Säkerhet

- Innehållet krypteras med **AES-GCM 256**.
- Nyckeln härleds från ditt lösenord med **PBKDF2 (SHA-256, 150k+ iterationer)**.
- All data lagras i **IndexedDB** i din webbläsare.
- **Glömt lösenordet?** Det finns ingen återställning. Importera en **tidigare export** eller börja om.


## 🧩 Toolbar-översikt

| Knapp | Funktion |
| --- | --- |
| **B / I / U / S** | Fet / Kursiv / Understryk / Överstryk |
| **H1 / H2 / H3 / Brödtext** | Formatblock |
| **• List / 1. List** | Oordnad / Ordnad lista |
| **⟸  ⟺  ⟹** | Vänster / Center / Högerjustera |
| **🔗 / 🔗×** | Lägg till/ta bort länk |
| **🖼️** | Infoga bild (URL eller fil) |
| **▭** | Horisontell linje |
| **🎨 (färg) / 🟨 (markering)** | Textfärg / Markeringsfärg |
| **🔤 Font** | Välj typsnitt (från `fonts_db.js`) |
| **🌓** | Dark/Light |

**Tips:**  
- Ctrl/Cmd **B/I/U** – fet/kursiv/understryk  
- Ctrl/Cmd **Z / Shift+Z** – ångra / gör om



## 🔎 Titel, taggar & sök

- **Titel**: första raden i din text blir titel (kan klippas/ändras).  
- **Taggar**: använd fältet ”Lägg till tagg…” per inlägg (Enter för att lägga till).  
- **Sök**: filtrerar på titel, innehåll och taggar.


## 🗂 Export/Import

- **Exportera** → `.json` med: `meta` (salt+test) & `entries` (krypterat).  
- **Importera** → läser in filen och ersätter lokala poster (läggs in parallellt).  
- **Lås upp** med samma lösenord som användes när exporten skapades.

> Förvara exporten i t.ex. iCloud/Drive/Dropbox.


## 🔤 Fonter

### Hitta fler fonter
- **Google Fonts:** <https://fonts.google.com>  
  Sök, testa och kopiera *familjsträngen* (i adressfältet, t.ex. `Mate+SC`).

### Lägg till en font
Öppna `fonts_db.js` och lägg till i `window.FONT_DB`:

```js
// Exempel: lägg till "Mate SC"
{ label: "Mate SC", css: "'Mate SC', serif", gf: "Mate+SC" }
```
### label – namnet som visas i fontmenyn
css – CSS-familjen som faktiskt sätts på editor-ytan
gf – Google Fonts-familj (exakt som i webbadressen)
Efter att du sparat: klicka ⟳ Uppdatera app i UI:t så laddas nya fonter.

## 🎨 Teman & färger
Dark/Light: via 🌓 i menyn (sparas i localStorage).
Papper/Ink: byt bakgrund/ink-färg i menyn och återställ när du vill.

## 🧹 Uppdatera cache
PWA:er cache:ar aggressivt. När du uppdaterar repo:t:
Ladda sidan.
Klicka ⟳ Uppdatera app → bekräfta.
(Avregistrerar service worker + rensar Cache Storage + reloada sidan.)

## 🛠 Felsökning
”Jag ser inte nya ändringar” → Klicka ⟳ Uppdatera app.
Lösenord glömt → Tyvärr låst; importera en äldre export.
Bytt enhet → Exportera på gamla → Importera på nya → Lås upp med samma lösen.

## 🧱 Teknik
Editor: contenteditable + execCommand (enkel, bred kompatibilitet).
Lagring: IndexedDB (entries, meta).
Krypto: window.crypto.subtle (Web Crypto API).
PWA: sw.js cache: app-shell + offline-stöd.

## 🗺️ Roadmap / idéer
Checklistor (☐/☑), tabeller, mallar.
Ritverktyg (canvas) för skisser.
Per-inlägg-nyckel (delbar, fortfarande lokalt).
Synk (valfritt) via egen backend/Supabase med E2E-krypto.

## 📦 Distribuera
GitHub Pages: lägg filerna i main (eller docs/) och aktivera Pages.
Vercel/Netlify: ”Deploy static site”.
Android (TWA/WebAPK): PWA:n kan packas till APK – följ respektive guide.

## ⚖️ Licens
MIT – Använd privat eller vidareutveckla fritt. Ingen garanti.
Kom ihåg backuper! Exportera regelbundet.

# 🙏 Tack
Google Fonts för typsnitt.
Bakgrunder: leather.jpg, parchment.jpg (byt gärna till egna).
