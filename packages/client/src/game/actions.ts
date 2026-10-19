import { RULES, actionCost, hullOf, makeManeuver, parseManeuverId, TORPEDO, type GameState, type Ship, type ShipOrders } from "@spacegame/shared";

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
}

const noAp = (ship: Ship, o: ShipOrders, active: boolean) => (!active && actionCost(ship, o) >= RULES.actionPoints ? `žádná volná akce (max. ${RULES.actionPoints} za kolo)` : null);

export const ACTIONS: ActionOption[] = [
  {
    id: "laser",
    glyph: "⚡",
    label: "Lasery (1 akce)",
    description: "Na začátku kola (před pohybem) vystřelí lasery ze současné pozice na cíl ve výseči ±20° do 300 (preferovaný cíl, jinak nejbližší nepřítel; ne skrz asteroid). Bez této akce loď nestřílí.",
    disabled: (ship, _s, o) => noAp(ship, o, !!o.fire),
    active: (o) => !!o.fire,
    apply: (o) => ({ fire: !o.fire }),
  },
  {
    id: "torpedo",
    glyph: "➤",
    label: "Torpédo (1 akce)",
    description: `Vypustí torpédo hned se začátkem pohybu (letí 240/kolo, zatáčí až 120°/kolo). Cíl zadáš jen na mapě: klikni na viditelnou nepřátelskou loď či torpédo do ${TORPEDO.lockRange} (sleduje ji celý let), nebo na bod do ${TORPEDO.pointRange} – tam vybuchne (poloměr ${TORPEDO.blastRadius}, zranění ${TORPEDO.blastDamage} všem, kráter do asteroidu). Přímý zásah lodi = ${TORPEDO.damage}.`,
    disabled: (ship, _s, o) => (ship.ammo.torpedoes > 0 ? noAp(ship, o, o.special?.type === "torpedo") : "došla torpéda"),
    active: (o) => o.special?.type === "torpedo",
    apply: (o) => ({ special: o.special?.type === "torpedo" ? undefined : { type: "torpedo" } }),
    pick: "torpedo",
  },
  {
    id: "mine",
    glyph: "✹",
    label: "Mina (1 akce)",
    description: "Odhodí minu ze startovní pozice lodi – za sebe nebo do strany; aktivní od příštího kola. Buď reaguje na pole: nepřítel, který v něm na začátku kola stojí, ji odpálí hned, kdokoliv (i ty) při vletu během kola; nebo je časovaná 1–3 kola a vybuchne na začátku kola, kdy odpočet dojde. Zraní všechny v poli a vykousne kráter do asteroidu.",
    disabled: (ship, _s, o) => (ship.ammo.mines > 0 ? noAp(ship, o, o.special?.type === "mine") : "došly miny"),
    active: (o) => o.special?.type === "mine",
    apply: (o) => ({ special: o.special?.type === "mine" ? undefined : { type: "mine", side: "behind" } }),
  },
  {
    id: "evade",
    glyph: "⤭",
    label: "Úhybný manévr (1 akce)",
    description: `Během pohybu proletíš skrz nepřátelské lodě bez srážky (každá z nich ztratí ${RULES.evadePassStress} stresový bod); nesmíš ale skončit v dotyku s nepřítelem – jinak normální srážka. Zranění minou i torpédem je v tomto kole nižší o ${RULES.evadeDamageReduction} %. Stojí ${RULES.evadeStressCost} stresový bod.`,
    disabled: (ship, _s, o) => (ship.stressPoints < RULES.evadeStressCost ? "chybí stresový bod" : noAp(ship, o, o.action?.type === "evade")),
    active: (o) => o.action?.type === "evade",
    apply: (o) => ({ action: o.action?.type === "evade" ? undefined : { type: "evade" } }),
  },
  {
    id: "koiogran",
    glyph: "⟲",
    label: "Otočka 180° (1 akce)",
    description: `Loď poletí rovně a na konci se otočí o 180°; její rychlost pak klesne o ${RULES.koiogranSpeedDrop}. Jde jen při rychlosti 3–4; jiná rychlost než aktuální stojí další akci (úprava pohybu). Otočka je červený manévr (1 stresový bod) – jiný postih není.`,
    disabled: (ship, _s, o) => {
      const cur = parseManeuverId(o.maneuverId);
      if (cur?.koiogran) return null;
      const profile = hullOf(ship.loadout).profile;
      const sp = profile.koiogranSpeeds.includes(ship.speed) ? ship.speed : profile.koiogranSpeeds[0];
      const man = makeManeuver(profile, sp, 0, true, ship.speed);
      if (!man) return "loď otočku nezvládne";
      const cost = actionCost(ship, { ...o, maneuverId: man.id });
      return cost > RULES.actionPoints ? `otočka by stála ${cost} akce` : null;
    },
    active: (o) => !!parseManeuverId(o.maneuverId)?.koiogran,
    apply: (o, ship) => {
      const profile = hullOf(ship.loadout).profile;
      const cur = parseManeuverId(o.maneuverId);
      if (cur?.koiogran) return { maneuverId: makeManeuver(profile, ship.speed, 0, false, ship.speed)?.id ?? o.maneuverId };
      const sp = profile.koiogranSpeeds.includes(ship.speed) ? ship.speed : profile.koiogranSpeeds[0];
      return { maneuverId: makeManeuver(profile, sp, 0, true, ship.speed)?.id ?? o.maneuverId };
    },
  },
];

export function actionById(id: string): ActionOption | undefined {
  return ACTIONS.find((a) => a.id === id);
}
