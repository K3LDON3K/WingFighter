import { LASER, TORPEDO } from "./constants.ts";
import { bearingTo, circlesOverlap, dist, inArc, samplePath, type Pose } from "./geometry.ts";
import { isRed, listManeuvers, maneuverEnd, maneuverPath } from "./maneuvers.ts";
import type { Rng } from "./rng.ts";
import { hullOf } from "./ships.ts";
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
    const dial = listManeuvers(hullOf(ship.loadout).profile, ship.speed).filter((m) => !(isRed(m.difficulty) && ship.stress > 0) && m.difficulty !== "danger");
    let best = dial[0];
    let bestScore = -Infinity;
    for (const man of dial) {
      const end = maneuverEnd(ship, man);
      let score = scorePose(state, ship, end, enemies) + rng.next() * 2;
      // dráha nesmí vést skrz asteroid ani ven z mapy
      for (const p of samplePath(maneuverPath(ship, man), 8)) {
        const r = ship.stats.radius + 4;
        if (p.x < r || p.y < r || p.x > state.width - r || p.y > state.height - r) score -= 15;
        for (const a of state.asteroids) if (circlesOverlap(p, r, a, a.radius)) score -= 15;
      }
      if (isRed(man.difficulty)) score -= 3;
      if (man.difficulty === "green" && ship.stress > 0) score += 4;
      if (score > bestScore) {
        bestScore = score;
        best = man;
      }
    }
    const end = maneuverEnd(ship, best);
    const nearest = enemies.length ? enemies.reduce((a, b) => (dist(ship, a) < dist(ship, b) ? a : b)) : undefined;
    const willHaveTarget = enemies.some((e) => inArc(end, e, LASER.halfArc * 2) && dist(end, e) <= LASER.range);

    const orders: ShipOrders = { shipId: ship.id, maneuverId: best.id, fire: true, preferredTargetId: nearest?.id };
    const canAct = ship.stress === 0 || best.difficulty === "green";
    if (canAct && !isRed(best.difficulty)) {
      const torpTarget = enemies.find((e) => dist(ship, e) <= TORPEDO.lockRange);
      if (ship.ammo.torpedoes > 0 && torpTarget && rng.next() < 0.45) {
        orders.special = { type: "torpedo", targetId: torpTarget.id };
      } else if (ship.ammo.mines > 0 && nearest && dist(ship, nearest) < 200 && Math.abs(bearingTo(ship, nearest)) > Math.PI / 2 && rng.next() < 0.5) {
        orders.special = { type: "mine" };
      } else if (willHaveTarget) {
        orders.action = { type: "focus" };
      } else if (nearest && dist(end, nearest) <= 300 && rng.next() < 0.6) {
        orders.action = { type: "lock", targetId: nearest.id };
      } else {
        orders.action = { type: "evade" };
      }
    }
    out.push(orders);
  }
  return out;
}

function scorePose(state: GameState, ship: Ship, end: Pose, enemies: Ship[]): number {
  let score = 0;
  const r = ship.stats.radius;
  if (end.x < r + 30 || end.y < r + 30 || end.x > state.width - r - 30 || end.y > state.height - r - 30) score -= 50;
  for (const a of state.asteroids) if (circlesOverlap(end, r + 10, a, a.radius)) score -= 40;
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
