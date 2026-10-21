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
  generateMap,
  newModule,
  actionCost,
  classifyManeuver,
  carveCrater,
  circleHitsAsteroid,
  createGame,
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
    expect(classifyManeuver(P, 2, 15, false, 2)).toBe("green");
    expect(classifyManeuver(P, 3, 45, false, 2)).toBe("white");
    expect(classifyManeuver(P, 3, 90, false, 2)).toBe("red");
    expect(classifyManeuver(P, 4, 0, false, 2)).toBe("red");
    expect(classifyManeuver(P, 4, 45, false, 2)).toBe("danger");
    expect(classifyManeuver(P, 5, 60, false, 5)).toBeNull(); // nad limit úhlu
    expect(classifyManeuver(P, 3, 0, true, 3)).toBe("red");
    expect(classifyManeuver(P, 3, 0, true, 1)).toBe("danger");
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

  it("čelní srážka obě lodě odmrští, zraní a zruší akce – lodě nezůstanou stát", () => {
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
    // lodě se od sebe odrazily a pokračovaly – nekončí v bodě srážky
    expect(Math.hypot(a.x - 500, a.y - 500)).toBeGreaterThan(30);
    expect(Math.hypot(b.x - 600, b.y - 500)).toBeGreaterThan(30);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(32);
    expect(a.tokens.focus).toBe(0);
    expect(r.events.some((e) => e.type === "action" && e.ok === false)).toBe(true);
  });

  it("náraz do asteroidu loď odmrští, zraní a letí dál", () => {
    const g = game({ asteroids: [ast("a", 700, 500, 40)] });
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 900, 0);
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m4a0", fire: false }], createRng(1));
    const s = r.state.ships[0];
    const col = r.events.find((e) => e.type === "collision");
    expect(col && col.type === "collision" && col.with).toBe("asteroid");
    expect(Math.hypot(s.x - 700, s.y - 500)).toBeGreaterThan(40 + 16 - 2);
    expect(s.hull).toBe(100);
    expect(r.events.some((e) => e.type === "damage" && e.shipId === "ship-p1-0" && e.amount === 15)).toBe(true);
    // loď po odrazu pokračovala v pohybu novým kurzem
    const move = r.events[0];
    const pts = move.type === "move" ? move.paths.find((p) => p.id === "ship-p1-0")!.points : [];
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    expect(Math.hypot(last.x - prev.x, last.y - prev.y)).toBeGreaterThan(1);
  });

  it("okraj mapy odmrští loď zpět do mapy", () => {
    const g = game();
    place(g, "ship-p1-0", 60, 500, Math.PI);
    place(g, "ship-p2-0", 1500, 900, 0);
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m3a0", fire: false }], createRng(1));
    expect(r.state.ships[0].x).toBeGreaterThanOrEqual(16);
    expect(r.events.some((e) => e.type === "collision" && e.with === "edge")).toBe(true);
    expect(Math.abs(r.state.ships[0].heading)).toBeLessThan(Math.PI / 2 + 0.8);
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
    // z rychlosti 3 na 5 s ostrým úhlem = nebezpečný: −2 body + 5 % trupu
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m5a45", fire: false }], createRng(1));
    expect(r.state.ships[0].stressPoints).toBe(0);
    expect(r.events.some((e) => e.type === "damage" && e.shipId === "ship-p1-0" && e.amount === 5)).toBe(true);
    // bez bodů: červený manévr sanitizace nahradí
    const fixed = sanitizeOrders(r.state, "p1", [{ shipId: "ship-p1-0", maneuverId: "m5a45", fire: true }]);
    expect(fixed[0].maneuverId).not.toBe("m5a45");
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
        if ((dmg.absorbed ?? 0) > 0) expect(dmg.hullAfter).toBe(100);
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
    expect(actionCost(ship, { shipId: ship.id, maneuverId: "m2a15", fire: true })).toBe(2);
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
    place(g, "ship-p2-0", 1040, 440, Math.PI / 2); // bude u bodu výbuchu, mimo dráhu torpéda
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
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "m5a0", fire: false }], createRng(1));
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
        { shipId: "ship-p2-0", maneuverId: "m3a15", fire: false, special: { type: "torpedo", targetId: "ship-p1-0" } },
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
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "m2a0", fire: false, action: { type: "jettison", moduleId: mineMod.id } }], createRng(1));
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
    let r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m2a0", fire: false }], createRng(1));
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
    // průlet ocasem komety: +COMET.tailTech (do stropu)
    const g3 = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default" }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
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
    const g = createGame({ players: [{ ...players[0], startIndex: 0 }, { ...players[1], startIndex: 5 }], settings: { mode: "tdm", turnLimit: 0, shipPoints: 1, allowedModules: {}, botLoadout: "default", map }, tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
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
    let r = resolveTurn(g, [{ shipId: me.id, maneuverId: "m1a0", fire: false, fireMg: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
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
    r = resolveTurn(g2, [{ shipId: me.id, maneuverId: "m1a0", fire: false, fireMg: true }, { shipId: "ship-p2-0", maneuverId: "m1a0", fire: false }], createRng(1));
    expect(r.state.ships[1].shieldEff).toBe(0); // 10 zásahů × −10 %
    expect(r.state.ships[1].hull).toBeLessThan(100);
    // kulomet není akce zdarma: s laserem a torpédem (2 akce) se neschválí
    me.loadout.modules.push(newModule("laser", "left", "l1"), newModule("torpedo", "back", "t1"));
    const fixed = sanitizeOrders(g, "p1", [{ shipId: me.id, maneuverId: "m1a0", fire: true, fireMg: true, special: { type: "torpedo", point: { x: 900, y: 500 } } }]);
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
    const edgePt = { x: c.x + f.x * COMET.speed * COMET.approachTurns, y: c.y + f.y * COMET.speed * COMET.approachTurns };
    const onEdge = Math.abs(edgePt.x - c.radius) < 1e-6 || Math.abs(edgePt.y - c.radius) < 1e-6 || Math.abs(edgePt.x - (g.width - c.radius)) < 1e-6 || Math.abs(edgePt.y - (g.height - c.radius)) < 1e-6;
    expect(onEdge).toBe(true);
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
    // kometa mířící ven zmizí
    const g2 = createGame({ players, settings: settingsWith("none"), tuning: { ...DEFAULT_TUNING, weightPerSpeed: 100 } });
    g2.asteroids = [];
    g2.comets = [{ ...cometAt(g2.width - 20, 500, 0), entered: true }];
    r = resolveTurn(g2, noOrders(g2), createRng(1));
    expect(r.state.comets!.length).toBe(0);
    expect(r.events.some((e) => e.type === "cometGone" && e.reason === "edge")).toBe(true);
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
    r = resolveTurn(g4, [noFire(me.id, "m1a0", { type: "jettison", moduleId: "c0" }), noFire(foe.id, "m1a0")], createRng(1));
    expect(r.state.ships[0].loadout.cargo?.length).toBe(0);
    expect(r.state.debris.some((d) => d.module?.id === "c0")).toBe(true);
    // sanitizace: zvednutí je 1 akce
    expect(actionCost(g.ships[0], noFire(me.id, "m2a0", { type: "pickup", targetId: "d1" }))).toBe(1);
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
    expect(Math.hypot(sa[0].x - sa[1].x, sa[0].y - sa[1].y)).toBeCloseTo(60, 5);
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
    expect(effectivePlacement({ mode: "tdm" })).toBe("manual");
  });
});
