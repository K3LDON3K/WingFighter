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
/** Nákres lodi: 24 px na pixel šablony, čtyři hexagonové sloty v plástvi (příď nad zádí, boky na šikmých stěnách zádi). */
const DIAG = { w: 480, h: 412, s: 24, x0: 72, y0: 14 };
const HEX_R = 50;
const HW = 2 * HEX_R;
const HH = Math.sqrt(3) * HEX_R;
const FY = 112;
const SLOT_BOX: Record<SlotId, { x: number; y: number; w: number; h: number }> = {
  front: { x: 190, y: FY, w: HW, h: HH },
  back: { x: 190, y: FY + HH, w: HW, h: HH },
  left: { x: 190 - HW * 0.75, y: FY + HH + HH / 2, w: HW, h: HH },
  right: { x: 190 + HW * 0.75, y: FY + HH + HH / 2, w: HW, h: HH },
};
function hexPoints(b: { x: number; y: number; w: number; h: number }): string {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return [0, 60, 120, 180, 240, 300].map((a) => `${(cx + HEX_R * Math.cos((a * Math.PI) / 180)).toFixed(1)},${(cy + HEX_R * Math.sin((a * Math.PI) / 180)).toFixed(1)}`).join(" ");
}
/** Barva kategorie: zbraně červeně, speciální moduly modře. */
export function moduleColor(type: ModuleType): string {
  return type === "laser" || type === "torpedo" || type === "mine" ? "#ef4444" : "#3b82f6";
}

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

  /* --- nákres lodi s hexagonovými sloty --- */
  const scale = opts.compact ? 0.62 : 1;
  const svg = svgEl("svg", { viewBox: `0 0 ${DIAG.w} ${DIAG.h}`, width: Math.round(DIAG.w * scale), height: Math.round(DIAG.h * scale), class: "lo-svg" });
  const g = svgEl("g", { transform: `translate(${DIAG.x0}, ${DIAG.y0 + 16 * DIAG.s}) rotate(-90) scale(${DIAG.s})`, "shape-rendering": "crispEdges" });
  const pal: Record<string, string> = { P: "#3b82f6", G: "#9aa3ad", D: "#4b5563", W: "#dbeafe", E: "#fb923c" };
  FIGHTER.forEach((row, y) => [...row].forEach((c, x) => pal[c] && g.append(svgEl("rect", { x, y, width: 1, height: 1, fill: pal[c] }))));
  svg.append(g);
  const free = freeSlots(loadout);
  const drawn = new Set<string>();
  const arrowAt = (box: { x: number; y: number; w: number; h: number }, f: Facing) => ({
    x: f === "left" ? box.x + 10 : f === "right" ? box.x + box.w - 10 : box.x + box.w / 2,
    y: f === "front" ? box.y + 8 : f === "back" ? box.y + box.h - 8 : box.y + box.h / 2,
    rot: f === "right" ? 90 : f === "back" ? 180 : f === "left" ? 270 : 0,
  });
  const slotBox = (slot: SlotId, box: { x: number; y: number; w: number; h: number }, m?: (typeof loadout.modules)[number]) => {
    const def = m ? MODULES[m.type] : undefined;
    const selectable = !!m && !!opts.onSelect;
    const selected = !!m && opts.selectedId === m.id;
    const grp = svgEl("g", { class: `lo-g ${m ? "mod" : "empty"} ${ro && !selectable ? "ro" : ""} ${selected ? "sel" : ""} ${selectable ? "selectable" : ""}` });
    const pts = hexPoints(box);
    if (m && def) {
      const col = selected ? "#fb923c" : moduleColor(m.type);
      grp.append(svgEl("polygon", { points: pts, fill: "#0f172a", stroke: col, "stroke-width": 3, "stroke-linejoin": "miter" }));
      grp.append(svgEl("polygon", { points: pts, fill: col, opacity: selected ? 0.3 : 0.18 }));
      const ammo = opts.ammoOf?.(m.id) ?? m.ammo;
      const words = def.name.toUpperCase().split(" ");
      const long = Math.max(...words.map((w) => w.length)) > 8;
      const fs = long ? 9.5 : 12;
      const base = box.y + box.h / 2 + 4 - (words.length - 1) * 6;
      words.forEach((w, i) => grp.append(svgEl("text", { x: box.x + box.w / 2, y: base + i * 12, "font-family": "Pix, ui-monospace, monospace", "font-size": fs, fill: "#f8fafc", "text-anchor": "middle" }, w)));
      if (ammo !== undefined) grp.append(svgEl("text", { x: box.x + box.w / 2 + 20, y: box.y + 14, "font-family": "PS2P", "font-size": 7, fill: "#fbbf24", "text-anchor": "middle" }, String(ammo)));
      if (m.type === "scanner") grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + 14, "font-family": "PS2P", "font-size": 6, fill: (m.cooldown ?? 0) > 0 ? "#f87171" : "#fbbf24", "text-anchor": "middle" }, (m.cooldown ?? 0) > 0 ? `CD ${m.cooldown}` : `${m.charges ?? 0}×`));
      if (hasFacing(m.type)) {
        // šipky natočení: všechny povolené směry (šedé = možnosti, žlutá = zvolený); boční v cípech, ↑↓ uprostřed hran
        for (const f of allowedFacings(m.type, m.slot)) {
          const sel = (m.facing ?? "front") === f;
          const a = arrowAt(box, f);
          const col2 = sel ? "#fbbf24" : "#64748b";
          const arrow = svgEl("g", { class: `lo-arrow ${sel ? "sel" : "opt"} ${ro ? "ro" : ""}`, transform: `translate(${a.x}, ${a.y}) rotate(${a.rot})` });
          arrow.append(svgEl("rect", { x: -7, y: -7, width: 14, height: 14, fill: sel ? "#0b1020" : "rgba(11,16,32,0.7)", stroke: col2, "stroke-width": 1, ...(sel ? {} : { "stroke-dasharray": "2 1" }) }));
          arrow.append(svgEl("path", { d: "M0,-5 L5,2 L1.5,2 L1.5,5 L-1.5,5 L-1.5,2 L-5,2 Z", fill: col2 }));
          arrow.append(svgEl("title", {}, `${FACING_NAMES[f]}${sel ? " (zvoleno)" : ro ? "" : " – klik = natočit"}`));
          if (!ro && !sel) {
            arrow.addEventListener("click", (ev) => {
              ev.stopPropagation();
              change({ ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? { ...x, facing: f } : x)) });
            });
          }
          grp.append(arrow);
        }
      }
      if (!ro && !selectable) {
        const x = svgEl("g", { class: "lo-remove", transform: `translate(${box.x + box.w - 24}, ${box.y + box.h - 14})` });
        x.append(svgEl("rect", { x: -7, y: -7, width: 14, height: 14, fill: "#0b1020", stroke: "#f87171", "stroke-width": 1 }));
        x.append(svgEl("path", { d: "M-4,-4 L4,4 M4,-4 L-4,4", stroke: "#f87171", "stroke-width": 2 }));
        x.append(svgEl("title", {}, `Odebrat ${def.name} (vrátí ${def.price} kreditů)`));
        x.addEventListener("click", (ev) => {
          ev.stopPropagation();
          remove(m.id);
        });
        grp.append(x);
      }
      grp.append(svgEl("title", {}, `${def.name}${ammo !== undefined ? ` · munice ${ammo}` : ""} · váha ${def.weight + (def.ammoWeight ?? 0) * (ammo ?? 0)}${selectable ? "\nKlik = vybrat k vyhození" : ""}`));
      if (selectable) grp.addEventListener("click", () => opts.onSelect!(m.id));
    } else {
      const name = hull.slots.find((x) => x.id === slot)?.name ?? slot;
      grp.append(svgEl("polygon", { points: pts, fill: "rgba(5,7,15,0.55)", stroke: "#7dd3fc", "stroke-width": 3, "stroke-dasharray": "6 4" }));
      grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 4, "font-family": "Pix, ui-monospace, monospace", "font-size": 11, fill: "#7dd3fc", "text-anchor": "middle" }, name.toUpperCase()));
      grp.append(svgEl("title", {}, `${name}: volný malý slot`));
    }
    svg.append(grp);
  };
  if (LARGE_SLOTS.every((sl) => free.includes(sl))) {
    const f = SLOT_BOX.front;
    const b = SLOT_BOX.back;
    svg.append(svgEl("rect", { x: f.x - 8, y: f.y - 8, width: f.w + 16, height: b.y + b.h - f.y + 16, fill: "none", stroke: "#fbbf24", "stroke-width": 2, "stroke-dasharray": "3 5" }));
    svg.append(svgEl("text", { x: f.x + f.w / 2, y: f.y - 14, "font-family": "PS2P", "font-size": 7, fill: "#fbbf24", "text-anchor": "middle" }, "1 VELKY"));
  }
  for (const m of loadout.modules) {
    const occ = occupiedSlots(m);
    if (MODULES[m.type].size === "large") {
      slotBox("front", SLOT_BOX.front, m);
      slotBox("back", SLOT_BOX.back, m);
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
          { class: "lo-buy", style: `--mc:${moduleColor(t)}`, disabled: !!why, title: `${def.name}\n${def.description}\nCena ${def.price} · váha ${def.weight}${def.ammo ? ` + ${def.ammoWeight} × ${def.ammo} munice` : ""}${why ? `\nNelze: ${why}` : ""}`, onclick: () => add(t) },
          icon(def.icon, "currentColor", 12),
          h("span", { class: "lo-buyname txt" }, def.name),
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
