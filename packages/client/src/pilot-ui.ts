import { PILOTS, type PilotDef } from "@wingfighter/shared";
import { h } from "./dom.ts";
import { label } from "./icons.ts";

/** Pixelové podobizny pilotů (16 × 16). */
const PORTRAITS: Record<string, { rows: string[]; pal: Record<string, string> }> = {
  kadet: {
    pal: { h: "#2b1d0e", s: "#e8b58a", e: "#1e293b", w: "#f8fafc", m: "#b45309", u: "#1d4ed8", c: "#60a5fa", b: "#0b1020", g: "#fbbf24" },
    rows: [
      "....hhhhhhhh....",
      "...hhhhhhhhhh...",
      "..hhhhhhhhhhhh..",
      "..hhsssssssshh..",
      "..hsssssssssssh.",
      "..hsswsssswsss..",
      "..hssessssesss..",
      "..ssssssssssss..",
      "..sssssmmsssss..",
      "...ssssssssss...",
      "....ssssssss....",
      ".....uuuuuu.....",
      "...uuuuccuuuu...",
      "..uuuuuccuuuuu..",
      "..uuuugcccguuu..",
      "..uuuuuuuuuuuu..",
    ],
  },
};

// další piloti: stejná šablona, jiné vlasy / barvy / doplňky
PORTRAITS.eso = {
  pal: { h: "#111827", s: "#d9a57c", e: "#0ea5e9", w: "#f8fafc", m: "#9a3412", u: "#b91c1c", c: "#fca5a5", b: "#0b1020", g: "#fde047", v: "#0ea5e9" },
  rows: [
    "....hhhhhhhh....",
    "...hhhhhhhhhh...",
    "..hhhhhhhhhhhh..",
    "..hhvvvvvvvvhh..",
    "..hvvvvvvvvvvvh.",
    "..hsswsssswsss..",
    "..hssessssesss..",
    "..ssssssssssss..",
    "..sssssmmsssss..",
    "...ssssssssss...",
    "....ssssssss....",
    ".....uuuuuu.....",
    "...uuuuccuuuu...",
    "..uuuuuccuuuuu..",
    "..uuuugcccguuu..",
    "..uuuuuuuuuuuu..",
  ],
};
PORTRAITS.strelec = {
  pal: { h: "#7c2d12", s: "#e8b58a", e: "#1e293b", w: "#f8fafc", m: "#b45309", u: "#166534", c: "#86efac", b: "#0b1020", g: "#fbbf24", k: "#334155" },
  rows: [
    "....hhhhhhhh....",
    "...hhhhhhhhhh...",
    "..hhhhhhhhhhhh..",
    "..hhsssssssshh..",
    "..hsssssssssssh.",
    "..hsswssskkkss..",
    "..hssesssskess..",
    "..ssssssssssss..",
    "..sssssmmsssss..",
    "...sssmmmmsss...",
    "....ssssssss....",
    ".....uuuuuu.....",
    "...uuuuccuuuu...",
    "..uuuuuccuuuuu..",
    "..uuuugcccguuu..",
    "..uuuuuuuuuuuu..",
  ],
};
PORTRAITS.kapitan = {
  pal: { h: "#9ca3af", s: "#e8b58a", e: "#1e293b", w: "#f8fafc", m: "#9ca3af", u: "#1e3a8a", c: "#fbbf24", b: "#0b1020", g: "#fbbf24", t: "#1e3a8a" },
  rows: [
    "...tttttttttt...",
    "..tttttttttttt..",
    "..ttttggggtttt..",
    "..hhsssssssshh..",
    "..hsssssssssssh.",
    "..hsswsssswsss..",
    "..hssessssesss..",
    "..ssssssssssss..",
    "..ssmmmmmmmmss..",
    "...ssmmmmmmss...",
    "....ssssssss....",
    ".....uuuuuu.....",
    "...uuuuccuuuu...",
    "..uuuuuccuuuuu..",
    "..uuuugcccguuu..",
    "..uuuuuuuuuuuu..",
  ],
};
/** Neznámý (editovaný) pilot: podobizna Kadeta s barvou vlasů a uniformy podle id. */
function portraitFor(pilotId: string) {
  if (PORTRAITS[pilotId]) return PORTRAITS[pilotId];
  let hsh = 0;
  for (const ch of pilotId) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const hairs = ["#2b1d0e", "#111827", "#7c2d12", "#9ca3af", "#fde047", "#dc2626"];
  const unis = ["#1d4ed8", "#b91c1c", "#166534", "#7c3aed", "#0f766e", "#a16207"];
  const base = PORTRAITS.kadet;
  return { rows: base.rows, pal: { ...base.pal, h: hairs[hsh % hairs.length], u: unis[(hsh >> 3) % unis.length] } };
}

export function pilotPortrait(pilotId: string, size = 32): SVGSVGElement {
  const p = portraitFor(pilotId);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", "16");
  bg.setAttribute("height", "16");
  bg.setAttribute("fill", "#0b1020");
  svg.append(bg);
  p.rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const col = p.pal[c];
      if (!col) return;
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", "1");
      r.setAttribute("height", "1");
      r.setAttribute("fill", col);
      svg.append(r);
    }),
  );
  return svg;
}

let bubble: HTMLElement | null = null;

/** Pixelová bublina se schopnostmi pilota – zobrazí se nad prvkem. */
function showBubble(anchor: HTMLElement, pilot: PilotDef) {
  hideBubble();
  bubble = h(
    "div",
    { class: "pbubble" },
    h("div", { class: "pb-name" }, label(pilot.name)),
    h("div", { class: "pb-desc txt" }, pilot.description),
    h("div", { class: "pb-cap" }, label("Schopnosti")),
    pilot.abilities.length ? h("ul", { class: "pb-list txt" }, ...pilot.abilities.map((a) => h("li", {}, a))) : h("div", { class: "pb-none txt" }, "— žádné zvláštní schopnosti —"),
    h("i", { class: "pb-tail" }),
  );
  document.body.append(bubble);
  const r = anchor.getBoundingClientRect();
  const bw = bubble.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${r.top - bubble.offsetHeight - 10}px`;
  (bubble.querySelector(".pb-tail") as HTMLElement).style.left = `${r.left + r.width / 2 - left - 6}px`;
}
function hideBubble() {
  bubble?.remove();
  bubble = null;
}

/** Okénko s podobiznou a jménem pilota; najetí myší = bublina se schopnostmi. */
export function pilotBadge(pilotId: string, vertical = false): HTMLElement {
  const pilot = PILOTS[pilotId] ?? PILOTS.kadet;
  const el = h(
    "div",
    { class: `pilot-badge ${vertical ? "vertical" : ""}`, title: "" },
    h("div", { class: "pilot-frame" }, pilotPortrait(pilotId, vertical ? 58 : 28)),
    vertical ? h("div", { class: "spacer" }) : null,
    h("div", { class: "pilot-text" }, h("span", { class: "muted pilot-cap" }, label("pilot")), h("span", { class: "pilot-name" }, label(pilot.name))),
  );
  el.addEventListener("mouseenter", () => showBubble(el, pilot));
  el.addEventListener("mouseleave", hideBubble);
  return el;
}
