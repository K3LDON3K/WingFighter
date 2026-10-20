import { PILOTS, type PilotDef } from "@wingfighter/shared";
import { h } from "./dom.ts";
import { label } from "./icons.ts";

/** Pixelové podobizny pilotů (32 × 32): detail tváře, hrubé stínování, zamračený výraz – ve stylu stavové lišty. */
const PORTRAITS: Record<string, { rows: string[]; pal: Record<string, string> }> = {
  kadet: {
    pal: { A: "#c57d4a", B: "#9c5b32", C: "#dd9a63", D: "#f0bb87", E: "#6b3f22", F: "#3b2314", G: "#f1f5f9", H: "#cbd5e1", I: "#1e293b", J: "#5a3a1e", K: "#1f1209", L: "#4a1d13" },
    rows: [
      "................................",
      "................................",
      "................................",
      "............KJJKJJK.............",
      "..........JKJJKJJKJJK...........",
      ".........JKJJKJJKJJKJJ..........",
      "........JKJJKJJKJJKJJKJ.........",
      ".......JKJJKJJKJJKJJKJJK........",
      "......JKJJKJJKJJKJJKJJKJJ.......",
      "......KJJKJJKJJKJJKJJKJJK.......",
      "......CCDDDKJJKJJKJJCCABB.......",
      ".....ACCDDKKKDDDDDDDCKKKBE......",
      ".....ACCDDJJJKKDDDDKKJJJBE......",
      ".....ACCDDDDDDDDDDDDCCAABE......",
      ".....ACCDDGIIGDDDDDGIIGABE......",
      ".....ACCDDHIIHDDDDDHIIHABE......",
      "....BACCDEEEEEEEBDEEEEEEBEE.....",
      ".....AACCDDDDDDEBDDDCCAABE......",
      ".....BACCDDDDDDEBDDCCCABBE......",
      ".....BAACCDDDDDEBCACCAABEE......",
      "......BAACCDCDFEBEACAABBE.......",
      "......EBBCCCCCCEEAACAAEEF.......",
      ".......EBAACCCCCCCCAABEF........",
      ".......EEAAACCCCCAAABBFF........",
      "........EBAALLLLLLLLBEF.........",
      ".........BBBAEEEEEEBEE..........",
      ".........FEEEEBBEEEEFF..........",
      "..........FFEEEEEEFFF...........",
      "...........FFFFFFFFF............",
      ".............FFFFF..............",
      "................................",
      "................................",
    ],
  },
  eso: {
    pal: { A: "#c57d4a", B: "#9c5b32", C: "#dd9a63", D: "#f0bb87", E: "#6b3f22", F: "#3b2314", G: "#f1f5f9", H: "#cbd5e1", I: "#0ea5e9", J: "#111827", K: "#1f1209", L: "#4a1d13", M: "#38bdf8" },
    rows: [
      "................................",
      "................................",
      "................................",
      ".....IIIIIIIIIIIIIIIIIIIIII.....",
      ".....I....JJJJJJJJJJJ.....I.....",
      ".....I...JJJJJJJJJJJJJ....I.....",
      ".....I..JJJJJJJJJJJJJJJ...I.....",
      ".....I.JJJJJJJJJJJJJJJJJ..I.....",
      ".....IJJJJJJJJJJJJJJJJJJJ.I.....",
      ".....IACDDDDDDDDDDDCCAABE.I.....",
      ".....ICCDDDDDDDDDDDCCCABB.I.....",
      ".....ICCDDKKKDDDDDDDCKKKBEI.....",
      "...IMICCDDJJJDDDDDDDCJJJBEIMI...",
      "...IMICCDDDDDKKDDDDKKCAABEIMI...",
      "...IMICCDDGIIGDDDDDGIIGABEIMI...",
      "...IMICCDDHIIHDDDDDHIIHABEIMI...",
      "...IMICCDEEEEEEEBDEEEEEEBEIMI...",
      "...IMIACCDDDDDDEBDDDCCAABEIMI...",
      "...IMIACCDDDDDDEBDDCCCABBEIMI...",
      "...IMIAACCDDDDDEBCACCAABEEIMI...",
      "......BAACCDCDFEBEACAABBE.......",
      "......EBBCCCCCCEEAACAAEEF.......",
      ".......EBAACCCCCCCCAABEF........",
      ".......EEAAACCCCCAAABBFF........",
      "........EBAALLLLLLLLBEF.........",
      ".........BBBAEEEEEEBEE..........",
      ".........FEEEEBBEEEEFF..........",
      "..........FFEEEEEEFFF...........",
      "...........FFFFFFFFF............",
      ".............FFFFF..............",
      "................................",
      "................................",
    ],
  },
  strelec: {
    pal: { A: "#c57d4a", B: "#9c5b32", C: "#dd9a63", D: "#f0bb87", E: "#6b3f22", F: "#3b2314", G: "#f1f5f9", H: "#cbd5e1", I: "#1e293b", J: "#7c2d12", K: "#1f1209", L: "#4a1d13", M: "#0b1020", N: "#7f1d1d" },
    rows: [
      "................................",
      "................................",
      "................................",
      "............JBJBJBJ.............",
      "..........BJBJBJBJBJB...........",
      ".........BJBJBJBJBJBJB..........",
      "........BJBJBJBJBJBJBJB.........",
      ".......BJBJBJBJBJBJBJBJB........",
      ".......CCDDDDDDDDDCCAABB........",
      "......ACDDDDDDDDDDDCCAABE.......",
      "......CCDDDDDDDDDDDCCCABB.......",
      ".....ACCMMMMMMMMMMDDCKKKBE......",
      ".....AMMMMMMMMMMMMDDCJJJBE......",
      ".....ACCDDDDDKKDDDMMMMMMBE......",
      ".....ACCDDGIIGDDDDMMMMMMBE......",
      ".....ACCDDHIIHDDDDMMMMMMBE......",
      "....BACCDEEEEEEEBDMMMMMMBEE.....",
      ".....AACNDDDDDDEBDDDCCAABE......",
      ".....BACNDDDDDDEBDDCCCABBE......",
      ".....BAACNDDDDDEBCACCAABEE......",
      "......BAANCDCDFEBEACAABBE.......",
      "......EBBCNCCCCEEAACAAEEF.......",
      ".......EBAACCCCCCCCAABEF........",
      ".......EEAAACCCCCAAABBFF........",
      "........EBAALLLLLLLLBEF.........",
      ".........BBBAEEEEEEBEE..........",
      ".........FEEEEBBEEEEFF..........",
      "..........FFEEEEEEFFF...........",
      "...........FFFFFFFFF............",
      ".............FFFFF..............",
      "................................",
      "................................",
    ],
  },
  kapitan: {
    pal: { A: "#c57d4a", B: "#9c5b32", C: "#dd9a63", D: "#f0bb87", E: "#6b3f22", F: "#3b2314", G: "#f1f5f9", H: "#cbd5e1", I: "#1e293b", J: "#9ca3af", K: "#1f1209", L: "#4a1d13", M: "#1e3a8a", N: "#fbbf24", O: "#e5e7eb" },
    rows: [
      "................................",
      "................................",
      "............MMMMMMM.............",
      "..........MMMMMMMMMMM...........",
      "........MMMMMMMMMMMMMMM.........",
      ".......MMMMMMMMNNMMMMMMM........",
      "......MMMMMMMMMNNMMMMMMMM.......",
      "......MMMMMMMMMMMMMMMMMMM.......",
      "....NNNNNNNNNNNNNNNNNNNNNNNN....",
      "......KJJKJJKJJKJJKJJKJJK.......",
      "......CCDDDKJJKJJKJJCCABB.......",
      ".....ACCDDKKKDDDDDDDCKKKBE......",
      ".....ACCDDJJJKKDDDDKKJJJBE......",
      ".....ACCDDDDDDDDDDDDCCAABE......",
      ".....ACCDDGIIGDDDDDGIIGABE......",
      ".....ACCDDHIIHDDDDDHIIHABE......",
      "....BACCDEEEEEEEBDEEEEEEBEE.....",
      ".....AACCDDDDDDEBDDDCCAABE......",
      ".....BACCDDDDDDEBDDCCCABBE......",
      ".....BAACCDDDDDEBCACCAABEE......",
      "......BAACCDCDFEBEACAABBE.......",
      "......EBBCCCCCCEEAACAAEEF.......",
      ".......JJJJOJJJJOJJJJOJJ........",
      ".......JJOJJJJOJJJJOJJJJ........",
      "........JJJJLLLLLLLLJJO.........",
      ".........JOJAEEEEEEBOJ..........",
      ".........JJJJOJJJJOJJJ..........",
      "..........JOJJJJOJJJJ...........",
      "...........JJJOJJJJO............",
      ".............FFFFF..............",
      "................................",
      "................................",
    ],
  },
};
/** Neznámý (editovaný) pilot: podobizna Kadeta s barvou vlasů a uniformy podle id. */
function portraitFor(pilotId: string) {
  if (PORTRAITS[pilotId]) return PORTRAITS[pilotId];
  let hsh = 0;
  for (const ch of pilotId) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const hairs = ["#2b1d0e", "#111827", "#7c2d12", "#9ca3af", "#fde047", "#dc2626"];
  const unis = ["#1d4ed8", "#b91c1c", "#166534", "#7c3aed", "#0f766e", "#a16207"];
  const base = PORTRAITS.kadet;
  const pal = { ...base.pal };
  for (const k of Object.keys(pal)) if (pal[k] === "#5a3a1e") pal[k] = hairs[hsh % hairs.length];
  void unis;
  return { rows: base.rows, pal };
}

export function pilotPortrait(pilotId: string, size = 32): SVGSVGElement {
  const p = portraitFor(pilotId);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", "32");
  bg.setAttribute("height", "32");
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
