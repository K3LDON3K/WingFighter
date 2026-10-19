import { describe, expect, it } from "vitest";
import {
  createGame,
  createRng,
  FIGHTER_DIAL,
  findManeuver,
  maneuverEnd,
  MINE,
  MOVE_UNIT,
  planBot,
  resolveAttack,
  resolveTurn,
  sanitizeOrders,
  TORPEDO,
  type GameState,
  type PlayerInfo,
  type ShipOrders,
} from "../src/index.ts";

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

describe("manévry", () => {
  it("rovně 3 posune loď o 3 dílky ve směru kurzu", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, findManeuver(FIGHTER_DIAL, "straight-3")!);
    expect(end.x).toBeCloseTo(3 * MOVE_UNIT);
    expect(end.y).toBeCloseTo(0);
    expect(end.heading).toBeCloseTo(0);
  });
  it("zatáčka vpravo otočí o 90° a posune doprava-dolů", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, findManeuver(FIGHTER_DIAL, "turn-2-right")!);
    expect(end.heading).toBeCloseTo(Math.PI / 2);
    expect(end.x).toBeGreaterThan(0);
    expect(end.y).toBeGreaterThan(0);
  });
  it("zatáčka vlevo otočí o -90° a posune nahoru", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, findManeuver(FIGHTER_DIAL, "turn-2-left")!);
    expect(end.heading).toBeCloseTo(-Math.PI / 2);
    expect(end.y).toBeLessThan(0);
  });
  it("otočka posune rovně a otočí o 180°", () => {
    const end = maneuverEnd({ x: 0, y: 0, heading: 0 }, findManeuver(FIGHTER_DIAL, "koiogran-3")!);
    expect(end.x).toBeCloseTo(3 * MOVE_UNIT);
    expect(Math.abs(end.heading)).toBeCloseTo(Math.PI);
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
  it("lodě se pohnou a kolo se zvýší", () => {
    const g = game();
    const orders: ShipOrders[] = g.ships.map((s) => ({ shipId: s.id, maneuverId: "straight-2", fire: false }));
    const r = resolveTurn(g, orders, createRng(1));
    expect(r.state.turn).toBe(2);
    const s = r.state.ships.find((x) => x.id === "ship-p1-0")!;
    expect(s.x).toBeCloseTo(150 + 2 * MOVE_UNIT);
    expect(r.events[0].type).toBe("move");
  });

  it("čelní srážka zastaví obě lodě a zruší akce", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 600, 500, Math.PI);
    const orders: ShipOrders[] = [
      { shipId: "ship-p1-0", maneuverId: "straight-3", fire: false, action: { type: "focus" } },
      { shipId: "ship-p2-0", maneuverId: "straight-3", fire: false, action: { type: "focus" } },
    ];
    const r = resolveTurn(g, orders, createRng(1));
    const a = r.state.ships[0];
    const b = r.state.ships[1];
    expect(a.x).toBeLessThan(600);
    expect(b.x).toBeGreaterThan(500);
    expect(b.x - a.x).toBeGreaterThanOrEqual(32 - 1e-6);
    expect(r.events.filter((e) => e.type === "collision")).toHaveLength(2);
    expect(a.tokens.focus).toBe(0);
    expect(r.events.some((e) => e.type === "action" && e.ok === false)).toBe(true);
  });

  it("náraz do asteroidu zastaví loď a dá 1 zranění do štítů", () => {
    const g = game({ asteroids: [{ id: "a", x: 700, y: 500, radius: 40, vx: 0, vy: 0, seed: 1 }] });
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 900, 0);
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "straight-5", fire: false }], createRng(1));
    const s = r.state.ships[0];
    expect(s.x).toBeLessThan(700 - 40 - 16 + 1e-6);
    // štít 2 → -1 zranění → 1, pak dobití +1 → 2; trup beze změny
    expect(s.hull).toBe(3);
    expect(r.events.some((e) => e.type === "damage" && e.shipId === "ship-p1-0" && e.amount === 1)).toBe(true);
  });

  it("loď dotýkající se asteroidu se od něj může odlepit", () => {
    const g = game({ asteroids: [{ id: "a", x: 700, y: 500, radius: 40, vx: 0, vy: 0, seed: 1 }] });
    place(g, "ship-p1-0", 700 - 40 - 16, 500, 0); // přesně na dotek
    place(g, "ship-p2-0", 1500, 900, 0);
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "turn-2-left", fire: false }], createRng(1));
    expect(r.events.some((e) => e.type === "collision")).toBe(false);
    expect(r.state.ships[0].y).toBeLessThan(450);
  });

  it("okraj mapy funguje jako překážka", () => {
    const g = game();
    place(g, "ship-p1-0", 60, 500, Math.PI);
    place(g, "ship-p2-0", 1500, 900, 0);
    const r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "straight-5", fire: false }], createRng(1));
    expect(r.state.ships[0].x).toBeGreaterThanOrEqual(16);
    expect(r.events.some((e) => e.type === "collision" && e.with === "edge")).toBe(true);
  });

  it("laser zasáhne cíl ve výseči a v dostřelu, cíl mimo výseč ne", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 700, 500, 0); // 110 px po pohybu p1 rovně 2 → stále ve výseči
    const orders: ShipOrders[] = [
      { shipId: "ship-p1-0", maneuverId: "straight-2", fire: true },
      { shipId: "ship-p2-0", maneuverId: "straight-1", fire: true }, // míří pryč, p1 za ní → nestřílí
    ];
    const r = resolveTurn(g, orders, createRng(7));
    const lasers = r.events.filter((e) => e.type === "laser");
    expect(lasers).toHaveLength(1);
    expect(lasers[0].type === "laser" && lasers[0].shooterId).toBe("ship-p1-0");
  });

  it("červený manévr dá stres a zablokuje akci; zelený ho odstraní", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 1500, 900, 0);
    let r = resolveTurn(g, [{ shipId: "ship-p1-0", maneuverId: "koiogran-3", fire: false, action: { type: "evade" } }], createRng(1));
    expect(r.state.ships[0].stress).toBe(1);
    expect(r.state.ships[0].tokens.evade).toBe(0);
    // stresovaná loď nesmí červený manévr – sanitizace ho nahradí
    const fixed = sanitizeOrders(r.state, "p1", [{ shipId: "ship-p1-0", maneuverId: "turn-3-left", fire: true }]);
    expect(fixed[0].maneuverId).not.toBe("turn-3-left");
    r = resolveTurn(r.state, [{ shipId: "ship-p1-0", maneuverId: "straight-1", fire: false }], createRng(1));
    expect(r.state.ships[0].stress).toBe(0);
  });

  it("torpédo se vypustí, letí a zasáhne stojící cíl", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 800, 500, Math.PI); // 300 px, v zaměřovacím dostřelu
    let r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "straight-1", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } },
        { shipId: "ship-p2-0", maneuverId: "straight-1", fire: false },
      ],
      createRng(1),
    );
    expect(r.state.torpedoes).toHaveLength(1);
    expect(r.state.ships[0].ammo.torpedoes).toBe(2);
    // další kolo: p2 letí proti torpédu
    r = resolveTurn(
      r.state,
      [
        { shipId: "ship-p1-0", maneuverId: "bank-1-left", fire: false },
        { shipId: "ship-p2-0", maneuverId: "straight-1", fire: false },
      ],
      createRng(1),
    );
    const hit = r.events.find((e) => e.type === "torpedoHit");
    expect(hit && hit.type === "torpedoHit" && hit.shipId).toBe("ship-p2-0");
    expect(r.state.torpedoes).toHaveLength(0);
    const target = r.state.ships[1];
    // 3 zranění: štít 2 → 0, trup 3 → 2; dobití → štít 1
    expect(target.hull).toBe(2);
    expect(target.shields).toBe(1);
  });

  it("torpédo bez cíle vyprší po životnosti", () => {
    const g = game();
    place(g, "ship-p1-0", 100, 100, 0);
    place(g, "ship-p2-0", 400, 100, 0);
    let r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "straight-1", fire: false, special: { type: "torpedo", targetId: "ship-p2-0" } },
        { shipId: "ship-p2-0", maneuverId: "straight-5", fire: false },
      ],
      createRng(1),
    );
    let turns = 0;
    while (r.state.torpedoes.length && turns < 10) {
      r = resolveTurn(
        r.state,
        r.state.ships.filter((s) => s.alive).map((s) => ({ shipId: s.id, maneuverId: "straight-5", fire: false })),
        createRng(1),
      );
      turns++;
    }
    expect(turns).toBeLessThanOrEqual(TORPEDO.lifeTurns);
    expect(r.state.torpedoes).toHaveLength(0);
  });

  it("mina se položí na startovní pozici, aktivuje se další kolo a zraní všechny v poli", () => {
    const g = game();
    place(g, "ship-p1-0", 500, 500, 0);
    place(g, "ship-p2-0", 500 + 2 * MOVE_UNIT + 40, 500, Math.PI);
    let r = resolveTurn(
      g,
      [
        { shipId: "ship-p1-0", maneuverId: "straight-1", fire: false, special: { type: "mine" } },
        { shipId: "ship-p2-0", maneuverId: "turn-1-left", fire: false },
      ],
      createRng(1),
    );
    expect(r.state.mines).toHaveLength(1);
    expect(r.state.mines[0].x).toBeCloseTo(500);
    expect(r.state.mines[0].armed).toBe(true);
    expect(r.state.ships[0].ammo.mines).toBe(1);
    // p1 se otočí a vletí zpět do vlastní miny
    r = resolveTurn(
      r.state,
      [
        { shipId: "ship-p1-0", maneuverId: "koiogran-3", fire: false },
        { shipId: "ship-p2-0", maneuverId: "straight-1", fire: false },
      ],
      createRng(1),
    );
    // po otočce loď míří zpět, ale teprve příští kolo se vrátí; ověříme, že mina dosud stojí
    expect(r.state.mines).toHaveLength(1);
    r = resolveTurn(
      r.state,
      [
        { shipId: "ship-p1-0", maneuverId: "straight-5", fire: false },
        { shipId: "ship-p2-0", maneuverId: "straight-1", fire: false },
      ],
      createRng(1),
    );
    const blast = r.events.find((e) => e.type === "mineBlast");
    expect(blast).toBeTruthy();
    expect(blast!.type === "mineBlast" && blast!.hits.some((h) => h.shipId === "ship-p1-0" && h.damage === MINE.damage)).toBe(true);
    expect(r.state.mines).toHaveLength(0);
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
    expect(g.result).toBeTruthy();
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
