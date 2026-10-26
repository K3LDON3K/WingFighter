import { ASTEROID_SEGMENTS, asteroidDestroyed, carveCrater, circleHitsAsteroid, lineBlocked } from "./asteroids.ts";
import {
  CARGO,
  COLLISION_SCATTER,
  COMET,
  LASER,
  LOCK_RANGE,
  MAX_DEFLECTIONS,
  MINE,
  MOVE_STEPS,
  MOVE_UNIT,
  MG,
  RULES,
  SCANNER,
  SHIELD_GAP,
  STATION,
  DROID,
  HACK,
  REPAIR,
  STRESS,
  TORPEDO,
  TORPEDO_AGILITY,
} from "./constants.ts";
import { attackOdds, resolveAttack } from "./dice.ts";
import {
  circlesOverlap,
  clamp,
  dist,
  forward,
  inArc,
  makePath,
  normalizeAngle,
  rightOf,
  samplePath,
  type Pose,
  type Vec,
} from "./geometry.ts";
import { listManeuvers, makeManeuver, maneuverId, maneuverLength, maneuverPath, maneuverStress, parseManeuverId, resolveManeuver, stressCost } from "./maneuvers.ts";
import { activeShield, allowedFacings, cargoCapacity, computeStats, defaultFacing, hasFacing, hullOf, laserRange, mgRange, torpedoLockRange, torpedoPointRange, facingAngle, laserHalfArc, mineSideOf, modulePos, moduleHp, moduleMaxHp, moduleUsable, moduleWorking, MODULES, MODULE_CATEGORY, MODULE_TYPES, newModule, normalizeShields, occupiedSlots, profileOf, shieldTypeOf } from "./ships.ts";
import { lineCrossesStorm, pointInStorm } from "./mapgen.ts";
import { beyondHardEdge, edgeNormal, insideMap, pointOnEdge, reflectAtEdge } from "./mapshape.ts";

/** Je loď/bod v elektromagnetické bouři? */
export function inStorm(state: GameState, p: Vec): boolean {
  if (inBorderStorm(state, p)) return true;
  return pointInStorm(state.storms ?? [], p);
}
/** Je bod v okrajové bouři (mimo ovál hrací plochy; pás i vše za ním)? */
export function inBorderStorm(state: Pick<GameState, "width" | "height" | "border">, p: Vec): boolean {
  return !!state.border && !insideMap(state, p);
}
/** Laserová čára: nesmí začínat ani končit v bouři a nesmí ji protínat. */
function laserBlockedByStorm(state: GameState, a: Vec, b: Vec): boolean {
  return (state.storms?.length ?? 0) > 0 && (inStorm(state, a) || inStorm(state, b) || lineCrossesStorm(state.storms, a, b));
}
import type { Difficulty, DroidOrder, HackOrder, ManeuverProfile, ModuleInstance, ModuleType, RepairOrder } from "./types.ts";

/** Pozice lodi natočená podle směru modulu (výseč laserů, výlet torpéda). */
/** Odkud a kam modul míří: z pozice slotu na trupu, ve směru natočení modulu. */
export function aimPose(ship: Pose, mod: ModuleInstance | undefined): Pose {
  const p = modulePos(ship, mod);
  return { x: p.x, y: p.y, heading: ship.heading + facingAngle(mod?.facing) };
}

/**
 * Podíl cíle uvnitř výseče (0–1): kolizní kruhy cíle se navzorkují mřížkou a spočítá se, kolik bodů leží
 * v dostřelu i v úhlu výseče. Cíl jde zaměřit, jakmile je podíl > 0; šance na zásah se jím násobí.
 */
export function sectorCoverage(aim: Pose, range: number, halfArc: number, target: Ship): number {
  return sectorHit(aim, range, halfArc, target).coverage;
}

/**
 * Zasažená plocha cíle ve výseči: podíl (coverage), průměrná vzdálenost zasažených bodů (meanDist)
 * a pásmo dostřelu podle plochy: nejbližší pásmo, ve kterém leží aspoň pětina zasažené plochy
 * (jinak pásmo s největší plochou). U velké lodi tak bonus zblízka platí, když je v blízkém pásmu kus trupu, ne jen pixel.
 */
export function sectorHit(aim: Pose, range: number, halfArc: number, target: Ship): { coverage: number; meanDist: number; band: number } {
  const circles = shipCircles(target, target.stats.colliders ?? [{ x: 0, y: 0, r: target.stats.radius }]);
  const STEP = 3; // mřížka s pevným krokem (jednotky) – počet bodů odpovídá ploše, velký trup váží víc než špice
  let inside = 0;
  let total = 0;
  let sumDist = 0;
  const perBand = [0, 0, 0, 0];
  for (const c of circles) {
    const N = Math.max(2, Math.ceil(c.r / STEP));
    for (let i = -N; i <= N; i++)
      for (let j = -N; j <= N; j++) {
        const dx = (i / N) * c.r;
        const dy = (j / N) * c.r;
        if (dx * dx + dy * dy > c.r * c.r) continue;
        total++;
        const p = { x: c.x + dx, y: c.y + dy };
        const d = dist(aim, p);
        if (d <= range && inArc(aim, p, halfArc)) {
          inside++;
          sumDist += d;
          perBand[clamp(Math.ceil(d / LASER.band), 1, 3)]++;
        }
      }
  }
  const dCenter = dist(aim, target);
  if (!inside) return { coverage: 0, meanDist: dCenter, band: clamp(Math.ceil(dCenter / LASER.band), 1, 3) };
  let band = 0;
  for (let b = 1; b <= 3; b++) if (perBand[b] >= inside / 5) { band = b; break; }
  if (!band) band = perBand.indexOf(Math.max(perBand[1], perBand[2], perBand[3]));
  return { coverage: inside / total, meanDist: sumDist / inside, band };
}
import type { Rng } from "./rng.ts";
import { applyTuning } from "./tuning.ts";
import type {
  ActionOrder,
  Asteroid,
  Comet,
  Debris,
  SlotId,
  Facing,
  GameResult,
  GameState,
  Maneuver,
  Mine,
  MineSide,
  MovePath,
  PlayerStats,
  Segments,
  Ship,
  Station,
  ShipOrders,
  Shot,
  Storm,
  Torpedo,
  TurnEvent,
  TurnResult,
} from "./types.ts";
import { boundingRadius, shipCircles, shipHitsAsteroid, shipHitsCircle, shipInsideMap, shipsOverlap, shipsOverlapPadded } from "./colliders.ts";

/* ------------------------------------------------------------------ */
/* Pomocné                                                              */
/* ------------------------------------------------------------------ */

function shipById(state: GameState, id: string | undefined): Ship | undefined {
  return id ? state.ships.find((s) => s.id === id) : undefined;
}

function torpedoById(state: GameState, id: string | undefined): Torpedo | undefined {
  return id ? state.torpedoes.find((t) => t.id === id) : undefined;
}

function isInsideMap(state: GameState, p: Vec, r: number): boolean {
  return insideMap(state, p, r);
}

/** Stanice jako kruhové „asteroidy“ pro geometrii (překážka, kryje střelbu); id = id stanice. */
export function stationObstacles(state: Pick<GameState, "stations">): Asteroid[] {
  return (state.stations ?? []).map((st) => ({ id: st.id, x: st.x, y: st.y, radius: st.radius, profile: new Array<number>(ASTEROID_SEGMENTS).fill(st.radius), version: 0, vx: 0, vy: 0, seed: 0 }));
}
/** Všechny pevné překážky: asteroidy + stanice. */
export function obstacles(state: Pick<GameState, "asteroids" | "stations">): Asteroid[] {
  return state.stations?.length ? [...state.asteroids, ...stationObstacles(state)] : state.asteroids;
}
export function isStationId(state: Pick<GameState, "stations">, id: string): boolean {
  return !!state.stations?.some((st) => st.id === id);
}

function hitsAsteroid(state: GameState, p: Vec, r: number): Asteroid | undefined {
  for (const a of obstacles(state)) if (circleHitsAsteroid(a, p, r)) return a;
  return undefined;
}

/**
 * Zranění stanice: energetický štít (lasery jen vybíjejí, projektily prorazí % do trupu). Při zničení výbuch
 * (zraní lodě v okruhu), odměna střelci a 1–2 moduly ze zásoby se vysypou jako trosky; stanice zůstane rozbitá.
 */
export function damageStation(state: GameState, st: Station, amount: number, kind: DamageKind, events: TurnEvent[], byId?: string, t?: number, hitShips?: (c: Vec, radius: number, damage: number, exceptOwnerId?: string) => void, rng?: Rng): void {
  if (st.broken || amount <= 0) return;
  let absorbed = 0;
  let toHull = amount;
  if (st.shields > 0) {
    const pierced = kind === "kinetic" ? Math.round((amount * RULES.wholePiercePct) / 100) : 0;
    absorbed = Math.min(st.shields, amount - pierced);
    st.shields -= absorbed;
    toHull = amount - absorbed;
  }
  st.hull = Math.max(0, st.hull - toHull);
  events.push({ type: "stationHit", stationId: st.id, shooterId: byId, damage: amount, absorbed, hullAfter: st.hull, shieldsAfter: st.shields, x: st.x, y: st.y, t });
  if (st.hull > 0) return;
  st.broken = true;
  st.shields = 0;
  const shooter = byId ? shipById(state, byId) : undefined;
  if (shooter) awardCredits(state, events, shooter.ownerId, STATION.reward, "station");
  events.push({ type: "stationDestroyed", stationId: st.id, byId, x: st.x, y: st.y, reward: shooter ? STATION.reward : 0, t });
  if (hitShips && STATION.blastDamage > 0) hitShips(st, STATION.blastRadius, STATION.blastDamage);
  // vysypané moduly ze zásoby (1–2) kolem stanice
  const drop = Math.min(st.stock, 1 + Math.floor((rng?.next() ?? 0.5) * 2));
  for (let i = 0; i < drop; i++) {
    const mod = randomStationModule(state, rng);
    if (!mod) break;
    st.stock--;
    const ang = (rng?.next() ?? Math.random()) * Math.PI * 2;
    const d = st.radius + 40 + (rng?.next() ?? 0.5) * 40;
    const debris: Debris = { id: `debris-st-${st.id}-${state.turn}-${i}`, type: mod.type, x: clamp(st.x + Math.cos(ang) * d, 0, state.width), y: clamp(st.y + Math.sin(ang) * d, 0, state.height), team: -1, value: Math.round((MODULES[mod.type].price * RULES.debrisRewardPct) / 100), module: mod };
    state.debris.push(debris);
    events.push({ type: "jettison", shipId: "", debris, dropped: true });
  }
}

/** Náhodný modul ze zásoby stanice: z povolených modulů hry, bez droidů. */
export function randomStationModule(state: GameState, rng?: Rng): ModuleInstance | undefined {
  const allowed = state.settings.allowedModules ?? {};
  const types = MODULE_TYPES.filter((t) => allowed[t] !== 0 && MODULE_CATEGORY[t] !== "droid");
  if (!types.length) return undefined;
  const type = types[Math.floor((rng?.next() ?? Math.random()) * types.length)];
  return newModule(type, "front", `st-${type}-${Math.floor((rng?.next() ?? Math.random()) * 1e6).toString(36)}`);
}

/** Stanice v okruhu sběru lodi (střed lodi uvnitř okruhu). */
export function stationInPickupRange(state: GameState, p: Vec): Station | undefined {
  return (state.stations ?? []).find((st) => dist(st, p) <= st.radius + STATION.pickupRange);
}

/** Který segment štítu zásah trefí: podle směru, odkud přišel (0 předek, 1 pravobok, 2 záď, 3 levobok). */
export function hitSegment(ship: Pose, from: Vec): number {
  const rel = normalizeAngle(Math.atan2(from.y - ship.y, from.x - ship.x) - ship.heading);
  const a = Math.abs(rel);
  if (a <= Math.PI / 4) return 0;
  if (a >= (3 * Math.PI) / 4) return 2;
  return rel > 0 ? 1 : 3;
}

/**
 * Odečte zranění přes štít. `from` = odkud zásah přišel (undefined = vnitřní, např. nebezpečný manévr → rovnou trup).
 * Celolodní: pohltí `účinnost %` ze zásoby, zbytek do trupu, účinnost klesne.
 * Segmentový: segment se životy pohltí celý zásah a ztratí 1 život; bez životů jde vše do trupu.
 */
/** Ochranná lhůta torpéda: prvních `safeTurns` kol nemůže zranit vlastníka (ani nárazem, ani výbuchem). */
export function torpedoSafe(t: Torpedo): boolean {
  return TORPEDO.lifeTurns - t.lifeLeft < TORPEDO.safeTurns;
}

/** Statistiky hráče (vytvoří prázdné, pokud chybí). */
export function statsOf(state: GameState, playerId: string | undefined): PlayerStats | undefined {
  if (!playerId) return undefined;
  if (!state.stats) state.stats = {};
  return (state.stats[playerId] ??= { damageDealt: 0, damageTaken: 0, kills: 0, deaths: 0, creditsEarned: 0, maneuvers: { green: 0, white: 0, red: 0, danger: 0, koiogran: 0 }, lasersFired: 0, laserHits: 0, mgShots: 0, mgHits: 0, torpedoesFired: 0, minesDropped: 0, scans: 0 });
}

/** Kontext pro připisování kreditů během vyhodnocení (nastavuje resolveTurn). */
let creditCtx: { state: GameState; events: TurnEvent[]; rng: Rng; turn: number } | null = null;

/** Po změně modulů srovná štíty s tím, co funkční moduly unesou. */
function syncShields(ship: Ship): void {
  // zničený zapnutý štít → automaticky se zapne další funkční (záloha startuje plná)
  ship.loadout = normalizeShields(ship.loadout);
  refreshShip(ship);
  const nowType = shieldTypeOf(ship.loadout);
  if (nowType !== ship.shieldType) {
    ship.shieldType = nowType;
    ship.segments = nowType === "segment" ? ([1, 1, 1, 1].map(() => RULES.segmentHp * ship.stats.segmentModules) as Segments) : [0, 0, 0, 0];
    ship.shields = nowType === "whole" ? ship.stats.shields : 0;
    ship.shieldEff = 100;
    return;
  }
  if (ship.shieldType !== "none" && ship.stats.segmentModules === 0 && ship.stats.shields === 0) {
    ship.shieldType = "none";
    ship.segments = [0, 0, 0, 0];
    ship.shields = 0;
  } else if (ship.shieldType === "segment") {
    const cap = RULES.segmentHp * ship.stats.segmentModules;
    ship.segments = ship.segments.map((v) => Math.min(v, cap)) as Segments;
  } else if (ship.shieldType === "whole") ship.shields = Math.min(ship.shields, ship.stats.shields);
}

/**
 * Zranění trupu poškodí i modul: směrovaný zásah modul na zasažené straně (slot příď / pravobok / záď / levobok),
 * nesměrovaný (výbuch, náraz) náhodný funkční modul. Při 0 hp modul přestane fungovat.
 */
function damageModule(ship: Ship, hullDamage: number, events: TurnEvent[], from?: Vec): void {
  if (!creditCtx || hullDamage <= 0 || RULES.moduleDamagePct <= 0) return;
  const dmg = Math.max(1, Math.round((hullDamage * RULES.moduleDamagePct) / 100));
  const working = ship.loadout.modules.filter(moduleWorking);
  if (working.length === 0) return;
  let target: ModuleInstance | undefined;
  if (from) {
    const side: Facing = (["front", "right", "back", "left"] as Facing[])[hitSegment(ship, from)];
    const sideSlots: SlotId[] = side === "left" ? ["left", "podLeft"] : side === "right" ? ["right", "podRight"] : [side];
    target = working.find((m) => occupiedSlots(m).some((s) => sideSlots.includes(s)));
    if (!target) return; // na zasažené straně nic není
  } else target = working[Math.floor(creditCtx.rng.next() * working.length)];
  const hp = Math.max(0, moduleHp(target) - dmg);
  target.hp = hp;
  const broken = hp === 0;
  events.push({ type: "moduleDamage", shipId: ship.id, moduleId: target.id, moduleType: target.type, damage: dmg, hp, maxHp: moduleMaxHp(target.type), broken });
  if (broken) syncShields(ship);
}

/** Zničená loď: každý modul (i z nákladu) s danou šancí vypadne jako trosky do náhodného směru. */
function dropModules(ship: Ship, events: TurnEvent[]): void {
  if (!creditCtx) return;
  const { state, rng, turn } = creditCtx;
  let all = [...ship.loadout.modules, ...(ship.loadout.cargo ?? [])];
  // bot: vždy právě jeden náhodný funkční modul (hráč: každý modul podle šance)
  const isBot = state.players.find((p) => p.id === ship.ownerId)?.isBot ?? false;
  if (isBot) {
    const working = all.filter((m) => moduleWorking(m));
    all = working.length ? [working[Math.floor(rng.next() * working.length)]] : [];
  }
  for (const mod of all) {
    if (!isBot && rng.next() * 100 >= RULES.moduleDropChance) continue;
    // vypadlý modul už vraku nepatří (po bitvě se hráči nevrátí)
    ship.loadout.modules = ship.loadout.modules.filter((m) => m.id !== mod.id);
    if (ship.loadout.cargo) ship.loadout.cargo = ship.loadout.cargo.filter((m) => m.id !== mod.id);
    const ang = rng.next() * Math.PI * 2;
    const dist = 40 + rng.next() * 50;
    const debris: Debris = {
      id: `debris-${turn}-${ship.id}-${mod.id}`,
      type: mod.type,
      x: clamp(ship.x + Math.cos(ang) * dist, 0, state.width),
      y: clamp(ship.y + Math.sin(ang) * dist, 0, state.height),
      team: ship.team,
      value: Math.round((MODULES[mod.type].price * RULES.debrisRewardPct * (moduleWorking(mod) ? 1 : RULES.brokenSellPct / 100)) / 100),
      module: { ...mod },
    };
    state.debris.push(debris);
    events.push({ type: "jettison", shipId: ship.id, debris, dropped: true });
  }
}

/** Připíše hráči kredity a zapíše událost. */
export function awardCredits(state: GameState, events: TurnEvent[], playerId: string | undefined, delta: number, reason: "kill" | "survive" | "debris" | "comet" | "tail" | "station"): void {
  if (!playerId || delta <= 0) return;
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  p.credits = (p.credits ?? 0) + delta;
  const st = statsOf(state, playerId);
  if (st) {
    st.creditsEarned += delta;
    if (reason === "kill") st.kills++;
  }
  events.push({ type: "credits", playerId, delta, total: p.credits, reason });
}

/** Přepočítá statistiky a souhrn munice po změně modulů. */
export function refreshShip(ship: Ship): void {
  ship.stats = computeStats(ship.loadout);
  ship.ammo = { torpedoes: ship.stats.torpedoes, mines: ship.stats.mines };
}

/** Druh zranění: energetické (laser) energetický štít jen vybíjí, ale segmenty proniká; kinetické (projektily, srážky) segment zachytí celé, ale energetický štít částečně prorazí. */
export type DamageKind = "energy" | "kinetic";

function applyDamage(ship: Ship, amount: number, events: TurnEvent[], from?: Vec, by?: string, kind: DamageKind = "kinetic"): void {
  if (amount <= 0 || !ship.alive) return;
  let absorbed = 0;
  let segment: number | undefined;
  let pierced = 0; // část, která prošla štítem do trupu i když štít ještě držel
  const stormed = (!!creditCtx && inStorm(creditCtx.state, ship)) || !!activeShield(ship.loadout)?.hacked; // v bouři (a s hacknutým štítem) štíty nefungují
  if (stormed) {
    /* zásah jde rovnou do trupu */
  } else if (from && ship.shieldType === "segment") {
    segment = hitSegment(ship, from);
    if (ship.segments[segment] > 0) {
      ship.segments[segment]--;
      if (kind === "energy") {
        // laser se mezi poletujícími segmenty protáhne: část zranění projde do trupu
        pierced = Math.round((amount * RULES.segmentPassPct) / 100);
        absorbed = amount - pierced;
      } else absorbed = amount;
    }
  } else if (from && ship.shieldType === "whole" && ship.shields > 0) {
    // projektil pole prorazí: část jde do trupu vždy, zbytek odnese zásoba
    pierced = kind === "kinetic" ? Math.round((amount * RULES.wholePiercePct) / 100) : 0;
    absorbed = Math.min(ship.shields, Math.round(((amount - pierced) * ship.shieldEff) / 100));
    ship.shields -= absorbed;
    ship.shieldEff = Math.max(0, ship.shieldEff - RULES.wholeEffDrop);
  }
  ship.hull -= amount - absorbed;
  damageModule(ship, amount - absorbed, events, from);
  if (creditCtx) {
    const dealer = statsOf(creditCtx.state, by);
    if (dealer && by !== ship.ownerId) dealer.damageDealt += amount;
    const taker = statsOf(creditCtx.state, ship.ownerId);
    if (taker) taker.damageTaken += amount;
  }
  events.push({
    type: "damage",
    shipId: ship.id,
    amount,
    absorbed,
    segment,
    shieldsAfter: ship.shields,
    hullAfter: Math.max(0, ship.hull),
    segmentsAfter: [...ship.segments] as Segments,
    effAfter: ship.shieldEff,
    pierced: pierced > 0 ? pierced : undefined,
    kind,
  });
  if (ship.hull <= 0) {
    ship.hull = 0;
    ship.alive = false;
    events.push({ type: "destroyed", shipId: ship.id, x: ship.x, y: ship.y });
    dropModules(ship, events);
    if (creditCtx) {
      const st = statsOf(creditCtx.state, ship.ownerId);
      if (st) st.deaths++;
    }
    if (creditCtx && by && by !== ship.ownerId) awardCredits(creditCtx.state, creditCtx.events, by, RULES.creditsPerKill, "kill");
  }
}

/* ---------- Komety ---------- */

/** Je bod v ocasu komety (obdélník za jádrem, proti směru letu)? */
export function inCometTail(c: Pose, p: Vec, length = COMET.tailLength, width = COMET.tailWidth, radius = COMET.radius): boolean {
  const f = forward(c.heading);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const along = -(dx * f.x + dy * f.y); // kladné = za kometou
  const across = Math.abs(dx * -f.y + dy * f.x);
  return along >= radius && along <= radius + length && across <= width / 2;
}

/** Nová kometa: z náhodného bodu hrany oválu na náhodný bod protější části hrany. */
export function spawnComet(state: GameState, rng: Rng, id: string): Comet {
  const r = COMET.radius;
  const a0 = rng.next() * Math.PI * 2;
  const a1 = a0 + Math.PI + (rng.next() - 0.5) * (Math.PI * 0.7);
  const from = pointOnEdge(state, a0, r);
  const to = pointOnEdge(state, a1, r);
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  // rychlost náhodně v rozmezí ±COMET.speedVarPct % základu (zaokrouhlená na 10)
  const v = COMET.speedVarPct / 100;
  const speed = Math.max(10, Math.round((COMET.speed * (1 - v + rng.next() * 2 * v)) / 10) * 10);
  // objeví se COMET.approachTurns kol letu za okrajem a na mapu teprve přiletí (do té doby je jen vidět)
  const back = speed * COMET.approachTurns;
  return { id, x: from.x - Math.cos(heading) * back, y: from.y - Math.sin(heading) * back, heading, speed, hull: COMET.hull, maxHull: COMET.hull, radius: r, tailUsed: [], entered: false };
}

/** Je kometa na mapě (střed uvnitř)? Za okrajem je jen vidět – nejde zasáhnout ani do ničeho narazit. */
export function cometOnMap(state: Pick<GameState, "width" | "height">, c: Vec): boolean {
  return insideMap(state, c);
}

/** Kam se mina odhodí vůči startovní pozici lodi. */
export function mineDropPosition(start: Pose, side: MineSide | undefined): Vec {
  const f = forward(start.heading);
  const r = rightOf(start.heading);
  if (side === "left") return { x: start.x - r.x * MINE.dropSide, y: start.y - r.y * MINE.dropSide };
  if (side === "right") return { x: start.x + r.x * MINE.dropSide, y: start.y + r.y * MINE.dropSide };
  return { x: start.x - f.x * MINE.dropBehind, y: start.y - f.y * MINE.dropBehind };
}

/** Úprava štítu: stejný součet jako teď, nic záporného, žádný segment nad max. */
export function validShieldAction(ship: Ship, segments: unknown): segments is Segments {
  if (ship.shieldType !== "segment" || !Array.isArray(segments) || segments.length !== 4) return false;
  const vals = segments.map((n) => Math.round(Number(n)));
  if (vals.some((n) => !Number.isFinite(n) || n < 0 || n > RULES.segmentMax)) return false;
  const sum = vals.reduce((a, b) => a + b, 0);
  const cur = ship.segments.reduce((a, b) => a + b, 0);
  return sum === cur;
}

/** Funkční droid-pilot na lodi. */
export function droidModule(ship: Ship): ModuleInstance | undefined {
  return ship.loadout.modules.find((m) => m.type === "droid" && moduleUsable(m));
}
/** Kolik technologie stojí zapnuté funkce droida. */
export function droidCost(o: Pick<ShipOrders, "droid"> | undefined): number {
  return (o?.droid?.overdrive ? DROID.overdriveCost : 0) + (o?.droid?.autopilot ? DROID.autopilotCost : 0);
}
/**
 * Stres za manévr s ohledem na droida: overdrive = červený/nebezpečný bez stresu, autopilot = zelený vrací víc.
 * Záporná hodnota = regenerace.
 */
export function effStressCost(x: Difficulty | Maneuver, o?: Pick<ShipOrders, "droid">): number {
  const d = typeof x === "string" ? x : x.difficulty;
  const base = typeof x === "string" ? stressCost(x) : maneuverStress(x);
  if (base > 0 && o?.droid?.overdrive) return 0;
  if (d === "green" && o?.droid?.autopilot) return -DROID.autopilotRegen;
  return base;
}
/** Manévrovací profil lodi pro dané rozkazy: s overdrivem droida rychlost v tomto kole ignoruje váhu. */
export function profileFor(ship: Ship, o?: Pick<ShipOrders, "droid">): ManeuverProfile {
  return profileOf(ship.loadout, !!o?.droid?.overdrive);
}
/** Stres za úhyb (overdrive = zdarma). */
export function effEvadeCost(o?: Pick<ShipOrders, "droid">): number {
  return o?.droid?.overdrive ? 0 : RULES.evadeStressCost;
}

/** Může si loď manévr dovolit (stresové body)? */
export function canAfford(ship: Ship, man: Maneuver, o?: Pick<ShipOrders, "droid">): boolean {
  return effStressCost(man, o) <= ship.stressPoints;
}

/** Výchozí rozkaz (bez akcí): stejná rychlost rovně, nestřílí. */
export function defaultOrders(ship: Ship): ShipOrders {
  const profile = profileOf(ship.loadout);
  const candidates = [ship.speed, 2, ship.speed - 1, ship.speed + 1, 1, 3, 0];
  for (const sp of candidates) {
    const man = makeManeuver(profile, sp, 0, false, ship.speed);
    if (man && canAfford(ship, man)) return { shipId: ship.id, maneuverId: man.id, shots: [] };
  }
  const any = listManeuvers(profile, ship.speed).find((m) => !m.koiogran) ?? listManeuvers(profile, ship.speed)[0];
  return { shipId: ship.id, maneuverId: any?.id ?? maneuverId(Math.max(0, Math.min(profile.maxSpeed, ship.speed)), 0), shots: [] };
}

/** Rozpis akcí rozkazu (každá stojí 1 bod). */
export type ActionId = "move" | "koiogran" | "laser" | "mg" | "torpedo" | "mine" | "evade" | "shield" | "jettison" | "pickup" | "comm" | "turn" | "stop";

export function actionList(ship: Ship, o: ShipOrders): { id: ActionId; label: string }[] {
  const out: { id: ActionId; label: string }[] = [];
  const m = parseManeuverId(o.maneuverId);
  if (m) {
    if (m.koiogran) {
      // otočka stojí 2 akce; s overdrivem droida jen 1
      if (!o.droid?.overdrive) out.push({ id: "move", label: "úprava pohybu" });
      out.push({ id: "koiogran", label: "otočka 180°" });
    }
    else if (m.speed !== ship.speed || m.angle !== 0) out.push({ id: "move", label: "úprava pohybu" });
    if (m.stop) out.push({ id: "stop", label: "zastavení na konci dráhy" });
  }
  if (o.action?.type === "evade") out.push({ id: "evade", label: "úhybný manévr" });
  if (o.action?.type === "shield") out.push({ id: "shield", label: "úprava štítu" });
  if (o.action?.type === "jettison") out.push({ id: "jettison", label: "vyhození modulu" });
  if (o.action?.type === "pickup") out.push({ id: "pickup", label: "zvednutí nákladu" });
  if (o.action?.type === "comm") out.push({ id: "comm", label: "komunikace se stanicí" });
  if (o.action?.type === "turn") out.push({ id: "turn", label: "otočení na místě" });
  for (const sh of shotsOf(ship, o)) {
    const mod = ship.loadout.modules.find((x) => x.id === sh.moduleId);
    if (mod?.type === "mg") out.push({ id: "mg", label: "kulomet" });
    else out.push({ id: "laser", label: "lasery" });
  }
  if (o.special?.type === "torpedo") out.push({ id: "torpedo", label: "torpédo" });
  if (o.special?.type === "mine") out.push({ id: "mine", label: "mina" });
  return out;
}

export function actionCost(ship: Ship, o: ShipOrders): number {
  return actionList(ship, o).length;
}

/** Je cíl (loď nebo torpédo) nepřátelský a existující? */
/** Torpédový modul s municí (zadaný, nebo první s municí). */
export function torpedoModule(ship: Ship, moduleId?: string) {
  const mods = ship.loadout.modules.filter((m) => m.type === "torpedo" && (m.ammo ?? 0) > 0 && moduleUsable(m));
  return mods.find((m) => m.id === moduleId) ?? mods[0];
}
/** Minový modul s municí. */
export function mineModule(ship: Ship) {
  return ship.loadout.modules.find((m) => m.type === "mine" && (m.ammo ?? 0) > 0 && moduleUsable(m));
}
/** Kulometný modul s municí (zadaný, nebo první s municí). */
export function mgModule(ship: Ship, moduleId?: string) {
  const mods = ship.loadout.modules.filter((m) => m.type === "mg" && (m.ammo ?? 0) > 0 && moduleUsable(m));
  return mods.find((m) => m.id === moduleId) ?? mods[0];
}

/** Šance zásahu jednoho projektilu kulometu podle vzdálenosti (lineárně blízko → hranice dosahu), úhyb cíle snižuje. */
export function mgHitChance(d: number, targetEvading = false, range = MG.range): number {
  const t = clamp(d / Math.max(1, range), 0, 1);
  let p = (MG.hitNear + (MG.hitFar - MG.hitNear) * t) / 100;
  if (targetEvading) p *= 1 - RULES.evadeDamageReduction / 100;
  return clamp(p, 0, 1);
}

/** Laserový modul (zadaný, nebo první). */
export function laserModule(ship: Ship, moduleId?: string) {
  const mods = ship.loadout.modules.filter((m) => m.type === "laser" && moduleUsable(m));
  return mods.find((m) => m.id === moduleId) ?? mods[0];
}

/** Střely v kole: `shots`, nebo převod staršího zápisu (fire / fireMg). */
export function shotsOf(ship: Ship, o: Pick<ShipOrders, "shots" | "fire" | "laserModuleId" | "fireMg" | "mgModuleId">): Shot[] {
  if (o.shots) return o.shots;
  const out: Shot[] = [];
  if (o.fire) {
    const m = laserModule(ship, o.laserModuleId);
    if (m) out.push({ moduleId: m.id });
  }
  if (o.fireMg) {
    const m = mgModule(ship, o.mgModuleId);
    if (m) out.push({ moduleId: m.id });
  }
  return out;
}
/** Střely daného typu zbraně. */
export function shotsOfType(ship: Ship, o: ShipOrders, type: "laser" | "mg"): { shot: Shot; mod: ModuleInstance }[] {
  const out: { shot: Shot; mod: ModuleInstance }[] = [];
  for (const shot of shotsOf(ship, o)) {
    const mod = ship.loadout.modules.find((m) => m.id === shot.moduleId);
    if (mod && mod.type === type && !mod.hacked) out.push({ shot, mod });
  }
  return out;
}
/** Cíl střely: vlastní, jinak výchozí cíl lodi. */
export function shotTargetId(o: ShipOrders, shot: Shot): string | undefined {
  return shot.targetId ?? o.preferredTargetId;
}

function enemyTarget(state: GameState, ship: Ship, id: string | undefined): Ship | Torpedo | undefined {
  if (!id) return undefined;
  const s = shipById(state, id);
  if (s) return s.alive && s.team !== ship.team ? s : undefined;
  const t = torpedoById(state, id);
  if (t) return t.team !== ship.team ? t : undefined;
  return undefined;
}

/**
 * Ověří a opraví rozkazy hráče proti aktuálnímu stavu (server tomu nevěří).
 * Vrací sadu rozkazů pro všechny živé lodě hráče.
 */
export function sanitizeOrders(state: GameState, playerId: string, incoming: ShipOrders[]): ShipOrders[] {
  if (state.tuning) applyTuning(state.tuning);
  const out: ShipOrders[] = [];
  for (const ship of state.ships) {
    if (!ship.alive || ship.ownerId !== playerId) continue;
    const raw = incoming.find((o) => o.shipId === ship.id);
    const def = defaultOrders(ship);
    if (!raw) {
      out.push(def);
      continue;
    }
    // droid: jen s funkčním modulem, mimo bouři a s dostatkem technologie
    let droid: DroidOrder | undefined = raw.droid && (raw.droid.overdrive || raw.droid.autopilot) ? { overdrive: !!raw.droid.overdrive, autopilot: !!raw.droid.autopilot } : undefined;
    if (droid && (!droidModule(ship) || inStorm(state, ship) || droidCost({ droid }) > ship.techPoints)) droid = undefined;
    const profile = profileFor(ship, { droid });
    let man = resolveManeuver(profile, raw.maneuverId, ship.speed);
    if (!man || !canAfford(ship, man, { droid })) man = resolveManeuver(profile, def.maneuverId, ship.speed)!;

    let action: ActionOrder | undefined;
    if (raw.action?.type === "evade") action = ship.stressPoints >= effEvadeCost({ droid }) && man.speed > 0 && ship.loadout.hullId !== "battleship" ? { type: "evade" } : undefined;
    else if (raw.action?.type === "shield") action = validShieldAction(ship, raw.action.segments) ? { type: "shield", segments: raw.action.segments.map((n) => Math.round(Number(n))) as Segments } : undefined;
    else if (raw.action?.type === "jettison") {
      const wantedId = raw.action.moduleId;
      action = ship.loadout.modules.some((m) => m.id === wantedId) || (ship.loadout.cargo ?? []).some((m) => m.id === wantedId) ? { type: "jettison", moduleId: wantedId } : undefined;
    } else if (raw.action?.type === "pickup") {
      const tid = raw.action.targetId;
      action = { type: "pickup", targetId: typeof tid === "string" && (state.debris.some((d) => d.id === tid) || isStationId(state, tid)) ? tid : undefined };
    } else if (raw.action?.type === "turn") {
      const hd = raw.action.heading;
      // otočení na místě: loď stojí (rychlost 0), nebo v tomto kole zastaví hned (manévr rychlostí 0)
      if ((ship.speed === 0 || man.speed === 0) && typeof hd === "number" && Number.isFinite(hd)) action = { type: "turn", heading: normalizeAngle(hd) };
    } else if (raw.action?.type === "comm") {
      const st = (state.stations ?? []).find((x) => x.id === (raw.action as { stationId?: string }).stationId);
      const mt = (raw.action as { moduleType?: string }).moduleType;
      if (st && typeof mt === "string" && MODULE_TYPES.includes(mt as ModuleType) && (state.settings.allowedModules ?? {})[mt as ModuleType] !== 0) action = { type: "comm", stationId: st.id, moduleType: mt as ModuleType };
    }
    let special = raw.special;
    if (special?.type === "torpedo") {
      const mod = torpedoModule(ship, special.moduleId);
      if (!mod) special = undefined;
      else if (special.targetId) {
        const t = enemyTarget(state, ship, special.targetId);
        special = t && dist(ship, t) <= torpedoLockRange(ship) ? { type: "torpedo", targetId: t.id, moduleId: mod.id } : undefined;
      } else if (special.point && Number.isFinite(special.point.x) && Number.isFinite(special.point.y)) {
        const p = { x: clamp(special.point.x, 0, state.width), y: clamp(special.point.y, 0, state.height) };
        special = dist(ship, p) <= torpedoPointRange(ship) ? { type: "torpedo", point: p, moduleId: mod.id } : undefined;
      } else special = undefined;
    }
    if (special?.type === "mine") {
      const mm = mineModule(ship);
      if (!mm) special = undefined;
      else {
        const t = special.timer;
        special = { type: "mine", timer: typeof t === "number" && t >= 1 && t <= 3 ? Math.round(t) : undefined, side: mineSideOf(mm.facing) };
      }
    }

    const preferredTargetId = enemyTarget(state, ship, raw.preferredTargetId)?.id ?? state.debris.find((d) => d.id === raw.preferredTargetId)?.id ?? (state.comets ?? []).find((c) => c.id === raw.preferredTargetId)?.id;
    // střely: jen existující funkční moduly (kulomet s municí), každý modul nejvýš jednou, cíle ověřené
    const seen = new Set<string>();
    const shots: Shot[] = [];
    const rawShots = Array.isArray(raw.shots) ? raw.shots : shotsOf(ship, raw);
    for (const rs of rawShots) {
      if (!rs || typeof rs.moduleId !== "string" || seen.has(rs.moduleId)) continue;
      const mod = ship.loadout.modules.find((m) => m.id === rs.moduleId);
      if (!mod || !moduleUsable(mod) || (mod.type !== "laser" && mod.type !== "mg") || (mod.type === "mg" && (mod.ammo ?? 0) <= 0)) continue;
      seen.add(mod.id);
      const tid = typeof rs.targetId === "string" ? (enemyTarget(state, ship, rs.targetId)?.id ?? state.debris.find((d) => d.id === rs.targetId)?.id ?? (state.comets ?? []).find((c) => c.id === rs.targetId)?.id ?? (state.stations ?? []).find((x) => x.id === rs.targetId && !x.broken)?.id) : undefined;
      shots.push(tid ? { moduleId: mod.id, targetId: tid } : { moduleId: mod.id });
    }
    const o: ShipOrders = { shipId: ship.id, maneuverId: man.id, action, special, shots, preferredTargetId, droid };
    // limit akcí: nejdřív padá zbraň, pak střely (od poslední), pak úhyb, nakonec manévr
    if (actionCost(ship, o) > RULES.actionPoints) o.special = undefined;
    if (actionCost(ship, o) > RULES.actionPoints) o.action = undefined;
    while (actionCost(ship, o) > RULES.actionPoints && o.shots!.length) o.shots!.pop();
    if (actionCost(ship, o) > RULES.actionPoints) o.maneuverId = def.maneuverId;
    // odvozené starší příznaky (pro čtení)
    const ls = shotsOfType(ship, o, "laser");
    const ms = shotsOfType(ship, o, "mg");
    o.fire = ls.length > 0;
    o.laserModuleId = ls[0]?.mod.id;
    o.fireMg = ms.length > 0;
    o.mgModuleId = ms[0]?.mod.id;
    out.push(o);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Vyhodnocení kola                                                     */
/* ------------------------------------------------------------------ */

/** Jemnost simulace torpéda uvnitř kola (násobek MOVE_STEPS). */
const TORPEDO_SUBSTEPS = MOVE_STEPS * 2;

/**
 * Fázové torpédo – jedno kolo letu po mikrokrocích:
 * výlet (rovně, startovní rychlost) → zaměření (otáčí se na cíl) → let (zrychluje, mírně zatáčí, cíl mimo výseč ztratí).
 * Mění `t.phase/speed/launchLeft/lost`; vrací vzorky (MOVE_STEPS + 1) a ujetou délku.
 */
export function simulateTorpedo(t: Torpedo, aimAt: (k: number) => Vec | undefined, storms: Storm[] = []): { samples: Pose[]; length: number } {
  const dt = 1 / TORPEDO_SUBSTEPS;
  let { x, y, heading } = t;
  let length = 0;
  const micro: Pose[] = [{ x, y, heading }];
  for (let i = 0; i < TORPEDO_SUBSTEPS; i++) {
    const k = Math.min(MOVE_STEPS, Math.round(((i + 1) / TORPEDO_SUBSTEPS) * MOVE_STEPS));
    if (!t.lost && pointInStorm(storms, { x, y })) t.lost = true; // v bouři torpédo ohluchne – natrvalo
    const aim = t.lost ? undefined : aimAt(k);
    const err = aim ? normalizeAngle(Math.atan2(aim.y - y, aim.x - x) - heading) : 0;
    if (t.phase === "launch") {
      t.speed = TORPEDO.launchSpeed;
      t.launchLeft -= t.speed * dt;
      if (t.launchLeft <= 0) t.phase = aim ? "lock" : "cruise";
    } else if (t.phase === "lock") {
      t.speed = TORPEDO.launchSpeed;
      if (!aim || t.lost || Math.abs(err) <= TORPEDO.lockAngle) t.phase = "cruise";
      else heading += clamp(err, -TORPEDO.lockTurn * dt, TORPEDO.lockTurn * dt);
    }
    if (t.phase === "cruise") {
      t.speed = Math.min(TORPEDO.speed, t.speed + TORPEDO.accel * dt);
      if (aim) {
        if (Math.abs(err) > TORPEDO.trackArc) t.lost = true;
        else heading += clamp(err, -TORPEDO.maxTurn * dt, TORPEDO.maxTurn * dt);
      }
    }
    const step = t.speed * dt;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    length += step;
    micro.push({ x, y, heading });
  }
  const samples: Pose[] = [];
  for (let i = 0; i <= MOVE_STEPS; i++) samples.push(micro[Math.round((i / MOVE_STEPS) * TORPEDO_SUBSTEPS)]);
  return { samples, length };
}

interface Mover {
  samples: Pose[];
  length: number;
  /** Index vzorku, od kterého se už nehýbe (zničení). */
  frozenAt: number | null;
  deflections: number;
  collided: boolean;
}

export function resolveTurn(input: GameState, allOrders: ShipOrders[], rng: Rng): TurnResult {
  if (input.tuning) applyTuning(input.tuning);
  const state: GameState = structuredClone(input);
  if (!state.debris) state.debris = [];
  if (!state.storms) state.storms = [];
  if (!state.comets) state.comets = [];
  const events: TurnEvent[] = [];
  const turn = state.turn;
  creditCtx = { state, events, rng, turn: state.turn };

  // Nová kometa přilétá na okraj mapy na začátku kola (lze ji hned ostřelovat, pohybuje se s loděmi).
  const cometLevel = state.settings.map?.comets ?? "none";
  if (cometLevel !== "none" && state.comets.length < COMET.max[cometLevel] && rng.next() * 100 < COMET.chance[cometLevel]) {
    const c = spawnComet(state, rng, `comet-${turn}`);
    state.comets.push(c);
    events.push({ type: "spawnComet", comet: c });
  }
  // hacknuté moduly: oběť se to dozví teď (modul na toto kolo nefunguje)
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    for (const m of ship.loadout.modules) if (m.hacked) events.push({ type: "hacked", shipId: ship.id, moduleId: m.id, moduleType: m.type });
  }
  const shotComets = new Set<string>();
  const cometById = (id: string | undefined) => state.comets!.find((c) => c.id === id && !shotComets.has(c.id) && cometOnMap(state, c));
  /** Zásah komety zbraní (před pohybem). */
  const hitComet = (c: Comet, shooterId: string, dmg: number) => {
    const shooter = shipById(state, shooterId)!;
    c.hull = Math.max(0, c.hull - dmg);
    const destroyed = c.hull <= 0;
    if (destroyed) shotComets.add(c.id);
    events.push({ type: "cometShot", cometId: c.id, shooterId, x: c.x, y: c.y, damage: dmg, hullAfter: c.hull, destroyed, reward: destroyed ? COMET.reward : 0 });
    if (destroyed) {
      const st = statsOf(state, shooter.ownerId);
      if (st) st.cometsShot = (st.cometsShot ?? 0) + 1;
      awardCredits(state, events, shooter.ownerId, COMET.reward, "comet");
    }
  };

  const orders = new Map<string, ShipOrders>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = allOrders.find((x) => x.shipId === ship.id) ?? defaultOrders(ship);
    orders.set(ship.id, o);
  }
  // Otočení na místě (jen stojící loď): nový kurz platí hned – pro střelbu i pohyb
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.action?.type !== "turn" || (ship.speed !== 0 && (parseManeuverId(o.maneuverId)?.speed ?? ship.speed) !== 0)) continue;
    ship.heading = normalizeAngle(o.action.heading);
    events.push({ type: "action", shipId: ship.id, action: o.action, ok: true });
  }
  const startPose = new Map<string, Pose>();
  for (const ship of state.ships) startPose.set(ship.id, { x: ship.x, y: ship.y, heading: ship.heading });

  /* ---------- 0. Droid – pilot: zaplacení funkcí technologií ---------- */
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    if (!o.droid || (!o.droid.overdrive && !o.droid.autopilot)) continue;
    const cost = droidCost(o);
    if (!droidModule(ship) || inStorm(state, ship) || cost > ship.techPoints) {
      o.droid = undefined;
      continue;
    }
    ship.techPoints -= cost;
    events.push({ type: "droid", shipId: ship.id, overdrive: !!o.droid.overdrive, autopilot: !!o.droid.autopilot, cost, techPoints: ship.techPoints });
  }

  // Úhybný manévr: zaplatí stres hned; po celé kolo snižuje zranění minou/torpédem a dovolí prolétnout nepřáteli.
  const evading = new Set<string>();
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.action?.type !== "evade") continue;
    const evCost = effEvadeCost(o);
    if (ship.stressPoints < evCost) continue;
    evading.add(ship.id);
    const before = ship.stressPoints;
    ship.stressPoints -= evCost;
    if (ship.stressPoints !== before) events.push({ type: "stress", shipId: ship.id, stressPoints: ship.stressPoints, delta: ship.stressPoints - before });
    events.push({ type: "action", shipId: ship.id, action: { type: "evade" }, ok: true });
  }
  // Úprava štítu: přerozdělení segmentů hned na začátku kola.
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.action?.type !== "shield") continue;
    if (!validShieldAction(ship, o.action.segments)) continue;
    ship.segments = [...o.action.segments] as Segments;
    events.push({ type: "action", shipId: ship.id, action: o.action, ok: true });
  }
  // Vyhození modulu: hned na začátku kola; modul zůstane za lodí jako trosky.
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.action?.type !== "jettison") continue;
    const wanted = o.action.moduleId;
    const idx = ship.loadout.modules.findIndex((m) => m.id === wanted);
    const cidx = (ship.loadout.cargo ?? []).findIndex((m) => m.id === wanted);
    if (idx < 0 && cidx < 0) continue;
    const [mod] = idx >= 0 ? ship.loadout.modules.splice(idx, 1) : ship.loadout.cargo!.splice(cidx, 1);
    syncShields(ship);
    const f = forward(ship.heading);
    const back = ship.stats.radius + 14;
    const debris: Debris = {
      id: `debris-${turn}-${ship.id}-${mod.id}`,
      type: mod.type,
      x: clamp(ship.x - f.x * back, 0, state.width),
      y: clamp(ship.y - f.y * back, 0, state.height),
      team: ship.team,
      value: Math.round((MODULES[mod.type].price * RULES.debrisRewardPct * (moduleWorking(mod) ? 1 : RULES.brokenSellPct / 100)) / 100),
      module: { ...mod },
    };
    state.debris.push(debris);
    events.push({ type: "jettison", shipId: ship.id, debris, shieldType: ship.shieldType });
    events.push({ type: "action", shipId: ship.id, action: o.action, ok: true });
  }
  const scaleEvade = (ship: Ship, dmg: number) => (evading.has(ship.id) ? Math.round(dmg * (1 - RULES.evadeDamageReduction / 100)) : dmg);
  const passedThrough = new Set<string>(); // "evader:enemy"

  /* ---------- 1. Lasery (všichni současně, ze startovních pozic, před pohybem) ---------- */
  const pending = new Map<string, { dmg: number; from: Vec; by: string }>();
  const shotTorpedoes = new Set<string>();
  const shotDebris = new Set<string>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    if (ship.stats.attack <= 0) continue;
    if (inStorm(state, ship)) continue; // v bouři lasery nefungují
    // každý laserový modul střílí zvlášť (vlastní akce, vlastní cíl, vlastní kostky), z pozice modulu na trupu
    for (const { shot, mod: lmod } of shotsOfType(ship, o, "laser")) {
    const prefId = shotTargetId(o, shot);
    const aim = aimPose(ship, lmod);
    const arc = laserHalfArc(lmod.facing, ship.loadout.hullId);

    const deb = state.debris.find((d) => d.id === prefId);
    if (deb && !shotDebris.has(deb.id)) {
      if (dist(aim, deb) <= laserRange(ship) && inArc(aim, deb, arc) && !lineBlocked(obstacles(state), aim, deb) && !laserBlockedByStorm(state, ship, deb)) {
        const rangeBand = clamp(Math.ceil(dist(aim, deb) / LASER.band), 1, 3);
        const outcome = resolveAttack(rng, { attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0), defenseDice: rangeBand === 3 ? 1 : 0, attackerFocus: ship.tokens.focus > 0, attackerLock: false, defenderFocus: false, defenderEvade: false });
        const destroyed = outcome.damage > 0;
        if (destroyed) shotDebris.add(deb.id);
        events.push({ type: "debrisShot", debrisId: deb.id, shooterId: ship.id, x: deb.x, y: deb.y, destroyed, reward: destroyed ? deb.value : 0 });
        if (destroyed) awardCredits(state, events, ship.ownerId, deb.value, "debris");
      }
      continue;
    }
    const com = cometById(prefId);
    if (com) {
      if (dist(aim, com) <= laserRange(ship) && inArc(aim, com, arc) && !lineBlocked(obstacles(state), aim, com) && !laserBlockedByStorm(state, ship, com)) {
        const rangeBand = clamp(Math.ceil(dist(aim, com) / LASER.band), 1, 3);
        const outcome = resolveAttack(rng, { attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0), defenseDice: rangeBand === 3 ? 1 : 0, attackerFocus: ship.tokens.focus > 0, attackerLock: false, defenderFocus: false, defenderEvade: false });
        const stL = statsOf(state, ship.ownerId);
        if (stL) {
          stL.lasersFired++;
          if (outcome.damage > 0) stL.laserHits++;
        }
        hitComet(com, ship.id, outcome.damage * RULES.damagePerHit);
      }
      continue;
    }
    const stnT = (state.stations ?? []).find((x) => x.id === prefId && !x.broken);
    if (stnT) {
      if (dist(aim, stnT) <= laserRange(ship) + stnT.radius && inArc(aim, stnT, arc) && !lineBlocked(state.asteroids, aim, stnT) && !laserBlockedByStorm(state, ship, stnT)) {
        const rangeBand = clamp(Math.ceil(Math.max(0, dist(aim, stnT) - stnT.radius) / LASER.band), 1, 3);
        const outcome = resolveAttack(rng, { attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0), defenseDice: 0, attackerFocus: ship.tokens.focus > 0, attackerLock: false, defenderFocus: false, defenderEvade: false });
        const stL = statsOf(state, ship.ownerId);
        if (stL) {
          stL.lasersFired++;
          if (outcome.damage > 0) stL.laserHits++;
        }
        events.push({ type: "laser", shooterId: ship.id, targetId: stnT.id, from: { x: aim.x, y: aim.y, heading: aim.heading }, to: { x: stnT.x, y: stnT.y, heading: 0 }, attackDice: outcome.attackDice, defenseDice: outcome.defenseDice, hits: outcome.hits, evades: outcome.evades, damage: outcome.damage * RULES.damagePerHit, rangeBand });
        damageStation(state, stnT, outcome.damage * RULES.damagePerHit, "energy", events, ship.id, 0, (cc, radius, damage) => applyHits(explode(cc, radius, damage, 0), 0, cc), rng);
      }
      continue;
    }
    const torp = torpedoById(state, prefId);
    if (torp && torp.team !== ship.team) {
      if (dist(aim, torp) <= laserRange(ship) && inArc(aim, torp, arc) && !shotTorpedoes.has(torp.id) && !lineBlocked(obstacles(state), aim, torp) && !laserBlockedByStorm(state, ship, torp)) {
        const d = dist(aim, torp);
        const rangeBand = clamp(Math.ceil(d / LASER.band), 1, 3);
        const outcome = resolveAttack(rng, {
          attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0),
          defenseDice: TORPEDO_AGILITY + (rangeBand === 3 ? 1 : 0),
          attackerFocus: ship.tokens.focus > 0,
          attackerLock: false,
          defenderFocus: false,
          defenderEvade: false,
        });
        const destroyed = outcome.damage > 0;
        if (destroyed) shotTorpedoes.add(torp.id);
        events.push({ type: "torpedoShot", torpedoId: torp.id, shooterId: ship.id, x: torp.x, y: torp.y, attackDice: outcome.attackDice, defenseDice: outcome.defenseDice, destroyed });
      }
      continue;
    }

    const candidates = state.ships.filter(
      (e) => e.alive && e.team !== ship.team && sectorCoverage(aim, laserRange(ship), arc, e) > 0 && !lineBlocked(obstacles(state), aim, e) && !laserBlockedByStorm(state, ship, e),
    );
    if (candidates.length === 0) continue;
    let target = candidates.find((c) => c.id === prefId);
    if (!target) target = candidates.reduce((best, c) => (dist(aim, c) < dist(aim, best) ? c : best));
    const hitArea = sectorHit(aim, laserRange(ship), arc, target);
    const rangeBand = hitArea.band;
    const coverage = hitArea.coverage;
    const useLock = ship.lockTargetId === target.id;
    const outcome = resolveAttack(rng, {
      attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0),
      defenseDice: target.stats.agility + (rangeBand === 3 ? 1 : 0),
      attackerFocus: ship.tokens.focus > 0,
      attackerLock: useLock,
      defenderFocus: target.tokens.focus > 0,
      defenderEvade: target.tokens.evade > 0,
      coverage,
    });
    if (useLock) ship.lockTargetId = undefined;
    const damage = outcome.damage * RULES.damagePerHit;
    const stL = statsOf(state, ship.ownerId);
    if (stL) {
      stL.lasersFired++;
      if (damage > 0) stL.laserHits++;
    }
    events.push({
      type: "laser",
      shooterId: ship.id,
      targetId: target.id,
      from: { x: aim.x, y: aim.y, heading: aim.heading },
      to: { x: target.x, y: target.y, heading: target.heading },
      attackDice: outcome.attackDice,
      defenseDice: outcome.defenseDice,
      hits: outcome.hits,
      evades: outcome.evades,
      damage,
      rangeBand,
      coverage,
    });
    const prev = pending.get(target.id);
    pending.set(target.id, { dmg: (prev?.dmg ?? 0) + damage, from: prev?.from ?? { x: aim.x, y: aim.y }, by: prev?.by ?? ship.ownerId });
    }
  }
  for (const [id, { dmg, from, by }] of pending) applyDamage(shipById(state, id)!, dmg, events, from, by, "energy");

  /* ---------- 1b. Kulomety (také před pohybem; bouře je neovlivňuje) ---------- */
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    // každý kulomet střílí zvlášť (vlastní akce a cíl), z pozice modulu na trupu
    for (const { shot, mod } of shotsOfType(ship, o, "mg")) {
    if ((mod.ammo ?? 0) <= 0) continue;
    const aim = aimPose(ship, mod);
    const mgR = mgRange(ship);
    const inRange = (p: Vec) => dist(aim, p) <= mgR && inArc(aim, p, MG.halfArc) && !lineBlocked(obstacles(state), aim, p);
    const shipInRange = (e: Ship) => sectorCoverage(aim, mgR, MG.halfArc, e) > 0 && !lineBlocked(obstacles(state), aim, e);
    // cíl: preferovaný (loď / torpédo / trosky), jinak nejbližší nepřátelská loď ve výseči
    let target: { kind: "ship" | "torpedo" | "debris" | "comet"; id: string; pos: Pose } | undefined;
    const pref = shotTargetId(o, shot);
    const ts = pref ? state.ships.find((x) => x.id === pref && x.alive && x.team !== ship.team) : undefined;
    const tt = pref ? state.torpedoes.find((x) => x.id === pref && x.team !== ship.team && !shotTorpedoes.has(x.id)) : undefined;
    const td = pref ? state.debris.find((x) => x.id === pref && !shotDebris.has(x.id)) : undefined;
    const tc = cometById(pref); // jen komety na mapě
    if (ts && shipInRange(ts)) target = { kind: "ship", id: ts.id, pos: ts };
    else if (tt && inRange(tt)) target = { kind: "torpedo", id: tt.id, pos: tt };
    else if (td && inRange(td)) target = { kind: "debris", id: td.id, pos: { ...td, heading: 0 } };
    else if (tc && inRange(tc)) target = { kind: "comet", id: tc.id, pos: tc };
    else {
      const cands = state.ships.filter((e) => e.alive && e.team !== ship.team && shipInRange(e));
      if (cands.length) {
        const c = cands.reduce((b, e) => (dist(aim, e) < dist(aim, b) ? e : b));
        target = { kind: "ship", id: c.id, pos: c };
      }
    }
    if (!target) continue;
    const shots = Math.min(MG.burst, mod.ammo ?? 0);
    mod.ammo = (mod.ammo ?? 0) - shots;
    refreshShip(ship);
    const victimShip = target.kind === "ship" ? shipById(state, target.id) : undefined;
    // kulomet: šance podle průměrné vzdálenosti zasažené části trupu (ne středu) × podíl trupu ve výseči
    const hitArea = victimShip ? sectorHit(aim, mgR, MG.halfArc, victimShip) : undefined;
    const p = mgHitChance(hitArea ? hitArea.meanDist : dist(aim, target.pos), !!victimShip && evading.has(victimShip.id), mgR) * (hitArea ? hitArea.coverage : 1);
    let hits = 0;
    const spread: number[] = [];
    for (let i = 0; i < shots; i++) {
      spread.push((rng.next() * 2 - 1) * MG.spread);
      if (rng.next() < p) hits++;
    }
    const damage = hits * MG.damage;
    const st = statsOf(state, ship.ownerId);
    if (st) {
      st.mgShots += shots;
      st.mgHits += hits;
    }
    let destroyed = false;
    if (target.kind === "torpedo" && hits > 0) {
      shotTorpedoes.add(target.id);
      destroyed = true;
    } else if (target.kind === "debris" && hits > 0) {
      shotDebris.add(target.id);
      destroyed = true;
      const deb = state.debris.find((x) => x.id === target!.id)!;
      awardCredits(state, events, ship.ownerId, deb.value, "debris");
    } else if (target.kind === "comet" && damage > 0) {
      hitComet(tc!, ship.id, damage);
      destroyed = shotComets.has(tc!.id);
    }
    events.push({ type: "mg", shooterId: ship.id, targetId: target.id, from: { x: aim.x, y: aim.y, heading: aim.heading }, to: { x: target.pos.x, y: target.pos.y, heading: target.pos.heading }, shots, hits, damage, spread, destroyed });
    if (victimShip && damage > 0) {
      if (victimShip.shieldType === "whole" && !inStorm(state, victimShip)) {
        // celolodní štít řeší každý projektil zvlášť
        for (let i = 0; i < hits && victimShip.alive; i++) applyDamage(victimShip, MG.damage, events, { x: aim.x, y: aim.y }, ship.ownerId);
      } else applyDamage(victimShip, damage, events, { x: aim.x, y: aim.y }, ship.ownerId); // segment: celá dávka = jeden zásah
    }
    }
  }
  state.torpedoes = state.torpedoes.filter((t) => !shotTorpedoes.has(t.id));
  state.debris = state.debris.filter((d) => !shotDebris.has(d.id));
  state.comets = state.comets.filter((c) => !shotComets.has(c.id));

  /* ---------- 1c. Zvednutí nákladu (po střelbě, před pohybem) ---------- */
  {
    const claims = new Map<string, { ship: Ship; speed: number; d: number }[]>();
    for (const ship of state.ships) {
      const o = orders.get(ship.id);
      if (!ship.alive || o?.action?.type !== "pickup") continue;
      const wantId = o.action.targetId;
      const speed = parseManeuverId(o.maneuverId)?.speed ?? ship.speed;
      const cap = cargoCapacity(ship.loadout);
      const held = (ship.loadout.cargo ?? []).length;
      const inRange = state.debris.filter((d) => dist(ship, d) <= CARGO.range);
      const target = wantId ? inRange.find((d) => d.id === wantId) : inRange.sort((a, b) => dist(ship, a) - dist(ship, b))[0];
      const fail = (reason: "range" | "speed" | "full" | "gone", debrisId = wantId ?? "") => events.push({ type: "pickup", shipId: ship.id, debrisId, x: ship.x, y: ship.y, ok: false, reason });
      // nabrání ze stanice: v okruhu sběru, rychlost ≤ 2, zásoba > 0 → náhodný modul do nákladu
      if (wantId && isStationId(state, wantId)) {
        const stn = state.stations!.find((x) => x.id === wantId)!;
        const sfail = (reason: "range" | "speed" | "full" | "empty") => events.push({ type: "stationPickup", shipId: ship.id, stationId: stn.id, ok: false, reason, stockLeft: stn.stock });
        if (held >= cap) sfail("full");
        else if (speed > CARGO.maxSpeed) sfail("speed");
        else if (dist(ship, stn) > stn.radius + STATION.pickupRange) sfail("range");
        else if (stn.stock <= 0) sfail("empty");
        else {
          const mod = randomStationModule(state, rng);
          if (!mod) sfail("empty");
          else {
            stn.stock--;
            ship.loadout.cargo = [...(ship.loadout.cargo ?? []), mod];
            refreshShip(ship);
            events.push({ type: "stationPickup", shipId: ship.id, stationId: stn.id, ok: true, module: mod, stockLeft: stn.stock });
          }
        }
        continue;
      }
      if (held >= cap) {
        fail("full");
        continue;
      }
      if (speed > CARGO.maxSpeed) {
        fail("speed");
        continue;
      }
      if (!target) {
        fail(wantId && !state.debris.some((d) => d.id === wantId) ? "gone" : "range");
        continue;
      }
      const list = claims.get(target.id) ?? [];
      list.push({ ship, speed, d: dist(ship, target) });
      claims.set(target.id, list);
    }
    const picked = new Set<string>();
    for (const [debrisId, list] of claims) {
      const deb = state.debris.find((d) => d.id === debrisId)!;
      // přednost: nižší rychlost, pak menší vzdálenost, pak náhoda
      list.sort((a, b) => a.speed - b.speed || a.d - b.d || rng.next() - 0.5);
      const winner = list[0];
      const mod: ModuleInstance = deb.module ? { ...deb.module } : { id: `cargo-${turn}-${winner.ship.id}`, type: deb.type, slot: "front", ammo: MODULES[deb.type].ammo };
      winner.ship.loadout.cargo = [...(winner.ship.loadout.cargo ?? []), mod];
      refreshShip(winner.ship);
      picked.add(debrisId);
      events.push({ type: "pickup", shipId: winner.ship.id, debrisId, x: deb.x, y: deb.y, ok: true, module: mod });
      for (const l of list.slice(1)) events.push({ type: "pickup", shipId: l.ship.id, debrisId, x: deb.x, y: deb.y, ok: false, reason: "lost", winnerId: winner.ship.id });
    }
    state.debris = state.debris.filter((d) => !picked.has(d.id));
  }

  /* ---------- 1d. Komunikace se stanicí: objednávka modulu (před pohybem; stanice ho vypustí jako trosky směrem k volajícímu) ---------- */
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.action?.type !== "comm") continue;
    const stn = (state.stations ?? []).find((x) => x.id === (o.action as { stationId: string }).stationId);
    const mt = (o.action as { moduleType: ModuleType }).moduleType;
    const price = MODULES[mt]?.price ?? 0;
    const player = state.players.find((x) => x.id === ship.ownerId);
    const fail = (reason: "range" | "broken" | "credits" | "busy" | "module") => events.push({ type: "stationOrder", shipId: ship.id, stationId: stn?.id ?? "", ok: false, reason, moduleType: mt, price });
    if (!stn || !MODULES[mt]) fail("module");
    else if (stn.broken) fail("broken");
    else if (dist(ship, stn) > ship.stats.vision + stn.radius) fail("range");
    else if (stn.orderedTurn === turn) fail("busy");
    else if ((player?.credits ?? 0) < price) fail("credits");
    else {
      player!.credits = (player!.credits ?? 0) - price;
      events.push({ type: "credits", playerId: player!.id, delta: -price, total: player!.credits, reason: "station" });
      stn.orderedTurn = turn;
      const ang = Math.atan2(ship.y - stn.y, ship.x - stn.x);
      const d = stn.radius + STATION.dropDist;
      const mod = newModule(mt, "front", `order-${turn}-${ship.id}`);
      const debris: Debris = { id: `debris-order-${turn}-${ship.id}`, type: mt, x: clamp(stn.x + Math.cos(ang) * d, 0, state.width), y: clamp(stn.y + Math.sin(ang) * d, 0, state.height), team: -1, value: Math.round((price * RULES.debrisRewardPct) / 100), module: mod };
      state.debris.push(debris);
      events.push({ type: "stationOrder", shipId: ship.id, stationId: stn.id, ok: true, moduleType: mt, price, debris });
      events.push({ type: "action", shipId: ship.id, action: o.action, ok: true });
    }
  }


  /* ---------- 2. Pohyb (lodě i torpéda současně) ---------- */
  const preMoveCount = events.length; // akce + lasery patří před událost pohybu
  const shipMovers = new Map<string, Mover>();
  const maneuverOf = new Map<string, Maneuver>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    const profile = profileFor(ship, o);
    let man = resolveManeuver(profile, o.maneuverId, ship.speed);
    if (!man || !canAfford(ship, man, o)) man = resolveManeuver(profile, defaultOrders(ship).maneuverId, ship.speed)!;
    maneuverOf.set(ship.id, man);
    shipMovers.set(ship.id, {
      samples: samplePath(maneuverPath(ship, man), MOVE_STEPS),
      length: maneuverLength(man),
      frozenAt: null,
      deflections: 0,
      collided: false,
    });
  }

  // Torpéda se vypouštějí hned se začátkem pohybu (ze startovní pozice lodi) – letí rychleji než loď.
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-${turn}-${seq++}`;
  const spawnEvents: TurnEvent[] = [];
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.special?.type !== "torpedo") continue;
    const tmod = torpedoModule(ship, o.special.moduleId);
    if (!tmod) continue;
    const target = enemyTarget(state, ship, o.special.targetId);
    const point = o.special.point;
    if (!target && !point) continue;
    tmod.ammo = (tmod.ammo ?? 1) - 1;
    refreshShip(ship);
    const stT = statsOf(state, ship.ownerId);
    if (stT) stT.torpedoesFired++;
    const launchHeading = ship.heading + facingAngle(tmod.facing);
    const f = forward(launchHeading);
    // start z pozice torpédometu na trupu, kousek před modul
    const mp = modulePos(ship, tmod);
    const off = TORPEDO.radius + 10;
    const torpedo: Torpedo = {
      id: newId("torp"),
      ownerId: ship.ownerId,
      team: ship.team,
      x: mp.x + f.x * off,
      y: mp.y + f.y * off,
      heading: normalizeAngle(launchHeading),
      targetId: target?.id,
      targetPoint: target ? undefined : point,
      trackLeft: TORPEDO.trackTurns,
      lifeLeft: TORPEDO.lifeTurns,
      phase: "launch",
      speed: TORPEDO.launchSpeed,
      launchLeft: TORPEDO.launchDist,
    };
    state.torpedoes.push(torpedo);
    spawnEvents.push({ type: "spawnTorpedo", torpedo });
  }

  // Miny se odhazují ze startovní pozice hned na začátku kola (aktivní až od příštího kola).
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.special?.type !== "mine") continue;
    const mmod = mineModule(ship);
    if (!mmod) continue;
    mmod.ammo = (mmod.ammo ?? 1) - 1;
    refreshShip(ship);
    const stMi = statsOf(state, ship.ownerId);
    if (stMi) stMi.minesDropped++;
    const sp = startPose.get(ship.id)!;
    const pos = mineDropPosition(sp, o.special.side);
    const mine: Mine = { id: newId("mine"), ownerId: ship.ownerId, team: ship.team, x: pos.x, y: pos.y, radius: MINE.radius, armed: false, timer: o.special.timer };
    state.mines.push(mine);
    spawnEvents.push({ type: "spawnMine", mine });
  }

  const posAt = (m: Mover, k: number): Pose => m.samples[m.frozenAt !== null ? Math.min(m.frozenAt, k) : k];
  const torpMovers = new Map<string, Mover>();
  for (const t of state.torpedoes) {
    const sim = simulateTorpedo(t, (k) => {
      if (t.targetPoint) return t.targetPoint;
      if (t.trackLeft <= 0 || t.lost) return undefined;
      const s = shipById(state, t.targetId);
      if (s?.alive) return posAt(shipMovers.get(s.id)!, k);
      return torpedoById(state, t.targetId);
    }, state.storms ?? []);
    torpMovers.set(t.id, { samples: sim.samples, length: sim.length, frozenAt: null, deflections: 0, collided: false });
  }
  const removedTorpedoes = new Set<string>();
  const removedMines = new Set<string>();
  const removedAsteroids = new Set<string>();
  // komety: rovný let; samples jako u lodí
  const cometMovers = new Map<string, Mover>();
  for (const c of state.comets) {
    const f = forward(c.heading);
    const samples: Pose[] = [];
    for (let i = 0; i <= MOVE_STEPS; i++) samples.push({ x: c.x + (f.x * c.speed * i) / MOVE_STEPS, y: c.y + (f.y * c.speed * i) / MOVE_STEPS, heading: c.heading });
    cometMovers.set(c.id, { samples, length: c.speed, frozenAt: null, deflections: 0, collided: false });
  }
  const removedComets = new Set<string>();
  const cometHitAsteroids = !!state.settings.map?.cometsHitAsteroids || COMET.collide;
  const endComet = (c: Comet, k: number, reason: "ship" | "asteroid" | "torpedo" | "mine" | "edge" | "comet", shipId?: string, damage?: number) => {
    removedComets.add(c.id);
    const m = cometMovers.get(c.id)!;
    m.frozenAt = k;
    const p = m.samples[k];
    events.push({ type: "cometGone", cometId: c.id, x: p.x, y: p.y, t: k / MOVE_STEPS, reason, shipId, damage });
  };
  /** Průlet ocasem komety: doplnění štítu / trupu / kreditů (každá loď jednou za kometu). */
  const tailBonus = (c: Comet, ship: Ship, k: number) => {
    c.tailUsed.push(ship.id);
    const p = posAt(shipMovers.get(ship.id)!, k);
    const st = statsOf(state, ship.ownerId);
    if (st) st.cometTails = (st.cometTails ?? 0) + 1;
    const push = (effect: "shield" | "segment" | "hull" | "credits" | "stress" | "tech", amount: number, segment?: number) =>
      events.push({ type: "cometTail", cometId: c.id, shipId: ship.id, t: k / MOVE_STEPS, x: p.x, y: p.y, effect, amount, segment });
    // los: buď část štítu, nebo technologie; když vylosované není kam dát, přehodí se na druhé
    const techRoom = Math.max(0, ship.stats.techMax - ship.techPoints);
    const shieldRoom = ship.shieldType === "whole" ? ship.shields < ship.stats.shields : ship.shieldType === "segment" ? ship.segments.some((v) => v < RULES.segmentHp * ship.stats.segmentModules) : false;
    let giveTech = rng.next() < COMET.tailTechChance / 100;
    if (giveTech && techRoom <= 0 && shieldRoom) giveTech = false;
    if (!giveTech && !shieldRoom && techRoom > 0) giveTech = true;
    if (giveTech && techRoom > 0) {
      const techAdd = Math.min(COMET.tailTech, techRoom);
      ship.techPoints += techAdd;
      push("tech", techAdd);
      return;
    }
    const hullHeal = () => {
      if (ship.hull < ship.stats.hull) {
        const add = Math.min(ship.stats.hull - ship.hull, Math.max(1, Math.round((ship.stats.hull * COMET.hullPct) / 100)));
        ship.hull += add;
        push("hull", add);
      } else {
        awardCredits(state, events, ship.ownerId, COMET.bonusCredits, "tail");
        push("credits", COMET.bonusCredits);
      }
    };
    if (ship.shieldType === "whole") {
      if (ship.shields < ship.stats.shields) {
        const add = Math.min(ship.stats.shields - ship.shields, Math.max(1, Math.round((ship.stats.shields * COMET.shieldPct) / 100)));
        ship.shields += add;
        push("shield", add);
      } else hullHeal();
    } else if (ship.shieldType === "segment") {
      const cap = RULES.segmentHp * ship.stats.segmentModules;
      const open = [0, 1, 2, 3].filter((i) => ship.segments[i] < cap);
      if (open.length) {
        const seg = open[Math.floor(rng.next() * open.length)];
        ship.segments[seg]++;
        push("segment", 1, seg);
      } else hullHeal();
    } else {
      const before = ship.stressPoints;
      ship.stressPoints = ship.stats.stressMax;
      if (ship.stressPoints !== before) events.push({ type: "stress", shipId: ship.id, stressPoints: ship.stressPoints, delta: ship.stressPoints - before });
      awardCredits(state, events, ship.ownerId, COMET.noShieldCredits, "tail");
      push("stress", COMET.noShieldCredits);
    }
  };

  /** Odrazí pohyb od vzorku k: zbytek dráhy pokračuje rovně novým kurzem. */
  const deflect = (m: Mover, k: number, newHeading: number) => {
    const p0 = m.samples[k - 1];
    const remSteps = MOVE_STEPS - (k - 1);
    const rem = (m.length * remSteps) / MOVE_STEPS;
    const f = forward(newHeading);
    for (let i = k; i <= MOVE_STEPS; i++) {
      const s = (i - (k - 1)) / remSteps;
      m.samples[i] = { x: p0.x + f.x * rem * s, y: p0.y + f.y * rem * s, heading: newHeading };
    }
    m.deflections++;
    m.collided = true;
    if (m.deflections >= MAX_DEFLECTIONS) m.frozenAt = k - 1;
  };
  const scatter = () => (rng.next() * 2 - 1) * COLLISION_SCATTER;
  /** Lodě, které narazily do asteroidu nebo do nich narazila kometa: po tahu rychlost 1 a nulový stres. */
  const crashed = new Set<string>();
  /** Lodě, do kterých narazila kometa: po tahu rychlost 1 a nulový stres (odmrštění náhodným směrem). */
  const cometCrashed = new Set<string>();
  /** Lodě zastavené srážkou (loď–loď): po tahu rychlost 0. */
  const stopped = new Set<string>();
  /** Zastavení na místě: zbytek dráhy stojí tam, kde k dotyku došlo (vzorek k−1). */
  const freeze = (m: Mover, k: number) => {
    const p0 = m.samples[Math.max(0, k - 1)];
    for (let i = k; i <= MOVE_STEPS; i++) m.samples[i] = { ...p0 };
    m.frozenAt = Math.max(0, k - 1);
    m.deflections++;
    m.collided = true;
  };
  /** Polštář štítu kolem lodi (dotyk štítů = srážka). */
  const shieldPad = (sh: Ship): number | null => ((sh.shieldType === "whole" && sh.shields > 0) || (sh.shieldType === "segment" && sh.segments.some((v) => v > 0)) ? sh.stats.radius + SHIELD_GAP : null);

  // Překážky, kterých se loď dotýká (po srážce), ji neblokují, dokud se od nich neodlepí.
  const touching = new Map<string, Set<string>>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const set = new Set<string>();
    const cols = ship.stats.colliders.map((c) => ({ ...c, r: c.r + 1 }));
    if (!shipInsideMap(state.width, state.height, ship, cols)) set.add("edge");
    for (const a of state.asteroids) if (shipHitsAsteroid(a, ship, cols)) set.add(a.id);
    for (const o of state.ships) if (o !== ship && o.alive && shipsOverlap(ship, cols, o, o.stats.colliders)) set.add(o.id);
    touching.set(ship.id, set);
  }
  const stillTouching = (shipId: string, obstacleId: string, overlapping: boolean): boolean => {
    const set = touching.get(shipId)!;
    if (!set.has(obstacleId)) return false;
    if (!overlapping) {
      set.delete(obstacleId);
      return false;
    }
    return true;
  };

  // Mina reaguje na VSTUP do pole: objekt, který v poli už na začátku kola je, ji nespustí, dokud nevyletí.
  const mineIgnore = new Map<string, Set<string>>();
  for (const mine of state.mines) {
    const set = new Set<string>();
    for (const s of state.ships) if (s.alive && shipHitsCircle(s, s.stats.colliders, mine, mine.radius)) set.add(s.id);
    for (const t of state.torpedoes) if (circlesOverlap(t, TORPEDO.radius, mine, mine.radius)) set.add(t.id);
    mineIgnore.set(mine.id, set);
  }

  /** Plošný výbuch: zraní lodě v poli a vykousne krátery do asteroidů. */
  const explode = (c: Vec, radius: number, damage: number, k: number, exceptOwnerId?: string) => {
    const hits: { shipId: string; damage: number }[] = [];
    for (const s of state.ships) {
      if (!s.alive || (exceptOwnerId && s.ownerId === exceptOwnerId)) continue;
      if (shipHitsCircle(posAt(shipMovers.get(s.id)!, k), s.stats.colliders, c, radius)) hits.push({ shipId: s.id, damage: scaleEvade(s, damage) });
    }
    for (const st of state.stations ?? []) if (!st.broken && Math.hypot(st.x - c.x, st.y - c.y) <= st.radius + radius) damageStation(state, st, damage, "kinetic", events, exceptOwnerId ? state.ships.find((s) => s.ownerId === exceptOwnerId)?.id : undefined, k / MOVE_STEPS, undefined, rng);
    for (const a of state.asteroids) {
      if (removedAsteroids.has(a.id)) continue;
      if (Math.hypot(a.x - c.x, a.y - c.y) > a.radius + radius) continue;
      if (!carveCrater(a, c)) continue;
      const destroyed = asteroidDestroyed(a);
      if (destroyed) removedAsteroids.add(a.id);
      events.push({ type: "asteroidHit", asteroidId: a.id, x: c.x, y: c.y, t: k / MOVE_STEPS, profile: [...a.profile], destroyed });
    }
    return hits;
  };
  const applyHits = (hits: { shipId: string; damage: number }[], k: number, from: Vec, by?: string) => {
    for (const hhit of hits) {
      const s = shipById(state, hhit.shipId)!;
      applyDamage(s, hhit.damage, events, from, by);
      if (!s.alive) shipMovers.get(s.id)!.frozenAt = k;
    }
  };

  const blastMine = (mine: Mine, k: number) => {
    removedMines.add(mine.id);
    const hits = explode(mine, mine.radius, MINE.damage, k);
    events.push({ type: "mineBlast", mineId: mine.id, x: mine.x, y: mine.y, t: k / MOVE_STEPS, hits });
    applyHits(hits, k, mine, mine.ownerId);
  };

  /** Konec torpéda: přímý zásah lodi (bez plošného výbuchu) nebo výbuch (na bodě / o asteroid / vypršení). */
  const endTorpedo = (t: Torpedo, k: number, opts: { shipId?: string; blast: boolean }) => {
    removedTorpedoes.add(t.id);
    const m = torpMovers.get(t.id)!;
    m.frozenAt = k;
    const p = m.samples[k];
    events.push({
      type: "torpedoHit",
      torpedoId: t.id,
      shipId: opts.shipId,
      x: p.x,
      y: p.y,
      t: k / MOVE_STEPS,
      damage: opts.shipId ? TORPEDO.damage : opts.blast ? TORPEDO.blastDamage : 0,
      blast: opts.blast,
    });
    if (opts.shipId) {
      const s = shipById(state, opts.shipId)!;
      applyDamage(s, scaleEvade(s, TORPEDO.damage), events, p, t.ownerId);
      if (!s.alive) shipMovers.get(s.id)!.frozenAt = k;
    }
    if (opts.blast) applyHits(explode(p, TORPEDO.blastRadius, TORPEDO.blastDamage, k, torpedoSafe(t) ? t.ownerId : undefined), k, p, t.ownerId);
  };

  // --- Miny na začátku kola: časované s odpočtem na nule a miny s nepřítelem v poli vybuchnou hned ---
  for (const mine of state.mines) {
    if (!mine.armed || removedMines.has(mine.id)) continue;
    if (mine.timer !== undefined) {
      mine.timer--;
      if (mine.timer <= 0) blastMine(mine, 0);
      continue;
    }
    const enemyInside = state.ships.some((s) => s.alive && s.team !== mine.team && shipHitsCircle(s, s.stats.colliders, mine, mine.radius));
    if (enemyInside) blastMine(mine, 0);
  }

  for (let k = 1; k <= MOVE_STEPS; k++) {
    // --- srážky lodí: odmrštění, zranění, pokračování v pohybu ---
    for (let iter = 0; iter < 4; iter++) {
      let changed = false;
      for (const ship of state.ships) {
        if (!ship.alive) continue;
        const m = shipMovers.get(ship.id)!;
        if (m.frozenAt !== null) continue;
        const p = posAt(m, k);
        const cols = ship.stats.colliders;
        const br = boundingRadius(cols);
        const t = k / MOVE_STEPS;
        let hit: { with: "edge" | "asteroid" | "ship"; otherId?: string; heading: number } | null = null;

        const outside = !shipInsideMap(state.width, state.height, p, cols);
        if (state.border) {
          // okrajová bouře: loď letí dál (bouře zraňuje průběžně); dotyk tvrdého okraje = zničení
          if (beyondHardEdge(state, p, state.border, br)) {
            events.push({ type: "collision", shipId: ship.id, with: "edge", t, newHeading: p.heading });
            applyDamage(ship, ship.hull, events);
            m.frozenAt = k;
            changed = true;
            continue;
          }
        }
        if (outside && !state.border && !stillTouching(ship.id, "edge", true)) {
          // odraz od hrany oválu (jen bez okrajové bouře)
          hit = { with: "edge", heading: normalizeAngle(reflectAtEdge(state, p, p.heading) + scatter()) };
        } else {
          if (!outside) stillTouching(ship.id, "edge", false);
          for (const a of obstacles(state)) {
            if (removedAsteroids.has(a.id)) continue;
            const ov = shipHitsAsteroid(a, p, cols);
            // úhybný manévr: asteroidem proletí (kromě posledního vzorku – nesmí v něm skončit, jinak dvojité zranění)
            if (ov && k < MOVE_STEPS && evading.has(ship.id)) {
              const key = `${ship.id}:${a.id}`;
              if (!passedThrough.has(key)) {
                passedThrough.add(key);
                events.push({ type: "evadeThrough", shipId: ship.id, with: "asteroid", otherId: a.id, t, x: p.x, y: p.y });
              }
              continue;
            }
            if (ov && !stillTouching(ship.id, a.id, true)) {
              // náraz do asteroidu/stanice: loď u něj zastaví (viz crash níže)
              hit = { with: "asteroid", otherId: a.id, heading: p.heading };
              break;
            }
            if (!ov) stillTouching(ship.id, a.id, false);
          }
        }
        if (!hit) {
          for (const other of state.ships) {
            if (other === ship || !other.alive) continue;
            // po srážce mají obě lodě jedno kolo imunitu vůči sobě (ať se od sebe dokážou rozjet)
            if ((ship.collidedWith?.[other.id] ?? -1) >= turn || (other.collidedWith?.[ship.id] ?? -1) >= turn) continue;
            const om = shipMovers.get(other.id)!;
            const op = posAt(om, k);
            const ov = shipsOverlapPadded(p, cols, shieldPad(ship), op, other.stats.colliders, shieldPad(other));
            if (!ov) {
              stillTouching(ship.id, other.id, false);
              continue;
            }
            // úhybný manévr: nepřátelské lodě se prolétají (kromě posledního vzorku – nesmí skončit v dotyku)
            const enemyPair = other.team !== ship.team;
            if (enemyPair && k < MOVE_STEPS && (evading.has(ship.id) || evading.has(other.id))) {
              const evader = evading.has(ship.id) ? ship : other;
              const victim = evader === ship ? other : ship;
              const key = `${evader.id}:${victim.id}`;
              if (!passedThrough.has(key)) {
                passedThrough.add(key);
                events.push({ type: "evadePass", shipId: evader.id, victimId: victim.id, t: k / MOVE_STEPS, x: (p.x + op.x) / 2, y: (p.y + op.y) / 2 });
                const before = victim.stressPoints;
                victim.stressPoints = Math.max(0, victim.stressPoints - RULES.evadePassStress);
                if (victim.stressPoints !== before) events.push({ type: "stress", shipId: victim.id, stressPoints: victim.stressPoints, delta: victim.stressPoints - before });
              }
              continue;
            }
            if (stillTouching(ship.id, other.id, true)) continue;
            // srážka lodí: obě zastaví v místě dotyku (i štítů), kurz zůstává; příští kolo se vůči sobě nesrazí
            hit = { with: "ship", otherId: other.id, heading: p.heading };
            ship.collidedWith = { ...(ship.collidedWith ?? {}), [other.id]: turn + 1 };
            other.collidedWith = { ...(other.collidedWith ?? {}), [ship.id]: turn + 1 };
            if (om.frozenAt === null) {
              freeze(om, k);
              stopped.add(other.id);
              touching.get(other.id)!.add(ship.id);
              events.push({ type: "collision", shipId: other.id, with: "ship", otherId: ship.id, t, newHeading: op.heading });
              applyDamage(other, RULES.collisionShip, events, p);
            }
            break;
          }
        }
        if (hit) {
          if (hit.with === "edge") deflect(m, k, hit.heading);
          else {
            freeze(m, k);
            if (hit.with === "ship") stopped.add(ship.id);
          }
          touching.get(ship.id)!.add(hit.otherId ?? "edge");
          events.push({ type: "collision", shipId: ship.id, with: hit.with, otherId: hit.otherId, t, newHeading: hit.heading });
          const src: Vec =
            hit.with === "ship"
              ? posAt(shipMovers.get(hit.otherId!)!, k)
              : hit.with === "asteroid"
                ? obstacles(state).find((a) => a.id === hit!.otherId)!
                : { x: p.x + Math.cos(edgeNormal(state, p)) * 10, y: p.y + Math.sin(edgeNormal(state, p)) * 10 };
          const dbl = hit.with === "asteroid" && evading.has(ship.id) ? 2 : 1; // úhyb skončil v asteroidu
          if (hit.with === "asteroid" && !isStationId(state, hit.otherId!)) {
            // náraz vykousne do asteroidu díru v místě dotyku (na obrysu lodi směrem k asteroidu)
            const a = src as Asteroid;
            const ang = Math.atan2(a.y - p.y, a.x - p.x);
            const contact: Vec = { x: p.x + Math.cos(ang) * ship.stats.radius, y: p.y + Math.sin(ang) * ship.stats.radius };
            if (carveCrater(a, contact, Math.max(RULES.crashCrater, ship.stats.radius))) {
              const destroyed = asteroidDestroyed(a);
              if (destroyed) removedAsteroids.add(a.id);
              events.push({ type: "asteroidHit", asteroidId: a.id, x: contact.x, y: contact.y, t, profile: [...a.profile], destroyed });
            }
            crashed.add(ship.id);
          } else if (hit.with === "asteroid") crashed.add(ship.id); // stanice: stejný tvrdý náraz, bez díry
          applyDamage(ship, hit.with === "ship" ? RULES.collisionShip : hit.with === "asteroid" ? RULES.collisionAsteroid * dbl : RULES.collisionEdge, events, src);
          if (!ship.alive) m.frozenAt = k - 1;
          changed = true;
        }
      }
      if (!changed) break;
    }

    // --- komety: náraz do lodi (zranění + odmrštění), asteroidu, torpéda; odlet z mapy; průlet ocasem ---
    for (const c of state.comets) {
      if (removedComets.has(c.id)) continue;
      const cm = cometMovers.get(c.id)!;
      const cp = cm.samples[k];
      if (!cometOnMap(state, cp)) {
        // za okrajem: jen přilétá (nebo odlétá) – žádné srážky; odlétá dál přes okrajovou bouři a zmizí až za tvrdým okrajem
        if (c.entered && !insideMap(state, cp, -(c.radius + (state.border ?? 0) + COMET.tailLength))) endComet(c, k, "edge");
        continue;
      }
      c.entered = true;
      let done = false;
      for (const s of state.ships) {
        if (!s.alive) continue;
        const sm = shipMovers.get(s.id)!;
        const sp = posAt(sm, k);
        if (!shipHitsCircle(sp, s.stats.colliders, cp, c.radius)) continue;
        if (k < MOVE_STEPS && evading.has(s.id)) {
          const key = `${s.id}:${c.id}`;
          if (!passedThrough.has(key)) {
            passedThrough.add(key);
            events.push({ type: "evadeThrough", shipId: s.id, with: "comet", otherId: c.id, t: k / MOVE_STEPS, x: sp.x, y: sp.y });
          }
          continue;
        }
        if (sm.frozenAt === null) {
          // náraz komety: loď se otočí náhodným směrem, zpomalí na 1 a ztratí stres (viz crash níže)
          const h = normalizeAngle(rng.next() * Math.PI * 2);
          deflect(sm, k, h);
          cometCrashed.add(s.id);
          events.push({ type: "collision", shipId: s.id, with: "comet", otherId: c.id, t: k / MOVE_STEPS, newHeading: h });
        }
        const dmg = evading.has(s.id) ? COMET.damage * 2 : COMET.damage; // úhyb skončil v kometě = dvojité zranění
        endComet(c, k, "ship", s.id, dmg);
        applyDamage(s, dmg, events, cp);
        if (!s.alive) sm.frozenAt = k - 1;
        done = true;
        break;
      }
      if (done) continue;
      const torp = state.torpedoes.find((t) => !removedTorpedoes.has(t.id) && circlesOverlap(cp, c.radius, posAt(torpMovers.get(t.id)!, k), TORPEDO.radius));
      if (torp) {
        endTorpedo(torp, k, { blast: false });
        endComet(c, k, "torpedo");
        continue;
      }
      if (COMET.collide) {
        const other = state.comets.find((o) => o !== c && !removedComets.has(o.id) && circlesOverlap(cp, c.radius, cometMovers.get(o.id)!.samples[k], o.radius));
        if (other) {
          endComet(c, k, "comet");
          endComet(other, k, "comet");
          continue;
        }
      }
      // stanice zastaví kometu vždy (zranění jako náraz do lodi)
      const stnHit = (state.stations ?? []).find((x) => circlesOverlap(cp, c.radius, x, x.radius));
      if (stnHit) {
        damageStation(state, stnHit, COMET.damage, "kinetic", events, undefined, k / MOVE_STEPS, (cc, radius, damage) => applyHits(explode(cc, radius, damage, k), k, cc), rng);
        endComet(c, k, "asteroid");
        continue;
      }
      if (cometHitAsteroids) {
        const a = state.asteroids.find((x) => !removedAsteroids.has(x.id) && circleHitsAsteroid(x, cp, c.radius));
        if (a) {
          if (carveCrater(a, cp)) {
            const destroyed = asteroidDestroyed(a);
            if (destroyed) removedAsteroids.add(a.id);
            events.push({ type: "asteroidHit", asteroidId: a.id, x: cp.x, y: cp.y, t: k / MOVE_STEPS, profile: [...a.profile], destroyed });
          }
          endComet(c, k, "asteroid");
          continue;
        }
      }
      // ocas: střed lodi v obdélníku za kometou
      for (const s of state.ships) {
        if (!s.alive || c.tailUsed.includes(s.id)) continue;
        if (inCometTail(cp, posAt(shipMovers.get(s.id)!, k), COMET.tailLength, COMET.tailWidth, c.radius)) tailBonus(c, s, k);
      }
    }

    // --- miny (spouští je lodě, torpéda i komety) ---
    for (const mine of state.mines) {
      if (!mine.armed || removedMines.has(mine.id) || mine.timer !== undefined) continue;
      const ignore = mineIgnore.get(mine.id)!;
      const shipsIn = state.ships.filter((s) => s.alive && shipHitsCircle(posAt(shipMovers.get(s.id)!, k), s.stats.colliders, mine, mine.radius));
      const torpsIn = state.torpedoes.filter((t) => !removedTorpedoes.has(t.id) && circlesOverlap(posAt(torpMovers.get(t.id)!, k), TORPEDO.radius, mine, mine.radius));
      const cometsIn = state.comets.filter((c) => !removedComets.has(c.id) && cometOnMap(state, cometMovers.get(c.id)!.samples[k]) && circlesOverlap(cometMovers.get(c.id)!.samples[k], c.radius, mine, mine.radius));
      const inIds = new Set([...shipsIn.map((s) => s.id), ...torpsIn.map((t) => t.id), ...cometsIn.map((c) => c.id)]);
      for (const id of [...ignore]) if (!inIds.has(id)) ignore.delete(id);
      if (![...inIds].some((id) => !ignore.has(id))) continue;
      blastMine(mine, k);
      for (const t of torpsIn) if (!removedTorpedoes.has(t.id)) endTorpedo(t, k, { blast: false });
      for (const c of cometsIn) if (!removedComets.has(c.id)) endComet(c, k, "mine");
    }

    // --- torpéda ---
    for (const t of state.torpedoes) {
      if (removedTorpedoes.has(t.id)) continue;
      const m = torpMovers.get(t.id)!;
      const p = m.samples[k];
      const safe = torpedoSafe(t); // ochranná lhůta: vlastníkovy lodě torpédo neporaní a proletí jimi
      let hitShip: Ship | undefined;
      for (const s of state.ships) {
        if (!s.alive) continue;
        if (safe && s.ownerId === t.ownerId) continue;
        if (shipHitsCircle(posAt(shipMovers.get(s.id)!, k), s.stats.colliders, p, TORPEDO.radius)) {
          hitShip = s;
          break;
        }
      }
      if (hitShip) {
        endTorpedo(t, k, { shipId: hitShip.id, blast: false });
        continue;
      }
      const other = state.torpedoes.find((o) => o !== t && !removedTorpedoes.has(o.id) && circlesOverlap(p, TORPEDO.radius, posAt(torpMovers.get(o.id)!, k), TORPEDO.radius));
      if (other) {
        endTorpedo(t, k, { blast: false });
        endTorpedo(other, k, { blast: false });
        continue;
      }
      if (t.targetPoint && dist(p, t.targetPoint) <= Math.max(6, (m.length / MOVE_STEPS) * 0.6)) {
        endTorpedo(t, k, { blast: true });
        continue;
      }
      if (hitsAsteroid(state, p, TORPEDO.radius)) {
        endTorpedo(t, k, { blast: true });
        continue;
      }
      if (!isInsideMap(state, p, 0)) endTorpedo(t, k, { blast: false });
    }
  }

  // Výsledné pozice + dráhy pro animaci
  const paths: MovePath[] = [];
  for (const ship of state.ships) {
    const m = shipMovers.get(ship.id);
    if (!m) continue;
    const end = m.frozenAt !== null ? m.frozenAt : MOVE_STEPS;
    const points = m.samples.map((_, i) => m.samples[Math.min(i, end)]);
    const man = maneuverOf.get(ship.id)!;
    if (man.koiogran && m.collided) points[MOVE_STEPS] = { ...points[MOVE_STEPS], heading: points[MOVE_STEPS - 1].heading };
    paths.push({ id: ship.id, kind: "ship", points });
    const fin = points[MOVE_STEPS];
    ship.x = fin.x;
    ship.y = fin.y;
    ship.heading = normalizeAngle(fin.heading);
    ship.lastManeuverId = man.id;
  }
  for (const t of state.torpedoes) {
    const m = torpMovers.get(t.id)!;
    const end = m.frozenAt !== null ? m.frozenAt : MOVE_STEPS;
    paths.push({ id: t.id, kind: "torpedo", points: m.samples.map((_, i) => m.samples[Math.min(i, end)]) });
    const fin = m.samples[end];
    t.x = fin.x;
    t.y = fin.y;
    t.heading = normalizeAngle(fin.heading);
    t.lifeLeft--;
    t.trackLeft = Math.max(0, t.trackLeft - 1);
    if (!removedTorpedoes.has(t.id) && t.lifeLeft <= 0) {
      if (t.targetPoint) endTorpedo(t, MOVE_STEPS, { blast: true });
      else {
        removedTorpedoes.add(t.id);
        events.push({ type: "torpedoExpire", torpedoId: t.id, x: t.x, y: t.y });
      }
    }
  }
  for (const c of state.comets) {
    const m = cometMovers.get(c.id)!;
    const end = m.frozenAt !== null ? m.frozenAt : MOVE_STEPS;
    paths.push({ id: c.id, kind: "comet", points: m.samples.map((_, i) => m.samples[Math.min(i, end)]) });
    const fin = m.samples[end];
    c.x = fin.x;
    c.y = fin.y;
  }
  events.splice(preMoveCount, 0, ...spawnEvents, { type: "move", paths });
  state.comets = state.comets.filter((c) => !removedComets.has(c.id));
  state.torpedoes = state.torpedoes.filter((t) => !removedTorpedoes.has(t.id));
  state.mines = state.mines.filter((m) => !removedMines.has(m.id));
  state.asteroids = state.asteroids.filter((a) => !removedAsteroids.has(a.id));

  // Stresové body a nebezpečný manévr
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const man = maneuverOf.get(ship.id)!;
    const od = orders.get(ship.id);
    ship.speed = man.stop ? 0 : man.koiogran ? Math.max(1, man.speed - RULES.koiogranSpeedDrop) : man.speed;
    if (crashed.has(ship.id) || stopped.has(ship.id)) ship.speed = 0;
    else if (cometCrashed.has(ship.id)) ship.speed = 1;
    const cost = effStressCost(man, od);
    const stM = statsOf(state, ship.ownerId);
    if (stM) {
      stM.maneuvers[man.difficulty]++;
      if (man.koiogran) stM.maneuvers.koiogran++;
    }
    const before = ship.stressPoints;
    ship.stressPoints = crashed.has(ship.id) || cometCrashed.has(ship.id) ? 0 : clamp(ship.stressPoints - cost, 0, ship.stats.stressMax);
    if (ship.stressPoints !== before) events.push({ type: "stress", shipId: ship.id, stressPoints: ship.stressPoints, delta: ship.stressPoints - before });
    if (man.difficulty === "danger" && !od?.droid?.overdrive) applyDamage(ship, Math.max(1, Math.round((ship.stats.hull * STRESS.dangerHullPercent) / 100)), events);
  }

  // okrajová bouře: zranění trupu podle části dráhy strávené mimo ovál (štíty tam nefungují)
  if (state.border && RULES.borderDamage > 0) {
    for (const ship of state.ships) {
      if (!ship.alive) continue;
      const m = shipMovers.get(ship.id)!;
      const last = m.frozenAt ?? MOVE_STEPS;
      let n = 0;
      for (let k = 1; k <= MOVE_STEPS; k++) if (!insideMap(state, posAt(m, Math.min(k, last)))) n++;
      if (!n) continue;
      const dmg = Math.ceil((RULES.borderDamage * n) / MOVE_STEPS);
      events.push({ type: "borderStorm", shipId: ship.id, damage: dmg, fraction: n / MOVE_STEPS });
      applyDamage(ship, dmg, events);
    }
  }

  /* ---------- 2. Akce ---------- */
  const canAct = (ship: Ship) => ship.alive && !shipMovers.get(ship.id)!.collided;

  const spotFree = (self: Ship, p: Pose): boolean => {
    const cols = self.stats.colliders;
    if (!shipInsideMap(state.width, state.height, p, cols)) return false;
    if (obstacles(state).some((a) => shipHitsAsteroid(a, p, cols))) return false;
    for (const o of state.ships) {
      if (o !== self && o.alive && shipsOverlap(p, cols, o, o.stats.colliders)) return false;
    }
    return true;
  };

  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!o?.action || o.action.type === "evade" || o.action.type === "shield" || o.action.type === "jettison" || o.action.type === "pickup") continue;
    if (!canAct(ship)) {
      events.push({ type: "action", shipId: ship.id, action: o.action, ok: false });
      continue;
    }
    const a = o.action;
    switch (a.type) {
      case "focus":
        ship.tokens.focus = 1;
        events.push({ type: "action", shipId: ship.id, action: a, ok: true });
        break;
      case "lock": {
        const t = shipById(state, a.targetId);
        const ok = !!t && t.alive && t.team !== ship.team && dist(ship, t) <= LOCK_RANGE;
        if (ok) ship.lockTargetId = t!.id;
        events.push({ type: "action", shipId: ship.id, action: a, ok });
        break;
      }
      case "boost": {
        const angle = a.dir === "straight" ? 0 : a.dir === "left" ? -Math.PI / 4 : Math.PI / 4;
        const path = makePath(ship, MOVE_UNIT, angle);
        const end = path(1);
        const ok = spotFree(ship, end);
        if (ok) {
          ship.x = end.x;
          ship.y = end.y;
          ship.heading = normalizeAngle(end.heading);
        }
        events.push({ type: "action", shipId: ship.id, action: a, ok, path: ok ? samplePath(path, 8) : undefined });
        break;
      }
      case "barrelRoll": {
        const r = rightOf(ship.heading);
        const sign = a.side === "left" ? -1 : 1;
        const end: Pose = { x: ship.x + r.x * MOVE_UNIT * sign, y: ship.y + r.y * MOVE_UNIT * sign, heading: ship.heading };
        const ok = spotFree(ship, end);
        const from: Pose = { x: ship.x, y: ship.y, heading: ship.heading };
        if (ok) {
          ship.x = end.x;
          ship.y = end.y;
        }
        events.push({ type: "action", shipId: ship.id, action: a, ok, path: ok ? [from, end] : undefined });
        break;
      }
    }
  }

  /* ---------- 5. Konec kola ---------- */
  for (const mine of state.mines) mine.armed = true;
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    if (ship.shieldType === "whole") ship.shields = Math.min(ship.stats.shields, ship.shields + RULES.shieldRecharge);
    ship.tokens.focus = 0;
    ship.tokens.evade = 0;
    if (ship.lockTargetId && !shipById(state, ship.lockTargetId)?.alive) ship.lockTargetId = undefined;
  }
  for (const p of state.players) if (state.ships.some((s) => s.alive && s.ownerId === p.id)) awardCredits(state, events, p.id, RULES.creditsPerTurn, "survive");
  // pasivní oprava trupu (hacker): jen když droid funguje a loď není v bouři; hack modulů platil jen na toto kolo
  for (const ship of state.ships) {
    for (const m of ship.loadout.modules) if (m.hacked) delete m.hacked;
    if (!ship.alive || !(ship.autoRepair ?? 0)) continue;
    if (hackerModule(ship) && !inStorm(state, ship)) {
      const amount = Math.min(Math.max(1, Math.round((ship.stats.hull * HACK.repairPct) / 100)), ship.stats.hull - ship.hull);
      ship.autoRepair = (ship.autoRepair ?? 1) - 1;
      if (amount > 0) ship.hull += amount;
      events.push({ type: "autoRepair", shipId: ship.id, amount: Math.max(0, amount), hullAfter: ship.hull, turnsLeft: ship.autoRepair });
    }
  }
  for (const stn of state.stations ?? []) if (!stn.broken) stn.shields = Math.min(stn.maxShields, stn.shields + STATION.shieldRegen);
  // prošlá imunita po srážce
  for (const ship of state.ships) {
    if (!ship.collidedWith) continue;
    const keep = Object.fromEntries(Object.entries(ship.collidedWith).filter(([, t]) => t > turn));
    ship.collidedWith = Object.keys(keep).length ? keep : undefined;
  }
  state.revealTeams = []; // hluboký sken platí jen do konce kola
  creditCtx = null;
  state.turn = turn + 1;

  const result = checkVictory(state);
  if (result) {
    state.status = "finished";
    state.result = result;
  }

  return { turn, orders: [...orders.values()], events, state };
}

/* ------------------------------------------------------------------ */
/* Vítězství                                                            */
/* ------------------------------------------------------------------ */

export function checkVictory(state: GameState): GameResult | null {
  const alive = state.ships.filter((s) => s.alive);
  const teams = new Set(alive.map((s) => s.team));
  const ownerOfTeam = (team: number) => state.players.find((p) => p.team === team)?.id ?? null;

  if (teams.size <= 1) {
    const team = teams.size === 1 ? [...teams][0] : null;
    return {
      winnerTeam: team,
      winnerPlayerId: state.settings.mode === "dm" && team !== null ? ownerOfTeam(team) : null,
      reason: "elimination",
    };
  }
  if (state.settings.turnLimit > 0 && state.turn > state.settings.turnLimit) {
    const score = new Map<number, number>();
    for (const s of alive) score.set(s.team, (score.get(s.team) ?? 0) + s.hull + s.shields);
    let best: number | null = null;
    let bestScore = -1;
    let tie = false;
    for (const [team, sc] of score) {
      if (sc > bestScore) {
        best = team;
        bestScore = sc;
        tie = false;
      } else if (sc === bestScore) tie = true;
    }
    if (tie) best = null;
    return {
      winnerTeam: best,
      winnerPlayerId: state.settings.mode === "dm" && best !== null ? ownerOfTeam(best) : null,
      reason: "turnLimit",
    };
  }
  return null;
}

/** Cíl laserů podle stejných pravidel jako vyhodnocení (preferovaný ve výseči, jinak nejbližší). Pro náhled v plánování. */
export function laserTarget(state: GameState, ship: Ship, preferredTargetId?: string, laserModuleId?: string): Ship | undefined {
  const lmod = laserModule(ship, laserModuleId);
  const aim = aimPose(ship, lmod);
  const arc = laserHalfArc(lmod?.facing, ship.loadout.hullId);
  if (inStorm(state, ship)) return undefined;
  const candidates = state.ships.filter(
    (e) => e.alive && e.team !== ship.team && sectorCoverage(aim, laserRange(ship), arc, e) > 0 && !lineBlocked(obstacles(state), aim, e) && !laserBlockedByStorm(state, ship, e),
  );
  if (candidates.length === 0) return undefined;
  return candidates.find((c) => c.id === preferredTargetId) ?? candidates.reduce((best, c) => (dist(aim, c) < dist(aim, best) ? c : best));
}

/** Výseč laserů pro náhled: natočení a poloviční úhel podle modulu. */
/** Dosáhne laser na bod (kometa / trosky) z aktuální pozice? Vrací důvod, proč ne. */
export function laserReach(state: GameState, ship: Ship, p: Vec, laserModuleId?: string): string | null {
  if (inStorm(state, ship)) return "loď je v bouři";
  const lmod = laserModule(ship, laserModuleId);
  const aim = aimPose(ship, lmod);
  if (!cometOnMap(state, p)) return "ještě není na mapě";
  if (dist(aim, p) > laserRange(ship)) return "mimo dostřel";
  if (!inArc(aim, p, laserHalfArc(lmod?.facing, ship.loadout.hullId))) return "mimo výseč laseru";
  if (lineBlocked(obstacles(state), aim, p)) return "v cestě je asteroid";
  if (laserBlockedByStorm(state, ship, p)) return "cíl je v bouři";
  return null;
}

/** Proč laser (daný modul) nedosáhne na nepřátelskou loď – s čísly pro hráče; null = v pořádku. */
export function laserReachShip(state: GameState, ship: Ship, target: Ship, laserModuleId?: string): string | null {
  if (inStorm(state, ship)) return "loď je v bouři – lasery nefungují";
  const lmod = laserModule(ship, laserModuleId);
  const aim = aimPose(ship, lmod);
  const arc = laserHalfArc(lmod?.facing, ship.loadout.hullId);
  const cov = sectorCoverage(aim, laserRange(ship), arc, target);
  if (cov > 0) {
    if (lineBlocked(obstacles(state), aim, target)) return "v cestě je asteroid";
    if (laserBlockedByStorm(state, ship, target)) return "cíl je v bouři";
    return null;
  }
  const d = Math.round(dist(aim, target) - target.stats.radius);
  if (d > laserRange(ship)) return `mimo dostřel (${d} / ${laserRange(ship)})`;
  const rel = Math.round((Math.abs(normalizeAngle(Math.atan2(target.y - aim.y, target.x - aim.x) - aim.heading)) * 180) / Math.PI);
  return `mimo výseč laseru (${rel}° od osy, výseč ±${Math.round((arc * 180) / Math.PI)}°)`;
}

export function laserArcOf(ship: Ship, laserModuleId?: string): { x: number; y: number; heading: number; halfArc: number; range: number } {
  const lmod = laserModule(ship, laserModuleId);
  const aim = aimPose(ship, lmod);
  return { x: aim.x, y: aim.y, heading: aim.heading, halfArc: laserHalfArc(lmod?.facing, ship.loadout.hullId), range: laserRange(ship) };
}

/** Šance laserů na zásah (aspoň jeden čistý zásah) a očekávané zranění proti danému cíli ze současných pozic. */
export function laserOdds(ship: Ship, target: Ship, laserModuleId?: string): { hitChance: number; expectedDamage: number; rangeBand: number; coverage: number } {
  const lmod = laserModule(ship, laserModuleId);
  const aim = aimPose(ship, lmod);
  const hitArea = sectorHit(aim, laserRange(ship), laserHalfArc(lmod?.facing, ship.loadout.hullId), target);
  const rangeBand = hitArea.band;
  const coverage = hitArea.coverage;
  const odds = attackOdds({
    attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0),
    defenseDice: target.stats.agility + (rangeBand === 3 ? 1 : 0),
    attackerFocus: ship.tokens.focus > 0,
    attackerLock: ship.lockTargetId === target.id,
    defenderFocus: target.tokens.focus > 0,
    defenderEvade: target.tokens.evade > 0,
    coverage,
  });
  return { hitChance: odds.hitChance, expectedDamage: odds.expectedHits * RULES.damagePerHit, rangeBand, coverage };
}

/**
 * Skener – okamžitá akce při plánování (nebere akci, čerpá body technologie lodi). Vrací chybu, nebo provede:
 * ship = SCANNER.shipCost bodů, cíl musí být nepřátelská loď v dosahu (viditelnost ověřuje server);
 * deep = SCANNER.deepCost bodů, odkryje mapu týmu do konce kola.
 */
/** Vidí hráč v tomto kole předpověď manévrů botů (zaplatil skenerem)? */
export function botPredictActive(state: GameState, playerId: string): boolean {
  return (state.botPredict?.[playerId] ?? -1) >= state.turn;
}

export function applyScan(state: GameState, ship: Ship, moduleId: string, mode: "ship" | "deep" | "cooldown" | "predict", targetId?: string): { error?: string; target?: Ship } {
  const mod = ship.loadout.modules.find((m) => m.id === moduleId && m.type === "scanner");
  if (!mod) return { error: "loď nemá skener" };
  if (!moduleWorking(mod)) return { error: "skener je zničený" };
  if (mod.hacked) return { error: "skener je hacknutý" };
  if (mode === "cooldown") return { error: "cooldown skeneru už ve hře není" };
  if (mode === "predict") {
    if (botPredictActive(state, ship.ownerId)) return { error: "předpověď manévrů už běží" };
    if (ship.techPoints < SCANNER.predictCost) return { error: `nedostatek technologie (${ship.techPoints}/${SCANNER.predictCost})` };
    if (inStorm(state, ship)) return { error: "bouře ruší skener" };
    ship.techPoints -= SCANNER.predictCost;
    const st = statsOf(state, ship.ownerId);
    if (st) st.scans++;
    state.botPredict = { ...(state.botPredict ?? {}), [ship.ownerId]: state.turn + SCANNER.predictTurns - 1 };
    return {};
  }
  const cost = mode === "ship" ? SCANNER.shipCost : SCANNER.deepCost;
  if (ship.techPoints < cost) return { error: `nedostatek technologie (${ship.techPoints}/${cost})` };
  if (mode === "ship") {
    const target = state.ships.find((s) => s.id === targetId && s.alive && s.team !== ship.team);
    if (!target) return { error: "cíl skenu není cizí živá loď" };
    if (dist(ship, target) > SCANNER.range) return { error: `cíl je mimo dosah skeneru (${SCANNER.range})` };
    if (inStorm(state, ship) || inStorm(state, target)) return { error: "bouře ruší skener" };
    ship.techPoints -= cost;
    const st = statsOf(state, ship.ownerId);
    if (st) st.scans++;
    return { target };
  }
  if (inStorm(state, ship)) return { error: "bouře ruší skener" };
  ship.techPoints -= cost;
  const st = statsOf(state, ship.ownerId);
  if (st) st.scans++;
  state.revealTeams = [...new Set([...(state.revealTeams ?? []), ship.team])];
  return {};
}

/** Aktivní (funkční) modul štítu lodi. */
export function activeShieldModule(ship: Ship): ModuleInstance | undefined {
  return ship.shieldType === "none" ? undefined : activeShield(ship.loadout);
}

/** Kolik může dobití štítu ještě přidat (0 = štít je plný / není). Segmentový: volné body do maxima na segment. */
export function shieldRechargeRoom(ship: Ship): number {
  if (ship.shieldType === "whole") return Math.max(0, ship.stats.shields - ship.shields);
  if (ship.shieldType === "segment") {
    const cap = RULES.segmentHp * ship.stats.segmentModules;
    return ship.segments.reduce((a, b) => a + Math.max(0, cap - b), 0);
  }
  return 0;
}

/** Proč nejde dobít štít technologií (undefined = jde). */
/* ---------- Droid – opravář ---------- */

/** Funkční droid opravář lodi (první). */
export function repairModule(ship: Ship): ModuleInstance | undefined {
  return ship.loadout.modules.find((m) => m.type === "repair" && moduleUsable(m));
}

/** Cena úkonu opraváře v bodech technologie. */
export function repairCost(kind: RepairOrder["kind"]): number {
  return kind === "module" ? REPAIR.moduleCost : kind === "ammo" ? REPAIR.ammoCost : kind === "hull" ? REPAIR.hullCost : REPAIR.installCost;
}

/** Proč opravář teď nemůže pracovat (undefined = může). */
export function repairBlocked(state: GameState, ship: Ship): string | undefined {
  if (!repairModule(ship)) return "loď nemá funkční droida opraváře";
  if (inStorm(state, ship)) return "v bouři droid nefunguje";
  return undefined;
}

/** Moduly, které opravář umí opravit (poškozené nebo zničené). */
export function repairableModules(ship: Ship): ModuleInstance[] {
  return ship.loadout.modules.filter((m) => moduleHp(m) < moduleMaxHp(m.type));
}
/** Moduly, do kterých lze vyrobit munici (torpéda/miny pod plným zásobníkem). */
export function ammoModules(ship: Ship): ModuleInstance[] {
  return ship.loadout.modules.filter((m) => (MODULES[m.type]?.ammo ?? 0) > 0 && (m.ammo ?? 0) < (MODULES[m.type].ammo ?? 0));
}
/** O kolik trupu opraví úkon „oprava trupu“ (max. do plného). */
export function repairHullAmount(ship: Ship): number {
  return Math.min(Math.max(1, Math.round((ship.stats.hull * REPAIR.hullPct) / 100)), ship.stats.hull - ship.hull);
}

/**
 * Úkon droida opraváře – provede se hned při plánování, nebere akci, platí se technologií.
 * Instalace: modul z nákladu do libovolného slotu; obsazený slot → stávající modul (i velký, zabírající dvojici) jde do nákladu.
 */
export function applyRepair(state: GameState, ship: Ship, order: RepairOrder): { error?: string; event?: TurnEvent } {
  const why = repairBlocked(state, ship);
  if (why) return { error: why };
  const cost = repairCost(order.kind);
  if (ship.techPoints < cost) return { error: `nedostatek technologie (${ship.techPoints}/${cost})` };
  const base = { type: "repair" as const, shipId: ship.id, kind: order.kind, cost };
  switch (order.kind) {
    case "module": {
      const m = ship.loadout.modules.find((x) => x.id === order.moduleId);
      if (!m) return { error: "takový modul loď nemá" };
      const max = moduleMaxHp(m.type);
      const hp = moduleHp(m);
      if (hp >= max) return { error: "modul je nepoškozený" };
      m.hp = undefined;
      delete m.repair;
      ship.techPoints -= cost;
      syncShields(ship);
      return { event: { ...base, techPoints: ship.techPoints, moduleId: m.id, moduleType: m.type, amount: max - hp } };
    }
    case "ammo": {
      const m = ship.loadout.modules.find((x) => x.id === order.moduleId);
      if (!m) return { error: "takový modul loď nemá" };
      const cap = MODULES[m.type]?.ammo ?? 0;
      if (!cap) return { error: "modul nemá munici" };
      if ((m.ammo ?? 0) >= cap) return { error: "zásobník je plný" };
      m.ammo = (m.ammo ?? 0) + 1;
      ship.techPoints -= cost;
      refreshShip(ship);
      return { event: { ...base, techPoints: ship.techPoints, moduleId: m.id, moduleType: m.type, amount: 1 } };
    }
    case "hull": {
      const amount = repairHullAmount(ship);
      if (amount <= 0) return { error: "trup je nepoškozený" };
      ship.hull += amount;
      ship.techPoints -= cost;
      return { event: { ...base, techPoints: ship.techPoints, amount, hullAfter: ship.hull } };
    }
    case "install": {
      const cargo = ship.loadout.cargo ?? [];
      const ci = cargo.findIndex((x) => x.id === order.moduleId);
      if (ci < 0) return { error: "takový modul v nákladu není" };
      const hull = hullOf(ship.loadout);
      if (!hull.slots.some((x) => x.id === order.slot)) return { error: "takový slot loď nemá" };
      const mod = cargo[ci];
      // obsazený slot → stávající modul (i velký) jde do nákladu místo nasazovaného
      const outIdx = ship.loadout.modules.findIndex((x) => occupiedSlots(x).includes(order.slot));
      const out = outIdx >= 0 ? ship.loadout.modules[outIdx] : undefined;
      const facing = hasFacing(mod.type) ? (order.facing && allowedFacings(mod.type, order.slot).includes(order.facing) ? order.facing : defaultFacing(mod.type, order.slot)) : undefined;
      const installed: ModuleInstance = { ...mod, slot: order.slot, facing, off: undefined };
      cargo.splice(ci, 1);
      if (out) {
        ship.loadout.modules.splice(outIdx, 1);
        cargo.splice(ci, 0, { ...out, off: undefined });
      }
      ship.loadout.modules.push(installed);
      ship.loadout.cargo = cargo.length ? cargo : undefined;
      ship.techPoints -= cost;
      syncShields(ship);
      return { event: { ...base, techPoints: ship.techPoints, moduleId: installed.id, moduleType: installed.type, slot: order.slot, swappedType: out?.type } };
    }
  }
}

/* ---------- Droid – hacker ---------- */

export function hackerModule(ship: Ship): ModuleInstance | undefined {
  return ship.loadout.modules.find((m) => m.type === "hacker" && moduleUsable(m));
}
export function hackCost(kind: HackOrder["kind"]): number {
  return kind === "module" ? HACK.moduleCost : kind === "repair" ? HACK.repairCost : HACK.ordnanceCost;
}
export function hackBlocked(state: GameState, ship: Ship): string | undefined {
  if (!hackerModule(ship)) return "loď nemá funkční droida hackera";
  if (inStorm(state, ship)) return "v bouři droid nefunguje";
  return undefined;
}

/**
 * Úkon hackera – hned při plánování, nebere akci, platí se technologií. `seen` = stav, jak ho vidí tým hackera
 * (cíl musí být v dohledu). Mina: přejde hackerovi (volitelně odpočet: 1 = vybuchne na startu kola, n = za n−1 kol);
 * torpédo: přejde hackerovi, nový cíl, +kola života; modul: cizí modul na toto kolo nefunguje; oprava: pasivní oprava trupu.
 */
export function applyHack(state: GameState, seen: GameState, ship: Ship, order: HackOrder): { error?: string; event?: TurnEvent } {
  const why = hackBlocked(state, ship);
  if (why) return { error: why };
  const cost = hackCost(order.kind);
  if (ship.techPoints < cost) return { error: `nedostatek technologie (${ship.techPoints}/${cost})` };
  const base = { type: "hack" as const, shipId: ship.id, kind: order.kind, cost };
  switch (order.kind) {
    case "mine": {
      const mine = state.mines.find((m) => m.id === order.mineId);
      if (!mine || !seen.mines.some((m) => m.id === mine.id)) return { error: "mina není v dohledu" };
      if (mine.team === ship.team && mine.ownerId === ship.ownerId && order.timer === undefined) return { error: "mina už je tvoje" };
      mine.ownerId = ship.ownerId;
      mine.team = ship.team;
      mine.armed = true;
      if (order.timer !== undefined) mine.timer = Math.max(1, Math.min(4, Math.round(order.timer)));
      ship.techPoints -= cost;
      return { event: { ...base, techPoints: ship.techPoints, targetId: mine.id, timer: mine.timer } };
    }
    case "torpedo": {
      const t = state.torpedoes.find((x) => x.id === order.torpedoId);
      if (!t || !seen.torpedoes.some((x) => x.id === t.id)) return { error: "torpédo není v dohledu" };
      const target = state.ships.find((x) => x.id === order.targetId && x.alive) ?? state.torpedoes.find((x) => x.id === order.targetId && x.id !== t.id);
      if (!target) return { error: "cíl torpéda musí být loď nebo jiné torpédo" };
      if (!seen.ships.some((x) => x.id === target.id) && !seen.torpedoes.some((x) => x.id === target.id)) return { error: "cíl není v dohledu" };
      t.ownerId = ship.ownerId;
      t.team = ship.team;
      t.targetId = target.id;
      t.targetPoint = undefined;
      t.lost = false;
      t.lifeLeft += HACK.torpedoLife;
      t.trackLeft = Math.max(t.trackLeft, HACK.torpedoLife) + HACK.torpedoLife;
      if (t.phase === "cruise") t.phase = "lock";
      ship.techPoints -= cost;
      return { event: { ...base, techPoints: ship.techPoints, targetId: t.id, victimId: target.id } };
    }
    case "module": {
      const victim = state.ships.find((x) => x.id === order.shipId && x.alive);
      if (!victim || victim.team === ship.team) return { error: "cíl musí být živá cizí loď" };
      if (!seen.ships.some((x) => x.id === victim.id)) return { error: "loď není v dohledu" };
      if (inStorm(state, victim)) return { error: "bouře ruší hack" };
      const mod = victim.loadout.modules.find((m) => m.id === order.moduleId);
      if (!mod) return { error: "takový modul loď nemá" };
      if (!moduleWorking(mod)) return { error: "modul je už zničený" };
      if (mod.hacked) return { error: "modul je už hacknutý" };
      mod.hacked = true;
      ship.techPoints -= cost;
      return { event: { ...base, techPoints: ship.techPoints, victimId: victim.id, moduleId: mod.id, moduleType: mod.type } };
    }
    case "repair": {
      if ((ship.autoRepair ?? 0) > 0) return { error: `pasivní oprava už běží (zbývá ${ship.autoRepair} kol)` };
      ship.autoRepair = HACK.repairTurns;
      ship.techPoints -= cost;
      return { event: { ...base, techPoints: ship.techPoints } };
    }
  }
}

export function shieldRechargeBlocked(state: GameState, ship: Ship): string | undefined {
  if (ship.shieldType === "none" || !activeShieldModule(ship)) return "loď nemá funkční štít";
  if (inStorm(state, ship)) return "v bouři štít nefunguje";
  if (ship.shieldRechargedTurn === state.turn) return "štít už byl v tomto kole dobit";
  if (ship.techPoints < RULES.rechargeTechCost) return `nedostatek technologie (${ship.techPoints}/${RULES.rechargeTechCost})`;
  if (shieldRechargeRoom(ship) <= 0) return "štít je plný";
  return undefined;
}

/**
 * Dobití štítu technologií – provede se hned při plánování, nebere akci, 1× za kolo.
 * Energetický: +rechargeWhole zásoby (do maxima). Segmentový: +rechargeSegments bodů rozdělených podle `segments`
 * (součet ≤ limit, nad maximum segmentu se ořízne; bez zadání se body dají nejslabším segmentům).
 */
export function applyShieldRecharge(state: GameState, ship: Ship, segments?: number[]): { error?: string; event?: TurnEvent } {
  const why = shieldRechargeBlocked(state, ship);
  if (why) return { error: why };
  const cost = RULES.rechargeTechCost;
  let amount: number | undefined;
  let added: Segments | undefined;
  if (ship.shieldType === "whole") {
    amount = Math.min(RULES.rechargeWhole, ship.stats.shields - ship.shields);
    ship.shields += amount;
  } else {
    const cap = RULES.segmentHp * ship.stats.segmentModules;
    let budget = RULES.rechargeSegments;
    added = [0, 0, 0, 0];
    const want = (segments ?? []).map((n) => Math.max(0, Math.floor(Number(n) || 0)));
    for (let i = 0; i < 4 && budget > 0; i++) {
      const add = Math.min(want[i] ?? 0, cap - ship.segments[i], budget);
      if (add > 0) {
        ship.segments[i] += add;
        added[i] += add;
        budget -= add;
      }
    }
    // zbytek (nebo bez zadání): nejslabší segmenty
    while (budget > 0) {
      let best = -1;
      for (let i = 0; i < 4; i++) if (ship.segments[i] < cap && (best < 0 || ship.segments[i] < ship.segments[best])) best = i;
      if (best < 0) break;
      ship.segments[best]++;
      added[best]++;
      budget--;
    }
    if (added.every((n) => n === 0)) return { error: "štít je plný" };
  }
  ship.techPoints -= cost;
  ship.shieldRechargedTurn = state.turn;
  return { event: { type: "shieldRecharge", shipId: ship.id, cost, techPoints: ship.techPoints, amount, segments: added, shieldsAfter: ship.shields, segmentsAfter: [...ship.segments] as Segments } };
}

/** Náhled kulometu: cíl (stejná pravidla jako vyhodnocení), šance zásahu projektilu a očekávané zranění. */
export function mgPreview(state: GameState, ship: Ship, preferredTargetId?: string, mgModuleId?: string): { targetId: string; x: number; y: number; hitChance: number; expectedDamage: number; shots: number; coverage: number } | undefined {
  const mod = ship.loadout.modules.find((m) => m.type === "mg" && moduleUsable(m) && m.id === (mgModuleId ?? m.id)) ?? ship.loadout.modules.find((m) => m.type === "mg" && moduleUsable(m));
  if (!mod) return undefined;
  const aim = aimPose(ship, mod);
  const mgR = mgRange(ship);
  const inRange = (p: Vec) => dist(aim, p) <= mgR && inArc(aim, p, MG.halfArc) && !lineBlocked(obstacles(state), aim, p);
  const shipInRange = (e: Ship) => sectorCoverage(aim, mgR, MG.halfArc, e) > 0 && !lineBlocked(obstacles(state), aim, e);
  let target: Vec & { id: string } | undefined;
  const ts = state.ships.find((x) => x.id === preferredTargetId && x.alive && x.team !== ship.team);
  const tt = state.torpedoes.find((x) => x.id === preferredTargetId && x.team !== ship.team);
  const td = (state.debris ?? []).find((x) => x.id === preferredTargetId);
  const tc = (state.comets ?? []).find((x) => x.id === preferredTargetId && cometOnMap(state, x));
  if (ts && shipInRange(ts)) target = ts;
  else if (tt && inRange(tt)) target = tt;
  else if (td && inRange(td)) target = td;
  else if (tc && inRange(tc)) target = tc;
  else {
    const cands = state.ships.filter((e) => e.alive && e.team !== ship.team && shipInRange(e));
    if (cands.length) target = cands.reduce((b, e) => (dist(aim, e) < dist(aim, b) ? e : b));
  }
  if (!target) return undefined;
  const shots = Math.min(MG.burst, mod.ammo ?? 0);
  const tShip = state.ships.find((x) => x.id === target!.id);
  const hitArea = tShip ? sectorHit(aim, mgR, MG.halfArc, tShip) : undefined;
  const coverage = hitArea ? hitArea.coverage : 1;
  const hitChance = mgHitChance(hitArea ? hitArea.meanDist : dist(aim, target), false, mgR) * coverage;
  return { targetId: target.id, x: target.x, y: target.y, hitChance, expectedDamage: hitChance * shots * MG.damage, shots, coverage };
}

/** Výseč kulometu pro náhled. */
export function mgArcOf(ship: Ship, mgModuleId?: string): { x: number; y: number; heading: number; halfArc: number; range: number } {
  const mod = ship.loadout.modules.find((m) => m.type === "mg" && moduleUsable(m) && m.id === (mgModuleId ?? m.id)) ?? ship.loadout.modules.find((m) => m.type === "mg" && moduleUsable(m));
  const aim = aimPose(ship, mod);
  return { x: aim.x, y: aim.y, heading: aim.heading, halfArc: MG.halfArc, range: mgRange(ship) };
}
