import type { Asteroid, Comet, Debris, GameState, Mine, Pose, Segments, ShieldType, Ship, Torpedo, TorpedoPhase } from "@wingfighter/shared";

/** Co se právě kreslí – během plánování kopie stavu, během animace průběžně měněný model. */
export interface ViewShip extends Pose {
  id: string;
  team: number;
  name: string;
  hull: number;
  maxHull: number;
  shields: number;
  maxShields: number;
  shieldType: ShieldType;
  shieldEff: number;
  segments: Segments;
  /** Úhybný manévr – probíhá (nastavuje animace); `roll` = fáze sudového překrutu (0–2π). */
  evading?: boolean;
  roll?: number;
  stressPoints: number;
  stressMax: number;
  /** Trup (pro výběr spritu). */
  hullId: string;
  radius: number;
  /** Kolizní kruhy v souřadnicích lodi. */
  colliders: { x: number; y: number; r: number }[];
  alive: boolean;
  tokens: { focus: number; evade: number };
  lockTargetId?: string;
  /** Zbývající zásoba (pro panel). */
  ammo: { torpedoes: number; mines: number };
}

export interface ViewTorpedo extends Pose {
  id: string;
  team: number;
  targetPoint?: { x: number; y: number };
  /** Fáze a rychlost (délka plamene). */
  phase: TorpedoPhase;
  speed: number;
  lost?: boolean;
}

export interface ViewStation {
  id: string;
  x: number;
  y: number;
  radius: number;
  hull: number;
  maxHull: number;
  shields: number;
  maxShields: number;
  broken: boolean;
  stock: number;
}

export interface ViewMine {
  id: string;
  team: number;
  x: number;
  y: number;
  radius: number;
  armed: boolean;
  timer?: number;
}

export type Effect =
  | { kind: "explosion"; x: number; y: number; size: number; start: number; duration: number; color?: string }
  | { kind: "laser"; from: Pose; to: Pose; color: string; start: number; duration: number; hit: boolean }
  /** Projektil kulometu: krátká stopa letící od střelce směrem k cíli (s rozptylem), hit = zasáhne. */
  | { kind: "tracer"; from: Pose; to: Pose; angle: number; hit: boolean; start: number; duration: number }
  | { kind: "ring"; x: number; y: number; radius: number; color: string; start: number; duration: number }
  | { kind: "text"; x: number; y: number; text: string; color: string; start: number; duration: number }
  | { kind: "shield"; shipId: string; start: number; duration: number }
  | { kind: "launch"; x: number; y: number; heading: number; color: string; start: number; duration: number }
  | { kind: "drop"; from: { x: number; y: number }; to: { x: number; y: number }; color: string; start: number; duration: number }
  | { kind: "segmentHit"; shipId: string; segment: number; start: number; duration: number }
  /** Vlnky při průletu úhybu skrz nepřátelskou loď. */
  | { kind: "ripple"; x: number; y: number; color: string; start: number; duration: number };

export type ViewDebris = Debris;

export interface ViewComet extends Pose {
  id: string;
  radius: number;
  hull: number;
  maxHull: number;
  speed: number;
  /** Lodě, které ocas už využily (pro zobrazení). */
  tailUsed: string[];
}

export interface ViewModel {
  ships: ViewShip[];
  torpedoes: ViewTorpedo[];
  debris: ViewDebris[];
  comets: ViewComet[];
  mines: ViewMine[];
  stations: ViewStation[];
  asteroids: Asteroid[];
  effects: Effect[];
}

export function shipToView(s: Ship): ViewShip {
  return {
    id: s.id,
    team: s.team,
    name: s.name,
    x: s.x,
    y: s.y,
    heading: s.heading,
    hull: s.hull,
    maxHull: s.stats.hull,
    shields: s.shields,
    maxShields: s.stats.shields,
    shieldType: s.shieldType,
    shieldEff: s.shieldEff,
    segments: [...s.segments] as Segments,
    stressPoints: s.stressPoints,
    stressMax: s.stats.stressMax,
    hullId: s.loadout.hullId,
    radius: s.stats.radius,
    colliders: s.stats.colliders,
    alive: s.alive,
    tokens: { ...s.tokens },
    lockTargetId: s.lockTargetId,
    ammo: { ...s.ammo },
  };
}

export function torpedoToView(t: Torpedo): ViewTorpedo {
  return { id: t.id, team: t.team, x: t.x, y: t.y, heading: t.heading, targetPoint: t.targetPoint, phase: t.phase, speed: t.speed, lost: t.lost };
}

export function cometToView(c: Comet): ViewComet {
  return { id: c.id, x: c.x, y: c.y, heading: c.heading, radius: c.radius, hull: c.hull, maxHull: c.maxHull, speed: c.speed, tailUsed: [...c.tailUsed] };
}

export function mineToView(m: Mine): ViewMine {
  return { id: m.id, team: m.team, x: m.x, y: m.y, radius: m.radius, armed: m.armed, timer: m.timer };
}

export function viewFromState(state: GameState): ViewModel {
  return {
    ships: state.ships.filter((s) => s.alive).map(shipToView),
    torpedoes: state.torpedoes.map(torpedoToView),
    debris: (state.debris ?? []).map((d) => ({ ...d })),
    comets: (state.comets ?? []).map(cometToView),
    mines: state.mines.map(mineToView),
    stations: (state.stations ?? []).map((st) => ({ ...st })),
    asteroids: structuredClone(state.asteroids),
    effects: [],
  };
}
