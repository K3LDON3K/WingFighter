import { CARGO, RULES, actionCost, cargoCapacity, dist, inStorm, makeManeuver, mineModule, mineSideOf, moduleWorking, parseManeuverId, profileOf, profileFor, effStressCost, effEvadeCost, TORPEDO, type GameState, type Segments, type Ship, type ShipOrders } from "@wingfighter/shared";

/** Jedna ikona ve věnečku u konce dráhy. Každá představuje jednu akci (1 bod). */
export interface ActionOption {
  id: string;
  glyph: string;
  label: string;
  description: string;
  /** Vrátí důvod, proč nejde vybrat, nebo null. */
  disabled(ship: Ship, state: GameState, o: ShipOrders): string | null;
  /** Je právě vybraná? */
  active(o: ShipOrders): boolean;
  /** Úprava rozkazu po kliknutí (přepíná zapnuto/vypnuto). */
  apply(o: ShipOrders, ship: Ship, state: GameState): Partial<ShipOrders>;
  /** Po výběru čeká na kliknutí na cíl na mapě. */
  pick?: "torpedo";
  /** Akce je k dispozici jen s tímto modulem na lodi (jinak se tlačítko vůbec nezobrazí). */
  requiresModule?: import("@wingfighter/shared").ModuleType;
}

/** Je akce pro loď vůbec k dispozici (má potřebný modul)? */
export function actionAvailable(a: ActionOption, ship: Ship): boolean {
  if (a.id === "shield") return ship.loadout.modules.some((m) => m.type === "shield-segment");
  if (a.id === "jettison") return ship.loadout.modules.length > 0;
  return !a.requiresModule || ship.loadout.modules.some((m) => m.type === a.requiresModule);
}

const noAp = (ship: Ship, o: ShipOrders, active: boolean) => (!active && actionCost(ship, o) >= RULES.actionPoints ? `žádná volná akce (max. ${RULES.actionPoints} za kolo)` : null);

export const ACTIONS: ActionOption[] = [
  {
    id: "move",
    glyph: "↗",
    label: "Manévr (1 akce)",
    description: "Změna směru nebo rychlosti: klik na tlačítko (nebo mezerník / klik na vlastní loď) začne kreslit dráhu myší – pohyb myši = směr a rychlost, kolečko / 1–5 = rychlost, klik nebo mezerník = potvrdit. Rovně stejnou rychlostí je zdarma; jiná rychlost nebo zatočení stojí 1 akci.",
    disabled: (ship, _s, o) => {
      const cur = parseManeuverId(o.maneuverId);
      const costs = !!cur && (cur.speed !== ship.speed || cur.angle !== 0 || cur.koiogran);
      return noAp(ship, o, costs);
    },
    active: () => false,
    apply: () => ({}),
  },
  {
    id: "laser",
    glyph: "⚡",
    label: "Lasery (1 akce)",
    description: "Na začátku kola (před pohybem) vystřelí lasery ze současné pozice na cíl ve výseči ±20° do 300 (preferovaný cíl, jinak nejbližší nepřítel; ne skrz asteroid). Bez této akce loď nestřílí.",
    disabled: (ship, s, o) => (!ship.loadout.modules.some((m) => m.type === "laser") ? "loď nemá laserový modul" : !ship.loadout.modules.some((m) => m.type === "laser" && moduleWorking(m)) ? "lasery jsou zničené" : inStorm(s, ship) ? "v bouři lasery nefungují" : noAp(ship, o, !!o.fire)),
    active: (o) => !!o.fire,
    apply: (o, ship) => ({ fire: !o.fire, laserModuleId: o.fire ? undefined : ship.loadout.modules.find((m) => m.type === "laser" && moduleWorking(m))?.id }),
    requiresModule: "laser",
  },
  {
    id: "mg",
    glyph: "⁘",
    label: "Kulomet (1 akce)",
    description: "Na začátku kola vystřelí dávku projektilů s rozptylem na cíl ve výseči kulometu (krátký dosah, široká výseč). Každý projektil má šanci zasáhnout podle vzdálenosti a dává malé zranění. Míří na preferovaný cíl (loď, torpédo, trosky), jinak na nejbližší nepřátelskou loď. Funguje i v bouři.",
    disabled: (ship, _s, o) => (!ship.loadout.modules.some((m) => m.type === "mg") ? "loď nemá kulomet" : !ship.loadout.modules.some((m) => m.type === "mg" && moduleWorking(m)) ? "kulomet je zničený" : !ship.loadout.modules.some((m) => m.type === "mg" && moduleWorking(m) && (m.ammo ?? 0) > 0) ? "došly náboje" : noAp(ship, o, !!o.fireMg)),
    active: (o) => !!o.fireMg,
    apply: (o, ship) => ({ fireMg: !o.fireMg, mgModuleId: o.fireMg ? undefined : ship.loadout.modules.find((m) => m.type === "mg" && moduleWorking(m) && (m.ammo ?? 0) > 0)?.id }),
    requiresModule: "mg",
  },
  {
    id: "torpedo",
    glyph: "➤",
    label: "Torpédo (1 akce)",
    description: `Fázové torpédo: vyletí rovně z lodi (${TORPEDO.launchDist} j. rychlostí ${TORPEDO.launchSpeed}/kolo), pak se otáčí na cíl a po zaměření zrychlí až na ${TORPEDO.speed}/kolo; při plné rychlosti zatáčí jen mírně a cíl mimo výseč před sebou ztratí. Cíl zadáš jen na mapě: klikni na viditelnou nepřátelskou loď či torpédo do ${TORPEDO.lockRange} (sleduje ji celý let), nebo na bod do ${TORPEDO.pointRange} – tam vybuchne (poloměr ${TORPEDO.blastRadius}, zranění ${TORPEDO.blastDamage} všem, kráter do asteroidu). Přímý zásah lodi = ${TORPEDO.damage}.`,
    disabled: (ship, _s, o) => (!ship.loadout.modules.some((m) => m.type === "torpedo") ? "loď nemá torpédomet" : !ship.loadout.modules.some((m) => m.type === "torpedo" && moduleWorking(m)) ? "torpédomet je zničený" : ship.ammo.torpedoes > 0 ? noAp(ship, o, o.special?.type === "torpedo") : "došla torpéda"),
    active: (o) => o.special?.type === "torpedo",
    apply: (o, ship) => ({ special: o.special?.type === "torpedo" ? undefined : { type: "torpedo", moduleId: ship.loadout.modules.find((m) => m.type === "torpedo" && moduleWorking(m) && (m.ammo ?? 0) > 0)?.id } }),
    pick: "torpedo",
    requiresModule: "torpedo",
  },
  {
    id: "mine",
    glyph: "✹",
    label: "Mina (1 akce)",
    description: "Odhodí minu ze startovní pozice lodi na stranu, kam je minový zásobník natočený (za sebe / do boku); aktivní od příštího kola. Buď reaguje na pole: nepřítel, který v něm na začátku kola stojí, ji odpálí hned, kdokoliv (i ty) při vletu během kola; nebo je časovaná 1–3 kola a vybuchne na začátku kola, kdy odpočet dojde. Zraní všechny v poli a vykousne kráter do asteroidu.",
    disabled: (ship, _s, o) => (!ship.loadout.modules.some((m) => m.type === "mine") ? "loď nemá minový zásobník" : !ship.loadout.modules.some((m) => m.type === "mine" && moduleWorking(m)) ? "minový zásobník je zničený" : ship.ammo.mines > 0 ? noAp(ship, o, o.special?.type === "mine") : "došly miny"),
    active: (o) => o.special?.type === "mine",
    apply: (o, ship) => ({ special: o.special?.type === "mine" ? undefined : { type: "mine", side: mineSideOf(mineModule(ship)?.facing) } }),
    requiresModule: "mine",
  },
  {
    id: "evade",
    glyph: "⤭",
    label: "Úhybný manévr (1 akce)",
    description: `Během pohybu proletíš skrz nepřátelské lodě (každá z nich ztratí ${RULES.evadePassStress} stresový bod), asteroidy i komety bez srážky; nesmíš ale v nich skončit – v nepříteli = normální srážka, v asteroidu nebo kometě = dvojité zranění. Zranění minou i torpédem je v tomto kole nižší o ${RULES.evadeDamageReduction} %. Stojí ${RULES.evadeStressCost} stresový bod.`,
    disabled: (ship, _s, o) => (ship.stressPoints < effEvadeCost(o) ? "chybí stresový bod" : noAp(ship, o, o.action?.type === "evade")),
    active: (o) => o.action?.type === "evade",
    apply: (o) => ({ action: o.action?.type === "evade" ? undefined : { type: "evade" } }),
  },
  {
    id: "shield",
    glyph: "◈",
    label: "Úprava štítu (1 akce)",
    description: `Přerozdělí body segmentového štítu (předek, pravobok, záď, levobok) – stejný součet, max. ${RULES.segmentMax} na segment. Nové rozložení platí od začátku kola, tedy ještě před palbou laserů.`,
    disabled: (ship, _s, o) => (ship.shieldType !== "segment" ? "jen se segmentovým štítem" : ship.segments.every((x) => x === 0) ? "štít je vybitý" : noAp(ship, o, o.action?.type === "shield")),
    active: (o) => o.action?.type === "shield",
    apply: (o, ship) => ({ action: o.action?.type === "shield" ? undefined : { type: "shield", segments: [...ship.segments] as Segments } }),
  },
  {
    id: "jettison",
    glyph: "⏏",
    label: "Vyhodit modul (1 akce)",
    description: "Na začátku kola vyhodí zvolený modul z lodi – loď je lehčí (vyšší max. rychlost od příštího kola). Modul zůstane za lodí jako trosky; kdo je sestřelí lasery, dostane kredity. Moduly se zatím nedají sebrat zpět.",
    disabled: (ship, _s, o) => (ship.loadout.modules.length === 0 ? "loď nemá žádný modul" : noAp(ship, o, o.action?.type === "jettison")),
    active: (o) => o.action?.type === "jettison",
    apply: (o) => ({ action: o.action?.type === "jettison" ? undefined : { type: "jettison", moduleId: "" } }),
  },
  {
    id: "koiogran",
    glyph: "⟲",
    label: "Otočka 180° (2 akce)",
    description: `Na konci nakreslené křivky (nebo rovné dráhy) se loď otočí o 180°; její rychlost pak klesne o ${RULES.koiogranSpeedDrop}. Jde od rychlosti 2. Stojí obě akce kola. Stres: 1 na zelené/bílé křivce, 2 na červené, 3 na nebezpečné (ta navíc zraní trup). Zapni před kreslením, nebo až po něm – duch v cíli se otočí.`,
    disabled: (ship, _s, o) => {
      const cur = parseManeuverId(o.maneuverId);
      if (cur?.koiogran) return null;
      const profile = profileFor(ship, o);
      const sp = Math.max(2, cur?.speed ?? ship.speed);
      const man = makeManeuver(profile, sp, cur?.angle ?? 0, true, ship.speed) ?? makeManeuver(profile, sp, 0, true, ship.speed);
      if (!man) return "loď otočku nezvládne";
      if (effStressCost(man, o) > ship.stressPoints) return `chybí stres (otočka stojí ${effStressCost(man, o)})`;
      const cost = actionCost(ship, { ...o, maneuverId: man.id });
      return cost > RULES.actionPoints ? `otočka by stála ${cost} akce` : null;
    },
    active: (o) => !!parseManeuverId(o.maneuverId)?.koiogran,
    apply: (o, ship) => {
      const profile = profileFor(ship, o);
      const cur = parseManeuverId(o.maneuverId);
      // přepínač: zachová rychlost i úhel křivky; otočka jde od rychlosti 2
      if (cur?.koiogran) return { maneuverId: makeManeuver(profile, cur.speed, cur.angle, false, ship.speed)?.id ?? o.maneuverId };
      const sp = Math.max(2, cur?.speed ?? ship.speed);
      return { maneuverId: (makeManeuver(profile, sp, cur?.angle ?? 0, true, ship.speed) ?? makeManeuver(profile, sp, 0, true, ship.speed))?.id ?? o.maneuverId };
    },
  },
];

ACTIONS.push({
  id: "pickup",
  glyph: "⬒",
  label: "Zvednout náklad (1 akce)",
  description: `Po střelbě, před pohybem: zvedne vyhozený modul (trosky) v dosahu ${CARGO.range} kolem lodi do nákladového prostoru. Jde jen při rychlosti manévru ≤ ${CARGO.maxSpeed}. Klik na trosky = cíl (jinak nejbližší). Když o stejný předmět usiluje víc lodí, vyhrává pomalejší, pak bližší. Náklad nefunguje, jen váží; lze ho vyhodit, mezi bitvami nasadit nebo prodat.`,
  disabled: (ship, s, o) => {
    const cap = cargoCapacity(ship.loadout);
    if (cap <= 0) return "loď nemá nákladový prostor";
    if ((ship.loadout.cargo ?? []).length >= cap) return "nákladový prostor je plný";
    // dosah a rychlost nejsou blokující – akci jde zapnout (ukáže dosah), jen se nevykoná
    return noAp(ship, o, o.action?.type === "pickup");
  },
  active: (o) => o.action?.type === "pickup",
  apply: (o, ship, s) => {
    if (o.action?.type === "pickup") return { action: undefined };
    const near = (s.debris ?? []).filter((d) => dist(ship, d) <= CARGO.range).sort((a, b) => dist(ship, a) - dist(ship, b))[0];
    return { action: { type: "pickup", targetId: near?.id } };
  },
});

export function actionById(id: string): ActionOption | undefined {
  return ACTIONS.find((a) => a.id === id);
}
