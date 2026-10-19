import { VISION_REF } from "./fog.ts";
import { FIGHTER_PROFILE } from "./maneuvers.ts";
import type { HullDef, ManeuverProfile, ModuleDef, ModuleInstance, ModuleType, PilotDef, ShieldType, ShipLoadout, ShipStats, SlotId } from "./types.ts";

/**
 * Lodě = trup + pilot + moduly ve slotech.
 * Stíhač má 4 sloty: levý a pravý bok (malé), příď a záď (každý buď 1 velký, nebo 2 malé moduly).
 * Každý modul má váhu – součet váhy snižuje maximální rychlost lodi (viz `maxSpeedFor`).
 */

export const HULLS: Record<string, HullDef> = {
  fighter: {
    id: "fighter",
    name: "Stíhač",
    description: "Malá rychlá loď. Čtyři malé sloty: příď, záď, levobok, pravobok. Příď + záď jde spojit v jeden velký slot.",
    radius: 16,
    hull: 100,
    slots: [
      { id: "front", name: "příď", size: "small" },
      { id: "back", name: "záď", size: "small" },
      { id: "left", name: "levobok", size: "small" },
      { id: "right", name: "pravobok", size: "small" },
    ],
    profile: FIGHTER_PROFILE,
  },
};

export const PILOTS: Record<string, PilotDef> = {
  kadet: { id: "kadet", name: "Kadet", description: "Čerstvý absolvent akademie. Bez zvláštních schopností.", abilities: [] },
};

/** Lodní systémy (moduly). Ceny a váhy ladí `applyTuning`. */
export const MODULES: Record<ModuleType, ModuleDef> = {
  laser: { id: "laser", name: "Lasery", short: "LAS", icon: "laser", size: "small", weight: 2, price: 100, description: "Laserové kanóny: výseč ±20° před přídí, dostřel 300. Více modulů = při střelbě si vybereš, ze kterého střílíš (jeden za akci)." },
  torpedo: { id: "torpedo", name: "Torpédomet", short: "TORP", icon: "torpedo", size: "small", weight: 1, price: 150, ammo: 3, ammoWeight: 1, description: "Fázové torpédo, 3 kusy na modul. Každé vystřelené torpédo loď odlehčí." },
  mine: { id: "mine", name: "Minový zásobník", short: "MINA", icon: "mine", size: "small", weight: 1, price: 100, ammo: 2, ammoWeight: 0.5, description: "Miny, 2 kusy na modul. Odhazují se za loď nebo do stran." },
  "shield-segment": { id: "shield-segment", name: "Segmentový štít", short: "SEG", icon: "segments", size: "small", weight: 2, price: 120, shieldType: "segment", description: "Čtyři segmenty po 2 bodech; každý zásah ubere 1 bod a je pohlcen celý. Akce Úprava štítu body přesouvá. Nelze kombinovat s celolodním." },
  "shield-whole": { id: "shield-whole", name: "Celolodní štít", short: "CEL", icon: "shield", size: "small", weight: 2, price: 120, shieldType: "whole", shields: 50, description: "Zásoba 50 kolem celé lodi, pohltí účinnost % zranění; účinnost po každém zásahu klesá o 10 %. Nelze kombinovat se segmentovým." },
};
export const MODULE_TYPES = Object.keys(MODULES) as ModuleType[];

/** Výchozí sestava (lasery, torpéda, miny, segmentový štít). */
export const DEFAULT_LOADOUT: ShipLoadout = {
  hullId: "fighter",
  pilotId: "kadet",
  modules: [
    { id: "m1", type: "laser", slot: "left" },
    { id: "m2", type: "torpedo", slot: "front", ammo: 3 },
    { id: "m3", type: "mine", slot: "back", ammo: 2 },
    { id: "m4", type: "shield-segment", slot: "right" },
  ],
};

/** Mutovatelná pravidla vážení. */
export const WEIGHT = {
  /** Kolik váhy ubere 1 bod maximální rychlosti. */
  perSpeed: 6,
};

export function newModule(type: ModuleType, slot: SlotId, id?: string): ModuleInstance {
  const def = MODULES[type];
  return { id: id ?? `${type}-${Math.random().toString(36).slice(2, 8)}`, type, slot, ammo: def.ammo };
}

/** Velký modul zabírá příď + záď (zapisuje se do slotu "front"). */
export const LARGE_SLOTS: [SlotId, SlotId] = ["front", "back"];

/** Kolik malých modulů slot pojme (každý slot 1). */
export function slotCapacity(hull: HullDef, slot: SlotId): number {
  return hull.slots.some((x) => x.id === slot) ? 1 : 0;
}

/** Které sloty modul obsazuje. */
export function occupiedSlots(m: ModuleInstance): SlotId[] {
  return MODULES[m.type]?.size === "large" ? [...LARGE_SLOTS] : [m.slot];
}

/** Volné sloty sestavy (v pořadí příď, záď, levobok, pravobok). */
export function freeSlots(loadout: ShipLoadout): SlotId[] {
  const hull = hullOf(loadout);
  const used = new Set(loadout.modules.flatMap(occupiedSlots));
  return hull.slots.map((s) => s.id).filter((id) => !used.has(id));
}

/** Celková váha sestavy (včetně zbývající munice). */
export function loadoutWeight(loadout: ShipLoadout): number {
  let w = 0;
  for (const m of loadout.modules) {
    const def = MODULES[m.type];
    if (!def) continue;
    w += def.weight + (def.ammoWeight ?? 0) * (m.ammo ?? 0);
  }
  return w;
}

export function moduleCost(loadout: ShipLoadout): number {
  return loadout.modules.reduce((sum, m) => sum + (MODULES[m.type]?.price ?? 0), 0);
}

/** Maximální rychlost po započtení váhy (nejméně 1). */
export function maxSpeedFor(loadout: ShipLoadout): number {
  const base = hullOf(loadout).profile.maxSpeed;
  return Math.max(1, base - Math.floor(loadoutWeight(loadout) / Math.max(0.1, WEIGHT.perSpeed)));
}

/** Pohybový profil lodi s ohledem na váhu. */
export function profileOf(loadout: ShipLoadout): ManeuverProfile {
  const p = hullOf(loadout).profile;
  const maxSpeed = maxSpeedFor(loadout);
  return { ...p, maxSpeed, koiogranSpeeds: p.koiogranSpeeds.filter((s) => s <= maxSpeed) };
}

export function shieldTypeOf(loadout: ShipLoadout): ShieldType {
  if (loadout.modules.some((m) => m.type === "shield-whole")) return "whole";
  if (loadout.modules.some((m) => m.type === "shield-segment")) return "segment";
  return "none";
}

/**
 * Ověří sestavu: známý trup/pilot/moduly, kapacita slotů, nemíchat typy štítů,
 * povolené počty na hráče a rozpočet. Vrací text chyby, nebo null.
 */
export function validateLoadout(loadout: ShipLoadout, limits?: { allowed?: Partial<Record<ModuleType, number>>; budget?: number }): string | null {
  const hull = HULLS[loadout.hullId];
  if (!hull) return "neznámá loď";
  if (!PILOTS[loadout.pilotId]) return "neznámý pilot";
  const ids = new Set<string>();
  const perSlot: Record<string, number> = {};
  const perType: Partial<Record<ModuleType, number>> = {};
  for (const m of loadout.modules) {
    const def = MODULES[m.type];
    if (!def) return `neznámý modul ${m.type}`;
    if (ids.has(m.id)) return "duplicitní modul";
    ids.add(m.id);
    if (!hull.slots.some((s) => s.id === m.slot)) return `neznámý slot ${m.slot}`;
    if (def.size === "large" && m.slot !== LARGE_SLOTS[0]) return "velký modul patří do spojeného slotu příď + záď";
    for (const sl of occupiedSlots(m)) {
      perSlot[sl] = (perSlot[sl] ?? 0) + 1;
      if (perSlot[sl] > slotCapacity(hull, sl)) return `slot ${hull.slots.find((s) => s.id === sl)?.name} je obsazený`;
    }
    perType[m.type] = (perType[m.type] ?? 0) + 1;
  }
  if (perType["shield-segment"] && perType["shield-whole"]) return "segmentový a celolodní štít nejde kombinovat";
  if (limits?.allowed) {
    for (const t of MODULE_TYPES) {
      const max = limits.allowed[t];
      if (max !== undefined && (perType[t] ?? 0) > max) return max === 0 ? `${MODULES[t].name}: v této hře zakázán` : `${MODULES[t].name}: max. ${max} na hráče`;
    }
  }
  if (limits?.budget !== undefined && moduleCost(loadout) > limits.budget) return `překročen rozpočet (${moduleCost(loadout)} / ${limits.budget})`;
  return null;
}

/** Obnoví munici modulů na plnou (nová bitva). */
export function refillLoadout(loadout: ShipLoadout): ShipLoadout {
  return { ...loadout, modules: loadout.modules.map((m) => ({ ...m, ammo: MODULES[m.type]?.ammo })) };
}

export function computeStats(loadout: ShipLoadout): ShipStats {
  const hull = HULLS[loadout.hullId];
  if (!hull) throw new Error(`Neznámý trup: ${loadout.hullId}`);
  const stats: ShipStats = {
    attack: 0,
    agility: hull.agility ?? 3,
    hull: hull.hull,
    shields: 0,
    torpedoes: 0,
    mines: 0,
    radius: hull.radius,
    vision: VISION_REF.value,
    segmentModules: 0,
  };
  for (const m of loadout.modules) {
    const def = MODULES[m.type];
    if (!def) throw new Error(`Neznámý modul: ${m.type}`);
    if (m.type === "laser") stats.attack = LASER_DICE.value;
    if (m.type === "torpedo") stats.torpedoes += m.ammo ?? 0;
    if (m.type === "mine") stats.mines += m.ammo ?? 0;
    if (m.type === "shield-whole") stats.shields += def.shields ?? 0;
    if (m.type === "shield-segment") stats.segmentModules++;
  }
  return stats;
}

/** Kostky útoku laserů (ladí se). */
export const LASER_DICE = { value: 2 };

export function hullOf(loadout: ShipLoadout): HullDef {
  return HULLS[loadout.hullId];
}

/** Náhodná sestava v rámci povolených počtů a rozpočtu (pro boty). */
export function randomLoadout(rng: () => number, allowed: Partial<Record<ModuleType, number>>, budget: number): ShipLoadout {
  const lo: ShipLoadout = { hullId: "fighter", pilotId: "kadet", modules: [] };
  const order = [...MODULE_TYPES].sort(() => rng() - 0.5);
  let spent = 0;
  for (let round = 0; round < 3; round++) {
    for (const t of order) {
      const def = MODULES[t];
      const count = lo.modules.filter((m) => m.type === t).length;
      if ((allowed[t] ?? 99) <= count || spent + def.price > budget) continue;
      if ((t === "shield-whole" && lo.modules.some((m) => m.type === "shield-segment")) || (t === "shield-segment" && lo.modules.some((m) => m.type === "shield-whole"))) continue;
      if (rng() < 0.35) continue;
      const slot = freeSlots(lo)[0];
      if (!slot) break;
      lo.modules.push(newModule(t, slot, `b${lo.modules.length + 1}`));
      spent += def.price;
    }
  }
  return lo;
}
