/**
 * Tvar mapy: hrací plocha je ovál (elipsa vepsaná do width × height), nebo – u vlastní mapy z editoru –
 * libovolný uzavřený obrys (`outline`, mnohoúhelník v souřadnicích mapy). Kolem plochy je pás okrajové bouře
 * (šířka `border`) a za ním tvrdý okraj – hranice posunutá o `border` ven.
 */
import type { Vec } from "./geometry.ts";

export interface MapBox {
  width: number;
  height: number;
  /** Volný obrys (vlastní mapa); chybí = elipsa vepsaná do width × height. Aspoň 3 body. */
  outline?: Vec[];
}

/** Normalizovaná vzdálenost od středu oválu: < 1 uvnitř, 1 na hraně, > 1 venku. `pad` zmenší (kladné) / zvětší (záporné) ovál. */
export function ellipseNorm(m: MapBox, p: Vec, pad = 0): number {
  const a = Math.max(1, m.width / 2 - pad);
  const b = Math.max(1, m.height / 2 - pad);
  const dx = (p.x - m.width / 2) / a;
  const dy = (p.y - m.height / 2) / b;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ---------- mnohoúhelník ---------- */

const hasOutline = (m: MapBox): m is MapBox & { outline: Vec[] } => !!m.outline && m.outline.length >= 3;

export function polygonCentroid(poly: Vec[]): Vec {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(poly: Vec[], p: Vec): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Nejbližší bod obrysu a index hrany. */
export function nearestOnPolygon(poly: Vec[], p: Vec): { point: Vec; edge: number; dist: number } {
  let best = { point: poly[0], edge: 0, dist: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.dist) best = { point: q, edge: i, dist: d };
  }
  return best;
}

/** Znaménková vzdálenost od obrysu: záporná uvnitř, kladná venku. */
export function polygonSignedDist(poly: Vec[], p: Vec): number {
  const d = nearestOnPolygon(poly, p).dist;
  return pointInPolygon(poly, p) ? -d : d;
}

/** Obrys posunutý o `d` ven (záporné = dovnitř) – posun vrcholů po průměrné normále sousedních hran. */
export function offsetPolygon(poly: Vec[], d: number): Vec[] {
  const n = poly.length;
  if (n < 3 || d === 0) return poly.map((p) => ({ ...p }));
  const c = polygonCentroid(poly);
  // orientace: normála hrany má mířit od těžiště
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const n1 = edgeOutwardNormal(prev, cur, c);
    const n2 = edgeOutwardNormal(cur, next, c);
    let nx = n1.x + n2.x;
    let ny = n1.y + n2.y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    // u ostrých rohů posun zvětšit, ať je pás stejně široký (omezeno)
    const cos = Math.max(0.5, nx * n1.x + ny * n1.y);
    out.push({ x: cur.x + (nx * d) / cos, y: cur.y + (ny * d) / cos });
  }
  return out;
}

function edgeOutwardNormal(a: Vec, b: Vec, centroid: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  let nx = dy / l;
  let ny = -dx / l;
  const mx = (a.x + b.x) / 2 - centroid.x;
  const my = (a.y + b.y) / 2 - centroid.y;
  if (nx * mx + ny * my < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/** Průsečík paprsku z `from` ve směru `angle` s obrysem – nejvzdálenější (pro bod na hraně). */
function rayHitPolygon(poly: Vec[], from: Vec, angle: number): Vec | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: { t: number } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
    const u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1 && (!best || t > best.t)) best = { t };
  }
  return best ? { x: from.x + dx * best.t, y: from.y + dy * best.t } : null;
}

/* ---------- společné rozhraní (elipsa / obrys) ---------- */

/** Je bod (s poloměrem `pad`) uvnitř hrací plochy? */
export function insideMap(m: MapBox, p: Vec, pad = 0): boolean {
  if (hasOutline(m)) return polygonSignedDist(m.outline, p) + pad <= 0;
  return ellipseNorm(m, p, pad) <= 1;
}

/** Je bod za tvrdým okrajem (hranice posunutá o `border` ven)? */
export function beyondHardEdge(m: MapBox, p: Vec, border: number, pad = 0): boolean {
  if (hasOutline(m)) return polygonSignedDist(m.outline, p) + pad - border > 0;
  return ellipseNorm(m, p, pad - border) > 1;
}

/** Směr normály hrany v bodě (ven, kolmo k hraně) – pro odraz. */
export function edgeNormal(m: MapBox, p: Vec): number {
  if (hasOutline(m)) {
    const near = nearestOnPolygon(m.outline, p);
    const a = m.outline[near.edge];
    const b = m.outline[(near.edge + 1) % m.outline.length];
    const n = edgeOutwardNormal(a, b, polygonCentroid(m.outline));
    return Math.atan2(n.y, n.x);
  }
  const a = Math.max(1, m.width / 2);
  const b = Math.max(1, m.height / 2);
  return Math.atan2((p.y - m.height / 2) / (b * b), (p.x - m.width / 2) / (a * a));
}

/** Odraz kurzu od hrany v bodě p. */
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

/** Střed mapy (těžiště obrysu, jinak střed oválu). */
export function mapCenter(m: MapBox): Vec {
  return hasOutline(m) ? polygonCentroid(m.outline) : { x: m.width / 2, y: m.height / 2 };
}

/** Bod na hraně (zmenšené o `inset`) pod úhlem `angle` od středu. */
export function pointOnEdge(m: MapBox, angle: number, inset = 0): Vec {
  if (hasOutline(m)) {
    const c = polygonCentroid(m.outline);
    const hit = rayHitPolygon(m.outline, c, angle);
    if (!hit) return c;
    const d = Math.hypot(hit.x - c.x, hit.y - c.y);
    const t = Math.max(0, d - inset) / (d || 1);
    return { x: c.x + (hit.x - c.x) * t, y: c.y + (hit.y - c.y) * t };
  }
  const a = Math.max(1, m.width / 2 - inset);
  const b = Math.max(1, m.height / 2 - inset);
  return { x: m.width / 2 + Math.cos(angle) * a, y: m.height / 2 + Math.sin(angle) * b };
}

/** Bod uvnitř plochy nejblíž danému bodu (elipsa: posun po paprsku ze středu; obrys: kolmý průmět dovnitř). */
export function clampToMap(m: MapBox, p: Vec, pad = 0): Vec {
  if (hasOutline(m)) {
    if (polygonSignedDist(m.outline, p) + pad <= 0) return p;
    const near = nearestOnPolygon(m.outline, p);
    const n = edgeNormal(m, p);
    return { x: near.point.x - Math.cos(n) * pad, y: near.point.y - Math.sin(n) * pad };
  }
  const n = ellipseNorm(m, p, pad);
  if (n <= 1) return p;
  const cx = m.width / 2;
  const cy = m.height / 2;
  return { x: cx + (p.x - cx) / n, y: cy + (p.y - cy) / n };
}
