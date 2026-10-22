import { describe, expect, it } from "vitest";
import { createGame, createRng, planBot, sanitizeOrders, actionCost, DEFAULT_LOADOUT, DEFAULT_MAP, DEFAULT_TUNING, _ai, type GameState } from "../src/index.ts";

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
});
