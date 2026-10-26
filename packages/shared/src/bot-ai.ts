/**
 * Chytřejší boti (Pilot, Eso). Nepodvádí – dostávají stejný stav jako hráč jejich týmu (mlha války).
 *
 * Pilot: předvídá pohyb nepřátel (letí dál rovně), hodnotí vzájemnou pozici po manévru (já je mám ve výseči,
 * oni mě ne), využije všechny zbraně s nejvýhodnějšími cíli, uhýbá při silném ohrožení a přerozděluje segmenty
 * štítu směrem k hrozbě.
 *
 * Eso: navíc počítá s více možnými manévry nepřítele (průměr + nejhorší případ), hledá dvě kola dopředu
 * (nejlepší odpověď z dosažené pozice), používá otočku, torpéda na předvídaný bod, droida (overdrive / autopilot),
 * skener a sbírá ocasy komet, když má vybitý štít.
 */
import { circleHitsAsteroid } from "./asteroids.ts";
import { CARGO, DROID, LASER, MG, REPAIR, RULES, TORPEDO } from "./constants.ts";
import { bearingTo, circlesOverlap, dist, inArc, samplePath, type Pose } from "./geometry.ts";
import { listManeuvers, maneuverEnd, maneuverPath, makeManeuver } from "./maneuvers.ts";
import { insideMap } from "./mapshape.ts";
import { pointInStorm } from "./mapgen.ts";
import { actionCost, aimPose, ammoModules, obstacles, stationInPickupRange, canAfford, defaultOrders, droidModule, effStressCost, hitSegment, inCometTail, laserOdds, mgHitChance, mgPreview, mineModule, repairBlocked, repairableModules, sectorHit, shieldRechargeBlocked, torpedoModule, validShieldAction } from "./resolve.ts";
import type { Rng } from "./rng.ts";
import { cargoCapacity, laserHalfArc, laserRange, mgRange, moduleWorking, MODULES, profileOf, torpedoLockRange, torpedoPointRange } from "./ships.ts";
import type { BotLevel, GameState, Maneuver, RepairOrder, Segments, Ship, ShipOrders, Shot } from "./types.ts";

/** Předpokládané pozice nepřítele po tomto kole (s vahou). */
interface Guess {
  pose: Pose;
  w: number;
}

/** Kam nepřítel asi doletí: Pilot = rovně stejnou rychlostí; Eso = rovně / mírně vlevo / vpravo (váhy). */
function guessMoves(e: Ship, level: BotLevel): Guess[] {
  const profile = profileOf(e.loadout);
  const sp = Math.max(1, Math.min(profile.maxSpeed, e.speed));
  const mk = (angle: number) => makeManeuver(profile, sp, angle, false, e.speed) ?? makeManeuver(profile, sp, 0, false, e.speed);
  if (level !== "eso") {
    // rovně stejnou rychlostí; zčásti i „zůstane blízko“ (zatáčky, zpomalení)
    const m = mk(0);
    return [{ pose: m ? maneuverEnd(e, m) : e, w: 0.6 }, { pose: e, w: 0.4 }];
  }
  const out: Guess[] = [{ pose: e, w: 0.25 }];
  for (const [angle, w] of [[0, 0.35], [-45, 0.2], [45, 0.2]] as const) {
    const m = mk(angle);
    out.push({ pose: m ? maneuverEnd(e, m) : e, w });
  }
  return out;
}

/** Očekávané zranění, které z pozice `me` (po manévru) příští kolo dám nepříteli na `pose` (všechny lasery + kulomet). */
function offenseAt(me: Ship, mePose: Pose, enemy: Ship, pose: Pose): number {
  let dmg = 0;
  const target: Ship = { ...enemy, x: pose.x, y: pose.y, heading: pose.heading };
  const shooter: Ship = { ...me, x: mePose.x, y: mePose.y, heading: mePose.heading };
  for (const mod of me.loadout.modules) {
    if (!moduleWorking(mod)) continue;
    if (mod.type === "laser" && me.stats.attack > 0) {
      const odds = laserOdds(shooter, target, mod.id);
      if (odds.coverage > 0) dmg += odds.expectedDamage;
    } else if (mod.type === "mg" && (mod.ammo ?? 0) > 0) {
      const aim = aimPose(shooter, mod);
      const ha = sectorHit(aim, mgRange(shooter), MG.halfArc, target);
      const cov = ha.coverage;
      if (cov <= 0) continue;
      dmg += Math.min(MG.burst, mod.ammo ?? 0) * MG.damage * mgHitChance(ha.meanDist, false, mgRange(shooter)) * cov;
    }
  }
  return dmg;
}

/** Očekávané zranění, které mi nepřítel na `pose` dá, když já stojím na `mePose`. */
function threatAt(me: Ship, mePose: Pose, enemy: Ship, pose: Pose): number {
  return offenseAt({ ...enemy, x: pose.x, y: pose.y, heading: pose.heading }, pose, me, mePose);
}

/** Konec limitu kol: kdo vede na trup+štít, hraje opatrně; kdo prohrává, musí útočit. */
function endgameWeights(state: GameState, ship: Ship, enemies: Ship[]): { off: number; def: number } {
  const limit = state.settings.turnLimit;
  if (!limit || limit - state.turn > 6) return { off: 1, def: 1 };
  const mine = state.ships.filter((s) => s.alive && s.team === ship.team).reduce((a, s) => a + s.hull + s.shields, 0);
  const theirs = enemies.reduce((a, s) => a + s.hull + s.shields, 0);
  return mine > theirs ? { off: 0.7, def: 2 } : { off: 1.8, def: 0.6 };
}

/** Kontext plánování: dráhy spoluhráčů, které už jsou známé (naplánovaní boti, odeslané rozkazy lidí). */
export interface BotContext {
  allyPaths?: Map<string, (t: number) => Pose>;
}

/** Dráhy lodí z rozkazů (pro předání dalším botům ve stejném týmu). */
export function plannedPaths(state: GameState, orders: ShipOrders[]): Map<string, (t: number) => Pose> {
  const out = new Map<string, (t: number) => Pose>();
  for (const o of orders) {
    const ship = state.ships.find((s) => s.id === o.shipId && s.alive);
    if (!ship) continue;
    const man = listManeuvers(profileOf(ship.loadout), ship.speed).find((m) => m.id === o.maneuverId);
    if (man) out.set(ship.id, maneuverPath(ship, man));
  }
  return out;
}

/** Předpokládaná dráha cizí lodi: známý plán, u spoluhráče jinak „rovně stejnou rychlostí“, u nepřítele stojí. */
function expectedPath(ship: Ship, other: Ship, ctx?: BotContext): (t: number) => Pose {
  const known = ctx?.allyPaths?.get(other.id);
  if (known) return known;
  if (other.team === ship.team) {
    const man = makeManeuver(profileOf(other.loadout), other.speed, 0, false, other.speed);
    if (man) return maneuverPath(other, man);
  }
  return () => other;
}

/**
 * Hrozba srážky s jinou lodí během manévru: obě dráhy se vzorkují ve stejném čase.
 * Známá dráha spoluhráče = jistá srážka (velká pokuta); odhad = menší pokuta.
 */
export function shipCollisionPenalty(state: GameState, ship: Ship, path: (t: number) => Pose, ctx?: BotContext): number {
  let s = 0;
  const r = ship.stats.radius;
  for (const o of state.ships) {
    if (o.id === ship.id || !o.alive) continue;
    const op = expectedPath(ship, o, ctx);
    const known = !!ctx?.allyPaths?.has(o.id);
    const ally = o.team === ship.team;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      if (circlesOverlap(path(t), r + 6, op(t), o.stats.radius)) {
        s -= known ? 90 : ally ? 45 : 25;
        break;
      }
    }
  }
  return s;
}

/** Bezpečnost pozice: okraj, asteroidy, bouře, miny, srážky. */
function safety(state: GameState, ship: Ship, end: Pose, path: (t: number) => Pose, ctx?: BotContext): number {
  let s = 0;
  const r = ship.stats.radius;
  s += shipCollisionPenalty(state, ship, path, ctx);
  if (!insideMap(state, end, r + 40)) s -= 60;
  if (state.border && !insideMap(state, end, r)) s -= 300;
  for (const p of samplePath(path, 8)) {
    if (!insideMap(state, p, r + 4)) s -= 20;
    for (const a of obstacles(state)) if (circleHitsAsteroid(a, p, r + 2)) s -= 60;
  }
  for (const a of obstacles(state)) if (circleHitsAsteroid(a, end, r + 12)) s -= 30;
  for (const o of state.ships) if (o.id !== ship.id && o.alive && circlesOverlap(end, r + 14, o, o.stats.radius)) s -= 30;
  for (const m of state.mines) if (m.team !== ship.team && circlesOverlap(end, r, m, m.radius + 24)) s -= 45;
  if (state.storms?.length && pointInStorm(state.storms, end, r)) s -= ship.shieldType === "none" ? 2 : 14; // v bouři nefungují štíty ani lasery
  for (const c of state.comets ?? []) {
    // dráha komety v tomto kole: držet se dál od ní
    const f = { x: Math.cos(c.heading), y: Math.sin(c.heading) };
    for (let t = 0; t <= 1; t += 0.25) {
      const cp = { x: c.x + f.x * c.speed * t, y: c.y + f.y * c.speed * t };
      if (circlesOverlap(end, r + 10, cp, c.radius)) s -= 50;
    }
  }
  return s;
}

/** Hodnota pozice po manévru vůči (odhadnutým) pozicím nepřátel. */
function positionValue(state: GameState, ship: Ship, end: Pose, enemies: Ship[], guesses: Map<string, Guess[]>, level: BotLevel): number {
  let v = 0;
  const aggro = endgameWeights(state, ship, enemies);
  for (const e of enemies) {
    const gs = guesses.get(e.id) ?? [{ pose: e, w: 1 }];
    let off = 0;
    let thr = 0;
    let worstThr = 0;
    for (const g of gs) {
      const o = offenseAt(ship, end, e, g.pose);
      const t = threatAt(ship, end, e, g.pose);
      off += o * g.w;
      thr += t * g.w;
      worstThr = Math.max(worstThr, t);
    }
    // Eso hledí i na nejhorší případ; zraněného nepřítele tlačí (dorazit), před koncem limitu hraje na skóre
    const finish = e.hull < e.stats.hull * 0.5 ? 1.3 : 1;
    v += off * finish * aggro.off - (level === "eso" ? 0.8 * thr + 0.2 * worstThr : thr) * 0.9 * aggro.def;
    const d = dist(end, gs[0].pose);
    if (d < 70) v -= 8;
    else if (d > laserRange(ship) * 1.6) v -= (d - laserRange(ship) * 1.6) / 60;
  }
  if (enemies.length === 0) {
    // nikdo v dohledu: opatrný průzkum – ke středu mapy, ale pomalu, dál od okraje, bouří a spoluhráčů
    const c = { x: state.width / 2, y: state.height / 2 };
    v -= dist(end, c) / 40;
    if (!insideMap(state, end, ship.stats.radius + 90)) v -= 15;
    if (state.storms?.length && pointInStorm(state.storms, end, ship.stats.radius)) v -= 10;
    for (const o of state.ships) if (o.id !== ship.id && o.alive && o.team === ship.team && dist(end, o) < 90) v -= 15;
  }
  return v;
}

/** Ocas komety v dosahu: hodnotná dráha, když je štít vybitý (Eso). */
function cometTailBonus(state: GameState, ship: Ship, path: (t: number) => Pose): number {
  if (!state.comets?.length) return 0;
  const shieldLow = ship.shieldType === "whole" ? ship.shields < ship.stats.shields * 0.5 : ship.shieldType === "segment" ? ship.segments.reduce((a, b) => a + b, 0) <= 3 : ship.hull < ship.stats.hull * 0.6;
  if (!shieldLow) return 0;
  for (const c of state.comets) {
    if (c.tailUsed.includes(ship.id)) continue;
    for (const p of samplePath(path, 6)) if (inCometTail(c, p)) return 25;
  }
  return 0;
}

interface Candidate {
  man: Maneuver;
  end: Pose;
  score: number;
}

function rankManeuvers(state: GameState, ship: Ship, enemies: Ship[], guesses: Map<string, Guess[]>, level: BotLevel, overdrive: boolean, rng: Rng, ctx?: BotContext): Candidate[] {
  const o = { droid: overdrive ? { overdrive: true } : undefined };
  const dial = listManeuvers(profileOf(ship.loadout), ship.speed).filter((m) => canAfford(ship, m, o));
  const out: Candidate[] = [];
  for (const man of dial) {
    if (!man.koiogran && man.difficulty === "danger" && !overdrive) continue;
    if (man.koiogran && level !== "eso") continue; // otočku používá jen Eso
    const path = maneuverPath(ship, man);
    const end = maneuverEnd(ship, man);
    let score = positionValue(state, ship, end, enemies, guesses, level) + safety(state, ship, end, path, ctx);
    if (enemies.length === 0 && man.speed > 2) score -= (man.speed - 2) * 5; // při hledání nespěchat
    // stres: červený manévr jen když to stojí za to; zelený dobíjí
    const stress = effStressCost(man, o);
    if (stress > 0) score -= stress * (ship.stressPoints <= 1 ? 12 : 4);
    if (stress < 0 && ship.stressPoints < ship.stats.stressMax) score += 3;
    if (man.koiogran) score -= 6; // stojí 2 akce
    if (level === "eso") score += cometTailBonus(state, ship, path);
    score += rng.next() * (level === "eso" ? 0.5 : 1.5); // trocha nepředvídatelnosti
    out.push({ man, end, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Eso: pro nejlepší kandidáty se podívá ještě o kolo dál – jak dobrá bude nejlepší odpověď z dosažené pozice. */
function lookahead(state: GameState, ship: Ship, cands: Candidate[], enemies: Ship[], level: BotLevel, rng: Rng, freeId?: string, ctx?: BotContext): Candidate[] {
  if (!cands.length) return cands;
  const top = cands.slice(0, 8);
  const free = freeId ? cands.find((c) => c.man.id === freeId) : undefined;
  if (free && !top.includes(free)) top.push(free);
  // nepřátelé po svém dalším kole: z odhadnutých pozic zase rovně
  const next = new Map<string, Guess[]>();
  for (const e of enemies) {
    const gs = guessMoves(e, level);
    const list: Guess[] = [];
    for (const g of gs) for (const g2 of guessMoves({ ...e, x: g.pose.x, y: g.pose.y, heading: g.pose.heading }, "pilot")) list.push({ pose: g2.pose, w: g.w * g2.w });
    next.set(e.id, list);
  }
  const scored = top.map((c) => {
    const there: Ship = { ...ship, x: c.end.x, y: c.end.y, heading: c.end.heading, speed: c.man.speed, stressPoints: Math.max(0, Math.min(ship.stats.stressMax, ship.stressPoints - effStressCost(c.man))) };
    const replies = rankManeuvers(state, there, enemies, next, "pilot", false, rng, ctx);
    return { ...c, score: c.score + 0.8 * (replies[0]?.score ?? -50) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Střelba: každému laseru/kulometu nejvýhodnější cíl (očekávané zranění), v pořadí od nejlepšího; vrací i užitky. */
/**
 * Kolik ze zranění daného druhu skutečně „bolí“ cíl: energetický štít lasery jen vybíjí (dokud má zásobu),
 * ale projektil ho prorazí; segmenty projektil zachytí celý, laser jimi proniká. Vrací násobek 0.3–1.3.
 */
function shieldFactor(target: Ship, kind: "energy" | "kinetic"): number {
  if (target.shieldType === "whole" && target.shields > 0) return kind === "kinetic" ? 0.6 + (0.4 * RULES.wholePiercePct) / 100 : 0.5;
  if (target.shieldType === "segment" && target.segments.some((n) => n > 0)) return kind === "energy" ? 0.6 + (0.7 * RULES.segmentPassPct) / 100 : 0.45;
  return 1;
}

function planShots(state: GameState, ship: Ship, enemies: Ship[]): { shot: Shot; value: number }[] {
  const out: { shot: Shot; value: number }[] = [];
  for (const mod of ship.loadout.modules) {
    if (!moduleWorking(mod)) continue;
    if (mod.type === "laser" && ship.stats.attack > 0 && !(state.storms?.length && pointInStorm(state.storms, ship, ship.stats.radius))) {
      let best: { id: string; v: number } | undefined;
      for (const e of enemies) {
        const odds = laserOdds(ship, e, mod.id);
        if (odds.coverage <= 0) continue;
        // zraněného nepřítele dorazit: bonus
        const v = odds.expectedDamage * (e.hull <= odds.expectedDamage ? 1.6 : 1) * shieldFactor(e, "energy");
        if (!best || v > best.v) best = { id: e.id, v };
      }
      if (best && best.v > 1) out.push({ shot: { moduleId: mod.id, targetId: best.id }, value: best.v });
    } else if (mod.type === "mg" && (mod.ammo ?? 0) > 0) {
      let best: { id: string; v: number } | undefined;
      for (const e of enemies) {
        const pv = mgPreview(state, ship, e.id, mod.id);
        if (!pv || pv.targetId !== e.id) continue;
        const v = pv.expectedDamage * shieldFactor(e, "kinetic");
        if (!best || v > best.v) best = { id: e.id, v };
      }
      if (best && best.v > 1) out.push({ shot: { moduleId: mod.id, targetId: best.id }, value: best.v });
    }
  }
  return out.sort((a, b) => b.value - a.value);
}

/** Jak moc mě teď (před pohybem) ohrožují lasery/kulomety nepřátel. */
function incomingNow(state: GameState, ship: Ship, enemies: Ship[]): number {
  let t = 0;
  for (const e of enemies) t += offenseAt(e, e, ship, ship);
  return t;
}

/** Kam dát body z dobití segmentového štítu: k největší hrozbě, jinak nejslabším segmentům. */
function shieldRechargeSplit(ship: Ship, enemies: Ship[]): number[] {
  const cap = RULES.segmentHp * ship.stats.segmentModules;
  const threat = [0, 0, 0, 0];
  for (const e of enemies) threat[hitSegment(ship, e)] += offenseAt(e, e, ship, ship) + 1;
  const segs = [...ship.segments];
  const add = [0, 0, 0, 0];
  for (let k = 0; k < RULES.rechargeSegments; k++) {
    let best = -1;
    for (let i = 0; i < 4; i++) {
      if (segs[i] >= cap) continue;
      if (best < 0 || threat[i] > threat[best] || (threat[i] === threat[best] && segs[i] < segs[best])) best = i;
    }
    if (best < 0) break;
    segs[best]++;
    add[best]++;
  }
  return add;
}

/** Přerozdělení segmentů štítu směrem k největší hrozbě (součet zůstává). */
function shieldPlan(ship: Ship, enemies: Ship[]): Segments | undefined {
  if (ship.shieldType !== "segment") return undefined;
  const total = ship.segments.reduce((a, b) => a + b, 0);
  if (total === 0 || enemies.length === 0) return undefined;
  const threat = [0, 0, 0, 0];
  for (const e of enemies) {
    const v = offenseAt(e, e, ship, ship) + 1;
    threat[hitSegment(ship, e)] += v;
  }
  const order = [0, 1, 2, 3].sort((a, b) => threat[b] - threat[a]);
  const want: Segments = [0, 0, 0, 0];
  let left = total;
  for (const seg of order) {
    const give = Math.min(RULES.segmentMax, left, threat[seg] > 0 ? RULES.segmentMax : 1);
    want[seg] = give;
    left -= give;
  }
  // zbytek doplnit kamkoli pod strop
  for (const seg of order) {
    while (left > 0 && want[seg] < RULES.segmentMax) {
      want[seg]++;
      left--;
    }
  }
  if (!validShieldAction(ship, want)) return undefined;
  // má cenu jen když se něco přesune ke hrozbě
  const gain = want[order[0]] - ship.segments[order[0]];
  return gain >= 1 ? want : undefined;
}

export function planSmartBot(state: GameState, playerId: string, rng: Rng, level: BotLevel, ctx: BotContext = {}): ShipOrders[] {
  const out: ShipOrders[] = [];
  const myShips = state.ships.filter((s) => s.alive && s.ownerId === playerId);
  // vlastní lodě se plánují postupně a každá zná dráhy těch předchozích
  const allyPaths = new Map(ctx.allyPaths ?? []);
  ctx = { ...ctx, allyPaths };
  for (const ship0 of myShips) {
    const enemies = state.ships.filter((e) => e.alive && e.team !== ship0.team);
    // stojící loď se nejdřív otočí k nejbližšímu nepříteli (akce „otočit“) a plánuje z nového kurzu
    const turnTo = ship0.speed === 0 && enemies.length ? enemies.reduce((a, b) => (dist(ship0, a) < dist(ship0, b) ? a : b)) : undefined;
    const turnHeading = turnTo ? Math.atan2(turnTo.y - ship0.y, turnTo.x - ship0.x) : undefined;
    const ship: Ship = turnHeading !== undefined ? { ...ship0, heading: turnHeading } : ship0;
    const guesses = new Map<string, Guess[]>();
    for (const e of enemies) guesses.set(e.id, guessMoves(e, level));
    const droid = droidModule(ship);
    const inStormNow = !!state.storms?.length && pointInStorm(state.storms, ship, ship.stats.radius);

    // 1. manévr (Eso: zváží i overdrive, když by pomohl červený/nebezpečný manévr)
    let cands = rankManeuvers(state, ship, enemies, guesses, level, false, rng, ctx);
    let overdrive = false;
    if (level === "eso" && droid && !inStormNow && ship.techPoints >= DROID.overdriveCost) {
      const withOd = rankManeuvers(state, ship, enemies, guesses, level, true, rng, ctx);
      if (withOd[0] && cands[0] && withOd[0].score > cands[0].score + 15) {
        cands = withOd;
        overdrive = true;
      }
    }
    const freeId = defaultOrders(ship).maneuverId;
    if (level === "eso") cands = lookahead(state, ship, cands, enemies, level, rng, freeId, ctx);
    const chosen = cands[0];
    allyPaths.set(ship.id, maneuverPath(ship, chosen.man));
    const orders: ShipOrders = { shipId: ship.id, maneuverId: chosen.man.id, shots: [], preferredTargetId: enemies[0]?.id };
    if (turnHeading !== undefined) orders.action = { type: "turn", heading: turnHeading };
    if (overdrive) orders.droid = { overdrive: true };
    // dobití štítu technologií (nebere akci): když je štít slabý a technologie zbývá; Eso si nechá rezervu na overdrive
    if (!shieldRechargeBlocked(state, ship) && !overdrive) {
      const low = ship.shieldType === "whole" ? ship.shields <= ship.stats.shields * 0.4 : ship.segments.reduce((a, b) => a + b, 0) <= 3;
      const reserve = level === "eso" && droid ? DROID.overdriveCost : 0;
      if (low && ship.techPoints - RULES.rechargeTechCost >= reserve) orders.rechargeShield = { segments: ship.shieldType === "segment" ? shieldRechargeSplit(ship, enemies) : undefined };
    }
    // droid opravář (nebere akci): zničený/poškozený modul, prázdná munice, slabý trup – pokud technologie zbývá
    if (!repairBlocked(state, ship)) {
      const reserve = level === "eso" && droid ? DROID.overdriveCost : 0;
      let tech = ship.techPoints - (overdrive ? DROID.overdriveCost : 0) - (orders.rechargeShield ? RULES.rechargeTechCost : 0);
      const rep: RepairOrder[] = [];
      const broken = repairableModules(ship).filter((m) => !moduleWorking(m) && m.type !== "repair");
      if (broken.length && tech - REPAIR.moduleCost >= reserve) {
        rep.push({ kind: "module", moduleId: broken[0].id });
        tech -= REPAIR.moduleCost;
      }
      if (ship.hull <= ship.stats.hull * 0.5 && tech - REPAIR.hullCost >= reserve) {
        rep.push({ kind: "hull" });
        tech -= REPAIR.hullCost;
      }
      const empty = ammoModules(ship).filter((m) => (m.ammo ?? 0) === 0);
      if (empty.length && tech - REPAIR.ammoCost >= reserve) {
        rep.push({ kind: "ammo", moduleId: empty[0].id });
        tech -= REPAIR.ammoCost;
      }
      if (rep.length) orders.repair = rep;
    }
    const left = () => RULES.actionPoints - actionCost(ship, orders);

    // 2. nabídka akcí s užitkem; vezmou se nejlepší, co se vejdou
    type Opt = { value: number; kind: "shot" | "action" | "special"; apply: () => void };
    const opts: Opt[] = [];
    const shots = planShots(state, ship, enemies);
    for (const s of shots) opts.push({ value: s.value, kind: "shot", apply: () => orders.shots!.push(s.shot) });
    const incoming = incomingNow(state, ship, enemies);
    // úhyb: vyplatí se při silné palbě; stojí stres (ne při overdrive)
    if (incoming >= 12 && ship.stressPoints > (overdrive ? 0 : RULES.evadeStressCost)) {
      opts.push({ value: incoming * 0.45, kind: "action", apply: () => (orders.action = { type: "evade" }) });
    }
    // štít: přesunout segmenty k hrozbě
    const seg = shieldPlan(ship, enemies);
    if (seg && incoming > 0) opts.push({ value: Math.min(incoming, 15) * 0.6 + 2, kind: "action", apply: () => (orders.action = { type: "shield", segments: seg }) });
    // torpédo: Pilot jen se zámkem, Eso i na předvídaný bod
    const tmod = torpedoModule(ship);
    if (tmod && !inStormNow) {
      const lock = enemies.filter((e) => dist(ship, e) <= torpedoLockRange(ship) && inArc(ship, e, Math.PI / 2));
      if (lock.length) {
        const t = lock.reduce((a, b) => (a.hull * shieldFactor(a, "kinetic") < b.hull * shieldFactor(b, "kinetic") ? a : b));
        opts.push({ value: TORPEDO.damage * 0.55 * shieldFactor(t, "kinetic"), kind: "special", apply: () => (orders.special = { type: "torpedo", targetId: t.id, moduleId: tmod.id }) });
      } else if (level === "eso" && enemies.length) {
        // bod, kam nepřítel asi doletí (nejpravděpodobnější odhad), musí být v doletu
        const e = enemies.reduce((a, b) => (dist(ship, a) < dist(ship, b) ? a : b));
        const g = guesses.get(e.id)?.[0]?.pose ?? e;
        if (dist(ship, g) <= torpedoPointRange(ship) && dist(ship, g) > torpedoLockRange(ship)) opts.push({ value: TORPEDO.blastDamage * 0.35, kind: "special", apply: () => (orders.special = { type: "torpedo", point: { x: Math.round(g.x), y: Math.round(g.y) }, moduleId: tmod.id }) });
      }
    }
    // mina: nepřítel těsně za zádí
    const mm = mineModule(ship);
    if (mm) {
      const behind = enemies.find((e) => dist(ship, e) < 160 && Math.abs(bearingTo(ship, e)) > (2 * Math.PI) / 3);
      if (behind) opts.push({ value: 14, kind: "special", apply: () => (orders.special = { type: "mine", timer: 1 }) });
    }
    // stanice: nabrat modul (v okruhu sběru, rychlost ≤ 2, místo v nákladu); objednat modul (funkční stanice v dohledu, kredity, místo)
    const cargoRoom = (ship.loadout.cargo ?? []).length < cargoCapacity(ship.loadout);
    const stn = stationInPickupRange(state, ship);
    if (stn && stn.stock > 0 && cargoRoom && chosen.man.speed <= CARGO.maxSpeed && !incoming) {
      opts.push({ value: 12, kind: "action", apply: () => (orders.action = { type: "pickup", targetId: stn.id }) });
    }
    const credits = state.players.find((p) => p.id === ship.ownerId)?.credits ?? 0;
    const stnOrder = (state.stations ?? []).find((x) => !x.broken && dist(ship, x) <= ship.stats.vision + x.radius && x.orderedTurn !== state.turn);
    if (stnOrder && cargoRoom && !incoming && level !== "kadet") {
      const allowed = state.settings.allowedModules ?? {};
      const wish = (["laser", "shield-whole", "torpedo", "mg"] as const).find((t) => allowed[t] !== 0 && MODULES[t].price <= credits);
      if (wish) opts.push({ value: 6, kind: "action", apply: () => (orders.action = { type: "comm", stationId: stnOrder.id, moduleType: wish }) });
    }
    opts.sort((a, b) => b.value - a.value);
    // manévr jiný než „rovně stejnou rychlostí“ stojí akci: vyplatí se jen, když je lepší než akce, o kterou tím přijdu
    const free = cands.find((c) => c.man.id === freeId);
    if (free && chosen.man.id !== free.man.id) {
      const withMove = RULES.actionPoints - actionCost(ship, orders);
      const dropped = opts[withMove]?.value ?? 0; // první akce, která se už nevejde
      if (dropped > chosen.score - free.score) {
        orders.maneuverId = free.man.id;
        if (overdrive) orders.droid = undefined;
      }
    }
    for (const op of opts) {
      if (left() < 1) break;
      if (op.kind === "action" && orders.action) continue;
      if (op.kind === "special" && orders.special) continue;
      op.apply();
    }
    // 3. Eso: skener a autopilot (nestojí akci)
    if (level === "eso" && !inStormNow) {
      if (droid && !overdrive && ship.techPoints >= DROID.autopilotCost && chosen.man.difficulty === "green" && ship.stressPoints < ship.stats.stressMax - 1) orders.droid = { autopilot: true };
    }
    out.push(orders);
  }
  return out;
}

/** Pro testy. */
export const _ai = { offenseAt, threatAt, shieldPlan, planShots, guessMoves };
