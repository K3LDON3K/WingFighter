# SpaceGame – tahová vesmírná střílečka (prototyp v1)

2D tahová multiplayerová hra v prohlížeči. Inspirace: desková hra X-Wing (ciferník manévrů,
skryté simultánní plánování, kostky) a Space Rangers (vzhled, později inventář lodí).

## Rychlý start (Mac)

1. Nainstaluj **Node.js** (verze 20 nebo novější) z <https://nodejs.org> – stačí jednou.
2. Poklepej na **`Spustit server.command`** (poprvé se stáhnou knihovny a sestaví klient, chvíli to trvá).
3. V okně Terminálu se objeví adresy. Otevři v prohlížeči `http://localhost:3000`.
4. Ostatní hráči na stejné síti otevřou adresu **„V síti“** (např. `http://192.168.1.23:3000`).
5. Ukončení serveru: v Terminálu `Ctrl+C` nebo zavřít okno.

Stejný příkaz funguje jako **dedikovaný server** na jakémkoli stroji s Node.js
(`npm install && npm start`). Port lze změnit proměnnou `PORT=4000 npm start`.

## Jak se hraje

- V lobby si zvol jméno, vytvoř místnost (nebo se připoj kódem / ze seznamu), vyber tým.
  Host může přidat boty a nastavit mód (týmový deathmatch / deathmatch), limit kol a počet lodí na hráče.
- Každé kolo **všichni tajně naplánují** manévr (rychlost + směr), akci po pohybu *nebo* speciální zbraň
  a cíl laserů. Po „Připraven“ od všech se kolo **vyhodnotí najednou** a přehraje.
- Pořadí vyhodnocení: pohyb lodí a torpéd (včetně srážek a min) → akce → lasery (všichni naráz)
  → vypuštění nových torpéd a min → dobití štítů (+1).

### Manévry
Manévr = **rychlost 1–5** + **změna kurzu** (po 15°, max ±90°; čím rychleji, tím menší povolený úhel)
nebo **otočka o 180°** (rychlost 3–4). Nastavuje se jen myší: **klik na vlastní loď** zapne kreslení dráhy
(směr podle polohy myši, rychlost podle vzdálenosti; kolečko nebo klávesy 1–5 rychlost zamknou, K = otočka),
**další klik potvrdí** a loď se pustí. Kolem lodi jsou tečky dosažitelných pozic obarvené podle náročnosti.
Bez označení loď poletí tak, jak má nakresleno (výchozí = stejná rychlost rovně).

**Stresové body** (3 na loď, vidí je všichni): bílý manévr nic, **zelený** (mírný) vrátí 1 bod,
**červený** (ostrý úhel ≥75°, při rychlosti 4+ už ≥45°, *nebo* změna rychlosti o 2+) stojí 1 bod,
**nebezpečný** (změna rychlosti o 2+ *a* ostrý úhel) stojí 2 body a 5 % trupu. Bez bodů manévr nejde vybrat.
Akce po pohybu zůstává vždy povolená.

Lodě nikdy nestojí: při srážce s lodí, asteroidem nebo okrajem mapy je loď **odmrštěna** novým (náhodně
odchýleným) směrem, dostane 15 zranění, ztratí akci a doletí zbytek pohybu tím směrem.

### Akce – 2 na kolo
Každá stojí 1 bod: **úprava pohybu** (jiná rychlost nebo směr než „stejnou rychlostí rovně“), **otočka 180°**,
**lasery**, **torpédo**, **mina**. Bez akce loď jen letí dál a nestřílí. Ikony u konce dráhy
(⚡ lasery · ➤ torpédo · ✹ mina · ⟲ otočka) zapínají/vypínají, panel ukazuje použité akce.
Staré akce po pohybu (zaměřit, úhyb, zámek, posun, úskok) jsou vypnuté – vrátí se jako schopnosti pilotů.
Torpédo odstartuje **hned se začátkem pohybu** ze startovní pozice lodi.

### Fog of war
Každá loď vidí do vzdálenosti **960** (3 × zaměřovací dostřel torpéda); tým dohled sdílí. Server každému
posílá jen to, co jeho tým vidí (lodě, torpéda, miny). Asteroid, který tým jednou spatřil, zůstává v jeho
paměti v podobě, v jaké ho naposledy viděl – poškození mimo dohled se neprojeví, dokud ho zase neuvidí.

### Životy
Trup 100, štíty 50 (dobíjejí se 10 za kolo). Jeden čistý zásah laseru = 15.

### Zbraně
- **Lasery** – každé kolo zdarma, výseč ±20° před přídí, dostřel 300 (3 pásma: blízko +1 kostka útoku,
  daleko +1 kostka obrany). Střílí na preferovaný cíl, pokud je ve výseči, jinak na nejbližšího nepřítele.
  **Nestřílí skrz asteroidy.**
- **Torpédo** (3 ks, místo akce) – cíl: nepřátelská loď/torpédo do 320 (sleduje 3 kola) **nebo bod na mapě**
  do 1200 (letí tam a vybuchne). Rychlost 240/kolo, zatáčí max 75°/kolo, žije 5 kol.
  Přímý zásah lodi = 45. Výbuch (na bodě, o asteroid, na konci doletu) = poloměr 70, zranění 30 všem lodím
  v poli a **kráter do asteroidu**. Sestřelení: torpédo jde ručně označit jako cíl laserů (2 obranné kostky)
  nebo jako cíl jiného torpéda; dvě torpéda, která se potkají, vybuchnou.
- **Mina** (2 ks, 1 akce) – odhodí se ze startovní pozice lodi **za sebe** (40) nebo **do strany** (70). Buď **na vstup**: od příštího kola ji
  spustí kdokoliv (i vlastní loď) nebo torpédo při vstupu do pole (poloměr 70), nebo **časovaná 1–3 kola**:
  na lodě nereaguje, vybuchne po odpočtu (na mapě ⏱). Zranění 30 všem v poli, kráter do asteroidu.
- **Asteroidy** mají tvar (48 paprsků); výbuchy z nich vykusují krátery (poloměr 45), malý zbytek se rozpadne.

Všechna čísla jsou v `packages/shared/src/constants.ts` a `ships.ts`.

## Struktura projektu

```
packages/shared   pravidla hry (jediný zdroj pravdy, sdílí server i klient) + testy
packages/server   Node.js server: lobby, místnosti, WebSocket, hostuje i klienta
packages/client   prohlížečový klient: Vite + Canvas 2D, generovaný pixel art
```

Příkazy (z kořenové složky):

| příkaz          | co dělá                                                        |
| --------------- | -------------------------------------------------------------- |
| `npm install`   | nainstaluje závislosti                                         |
| `npm start`     | sestaví klienta a spustí server na portu 3000                  |
| `npm run dev`   | vývojový režim (server s auto-restartem + Vite na portu 5173)  |
| `npm test`      | testy herních pravidel                                         |
| `npm run typecheck` | kontrola typů ve všech balíčcích                           |

## Historie změn
- v1.9 – mina se volí na mapě ve dvou krocích: kam odhodit (tři místa kolem lodi), pak čas výbuchu (✕ = zpět na místo).
- v1.8 – pixel art UI „Retro konzole“ (přibalené fonty Press Start 2P + Pixelify Sans, pixelové ikony,
  zkosené panely, segmentové pruhy) pro lištu, HUD, log i lobby.
- v1.7 – torpédo zatáčí 120°/kolo a sleduje celý let, animace vypuštění, cíl torpéda jen klikem na mapě;
  mina za sebe / vlevo / vpravo; spodní lišta s pevnými rozměry a piktogramy.
- v1.6 – nové UI: spodní lišta (stav lodi, manévr, tlačítka zbraní s časováním/cílem/dostřelem na mapě,
  velké SPUSTIT KOLO), pravý panel odstraněn, log jako okno v rohu mapy.
- v1.5 – výseč laserů jen při zapnuté akci lasery; miny na vstup nebo časované 1–3 kola.
- v1.4 – systém 2 akcí na kolo (úprava pohybu, otočka, lasery, torpédo, mina); lasery jen jako akce.
- v1.3 – míření jen po označení lodi, zbraně ∅/torpédo/mina (akce po pohybu vypnuté), torpédo startuje
  s pohybem, fog of war s pamětí asteroidů, lasery nestřílí skrz asteroidy.
- v1.2 – ovládání jen myší u lodi (bez tlačítek), ikony akcí s vysvětlením u konce dráhy, stresové body,
  životy 100/50, torpédo na bod mapy s plošným výbuchem, krátery v asteroidech.
- v1.1 – manévr myší (rychlost + úhel místo ciferníku), odmrštění při srážce, sestřelování torpéd,
  torpéda spouští miny, větší mapa (2400×1600), oprava zadávání jména.
- v1 – první hratelný prototyp.

## Co bude dál (v2)
Utkání o více bitvách, vylepšování lodí mezi bitvami (inventář: trup + moduly, sloty),
více tříd lodí, pohyblivé asteroidy, zvuk, vlastní vesmír a jména, desktopový obal s tlačítkem „hostovat“.
