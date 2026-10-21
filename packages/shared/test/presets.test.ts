import { describe, expect, it } from "vitest";
import { applyPreset, DEFAULT_LOADOUT, hasWeapon, LOADOUT_PRESETS, moduleCost, randomLoadout, unarmedShips, type ShipLoadout } from "../src/index.ts";

const P = (id: string) => LOADOUT_PRESETS.find((p) => p.id === id)!;
const empty: ShipLoadout = { hullId: "fighter", pilotId: "kadet", modules: [] };

describe("sady výbavy", () => {
  it("plní se v pořadí priorit podle rozpočtu; co se nevejde, přeskočí", () => {
    const r100 = applyPreset(empty, P("attacker"), 100);
    expect(r100.loadout.modules.map((m) => m.type)).toEqual(["laser"]);
    expect(r100.left).toBe(0);
    const r250 = applyPreset(empty, P("attacker"), 250);
    expect(r250.loadout.modules.map((m) => m.type)).toEqual(["laser", "torpedo"]);
    const r500 = applyPreset(empty, P("attacker"), 500);
    expect(r500.loadout.modules.map((m) => m.type)).toEqual(["laser", "torpedo", "mg", "shield-segment"]);
    expect(r500.cost).toBe(490);
    expect(r500.left).toBe(10);
    // obránce za 150: štít (120) ano, lasery (100) už ne
    expect(applyPreset(empty, P("defender"), 150).loadout.modules.map((m) => m.type)).toEqual(["shield-whole"]);
    // lasery na přídi, miny na zádi
    const d = applyPreset(empty, P("defender"), 500).loadout;
    expect(d.modules.find((m) => m.type === "laser")?.slot).toBe("front");
    expect(d.modules.find((m) => m.type === "mine")?.slot).toBe("back");
    // prázdná = nic
    expect(applyPreset(DEFAULT_LOADOUT, P("empty"), 0).loadout.modules).toEqual([]);
  });
  it("stávající moduly stejného typu znovu použije, ostatní prodá (nový za plnou cenu)", () => {
    const r = applyPreset(DEFAULT_LOADOUT, P("attacker"), 30);
    // výchozí: laser, torpedo, mine, shield-segment → útočník chce laser, torpedo, mg, shield-segment
    expect(r.reuse.sort()).toEqual(["laser", "shield-segment", "torpedo"]);
    // miny se prodají za 100, kulomet stojí 120 → 30 + 100 = 130 ≥ 120 → koupí
    expect(r.buy).toEqual(["mg"]);
    expect(r.left).toBe(10);
    expect(r.loadout.modules.length).toBe(4);
    expect(moduleCost(r.loadout)).toBe(490);
  });
  it("zakázané moduly přeskočí", () => {
    const r = applyPreset(empty, P("tactician"), 500, { scanner: 0 });
    expect(r.loadout.modules.map((m) => m.type)).toEqual(["laser", "shield-segment", "mine"]);
    expect(r.skipped).toEqual(["scanner"]);
  });
  it("zbraně: detekce lodí beze zbraně; náhodná výbava bota má zbraň, když na ni je", () => {
    expect(hasWeapon(DEFAULT_LOADOUT)).toBe(true);
    expect(hasWeapon(applyPreset(empty, P("defender"), 150).loadout)).toBe(false);
    expect(unarmedShips([DEFAULT_LOADOUT, empty])).toEqual([2]);
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 30; i++) expect(hasWeapon(randomLoadout(rng, {}, 100))).toBe(true);
  });
});
