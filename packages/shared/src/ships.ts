import { VISION_REF } from "./fog.ts";
import { FIGHTER_PROFILE } from "./maneuvers.ts";
import type { HullDef, ModuleDef, ShipLoadout, ShipStats } from "./types.ts";

/**
 * Lodě = trup + moduly. V1 má jediný trup (stíhač) a pevnou sestavu modulů;
 * inventář a vylepšování ve v2 jen mění `moduleIds`.
 */

export const HULLS: Record<string, HullDef> = {
  fighter: {
    id: "fighter",
    name: "Stíhač",
    radius: 16,
    hull: 100,
    capacity: 6,
    slots: { weapon: 2, system: 1 },
    profile: FIGHTER_PROFILE,
  },
};

export const MODULES: Record<string, ModuleDef> = {
  "laser-mk1": { id: "laser-mk1", name: "Laserové kanóny Mk1", slot: "weapon", size: 1, stats: { attack: 2 } },
  "torpedo-rack": { id: "torpedo-rack", name: "Torpédomet", slot: "weapon", size: 1, stats: { torpedoes: 3 } },
  "mine-layer": { id: "mine-layer", name: "Minový zásobník", slot: "system", size: 1, stats: { mines: 2 } },
  "engine-mk1": { id: "engine-mk1", name: "Motor Mk1", slot: "engine", size: 1, stats: { agility: 3 } },
  "shield-mk1": { id: "shield-mk1", name: "Generátor štítů Mk1", slot: "shield", size: 1, stats: { shields: 50 } },
};

export const DEFAULT_LOADOUT: ShipLoadout = {
  hullId: "fighter",
  moduleIds: ["laser-mk1", "torpedo-rack", "mine-layer", "engine-mk1", "shield-mk1"],
};

export function computeStats(loadout: ShipLoadout): ShipStats {
  const hull = HULLS[loadout.hullId];
  if (!hull) throw new Error(`Neznámý trup: ${loadout.hullId}`);
  const stats: ShipStats = {
    attack: 0,
    agility: 0,
    hull: hull.hull,
    shields: 0,
    torpedoes: 0,
    mines: 0,
    radius: hull.radius,
    vision: VISION_REF.value,
  };
  for (const id of loadout.moduleIds) {
    const mod = MODULES[id];
    if (!mod) throw new Error(`Neznámý modul: ${id}`);
    for (const [k, v] of Object.entries(mod.stats)) {
      (stats as unknown as Record<string, number>)[k] += v ?? 0;
    }
  }
  return stats;
}

export function hullOf(loadout: ShipLoadout): HullDef {
  return HULLS[loadout.hullId];
}
