import { type ModuleDef } from "@wingfighter/shared";
import {
  moduleBroken,
  TEAM_COLORS,
  moduleHp,
  type PilotDef,
  type PilotMods,
  moduleSellPrice,
  ammoRefillCost,
  moduleRepairCost,
  RULES,
  type ModuleInstance,
  cargoCapacity,
  moduleWeight,
  allowedFacings,
  defaultFacing,
  FACING_NAMES,
  freeSlots,
  hasFacing,
  HULLS,
  hullLargePairs,
  hullOf,
  largePair,
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
  MODULE_CATEGORIES,
  MODULE_CATEGORY,
  CATEGORY_LABEL,
  WEAPON_KIND_LABEL,
  weaponKind,
  type ModuleCategory,
  type WeaponKind,
} from "@wingfighter/shared";
import { h } from "./dom.ts";
import { tipAttr } from "./tooltip.ts";
import { BATTLESHIP_TEMPLATE, fighterTemplate, shade } from "./game/sprites.ts";
/** Dávka kulometu (nábojů na jeden výstřel) – dílek munice v dlaždici. */
const MG_BURST = 10;
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
  /** Tým hráče (barva a varianta spritu v nákresu). */
  team?: number;
  /** Přetažení modulu na záložku jiné lodi letky (prvek s data-fleet-index): přesun bez prodeje. */
  onMoveToShip?: (moduleId: string, toIndex: number) => void;
}

const NS = "http://www.w3.org/2000/svg";
/** Nákres lodi: 24 px na pixel šablony, čtyři hexagonové sloty v plástvi (příď nad zádí, boky na šikmých stěnách zádi). */
const DIAG = { w: 480, h: 412, s: 24, x0: 72, y0: 14 };
const HEX_R = 50;
const HW = 2 * HEX_R;
const HH = Math.sqrt(3) * HEX_R;
const FY = 112;
type Box = { x: number; y: number; w: number; h: number };
const SLOT_BOX: Record<SlotId, Box> = {
  front: { x: 190, y: FY, w: HW, h: HH },
  back: { x: 190, y: FY + HH, w: HW, h: HH },
  left: { x: 190 - HW * 0.75, y: FY + HH + HH / 2, w: HW, h: HH },
  right: { x: 190 + HW * 0.75, y: FY + HH + HH / 2, w: HW, h: HH },
  // bitevník: přední levobok / pravobok – v plástvi přímo nad zadním levobokem / pravobokem
  podLeft: { x: 190 - HW * 0.75, y: FY + HH / 2, w: HW, h: HH },
  podRight: { x: 190 + HW * 0.75, y: FY + HH / 2, w: HW, h: HH },
};
/** Nákres trupu pod pláství: šablona, měřítko a umístění (stíhač 16×14 po 24 px, bitevník 50×40 po 7 px). */
function hullDiagram(hullId: string, team = 0): { template: string[]; s: number; x0: number; y0: number } {
  if (hullId === "battleship") return { template: BATTLESHIP_TEMPLATE, s: 7, x0: 100, y0: 30 };
  const { template, scale } = fighterTemplate(team);
  const s = scale === 2 ? 16 : 24; // nové šablony 24×20 po 16 px = stejná velikost jako původní 16×14 po 24 px
  return { template, s, x0: scale === 2 ? 80 : 72, y0: scale === 2 ? 14 : 14 };
}
function hexPoints(b: { x: number; y: number; w: number; h: number }): string {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return [0, 60, 120, 180, 240, 300].map((a) => `${(cx + HEX_R * Math.cos((a * Math.PI) / 180)).toFixed(1)},${(cy + HEX_R * Math.sin((a * Math.PI) / 180)).toFixed(1)}`).join(" ");
}

/**
 * Stav munice v hexu modulu: nabité kusy = ikonka typu munice žlutě, chybějící = tmavý obrys.
 * Kulomet (100 nábojů) se zobrazuje po dávkách (10 nábojů = 1 dílek).
 */
function ammoSlots(def: ModuleDef, ammo: number): { slots: number; loaded: number; unit: number } {
  const max = def.ammo ?? 0;
  const unit = max > 10 ? max / 10 : 1;
  const slots = Math.round(max / unit);
  return { slots, loaded: Math.min(slots, Math.ceil(ammo / unit)), unit };
}
function drawAmmo(grp: SVGElement, box: { x: number; y: number; w: number; h: number }, def: ModuleDef, ammo: number, nameLines: number): void {
  const max = def.ammo ?? 0;
  const { slots, loaded, unit } = ammoSlots(def, ammo);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const g = svgEl("g", { class: "lo-ammo" });
  g.append(svgEl("title", {}, `Munice ${ammo} / ${max}${unit > 1 ? ` (dílek = ${unit} nábojů)` : ""}`));
  const size = max > 10 ? 6 : 10;
  const gap = max > 10 ? 2 : 3;
  const total = slots * size + (slots - 1) * gap;
  const x0 = cx - total / 2;
  const y = cy + 4 + (nameLines - 1) * 6 + 6;
  for (let i = 0; i < slots; i++) {
    const on = i < loaded;
    const x = x0 + i * (size + gap);
    if (max > 10) g.append(svgEl("rect", { x, y, width: size, height: size * 0.6, fill: on ? "#fbbf24" : "none", stroke: on ? "#fbbf24" : "#64748b", "stroke-width": 1 }));
    else {
      const ic = icon(def.icon, on ? "#fbbf24" : "#475569", size);
      ic.setAttribute("x", String(x));
      ic.setAttribute("y", String(y));
      g.append(ic);
    }
  }
  grp.append(g);
}
/** Barva životů modulu: zelená (plné) → žlutá → červená (skoro zničený). */
function hpColor(frac: number): string {
  if (frac >= 0.999) return "#22c55e";
  if (frac > 0.5) return "#eab308";
  if (frac > 0.25) return "#f97316";
  return "#ef4444";
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

/** Barvy kategorií: zbraně červeně (energetické oranžověji), štíty modře, droidi fialově, technologie tyrkysově. */
export const CATEGORY_COLOR: Record<ModuleCategory, string> = { weapon: "#ef4444", shield: "#3b82f6", droid: "#c084fc", tech: "#2dd4bf" };
export function moduleColor(type: ModuleType): string {
  if (weaponKind(type) === "energy") return "#fb923c";
  return CATEGORY_COLOR[MODULE_CATEGORY[type]];
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Miniatura trupu (pixelový sprite otočený přídí nahoru) do dlaždic výběru lodi. */
export function hullThumb(hullId: string, color: string, size = 36, team = 1): SVGSVGElement {
  const tpl = hullId === "battleship" ? BATTLESHIP_TEMPLATE : fighterTemplate(team).template;
  const w = tpl[0].length;
  const hgt = tpl.length;
  const svg = svgEl("svg", { viewBox: `0 0 ${hgt} ${w}`, width: size, height: size, class: "hull-thumb", "shape-rendering": "crispEdges" });
  const pal: Record<string, string> = { P: color, S: shade(color, 0.72), L: shade(color, 1.35), G: "#9aa3ad", D: "#4b5563", K: "#1f2937", W: "#dbeafe", E: "#fb923c", Y: "#fde68a" };
  const g = svgEl("g", { transform: `translate(0, ${w}) rotate(-90)` });
  tpl.forEach((row, y) => [...row].forEach((c, x) => pal[c] && g.append(svgEl("rect", { x, y, width: 1, height: 1, fill: pal[c] }))));
  svg.append(g);
  return svg;
}

/** Změna trupu: moduly ve slotech, které nový trup nemá, se přesunou do volných slotů; co se nevejde, se prodá (odebere). */
function switchHull(loadout: ShipLoadout, hullId: string): ShipLoadout {
  const hull = HULLS[hullId];
  if (!hull) return loadout;
  const ids = new Set(hull.slots.map((s) => s.id));
  const kept: ModuleInstance[] = [];
  const homeless: ModuleInstance[] = [];
  for (const m of loadout.modules) (ids.has(m.slot) ? kept : homeless).push(m);
  const out: ShipLoadout = { ...loadout, hullId, modules: kept };
  for (const m of homeless) {
    const free = freeSlots(out)[0];
    if (!free) break;
    const slot = free;
    out.modules = [...out.modules, { ...m, slot, facing: hasFacing(m.type) ? (allowedFacings(m.type, slot).includes(m.facing ?? "front") ? m.facing : defaultFacing(m.type, slot)) : undefined }];
  }
  return out;
}

/** Právě proběhlo tažení modulu – následný klik se ignoruje. */
let dragMoved = false;
/** Krátká zpráva pod kurzorem (důvod, proč přesun nejde). */
function showTip(text: string): void {
  document.querySelector(".lo-dragtip")?.remove();
  const el = h("div", { class: "lo-dragtip" }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1800);
}

/** Výběr slotu / modulu v editoru: nejdřív slot a pak modul z obchodu, nebo naopak. Esc / klik vedle = zrušit. */
let pickSlot: SlotId | null = null;
let pickType: ModuleType | null = null;
/** Otevřené okénko výběru lodi / pilota. */
let pickerOpen: "hull" | "pilot" | null = null;
/** Otevřené okénko modulu v nákresu (id modulu). */
let modPop: string | null = null;
/** Zruší rozpracovaný výběr (volá se po umístění, při Esc a při kliku mimo editor). */
export function clearLoadoutPick(): boolean {
  const had = !!(pickSlot || pickType || pickerOpen || modPop);
  pickSlot = null;
  pickType = null;
  pickerOpen = null;
  modPop = null;
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
    const freeNow = freeSlots(loadout);
    const pairs = hullLargePairs(hullOf(loadout)).filter((p) => p.every((sl) => freeNow.includes(sl)));
    const slot = def.size === "large" ? ((want && pairs.find((p) => p.includes(want))) ?? pairs[0])?.[0] ?? null : want && freeNow.includes(want) ? want : firstFreeSlot();
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
  const hd = hullDiagram(loadout.hullId, opts.team ?? 0);
  const g = svgEl("g", { transform: `translate(${hd.x0}, ${hd.y0 + hd.template[0].length * hd.s}) rotate(-90) scale(${hd.s})`, "shape-rendering": "crispEdges" });
  const teamCol = TEAM_COLORS[opts.team ?? 0] ?? "#3b82f6";
  const pal: Record<string, string> = { P: teamCol, S: shade(teamCol, 0.72), L: shade(teamCol, 1.35), G: "#9aa3ad", D: "#4b5563", K: "#1f2937", W: "#dbeafe", E: "#fb923c", Y: "#fde68a" };
  hd.template.forEach((row, y) => [...row].forEach((c, x) => pal[c] && g.append(svgEl("rect", { x, y, width: 1, height: 1, fill: pal[c] }))));
  svg.append(g);
  const free = freeSlots(loadout);
  const drawn = new Set<string>();
  const arrowAt = (box: { x: number; y: number; w: number; h: number }, f: Facing) => ({
    x: f === "left" ? box.x + 10 : f === "right" ? box.x + box.w - 10 : box.x + box.w / 2,
    y: f === "front" ? box.y + 8 : f === "back" ? box.y + box.h - 8 : box.y + box.h / 2,
    rot: f === "right" ? 90 : f === "back" ? 180 : f === "left" ? 270 : 0,
  });
  /** Přesun modulu do slotu (volný = přesun, obsazený = prohození); vrací novou sestavu nebo text chyby. */
  const moveModule = (m: ModuleInstance, target: SlotId): ShipLoadout | string => {
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
        blockers.forEach((b, i) => { const k = out.findIndex((x) => x.id === b.id); out[k] = refacing(out[k], myPair[i]); });
        return { ...loadout, modules: out };
      }
      return "cílová dvojice slotů je obsazená";
    }
    if (!other) return { ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? refacing(x, target) : x)) };
    if (MODULES[other.type].size === "large") return "velký modul nejde prohodit s malým";
    return { ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? refacing(x, other.slot) : x.id === other.id ? refacing(x, m.slot) : x)) };
  };
  /** Přetažení modulu z obchodu do volného slotu = koupit rovnou tam. */
  const startShopDrag = (ev: PointerEvent, t: ModuleType, btn: HTMLElement) => {
    if (ev.button !== 0) return;
    const def = MODULES[t];
    const start = { x: ev.clientX, y: ev.clientY };
    let ghost: HTMLElement | null = null;
    const svgRoot = svg;
    const targets = () => {
      const freeNow = freeSlots(loadout);
      if (def.size !== "large") return freeNow;
      return hullLargePairs(hull).filter((p) => p.every((s) => freeNow.includes(s))).flat();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragMoved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      if (!dragMoved) {
        dragMoved = true;
        ghost = btn.cloneNode(true) as HTMLElement;
        ghost.classList.add("shop-ghost");
        document.body.append(ghost);
        document.body.classList.add("drag-on");
        (document.querySelector(".ptip") as HTMLElement | null)?.style.setProperty("display", "none");
        svgRoot?.classList.add("drag-on");
        // volné sloty se nabídnou; nákres lodi zezelená a nabídne nákup
        for (const s of targets()) svgRoot?.querySelector(`[data-slot="${s}"]`)?.classList.add("drop-free");
        const diag = svgRoot?.closest(".lo-diagram") as HTMLElement | null;
        if (diag) {
          diag.classList.add("drop-buy");
          diag.append(h("div", { class: "drop-banner buy" }, icon("credits", "#bbf7d0", 14), " ", label(targets().length ? `koupit · −${def.price} · pusť na volný slot` : "koupit – žádný volný slot")));
        }
      }
      ghost!.style.left = `${e.clientX - 56}px`;
      ghost!.style.top = `${e.clientY - 49}px`;
      ghost!.style.display = "none";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      ghost!.style.display = "";
      svgRoot?.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
      const slotEl = el?.closest?.("[data-slot]") as SVGGElement | null;
      if (slotEl && targets().includes(slotEl.getAttribute("data-slot") as SlotId)) slotEl.classList.add("drop-target");
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!dragMoved) return;
      ghost?.remove();
      document.body.classList.remove("drag-on");
      svgRoot?.classList.remove("drag-on");
      svgRoot?.querySelectorAll(".drop-target, .drop-free").forEach((x) => x.classList.remove("drop-target", "drop-free"));
      document.querySelectorAll(".lo-diagram.drop-buy").forEach((x) => x.classList.remove("drop-buy"));
      document.querySelectorAll(".drop-banner").forEach((x) => x.remove());
      setTimeout(() => (dragMoved = false), 0);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slotEl = el?.closest?.("[data-slot]") as SVGGElement | null;
      if (!slotEl) return;
      const slot = slotEl.getAttribute("data-slot") as SlotId;
      if (!targets().includes(slot)) {
        showTip("slot je obsazený – pusť modul na volný slot");
        return;
      }
      const why = buyWhy(t);
      if (why) {
        showTip(`Nelze koupit: ${why}`);
        return;
      }
      add(t, slot);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const startDrag = (ev: PointerEvent, m: ModuleInstance, grp: SVGGElement, box: Box) => {
    const svgRoot = grp.ownerSVGElement!;
    const start = { x: ev.clientX, y: ev.clientY };
    let ghost: SVGGElement | null = null;
    dragMoved = false;
    const toSvg = (cx: number, cy: number) => {
      const r = svgRoot.getBoundingClientRect();
      const vb = svgRoot.viewBox.baseVal;
      return { x: ((cx - r.left) / r.width) * vb.width, y: ((cy - r.top) / r.height) * vb.height };
    };
    const onMove = (e: PointerEvent) => {
      if (!dragMoved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      if (!dragMoved) {
        dragMoved = true;
        ghost = grp.cloneNode(true) as SVGGElement;
        ghost.classList.add("drag-ghost");
        ghost.style.pointerEvents = "none";
        svgRoot.append(ghost);
        grp.classList.add("dragging");
        svgRoot.classList.add("drag-on");
        document.body.classList.add("drag-on");
        // obchod se zbarví červeně a nabídne prodej
        const shopEl = svgRoot.closest(".loadout")?.querySelector(".lo-shop") as HTMLElement | null;
        if (shopEl && !ro) {
          shopEl.classList.add("drop-sell");
          shopEl.append(h("div", { class: "drop-banner sell" }, icon("credits", "#fecaca", 14), " ", label(shop ? `prodat modul · +${moduleSellPrice(m)}` : "odebrat modul")));
        }
        (document.querySelector(".ptip") as HTMLElement | null)?.style.setProperty("display", "none");
      }
      const p = toSvg(e.clientX, e.clientY);
      ghost!.setAttribute("transform", `translate(${p.x - (box.x + box.w / 2)}, ${p.y - (box.y + box.h / 2)})`);
      // zvýraznit cíl pod kurzorem
      ghost!.style.display = "none";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      ghost!.style.display = "";
      svgRoot.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
      document.querySelectorAll(".fleet-tab.drop-target").forEach((x) => x.classList.remove("drop-target"));
      const slotEl = el?.closest?.("[data-slot]") as SVGGElement | null;
      const tabEl = el?.closest?.("[data-fleet-index]") as HTMLElement | null;
      const shopHit = el?.closest?.(".lo-shop") as HTMLElement | null;
      document.querySelectorAll(".lo-shop.drop-target").forEach((x) => x.classList.remove("drop-target"));
      if (slotEl && slotEl !== grp && slotEl.ownerSVGElement === svgRoot) slotEl.classList.add("drop-target");
      else if (tabEl && !tabEl.classList.contains("on") && opts.onMoveToShip) tabEl.classList.add("drop-target");
      else if (shopHit && !ro) shopHit.classList.add("drop-target");
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!dragMoved) return;
      ghost?.remove();
      grp.classList.remove("dragging");
      svgRoot.classList.remove("drag-on");
      document.body.classList.remove("drag-on");
      svgRoot.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
      document.querySelectorAll(".fleet-tab.drop-target, .lo-shop.drop-target").forEach((x) => x.classList.remove("drop-target"));
      document.querySelectorAll(".lo-shop.drop-sell").forEach((x) => x.classList.remove("drop-sell"));
      document.querySelectorAll(".drop-banner").forEach((x) => x.remove());
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slotEl = el?.closest?.("[data-slot]") as SVGGElement | null;
      const tabEl = el?.closest?.("[data-fleet-index]") as HTMLElement | null;
      const shopHit = el?.closest?.(".lo-shop") as HTMLElement | null;
      setTimeout(() => (dragMoved = false), 0);
      if (shopHit && !ro) {
        // přetažení do obchodu = prodat / odebrat
        modPop = null;
        remove(m.id);
        return;
      }
      if (slotEl && slotEl !== grp && slotEl.ownerSVGElement === svgRoot) {
        const target = slotEl.getAttribute("data-slot") as SlotId;
        if (occupiedSlots(m).includes(target)) return;
        const res = moveModule(m, target);
        if (typeof res === "string") showTip(res);
        else {
          modPop = null;
          change(res);
        }
      } else if (tabEl && opts.onMoveToShip) {
        const idx = Number(tabEl.getAttribute("data-fleet-index"));
        if (!tabEl.classList.contains("on") && Number.isFinite(idx)) {
          modPop = null;
          opts.onMoveToShip(m.id, idx);
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const slotBox = (slot: SlotId, box: { x: number; y: number; w: number; h: number }, m?: (typeof loadout.modules)[number]) => {
    const def = m ? MODULES[m.type] : undefined;
    const selectable = !!m && !!opts.onSelect;
    const selected = !!m && opts.selectedId === m.id;
    const grp = svgEl("g", { class: `lo-g ${m ? "mod" : "empty"} ${ro && !selectable ? "ro" : ""} ${selected ? "sel" : ""} ${selectable ? "selectable" : ""}`, "data-slot": slot });
    const pts = hexPoints(box);
    if (m && def) {
      const broken = moduleBroken(m);
      const shieldOff = isShield(m) && !broken && !!m.off;
      const col = selected ? "#fb923c" : broken ? "#ef4444" : shieldOff ? "#475569" : moduleColor(m.type);
      const frac = hpFrac(m);
      const open = modPop === m.id;
      grp.append(svgEl("polygon", { points: pts, fill: broken ? "#3b0a0a" : "#0f172a", stroke: open ? "#fbbf24" : col, "stroke-width": open ? 4 : 3, "stroke-linejoin": "miter", ...(shieldOff ? { "stroke-dasharray": "6 4" } : {}) }));
      // výplň = životy: barva podle zbývajících životů (zelená → žlutá → červená), hladina klesá odshora
      grp.append(...hpFill(pts, box, broken ? "#ef4444" : hpColor(frac), selected ? 0.3 : broken ? 0.35 : shieldOff ? 0.08 : 0.22, broken ? 1 : frac));
      if (broken) grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h - 6, "font-family": "Jersey", "font-size": 10, fill: "#fca5a5", "text-anchor": "middle" }, "ZNIČEN"));
      const multiShield = isShield(m) && !broken && loadout.modules.filter((x) => isShield(x)).length > 1;
      if (multiShield) {
        // vypínač štítu (pixel art, uprostřed horní části hexu): funguje vždy jen jeden; vypnout jde jen s jiným funkčním štítem
        const others = loadout.modules.filter((x) => x.id !== m.id && isShield(x) && moduleWorking(x));
        const canOff = others.length > 0;
        const on = !m.off;
        const sw = svgEl("g", { class: `lo-switch ${on ? "on" : "off"} ${!ro && (!on || canOff) ? "" : "fixed"}`, transform: `translate(${box.x + box.w / 2}, ${box.y + box.h / 2 - 28})`, "shape-rendering": "crispEdges" });
        // dráha 24×10 s pixelovým rámečkem, knoflík 8×8 vlevo (VYP) / vpravo (ZAP)
        sw.append(svgEl("rect", { x: -12, y: -5, width: 24, height: 10, fill: on ? "#166534" : "#1e293b", stroke: on ? "#4ade80" : "#64748b", "stroke-width": 1 }));
        sw.append(svgEl("rect", { x: on ? 2 : -10, y: -3, width: 8, height: 6, fill: on ? "#bbf7d0" : "#64748b" }));
        if (on) sw.append(svgEl("rect", { x: -8, y: -1, width: 4, height: 2, fill: "#4ade80" }));
        sw.append(svgEl("rect", { x: -13, y: -6, width: 26, height: 12, fill: "transparent" }));
        sw.append(svgEl("title", {}, on ? (canOff ? "Štít zapnutý. Klik = vypnout – zapne se druhý nainstalovaný štít." : "Štít zapnutý. Jediný funkční štít nejde vypnout.") : "Štít vypnutý (záloha). Klik = zapnout (druhý štít se vypne)."));
        if (!ro && (!on || canOff))
          sw.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const target = !on ? m.id : others[0].id;
            change(normalizeShields({ ...loadout, modules: loadout.modules.map((x) => (isShield(x) ? { ...x, off: x.id === target ? undefined : true } : x)) }));
          });
        grp.append(sw);
        if (shieldOff) grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h - 6, "font-family": "Jersey", "font-size": 10, fill: "#94a3b8", "text-anchor": "middle" }, "ZÁLOHA"));
      } else {
        // ikona modulu nad názvem
        const ic = icon(def.icon, broken ? "#fca5a5" : col, 14);
        ic.setAttribute("x", String(box.x + box.w / 2 - 7));
        ic.setAttribute("y", String(box.y + box.h / 2 - 34));
        grp.append(ic);
      }
      const ammo = opts.ammoOf?.(m.id) ?? m.ammo;
      const words = def.name.toUpperCase().split(" ");
      const long = Math.max(...words.map((w) => w.length)) > 8;
      const fs = long ? 13 : 16;
      const base = box.y + box.h / 2 + 4 - (words.length - 1) * 6;
      words.forEach((w, i) => grp.append(svgEl("text", { x: box.x + box.w / 2, y: base + i * 12, "font-family": "Jersey, ui-monospace, monospace", "font-size": fs, fill: "#f8fafc", "text-anchor": "middle" }, w)));
      if (ammo !== undefined && def.ammo) drawAmmo(grp, box, def, ammo, words.length);
      if (hasFacing(m.type)) {
        // jen zvolené natočení (žlutá šipka na hraně hexu); změna se dělá v okénku modulu
        const f = m.facing ?? "front";
        const a = arrowAt(box, f);
        const arrow = svgEl("g", { class: "lo-arrow sel", transform: `translate(${a.x}, ${a.y}) rotate(${a.rot})` });
        arrow.append(svgEl("rect", { x: -7, y: -7, width: 14, height: 14, fill: "#0b1020", stroke: "#fbbf24", "stroke-width": 1 }));
        arrow.append(svgEl("path", { d: "M0,-5 L5,2 L1.5,2 L1.5,5 L-1.5,5 L-1.5,2 L-5,2 Z", fill: "#fbbf24" }));
        arrow.append(svgEl("title", {}, `Natočení: ${FACING_NAMES[f]}`));
        grp.append(arrow);
      }
      if (!ro && !selectable) {
        grp.classList.add("mod-click");
        grp.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (dragMoved) return; // konec tažení není klik
          modPop = open ? null : m.id;
          pickSlot = null;
          pickType = null;
          pickerOpen = null;
          rerender();
        });
        // přetažení modulu do jiného slotu (prohodí se) nebo na záložku jiné lodi letky
        grp.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          ev.preventDefault(); // bez označování textu při tažení
          startDrag(ev, m, grp, box);
        });
      }
      grp.append(svgEl("title", {}, `${def.name}${ammo !== undefined ? ` · munice ${ammo}/${def.ammo}` : ""} · životy ${moduleHp(m)}/${def.hp} · váha ${def.weight + (def.ammoWeight ?? 0) * (ammo ?? 0)}${selectable ? "\nKlik = vybrat k vyhození" : ro ? "" : "\nKlik = oprava, munice, natočení, prodej"}`));
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
        grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 22, "font-family": "Jersey, ui-monospace, monospace", "font-size": name.length > 9 ? 9 : 11, fill: "#7dd3fc", "text-anchor": "middle" }, name.toUpperCase()));
        grp.append(svgEl("title", {}, `${name}: sem umístit ${MODULES[pickType!].name}`));
      } else {
        grp.append(svgEl("polygon", { points: pts, fill: "rgba(5,7,15,0.55)", stroke: ro ? "#7dd3fc" : "#7dd3fc", "stroke-width": 3, "stroke-dasharray": "6 4" }));
        const nw = name.toUpperCase().split(" ");
        nw.forEach((w, i) => grp.append(svgEl("text", { x: box.x + box.w / 2, y: box.y + box.h / 2 + 4 + (i - (nw.length - 1) / 2) * 15, "font-family": "Jersey, ui-monospace, monospace", "font-size": 15, fill: "#7dd3fc", "text-anchor": "middle" }, w)));
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
  /** Okénko modulu: životy + oprava, munice + dokoupení, natočení, prodej / odebrání. */
  const modulePopup = (m: ModuleInstance): HTMLElement => {
    const def = MODULES[m.type];
    const box = SLOT_BOX[m.slot];
    const broken = moduleBroken(m);
    const col = moduleColor(m.type);
    const hp = moduleHp(m);
    const frac = hpFrac(m);
    const rows: (HTMLElement | null)[] = [];
    const costTag = (n: number, ok: boolean) => h("span", { class: `mp-cost ${ok ? "" : "no"}` }, icon("credits", ok ? "#fbbf24" : "#64748b", 10), ` ${n}`);
    const pay = (n: number) => !shop || n <= wallet;
    // životy
    const repairCost = moduleRepairCost(m);
    rows.push(
      h(
        "div",
        { class: "mp-row" },
        h("span", { class: "mp-k" }, label("Životy")),
        h("span", { class: "mp-bar", title: `${hp} / ${def.hp}` }, h("i", { style: `width:${Math.round(frac * 100)}%;background:${broken ? "#ef4444" : hpColor(frac)}` })),
        h("span", { class: `mp-v ${broken ? "bad" : ""}` }, broken ? "ZNIČEN" : `${hp}/${def.hp}`),
        broken && shop
          ? h("button", { class: `px tiny ${pay(repairCost) ? "on" : ""}`, disabled: !pay(repairCost), title: `Opravit zničený modul za ${repairCost} kreditů (${RULES.repairPct} % ceny)${pay(repairCost) ? "" : " – nedostatek kreditů"}`, onclick: () => {
              modPop = null;
              change({ ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? { ...x, repair: true } : x)) });
            } }, label("Opravit"), " ", costTag(repairCost, pay(repairCost)))
          : null,
      ),
    );
    // munice
    if (def.ammo) {
      const ammo = m.ammo ?? 0;
      const { slots, loaded, unit } = ammoSlots(def, ammo);
      const refillCost = ammoRefillCost(m);
      const full = ammo >= def.ammo;
      const pips = h("span", { class: "mp-ammo", title: `Munice ${ammo} / ${def.ammo}${unit > 1 ? ` (dílek = ${unit} nábojů)` : ""}` });
      for (let i = 0; i < slots; i++) pips.append(def.ammo > 10 ? h("i", { class: i < loaded ? "on" : "" }) : icon(def.icon, i < loaded ? "#fbbf24" : "#475569", 11));
      rows.push(
        h(
          "div",
          { class: "mp-row" },
          h("span", { class: "mp-k" }, label("Munice")),
          pips,
          h("span", { class: "mp-v" }, `${ammo}/${def.ammo}`),
          !full && !broken && shop
            ? h("button", { class: `px tiny ${pay(refillCost) ? "on" : ""}`, disabled: !pay(refillCost), title: `Doplnit ${def.ammo - ammo} ks munice za ${refillCost} kreditů${pay(refillCost) ? "" : " – nedostatek kreditů"}`, onclick: () => {
                modPop = null;
                refill(m.id);
              } }, label("Doplnit"), " ", costTag(refillCost, pay(refillCost)))
            : full
              ? h("span", { class: "muted txt mp-note" }, "plná")
              : broken
                ? h("span", { class: "muted txt mp-note" }, "nejdřív opravit")
                : null,
        ),
      );
    }
    // natočení
    if (hasFacing(m.type)) {
      const cur = m.facing ?? "front";
      const btns = h("span", { class: "mp-facing" });
      for (const f of allowedFacings(m.type, m.slot)) {
        const sel = f === cur;
        const rot = f === "right" ? 90 : f === "back" ? 180 : f === "left" ? 270 : 0;
        const b = h("button", { class: `px tiny mp-dir ${sel ? "on" : ""}`, title: `${FACING_NAMES[f]}${sel ? " (zvoleno)" : ""}`, onclick: () => {
            if (sel) return;
            change({ ...loadout, modules: loadout.modules.map((x) => (x.id === m.id ? { ...x, facing: f } : x)) });
          } });
        const sv = svgEl("svg", { viewBox: "-7 -7 14 14", width: 14, height: 14 });
        sv.append(svgEl("path", { d: "M0,-5 L5,2 L1.5,2 L1.5,5 L-1.5,5 L-1.5,2 L-5,2 Z", fill: sel ? "#fbbf24" : "#94a3b8", transform: `rotate(${rot})` }));
        b.append(sv);
        btns.append(b);
      }
      rows.push(h("div", { class: "mp-row" }, h("span", { class: "mp-k" }, label("Natočení")), btns, h("span", { class: "mp-v" }, FACING_NAMES[cur])));
    }
    // prodej / odebrání
    const sell = shop ? moduleSellPrice(m) : def.price;
    const sellTitle = shop ? m.gift ? "Záchranná výbava – nejde prodat (odebrání = zahození)" : `Prodat za ${sell} kreditů${broken ? " (zničený)" : m.used ? " (použitý)" : " (nový – plná cena)"}` : `Odebrat (vrátí ${def.price} kreditů)`;
    rows.push(
      h(
        "div",
        { class: "mp-row mp-foot" },
        h("span", { class: "muted txt", title: "Váha modulu včetně munice" }, icon("weight", "#94a3b8", 10), ` ${moduleWeight(m)}`),
        h("span", { class: "spacer" }),
        h("button", { class: "px tiny danger", title: sellTitle, onclick: () => {
            modPop = null;
            remove(m.id);
          } }, "✕ ", label(shop ? (m.gift ? "Zahodit" : "Prodat") : "Odebrat"), shop && !m.gift ? h("span", { class: "mp-cost" }, " ", icon("credits", "#fbbf24", 10), ` ${sell}`) : null),
      ),
    );
    const onRight = m.slot === "right";
    const px = Math.round((onRight ? box.x - 8 : box.x + box.w + 8) * scale);
    const py = Math.round(box.y * scale);
    const pop = h(
      "div",
      { class: "mod-pop", style: `top:${py}px;${onRight ? `right:calc(100% - ${px}px)` : `left:${px}px`}` },
      h("div", { class: "mp-head", style: `border-color:${col}` }, icon(def.icon, col, 14), h("span", { class: "mp-name" }, label(def.name)), h("span", { class: "spacer" }), h("button", { class: "px tiny", title: "Zavřít", onclick: () => ((modPop = null), rerender()) }, "✕")),
      ...rows,
    );
    pop.addEventListener("click", (ev) => ev.stopPropagation());
    return pop;
  };
  // volné dvojice pro velký modul: žlutý rámeček kolem obou hexů
  for (const pair of hullLargePairs(hull)) {
    if (!pair.every((sl) => free.includes(sl))) continue;
    const f = SLOT_BOX[pair[0]];
    const b = SLOT_BOX[pair[1]];
    svg.append(svgEl("rect", { x: f.x - 8, y: f.y - 8, width: f.w + 16, height: b.y + b.h - f.y + 16, fill: "none", stroke: "#fbbf24", "stroke-width": 2, "stroke-dasharray": "3 5" }));
    if (pair[0] === "front") svg.append(svgEl("text", { x: f.x + f.w / 2, y: f.y - 14, "font-family": "Jersey", "font-size": 12, fill: "#fbbf24", "text-anchor": "middle" }, "1 VELKY"));
  }
  for (const m of loadout.modules) {
    const occ = occupiedSlots(m);
    if (MODULES[m.type].size === "large") for (const sl of occ) slotBox(sl, SLOT_BOX[sl], m);
    else slotBox(m.slot, SLOT_BOX[m.slot], m);
    occ.forEach((sl) => drawn.add(sl));
  }
  for (const sl of hull.slots) if (!drawn.has(sl.id)) slotBox(sl.id, SLOT_BOX[sl.id]);
  // klik do nákresu mimo modul zavře okénko modulu
  svg.addEventListener("click", () => {
    if (modPop) {
      modPop = null;
      rerender();
    }
  });
  const diagram = h("div", { class: "lo-diagram" }, svg);
  const popMod = modPop ? loadout.modules.find((x) => x.id === modPop) : undefined;
  if (popMod && !ro && !opts.onSelect) diagram.append(modulePopup(popMod));
  else modPop = null;


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
    // obchod po kategoriích: řádek s barevným nadpisem pro zbraně, štíty, droidy a technologie
    const rows = new Map<ModuleCategory, HTMLElement>();
    for (const cat of MODULE_CATEGORIES) {
      const row = h("div", { class: "lo-shop-row" });
      rows.set(cat, row);
      shopEl.append(
        h("div", { class: "lo-shop-cat" }, h("div", { class: "lo-shop-cap", style: `color:${CATEGORY_COLOR[cat]}` }, h("i", { class: "cat-dot", style: `background:${CATEGORY_COLOR[cat]}` }), label(CATEGORY_LABEL[cat]), cat === "weapon" ? h("span", { class: "lo-shop-kinds" }, h("span", { style: "color:#fb923c" }, kindBadgeHtml("energy"), " ", label("energetické")), h("span", { style: "color:#ef4444" }, kindBadgeHtml("projectile"), " ", label("projektilové"))) : null), row),
      );
    }
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
      if (!why || why === "všechny sloty obsazené") btn.addEventListener("pointerdown", (ev) => { ev.preventDefault(); startShopDrag(ev, t, btn); });
      rows.get(MODULE_CATEGORY[t])!.append(btn);
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
        { class: `pk-tile hull ${on ? "on" : ""}`, disabled: !canPick || !opts.hullChoices, title: `${x.name}\n${x.description}\nLodní body: ${x.points} · trup ${x.hull} · sloty: ${x.slots.map((sl) => sl.name).join(", ")} · náklad ${x.cargo}`, onclick: () => ((pickerOpen = null), change(switchHull(loadout, x.id))) },
        h("span", { class: "pk-pic" }, hullThumb(x.id, on ? "#3b82f6" : "#64748b", 40, opts.team ?? 1)),
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
export function moduleHexSvg(t: ModuleType, sub: string, dim: boolean, weight?: number, ammo?: number, price?: number): SVGSVGElement {
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
  ic.setAttribute("y", "10");
  svg.append(ic);
  const kind = weaponKind(t);
  if (kind) {
    // značka druhu zbraně v pravém horním rohu: blesk = energetická, náboj = projektilová
    const g = svgEl("g", { transform: `translate(${cx + 22}, 20)`, class: "hex-kind", opacity: dim ? 0.5 : 1 });
    g.append(svgEl("circle", { cx: 0, cy: 0, r: 7, fill: "#0b1020", stroke: dim ? "#334155" : col, "stroke-width": 1.5 }));
    g.append(kindShape(kind, dim ? "#64748b" : col));
    g.append(svgEl("title", {}, WEAPON_KIND_LABEL[kind] + " zbraň"));
    svg.append(g);
  }
  // pevný vnitřní layout (stejná místa ve všech dlaždicích): ikona 12, název 40/51, cena 65, munice 69–77, váha 80
  const words = def.name.toUpperCase().replace(/ [–-] /g, " ").split(" ").slice(0, 2);
  const fs = Math.max(...words.map((w) => w.length)) > 8 ? 13 : 15;
  const hasAmmo = ammo !== undefined && !!def.ammo;
  words.forEach((w, i) => svg.append(svgEl("text", { x: cx, y: 38 + i * 11, "font-family": "Jersey, ui-monospace, monospace", "font-size": fs, fill: dim ? "#64748b" : "#f8fafc", "text-anchor": "middle" }, w)));
  let y = 62;
  if (price !== undefined) {
    // cena: mince + číslo (ať je jasné, že jde o kredity)
    const txt = `${price}${sub ? ` ${sub}` : ""}`;
    const tw = txt.length * 6.2;
    const x0 = cx - (tw + 12) / 2;
    const coin = icon("credits", dim ? "#64748b" : "#fbbf24", 10);
    coin.setAttribute("x", String(x0));
    coin.setAttribute("y", String(y - 9));
    svg.append(coin);
    svg.append(svgEl("text", { x: x0 + 13, y, "font-family": "Jersey", "font-size": 12, fill: dim ? "#64748b" : "#fbbf24", "text-anchor": "start" }, txt));
  } else if (sub) svg.append(svgEl("text", { x: cx, y, "font-family": "Jersey", "font-size": 12, fill: dim ? "#64748b" : "#fbbf24", "text-anchor": "middle" }, sub));
  if (hasAmmo) {
    // munice v modulu: do 10 kusů ikonky (náboje), jinak dílky + počet
    const max = def.ammo!;
    const yy = y + 4;
    const acol = dim ? "#64748b" : "#fbbf24";
    if (max <= 10) {
      const size = 9;
      const x0 = cx - (max * (size + 1)) / 2;
      for (let i = 0; i < max; i++) {
        const ic = icon(def.icon, i < ammo! ? acol : "#475569", size);
        ic.setAttribute("x", String(x0 + i * (size + 1)));
        ic.setAttribute("y", String(yy));
        svg.append(ic);
      }
    } else {
      // kulomet: munice po dávkách – „10× [zásobník] DÁVKA“ (zásobník = 10 nábojů = jedna dávka)
      const loaded = Math.floor(ammo! / MG_BURST);
      const txt = `${loaded}×`;
      const lbl = "DÁVKA";
      const tw = txt.length * 4.8;
      const cwid = 31;
      const lw = lbl.length * 4.3;
      const total = tw + 1 + cwid + 2 + lw;
      const x0 = cx - total / 2;
      svg.append(svgEl("text", { x: x0 + tw, y: yy + 8, "font-family": "Jersey", "font-size": 11, fill: acol, "text-anchor": "end" }, txt));
      const g = svgEl("g", { transform: `translate(${x0 + tw + 1}, ${yy + 1.5}) scale(0.7)` });
      g.append(svgEl("rect", { x: 0, y: 0, width: 44, height: 10, fill: "none", stroke: acol, "stroke-width": 1 }));
      for (let i = 0; i < MG_BURST; i++) g.append(svgEl("rect", { x: 3 + i * 4, y: 2.5, width: 2.5, height: 5, fill: acol }));
      g.append(svgEl("title", {}, `${loaded} dávek po ${MG_BURST} nábojích (${ammo} nábojů)`));
      svg.append(g);
      svg.append(svgEl("text", { x: x0 + tw + 1 + cwid + 2, y: yy + 8, "font-family": "Jersey", "font-size": 8, fill: dim ? "#64748b" : "#cbd5e1", "text-anchor": "start" }, lbl));
    }
  }
  y = 73;
  const ammoW = hasAmmo ? +((def.ammoWeight ?? 0) * ammo!).toFixed(2) : 0;
  if ((weight !== undefined && weight > 0) || ammoW > 0) {
    // váha jako závaží: šedá = modul, žlutá = munice (půlka = oříznutá ikona)
    const iw = 9;
    const parts: { w: number; col: string }[] = [
      { w: weight ?? 0, col: dim ? "#64748b" : "#94a3b8" },
      { w: ammoW, col: dim ? "#64748b" : "#fbbf24" },
    ].filter((p) => p.w > 0);
    const units = (w: number) => Math.floor(w) + (w % 1 > 0 ? 0.5 : 0);
    const total = parts.reduce((s, p) => s + units(p.w), 0) + (parts.length - 1) * 0.4;
    let x = cx - (total * (iw + 1)) / 2;
    const yy = y + 4;
    const g = svgEl("g", {});
    g.append(svgEl("title", {}, `Váha: modul ${weight ?? 0}${ammoW ? ` + munice ${ammoW}` : ""}`));
    for (const p of parts) {
      const n = Math.floor(p.w);
      for (let i = 0; i < n; i++) {
        const w = icon("weight", p.col, iw);
        w.setAttribute("x", String(x));
        w.setAttribute("y", String(yy));
        g.append(w);
        x += iw + 1;
      }
      if (p.w % 1 > 0) {
        const w = icon("weight", p.col, iw);
        w.setAttribute("x", String(x));
        w.setAttribute("y", String(yy));
        w.setAttribute("viewBox", "0 0 4 8");
        w.setAttribute("width", String(iw / 2));
        g.append(w);
        x += iw / 2 + 1;
      }
      x += 0.4 * (iw + 1);
    }
    svg.append(g);
  }
  return svg;
}

/** Tvar značky druhu zbraně (SVG, střed 0,0): blesk = energetická, náboj = projektilová. */
function kindShape(kind: WeaponKind, col: string): SVGElement {
  if (kind === "energy") return svgEl("polygon", { points: "0.5,-4.5 -2.5,0.5 -0.2,0.5 -1,4.5 2.5,-0.8 0.2,-0.8", fill: col });
  const g = svgEl("g", {});
  g.append(svgEl("path", { d: "M -1.6 -1.2 Q -1.6 -4.2 0 -4.2 Q 1.6 -4.2 1.6 -1.2 Z", fill: col }));
  g.append(svgEl("rect", { x: -1.6, y: -1.2, width: 3.2, height: 4.6, fill: col }));
  g.append(svgEl("rect", { x: -2.2, y: 3.2, width: 4.4, height: 1.2, fill: col }));
  return g;
}
/** Totéž jako HTML (do nadpisů). */
function kindBadgeHtml(kind: WeaponKind): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: "-5 -5 10 10", width: 10, height: 10, class: "kind-badge" });
  svg.append(kindShape(kind, "currentColor"));
  return svg;
}

/** Vysvětlivka modulu v obchodě: kategorie, druh, popis, cena, váha modulu, munice (kusy, váha, cena), životy. */
function moduleTip(t: ModuleType, why: string | null) {
  const def = MODULES[t];
  const cat = MODULE_CATEGORY[t];
  const kind = weaponKind(t);
  const fx: { icon: string; text: string; tone?: "good" | "bad" }[] = [
    { icon: "credits", text: `cena ${def.price}` },
    { icon: "weight", text: `váha modulu ${def.weight}` },
  ];
  if (def.ammo) {
    fx.push({ icon: "weight", text: `munice ${def.ammo} ks × ${def.ammoWeight} = váha ${+(def.ammo * (def.ammoWeight ?? 0)).toFixed(2)}` });
    fx.push({ icon: "credits", text: `doplnění ${def.ammoPrice}/ks` });
  }
  fx.push({ icon: "hull", text: `životy ${def.hp}` });
  if (t === "shield-whole") {
    fx.push({ icon: "laser", text: "⚡ lasery jen vybíjejí", tone: "good" });
    fx.push({ icon: "torpedo", text: `● projektily prorazí ${RULES.wholePiercePct} %`, tone: "bad" });
    fx.push({ icon: "scan", text: `dobití: ${RULES.rechargeTechCost} tech → +${RULES.rechargeWhole}` });
  } else if (t === "shield-segment") {
    fx.push({ icon: "torpedo", text: "● projektil zachytí celý (1 bod)", tone: "good" });
    fx.push({ icon: "laser", text: `⚡ laser pronikne ${RULES.segmentPassPct} %`, tone: "bad" });
    fx.push({ icon: "scan", text: `dobití: ${RULES.rechargeTechCost} tech → +${RULES.rechargeSegments} body` });
  }
  return tipAttr({
    icon: def.icon,
    iconColor: moduleColor(t),
    title: `${def.name} · ${CATEGORY_LABEL[cat]}${kind ? ` (${WEAPON_KIND_LABEL[kind]})` : ""}`,
    fx,
    note: `${def.description}${def.ammo ? ` Celková váha s plnou municí ${+(def.weight + def.ammo * (def.ammoWeight ?? 0)).toFixed(2)}.` : ""}`,
    warn: why ? `Nelze: ${why}` : undefined,
  });
}

function hexBuyButton(t: ModuleType, have: number, why: string | null, onClick: () => void): HTMLElement {
  const def = MODULES[t];
  const svg = moduleHexSvg(t, have ? `×${have}` : "", !!why, def.weight, def.ammo, def.price);
  const btn = h("button", { class: `lo-hexbuy ${why ? "dis" : ""}`, disabled: !!why, ...moduleTip(t, why), onclick: onClick }, svg);
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

/** Ladicí hák pro náhledy (e2e): vykreslení editoru s libovolnou výbavou. */
(window as unknown as { __renderLoadout?: typeof renderLoadout }).__renderLoadout = renderLoadout;
