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
function tipFor(target: Element | null): { el: Element; text: string } | null {
  let el: Element | null = target;
  while (el && el !== document.body) {
    const ds = (el as HTMLElement).dataset;
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

function show(el: Element, text: string, x: number, y: number) {
  const t = ensureEl();
  current = el;
  t.textContent = "";
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
    if (hit.el !== current) show(hit.el, hit.text, e.clientX, e.clientY);
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
      pressTimer = window.setTimeout(() => show(hit.el, hit.text, clientX, clientY), 450);
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
