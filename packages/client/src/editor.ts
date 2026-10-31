/**
 * Editor map: volný obrys (nebo elipsa), asteroidy, bouře štětcem, startovní body a zóny, stanice, dráhy komet.
 * Mapy se ukládají na server (maps.json) a vybírají v lobby. Ovládání myší i dotykem (pointer events).
 */
import {
  ASTEROID_SEGMENTS,
  CUSTOM_MAP_LIMITS,
  generateProfile,
  insideMap,
  MOVE_UNIT,
  newCustomMap,
  nearestOnPolygon,
  pointInStorm,
  polygonCentroid,
  sanitizeCustomMap,
  SKY_CHOICES,
  SKY_LABEL,
  TEAM_COLORS,
  TEAM_NAMES,
  type CometLane,
  type CustomMap,
  type CustomMapSummary,
  type SkyChoice,
} from "@wingfighter/shared";
import { clear, h } from "./dom.ts";
import { icon, label } from "./icons.ts";
import { confirmDialog } from "./dialog.ts";
import type { Net } from "./net.ts";
import { traceMap } from "./game/map-path.ts";

type Tool = "outline" | "asteroid" | "storm" | "start" | "zone" | "station" | "comet" | "select";
type Sel = { kind: "asteroid" | "start" | "station" | "zone" | "lane" | "blob" | "vertex"; i: number; j?: number } | null;

const TOOLS: { id: Tool; glyph: string; name: string; hint: string }[] = [
  { id: "outline", glyph: "◯", name: "Obrys mapy", hint: "Body: tažením posuň bod, klik na hranu přidá, dvojklik smaže. Od ruky: tažením nakresli libovolný tvar (vyhladí se). Plocha mapy se obrysu přizpůsobí sama." },
  { id: "asteroid", glyph: "●", name: "Asteroidy", hint: "Klik = asteroid zvolené velikosti, tažení = přesun. Vybraný: 🎲 tvar, ✕." },
  { id: "storm", glyph: "▒", name: "Bouře (štětec)", hint: "Tažením maluješ bouři zvoleným štětcem; režim guma maže." },
  { id: "start", glyph: "➤", name: "Starty", hint: "Klik = startovní bod zvoleného týmu, tažení od bodu = kurz, tažení těla = přesun." },
  { id: "zone", glyph: "▭", name: "Startovní zóny", hint: "Tažením nakresli obdélník zóny zvoleného týmu (použije se, když bodů není dost)." },
  { id: "station", glyph: "✚", name: "Stanice", hint: "Klik = stanice, tažení = přesun." },
  { id: "comet", glyph: "☄", name: "Dráhy komet", hint: "Klikej body dráhy (od okraje k okraji), dvojklik / Enter ukončí. Vybraná dráha má nastavení vpravo." },
  { id: "select", glyph: "✥", name: "Výběr / guma", hint: "Klik vybere objekt, tažení přesune, Delete / ✕ smaže." },
];

const AST_SIZES: [string, number][] = [
  ["S", 24],
  ["M", 40],
  ["L", 60],
  ["XL", 90],
];
const BRUSHES: [string, number][] = [
  ["malý", 70],
  ["střední", 120],
  ["velký", 200],
];

interface EditorState {
  map: CustomMap;
  tool: Tool;
  sel: Sel;
  astSize: number;
  brush: number;
  erase: boolean;
  team: number | null;
  snap: boolean;
  dirty: boolean;
  undo: string[];
  redo: string[];
  cam: { x: number; y: number; zoom: number };
  list: CustomMapSummary[];
  status: string;
  /** Rozkreslená dráha komety (body, dokud se neukončí). */
  lane: { x: number; y: number }[] | null;
  /** Obrys: úprava bodů, nebo kreslení od ruky tažením. */
  outlineMode: "points" | "freehand";
  /** Právě kreslený obrys od ruky. */
  stroke: { x: number; y: number }[] | null;
}

let st: EditorState | null = null;
let root: HTMLElement | null = null;
let netRef: Net | null = null;
let onExit: (() => void) | null = null;
let canvas: HTMLCanvasElement | null = null;
let raf = 0;
let authorName = "";

export function isEditorOpen(): boolean {
  return !!st;
}

export function openEditor(app: HTMLElement, net: Net, author: string, exit: () => void, map?: CustomMap) {
  netRef = net;
  onExit = exit;
  authorName = author;
  root = app;
  st = {
    map: map ?? newCustomMap("Nová mapa", author),
    tool: "asteroid",
    sel: null,
    astSize: 40,
    brush: 120,
    erase: false,
    team: 0,
    snap: true,
    dirty: false,
    undo: [],
    redo: [],
    cam: { x: 0, y: 0, zoom: 0.25 },
    list: [],
    status: "",
    lane: null,
    outlineMode: "points",
    stroke: null,
  };
  net.send({ type: "listMaps" });
  renderEditor();
  fitView();
}

export function closeEditor() {
  st = null;
  canvas = null;
  cancelAnimationFrame(raf);
}

/** Zprávy ze serveru (seznam map, načtená / uložená mapa). */
export function editorOnMaps(list: CustomMapSummary[]) {
  if (!st) return;
  st.list = list;
  renderEditor();
}
export function editorOnMap(map: CustomMap | null, saved?: boolean) {
  if (!st) return;
  if (saved && map) {
    st.map.id = map.id;
    st.map.author = map.author;
    st.map.updatedAt = map.updatedAt;
    st.dirty = false;
    st.status = `Uloženo: ${map.name}`;
    renderEditor();
    return;
  }
  if (map) {
    st.map = map;
    st.sel = null;
    st.undo = [];
    st.redo = [];
    st.dirty = false;
    st.status = `Načteno: ${map.name}`;
    normalizeBounds();
    renderEditor();
    fitView();
  }
}

/* ---------- pomocné ---------- */

function snapV(v: number): number {
  return st?.snap ? Math.round(v / MOVE_UNIT) * MOVE_UNIT : Math.round(v);
}
function pushUndo() {
  if (!st) return;
  st.undo.push(JSON.stringify(st.map));
  if (st.undo.length > 60) st.undo.shift();
  st.redo = [];
  st.dirty = true;
}
function undo() {
  if (!st || !st.undo.length) return;
  st.redo.push(JSON.stringify(st.map));
  st.map = JSON.parse(st.undo.pop()!);
  st.sel = null;
  st.dirty = true;
  renderEditor();
}
function redo() {
  if (!st || !st.redo.length) return;
  st.undo.push(JSON.stringify(st.map));
  st.map = JSON.parse(st.redo.pop()!);
  st.sel = null;
  st.dirty = true;
  renderEditor();
}
function box() {
  return { width: st!.map.width, height: st!.map.height, outline: st!.map.outline };
}
function fitView() {
  if (!st || !canvas) return;
  const pad = 300;
  const zoom = Math.min(canvas.clientWidth / (st.map.width + 2 * pad), canvas.clientHeight / (st.map.height + 2 * pad));
  st.cam = { zoom, x: st.map.width / 2 - canvas.clientWidth / 2 / zoom, y: st.map.height / 2 - canvas.clientHeight / 2 / zoom };
  requestDraw();
}
function toWorld(e: { clientX: number; clientY: number }) {
  const r = canvas!.getBoundingClientRect();
  return { x: st!.cam.x + (e.clientX - r.left) / st!.cam.zoom, y: st!.cam.y + (e.clientY - r.top) / st!.cam.zoom };
}
/** Zjednodušení křivky (Ramer–Douglas–Peucker) na rozumný počet bodů. */
function simplify(pts: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (pts.length <= 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const A = pts[a];
    const B = pts[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Plocha mapy se přizpůsobí obrysu: posune vše tak, aby obrys ležel uvnitř s okrajem, a nastaví šířku × výšku. */
function normalizeBounds() {
  if (!st) return;
  const m = st.map;
  if (!m.outline || m.outline.length < 3) return;
  const MARGIN = 220;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of m.outline) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // příliš velký tvar: zmenšit vše rovnoměrně na limit
  const maxSide = CUSTOM_MAP_LIMITS.maxSize - 2 * MARGIN;
  const scale = Math.min(1, maxSide / Math.max(1, maxX - minX), maxSide / Math.max(1, maxY - minY));
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  const tr = (p: { x: number; y: number }) => {
    p.x = Math.round((p.x + dx) * scale);
    p.y = Math.round((p.y + dy) * scale);
  };
  if (dx === 0 && dy === 0 && scale === 1 && m.width === Math.round((maxX - minX) * scale) + 2 * MARGIN && m.height === Math.round((maxY - minY) * scale) + 2 * MARGIN) return;
  for (const p of m.outline) tr(p);
  for (const a of m.asteroids) {
    tr(a);
    a.radius = Math.max(12, Math.round(a.radius * scale));
  }
  for (const sm of m.storms) for (const b of sm.blobs) {
    tr(b);
    b.r = Math.max(20, Math.round(b.r * scale));
  }
  for (const p of m.starts) tr(p);
  for (const p of m.stations) tr(p);
  for (const z of m.zones) {
    tr(z);
    z.w = Math.round(z.w * scale);
    z.h = Math.round(z.h * scale);
  }
  for (const l of m.cometLanes) for (const p of l.points) tr(p);
  m.width = Math.max(CUSTOM_MAP_LIMITS.minSize, Math.round((maxX - minX) * scale) + 2 * MARGIN);
  m.height = Math.max(CUSTOM_MAP_LIMITS.minSize, Math.round((maxY - minY) * scale) + 2 * MARGIN);
  // malý obrys: vycentrovat do minimální plochy
  const cx = (m.width - (Math.round((maxX - minX) * scale) + 2 * MARGIN)) / 2;
  const cy = (m.height - (Math.round((maxY - minY) * scale) + 2 * MARGIN)) / 2;
  if (cx || cy) {
    const sh = (p: { x: number; y: number }) => {
      p.x = Math.round(p.x + cx);
      p.y = Math.round(p.y + cy);
    };
    for (const p of m.outline) sh(p);
    for (const a of m.asteroids) sh(a);
    for (const sm of m.storms) for (const b of sm.blobs) sh(b);
    for (const p of m.starts) sh(p);
    for (const p of m.stations) sh(p);
    for (const z of m.zones) sh(z);
    for (const l of m.cometLanes) for (const p of l.points) sh(p);
  }
  st.cam.x += 0; // kamera zůstává; uživatel vidí posun – přizpůsobit pohled
}

/** Elipsa jako mnohoúhelník (pro převod „z elipsy“). */
function ellipsePoly(w: number, hh: number, n = 24) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: Math.round(w / 2 + (Math.cos(a) * w) / 2), y: Math.round(hh / 2 + (Math.sin(a) * hh) / 2) };
  });
}
function hitTest(w: { x: number; y: number }): Sel {
  const m = st!.map;
  const r = 14 / st!.cam.zoom;
  if (st!.tool === "outline" && m.outline) {
    for (let i = 0; i < m.outline.length; i++) if (Math.hypot(m.outline[i].x - w.x, m.outline[i].y - w.y) <= r) return { kind: "vertex", i };
  }
  const ms = Math.max(1, (1 / st!.cam.zoom) * 0.9);
  for (let i = m.starts.length - 1; i >= 0; i--) if (Math.hypot(m.starts[i].x - w.x, m.starts[i].y - w.y) <= 22 * ms) return { kind: "start", i };
  for (let i = m.stations.length - 1; i >= 0; i--) if (Math.hypot(m.stations[i].x - w.x, m.stations[i].y - w.y) <= 60) return { kind: "station", i };
  for (let i = m.asteroids.length - 1; i >= 0; i--) if (Math.hypot(m.asteroids[i].x - w.x, m.asteroids[i].y - w.y) <= m.asteroids[i].radius + 4) return { kind: "asteroid", i };
  for (let i = m.cometLanes.length - 1; i >= 0; i--) {
    const pts = m.cometLanes[i].points;
    for (let j = 0; j < pts.length; j++) if (Math.hypot(pts[j].x - w.x, pts[j].y - w.y) <= r) return { kind: "lane", i, j };
    if (nearestOnPolyline(pts, w) <= r) return { kind: "lane", i };
  }
  for (let i = m.zones.length - 1; i >= 0; i--) {
    const z = m.zones[i];
    if (w.x >= z.x && w.x <= z.x + z.w && w.y >= z.y && w.y <= z.y + z.h) return { kind: "zone", i };
  }
  for (let i = m.storms.length - 1; i >= 0; i--) for (let j = m.storms[i].blobs.length - 1; j >= 0; j--) if (Math.hypot(m.storms[i].blobs[j].x - w.x, m.storms[i].blobs[j].y - w.y) <= m.storms[i].blobs[j].r) return { kind: "blob", i, j };
  return null;
}
function nearestOnPolyline(pts: { x: number; y: number }[], p: { x: number; y: number }): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}
function deleteSel() {
  if (!st || !st.sel) return;
  const m = st.map;
  pushUndo();
  const s = st.sel;
  if (s.kind === "asteroid") m.asteroids.splice(s.i, 1);
  else if (s.kind === "start") m.starts.splice(s.i, 1);
  else if (s.kind === "station") m.stations.splice(s.i, 1);
  else if (s.kind === "zone") m.zones.splice(s.i, 1);
  else if (s.kind === "lane") m.cometLanes.splice(s.i, 1);
  else if (s.kind === "blob") {
    m.storms[s.i].blobs.splice(s.j!, 1);
    if (!m.storms[s.i].blobs.length) m.storms.splice(s.i, 1);
  } else if (s.kind === "vertex" && m.outline && m.outline.length > 3) m.outline.splice(s.i, 1);
  st.sel = null;
  renderEditor();
}

/** Kontrola mapy: varování do panelu. */
function checks(): { ok: boolean; text: string }[] {
  const m = st!.map;
  const b = box();
  const out: { ok: boolean; text: string }[] = [];
  const bad = m.starts.filter((s) => !insideMap(b, s, 60) || pointInStorm(m.storms, s, 40) || m.asteroids.some((a) => Math.hypot(a.x - s.x, a.y - s.y) < a.radius + 60));
  out.push(bad.length ? { ok: false, text: `${bad.length}× start v překážce / u okraje` } : { ok: true, text: "starty mimo asteroidy, bouře i okraj" });
  const teams = new Set(m.starts.map((s) => s.team ?? -1));
  if (m.starts.length < 2 && m.zones.length === 0) out.push({ ok: false, text: "mapa potřebuje aspoň 2 starty nebo zóny" });
  else out.push({ ok: true, text: `${m.starts.length} startů (${[...teams].filter((t) => t >= 0).length} týmových), ${m.zones.length} zón` });
  const astOut = m.asteroids.filter((a) => !insideMap(b, a, a.radius * 0.5)).length;
  if (astOut) out.push({ ok: false, text: `${astOut}× asteroid mimo mapu (ve hře se vynechá)` });
  for (const l of m.cometLanes) {
    const a = l.points[0];
    const z = l.points[l.points.length - 1];
    if (insideMap(b, a, -40) || insideMap(b, z, -40)) out.push({ ok: false, text: `dráha ${l.id}: začátek/konec má být za okrajem` });
  }
  return out;
}

/* ---------- vykreslení DOM ---------- */

function renderEditor() {
  if (!st || !root) return;
  const s = st;
  const m = s.map;
  clear(root);
  const toolBtn = (t: (typeof TOOLS)[number]) => h("button", { class: `ed-tool ${s.tool === t.id ? "on" : ""}`, title: t.hint, onclick: () => ((s.tool = t.id), (s.sel = null), (s.lane = null), renderEditor()) }, h("i", {}, t.glyph), label(t.name));
  const pip = (on: boolean, txt: string, cb: () => void, title = "", style = "") => h("button", { class: `px tiny ed-pip ${on ? "on" : ""}`, title, style, onclick: cb }, txt);
  const numIn = (v: number, lo: number, hi: number, cb: (n: number) => void, w = 56) => {
    const inp = h("input", { type: "number", value: String(v), min: String(lo), max: String(hi), class: "ed-num", style: `width:${w}px` });
    inp.onchange = () => {
      const n = Math.max(lo, Math.min(hi, Number(inp.value) || lo));
      cb(n);
    };
    return inp;
  };
  const nameIn = h("input", { value: m.name, maxLength: CUSTOM_MAP_LIMITS.nameLen, class: "ed-name", placeholder: "Název mapy" });
  nameIn.onchange = () => ((m.name = nameIn.value.trim() || "Mapa"), (s.dirty = true));

  /* --- horní lišta --- */
  const top = h(
    "div",
    { class: "ed-top" },
    h("b", {}, label("Editor map")),
    nameIn,
    h("span", { class: "muted txt" }, `autor: ${m.author || authorName || "?"} · ${m.width}×${m.height}${s.dirty ? " · neuloženo" : ""}`),
    h("span", { class: "spacer" }),
    pip(s.snap, "mřížka 45", () => ((s.snap = !s.snap), renderEditor()), "Přichytávání k mřížce po políčkách (45 j.)"),
    h(
      "select",
      { class: "fsel", onchange: (e) => ((m.sky = (e.target as HTMLSelectElement).value as SkyChoice), (s.dirty = true), requestDraw()) },
      ...SKY_CHOICES.map((k) => h("option", { value: k, selected: (m.sky ?? "none") === k }, `obloha: ${SKY_LABEL[k]}`)),
    ),
    h("span", { class: "muted txt ed-status" }, s.status),
  );

  /* --- levý panel --- */
  const left = h("div", { class: "pnl ed-left" }, h("h4", {}, label("Nástroje")), ...TOOLS.map(toolBtn), h("div", { class: "muted txt ed-hint" }, TOOLS.find((t) => t.id === s.tool)?.hint ?? ""));

  /* --- plátno --- */
  canvas = h("canvas", { class: "ed-canvas" });
  bindPointer(canvas);

  /* --- pravý panel --- */
  const right = h("div", { class: "pnl ed-right" });
  const sec = (title: string, ...rows: (Node | null)[]) => right.append(h("h4", {}, label(title)), ...rows.filter((x): x is Node => !!x));
  const row = (lbl: string, ...c: (Node | string | null)[]) => h("div", { class: "ed-row" }, h("label", {}, lbl), ...c.filter((x): x is Node | string => x !== null));

  // Mapa / obrys
  sec(
    "Mapa",
    m.outline
      ? row("plocha", h("span", { class: "muted txt" }, `${m.width} × ${m.height} (podle obrysu)`))
      : row("šířka × výška", numIn(m.width, CUSTOM_MAP_LIMITS.minSize, CUSTOM_MAP_LIMITS.maxSize, (n) => (pushUndo(), (m.width = n), renderEditor()), 64), " × ", numIn(m.height, CUSTOM_MAP_LIMITS.minSize, CUSTOM_MAP_LIMITS.maxSize, (n) => (pushUndo(), (m.height = n), renderEditor()), 64)),
    s.tool === "outline"
      ? row("kreslení", pip(s.outlineMode === "points", "body", () => ((s.outlineMode = "points"), renderEditor()), "Upravovat body obrysu"), pip(s.outlineMode === "freehand", "od ruky", () => ((s.outlineMode = "freehand"), renderEditor()), "Tažením nakreslit libovolný tvar – nahradí současný obrys"))
      : null,
    row(
      "obrys",
      m.outline
        ? h("button", { class: "px tiny", title: "Zahodit volný obrys, mapa bude elipsa", onclick: () => (pushUndo(), (m.outline = undefined), (s.sel = null), renderEditor()) }, "→ elipsa")
        : h("button", { class: "px tiny", title: "Převést elipsu na 24 bodů, které jde tahat", onclick: () => (pushUndo(), (m.outline = ellipsePoly(m.width, m.height)), (s.tool = "outline"), renderEditor()) }, "z elipsy"),
      m.outline ? h("span", { class: "muted txt" }, ` ${m.outline.length} bodů`) : h("span", { class: "muted txt" }, " elipsa"),
    ),
  );
  if (s.tool === "asteroid" || s.sel?.kind === "asteroid") {
    const a = s.sel?.kind === "asteroid" ? m.asteroids[s.sel.i] : null;
    sec(
      "Asteroidy",
      row("velikost", ...AST_SIZES.map(([k, r]) => pip(s.astSize === r, k, () => ((s.astSize = r), a && (pushUndo(), (a.radius = r)), renderEditor())))),
      a
        ? row(
            "vybraný",
            h("button", { class: "px tiny", title: "Přehodit tvar", onclick: () => (pushUndo(), (a.seed = Math.floor(Math.random() * 1e6)), renderEditor()) }, "🎲 tvar"),
            h("button", { class: "px tiny", onclick: deleteSel }, "✕"),
          )
        : null,
      row("doplnit", ...(["málo", "střed", "hodně"] as const).map((k, i) => h("button", { class: "px tiny", title: "Náhodně doplní asteroidy do prázdných míst", onclick: () => fillAsteroids([8, 16, 28][i]) }, k))),
      row("", h("button", { class: "px tiny", onclick: () => confirmDialog({ title: "Vyčistit asteroidy", text: "Smazat všechny asteroidy?", ok: "Smazat", danger: true }, () => (pushUndo(), (m.asteroids = []), renderEditor())) }, "Vyčistit vše"), h("span", { class: "muted txt" }, ` ${m.asteroids.length} ks`)),
    );
  }
  if (s.tool === "storm") {
    sec(
      "Bouře",
      row("štětec", ...BRUSHES.map(([k, r]) => pip(s.brush === r, k, () => ((s.brush = r), renderEditor())))),
      row("režim", pip(!s.erase, "malovat", () => ((s.erase = false), renderEditor())), pip(s.erase, "guma", () => ((s.erase = true), renderEditor()))),
      row("", h("button", { class: "px tiny", onclick: () => (pushUndo(), (m.storms = []), renderEditor()) }, "Vyčistit bouře"), h("span", { class: "muted txt" }, ` ${m.storms.reduce((n, x) => n + x.blobs.length, 0)} kruhů`)),
    );
  }
  if (s.tool === "start" || s.tool === "zone" || s.sel?.kind === "start" || s.sel?.kind === "zone") {
    const teamPips = (cur: number | null, cb: (t: number | null) => void, any: boolean) =>
      row(
        "tým",
        ...[0, 1, 2, 3].map((t) => pip(cur === t, TEAM_NAMES[t].toLowerCase(), () => cb(t), "", cur === t ? `background:${TEAM_COLORS[t]};border-color:${TEAM_COLORS[t]};color:#fff` : `color:${TEAM_COLORS[t]}`)),
        any ? pip(cur === null, "kdokoliv", () => cb(null)) : null,
      );
    const stSel = s.sel?.kind === "start" ? m.starts[s.sel.i] : null;
    const zSel = s.sel?.kind === "zone" ? m.zones[s.sel.i] : null;
    sec(
      "Starty a zóny",
      // tým: nastaví výchozí pro další body a zároveň přebarví vybraný start / zónu
      teamPips(stSel ? (stSel.team ?? null) : zSel ? zSel.team : s.team, (t) => {
        s.team = t;
        if (stSel) {
          pushUndo();
          if (t === null) delete stSel.team;
          else stSel.team = t;
        } else if (zSel) {
          pushUndo();
          zSel.team = t ?? 0;
        }
        renderEditor();
      }, !zSel && s.tool !== "zone"),
      stSel
        ? row("vybraný start", h("button", { class: "px tiny", title: "Otočit kurz o 90°", onclick: () => (pushUndo(), (stSel.heading += Math.PI / 2), renderEditor()) }, "↻ 90°"), h("button", { class: "px tiny", title: "Kurz do středu mapy", onclick: () => (pushUndo(), (stSel.heading = Math.atan2(polygonCentroidOf().y - stSel.y, polygonCentroidOf().x - stSel.x)), renderEditor()) }, "→ střed"), h("button", { class: "px tiny", onclick: deleteSel }, "✕"))
        : null,
      zSel ? row("vybraná zóna", h("span", { class: "muted txt" }, `${zSel.w}×${zSel.h}`), h("button", { class: "px tiny", onclick: deleteSel }, "✕")) : null,
      row("stav", h("span", { class: "muted txt" }, `${m.starts.length} startů · ${m.zones.length} zón`)),
    );
  }
  if (s.tool === "station" || s.sel?.kind === "station") sec("Stanice", row("počet", h("span", { class: "muted txt" }, `${m.stations.length} / ${CUSTOM_MAP_LIMITS.maxStations}`), s.sel?.kind === "station" ? h("button", { class: "px tiny", onclick: deleteSel }, "✕") : null));
  if (s.tool === "comet" || s.sel?.kind === "lane") {
    const l = s.sel?.kind === "lane" ? m.cometLanes[s.sel.i] : null;
    sec(
      "Komety",
      s.lane ? row("kreslím", h("span", { class: "muted txt" }, `${s.lane.length} bodů · dvojklik / Enter = hotovo, Esc = zrušit`)) : row("dráhy", h("span", { class: "muted txt" }, `${m.cometLanes.length} / ${CUSTOM_MAP_LIMITS.maxLanes}`)),
      l ? row("každých", numIn(l.every, 1, 99, (n) => (pushUndo(), (l.every = n), renderEditor()), 48), " kol, první v kole ", numIn(l.first, 1, 99, (n) => (pushUndo(), (l.first = n), renderEditor()), 48)) : null,
      l ? row("rychlost", ...(["slow", "normal", "fast"] as const).map((k, i) => pip(l.speed === k, ["pomalá", "běžná", "rychlá"][i], () => (pushUndo(), (l.speed = k), renderEditor())))) : null,
      l ? row("velikost", ...(["small", "medium", "large"] as const).map((k, i) => pip(l.size === k, ["malá", "střední", "velká"][i], () => (pushUndo(), (l.size = k), renderEditor())))) : null,
      l ? row("", h("button", { class: "px tiny", onclick: deleteSel }, "✕ smazat dráhu")) : null,
      row("náhodné komety", pip(m.randomComets, m.randomComets ? "ano" : "ne", () => (pushUndo(), (m.randomComets = !m.randomComets), renderEditor()), "Komety přilétají i náhodně od okraje (jako u generované mapy, podle nastavení místnosti)")),
    );
  }
  sec("Kontrola", ...checks().map((c) => h("div", { class: "ed-row", style: `color:${c.ok ? "#4ade80" : "#fbbf24"}` }, (c.ok ? "✓ " : "⚠ ") + c.text)));

  /* --- spodní lišta --- */
  const loadSel = h("select", { class: "fsel", title: "Načíst mapu ze serveru" }, h("option", { value: "" }, "Načíst…"), ...s.list.map((x) => h("option", { value: x.id }, `${x.name} (${x.author || "?"})`)));
  loadSel.onchange = () => {
    const id = loadSel.value;
    if (!id) return;
    const go = () => netRef?.send({ type: "getMap", id });
    if (s.dirty) confirmDialog({ title: "Neuložené změny", text: "Načtením jiné mapy přijdeš o neuložené změny. Pokračovat?", ok: "Načíst" }, go);
    else go();
  };
  const fileIn = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  fileIn.onchange = () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    void f.text().then((txt) => {
      try {
        const mm = sanitizeCustomMap(JSON.parse(txt));
        if (!mm) throw new Error("neplatný soubor");
        pushUndo();
        mm.id = newCustomMap("", "").id; // import = nová mapa (nepřepíše cizí)
        mm.author = authorName;
        s.map = mm;
        s.sel = null;
        s.status = `Importováno: ${mm.name}`;
        renderEditor();
        fitView();
      } catch (e) {
        s.status = `Import selhal: ${(e as Error).message}`;
        renderEditor();
      }
    });
  };
  const bottom = h(
    "div",
    { class: "ed-bottom" },
    h("button", { class: "px primary", title: "Uložit na server (maps.json) – uvidí všichni na tomto serveru", onclick: () => save(false) }, "💾 ", label("Uložit")),
    h("button", { class: "px", title: "Uložit jako novou mapu (kopii)", onclick: () => save(true) }, label("Uložit jako")),
    h("button", { class: "px", onclick: () => { const go = () => { s.map = newCustomMap("Nová mapa", authorName); s.sel = null; s.undo = []; s.redo = []; s.dirty = false; renderEditor(); fitView(); }; if (s.dirty) confirmDialog({ title: "Neuložené změny", text: "Nová mapa zahodí neuložené změny. Pokračovat?", ok: "Nová mapa" }, go); else go(); } }, label("Nová")),
    loadSel,
    h("button", { class: "px", title: "Stáhnout mapu jako soubor JSON", onclick: exportJson }, label("Export JSON")),
    h("button", { class: "px", title: "Načíst mapu ze souboru JSON (jako novou)", onclick: () => fileIn.click() }, label("Import")),
    fileIn,
    s.list.some((x) => x.id === m.id) ? h("button", { class: "px", title: "Smazat tuto mapu ze serveru (jen autor)", onclick: () => confirmDialog({ title: "Smazat mapu", text: `Smazat mapu „${m.name}“ ze serveru?`, ok: "Smazat", danger: true }, () => netRef?.send({ type: "deleteMap", id: m.id })) }, "🗑") : null,
    h("span", { class: "spacer" }),
    h("button", { class: "px", title: "Zpět (Ctrl+Z)", disabled: !s.undo.length, onclick: undo }, "↶"),
    h("button", { class: "px", title: "Znovu (Ctrl+Y)", disabled: !s.redo.length, onclick: redo }, "↷"),
    h("button", { class: "px", title: "Zobrazit celou mapu", onclick: fitView }, "⤢"),
    h("button", { class: "px", onclick: () => { const go = () => { closeEditor(); onExit?.(); }; if (s.dirty) confirmDialog({ title: "Neuložené změny", text: "Opustit editor bez uložení?", ok: "Opustit", danger: true }, go); else go(); } }, label("Zpět do menu")),
  );

  root.append(h("div", { class: "screen editor" }, top, h("div", { class: "ed-mid" }, left, canvas, right), bottom));
  requestAnimationFrame(() => {
    resizeCanvas();
    requestDraw();
  });
}

function polygonCentroidOf() {
  const m = st!.map;
  return m.outline ? polygonCentroid(m.outline) : { x: m.width / 2, y: m.height / 2 };
}

function save(asNew: boolean) {
  if (!st || !netRef) return;
  const m = st.map;
  if (asNew) {
    const fresh = newCustomMap(m.name, authorName);
    m.id = fresh.id;
    m.author = authorName;
    if (!/\(kopie\)$/.test(m.name)) m.name = `${m.name} (kopie)`.slice(0, CUSTOM_MAP_LIMITS.nameLen);
  }
  if (!m.author) m.author = authorName;
  st.status = "Ukládám…";
  renderEditor();
  netRef.send({ type: "saveMap", map: m });
}

function exportJson() {
  if (!st) return;
  const blob = new Blob([JSON.stringify(st.map, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${st.map.name.replace(/[^\wáčďéěíňóřšťúůýž -]/gi, "_") || "mapa"}.wingfighter-map.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Náhodně doplní asteroidy do volných míst. */
function fillAsteroids(count: number) {
  if (!st) return;
  const m = st.map;
  const b = box();
  pushUndo();
  let guard = 0;
  let added = 0;
  while (added < count && guard < 3000 && m.asteroids.length < CUSTOM_MAP_LIMITS.maxAsteroids) {
    guard++;
    const x = Math.round(Math.random() * m.width);
    const y = Math.round(Math.random() * m.height);
    const r = 24 + Math.floor(Math.random() * (Math.random() < 0.2 ? 70 : 40));
    if (!insideMap(b, { x, y }, r + 160)) continue;
    if (pointInStorm(m.storms, { x, y }, r)) continue;
    if (m.asteroids.some((a) => Math.hypot(a.x - x, a.y - y) < a.radius + r + 50)) continue;
    if (m.starts.some((s) => Math.hypot(s.x - x, s.y - y) < r + 140)) continue;
    if (m.stations.some((s) => Math.hypot(s.x - x, s.y - y) < r + 260)) continue;
    m.asteroids.push({ x, y, radius: r, seed: Math.floor(Math.random() * 1e6) });
    added++;
  }
  renderEditor();
}

/* ---------- plátno: vstup ---------- */

function bindPointer(c: HTMLCanvasElement) {
  let drag: null | { kind: string; i?: number; j?: number; start: { x: number; y: number }; orig?: unknown; moved: boolean; last: { x: number; y: number } } = null;
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; mx: number; my: number } | null = null;
  let lastTap = 0;

  c.addEventListener("contextmenu", (e) => e.preventDefault());
  c.addEventListener(
    "wheel",
    (e) => {
      if (!st) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const z = Math.max(0.05, Math.min(2, st.cam.zoom * f));
      st.cam.x = st.cam.x + sx / st.cam.zoom - sx / z;
      st.cam.y = st.cam.y + sy / st.cam.zoom - sy / z;
      st.cam.zoom = z;
      requestDraw();
    },
    { passive: false },
  );

  c.addEventListener("pointerdown", (e) => {
    if (!st) return;
    c.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null;
      return;
    }
    if (fingers.size > 1) return;
    const w = toWorld(e);
    const s = st;
    const m = s.map;
    const now = performance.now();
    const dbl = now - lastTap < 350;
    lastTap = now;
    // pravé / prostřední tlačítko = posun
    if (e.button === 1 || e.button === 2) {
      drag = { kind: "pan", start: w, moved: false, last: { x: e.clientX, y: e.clientY } };
      return;
    }
    const hit = hitTest(w);
    const tool = s.tool;
    if (tool === "comet") {
      if (s.lane) {
        const lastP = s.lane[s.lane.length - 1];
        if (Math.hypot(lastP.x - w.x, lastP.y - w.y) > 20 / s.cam.zoom) s.lane.push({ x: snapV(w.x), y: snapV(w.y) });
        if (dbl) {
          finishLane();
          return;
        }
        requestDraw();
        return;
      }
      if (hit?.kind === "lane") {
        s.sel = hit;
        drag = { kind: hit.j !== undefined ? "lanePt" : "lane", i: hit.i, j: hit.j, start: w, moved: false, last: w, orig: JSON.stringify(m.cometLanes[hit.i].points) };
        renderEditor();
        return;
      }
      if (m.cometLanes.length >= CUSTOM_MAP_LIMITS.maxLanes) return;
      s.lane = [{ x: snapV(w.x), y: snapV(w.y) }];
      s.sel = null;
      renderEditor();
      return;
    }
    if (tool === "outline" && s.outlineMode === "freehand") {
      s.stroke = [{ x: w.x, y: w.y }];
      drag = { kind: "freehand", start: w, moved: false, last: w };
      requestDraw();
      return;
    }
    if (tool === "outline") {
      if (!m.outline) {
        pushUndo();
        m.outline = ellipsePoly(m.width, m.height);
      }
      if (hit?.kind === "vertex") {
        if (dbl) {
          if (m.outline.length > 3) {
            pushUndo();
            m.outline.splice(hit.i, 1);
            s.sel = null;
            renderEditor();
          }
          return;
        }
        s.sel = hit;
        drag = { kind: "vertex", i: hit.i, start: w, moved: false, last: w };
        pushUndo();
        requestDraw();
        return;
      }
      // klik blízko hrany = nový bod
      const near = nearestOnPolygon(m.outline, w);
      if (near.dist <= 20 / s.cam.zoom && m.outline.length < CUSTOM_MAP_LIMITS.maxOutline) {
        pushUndo();
        m.outline.splice(near.edge + 1, 0, { x: snapV(w.x), y: snapV(w.y) });
        s.sel = { kind: "vertex", i: near.edge + 1 };
        drag = { kind: "vertex", i: near.edge + 1, start: w, moved: false, last: w };
        requestDraw();
        return;
      }
      drag = { kind: "pan", start: w, moved: false, last: { x: e.clientX, y: e.clientY } };
      return;
    }
    if (tool === "storm") {
      pushUndo();
      if (s.erase) {
        eraseStorm(w);
        drag = { kind: "erase", start: w, moved: false, last: w };
      } else {
        m.storms.push({ id: `storm${m.storms.length + 1}`, blobs: [{ x: snapV(w.x), y: snapV(w.y), r: s.brush }] });
        drag = { kind: "paint", i: m.storms.length - 1, start: w, moved: false, last: w };
      }
      requestDraw();
      return;
    }
    if (tool === "zone") {
      if (hit?.kind === "zone") {
        s.sel = hit;
        drag = { kind: "zone", i: hit.i, start: w, moved: false, last: w, orig: { ...m.zones[hit.i] } };
        pushUndo();
        renderEditor();
        return;
      }
      if (m.zones.length >= CUSTOM_MAP_LIMITS.maxZones) return;
      pushUndo();
      m.zones.push({ team: s.team ?? 0, x: snapV(w.x), y: snapV(w.y), w: 60, h: 60 });
      s.sel = { kind: "zone", i: m.zones.length - 1 };
      drag = { kind: "zoneNew", i: m.zones.length - 1, start: { x: snapV(w.x), y: snapV(w.y) }, moved: false, last: w };
      requestDraw();
      return;
    }
    // objekty: existující = výběr + přesun / kurz; prázdno = nový podle nástroje
    if (hit && hit.kind !== "vertex" && (tool === "select" || hit.kind === toolKind(tool))) {
      s.sel = hit;
      if (hit.kind === "start" && tool === "start" && Math.hypot(m.starts[hit.i].x - w.x, m.starts[hit.i].y - w.y) > 10 * Math.max(1, 0.9 / s.cam.zoom)) {
        drag = { kind: "heading", i: hit.i, start: w, moved: false, last: w };
      } else drag = { kind: "move", i: hit.i, j: hit.j, start: w, moved: false, last: w, orig: JSON.stringify(objOf(hit)) };
      pushUndo();
      renderEditor();
      return;
    }
    if (tool === "asteroid") {
      if (m.asteroids.length >= CUSTOM_MAP_LIMITS.maxAsteroids) return;
      pushUndo();
      m.asteroids.push({ x: snapV(w.x), y: snapV(w.y), radius: s.astSize, seed: Math.floor(Math.random() * 1e6) });
      s.sel = { kind: "asteroid", i: m.asteroids.length - 1 };
      drag = { kind: "move", i: m.asteroids.length - 1, start: w, moved: false, last: w };
      renderEditor();
      return;
    }
    if (tool === "start") {
      if (m.starts.length >= CUSTOM_MAP_LIMITS.maxStarts) return;
      pushUndo();
      const c0 = polygonCentroidOf();
      const stNew: CustomMap["starts"][number] = { x: snapV(w.x), y: snapV(w.y), heading: Math.atan2(c0.y - w.y, c0.x - w.x) };
      if (s.team !== null) stNew.team = s.team;
      m.starts.push(stNew);
      s.sel = { kind: "start", i: m.starts.length - 1 };
      drag = { kind: "headingNew", i: m.starts.length - 1, start: w, moved: false, last: w };
      renderEditor();
      return;
    }
    if (tool === "station") {
      if (m.stations.length >= CUSTOM_MAP_LIMITS.maxStations) return;
      pushUndo();
      m.stations.push({ x: snapV(w.x), y: snapV(w.y) });
      s.sel = { kind: "station", i: m.stations.length - 1 };
      drag = { kind: "move", i: m.stations.length - 1, start: w, moved: false, last: w };
      renderEditor();
      return;
    }
    // výběr na prázdnu = zrušit výběr, tažení = posun
    s.sel = null;
    drag = { kind: "pan", start: w, moved: false, last: { x: e.clientX, y: e.clientY } };
    renderEditor();
  });

  c.addEventListener("pointermove", (e) => {
    if (!st) return;
    const f = fingers.get(e.pointerId);
    if (f) {
      f.x = e.clientX;
      f.y = e.clientY;
    }
    if (pinch && fingers.size >= 2) {
      const [a, b] = [...fingers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const r = c.getBoundingClientRect();
      const z = Math.max(0.05, Math.min(2, (st.cam.zoom * d) / (pinch.d || 1)));
      const sx = mx - r.left;
      const sy = my - r.top;
      st.cam.x = st.cam.x + sx / st.cam.zoom - sx / z - (mx - pinch.mx) / z;
      st.cam.y = st.cam.y + sy / st.cam.zoom - sy / z - (my - pinch.my) / z;
      st.cam.zoom = z;
      pinch = { d, mx, my };
      requestDraw();
      return;
    }
    if (!drag) {
      // náhled štětce / kurzoru
      st.status = st.status;
      return;
    }
    const w = toWorld(e);
    const s = st;
    const m = s.map;
    if (Math.hypot(w.x - drag.start.x, w.y - drag.start.y) * s.cam.zoom > 3) drag.moved = true;
    switch (drag.kind) {
      case "pan": {
        s.cam.x -= (e.clientX - drag.last.x) / s.cam.zoom;
        s.cam.y -= (e.clientY - drag.last.y) / s.cam.zoom;
        drag.last = { x: e.clientX, y: e.clientY };
        break;
      }
      case "vertex": {
        m.outline![drag.i!] = { x: snapV(w.x), y: snapV(w.y) };
        break;
      }
      case "freehand": {
        const lastP = s.stroke![s.stroke!.length - 1];
        if (Math.hypot(lastP.x - w.x, lastP.y - w.y) >= 6 / s.cam.zoom) s.stroke!.push({ x: w.x, y: w.y });
        break;
      }
      case "paint": {
        const stm = m.storms[drag.i!];
        const lastB = stm.blobs[stm.blobs.length - 1];
        if (Math.hypot(lastB.x - w.x, lastB.y - w.y) >= s.brush * 0.45 && stm.blobs.length < 80) stm.blobs.push({ x: Math.round(w.x), y: Math.round(w.y), r: s.brush });
        break;
      }
      case "erase":
        eraseStorm(w);
        break;
      case "move": {
        const dx = w.x - drag.start.x;
        const dy = w.y - drag.start.y;
        const o = JSON.parse(drag.orig as string) as { x: number; y: number };
        const t = objOf(s.sel!) as { x: number; y: number };
        if (t) {
          t.x = snapV(o.x + dx);
          t.y = snapV(o.y + dy);
        }
        break;
      }
      case "heading":
      case "headingNew": {
        const stt = m.starts[drag.i!];
        if (Math.hypot(w.x - stt.x, w.y - stt.y) > 12) stt.heading = Math.atan2(w.y - stt.y, w.x - stt.x);
        break;
      }
      case "zoneNew": {
        const z = m.zones[drag.i!];
        const x2 = snapV(w.x);
        const y2 = snapV(w.y);
        z.x = Math.min(drag.start.x, x2);
        z.y = Math.min(drag.start.y, y2);
        z.w = Math.max(60, Math.abs(x2 - drag.start.x));
        z.h = Math.max(60, Math.abs(y2 - drag.start.y));
        break;
      }
      case "zone": {
        const o = drag.orig as { x: number; y: number };
        const z = m.zones[drag.i!];
        z.x = snapV(o.x + w.x - drag.start.x);
        z.y = snapV(o.y + w.y - drag.start.y);
        break;
      }
      case "lanePt": {
        m.cometLanes[drag.i!].points[drag.j!] = { x: snapV(w.x), y: snapV(w.y) };
        break;
      }
      case "lane": {
        const o = JSON.parse(drag.orig as string) as { x: number; y: number }[];
        m.cometLanes[drag.i!].points = o.map((p) => ({ x: snapV(p.x + w.x - drag!.start.x), y: snapV(p.y + w.y - drag!.start.y) }));
        break;
      }
    }
    requestDraw();
  });

  const up = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
    if (!st || !drag) return;
    const d = drag;
    drag = null;
    if (d.kind === "pan") return;
    if (d.kind === "freehand") {
      const stroke = st.stroke ?? [];
      st.stroke = null;
      if (stroke.length >= 8) {
        // vyhladit: zjednodušit podle zoomu, nejvýš limit bodů; pak plochu přizpůsobit
        let tol = 10 / st.cam.zoom;
        let pts = simplify(stroke, tol);
        while (pts.length > CUSTOM_MAP_LIMITS.maxOutline) {
          tol *= 1.5;
          pts = simplify(stroke, tol);
        }
        if (pts.length >= 3) {
          pushUndo();
          st.map.outline = pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
          normalizeBounds();
          st.sel = null;
          st.outlineMode = "points";
          st.status = `Obrys od ruky: ${pts.length} bodů, plocha ${st.map.width}×${st.map.height}`;
          renderEditor();
          fitView();
          return;
        }
      }
      renderEditor();
      return;
    }
    if (d.kind === "vertex" && d.moved) {
      // posun bodu obrysu: plocha se přizpůsobí (posun celé mapy, když bod vyjel ven)
      const before = `${st.map.width}x${st.map.height}`;
      normalizeBounds();
      if (before !== `${st.map.width}x${st.map.height}`) fitView();
    }
    // přesun bez pohybu u nástroje výběr = jen výběr (undo záznam zůstává, je neškodný)
    if ((d.kind === "lane" || d.kind === "lanePt" || d.kind === "move" || d.kind === "zone") && !d.moved) {
      // bez změny: vrátit undo záznam
      st.undo.pop();
    }
    if (d.kind === "vertex" && !d.moved) st.undo.pop();
    st.dirty = st.dirty || d.moved || d.kind === "paint" || d.kind === "erase" || d.kind === "headingNew" || d.kind === "zoneNew";
    renderEditor();
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);

  window.addEventListener("keydown", onKey);
}

function onKey(e: KeyboardEvent) {
  if (!st) {
    window.removeEventListener("keydown", onKey);
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if ((e.key === "Delete" || e.key === "Backspace") && st.sel) {
    deleteSel();
    e.preventDefault();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    if (e.shiftKey) redo();
    else undo();
    e.preventDefault();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    redo();
    e.preventDefault();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    save(false);
    e.preventDefault();
  } else if (e.key === "Enter" && st.lane) finishLane();
  else if (e.key === "Escape") {
    if (st.lane) st.lane = null;
    else st.sel = null;
    renderEditor();
  }
}

function finishLane() {
  if (!st || !st.lane) return;
  if (st.lane.length >= 2) {
    pushUndo();
    const id = `lane${st.map.cometLanes.length + 1}`;
    st.map.cometLanes.push({ id, points: st.lane, every: 4, first: 2, speed: "normal", size: "medium" });
    st.sel = { kind: "lane", i: st.map.cometLanes.length - 1 };
  }
  st.lane = null;
  renderEditor();
}

function toolKind(t: Tool): Sel extends infer S ? (S extends { kind: infer K } ? K : never) : never {
  return (t === "asteroid" ? "asteroid" : t === "start" ? "start" : t === "station" ? "station" : t === "zone" ? "zone" : t === "comet" ? "lane" : "blob") as never;
}
function objOf(s: NonNullable<Sel>): unknown {
  const m = st!.map;
  return s.kind === "asteroid" ? m.asteroids[s.i] : s.kind === "start" ? m.starts[s.i] : s.kind === "station" ? m.stations[s.i] : s.kind === "zone" ? m.zones[s.i] : s.kind === "blob" ? m.storms[s.i].blobs[s.j!] : s.kind === "vertex" ? m.outline![s.i] : null;
}
function eraseStorm(w: { x: number; y: number }) {
  const m = st!.map;
  for (const stm of m.storms) stm.blobs = stm.blobs.filter((b) => Math.hypot(b.x - w.x, b.y - w.y) > Math.max(b.r * 0.5, st!.brush * 0.5));
  m.storms = m.storms.filter((x) => x.blobs.length);
}

/* ---------- plátno: kreslení ---------- */

function resizeCanvas() {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const hh = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
  }
}
function requestDraw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}
const profileCache = new Map<string, number[]>();
function asteroidPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number) {
  const key = `${r}:${seed}`;
  let prof = profileCache.get(key);
  if (!prof) profileCache.set(key, (prof = generateProfile(r, seed)));
  ctx.beginPath();
  for (let i = 0; i < ASTEROID_SEGMENTS; i++) {
    const a = (i / ASTEROID_SEGMENTS) * Math.PI * 2;
    const rr = prof[i];
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function draw() {
  if (!st || !canvas) return;
  resizeCanvas();
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const s = st;
  const m = s.map;
  const b = box();
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#04060d";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.scale(s.cam.zoom, s.cam.zoom);
  ctx.translate(-s.cam.x, -s.cam.y);
  const k = 1 / s.cam.zoom; // tloušťka čar nezávislá na zoomu
  // mřížka uvnitř
  ctx.save();
  ctx.beginPath();
  traceMap(ctx, b);
  ctx.clip();
  ctx.fillStyle = "#070b16";
  ctx.fillRect(-m.width, -m.height, m.width * 3, m.height * 3);
  ctx.strokeStyle = "rgba(148,163,184,0.09)";
  ctx.lineWidth = k;
  const step = MOVE_UNIT * (s.cam.zoom < 0.15 ? 8 : s.cam.zoom < 0.4 ? 4 : 1);
  ctx.beginPath();
  for (let x = 0; x <= m.width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, m.height);
  }
  for (let y = 0; y <= m.height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(m.width, y);
  }
  ctx.stroke();
  ctx.restore();
  // zóny
  for (let i = 0; i < m.zones.length; i++) {
    const z = m.zones[i];
    ctx.fillStyle = TEAM_COLORS[z.team] + "22";
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = TEAM_COLORS[z.team];
    ctx.lineWidth = (s.sel?.kind === "zone" && s.sel.i === i ? 3 : 1.5) * k;
    ctx.setLineDash([8 * k, 6 * k]);
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);
    ctx.fillStyle = TEAM_COLORS[z.team];
    ctx.font = `${12 * k}px system-ui`;
    ctx.fillText(`zóna ${TEAM_NAMES[z.team].toLowerCase()}`, z.x + 4 * k, z.y - 4 * k);
  }
  // bouře
  for (let i = 0; i < m.storms.length; i++) {
    for (let j = 0; j < m.storms[i].blobs.length; j++) {
      const bl = m.storms[i].blobs[j];
      const g = ctx.createRadialGradient(bl.x, bl.y, 1, bl.x, bl.y, bl.r);
      g.addColorStop(0, "rgba(168,85,247,0.45)");
      g.addColorStop(1, "rgba(236,72,153,0.06)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.sel?.kind === "blob" && s.sel.i === i && s.sel.j === j) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2 * k;
        ctx.stroke();
      }
    }
  }
  // stanice
  for (let i = 0; i < m.stations.length; i++) {
    const p = m.stations[i];
    ctx.save();
    ctx.strokeStyle = "rgba(165,243,252,0.35)";
    ctx.setLineDash([6 * k, 6 * k]);
    ctx.lineWidth = k;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 60 + 170, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = s.sel?.kind === "station" && s.sel.i === i ? "#fbbf24" : "#a5f3fc";
    ctx.lineWidth = 4 * k;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 50, p.y);
    ctx.lineTo(p.x + 50, p.y);
    ctx.moveTo(p.x, p.y - 50);
    ctx.lineTo(p.x, p.y + 50);
    ctx.stroke();
    ctx.restore();
  }
  // asteroidy
  for (let i = 0; i < m.asteroids.length; i++) {
    const a = m.asteroids[i];
    const inside = insideMap(b, a, a.radius * 0.5);
    asteroidPath(ctx, a.x, a.y, a.radius, a.seed);
    ctx.fillStyle = inside ? "#8a7f6a" : "rgba(138,127,106,0.35)";
    ctx.fill();
    ctx.strokeStyle = inside ? "#5b5347" : "#ef4444";
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
    if (s.sel?.kind === "asteroid" && s.sel.i === i) {
      ctx.strokeStyle = "#fbbf24";
      ctx.setLineDash([6 * k, 4 * k]);
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // dráhy komet
  const drawLane = (pts: { x: number; y: number }[], sel: boolean, lbl?: string) => {
    if (pts.length < 1) return;
    ctx.save();
    ctx.strokeStyle = sel ? "#fdba74" : "#fb923c";
    ctx.lineWidth = (sel ? 3 : 2) * k;
    ctx.setLineDash([12 * k, 8 * k]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fb923c";
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (sel ? 7 : 5) * k, 0, Math.PI * 2);
      ctx.fill();
    }
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const z = pts[pts.length - 1];
      const ang = Math.atan2(z.y - a.y, z.x - a.x);
      ctx.translate(z.x, z.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(14 * k, 0);
      ctx.lineTo(-6 * k, -8 * k);
      ctx.lineTo(-6 * k, 8 * k);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang);
      ctx.translate(-z.x, -z.y);
    }
    if (lbl) {
      ctx.font = `${12 * k}px system-ui`;
      ctx.fillText(lbl, pts[0].x + 10 * k, pts[0].y - 10 * k);
    }
    ctx.restore();
  };
  for (let i = 0; i < m.cometLanes.length; i++) {
    const l = m.cometLanes[i];
    drawLane(l.points, s.sel?.kind === "lane" && s.sel.i === i, `☄ ${l.id} · každých ${l.every} kol od ${l.first}.`);
  }
  if (s.lane) drawLane(s.lane, true, "kreslím…");
  // starty
  for (let i = 0; i < m.starts.length; i++) {
    const p = m.starts[i];
    const col = p.team === undefined ? "#e2e8f0" : TEAM_COLORS[p.team];
    const sel = s.sel?.kind === "start" && s.sel.i === i;
    const ms = Math.max(1, k * 0.9); // značka startu čitelná i při oddálení
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.heading);
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(16 * ms, 0);
    ctx.lineTo(60 * ms, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(18 * ms, 0);
    ctx.lineTo(-12 * ms, -12 * ms);
    ctx.lineTo(-6 * ms, 0);
    ctx.lineTo(-12 * ms, 12 * ms);
    ctx.closePath();
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = "#fbbf24";
      ctx.setLineDash([5 * k, 4 * k]);
      ctx.beginPath();
      ctx.arc(0, 0, 26 * ms, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (p.team === undefined) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `${11 * k}px system-ui`;
      ctx.fillText("kdokoliv", p.x + 20 * k, p.y + 4 * k);
    }
  }
  // obrys + okrajová bouře
  ctx.save();
  ctx.strokeStyle = "rgba(192,132,252,0.9)";
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  traceMap(ctx, b);
  ctx.stroke();
  ctx.strokeStyle = "rgba(239,68,68,0.7)";
  ctx.beginPath();
  traceMap(ctx, b, 160);
  ctx.stroke();
  ctx.restore();
  if (s.stroke && s.stroke.length > 1) {
    ctx.save();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(s.stroke[0].x, s.stroke[0].y);
    for (let i = 1; i < s.stroke.length; i++) ctx.lineTo(s.stroke[i].x, s.stroke[i].y);
    ctx.stroke();
    ctx.restore();
  }
  if (s.tool === "outline" && m.outline) {
    for (let i = 0; i < m.outline.length; i++) {
      const p = m.outline[i];
      ctx.fillStyle = s.sel?.kind === "vertex" && s.sel.i === i ? "#fbbf24" : "#f8fafc";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // ukazatel štětce
  ctx.restore();
  // měřítko
  ctx.fillStyle = "rgba(226,232,240,0.6)";
  ctx.font = "11px system-ui";
  ctx.fillText(`zoom ${(s.cam.zoom * 100).toFixed(0)} % · kolečko = zoom · pravé tlačítko / tažení prázdna = posun`, 8, H - 8);
}

export type { CometLane };
