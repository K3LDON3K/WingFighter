/**
 * Vysvětlivky v pixel-art stylu místo nativních bublin prohlížeče.
 * Funguje pro atribut `title` (přesune se do data-tip) i pro <title> uvnitř SVG.
 * Myš: najetí; dotyk: podržení ~0,45 s (zmizí dalším dotykem).
 */
let tipEl: HTMLElement | null = null;
let current: Element | null = null;
let pressTimer = 0;

function ensureEl(): HTMLElement {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "ptip";
    tipEl.style.display = "none";
    document.body.append(tipEl);
  }
  return tipEl;
}

/** Najde nejbližší prvek s vysvětlivkou a vrátí její text (title se přesune do data-tip, aby nativní bublina nevyskočila). */
function tipFor(target: Element | null): { el: Element; text: string; html?: string } | null {
  let el: Element | null = target;
  while (el && el !== document.body) {
    const ds = (el as HTMLElement).dataset;
    if (ds?.tiphtml) return { el, text: "", html: ds.tiphtml };
    if (ds?.tip) return { el, text: ds.tip };
    const t = el.getAttribute("title");
    if (t) {
      el.removeAttribute("title");
      if (ds) ds.tip = t;
      return { el, text: t };
    }
    // SVG: přímý potomek <title>
    for (const c of el.children) {
      if (c.tagName.toLowerCase() === "title" && c.textContent) {
        const text = c.textContent;
        c.remove();
        if (ds) ds.tip = text;
        return { el, text };
      }
    }
    el = el.parentElement;
  }
  return null;
}

function show(el: Element, text: string, x: number, y: number, html?: string) {
  if (document.body.classList.contains("drag-on")) return; // během přetahování modulu bez vysvětlivek
  const t = ensureEl();
  current = el;
  t.textContent = "";
  if (html) {
    t.innerHTML = html;
    t.style.display = "block";
    place(x, y);
    return;
  }
  const lines = text.split("\n");
  lines.forEach((ln, i) => {
    const d = document.createElement("div");
    d.textContent = ln;
    if (i === 0 && lines.length > 1) d.className = "ptip-h";
    if (/^Nelze:/.test(ln)) d.className = "ptip-warn";
    t.append(d);
  });
  t.style.display = "block";
  place(x, y);
}

function place(x: number, y: number) {
  const t = ensureEl();
  const w = t.offsetWidth;
  const hgt = t.offsetHeight;
  let left = x + 14;
  let top = y + 18;
  if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 14);
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, y - hgt - 12);
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

export function hideTip() {
  if (tipEl) tipEl.style.display = "none";
  current = null;
}

export function initTooltips() {
  document.addEventListener("mouseover", (e) => {
    if ((e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
    const hit = tipFor(e.target as Element);
    if (!hit) {
      if (current) hideTip();
      return;
    }
    if (hit.el !== current) show(hit.el, hit.text, e.clientX, e.clientY, hit.html);
  });
  document.addEventListener("mousemove", (e) => {
    if (current && tipEl?.style.display === "block") place(e.clientX, e.clientY);
  });
  document.addEventListener("mouseout", (e) => {
    if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hideTip();
  });
  document.addEventListener("mousedown", () => hideTip(), true);
  // dotyk: podržení ukáže vysvětlivku, další dotyk ji schová
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return;
      hideTip();
      clearTimeout(pressTimer);
      const hit = tipFor(e.target as Element);
      if (!hit) return;
      const { clientX, clientY } = e;
      pressTimer = window.setTimeout(() => show(hit.el, hit.text, clientX, clientY, hit.html), 450);
    },
    true,
  );
  document.addEventListener("pointerup", () => clearTimeout(pressTimer), true);
  document.addEventListener("pointercancel", () => clearTimeout(pressTimer), true);
  window.addEventListener("scroll", () => hideTip(), true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });
}

/* ---------- strukturovaná vysvětlivka akce (varianta B): název + cena vpravo, štítky efektů, poznámka ---------- */
import { ICONS } from "./icons.ts";

export interface TipSpec {
  icon: string;
  iconColor?: string;
  title: string;
  cost?: { actions?: number; stress?: number; tech?: number };
  /** Štítky: ikona, text, ladění (good = zelený rámeček, bad = červený). */
  fx: { icon: string; text: string; tone?: "good" | "bad" }[];
  note?: string;
  /** Důvod, proč akce nejde (červeně). */
  warn?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function iconSvg(name: string, color: string, size: number): string {
  const rows = ICONS[name] ?? ICONS.target;
  const rects = rows.map((r, y) => [...r].map((c, x) => (c === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "")).join("")).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 8 8" shape-rendering="crispEdges" fill="${color}">${rects}</svg>`;
}
function pips(n: number, cls: string): string {
  return n > 0 ? `<span class="tp-pips ${cls}">${"<i></i>".repeat(n)}</span>` : "";
}

/** HTML vysvětlivky pro `data-tiphtml`. */
export function tipHtml(t: TipSpec): string {
  const c = t.cost ?? {};
  const costHtml = `${pips(c.actions ?? 0, "r")}${(c.stress ?? 0) > 0 ? pips(c.stress!, "p") : (c.stress ?? 0) < 0 ? `<span class="tp-pips p plus"><i>+</i></span>` : ""}${pips(c.tech ?? 0, "y")}`;
  const free = !(c.actions || c.stress || c.tech);
  const head = `<div class="tp-h"><span class="tp-name">${iconSvg(t.icon, t.iconColor ?? "#fbbf24", 14)}${esc(t.title)}</span><span class="tp-cost">${free && t.cost ? '<span class="tp-free">zdarma</span>' : costHtml}</span></div>`;
  const chips = t.fx.length ? `<div class="tp-chips">${t.fx.map((f) => `<span class="tp-chip ${f.tone ?? ""}">${iconSvg(f.icon, f.tone === "good" ? "#86efac" : f.tone === "bad" ? "#fca5a5" : "#cbd5e1", 12)}${esc(f.text)}</span>`).join("")}</div>` : "";
  const note = t.note ? `<div class="tp-note">${esc(t.note)}</div>` : "";
  const warn = t.warn ? `<div class="tp-warn">${esc(t.warn)}</div>` : "";
  return head + chips + note + warn;
}

/** Atributy pro h(): data-tiphtml s hotovým HTML. */
export function tipAttr(t: TipSpec): { dataset: { tiphtml: string } } {
  return { dataset: { tiphtml: tipHtml(t) } };
}
