/**
 * Tvar mapy: hrací plocha je ovál (elipsa vepsaná do width × height). Kolem ní je pás okrajové bouře
 * (šířka `border`) a za ním tvrdý okraj – další elipsa s poloosami o `border` větší.
 */
import type { Vec } from "./geometry.ts";

export interface MapBox {
  width: number;
  height: number;
}

/** Normalizovaná vzdálenost od středu oválu: < 1 uvnitř, 1 na hraně, > 1 venku. `pad` zmenší (kladné) / zvětší (záporné) ovál. */
export function ellipseNorm(m: MapBox, p: Vec, pad = 0): number {
  const a = Math.max(1, m.width / 2 - pad);
  const b = Math.max(1, m.height / 2 - pad);
  const dx = (p.x - m.width / 2) / a;
  const dy = (p.y - m.height / 2) / b;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Je bod (s poloměrem `pad`) uvnitř hrací plochy? */
export function insideMap(m: MapBox, p: Vec, pad = 0): boolean {
  return ellipseNorm(m, p, pad) <= 1;
}

/** Je bod za tvrdým okrajem (ovál zvětšený o `border`)? */
export function beyondHardEdge(m: MapBox, p: Vec, border: number, pad = 0): boolean {
  return ellipseNorm(m, p, pad - border) > 1;
}

/** Směr normály hrany oválu v bodě (ven ze středu, kolmo k hraně) – pro odraz. */
export function edgeNormal(m: MapBox, p: Vec): number {
  const a = Math.max(1, m.width / 2);
  const b = Math.max(1, m.height / 2);
  return Math.atan2((p.y - m.height / 2) / (b * b), (p.x - m.width / 2) / (a * a));
}

/** Odraz kurzu od hrany oválu v bodě p. */
export function reflectAtEdge(m: MapBox, p: Vec, heading: number): number {
  const n = edgeNormal(m, p);
  // odraz vektoru v = (cos h, sin h) podle normály n: v' = v − 2 (v·n) n
  const vx = Math.cos(heading);
  const vy = Math.sin(heading);
  const nx = Math.cos(n);
  const ny = Math.sin(n);
  const d = vx * nx + vy * ny;
  return Math.atan2(vy - 2 * d * ny, vx - 2 * d * nx);
}

/** Bod na hraně oválu (zmenšeného o `inset`) pod úhlem `angle` od středu. */
export function pointOnEdge(m: MapBox, angle: number, inset = 0): Vec {
  const a = Math.max(1, m.width / 2 - inset);
  const b = Math.max(1, m.height / 2 - inset);
  return { x: m.width / 2 + Math.cos(angle) * a, y: m.height / 2 + Math.sin(angle) * b };
}

/** Bod uvnitř oválu nejblíž danému bodu (zhruba – posun po paprsku ze středu). */
export function clampToMap(m: MapBox, p: Vec, pad = 0): Vec {
  const n = ellipseNorm(m, p, pad);
  if (n <= 1) return p;
  const cx = m.width / 2;
  const cy = m.height / 2;
  return { x: cx + (p.x - cx) / n, y: cy + (p.y - cy) / n };
}
