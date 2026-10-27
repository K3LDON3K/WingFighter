import { RULES, type Segments, type ShieldType } from "@wingfighter/shared";

/** Barvy štítů: podle síly (celolodní) a podle bodů segmentu. */
export const SHIELD_BLUE = "#3b82f6";
export const SHIELD_YELLOW = "#facc15";
export const SHIELD_RED = "#ef4444";
export const SHIELD_DARK = "#1e293b";
export const SHIELD_ORANGE = "#fb923c";
export const SEGMENT_NAMES = ["předek", "pravobok", "záď", "levobok"];

export function strengthColor(frac: number): string {
  return frac >= 0.66 ? SHIELD_BLUE : frac >= 0.33 ? SHIELD_YELLOW : SHIELD_RED;
}

export function segmentColor(hp: number): string {
  if (hp <= 0) return SHIELD_DARK;
  if (hp === 1) return SHIELD_RED;
  // 2 i 3 vrstvy modře – třetí vrstva se pozná podle tloušťky (žlutá vypadala jako poškození)
  return SHIELD_BLUE;
}

export interface BubbleShip {
  shieldType: ShieldType;
  shields: number;
  maxShields: number;
  shieldEff: number;
  segments: Segments;
}

const FIGHTER = ["..GG............", "..GPG...........", "..GPPG..........", "EEDPPPG.........", "..GPPPPGGG......", "...GPPPPPPGGGG..", "EEDDPWWPPPPPPPGG", "EEDDPWWPPPPPPPGG", "...GPPPPPPGGGG..", "..GPPPPGGG......", "EEDPPPG.........", "..GPPG..........", "..GPG...........", "..GG............"];
const NS = "http://www.w3.org/2000/svg";

function rect(x: number, y: number, w: number, h: number, fill: string, stroke?: string) {
  const r = document.createElementNS(NS, "rect");
  r.setAttribute("x", x.toFixed(1));
  r.setAttribute("y", y.toFixed(1));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("fill", fill);
  if (stroke) {
    r.setAttribute("stroke", stroke);
    r.setAttribute("stroke-width", "1.5");
  }
  return r;
}

function text(x: number, y: number, str: string, color: string, size = 13) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", x.toFixed(1));
  t.setAttribute("y", y.toFixed(1));
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("font-family", "Jersey, monospace");
  t.setAttribute("font-size", String(size));
  t.setAttribute("fill", color);
  t.setAttribute("stroke", "#05070f");
  t.setAttribute("stroke-width", "3");
  t.setAttribute("paint-order", "stroke");
  t.textContent = str;
  return t;
}

/**
 * Pixelová bublina štítu kolem lodi (loď míří nahoru).
 * Celolodní: vnitřní tečky = zásoba (barva podle síly), vnější šedé tečky = účinnost.
 * Segmentový: čtyři výseče, vrstvy = body; `planned` = plánované rozložení (úprava štítu):
 * odebrané body se kreslí jako oranžové duté vrstvy.
 */
export function shieldBubble(ship: BubbleShip, teamColor: string, planned?: Segments, size = 118, storm = false): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 118 118");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.classList.add("bubble");
  if (storm) svg.classList.add("storm");
  const cx = 59;
  const cy = 59;
  const D = Math.PI / 180;

  if (ship.shieldType === "whole") {
    const frac = ship.maxShields > 0 ? ship.shields / ship.maxShields : 0;
    const col = strengthColor(frac);
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i * 360) / n - 90;
      const on = i < Math.round(frac * n);
      svg.append(rect(cx + 40 * Math.cos(a * D) - 3, cy + 40 * Math.sin(a * D) - 3, 6, 6, on ? col : SHIELD_DARK));
    }
    // vnější prstenec účinnosti jen pokud účinnost vůbec klesá (ladění)
    for (let i = 0; i < (RULES.wholeEffDrop > 0 ? n : 0); i++) {
      const a = (i * 360) / n - 90 + 6;
      const on = i < Math.round((ship.shieldEff / 100) * n);
      svg.append(rect(cx + 51 * Math.cos(a * D) - 2, cy + 51 * Math.sin(a * D) - 2, 4, 4, on ? "#9aa3ad" : SHIELD_DARK));
    }
  } else if (ship.shieldType === "none") {
    // bez štítu: jen tmavý obrys a nápis
    svg.append(text(cx, cy - 44, "BEZ ŠTÍTU", "#64748b", 9));
  } else {
    const cur = ship.segments;
    const plan = planned ?? cur;
    for (let seg = 0; seg < 4; seg++) {
      const a0 = -135 + seg * 90;
      const hp = plan[seg];
      const layers = Math.max(cur[seg], hp, 2);
      const col = segmentColor(hp);
      for (let layer = 0; layer < layers; layer++) {
        const r = 36 + layer * 8;
        for (let a = a0 + 9; a < a0 + 90 - 8; a += 9) {
          const x = cx + r * Math.cos(a * D);
          const y = cy + r * Math.sin(a * D);
          if (layer < hp) svg.append(rect(x - 2.5, y - 2.5, 5, 5, col));
          else if (layer < cur[seg]) svg.append(rect(x - 2.5, y - 2.5, 5, 5, "none", SHIELD_ORANGE));
          else svg.append(rect(x - 2.5, y - 2.5, 5, 5, SHIELD_DARK));
        }
      }
      const mid = (a0 + 45) * D;
      svg.append(text(cx + 27 * Math.cos(mid), cy + 27 * Math.sin(mid) + 3, String(hp), hp === 0 ? SHIELD_RED : "#e2e8f0"));
    }
  }

  // loď (šablona míří doprava → otočíme o −90°, aby mířila nahoru), 1 px = 2.6 px
  const g = document.createElementNS(NS, "g");
  const s = 2.6;
  g.setAttribute("transform", `translate(${cx - (14 * s) / 2}, ${cy + (16 * s) / 2}) rotate(-90)`);
  const pal: Record<string, string> = { P: teamColor, G: "#9aa3ad", D: "#4b5563", W: "#dbeafe", E: "#fb923c" };
  FIGHTER.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (pal[c]) g.append(rect(x * s, y * s, s, s, pal[c]));
    }),
  );
  svg.append(g);
  if (storm) {
    // tečky zešednou a problikávají fialově (CSS animace), přes bublinu nápis
    svg.querySelectorAll("rect").forEach((r, i) => {
      if (r.parentNode === g) return;
      r.classList.add("sd", `sd${i % 5}`);
    });
    svg.append(rect(12, 50, 94, 18, "rgba(5,7,15,0.85)", "#a855f7"));
    svg.append(text(cx, 62, "ŠTÍT VYPNUT ⚡", "#e879f9", 10));
  }
  return svg;
}
