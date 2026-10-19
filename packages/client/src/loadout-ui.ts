import {
  allowedFacings,
  FACING_NAMES,
  freeSlots,
  hasFacing,
  HULLS,
  LARGE_SLOTS,
  loadoutWeight,
  maxSpeedFor,
  MODULE_TYPES,
  MODULES,
  moduleCost,
  newModule,
  occupiedSlots,
  PILOTS,
  validateLoadout,
  type Facing,
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
  /** Bez řádku loď / pilot (inventář ve hře). */
  hideHead?: boolean;
  /** Výběr modulu (např. vyhození): klik na modul ho označí místo odebrání. */
  onSelect?: (moduleId: string) => void;
  selectedId?: string;
}

const NS = "http://www.w3.org/2000/svg";
const FIGHTER = ["..GG............", "..GPG...........", "..GPPG..........", "EEDPPPG.........", "..GPPPPGGG......", "...GPPPPPPGGGG..", "EEDDPWWPPPPPPPGG", "EEDDPWWPPPPPPPGG", "...GPPPPPPGGGG..", "..GPPPPGGG......", "EEDPPPG.........", "..GPPG..........", "..GPG...........", "..GG............"];
/** Rozměry nákresu (varianta A): loď 16 px / pixel šablony, sloty uvnitř siluety. */
const DIAG = { w: 340, h: 290, s: 16, x0: 58, y0: 16 };
const SLOT_BOX: Record<SlotId, { x: number; y: number; w: number; h: number }> = {
  front: { x: 138, y: 92, w: 64, h: 74 },
  back: { x: 138, y: 166, w: 64, h: 74 },
  left: { x: 72, y: 136, w: 60, h: 48 },
  right: { x: 208, y: 136, w: 60, h: 48 },
};

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

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
  const firstFreeSlot = (): SlotId | null => freeSlots(loadout)[0] ?? null;
  const add = (type: ModuleType) => {
    const def = MODULES[type];
    const slot = def.size === "large" ? (LARGE_SLOTS.every((sl) => freeSlots(loadout).includes(sl)) ? LARGE_SLOTS[0] : null) : firstFreeSlot();
    if (!slot) return;
    change({ ...loadout, modules: [...loadout.modules, newModule(type, slot)] });
  };

  /* --- nákres lodi se sloty (varianta A) --- */
  const scale = opts.compact ? 0.72 : 1;
  const svg = svgEl("svg", { viewBox: `0 0 ${DIAG.w} ${DIAG.h}`, width: Math.round(DIAG.w * scale), height: Math.round(DIAG.h * scale), "shape-rendering": "crispEdges", class: "lo-svg" });
  const g = svgEl("g", { transform: `translate(${DIAG.x0}, ${DIAG.y0 + 16 * DIAG.s}) rotate(-90) scale(${DIAG.s})` });
  const pal: Record<string, string> = { P: "#3b82f6", G: "#9aa3ad", D: "#4b5563", W: "#dbeafe", E: "#fb923c" };
  FIGHTER.forEach((row, y) => [...row].forEach((c, x) => pal[c] && g.append(svgEl("rect", { x, y, width: 1, height: 1, fill: pal[c] }))));
  svg.append(g);
  const free = freeSlots(loadout);
  const drawn = new Set<string>();
  const slotBox = (slot: SlotId, box: { x: number; y: number; w: number; h: number }, m?: (typeof loadout.modules)[number]) => {
    const def = m ? MODULES[m.type] : undefined;
    const large = def?.size === "large";
    const stroke = large ? "#fbbf24" : "#7dd3fc";
    const selectable = !!m && !!opts.onSelect;
    const selected = !!m && opts.selectedId === m.id;
    const grp = svgEl("g", { class: `lo-g ${m ? "mod" : "empty"} ${ro && !selectable ? "ro" : ""} ${selected ? "sel" : ""}` });
    grp.append(svgEl("rect", { x: box.x, y: box.y, width: box.w, height: box.h, fill: selected ? "#4a2a1e" : m ? "#1e2a4a" : "rgba(5,7,15,0.55)", stroke: selected ? "#fb923c" : stroke, "stroke-width": 3, ...(m ? {} : { "stroke-dasharray": "6 4" }) }));
    if (m && def) {
      const ammo = opts.ammoOf?.(m.id) ?? m.ammo;
      grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 4, "font-family": "PS2P", "font-size": 10, fill: "#e2e8f0", "text-anchor": "middle" }, label(def.short)));
      if (ammo !== undefined) grp.append(svgEl("text", { x: box.x + box.w - 6, y: box.y + 11, "font-family": "PS2P", "font-size": 7, fill: "#fbbf24", "text-anchor": "end" }, String(ammo)));
      if (hasFacing(m.type)) {
        // šipka natočení v levém horním rohu modulu (klik = otočit)
        const ax = box.x + 10;
        const ay = box.y + 10;
        const rot = m.facing === "right" ? 90 : m.facing === "back" ? 180 : m.facing === "left" ? 270 : 0;
        const arrow = svgEl("g", { class: `lo-arrow ${ro ? "ro" : ""}`, transform: `translate(${ax}, ${ay}) rotate(${rot})` });
        arrow.append(svgEl("rect", { x: -7, y: -7, width: 14, height: 14, fill: "#0b1020", stroke: "#fbbf24", "stroke-width": 1 }));
        arrow.append(svgEl("path", { d: "M0,-5 L5,2 L1.5,2 L1.5,5 L-1.5,5 L-1.5,2 L-5,2 Z", fill: "#fbbf24" }));
        arrow.append(svgEl("title", {}, `Natočení: ${FACING_NAMES[m.facing ?? "front"]}${ro ? "" : "\nKlik = otočit (jen ven ze slotu)"}`));
        if (!ro) {
          arrow.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const opts = allowedFacings(m.type, m.slot);
            const next: Facing = opts[(opts.indexOf(m.facing ?? opts[0]) + 1) % opts.length];
            change({ ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? { ...x, facing: next } : x)) });
          });
        }
        grp.append(arrow);
      }
      const title = svgEl("title", {}, `${def.name}${ammo !== undefined ? ` · munice ${ammo}` : ""} · váha ${def.weight + (def.ammoWeight ?? 0) * (ammo ?? 0)}${selectable ? "\nKlik = vybrat k vyhození" : ro ? "" : "\nKlik = odebrat (vrátí cenu)"}`);
      grp.append(title);
      if (selectable) grp.addEventListener("click", () => opts.onSelect!(m.id));
      else if (!ro) grp.addEventListener("click", () => remove(m.id));
    } else {
      const name = hull.slots.find((x) => x.id === slot)?.name ?? slot;
      grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 3, "font-family": "PS2P", "font-size": 6, fill: stroke, "text-anchor": "middle" }, label(name)));
      grp.append(svgEl("title", {}, `${name}: volný malý slot`));
    }
    svg.append(grp);
  };
  // žlutý rám "1 velký" kolem přídě + zádi, když jsou obě volné
  if (LARGE_SLOTS.every((sl) => free.includes(sl))) {
    const f = SLOT_BOX.front;
    const b = SLOT_BOX.back;
    svg.append(svgEl("rect", { x: f.x - 6, y: f.y - 6, width: f.w + 12, height: b.y + b.h - f.y + 12, fill: "none", stroke: "#fbbf24", "stroke-width": 2, "stroke-dasharray": "3 5" }));
    svg.append(svgEl("text", { x: f.x + f.w / 2, y: f.y - 12, "font-family": "PS2P", "font-size": 7, fill: "#fbbf24", "text-anchor": "middle" }, "1 VELKY"));
  }
  for (const m of loadout.modules) {
    const occ = occupiedSlots(m);
    if (MODULES[m.type].size === "large") {
      const f = SLOT_BOX.front;
      const b = SLOT_BOX.back;
      slotBox("front", { x: f.x, y: f.y, w: f.w, h: b.y + b.h - f.y }, m);
    } else slotBox(m.slot, SLOT_BOX[m.slot], m);
    occ.forEach((sl) => drawn.add(sl));
  }
  for (const sl of hull.slots) if (!drawn.has(sl.id)) slotBox(sl.id, SLOT_BOX[sl.id]);
  const diagram = h("div", { class: "lo-diagram" }, svg);

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
  const root = h("div", { class: `loadout ${opts.compact ? "compact" : ""}` }, opts.hideHead ? null : head, diagram, summary);
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
