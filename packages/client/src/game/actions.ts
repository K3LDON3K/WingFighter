import { ACTION_POINTS, actionCost, hullOf, makeManeuver, parseManeuverId, TORPEDO, type GameState, type Ship, type ShipOrders } from "@spacegame/shared";

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

const noAp = (ship: Ship, o: ShipOrders, active: boolean) => (!active && actionCost(ship, o) >= ACTION_POINTS ? "žádná volná akce (max. 2 za kolo)" : null);

export const ACTIONS: ActionOption[] = [
  {
    id: "laser",
    glyph: "⚡",
    label: "Lasery (1 akce)",
    description: "Po pohybu vystřelí lasery na cíl ve výseči ±20° do 300 (preferovaný cíl, jinak nejbližší nepřítel; ne skrz asteroid). Bez této akce loď nestřílí.",
    disabled: (ship, _s, o) => noAp(ship, o, !!o.fire),
    active: (o) => !!o.fire,
    apply: (o) => ({ fire: !o.fire }),
  },
  {
    id: "torpedo",
    glyph: "➤",
    label: "Torpédo (1 akce)",
    description: `Vypustí torpédo hned se začátkem pohybu (letí rychleji než loď). Klikni na nepřátelskou loď či torpédo do ${TORPEDO.lockRange} (sleduje cíl ${TORPEDO.trackTurns} kola), nebo na bod mapy do ${TORPEDO.pointRange} – tam vybuchne (poloměr ${TORPEDO.blastRadius}, zranění ${TORPEDO.blastDamage} všem, kráter do asteroidu). Přímý zásah lodi = ${TORPEDO.damage}.`,
    disabled: (ship, _s, o) => (ship.ammo.torpedoes > 0 ? noAp(ship, o, o.special?.type === "torpedo") : "došla torpéda"),
    active: (o) => o.special?.type === "torpedo",
    apply: (o) => ({ special: o.special?.type === "torpedo" ? undefined : { type: "torpedo" } }),
    pick: "torpedo",
  },
  {
    id: "mine",
    glyph: "✹",
    label: "Mina (1 akce)",
    description: "Položí minu na místo, kde loď kolo začínala. Od příštího kola ji odpálí kdokoliv (i ty) nebo torpédo při vstupu do pole; zraní všechny v poli a vykousne kráter do asteroidu.",
    disabled: (ship, _s, o) => (ship.ammo.mines > 0 ? noAp(ship, o, o.special?.type === "mine") : "došly miny"),
    active: (o) => o.special?.type === "mine",
    apply: (o) => ({ special: o.special?.type === "mine" ? undefined : { type: "mine" } }),
  },
  {
    id: "koiogran",
    glyph: "⟲",
    label: "Otočka 180° (1 akce)",
    description: "Loď poletí rovně a na konci se otočí o 180°. Jde jen při rychlosti 3–4; jiná rychlost než aktuální stojí další akci (úprava pohybu). Otočka je vždy červený manévr (stresový bod).",
    disabled: (ship, _s, o) => {
      const cur = parseManeuverId(o.maneuverId);
      if (cur?.koiogran) return null;
      const profile = hullOf(ship.loadout).profile;
      const sp = profile.koiogranSpeeds.includes(ship.speed) ? ship.speed : profile.koiogranSpeeds[0];
      const man = makeManeuver(profile, sp, 0, true, ship.speed);
      if (!man) return "loď otočku nezvládne";
      const cost = actionCost(ship, { ...o, maneuverId: man.id });
      return cost > ACTION_POINTS ? `otočka by stála ${cost} akce` : null;
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
