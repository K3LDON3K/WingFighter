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
  /** Vyhození modulu z lodi (odlehčení) – modul zůstane jako trosky, které jde sestřelit za odměnu. */
  | { type: "jettison"; moduleId: string }
  | { type: "barrelRoll"; side: Side };

export type ShieldType = "whole" | "segment" | "none";
/** Segmenty štítu: 0 předek, 1 pravobok, 2 záď, 3 levobok. */
export type Segments = [number, number, number, number];

export type SpecialOrder =
  | { type: "torpedo"; targetId?: string; point?: { x: number; y: number }; moduleId?: string }
  | { type: "mine"; timer?: number; side?: MineSide };

export type MineSide = "behind" | "left" | "right";

/** Rozkaz pro jednu loď na jedno kolo. */
export interface ShipOrders {
  shipId: string;
  maneuverId: string;
  action?: ActionOrder;
  special?: SpecialOrder;
  fire: boolean;
  /** Ze kterého laserového modulu se střílí (když je jich víc). */
  laserModuleId?: string;
  /** Preferovaný cíl laserů (loď nebo torpédo); když není ve výseči, střílí se na nejbližší nepřátelskou loď. */
  preferredTargetId?: string;
}

/** Sloty stíhače. */
export type SlotId = "front" | "back" | "left" | "right";
export type ModuleType = "laser" | "torpedo" | "mine" | "shield-segment" | "shield-whole" | "scanner";

/** Trup lodi – nese moduly ve slotech. */
export interface HullDef {
  id: string;
  name: string;
  description: string;
  /** Poloměr pro kolize a vykreslení. */
  radius: number;
  hull: number;
  /** Obratnost (kostky obrany). */
  agility?: number;
  /** Sloty: small = 1 malý modul, flex = 1 velký nebo 2 malé. */
  slots: { id: SlotId; name: string; size: "small" | "flex" }[];
  /** Pohybové možnosti lodi. */
  profile: ManeuverProfile;
}

export interface PilotDef {
  id: string;
  name: string;
  description: string;
  abilities: string[];
}

export interface ModuleDef {
  id: ModuleType;
  name: string;
  short: string;
  icon: string;
  size: "small" | "large";
  weight: number;
  price: number;
  description: string;
  /** Munice na modul a váha jednoho kusu. */
  ammo?: number;
  ammoWeight?: number;
  shieldType?: ShieldType;
  shields?: number;
}

/** Směr, kam modul míří (vůči lodi). */
export type Facing = SlotId;

/** Modul osazený v lodi. */
export interface ModuleInstance {
  id: string;
  type: ModuleType;
  slot: SlotId;
  ammo?: number;
  /** Natočení zbraně (lasery: výseč, miny: strana odhozu, torpéda: směr výletu). Štíty směr nemají. */
  facing?: Facing;
  /** Skener: náboje a zbývající kola cooldownu (po něm plné náboje). */
  charges?: number;
  cooldown?: number;
}

/** Sestavená loď = trup + pilot + moduly → výsledné statistiky. */
export interface ShipLoadout {
  hullId: string;
  pilotId: string;
  modules: ModuleInstance[];
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
  /** Počet segmentových štítových modulů (životy segmentu = počet × segmentHp). */
  segmentModules: number;
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
  loadout?: ShipLoadout;
  /** Kredity: zbytek rozpočtu + odměny za sestřely a přežití. */
  credits?: number;
}

/** Vyhozený modul plující vesmírem – lze sestřelit laserem za odměnu. */
export interface Debris {
  id: string;
  type: ModuleType;
  x: number;
  y: number;
  team: number;
  /** Odměna za sestřelení. */
  value: number;
}

export interface GameSettings {
  mode: GameMode;
  /** 0 = bez limitu. */
  turnLimit: number;
  shipsPerPlayer: number;
  /** Max. kusů modulu na hráče (0 = zakázán; chybí = bez limitu). */
  allowedModules: Partial<Record<ModuleType, number>>;
  /** Výbava botů: výchozí sestava, náhodná, nebo ruční (host ji nakliká). */
  botLoadout: "default" | "random" | "manual";
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
  debris: Debris[];
  players: PlayerInfo[];
  /** Týmy, které mají do konce kola odkrytou mapu (hluboký sken). */
  revealTeams?: number[];
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
  | { type: "debrisShot"; debrisId: string; shooterId: string; x: number; y: number; destroyed: boolean; reward: number }
  | { type: "jettison"; shipId: string; debris: Debris }
  | { type: "credits"; playerId: string; delta: number; total: number; reason: "kill" | "survive" | "debris" }
  /** Skener (vyhodnocuje se hned při plánování, ale zapisuje se do logu kola). */
  | { type: "scan"; shipId: string; mode: "ship" | "deep" | "cooldown"; targetId?: string }
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
