import { moduleWorking } from "./ships.ts";
import { insideMap } from "./mapshape.ts";
import { LASER, RULES, TORPEDO } from "./constants.ts";
import { actionCost, obstacles } from "./resolve.ts";
import { bearingTo, circlesOverlap, dist, inArc, samplePath, type Pose } from "./geometry.ts";
import { isRed, listManeuvers, maneuverEnd, maneuverPath, maneuverStress } from "./maneuvers.ts";
import { circleHitsAsteroid } from "./asteroids.ts";
import type { Rng } from "./rng.ts";
import { laserRange, profileOf, torpedoLockRange } from "./ships.ts";
import type { BotLevel, GameState, Ship, ShipOrders } from "./types.ts";
import { planSmartBot, shipCollisionPenalty, type BotContext } from "./bot-ai.ts";

/**
 * Jednoduchý bot: vybere manévr, po kterém bude mít nejvíc nepřátel ve výseči
 * a ideální vzdálenost; občas vypustí torpédo nebo položí minu.
 */
export function planBot(state: GameState, playerId: string, rng: Rng, level: BotLevel = "kadet", ctx: BotContext = {}): ShipOrders[] {
  if (level === "pilot" || level === "eso") return planSmartBot(state, playerId, rng, level, ctx);
  const out: ShipOrders[] = [];
  const myShips = state.ships.filter((s) => s.alive && s.ownerId === playerId);
  const allyPaths = new Map(ctx.allyPaths ?? []);
  ctx = { ...ctx, allyPaths };
  for (const ship0 of myShips) {
    const enemies = state.ships.filter((e) => e.alive && e.team !== ship0.team);
    // stojící loď se nejdřív otočí k nejbližšímu nepříteli (akce „otočit“) a plánuje z nového kurzu
    const turnTo = ship0.speed === 0 && enemies.length ? enemies.reduce((a, b) => (dist(ship0, a) < dist(ship0, b) ? a : b)) : undefined;
    const turnHeading = turnTo ? Math.atan2(turnTo.y - ship0.y, turnTo.x - ship0.x) : undefined;
    const ship = turnHeading !== undefined ? { ...ship0, heading: turnHeading } : ship0;
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
        for (const a of obstacles(state)) if (circleHitsAsteroid(a, p, r)) score -= 15;
      }
      score += shipCollisionPenalty(state, ship, maneuverPath(ship, man), ctx) / 3; // kadet: srážky řeší jen hrubě
      if (isRed(man.difficulty)) score -= 3;
      if (man.difficulty === "green" && ship.stressPoints < 3) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = man;
      }
    }
    const end = maneuverEnd(ship, best);
    allyPaths.set(ship.id, maneuverPath(ship, best));
    const nearest = enemies.length ? enemies.reduce((a, b) => (dist(ship, a) < dist(ship, b) ? a : b)) : undefined;
    const willHaveTarget = enemies.some((e) => inArc(end, e, LASER.halfArc * 2) && dist(end, e) <= laserRange(ship));

    const orders: ShipOrders = { shipId: ship.id, maneuverId: best.id, shots: [], preferredTargetId: nearest?.id };
    if (turnHeading !== undefined) orders.action = { type: "turn", heading: turnHeading };
    const left = () => RULES.actionPoints - actionCost(ship, orders);
    const lasers = ship.loadout.modules.filter((m) => m.type === "laser" && moduleWorking(m));
    const addLaser = () => {
      const m = lasers.find((x) => !orders.shots!.some((sh) => sh.moduleId === x.id));
      if (m) orders.shots!.push({ moduleId: m.id });
      return !!m;
    };
    const torpTarget = enemies.find((e) => dist(ship, e) <= torpedoLockRange(ship));
    if (left() > 0 && willHaveTarget) addLaser();
    if (left() > 0 && ship.ammo.torpedoes > 0 && torpTarget && rng.next() < 0.5) {
      orders.special = { type: "torpedo", targetId: torpTarget.id };
    } else if (left() > 0 && ship.ammo.mines > 0 && nearest && dist(ship, nearest) < 200 && Math.abs(bearingTo(ship, nearest)) > Math.PI / 2 && rng.next() < 0.5) {
      orders.special = { type: "mine" };
    }
    // zbylé akce: další lasery (každý modul zvlášť)
    while (left() > 0 && addLaser()) {
      /* další laser */
    }
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
  for (const a of obstacles(state)) if (circleHitsAsteroid(a, end, r + 10)) score -= 40;
  for (const o of state.ships) if (o !== ship && o.alive && circlesOverlap(end, r + 12, o, o.stats.radius)) score -= 25;
  for (const e of enemies) {
    const d = dist(end, e);
    if (d <= laserRange(ship) && inArc(end, e, LASER.halfArc)) score += 12;
    else if (d <= laserRange(ship) && inArc(end, e, LASER.halfArc * 2.5)) score += 4;
    // nechceme být příliš blízko ani daleko
    if (d < 60) score -= 6;
    else if (d < 220) score += 3;
    else score -= d / 200;
    // nebýt v jejich výseči
    if (inArc(e, end, LASER.halfArc) && d <= laserRange(e)) score -= 5;
  }
  for (const m of state.mines) if (circlesOverlap(end, r, m, m.radius + 20)) score -= 30;
  // nikdo v dohledu (mlha): letět ke středu mapy
  if (enemies.length === 0) score -= dist(end, { x: state.width / 2, y: state.height / 2 }) / 40;
  return score;
}
