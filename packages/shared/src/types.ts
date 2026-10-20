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
  /** Vyhození modulu z lodi nebo z nákladu (odlehčení) – modul zůstane jako trosky, které jde sestřelit za odměnu. */
  | { type: "jettison"; moduleId: string }
  /** Zvednutí nákladu (trosek) v dosahu kolem lodi do nákladového prostoru; před pohybem, rychlost ≤ limit. */
  | { type: "pickup"; targetId?: string }
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
  /** Kulomet: dávka na začátku kola (1 akce), ze kterého modulu. */
  fireMg?: boolean;
  mgModuleId?: string;
  /** Preferovaný cíl laserů (loď nebo torpédo); když není ve výseči, střílí se na nejbližší nepřátelskou loď. */
  preferredTargetId?: string;
}

/** Sloty stíhače. */
export type SlotId = "front" | "back" | "left" | "right";
export type ModuleType = "laser" | "torpedo" | "mine" | "shield-segment" | "shield-whole" | "scanner" | "mg";

/** Trup lodi – nese moduly ve slotech. */
export interface HullDef {
  id: string;
  name: string;
  description: string;
  /** Poloměr pro vykreslení, výběr a hrubé testy (opsaná kružnice modelu se nepoužívá pro kolize). */
  radius: number;
  /** Cena trupu v lodních bodech (zakladatel dává hráči lodní rozpočet). */
  points: number;
  /** Kolizní kruhy v souřadnicích lodi (+x příď, +y pravobok); bez nich se použije jeden kruh `radius`. */
  colliders?: { x: number; y: number; r: number }[];
  hull: number;
  /** Obratnost (kostky obrany). */
  agility?: number;
  /** Sloty: small = 1 malý modul, flex = 1 velký nebo 2 malé. */
  slots: { id: SlotId; name: string; size: "small" | "flex" }[];
  /** Nákladový prostor: počet malých modulů, které loď uveze (nefungují, jen váží). */
  cargo: number;
  /** Pohybové možnosti lodi. */
  profile: ManeuverProfile;
}

/** Modifikátory pilota (přičítají se ke statistikám lodi). */
export interface PilotMods {
  /** Kostky útoku laserů. */
  attack: number;
  /** Kostky obrany. */
  agility: number;
  /** Maximum stresových bodů. */
  stressMax: number;
  /** Maximální rychlost. */
  maxSpeed: number;
  /** Trup v % (např. +10). */
  hullPct: number;
}

export interface PilotDef {
  id: string;
  name: string;
  description: string;
  /** Slovní popis schopností (pro panel pilota); u editovaných pilotů se generuje z modifikátorů. */
  abilities: string[];
  mods: PilotMods;
  /** Unikátní na hráče (jen jeden v letce); Kadet se může opakovat. */
  unique: boolean;
  /** Vestavěný pilot (nejde smazat, jde upravit). */
  builtin?: boolean;
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
  /** Cena jednoho kusu munice při dokupování (levnější než prodat prázdný a koupit nový). */
  ammoPrice?: number;
  /** Životy modulu: zranění trupu ho poškozuje, při 0 přestane fungovat. */
  hp: number;
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
  /** Zbývající životy modulu (chybí = plné). 0 = zničený: nefunguje, prodá se jen za zlomek ceny. */
  hp?: number;
  /** Modul už byl v bitvě – prodá se jen za část ceny (nový se vrací za plnou). */
  used?: boolean;
  /** Záchranná výbava (dar po krachu) – nejde prodat. */
  gift?: boolean;
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
  /** Náklad: zvednuté moduly (nefungují, jen váží; lze je vyhodit, mezi bitvami nasadit nebo prodat). */
  cargo?: ModuleInstance[];
}

export interface ShipStats {
  attack: number;
  agility: number;
  hull: number;
  shields: number;
  torpedoes: number;
  mines: number;
  radius: number;
  /** Kolizní kruhy v souřadnicích lodi (viz HullDef.colliders). */
  colliders: { x: number; y: number; r: number }[];
  /** Dohled (fog of war). */
  vision: number;
  /** Maximum stresových bodů (ladění + pilot). */
  stressMax: number;
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

/**
 * Kometa: malý kámen letící vysokou rychlostí přímo přes mapu. Lze ji sestřelit zbraněmi; náraz zraní loď.
 * Za kometou je ocas – loď, která jím proletí, si doplní štít (každá loď jednou za kometu).
 */
export interface Comet extends Pose {
  id: string;
  /** Ujetá vzdálenost za kolo. */
  speed: number;
  hull: number;
  maxHull: number;
  radius: number;
  /** Lodě, které už ocas této komety využily. */
  tailUsed: string[];
}

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
  /** Letka: jedna výbava na loď (chybí = jedna loď podle `loadout`). */
  loadouts?: ShipLoadout[];
  /** Kredity: zbytek rozpočtu + odměny za sestřely a přežití. */
  credits?: number;
  /** Zvolený startovní bod (index v generované mapě). */
  startIndex?: number;
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
  /** Původní modul (s municí) – při zvednutí se vrátí do nákladu. */
  module?: ModuleInstance;
}

/** Nastavení generované mapy. */
export interface MapSettings {
  size: "small" | "medium" | "large" | "huge";
  asteroids: "none" | "few" | "medium" | "many";
  /** Asteroidy ve shlucích (pásech). */
  clusters: boolean;
  /** Počet bouří (0–5). */
  storms: number;
  stormSize: "small" | "medium" | "large";
  seed: number;
  /** Zrcadlově symetrická mapa (férová pro týmy). */
  symmetric: boolean;
  /** Komety: jak často přilétají (šance za kolo a limit – v ladění). */
  comets: "none" | "few" | "medium" | "many";
  /** Komety naráží do asteroidů (zmizí a vykousnou kráter); jinak jimi proletí. */
  cometsHitAsteroids: boolean;
}

/** Elektromagnetická bouře: shluk kruhů. Uvnitř nefungují štíty ani lasery, torpéda letí rovně, skener a dohled nepronikne. */
export interface Storm {
  id: string;
  blobs: { x: number; y: number; r: number }[];
}

export interface GameSettings {
  mode: GameMode;
  /** 0 = bez limitu. */
  turnLimit: number;
  /** Lodní body na hráče: součet cen trupů letky musí být přesně tento (stíhač = 1). */
  shipPoints: number;
  /** Max. kusů modulu na hráče (0 = zakázán; chybí = bez limitu). */
  allowedModules: Partial<Record<ModuleType, number>>;
  /** Zakázané trupy (0 = zakázán; chybí = povolen). */
  allowedHulls?: Partial<Record<string, number>>;
  /** Zakázaní piloti (0 = zakázán; chybí = povolen). */
  allowedPilots?: Partial<Record<string, number>>;
  /** Výbava botů: výchozí sestava, náhodná, nebo ruční (host ji nakliká). */
  botLoadout: "default" | "random" | "manual";
  /** Generovaná mapa (chybí = klasická pevná mapa 1). */
  map?: MapSettings;
}

export interface GameResult {
  /** V TDM číslo vítězného týmu, v DM id vítěze; null = remíza. */
  winnerTeam: number | null;
  winnerPlayerId: string | null;
  reason: "elimination" | "turnLimit";
}

/** Statistiky hráče za bitvu (žebříček). */
export interface PlayerStats {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  creditsEarned: number;
  maneuvers: { green: number; white: number; red: number; danger: number; koiogran: number };
  lasersFired: number;
  laserHits: number;
  mgShots: number;
  mgHits: number;
  torpedoesFired: number;
  minesDropped: number;
  scans: number;
  /** Sestřelené komety a průlety ocasem. */
  cometsShot?: number;
  cometTails?: number;
}

export interface GameState {
  turn: number;
  settings: GameSettings;
  /** Piloti platní v této bitvě (editovatelní na serveru). */
  pilots?: PilotDef[];
  /** Ladicí parametry platné pro tuto bitvu. */
  tuning: Tuning;
  width: number;
  height: number;
  asteroids: Asteroid[];
  storms: Storm[];
  ships: Ship[];
  torpedoes: Torpedo[];
  mines: Mine[];
  debris: Debris[];
  comets?: Comet[];
  players: PlayerInfo[];
  /** Týmy, které mají do konce kola odkrytou mapu (hluboký sken). */
  revealTeams?: number[];
  /** Statistiky hráčů (klíč = id hráče). */
  stats?: Record<string, PlayerStats>;
  status: "planning" | "finished";
  result?: GameResult;
}

export type DieFace = "hit" | "crit" | "focus" | "blank" | "evade";

/** Události jednoho kola – klient podle nich animuje. */
export type TurnEvent =
  | { type: "move"; paths: MovePath[] }
  | { type: "collision"; shipId: string; with: "ship" | "asteroid" | "edge" | "comet"; otherId?: string; t: number; newHeading: number }
  /** Kometa: přílet na okraj mapy, zásah zbraní (lasery/kulomet před pohybem), zánik během pohybu (náraz do lodi/asteroidu/torpéda/miny, odlet z mapy). */
  | { type: "spawnComet"; comet: Comet }
  | { type: "cometShot"; cometId: string; shooterId: string; x: number; y: number; damage: number; hullAfter: number; destroyed: boolean; reward: number }
  | { type: "cometGone"; cometId: string; x: number; y: number; t: number; reason: "ship" | "asteroid" | "torpedo" | "mine" | "edge" | "comet"; shipId?: string; damage?: number }
  /** Průlet ocasem komety: co loď dostala. */
  | { type: "cometTail"; cometId: string; shipId: string; t: number; x: number; y: number; effect: "shield" | "segment" | "hull" | "credits" | "stress"; amount: number; segment?: number }
  | { type: "mineBlast"; mineId: string; x: number; y: number; t: number; hits: { shipId: string; damage: number }[] }
  | { type: "torpedoHit"; torpedoId: string; shipId?: string; x: number; y: number; t: number; damage: number; blast: boolean }
  | { type: "asteroidHit"; asteroidId: string; x: number; y: number; t: number; profile: number[]; destroyed: boolean }
  | { type: "torpedoExpire"; torpedoId: string; x: number; y: number }
  | { type: "torpedoShot"; torpedoId: string; shooterId: string; x: number; y: number; attackDice: DieFace[]; defenseDice: DieFace[]; destroyed: boolean }
  | { type: "debrisShot"; debrisId: string; shooterId: string; x: number; y: number; destroyed: boolean; reward: number }
  | { type: "jettison"; shipId: string; debris: Debris ; dropped?: boolean }
  /** Zvednutí nákladu: ok = zvednuto; jinak důvod (lost = předmět uchvátila jiná loď). */
  | { type: "pickup"; shipId: string; debrisId: string; x: number; y: number; ok: boolean; reason?: "lost" | "range" | "speed" | "full" | "gone"; winnerId?: string; module?: ModuleInstance }
  | { type: "credits"; playerId: string; delta: number; total: number; reason: "kill" | "survive" | "debris" | "comet" | "tail" }
  | { type: "moduleDamage"; shipId: string; moduleId: string; moduleType: ModuleType; damage: number; hp: number; maxHp: number; broken: boolean }
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
  /** Dávka kulometu: počet projektilů, zásahy, celkové zranění; úhly rozptylu pro animaci (rad, relativně ke směru na cíl). */
  | { type: "mg"; shooterId: string; targetId: string; from: Pose; to: Pose; shots: number; hits: number; damage: number; spread: number[]; destroyed?: boolean }
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
  | { type: "evadePass"; shipId: string; victimId: string; t: number; x: number; y: number }
  /** Úhybný manévr: průlet skrz asteroid / kometu (bez srážky). */
  | { type: "evadeThrough"; shipId: string; with: "asteroid" | "comet"; otherId: string; t: number; x: number; y: number };

export interface MovePath {
  id: string;
  kind: "ship" | "torpedo" | "comet";
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
