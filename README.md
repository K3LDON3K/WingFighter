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
- Každé kolo **všichni tajně naplánují** manévr (ciferník), akci po pohybu *nebo* speciální zbraň
  a cíl laserů. Po „Připraven“ od všech se kolo **vyhodnotí najednou** a přehraje.
- Pořadí vyhodnocení: pohyb lodí a torpéd (včetně srážek a min) → akce → lasery (všichni naráz)
  → vypuštění nových torpéd a min → dobití štítů (+1).

### Manévry
Zelené odstraňují stres, červené ho způsobí (loď pak nemůže provést akci a příště nesmí červený manévr).
Srážka s lodí zastaví obě lodě; náraz do asteroidu nebo okraje mapy zastaví loď a dá 1 zranění.

### Akce (jedna za kolo)
zaměřit (oči na kostkách = zásah/úhyb) · úhyb (+1 úhyb) · zámek cíle (přehození kostek)
· přídavný posun (rovně/oblouk 1) · úskok do strany

### Zbraně
- **Lasery** – každé kolo zdarma, výseč ±20° před přídí, dostřel 300 (3 pásma: blízko +1 kostka útoku,
  daleko +1 kostka obrany). Střílí na preferovaný cíl, pokud je ve výseči, jinak na nejbližšího nepřítele.
- **Torpédo** (3 ks, místo akce) – cíl musí být v zaměřovacím dostřelu 320. Letí rychlostí 240/kolo,
  zatáčí max 75°/kolo, cíl sleduje 3 kola, žije 5 kol, zranění 3. Vybuchne o cokoliv.
- **Mina** (2 ks, místo akce) – zůstane na místě, kde loď kolo začala. Aktivní od příštího kola,
  spustí ji kdokoliv (i vlastní loď) při vstupu do pole (poloměr 70), zranění 2 všem v poli.

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

## Co bude dál (v2)
Utkání o více bitvách, vylepšování lodí mezi bitvami (inventář: trup + moduly, sloty),
více tříd lodí, pohyblivé asteroidy, zvuk, vlastní vesmír a jména, desktopový obal s tlačítkem „hostovat“.
