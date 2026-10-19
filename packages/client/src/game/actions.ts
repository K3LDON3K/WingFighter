import { TORPEDO, type GameState, type Ship, type ShipOrders } from "@spacegame/shared";

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

export const ACTIONS: ActionOption[] = [
  {
    id: "none",
    glyph: "∅",
    label: "Bez zbraně",
    description: "V tomto kole loď jen manévruje a střílí lasery.",
    disabled: () => null,
    active: (o) => !o.action && !o.special,
    apply: () => ({ action: undefined, special: undefined }),
  },
  {
    id: "torpedo",
    glyph: "➤",
    label: "Torpédo",
    description: `Vypustí torpédo hned se začátkem pohybu (letí rychleji než loď). Klikni na nepřátelskou loď či torpédo do ${TORPEDO.lockRange} (sleduje cíl ${TORPEDO.trackTurns} kola), nebo na bod mapy do ${TORPEDO.pointRange} – tam vybuchne (poloměr ${TORPEDO.blastRadius}, zranění ${TORPEDO.blastDamage} všem, kráter do asteroidu). Přímý zásah lodi = ${TORPEDO.damage}.`,
    disabled: (ship) => (ship.ammo.torpedoes > 0 ? null : "došla torpéda"),
    active: (o) => o.special?.type === "torpedo",
    apply: (o) => ({ action: undefined, special: o.special?.type === "torpedo" ? o.special : { type: "torpedo" } }),
    pick: "torpedo",
  },
  {
    id: "mine",
    glyph: "✹",
    label: "Mina",
    description: "Položí minu na místo, kde loď kolo začínala. Od příštího kola ji odpálí kdokoliv (i ty) nebo torpédo při vstupu do pole; zraní všechny v poli a vykousne kráter do asteroidu.",
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
