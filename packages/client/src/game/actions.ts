import { dist, LOCK_RANGE, TORPEDO, type GameState, type Ship, type ShipOrders } from "@spacegame/shared";

/** Jedna ikona ve věnečku kolem lodi. */
export interface ActionOption {
  id: string;
  glyph: string;
  label: string;
  description: string;
  /** Vrátí důvod, proč nejde vybrat, nebo null. */
  disabled(ship: Ship, state: GameState): string | null;
  /** Je právě vybraná? */
  active(o: ShipOrders): boolean;
  /** Úprava rozkazu po kliknutí. */
  apply(o: ShipOrders, ship: Ship, state: GameState): Partial<ShipOrders>;
  /** Po výběru čeká na kliknutí na cíl na mapě. */
  pick?: "torpedo" | "lock";
}

const enemies = (ship: Ship, state: GameState) => state.ships.filter((s) => s.alive && s.team !== ship.team);

export const ACTIONS: ActionOption[] = [
  {
    id: "none",
    glyph: "∅",
    label: "Bez akce",
    description: "Loď po pohybu neudělá nic navíc.",
    disabled: () => null,
    active: (o) => !o.action && !o.special,
    apply: () => ({ action: undefined, special: undefined }),
  },
  {
    id: "focus",
    glyph: "◎",
    label: "Zaměřit",
    description: "Soustředění: v tomto kole se všechny „oči“ (◉) na tvých kostkách počítají jako zásah při útoku i jako úhyb při obraně.",
    disabled: () => null,
    active: (o) => o.action?.type === "focus",
    apply: () => ({ action: { type: "focus" }, special: undefined }),
  },
  {
    id: "evade",
    glyph: "◇",
    label: "Úhyb",
    description: "Loď získá +1 úhyb proti každému laserovému útoku v tomto kole.",
    disabled: () => null,
    active: (o) => o.action?.type === "evade",
    apply: () => ({ action: { type: "evade" }, special: undefined }),
  },
  {
    id: "lock",
    glyph: "⌖",
    label: "Zámek cíle",
    description: `Zaměří nepřátelskou loď do vzdálenosti ${LOCK_RANGE}. Zámek vydrží do dalšího útoku na tento cíl a nechá přehodit všechny kostky, které nepadly na zásah. Po výběru klikni na cíl.`,
    disabled: (ship, state) => (enemies(ship, state).some((e) => dist(ship, e) <= LOCK_RANGE) ? null : "žádný nepřítel v dosahu zámku"),
    active: (o) => o.action?.type === "lock",
    apply: (o, ship, state) => {
      const first = enemies(ship, state).find((e) => dist(ship, e) <= LOCK_RANGE);
      return { action: { type: "lock", targetId: o.action?.type === "lock" ? o.action.targetId : (first?.id ?? "") }, special: undefined };
    },
    pick: "lock",
  },
  {
    id: "boost-straight",
    glyph: "⇡",
    label: "Přídavný posun rovně",
    description: "Po manévru loď ještě popojede o 1 dílek rovně. Nepovede se, když by skončila v překážce.",
    disabled: () => null,
    active: (o) => o.action?.type === "boost" && o.action.dir === "straight",
    apply: () => ({ action: { type: "boost", dir: "straight" }, special: undefined }),
  },
  {
    id: "boost-left",
    glyph: "⇖",
    label: "Přídavný posun vlevo",
    description: "Po manévru loď ještě popojede o 1 dílek obloukem 45° vlevo.",
    disabled: () => null,
    active: (o) => o.action?.type === "boost" && o.action.dir === "left",
    apply: () => ({ action: { type: "boost", dir: "left" }, special: undefined }),
  },
  {
    id: "boost-right",
    glyph: "⇗",
    label: "Přídavný posun vpravo",
    description: "Po manévru loď ještě popojede o 1 dílek obloukem 45° vpravo.",
    disabled: () => null,
    active: (o) => o.action?.type === "boost" && o.action.dir === "right",
    apply: () => ({ action: { type: "boost", dir: "right" }, special: undefined }),
  },
  {
    id: "roll-left",
    glyph: "⇐",
    label: "Úskok vlevo",
    description: "Loď uskočí o 1 dílek do strany bez změny kurzu – dobré na vyklouznutí z nepřátelské výseče.",
    disabled: () => null,
    active: (o) => o.action?.type === "barrelRoll" && o.action.side === "left",
    apply: () => ({ action: { type: "barrelRoll", side: "left" }, special: undefined }),
  },
  {
    id: "roll-right",
    glyph: "⇒",
    label: "Úskok vpravo",
    description: "Loď uskočí o 1 dílek do strany bez změny kurzu.",
    disabled: () => null,
    active: (o) => o.action?.type === "barrelRoll" && o.action.side === "right",
    apply: () => ({ action: { type: "barrelRoll", side: "right" }, special: undefined }),
  },
  {
    id: "torpedo",
    glyph: "➤",
    label: "Torpédo",
    description: `Místo akce vypustí torpédo. Klikni na nepřátelskou loď či torpédo do ${TORPEDO.lockRange} (sleduje cíl ${TORPEDO.trackTurns} kola), nebo na bod mapy do ${TORPEDO.pointRange} – tam vybuchne (poloměr ${TORPEDO.blastRadius}, zranění ${TORPEDO.blastDamage} všem, kráter do asteroidu). Přímý zásah lodi = ${TORPEDO.damage}.`,
    disabled: (ship) => (ship.ammo.torpedoes > 0 ? null : "došla torpéda"),
    active: (o) => o.special?.type === "torpedo",
    apply: (o) => ({ action: undefined, special: o.special?.type === "torpedo" ? o.special : { type: "torpedo" } }),
    pick: "torpedo",
  },
  {
    id: "mine",
    glyph: "✹",
    label: "Mina",
    description: "Místo akce položí minu na místo, kde loď kolo začínala. Od příštího kola ji odpálí kdokoliv (i ty) nebo torpédo při vstupu do pole; zraní všechny v poli a vykousne kráter do asteroidu.",
    disabled: (ship) => (ship.ammo.mines > 0 ? null : "došly miny"),
    active: (o) => o.special?.type === "mine",
    apply: () => ({ action: undefined, special: { type: "mine" } }),
  },
];

export function actionById(id: string): ActionOption | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/** Která ikona odpovídá aktuálnímu rozkazu. */
export function activeAction(o: ShipOrders): ActionOption {
  return ACTIONS.find((a) => a.id !== "none" && a.active(o)) ?? ACTIONS[0];
}
