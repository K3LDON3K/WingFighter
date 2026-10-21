/** Nastavení zobrazení (jen tento počítač): rozlišení herní mapy. Výchozí 0.5 (čtvrtina pixelů, plynulé); 1 = nativní. */
import { h } from "./dom.ts";
import { icon, label } from "./icons.ts";

const KEY = "wingfighter.renderScale";
export const RENDER_SCALES: [number, string][] = [
  [1, "100 %"],
  [0.75, "75 %"],
  [0.5, "50 %"],
  [0.25, "25 %"],
];
let scale = 0.5;
try {
  const v = Number(localStorage.getItem(KEY));
  if (RENDER_SCALES.some(([s]) => s === v)) scale = v;
} catch {
  /* bez úložiště */
}
const listeners = new Set<() => void>();

export function renderScale(): number {
  return scale;
}
export function setRenderScale(v: number): void {
  scale = v;
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* ignorovat */
  }
  for (const l of listeners) l();
}
export function onRenderScaleChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Řádek s přepínačem rozlišení (do menu hry i do ladění). */
export function renderScaleRow(): HTMLElement {
  const row = h("div", { class: "rs-row" }, h("span", { class: "txt muted rs-lbl", title: "Nižší rozlišení = méně vykreslovaných pixelů, plynulejší hra na slabším počítači. Platí jen pro tento prohlížeč." }, "Rozlišení mapy"));
  for (const [v, txt] of RENDER_SCALES)
    row.append(
      h("button", { class: `px tiny ${scale === v ? "on" : ""}`, onclick: () => {
          setRenderScale(v);
          for (const b of row.querySelectorAll("button")) b.classList.toggle("on", Number(b.dataset.v) === v);
        }, dataset: { v: String(v) } }, txt),
    );
  return row;
}

/** Vzdálená paralaxní vrstva (galaxie, planety) – jen vizuální; jde vypnout (slabší počítač / rozptyluje). */
const PKEY = "wingfighter.parallax";
let parallax = true;
try {
  parallax = localStorage.getItem(PKEY) !== "0";
} catch {
  /* bez úložiště */
}
export function parallaxEnabled(): boolean {
  return parallax;
}
export function setParallaxEnabled(v: boolean): void {
  parallax = v;
  try {
    localStorage.setItem(PKEY, v ? "1" : "0");
  } catch {
    /* ignorovat */
  }
  for (const l of listeners) l();
}
/** Řádek s přepínačem paralaxní vrstvy. */
export function parallaxRow(): HTMLElement {
  const row = h("div", { class: "rs-row" }, h("span", { class: "txt muted rs-lbl", title: "Galaxie a planety hluboko za mapou, posouvají se pomaleji než mapa. Jen vizuální; vypnutí trochu ušetří výkon. Platí jen pro tento prohlížeč." }, "Vzdálené pozadí"));
  const mk = (v: boolean, txt: string) => h("button", { class: `px tiny ${parallax === v ? "on" : ""}`, onclick: () => {
      setParallaxEnabled(v);
      for (const b of row.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === String(v));
    }, dataset: { v: String(v) } }, txt);
  row.append(mk(true, "ZAPNUTO"), mk(false, "VYPNUTO"));
  return row;
}

/** Okno „Nastavení grafiky“ (hlavní menu): rozlišení mapy + vzdálené pozadí. */
export function openGraphicsPanel(): void {
  if (document.querySelector(".gfx-overlay")) return;
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  const overlay = h("div", { class: "mu-overlay gfx-overlay", onclick: (e: Event) => {
      if (e.target === overlay) close();
    } },
    h(
      "div",
      { class: "mu-body" },
      h(
        "div",
        { class: "pnl mu-card gfx-card" },
        h("div", { class: "bb-head" }, icon("eye", "#7dd3fc", 14), h("span", { class: "ttl" }, label("Nastavení grafiky")), h("span", { class: "muted txt", style: "font-size:13px;margin-left:8px" }, "platí jen pro tento prohlížeč"), h("span", { class: "spacer" }), h("button", { class: "px tiny", onclick: close }, "✕")),
        renderScaleRow(),
        h("div", { class: "muted txt", style: "font-size:13px" }, "Nižší rozlišení = méně vykreslovaných pixelů a plynulejší hra na slabším počítači (obraz je o něco hrubší)."),
        parallaxRow(),
        h("div", { class: "muted txt", style: "font-size:13px" }, "Galaxie, mlhoviny a planety hluboko za mapou (posouvají se pomaleji než mapa). Jen vizuální – na hru nemá vliv; motiv pozadí volí zakladatel v nastavení mapy."),
      ),
    ),
  );
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
}
