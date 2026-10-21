/** Nastavení zobrazení (jen tento počítač): rozlišení herní mapy. Výchozí 0.5 (čtvrtina pixelů, plynulé); 1 = nativní. */
import { h } from "./dom.ts";
import { label } from "./icons.ts";

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
