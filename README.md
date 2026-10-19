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
- Pořadí vyhodnocení: **lasery** (všichni naráz, ze startovních pozic) → start torpéd a odhození min →
  výbuch min (nepřítel v poli / odpočet) → pohyb lodí a torpéd (srážky, vlet do min). Úprava štítu
  a úhybný manévr platí od úplného začátku kola (ještě před lasery).

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
Každá stojí 1 bod: **úprava pohybu** (jiná rychlost nebo směr než „stejnou rychlostí rovně“), **otočka 180°**
(po ní klesne rychlost o 2; stres jen z červeného manévru), **úhybný manévr** (1 stresový bod: proletíš skrz
nepřátelské lodě – každá ztratí 1 stresový bod – nesmíš s nimi ale skončit v dotyku; zranění minou/torpédem
v tom kole −50 %), **lasery**, **torpédo**, **mina**. Bez akce loď jen letí dál a nestřílí. Ikony u konce dráhy
(⚡ lasery · ➤ torpédo · ✹ mina · ⟲ otočka) zapínají/vypínají, panel ukazuje použité akce.
Staré akce po pohybu (zaměřit, úhyb, zámek, posun, úskok) jsou vypnuté – vrátí se jako schopnosti pilotů.
Torpédo odstartuje **hned se začátkem pohybu** ze startovní pozice lodi.

### Fog of war
Každá loď vidí do vzdálenosti **960** (3 × zaměřovací dostřel torpéda); tým dohled sdílí. Server každému
posílá jen to, co jeho tým vidí (lodě, torpéda, miny). Asteroid, který tým jednou spatřil, zůstává v jeho
paměti v podobě, v jaké ho naposledy viděl – poškození mimo dohled se neprojeví, dokud ho zase neuvidí.

### Výbava lodi (inventář)
Loď **Stíhač** má 4 malé sloty: příď, záď, levobok, pravobok. Příď a záď jsou pod sebou a lze je spojit v jeden
**velký** slot pro budoucí velké moduly. Moduly:
**Lasery** (100 cr, váha 2), **Torpédomet** (150, váha 1 + 1 za torpédo, 3 ks), **Minový zásobník** (100, váha 1 +
0,5 za minu, 2 ks), **Segmentový štít** (120, váha 2), **Celolodní štít** (120, váha 2). Součet váhy snižuje
max. rychlost: každých 6 váhy = −1 (výchozí sestava má váhu 10 → rychlost max. 4, prázdná loď 5). Vystřelená
munice loď odlehčí. Loď smí letět i bez modulů. Více modulů stejného typu = víc munice; při střelbě si vybereš,
ze kterého modulu střílíš (jeden za akci). **Natočení:** lasery, torpédomet a miny míří na jednu ze 4 stran
(kamkoli kromě „do středu“ svého slotu; miny ne dopředu) – lasery pak střílí jen v té výseči (dopředu ±20°, do
boku ±15°, dozadu ±10°), miny se odhazují na tu stranu a torpédo tím směrem vylétá. Natáčí se jen v místnosti
(klik na šipku modulu). Pilot: zatím jen **Kadet** (bez schopností).

**Nákup:** v místnosti má každý rozpočet (ladění → Ekonomika, výchozí 500) a kupuje moduly; host může omezit
počet kusů každého modulu na hráče a zvolit výbavu botů (výchozí / náhodná / ruční naklikání). Co hráč neutratí,
má ve hře jako **kredity**; další dostane za sestřel (200) a za každé přežité kolo (10). Akce **Vyhodit modul**
(1 akce) modul na začátku kola odhodí – loď je lehčí, modul zůstane jako trosky, které jde sestřelit lasery
(klik na trosky = cíl) za polovinu ceny. Nákupy mezi koly a vylepšení modulů přijdou později.

### Životy a štíty
Trup 100. Jeden čistý zásah laseru = 15. Štít je modul (segmentový, nebo celolodní – nelze kombinovat):
- **Segmentový** (výchozí) – čtyři segmenty (předek, pravobok, záď, levobok) po **2 bodech**. Každý zásah
  (salva laserů, torpédo, výbuch, náraz) trefí segment podle směru, odkud přišel, ubere **1 bod** a je pohlcen
  celý; segment na nule už nechrání a zranění jde do trupu. Akce **Úprava štítu** (1 akce) body přesune
  (stejný součet, max. 3 na segment) – v panelu lodi –/+ u segmentů, odebrané body „v ruce“ je nutné rozmístit.
- **Celolodní** – zásoba 50 kolem celé lodi; pohltí **účinnost %** zranění (začíná na 100 %), zbytek jde do
  trupu, po každém zásahu účinnost klesne o 10 %.
Štíty se zatím nedobíjejí (dobíjení přinesou moduly). V liště je loď s pixelovou bublinou štítu (barva podle
síly: modrá / žlutá / červená) a tlačítka CENTROVAT (mapa na loď) a INVENTÁŘ (zatím ukázka). Na mapě má
celolodní štít kruh obarvený podle síly, segmentový čtyři oblouky otáčející se s lodí.

### Zbraně
- **Lasery** (1 akce) – střílí **na začátku kola ze startovní pozice**, výseč ±20° před přídí, dostřel 300
  (3 pásma: blízko +1 kostka útoku, daleko +1 kostka obrany). Při zapnutých laserech lišta i mapa ukazují
  **šanci na zásah v %** (aspoň jeden čistý zásah) a průměrné zranění. Střílí na preferovaný cíl, pokud je ve výseči,
  jinak na nejbližšího nepřítele.
  **Nestřílí skrz asteroidy.**
- **Fázové torpédo** (3 ks, 1 akce) – cíl: nepřátelská loď/torpédo do 320 (sleduje celý let) **nebo bod na mapě**
  do 1200 (letí tam a vybuchne). Let má tři fáze: **výlet** rovně z lodi (60 j. rychlostí 120/kolo) → **zaměření**
  (otáčí se na cíl až 90°/kolo, hotovo pod 15°) → **let** (zrychluje +120/kolo na 240, zatáčí jen 45°/kolo; cíl
  mimo výseč ±90° před sebou ztratí a letí rovně). Žije 5 kol; první 2 kola nemůže zranit vlastníka (ochranná lhůta). Vše v ladění ve skupině „Fázové torpédo“.
  Přímý zásah lodi = 45. Výbuch (na bodě, o asteroid, na konci doletu) = poloměr 70, zranění 30 všem lodím
  v poli a **kráter do asteroidu**. Sestřelení: torpédo jde ručně označit jako cíl laserů (2 obranné kostky)
  nebo jako cíl jiného torpéda; dvě torpéda, která se potkají, vybuchnou.
- **Mina** (2 ks, 1 akce) – odhodí se ze startovní pozice lodi **za sebe** (40) nebo **do strany** (70). Buď **na vstup**: od příštího kola ji
  spustí kdokoliv (i vlastní loď) nebo torpédo při vstupu do pole (poloměr 70), nebo **časovaná 1–3 kola**:
  na lodě nereaguje, vybuchne na začátku kola, kdy odpočet dojde (na mapě T-n). Mina na vstup vybuchne hned
  na začátku kola, pokud v jejím poli stojí nepřítel. Zranění 30 všem v poli, kráter do asteroidu.
- **Asteroidy** mají tvar (48 paprsků); výbuchy z nich vykusují krátery (poloměr 45), malý zbytek se rozpadne.

### Ladění parametrů ve hře
Host má v lobby i během bitvy tlačítko **LADĚNÍ** (⌖): menu se všemi čísly – zranění (laser, torpédo
přímé/plošné, mina, nárazy, nebezpečný manévr, kráter), loď (trup, štíty, dobíjení, kostky, munice, dohled),
dosahy (laser, torpédo: zaměření, dolet, rychlost, zatáčení, životnost) a akce/stres. Změny se pošlou na
server, platí pro všechny od příštího kola (u běžících lodí se přepočítají maxima). **ULOŽIT** je zapíše
na server do `tuning.json` v kořeni projektu – stanou se výchozími pro každou novou místnost (i po restartu);
**NAČÍST ULOŽENÉ** je vrátí, **VÝCHOZÍ** dá tovární hodnoty. Meze a tovární hodnoty jsou
v `packages/shared/src/tuning.ts`.

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
- v2.2 – **natočení modulů**: lasery, torpédomet a miny mají směr (4 strany, ne „do středu“ slotu); šipka v rohu
  modulu v editoru (klik otočí), ve hře jen k nahlédnutí v inventáři, soupeř ji nevidí. Lasery střílí ve výseči
  podle natočení (dopředu ±20°, do boku ±15°, dozadu ±10° – ladění → Lasery), výseč v plánování se kreslí podle
  vybraného laseru. Miny se odhazují jen na stranu natočení (na příď je nelze dát), torpédo vylétá směrem modulu.
  Štíty se neotáčejí.
- v2.1.1 – tlačítka akcí jen pro moduly, které loď skutečně má (bez torpédometu žádné TORPÉDO, po vyhození min
  zmizí MINA, bez segmentového štítu není ŠTÍT; skupina bez akcí se neukáže). Získaný modul tlačítko zase přidá.
- v2.1 – vyhození modulu přes inventář (akce VYHODIT otevře inventář, klik na modul, POTVRDIT); podobizna pilota
  ve svislém sloupci vedle SPUSTIT KOLO s pixelovou bublinou schopností; inventář bez řádku loď/pilot; ladicí menu se záložkami podle
  kategorií a bez ztráty rozepsané hodnoty při překreslení (políčko už nepřepisuje, co právě píšeš).
- v2.0.2 – oprava: pomalé fázové torpédo doháněla vlastní loď a hned ve 2. kole do něj narazila. Nově má torpédo
  **ochrannou lhůtu** (ladění, výchozí 2 kola): vlastníkovy lodě jím proletí a jeho výbuch je nezraní.
- v2.0.1 – sloty podle schváleného nákresu: 4 malé (příď, záď, levobok, pravobok), příď + záď pod sebou jde spojit
  v 1 velký (žlutý rám); velká pixelová loď se sloty uvnitř siluety v editoru i inventáři.
- v2.0 – **Inventář, piloti a ekonomika**: loď Stíhač má 4 sloty (boky malé, příď a záď na 1 velký / 2 malé);
  moduly Lasery, Torpédomet (3 ks), Minový zásobník (2 ks), Segmentový štít, Celolodní štít – každý má cenu a váhu,
  váha snižuje max. rychlost (vystřelená munice odlehčí). Výbava se kupuje v místnosti z rozpočtu (ladění →
  Ekonomika); host omezuje počty modulů na hráče a volí výbavu botů (výchozí / náhodná / ruční). Pilot „Kadet“.
  Kredity: zbytek rozpočtu + odměny za sestřel a přežité kolo. Akce **Vyhodit modul** (trosky lze sestřelit
  lasery za kredity). Inventář ve hře = náhled sestavy. Více modulů stejného typu = výběr, ze kterého se střílí.
  Ladicí menu přeskupeno (Loď, Akce a stres, Lasery, Fázové torpédo, Miny, Štíty, Ekonomika).
- v1.15 – **Fázové torpédo**: výlet rovně z lodi (60 j., 120/kolo) → zaměření (otáčí se 90°/kolo, hotovo pod 15°)
  → let (zrychluje +120/kolo na 240, zatáčí 45°/kolo, cíl mimo ±90° ztratí). Všechny parametry v ladění
  (skupina „Fázové torpédo“); plamen torpéda podle rychlosti.
- v1.14 – úhybný manévr v animaci (varianta E): poloprůhledná loď se sudovým překrutem, pulzující modrý obrys,
  jiskry, bledé kopie; při průletu nepřátelskou lodí vlnky a „PRŮLET −1 STRES“. Lasery: v liště i u cíle na mapě
  se ukazuje šance na zásah v % (přesný výpočet z kostek, pásma, zaměření, zámku a úhybu) a průměrné zranění.
- v1.13.2 – oprava: animace salv laserů běží na začátku kola před pohybem (událost pohybu se řadila před lasery).
- v1.13.1 – lišta: akce ve skupinách Zbraně · Pohyb · Speciální, menší panel manévru, úzké svislé SPUSTIT KOLO; CENTROVAT a INVENTÁŘ přesunuty k tlačítku ladění nad mapou.
- v1.13 – štíty: segmentový (4 × 2 body, zásah podle směru, akce Úprava štítu) nebo celolodní (zásoba + účinnost
  klesající o 10 % za zásah), volba v místnosti; panel lodi s pixelovou bublinou štítu, CENTROVAT a INVENTÁŘ;
  štíty na mapě; kývání lodi při úhybném manévru.
- v1.12 – otočka snižuje rychlost o 2; nová akce úhybný manévr; oprava psaní do polí (ladění, kód místnosti).
- v1.11.1 – ukládání parametrů na server (tuning.json), načtení uložených, oznámení ve hře.
- v1.11 – lasery střílí na začátku kola ze startovní pozice (výseč se kreslí u lodi), animace: salvy → pohyb.
- v1.10.1 – miny vybuchují na začátku kola (nepřítel v poli, nebo odpočet na nule), ne až na konci.
- v1.10 – ladicí menu parametrů hry (host, lobby i bitva, platí pro všechny).
- v1.9.2 – mina se odhazuje na začátku kola s animací letu na zvolené místo; ikony zbraní u konce dráhy odstraněny (jen lišta).
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
