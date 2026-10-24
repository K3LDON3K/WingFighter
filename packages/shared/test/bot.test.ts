import { describe, expect, it } from "vitest";
import { createGame, createRng, planBot, plannedPaths, sanitizeOrders, actionCost, maneuverPath, listManeuvers, profileOf, circlesOverlap, DEFAULT_LOADOUT, DEFAULT_MAP, DEFAULT_TUNING, _ai, type GameState } from "../src/index.ts";

function setup(): GameState {
  const players = [{ id: "A", name: "A", team: 0, isBot: true, loadouts: [structuredClone(DEFAULT_LOADOUT)] }, { id: "B", name: "B", team: 1, isBot: true, loadouts: [structuredClone(DEFAULT_LOADOUT)] }];
  const g = createGame({ players, settings: { mode: "tdm", turnLimit: 40, shipPoints: 1, allowedModules: {}, botLoadout: "default", map: { ...DEFAULT_MAP, size: "small", seed: 5, storms: 0, asteroids: "none" } }, tuning: DEFAULT_TUNING });
  g.asteroids = [];
  g.storms = [];
  return g;
}

describe("boti – obtížnosti", () => {
  it("Pilot: střílí laserem na nepřítele ve výseči a dává platné rozkazy v limitu akcí", () => {
    const g = setup();
    const [A, B] = g.ships;
    A.x = 1000; A.y = 800; A.heading = 0;
    B.x = 1150; B.y = 800; B.heading = Math.PI;
    for (const level of ["kadet", "pilot", "eso"] as const) {
      const orders = planBot(g, "A", createRng(1), level);
      expect(orders.length).toBe(1);
      const fixed = sanitizeOrders(g, "A", orders)[0];
      expect(actionCost(A, fixed)).toBeLessThanOrEqual(2);
      if (level !== "kadet") expect(fixed.shots!.some((s) => s.targetId === B.id) || (fixed.special?.type === "torpedo" && fixed.special.targetId === B.id)).toBe(true);
    }
  });
  it("Pilot: přerozdělí segmenty štítu směrem k hrozbě", () => {
    const g = setup();
    const [A, B] = g.ships;
    A.x = 1000; A.y = 800; A.heading = 0;
    A.segments = [1, 1, 1, 1];
    B.x = 1000; B.y = 650; B.heading = Math.PI / 2; // nalevo (levobok = segment 3), míří na A
    const seg = _ai.shieldPlan(A, [B]);
    expect(seg).toBeDefined();
    expect(seg![3]).toBeGreaterThan(1);
    expect(seg!.reduce((a, b) => a + b, 0)).toBe(4);
  });
  it("bez viditelného nepřítele letí bot ke středu mapy (mlha), ne ven z mapy", () => {
    const g = setup();
    const [A] = g.ships;
    A.x = 300; A.y = 300; A.heading = Math.PI; // u okraje, míří ven
    g.ships = [A];
    for (const level of ["kadet", "pilot", "eso"] as const) {
      const o = planBot(g, "A", createRng(2), level)[0];
      expect(o.maneuverId).not.toBe("m1a0"); // nejede rovně dál ven
    }
  });
  it("vyhýbá se spoluhráči: nevletí do známé dráhy druhého bota ani mu nekříží cestu", () => {
    for (const level of ["kadet", "pilot", "eso"] as const) {
      const players = [
        { id: "A", name: "A", team: 0, isBot: true, loadouts: [structuredClone(DEFAULT_LOADOUT)] },
        { id: "C", name: "C", team: 0, isBot: true, loadouts: [structuredClone(DEFAULT_LOADOUT)] },
        { id: "B", name: "B", team: 1, isBot: true, loadouts: [structuredClone(DEFAULT_LOADOUT)] },
      ];
      const g = createGame({ players, settings: { mode: "tdm", turnLimit: 40, shipPoints: 1, allowedModules: {}, botLoadout: "default", map: { ...DEFAULT_MAP, size: "small", seed: 5, storms: 0, asteroids: "none" } }, tuning: DEFAULT_TUNING });
      g.asteroids = []; g.storms = [];
      const A = g.ships.find((s) => s.ownerId === "A")!;
      const C = g.ships.find((s) => s.ownerId === "C")!;
      g.ships = g.ships.filter((s) => s.team === 0); // nepřítel mimo dohled
      // C letí zprava doleva přes bod, kam by A doletěl rovně rychlostí 2
      A.x = 1000; A.y = 800; A.heading = 0; A.speed = 2;
      C.x = 1080; C.y = 900; C.heading = -Math.PI / 2; C.speed = 2;
      const cOrders = [{ shipId: C.id, maneuverId: "m2a0", shots: [] }];
      const allyPaths = plannedPaths(g, cOrders);
      expect(allyPaths.has(C.id)).toBe(true);
      const o = planBot(g, "A", createRng(3), level, { allyPaths })[0];
      const man = listManeuvers(profileOf(A.loadout), A.speed).find((m) => m.id === o.maneuverId)!;
      const pa = maneuverPath(A, man);
      const pc = allyPaths.get(C.id)!;
      let crash = false;
      for (let i = 0; i <= 10; i++) if (circlesOverlap(pa(i / 10), A.stats.radius, pc(i / 10), C.stats.radius)) crash = true;
      expect(crash, level).toBe(false);
    }
  });
});
