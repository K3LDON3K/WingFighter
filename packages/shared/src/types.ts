import type { Pose } from "./geometry.ts";

export type GameMode = "tdm" | "dm";

export type ManeuverKind = "straight" | "bank" | "turn" | "koiogran";
export type Side = "left" | "right";
export type Difficulty = "green" | "white" | "red";

export interface Maneuver {
  /** Stabilní identifikátor, např. "bank-2-left". */
  id: string;
  kind: ManeuverKind;
  speed: number;
  side?: Side;
  difficulty: Difficulty;
}

/** Akce po pohybu – jedna za kolo (nebo místo ní speciální zbraň). */
export type ActionOrder =
  | { type: "focus" }
  | { type: "evade" }
  | { type: "lock"; targetId: string }
  | { type: "boost"; dir: "straight" | "left" | "right" }
  | { type: "barrelRoll"; side: Side };

export type SpecialOrder = { type: "torpedo"; targetId: string } | { type: "mine" };

/** Rozkaz pro jednu loď na jedno kolo. */
export interface ShipOrders {
  shipId: string;
  maneuverId: string;
  action?: ActionOrder;
  special?: SpecialOrder;
  fire: boolean;
  /** Preferovaný cíl laserů; když není ve výseči, střílí se na nejbližšího nepřítele. */
  preferredTargetId?: string;
}

/** Trup lodi – nese moduly. V1 má jen stíhač s pevnou sestavou. */
export interface HullDef {
  id: string;
  name: string;
  /** Poloměr pro kolize a vykreslení. */
  radius: number;
  hull: number;
  /** Nosnost pro moduly (v1 nevyužito, připraveno pro inventář). */
  capacity: number;
  slots: { weapon: number; system: number };
  /** Dostupné manévry ("ciferník"). */
  dial: Maneuver[];
}

export interface ModuleDef {
  id: string;
  name: string;
  slot: "weapon" | "engine" | "shield" | "system";
  size: number;
  stats: Partial<{
    attack: number;
    agility: number;
    shields: number;
    torpedoes: number;
    mines: number;
    hull: number;
  }>;
}

/** Sestavená loď = trup + moduly → výsledné statistiky. */
export interface ShipLoadout {
  hullId: string;
  moduleIds: string[];
}

export interface ShipStats {
  attack: number;
  agility: number;
  hull: number;
  shields: number;
  torpedoes: number;
  mines: number;
  radius: number;
}

export interface Ship extends Pose {
  id: string;
  ownerId: string;
  team: number;
  name: string;
  loadout: ShipLoadout;
  stats: ShipStats;
  hull: number;
  shields: number;
  stress: number;
  tokens: { focus: number; evade: number };
  lockTargetId?: string;
  ammo: { torpedoes: number; mines: number };
  alive: boolean;
  /** Poslední manévr (pro zobrazení soupeřům po vyhodnocení). */
  lastManeuverId?: string;
}

export interface Torpedo extends Pose {
  id: string;
  ownerId: string;
  team: number;
  targetId: string;
  trackLeft: number;
  lifeLeft: number;
}

export interface Mine {
  id: string;
  ownerId: string;
  team: number;
  x: number;
  y: number;
  radius: number;
  armed: boolean;
}

export interface Asteroid {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** Rychlost za kolo – pro budoucí pohyblivé asteroidy (v1 = 0). */
  vx: number;
  vy: number;
  /** Seed pro vykreslení tvaru. */
  seed: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
}

export interface GameSettings {
  mode: GameMode;
  /** 0 = bez limitu. */
  turnLimit: number;
  shipsPerPlayer: number;
}

export interface GameResult {
  /** V TDM číslo vítězného týmu, v DM id vítěze; null = remíza. */
  winnerTeam: number | null;
  winnerPlayerId: string | null;
  reason: "elimination" | "turnLimit";
}

export interface GameState {
  turn: number;
  settings: GameSettings;
  width: number;
  height: number;
  asteroids: Asteroid[];
  ships: Ship[];
  torpedoes: Torpedo[];
  mines: Mine[];
  players: PlayerInfo[];
  status: "planning" | "finished";
  result?: GameResult;
}

export type DieFace = "hit" | "crit" | "focus" | "blank" | "evade";

/** Události jednoho kola – klient podle nich animuje. */
export type TurnEvent =
  | { type: "move"; paths: MovePath[] }
  | { type: "collision"; shipId: string; with: "ship" | "asteroid" | "edge"; otherId?: string; t: number }
  | { type: "mineBlast"; mineId: string; x: number; y: number; t: number; hits: { shipId: string; damage: number }[] }
  | { type: "torpedoHit"; torpedoId: string; shipId?: string; x: number; y: number; t: number; damage: number }
  | { type: "torpedoExpire"; torpedoId: string; x: number; y: number }
  | { type: "action"; shipId: string; action: ActionOrder; ok: boolean; path?: Pose[] }
  | {
      type: "laser";
      shooterId: string;
      targetId: string;
      from: Pose;
      to: Pose;
      attackDice: DieFace[];
      defenseDice: DieFace[];
      hits: number;
      evades: number;
      damage: number;
      rangeBand: number;
    }
  | { type: "spawnTorpedo"; torpedo: Torpedo }
  | { type: "spawnMine"; mine: Mine }
  | { type: "damage"; shipId: string; amount: number; shieldsAfter: number; hullAfter: number }
  | { type: "destroyed"; shipId: string; x: number; y: number }
  | { type: "stress"; shipId: string; stress: number };

export interface MovePath {
  id: string;
  kind: "ship" | "torpedo";
  /** Vzorky dráhy (MOVE_STEPS + 1). Po zastavení se poslední pozice opakuje. */
  points: Pose[];
}

export interface TurnResult {
  turn: number;
  /** Rozkazy všech hráčů (odkryté po vyhodnocení). */
  orders: ShipOrders[];
  events: TurnEvent[];
  state: GameState;
}
