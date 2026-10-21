import { insideMap } from "./mapshape.ts";
import { LASER, RULES, TORPEDO } from "./constants.ts";
import { actionCost } from "./resolve.ts";
import { bearingTo, circlesOverlap, dist, inArc, samplePath, type Pose } from "./geometry.ts";
import { isRed, listManeuvers, maneuverEnd, maneuverPath, maneuverStress } from "./maneuvers.ts";
import { circleHitsAsteroid } from "./asteroids.ts";
import type { Rng } from "./rng.ts";
import { profileOf } from "./ships.ts";
import type { GameState, Ship, ShipOrders } from "./types.ts";

/**
 * Jednoduchý bot: vybere manévr, po kterém bude mít nejvíc nepřátel ve výseči
 * a ideální vzdálenost; občas vypustí torpédo nebo položí minu.
 */
export function planBot(state: GameState, playerId: string, rng: Rng): ShipOrders[] {
  const out: ShipOrders[] = [];
  const myShips = state.ships.filter((s) => s.alive && s.ownerId === playerId);
  for (const ship of myShips) {
    const enemies = state.ships.filter((e) => e.alive && e.team !== ship.team);
    const dial = listManeuvers(profileOf(ship.loadout), ship.speed).filter((m) => maneuverStress(m) <= ship.stressPoints && m.difficulty !== "danger");
    let best = dial[0];
    let bestScore = -Infinity;
    for (const man of dial) {
      const end = maneuverEnd(ship, man);
      let score = scorePose(state, ship, end, enemies) + rng.next() * 2;
      // dráha nesmí vést skrz asteroid ani ven z mapy
      for (const p of samplePath(maneuverPath(ship, man), 8)) {
        const r = ship.stats.radius + 4;
        if (!insideMap(state, p, r)) score -= 15;
        for (const a of state.asteroids) if (circleHitsAsteroid(a, p, r)) score -= 15;
      }
      if (isRed(man.difficulty)) score -= 3;
      if (man.difficulty === "green" && ship.stressPoints < 3) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = man;
      }
    }
    const end = maneuverEnd(ship, best);
    const nearest = enemies.length ? enemies.reduce((a, b) => (dist(ship, a) < dist(ship, b) ? a : b)) : undefined;
    const willHaveTarget = enemies.some((e) => inArc(end, e, LASER.halfArc * 2) && dist(end, e) <= LASER.range);

    const orders: ShipOrders = { shipId: ship.id, maneuverId: best.id, fire: false, preferredTargetId: nearest?.id };
    const left = () => RULES.actionPoints - actionCost(ship, orders);
    const torpTarget = enemies.find((e) => dist(ship, e) <= TORPEDO.lockRange);
    if (left() > 0 && willHaveTarget) orders.fire = true;
    if (left() > 0 && ship.ammo.torpedoes > 0 && torpTarget && rng.next() < 0.5) {
      orders.special = { type: "torpedo", targetId: torpTarget.id };
    } else if (left() > 0 && ship.ammo.mines > 0 && nearest && dist(ship, nearest) < 200 && Math.abs(bearingTo(ship, nearest)) > Math.PI / 2 && rng.next() < 0.5) {
      orders.special = { type: "mine" };
    }
    if (left() > 0 && !orders.fire) orders.fire = true;
    // nemá-li střílet na nic, radši nechat akci na pohyb příště (nic nestojí)
    out.push(orders);
  }
  return out;
}

function scorePose(state: GameState, ship: Ship, end: Pose, enemies: Ship[]): number {
  let score = 0;
  const r = ship.stats.radius;
  if (!insideMap(state, end, r + 30)) score -= 50;
  // okrajová bouře: do pásu vůbec, za tvrdý okraj nikdy
  if (state.border && !insideMap(state, end, r)) score -= 200;
  for (const a of state.asteroids) if (circleHitsAsteroid(a, end, r + 10)) score -= 40;
  for (const o of state.ships) if (o !== ship && o.alive && circlesOverlap(end, r + 12, o, o.stats.radius)) score -= 25;
  for (const e of enemies) {
    const d = dist(end, e);
    if (d <= LASER.range && inArc(end, e, LASER.halfArc)) score += 12;
    else if (d <= LASER.range && inArc(end, e, LASER.halfArc * 2.5)) score += 4;
    // nechceme být příliš blízko ani daleko
    if (d < 60) score -= 6;
    else if (d < 220) score += 3;
    else score -= d / 200;
    // nebýt v jejich výseči
    if (inArc(e, end, LASER.halfArc) && d <= LASER.range) score -= 5;
  }
  for (const m of state.mines) if (circlesOverlap(end, r, m, m.radius + 20)) score -= 30;
  return score;
}
