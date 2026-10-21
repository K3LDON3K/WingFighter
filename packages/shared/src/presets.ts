import { freeSlots, HULLS, MODULES, moduleSellPrice, newModule, WEAPON_TYPES } from "./ships.ts";
import type { ModuleInstance, ModuleType, ShipLoadout, SlotId } from "./types.ts";

export function isWeaponType(t: ModuleType): boolean {
  return WEAPON_TYPES.includes(t);
}
/** Má loď aspoň jednu (funkční) zbraň? */
export function hasWeapon(loadout: ShipLoadout): boolean {
  return loadout.modules.some((m) => isWeaponType(m.type) && (m.hp === undefined || m.hp > 0));
}
/** Lodě letky bez zbraně (pořadová čísla od 1). */
export function unarmedShips(loadouts: ShipLoadout[]): number[] {
  return loadouts.map((l, i) => (hasWeapon(l) ? -1 : i + 1)).filter((i) => i > 0);
}

/**
 * Sada výbavy: pořadí priorit modulů (volitelně s preferovaným slotem). Naplní se v tomto pořadí;
 * co se do rozpočtu nevejde (nebo je v místnosti zakázané), se přeskočí a zkusí se další modul.
 */
export interface LoadoutPreset {
  id: string;
  name: string;
  description: string;
  modules: { type: ModuleType; slot?: SlotId }[];
}

export const LOADOUT_PRESETS: LoadoutPreset[] = [
  { id: "empty", name: "Prázdný", description: "Bez modulů – všechno nakoupíš ručně.", modules: [] },
  {
    id: "attacker",
    name: "Útočník",
    description: "Lasery na přídi, torpédomet, kulomet, segmentový štít.",
    modules: [{ type: "laser", slot: "front" }, { type: "torpedo" }, { type: "mg" }, { type: "shield-segment" }],
  },
  {
    id: "defender",
    name: "Obránce",
    description: "Celolodní štít, lasery na přídi, miny na zádi, droid.",
    modules: [{ type: "shield-whole" }, { type: "laser", slot: "front" }, { type: "mine", slot: "back" }, { type: "droid" }],
  },
  {
    id: "tactician",
    name: "Taktik",
    description: "Lasery na přídi, skener, segmentový štít, miny na zádi.",
    modules: [{ type: "laser", slot: "front" }, { type: "scanner" }, { type: "shield-segment" }, { type: "mine", slot: "back" }],
  },
];

export interface PresetResult {
  loadout: ShipLoadout;
  /** Co se koupí nově (ceny), co se znovu použije ze stávající výbavy a co se nevešlo. */
  buy: ModuleType[];
  reuse: ModuleType[];
  skipped: ModuleType[];
  /** Utraceno (nákupy − prodeje) a kolik kreditů zůstane. */
  cost: number;
  left: number;
}

/**
 * Sestaví výbavu podle sady z aktuální výbavy a peněženky: moduly stejného typu se znovu použijí (přesunou do
 * slotu), zbytek se prodá a za utržené + peněženku se nakoupí další v pořadí priorit. Trup a pilot zůstávají.
 */
export function applyPreset(current: ShipLoadout, preset: LoadoutPreset, wallet: number, allowed: Partial<Record<ModuleType, number>> = {}): PresetResult {
  const hull = HULLS[current.hullId] ?? HULLS.fighter;
  const pool = [...current.modules, ...(current.cargo ?? [])];
  const out: ShipLoadout = { hullId: current.hullId, pilotId: current.pilotId, modules: [] };
  const buy: ModuleType[] = [];
  const reuse: ModuleType[] = [];
  const skipped: ModuleType[] = [];
  const used = new Set<string>();
  // 1. znovupoužití stejných typů (nic nestojí)
  const plan: { type: ModuleType; slot?: SlotId; inst?: ModuleInstance }[] = preset.modules.map((p) => ({ ...p }));
  for (const p of plan) {
    const have = pool.find((m) => m.type === p.type && !used.has(m.id) && (m.hp === undefined || m.hp > 0));
    if (have) {
      used.add(have.id);
      p.inst = have;
    }
  }
  // 2. rozpočet = peněženka + prodej všeho, co se nepoužije
  let money = wallet;
  for (const m of pool) if (!used.has(m.id)) money += moduleSellPrice(m);
  // 3. naplnění v pořadí priorit
  for (const p of plan) {
    const def = MODULES[p.type];
    if (!def || (allowed[p.type] ?? 99) === 0) {
      skipped.push(p.type);
      continue;
    }
    const free = freeSlots(out).filter((s) => hull.slots.some((x) => x.id === s));
    // slot bez preference: nebrat sloty, které chtějí jiné moduly sady (lasery příď, miny záď)
    const reserved = new Set(plan.filter((q) => q !== p && q.slot && !out.modules.some((m) => m.slot === q.slot)).map((q) => q.slot));
    const pick = (list: SlotId[]) => list.find((s) => !(p.type === "mine" && s === "front"));
    const wantSlot = p.slot && free.includes(p.slot) ? p.slot : (pick(free.filter((s) => !reserved.has(s))) ?? pick(free));
    if (!wantSlot) {
      skipped.push(p.type);
      continue;
    }
    if (p.inst) {
      const inst = newModule(p.type, wantSlot, p.inst.id);
      out.modules.push({ ...p.inst, slot: wantSlot, facing: inst.facing });
      reuse.push(p.type);
      continue;
    }
    if (def.price > money) {
      skipped.push(p.type);
      continue;
    }
    money -= def.price;
    out.modules.push(newModule(p.type, wantSlot));
    buy.push(p.type);
  }
  return { loadout: out, buy, reuse, skipped, cost: wallet - money, left: money };
}
