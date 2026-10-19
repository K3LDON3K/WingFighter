import {
  HULLS,
  loadoutWeight,
  maxSpeedFor,
  MODULE_TYPES,
  MODULES,
  moduleCost,
  newModule,
  PILOTS,
  slotCapacity,
  validateLoadout,
  type ModuleType,
  type ShipLoadout,
  type SlotId,
} from "@spacegame/shared";
import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";

export interface LoadoutEditorOptions {
  loadout: ShipLoadout;
  /** Jen náhled (bez tlačítek). */
  readonly?: boolean;
  budget: number;
  allowed: Partial<Record<ModuleType, number>>;
  /** Zbývající munice z lodi ve hře (náhled v inventáři). */
  ammoOf?: (moduleId: string) => number | undefined;
  onChange?: (loadout: ShipLoadout) => void;
  compact?: boolean;
}

const SLOT_ORDER: SlotId[] = ["front", "left", "right", "back"];

/** Editor / náhled výbavy: loď, pilot, sloty s moduly, nákup modulů, souhrn (cena, váha, rychlost). */
export function renderLoadout(opts: LoadoutEditorOptions): HTMLElement {
  const { loadout, budget, allowed } = opts;
  const hull = HULLS[loadout.hullId] ?? HULLS.fighter;
  const cost = moduleCost(loadout);
  const weight = loadoutWeight(loadout);
  const maxSpeed = maxSpeedFor(loadout);
  const err = validateLoadout(loadout, { allowed, budget });
  const ro = !!opts.readonly;

  const change = (lo: ShipLoadout) => opts.onChange?.(lo);
  const remove = (id: string) => change({ ...loadout, modules: loadout.modules.filter((m) => m.id !== id) });
  const firstFreeSlot = (): SlotId | null => {
    for (const s of SLOT_ORDER) {
      const used = loadout.modules.filter((m) => m.slot === s).length;
      if (used < slotCapacity(hull, s)) return s;
    }
    return null;
  };
  const add = (type: ModuleType) => {
    const slot = firstFreeSlot();
    if (!slot) return;
    change({ ...loadout, modules: [...loadout.modules, newModule(type, slot)] });
  };

  /* --- sloty kolem lodi --- */
  const cell = (slot: SlotId, index: number) => {
    const mods = loadout.modules.filter((m) => m.slot === slot);
    const m = mods[index];
    if (!m) return h("div", { class: "lo-cell empty", title: `${hull.slots.find((s) => s.id === slot)?.name}: volný malý slot` }, "·");
    const def = MODULES[m.type];
    const ammo = opts.ammoOf?.(m.id) ?? m.ammo;
    return h(
      "button",
      { class: `lo-cell mod ${ro ? "ro" : ""}`, disabled: ro, title: `${def.name}${ammo !== undefined ? ` · munice ${ammo}` : ""} · váha ${def.weight + (def.ammoWeight ?? 0) * (ammo ?? 0)}${ro ? "" : "\nKlik = odebrat (vrátí cenu)"}`, onclick: () => !ro && remove(m.id) },
      icon(def.icon, "currentColor", 12),
      h("span", { class: "lo-short" }, def.short),
      ammo !== undefined ? h("span", { class: "lo-ammo" }, String(ammo)) : null,
    );
  };
  const slotBox = (slot: SlotId) => {
    const s = hull.slots.find((x) => x.id === slot)!;
    const cap = slotCapacity(hull, slot);
    return h("div", { class: `lo-slot lo-${slot}` }, h("span", { class: "lo-slotname" }, label(s.name)), h("div", { class: "lo-cells" }, ...Array.from({ length: cap }, (_, i) => cell(slot, i))));
  };
  const diagram = h(
    "div",
    { class: "lo-diagram" },
    slotBox("front"),
    h("div", { class: "lo-mid" }, slotBox("left"), h("div", { class: "lo-ship" }, icon("ship", "#60a5fa", 28)), slotBox("right")),
    slotBox("back"),
  );

  /* --- nákup --- */
  const shop = h("div", { class: "lo-shop" });
  if (!ro) {
    for (const t of MODULE_TYPES) {
      const def = MODULES[t];
      const have = loadout.modules.filter((m) => m.type === t).length;
      const max = allowed[t];
      let why: string | null = null;
      if (max === 0) why = "v této hře zakázán";
      else if (max !== undefined && have >= max) why = `max. ${max} na hráče`;
      else if (cost + def.price > budget) why = "nestačí rozpočet";
      else if (!firstFreeSlot()) why = "všechny sloty obsazené";
      else if ((t === "shield-whole" && loadout.modules.some((m) => m.type === "shield-segment")) || (t === "shield-segment" && loadout.modules.some((m) => m.type === "shield-whole"))) why = "nelze kombinovat typy štítů";
      shop.append(
        h(
          "button",
          { class: "lo-buy", disabled: !!why, title: `${def.name}\n${def.description}\nCena ${def.price} · váha ${def.weight}${def.ammo ? ` + ${def.ammoWeight} × ${def.ammo} munice` : ""}${why ? `\nNelze: ${why}` : ""}`, onclick: () => add(t) },
          icon(def.icon, "currentColor", 12),
          h("span", { class: "lo-buyname" }, label(def.short)),
          h("span", { class: "lo-price" }, `${def.price}`),
          have ? h("span", { class: "lo-have" }, `×${have}`) : null,
        ),
      );
    }
  }

  /* --- hlavička: loď + pilot --- */
  const head = h(
    "div",
    { class: "lo-head" },
    h("label", {}, h("span", {}, label("Loď")), h("select", { disabled: true }, ...Object.values(HULLS).map((x) => h("option", { value: x.id, selected: x.id === loadout.hullId }, x.name)))),
    h("label", {}, h("span", {}, label("Pilot")), h("select", { disabled: true, title: PILOTS[loadout.pilotId]?.description ?? "" }, ...Object.values(PILOTS).map((x) => h("option", { value: x.id, selected: x.id === loadout.pilotId }, x.name)))),
  );

  const summary = h(
    "div",
    { class: "lo-summary" },
    h("span", { title: "Utraceno z rozpočtu; zbytek máš ve hře jako kredity" }, icon("credits", "#fbbf24", 10), ` ${cost} / ${budget}`),
    h("span", { title: "Součet váhy modulů (včetně munice). Každých " + "N" + " váhy = −1 max. rychlost" }, icon("weight", "#94a3b8", 10), ` ${weight}`),
    h("span", { title: "Maximální rychlost lodi s touto výbavou" }, icon("speed", "#94a3b8", 10), ` ${maxSpeed}`),
  );
  const root = h("div", { class: `loadout ${opts.compact ? "compact" : ""}` }, head, diagram, summary);
  if (!ro) root.append(shop);
  if (err) root.append(h("div", { class: "error" }, err));
  return root;
}

/** Krátký štítek sestavy (pro ostatní hráče). */
export function loadoutTag(loadout: ShipLoadout): HTMLElement {
  const el = h("span", { class: "lo-tag", title: loadout.modules.map((m) => MODULES[m.type].name).join(", ") || "bez modulů" });
  if (!loadout.modules.length) el.append(h("span", { class: "muted" }, label("bez modulů")));
  for (const m of loadout.modules) el.append(icon(MODULES[m.type].icon, "#60a5fa", 10));
  el.append(h("span", { class: "muted" }, ` ${label(PILOTS[loadout.pilotId]?.name ?? "")} · `), icon("speed", "#94a3b8", 10), ` ${maxSpeedFor(loadout)}`);
  return el;
}
