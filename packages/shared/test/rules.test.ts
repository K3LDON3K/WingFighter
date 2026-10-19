import { describe, expect, it } from "vitest";
import {
  actionCost,
  classifyManeuver,
  carveCrater,
  circleHitsAsteroid,
  createGame,
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

function game(overrides?: Partial<GameState>): GameState {
  const g = createGame({ players, settings: { mode: "tdm", turnLimit: 0, shipsPerPlayer: 1 } });
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
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "k3", fire: false, action: { type: "evade" } }], createRng(1));
    expect(r.state.ships[0].stressPoints).toBe(2);
    expect(r.state.ships[0].tokens.evade).toBe(0); // tokeny se čistí na konci kola, ale akce proběhla:
    expect(r.events.some((e) => e.type === "action" && e.ok)).toBe(true);
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

  it("torpédo startuje hned s pohybem a zasáhne cíl v témže kole", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 800, 500, Math.PI);
    const r = resolveTurn(
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
    const hit = r.events.find((e) => e.type === "torpedoHit");
    expect(hit && hit.type === "torpedoHit" && hit.shipId).toBe("ship-p2-0");
    expect(r.state.torpedoes).toHaveLength(0);
    // 45 zranění: štít 50 → 5, trup 100; dobití → štít 15
    expect(r.state.ships[1].hull).toBe(100);
    expect(r.state.ships[1].shields).toBe(15);
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
    place(g, "ship-p2-0", 1300, 500, Math.PI);
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
    const g = createGame({ players: [...players, { id: "p3", name: "Gama", team: 0, isBot: false }], settings: { mode: "tdm", turnLimit: 0, shipsPerPlayer: 1 } });
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

  it("bitva mezi boty skončí", () => {
    const bots: PlayerInfo[] = [
      { id: "b1", name: "Bot 1", team: 0, isBot: true },
      { id: "b2", name: "Bot 2", team: 1, isBot: true },
      { id: "b3", name: "Bot 3", team: 2, isBot: true },
    ];
    let g = createGame({ players: bots, settings: { mode: "tdm", turnLimit: 40, shipsPerPlayer: 2 } });
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
    const g = createGame({ players: [...players, { id: "p3", name: "Gama", team: 0, isBot: false }], settings: { mode: "dm", turnLimit: 0, shipsPerPlayer: 1 } });
    expect(new Set(g.ships.map((s) => s.team)).size).toBe(3);
    for (const s of g.ships) if (s.ownerId !== "p3") s.alive = false;
    const r = resolveTurn(g, [], createRng(1));
    expect(r.state.status).toBe("finished");
    expect(r.state.result?.winnerPlayerId).toBe("p3");
  });
});
