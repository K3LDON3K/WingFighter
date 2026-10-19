import type { Pose } from "./geometry.ts";
import type { Tuning } from "./tuning.ts";

export type GameMode = "tdm" | "dm";

export type Side = "left" | "right";
/** zelený = odstraní stres · bílý · červený = stres, bez akce · nebezpečný = červený + 1 zranění */
export type Difficulty = "green" | "white" | "red" | "danger";

/** Manévr = rychlost (1–5) + změna kurzu ve stupních (po 15°, záporné = vlevo), případně otočka o 180°. */
export interface Maneuver {
  /** Stabilní identifikátor, např. "m3a-30" nebo "k3". */
  id: string;
  speed: number;
  angle: number;
  koiogran: boolean;
  difficulty: Difficulty;
}

/** Co motor/trup dovolí. Index pole maxAngle = rychlost. */
export interface ManeuverProfile {
  maxSpeed: number;
  maxAngle: number[];
  koiogranSpeeds: number[];
}

/** Akce po pohybu – jedna za kolo (nebo místo ní speciální zbraň). */
export type ActionOrder =
  | { type: "focus" }
  | { type: "evade" }
  | { type: "lock"; targetId: string }
  | { type: "boost"; dir: "straight" | "left" | "right" }
  | { type: "shield"; segments: Segments }
  | { type: "barrelRoll"; side: Side };

export type ShieldType = "whole" | "segment";
/** Segmenty štítu: 0 předek, 1 pravobok, 2 záď, 3 levobok. */
export type Segments = [number, number, number, number];

export type SpecialOrder =
  | { type: "torpedo"; targetId?: string; point?: { x: number; y: number } }
  | { type: "mine"; timer?: number; side?: MineSide };

export type MineSide = "behind" | "left" | "right";

/** Rozkaz pro jednu loď na jedno kolo. */
export interface ShipOrders {
  shipId: string;
  maneuverId: string;
  action?: ActionOrder;
  special?: SpecialOrder;
  fire: boolean;
  /** Preferovaný cíl laserů (loď nebo torpédo); když není ve výseči, střílí se na nejbližší nepřátelskou loď. */
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
  /** Pohybové možnosti lodi. */
  profile: ManeuverProfile;
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
    vision: number;
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
  /** Dohled (fog of war). */
  vision: number;
}

export interface Ship extends Pose {
  id: string;
  ownerId: string;
  team: number;
  name: string;
  loadout: ShipLoadout;
  stats: ShipStats;
  hull: number;
  /** Celolodní štít: zásoba. */
  shields: number;
  shieldType: ShieldType;
  /** Celolodní štít: účinnost v % (kolik zranění pohltí); po každém zásahu klesá. */
  shieldEff: number;
  /** Segmentový štít: životy segmentů (předek, pravobok, záď, levobok). */
  segments: Segments;
  /** Zásoba stresových bodů (červený manévr −1, nebezpečný −2, zelený +1). */
  stressPoints: number;
  /** Rychlost posledního manévru (prudká změna o 2+ = červený manévr). */
  speed: number;
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
  /** Sledovaný cíl (loď nebo torpédo) … */
  targetId?: string;
  /** … nebo bod na mapě, kde má vybuchnout. */
  targetPoint?: { x: number; y: number };
  trackLeft: number;
  lifeLeft: number;
  /** Fázové torpédo: fáze letu, aktuální rychlost (j./kolo), zbývající délka výletu, ztracený cíl. */
  phase: TorpedoPhase;
  speed: number;
  launchLeft: number;
  lost?: boolean;
}
export type TorpedoPhase = "launch" | "lock" | "cruise";

export interface Mine {
  id: string;
  ownerId: string;
  team: number;
  x: number;
  y: number;
  radius: number;
  armed: boolean;
  /** Časovaná mina: za kolik kol vybuchne (nereaguje na vstup do pole). undefined = reaguje na vstup. */
  timer?: number;
}

export interface Asteroid {
  id: string;
  x: number;
  y: number;
  /** Nominální (největší) poloměr – hrubý test kolizí. */
  radius: number;
  /** Rychlost za kolo – pro budoucí pohyblivé asteroidy (v1 = 0). */
  vx: number;
  vy: number;
  /** Seed tvaru. */
  seed: number;
  /** Tvar: vzdálenost okraje od středu pro ASTEROID_SEGMENTS úhlů (0 = díra). Výbuchy ho vykusují. */
  profile: number[];
  /** Zvýší se při každé změně tvaru (klient podle toho překreslí sprite). */
  version: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
  shieldType?: ShieldType;
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
  /** Ladicí parametry platné pro tuto bitvu. */
  tuning: Tuning;
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
  | { type: "collision"; shipId: string; with: "ship" | "asteroid" | "edge"; otherId?: string; t: number; newHeading: number }
  | { type: "mineBlast"; mineId: string; x: number; y: number; t: number; hits: { shipId: string; damage: number }[] }
  | { type: "torpedoHit"; torpedoId: string; shipId?: string; x: number; y: number; t: number; damage: number; blast: boolean }
  | { type: "asteroidHit"; asteroidId: string; x: number; y: number; t: number; profile: number[]; destroyed: boolean }
  | { type: "torpedoExpire"; torpedoId: string; x: number; y: number }
  | { type: "torpedoShot"; torpedoId: string; shooterId: string; x: number; y: number; attackDice: DieFace[]; defenseDice: DieFace[]; destroyed: boolean }
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
  | {
      type: "damage";
      shipId: string;
      amount: number;
      shieldsAfter: number;
      hullAfter: number;
      /** Kolik pohltil štít a který segment (u segmentového). */
      absorbed?: number;
      segment?: number;
      segmentsAfter?: Segments;
      effAfter?: number;
    }
  | { type: "destroyed"; shipId: string; x: number; y: number }
  | { type: "stress"; shipId: string; stressPoints: number; delta: number }
  /** Úhybný manévr: loď proletěla skrz nepřátelskou loď (t = podíl dráhy, x/y = místo průletu). */
  | { type: "evadePass"; shipId: string; victimId: string; t: number; x: number; y: number };

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
