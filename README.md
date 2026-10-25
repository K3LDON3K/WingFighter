# Wingfighter – tahová vesmírná střílečka

(Dříve SpaceGame. Balíčky se jmenují `@wingfighter/shared`, `@wingfighter/server`, `@wingfighter/client`.)

2D tahová multiplayerová hra v prohlížeči. Inspirace: desková hra X-Wing (ciferník manévrů,
skryté simultánní plánování, kostky) a Space Rangers (vzhled, později inventář lodí).

## Rychlý start (Mac)

1. Nainstaluj **Node.js** (verze 20 nebo novější) z <https://nodejs.org> – stačí jednou.
2. Poklepej na **`Spustit server.command`** (poprvé se stáhnou knihovny a sestaví klient, chvíli to trvá).
3. V okně Terminálu se objeví adresy. Otevři v prohlížeči `http://localhost:3000`.
4. Ostatní hráči na stejné síti otevřou adresu **„V síti“** (např. `http://192.168.1.23:3000`).
5. Okno Terminálu pak přijímá příkazy: **`r`** = restart (znovu sestaví klienta a spustí server – po stažení nové
   verze z GitHubu), `i` = `npm install` + restart, `p` = `git pull` + restart, `s` = stav, `h` = nápověda,
   **`q`** = ukončit (jde i `Ctrl+C` nebo zavřít okno).

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
Manévr = **rychlost 1–5** + **změna kurzu** (po 10°, max ±90°; rychlost 4 max ±60°, rychlost 5 max ±40°)
nebo **otočka o 180°** (rychlost 3–4). Nastavuje se jen myší: **klik na vlastní loď** zapne kreslení dráhy
(směr podle polohy myši, rychlost podle vzdálenosti; kolečko nebo klávesy 1–5 rychlost zamknou, K = otočka),
**další klik potvrdí** a loď se pustí. Kolem lodi jsou tečky dosažitelných pozic obarvené podle náročnosti.
Bez označení loď poletí tak, jak má nakresleno (výchozí = stejná rychlost rovně).

**Stresové body** (3 na loď, vidí je všichni): bílý manévr nic, **zelený** (mírný) vrátí 1 bod,
**oranžový** (ostrý úhel ≥70°, při rychlosti 4+ už ≥40°, *nebo* změna rychlosti o 2+) stojí 1 bod,
**nebezpečný – červený** (změna rychlosti o 2+ *a* ostrý úhel) stojí 2 body a 5 % trupu. Bez bodů manévr nejde vybrat.
Akce po pohybu zůstává vždy povolená.

Lodě nikdy nestojí: při srážce s lodí nebo okrajem mapy je loď **odmrštěna** novým (náhodně
odchýleným) směrem, dostane 15 zranění, ztratí akci a doletí zbytek pohybu tím směrem.
**Náraz do asteroidu** (nebo komety do lodi) je tvrdší: loď vykousne do asteroidu díru (velikost podle lodi,
min. poloměr v ladění), otočí se **zcela náhodným směrem**, po kole má **rychlost 1** a **nulový stres**
(náraz ji „probere“); zranění 15 zůstává.

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
posílá jen to, co jeho tým vidí – cizí lodě, torpéda, miny, trosky, komety (jádro nebo kus ocasu v dohledu)
i bouře (aspoň část mraku v dohledu), vše přesně po hranici dohledu, bez okraje. Asteroid, který tým jednou
spatřil, zůstává v jeho paměti v podobě, v jaké ho naposledy viděl – poškození mimo dohled se neprojeví, dokud
ho zase neuvidí. Hluboký sken odkryje mapu do 2000 jen do konce kola.

### Výbava lodi (inventář)
Loď **Stíhač** má 4 malé sloty: příď, záď, levobok, pravobok. Příď a záď jsou pod sebou a lze je spojit v jeden
**velký** slot pro budoucí velké moduly. Moduly:
**Lasery** (100 cr, váha 2), **Kulomet** (120, váha 1 + 0,02/náboj, 100 nábojů; dávka 10 × 3 zranění, dosah 150,
výseč ±45°, šance zásahu podle vzdálenosti, funguje v bouři), **Torpédomet** (150, váha 1 + 1 za torpédo, 3 ks), **Miny** (100, váha 1 +
0,5 za minu, 2 ks), **Segmentový štít** (120, váha 2), **Energetický štít** (120, váha 2). Součet váhy snižuje
max. rychlost: každých 6 váhy = −1 (výchozí sestava má váhu 10 → rychlost max. 4, prázdná loď 5). Vystřelená
munice loď odlehčí. Loď smí letět i bez modulů. Více modulů stejného typu = víc munice; při střelbě si vybereš,
ze kterého modulu střílíš (jeden za akci). **Natočení:** lasery, torpédomet a miny míří na jednu ze 4 stran
(kamkoli kromě „do středu“ svého slotu; miny ne dopředu) – lasery pak střílí jen v té výseči (dopředu ±20°, do
boku ±15°, dozadu ±10°), miny se odhazují na tu stranu a torpédo tím směrem vylétá. Natáčí se jen v místnosti
(klik na šipku modulu). **Skener** (130 cr, váha 1): 2 náboje; sken lodi (1 náboj, do 600, cíl v dohledu) hned
ukáže výbavu cizí lodi; hluboký sken (2 náboje) hned odkryje mapu do 2000 celému týmu do konce kola a spustí cooldown
3 kola (po něm plné náboje); zelený manévr dobíjí +1; cooldown jde vynutit (délka = 3 − náboje). Nebere akci.
**Manévry botů** (3 body technologie): hráči (jen jemu, ne spoluhráčům) ukáže naplánované manévry nepřátelských
botů v dohledu jeho týmu – čárkovaná dráha v barvě nepřítele a průsvitný duch s nápisem SKEN – v tomto a příštím
kole; lidské protihráče neodhalí. **Pasivně:** předpověď dráhy komet v kole vidí jen hráč, jehož vlastní loď má
funkční skener. **Droid – opravář** (140 cr, váha 0,5, 15 HP): čerpá technologii, nebere akci, úkony se provedou
hned při plánování (libovolný počet, i víc opravářů na lodi). Oprava modulu (4): plně opraví vybraný modul, i
zničený. Munice (2): vyrobí 1 náboj do torpédometu nebo min (jen do plného zásobníku). Oprava trupu (3): +25 %
maxima trupu (ladění → „Opravář – oprava trupu“), ne přes maximum. Instalace (1): nasadí modul z nákladu do
libovolného slotu; stojí-li tam modul, vymění se a jde do nákladu. V bouři nefunguje. Boti ho používají (zničený
modul, slabý trup, prázdná munice).
Pilot: zatím jen **Kadet** (bez schopností).

**Nákup:** v místnosti má každý rozpočet (ladění → Ekonomika, výchozí 500) a kupuje moduly; host může omezit
počet kusů každého modulu na hráče a zvolit výbavu botů (výchozí / náhodná / ruční naklikání). Co hráč neutratí,
má ve hře jako **kredity**; další dostane za sestřel (200) a za každé přežité kolo (10). Akce **Vyhodit modul**
(1 akce) modul na začátku kola odhodí – loď je lehčí, modul zůstane jako trosky, které jde sestřelit lasery
(klik na trosky = cíl) za polovinu ceny. Nákupy mezi koly a vylepšení modulů přijdou později.

### Životy a štíty
Trup 100. Jeden čistý zásah laseru = 15. Štít je modul (segmentový, nebo energetický – nelze kombinovat).
Zbraně jsou dvojího druhu: **energetické** (lasery) a **projektilové** (torpédo, mina, kulomet; stejně se
chovají i srážky a komety) – a každý štít má proti jednomu druhu slabinu:
- **Segmentový (kinetický)** (výchozí) – čtyři poletující segmenty (předek, pravobok, záď, levobok) po
  **2 bodech**. Zásah trefí segment podle směru, odkud přišel, a ubere **1 bod**. **Projektil** segment zachytí
  celý (dávka kulometu = jeden zásah); **laser** je přesnější a mezi segmenty pronikne: 1 bod pryč a **60 %**
  zranění jde do trupu. Segment na nule už nechrání. Akce **Úprava štítu** (1 akce) body přesune
  (stejný součet, max. 3 na segment).
- **Energetický** – zásoba 80 kolem celé lodi, každé kolo +5. **Laser** pole jen vybíjí – do trupu nejde nic,
  dokud zásoba stačí. **Projektil** pole prorazí: **30 %** zranění jde do trupu vždy, zbytek odnese zásoba.
- **Dobití technologií** – akce „Dobít štít“ ve skupině Speciální: 3 body technologie (nebere akci, 1× za kolo,
  ne v bouři), provede se hned při plánování. Energetický +40 zásoby, segmentový +2 body do segmentů, které si
  hráč zvolí. Technologie (6 bodů na bitvu) se tak dělí mezi skener, droida a štít.
Všechna procenta a hodnoty jsou v menu ladění (sekce Štíty). V liště je loď s pixelovou bublinou štítu
(barva podle síly); na mapě má energetický štít kruh obarvený podle síly, segmentový čtyři oblouky otáčející
se s lodí.

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
- v3.142 – **Mlha války přesně po hranici dohledu.** Cizí lodě se už neposílají 160 jednotek před hranicí (nevplouvají, objeví se až v dohledu – i jejich jmenovky), komety jen když je v dohledu jádro nebo kus ocasu, bouře jen když je v dohledu aspoň část mraku; torpéda, miny a trosky byly jen v dohledu už dřív. Paměť asteroidů zůstává.
- v3.141 – Komety mají náhodnou rychlost: každá nová kometa dostane 80–120 % základní rychlosti (zaokrouhleno na 10); rozptyl je v ladění → Komety „Rozptyl rychlosti (± %)“. Bublina komety na mapě ukazuje její skutečnou rychlost.
- v3.140 – Bitevník má **10 bodů technologie** (stíhač dál 6 ze sekce Skener); nový parametr ladění → Loď „Bitevník – body technologie“. Popis trupu doplněn.
- v3.139 – **Ocas komety: los.** Průlet ocasem už nedává technologii a štít zároveň – náhodně (výchozí 50 %, ladění → Komety „šance na technologii“) buď +2 body technologie, nebo část štítu jako dřív (plný štít → trup → kredity; bez štítového modulu reset stresu + kredity). Když vylosované není kam dát (plná technologie / plný štít), dostaneš to druhé. Nápověda v bublině komety a v panelu technologie.
- v3.138 – **Skener: manévry botů** (3 body technologie): hráči ukáže naplánované manévry nepřátelských botů v dohledu týmu na toto a příští kolo (čárkovaná dráha v barvě nepřítele, tečky po dílech rychlosti, průsvitný duch s nápisem SKEN); vidí jen skenující hráč, lidské protihráče neodhalí, nebere akci. Třetí tlačítko v okénku skeneru (MANÉVRY; po zaplacení „běží“). **Dráha komet** v kole se už nekreslí všem – jen hráči, jehož vlastní loď má funkční skener (pasivní funkce skeneru). Log hlásí předpověď.
- v3.137 – **Nový modul Droid – opravář** (140 cr, váha 0,5, 15 HP, kategorie Droidi): úkony za technologii, hned při plánování, bez omezení počtu, nebere akci, v bouři nefunguje; loď může mít víc opravářů. Oprava modulu (4 body) plně opraví i zničený modul; munice (2) vyrobí 1 náboj do torpédometu/min (do plného zásobníku); oprava trupu (3) +25 % maxima (nový parametr ladění „Opravář – oprava trupu (% maxima)“); instalace (1) nasadí modul z nákladu do libovolného slotu (obsazený se vymění a jde do nákladu). Dlaždice OPRAVÁŘ s okénkem: záložky MODUL / MUNICE / TRUP / NASADIT se seznamem cílů (poškozené moduly s HP, zásobníky, náhled trupu, moduly v nákladu → sloty lodi). Boti opraváře používají (zničený modul, trup pod 50 %, prázdná munice). Log hlásí úkony.
- v3.136 – **Náraz do asteroidu / kometa do lodi:** loď vykousne do asteroidu díru v místě dotyku (poloměr = větší z „Díra po nárazu lodi“ v ladění a poloměru lodi – bitevník dělá větší díru), otočí se do zcela náhodného směru (ne jen odmrštění od asteroidu), po kole má rychlost 1 a všechny stresové body jsou odebrány. Totéž (rychlost 1, nulový stres, náhodný směr) při nárazu komety do lodi. Zranění 15 zůstává.
- v3.135 – Pásmo dostřelu laserů podle zasažené plochy: nejbližší pásmo, ve kterém leží aspoň pětina trupu ve výseči (dřív podle středu cíle) – u bitevníku s přídí zblízka platí bonus +1 kostka; vzorkování trupu je úměrné ploše. Kulomet počítá šanci z průměrné vzdálenosti zasažené části. Náhled střelby ukazuje pásmo („pásmo 1 · +1 kostka“). Bitevník: lasery mají do všech směrů stejnou výseč ±20°. Duch taženého modulu je nad celou stránkou (nezmizí pod obchodem).
- v3.134 – Startovní rozestupy lodí podle velikosti: sousední lodě ve formaci dělí součet jejich poloměrů + 36 (stíhač–stíhač 68, bitevník–stíhač 110), takže se bitevník se stíhačem nepřekrývají.
- v3.133 – Tažení v editoru výbavy: modul tažený do obchodu zčervená obchod s bannerem „PRODAT MODUL · +cena“, modul tažený z obchodu zezelená nákres lodi s bannerem „KOUPIT · −cena · pusť na volný slot“; při tažení se už neoznačuje text.
- v3.132 – Letka: lodní body jsou strop, ne povinnost. Hráč začíná s jednou lodí; u záložek letky je „+ Stíhač“ / „+ Bitevník“ (jen trupy, které se vejdou do zbývajících bodů) a ✕ u lodi (moduly se prodají). Bitvu jde zahájit i s nevyužitými body. Boti body využijí celé a při ≥ 2 bodech mají 50% šanci na bitevník (náhodná výbava). Zakladatel může letku ručně vybaveného bota skládat stejně.
- v3.131 – Bitevník: obratnější (úhly 90/90/80/60° podle rychlosti 1–4) a dostřel všech zbraní o 25 % delší (lasery 375, kulomet 188, torpédo zaměření 400 / bod 1500) – platí pro střelbu, náhled výsečí, kruhy dosahu, vysvětlivky i boty.
- v3.130 – Štít bitevníku se na mapě kreslí jako elipsa protažená ve směru letu (energetický i segmentový, včetně záblesků zásahu); stíhač má dál kruh.
- v3.129 – Záložky lodí letky na horní hraně panelu lodi jsou kompaktní (ikonka trupu + číslo, pilot ve vysvětlivce) a nelámou se; při více lodích přesahují doprava přes lištu.
- v3.128 – Editor výbavy: přetažení nainstalovaného modulu do obchodu = prodat (odebrat); přetažení modulu z obchodu do volného slotu = koupit rovnou tam (volné sloty se při tažení nabídnou). Dlaždice výběru lodi (nastavení hry i editor) ukazují pixelovou miniaturu trupu místo společné ikonky.
- v3.127 – Editor výbavy: nainstalované moduly jde **přetáhnout** myší/prstem do jiného slotu (volný = přesun, obsazený = prohození; velký modul do volné dvojice), natočení se při přesunu zachová, nebo se upraví na povolené. Přetažením na záložku jiné lodi letky se modul přesune tam (do prvního volného slotu) bez prodeje a nákupu – zůstává munice i životy. Během tažení se nezobrazují vysvětlivky.
- v3.126 – Bitevník: boční sloty přejmenovány na přední/zadní levobok a přední/zadní pravobok a v nákresu posunuty do plástve vedle přídě a zádi; velký modul jde na bitevníku spojit z přídě + zádi, předního + zadního levoboku i předního + zadního pravoboku (na stíhači jen příď + záď). Dlouhé názvy slotů se v hexu lámou na dva řádky.
- v3.125 – Nový trup **Bitevník** (2 lodní body): asi 3× větší než stíhač, trup 200, obratnost 2, náklad 2, šest slotů (příď, záď, levobok, pravobok, levá a pravá gondola), max. rychlost 4 (úhly 90/80/60/40°), otočka jen z rychlosti 2–3; vlastní sprite (křižníkový trup s věžovou nástavbou a gondolami), kolizní model, pozice modulů a nákres v editoru výbavy. Zásah z boku poškozuje i modul v gondole. Výběr trupu v editoru: větší trup vytlačí prázdné lodě letky, moduly se při změně trupu přesunou do volných slotů. **Stíhač má nový vzhled podle týmu**: modří šípová křídla s motory na koncích, zelení delta interceptor, červení původní tvar, další týmy dvoumotorový s kachními plochami; šablony 24×20 px s detaily (kabina, spáry, hlavně). Ladění → Loď: trup, obratnost a **max. rychlost** stíhače i bitevníku.
- v3.124 – Panel Manévr má otazník: otevře nápovědu s pravidly dráhy, rychlostí (včetně aktuálního maxima lodi), úhlů, barev náročnosti, stresu a akcí.
- v3.123 – Manévry: krok kurzu 10° (dřív 15°; limity úhlu 90/90/90/60/40° podle rychlosti, ostrý úhel od 70°, při rychlosti 4+ od 40°, zelený do 40°). Barvy náročnosti vyměněny: prudký manévr se stresem je **oranžový**, nebezpečný (stres + zranění) **červený** – v tečkách kolem lodi, v panelu i ve statistikách.
- v3.122 – Jedno tlačítko ŠTÍT místo dvou: okénko má záložky PŘESUNOUT (1 akce, −/+ jako dosud, dole ↺ reset) a DOBÍT (3 technologie – žluté + u segmentů, potvrzení druhým klikem na záložku DOBÍT n/2). Energetický štít má jen záložku DOBÍT s ukazatelem zásoby (modrá = teď, žlutá = co přibude). Okénko jde otevřít i bez volné akce (jen dobití); klik na hotový ŠTÍT ho znovu otevře místo resetu.
- v3.121 – Štíty podle druhu zbraně: energetický (dřív celolodní) lasery jen vybíjejí, projektily (torpédo, mina, kulomet, srážky, komety) prorazí 30 % do trupu; segmentový (kinetický) projektil zachytí celý za 1 bod, laser ubere 1 bod a 60 % pronikne do trupu. Nová akce „Dobít štít“ za 3 body technologie (nebere akci, 1× za kolo, hned): energetický +40, segmentový +2 body do zvolených segmentů. Vše laditelné v sekci Štíty. Log hlásí průraz/průnik. Boti (Pilot, Eso) volí zbraň podle štítu cíle a dobíjejí štít, když je slabý. Popisy modulů a karta v obchodě doplněny.
- v3.120 – Obchod: kulomet ukazuje munici jako „10× [zásobník] DÁVKA“ (zásobník = dávka 10 nábojů) místo pruhu s počtem nábojů.
- v3.119 – Boti: lodě stejného týmu se plánují postupně a znají dráhy spoluhráčů (i odeslané rozkazy lidí), takže si nelétají do cesty; bez nepřítele v dohledu hledají opatrně (pomalu, dál od okraje, bouří a spoluhráčů). Panel HRÁČI: týmy odděleně s hlavičkou v barvě týmu, sestřelený hráč má ☠ a přeškrtnuté jméno, bez legendy. Samostatná bitva (bez série): po konci se všem vrátí výbava, munice, životy modulů, náklad, pilot i kredity do stavu před bitvou; v sérii zůstává dosavadní chování. Obchod s moduly: kategorie Zbraně / Štíty / Droidi / Technologie s barvami (energetické zbraně oranžově se značkou ⚡, projektilové červeně se značkou náboje), v dlaždici cena s mincí, munice v modulu a dvoubarevná závaží (šedá modul, žlutá munice), po najetí/podržení karta s detaily; stejné barvy na schématu lodi i v inventáři.
- v3.118 – Herní obrazovka na telefonu/tabletu: rozložení lišty, HUD a panelů je vždy stejné jako na počítači, jen se celé zmenší podle šířky okna (do šířky 1280 px = 100 %, min. 50 %); dvousloupcová lišta zůstává jen pro telefon na výšku (pod 620 px).
- v3.117 – Pozadí mapy: nová volba „Bez pozadí“ (jen hvězdy) je výchozí; galaxie a planety si zakladatel zapne
  výběrem motivu nebo „náhodné“.
- v3.116 – Klik na nepřítele, na kterého zvolený laser nedosáhne, vypíše důvod s čísly (mimo dostřel 318 / 300,
  mimo výseč o X°, asteroid v cestě, bouře) a připomene, že laser vystřelí na nejbližšího ve výseči.
- v3.115 – Tři obtížnosti botů, volba u každého bota v jeho řádku (Kadet ★ / Pilot ★★ / Eso ★★★), štítek u jména.
  Boti nepodvádí – plánují ze stavu svého týmu s mlhou války (dřív viděli celou mapu). Kadet = dosavadní bot.
  Pilot: předvídá pohyb nepřátel, hodnotí pozici po manévru (můj útok − jejich hrozba, bezpečnost), střílí všemi
  zbraněmi na nejvýhodnější cíle, uhýbá při silné palbě, přerozděluje segmenty štítu k hrozbě, torpédo se
  zámkem, mina za záď; manévr za akci jen když stojí za víc než ztracená akce. Eso: navíc více odhadů manévru
  soupeře (průměr + nejhorší případ), pohled o kolo dál, otočka, torpédo na předvídaný bod, overdrive /
  autopilot droida, sběr ocasu komety při vybitém štítu, koncovka podle limitu kol. Headless turnaj (30 bitev na dvojici,
  stejná výbava): Pilot–Kadet 16:11, Eso–Pilot 14:8, Eso–Kadet 17:4.
- v3.114 – Víc zbraní stejného typu = jedna dlaždice s vyjížděcím podmenu (tlačítka 1↑, 2→ … jako u skeneru);
  na sbalené dlaždici čipy jednotlivých modulů (zelený střílí, šedý ne, bílý rám = zvolený), ✓ s počtem; částečně
  použitá zbraň má tlumenější modrou, plně použitá jasnou. Nová skupina LOĎ s tlačítkem NÁKLAD (vyhodit / zvednout)
  – dřív zmizelo, když loď neměla segmentový štít ani skener/droida. Verze klienta se čte při každém připojení
  (po přebudování klienta bez restartu se stránky obnoví správně).
- v3.113 – Střelba po modulech: každý laser a každý kulomet má v liště vlastní dlaždici (s natočením) a střílí za
  vlastní akci s vlastním cílem – dva lasery mohou mířit na dva nepřátele, nebo oba na jednoho (dvě samostatné
  salvy). Klik na dlaždici = střílet a zvolit modul (bílý rám), klik na nepřítele = cíl zvoleného modulu; ✓ = střílí.
  Zbraně střílí z pozice modulu na trupu (příď / boky / záď): odtud se měří dosah i výseč, odtud vychází paprsek,
  dávka kulometu i start torpéda. U cíle je značka zbraně s číslem modulu. Rozkaz nese seznam střel (modul + cíl);
  server hlídá jeden výstřel na modul a limit akcí. Bot využije zbylé akce na další lasery.
- v3.112 – Po restartu serveru s novou verzí se otevřené stránky se starým klientem samy obnoví (mimo rozehranou
  bitvu – tam jen upozorní). Řeší situaci, kdy hráč se starou stránkou neměl tlačítko PŘIPRAVEN a host nemohl
  spustit bitvu.
- v3.111 – Průvodce nastavením má pátý krok „Souhrn“ – výpis celé konfigurace (bitvy a mapy, pravidla, trupy,
  piloti, moduly). V posledním kroku už není DALŠÍ, místnost se otevírá tlačítkem OTEVŘÍT MÍSTNOST nahoře
  (počítadlo kroků je 5).
- v3.110 – Záložky v ladění čitelnější: vybraná je tmavě modrá se světlým textem a světlým rámem, ostatní šedé.
- v3.109 – Tlačítko LADĚNÍ je vlevo nahoře u ostatních tlačítek (jen v místnosti); ladění se otevírá jako překryvné
  okno přes celou šířku. Tlačítka v hlavičce ladění sjednocená (stejná výška, bez zalamování, velká písmena).
- v3.108 – Tlačítko OTEVŘÍT MÍSTNOST je zelené v hlavičce místnosti vedle OPUSTIT; vedle něj čtyři kroky nastavení
  (zeleně projité, modře aktuální) – host vidí, kolik kroků z průvodce už prošel. Tlačítko dole a v posledním
  kroku průvodce zmizelo.
- v3.107 – Hvězdy přesunuty z herní vrstvy do vzdáleného pozadí ve dvou hloubkách (matné daleké + jasnější bližší,
  posouvají se pomaleji než mapa). Na herní vrstvě zůstávají jen aktivní prvky, ovál mapy a mřížka. Při
  vypnutém vzdáleném pozadí zůstanou nehybné hvězdy jako dřív.
- v3.106 – Vzdálené pozadí utlumené na polovinu, aby nekonkurovalo lodím a dráhám.
- v3.105 – Náhled mapy v místnosti ukazuje i zvolené vzdálené pozadí (motiv, rozložení galaxií a planet).
- v3.104 – Vzdálené paralaxní pozadí: galaxie, mlhoviny a planety hluboko za mapou (pixel-art ze seedu mapy, posouvají
  se pomaleji než mapa, jen vizuální, kreslí se do statické mezipaměti – bez vlivu na výkon). Čtyři motivy
  (Spirální galaxie · Mlhovina · Planetární soustava · Hluboký vesmír) volí zakladatel v nastavení mapy, výchozí
  „náhodné“ podle seedu. Nové tlačítko NASTAVENÍ GRAFIKY v hlavním menu (rozlišení mapy, vzdálené pozadí
  zapnout/vypnout); stejné přepínače v herním menu a v hlavičce ladění.
- v3.103 – Sady výbavy: nad výbavou lodi tlačítka Prázdný · Útočník · Obránce · Taktik (rychlý start, pak jde vše
  upravit). Sada se plní v pořadí priorit podle kreditů – co se nevejde nebo je zakázané, vynechá; moduly stejného
  typu ponechá, ostatní prodá; nápověda ukáže, co koupí/prodá a kolik zůstane. Rozpočet na výbavu má minimum 100
  (nejlevnější zbraň); náhodná výbava bota obsahuje zbraň, když na ni je. Hráč s lodí beze zbraně musí při
  PŘIPRAVEN potvrdit, že letí beze zbraně (host se neptá); „⚠ bez zbraně“ vidí jen spoluhráči v týmu (v
  deathmatchi nikdo).
- v3.102 – Výchozí umístění na mapě je náhodné a výchozí výbava botů náhodná (obojí jde v nastavení změnit).
- v3.101 – Balanc celolodního štítu (varianta C): zásoba 50 → 80, dobíjení +5 za kolo (dřív 0), účinnost už
  neklesá (pokles 0 %; v ladění jde vrátit – pak se opět ukazuje prstenec účinnosti). Cena a váha beze změny.
- v3.100 – Místnost: hráči potvrzují připravenost tlačítkem PŘIPRAVEN (jde vzít zpět a upravit výbavu; každá
  vlastní změna výbavy, týmu nebo startu ji ruší, stejně jako změna nastavení hostem a návrat z bitvy). Host může
  bitvu spustit, až jsou připraveni všichni; ve stavu hráče je „⌛ ještě upravuje“ / „✓ připraven“.
- v3.99 – Oprava segmentového štítu: nové rozdělení segmentů se během přehrávání kola už nevrací na starý
  stav (přerozdělení platí od začátku kola, animace ho teď přebírá hned). Úprava štítu už se v animaci nehlásí
  chybně jako „úskok“.
- v3.98 – Ocas komety se během přehrávání kola lehce kývá jako vlajka (plynule se rozjede i zastaví); při
  plánování stojí.
- v3.97 – Ladění parametrů (v místnosti i ve hře) je schované pod heslem – po odemknutí si ho prohlížeč pamatuje.
  Tlačítko ZAHÁJIT BITVU je zelené a přesunuté nahoru do hlavičky místnosti vedle OPUSTIT.
- v3.96 – Ocas komety: hladký obrys s malou sinusoidou (osa i krystaly sledují vlnu, fáze pro každou kometu jiná).
- v3.95 – Oprava zpomalování po delším hraní v jedné záložce: každá spuštěná bitva přidávala další posluchače myši
  a klávesnice na okno (a držela staré plátno v paměti); teď se s koncem bitvy odebírají. Kometa: nepravidelný
  ocas místo obdélníku (tvar je pro každou kometu jiný, bez animace), jádro se neotáčí, a při odletu z mapy letí
  dál přes okrajovou bouři – zmizí až za tvrdým okrajem.
- v3.94 – Rozlišení mapy i 25 %. Při kreslení dráhy, při animaci kola a chvíli po každém pohybu myši běží
  vykreslování plnou rychlostí (60 snímků/s), úsporných 30 jen v klidu – kreslení manévru je plynulejší.
- v3.93 – Výchozí rozlišení mapy je 50 % (jde přepnout v menu / ladění, volba se pamatuje); log událostí je ve
  výchozím stavu sbalený.
- v3.92 – Oprava grafických glitchů po v3.91 (mezipaměť statické vrstvy si držela ořez z minulého překreslení –
  násobené elipsy okraje a zbytky starého obrazu).
- v3.91 – Výkon pro velké mapy a hodně hráčů: za tvrdým okrajem se nekreslí nic (ořez), objekty mimo obraz se
  přeskakují, blesky bouří se kreslí jen hráči, jehož loď v bouři je. Lodě a komety se posílají už 160 jednotek
  za hranicí dohledu (v mlze ztlumené), takže do dohledu vplouvají a neobjeví se naráz. **Rozlišení mapy**
  (100 / 75 / 50 %) v menu hry i v ladění – jen pro tento počítač, ukládá se v prohlížeči.
- v3.90 – Výkon: okrajová bouře je jen tenká fialová hrana (za ní zraňuje) a tenká červená čára tvrdého okraje,
  bez výplně; při kreslení dráhy se místo celé lišty vyměňuje jen panel Manévr; ocas komety a jádro bez animace.
- v3.89 – **Výkon**: statické vrstvy mapy (hvězdy, mřížka, okrajová bouře, mraky bouří) se kreslí do mezipaměti
  a překreslují jen při pohybu kamery; mlha dohledu se přepočítává jen při změně kamery nebo dohledu; mimo
  animaci kola běží hra na ~30 snímků/s; postranní panel se při kreslení manévru překresluje nejvýš jednou za
  snímek. Za tvrdým okrajem se vesmír nekreslí (plná barva). Okénka Vyhodit / Zvednout jsou širší (460 px)
  s větším nákresem lodi. Loď bez funkčního štítu nemá na mapě žádný náznak štítu (po vyhození modulu štítu
  prstenec zmizí hned v animaci kola); v panelu lodi je místo bubliny „BEZ ŠTÍTU“.
- v3.88 – Ikonky velikosti mapy jsou ovály (podle tvaru mapy). Okrajová bouře se kreslí staticky – bez blesků,
  šumu a běžící animace tvrdého okraje (šetří výkon).
- v3.87 – **Oválná mapa a okrajová bouře.** Hrací plocha je ovál vepsaný do rozměru mapy (asteroidy, bouře
  i startovní body se generují uvnitř, starty rovnoměrně po obvodu). Kolem oválu je **pás okrajové bouře**
  (ladění → Mapa → šířka pásu, výchozí 450; 0 = vypnuto a loď se od hrany odráží jako dřív): platí v něm vše
  jako v bouři (bez štítů, laserů, skeneru, droida; torpédo ohluchne; loď není vidět) a navíc **zraňuje trup
  podle části kola strávené v pásu** (ladění → Mapa → zranění za celé kolo, výchozí 10; v logu „letěl okrajovou
  bouří“). Loď se už od hrany neodráží – letí dál do pásu; za ním je **tvrdý okraj** (červená čára, ovál
  o pás větší) a jeho dotyk loď okamžitě zničí. Bouře pokračuje i za tvrdý okraj. Komety přilétají přes pás
  z hrany oválu. Boti do pásu nelétají. Náhled mapy v místnosti ukazuje ovál, pás i tvrdý okraj.
- v3.86 – **Otočka 180° na konci křivky.** Otočka už nenutí rovný let: jde na konci jakéhokoli nakresleného
  manévru (rychlost 2–5, úhel podle profilu). Tlačítko OTOČKA je přepínač – zapni ho před kreslením (pak
  kreslíš s nejnižší rychlostí 2) nebo až po něm; duch lodi v cíli je otočený o 180° se žlutým odznakem ⟲.
  Stres: 1 na zelené/bílé křivce, 2 na červené, 3 na nebezpečné (ta navíc zraní trup jako dosud); cena se
  ukazuje na tlačítku i v panelu manévru („45° +180°“). Po otočce rychlost klesá jako dřív; otočka se každé
  kolo zapíná znovu. Id manévru s otočkou je `k{rychlost}a{úhel}`.
- v3.85 – **Animace remízy**: tři stíhače v barvách týmů 1–3 vletí zleva, zprava a shora po křivkách, vystřelí
  po sobě mimo, těsně se minou (bílé švihnutí s jiskrami) a odletí z obrazovky; pak se nad tabulkou zjasní bílý
  nápis REMÍZA. Hraje se všem při remíze bitvy i nerozhodné sérii (po poslední bitvě).
- v3.84 – **Animace prohry** pro poraženou stranu: hořící stíhač v barvě týmu padá shora do výsledkové tabulky,
  při dopadu vybuchne (záblesk, jiskry, trosky), z místa dopadu se dál kouří a nad tabulku vystoupá nápis
  PROHRA v tmavší barvě týmu. Výhra / prohra se určuje stejně jako u vítězné animace (série až po konci).
- v3.83 – **Vítězná animace**: po výhře (jedna bitva hned, série až po celkové výhře) vyletí zpoza výsledkové
  tabulky tři stíhače v barvě vítězného týmu s barevnými pruhy, nad tabulkou se odkryje pixelový nápis
  VÍTĚZSTVÍ (písmo UI, styl loga) a spustí se ohňostroj v týmových barvách. Hraje se jen hráčům vítězné
  strany; remíza bez animace. Tabulka je při animaci posunutá níž, aby se nápis vešel.
- v3.82 – Plánovaná úprava štítu se na mapě (prstenec segmentů kolem lodi) zobrazí hned po potvrzení, ne až po
  odehrání kola; v bitvě platí od začátku kola (před střelbou) jako dosud.
- v3.81 – Okénko modulu je širší (380 px), tlačítka DOPLNIT / OPRAVIT / PRODAT se vždy vejdou (kulomet 60/100).
- v3.80 – Šířka místnosti je pevná (1140 px, na menších obrazovkách 94 % šířky) a obsah ji už nikdy neroztáhne:
  5 bitev má stejnou šířku jako 2; záložky bitev se v úzkém sloupci zúží (bez podtextu), souhrn má kratší čipy
  (velikost mapy, „2 týmy“) a neořezává je.
- v3.79 – Záložka Bitvy má stálé rozměry: řádek záložek je vždy (u jedné bitvy záložka „Bitva · jediná“ s 🎲),
  text u počtu bitev je jednořádkový (pravidla bodování v nápovědě) – změna počtu bitev nic neposouvá.
- v3.78 – Záložka Bitvy: počet bitev jako ikonková tlačítka (tolik křížků, kolik bitev); bitvy série jako
  skutečné záložky nad panelem mapy (aktivní splývá s panelem, pod názvem stav ✓ výsledek / příští / velikost
  · seed, 🎲 v rohu = nová mapa té bitvy, „🎲 VŠECHNY“ pro neodehrané).
- v3.77 – **Série bitev.** Nastavení hry má první záložku **Bitvy**: počet bitev 1 (jedna bitva) nebo 2–5 (série).
  V sérii má každá bitva vlastní **mapu, limit kol a umístění na mapě** (dlaždice Bitva 1…N, klik = její
  nastavení s náhledem; 🎲 u seedu i „🎲 všechny“); mód, kredity, lodní body, lodě a moduly jsou společné
  (záložka *Pravidla*). Mezi bitvami se všichni vrátí do místnosti (nákupy, opravy, startovní body na další mapě),
  v hlavičce je panel série (příští bitva, pořadí, výsledky) a host dá ZAHÁJIT BITVU 2/3. **Vítěz série podle
  bodů**: výhra 3, remíza 1, prohra 0 (za tým; v deathmatchi za hráče), při rovnosti sestřely, pak zranění.
  Po poslední bitvě tabulka série a tlačítko NOVÁ SÉRIE (stejné nastavení, nové seedy, skóre od nuly). Změna
  počtu bitev začne sérii znovu. Závěrečné okno bitvy ukazuje i průběžné pořadí série.
- v3.76 – **Nákres lodi** v editoru výbavy ukazuje u modulu jen ikonu, název, jednu šipku zvoleného natočení,
  výplň podle životů (zelená → žlutá → oranžová → červená, zničený tmavě červený) a munici jako ikonky (žlutá =
  nabito; kulomet po dávkách 10 nábojů). **Klik na modul otevře okénko**: životy + OPRAVIT (zničený modul za
  % ceny – ladění → Moduly → „Oprava zničeného modulu“, výchozí 50 %; po opravě plné životy, zůstává použitý),
  munice + DOPLNIT (jen když není plná), natočení (jen povolené směry), váha a PRODAT / ODEBRAT. Zavře se
  křížkem, klikem vedle nebo Esc. **Souhrn nastavení hry** je samostatný řádek čipů s ikonami (mapa modře, bitva
  žlutě) s pevnou výškou – změna textu už neposouvá zbytek obrazovky.
- v3.75 – Nastavení → Bitva: Herní mód, Umístění na mapě a Výbava botů jsou ikonková tlačítka (jako ostatní řádky)
  místo rozbalovacích seznamů; najetí ukáže popis, vedle je text zvolené volby.
- v3.74 – Nastavení hry → Bitva → **Umístění na mapě**: *Náhodné* (každý náhodný startovní bod, mapa se před
  bitvou nevybírá), *Týmové náhodné* (tým náhodný bod, spoluhráči ve formaci vedle sebe, rozestup 60), *Ruční*
  (dosavadní výběr bodu na náhledu mapy) a *Týmové ruční* (velitel týmu ★ vybere bod, tým startuje ve formaci
  vedle něj). Velitel = první člověk v týmu; host nebo velitel ho může předat tlačítkem ★ v tabulce týmů (zvolený
  start přejde s velením); tým jen z botů velí první bot (start mu vybere host). V deathmatchi se týmové varianty
  chovají jako ne-týmové. Náhodné umístění je čistě náhodné (soupeři mohou startovat blízko sebe).
- v3.73 – `Spustit server.command` po spuštění přijímá příkazy: `r` restartuje server (včetně nového sestavení
  klienta) bez zavírání okna, `i` přeinstaluje závislosti, `p` stáhne změny z gitu, `s` stav, `q` konec.
- v3.72 – Roadmapa se **upravuje přímo ve hře**: tlačítko UPRAVIT → přidat položku, upravit (oblast, název, popis,
  horizont), označit jako hotovou (✓, přesune se do sbalené sekce *Hotovo* s datem) nebo smazat (✕, druhý klik
  potvrdí). Data jsou na serveru v souboru `roadmap.json` v kořeni projektu (HTTP API `GET/PUT /api/roadmap`), takže
  jdou upravovat i ručně v souboru; při prvním spuštění se soubor vytvoří s výchozím obsahem.
- v3.71 – Roadmapa naplněná skutečným plánem: sekce *Stále probíhá / Budeme vypracovávat / Střednědobý vývoj /
  Pozdější vývoj*, každá položka má štítek oblasti (nový droid, nový modul, nová loď, herní mód, prvky na mapě, UI).
- v3.70 – V hlavním menu tlačítko **ROADMAPA** – textový přehled toho, na čem se pracuje, co se plánuje a nápady
  (obsah v `packages/client/src/roadmap.ts`). Editor výbavy: vypínač štítu se zobrazí jen při **více než jednom**
  štítu a je nakreslený jako pixel‑art páčka uprostřed horní části hexu; křížek pro odebrání a tlačítko dobití
  munice jsou posunuté dovnitř hexagonu, aby nepřesahovaly.
- v3.69 – Editor výbavy: pruh váhy přes celou šířku sloupce; **loď a pilot jako jedna dlaždice** – klik otevře
  okénko se všemi možnostmi (každá s vysvětlivkou). **Více štítů**: jde nainstalovat segmentový i celolodní (i víc
  kusů), funguje vždy jen **zapnutý** – v hexu je vypínač ZAP/VYP; vypnout jde jen když je k dispozici jiný funkční
  štít (ten se zapne), jediný štít vypnout nejde; vypnutý = „ZÁLOHA“. Zničí-li se v bitvě zapnutý štít, záloha se
  automaticky zapne plná. Droid má v hexagonech fialovou barvu.
- v3.68 – Editor výbavy kompaktně (rozvržení B): vlevo loď a piloti pod sebou (malé dlaždice, piloti 2×2), uprostřed
  nákres s pruhem váhy, vpravo souhrn a obchod v mřížce; stejně i editor bota. Dlouhý text o pravidlech nákupu je
  nahrazen jednořádkovou nápovědou (pravidla po najetí).
- v3.67 – Editor výbavy: **váha modulů jako počet závaží** v hexagonech obchodu (půl závaží = 0,5); **pruh váhy a
  rychlosti** pod nákresem lodi (dílky podle výsledné max. rychlosti, žluté značky = prahy, text „váha X → max.
  rychlost Y“); **výběr slotu přímo v nákresu**: klik na volný slot (svítí „SEM ◆“) a pak na modul v obchodě, nebo
  klik na modul (žlutý) a pak na volný slot („+“ pulzuje). Esc / klik mimo editor výběr zruší; bez výběru jde modul
  do prvního volného slotu jako dřív.
- v3.66 – Úhybný manévr: loď v animaci přesně sleduje nakreslenou dráhu i rychlost (zrušeno vlnění do stran, zůstal
  jen sudový překrut a modrý obrys). Vyhodnocení na serveru dráhu i rychlost už dřív používalo beze změny.
- v3.65 – Okénka tlačítek (štít, droid, skener, náklad) se zavřou klikem vedle (na mapu), volbou jiné akce i při
  SPUSTIT KOLO; po novém kole nezůstává žádné tlačítko „zapnuté“. Zapnuté volby droida v plánu zůstávají.
- v3.64 – V panelu lodi zmizel popisek „štít vypnut / ⚡ bouře“ vpravo dole (byl oříznutý) – stav je vidět přímo
  v nákresu lodi; řádek celolodního štítu (% a účinnost) zůstává jen mimo bouři.
- v3.63 – Ukazatel rychlosti v panelu lodi hned ukazuje **plánovanou rychlost** nakresleného manévru (modře; ve
  vysvětlivce „Plán: rychlost X (teď Y)“); po vyhodnocení kola se zobrazí nová aktuální rychlost.
- v3.62 – **Vysvětlivky akcí přehledně** (varianta B): název s ikonou vlevo, cena pilulkami vpravo (akce · stres ·
  technologie, aktuální i s overdrivem), efekty jako krátké štítky s ikonkou (zelený rámeček = výhoda, červený =
  postih), drobná poznámka dole, případný důvod „Nelze: …“ červeně. Platí pro všechna tlačítka lišty akcí včetně
  okének (náklad, skener, droid). Pixel-art bubliny umí i strukturovaný obsah (`tipAttr` / `tipHtml`).
- v3.61 – Overdrive droida navíc: rychlost v tomto kole **ignoruje váhu** (plná max. rychlost trupu, blokované
  dílky ukazatele rychlosti zmizí); příští kolo limit zase platí.
- v3.60 – **Nový modul Droid – pilot** (kategorie Speciální, malý, váha 0,5, cena 140; Ladění → Droid). Čerpá
  technologii, nebere akci, zapíná se pro kolo a platí se až při SPUSTIT KOLO (rezervované body jsou v hlavičce
  obrysově, zrušit jde zdarma). **Overdrive** (3): v tomto kole manévry nestojí stres – červený i nebezpečný jsou
  „bílé“ (nebezpečný bez ztráty trupu), úhyb bez stresu, otočka jen za 1 akci; ceny na tlačítkách se hned přepočítají.
  **Autopilot** (2): zelený manévr vrátí +2 stresové body místo +1. V bouři droid nefunguje; zničený droid = šrafované
  tlačítko. Bez dostatku technologie server funkce vypne.
- v3.59 – Štít: tlačítko se při otevřeném okénku už neprotahuje; zavření okénka bez změny rozložení akci neutratí
  (akce stojí jen skutečná úprava – platí i pro klik vedle a pro SPUSTIT KOLO); štítek „plán“ u lodi vlevo odstraněn.
- v3.58 – **Zničená zbraň v liště akcí** (varianta B): když jsou všechny moduly dané zbraně zničené, je její tlačítko
  červeně šrafované s křížkem a nejde kliknout. U více modulů stejného typu je takto označené jen malé tlačítko
  zničeného modulu (1↑ / 2←) pod hlavním tlačítkem a nejde ho vybrat; hlavní tlačítko zůstává funkční.
- v3.57 – **Výzbroj kompaktně** (varianta E, panel 136 px): bez názvů a čísel – svislá „baterie“ životů modulu
  (5 segmentů po 20 %, zelená/žlutá/červená, zničený = tmavě červená), políčko s ikonkou zbraně (šipka = natočení,
  zničený = červené políčko) a munice ikonkami (plná = k dispozici, šedá = spotřebovaná; kulomet proužky, lasery ∞).
  Název, životy a munice slovy jsou ve vysvětlivce po najetí.
- v3.56 – Spodní lišta: panel lodi užší (trup a rychlost blíž k sobě), Výzbroj o něco užší, tlačítka akcí se při
  nedostatku místa mírně zúží – víc prostoru pro akce, na 1280 px se vejde všech 8 tlačítek.
- v3.55 – Při kreslení manévru ukazuje tlačítko Potvrdit cenu surovin bez fajfek (barevné čtverečky se mění podle
  dráhy); fajfky se objeví až po potvrzení manévru.
- v3.54 – Cena akce na tlačítku ve **všech surovinách**: červené čtverečky = akce, růžové = stres, žluté = technologie.
  Otočka 2 červené + 1 růžový, úhyb 1 + 1, manévr 1 + stres podle nakreslené dráhy (zelený manévr ukáže růžové „+“ –
  stres vrací), sken lodi / vesmíru žluté. Zaplacené čtverečky ztmavnou s fajfkou.
- v3.53 – **Suroviny v hlavičce panelu Akce** (varianta C): vedle sebe Akce (červené), Stres (růžové) a nová
  **Technologie** (žluté) – popisek nad pilulkami, text „2/2 volné“ a svislý ukazatel stresu zmizely. **Technologie**:
  6 bodů na loď na celou bitvu, nedobíjí se; čerpá je **skener** – sken lodi 1 bod, hluboký sken 2 body (náboje a
  cooldown skeneru zrušeny, tlačítko Cooldown pryč). Průlet ocasem komety přidá +2 technologie (do stropu). V bouři je
  technologie deaktivovaná (pilulky přeškrtnuté, popisek „⚡ bouře“, skener nefunguje). Ladění → Skener: body
  technologie na bitvu, ceny skenů; Komety: body za průlet ocasem.
- v3.52 – Značky cílů (závorky + ikonky zbraní) se kreslí až nad vším ostatním – nepřekrývá je loď ani štít.
- v3.51 – **Boti:** ze zničeného bota vypadne vždy právě jeden náhodný funkční modul (u hráčů dál platí šance na každý
  modul). **Fog of war:** cizí loď (i torpédo), která vletí do dohledu během kola, se teď animuje po celé své dráze
  od začátku kola – dřív se objevila až na konci pohybu. **Komety** se objevují 2 kola letu za okrajem mapy a teprve
  přilétají: za okrajem jsou jen vidět (jde na ně kliknout, ale „ještě není na mapě – nevystřelí“), nedá se na ně
  střílet, nenaráží do ničeho a nespouští miny; zmizí až když mapu opustí.
- v3.50 – **Značka cíle podle zbraně** (varianta D): cíl, na který míří zbraň, má místo žlutého kroužku čtyři rohové
  zaměřovací závorky v barvě zbraně a v pravém horním rohu plné čtverečky s ikonkami všech zbraní, které na něj
  míří (laser červená, kulomet žlutá, torpédo oranžová). Více zbraní na jeden cíl = ikonky vedle sebe, závorky
  žluté. Funguje pro lodě, trosky, komety i torpéda; kroužek zůstává pro najetí myší a cíl zvednutí nákladu.
- v3.49 – **Střelba na cíl částečně ve výseči.** Místo středu lodi se počítá podíl jejích kolizních kruhů uvnitř výseče
  a dostřelu (0–100 %). Jakmile je uvnitř aspoň kousek, cíl jde zaměřit a střelba proběhne; **šance na zásah se
  násobí podílem v dosahu** (lasery: každý zásah na kostkách projde jen s touto pravděpodobností; kulomet: šance
  projektilu × podíl). Úhyb obránce se nemění. U cíle se zobrazí výsledná šance a pod ní „N % v dosahu“, v panelu
  Lasery totéž; část lodi mimo výseč se v mapě ztlumí. Cíl úplně mimo zaměřit nejde.
- v3.48 – **Životy modulů v hexagonech** (varianta A): barevná výplň hexu ubývá odshora dolů podle zbývajících
  životů (plné = jako dřív, nad hladinou tmavý podklad a tenká linka), ve vysvětlivce modulu je „životy X/Y“.
  Platí v inventáři v bitvě, ve skenu i v obchodě. **Oprava:** manévr, na který nemáš stresové body (otočka, ostré
  zatáčky), už nejde vůbec vybrat – tlačítko Otočka je zašedlé s důvodem a při kreslení dráhy se neuloží.
- v3.47 – V otevřené místnosti je **náhled mapy přes celou šířku** panelu (značky a jména se škálují). Startovní bod:
  každý hráč volí jen sobě; host navíc botům – místo seznamu jsou **čipy** (já + boti s ikonkou): klik na bota, klik na
  kroužek v mapě, bot dostane **✓**. Po výběru se volba vrátí na „já“.
- v3.46 – **Místnost se otevírá až po nastavení**: nově vytvořená místnost je zavřená – zakladatel projde průvodce
  (Mapa · Bitva · Lodě a piloti · Moduly) a na konci dá **OTEVŘÍT MÍSTNOST** (i tlačítko dole). Do té doby ji ostatní
  v seznamu vidí s poznámkou „zakladatel dokončuje nastavení…“ a připojení (i kódem) server odmítne. Po otevření se
  zobrazí tabulka Hráči a týmy a Tvoje výbava (i pro zakladatele – lodě se vybírají podle hotového nastavení);
  nastavení je jen souhrn + náhled mapy se startovním bodem, host se může vrátit tlačítkem UPRAVIT (místnost se
  pro nové hráče zase zavře). Bitvu jde zahájit jen v otevřené místnosti.
- v3.45 – **Hráči a týmy jako přehledná tabulka**: jeden panel, pruh týmu (jméno · N hráčů · N lodí · N bodů,
  PŘEJÍT SEM, + BOT), pod ním řádky hráčů (jméno, HOST / BOT, letka jako čipy s portrétem pilota a ikonkami
  modulů – najetí ukáže celou výbavu, stav ✓ připraven / ⚠ chyba letky / odpojen, tlačítka ⇄ přesun do dalšího
  týmu (host kohokoli, hráč sebe), ⚙ ruční výbava bota, ✕ odebrat bota). V hlavičce souhrn, výběr výbavy botů,
  **+ TÝM / − TÝM (2–4 týmy)**, **VYROVNAT** (rozdělí podle lodních bodů) a **ZAMÍCHAT**. Deathmatch = stejná tabulka
  bez týmových pruhů. **Portréty pilotů** předělány na 32 × 32 „doomguy“ styl: zblízka, těžké stínování, zamračený
  výraz, každý pilot má vlastní variantu (vlasy, pleť, doplňky), editovaní piloti dostanou vlastní barvu vlasů.
- v3.44 – Nastavení hry jako **průvodce po stránkách** (1 Mapa · 2 Bitva · 3 Lodě a piloti · 4 Moduly; kroky
  nahoře, Zpět / Další, souhrn hry v hlavičce). Dostupné moduly jako **hexagony** v barvách obchodu (VE HŘE /
  VYŘAZEN). Dostupné lodě a piloti rozděleny do dvou sekcí; piloti s podobiznami. **Portréty pilotů** nově
  24 × 24 ve stylu stavové lišty (hrubé stínování, tvář zpředu): Kadet, Eso (sluchátka, červená uniforma),
  Střelec (zrzavý, páska přes oko), Kapitán (šedivý, knír, čepice); editovaní piloti dostanou variantu Kadeta.
- v3.43 – výběr lodi a pilota z dlaždic místo seznamů: pilot = pixelová podobizna (Kadet, Eso, Střelec, Kapitán;
  editovaní piloti dostanou podobiznu s barvou podle id), jméno a malá infografika schopností (ikona + hodnota,
  zelená plus / červená minus); vybraný svítí, ostatní ztlumené, pilot použitý v jiné lodi letky je zašedlý.
  Loď = ikona, název, lodní body. Podrobnosti ve vysvětlivce po najetí / podržení. Nastavení bitvy: řádek
  „Limit kol“ odstraněn (hra je vždy bez limitu), místo něj **Startovní kredity** (číslo + rychlé volby
  300 / 500 / 800 / 1200; totéž co ladění → Ekonomika).
- v3.42 – letka a piloti. **Lodní body na hráče** (1–3) místo „lodí na hráče“: každý trup stojí body (stíhač 1),
  hráč je musí využít přesně; všechny lodě hráče mají jednu peněženku. „Tvoje výbava“ má záložky LOĎ 1/2/3
  (trup, pilot, moduly, náklad zvlášť); výběr trupu a pilota je odemčený. Zakladatel volí **dostupné lodě
  a piloty** dlaždicemi (Kadet vždy). Noví piloti **Eso** (+1 obrana / −1 max. stres), **Střelec** (+1 útok /
  −1 max. rychlost), **Kapitán** (+1 max. stres / −1 útok); piloti se schopnostmi jsou v letce unikátní, Kadet
  se opakuje; pilot zničené lodi zahyne a příští bitvu nastoupí Kadet. **Editor pilotů** v Ladění → Piloti
  (jméno, popis, modifikátory útok / obrana / stres / rychlost / trup %, unikátnost; uloženo v `pilots.json`,
  platí pro všechny místnosti). Lodě se jmenují `ZKR·Pilot N` (MIR·Kadet 1, MIR·Eso). Ve hře: záložky lodí
  v liště s jménem pilota (klik vycentruje) a vybraná loď má na mapě pulzující bílý překryv siluety.
- v3.41 – vysvětlivky v pixel-art stylu: všechny nativní bubliny (atribut title i <title> v SVG) nahrazuje
  vlastní okénko s bevel rámečkem a písmem hry (první řádek žlutě jako nadpis, „Nelze: …“ červeně); myš =
  najetí, dotyk = podržení ~0,45 s. Nastavení mapy: i Velikost (čtyři políčka s rostoucím obdélníkem) a
  Symetrie (náhodná / zrcadlená) jako políčka.
- v3.40 – nastavení mapy: bouře jako pět políček (kolik svítí, tolik bouří, 0–5; klik na poslední = o jednu
  míň), velikost bouří jako tři políčka jen s velikostí kolečka, komety jako tři políčka s kometou
  (málo / středně / hodně); přepínač „komety naráží do asteroidů“ na vlastním řádku. Asteroidy stejně: tři
  políčka s rostoucím počtem kamenů (málo / střední / hodně, žádné = nic nesvítí) a „Rozložení“ jako dvě
  políčka rozptýlené / ve shlucích.
- v3.39 – místnost: jedna karta **Nastavení hry** místo dvou (Mapa + Nastavení bitvy). Jednotná mřížka řádků
  (popisek | prvek | „?“ s vysvětlivkou), stejně široké selecty, pixelové přepínače ano/ne, související volby na
  jednom řádku (bouře = počet + velikost, komety + naráží do asteroidů, seed + kostka), sekce Mapa / Bitva /
  Dostupné moduly, vpravo náhled mapy se startovními body a jednořádkový souhrn hry. Limity „max N na hráče“
  nahrazeny **dlaždicemi dostupných modulů** (klik = povolit / vyřadit, odkazy všechny / žádný); vyřazený modul
  nejde koupit a hráč ho musí před bitvou prodat.
- v3.38 – tlačítka akcí s okénkem (ŠTÍT, NÁKLAD) se chovají jako MANÉVR: okénko zůstává otevřené a při
  klikání na −/+ už neprobliká (okénko se znovu neanimuje), klik kamkoliv vedle okénko zavře a volba platí –
  tlačítko zezelená s proužkem ↺ RESET; další stisk akci zruší. ✕ proužky pod tlačítky odstraněny. Při
  nepoložených bodech štítu klik vedle jen upozorní.
- v3.37 – ukazatel RYCHLOST v panelu lodi (varianta C): dílky nad maximem daným váhou jsou tmavě červené
  s rámečkem, maximum v čísle červeně a vedle ikona váhy; tooltip říká, které rychlosti váha blokuje.
- v3.36 – během bitvy se obrazovka neuspává (Screen Wake Lock API; iPadOS 16.4+, Chrome, Android). Zámek se
  obnoví po návratu z pozadí a uvolní při odchodu z bitvy. Vyžaduje HTTPS nebo localhost – na vlastní síti
  přes http:// ho Safari nepovolí (viz poznámka níže).
- v3.35 – tlačítko MANÉVR po nakreslení dráhy (varianta D2): zezelená, tužka, zaškrtnutý čtvereček ceny a dole proužek „↺ RESET“ (v3.35.1 bez druhé fajfky u tužky);
  stisk manévr resetuje (rovně stejnou rychlostí, akce se uvolní). Na dotyku platí dráha hned po zvednutí
  prstu (bez čipů i bez ✕ proužku); myší se potvrzuje klikem jako dřív. ✕ pod MANÉVR odstraněno.
- v3.34 – bez čipů ✓ / ✕: i na dotyku dráhu potvrdí ťuknutí kamkoliv nebo SPUSTIT KOLO (jako myší). Pod
  tlačítkem MANÉVR je ✕: při kreslení vrátí původní dráhu, u naplánovaného manévru ho zruší (loď poletí rovně
  stejnou rychlostí, akce se uvolní).
- v3.33.1 – čipy potvrzení dráhy na dotyku jsou čtvercové (56 px) jen s ✓ / ✕.
- v3.33 – dotykové ovládání (tablety): vstup mapy přes Pointer Events; v dotykovém režimu (automaticky podle
  zařízení, přepínač v ladění → Zobrazení) jeden prst = posun, dva prsty = pinch zoom kolem středu prstů,
  ťuknutí = klik, podržení ~0,45 s = info o objektu. Tažení prstem z vlastní lodi kreslí dráhu (duch lodi
  se drží nad prstem); po zvednutí zůstane dráha čekající a nad duchem jsou čipy **✓ POTVRDIT / ✕ ZRUŠIT**
  (✕ vrátí původní manévr, potvrdit jde i tlačítkem POTVRDIT v liště). Tlačítko **☰ MENU** místo Esc,
  dotyková nápověda pod mapou, zákaz gest prohlížeče na mapě (touch-action, viewport bez škálování,
  100dvh), větší −/+ u štítu a položky v okénkách. Myš se chová jako dřív.
- v3.32.1 – záchranná výbava: kdo po bitvě nemá žádný funkční modul ani kredity na nejlevnější, dostane
  startovní loď zdarma (zbytky se automaticky prodají); záchranné moduly nejdou prodat (0 kreditů), jinak
  se používají normálně.
- v3.32 – ekonomika mezi bitvami: každý hráč má v místnosti **kredity** (startovní rozpočet + výdělky z bitev
  − utracené za výbavu; zobrazeno u „Tvoje výbava“). Změna výbavy je obchod: nový modul za plnou cenu (před
  bitvou jde vrátit za plnou), použitý modul (po bitvě) se prodá za 60 %, zničený za 10 % (ladění → Moduly).
  Po bitvě hráči zůstane výbava z lodi: zbývající munice, zničené moduly (červené, jen k prodeji), náklad
  (v místnosti klik = prodat); poškozené moduly se opraví. Ve vraku zničené lodi je vše, co nevypadlo,
  zničené. Munice se už sama nedoplňuje – u modulu je tlačítko **+cena** (torpédo 12, mina 12, 10 nábojů
  kulometu 3; vždy levnější než prodat prázdný modul a koupit nový). Boti mají výbavu zdarma jako dřív.
- v3.31 – životy modulů a výpad modulů: každý modul má hp (lasery 30, torpédomet 20, miny 20, kulomet 25,
  skener 15, štíty 40; ladění → Moduly). Zranění, které projde do trupu, poškodí i modul (50 % zranění):
  směrovaný zásah modul na zasažené straně (slot podle směru jako u segmentů), výbuch / náraz náhodný modul.
  Modul s 0 hp je **zničený** – nefunguje (lasery nestřílí, munice nejde použít, štít spadne, skener
  bez nábojů), váží dál, ve VÝZBROJI, v inventáři a v troskách je červený. Zničená loď: každý modul (i z nákladu)
  vypadne s šancí 45 % do náhodného směru 40–90 j. jako trosky (zvednutelné, s aktuálním hp a municí).
  Zničený modul se prodá za 10 % ceny (sestřelení takových trosek dává jen zlomek odměny). Nový zvuk prasknutí
  modulu, texty v logu, hp ukazatel u každého modulu ve VÝZBROJI.
- v3.30 – rychlost na dráze (varianta C): naplánovaná dráha je tenká souvislá čára v barvě obtížnosti a na ní
  tolik teček, kolik je rychlost (poslední u ducha lodi); svislé čárky u konce dráhy zmizely, otočka má ↺.
  Okénko potvrzení volných akcí je úzké jako tlačítko SPUSTIT KOLO, bez tlačítka ZPĚT (Esc = zpět).
- v3.29 – bílý kroužek kolem vybrané lodi (a slabý při najetí myší) se už nezobrazuje; zapnout jde v ladění
  → Zobrazení („Zobrazit kroužek kolem vybrané lodi“). Žlutý kroužek cíle zůstává. Lišta nad mapou
  přeskládána: POHLED · mezera · − · oko (najít loď) · +.
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
