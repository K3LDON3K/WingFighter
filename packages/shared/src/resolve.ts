import { asteroidDestroyed, carveCrater, circleHitsAsteroid, lineBlocked } from "./asteroids.ts";
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
import { makeManeuver, maneuverLength, maneuverPath, parseManeuverId, resolveManeuver, stressCost } from "./maneuvers.ts";
import { cargoCapacity, computeStats, facingAngle, laserHalfArc, mineSideOf, moduleHp, moduleMaxHp, moduleWorking, MODULES, occupiedSlots, profileOf } from "./ships.ts";
import { lineCrossesStorm, pointInStorm } from "./mapgen.ts";

/** Je loď/bod v elektromagnetické bouři? */
export function inStorm(state: GameState, p: Vec): boolean {
  return pointInStorm(state.storms ?? [], p);
}
/** Laserová čára: nesmí začínat ani končit v bouři a nesmí ji protínat. */
function laserBlockedByStorm(state: GameState, a: Vec, b: Vec): boolean {
  return (state.storms?.length ?? 0) > 0 && (inStorm(state, a) || inStorm(state, b) || lineCrossesStorm(state.storms, a, b));
}
import type { ModuleInstance } from "./types.ts";

/** Pozice lodi natočená podle směru modulu (výseč laserů, výlet torpéda). */
function aimPose(ship: Pose, mod: ModuleInstance | undefined): Pose {
  return { x: ship.x, y: ship.y, heading: ship.heading + facingAngle(mod?.facing) };
}

/**
 * Podíl cíle uvnitř výseče (0–1): kolizní kruhy cíle se navzorkují mřížkou a spočítá se, kolik bodů leží
 * v dostřelu i v úhlu výseče. Cíl jde zaměřit, jakmile je podíl > 0; šance na zásah se jím násobí.
 */
export function sectorCoverage(aim: Pose, range: number, halfArc: number, target: Ship): number {
  const circles = shipCircles(target, target.stats.colliders ?? [{ x: 0, y: 0, r: target.stats.radius }]);
  const N = 5; // mřížka (2N+1)² bodů na kruh
  let inside = 0;
  let total = 0;
  for (const c of circles) {
    for (let i = -N; i <= N; i++)
      for (let j = -N; j <= N; j++) {
        const dx = (i / N) * c.r;
        const dy = (j / N) * c.r;
        if (dx * dx + dy * dy > c.r * c.r) continue;
        total++;
        const p = { x: c.x + dx, y: c.y + dy };
        if (dist(aim, p) <= range && inArc(aim, p, halfArc)) inside++;
      }
  }
  return total ? inside / total : 0;
}
import type { Rng } from "./rng.ts";
import { applyTuning } from "./tuning.ts";
import type {
  ActionOrder,
  Asteroid,
  Comet,
  Debris,
  SlotId,
  GameResult,
  GameState,
  Maneuver,
  Mine,
  MineSide,
  MovePath,
  PlayerStats,
  Segments,
  Ship,
  ShipOrders,
  Storm,
  Torpedo,
  TurnEvent,
  TurnResult,
} from "./types.ts";
import { boundingRadius, shipCircles, shipHitsAsteroid, shipHitsCircle, shipInsideMap, shipsOverlap } from "./colliders.ts";

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
  return p.x >= r && p.y >= r && p.x <= state.width - r && p.y <= state.height - r;
}

function hitsAsteroid(state: GameState, p: Vec, r: number): Asteroid | undefined {
  for (const a of state.asteroids) if (circleHitsAsteroid(a, p, r)) return a;
  return undefined;
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
  refreshShip(ship);
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
    const slot: SlotId = (["front", "right", "back", "left"] as SlotId[])[hitSegment(ship, from)];
    target = working.find((m) => occupiedSlots(m).includes(slot));
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
  const all = [...ship.loadout.modules, ...(ship.loadout.cargo ?? [])];
  for (const mod of all) {
    if (rng.next() * 100 >= RULES.moduleDropChance) continue;
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
export function awardCredits(state: GameState, events: TurnEvent[], playerId: string | undefined, delta: number, reason: "kill" | "survive" | "debris" | "comet" | "tail"): void {
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

function applyDamage(ship: Ship, amount: number, events: TurnEvent[], from?: Vec, by?: string): void {
  if (amount <= 0 || !ship.alive) return;
  let absorbed = 0;
  let segment: number | undefined;
  const stormed = !!creditCtx && inStorm(creditCtx.state, ship); // v bouři štíty nefungují
  if (stormed) {
    /* zásah jde rovnou do trupu */
  } else if (from && ship.shieldType === "segment") {
    segment = hitSegment(ship, from);
    if (ship.segments[segment] > 0) {
      ship.segments[segment]--;
      absorbed = amount;
    }
  } else if (from && ship.shieldType === "whole" && ship.shields > 0) {
    absorbed = Math.min(ship.shields, Math.round((amount * ship.shieldEff) / 100));
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

/** Nová kometa: z náhodného bodu jednoho okraje na náhodný bod protějšího okraje. */
export function spawnComet(state: GameState, rng: Rng, id: string): Comet {
  const side = Math.floor(rng.next() * 4); // 0 = zleva, 1 = zprava, 2 = shora, 3 = zdola
  const r = COMET.radius;
  const fx = rng.next();
  const tx = rng.next();
  let x: number, y: number, ex: number, ey: number;
  if (side === 0) [x, y, ex, ey] = [r, r + fx * (state.height - 2 * r), state.width - r, r + tx * (state.height - 2 * r)];
  else if (side === 1) [x, y, ex, ey] = [state.width - r, r + fx * (state.height - 2 * r), r, r + tx * (state.height - 2 * r)];
  else if (side === 2) [x, y, ex, ey] = [r + fx * (state.width - 2 * r), r, r + tx * (state.width - 2 * r), state.height - r];
  else [x, y, ex, ey] = [r + fx * (state.width - 2 * r), state.height - r, r + tx * (state.width - 2 * r), r];
  return { id, x, y, heading: Math.atan2(ey - y, ex - x), speed: COMET.speed, hull: COMET.hull, maxHull: COMET.hull, radius: r, tailUsed: [] };
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

/** Může si loď manévr dovolit (stresové body)? */
export function canAfford(ship: Ship, man: Maneuver): boolean {
  return stressCost(man.difficulty) <= ship.stressPoints;
}

/** Výchozí rozkaz (bez akcí): stejná rychlost rovně, nestřílí. */
export function defaultOrders(ship: Ship): ShipOrders {
  const profile = profileOf(ship.loadout);
  const candidates = [ship.speed, 2, ship.speed - 1, ship.speed + 1, 1, 3];
  for (const sp of candidates) {
    const man = makeManeuver(profile, sp, 0, false, ship.speed);
    if (man && canAfford(ship, man)) return { shipId: ship.id, maneuverId: man.id, fire: false };
  }
  return { shipId: ship.id, maneuverId: makeManeuver(profile, 1, 0, false, ship.speed)!.id, fire: false };
}

/** Rozpis akcí rozkazu (každá stojí 1 bod). */
export type ActionId = "move" | "koiogran" | "laser" | "mg" | "torpedo" | "mine" | "evade" | "shield" | "jettison" | "pickup";

export function actionList(ship: Ship, o: ShipOrders): { id: ActionId; label: string }[] {
  const out: { id: ActionId; label: string }[] = [];
  const m = parseManeuverId(o.maneuverId);
  if (m) {
    if (m.koiogran) out.push({ id: "move", label: "úprava pohybu" }, { id: "koiogran", label: "otočka 180°" }); // otočka stojí 2 akce
    else if (m.speed !== ship.speed || m.angle !== 0) out.push({ id: "move", label: "úprava pohybu" });
  }
  if (o.action?.type === "evade") out.push({ id: "evade", label: "úhybný manévr" });
  if (o.action?.type === "shield") out.push({ id: "shield", label: "úprava štítu" });
  if (o.action?.type === "jettison") out.push({ id: "jettison", label: "vyhození modulu" });
  if (o.action?.type === "pickup") out.push({ id: "pickup", label: "zvednutí nákladu" });
  if (o.fire) out.push({ id: "laser", label: "lasery" });
  if (o.fireMg) out.push({ id: "mg", label: "kulomet" });
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
  const mods = ship.loadout.modules.filter((m) => m.type === "torpedo" && (m.ammo ?? 0) > 0 && moduleWorking(m));
  return mods.find((m) => m.id === moduleId) ?? mods[0];
}
/** Minový modul s municí. */
export function mineModule(ship: Ship) {
  return ship.loadout.modules.find((m) => m.type === "mine" && (m.ammo ?? 0) > 0 && moduleWorking(m));
}
/** Kulometný modul s municí (zadaný, nebo první s municí). */
export function mgModule(ship: Ship, moduleId?: string) {
  const mods = ship.loadout.modules.filter((m) => m.type === "mg" && (m.ammo ?? 0) > 0 && moduleWorking(m));
  return mods.find((m) => m.id === moduleId) ?? mods[0];
}

/** Šance zásahu jednoho projektilu kulometu podle vzdálenosti (lineárně blízko → hranice dosahu), úhyb cíle snižuje. */
export function mgHitChance(d: number, targetEvading = false): number {
  const t = clamp(d / Math.max(1, MG.range), 0, 1);
  let p = (MG.hitNear + (MG.hitFar - MG.hitNear) * t) / 100;
  if (targetEvading) p *= 1 - RULES.evadeDamageReduction / 100;
  return clamp(p, 0, 1);
}

/** Laserový modul (zadaný, nebo první). */
export function laserModule(ship: Ship, moduleId?: string) {
  const mods = ship.loadout.modules.filter((m) => m.type === "laser" && moduleWorking(m));
  return mods.find((m) => m.id === moduleId) ?? mods[0];
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
    const profile = profileOf(ship.loadout);
    let man = resolveManeuver(profile, raw.maneuverId, ship.speed);
    if (!man || !canAfford(ship, man)) man = resolveManeuver(profile, def.maneuverId, ship.speed)!;

    let action: ActionOrder | undefined;
    if (raw.action?.type === "evade") action = ship.stressPoints >= RULES.evadeStressCost ? { type: "evade" } : undefined;
    else if (raw.action?.type === "shield") action = validShieldAction(ship, raw.action.segments) ? { type: "shield", segments: raw.action.segments.map((n) => Math.round(Number(n))) as Segments } : undefined;
    else if (raw.action?.type === "jettison") {
      const wantedId = raw.action.moduleId;
      action = ship.loadout.modules.some((m) => m.id === wantedId) || (ship.loadout.cargo ?? []).some((m) => m.id === wantedId) ? { type: "jettison", moduleId: wantedId } : undefined;
    } else if (raw.action?.type === "pickup") {
      const tid = raw.action.targetId;
      action = { type: "pickup", targetId: typeof tid === "string" && state.debris.some((d) => d.id === tid) ? tid : undefined };
    }
    let special = raw.special;
    if (special?.type === "torpedo") {
      const mod = torpedoModule(ship, special.moduleId);
      if (!mod) special = undefined;
      else if (special.targetId) {
        const t = enemyTarget(state, ship, special.targetId);
        special = t && dist(ship, t) <= TORPEDO.lockRange ? { type: "torpedo", targetId: t.id, moduleId: mod.id } : undefined;
      } else if (special.point && Number.isFinite(special.point.x) && Number.isFinite(special.point.y)) {
        const p = { x: clamp(special.point.x, 0, state.width), y: clamp(special.point.y, 0, state.height) };
        special = dist(ship, p) <= TORPEDO.pointRange ? { type: "torpedo", point: p, moduleId: mod.id } : undefined;
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
    const laserMod = laserModule(ship, raw.laserModuleId);
    const mgMod = mgModule(ship, raw.mgModuleId);
    const o: ShipOrders = { shipId: ship.id, maneuverId: man.id, action, special, fire: !!raw.fire && !!laserMod, laserModuleId: laserMod?.id, fireMg: !!raw.fireMg && !!mgMod, mgModuleId: mgMod?.id, preferredTargetId };
    // limit akcí: nejdřív padá zbraň, pak lasery, pak úhyb, nakonec manévr
    if (actionCost(ship, o) > RULES.actionPoints) o.special = undefined;
    if (actionCost(ship, o) > RULES.actionPoints) o.action = undefined;
    if (actionCost(ship, o) > RULES.actionPoints) o.fireMg = false;
    if (actionCost(ship, o) > RULES.actionPoints) o.fire = false;
    if (actionCost(ship, o) > RULES.actionPoints) o.maneuverId = def.maneuverId;
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
  const shotComets = new Set<string>();
  const cometById = (id: string | undefined) => state.comets!.find((c) => c.id === id && !shotComets.has(c.id));
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
  const startPose = new Map<string, Pose>();
  for (const ship of state.ships) startPose.set(ship.id, { x: ship.x, y: ship.y, heading: ship.heading });

  // Úhybný manévr: zaplatí stres hned; po celé kolo snižuje zranění minou/torpédem a dovolí prolétnout nepřáteli.
  const evading = new Set<string>();
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!ship.alive || o?.action?.type !== "evade") continue;
    if (ship.stressPoints < RULES.evadeStressCost) continue;
    evading.add(ship.id);
    const before = ship.stressPoints;
    ship.stressPoints -= RULES.evadeStressCost;
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
    events.push({ type: "jettison", shipId: ship.id, debris });
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
    if (!o.fire || ship.stats.attack <= 0) continue;
    if (inStorm(state, ship)) continue; // v bouři lasery nefungují
    const lmod = laserModule(ship, o.laserModuleId);
    const aim = aimPose(ship, lmod);
    const arc = laserHalfArc(lmod?.facing);

    const deb = state.debris.find((d) => d.id === o.preferredTargetId);
    if (deb && !shotDebris.has(deb.id)) {
      if (dist(ship, deb) <= LASER.range && inArc(aim, deb, arc) && !lineBlocked(state.asteroids, ship, deb) && !laserBlockedByStorm(state, ship, deb)) {
        const rangeBand = clamp(Math.ceil(dist(ship, deb) / LASER.band), 1, 3);
        const outcome = resolveAttack(rng, { attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0), defenseDice: rangeBand === 3 ? 1 : 0, attackerFocus: ship.tokens.focus > 0, attackerLock: false, defenderFocus: false, defenderEvade: false });
        const destroyed = outcome.damage > 0;
        if (destroyed) shotDebris.add(deb.id);
        events.push({ type: "debrisShot", debrisId: deb.id, shooterId: ship.id, x: deb.x, y: deb.y, destroyed, reward: destroyed ? deb.value : 0 });
        if (destroyed) awardCredits(state, events, ship.ownerId, deb.value, "debris");
      }
      continue;
    }
    const com = cometById(o.preferredTargetId);
    if (com) {
      if (dist(ship, com) <= LASER.range && inArc(aim, com, arc) && !lineBlocked(state.asteroids, ship, com) && !laserBlockedByStorm(state, ship, com)) {
        const rangeBand = clamp(Math.ceil(dist(ship, com) / LASER.band), 1, 3);
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
    const torp = torpedoById(state, o.preferredTargetId);
    if (torp && torp.team !== ship.team) {
      if (dist(ship, torp) <= LASER.range && inArc(aim, torp, arc) && !shotTorpedoes.has(torp.id) && !lineBlocked(state.asteroids, ship, torp) && !laserBlockedByStorm(state, ship, torp)) {
        const d = dist(ship, torp);
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
      (e) => e.alive && e.team !== ship.team && sectorCoverage(aim, LASER.range, arc, e) > 0 && !lineBlocked(state.asteroids, ship, e) && !laserBlockedByStorm(state, ship, e),
    );
    if (candidates.length === 0) continue;
    let target = candidates.find((c) => c.id === o.preferredTargetId);
    if (!target) target = candidates.reduce((best, c) => (dist(ship, c) < dist(ship, best) ? c : best));
    const d = dist(ship, target);
    const rangeBand = clamp(Math.ceil(d / LASER.band), 1, 3);
    const coverage = sectorCoverage(aim, LASER.range, arc, target);
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
      from: { x: ship.x, y: ship.y, heading: ship.heading },
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
    pending.set(target.id, { dmg: (prev?.dmg ?? 0) + damage, from: prev?.from ?? { x: ship.x, y: ship.y }, by: prev?.by ?? ship.ownerId });
  }
  for (const [id, { dmg, from, by }] of pending) applyDamage(shipById(state, id)!, dmg, events, from, by);

  /* ---------- 1b. Kulomety (také před pohybem; bouře je neovlivňuje) ---------- */
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    if (!o.fireMg) continue;
    const mod = mgModule(ship, o.mgModuleId);
    if (!mod) continue;
    const aim = aimPose(ship, mod);
    const inRange = (p: Vec) => dist(ship, p) <= MG.range && inArc(aim, p, MG.halfArc) && !lineBlocked(state.asteroids, ship, p);
    const shipInRange = (e: Ship) => sectorCoverage(aim, MG.range, MG.halfArc, e) > 0 && !lineBlocked(state.asteroids, ship, e);
    // cíl: preferovaný (loď / torpédo / trosky), jinak nejbližší nepřátelská loď ve výseči
    let target: { kind: "ship" | "torpedo" | "debris" | "comet"; id: string; pos: Pose } | undefined;
    const pref = o.preferredTargetId;
    const ts = pref ? state.ships.find((x) => x.id === pref && x.alive && x.team !== ship.team) : undefined;
    const tt = pref ? state.torpedoes.find((x) => x.id === pref && x.team !== ship.team && !shotTorpedoes.has(x.id)) : undefined;
    const td = pref ? state.debris.find((x) => x.id === pref && !shotDebris.has(x.id)) : undefined;
    const tc = cometById(pref);
    if (ts && shipInRange(ts)) target = { kind: "ship", id: ts.id, pos: ts };
    else if (tt && inRange(tt)) target = { kind: "torpedo", id: tt.id, pos: tt };
    else if (td && inRange(td)) target = { kind: "debris", id: td.id, pos: { ...td, heading: 0 } };
    else if (tc && inRange(tc)) target = { kind: "comet", id: tc.id, pos: tc };
    else {
      const cands = state.ships.filter((e) => e.alive && e.team !== ship.team && shipInRange(e));
      if (cands.length) {
        const c = cands.reduce((b, e) => (dist(ship, e) < dist(ship, b) ? e : b));
        target = { kind: "ship", id: c.id, pos: c };
      }
    }
    if (!target) continue;
    const shots = Math.min(MG.burst, mod.ammo ?? 0);
    mod.ammo = (mod.ammo ?? 0) - shots;
    refreshShip(ship);
    const victimShip = target.kind === "ship" ? shipById(state, target.id) : undefined;
    const p = mgHitChance(dist(ship, target.pos), !!victimShip && evading.has(victimShip.id)) * (victimShip ? sectorCoverage(aim, MG.range, MG.halfArc, victimShip) : 1);
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
    events.push({ type: "mg", shooterId: ship.id, targetId: target.id, from: { x: ship.x, y: ship.y, heading: aim.heading }, to: { x: target.pos.x, y: target.pos.y, heading: target.pos.heading }, shots, hits, damage, spread, destroyed });
    if (victimShip && damage > 0) {
      if (victimShip.shieldType === "whole" && !inStorm(state, victimShip)) {
        // celolodní štít řeší každý projektil zvlášť
        for (let i = 0; i < hits && victimShip.alive; i++) applyDamage(victimShip, MG.damage, events, { x: ship.x, y: ship.y }, ship.ownerId);
      } else applyDamage(victimShip, damage, events, { x: ship.x, y: ship.y }, ship.ownerId); // segment: celá dávka = jeden zásah
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


  /* ---------- 2. Pohyb (lodě i torpéda současně) ---------- */
  const preMoveCount = events.length; // akce + lasery patří před událost pohybu
  const shipMovers = new Map<string, Mover>();
  const maneuverOf = new Map<string, Maneuver>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    const profile = profileOf(ship.loadout);
    let man = resolveManeuver(profile, o.maneuverId, ship.speed);
    if (!man || !canAfford(ship, man)) man = resolveManeuver(profile, defaultOrders(ship).maneuverId, ship.speed)!;
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
    const off = ship.stats.radius + TORPEDO.radius + 2;
    const torpedo: Torpedo = {
      id: newId("torp"),
      ownerId: ship.ownerId,
      team: ship.team,
      x: ship.x + f.x * off,
      y: ship.y + f.y * off,
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
    const push = (effect: "shield" | "segment" | "hull" | "credits" | "stress", amount: number, segment?: number) =>
      events.push({ type: "cometTail", cometId: c.id, shipId: ship.id, t: k / MOVE_STEPS, x: p.x, y: p.y, effect, amount, segment });
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
        if (outside && !stillTouching(ship.id, "edge", true)) {
          // která hrana: podle opsané kružnice modelu (kolizní kruhy mohou vyčnívat dřív než střed)
          let h = p.heading;
          if (p.x < br || p.x > state.width - br) h = Math.PI - h;
          if (p.y < br || p.y > state.height - br) h = -h;
          hit = { with: "edge", heading: normalizeAngle(h + scatter()) };
        } else {
          if (!outside) stillTouching(ship.id, "edge", false);
          for (const a of state.asteroids) {
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
              hit = { with: "asteroid", otherId: a.id, heading: normalizeAngle(Math.atan2(p.y - a.y, p.x - a.x) + scatter()) };
              break;
            }
            if (!ov) stillTouching(ship.id, a.id, false);
          }
        }
        if (!hit) {
          for (const other of state.ships) {
            if (other === ship || !other.alive) continue;
            const om = shipMovers.get(other.id)!;
            const op = posAt(om, k);
            const ov = shipsOverlap(p, cols, op, other.stats.colliders);
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
            const away = Math.atan2(p.y - op.y, p.x - op.x);
            hit = { with: "ship", otherId: other.id, heading: normalizeAngle(away + scatter()) };
            if (om.frozenAt === null) {
              const h2 = normalizeAngle(away + Math.PI + scatter());
              deflect(om, k, h2);
              touching.get(other.id)!.add(ship.id);
              events.push({ type: "collision", shipId: other.id, with: "ship", otherId: ship.id, t, newHeading: h2 });
              applyDamage(other, RULES.collisionShip, events, p);
              if (!other.alive) om.frozenAt = k - 1;
            }
            break;
          }
        }
        if (hit) {
          deflect(m, k, hit.heading);
          touching.get(ship.id)!.add(hit.otherId ?? "edge");
          events.push({ type: "collision", shipId: ship.id, with: hit.with, otherId: hit.otherId, t, newHeading: hit.heading });
          const src: Vec =
            hit.with === "ship"
              ? posAt(shipMovers.get(hit.otherId!)!, k)
              : hit.with === "asteroid"
                ? state.asteroids.find((a) => a.id === hit!.otherId)!
                : { x: p.x < br ? p.x - 10 : p.x > state.width - br ? p.x + 10 : p.x, y: p.y < br ? p.y - 10 : p.y > state.height - br ? p.y + 10 : p.y };
          const dbl = hit.with === "asteroid" && evading.has(ship.id) ? 2 : 1; // úhyb skončil v asteroidu
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
        const away = Math.atan2(sp.y - cp.y, sp.x - cp.x);
        if (sm.frozenAt === null) {
          const h = normalizeAngle(away + scatter());
          deflect(sm, k, h);
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
      if (cp.x < -c.radius || cp.y < -c.radius || cp.x > state.width + c.radius || cp.y > state.height + c.radius) {
        endComet(c, k, "edge");
        continue;
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
      const cometsIn = state.comets.filter((c) => !removedComets.has(c.id) && circlesOverlap(cometMovers.get(c.id)!.samples[k], c.radius, mine, mine.radius));
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
    ship.speed = man.koiogran ? Math.max(1, man.speed - RULES.koiogranSpeedDrop) : man.speed;
    const cost = stressCost(man.difficulty);
    const stM = statsOf(state, ship.ownerId);
    if (stM) {
      stM.maneuvers[man.difficulty]++;
      if (man.koiogran) stM.maneuvers.koiogran++;
    }
    const before = ship.stressPoints;
    ship.stressPoints = clamp(ship.stressPoints - cost, 0, ship.stats.stressMax);
    if (ship.stressPoints !== before) events.push({ type: "stress", shipId: ship.id, stressPoints: ship.stressPoints, delta: ship.stressPoints - before });
    if (man.difficulty === "danger") applyDamage(ship, Math.max(1, Math.round((ship.stats.hull * STRESS.dangerHullPercent) / 100)), events);
    // skener: cooldown odpočítává; po jeho konci plné náboje; jinak zelený manévr dobije +1
    for (const mod of ship.loadout.modules) {
      if (mod.type !== "scanner") continue;
      if ((mod.cooldown ?? 0) > 0) {
        mod.cooldown = (mod.cooldown ?? 0) - 1;
        if (mod.cooldown <= 0) {
          mod.cooldown = 0;
          mod.charges = SCANNER.charges;
        }
      } else if (man.difficulty === "green") mod.charges = Math.min(SCANNER.charges, (mod.charges ?? 0) + 1);
    }
  }

  /* ---------- 2. Akce ---------- */
  const canAct = (ship: Ship) => ship.alive && !shipMovers.get(ship.id)!.collided;

  const spotFree = (self: Ship, p: Pose): boolean => {
    const cols = self.stats.colliders;
    if (!shipInsideMap(state.width, state.height, p, cols)) return false;
    if (state.asteroids.some((a) => shipHitsAsteroid(a, p, cols))) return false;
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
  const arc = laserHalfArc(lmod?.facing);
  if (inStorm(state, ship)) return undefined;
  const candidates = state.ships.filter(
    (e) => e.alive && e.team !== ship.team && sectorCoverage(aim, LASER.range, arc, e) > 0 && !lineBlocked(state.asteroids, ship, e) && !laserBlockedByStorm(state, ship, e),
  );
  if (candidates.length === 0) return undefined;
  return candidates.find((c) => c.id === preferredTargetId) ?? candidates.reduce((best, c) => (dist(ship, c) < dist(ship, best) ? c : best));
}

/** Výseč laserů pro náhled: natočení a poloviční úhel podle modulu. */
/** Dosáhne laser na bod (kometa / trosky) z aktuální pozice? Vrací důvod, proč ne. */
export function laserReach(state: GameState, ship: Ship, p: Vec, laserModuleId?: string): string | null {
  if (inStorm(state, ship)) return "loď je v bouři";
  const lmod = laserModule(ship, laserModuleId);
  const aim = aimPose(ship, lmod);
  if (dist(ship, p) > LASER.range) return "mimo dostřel";
  if (!inArc(aim, p, laserHalfArc(lmod?.facing))) return "mimo výseč laseru";
  if (lineBlocked(state.asteroids, ship, p)) return "v cestě je asteroid";
  if (laserBlockedByStorm(state, ship, p)) return "cíl je v bouři";
  return null;
}

export function laserArcOf(ship: Ship, laserModuleId?: string): { heading: number; halfArc: number } {
  const lmod = laserModule(ship, laserModuleId);
  return { heading: ship.heading + facingAngle(lmod?.facing), halfArc: laserHalfArc(lmod?.facing) };
}

/** Šance laserů na zásah (aspoň jeden čistý zásah) a očekávané zranění proti danému cíli ze současných pozic. */
export function laserOdds(ship: Ship, target: Ship, laserModuleId?: string): { hitChance: number; expectedDamage: number; rangeBand: number; coverage: number } {
  const rangeBand = clamp(Math.ceil(dist(ship, target) / LASER.band), 1, 3);
  const lmod = laserModule(ship, laserModuleId);
  const coverage = sectorCoverage(aimPose(ship, lmod), LASER.range, laserHalfArc(lmod?.facing), target);
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
 * Skener – okamžitá akce při plánování (nebere akci). Vrací chybu, nebo provede:
 * ship = 1 náboj, cíl musí být nepřátelská loď v dosahu (viditelnost ověřuje server);
 * deep = všechny náboje (min. 2), odkryje mapu týmu do konce kola a spustí cooldown;
 * cooldown = vynucený cooldown (jen bez plné zásoby): délka = cooldown − zbývající náboje, náboje 0.
 */
export function applyScan(state: GameState, ship: Ship, moduleId: string, mode: "ship" | "deep" | "cooldown", targetId?: string): { error?: string; target?: Ship } {
  const mod = ship.loadout.modules.find((m) => m.id === moduleId && m.type === "scanner");
  if (!mod) return { error: "loď nemá skener" };
  if (!moduleWorking(mod)) return { error: "skener je zničený" };
  if ((mod.cooldown ?? 0) > 0) return { error: `skener je v cooldownu (${mod.cooldown} kol)` };
  const charges = mod.charges ?? 0;
  if (mode === "ship") {
    if (charges < 1) return { error: "skener nemá náboj" };
    const target = state.ships.find((s) => s.id === targetId && s.alive && s.team !== ship.team);
    if (!target) return { error: "cíl skenu není cizí živá loď" };
    if (dist(ship, target) > SCANNER.range) return { error: `cíl je mimo dosah skeneru (${SCANNER.range})` };
    if (inStorm(state, ship) || inStorm(state, target)) return { error: "bouře ruší skener" };
    mod.charges = charges - 1;
    const st = statsOf(state, ship.ownerId);
    if (st) st.scans++;
    return { target };
  }
  if (mode === "deep") {
    if (charges < 2) return { error: "hluboký sken potřebuje 2 náboje" };
    if (inStorm(state, ship)) return { error: "bouře ruší skener" };
    mod.charges = 0;
    mod.cooldown = SCANNER.cooldown;
    const st = statsOf(state, ship.ownerId);
    if (st) st.scans++;
    state.revealTeams = [...new Set([...(state.revealTeams ?? []), ship.team])];
    return {};
  }
  if (charges >= SCANNER.charges) return { error: "cooldown jde vynutit jen bez plné zásoby nábojů" };
  mod.cooldown = Math.max(1, SCANNER.cooldown - charges);
  mod.charges = 0;
  return {};
}

/** Náhled kulometu: cíl (stejná pravidla jako vyhodnocení), šance zásahu projektilu a očekávané zranění. */
export function mgPreview(state: GameState, ship: Ship, preferredTargetId?: string, mgModuleId?: string): { targetId: string; x: number; y: number; hitChance: number; expectedDamage: number; shots: number; coverage: number } | undefined {
  const mod = ship.loadout.modules.find((m) => m.type === "mg" && moduleWorking(m) && m.id === (mgModuleId ?? m.id)) ?? ship.loadout.modules.find((m) => m.type === "mg" && moduleWorking(m));
  if (!mod) return undefined;
  const aim = aimPose(ship, mod);
  const inRange = (p: Vec) => dist(ship, p) <= MG.range && inArc(aim, p, MG.halfArc) && !lineBlocked(state.asteroids, ship, p);
  const shipInRange = (e: Ship) => sectorCoverage(aim, MG.range, MG.halfArc, e) > 0 && !lineBlocked(state.asteroids, ship, e);
  let target: Vec & { id: string } | undefined;
  const ts = state.ships.find((x) => x.id === preferredTargetId && x.alive && x.team !== ship.team);
  const tt = state.torpedoes.find((x) => x.id === preferredTargetId && x.team !== ship.team);
  const td = (state.debris ?? []).find((x) => x.id === preferredTargetId);
  const tc = (state.comets ?? []).find((x) => x.id === preferredTargetId);
  if (ts && shipInRange(ts)) target = ts;
  else if (tt && inRange(tt)) target = tt;
  else if (td && inRange(td)) target = td;
  else if (tc && inRange(tc)) target = tc;
  else {
    const cands = state.ships.filter((e) => e.alive && e.team !== ship.team && shipInRange(e));
    if (cands.length) target = cands.reduce((b, e) => (dist(ship, e) < dist(ship, b) ? e : b));
  }
  if (!target) return undefined;
  const shots = Math.min(MG.burst, mod.ammo ?? 0);
  const tShip = state.ships.find((x) => x.id === target!.id);
  const coverage = tShip ? sectorCoverage(aim, MG.range, MG.halfArc, tShip) : 1;
  const hitChance = mgHitChance(dist(ship, target)) * coverage;
  return { targetId: target.id, x: target.x, y: target.y, hitChance, expectedDamage: hitChance * shots * MG.damage, shots, coverage };
}

/** Výseč kulometu pro náhled. */
export function mgArcOf(ship: Ship, mgModuleId?: string): { heading: number; halfArc: number; range: number } {
  const mod = ship.loadout.modules.find((m) => m.type === "mg" && moduleWorking(m) && m.id === (mgModuleId ?? m.id)) ?? ship.loadout.modules.find((m) => m.type === "mg" && moduleWorking(m));
  return { heading: ship.heading + facingAngle(mod?.facing), halfArc: MG.halfArc, range: MG.range };
}
