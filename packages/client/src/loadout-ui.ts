import {
  moduleBroken,
  moduleHp,
  type PilotDef,
  type PilotMods,
  moduleSellPrice,
  ammoRefillCost,
  type ModuleInstance,
  cargoCapacity,
  moduleWeight,
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
  WEIGHT,
  isShield,
  moduleWorking,
  normalizeShields,
  type Facing,
  type ModuleType,
  type ShipLoadout,
  type SlotId,
} from "@wingfighter/shared";
import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";
import { pilotPortrait } from "./pilot-ui.ts";

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
  /** Zobrazit nákladový prostor (ve hře). */
  showCargo?: boolean;
  /** Obchod v místnosti: kredity hráče; nákup za cenu, prodej za prodejní cenu, dokoupení munice po kusech. */
  wallet?: number;
  /** Výběr trupu a pilota (místnost): povolené id; chybí = výběr zamčený. */
  hullChoices?: string[];
  pilotChoices?: string[];
  /** Piloti už použití v jiných lodích letky (unikátní nejdou vybrat podruhé). */
  pilotsTaken?: string[];
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
let hpClipSeq = 0;
/**
 * Výplň hexu podle životů modulu (varianta A): barva ubývá odshora dolů, nad hladinou zůstává tmavý podklad
 * a tenká linka hladiny. Plné životy = beze změny.
 */
function hpFill(pts: string, box: { y: number; h: number }, col: string, opacity: number, frac: number): SVGElement[] {
  const poly = svgEl("polygon", { points: pts, fill: col, opacity });
  if (frac >= 1) return [poly];
  const id = `hpc${hpClipSeq++}`;
  const top = box.y + box.h * (1 - frac);
  const defs = svgEl("defs", {});
  const clip = svgEl("clipPath", { id });
  clip.append(svgEl("polygon", { points: pts }));
  defs.append(clip);
  poly.setAttribute("clip-path", `url(#${id})`);
  // oříznutí hladiny: polygon zobrazíme jen pod linkou
  const band = svgEl("clipPath", { id: `${id}b` });
  band.append(svgEl("rect", { x: -9999, y: top, width: 99999, height: 99999 }));
  defs.append(band);
  const g = svgEl("g", { "clip-path": `url(#${id}b)` });
  g.append(poly);
  const line = svgEl("line", { x1: -9999, y1: top, x2: 99999, y2: top, stroke: col, "stroke-width": 1, opacity: 0.7, "clip-path": `url(#${id})` });
  return [defs, g, line];
}
/** Podíl zbývajících životů modulu 0–1. */
function hpFrac(m: ModuleInstance): number {
  const max = MODULES[m.type].hp;
  return max > 0 ? Math.max(0, Math.min(1, moduleHp(m) / max)) : 1;
}

/** Barva kategorie: zbraně červeně, speciální moduly modře. */
export function moduleColor(type: ModuleType): string {
  if (type === "droid") return "#c084fc";
  return type === "laser" || type === "torpedo" || type === "mine" || type === "mg" ? "#ef4444" : "#3b82f6";
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Výběr slotu / modulu v editoru: nejdřív slot a pak modul z obchodu, nebo naopak. Esc / klik vedle = zrušit. */
let pickSlot: SlotId | null = null;
let pickType: ModuleType | null = null;
/** Otevřené okénko výběru lodi / pilota. */
let pickerOpen: "hull" | "pilot" | null = null;
/** Zruší rozpracovaný výběr (volá se po umístění, při Esc a při kliku mimo editor). */
export function clearLoadoutPick(): boolean {
  const had = !!(pickSlot || pickType || pickerOpen);
  pickSlot = null;
  pickType = null;
  pickerOpen = null;
  return had;
}

/** Editor / náhled výbavy: loď, pilot, sloty s moduly, nákup modulů, souhrn (cena, váha, rychlost). */
export function renderLoadout(opts: LoadoutEditorOptions): HTMLElement {
  const { loadout, budget, allowed } = opts;
  const hull = HULLS[loadout.hullId] ?? HULLS.fighter;
  const cost = moduleCost(loadout);
  const weight = loadoutWeight(loadout);
  const maxSpeed = maxSpeedFor(loadout);
  const shop = opts.wallet !== undefined;
  const err = validateLoadout(loadout, { allowed, budget: shop ? undefined : budget });
  const ro = !!opts.readonly;

  const change = (lo: ShipLoadout) => opts.onChange?.(normalizeShields(lo));
  /** Překreslení editoru na místě (změna výběru slotu/modulu bez změny výbavy). */
  const rerender = () => {
    const next = renderLoadout(opts);
    rootRef?.replaceWith(next);
  };
  let rootRef: HTMLElement | null = null;
  const remove = (id: string) => change({ ...loadout, modules: loadout.modules.filter((m) => m.id !== id), cargo: loadout.cargo?.filter((m) => m.id !== id) });
  const wallet = opts.wallet ?? 0;
  const refill = (id: string) => {
    const fix = (m: ModuleInstance) => (m.id === id ? { ...m, ammo: MODULES[m.type].ammo } : m);
    change({ ...loadout, modules: loadout.modules.map(fix), cargo: loadout.cargo?.map(fix) });
  };
  const firstFreeSlot = (): SlotId | null => freeSlots(loadout)[0] ?? null;
  /** Přidá modul: do vybraného slotu (pickSlot), jinak do prvního volného. */
  const add = (type: ModuleType, into?: SlotId | null) => {
    const def = MODULES[type];
    const want = into ?? pickSlot;
    const slot = def.size === "large" ? (LARGE_SLOTS.every((sl) => freeSlots(loadout).includes(sl)) ? LARGE_SLOTS[0] : null) : want && freeSlots(loadout).includes(want) ? want : firstFreeSlot();
    if (!slot) return;
    clearLoadoutPick();
    change({ ...loadout, modules: [...loadout.modules, newModule(type, slot)] });
  };
  /** Lze teď koupit (vybraný modul z obchodu)? Stejná pravidla jako tlačítko v obchodě. */
  const buyWhy = (t: ModuleType): string | null => {
    const def = MODULES[t];
    const have = loadout.modules.filter((m) => m.type === t).length;
    const max = allowed[t];
    if (max === 0) return "v této hře zakázán";
    if (max !== undefined && have >= max) return `max. ${max} na hráče`;
    if (shop ? def.price > wallet : cost + def.price > budget) return shop ? "nedostatek kreditů" : "nestačí rozpočet";
    if (!firstFreeSlot()) return "všechny sloty obsazené";
    return null;
  };
  if (pickType && (ro || buyWhy(pickType))) pickType = null;
  if (pickSlot && (ro || !freeSlots(loadout).includes(pickSlot))) pickSlot = null;

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
      const broken = moduleBroken(m);
      const shieldOff = isShield(m) && !broken && !!m.off;
      const col = selected ? "#fb923c" : broken ? "#ef4444" : shieldOff ? "#475569" : moduleColor(m.type);
      grp.append(svgEl("polygon", { points: pts, fill: broken ? "#3b0a0a" : "#0f172a", stroke: col, "stroke-width": 3, "stroke-linejoin": "miter", ...(shieldOff ? { "stroke-dasharray": "6 4" } : {}) }));
      grp.append(...hpFill(pts, box, col, selected ? 0.3 : broken ? 0.35 : shieldOff ? 0.08 : 0.18, broken ? 1 : hpFrac(m)));
      if (broken) grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h - 6, "font-family": "Jersey", "font-size": 10, fill: "#fca5a5", "text-anchor": "middle" }, "ZNIČEN"));
      if (isShield(m) && !broken) {
        // vypínač štítu: funguje vždy jen jeden; vypnout jde jen když je k dispozici jiný funkční štít
        const others = loadout.modules.filter((x) => x.id !== m.id && isShield(x) && moduleWorking(x));
        const canOff = others.length > 0;
        const sw = svgEl("g", { class: `lo-switch ${m.off ? "off" : "on"} ${!ro && (m.off || canOff) ? "" : "fixed"}`, transform: `translate(${box.x + 24}, ${box.y + 14})` });
        sw.append(svgEl("rect", { x: -16, y: -7, width: 32, height: 14, fill: m.off ? "#0b1020" : "#14532d", stroke: m.off ? "#64748b" : "#4ade80", "stroke-width": 1 }));
        sw.append(svgEl("rect", { x: m.off ? -14 : 2, y: -5, width: 12, height: 10, fill: m.off ? "#475569" : "#4ade80" }));
        sw.append(svgEl("text", { x: m.off ? 7 : -7, y: 3.5, "font-family": "Jersey", "font-size": 9, fill: m.off ? "#94a3b8" : "#bbf7d0", "text-anchor": "middle" }, m.off ? "VYP" : "ZAP"));
        sw.append(svgEl("title", {}, m.off ? "Štít je vypnutý (záloha). Klik = zapnout (druhý štít se vypne)." : canOff ? "Štít je zapnutý. Klik = vypnout – zapne se druhý nainstalovaný štít." : "Štít je zapnutý. Jediný funkční štít nejde vypnout."));
        if (!ro && (m.off || canOff))
          sw.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const target = m.off ? m.id : others[0].id;
            change(normalizeShields({ ...loadout, modules: loadout.modules.map((x) => (isShield(x) ? { ...x, off: x.id === target ? undefined : true } : x)) }));
          });
        grp.append(sw);
        if (shieldOff) grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h - 6, "font-family": "Jersey", "font-size": 10, fill: "#94a3b8", "text-anchor": "middle" }, "ZÁLOHA"));
      }
      const ammo = opts.ammoOf?.(m.id) ?? m.ammo;
      const words = def.name.toUpperCase().split(" ");
      const long = Math.max(...words.map((w) => w.length)) > 8;
      const fs = long ? 13 : 16;
      const base = box.y + box.h / 2 + 4 - (words.length - 1) * 6;
      words.forEach((w, i) => grp.append(svgEl("text", { x: box.x + box.w / 2, y: base + i * 12, "font-family": "Jersey, ui-monospace, monospace", "font-size": fs, fill: "#f8fafc", "text-anchor": "middle" }, w)));
      if (ammo !== undefined) grp.append(svgEl("text", { x: box.x + box.w / 2 + 20, y: box.y + 14, "font-family": "Jersey", "font-size": 12, fill: "#fbbf24", "text-anchor": "middle" }, String(ammo)));
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
      if (!ro && !selectable && shop && !moduleBroken(m) && ammoRefillCost(m) > 0) {
        const price = ammoRefillCost(m);
        const can = price <= wallet;
        const r = svgEl("g", { class: `lo-refill ${can ? "" : "dis"}`, transform: `translate(${box.x + 24}, ${box.y + box.h - 14})` });
        r.append(svgEl("rect", { x: -16, y: -7, width: 32, height: 14, fill: "#0b1020", stroke: can ? "#fbbf24" : "#64748b", "stroke-width": 1 }));
        r.append(svgEl("text", { x: 0, y: 4, "font-family": "Jersey", "font-size": 10, fill: can ? "#fbbf24" : "#64748b", "text-anchor": "middle" }, `+${price}`));
        r.append(svgEl("title", {}, `Doplnit munici (${def.ammo! - (m.ammo ?? 0)} ks) za ${price} kreditů${can ? "" : " – nedostatek kreditů"}`));
        if (can)
          r.addEventListener("click", (ev) => {
            ev.stopPropagation();
            refill(m.id);
          });
        grp.append(r);
      }
      if (!ro && !selectable) {
        const x = svgEl("g", { class: "lo-remove", transform: `translate(${box.x + box.w - 24}, ${box.y + box.h - 14})` });
        x.append(svgEl("rect", { x: -7, y: -7, width: 14, height: 14, fill: "#0b1020", stroke: "#f87171", "stroke-width": 1 }));
        x.append(svgEl("path", { d: "M-4,-4 L4,4 M4,-4 L-4,4", stroke: "#f87171", "stroke-width": 2 }));
        x.append(svgEl("title", {}, shop ? m.gift ? `${def.name}: záchranná výbava – nejde prodat (odebrání = zahození)` : `Prodat ${def.name} za ${moduleSellPrice(m)} kreditů${moduleBroken(m) ? " (zničený)" : m.used ? " (použitý)" : ""}` : `Odebrat ${def.name} (vrátí ${def.price} kreditů)`));
        x.addEventListener("click", (ev) => {
          ev.stopPropagation();
          remove(m.id);
        });
        grp.append(x);
      }
      grp.append(svgEl("title", {}, `${def.name}${ammo !== undefined ? ` · munice ${ammo}` : ""} · životy ${moduleHp(m)}/${def.hp} · váha ${def.weight + (def.ammoWeight ?? 0) * (ammo ?? 0)}${selectable ? "\nKlik = vybrat k vyhození" : ""}`));
      if (selectable) grp.addEventListener("click", () => opts.onSelect!(m.id));
    } else {
      const name = hull.slots.find((x) => x.id === slot)?.name ?? slot;
      const picked = pickSlot === slot;
      const hot = !!pickType && !ro; // vybraný modul v obchodě → sloty čekají na klik
      if (picked) {
        grp.classList.add("slot-pick");
        grp.append(svgEl("polygon", { points: pts, fill: "rgba(125,211,252,0.25)", stroke: "#7dd3fc", "stroke-width": 5 }));
        grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 5, "font-family": "Jersey, ui-monospace, monospace", "font-size": 16, fill: "#7dd3fc", "text-anchor": "middle" }, "SEM ◆"));
        grp.append(svgEl("title", {}, `${name}: vybraný slot – klikni na modul v obchodě (znovu klik = zrušit)`));
      } else if (hot) {
        grp.classList.add("slot-hot");
        grp.append(svgEl("polygon", { points: pts, fill: "rgba(125,211,252,0.14)", stroke: "#7dd3fc", "stroke-width": 3, "stroke-dasharray": "6 4" }));
        grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 8, "font-family": "Jersey, ui-monospace, monospace", "font-size": 24, fill: "#7dd3fc", "text-anchor": "middle" }, "+"));
        grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 22, "font-family": "Jersey, ui-monospace, monospace", "font-size": 11, fill: "#7dd3fc", "text-anchor": "middle" }, name.toUpperCase()));
        grp.append(svgEl("title", {}, `${name}: sem umístit ${MODULES[pickType!].name}`));
      } else {
        grp.append(svgEl("polygon", { points: pts, fill: "rgba(5,7,15,0.55)", stroke: ro ? "#7dd3fc" : "#7dd3fc", "stroke-width": 3, "stroke-dasharray": "6 4" }));
        grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 4, "font-family": "Jersey, ui-monospace, monospace", "font-size": 15, fill: "#7dd3fc", "text-anchor": "middle" }, name.toUpperCase()));
        grp.append(svgEl("title", {}, ro ? `${name}: volný malý slot` : `${name}: volný slot – klik = vybrat, pak modul v obchodě`));
      }
      if (!ro && !selectable) {
        grp.classList.add("slot-free");
        grp.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (pickType) add(pickType, slot);
          else {
            pickSlot = picked ? null : slot;
            rerender();
          }
        });
      }
    }
    svg.append(grp);
  };
  if (LARGE_SLOTS.every((sl) => free.includes(sl))) {
    const f = SLOT_BOX.front;
    const b = SLOT_BOX.back;
    svg.append(svgEl("rect", { x: f.x - 8, y: f.y - 8, width: f.w + 16, height: b.y + b.h - f.y + 16, fill: "none", stroke: "#fbbf24", "stroke-width": 2, "stroke-dasharray": "3 5" }));
    svg.append(svgEl("text", { x: f.x + f.w / 2, y: f.y - 14, "font-family": "Jersey", "font-size": 12, fill: "#fbbf24", "text-anchor": "middle" }, "1 VELKY"));
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

  /* --- náklad: zvednuté moduly (nefungují, jen váží) --- */
  if (opts.showCargo) {
    const cap = cargoCapacity(loadout);
    const items = loadout.cargo ?? [];
    const row = h("div", { class: "lo-cargo" }, h("span", { class: "lo-cargo-cap" }, label(`Náklad ${items.length}/${cap}`)));
    const hexW = 64;
    const hexH = 56;
    for (let i = 0; i < Math.max(cap, items.length); i++) {
      const m = items[i];
      const csvg = svgEl("svg", { viewBox: `0 0 ${hexW} ${hexH}`, width: hexW, height: hexH, class: "lo-cargo-hex" });
      const pts = hexPoints({ x: 2, y: 2, w: hexW - 4, h: hexH - 4 });
      if (m) {
        const def = MODULES[m.type];
        const selected = opts.selectedId === m.id;
        const broken = moduleBroken(m);
        const col = selected ? "#fb923c" : broken ? "#ef4444" : moduleColor(m.type);
        csvg.append(svgEl("polygon", { points: pts, fill: broken ? "#3b0a0a" : "#0f172a", stroke: col, "stroke-width": 3, "stroke-linejoin": "miter" }));
        csvg.append(...hpFill(pts, { y: 2, h: hexH - 4 }, col, selected ? 0.3 : broken ? 0.35 : 0.18, broken ? 1 : hpFrac(m)));
        if (broken) csvg.append(svgEl("text", { x: hexW / 2, y: hexH - 5, "font-family": "Jersey", "font-size": 9, fill: "#fca5a5", "text-anchor": "middle" }, "ZNIČEN"));
        const words = def.name.toUpperCase().split(" ");
        words.forEach((w, k) => csvg.append(svgEl("text", { x: hexW / 2, y: hexH / 2 + 4 - (words.length - 1) * 5 + k * 10, "font-family": "Jersey, ui-monospace, monospace", "font-size": 11, fill: "#f8fafc", "text-anchor": "middle" }, w)));
        if (m.ammo !== undefined) csvg.append(svgEl("text", { x: hexW / 2, y: 12, "font-family": "Jersey", "font-size": 10, fill: "#fbbf24", "text-anchor": "middle" }, String(m.ammo)));
        csvg.append(svgEl("title", {}, shop ? `${def.name} v nákladu${broken ? " – zničený" : ""}: prodat za ${moduleSellPrice(m)} kreditů (klik)` : `${def.name} v nákladu (váha ${moduleWeight(m)}) – nefunguje; lze vyhodit${opts.onSelect ? ", klik = vybrat" : ""}`));
        if (opts.onSelect) {
          csvg.classList.add("selectable");
          csvg.addEventListener("click", () => opts.onSelect!(m.id));
        } else if (shop && !ro) {
          csvg.classList.add("selectable");
          csvg.append(svgEl("text", { x: hexW / 2, y: hexH - 14, "font-family": "Jersey", "font-size": 9, fill: "#f87171", "text-anchor": "middle" }, `PRODAT ${moduleSellPrice(m)}`));
          csvg.addEventListener("click", () => remove(m.id));
        }
      } else {
        csvg.append(svgEl("polygon", { points: pts, fill: "none", stroke: "#334155", "stroke-width": 2, "stroke-dasharray": "3 4" }));
        csvg.append(svgEl("text", { x: hexW / 2, y: hexH / 2 + 4, "font-family": "Jersey", "font-size": 10, fill: "#64748b", "text-anchor": "middle" }, "VOLNÉ"));
        csvg.append(svgEl("title", {}, "Volné místo v nákladu – akce Zvednout náklad"));
      }
      row.append(csvg);
    }
    diagram.append(row);
  }

  /* --- nákup --- */
  const shopEl = h("div", { class: "lo-shop" });
  if (!ro) {
    for (const t of MODULE_TYPES) {
      const def = MODULES[t];
      const have = loadout.modules.filter((m) => m.type === t).length;
      const max = allowed[t];
      let why: string | null = null;
      if (max === 0) why = "v této hře zakázán";
      else if (max !== undefined && have >= max) why = `max. ${max} na hráče`;
      else if (shop ? def.price > wallet : cost + def.price > budget) why = shop ? "nedostatek kreditů" : "nestačí rozpočet";
      else if (!firstFreeSlot()) why = "všechny sloty obsazené";
      const btn = hexBuyButton(t, have, why, () => {
        if (pickSlot) add(t, pickSlot);
        else if (pickType === t) {
          pickType = null;
          rerender();
        } else if (why) return;
        else {
          // bez vybraného slotu: modul se vybere a čeká na klik do slotu (klik znovu = koupit do prvního volného)
          pickType = t;
          rerender();
        }
      });
      if (pickType === t) btn.classList.add("picked");
      shopEl.append(btn);
    }
  }

  /* --- hlavička: výběr lodi a pilota z dlaždic (podobizna, jméno, infografika schopností) --- */
  const MOD_ICON: { key: keyof PilotMods; icon: string; name: string }[] = [
    { key: "attack", icon: "laser", name: "útok" },
    { key: "agility", icon: "evade", name: "obrana" },
    { key: "stressMax", icon: "target", name: "stres" },
    { key: "maxSpeed", icon: "speed", name: "rychlost" },
    { key: "hullPct", icon: "shield", name: "trup" },
  ];
  const modInfo = (pd: PilotDef) => {
    const row = h("span", { class: "pk-mods" });
    const any = MOD_ICON.filter((m) => pd.mods[m.key] !== 0);
    if (!any.length) {
      row.append(h("span", { class: "pk-none" }, "—"));
      return row;
    }
    for (const m of any) {
      const v = pd.mods[m.key];
      row.append(h("span", { class: `pk-mod ${v > 0 ? "up" : "down"}` }, icon(m.icon, v > 0 ? "#86efac" : "#fca5a5", 10), h("i", {}, `${v > 0 ? "+" : ""}${v}${m.key === "hullPct" ? "%" : ""}`)));
    }
    return row;
  };
  const canPick = !ro && !!opts.onChange;
  const hullTiles = Object.values(HULLS)
    .filter((x) => x.id === loadout.hullId || !opts.hullChoices || opts.hullChoices.includes(x.id))
    .map((x) => {
      const on = x.id === loadout.hullId;
      return h(
        "button",
        { class: `pk-tile hull ${on ? "on" : ""}`, disabled: !canPick || !opts.hullChoices, title: `${x.name}\n${x.description}\nLodní body: ${x.points} · trup ${x.hull} · sloty: ${x.slots.map((sl) => sl.name).join(", ")} · náklad ${x.cargo}`, onclick: () => ((pickerOpen = null), change({ ...loadout, hullId: x.id })) },
        h("span", { class: "pk-pic" }, icon("ship", on ? "#7dd3fc" : "#64748b", 28)),
        h("span", { class: "pk-name" }, label(x.name)),
        h("span", { class: "pk-sub" }, `${x.points} ${x.points === 1 ? "bod" : "body"}`),
      );
    });
  const pilotTiles = Object.values(PILOTS)
    .filter((x) => x.id === loadout.pilotId || !opts.pilotChoices || opts.pilotChoices.includes(x.id))
    .map((x) => {
      const on = x.id === loadout.pilotId;
      const taken = x.unique && !on && (opts.pilotsTaken ?? []).includes(x.id);
      return h(
        "button",
        { class: `pk-tile pilot ${on ? "on" : ""} ${taken ? "taken" : ""}`, disabled: !canPick || !opts.pilotChoices || taken, title: `${x.name}\n${x.description}${x.abilities.length ? `\n${x.abilities.join("\n")}` : "\nBez zvláštních schopností."}\n${x.unique ? "Unikátní – v letce jen jednou." : "Může se v letce opakovat."}${taken ? "\nNelze: už je v jiné lodi tvé letky." : ""}`, onclick: () => ((pickerOpen = null), change({ ...loadout, pilotId: x.id })) },
        h("span", { class: "pk-pic" }, pilotPortrait(x.id, 40)),
        h("span", { class: "pk-name" }, label(x.name)),
        modInfo(x),
      );
    });
  /** Jen vybraná dlaždice; klik = okénko se všemi možnostmi (každá s vysvětlivkou). */
  const pickGroup = (kind: "hull" | "pilot", name: string, tiles: HTMLElement[]) => {
    const selTile = tiles.find((t) => t.classList.contains("on")) ?? tiles[0];
    const openable = canPick && (kind === "hull" ? !!opts.hullChoices : !!opts.pilotChoices) && tiles.length > 1;
    const shown = selTile.cloneNode(true) as HTMLElement;
    shown.classList.add("pk-current");
    shown.removeAttribute("disabled");
    shown.title = `${shown.title}${openable ? "\nKlik = vybrat jinou" : ""}`;
    shown.onclick = (ev) => {
      ev.stopPropagation();
      if (!openable) return;
      pickerOpen = pickerOpen === kind ? null : kind;
      rerender();
    };
    const pop = pickerOpen === kind ? h("div", { class: "pk-pop", onclick: (ev: Event) => ev.stopPropagation() }, h("div", { class: "pk-pop-h" }, label(kind === "hull" ? "Vyber loď" : "Vyber pilota")), h("div", { class: "pk-row" }, ...tiles)) : null;
    return h("div", { class: "pk-group" }, h("span", { class: "pk-lbl" }, label(name)), h("div", { class: "pk-holder" }, shown, pop));
  };
  const head = h("div", { class: "lo-head pick" }, pickGroup("hull", "Loď", hullTiles), pickGroup("pilot", "Pilot", pilotTiles));

  const summary = h(
    "div",
    { class: "lo-summary" },
    shop ? h("span", { title: "Tvoje kredity: rozpočet místnosti + výdělky z bitev − výbava. Co neutratíš, máš ve hře jako kredity." }, icon("credits", "#fbbf24", 10), ` ${wallet} kreditů`, h("span", { class: "muted" }, ` · výbava ${cost}`)) : h("span", { title: "Utraceno z rozpočtu; zbytek máš ve hře jako kredity" }, icon("credits", "#fbbf24", 10), ` ${cost} / ${budget}`),
    h("span", { title: `Součet váhy modulů (včetně munice). Každých ${WEIGHT.perSpeed} váhy = −1 max. rychlost` }, icon("weight", "#94a3b8", 10), ` ${weight}`),
    h("span", { title: "Maximální rychlost lodi s touto výbavou" }, icon("speed", "#94a3b8", 10), ` ${maxSpeed}`),
  );
  /* --- pruh váhy a rychlosti: dílky po 0,5, barva podle výsledné max. rychlosti, žluté značky = prahy --- */
  const weightBar = (() => {
    const per = Math.max(0.1, WEIGHT.perSpeed);
    const base = (HULLS[loadout.hullId] ?? HULLS.fighter).profile.maxSpeed + (PILOTS[loadout.pilotId]?.mods.maxSpeed ?? 0);
    const maxW = per * (base - 1) + per; // až do rychlosti 1
    const step = Math.max(0.5, Math.ceil((maxW / 24) * 2) / 2); // nejvýš ~24 dílků
    const bar = h("div", { class: "wbar" });
    for (let w = 0; w < maxW - 1e-9; w += step) {
      const sp = Math.max(1, base - Math.floor(w / per));
      const edge = w > 0 && Math.abs((w / per) % 1) < 1e-9;
      if (edge) bar.append(h("i", { class: "wedge", title: `od váhy ${w}: max. rychlost ${sp}` }));
      bar.append(h("i", { class: `wseg ${w < weight ? (sp >= base - 1 ? "g" : sp >= base - 2 ? "y" : "r") : ""}`, title: `váha ${w}–${w + step}: max. rychlost ${sp}` }));
    }
    const over = weight >= maxW ? h("span", { class: "wover" }, "+") : null;
    return h(
      "div",
      { class: "lo-wbar" },
      h("span", { class: "wlbl" }, label("Váha a rychlost")),
      h("div", { class: "wrow" }, bar, over),
      h("span", { class: "txt muted wtxt" }, `váha ${weight} → max. rychlost ${maxSpeed} · každých ${per} váhy = −1 rychlost`),
    );
  })();
  const hint = !ro && (pickSlot || pickType) ? h("div", { class: "lo-pickhint txt" }, pickSlot ? `Slot „${hull.slots.find((x) => x.id === pickSlot)?.name ?? pickSlot}“ vybraný – klikni na modul v obchodě (Esc = zrušit).` : `${MODULES[pickType!].name}: klikni na volný slot v nákresu, kam ho dát (nebo znovu na modul = zrušit).`) : null;
  // rozvržení B: vlevo loď + piloti pod sebou, uprostřed nákres s pruhem váhy, vpravo souhrn a obchod
  const mid = h("div", { class: "lo-mid-col" }, diagram, weightBar, hint);
  const right = h("div", { class: "lo-right-col" }, summary, ro ? null : shopEl);
  const root = h("div", { class: `loadout ${opts.compact ? "compact" : ""} ${opts.hideHead ? "nohead" : ""}` }, opts.hideHead ? null : head, mid, right);
  rootRef = root;
  if (err) root.append(h("div", { class: "error" }, err));
  return root;
}

/** Nákupní tlačítko ve tvaru hexagonu: ikona, název, cena, počet kusů; stejná barva kategorie jako v plástvi. */
/** Hexagon modulu (obchod, dostupné moduly): ikona, název, podtext; `dim` = zašedlý. */
export function moduleHexSvg(t: ModuleType, sub: string, dim: boolean, weight?: number): SVGSVGElement {
  const def = MODULES[t];
  const col = moduleColor(t);
  const W = 112;
  const Hh = 98;
  const R = 54;
  const cx = W / 2;
  const cy = Hh / 2;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, class: "lo-hexbuy-svg" });
  const pts = [0, 60, 120, 180, 240, 300].map((a) => `${(cx + R * Math.cos((a * Math.PI) / 180)).toFixed(1)},${(cy + (R * Math.sqrt(3)) / 2 / (Math.sqrt(3) / 2) * Math.sin((a * Math.PI) / 180) * 0.86).toFixed(1)}`).join(" ");
  svg.append(svgEl("polygon", { points: pts, fill: "#0f172a", stroke: dim ? "#334155" : col, "stroke-width": 3, "stroke-linejoin": "miter", class: "hexbg" }));
  svg.append(svgEl("polygon", { points: pts, fill: dim ? "#334155" : col, opacity: 0.16 }));
  const ic = icon(def.icon, dim ? "#64748b" : col, 16);
  ic.setAttribute("x", String(cx - 8));
  ic.setAttribute("y", "14");
  svg.append(ic);
  const words = def.name.toUpperCase().split(" ");
  const fs = Math.max(...words.map((w) => w.length)) > 8 ? 13 : 15;
  words.forEach((w, i) => svg.append(svgEl("text", { x: cx, y: 46 + i * 11, "font-family": "Jersey, ui-monospace, monospace", "font-size": fs, fill: dim ? "#64748b" : "#f8fafc", "text-anchor": "middle" }, w)));
  if (sub) svg.append(svgEl("text", { x: cx, y: 46 + words.length * 11 + 4, "font-family": "Jersey", "font-size": 12, fill: dim ? "#64748b" : "#fbbf24", "text-anchor": "middle" }, sub));
  if (weight !== undefined && weight > 0) {
    // váha jako počet závaží (půlka = oříznutá ikona)
    const n = Math.floor(weight);
    const half = weight % 1 > 0;
    const total = n + (half ? 0.5 : 0);
    const iw = 9;
    const x0 = cx - (total * (iw + 1)) / 2;
    const yy = 46 + words.length * 11 + 8;
    for (let i = 0; i < n; i++) {
      const w = icon("weight", dim ? "#64748b" : "#94a3b8", iw);
      w.setAttribute("x", String(x0 + i * (iw + 1)));
      w.setAttribute("y", String(yy));
      svg.append(w);
    }
    if (half) {
      const w = icon("weight", dim ? "#64748b" : "#94a3b8", iw);
      w.setAttribute("x", String(x0 + n * (iw + 1)));
      w.setAttribute("y", String(yy));
      w.setAttribute("viewBox", "0 0 4 8");
      w.setAttribute("width", String(iw / 2));
      svg.append(w);
    }
  }
  return svg;
}

function hexBuyButton(t: ModuleType, have: number, why: string | null, onClick: () => void): HTMLElement {
  const def = MODULES[t];
  const svg = moduleHexSvg(t, `${def.price}${have ? ` ×${have}` : ""}`, !!why, def.weight);
  const btn = h("button", { class: `lo-hexbuy ${why ? "dis" : ""}`, disabled: !!why, title: `${def.name}\n${def.description}\nCena ${def.price} · váha ${def.weight}${def.ammo ? ` + ${def.ammoWeight} × ${def.ammo} munice` : ""}${why ? `\nNelze: ${why}` : ""}`, onclick: onClick }, svg);
  return btn;
}

/** Krátký štítek sestavy (pro ostatní hráče). */
export function loadoutTag(loadout: ShipLoadout): HTMLElement {
  const el = h("span", { class: "lo-tag", title: loadout.modules.map((m) => MODULES[m.type].name).join(", ") || "bez modulů" });
  if (!loadout.modules.length) el.append(h("span", { class: "muted" }, label("bez modulů")));
  for (const m of loadout.modules) el.append(icon(MODULES[m.type].icon, "#60a5fa", 10));
  el.append(h("span", { class: "muted" }, ` ${label(PILOTS[loadout.pilotId]?.name ?? "")} · `), icon("speed", "#94a3b8", 10), ` ${maxSpeedFor(loadout)}`);
  return el;
}
