import {
  COLLISION_DAMAGE,
  COLLISION_SCATTER,
  LASER,
  LOCK_RANGE,
  MAX_DEFLECTIONS,
  MINE,
  MOVE_STEPS,
  MOVE_UNIT,
  SHIELD_RECHARGE_PER_TURN,
  TORPEDO,
  TORPEDO_AGILITY,
} from "./constants.ts";
import { resolveAttack } from "./dice.ts";
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
import { isRed, makeManeuver, maneuverLength, maneuverPath, resolveManeuver } from "./maneuvers.ts";
import type { Rng } from "./rng.ts";
import { hullOf } from "./ships.ts";
import type {
  ActionOrder,
  GameResult,
  GameState,
  Maneuver,
  Mine,
  MovePath,
  Ship,
  ShipOrders,
  Torpedo,
  TurnEvent,
  TurnResult,
} from "./types.ts";

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

function hitsAsteroid(state: GameState, p: Vec, r: number): string | undefined {
  for (const a of state.asteroids) if (circlesOverlap(p, r, a, a.radius)) return a.id;
  return undefined;
}

/** Odečte zranění (štíty první). Vrací událost zranění + případně zničení. */
function applyDamage(ship: Ship, amount: number, events: TurnEvent[]): void {
  if (amount <= 0 || !ship.alive) return;
  const fromShields = Math.min(ship.shields, amount);
  ship.shields -= fromShields;
  ship.hull -= amount - fromShields;
  events.push({ type: "damage", shipId: ship.id, amount, shieldsAfter: ship.shields, hullAfter: Math.max(0, ship.hull) });
  if (ship.hull <= 0) {
    ship.hull = 0;
    ship.alive = false;
    events.push({ type: "destroyed", shipId: ship.id, x: ship.x, y: ship.y });
  }
}

/** Výchozí rozkaz, když hráč nic neposlal (nebo poslal nesmysl). */
export function defaultOrders(ship: Ship): ShipOrders {
  const profile = hullOf(ship.loadout).profile;
  const man = makeManeuver(profile, 2, 0, false, ship.speed) ?? makeManeuver(profile, 1, 0, false, ship.speed)!;
  return { shipId: ship.id, maneuverId: man.id, fire: true };
}

/** Je cíl (loď nebo torpédo) nepřátelský a existující? */
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
  const out: ShipOrders[] = [];
  for (const ship of state.ships) {
    if (!ship.alive || ship.ownerId !== playerId) continue;
    const raw = incoming.find((o) => o.shipId === ship.id);
    const def = defaultOrders(ship);
    if (!raw) {
      out.push(def);
      continue;
    }
    const profile = hullOf(ship.loadout).profile;
    let man = resolveManeuver(profile, raw.maneuverId, ship.speed);
    if (!man || (isRed(man.difficulty) && ship.stress > 0)) man = resolveManeuver(profile, def.maneuverId, ship.speed)!;

    let action: ActionOrder | undefined = raw.action;
    let special = raw.special;
    if (special && action) action = undefined; // jedna akce za kolo
    if (ship.stress > 0 && man.difficulty !== "green") {
      action = undefined;
      special = undefined;
    }
    if (action?.type === "lock") {
      const t = shipById(state, action.targetId);
      if (!t || !t.alive || t.team === ship.team || dist(ship, t) > LOCK_RANGE) action = undefined;
    }
    if (special?.type === "torpedo") {
      const t = enemyTarget(state, ship, special.targetId);
      if (!t || ship.ammo.torpedoes <= 0 || dist(ship, t) > TORPEDO.lockRange) special = undefined;
    }
    if (special?.type === "mine" && ship.ammo.mines <= 0) special = undefined;

    const preferredTargetId = enemyTarget(state, ship, raw.preferredTargetId)?.id;
    out.push({ shipId: ship.id, maneuverId: man.id, action, special, fire: !!raw.fire, preferredTargetId });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Vyhodnocení kola                                                     */
/* ------------------------------------------------------------------ */

interface Mover {
  samples: Pose[];
  length: number;
  /** Index vzorku, od kterého se už nehýbe (zničení). */
  frozenAt: number | null;
  deflections: number;
  collided: boolean;
}

export function resolveTurn(input: GameState, allOrders: ShipOrders[], rng: Rng): TurnResult {
  const state: GameState = structuredClone(input);
  const events: TurnEvent[] = [];
  const turn = state.turn;

  // Rozkazy pro každou živou loď (chybějící → výchozí).
  const orders = new Map<string, ShipOrders>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = allOrders.find((x) => x.shipId === ship.id) ?? defaultOrders(ship);
    orders.set(ship.id, o);
  }
  const startPose = new Map<string, Pose>();
  for (const ship of state.ships) startPose.set(ship.id, { x: ship.x, y: ship.y, heading: ship.heading });

  /* ---------- 1. Pohyb (lodě i torpéda současně) ---------- */
  const shipMovers = new Map<string, Mover>();
  const maneuverOf = new Map<string, Maneuver>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    const profile = hullOf(ship.loadout).profile;
    const man = resolveManeuver(profile, o.maneuverId, ship.speed) ?? resolveManeuver(profile, defaultOrders(ship).maneuverId, ship.speed)!;
    maneuverOf.set(ship.id, man);
    shipMovers.set(ship.id, {
      samples: samplePath(maneuverPath(ship, man), MOVE_STEPS),
      length: maneuverLength(man),
      frozenAt: null,
      deflections: 0,
      collided: false,
    });
  }

  const torpMovers = new Map<string, Mover>();
  for (const t of state.torpedoes) {
    let delta = 0;
    const target = shipById(state, t.targetId)?.alive ? shipById(state, t.targetId) : torpedoById(state, t.targetId);
    if (t.trackLeft > 0 && target) {
      const want = normalizeAngle(Math.atan2(target.y - t.y, target.x - t.x) - t.heading);
      delta = clamp(want, -TORPEDO.maxTurn, TORPEDO.maxTurn);
    }
    torpMovers.set(t.id, {
      samples: samplePath(makePath(t, TORPEDO.speed, delta), MOVE_STEPS),
      length: TORPEDO.speed,
      frozenAt: null,
      deflections: 0,
      collided: false,
    });
  }
  const removedTorpedoes = new Set<string>();
  const removedMines = new Set<string>();

  const posAt = (m: Mover, k: number): Pose => m.samples[m.frozenAt !== null ? Math.min(m.frozenAt, k) : k];

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
    const r = ship.stats.radius + 1;
    if (!isInsideMap(state, ship, r)) set.add("edge");
    for (const a of state.asteroids) if (circlesOverlap(ship, r, a, a.radius)) set.add(a.id);
    for (const o of state.ships) if (o !== ship && o.alive && circlesOverlap(ship, r, o, o.stats.radius)) set.add(o.id);
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
    for (const s of state.ships) if (s.alive && circlesOverlap(s, s.stats.radius, mine, mine.radius)) set.add(s.id);
    for (const t of state.torpedoes) if (circlesOverlap(t, TORPEDO.radius, mine, mine.radius)) set.add(t.id);
    mineIgnore.set(mine.id, set);
  }

  const blastMine = (mine: Mine, k: number) => {
    removedMines.add(mine.id);
    const inField = state.ships.filter((s) => s.alive && circlesOverlap(posAt(shipMovers.get(s.id)!, k), s.stats.radius, mine, mine.radius));
    const hits = inField.map((s) => ({ shipId: s.id, damage: MINE.damage }));
    events.push({ type: "mineBlast", mineId: mine.id, x: mine.x, y: mine.y, t: k / MOVE_STEPS, hits });
    for (const s of inField) {
      applyDamage(s, MINE.damage, events);
      if (!s.alive) shipMovers.get(s.id)!.frozenAt = k;
    }
  };

  const killTorpedo = (t: Torpedo, k: number, hitShipId?: string, damage = 0) => {
    removedTorpedoes.add(t.id);
    const m = torpMovers.get(t.id)!;
    m.frozenAt = k;
    const p = m.samples[k];
    events.push({ type: "torpedoHit", torpedoId: t.id, shipId: hitShipId, x: p.x, y: p.y, t: k / MOVE_STEPS, damage });
  };

  for (let k = 1; k <= MOVE_STEPS; k++) {
    // --- srážky lodí: odmrštění, zranění, pokračování v pohybu ---
    for (let iter = 0; iter < 4; iter++) {
      let changed = false;
      for (const ship of state.ships) {
        if (!ship.alive) continue;
        const m = shipMovers.get(ship.id)!;
        if (m.frozenAt !== null) continue;
        const p = posAt(m, k);
        const r = ship.stats.radius;
        const t = k / MOVE_STEPS;
        let hit: { with: "edge" | "asteroid" | "ship"; otherId?: string; heading: number } | null = null;

        const outside = !isInsideMap(state, p, r);
        if (outside && !stillTouching(ship.id, "edge", true)) {
          let h = p.heading;
          if (p.x < r || p.x > state.width - r) h = Math.PI - h;
          if (p.y < r || p.y > state.height - r) h = -h;
          hit = { with: "edge", heading: normalizeAngle(h + scatter()) };
        } else {
          if (!outside) stillTouching(ship.id, "edge", false);
          for (const a of state.asteroids) {
            const ov = circlesOverlap(p, r, a, a.radius);
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
            const ov = circlesOverlap(p, r, op, other.stats.radius);
            if (!ov) {
              stillTouching(ship.id, other.id, false);
              continue;
            }
            if (stillTouching(ship.id, other.id, true)) continue;
            const away = Math.atan2(p.y - op.y, p.x - op.x);
            hit = { with: "ship", otherId: other.id, heading: normalizeAngle(away + scatter()) };
            // druhá loď se odrazí opačným směrem
            if (om.frozenAt === null) {
              const h2 = normalizeAngle(away + Math.PI + scatter());
              deflect(om, k, h2);
              touching.get(other.id)!.add(ship.id);
              events.push({ type: "collision", shipId: other.id, with: "ship", otherId: ship.id, t, newHeading: h2 });
              applyDamage(other, COLLISION_DAMAGE, events);
              if (!other.alive) om.frozenAt = k - 1;
            }
            break;
          }
        }
        if (hit) {
          deflect(m, k, hit.heading);
          touching.get(ship.id)!.add(hit.otherId ?? "edge");
          events.push({ type: "collision", shipId: ship.id, with: hit.with, otherId: hit.otherId, t, newHeading: hit.heading });
          applyDamage(ship, COLLISION_DAMAGE, events);
          if (!ship.alive) m.frozenAt = k - 1;
          changed = true;
        }
      }
      if (!changed) break;
    }

    // --- miny (spouští je lodě i torpéda) ---
    for (const mine of state.mines) {
      if (!mine.armed || removedMines.has(mine.id)) continue;
      const ignore = mineIgnore.get(mine.id)!;
      const shipsIn = state.ships.filter((s) => s.alive && circlesOverlap(posAt(shipMovers.get(s.id)!, k), s.stats.radius, mine, mine.radius));
      const torpsIn = state.torpedoes.filter((t) => !removedTorpedoes.has(t.id) && circlesOverlap(posAt(torpMovers.get(t.id)!, k), TORPEDO.radius, mine, mine.radius));
      const inIds = new Set([...shipsIn.map((s) => s.id), ...torpsIn.map((t) => t.id)]);
      for (const id of [...ignore]) if (!inIds.has(id)) ignore.delete(id);
      const trigger = [...inIds].some((id) => !ignore.has(id));
      if (!trigger) continue;
      blastMine(mine, k);
      for (const t of torpsIn) killTorpedo(t, k);
    }

    // --- torpéda ---
    for (const t of state.torpedoes) {
      if (removedTorpedoes.has(t.id)) continue;
      const m = torpMovers.get(t.id)!;
      const p = m.samples[k];
      const freshOwn = t.lifeLeft === TORPEDO.lifeTurns; // první kolo letu – neporaní vlastníka
      let hitShip: Ship | undefined;
      for (const s of state.ships) {
        if (!s.alive) continue;
        if (freshOwn && s.id === t.ownerId) continue;
        if (circlesOverlap(p, TORPEDO.radius, posAt(shipMovers.get(s.id)!, k), s.stats.radius)) {
          hitShip = s;
          break;
        }
      }
      if (hitShip) {
        killTorpedo(t, k, hitShip.id, TORPEDO.damage);
        applyDamage(hitShip, TORPEDO.damage, events);
        if (!hitShip.alive) shipMovers.get(hitShip.id)!.frozenAt = k;
        continue;
      }
      // torpédo vs torpédo
      const other = state.torpedoes.find((o) => o !== t && !removedTorpedoes.has(o.id) && circlesOverlap(p, TORPEDO.radius, posAt(torpMovers.get(o.id)!, k), TORPEDO.radius));
      if (other) {
        killTorpedo(t, k);
        killTorpedo(other, k);
        continue;
      }
      if (hitsAsteroid(state, p, TORPEDO.radius) || !isInsideMap(state, p, 0)) killTorpedo(t, k);
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
    // otočka se dokončí jen bez srážky
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
      removedTorpedoes.add(t.id);
      events.push({ type: "torpedoExpire", torpedoId: t.id, x: t.x, y: t.y });
    }
  }
  events.unshift({ type: "move", paths });
  state.torpedoes = state.torpedoes.filter((t) => !removedTorpedoes.has(t.id));
  state.mines = state.mines.filter((m) => !removedMines.has(m.id));

  // Stres z manévru, nebezpečný manévr zraní loď
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const man = maneuverOf.get(ship.id)!;
    ship.speed = man.speed;
    const before = ship.stress;
    if (isRed(man.difficulty)) ship.stress++;
    else if (man.difficulty === "green") ship.stress = Math.max(0, ship.stress - 1);
    if (ship.stress !== before) events.push({ type: "stress", shipId: ship.id, stress: ship.stress });
    if (man.difficulty === "danger") applyDamage(ship, 1, events);
  }

  /* ---------- 2. Akce ---------- */
  const canAct = (ship: Ship) => ship.alive && ship.stress === 0 && !shipMovers.get(ship.id)!.collided;

  const spotFree = (self: Ship, p: Vec): boolean => {
    if (!isInsideMap(state, p, self.stats.radius)) return false;
    if (hitsAsteroid(state, p, self.stats.radius)) return false;
    for (const o of state.ships) {
      if (o !== self && o.alive && circlesOverlap(p, self.stats.radius, o, o.stats.radius)) return false;
    }
    return true;
  };

  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!o?.action || o.special) continue;
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
      case "evade":
        ship.tokens.evade = 1;
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

  /* ---------- 3. Lasery (všichni současně) ---------- */
  const pending = new Map<string, number>();
  const shotTorpedoes = new Set<string>();
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    const o = orders.get(ship.id)!;
    if (!o.fire || ship.stats.attack <= 0) continue;

    // Ručně zaměřené torpédo – střílí se jen na něj.
    const torp = torpedoById(state, o.preferredTargetId);
    if (torp && torp.team !== ship.team) {
      if (dist(ship, torp) <= LASER.range && inArc(ship, torp, LASER.halfArc) && !shotTorpedoes.has(torp.id)) {
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
        events.push({
          type: "torpedoShot",
          torpedoId: torp.id,
          shooterId: ship.id,
          x: torp.x,
          y: torp.y,
          attackDice: outcome.attackDice,
          defenseDice: outcome.defenseDice,
          destroyed,
        });
      }
      continue;
    }

    const candidates = state.ships.filter(
      (e) => e.alive && e.team !== ship.team && dist(ship, e) <= LASER.range && inArc(ship, e, LASER.halfArc),
    );
    if (candidates.length === 0) continue;
    let target = candidates.find((c) => c.id === o.preferredTargetId);
    if (!target) target = candidates.reduce((best, c) => (dist(ship, c) < dist(ship, best) ? c : best));
    const d = dist(ship, target);
    const rangeBand = clamp(Math.ceil(d / LASER.band), 1, 3);
    const useLock = ship.lockTargetId === target.id;
    const outcome = resolveAttack(rng, {
      attackDice: ship.stats.attack + (rangeBand === 1 ? 1 : 0),
      defenseDice: target.stats.agility + (rangeBand === 3 ? 1 : 0),
      attackerFocus: ship.tokens.focus > 0,
      attackerLock: useLock,
      defenderFocus: target.tokens.focus > 0,
      defenderEvade: target.tokens.evade > 0,
    });
    if (useLock) ship.lockTargetId = undefined;
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
      damage: outcome.damage,
      rangeBand,
    });
    pending.set(target.id, (pending.get(target.id) ?? 0) + outcome.damage);
  }
  for (const [id, dmg] of pending) applyDamage(shipById(state, id)!, dmg, events);
  state.torpedoes = state.torpedoes.filter((t) => !shotTorpedoes.has(t.id));

  /* ---------- 4. Vypuštění torpéd a min ---------- */
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-${turn}-${seq++}`;
  for (const ship of state.ships) {
    const o = orders.get(ship.id);
    if (!o?.special || !ship.alive) continue;
    if (!canAct(ship)) continue;
    if (o.special.type === "torpedo") {
      const target = enemyTarget(state, ship, o.special.targetId);
      if (!target || ship.ammo.torpedoes <= 0) continue;
      ship.ammo.torpedoes--;
      const f = forward(ship.heading);
      const off = ship.stats.radius + TORPEDO.radius + 2;
      const torpedo: Torpedo = {
        id: newId("torp"),
        ownerId: ship.ownerId,
        team: ship.team,
        x: ship.x + f.x * off,
        y: ship.y + f.y * off,
        heading: ship.heading,
        targetId: target.id,
        trackLeft: TORPEDO.trackTurns,
        lifeLeft: TORPEDO.lifeTurns,
      };
      state.torpedoes.push(torpedo);
      events.push({ type: "spawnTorpedo", torpedo });
    } else if (o.special.type === "mine") {
      if (ship.ammo.mines <= 0) continue;
      ship.ammo.mines--;
      const sp = startPose.get(ship.id)!;
      const mine: Mine = { id: newId("mine"), ownerId: ship.ownerId, team: ship.team, x: sp.x, y: sp.y, radius: MINE.radius, armed: false };
      state.mines.push(mine);
      events.push({ type: "spawnMine", mine });
    }
  }

  /* ---------- 5. Konec kola ---------- */
  for (const mine of state.mines) mine.armed = true;
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    ship.shields = Math.min(ship.stats.shields, ship.shields + SHIELD_RECHARGE_PER_TURN);
    ship.tokens.focus = 0;
    ship.tokens.evade = 0;
    if (ship.lockTargetId && !shipById(state, ship.lockTargetId)?.alive) ship.lockTargetId = undefined;
  }
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
