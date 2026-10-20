# Wingfighter – tahová vesmírná střílečka

(Dříve SpaceGame. Balíčky se jmenují `@wingfighter/shared`, `@wingfighter/server`, `@wingfighter/client`.)

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

### Mapa a bouře
Host v místnosti nastaví mapu: velikost (Malá 2400×1600 · Střední 3600×2400 · Velká 4800×3200 · Obří 6400×4000),
asteroidy (žádné/málo/střední/hodně, volitelně shluky), bouře (0–5, malé/střední/velké), symetrii (zrcadlená mapa)
a seed – stejný seed = stejná mapa. Náhled ukazuje asteroidy, bouře a **startovní body** po okraji (12–24 podle
velikosti, mimo překážky); hráč si klikem vybere start, ostatní vidí barvu a jméno. Kdo nevybere, dostane volný
bod co nejdál od soupeřů. **Elektromagnetická bouře**: uvnitř nefungují štíty (zásah jde rovnou do trupu) ani lasery
(nejde střílet z bouře, do bouře ani skrz ni), torpédo po vletu ohluchne a letí rovně, skener a dohled bouří
neprojdou (dohled bouře neovlivňuje – loď v bouři je vidět).

### Fog of war
Každá loď vidí do vzdálenosti **960** (3 × zaměřovací dostřel torpéda); tým dohled sdílí. Server každému
posílá jen to, co jeho tým vidí (lodě, torpéda, miny). Asteroid, který tým jednou spatřil, zůstává v jeho
paměti v podobě, v jaké ho naposledy viděl – poškození mimo dohled se neprojeví, dokud ho zase neuvidí.

### Výbava lodi (inventář)
Loď **Stíhač** má 4 malé sloty: příď, záď, levobok, pravobok. Příď a záď jsou pod sebou a lze je spojit v jeden
**velký** slot pro budoucí velké moduly. Moduly:
**Lasery** (100 cr, váha 2), **Kulomet** (120, váha 1 + 0,02/náboj, 100 nábojů; dávka 10 × 3 zranění, dosah 150,
výseč ±45°, šance zásahu podle vzdálenosti, funguje v bouři), **Torpédomet** (150, váha 1 + 1 za torpédo, 3 ks), **Miny** (100, váha 1 +
0,5 za minu, 2 ks), **Segmentový štít** (120, váha 2), **Celolodní štít** (120, váha 2). Součet váhy snižuje
max. rychlost: každých 6 váhy = −1 (výchozí sestava má váhu 10 → rychlost max. 4, prázdná loď 5). Vystřelená
munice loď odlehčí. Loď smí letět i bez modulů. Více modulů stejného typu = víc munice; při střelbě si vybereš,
ze kterého modulu střílíš (jeden za akci). **Natočení:** lasery, torpédomet a miny míří na jednu ze 4 stran
(kamkoli kromě „do středu“ svého slotu; miny ne dopředu) – lasery pak střílí jen v té výseči (dopředu ±20°, do
boku ±15°, dozadu ±10°), miny se odhazují na tu stranu a torpédo tím směrem vylétá. Natáčí se jen v místnosti
(klik na šipku modulu). **Skener** (130 cr, váha 1): 2 náboje; sken lodi (1 náboj, do 600, cíl v dohledu) hned
ukáže výbavu cizí lodi; hluboký sken (2 náboje) hned odkryje mapu do 2000 celému týmu do konce kola a spustí cooldown
3 kola (po něm plné náboje); zelený manévr dobíjí +1; cooldown jde vynutit (délka = 3 − náboje). Nebere akci.
Pilot: zatím jen **Kadet** (bez schopností).

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
- v3.28 – kolize podle modelu lodi: každý trup má sadu kolizních kruhů v souřadnicích lodi
  (`HullDef.colliders`; stíhač = tělo, příď, levé a pravé křídlo, plameny motorů se nepočítají), otáčí se
  s lodí a používají se pro loď × loď, asteroidy, komety, miny, torpéda, výbuchy, okraj mapy i volné místo
  pro boost / sudový překrut. Lasery a kulomet míří dál na střed lodi. Hitboxy se běžně nezobrazují; v ladění
  je nová záložka **Zobrazení** (místní volby, neposílají se na server) s přepínačem „Zobrazit hitboxy
  lodí“ – zelené kružnice u všech viditelných lodí (v3.28.1). Nový modul `packages/shared/src/colliders.ts`.
- v3.27 – popisek u konce naplánované dráhy nahrazen čárkami: počet čárek = rychlost (1–4), barva = obtížnost
  manévru (zelená / bílá / červená); číslo rychlosti a údaj o stupních se už nezobrazují, otočka má navíc ↺.
- v3.26 – potvrzení nevyužitých akcí už není překryvný dialog: vysune se okénko přímo nad tlačítko SPUSTIT
  KOLO (styl jako skener) s počtem volných akcí a tlačítky SPUSTIT / ZPĚT; potvrdit jde myší, dalším
  Enterem nebo dalším stiskem SPUSTIT KOLO, Esc = zpět. Tlačítko CENTROVAT přejmenováno na **POHLED**
  (C; stavy loď / dohled / mapa) a vedle něj nové tlačítko s okem (**F**): vycentruje na vybranou loď
  při zachování aktuálního zoomu.
- v3.25 – tlačítko CENTROVAT (C) má tři režimy a cyklicky je střídá: **loď** (2× blíž než dřív – polovina
  dohledu; zároveň výchozí pohled na začátku bitvy) → **dohled** (celý kruh dohledu, dřívější stav) →
  **mapa** (celá mapa). Na tlačítku jsou tři políčka s podsvíceným aktivním režimem a jeho název; po
  ručním posunu či zoomu kamery se indikátor zhasne a další stisk začne od režimu loď.
- v3.24 – UI: po spuštění kola i během vyhodnocování zůstává spodní lišta vidět, jen jsou všechna tlačítka
  vypnutá (tlačítko SPUSTIT ukazuje „kolo probíhá…“). Výchozí stav přepínače „potvrzení nevyužitých akcí“
  je nově **vypnuto**. Esc menu přehlednější: jednotná tlačítka (ikona · název · klávesa), skupiny Přehled
  (tabulka skóre, hudba a zvuk) a Odchod (ukončit bitvu pro všechny – jen host, opustit hru), popisky přímo
  v tlačítkách.
- v3.23 – čtvrtá vestavěná skladba **„Wingfighter – hlubina (Space)“** (G dórská, 100 BPM, 160 dob ≈ 96 s):
  ambientní let vesmírem ve stylu „Space“ skladeb ze Space Rangers – pady s dronem, sekvencovaná basa,
  melancholický lead s ozvěnou, třpytivé arpeggio, měkké bicí; hodí se do menu i do playlistu bitvy.
- v3.22 – třetí vestavěná skladba **„Wingfighter – bitva II (Rangers)“** (D moll, 138 BPM, 176 dob ≈ 77 s):
  elektronika ve stylu Space Rangers – pumpující kopák, offbeatová basa, šestnáctinová arpeggia, build-up
  se zhušťujícím snarem a šumovým nájezdem (nový hlas `riser`), drop se širokým leadem a harmonií, break
  s pady. U nové instalace je v playlistu bitvy automaticky.
- v3.21 – nové vestavěné skladby: chiptune sekvencer s pulzními vlnami (12,5 / 25 / 50 %), vibratem,
  tempovou ozvěnou, filtrovanými pady, „žesťovým“ sborem, subbasovým dronem, snare/kopák/hi-hat a limiterem.
  **Menu** (A moll, 88 BPM, 128 dob ≈ 87 s): vesmírná elektronika ve stylu Space Rangers – dron, pady, třpytivé
  arpeggio, intro → téma → druhé téma → téma s druhým hlasem → most. **Bitva** (E moll, 140 BPM, 184 dob
  ≈ 79 s): hnací basa v osminách, napjatá část, fanfárový refrén s žesti a pochodovým snarem (hrdinský
  charakter à la filmové vesmírné bitvy), breakdown s vířením, závěrečný refrén. Ladicí `window.__wfRender(id, s)`
  vyrenderuje skladbu do WAV.
- v3.20 – úvodní obrazovka: po načtení jen statické logo a tlačítko **SPUSTIT HRU**. Klik povolí zvuk
  v prohlížeči, přepne do hlavního menu, kde proběhne animace loga se zvukem a naváže hudba menu
  (nahrazuje nápovědu „klikni kamkoliv“ z v3.19.2). Při návratu do rozehrané bitvy se úvodní obrazovka
  přeskočí.
- v3.19.2 – zvuk po načtení: hned po otevření stránky se zkusí audio rozběhnout; když to prohlížeč povolí
  (Chrome u často hraných stránek), logo se zvukem a hudba startují samy. Jinak blikající nápověda dole
  „klikni kamkoliv“ – prohlížeče zvuk bez prvního vstupu uživatele nepovolí, to obejít nejde.
- v3.19.1 – odezva zvuku: cvaknutí tlačítek hraje už při stisku (ne až po puštění myši), animace loga
  se zvukem startuje až po rozběhnutí audia (resume je asynchronní – zvuk dřív zaostával za obrazem),
  audio kontext s nízkou latencí.
- v3.19 – hudba: dvě vestavěné syntetizované skladby (hlavní menu 84 BPM, bitva 128 BPM) a možnost nahrát
  vlastní mp3 / ogg / wav (ukládají se jen v prohlížeči, IndexedDB). Panel **HUDBA** vlevo nahoře v lobby
  a „Hudba a zvuk“ v Esc menu: přepínač, která skladba hraje v menu, zaškrtávátka pro playlist v bitvě
  (hraje popořadě, po konci další), oddělená hlasitost hudby a efektů, ztlumit vše (**M**). Výběr i hlasitost
  se pamatují. Po prvním kliknutí / klávese se animace loga přehraje znovu se zvukem (prolet stíhače,
  dva výstřely) a pak začne hudba menu; start bitvy přepne na playlist bitvy, návrat do lobby zpět.
- v3.18 – zvuky ve hře: události kola (lasery, kulomet, torpéda, miny, výbuchy, nárazy, štít/trup, úhyb,
  komety, náklad, zničení lodi) hrají prostorově – čím dál od vlastních lodí, tím tišeji; UI (klik, zapnutí
  / zrušení akce, chyba, spuštění kola, nové kolo, sken, bouře), lobby (připojení hráče), konec bitvy
  (výhra / prohra). Hlasitost a ztlumení v Esc menu, klávesa **M** = ztlumit; pamatuje se v prohlížeči.
- v3.17 – zvukový modul (`packages/client/src/sound.ts`): 27 syntetizovaných 8-bit efektů přes Web Audio
  (bez souborů), hlasitost a ztlumení v prohlížeči. Zatím jen ukázková stránka **/zvuky/** (server umí
  servírovat podsložky s index.html); napojení do hry přijde po odsouhlasení zvuků.
- v3.16 – zrušení naplánované akce: pod tlačítkem NÁKLAD (vyhodit / zvednout) a ŠTÍT se při aktivní akci
  zobrazí červený proužek ✕ přes celou šířku; klik akci zruší.
- v3.15.3 – výběr modulu k vyhození rovnou zavře okénko nákladu a ukáže oznámení; tlačítko zůstává označené
  (VYHODIT ✔) a řádek pod akcemi říká, co se vyhodí.
- v3.15.2 – náklad: po výběru modulu zelené potvrzení „✔ vyhodí se: …“ (v okénku i pod akcemi), vybraný hex
  pulzuje; ZVEDNOUT jde zapnout vždy (ukáže dosah) – když nic není v dosahu nebo je rychlost > 2, zobrazí se
  žluté varování, že se akce nevykoná.
- v3.15.1 – spojené tlačítko **NÁKLAD** (Speciální): vysune volby VYHODIT / ZVEDNOUT; vyhození ukáže hexový
  inventář, zvednutí cíl a podmínky. Popisek tlačítka se mění podle zvolené akce.
- v3.15 – **Nákladový prostor**: stíhač uveze 1 malý modul (ladění, skupina „Náklad“: dosah 120, max. rychlost 2,
  kapacita). Nová akce **Zvednout náklad** (Speciální, 1 akce): po střelbě a před pohybem zvedne vyhozený modul
  (trosky) v dosahu kolem lodi – klik na trosky = cíl, jinak nejbližší; jde jen s manévrem rychlosti ≤ 2.
  Přetahování o stejný předmět vyhrává pomalejší, pak bližší loď (v logu). Náklad nefunguje, jen váží
  (snižuje max. rychlost), v inventáři je sekce NÁKLAD a lze ho vyhodit (akce Vyhodit → zase trosky).
  Zvednutý modul si pamatuje munici. Mezi bitvami půjde (až budou navazující bitvy) nasadit zdarma nebo prodat.
- v3.14.1 – vyhození modulu: okénko s hexovým inventářem nad tlačítkem VYHODIT (klik na modul = výběr);
  panel INVENTÁŘ se už pro vyhození neotvírá.
- v3.14 – úprava štítu ve vysouvacím okénku nad tlačítkem ŠTÍT (styl skeneru): bublina, −/+ u segmentů, sloty;
  panel lodi je jen ukazatel (plán s štítkem PLÁN).
- v3.13.2 – štít na mapě má větší odstup od trupu (14 místo 6); jméno a ukazatele nad štítem.
- v3.13.1 – jméno hráče na záložce nad panelem lodi; v panelu tři svislé ukazatele (trup, stres, rychlost);
  VÝZBROJ ukazuje i lasery (∞ – bez munice); pixelové ikony −/+ u úpravy štítu.
- v3.13 – nový panel lodi: bublina štítu + svislé ukazatele trupu a stresu; „1/1“ se při jedné lodi nezobrazuje.
  **Úprava štítu**: po zapnutí akce ŠTÍT se u segmentů objeví −/+ (příď a záď: − vlevo / + vpravo; boky: + nahoře
  / − dole), každá změna platí hned (bez potvrzení), odebrané body svítí v 8 modrých slotech pod bublinou;
  návrat na původní rozložení akci sám vypne. Nový panel **VÝZBROJ**: řádek za každý modul s municí
  (TORP 1 ↑, TORP 2 ←, MINY ↓, KULOMET →), ikonky munice – vystřelené šedé, kulomet po 10 nábojích.
- v3.12 – nové písmo **Jersey 15** (pixel art s plnou českou diakritikou, OFL) všude v UI i na mapě; Press
  Start 2P zůstává jen v logu. Popisky už neodstraňují háčky a čárky.
- v3.11 – akce: v hlavičce svítí červeně **volné** akce (utracené se odbarví, „1/2 volné“); na tlačítku se
  cenové čtverečky po aktivaci odbarví a objeví se v nich pixel art fajfka; červené pilulky vlevo dole zrušeny.
- v3.10.3 – cena akce na tlačítkách jako čtverečky: červené = akce (otočka 2), žluté = náboje skeneru.
- v3.10.1 – každé tlačítko akce má vpravo nahoře žlutou cenu v akcích (1, otočka 2); tlačítko skeneru ukazuje
  jen náboje (2 políčka), při cooldownu 3 políčka s odpočtem.
- v3.10 – akce: nové tlačítko **MANÉVR** (první v Pohybu) nahrazuje NAKRESLIT – klik začne kreslit dráhu,
  znovu = potvrdit (mezerník a klik na loď fungují dál); panel MANÉVR vpravo je jen informativní. Za co
  byly akce vyčerpány ukazují červené pilulky: v hlavičce AKCE (použité červeně + „2/2 použito“) a vlevo
  dole na tlačítku dané akce. **Otočka stojí 2 akce** (dvě pilulky). Tlačítka bez volné akce jsou ztlumená.
  Tlačítka akcí jsou větší (72×62). Skener: místo řádku vpravo vyjedou tři stejně velká tlačítka nad
  tlačítko SKENER (přes okraj lišty): SKEN LODI ·1, VESMÍR ·2, COOLDOWN.
- v3.9 – ladění „Komety“: zaškrtávátko **Naráží do asteroidů i do sebe** – zapnuto = kometa se roztříští o
  asteroid (vykousne kráter) a dvě komety se při srážce zničí navzájem (doplňuje volbu v nastavení mapy,
  která řeší jen asteroidy). Ladicí panel umí zaškrtávací pole.
- v3.8 – přepínač potvrzení nad tlačítkem SPUSTIT KOLO (stejný styl, napojený shora): zapnuto = celé tlačítko
  tmavě červené se žlutým jezdcem vpravo a hra se před spuštěním ptá na nevyužité akce; vypnuto = běžná
  červená, kolo se spustí rovnou. Přepíná klik nebo klávesa P (animovaný jezdec), popis po najetí myší.
  Volba se pamatuje v prohlížeči pro kód místnosti (všechny její bitvy); zaškrtávátko v dialogu
  NEVYUŽITÉ AKCE přepíná tentýž stav.
- v3.7.2 – úhybný manévr proletí i asteroidem a kometou bez srážky (vlnka + řádek v logu); loď ale nesmí
  v tělese skončit – konec dráhy v asteroidu nebo v kometě = normální srážka s dvojitým zraněním.
- v3.7.1 – oprava: server zahazoval kometu jako cíl laserů/kulometu (střelba na kometu neproběhla). V panelu
  laserů se u komety/trosek zobrazuje „v dosahu“ nebo důvod, proč loď nevystřelí (mimo dostřel, mimo výseč,
  asteroid v cestě, bouře).
- v3.7 – **Komety**: nastavení mapy „Komety“ (žádné / málo / středně / hodně – šance za kolo a limit v ladění)
  a „Komety naráží do asteroidů“. Kometa přiletí na začátku kola na okraj mapy a letí přímo na protější
  okraj (rychlost 300/kolo, torpédo 240), pohybuje se s loděmi; při plánování je vidět předpověď dráhy.
  Náraz do lodi = zranění (štít normálně, v bouři ne) + odmrštění a zpomalení; kometa zmizí. Lasery i
  kulomet ji sestřelí (klik na kometu = cíl), torpédo i mina ji zničí; za sestřel kredity + statistika.
  **Ocas komety** (tyrkysová zóna za jádrem): průlet doplní štít – celolodní +25 % maxima, segmentový +1
  bod náhodnému neplnému segmentu; při plném štítu +10 % trupu; při plném trupu kredity; loď bez štítového
  modulu dostane plný stres + víc kreditů. Každá loď může každou kometu využít jen jednou (srážka s jádrem
  bonus ruší). Nová skupina ladění „Komety“.
- v3.6.1 – interní přejmenování: balíčky `@wingfighter/*`, kořenový balíček `wingfighter`, klíče v
  localStorage (`wingfighter.name`, `wingfighter.session` – jméno pilota se zadá znovu).
- v3.6 – hra se jmenuje **Wingfighter**. Nové pixel art logo na hlavní obrazovce (dvoubarevný nápis s 3D
  stínem, lasery a stíhač); při načtení stránky stíhač přiletí zleva, nápis se za ním odkrývá a lasery
  vystřelí, pak je logo statické (`packages/client/src/logo.ts`). Přejmenován titulek stránky, výpis
  serveru a startovací skript.
- v3.5.1 – pozorovatel: po zničení všech svých lodí hráč vidí celou mapu (bez mlhy) a sleduje zbytek bitvy;
  v liště má panel POZOROVATEL s tlačítky Tabulka skóre a Opustit hru. Opuštění hry (i z menu) se potvrzuje
  dialogem (upozorní, že opouštíš i navazující bitvy v místnosti). Tabulka skóre kdykoliv přes Tab,
  tlačítko SKÓRE nahoře vedle INVENTÁŘE nebo z menu (stejná tabulka jako na konci hry).
- v3.5 – nová spodní lišta: panel MANÉVR je svislý sloupec mezi portrétem pilota a tlačítkem SPUSTIT KOLO
  (NAKRESLIT dole + nápověda MEZERNÍK), portrét pilota na výšku se jménem dole, SPUSTIT KOLO jen s ikonou a
  nápovědou ENTER. Stav hráčů (odesláno ✔ / plánuje ⌛ / odpojen šedě, barvy týmů, během přehrávání
  „přehrává se“) je ve svislém panelu vpravo na mapě. Při spuštění kola s nevyužitými akcemi se hra zeptá
  na potvrzení (Enter / Esc, volba „příště se neptat“ pro zbytek bitvy).
- v3.4.1 – loď v bouři je normálně vidět (bouře ruší jen skener a lasery, ne dohled); po kole se kamera na loď
  jen přesune, zoom zůstává.
- v3.4 – zoom: tlačítka + / − / CENTROVAT nahoře uprostřed mapy (krok 10 %, stejně kolečko; klávesy +, −, C).
  Centrování nastaví zoom tak, aby byl v okně celý kruh dohledu lodi (kreslí se slabou čárkovanou čarou), druhý
  stisk = celá mapa; stejné centrování při startu bitvy a když loď po kole zmizí ze záběru. Loď u okraje jde
  vycentrovat (kamera smí vyjet až půl okna za mapu). Inventář/ladění/menu přesunuty vpravo nad log.
- v3.3.1 – kulomet je v editoru a obchodě červený jako ostatní zbraně.
- v3.3 – zbraňový modul **Kulomet** (120 cr, váha 1 + 0,02/náboj, 100 nábojů): na začátku kola dávka 10 projektilů
  s rozptylem, každý 3 zranění, šance zásahu 70 % zblízka → 35 % na hranici dosahu 150, výseč ±45°, otočný (ne do
  středu). Míří na preferovaný cíl (loď, torpédo, trosky) nebo nejbližší loď ve výseči; úhyb cíle šanci snižuje.
  Celolodní štít řeší každý projektil zvlášť, segmentový pohltí celou dávku za 1 bod. Funguje i v bouři. Ladění →
  Kulomet. V liště šance zásahu a průměrné zranění, na mapě stopy projektilů; sloupec v žebříčku.
- v3.2 – loď v bouři: štít na mapě zmizí (jen fialový tečkovaný obrys), bublina štítu v panelu zešedne a probliká
  fialově s nápisem „ŠTÍT VYPNUT ⚡“, řádek štítu přeškrtnutý; tlačítka LASERY, ŠTÍT a SKENER fialově šrafovaná
  s bleskem a vypnutá; pod akcemi shrnutí, co v bouři nefunguje.
- v3.1.2 – oprava: místnost při každé změně (start, výbava, ladění) skákala nahoru – posun stránky se zachová.
- v3.1.1 – nákupní seznam modulů také jako hexagony s ikonou, názvem, cenou a počtem (barva kategorie).
- v3.1 – editor výbavy: **hexagonové moduly** v plástvi na větší lodi, plné názvy, barva podle kategorie (zbraně
  červeně, speciální moduly modře); šipky natočení na všech povolených hranách (šedé = možnosti, žlutá = zvolená,
  klik přepne); modul „Minový zásobník“ přejmenován na „Miny“.
- v3.0 – **generované mapy a elektromagnetické bouře**. V místnosti karta Mapa: velikost (2400×1600 až 6400×4000),
  hustota asteroidů, shluky, počet a velikost bouří, symetrie, seed (🎲); náhled mapy se startovními body po okraji –
  klik = zvolit start (barva týmu + jméno, ostatní to vidí; host nastavuje i botům). Bouře (fialová mlhovina, blesky):
  uvnitř nefungují štíty (zásah jde do trupu) ani lasery (ani zvenku na loď v bouři, paprsek se o bouři zastaví),
  torpédo po vletu ohluchne a letí rovně, skener bouří neprojde.
- v2.4.1 – po kliknutí na SKENER se na mapě tyrkysově ukáže dosah skenu lodi (vyplněný kruh) a hlubokého skenu.
- v2.4 – **žebříček** po skončení bitvy (a kdykoli z Esc menu → Statistiky): sestřely, poškození uděleno/utrženo,
  vydělané kredity, manévry (zelený/bílý/červený/nebezpečný · otočky), lasery zásahy/salvy, torpéda, miny, skeny.
- v2.3 – modul **Skener** (malý, 130 cr, váha 1, bez natočení, nebere akci): 2 náboje, +1 za zelený manévr. Sken lodi
  (1 náboj, cíl v dohledu do 600) hned ukáže výbavu, natočení, munici a pilota cizí lodi (okno + řádek v logu).
  Hluboký sken (2 náboje, dosah 2000) hned odkryje mapu týmu do konce kola, pak cooldown 3 kola; po cooldownu
  plné náboje. Vynucený cooldown (jen bez plné zásoby) = cooldown − náboje. Tlačítko SKENER s náboji (žlutá) /
  cooldownem (červená), po kliknutí vyjedou tlačítka SKEN LODI · SKEN VESMÍRU · VYNUTIT COOLDOWN. Ladění → Skener.
- v2.2.2 – editor výbavy: šipka natočení sedí na hraně modulu ve směru, kam míří; modul se odebírá křížkem
  v pravém dolním rohu (klik na modul už nic nedělá).
- v2.2.1 – herní menu na Esc (nebo tlačítko MENU nad mapou): Pokračovat, Ukončit bitvu – do místnosti (host, pro
  všechny), Opustit hru – hlavní menu. Esc nejdřív ruší rozdělanou akci, prázdný Esc otevře menu.
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
  moduly Lasery, Torpédomet (3 ks), Miny (2 ks), Segmentový štít, Celolodní štít – každý má cenu a váhu,
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
