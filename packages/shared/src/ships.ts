import { VISION_REF } from "./fog.ts";
import { BATTLESHIP_PROFILE, FIGHTER_PROFILE } from "./maneuvers.ts";
import { CARGO, LASER, MG, RULES, TECH, TORPEDO } from "./constants.ts";
import type { Facing, GameSettings, HullDef, ManeuverProfile, MineSide, ModuleDef, ModuleInstance, ModuleType, PilotDef, PilotMods, ShieldType, ShipLoadout, ShipStats, SlotId } from "./types.ts";

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
    points: 1,
    // kolizní model z pixelového spritu: tělo, příď, levé a pravé křídlo (plameny motorů se nepočítají)
    colliders: [
      { x: -4, y: -1.5, r: 13 },
      { x: 17, y: -1.5, r: 7 },
      { x: -12, y: -16, r: 7 },
      { x: -12, y: 13, r: 7 },
    ],
    hull: 100,
    cargo: 1,
    slots: [
      { id: "front", name: "příď", size: "small" },
      { id: "back", name: "záď", size: "small" },
      { id: "left", name: "levobok", size: "small" },
      { id: "right", name: "pravobok", size: "small" },
    ],
    profile: FIGHTER_PROFILE,
  },
  battleship: {
    id: "battleship",
    name: "Bitevník",
    description: "Střední loď, asi 3× větší než stíhač. Dostřel všech zbraní o 25 % delší, lasery mají do všech směrů stejnou výseč (±20°). Šest slotů: příď, záď, přední a zadní levobok, přední a zadní pravobok. Příď + záď, oba levoboky i oba pravoboky jde spojit v jeden velký slot. Pomalejší (max. rychlost 4), otočka jen z rychlosti 2–3, větší trup a náklad, 10 bodů technologie. Stojí 2 lodní body.",
    radius: 58,
    points: 2,
    // kolizní model podle spritu (50×40 px × 3): trup od zádi k přídi, špice, dvě gondoly na bocích
    colliders: [
      { x: -45, y: 0, r: 16 },
      { x: -18, y: 0, r: 18 },
      { x: 12, y: 0, r: 17 },
      { x: 42, y: 0, r: 12 },
      { x: 64, y: 0, r: 6 },
      { x: -42, y: -36, r: 11 },
      { x: -18, y: -36, r: 11 },
      { x: -42, y: 36, r: 11 },
      { x: -18, y: 36, r: 11 },
    ],
    hull: 200,
    agility: 2,
    cargo: 2,
    slots: [
      { id: "front", name: "příď", size: "small" },
      { id: "back", name: "záď", size: "small" },
      { id: "podLeft", name: "přední levobok", size: "small" },
      { id: "left", name: "zadní levobok", size: "small" },
      { id: "podRight", name: "přední pravobok", size: "small" },
      { id: "right", name: "zadní pravobok", size: "small" },
    ],
    profile: BATTLESHIP_PROFILE,
    rangeMul: 1.25,
    techMax: 10,
    sameArcs: true,
  },
};

/** Dostřel zbraní podle trupu (bitevník má o 25 % delší). */
export function rangeMul(ship: { loadout: { hullId: string } }): number {
  return HULLS[ship.loadout.hullId]?.rangeMul ?? 1;
}
export function laserRange(ship: { loadout: { hullId: string } }): number {
  return Math.round(LASER.range * rangeMul(ship));
}
export function mgRange(ship: { loadout: { hullId: string } }): number {
  return Math.round(MG.range * rangeMul(ship));
}
export function torpedoLockRange(ship: { loadout: { hullId: string } }): number {
  return Math.round(TORPEDO.lockRange * rangeMul(ship));
}
export function torpedoPointRange(ship: { loadout: { hullId: string } }): number {
  return Math.round(TORPEDO.pointRange * rangeMul(ship));
}

const NO_MODS: PilotMods = { attack: 0, agility: 0, stressMax: 0, maxSpeed: 0, hullPct: 0 };
/** Slovní popis modifikátorů pilota. */
export function pilotAbilities(m: PilotMods): string[] {
  const out: string[] = [];
  const f = (v: number, what: string) => v && out.push(`${v > 0 ? "+" : ""}${v} ${what}`);
  f(m.attack, "kostka útoku laserů");
  f(m.agility, "kostka obrany");
  f(m.stressMax, "max. stresový bod");
  f(m.maxSpeed, "max. rychlost");
  f(m.hullPct, "% trupu");
  return out;
}
export const BUILTIN_PILOTS: PilotDef[] = [
  { id: "kadet", name: "Kadet", description: "Čerstvý absolvent akademie. Bez výhod i nevýhod – těch může být v letce víc.", abilities: [], mods: { ...NO_MODS }, unique: false, builtin: true },
  { id: "eso", name: "Eso", description: "Pilot s instinktem pro úhyb: +1 kostka obrany, ale snese méně stresu (−1 max. stresový bod).", abilities: [], mods: { ...NO_MODS, agility: 1, stressMax: -1 }, unique: true, builtin: true },
  { id: "strelec", name: "Střelec", description: "Mistr zaměřování: +1 kostka útoku laserů, zato letí opatrněji (−1 max. rychlost).", abilities: [], mods: { ...NO_MODS, attack: 1, maxSpeed: -1 }, unique: true, builtin: true },
  { id: "kapitan", name: "Kapitán", description: "Zkušený velitel s chladnou hlavou: +1 max. stresový bod, ale střílí hůř (−1 kostka útoku).", abilities: [], mods: { ...NO_MODS, stressMax: 1, attack: -1 }, unique: true, builtin: true },
];
for (const p of BUILTIN_PILOTS) p.abilities = pilotAbilities(p.mods);
/** Registr pilotů – server ho může přepsat editovanými (setPilots). */
export const PILOTS: Record<string, PilotDef> = Object.fromEntries(BUILTIN_PILOTS.map((p) => [p.id, p]));
export function setPilots(list: PilotDef[]) {
  for (const k of Object.keys(PILOTS)) delete PILOTS[k];
  for (const p of list) PILOTS[p.id] = { ...p, abilities: pilotAbilities(p.mods) };
  if (!PILOTS.kadet) PILOTS.kadet = BUILTIN_PILOTS[0];
}
export function pilotList(): PilotDef[] {
  return Object.values(PILOTS);
}
/** Ověří tvar seznamu pilotů od klienta. */
export function sanitizePilots(raw: unknown): PilotDef[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) return null;
  const out: PilotDef[] = [];
  const ids = new Set<string>();
  const num = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || typeof r.name !== "string") return null;
    const id = r.id.replace(/[^a-z0-9-]/gi, "").slice(0, 24).toLowerCase();
    if (!id || ids.has(id)) return null;
    ids.add(id);
    const m = (r.mods ?? {}) as Record<string, unknown>;
    const mods: PilotMods = { attack: num(m.attack, -2, 2), agility: num(m.agility, -2, 2), stressMax: num(m.stressMax, -2, 2), maxSpeed: num(m.maxSpeed, -2, 2), hullPct: num(m.hullPct, -50, 50) };
    out.push({ id, name: r.name.slice(0, 20), description: String(r.description ?? "").slice(0, 300), abilities: pilotAbilities(mods), mods, unique: id === "kadet" ? false : r.unique !== false, builtin: BUILTIN_PILOTS.some((b) => b.id === id) });
  }
  if (!ids.has("kadet")) out.unshift(BUILTIN_PILOTS[0]);
  return out;
}

/** Lodní systémy (moduly). Ceny a váhy ladí `applyTuning`. */
export const MODULES: Record<ModuleType, ModuleDef> = {
  laser: { id: "laser", name: "Lasery", short: "LAS", icon: "laser", size: "small", weight: 2, price: 100, hp: 30, description: "Laserové kanóny: výseč ±20° před přídí, dostřel 300. Více modulů = při střelbě si vybereš, ze kterého střílíš (jeden za akci)." },
  torpedo: { id: "torpedo", name: "Torpédomet", short: "TORP", icon: "torpedo", size: "small", weight: 1, price: 150, hp: 20, ammo: 3, ammoWeight: 1, ammoPrice: 12, description: "Fázové torpédo, 3 kusy na modul. Každé vystřelené torpédo loď odlehčí." },
  mine: { id: "mine", name: "Miny", short: "MINA", icon: "mine", size: "small", weight: 1, price: 100, hp: 20, ammo: 2, ammoWeight: 0.5, ammoPrice: 12, description: "Miny, 2 kusy na modul. Odhazují se za loď nebo do stran." },
  "shield-segment": { id: "shield-segment", name: "Segmentový štít", short: "SEG", icon: "segments", size: "small", weight: 2, price: 120, hp: 40, shieldType: "segment", description: "Kinetický: čtyři poletující segmenty po 2 bodech, akce Úprava štítu je přesouvá. Projektil (torpédo, mina, dávka kulometu) segment zachytí celý za 1 bod. Laser je přesnější – ubere 1 bod a 60 % zranění pronikne do trupu. Dobití technologií: 3 body → +2 body segmentů. Nelze kombinovat s energetickým." },
  mg: { id: "mg", name: "Kulomet", short: "KUL", icon: "mg", size: "small", weight: 1, price: 120, hp: 25, ammo: 100, ammoWeight: 0.02, ammoPrice: 0.3, description: "Krátký dosah (150), široká výseč ±45°. Dávka 10 projektilů s rozptylem, každý 3 zranění; šance zásahu klesá se vzdáleností. Střílí na začátku kola na cokoliv (loď, torpédo, trosky). Funguje i v bouři. 100 nábojů = 10 dávek." },
  scanner: { id: "scanner", name: "Skener", short: "SKEN", icon: "scan", size: "small", weight: 1, price: 130, hp: 15, description: "Čerpá technologii lodi (6 bodů na celou bitvu, nedobíjí se). Sken lodi (1 bod): hned ukáže výbavu, natočení modulů, munici a pilota cizí lodi v dohledu. Hluboký sken (2 body): hned odkryje mapu celému týmu do konce kola. Nebere akci." },
  droid: { id: "droid", name: "Droid – pilot", short: "DROID", icon: "bot", size: "small", weight: 0.5, price: 140, hp: 15, description: "Palubní droid (čerpá technologii, nebere akci). Overdrive (3 body): v tomto kole manévry nestojí stres – oranžový i nebezpečný (červený) manévr jsou „bílé“ (nebezpečný bez ztráty trupu), úhyb bez stresu, otočka jen za 1 akci a rychlost ignoruje váhu (plná max. rychlost trupu). Autopilot (2 body): zelený manévr vrátí +2 stresové body místo +1. V bouři nefunguje." },
  repair: { id: "repair", name: "Droid – opravář", short: "OPRAV", icon: "wrench", size: "small", weight: 0.5, price: 140, hp: 15, description: "Palubní droid opravář (čerpá technologii, nebere akci, provádí se hned při plánování). Oprava modulu (4 body): plně opraví vybraný modul, i zničený. Munice (2 body): vyrobí 1 náboj do torpédometu nebo min. Oprava trupu (3 body): opraví 25 % maxima trupu. Instalace (1 bod): nasadí sebraný modul z nákladu do libovolného slotu; stojí-li tam modul, vymění se a jde do nákladu. Lze mít víc opravářů. V bouři nefunguje." },
  hacker: { id: "hacker", name: "Droid – hacker", short: "HACK", icon: "hack", size: "small", weight: 0.5, price: 140, hp: 15, description: "Palubní droid hacker (čerpá technologii, nebere akci, provádí se hned při plánování, cíle v dohledu týmu). Hack miny/torpéda (2 body): mina se stane tvou (jde nastavit odpočet nebo odpálit na startu kola), torpédu určíš nový cíl a dostane +2 kola života. Hack modulu (3 body): vybraný modul cizí lodi na toto kolo nefunguje – zbraň nevystřelí, štít nechrání, droid/skener nejde použít; oběť se to dozví až při vyhodnocení. Pasivní oprava (4 body): 4 kola po 5 % trupu za kolo (jen když hacker funguje). V bouři nefunguje." },
  "shield-whole": { id: "shield-whole", name: "Energetický štít", short: "ENE", icon: "shield", size: "small", weight: 2, price: 120, hp: 40, shieldType: "whole", shields: 80, description: "Pole kolem celé lodi, zásoba 80, každé kolo +5. Laser pole jen vybíjí – do trupu nejde nic, dokud zásoba stačí. Projektil (torpédo, mina, kulomet, srážka) pole prorazí: 30 % zranění jde do trupu vždy. Dobití technologií: 3 body → +40 zásoby. Nelze kombinovat se segmentovým." },
};
export const MODULE_TYPES = Object.keys(MODULES) as ModuleType[];
/** Zbraně – s nimi jde aktivně vyhrát (sestřelit soupeře). */
export const WEAPON_TYPES: ModuleType[] = ["laser", "torpedo", "mine", "mg"];

/** Kategorie modulů (obchod, barvy v UI). */
export type ModuleCategory = "weapon" | "shield" | "droid" | "tech";
export const MODULE_CATEGORIES: ModuleCategory[] = ["weapon", "shield", "droid", "tech"];
export const MODULE_CATEGORY: Record<ModuleType, ModuleCategory> = {
  laser: "weapon",
  torpedo: "weapon",
  mine: "weapon",
  mg: "weapon",
  "shield-segment": "shield",
  "shield-whole": "shield",
  droid: "droid",
  repair: "droid",
  hacker: "droid",
  scanner: "tech",
};
export const CATEGORY_LABEL: Record<ModuleCategory, string> = { weapon: "Zbraně", shield: "Štíty", droid: "Droidi", tech: "Technologie" };
/** Druh zbraně: energetická (bez munice) nebo projektilová (má munici). */
export type WeaponKind = "energy" | "projectile";
export const WEAPON_KIND_LABEL: Record<WeaponKind, string> = { energy: "energetická", projectile: "projektilová" };
export function weaponKind(type: ModuleType): WeaponKind | null {
  if (MODULE_CATEGORY[type] !== "weapon") return null;
  return MODULES[type].ammo ? "projectile" : "energy";
}

/** Výchozí sestava (lasery, torpéda, miny, segmentový štít). */
export const DEFAULT_LOADOUT: ShipLoadout = {
  hullId: "fighter",
  pilotId: "kadet",
  modules: [
    { id: "m1", type: "laser", slot: "left", facing: "front" },
    { id: "m2", type: "torpedo", slot: "front", ammo: 3, facing: "front" },
    { id: "m3", type: "mine", slot: "back", ammo: 2, facing: "back" },
    { id: "m4", type: "shield-segment", slot: "right" },
  ],
};

/** Mutovatelná pravidla vážení. */
export const WEIGHT = {
  /** Kolik váhy ubere 1 bod maximální rychlosti. */
  perSpeed: 6,
};

/** Má modul směr (otáčí se)? Štíty ne. */
export function hasFacing(type: ModuleType): boolean {
  return type === "laser" || type === "torpedo" || type === "mine" || type === "mg";
}

/** Strana lodi, na které slot leží (gondoly = bok). */
export function slotSide(slot: SlotId): Facing {
  return slot === "podLeft" ? "left" : slot === "podRight" ? "right" : slot;
}
const OPPOSITE: Record<Facing, Facing> = { front: "back", back: "front", left: "right", right: "left" };
export const FACINGS: Facing[] = ["front", "right", "back", "left"];
export const FACING_NAMES: Record<Facing, string> = { front: "dopředu", right: "doprava", back: "dozadu", left: "doleva" };

/** Povolené směry modulu ve slotu: všechny kromě „do středu“; miny nesmí dopředu. */
export function allowedFacings(type: ModuleType, slot: SlotId): Facing[] {
  if (!hasFacing(type)) return [];
  return FACINGS.filter((f) => f !== OPPOSITE[slotSide(slot)] && !(type === "mine" && f === "front"));
}

/** Výchozí směr modulu ve slotu (ven ze slotu; miny na boku do boku). */
export function defaultFacing(type: ModuleType, slot: SlotId): Facing | undefined {
  if (!hasFacing(type)) return undefined;
  const pref: Facing[] = type === "mine" ? [slotSide(slot), "back"] : ["front", slotSide(slot)];
  return pref.find((f) => allowedFacings(type, slot).includes(f)) ?? allowedFacings(type, slot)[0];
}

/** Úhel směru modulu vůči kurzu lodi. */
/** Poloha slotu na trupu v souřadnicích lodi (x dopředu, y doprava) – odtud zbraň střílí a měří dosah. */
const SLOT_OFFSETS: Record<string, Partial<Record<SlotId, { x: number; y: number }>>> = {
  fighter: { front: { x: 14, y: 0 }, back: { x: -12, y: 0 }, left: { x: -4, y: -12 }, right: { x: -4, y: 12 } },
  battleship: { front: { x: 52, y: 0 }, back: { x: -48, y: 0 }, podLeft: { x: -14, y: -36 }, left: { x: -44, y: -20 }, podRight: { x: -14, y: 36 }, right: { x: -44, y: 20 } },
};
/** Poloha slotu vůči středu lodi (+x příď, +y pravobok) podle trupu. */
export function slotOffset(slot: SlotId | undefined, hullId = "fighter"): { x: number; y: number } {
  return (slot && (SLOT_OFFSETS[hullId] ?? SLOT_OFFSETS.fighter)[slot]) ?? { x: 0, y: 0 };
}
/** Světová pozice modulu na lodi. */
export function modulePos(ship: { x: number; y: number; heading: number; loadout?: { hullId: string } }, mod: { slot?: SlotId } | undefined): { x: number; y: number } {
  const o = slotOffset(mod?.slot, ship.loadout?.hullId);
  const c = Math.cos(ship.heading);
  const s = Math.sin(ship.heading);
  return { x: ship.x + o.x * c - o.y * s, y: ship.y + o.x * s + o.y * c };
}

export function facingAngle(f: Facing | undefined): number {
  return f === "right" ? Math.PI / 2 : f === "back" ? Math.PI : f === "left" ? -Math.PI / 2 : 0;
}

/** Poloviční výseč laserů podle natočení modulu. */
export function laserHalfArc(f: Facing | undefined, hullId?: string): number {
  if (hullId && HULLS[hullId]?.sameArcs) return LASER.halfArc; // bitevník: stejná výseč do všech směrů
  return f === "back" ? LASER.halfArcBack : f === "left" || f === "right" ? LASER.halfArcSide : LASER.halfArc;
}

/** Strana, kam minový modul odhazuje. */
export function mineSideOf(f: Facing | undefined): MineSide {
  return f === "left" ? "left" : f === "right" ? "right" : "behind";
}

export function newModule(type: ModuleType, slot: SlotId, id?: string): ModuleInstance {
  const def = MODULES[type];
  return { id: id ?? `${type}-${Math.random().toString(36).slice(2, 8)}`, type, slot, ammo: def.ammo, facing: defaultFacing(type, slot), };
}

/** Skenerový modul lodi (první). */
export function scannerModule(loadout: ShipLoadout): ModuleInstance | undefined {
  return loadout.modules.find((m) => m.type === "scanner" && moduleUsable(m));
}

/** Životy modulů se ladí procentem základu. */
export const MODULE_HP_PCT = { value: 100 };
export function moduleMaxHp(type: ModuleType): number {
  return Math.max(1, Math.round(((MODULES[type]?.hp ?? 20) * MODULE_HP_PCT.value) / 100));
}
export function moduleHp(m: ModuleInstance): number {
  return m.hp === undefined ? moduleMaxHp(m.type) : Math.max(0, Math.min(moduleMaxHp(m.type), m.hp));
}
/** Modul funguje, dokud má životy. */
export function moduleWorking(m: ModuleInstance): boolean {
  return moduleHp(m) > 0;
}
/** Modul jde v tomto kole použít: funguje a není hacknutý. */
export function moduleUsable(m: ModuleInstance): boolean {
  return moduleWorking(m) && !m.hacked;
}
export function moduleBroken(m: ModuleInstance): boolean {
  return !moduleWorking(m);
}
/** Prodejní cena modulu: zničený jen za zlomek, použitý (po bitvě) za část, nový za plnou cenu. */
export function moduleSellPrice(m: ModuleInstance): number {
  const def = MODULES[m.type];
  if (!def) return 0;
  if (m.gift) return 0;
  if (moduleBroken(m)) return Math.round((def.price * RULES.brokenSellPct) / 100);
  if (m.used) return Math.round((def.price * RULES.usedSellPct) / 100);
  return def.price;
}

/** Cena dokoupení chybějící munice (0 = plný zásobník nebo modul bez munice). */
/** Cena opravy zničeného modulu v obchodě (% ceny; 0 = modul není zničený). */
export function moduleRepairCost(m: ModuleInstance): number {
  const def = MODULES[m.type];
  if (!def || !moduleBroken(m)) return 0;
  return Math.round((def.price * RULES.repairPct) / 100);
}

export function ammoRefillCost(m: ModuleInstance): number {
  const def = MODULES[m.type];
  if (!def?.ammo || def.ammoPrice === undefined) return 0;
  const missing = Math.max(0, def.ammo - (m.ammo ?? 0));
  return Math.ceil(missing * def.ammoPrice);
}

/**
 * Změna výbavy v místnosti jako obchod: nové moduly se kupují za plnou cenu (plná munice, nepoškozené),
 * odebrané se prodávají (nový 100 %, použitý část, zničený zlomek), doplněná munice se platí po kusech.
 * Vrací vyčištěnou výbavu (hp / used se nedají změnit) a cenu (záporná = výdělek), nebo chybu.
 */
export function applyLoadoutTrade(prev: ShipLoadout, next: ShipLoadout): { loadout: ShipLoadout; cost: number; error?: string } {
  const prevAll = new Map<string, ModuleInstance>();
  for (const m of [...prev.modules, ...(prev.cargo ?? [])]) prevAll.set(m.id, m);
  let cost = 0;
  const fix = (m: ModuleInstance): ModuleInstance | string => {
    const def = MODULES[m.type];
    if (!def) return `neznámý modul ${m.type}`;
    const old = prevAll.get(m.id);
    if (!old) {
      // nákup: vždy nový, plný, nepoškozený
      cost += def.price;
      return { ...m, ammo: def.ammo, hp: undefined, used: undefined, gift: undefined };
    }
    if (old.type !== m.type) return "modul nelze změnit na jiný typ";
    const out: ModuleInstance = { ...m, hp: old.hp, used: old.used, gift: old.gift, repair: undefined };
    let repaired = false;
    if (m.repair && moduleBroken(old)) {
      // oprava zničeného modulu: plné životy, zůstává „použitý“
      cost += moduleRepairCost(old);
      out.hp = undefined;
      out.used = true;
      repaired = true;
    }
    if (def.ammo !== undefined) {
      const was = old.ammo ?? 0;
      const want = Math.max(0, Math.min(def.ammo, Math.round(m.ammo ?? was)));
      if (want > was) {
        if (moduleBroken(old) && !repaired) return `${def.name}: zničený modul nejde doplnit`;
        cost += Math.ceil((want - was) * (def.ammoPrice ?? 0));
      }
      out.ammo = Math.max(was, want); // munici nejde „odprodat“ – zůstává
    }
    prevAll.delete(m.id);
    return out;
  };
  const modules: ModuleInstance[] = [];
  for (const m of next.modules) {
    const r = fix(m);
    if (typeof r === "string") return { loadout: prev, cost: 0, error: r };
    modules.push(r);
  }
  const cargo: ModuleInstance[] = [];
  for (const m of next.cargo ?? []) {
    const r = fix(m);
    if (typeof r === "string") return { loadout: prev, cost: 0, error: r };
    cargo.push(r);
  }
  // co zbylo v prevAll, bylo prodáno
  for (const m of prevAll.values()) cost -= moduleSellPrice(m);
  return { loadout: { ...next, modules, cargo: cargo.length ? cargo : undefined }, cost };
}

/** Velký modul zabírá dvojici slotů (zapisuje se do prvního z dvojice): příď + záď, přední + zadní levobok, přední + zadní pravobok. */
export const LARGE_SLOTS: [SlotId, SlotId] = ["front", "back"];
export const LARGE_PAIRS: [SlotId, SlotId][] = [
  ["front", "back"],
  ["podLeft", "left"],
  ["podRight", "right"],
];
/** Dvojice pro velký modul zapsaný do slotu `slot` (slot musí být první z dvojice). */
export function largePair(slot: SlotId): [SlotId, SlotId] | undefined {
  return LARGE_PAIRS.find((p) => p[0] === slot);
}
/** Dvojice slotů, které trup umí spojit pro velký modul. */
export function hullLargePairs(hull: HullDef): [SlotId, SlotId][] {
  const ids = new Set(hull.slots.map((s) => s.id));
  return LARGE_PAIRS.filter((p) => ids.has(p[0]) && ids.has(p[1]));
}

/** Kolik malých modulů slot pojme (každý slot 1). */
export function slotCapacity(hull: HullDef, slot: SlotId): number {
  return hull.slots.some((x) => x.id === slot) ? 1 : 0;
}

/** Které sloty modul obsazuje. */
export function occupiedSlots(m: ModuleInstance): SlotId[] {
  return MODULES[m.type]?.size === "large" ? [...(largePair(m.slot) ?? LARGE_SLOTS)] : [m.slot];
}

/** Volné sloty sestavy (v pořadí příď, záď, levobok, pravobok). */
export function freeSlots(loadout: ShipLoadout): SlotId[] {
  const hull = hullOf(loadout);
  const used = new Set(loadout.modules.flatMap(occupiedSlots));
  return hull.slots.map((s) => s.id).filter((id) => !used.has(id));
}

/** Celková váha sestavy (včetně zbývající munice). */
export function moduleWeight(m: ModuleInstance): number {
  const def = MODULES[m.type];
  return def ? def.weight + (def.ammoWeight ?? 0) * (m.ammo ?? 0) : 0;
}

/** Váha výbavy včetně nákladu. */
export function loadoutWeight(loadout: ShipLoadout): number {
  let w = 0;
  for (const m of loadout.modules) w += moduleWeight(m);
  for (const m of loadout.cargo ?? []) w += moduleWeight(m);
  return w;
}

/** Kapacita nákladového prostoru trupu (ladění může přepsat stíhač). */
export function cargoCapacity(loadout: ShipLoadout): number {
  const hull = HULLS[loadout.hullId];
  if (!hull) return 0;
  return hull.id === "fighter" ? CARGO.fighter : hull.cargo;
}

export function moduleCost(loadout: ShipLoadout): number {
  return loadout.modules.reduce((sum, m) => sum + (MODULES[m.type]?.price ?? 0), 0);
}

/** Maximální rychlost po započtení váhy (nejméně 1). */
export function maxSpeedFor(loadout: ShipLoadout, ignoreWeight = false): number {
  const base = hullOf(loadout).profile.maxSpeed + (PILOTS[loadout.pilotId]?.mods.maxSpeed ?? 0);
  return Math.max(1, ignoreWeight ? base : base - Math.floor(loadoutWeight(loadout) / Math.max(0.1, WEIGHT.perSpeed)));
}

/** Prázdná loď (bez modulů) daného trupu s Kadetem – pro další sloty letky. */
export function emptyLoadout(hullId = "fighter"): ShipLoadout {
  return { hullId, pilotId: "kadet", modules: [] };
}
export function hullPoints(loadout: ShipLoadout): number {
  return HULLS[loadout.hullId]?.points ?? 1;
}
export function fleetPoints(loadouts: ShipLoadout[]): number {
  return loadouts.reduce((s, l) => s + hullPoints(l), 0);
}
/** Jméno lodi: zkratka hráče · pilot · číslo (když se pilot v letce opakuje). */
export function shipNames(playerName: string, loadouts: ShipLoadout[]): string[] {
  const abbr = playerName.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3).toUpperCase() || "PIL";
  const counts: Record<string, number> = {};
  for (const l of loadouts) counts[l.pilotId] = (counts[l.pilotId] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return loadouts.map((l) => {
    const pn = PILOTS[l.pilotId]?.name ?? l.pilotId;
    seen[l.pilotId] = (seen[l.pilotId] ?? 0) + 1;
    return counts[l.pilotId] > 1 ? `${abbr}·${pn} ${seen[l.pilotId]}` : `${abbr}·${pn}`;
  });
}
/**
 * Letka hráče: lodní body musí sedět přesně, trupy a piloti povolení, piloti se schopnostmi unikátní,
 * id modulů unikátní napříč loděmi; každá loď platná sama o sobě.
 */
export function validateFleet(loadouts: ShipLoadout[], settings: Pick<GameSettings, "shipPoints" | "allowedModules" | "allowedHulls" | "allowedPilots">, perShipBudget?: number): string | null {
  if (loadouts.length === 0) return "letka je prázdná";
  const pts = fleetPoints(loadouts);
  if (pts > settings.shipPoints) return `příliš mnoho lodních bodů (${pts}/${settings.shipPoints})`;
  const ids = new Set<string>();
  const pilotsUsed = new Set<string>();
  for (const l of loadouts) {
    if (settings.allowedHulls?.[l.hullId] === 0) return `${HULLS[l.hullId]?.name ?? l.hullId}: v této hře zakázán`;
    if (settings.allowedPilots?.[l.pilotId] === 0) return `${PILOTS[l.pilotId]?.name ?? l.pilotId}: v této hře zakázán`;
    const p = PILOTS[l.pilotId];
    if (p?.unique) {
      if (pilotsUsed.has(l.pilotId)) return `${p.name}: v letce může být jen jednou`;
      pilotsUsed.add(l.pilotId);
    }
    for (const m of [...l.modules, ...(l.cargo ?? [])]) {
      if (ids.has(m.id)) return "duplicitní modul v letce";
      ids.add(m.id);
    }
    const err = validateLoadout(l, { allowed: settings.allowedModules, budget: perShipBudget });
    if (err) return err;
  }
  return null;
}

/** Pohybový profil lodi s ohledem na váhu. */
export function profileOf(loadout: ShipLoadout, ignoreWeight = false): ManeuverProfile {
  const p = hullOf(loadout).profile;
  const maxSpeed = maxSpeedFor(loadout, ignoreWeight);
  return { ...p, maxSpeed, koiogranSpeeds: p.koiogranSpeeds.filter((s) => s <= maxSpeed) };
}

/** Je modul štít? */
export function isShield(m: Pick<ModuleInstance, "type">): boolean {
  return m.type === "shield-segment" || m.type === "shield-whole";
}
/**
 * Štíty: nainstalovat jde víc, funguje vždy právě jeden (zapnutý). Vrátí sestavu, kde je mezi funkčními štíty
 * zapnutý přesně jeden – ponechá první zapnutý, jinak zapne první funkční; zničené štíty se neřeší.
 */
export function normalizeShields(loadout: ShipLoadout): ShipLoadout {
  const working = loadout.modules.filter((m) => isShield(m) && moduleWorking(m));
  if (working.length === 0) return loadout;
  const keep = working.find((m) => !m.off) ?? working[0];
  let changed = false;
  const modules = loadout.modules.map((m) => {
    if (!isShield(m) || !moduleWorking(m)) return m;
    const off = m !== keep;
    if (!!m.off !== off) changed = true;
    return off ? { ...m, off: true } : { ...m, off: undefined };
  });
  return changed ? { ...loadout, modules } : loadout;
}
/** Zapnutý funkční štít (po normalizaci nejvýš jeden). */
export function activeShield(loadout: ShipLoadout): ModuleInstance | undefined {
  const working = loadout.modules.filter((m) => isShield(m) && moduleWorking(m));
  return working.find((m) => !m.off) ?? working[0];
}
export function shieldTypeOf(loadout: ShipLoadout): ShieldType {
  const a = activeShield(loadout);
  return a ? (a.type === "shield-whole" ? "whole" : "segment") : "none";
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
    if (def.size === "large" && !hullLargePairs(hull).some((p) => p[0] === m.slot)) return "velký modul patří do spojené dvojice slotů (příď + záď, nebo přední + zadní bok)";
    if (m.type === "mine" && m.slot === "front") return "miny nelze uložit na příď";
    if (hasFacing(m.type)) {
      if (!m.facing || !allowedFacings(m.type, m.slot).includes(m.facing)) return `${def.name}: neplatné natočení`;
    } else if (m.facing) return `${def.name}: neotáčí se`;
    for (const sl of occupiedSlots(m)) {
      perSlot[sl] = (perSlot[sl] ?? 0) + 1;
      if (perSlot[sl] > slotCapacity(hull, sl)) return `slot ${hull.slots.find((s) => s.id === sl)?.name} je obsazený`;
    }
    perType[m.type] = (perType[m.type] ?? 0) + 1;
  }
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
  return {
    ...loadout,
    modules: loadout.modules.map((m) => ({
      ...m,
      ammo: MODULES[m.type]?.ammo === undefined ? undefined : Math.max(0, Math.min(MODULES[m.type].ammo!, m.ammo ?? MODULES[m.type].ammo!)),
      facing: hasFacing(m.type) ? (m.facing ?? defaultFacing(m.type, m.slot)) : undefined,
      charges: undefined,
      cooldown: undefined,
    })),
  };
}

/** Hráč bez funkčních modulů a bez kreditů na nový dostane startovní loď zdarma (moduly nejdou prodat). */
export function needsBailout(loadout: ShipLoadout, wallet: number): boolean {
  const working = [...loadout.modules, ...(loadout.cargo ?? [])].some(moduleWorking);
  const cheapest = Math.min(...Object.values(MODULES).map((d) => d.price));
  return !working && wallet < cheapest;
}
export function bailoutLoadout(from: ShipLoadout): ShipLoadout {
  const lo = structuredClone(DEFAULT_LOADOUT);
  return { ...lo, pilotId: from.pilotId, modules: lo.modules.map((m) => ({ ...m, id: `g-${m.id}-${Date.now().toString(36)}`, used: true, gift: true })) };
}

/** Výbava po bitvě: poškozené moduly se opraví na plné hp (zničené zůstanou), vše je „použité“, munice zůstává. */
export function settleLoadoutAfterBattle(loadout: ShipLoadout): ShipLoadout {
  const fix = (m: ModuleInstance): ModuleInstance => ({ ...m, hp: moduleBroken(m) ? 0 : undefined, used: true, charges: undefined, cooldown: undefined });
  return { ...loadout, modules: loadout.modules.map(fix), cargo: loadout.cargo?.length ? loadout.cargo.map(fix) : undefined };
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
    colliders: hull.colliders ?? [{ x: 0, y: 0, r: hull.radius }],
    vision: VISION_REF.value,
    stressMax: STRESS_MAX_REF.value,
    techMax: hull.techMax ?? TECH.max,
    segmentModules: 0,
  };
  for (const m of loadout.modules) {
    const def = MODULES[m.type];
    if (!def) throw new Error(`Neznámý modul: ${m.type}`);
    if (!moduleWorking(m)) continue; // zničený modul nefunguje (váží ale dál)
    if (m.type === "laser") stats.attack = LASER_DICE.value;
    if (m.type === "torpedo") stats.torpedoes += m.ammo ?? 0;
    if (m.type === "mine") stats.mines += m.ammo ?? 0;
  }
  // štít: funguje jen zapnutý (jeden)
  const act = activeShield(loadout);
  if (act?.type === "shield-whole") stats.shields += MODULES["shield-whole"].shields ?? 0;
  if (act?.type === "shield-segment") stats.segmentModules = 1;
  // pilot
  const pm = PILOTS[loadout.pilotId]?.mods;
  if (pm) {
    if (stats.attack > 0) stats.attack = Math.max(1, stats.attack + pm.attack);
    stats.agility = Math.max(0, stats.agility + pm.agility);
    stats.hull = Math.max(10, Math.round((stats.hull * (100 + pm.hullPct)) / 100));
    stats.stressMax = Math.max(1, stats.stressMax + pm.stressMax);
  }
  return stats;
}

/** Kostky útoku laserů (ladí se). */
export const LASER_DICE = { value: 2 };
/** Max. stresových bodů (ladí se; pilot upravuje). */
export const STRESS_MAX_REF = { value: 3 };

export function hullOf(loadout: ShipLoadout): HullDef {
  return HULLS[loadout.hullId];
}

/** Náhodná sestava v rámci povolených počtů a rozpočtu (pro boty). */
export function randomLoadout(rng: () => number, allowed: Partial<Record<ModuleType, number>>, budget: number, hullId = "fighter"): ShipLoadout {
  const lo: ShipLoadout = { hullId: HULLS[hullId] ? hullId : "fighter", pilotId: "kadet", modules: [] };
  const order = [...MODULE_TYPES].sort(() => rng() - 0.5);
  let spent = 0;
  // nejdřív zbraň (pokud na ni rozpočet stačí) – bot beze zbraně by jen čekal na smrt
  const weapons = order.filter((t) => WEAPON_TYPES.includes(t) && (allowed[t] ?? 99) > 0 && MODULES[t].price <= budget);
  if (weapons.length) {
    const t = weapons[0];
    const slot = freeSlots(lo).find((sl) => !(t === "mine" && sl === "front"))!;
    lo.modules.push(newModule(t, slot, "b1"));
    spent += MODULES[t].price;
  }
  for (let round = 0; round < 3; round++) {
    for (const t of order) {
      const def = MODULES[t];
      const count = lo.modules.filter((m) => m.type === t).length;
      if ((allowed[t] ?? 99) <= count || spent + def.price > budget) continue;
      if (isShield({ type: t }) && lo.modules.some(isShield)) continue; // bot: jeden štít stačí
      if (rng() < 0.35) continue;
      const slot = freeSlots(lo).find((sl) => !(t === "mine" && sl === "front"));
      if (!slot) continue;
      lo.modules.push(newModule(t, slot, `b${lo.modules.length + 1}`));
      spent += def.price;
    }
  }
  return lo;
}

/** Přesun modulu do slotu (volný = přesun, obsazený = prohození); vrací novou sestavu nebo text chyby. */
export function moveModule(loadout: ShipLoadout, m: ModuleInstance, target: SlotId): ShipLoadout | string {
  const hull = hullOf(loadout);
  const def = MODULES[m.type];
  const occOf = (x: ModuleInstance) => occupiedSlots(x);
  const other = loadout.modules.find((x) => x.id !== m.id && occOf(x).includes(target));
  const refacing = (x: ModuleInstance, slot: SlotId): ModuleInstance => ({ ...x, slot, facing: hasFacing(x.type) ? (x.facing && allowedFacings(x.type, slot).includes(x.facing) ? x.facing : defaultFacing(x.type, slot)) : undefined });
  if (def.size === "large") {
    const pair = hullLargePairs(hull).find((p) => p.includes(target));
    if (!pair) return "velký modul patří do spojené dvojice slotů";
    const blockers = loadout.modules.filter((x) => x.id !== m.id && occOf(x).some((s) => pair.includes(s)));
    if (blockers.length === 0) return { ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? refacing(x, pair[0]) : x)) };
    const myPair = largePair(m.slot)!;
    if (blockers.length === 1 && MODULES[blockers[0].type].size === "large") return { ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? refacing(x, pair[0]) : x.id === blockers[0].id ? refacing(x, myPair[0]) : x)) };
    if (blockers.length <= 2 && blockers.every((x) => MODULES[x.type].size !== "large")) {
      // dva malé moduly se přesunou do mé uvolněné dvojice
      const out = loadout.modules.map((x) => (x.id === m.id ? refacing(x, pair[0]) : x));
      blockers.forEach((b, i) => {
        const k = out.findIndex((x) => x.id === b.id);
        out[k] = refacing(out[k], myPair[i]);
      });
      return { ...loadout, modules: out };
    }
    return "cílová dvojice slotů je obsazená";
  }
  if (!other) return { ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? refacing(x, target) : x)) };
  if (MODULES[other.type].size === "large") return "velký modul nejde prohodit s malým";
  return { ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? refacing(x, other.slot) : x.id === other.id ? refacing(x, m.slot) : x)) };
}
