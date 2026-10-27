import { describe, expect, it } from "vitest";
import {
  applyLoadoutTrade,
  laserTarget,
  laserOdds,
  refreshShip,
  shieldTypeOf,
  normalizeShields,
  profileFor,
  profileOf,
  resolveManeuver,
  canAfford,
  DROID,
  laserReach,
  cometOnMap,
  COMET,
  ammoRefillCost,
  moduleSellPrice,
  settleLoadoutAfterBattle,
  MODULES,
  RULES,
  computeStats,
  moduleWorking,
  DEFAULT_TUNING,
  DEFAULT_LOADOUT,
  loadoutWeight,
  maxSpeedFor,
  moduleCost,
  validateLoadout,
  applyScan,
  botPredictActive,
  SCANNER,
  HULLS,
  hullLargePairs,
  laserRange,
  mgRange,
  torpedoLockRange,
  LASER,
  MG,
  fleetPoints,
  modulePos,
  applyShieldRecharge,
  applyRepair,
  applyHack,
  BATTLESHIP_PROFILE,
  damageStation,
  STATION,
  hackBlocked,
  HACK,
  repairBlocked,
  REPAIR,
  shieldRechargeBlocked,
  generateMap,
  DEFAULT_MAP,
  newModule,
  actionCost,
  defaultOrders,
  classifyManeuver,
  carveCrater,
  circleHitsAsteroid,
  createGame,
  insideMap,
  ellipseNorm,
  inStorm,
  parseManeuverId,
  effStressCost,
  maneuverStress,
  STRESS,
  sanitizeBattles,
  currentBattle,
  isSeries,
  battleResult,
  seriesStandings,
  seriesWinner,
  SERIES_MAX,
  type SeriesBattleResult,
  type ShipLoadout,
  type MapSettings,
  commanderOf,
  effectivePlacement,
  createRng,
  generateProfile,
  FIGHTER_PROFILE,
  listManeuvers,
  makeManeuver,
  maneuverEnd,
  MINE,
  MOVE_UNIT,
  planBot,
  resolveAttack,
  resolveTurn,
  resultForTeam,
  spawnComet,
  inCometTail,
  type Comet,
  sanitizeOrders,
  stateForTeam,
  TORPEDO,
  type Asteroid,
  type GameState,
  type TurnEvent,
  type PlayerInfo,
  type ShipOrders,
} from "../src/index.ts";

const ast = (id: string, x: number, y: number, radius: number): Asteroid => ({ id, x, y, radius, vx: 0, vy: 0, seed: 1, profile: Array(48).fill(radius), version: 0 });

const players: PlayerInfo[] = [
  { id: "p1", name: "Alfa", team: 0, isBot: false },
  { id: "p2", name: "Beta", team: 1, isBot: false },
];

/** Testy pravidel běží s vypnutým vlivem váhy (max. rychlost 5), váha má vlastní test. */
function game(overrides?: Partial<GameState>): GameState {
  const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
  g.asteroids = [];
  return { ...g, ...overrides };
}

function place(g: GameState, id: string, x: number, y: number, heading: number) {
  const s = g.ships.find((s) => s.id === id)!;
  s.x = x;
  s.y = y;
  s.heading = heading;
  return s;
}

const P = FIGHTER_PROFILE;
const man = (speed: number, angle: number, prev = 2, k = false) => makeManeuver(P, speed, angle, k, prev)!;

describe("manévry", () => {
  it("rovně 3 posune loď o 3 dílky ve směru kurzu", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, man(3, 0));
    expect(end.x).toBeCloseTo(3 * MOVE_UNIT);
    expect(end.y).toBeCloseTo(0);
    expect(end.heading).toBeCloseTo(0);
  });
  it("90° vpravo otočí o 90° a posune doprava-dolů", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, man(2, 90));
    expect(end.heading).toBeCloseTo(Math.PI / 2);
    expect(end.x).toBeGreaterThan(0);
    expect(end.y).toBeGreaterThan(0);
  });
  it("90° vlevo otočí o -90° a posune nahoru", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, man(2, -90));
    expect(end.heading).toBeCloseTo(-Math.PI / 2);
    expect(end.y).toBeLessThan(0);
  });
  it("otočka posune rovně a otočí o 180°", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, man(3, 0, 2, true));
    expect(end.x).toBeCloseTo(3 * MOVE_UNIT);
    expect(Math.abs(end.heading)).toBeCloseTo(Math.PI);
  });
  it("náročnost: mírný = zelený, ostrý = červený, změna rychlosti o 2 = červený, obojí = nebezpečný", () => {
    expect(classifyManeuver(P, 2, 10, false, 2)).toBe("green");
    expect(classifyManeuver(P, 3, 40, false, 2)).toBe("white");
    expect(classifyManeuver(P, 3, 90, false, 2)).toBe("red");
    expect(classifyManeuver(P, 4, 0, false, 2)).toBe("red");
    expect(classifyManeuver(P, 4, 40, false, 2)).toBe("danger");
    expect(classifyManeuver(P, 5, 60, false, 5)).toBeNull(); // nad limit úhlu
    expect(classifyManeuver(P, 3, 0, true, 3)).toBe("red");
    // otočka na červené křivce (změna rychlosti o 2, rovně) zůstává červená, stojí ale 2 stres
    expect(classifyManeuver(P, 3, 0, true, 1)).toBe("red");
    expect(maneuverStress(makeManeuver(P, 3, 0, true, 1)!)).toBe(STRESS.costRed + 1);
    expect(listManeuvers(P, 2).length).toBeGreaterThan(30);
  });
});

describe("kostky", () => {
  it("zranění je nikdy záporné a nejvýš počet útočných kostek", () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const o = resolveAttack(rng, { attackDice: 3, defenseDice: 3, attackerFocus: true, attackerLock: true, defenderFocus: false, defenderEvade: true });
      expect(o.damage).toBeGreaterThanOrEqual(0);
      expect(o.damage).toBeLessThanOrEqual(3);
    }
  });
});

describe("vyhodnocení kola", () => {
  it("lodě se pohnou, zapamatují si rychlost a kolo se zvýší", () => {
    const g = game();
    const orders: ShipOrders[] = g.ships.map((s) => ({ shipId: s.id, maneuverId: "m3a0", fire: false }));
    const r = resolveTurn(g, orders, createRng(1));
    expect(r.state.turn).toBe(2);
    const s = r.state.ships.find((x) => x.id === "ship-p1-0")!;
    expect(s.x).toBeCloseTo(150 + 3 * MOVE_UNIT);
    expect(s.speed).toBe(3);
    expect(r.events[0].type).toBe("move");
  });

  it("čelní srážka: obě lodě zastaví v místě dotyku (štítů), zraní a zruší akce; po kole rychlost 0", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 600, 500, Math.PI);
    const orders: ShipOrders[] = [
      { shipId: "ship-p1-0", maneuverId: "m3a0", fire: false, action: { type: "focus" } },
      { shipId: "ship-p2-0", maneuverId: "m3a0", fire: false, action: { type: "focus" } },
    ];
    const r = resolveTurn(g, orders, createRng(1));
    const a = r.state.ships[0];
    const b = r.state.ships[1];
    expect(r.events.filter((e) => e.type === "collision")).toHaveLength(2);
    // každá dostala 15 zranění do štítů
    expect(r.events.filter((e) => e.type === "damage" && e.amount === 15)).toHaveLength(2);
    // lodě zastavily v dotyku štítů (štít 16 + 14 na každé straně) a mají rychlost 0, kurz zůstal
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * (16 + 14) - 6);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2 * (16 + 14) + 12);
    expect(a.speed).toBe(0);
    expect(b.speed).toBe(0);
    expect(a.heading).toBeCloseTo(0, 5);
    // příští kolo imunita: lodě se vůči sobě nesrazí a rozjedou se (i skrz sebe)
    expect(a.collidedWith?.[b.id]).toBe(r.state.turn);
    const r2 = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r2.events.some((e) => e.type === "collision")).toBe(false);
    expect(r2.state.ships[0].speed).toBe(1);
    expect(r2.state.ships[0].collidedWith).toBeUndefined();
    expect(a.tokens.focus).toBe(0);
    expect(r.events.some((e) => e.type === "action" && e.ok === false)).toBe(true);
  });

  it("náraz do asteroidu: loď u něj zastaví (rychlost 0), zraní se a vykousne díru", () => {
    const g = game({ asteroids: [ast("a", 700, 500, 40)] });
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 900, 0);
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m4a0", fire: false }], createRng(1));
    const s = r.state.ships[0];
    const col = r.events.find((e) => e.type === "collision");
    expect(col && col.type === "collision" && col.with).toBe("asteroid");
    expect(s.x).toBeLessThan(700);
    expect(s.hull).toBe(100);
    expect(s.speed).toBe(0);
    expect(r.events.some((e) => e.type === "damage" && e.shipId === "ship-p1-0" && e.amount === 15)).toBe(true);
    // loď stojí: konec dráhy je na místě
    const move = r.events[0];
    const pts = move.type === "move" ? move.paths.find((p) => p.id === "ship-p1-0")!.points : [];
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    expect(Math.hypot(last.x - prev.x, last.y - prev.y)).toBeLessThan(1e-6);
  });

  it("bez okrajové bouře: hrana oválu odmrští loď zpět do mapy", () => {
    const g = game();
    g.border = undefined;
    place(g, "ship-p1-0", 60, g.height / 2, Math.PI);
    place(g, "ship-p2-0", 1500, 900, 0);
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(1));
    expect(insideMap(g, r.state.ships[0])).toBe(true);
    expect(r.events.some((e) => e.type === "collision" && e.with === "edge")).toBe(true);
    expect(Math.abs(r.state.ships[0].heading)).toBeLessThan(Math.PI / 2 + 0.8);
  });

  it("okrajová bouře: loď letí ven bez odrazu, bouře zraňuje podle části dráhy, tvrdý okraj loď zničí", () => {
    const g = game();
    g.border = 450;
    g.asteroids = [];
    place(g, "ship-p1-0", 100, g.height / 2, Math.PI); // 100 od středu levé hrany, letí ven
    place(g, "ship-p2-0", 1500, 900, 0);
    const hull = g.ships[0].hull;
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(1));
    const s = r.state.ships[0];
    expect(s.alive).toBe(true);
    expect(insideMap(g, s)).toBe(false); // je v pásu
    expect(r.events.some((e) => e.type === "collision")).toBe(false); // žádný odraz
    const bs = r.events.find((e) => e.type === "borderStorm");
    expect(bs && bs.type === "borderStorm" && bs.damage > 0 && bs.damage <= RULES.borderDamage).toBe(true);
    expect(s.hull).toBe(hull - (bs as { damage: number }).damage);
    expect(inStorm(r.state, s)).toBe(true); // v pásu platí pravidla bouře
    // dál ven: za tvrdý okraj (450 za hranou) = zničení
    const g2 = r.state;
    g2.ships[0].x = -400;
    g2.ships[0].speed = 3;
    r = resolveTurn(g2, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(2));
    expect(r.state.ships[0].alive).toBe(false);
    expect(r.events.some((e) => e.type === "destroyed" && e.shipId === "ship-p1-0")).toBe(true);
  });

  it("laser zasáhne cíl ve výseči a v dostřelu, cíl mimo výseč ne", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, 0);
    const orders: ShipOrders[] = [
      { shipId: "ship-p1-0", maneuverId: "m2a0", fire: true },
      { shipId: "ship-p2-0", maneuverId: "m1a0", fire: true },
    ];
    const r = resolveTurn(g, orders, createRng(7));
    const lasers = r.events.filter((e) => e.type === "laser");
    expect(lasers).toHaveLength(1);
    expect(lasers[0].type === "laser" && lasers[0].shooterId).toBe("ship-p1-0");
  });

  it("stresové body: červený −1 (akce zůstává), nebezpečný −2 a 5 % trupu, zelený +1, bez bodů nejde červený", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 900, 0);
    expect(g.ships[0].stressPoints).toBe(3);
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "k3", fire: false }], createRng(1));
    expect(r.state.ships[0].stressPoints).toBe(2);
    expect(r.state.ships[0].speed).toBe(1); // po otočce −2
    // z rychlosti 1 na 4 (změna o 3, ostrý úhel) = nebezpečný: −2 body + 5 % trupu
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m4a40", fire: false }], createRng(1));
    expect(r.state.ships[0].stressPoints).toBe(0);
    expect(r.events.some((e) => e.type === "damage" && e.shipId === "ship-p1-0" && e.amount === 5)).toBe(true);
    // bez bodů: červený manévr sanitizace nahradí
    const fixed = sanitizeOrders(r.state, "p1", [{ shipId: "ship-p1-0", maneuverId: "m5a40", fire: true }]);
    expect(fixed[0].maneuverId).not.toBe("m5a40");
    // zelený manévr vrátí bod
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m4a0", fire: false }], createRng(1)); // bílý
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(1)); // zelený
    expect(r.state.ships[0].stressPoints).toBe(1);
  });

  it("fázové torpédo: startuje s pohybem, vyletí → zaměří → zrychlí a zasáhne cíl do dvou kol", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 800, 500, Math.PI);
    let r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "m1a-45", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } },
        { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false },
      ],
      createRng(1),
    );
    expect(r.events[0].type).toBe("spawnTorpedo");
    expect(r.events[1].type).toBe("move");
    expect(r.state.ships[0].ammo.torpedoes).toBe(2);
    // po prvním kole je torpédo ve fázi letu, ale ještě nemá plnou rychlost a cíl nezasáhlo
    expect(r.state.torpedoes).toHaveLength(1);
    expect(r.state.torpedoes[0].phase).toBe("cruise");
    expect(r.state.torpedoes[0].speed).toBeGreaterThan(120);
    expect(r.state.torpedoes[0].speed).toBeLessThan(240);
    r = resolveTurn(
      r.state,
      [
        { shipId: "ship-p1-0", maneuverId: "m1a0", fire: false },
        { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false },
      ],
      createRng(2),
    );
    const hit = r.events.find((e) => e.type === "torpedoHit");
    expect(hit && hit.type === "torpedoHit" && hit.shipId).toBe("ship-p2-0");
    expect(r.state.torpedoes).toHaveLength(0);
    // segmentový štít: přední segment pohltí celý zásah (2 → 1), trup beze změny
    expect(r.state.ships[1].hull).toBe(100);
    expect(r.state.ships[1].segments[0]).toBe(1);
  });

  it("segmentový štít: zásah podle směru, po vyčerpání segmentu jde vše do trupu", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, 0); // p2 míří pryč, p1 ji střílí do zádi
    g.ships[1].stats.agility = 0; // ať se trefí spolehlivě
    g.ships[0].stats.attack = 4;
    let seed = 1;
    const fire = (st: GameState) =>
      resolveTurn(st, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m2a0", fire: false }], createRng(seed++));
    let r = fire(g);
    let hits = 0;
    for (let i = 0; i < 12 && r.state.ships[1].alive; i++) {
      const dmg = r.events.find((e) => e.type === "damage" && e.shipId === "ship-p2-0");
      if (dmg && dmg.type === "damage") {
        hits++;
        expect(dmg.segment).toBe(2); // záď
        // laser (energetický) segmenty proniká: 1 bod segmentu, segmentPassPct % zranění do trupu
        if ((dmg.absorbed ?? 0) > 0) {
          expect(dmg.kind).toBe("energy");
          expect(dmg.pierced).toBe(Math.round((dmg.amount * RULES.segmentPassPct) / 100));
          expect(dmg.absorbed).toBe(dmg.amount - dmg.pierced!);
        }
      }
      r = fire(r.state);
    }
    const b = r.state.ships[1];
    expect(b.segments[2]).toBe(0);
    expect(b.segments[0]).toBe(2); // ostatní segmenty nedotčené
    expect(b.hull).toBeLessThan(100);
  });

  it("celolodní štít pohltí účinnost % a účinnost klesá; úprava štítu přerozdělí segmenty", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, 0);
    g.ships[1].shieldType = "whole";
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m2a0", fire: false }], createRng(3));
    const dmg = r.events.find((e) => e.type === "damage" && e.shipId === "ship-p2-0");
    if (dmg && dmg.type === "damage") {
      expect(dmg.absorbed ?? 0).toBe(dmg.amount); // plná účinnost 100 %
      expect(dmg.effAfter).toBe(90);
      expect(dmg.shieldsAfter).toBe(50 - dmg.amount);
    }
    // úprava štítu u p1: záď → předek
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: false, action: { type: "shield", segments: [3, 2, 1, 2] } }], createRng(1));
    expect(r.state.ships[0].segments).toEqual([3, 2, 1, 2]);
    // neplatné rozložení (součet) sanitizace zahodí
    const fixed = sanitizeOrders(r.state, "p1", [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: false, action: { type: "shield", segments: [3, 3, 3, 3] } }]);
    expect(fixed[0].action).toBeUndefined();
  });

  it("akce: 2 na kolo – úprava pohybu, otočka, lasery, torpédo, mina; sanitizace přebytek ořeže", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 800, 500, Math.PI);
    const ship = g.ships[0];
    expect(actionCost(ship, { shipId: ship.id, maneuverId: "m2a0", fire: false })).toBe(0);
    expect(actionCost(ship, { shipId: ship.id, maneuverId: "m3a0", fire: false })).toBe(1);
    expect(actionCost(ship, { shipId: ship.id, maneuverId: "m2a10", fire: true })).toBe(2);
    expect(actionCost(ship, { shipId: ship.id, maneuverId: "k3", fire: false })).toBe(2); // změna rychlosti + otočka
    const fixed = sanitizeOrders(g, "p1", [{ shipId: ship.id, maneuverId: "m3a30", fire: true, special: { type: "torpedo", targetId: "ship-p2-0" } }]);
    expect(actionCost(ship, fixed[0])).toBe(2);
    expect(fixed[0].special).toBeUndefined();
    expect(fixed[0].fire).toBe(true);
    // bez akce "lasery" loď nestřílí
    const r = resolveTurn(g, [{ shipId: ship.id, maneuverId: "m2a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m2a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "laser")).toBe(false);
  });

  it("laser nestřílí skrz asteroid", () => {
    const g = game({ asteroids: [ast("a", 700, 500, 40)] });
    place(g, "ship-p1-0", 550, 500, 0);
    place(g, "ship-p2-0", 850, 500, 0);
    const r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "m1a0", fire: true },
        { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false },
      ],
      createRng(1),
    );
    expect(r.events.some((e) => e.type === "laser")).toBe(false);
    expect(r.events.some((e) => e.type === "collision")).toBe(false);
  });

  it("fog of war: nepřátelská loď mimo dohled není ve stavu, asteroid zůstává v paměti tak, jak byl viděn", () => {
    const g = game({ asteroids: [ast("far", 2200, 1400, 40), ast("near", 700, 500, 40)] });
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 2000, 1400, Math.PI);
    const memory = new Map();
    const seen = stateForTeam(g, 0, memory);
    expect(seen.ships.map((s) => s.id)).toEqual(["ship-p1-0"]);
    expect(seen.asteroids.map((a) => a.id)).toEqual(["near"]);
    // p2 vybuchne torpédo u "near", p1 to vidí → paměť se aktualizuje
    const r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "m1a0", fire: false },
        { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false },
      ],
      createRng(1),
    );
    // ručně vykousneme kráter do stavu a předstíráme, že to tým 0 neviděl (loď daleko)
    const r2 = { ...r, state: structuredClone(r.state) };
    const far = r2.state.asteroids.find((a) => a.id === "near")!;
    far.profile = far.profile.map((x) => x * 0.5);
    far.version++;
    place(r2.state, "ship-p1-0", 2300, 100, 0);
    const seen2 = resultForTeam(r2, g, 0, memory);
    const remembered = seen2.state.asteroids.find((a) => a.id === "near")!;
    expect(remembered.profile[0]).toBe(40); // stará podoba
  });

  it("torpédo vystřelené na bod tam vybuchne, zraní lodě v okolí a vykousne kráter do asteroidu", () => {
    const g = game({ asteroids: [ast("a", 1000, 560, 40)] });
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1040, 440, Math.PI); // bude u bodu výbuchu, mimo dráhu torpéda i asteroid
    let r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "m1a0", fire: false, special: { type: "torpedo", point: { x: 1000, y: 500 } } },
        { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false },
      ],
      createRng(1),
    );
    const before = [...g.asteroids[0].profile];
    let blast = r.events.find((e) => e.type === "torpedoHit" && e.blast);
    for (let i = 0; i < 4 && !blast; i++) {
      r = resolveTurn(
        r.state,
        [
          { shipId: "ship-p1-0", maneuverId: "m1a0", fire: false },
          { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false },
        ],
        createRng(1),
      );
      blast = r.events.find((e) => e.type === "torpedoHit" && e.blast);
    }
    expect(blast).toBeTruthy();
    expect(blast!.type === "torpedoHit" && Math.hypot(blast!.x - 1000, blast!.y - 500)).toBeLessThan(20);
    expect(r.state.torpedoes).toHaveLength(0);
    const hit = r.events.find((e) => e.type === "asteroidHit");
    expect(hit).toBeTruthy();
    const after = r.state.asteroids[0].profile;
    expect(Math.min(...after)).toBeLessThan(Math.min(...before));
    // loď p2 blízko bodu dostala plošné zranění 30
    expect(r.events.some((e) => e.type === "damage" && e.shipId === "ship-p2-0" && e.amount === 30)).toBe(true);
  });

  it("kráter: výbuch vykousne tvar a loď skrz díru proletí; dost výbuchů asteroid zničí", () => {
    const a = ast("a", 500, 500, 40);
    a.profile = generateProfile(40, 1);
    expect(circleHitsAsteroid(a, { x: 540, y: 500 }, 16)).toBe(true);
    carveCrater(a, { x: 550, y: 500 }, 45);
    expect(a.version).toBe(1);
    expect(circleHitsAsteroid(a, { x: 540, y: 500 }, 8)).toBe(false);
    expect(circleHitsAsteroid(a, { x: 470, y: 500 }, 8)).toBe(true);
    carveCrater(a, { x: 500, y: 500 }, 45);
    expect(Math.max(...a.profile)).toBeLessThan(10);
  });

  it("torpédo lze sestřelit ručně zaměřeným laserem", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 900, 500, Math.PI);
    let r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "m1a0", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } },
        { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false },
      ],
      createRng(1),
    );
    expect(r.state.torpedoes).toHaveLength(1);
    const torpId = r.state.torpedoes[0].id;
    // p2 stojí proti torpédu; torpédo po dalším pohybu bude před ní – zaměří ho
    let shot = false;
    for (let seed = 1; seed < 40 && !shot; seed++) {
      const r2 = resolveTurn(
        r.state,
        [
          { shipId: "ship-p1-0", maneuverId: "m1a0", fire: false },
          { shipId: "ship-p2-0", maneuverId: "m1a0", fire: true, preferredTargetId: torpId },
        ],
        createRng(seed),
      );
      const ev = r2.events.find((e) => e.type === "torpedoShot");
      expect(ev).toBeTruthy();
      if (ev && ev.type === "torpedoShot" && ev.destroyed) {
        shot = true;
        expect(r2.state.torpedoes).toHaveLength(0);
      }
    }
    expect(shot).toBe(true);
  });

  it("torpédo bez cíle vyprší po životnosti", () => {
    const g = game();
    place(g, "ship-p1-0", 100, 100, 0);
    place(g, "ship-p2-0", 400, 100, 0);
    let r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "m1a0", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } },
        { shipId: "ship-p2-0", maneuverId: "m3a0", fire: false },
      ],
      createRng(1),
    );
    let turns = 0;
    while (r.state.torpedoes.length && turns < 10) {
      r = resolveTurn(
        r.state,
        r.state.ships.filter((s) => s.alive).map((s) => ({ shipId: s.id, maneuverId: `m${Math.min(5, s.speed + 1)}a0`, fire: false })),
        createRng(1),
      );
      turns++;
    }
    expect(turns).toBeLessThanOrEqual(TORPEDO.lifeTurns);
    expect(r.state.torpedoes).toHaveLength(0);
  });

  it("mina se položí na startovní pozici, aktivuje se další kolo a spustí ji i torpédo", () => {
    const g = createGame({ players: [...players, { id: "p3", name: "Gama", team: 0, isBot: false }], settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" } });
    g.asteroids = [];
    place(g, "ship-p1-0", 500, 500, -Math.PI / 2);
    place(g, "ship-p2-0", 900, 500, Math.PI);
    place(g, "ship-p3-0", 200, 500, 0);
    const go = (r: GameState, extra: Partial<ShipOrders>[] = []) =>
      resolveTurn(
        r,
        [
          { shipId: "ship-p1-0", maneuverId: "m2a0", fire: false, ...extra[0] },
          { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false, ...extra[1] },
          { shipId: "ship-p3-0", maneuverId: "m1a0", fire: false },
        ],
        createRng(1),
      );
    let r = go(g, [{ special: { type: "mine" } }, { special: { type: "torpedo", targetId: "ship-p3-0" } }]);
    expect(r.state.mines).toHaveLength(1);
    expect(r.state.mines[0].x).toBeCloseTo(500);
    expect(r.state.mines[0].armed).toBe(true);
    expect(r.state.ships[0].ammo.mines).toBe(1);
    expect(r.state.torpedoes).toHaveLength(1);
    // torpédo letí po y=500 doleva na p3 a v dalším kole proletí minou na x=500
    r = go(r.state);
    const blast = r.events.find((e) => e.type === "mineBlast");
    expect(blast).toBeTruthy();
    expect(r.state.mines).toHaveLength(0);
    expect(r.state.torpedoes).toHaveLength(0);
  });

  it("mina zraní vlastní loď při návratu do pole", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, Math.PI);
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false, special: { type: "mine" } }], createRng(1));
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "k3", fire: false }], createRng(1));
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(1));
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(1));
    const blast = r.events.find((e) => e.type === "mineBlast");
    expect(blast && blast.type === "mineBlast" && blast.hits.some((h) => h.shipId === "ship-p1-0" && h.damage === MINE.damage)).toBe(true);
  });

  it("mina s nepřítelem v poli na začátku kola vybuchne hned (t = 0)", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, Math.PI);
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: false, special: { type: "mine" } }], createRng(1));
    const mine = r.state.mines[0];
    // nepřítel se objeví v poli miny (teleport pro test)
    place(r.state, "ship-p2-0", mine.x + 30, mine.y, 0);
    r = resolveTurn(r.state, [{ shipId: "ship-p2-0", maneuverId: "m2a0", fire: false }], createRng(1));
    const blast = r.events.find((e) => e.type === "mineBlast");
    expect(blast && blast.type === "mineBlast" && blast.t).toBe(0);
    expect(r.state.mines).toHaveLength(0);
  });

  it("časovaná mina nereaguje na vstup a vybuchne po odpočtu", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, Math.PI);
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: false, special: { type: "mine", timer: 2 } }], createRng(1));
    expect(r.state.mines[0].timer).toBe(2);
    // p1 se otočí a vletí do pole – časovaná mina nereaguje
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "k3", fire: false }], createRng(1)); // kolo 2: odpočet 2→1
    expect(r.state.mines).toHaveLength(1);
    expect(r.state.mines[0].timer).toBe(1);
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(1)); // kolo 3: 1→0 → výbuch
    expect(r.state.mines).toHaveLength(0);
    expect(r.events.some((e) => e.type === "mineBlast")).toBe(true);
  });

  it("otočka sníží rychlost o 2", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, Math.PI);
    g.ships[0].speed = 4;
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "k4", fire: false }], createRng(1));
    expect(r.state.ships[0].speed).toBe(2);
    expect(r.state.ships[0].stressPoints).toBe(2); // jen červený manévr
  });

  it("úhybný manévr: prolet skrz nepřítele bez srážky, stres oběma, poloviční zranění torpédem", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 600, 500, Math.PI); // čelně, 100 od sebe
    const r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "m4a0", fire: false, action: { type: "evade" } },
        { shipId: "ship-p2-0", maneuverId: "m3a10", fire: false, special: { type: "torpedo", targetId: "ship-p1-0" } },
      ],
      createRng(1),
    );
    expect(r.events.some((e) => e.type === "collision")).toBe(false);
    const a = r.state.ships[0];
    const b = r.state.ships[1];
    expect(a.x).toBeGreaterThan(b.x); // proletěl skrz
    expect(a.stressPoints).toBe(1); // 3 − 1 úhyb − 1 (4 z 2 = červený)
    expect(b.stressPoints).toBe(2); // proletěli skrz něj
    // torpédo z p2 zasáhlo p1 (letí proti němu) jen za polovinu
    const hit = r.events.find((e) => e.type === "torpedoHit" && e.shipId === "ship-p1-0");
    if (hit) expect(r.events.some((e) => e.type === "damage" && e.shipId === "ship-p1-0" && e.amount === 23)).toBe(true);
  });

  it("bitva mezi boty skončí", () => {
    const bots: PlayerInfo[] = [
      { id: "b1", name: "Bot 1", team: 0, isBot: true },
      { id: "b2", name: "Bot 2", team: 1, isBot: true },
      { id: "b3", name: "Bot 3", team: 2, isBot: true },
    ];
    let g = createGame({ players: bots, settings: { mode: "tdm", turnLimit: 40, shipPoints: 2, allowedModules: {}, botLoadout: "default" } });
    const rng = createRng(42);
    let turns = 0;
    while (g.status !== "finished" && turns < 100) {
      const orders = bots.flatMap((b) => planBot(g, b.id, rng));
      const sanitized = bots.flatMap((b) => sanitizeOrders(g, b.id, orders));
      g = resolveTurn(g, sanitized, rng).state;
      turns++;
    }
    expect(g.status).toBe("finished");
    expect(turns).toBeLessThanOrEqual(40);
  });

  it("deathmatch přiřadí každému hráči vlastní tým a vrací vítěze", () => {
    const g = createGame({ players: [...players, { id: "p3", name: "Gama", team: 0, isBot: false }], settings: { mode: "dm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" } });
    expect(new Set(g.ships.map((s) => s.team)).size).toBe(3);
    for (const s of g.ships) if (s.ownerId !== "p3") s.alive = false;
    const r = resolveTurn(g, [], createRng(1));
    expect(r.state.status).toBe("finished");
    expect(r.state.result?.winnerPlayerId).toBe("p3");
  });
});

describe("inventář a ekonomika", () => {
  it("váha modulů snižuje max. rychlost; vystřelené torpédo loď odlehčí", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" } });
    g.asteroids = [];
    const ship = g.ships[0];
    expect(loadoutWeight(ship.loadout)).toBe(10); // lasery 2 + torpédomet 1+3 + miny 1+1 + štít 2
    expect(maxSpeedFor(ship.loadout)).toBe(4);
    const empty = { ...DEFAULT_LOADOUT, modules: [] };
    expect(maxSpeedFor(empty)).toBe(5);
    const fixed = sanitizeOrders(g, "p1", [{ shipId: ship.id, maneuverId: "m5a0", fire: false }]);
    expect(fixed[0].maneuverId).not.toBe("m5a0");
    place(g, "ship-p2-0", 1500, 1200, Math.PI);
    const r = resolveTurn(g, [{ shipId: ship.id, maneuverId: "m2a0", fire: false, special: { type: "torpedo", point: { x: 900, y: 500 } } }], createRng(1));
    expect(r.state.ships[0].ammo.torpedoes).toBe(2);
    expect(loadoutWeight(r.state.ships[0].loadout)).toBe(9);
  });

  it("validace sestavy: kapacita slotů, míchání štítů, limity a rozpočet", () => {
    expect(validateLoadout(DEFAULT_LOADOUT)).toBeNull();
    const full = { ...DEFAULT_LOADOUT, modules: [...DEFAULT_LOADOUT.modules, { id: "x", type: "laser" as const, slot: "front" as const, facing: "front" as const }] };
    expect(validateLoadout(full)).toMatch(/obsazený/);
    const mixed = { ...DEFAULT_LOADOUT, modules: [...DEFAULT_LOADOUT.modules.filter((m) => m.type !== "mine"), { id: "x", type: "shield-whole" as const, slot: "back" as const }] };
    // míchání štítů je nově dovolené – funguje jen jeden (zapnutý), druhý je záloha
    expect(validateLoadout(mixed)).toBeNull();
    const norm = normalizeShields(mixed);
    const shields = norm.modules.filter((m) => m.type === "shield-segment" || m.type === "shield-whole");
    expect(shields.filter((m) => !m.off).length).toBe(1);
    expect(shieldTypeOf(norm)).toBe("segment"); // první funkční zůstává zapnutý
    // přepnutí: segmentový vypnout → zapne se celolodní
    const sw = normalizeShields({ ...norm, modules: norm.modules.map((m) => (m.type === "shield-segment" ? { ...m, off: true } : { ...m, off: undefined })) });
    expect(shieldTypeOf(sw)).toBe("whole");
    expect(computeStats(sw).segmentModules).toBe(0);
    expect(computeStats(sw).shields).toBeGreaterThan(0);
    expect(validateLoadout(DEFAULT_LOADOUT, { allowed: { torpedo: 0 } })).toMatch(/zakázán/);
    expect(moduleCost(DEFAULT_LOADOUT)).toBe(470);
    expect(validateLoadout(DEFAULT_LOADOUT, { budget: 400 })).toMatch(/rozpočet/);
  });

  it("vyhození modulu: loď odlehčí, trosky lze sestřelit za kredity; sestřel lodi a přežití dávají kredity", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" } });
    g.asteroids = [];
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, Math.PI);
    const mineMod = g.ships[0].loadout.modules.find((m) => m.type === "mine")!;
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: false, action: { type: "jettison", moduleIds: [mineMod.id] } }], createRng(1));
    expect(r.state.ships[0].loadout.modules.some((m) => m.type === "mine")).toBe(false);
    expect(r.state.ships[0].ammo.mines).toBe(0);
    expect(r.state.debris).toHaveLength(1);
    const deb = r.state.debris[0];
    expect(deb.value).toBe(50);
    // p2 otočená na trosky (jsou u startovní pozice p1) je sestřelí – zkoušíme seedy
    const p2 = r.state.ships[1];
    place(r.state, "ship-p2-0", deb.x + 120, deb.y, Math.PI);
    const before = r.state.players[1].credits!;
    let shot = false;
    for (let seed = 1; seed < 30 && !shot; seed++) {
      const r2 = resolveTurn(r.state, [{ shipId: p2.id, maneuverId: "m2a0", fire: true, preferredTargetId: deb.id }], createRng(seed));
      const ev = r2.events.find((e) => e.type === "debrisShot");
      expect(ev).toBeTruthy();
      if (ev && ev.type === "debrisShot" && ev.destroyed) {
        shot = true;
        expect(r2.state.debris).toHaveLength(0);
        expect(r2.state.players[1].credits).toBe(before + 50 + DEFAULT_TUNING.creditsPerTurn);
      }
    }
    expect(shot).toBe(true);
    // přežité kolo = kredity oběma
    expect(r.state.players[0].credits).toBe(DEFAULT_TUNING.startBudget - 470 + DEFAULT_TUNING.creditsPerTurn);
  });
});

describe("ochranná lhůta torpéda", () => {
  it("vlastní torpédo nemůže 2 kola zranit vlastníka, i když ho loď dožene", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" } });
    g.asteroids = [];
    place(g, "ship-p1-0", 300, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, Math.PI);
    // loď letí rychlostí 4 (180) rovně za pomalým torpédem (výlet 120/kolo) na bod daleko před ní
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m4a0", fire: false, special: { type: "torpedo", point: { x: 1400, y: 500 } } }], createRng(1));
    expect(r.state.torpedoes).toHaveLength(1);
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m4a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "torpedoHit")).toBe(false);
    expect(r.state.ships[0].hull).toBe(100);
    expect(r.state.torpedoes).toHaveLength(1);
  });
});

describe("natočení modulů", () => {
  it("lasery střílí jen ve výseči podle natočení; miny jen na svou stranu; torpédo vylétá směrem modulu", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const me = g.ships[0];
    const laser = me.loadout.modules.find((m) => m.type === "laser")!;
    laser.facing = "right"; // lasery otočené doprava (na levoboku je to povolené)
    me.stats.agility = 0;
    g.ships[1].stats.agility = 0;
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, Math.PI); // nepřítel přímo před přídí → mimo pravou výseč
    let r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: true }], createRng(1));
    expect(r.events.some((e) => e.type === "laser")).toBe(false);
    place(g, "ship-p2-0", 500, 700, 0); // nepřítel vpravo (y+) → ve výseči
    r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: true }], createRng(1));
    expect(r.events.some((e) => e.type === "laser")).toBe(true);
    // natočení "do středu" je neplatné, miny na příď také
    expect(validateLoadout({ ...DEFAULT_LOADOUT, modules: [{ id: "a", type: "laser", slot: "left", facing: "right" }] })).toMatch(/natočení/);
    expect(validateLoadout({ ...DEFAULT_LOADOUT, modules: [{ id: "a", type: "mine", slot: "front", facing: "back" }] })).toMatch(/příď/);
    // mina: strana se řídí natočením modulu (záď → za sebe), požadavek "vlevo" se ignoruje
    const fixed = sanitizeOrders(g, "p1", [{ shipId: me.id, maneuverId: "m1a0", fire: false, special: { type: "mine", side: "left" } }]);
    expect(fixed[0].special).toEqual({ type: "mine", timer: undefined, side: "behind" });
    // torpédomet otočený dozadu: torpédo vyletí za loď
    const torp = me.loadout.modules.find((m) => m.type === "torpedo")!;
    torp.facing = "back";
    place(g, "ship-p2-0", 1500, 1200, 0);
    r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: false, special: { type: "torpedo", point: { x: 100, y: 500 } } }], createRng(1));
    expect(r.state.torpedoes[0].x).toBeLessThan(500);
  });
});

describe("štíty × druh zbraně a dobití technologií", () => {
  it("energetický štít: laser jen vybíjí (nic do trupu), torpédo prorazí wholePiercePct % i přes plný štít", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, 0);
    const t = g.ships[1];
    t.shieldType = "whole";
    t.shields = 80;
    t.stats.shields = 80;
    t.stats.agility = 0;
    g.ships[0].stats.attack = 4;
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m2a0", fire: false }], createRng(3));
    const dmg = r.events.find((e) => e.type === "damage" && e.shipId === "ship-p2-0");
    expect(dmg && dmg.type === "damage" && dmg.kind === "energy" && dmg.absorbed === dmg.amount && !dmg.pierced).toBe(true);
    expect(r.state.ships[1].hull).toBe(100);
    // torpédo: přímý zásah 45 → 30 % (14) do trupu i při plné zásobě, zbytek do štítu
    const g2 = game();
    place(g2, "ship-p1-0", 500, 500, 0);
    place(g2, "ship-p2-0", 900, 500, 0);
    const t2 = g2.ships[1];
    t2.shieldType = "whole";
    t2.shields = 80;
    t2.stats.shields = 80;
    let r2 = resolveTurn(g2, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(2));
    for (let i = 0; i < 4 && !r2.events.some((e) => e.type === "torpedoHit"); i++) r2 = resolveTurn(r2.state, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(10 + i));
    const td = r2.events.find((e) => e.type === "damage" && e.shipId === "ship-p2-0");
    expect(td && td.type === "damage").toBe(true);
    if (td && td.type === "damage") {
      const pierce = Math.round((td.amount * RULES.wholePiercePct) / 100);
      expect(td.kind).toBe("kinetic");
      expect(td.pierced).toBe(pierce);
      expect(td.hullAfter).toBe(100 - pierce);
      expect(td.absorbed).toBe(td.amount - pierce);
    }
  });

  it("segmentový štít: torpédo zachytí celé za 1 bod; laser ubere 1 bod a segmentPassPct % projde do trupu", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 900, 500, 0);
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(2));
    for (let i = 0; i < 4 && !r.events.some((e) => e.type === "torpedoHit"); i++) r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(10 + i));
    const td = r.events.find((e) => e.type === "damage" && e.shipId === "ship-p2-0");
    expect(td && td.type === "damage" && td.kind === "kinetic" && td.absorbed === td.amount && !td.pierced).toBe(true);
    expect(r.state.ships[1].hull).toBe(100);
    expect(r.state.ships[1].segments.reduce((a, b) => a + b, 0)).toBe(7); // jeden bod pryč
    // laser
    const g2 = game();
    place(g2, "ship-p1-0", 500, 500, 0);
    place(g2, "ship-p2-0", 700, 500, 0);
    g2.ships[1].stats.agility = 0;
    g2.ships[0].stats.attack = 4;
    const r2 = resolveTurn(g2, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m2a0", fire: false }], createRng(3));
    const ld = r2.events.find((e) => e.type === "damage" && e.shipId === "ship-p2-0");
    expect(ld && ld.type === "damage").toBe(true);
    if (ld && ld.type === "damage") {
      const pierce = Math.round((ld.amount * RULES.segmentPassPct) / 100);
      expect(ld.kind).toBe("energy");
      expect(ld.pierced).toBe(pierce);
      expect(ld.hullAfter).toBe(100 - pierce);
      expect(ld.segmentsAfter![2]).toBe(1);
    }
  });

  it("dobití štítu technologií: stojí body, 1× za kolo, nad maximum ne; segmentový podle zadání, energetický +zásoba", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    me.techPoints = 6;
    expect(shieldRechargeBlocked(g, me)).toBe("štít je plný");
    me.segments = [0, 1, 2, 2];
    let res = applyShieldRecharge(g, me, [2, 0, 0, 0]);
    expect(res.error).toBeUndefined();
    expect(me.segments).toEqual([2, 1, 2, 2]);
    expect(me.techPoints).toBe(6 - RULES.rechargeTechCost);
    expect(res.event && res.event.type === "shieldRecharge" && res.event.segments).toEqual([2, 0, 0, 0]);
    // podruhé v tom samém kole ne
    expect(applyShieldRecharge(g, me, [0, 1, 0, 0]).error).toMatch(/v tomto kole/);
    g.turn++;
    // přes strop segmentu: zbytek jde nejslabšímu; bez zadání nejslabším
    me.segments = [2, 0, 2, 1];
    res = applyShieldRecharge(g, me, [5, 0, 0, 0]);
    expect(res.error).toBeUndefined();
    expect(me.segments).toEqual([2, 2, 2, 1]);
    expect(me.techPoints).toBe(0);
    g.turn++;
    expect(applyShieldRecharge(g, me).error).toMatch(/technologie/);
    // energetický
    const w = g.ships[1];
    w.shieldType = "whole";
    w.stats.shields = 80;
    w.shields = 60;
    w.techPoints = 3;
    res = applyShieldRecharge(g, w);
    expect(res.error).toBeUndefined();
    expect(w.shields).toBe(80); // +40, ale strop 80
    expect(res.event && res.event.type === "shieldRecharge" && res.event.amount).toBe(20);
    expect(w.techPoints).toBe(0);
  });
});

describe("bitevník", () => {
  it("šest slotů včetně gondol, 2 lodní body, max. rychlost 4, moduly dál od středu", () => {
    const lo = { hullId: "battleship", pilotId: "kadet", modules: [newModule("laser", "front", "a"), newModule("torpedo", "podLeft", "b"), newModule("mg", "podRight", "c"), newModule("shield-whole", "back", "d")] };
    expect(validateLoadout(lo, { allowed: {} })).toBeNull();
    expect(fleetPoints([lo])).toBe(2);
    expect(HULLS.battleship.slots.map((s) => s.id)).toEqual(["front", "back", "podLeft", "left", "podRight", "right"]);
    expect(computeStats(lo).techMax).toBe(10);
    expect(computeStats(DEFAULT_LOADOUT).techMax).toBe(DEFAULT_TUNING.techMax);
    expect(listManeuvers(profileOf(lo), 2).every((m) => m.speed <= 4)).toBe(true);
    expect(listManeuvers(profileOf(lo), 2).some((m) => m.koiogran && m.speed === 3)).toBe(true);
    expect(listManeuvers(profileOf(lo), 2).some((m) => m.koiogran && m.speed === 4)).toBe(false);
    // přední levobok: modul je vlevo, zadní levobok ještě víc vzadu
    const ship = { x: 0, y: 0, heading: 0, loadout: lo };
    const pos = modulePos(ship, lo.modules[1]);
    expect(pos.y).toBeLessThan(-30);
    expect(modulePos(ship, { slot: "left" }).x).toBeLessThan(pos.x);
    // pásmo dostřelu podle zasažené plochy: příď bitevníku v pásmu 1 (střed až v pásmu 2) → bonus zblízka
    const gB = game();
    const shooter = place(gB, "ship-p1-0", 500, 500, 0);
    const big = place(gB, "ship-p2-0", 600, 500, Math.PI); // střed ~104 od laseru (pásmo 2), přední část trupu do 100 (pásmo 1)
    big.loadout = { ...big.loadout, hullId: "battleship" };
    big.stats = computeStats(big.loadout);
    const o1 = laserOdds(shooter, big);
    expect(Math.ceil(104 / LASER.band)).toBe(2);
    expect(o1.rangeBand).toBe(1);
    // startovní rozestupy podle velikosti: bitevník a stíhač v jedné letce se nepřekrývají
    const g2 = createGame({ players: [{ id: "A", name: "A", team: 0, isBot: true, loadouts: [structuredClone(DEFAULT_LOADOUT), { hullId: "battleship", pilotId: "kadet", modules: [] }] }, { id: "B", name: "B", team: 1, isBot: true, loadouts: [structuredClone(DEFAULT_LOADOUT)] }], settings: { mode: "tdm", turnLimit: 40, shipPoints: 3, allowedModules: {}, botLoadout: "default", map: { ...DEFAULT_MAP, size: "small", seed: 5 } }, tuning: DEFAULT_TUNING });
    const [s1, s2] = g2.ships.filter((s) => s.ownerId === "A");
    expect(Math.hypot(s1.x - s2.x, s1.y - s2.y)).toBeGreaterThanOrEqual(s1.stats.radius + s2.stats.radius + 30);
    // delší dostřel o 25 % (lasery, kulomet, torpéda) a obratnější profil
    expect(laserRange({ loadout: lo })).toBe(Math.round(LASER.range * 1.25));
    expect(mgRange({ loadout: lo })).toBe(Math.round(MG.range * 1.25));
    expect(torpedoLockRange({ loadout: lo })).toBe(Math.round(TORPEDO.lockRange * 1.25));
    expect(laserRange({ loadout: { hullId: "fighter" } })).toBe(LASER.range);
    expect(HULLS.battleship.profile.maxAngle[3]).toBeGreaterThanOrEqual(80);
    // velký modul jde i do spojeného levoboku; na stíhači jen příď + záď
    expect(hullLargePairs(HULLS.battleship).length).toBe(3);
    expect(hullLargePairs(HULLS.fighter)).toEqual([["front", "back"]]);
    // stíhač nemá gondoly
    expect(validateLoadout({ hullId: "fighter", pilotId: "kadet", modules: [newModule("laser", "podLeft", "x")] }, { allowed: {} })).not.toBeNull();
  });
});

describe("skener", () => {
  it("sken lodi stojí 1 bod technologie, hluboký sken 2 a odkryje mapu do konce kola; technologie se nedobíjí; průlet ocasem komety přidá body", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const me = g.ships[0];
    me.loadout.modules = [newModule("scanner", "left", "sc")];
    expect(me.techPoints).toBe(6);
    place(g, "ship-p1-0", 300, 500, 0);
    place(g, "ship-p2-0", 2000, 1200, Math.PI); // daleko mimo dohled
    expect(stateForTeam(g, 0, new Map()).ships.some((s) => s.id === "ship-p2-0")).toBe(false);
    // sken lodi mimo dosah selže, v dosahu projde a stojí 1 bod technologie
    expect(applyScan(g, me, "sc", "ship", "ship-p2-0").error).toMatch(/dosah/);
    place(g, "ship-p2-0", 700, 500, Math.PI);
    expect(applyScan(g, me, "sc", "ship", "ship-p2-0").target?.id).toBe("ship-p2-0");
    expect(me.techPoints).toBe(5);
    // hluboký sken: 2 body, tým vidí vzdálenou loď jen do konce kola
    place(g, "ship-p2-0", 2000, 1200, Math.PI);
    expect(applyScan(g, me, "sc", "deep").error).toBeUndefined();
    expect(me.techPoints).toBe(3);
    expect(g.revealTeams).toEqual([0]);
    expect(stateForTeam(g, 0, new Map()).ships.some((s) => s.id === "ship-p2-0")).toBe(true);
    expect(stateForTeam(g, 1, new Map()).ships.some((s) => s.id === "ship-p1-0")).toBe(false);
    // předpověď manévrů botů: 3 body, platí toto a příští kolo, podruhé nejde zaplatit
    expect(applyScan(g, me, "sc", "predict").error).toBeUndefined();
    expect(me.techPoints).toBe(0);
    expect(botPredictActive(g, me.ownerId)).toBe(true);
    expect(g.botPredict?.[me.ownerId]).toBe(g.turn + SCANNER.predictTurns - 1);
    me.techPoints = 3;
    expect(applyScan(g, me, "sc", "predict").error).toMatch(/běží/);
    let r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m2a0", fire: false }], createRng(1));
    expect(botPredictActive(r.state, me.ownerId)).toBe(true);
    r = resolveTurn(r.state, [{ shipId: me.id, maneuverId: "m2a0", fire: false }], createRng(1));
    expect(botPredictActive(r.state, me.ownerId)).toBe(false);
    expect(r.state.revealTeams).toEqual([]);
    expect(stateForTeam(r.state, 0, new Map()).ships.some((s) => s.id === "ship-p2-0")).toBe(false);
    // technologie se zeleným manévrem nedobíjí
    expect(r.state.ships[0].techPoints).toBe(3);
    // vyčerpání: 3 → 1 → sken lodi ještě jde, hluboký ne
    const g2 = r.state;
    expect(applyScan(g2, g2.ships[0], "sc", "deep").error).toBeUndefined();
    expect(g2.ships[0].techPoints).toBe(1);
    expect(applyScan(g2, g2.ships[0], "sc", "deep").error).toMatch(/technologie/);
    expect(applyScan(g2, g2.ships[0], "sc", "cooldown").error).toBeDefined();
    // průlet ocasem komety: los štít / technologie – při plném štítu přehodí na technologii (+COMET.tailTech do stropu)
    const g3 = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100, cometTailTechChance: 0 } });
    g3.asteroids = [];
    g3.ships[0].techPoints = 1;
    place(g3, "ship-p1-0", 500, 500, 0);
    place(g3, "ship-p2-0", 2000, 1200, Math.PI);
    // kometa letí doprava po y=500 a loď stojí v jejím ocasu (za ní)
    g3.comets = [{ id: "c1", x: 600, y: 500, heading: 0, speed: COMET.speed, hull: COMET.hull, maxHull: COMET.hull, radius: COMET.radius, tailUsed: [], entered: true }];
    const r3 = resolveTurn(g3, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    const tech = r3.events.find((e) => e.type === "cometTail" && e.effect === "tech");
    expect(tech && tech.type === "cometTail" && tech.amount).toBe(COMET.tailTech);
    expect(r3.state.ships[0].techPoints).toBe(1 + COMET.tailTech);
    expect(r3.events.some((e) => e.type === "cometTail" && e.effect !== "tech")).toBe(false);
    // šance 100 % na technologii, ale plná technologie → štít (poškozený)
    const g4 = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100, cometTailTechChance: 100 } });
    g4.asteroids = [];
    g4.ships[0].techPoints = g4.ships[0].stats.techMax;
    g4.ships[0].segments = [0, 0, 0, 0];
    place(g4, "ship-p1-0", 500, 500, 0);
    place(g4, "ship-p2-0", 2000, 1200, Math.PI);
    g4.comets = [{ id: "c1", x: 600, y: 500, heading: 0, speed: COMET.speed, hull: COMET.hull, maxHull: COMET.hull, radius: COMET.radius, tailUsed: [], entered: true }];
    const r4 = resolveTurn(g4, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r4.events.some((e) => e.type === "cometTail" && e.effect === "tech")).toBe(false);
    expect(r4.events.some((e) => e.type === "cometTail" && e.effect === "segment")).toBe(true);
    // 100 % a technologie má místo → jen technologie, štít se nedobije
    g4.ships[0].techPoints = 0;
    const r5 = resolveTurn(g4, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r5.events.some((e) => e.type === "cometTail" && e.effect === "tech")).toBe(true);
    expect(r5.events.some((e) => e.type === "cometTail" && e.effect === "segment")).toBe(false);
  });
});

describe("generovaná mapa a bouře", () => {
  const map = { size: "medium" as const, asteroids: "medium" as const, clusters: false, storms: 2, stormSize: "medium" as const, seed: 42, symmetric: true, comets: "none" as const, cometsHitAsteroids: false };
  it("generátor je deterministický, symetrický a startovní body jsou mimo překážky", () => {
    const a = generateMap(map);
    const b = generateMap(map);
    expect(a).toEqual(b);
    expect(a.width).toBe(3600);
    expect(a.storms.length).toBe(2);
    expect(a.asteroids.length).toBeGreaterThan(10);
    for (const st of a.starts) {
      expect(a.asteroids.some((x) => Math.hypot(x.x - st.x, x.y - st.y) < x.radius + 60)).toBe(false);
      expect(a.storms.some((s) => s.blobs.some((bl) => Math.hypot(bl.x - st.x, bl.y - st.y) <= bl.r + 40))).toBe(false);
    }
    // zrcadlo: ke každému asteroidu vlevo existuje protějšek vpravo
    const left = a.asteroids.filter((x) => x.x < a.width / 2 - x.radius * 2 - 40);
    for (const x of left) expect(a.asteroids.some((y) => Math.abs(y.x - (a.width - x.x)) < 1 && y.y === x.y)).toBe(true);
  });
  it("hra na generované mapě: startovní body hráčů, v bouři nefungují štíty ani lasery, torpédo ohluchne, loď v bouři není vidět", () => {
    const g = createGame({ players: [{ ...players[0], startIndex: 0 }, { ...players[1], startIndex: 5 }], settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default", placement: "manual", map }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    const gen = generateMap(map);
    expect(g.ships[0].x).toBe(gen.starts[0].x);
    expect(g.ships[1].x).toBe(gen.starts[5].x);
    expect(g.storms.length).toBe(2);
    // umístíme obě lodě proti sobě, obránce do bouře
    const b = g.storms[0].blobs[0];
    g.asteroids = [];
    place(g, "ship-p1-0", b.x - b.r - 150, b.y, 0);
    place(g, "ship-p2-0", b.x, b.y, Math.PI);
    g.ships[0].stats.agility = 0;
    g.ships[1].stats.agility = 0;
    // útočník mimo bouři nevystřelí na cíl v bouři
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: true }], createRng(1));
    expect(r.events.some((e) => e.type === "laser")).toBe(false);
    // loď v bouři je normálně vidět (bouře ruší jen skener)
    expect(stateForTeam(g, 0, new Map()).ships.some((s) => s.id === "ship-p2-0")).toBe(true);
    // zásah lodi v bouři jde rovnou do trupu (segmenty beze změny): výbuch miny
    const g2 = structuredClone(g);
    g2.mines.push({ id: "m", ownerId: "p1", team: 0, x: b.x, y: b.y, radius: 70, armed: true, timer: 1 });
    r = resolveTurn(g2, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    const hit = r.state.ships[1];
    expect(hit.hull).toBeLessThan(100);
    expect(hit.segments).toEqual([2, 2, 2, 2]);
    // torpédo vletí do bouře a ohluchne
    const g3 = structuredClone(g);
    place(g3, "ship-p2-0", b.x + 20, b.y + 150, Math.PI);
    r = resolveTurn(g3, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    for (let i = 0; i < 2 && r.state.torpedoes.length; i++) r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    if (r.state.torpedoes.length) expect(r.state.torpedoes[0].lost).toBe(true);
  });
});

describe("kulomet", () => {
  it("dávka 10 projektilů před pohybem, zranění podle zásahů, funguje z bouře i do bouře; segmentový štít pohltí dávku za 1 bod", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100, mgHitNear: 100, mgHitFar: 100, mgRange: 200 } });
    g.asteroids = [];
    const me = g.ships[0];
    me.loadout.modules = [newModule("mg", "front", "mg1")];
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 640, 500, Math.PI);
    me.speed = 1; // střelec stojí (rychlost 0), cíl přilétá – nesrazí se
    let r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m0a0", fire: false, fireMg: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    const ev = r.events.find((e) => e.type === "mg");
    expect(ev && ev.type === "mg" && ev.shots).toBe(10);
    expect(ev && ev.type === "mg" && ev.hits).toBe(10);
    expect(r.state.ships[0].loadout.modules[0].ammo).toBe(90);
    // segmentový štít: celá dávka = jeden zásah → přední segment 2 → 1, trup celý
    expect(r.state.ships[1].segments[0]).toBe(1);
    expect(r.state.ships[1].hull).toBe(100);
    expect(r.events.indexOf(ev!)).toBeLessThan(r.events.findIndex((e) => e.type === "move"));
    // celolodní štít: každý projektil zvlášť (10 × 3, účinnost klesá po každém)
    const g2 = structuredClone(g);
    g2.ships[1].shieldType = "whole";
    g2.ships[1].shields = 50;
    g2.ships[1].stats.shields = 50;
    r = resolveTurn(g2, [{ shipId: me.id, maneuverId: "m0a0", fire: false, fireMg: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    // výchozí balanc: účinnost neklesá (wholeEffDrop 0); projektil energetický štít prorazí: z každého zásahu (3) jde wholePiercePct % do trupu (zaokrouhleno = 1), zbytek (2) odnese zásoba; pak dobití +5
    expect(r.state.ships[1].shieldEff).toBe(100);
    const pierce = Math.round((3 * RULES.wholePiercePct) / 100);
    expect(r.state.ships[1].hull).toBe(100 - 10 * pierce);
    expect(r.state.ships[1].shields).toBe(Math.min(50, 50 - 10 * (3 - pierce) + RULES.shieldRecharge));
    // s poklesem účinnosti (ladění) klesá po každém projektilu zvlášť
    const g3 = structuredClone(g2);
    g3.tuning = { ...g3.tuning, wholeEffDrop: 10 };
    r = resolveTurn(g3, [{ shipId: me.id, maneuverId: "m0a0", fire: false, fireMg: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.state.ships[1].shieldEff).toBe(0); // 10 zásahů × −10 %
    expect(r.state.ships[1].hull).toBeLessThan(100);
    // kulomet není akce zdarma: s laserem a torpédem (2 akce) se neschválí
    me.loadout.modules.push(newModule("laser", "left", "l1"), newModule("torpedo", "back", "t1"));
    const fixed = sanitizeOrders(g, "p1", [{ shipId: me.id, maneuverId: "m2a0", fire: true, fireMg: true, special: { type: "torpedo", point: { x: 900, y: 500 } } }]);
    expect(fixed[0].fireMg).toBe(false);
  });
});

describe("komety", () => {
  const settingsWith = (comets: "none" | "few" | "medium" | "many", cometsHitAsteroids = false) => ({ mode: "tdm" as const, turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" as const, map: { size: "medium" as const, asteroids: "none" as const, clusters: false, storms: 0, stormSize: "medium" as const, seed: 3, symmetric: false, comets, cometsHitAsteroids } });
  const noOrders = (g: GameState): ShipOrders[] => g.ships.map((s) => ({ shipId: s.id, maneuverId: "m1a0", fire: false }));
  const cometAt = (x: number, y: number, heading: number, id = "c1"): Comet => ({ id, x, y, heading, speed: COMET.speed, hull: COMET.hull, maxHull: COMET.hull, radius: COMET.radius, tailUsed: [] });

  it("kometa přilétá na okraj mapy a letí přes mapu; mimo mapu zmizí", () => {
    const g = createGame({ players, settings: settingsWith("many"), tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const c = spawnComet(g, createRng(5), "cx");
    // objeví se COMET.approachTurns kol letu za okrajem a míří dovnitř
    expect(cometOnMap(g, c)).toBe(false);
    const f = { x: Math.cos(c.heading), y: Math.sin(c.heading) };
    // rychlost náhodně v rozmezí ±20 % základu
    expect(c.speed).toBeGreaterThanOrEqual(COMET.speed * 0.8);
    expect(c.speed).toBeLessThanOrEqual(COMET.speed * 1.2);
    const speeds = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => spawnComet(g, createRng(seed), "c").speed));
    expect(speeds.size).toBeGreaterThan(1);
    const edgePt = { x: c.x + f.x * c.speed * COMET.approachTurns, y: c.y + f.y * c.speed * COMET.approachTurns };
    // bod vstupu leží na hraně oválu (zmenšeného o poloměr komety)
    expect(Math.abs(ellipseNorm(g, edgePt, c.radius) - 1)).toBeLessThan(1e-6);
    // za okrajem na ni nejde střílet ani ji netrefí loď
    const gc = structuredClone(g);
    gc.comets = [c];
    expect(laserReach(gc, gc.ships[0], c)).toBe("ještě není na mapě");
    // 100% šance → každé kolo nová (max. 6)
    let r = resolveTurn(g, noOrders(g), createRng(1));
    expect(r.events.some((e) => e.type === "spawnComet")).toBe(true);
    expect(r.state.comets!.length).toBe(1);
    const moved = r.events.find((e) => e.type === "move");
    expect(moved && moved.type === "move" && moved.paths.some((p) => p.kind === "comet")).toBe(true);
    // kometa mířící ven letí dál přes okrajovou bouři a zmizí až za tvrdým okrajem
    const g2 = createGame({ players, settings: settingsWith("none"), tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g2.asteroids = [];
    g2.comets = [{ ...cometAt(g2.width - 20, 500, 0), entered: true }];
    r = resolveTurn(g2, noOrders(g2), createRng(1));
    expect(r.state.comets!.length).toBe(1);
    expect(ellipseNorm(g2, r.state.comets![0])).toBeGreaterThan(1);
    let gone = false;
    for (let i = 0; i < 4 && !gone; i++) {
      r = resolveTurn(r.state, noOrders(r.state), createRng(1));
      gone = r.events.some((e) => e.type === "cometGone" && e.reason === "edge");
    }
    expect(gone).toBe(true);
    expect(r.state.comets!.length).toBe(0);
  });

  it("náraz do lodi: zranění, odmrštění, kometa zmizí; sestřelení laserem dává kredity", () => {
    const g = createGame({ players, settings: settingsWith("none"), tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const me = place(g, "ship-p1-0", 600, 500, 0); // letí pomalu stejným směrem, kometa ho dožene
    place(g, "ship-p2-0", 1500, 1200, 0);
    g.comets = [cometAt(400, 500, 0)];
    const hullBefore = me.hull + me.segments.reduce((a, b) => a + b, 0);
    let r = resolveTurn(g, noOrders(g), createRng(1));
    const gone = r.events.find((e) => e.type === "cometGone");
    expect(gone && gone.type === "cometGone" && gone.reason === "ship" && gone.shipId === me.id).toBe(true);
    expect(r.events.some((e) => e.type === "collision" && e.with === "comet" && e.shipId === me.id)).toBe(true);
    expect(r.events.some((e) => e.type === "damage" && e.shipId === me.id && e.amount === COMET.damage)).toBe(true);
    expect(r.state.ships[0].hull + r.state.ships[0].segments.reduce((a, b) => a + b, 0)).toBeLessThan(hullBefore);
    expect(r.state.comets!.length).toBe(0);
    // sestřelení: laser s jistým zásahem (6 kostek) a odolnost 15 → padne na jeden zásah
    const g2 = createGame({ players, settings: settingsWith("none"), tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100, laserDice: 6, cometHull: 15 } });
    g2.asteroids = [];
    const s2 = place(g2, "ship-p1-0", 500, 500, 0);
    s2.loadout.modules = [newModule("laser", "front", "l1")];
    place(g2, "ship-p2-0", 1500, 1200, 0);
    g2.comets = [{ ...cometAt(620, 500, Math.PI / 2), hull: 15, maxHull: 15 }];
    r = resolveTurn(g2, [{ shipId: s2.id, maneuverId: "m1a0", fire: true, preferredTargetId: "c1" }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(2));
    expect(sanitizeOrders(g2, "p1", [{ shipId: s2.id, maneuverId: "m1a0", fire: true, preferredTargetId: "c1" }])[0].preferredTargetId).toBe("c1");
    const shot = r.events.find((e) => e.type === "cometShot");
    expect(shot && shot.type === "cometShot" && shot.destroyed).toBe(true);
    expect(r.state.comets!.length).toBe(0);
    expect(r.state.players[0].credits).toBe(DEFAULT_TUNING.startBudget - moduleCost(DEFAULT_LOADOUT) + COMET.reward + DEFAULT_TUNING.creditsPerTurn);
    expect(r.state.stats!.p1.cometsShot).toBe(1);
  });

  it("průlet ocasem doplní štít (celolodní %, segmentový +1), při plném štítu trup, bez štítu stres + kredity; jen jednou za kometu", () => {
    expect(inCometTail({ x: 500, y: 500, heading: 0 }, { x: 400, y: 505 })).toBe(true);
    expect(inCometTail({ x: 500, y: 500, heading: 0 }, { x: 600, y: 500 })).toBe(false);
    expect(inCometTail({ x: 500, y: 500, heading: 0 }, { x: 400, y: 560 })).toBe(false);
    const base = () => {
      const g = createGame({ players, settings: settingsWith("none"), tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
      g.asteroids = [];
      place(g, "ship-p2-0", 1500, 1200, 0);
      // kometa letí doprava daleko vpravo od lodi; loď stojí v jejím ocasu během celého kola
      g.comets = [cometAt(700, 500, 0)];
      return g;
    };
    // segmentový: loď v ocasu, segment předek snížený
    let g = base();
    let me = place(g, "ship-p1-0", 640, 500, 0);
    me.segments = [1, 2, 2, 2];
    let r = resolveTurn(g, noOrders(g), createRng(1));
    let tail = r.events.find((e) => e.type === "cometTail");
    expect(tail && tail.type === "cometTail" && tail.effect === "segment" && tail.segment === 0).toBe(true);
    expect(r.state.ships[0].segments[0]).toBe(2);
    expect(r.state.comets![0].tailUsed).toContain(me.id);
    // podruhé stejná kometa už nic nedá
    const r2 = resolveTurn(r.state, noOrders(r.state), createRng(1));
    expect(r2.events.some((e) => e.type === "cometTail")).toBe(false);
    // plný štít → trup
    g = base();
    me = place(g, "ship-p1-0", 640, 500, 0);
    me.hull = 50;
    r = resolveTurn(g, noOrders(g), createRng(1));
    tail = r.events.find((e) => e.type === "cometTail");
    expect(tail && tail.type === "cometTail" && tail.effect === "hull" && tail.amount === 10).toBe(true);
    expect(r.state.ships[0].hull).toBe(60);
    // vše plné → kredity
    g = base();
    me = place(g, "ship-p1-0", 640, 500, 0);
    r = resolveTurn(g, noOrders(g), createRng(1));
    tail = r.events.find((e) => e.type === "cometTail");
    expect(tail && tail.type === "cometTail" && tail.effect === "credits").toBe(true);
    expect(r.state.players[0].credits).toBe(DEFAULT_TUNING.startBudget - moduleCost(DEFAULT_LOADOUT) + COMET.bonusCredits + DEFAULT_TUNING.creditsPerTurn);
    // celolodní štít 25 % maxima
    g = base();
    me = place(g, "ship-p1-0", 640, 500, 0);
    me.shieldType = "whole";
    me.stats.shields = 40;
    me.shields = 10;
    r = resolveTurn(g, noOrders(g), createRng(1));
    tail = r.events.find((e) => e.type === "cometTail");
    expect(tail && tail.type === "cometTail" && tail.effect === "shield" && tail.amount === 10).toBe(true);
    // bez štítu: stres zpět na max + kredity
    g = base();
    me = place(g, "ship-p1-0", 640, 500, 0);
    me.shieldType = "none";
    me.stressPoints = 0;
    r = resolveTurn(g, noOrders(g), createRng(1));
    tail = r.events.find((e) => e.type === "cometTail");
    expect(tail && tail.type === "cometTail" && tail.effect === "stress").toBe(true);
    expect(r.state.ships[0].stressPoints).toBe(3);
  });
});

describe("komety – ladění srážek", () => {
  it("se zapnutým cometCollide se dvě komety při srážce zničí a komety naráží do asteroidů i bez volby mapy", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100, cometCollide: 1 } });
    g.asteroids = [];
    place(g, "ship-p1-0", 300, 1200, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    const mk = (id: string, x: number, heading: number): Comet => ({ id, x, y: 500, heading, speed: COMET.speed, hull: COMET.hull, maxHull: COMET.hull, radius: COMET.radius, tailUsed: [] });
    g.comets = [mk("c1", 500, 0), mk("c2", 800, Math.PI)];
    let r = resolveTurn(g, g.ships.map((s) => ({ shipId: s.id, maneuverId: "m1a0", fire: false })), createRng(1));
    expect(r.events.filter((e) => e.type === "cometGone" && e.reason === "comet").length).toBe(2);
    expect(r.state.comets!.length).toBe(0);
    // asteroid v cestě
    const g2 = structuredClone(g);
    g2.comets = [mk("c1", 500, 0)];
    g2.asteroids = [ast("a1", 650, 500, 40)];
    r = resolveTurn(g2, g2.ships.map((s) => ({ shipId: s.id, maneuverId: "m1a0", fire: false })), createRng(1));
    expect(r.events.some((e) => e.type === "cometGone" && e.reason === "asteroid")).toBe(true);
    // bez ladění a bez volby mapy proletí
    const g3 = structuredClone(g2);
    g3.tuning = { ...DEFAULT_TUNING, weightPerSpeed: 100 };
    r = resolveTurn(g3, g3.ships.map((s) => ({ shipId: s.id, maneuverId: "m1a0", fire: false })), createRng(1));
    expect(r.events.some((e) => e.type === "cometGone")).toBe(false);
  });
});

describe("úhyb skrz asteroid a kometu", () => {
  it("úhybný manévr proletí asteroidem i kometou; konec v asteroidu = dvojité zranění", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    // asteroid uprostřed dráhy (rychlost 3 rovně = 3 × MOVE_UNIT), loď skončí za ním
    g.asteroids = [ast("a1", 500 + MOVE_UNIT * 1.5, 500, 30)];
    const orders = (): ShipOrders[] => [{ shipId: me.id, maneuverId: "m3a0", fire: false, action: { type: "evade" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }];
    let r = resolveTurn(g, orders(), createRng(1));
    expect(r.events.some((e) => e.type === "evadeThrough" && e.with === "asteroid")).toBe(true);
    expect(r.events.some((e) => e.type === "collision" && e.shipId === me.id)).toBe(false);
    expect(r.state.ships[0].x).toBeGreaterThan(500 + MOVE_UNIT * 2.5);
    // bez úhybu by narazila
    r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m3a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "collision" && e.with === "asteroid")).toBe(true);
    // konec dráhy v asteroidu → srážka s dvojitým zraněním
    const g2 = game();
    const me2 = place(g2, "ship-p1-0", 500, 500, 0);
    place(g2, "ship-p2-0", 1500, 1200, 0);
    g2.asteroids = [ast("a1", 500 + MOVE_UNIT * 3, 500, 40)];
    r = resolveTurn(g2, [{ shipId: me2.id, maneuverId: "m3a0", fire: false, action: { type: "evade" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "damage" && e.shipId === me2.id && e.amount === DEFAULT_TUNING.collisionAsteroid * 2)).toBe(true);
    // kometa: úhyb proletí (kometa letí proti lodi)
    const g3 = game();
    const me3 = place(g3, "ship-p1-0", 500, 500, 0);
    place(g3, "ship-p2-0", 1500, 1200, 0);
    g3.comets = [{ id: "c1", x: 640, y: 500, heading: Math.PI, speed: COMET.speed, hull: COMET.hull, maxHull: COMET.hull, radius: COMET.radius, tailUsed: [] }];
    r = resolveTurn(g3, [{ shipId: me3.id, maneuverId: "m3a0", fire: false, action: { type: "evade" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "evadeThrough" && e.with === "comet")).toBe(true);
    expect(r.events.some((e) => e.type === "cometGone" && e.reason === "ship")).toBe(false);
  });
});

describe("náraz do asteroidu / komety", () => {
  it("náraz do asteroidu vykousne díru, loď u něj zastaví (rychlost 0) bez stresu", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    me.speed = 3;
    me.stressPoints = 3;
    g.asteroids = [ast("a1", 500 + MOVE_UNIT * 2 + 40, 500, 90)];
    const before = [...g.asteroids[0].profile];
    const r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m3a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m3a0", fire: false }], createRng(7));
    expect(r.events.some((e) => e.type === "collision" && e.shipId === me.id && e.with === "asteroid")).toBe(true);
    const hitEv = r.events.find((e) => e.type === "asteroidHit" && e.asteroidId === "a1");
    expect(hitEv).toBeDefined();
    const a = r.state.asteroids.find((x) => x.id === "a1")!;
    expect(a.profile.some((v, i) => v < before[i])).toBe(true);
    const s = r.state.ships.find((x) => x.id === me.id)!;
    expect(s.speed).toBe(0);
    expect(s.stressPoints).toBe(0);
    expect(s.heading).toBeCloseTo(0, 5);
  });
  it("kometa do lodi: rychlost 1 a nulový stres", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    me.stressPoints = 2;
    g.comets = [{ id: "c1", x: 640, y: 500, heading: Math.PI, speed: COMET.speed, hull: COMET.hull, maxHull: COMET.hull, radius: COMET.radius, tailUsed: [] }];
    const r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m3a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "cometGone" && e.reason === "ship")).toBe(true);
    const s = r.state.ships.find((x) => x.id === me.id)!;
    expect(s.speed).toBe(1);
    expect(s.stressPoints).toBe(0);
  });
});

describe("droid – opravář", () => {
  it("oprava modulu, munice, trupu a instalace z nákladu (hned, za technologii); v bouři ne", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    me.loadout.modules = [newModule("laser", "front", "l1"), newModule("torpedo", "back", "t1"), newModule("repair", "left", "r1")];
    me.loadout.cargo = [newModule("mine", "front", "c1")];
    refreshShip(me);
    me.techPoints = 6;
    me.hull = 40;
    me.loadout.modules[0].hp = 0; // zničený laser
    me.loadout.modules[1].ammo = 0;
    expect(repairBlocked(g, me)).toBeUndefined();
    // modul (4)
    let r = applyRepair(g, me, { kind: "module", moduleId: "l1" });
    expect(r.error).toBeUndefined();
    expect(moduleWorking(me.loadout.modules[0])).toBe(true);
    expect(me.techPoints).toBe(6 - REPAIR.moduleCost);
    // munice (2) – jen do max.
    r = applyRepair(g, me, { kind: "ammo", moduleId: "t1" });
    expect(r.error).toBeUndefined();
    expect(me.loadout.modules[1].ammo).toBe(1);
    expect(me.techPoints).toBe(0);
    expect(applyRepair(g, me, { kind: "hull" }).error).toMatch(/technologie/);
    // trup (3): 25 % maxima, ne přes max.
    me.techPoints = 6;
    me.hull = me.stats.hull - 5;
    r = applyRepair(g, me, { kind: "hull" });
    expect(r.error).toBeUndefined();
    expect(me.hull).toBe(me.stats.hull);
    expect(r.event?.type === "repair" && r.event.amount).toBe(5);
    expect(applyRepair(g, me, { kind: "hull" }).error).toMatch(/nepoškozen/);
    me.hull = 40;
    applyRepair(g, me, { kind: "hull" });
    expect(me.hull).toBe(40 + Math.round((me.stats.hull * REPAIR.hullPct) / 100));
    // instalace (1): do obsazeného slotu = výměna, původní jde do nákladu
    me.techPoints = 2;
    r = applyRepair(g, me, { kind: "install", moduleId: "c1", slot: "back" });
    expect(r.error).toBeUndefined();
    expect(me.loadout.modules.find((m) => m.slot === "back")?.type).toBe("mine");
    expect(me.loadout.cargo?.map((m) => m.type)).toEqual(["torpedo"]);
    expect(me.stats.mines).toBeGreaterThan(0);
    expect(me.techPoints).toBe(1);
    // do volného slotu
    r = applyRepair(g, me, { kind: "install", moduleId: me.loadout.cargo![0].id, slot: "right" });
    expect(r.error).toBeUndefined();
    expect(me.loadout.cargo).toBeUndefined();
    expect(me.loadout.modules.some((m) => m.type === "torpedo" && m.slot === "right")).toBe(true);
    // bez opraváře / v bouři
    const g2 = game();
    const me2 = place(g2, "ship-p1-0", 500, 500, 0);
    expect(repairBlocked(g2, me2)).toMatch(/opravář/);
    me2.loadout.modules.push(newModule("repair", "left", "r1"));
    refreshShip(me2);
    g2.storms = [{ id: "s1", blobs: [{ x: 500, y: 500, r: 100 }] }];
    expect(repairBlocked(g2, me2)).toMatch(/bouři/);
  });
});

describe("mlha války – přesně hranice dohledu", () => {
  it("cizí loď, kometa i bouře se posílají jen v dohledu (bez okraje); vlastní vždy", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    const foe = place(g, "ship-p2-0", 500 + me.stats.vision + foe0r() + 50, 500, Math.PI);
    g.storms = [{ id: "s1", blobs: [{ x: 500 + me.stats.vision + 300, y: 500, r: 100 }] }, { id: "s2", blobs: [{ x: 700, y: 500, r: 100 }] }];
    g.comets = [{ id: "far", x: 500 + me.stats.vision + 400, y: 900, heading: 0, speed: 300, hull: 10, maxHull: 10, radius: 20, tailUsed: [] }, { id: "tail", x: 500 + me.stats.vision + 120, y: 500, heading: 0, speed: 300, hull: 10, maxHull: 10, radius: 20, tailUsed: [] }];
    let seen = stateForTeam(g, 0, new Map());
    expect(seen.ships.some((s) => s.id === foe.id)).toBe(false);
    expect(seen.storms.map((s) => s.id)).toEqual(["s2"]);
    // ocas komety „tail“ (za jádrem směrem doleva) zasahuje do dohledu → kometa se posílá; „far“ ne
    expect(seen.comets?.map((c) => c.id)).toEqual(["tail"]);
    // o kousek blíž → nepřítel v dohledu
    foe.x = 500 + me.stats.vision + foe.stats.radius - 1;
    seen = stateForTeam(g, 0, new Map());
    expect(seen.ships.some((s) => s.id === foe.id)).toBe(true);
    function foe0r() {
      return g.ships[1].stats.radius;
    }
  });
});

describe("droid – hacker", () => {
  it("hack modulu: laser oběti v tomto kole nevystřelí, oběť dostane zprávu; vlastní tým flag nevidí; příští kolo zas funguje", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    const foe = place(g, "ship-p2-0", 700, 500, Math.PI);
    me.loadout.modules.push(newModule("hacker", "left", "h1"));
    refreshShip(me);
    me.techPoints = 6;
    const laser = foe.loadout.modules.find((m) => m.type === "laser")!;
    expect(hackBlocked(g, me)).toBeUndefined();
    const seen = stateForTeam(g, 0, new Map());
    const r0 = applyHack(g, seen, me, { kind: "module", shipId: foe.id, moduleId: laser.id });
    expect(r0.error).toBeUndefined();
    expect(me.techPoints).toBe(6 - HACK.moduleCost);
    expect(laser.hacked).toBe(true);
    // tým oběti flag nevidí, tým hackera ano
    expect(stateForTeam(g, 1, new Map()).ships.find((s) => s.id === foe.id)!.loadout.modules.find((m) => m.id === laser.id)!.hacked).toBeUndefined();
    expect(stateForTeam(g, 0, new Map()).ships.find((s) => s.id === foe.id)!.loadout.modules.find((m) => m.id === laser.id)!.hacked).toBe(true);
    expect(applyHack(g, seen, me, { kind: "module", shipId: foe.id, moduleId: laser.id }).error).toMatch(/hacknut/);
    const orders: ShipOrders[] = [{ shipId: me.id, maneuverId: "m1a0", fire: false }, { shipId: foe.id, maneuverId: "m1a0", fire: true }];
    let r = resolveTurn(g, orders, createRng(7));
    expect(r.events.some((e) => e.type === "laser" && e.shooterId === foe.id)).toBe(false);
    expect(r.events.some((e) => e.type === "hacked" && e.shipId === foe.id && e.moduleType === "laser")).toBe(true);
    expect(r.state.ships.find((s) => s.id === foe.id)!.loadout.modules.some((m) => m.hacked)).toBe(false);
    r = resolveTurn(r.state, orders, createRng(7));
    expect(r.events.some((e) => e.type === "laser" && e.shooterId === foe.id)).toBe(true);
  });
  it("hack štítu: zásah jde do trupu; hack miny a torpéda je převezme; pasivní oprava 4 kola", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    const foe = place(g, "ship-p2-0", 700, 500, Math.PI);
    me.loadout.modules.push(newModule("hacker", "left", "h1"));
    refreshShip(me);
    me.techPoints = 6;
    const shield = foe.loadout.modules.find((m) => m.type.startsWith("shield"))!;
    const seen = stateForTeam(g, 0, new Map());
    expect(applyHack(g, seen, me, { kind: "module", shipId: foe.id, moduleId: shield.id }).error).toBeUndefined();
    const hullBefore = foe.hull;
    const r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: true }, { shipId: foe.id, maneuverId: "m1a0", fire: false }], createRng(3));
    const f2 = r.state.ships.find((s) => s.id === foe.id)!;
    const dmg = r.events.filter((e) => e.type === "damage" && e.shipId === foe.id);
    if (dmg.length) expect(f2.hull).toBeLessThan(hullBefore);
    // mina a torpédo
    const g2 = game();
    const me2 = place(g2, "ship-p1-0", 500, 500, 0);
    const foe2 = place(g2, "ship-p2-0", 1200, 500, Math.PI);
    me2.loadout.modules.push(newModule("hacker", "left", "h1"));
    refreshShip(me2);
    me2.techPoints = 6;
    g2.mines = [{ id: "mn", ownerId: foe2.ownerId, team: 1, x: 600, y: 600, radius: 70, armed: true }];
    g2.torpedoes = [{ id: "tp", ownerId: foe2.ownerId, team: 1, x: 620, y: 400, heading: 0, targetId: me2.id, trackLeft: 1, lifeLeft: 1, phase: "lock", speed: 240, launchLeft: 0 }];
    const seen2 = stateForTeam(g2, 0, new Map());
    expect(applyHack(g2, seen2, me2, { kind: "mine", mineId: "mn", timer: 1 }).error).toBeUndefined();
    expect(g2.mines[0].team).toBe(0);
    expect(g2.mines[0].timer).toBe(1);
    expect(applyHack(g2, seen2, me2, { kind: "torpedo", torpedoId: "tp", targetId: foe2.id }).error).toBeUndefined();
    expect(g2.torpedoes[0].team).toBe(0);
    expect(g2.torpedoes[0].targetId).toBe(foe2.id);
    expect(g2.torpedoes[0].lifeLeft).toBe(1 + HACK.torpedoLife);
    expect(me2.techPoints).toBe(6 - 2 * HACK.ordnanceCost);
    // mina vybuchne na startu kola
    const r2 = resolveTurn(g2, [{ shipId: me2.id, maneuverId: "m1a0", fire: false }, { shipId: foe2.id, maneuverId: "m1a0", fire: false }], createRng(3));
    expect(r2.events.some((e) => e.type === "mineBlast")).toBe(true);
    // pasivní oprava (droid opravář)
    const g3 = game();
    const me3 = place(g3, "ship-p1-0", 500, 500, 0);
    place(g3, "ship-p2-0", 1500, 1200, Math.PI);
    me3.loadout.modules.push(newModule("repair", "left", "r1"));
    refreshShip(me3);
    me3.techPoints = 6;
    me3.hull = 50;
    expect(applyRepair(g3, me3, { kind: "auto" }).error).toBeUndefined();
    me3.techPoints = 6;
    expect(applyRepair(g3, me3, { kind: "auto" }).error).toMatch(/běží/);
    let st = g3;
    for (let i = 0; i < REPAIR.autoTurns; i++) {
      const rr = resolveTurn(st, [{ shipId: me3.id, maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(3));
      expect(rr.events.some((e) => e.type === "autoRepair" && e.shipId === me3.id)).toBe(true);
      st = rr.state;
    }
    const m3 = st.ships.find((s) => s.id === me3.id)!;
    expect(m3.hull).toBe(50 + REPAIR.autoTurns * Math.round((m3.stats.hull * REPAIR.autoPct) / 100));
    expect(m3.autoRepair).toBe(0);
    const rr = resolveTurn(st, [{ shipId: me3.id, maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(3));
    expect(rr.events.some((e) => e.type === "autoRepair")).toBe(false);
  });
});

describe("vesmírná stanice", () => {
  const mkStation = (x: number, y: number) => ({ id: "st1", x, y, radius: STATION.radius, hull: STATION.hull, maxHull: STATION.hull, shields: STATION.shields, maxShields: STATION.shields, broken: false, stock: STATION.stock });
  it("mapa umí 0–2 stanice; stanice je překážka a zastaví torpédo", () => {
    const gen = generateMap({ ...DEFAULT_MAP, stations: 2, seed: 3 });
    expect(gen.stations).toHaveLength(2);
    expect(generateMap({ ...DEFAULT_MAP, stations: 0 }).stations).toHaveLength(0);
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    g.stations = [mkStation(500 + MOVE_UNIT * 2 + 50, 500)];
    const r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m3a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "collision" && e.shipId === me.id && e.otherId === "st1")).toBe(true);
    expect(r.state.stations![0].hull).toBe(STATION.hull); // náraz lodi stanici nezraní
  });
  it("laser zraní stanici (štít vybíjí energie), zničení → rozbitá, výbuch, odměna a trosky", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    g.stations = [mkStation(700, 500)];
    const r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: false, shots: [{ moduleId: me.loadout.modules.find((m) => m.type === "laser")!.id, targetId: "st1" }] }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(2));
    const hit = r.events.find((e) => e.type === "stationHit");
    if (hit && hit.type === "stationHit") {
      expect(hit.hullAfter).toBe(STATION.hull); // energie: jen štít
      expect(hit.shieldsAfter).toBeLessThan(STATION.shields);
    }
    // štít se dobíjí
    expect(r.state.stations![0].shields).toBeLessThanOrEqual(STATION.shields);
    // zničení přímo
    const g2 = game();
    const me2 = place(g2, "ship-p1-0", 500, 500, 0);
    place(g2, "ship-p2-0", 1500, 1200, 0);
    g2.stations = [mkStation(700, 500)];
    const ev: typeof r.events = [];
    damageStation(g2, g2.stations[0], 5000, "kinetic", ev, me2.id, 0, undefined, createRng(1));
    expect(g2.stations[0].broken).toBe(true);
    expect(ev.some((e) => e.type === "stationDestroyed")).toBe(true);
    expect(g2.players.find((p) => p.id === me2.ownerId)!.credits).toBeGreaterThanOrEqual(STATION.reward);
    expect(g2.debris.length).toBeGreaterThanOrEqual(1);
    expect(g2.stations[0].stock).toBeLessThan(STATION.stock);
  });
  it("nabrání modulu ze stanice (okruh, rychlost ≤ 2, zásoba) a objednávka (kredity, 1 za kolo, trosky směrem k lodi)", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    g.stations = [mkStation(500 + STATION.radius + 100, 500)];
    let r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: false, action: { type: "pickup", targetId: "st1" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    const pk = r.events.find((e) => e.type === "stationPickup");
    expect(pk && pk.type === "stationPickup" && pk.ok).toBe(true);
    expect(r.state.ships[0].loadout.cargo?.length).toBe(1);
    expect(r.state.stations![0].stock).toBe(STATION.stock - 1);
    // moc rychle
    r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m3a0", fire: false, action: { type: "pickup", targetId: "st1" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "stationPickup" && !e.ok && e.reason === "speed")).toBe(true);
    // objednávka
    const g3 = game();
    const me3 = place(g3, "ship-p1-0", 500, 500, 0);
    place(g3, "ship-p2-0", 1500, 1200, 0);
    g3.stations = [mkStation(900, 500)];
    const pl = g3.players.find((p) => p.id === me3.ownerId)!;
    pl.credits = 1000;
    r = resolveTurn(g3, [{ shipId: me3.id, maneuverId: "m1a0", fire: false, action: { type: "comm", stationId: "st1", moduleType: "laser" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    const od = r.events.find((e) => e.type === "stationOrder");
    expect(od && od.type === "stationOrder" && od.ok).toBe(true);
    expect(r.state.players.find((p) => p.id === me3.ownerId)!.credits).toBe(1000 - MODULES.laser.price + RULES.creditsPerTurn);
    const deb = r.state.debris.find((d) => d.id.startsWith("debris-order"));
    expect(deb?.type).toBe("laser");
    expect(deb!.x).toBeLessThan(900); // směrem k volajícímu (vlevo od stanice)
    // málo kreditů
    pl.credits = 10;
    r = resolveTurn(g3, [{ shipId: me3.id, maneuverId: "m1a0", fire: false, action: { type: "comm", stationId: "st1", moduleType: "laser" } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "stationOrder" && !e.ok && e.reason === "credits")).toBe(true);
  });
});

describe("zastavení a rozjezd", () => {
  it("rychlost 0 jen z 1; stíhač 0→1 bílý, 0→2 oranžový, 0→3 nelze; změna o 3 nebezpečná, o 4 nelze; bitevník ±2 nebezpečné, ±3 nelze, z 0 jen na 1", () => {
    const F = FIGHTER_PROFILE;
    expect(classifyManeuver(F, 0, 0, false, 1)).toBe("white");
    expect(classifyManeuver(F, 0, 0, false, 2)).toBe("red"); // stíhač zastaví i z 2 (oranžově)
    expect(classifyManeuver(F, 0, 0, false, 3)).toBeNull();
    expect(classifyManeuver(BATTLESHIP_PROFILE, 0, 0, false, 2)).toBeNull();
    expect(classifyManeuver(F, 0, 0, false, 0)).toBe("white");
    expect(classifyManeuver(F, 1, 0, false, 0)).toBe("green"); // rozjezd na 1 rovně = mírný manévr
    expect(classifyManeuver(F, 2, 0, false, 0)).toBe("red");
    expect(classifyManeuver(F, 3, 0, false, 0)).toBeNull();
    expect(classifyManeuver(F, 4, 0, false, 1)).toBe("danger");
    expect(classifyManeuver(F, 5, 0, false, 1)).toBeNull();
    expect(classifyManeuver(F, 3, 0, false, 1)).toBe("red");
    const B = BATTLESHIP_PROFILE;
    expect(classifyManeuver(B, 1, 0, false, 0)).toBe("green");
    expect(classifyManeuver(B, 2, 0, false, 0)).toBeNull();
    expect(classifyManeuver(B, 3, 0, false, 1)).toBe("danger");
    expect(classifyManeuver(B, 4, 0, false, 1)).toBeNull();
    expect(classifyManeuver(B, 0, 0, false, 1)).toBe("white");
    expect(listManeuvers(F, 1).some((m) => m.speed === 0)).toBe(true);
    expect(listManeuvers(F, 0).every((m) => !m.koiogran)).toBe(true);
  });
  it("zastavení na konci dráhy: rychlostí 1 bílé, rychlostí 2 oranžové (stíhač), s otočkou ne; stojí 1 akci; po kole rychlost 0 na konci dráhy", () => {
    const F = FIGHTER_PROFILE;
    expect(parseManeuverId("s2a30")).toEqual({ speed: 2, angle: 30, koiogran: false, stop: true });
    expect(classifyManeuver(F, 1, 0, false, 1, true)).toBe("white");
    expect(classifyManeuver(F, 2, 0, false, 2, true)).toBe("red");
    expect(classifyManeuver(F, 3, 0, false, 3, true)).toBeNull();
    expect(classifyManeuver(BATTLESHIP_PROFILE, 2, 0, false, 2, true)).toBeNull();
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    me.speed = 2;
    const o: ShipOrders = { shipId: me.id, maneuverId: "s2a0", fire: false };
    expect(actionCost(me, o)).toBe(1); // jen zastavení (rovně stejnou rychlostí je zdarma)
    const r = resolveTurn(g, [o], createRng(1));
    const s = r.state.ships.find((x) => x.id === me.id)!;
    expect(s.x).toBeCloseTo(500 + 2 * MOVE_UNIT, 1);
    expect(s.speed).toBe(0);
    expect(s.stressPoints).toBe(2); // oranžový: −1
    // zastavit hned + otočit na místě = 2 akce, kurz platí hned
    const g2 = game();
    const me2 = place(g2, "ship-p1-0", 500, 500, 0);
    place(g2, "ship-p2-0", 1500, 1200, 0);
    me2.speed = 1;
    const fixed = sanitizeOrders(g2, "p1", [{ shipId: me2.id, maneuverId: "m0a0", fire: false, action: { type: "turn", heading: 1 } }]);
    expect(fixed[0].action?.type).toBe("turn");
    expect(actionCost(me2, fixed[0])).toBe(2);
    const r2 = resolveTurn(g2, fixed, createRng(1));
    const s2 = r2.state.ships.find((x) => x.id === me2.id)!;
    expect(s2.heading).toBeCloseTo(1, 5);
    expect(s2.x).toBeCloseTo(500, 1);
    expect(s2.speed).toBe(0);
  });
  it("stojící loď se otočí (1 akce) a vyrazí novým směrem; úhyb při rychlosti 0 nejde", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 1200, 0);
    me.speed = 0;
    const fixed = sanitizeOrders(g, "p1", [{ shipId: me.id, maneuverId: "m1a0", fire: false, action: { type: "turn", heading: Math.PI / 2 } }]);
    expect(fixed[0].action?.type).toBe("turn");
    expect(actionCost(me, fixed[0])).toBe(2); // otočení + úprava pohybu (0→1)
    const r = resolveTurn(g, fixed, createRng(1));
    const s = r.state.ships.find((x) => x.id === me.id)!;
    expect(s.heading).toBeCloseTo(Math.PI / 2, 5);
    expect(s.y).toBeCloseTo(500 + MOVE_UNIT, 1);
    expect(s.speed).toBe(1);
    const ev = sanitizeOrders(g, "p1", [{ shipId: me.id, maneuverId: "m0a0", fire: false, action: { type: "evade" } }]);
    expect(ev[0].action).toBeUndefined();
    // otočení nejde, když loď jede
    me.speed = 2;
    const no = sanitizeOrders(g, "p1", [{ shipId: me.id, maneuverId: "m2a0", fire: false, action: { type: "turn", heading: 1 } }]);
    expect(no[0].action).toBeUndefined();
  });
});

describe("náklad", () => {
  it("zvednutí trosek: dosah, rychlost ≤ 2, kapacita; přetahování vyhrává pomalejší a bližší; náklad váží a jde vyhodit", () => {
    const g = game();
    const me = place(g, "ship-p1-0", 500, 500, 0);
    const foe = place(g, "ship-p2-0", 700, 500, Math.PI);
    g.debris = [{ id: "d1", type: "scanner", x: 600, y: 500, team: 0, value: 65, module: { id: "sc-x", type: "scanner", slot: "left", charges: 2 } }];
    const noFire = (id: string, man: string, action?: import("../src/index.ts").ActionOrder): ShipOrders => ({ shipId: id, maneuverId: man, fire: false, action });
    // oba chtějí d1: já rychlost 2, soupeř rychlost 1 → vyhraje soupeř (pomalejší), i když je stejně daleko
    let r = resolveTurn(g, [noFire(me.id, "m2a0", { type: "pickup", targetId: "d1" }), noFire(foe.id, "m1a0", { type: "pickup", targetId: "d1" })], createRng(1));
    const evs = r.events.filter((e) => e.type === "pickup");
    expect(evs.length).toBe(2);
    expect(evs.some((e) => e.type === "pickup" && e.ok && e.shipId === foe.id)).toBe(true);
    expect(evs.some((e) => e.type === "pickup" && !e.ok && e.reason === "lost" && e.shipId === me.id)).toBe(true);
    expect(r.state.ships[1].loadout.cargo?.length).toBe(1);
    expect(r.state.ships[1].loadout.cargo?.[0].id).toBe("sc-x");
    expect(r.state.debris.length).toBe(0);
    // váha nákladu snižuje rychlost: loď s nákladem má větší váhu
    const before = loadoutWeight(g.ships[1].loadout);
    expect(loadoutWeight(r.state.ships[1].loadout)).toBeGreaterThan(before);
    // rychlost 3 → neúspěch (speed); mimo dosah → range; plný náklad → full
    const g2 = structuredClone(g);
    r = resolveTurn(g2, [noFire(me.id, "m3a0", { type: "pickup", targetId: "d1" }), noFire(foe.id, "m1a0")], createRng(1));
    expect(r.events.some((e) => e.type === "pickup" && !e.ok && e.reason === "speed")).toBe(true);
    expect(r.state.debris.length).toBe(1);
    const g3 = structuredClone(g);
    g3.debris[0].x = 900;
    r = resolveTurn(g3, [noFire(me.id, "m1a0", { type: "pickup", targetId: "d1" }), noFire(foe.id, "m1a0")], createRng(1));
    expect(r.events.some((e) => e.type === "pickup" && !e.ok && e.reason === "range")).toBe(true);
    const g4 = structuredClone(g);
    g4.ships[0].loadout.cargo = [{ id: "c0", type: "mine", slot: "front", ammo: 2 }];
    r = resolveTurn(g4, [noFire(me.id, "m1a0", { type: "pickup", targetId: "d1" }), noFire(foe.id, "m1a0")], createRng(1));
    expect(r.events.some((e) => e.type === "pickup" && !e.ok && e.reason === "full")).toBe(true);
    // vyhození nákladu: modul z carga se stane troskami i s původním id
    r = resolveTurn(g4, [noFire(me.id, "m1a0", { type: "jettison", moduleIds: ["c0"] }), noFire(foe.id, "m1a0")], createRng(1));
    expect(r.state.ships[0].loadout.cargo?.length).toBe(0);
    expect(r.state.debris.some((d) => d.module?.id === "c0")).toBe(true);
    // sanitizace: zvednutí je 1 akce
    expect(actionCost(g.ships[0], noFire(me.id, "m2a0", { type: "pickup", targetId: "d1" }))).toBe(1);
    // zvednutí bez cíle (nic v dosahu) akci nestojí a při vyhodnocení se nic nestane
    expect(actionCost(g.ships[0], noFire(me.id, "m2a0", { type: "pickup" }))).toBe(0);
    const r5 = resolveTurn(g, [noFire(me.id, "m1a0", { type: "pickup" }), noFire(foe.id, "m1a0")], createRng(1));
    expect(r5.events.some((e) => e.type === "pickup")).toBe(false);

    // zvednout + nasadit opravářem: modul jde rovnou do volného slotu (za technologii), náklad může být plný
    const g6 = structuredClone(g);
    const me6 = g6.ships[0];
    me6.loadout.modules = me6.loadout.modules.filter((x) => x.slot !== "back");
    me6.loadout.modules.push({ id: "rep", type: "repair", slot: "left" });
    me6.loadout.cargo = [{ id: "c0", type: "mine", slot: "front", ammo: 2 }];
    me6.techPoints = 3;
    const san = sanitizeOrders(g6, "p1", [noFire(me.id, "m1a0", { type: "pickup", targetId: "d1", installSlot: "back" })]);
    expect(san[0].action).toEqual({ type: "pickup", targetId: "d1", installSlot: "back" });
    r = resolveTurn(g6, [san[0], noFire(foe.id, "m3a0")], createRng(1));
    expect(r.state.ships[0].loadout.modules.some((x) => x.id === "sc-x" && x.slot === "back")).toBe(true);
    expect(r.state.ships[0].loadout.cargo?.length).toBe(1);
    expect(r.state.ships[0].techPoints).toBe(2);
    // bez opraváře se installSlot zahodí (obyčejné zvednutí)
    const g7 = structuredClone(g);
    const san7 = sanitizeOrders(g7, "p1", [noFire(me.id, "m1a0", { type: "pickup", targetId: "d1", installSlot: "back" })]);
    expect((san7[0].action as { installSlot?: string }).installSlot).toBeUndefined();
  });
});

describe("životy modulů a výpad modulů", () => {
  it("zásah laserem zepředu poškodí modul na přídi; při 0 hp přestane fungovat", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, Math.PI); // nos proti nosu – p1 střílí do přídě p2
    const target = g.ships[1];
    target.shieldType = "none";
    target.segments = [0, 0, 0, 0];
    const frontMod = target.loadout.modules.find((m) => m.slot === "front")!;
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(3));
    const dmgEvents = r.events.filter((e) => e.type === "moduleDamage");
    if (r.events.some((e) => e.type === "laser" && e.damage > 0)) {
      expect(dmgEvents.length).toBeGreaterThan(0);
      expect(dmgEvents.every((e) => e.type === "moduleDamage" && e.moduleId === frontMod.id)).toBe(true);
    }
    // ručně: modul na 0 hp → nefunguje a nepočítá se do statistik
    const after = r.state.ships[1];
    const fm = after.loadout.modules.find((m) => m.id === frontMod.id)!;
    fm.hp = 0;
    expect(moduleWorking(fm)).toBe(false);
    expect(computeStats(after.loadout).torpedoes + computeStats(after.loadout).mines).toBeLessThanOrEqual(computeStats(DEFAULT_LOADOUT).torpedoes + computeStats(DEFAULT_LOADOUT).mines);
  });

  it("ze zničené lodi vypadnou moduly jako trosky (šance na modul)", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 640, 500, Math.PI);
    const t = g.ships[1];
    t.hull = 1;
    t.shieldType = "none";
    t.segments = [0, 0, 0, 0];
    let dropped = 0;
    let runs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(seed));
      if (!r.events.some((e) => e.type === "destroyed")) continue;
      runs++;
      const drops = r.events.filter((e) => e.type === "jettison" && e.dropped);
      dropped += drops.length;
      expect(drops.length).toBeLessThanOrEqual(t.loadout.modules.length);
      expect(r.state.debris.length).toBe(drops.length);
    }
    expect(runs).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
  });

  it("ze zničeného bota vypadne vždy právě jeden funkční modul", () => {
    const g = game();
    g.players.find((p) => p.id === "p2")!.isBot = true;
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 640, 500, Math.PI);
    const t = g.ships[1];
    t.hull = 1;
    t.shieldType = "none";
    t.segments = [0, 0, 0, 0];
    t.loadout.modules[0].hp = 0; // zničený modul nevypadne
    let runs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(seed));
      if (!r.events.some((e) => e.type === "destroyed")) continue;
      runs++;
      const drops = r.events.filter((e) => e.type === "jettison" && e.dropped);
      expect(drops.length).toBe(1);
      expect(r.state.debris[0].module?.id).not.toBe(t.loadout.modules[0].id);
    }
    expect(runs).toBeGreaterThan(0);
  });
});

describe("obchod s výbavou mezi bitvami", () => {
  it("nákup za plnou cenu, vrácení nového za plnou, prodej použitého a zničeného za část; dokoupení munice levnější než výměna", () => {
    const base = structuredClone(DEFAULT_LOADOUT);
    // nákup kulometu
    const withMg = { ...base, modules: [...base.modules, { id: "x1", type: "mg" as const, slot: "right" as const, facing: "right" as const, ammo: 100 }] };
    const buy = applyLoadoutTrade(base, withMg);
    expect(buy.error).toBeUndefined();
    expect(buy.cost).toBe(MODULES.mg.price);
    // vrácení nového = plná cena zpět
    const back = applyLoadoutTrade(buy.loadout, base);
    expect(back.cost).toBe(-MODULES.mg.price);
    // po bitvě: použité moduly, torpéda vystřílená, jeden modul zničený
    const after = settleLoadoutAfterBattle({ ...base, modules: base.modules.map((m) => (m.type === "torpedo" ? { ...m, ammo: 0 } : m.type === "laser" ? { ...m, hp: 0 } : m)) });
    const torp = after.modules.find((m) => m.type === "torpedo")!;
    const laser = after.modules.find((m) => m.type === "laser")!;
    expect(moduleSellPrice(laser)).toBe(Math.round((MODULES.laser.price * RULES.brokenSellPct) / 100));
    expect(moduleSellPrice(torp)).toBe(Math.round((MODULES.torpedo.price * RULES.usedSellPct) / 100));
    // dokoupení munice
    const refilled = { ...after, modules: after.modules.map((m) => (m.id === torp.id ? { ...m, ammo: MODULES.torpedo.ammo } : m)) };
    const refill = applyLoadoutTrade(after, refilled);
    expect(refill.error).toBeUndefined();
    expect(refill.cost).toBe(ammoRefillCost(torp));
    // levnější než prodat prázdný použitý a koupit nový
    expect(refill.cost).toBeLessThan(MODULES.torpedo.price - moduleSellPrice(torp));
    // hp / used nejde podvrhnout
    const cheat = applyLoadoutTrade(after, { ...after, modules: after.modules.map((m) => ({ ...m, hp: undefined, used: undefined })) });
    expect(cheat.loadout.modules.find((m) => m.id === laser.id)!.hp).toBe(0);
    expect(cheat.cost).toBe(0);
  });
});

describe("cíl částečně ve výseči", () => {
  it("loď s okrajem v dostřelu jde zaměřit, šance se násobí podílem v dosahu; loď celá mimo ne", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const me = g.ships[0];
    place(g, "ship-p1-0", 500, 500, 0);
    // střed 10 za hranicí dostřelu (300), ale kolizní kruhy do výseče zasahují
    place(g, "ship-p2-0", 810, 500, Math.PI);
    const full = laserOdds({ ...me, x: 500, y: 500 } as typeof me, { ...g.ships[1], x: 700 } as typeof me);
    const part = laserOdds(me, g.ships[1]);
    expect(part.coverage).toBeGreaterThan(0);
    expect(part.coverage).toBeLessThan(1);
    expect(part.hitChance).toBeLessThan(full.hitChance);
    expect(laserTarget(g, me)?.id).toBe("ship-p2-0");
    let fired = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(seed));
      const ev = r.events.find((e) => e.type === "laser");
      if (ev && ev.type === "laser") {
        fired++;
        expect(ev.coverage).toBeCloseTo(part.coverage, 5);
      }
    }
    expect(fired).toBe(20);
    // celá mimo → žádný cíl
    place(g, "ship-p2-0", 900, 500, Math.PI);
    expect(laserTarget(g, me)).toBeUndefined();
  });
});

describe("droid – pilot", () => {
  it("overdrive: otočka za 1 akci bez stresu, nebezpečný bez poškození; autopilot: zelený +2 stres; platí se technologií při vyhodnocení", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const me = g.ships[0];
    me.loadout.modules = [newModule("droid", "left", "dr")];
    me.speed = 3;
    me.stressPoints = 0; // bez stresu by otočka (červená) nešla
    place(g, "ship-p1-0", 1500, 1000, 0);
    place(g, "ship-p2-0", 3000, 1800, Math.PI);
    // bez overdrivu: otočka = 2 akce, nejde bez stresu
    expect(actionCost(me, { shipId: me.id, maneuverId: "k3", fire: false })).toBe(2);
    expect(canAfford(me, resolveManeuver(profileOf(me.loadout), "k3", 3)!)).toBe(false);
    // s overdrivem: 1 akce a jde
    const oo = { shipId: me.id, maneuverId: "k3", fire: false, droid: { overdrive: true } };
    expect(actionCost(me, oo)).toBe(1);
    expect(canAfford(me, resolveManeuver(profileOf(me.loadout), "k3", 3)!, oo)).toBe(true);
    const san = sanitizeOrders(g, "p1", [oo]);
    expect(san[0].maneuverId).toBe("k3");
    expect(san[0].droid?.overdrive).toBe(true);
    let r = resolveTurn(g, [san[0], { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    const ev = r.events.find((e) => e.type === "droid");
    expect(ev && ev.type === "droid" && ev.cost).toBe(DROID.overdriveCost);
    expect(r.state.ships[0].techPoints).toBe(6 - DROID.overdriveCost);
    expect(r.state.ships[0].stressPoints).toBe(0); // otočka nic nestála
    expect(r.state.ships[0].hull).toBe(100);
    // bez technologie se droid vypne a otočka spadne na výchozí manévr
    const g2 = structuredClone(g);
    g2.ships[0].techPoints = 1;
    expect(sanitizeOrders(g2, "p1", [oo])[0].droid).toBeUndefined();
    expect(sanitizeOrders(g2, "p1", [oo])[0].maneuverId).not.toBe("k3");
    // autopilot: zelený manévr (rovně 2) vrátí +2
    const g3 = structuredClone(g);
    g3.ships[0].stressPoints = 0;
    g3.ships[0].speed = 2;
    r = resolveTurn(g3, [{ shipId: me.id, maneuverId: "m2a0", fire: false, droid: { autopilot: true } }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.state.ships[0].stressPoints).toBe(DROID.autopilotRegen);
    expect(r.state.ships[0].techPoints).toBe(6 - DROID.autopilotCost);
  });
});

describe("droid – overdrive a váha", () => {
  it("s overdrivem rychlost v kole ignoruje váhu, příští kolo limit zase platí", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 2 } });
    g.asteroids = [];
    const me = g.ships[0];
    me.loadout.modules = [newModule("droid", "left", "dr"), newModule("laser", "front", "l1"), newModule("laser", "right", "l2")];
    place(g, "ship-p1-0", 500, 1000, 0);
    place(g, "ship-p2-0", 3000, 1800, Math.PI);
    const limited = profileOf(me.loadout).maxSpeed;
    expect(limited).toBeLessThan(5);
    expect(profileFor(me, { droid: { overdrive: true } }).maxSpeed).toBe(5);
    const o = { shipId: me.id, maneuverId: "m5a0", fire: false, droid: { overdrive: true } };
    expect(sanitizeOrders(g, "p1", [o])[0].maneuverId).toBe("m5a0");
    expect(sanitizeOrders(g, "p1", [{ ...o, droid: undefined }])[0].maneuverId).not.toBe("m5a0");
    const r = resolveTurn(g, [o, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.state.ships[0].speed).toBe(5);
    // další kolo bez overdrivu: rychlost 5 už nejde
    expect(sanitizeOrders(r.state, "p1", [{ shipId: me.id, maneuverId: "m5a0", fire: false }])[0].maneuverId).not.toBe("m5a0");
  });
});

describe("záložní štít", () => {
  it("při zničení zapnutého štítu se v bitvě zapne záložní (plný)", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const me = g.ships[0];
    me.loadout = normalizeShields({ ...me.loadout, modules: [newModule("shield-segment", "front", "s1"), newModule("shield-whole", "back", "s2")] });
    refreshShip(me);
    me.shieldType = "segment";
    me.segments = [2, 2, 2, 2];
    expect(me.loadout.modules.find((m) => m.id === "s2")?.off).toBe(true);
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 640, 500, Math.PI);
    // nepřítel střílí zepředu → zásah poškozuje přední modul (segmentový štít, 40 hp); dáme mu 1 hp
    me.loadout.modules[0].hp = 1;
    me.segments = [0, 0, 0, 0];
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m1a0", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: true }], createRng(3));
    const s = r.state.ships[0];
    const seg = s.loadout.modules.find((m) => m.id === "s1")!;
    if ((seg.hp ?? 1) <= 0) {
      expect(s.shieldType).toBe("whole");
      expect(s.loadout.modules.find((m) => m.id === "s2")?.off).toBeUndefined();
      expect(s.shields).toBe(s.stats.shields);
    }
  });
});

describe("umístění na mapě", () => {
  const map: MapSettings = { size: "small", asteroids: "few", storms: 0, stormSize: "small", seed: 7, symmetric: false, comets: "none", clusters: false, cometsHitAsteroids: false };
  const base = { mode: "tdm" as const, turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" as const, map };
  const four = [
    { id: "a1", name: "A1", team: 0, isBot: false, startIndex: 3 },
    { id: "a2", name: "A2", team: 0, isBot: false, startIndex: 4 },
    { id: "b1", name: "B1", team: 1, isBot: false, startIndex: 5 },
    { id: "b2", name: "B2", team: 1, isBot: true },
  ];
  it("náhodné: každý hráč jiný startovní bod, zvolené body se ignorují", () => {
    const gen = generateMap(map);
    const g = createGame({ players: four, settings: { ...base, placement: "random" } });
    const idx = g.players.map((p) => p.startIndex!);
    expect(new Set(idx).size).toBe(4);
    for (const s of g.ships) {
      const p = g.players.find((q) => q.id === s.ownerId)!;
      expect(s.x).toBe(gen.starts[p.startIndex!].x);
    }
  });
  it("týmové náhodné: tým sdílí bod, lodě ve formaci vedle sebe, týmy na různých bodech", () => {
    const g = createGame({ players: four, settings: { ...base, placement: "teamRandom" } });
    const a = g.players.filter((p) => p.team === 0).map((p) => p.startIndex);
    const b = g.players.filter((p) => p.team === 1).map((p) => p.startIndex);
    expect(a[0]).toBe(a[1]);
    expect(b[0]).toBe(b[1]);
    expect(a[0]).not.toBe(b[0]);
    const sa = g.ships.filter((s) => s.team === 0);
    expect(Math.hypot(sa[0].x - sa[1].x, sa[0].y - sa[1].y)).toBeCloseTo(16 + 16 + 36, 5);
    expect(sa[0].heading).toBe(sa[1].heading);
  });
  it("týmové ruční: bod určuje velitel (označený, jinak první člověk), ostatní volby se ignorují", () => {
    const gen = generateMap(map);
    const g = createGame({ players: [{ ...four[0] }, { ...four[1], commander: true }, four[2], four[3]], settings: { ...base, placement: "teamManual" } });
    expect(g.players.filter((p) => p.team === 0).every((p) => p.startIndex === 4)).toBe(true);
    expect(g.players.filter((p) => p.team === 1).every((p) => p.startIndex === 5)).toBe(true);
    const sa = g.ships.filter((s) => s.team === 0);
    const mid = { x: (sa[0].x + sa[1].x) / 2, y: (sa[0].y + sa[1].y) / 2 };
    expect(mid.x).toBeCloseTo(gen.starts[4].x, 5);
    expect(mid.y).toBeCloseTo(gen.starts[4].y, 5);
    expect(commanderOf(four, 0)?.id).toBe("a1");
    expect(commanderOf(four, 1)?.id).toBe("b1");
    expect(commanderOf([four[3]], 1)?.id).toBe("b2");
  });
  it("v deathmatchi se týmové varianty chovají jako ne-týmové", () => {
    expect(effectivePlacement({ mode: "dm", placement: "teamManual" })).toBe("manual");
    expect(effectivePlacement({ mode: "dm", placement: "teamRandom" })).toBe("random");
    expect(effectivePlacement({ mode: "tdm", placement: "teamRandom" })).toBe("teamRandom");
    expect(effectivePlacement({ mode: "tdm" })).toBe("random"); // výchozí = náhodné
  });
});

describe("oprava zničeného modulu", () => {
  it("obchod: repair=true u zničeného modulu stojí % ceny a vrátí plné životy; bez repair nejde doplnit munici", () => {
    const prev: ShipLoadout = { hullId: "fighter", pilotId: "kadet", modules: [{ id: "t", type: "torpedo", slot: "front", ammo: 1, hp: 0, used: true, facing: "front" }] };
    const bad = applyLoadoutTrade(prev, { ...prev, modules: [{ ...prev.modules[0], ammo: 3 }] });
    expect(bad.error).toBeTruthy();
    const ok = applyLoadoutTrade(prev, { ...prev, modules: [{ ...prev.modules[0], repair: true }] });
    expect(ok.error).toBeUndefined();
    expect(ok.cost).toBe(Math.round((MODULES.torpedo.price * RULES.repairPct) / 100));
    expect(ok.loadout.modules[0].hp).toBeUndefined();
    expect(ok.loadout.modules[0].repair).toBeUndefined();
    expect(ok.loadout.modules[0].used).toBe(true);
    // oprava + munice najednou
    const both = applyLoadoutTrade(prev, { ...prev, modules: [{ ...prev.modules[0], repair: true, ammo: 3 }] });
    expect(both.error).toBeUndefined();
    expect(both.cost).toBe(ok.cost + Math.ceil(2 * MODULES.torpedo.ammoPrice!));
    // repair u nezničeného modulu nic nestojí
    const fine = applyLoadoutTrade({ ...prev, modules: [{ ...prev.modules[0], hp: undefined }] }, { ...prev, modules: [{ ...prev.modules[0], hp: undefined, repair: true }] });
    expect(fine.cost).toBe(0);
  });
});

describe("série bitev", () => {
  const map: MapSettings = { size: "small", asteroids: "few", storms: 0, stormSize: "small", seed: 7, symmetric: false, comets: "none", clusters: false, cometsHitAsteroids: false };
  it("sanitizeBattles: 2–5 bitev, méně = jedna bitva; currentBattle podle odehraných", () => {
    const fb = { map, turnLimit: 0 };
    expect(sanitizeBattles([{}], undefined, fb)).toBeNull();
    const list = sanitizeBattles([{ map: { ...map, seed: 1 }, turnLimit: 20 }, { turnLimit: 150 }, {}, {}, {}, {}, {}], undefined, fb)!;
    expect(list.length).toBe(SERIES_MAX);
    expect(list[0].map.seed).toBe(1);
    expect(list[0].turnLimit).toBe(20);
    expect(list[1].turnLimit).toBe(99);
    const settings = { mode: "tdm" as const, turnLimit: 5, shipPoints: 1, allowedModules: {}, botLoadout: "default" as const, map, battles: list };
    expect(isSeries(settings)).toBe(true);
    expect(currentBattle(settings, 1).turnLimit).toBe(99);
    expect(currentBattle(settings, 99)).toBe(list[4]);
    expect(currentBattle({ ...settings, battles: undefined }, 3).turnLimit).toBe(5);
  });
  it("battleResult + standings: body 3/1/0, pořadí podle bodů, sestřelů, zranění", () => {
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default", map } });
    g.status = "finished";
    g.result = { winnerTeam: 1, winnerPlayerId: null, reason: "elimination" };
    g.stats!["p2"].kills = 1;
    g.stats!["p2"].damageDealt = 30;
    const r1 = battleResult(g, 0);
    expect(r1.winner).toBe("1");
    expect(r1.sides.sort()).toEqual(["0", "1"]);
    expect(r1.kills["1"]).toBe(1);
    const r2: SeriesBattleResult = { index: 1, winner: null, sides: ["0", "1"], kills: { "0": 2, "1": 0 }, damage: { "0": 50, "1": 10 }, reason: "turnLimit" };
    const st = seriesStandings([r1, r2]);
    expect(st[0].key).toBe("1");
    expect(st[0].points).toBe(4);
    expect(st[1].points).toBe(1);
    expect(seriesWinner([r1, r2])).toBe("1");
    // rovnost bodů: rozhodují sestřely
    const r3: SeriesBattleResult = { index: 2, winner: "0", sides: ["0", "1"], kills: { "0": 1, "1": 0 }, damage: { "0": 10, "1": 0 }, reason: "elimination" };
    expect(seriesWinner([r1, r2, r3])).toBe("0");
    // DM: klíč = id hráče
    const dm = createGame({ players, settings: { mode: "dm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default", map } });
    dm.status = "finished";
    dm.result = { winnerTeam: dm.players[0].team, winnerPlayerId: "p1", reason: "elimination" };
    expect(battleResult(dm, 0).winner).toBe("p1");
  });
});

describe("otočka na konci křivky", () => {
  const P = FIGHTER_PROFILE;
  it("jde od rychlosti 2 s libovolným povoleným úhlem; id a parsování", () => {
    expect(makeManeuver(P, 1, 0, true, 1)).toBeNull();
    const k = makeManeuver(P, 3, -40, true, 3)!;
    expect(k.id).toBe("k3a-40");
    expect(parseManeuverId("k3a-40")).toEqual({ speed: 3, angle: -40, koiogran: true, stop: false });
    expect(parseManeuverId("k3")).toEqual({ speed: 3, angle: 0, koiogran: true, stop: false });
    expect(makeManeuver(P, 5, 60, true, 5)).toBeNull(); // rychlost 5 dovolí jen ±40°
    expect(makeManeuver(P, 5, 40, true, 5)).not.toBeNull();
  });
  it("stres: zelená/bílá křivka 1, červená 2, nebezpečná 3 (a zůstává nebezpečná)", () => {
    const g = makeManeuver(P, 2, 10, true, 2)!; // křivka zelená
    expect(g.base).toBe("green");
    expect(g.difficulty).toBe("red");
    expect(maneuverStress(g)).toBe(STRESS.costRed);
    const w = makeManeuver(P, 4, 10, true, 4)!; // bílá
    expect(maneuverStress(w)).toBe(STRESS.costRed);
    const r = makeManeuver(P, 4, 40, true, 4)!; // oranžová (rychlost 4, 40°)
    expect(r.base).toBe("red");
    expect(maneuverStress(r)).toBe(STRESS.costRed + 1);
    const d = makeManeuver(P, 4, 40, true, 2)!; // nebezpečná (změna o 2 + ostrý)
    expect(d.difficulty).toBe("danger");
    expect(maneuverStress(d)).toBe(STRESS.costDanger + 1);
    expect(effStressCost(d, { droid: { overdrive: true } })).toBe(0);
  });
  it("dráha: křivka a na konci otočení o 180°, pak pokles rychlosti", () => {
    const k = makeManeuver(P, 3, 60, true, 3)!;
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, k);
    const plain = maneuverEnd({ x: 0, y: 0, heading: 0 }, makeManeuver(P, 3, 60, false, 3)!);
    expect(end.x).toBeCloseTo(plain.x, 5);
    expect(end.y).toBeCloseTo(plain.y, 5);
    expect(Math.abs(((end.heading - plain.heading) % (Math.PI * 2)) - Math.PI)).toBeLessThan(1e-9);
    const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    const me = g.ships[0];
    me.speed = 3;
    me.stressPoints = 3;
    const r = resolveTurn(g, [{ shipId: me.id, maneuverId: "k3a60", fire: false }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    const s = r.state.ships[0];
    expect(s.speed).toBe(Math.max(1, 3 - RULES.koiogranSpeedDrop));
    expect(s.stressPoints).toBe(3 - STRESS.costRed);
  });
});

describe("více zbraní v kole", () => {
  it("dva lasery = dvě akce, každý vlastní cíl; střílí z pozice modulu na trupu", () => {
    const g = createGame({ players: [...players, { id: "p3", name: "Gama", team: 1, isBot: false }], settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g.asteroids = [];
    g.storms = [];
    const me = g.ships.find((s) => s.ownerId === "p1")!;
    me.loadout.modules = [newModule("laser", "front", "la"), { ...newModule("laser", "right", "lb"), facing: "right" as const }];
    place(g, me.id, 500, 500, 0); // míří doprava (+x); pravobok = +y
    place(g, "ship-p2-0", 680, 500, Math.PI); // před přídí
    place(g, "ship-p3-0", 500, 680, -Math.PI / 2); // po pravoboku
    const man = defaultOrders(me).maneuverId;
    const orders = [{ shipId: me.id, maneuverId: man, shots: [{ moduleId: "la", targetId: "ship-p2-0" }, { moduleId: "lb", targetId: "ship-p3-0" }] }, { shipId: "ship-p2-0", maneuverId: "m1a0", shots: [] }, { shipId: "ship-p3-0", maneuverId: "m1a0", shots: [] }];
    const fixed = sanitizeOrders(g, "p1", [orders[0]]);
    expect(fixed[0].shots!.length).toBe(2);
    expect(actionCost(me, fixed[0])).toBe(2);
    const r = resolveTurn(g, orders, createRng(3));
    const lasers = r.events.filter((e): e is Extract<TurnEvent, { type: "laser" }> => e.type === "laser" && e.shooterId === me.id);
    expect(lasers.map((e) => e.targetId).sort()).toEqual(["ship-p2-0", "ship-p3-0"]);
    // přední laser střílí z přídě (x > 500), boční z pravoboku (y > 500)
    const front = lasers.find((e) => e.targetId === "ship-p2-0")!;
    const side = lasers.find((e) => e.targetId === "ship-p3-0")!;
    expect(front.from.x).toBeGreaterThan(505);
    expect(Math.abs(front.from.y - 500)).toBeLessThan(1);
    expect(side.from.y).toBeGreaterThan(505);
    // třetí střela (stejný modul podruhé) se zahodí, přes limit akcí odpadají od konce
    const dup = sanitizeOrders(g, "p1", [{ shipId: me.id, maneuverId: man, shots: [{ moduleId: "la" }, { moduleId: "la" }, { moduleId: "lb" }], special: { type: "mine" } }]);
    expect(dup[0].shots!.map((s) => s.moduleId)).toEqual(["la", "lb"]);
    expect(actionCost(me, dup[0])).toBeLessThanOrEqual(RULES.actionPoints);
  });
});
