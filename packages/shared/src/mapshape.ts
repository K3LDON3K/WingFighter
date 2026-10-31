/**
 * Tvar mapy: hrací plocha je ovál (elipsa vepsaná do width × height), nebo – u vlastní mapy z editoru –
 * libovolný tvar `shape`: víc kusů, každý s vnějším obrysem a případnými dírami (mnohoúhelníky v souřadnicích mapy).
 * Kolem plochy je pás okrajové bouře (šířka `border`) a za ním tvrdý okraj – hranice posunutá o `border` ven
 * (u děr dovnitř díry). Starší mapy mají jen `outline` (jeden obrys bez děr).
 */
import polygonClipping from "polygon-clipping";
import type { Vec } from "./geometry.ts";

/** Kus mapy: [vnější obrys, díra, díra, …]. */
export type MapPolygon = Vec[][];
/** Celý tvar: seznam kusů. */
export type MapShape = MapPolygon[];

export interface MapBox {
  width: number;
  height: number;
  /** Starší zápis: jeden volný obrys bez děr. */
  outline?: Vec[];
  /** Tvar mapy (víc kusů s dírami); má přednost před `outline`. */
  shape?: MapShape;
}

/** Tvar mapy jako kusy s dírami; null = elipsa. */
export function shapeOf(m: MapBox): MapShape | null {
  if (m.shape && m.shape.length && m.shape.every((p) => p.length && p[0].length >= 3)) return m.shape;
  if (m.outline && m.outline.length >= 3) return [[m.outline]];
  return null;
}

/** Normalizovaná vzdálenost od středu oválu: < 1 uvnitř, 1 na hraně, > 1 venku. `pad` zmenší (kladné) / zvětší (záporné) ovál. */
export function ellipseNorm(m: MapBox, p: Vec, pad = 0): number {
  const a = Math.max(1, m.width / 2 - pad);
  const b = Math.max(1, m.height / 2 - pad);
  const dx = (p.x - m.width / 2) / a;
  const dy = (p.y - m.height / 2) / b;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ---------- mnohoúhelníky ---------- */

export function polygonArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

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

/** Je bod uvnitř tvaru (v některém kusu a mimo jeho díry)? */
export function pointInShape(shape: MapShape, p: Vec): boolean {
  for (const poly of shape) {
    if (!pointInPolygon(poly[0], p)) continue;
    let inHole = false;
    for (let k = 1; k < poly.length; k++) if (pointInPolygon(poly[k], p)) inHole = true;
    if (!inHole) return true;
  }
  return false;
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

/** Nejbližší hrana v celém tvaru: který kus, který prstenec, která hrana. */
export function nearestOnShape(shape: MapShape, p: Vec): { point: Vec; poly: number; ring: number; edge: number; dist: number } {
  let best = { point: shape[0][0][0], poly: 0, ring: 0, edge: 0, dist: Infinity };
  shape.forEach((poly, pi) =>
    poly.forEach((ring, ri) => {
      const n = nearestOnPolygon(ring, p);
      if (n.dist < best.dist) best = { point: n.point, poly: pi, ring: ri, edge: n.edge, dist: n.dist };
    }),
  );
  return best;
}

/** Znaménková vzdálenost od hranice tvaru: záporná uvnitř hrací plochy, kladná venku (i v díře). */
export function shapeSignedDist(shape: MapShape, p: Vec): number {
  const d = nearestOnShape(shape, p).dist;
  return pointInShape(shape, p) ? -d : d;
}
/** @deprecated jeden obrys – viz shapeSignedDist. */
export function polygonSignedDist(poly: Vec[], p: Vec): number {
  return shapeSignedDist([[poly]], p);
}

/** Normála hrany mířící ven z hrací plochy (u vnějšího obrysu od kusu, u díry do díry). */
function edgeOutwardNormalOf(shape: MapShape, pi: number, ri: number, ei: number): Vec {
  const ring = shape[pi][ri];
  const a = ring[ei];
  const b = ring[(ei + 1) % ring.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  let nx = dy / l;
  let ny = -dx / l;
  // test: bod kousek po normále musí být venku z plochy
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const eps = Math.max(1, l * 0.01);
  if (pointInShape(shape, { x: mx + nx * eps, y: my + ny * eps })) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/* ---------- posun hranice (okrajová bouře / tvrdý okraj) ---------- */

type Ring = [number, number][];
const toRing = (r: Vec[]): Ring => r.map((p) => [p.x, p.y] as [number, number]);
const fromRing = (r: Ring): Vec[] => {
  const out = r.map(([x, y]) => ({ x, y }));
  // polygon-clipping uzavírá prstenec opakováním prvního bodu
  if (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  return out;
};
const toPc = (shape: MapShape) => shape.map((poly) => poly.map(toRing));
const fromPc = (mp: Ring[][]): MapShape => mp.map((poly) => poly.map(fromRing)).filter((poly) => poly[0]?.length >= 3);

const offsetCache = new WeakMap<MapShape, Map<number, MapShape>>();

/**
 * Hranice posunutá o `d` ven (záporné = dovnitř): sjednocení tvaru s obdélníky kolem hran a kruhy kolem vrcholů
 * (Minkowského součet) – rovnoměrný odstup i v zúženích a konkávních rozích. Výsledek se kešuje.
 */
export function offsetShape(shape: MapShape, d: number): MapShape {
  if (d === 0) return shape;
  let perShape = offsetCache.get(shape);
  if (!perShape) offsetCache.set(shape, (perShape = new Map()));
  const hit = perShape.get(d);
  if (hit) return hit;
  const r = Math.abs(d);
  const pieces: Ring[][] = [];
  // celočíselné souřadnice a jedna kružnice na vrchol – knihovna je citlivá na shodné/skoro shodné hrany
  const R = (v: number) => Math.round(v);
  const circle = (c: Vec): Ring => {
    const n = 16;
    const out: Ring = [];
    for (let i = 0; i < n; i++) out.push([R(c.x + Math.cos((i / n) * Math.PI * 2 + 0.1) * r), R(c.y + Math.sin((i / n) * Math.PI * 2 + 0.1) * r)]);
    out.push(out[0]);
    return out;
  };
  for (const poly of shape)
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (dy / l) * r;
        const ny = (-dx / l) * r;
        pieces.push([[[R(a.x + nx), R(a.y + ny)], [R(b.x + nx), R(b.y + ny)], [R(b.x - nx), R(b.y - ny)], [R(a.x - nx), R(a.y - ny)], [R(a.x + nx), R(a.y + ny)]]]);
        pieces.push([circle(a)]);
      }
    }
  let out: MapShape;
  try {
    // sjednocovat po částech (robustnější než vše najednou)
    let band = polygonClipping.union(pieces[0]);
    for (let i = 1; i < pieces.length; i += 8) band = polygonClipping.union(band, ...(pieces.slice(i, i + 8) as [Ring[], ...Ring[][]]));
    const base = toPc(shape).map((poly) => poly.map((ring) => ring.map(([x, y]) => [R(x), R(y)] as [number, number])));
    const res = d > 0 ? polygonClipping.union(base as Ring[][], band) : polygonClipping.difference(base as Ring[][], band);
    out = fromPc(res as Ring[][]);
    if (!out.length) out = shape;
  } catch (e) {
    console.warn("offsetShape selhal:", e);
    out = shape;
  }
  perShape.set(d, out);
  return out;
}

/** Sjednocení / rozdíl tvarů (editor: laso a štětec + / −). */
export function shapeUnion(a: MapShape, b: MapShape): MapShape {
  return fromPc(polygonClipping.union(toPc(a) as Ring[][], toPc(b) as Ring[][]) as Ring[][]);
}
export function shapeDifference(a: MapShape, b: MapShape): MapShape {
  return fromPc(polygonClipping.difference(toPc(a) as Ring[][], toPc(b) as Ring[][]) as Ring[][]);
}

/** @deprecated jen jeden obrys bez děr; viz offsetShape. */
export function offsetPolygon(poly: Vec[], d: number): Vec[] {
  const s = offsetShape([[poly]], d);
  return s[0]?.[0] ?? poly;
}

/** Průsečík paprsku z `from` ve směru `angle` s hranicí – nejvzdálenější (pro bod na hraně). */
function rayHitShape(shape: MapShape, from: Vec, angle: number): Vec | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: { t: number } | null = null;
  for (const poly of shape)
    for (const ring of poly)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
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

/* ---------- společné rozhraní (elipsa / tvar) ---------- */

/** Je bod (s poloměrem `pad`) uvnitř hrací plochy? */
export function insideMap(m: MapBox, p: Vec, pad = 0): boolean {
  const sh = shapeOf(m);
  if (sh) return shapeSignedDist(sh, p) + pad <= 0;
  return ellipseNorm(m, p, pad) <= 1;
}

/** Je bod za tvrdým okrajem (hranice posunutá o `border` ven)? */
export function beyondHardEdge(m: MapBox, p: Vec, border: number, pad = 0): boolean {
  const sh = shapeOf(m);
  if (sh) return shapeSignedDist(sh, p) + pad - border > 0;
  return ellipseNorm(m, p, pad - border) > 1;
}

/** Směr normály hrany v bodě (ven z hrací plochy, kolmo k hraně) – pro odraz. */
export function edgeNormal(m: MapBox, p: Vec): number {
  const sh = shapeOf(m);
  if (sh) {
    const near = nearestOnShape(sh, p);
    const n = edgeOutwardNormalOf(sh, near.poly, near.ring, near.edge);
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

/** Střed mapy (těžiště největšího kusu, jinak střed oválu). */
export function mapCenter(m: MapBox): Vec {
  const sh = shapeOf(m);
  if (!sh) return { x: m.width / 2, y: m.height / 2 };
  let best = sh[0][0];
  for (const poly of sh) if (Math.abs(polygonArea(poly[0])) > Math.abs(polygonArea(best))) best = poly[0];
  return polygonCentroid(best);
}

/** Bod na hraně (zmenšené o `inset`) pod úhlem `angle` od středu. */
export function pointOnEdge(m: MapBox, angle: number, inset = 0): Vec {
  const sh = shapeOf(m);
  if (sh) {
    const c = mapCenter(m);
    const hit = rayHitShape(sh, c, angle);
    if (!hit) return c;
    const d = Math.hypot(hit.x - c.x, hit.y - c.y);
    const t = Math.max(0, d - inset) / (d || 1);
    return { x: c.x + (hit.x - c.x) * t, y: c.y + (hit.y - c.y) * t };
  }
  const a = Math.max(1, m.width / 2 - inset);
  const b = Math.max(1, m.height / 2 - inset);
  return { x: m.width / 2 + Math.cos(angle) * a, y: m.height / 2 + Math.sin(angle) * b };
}

/** Bod uvnitř plochy nejblíž danému bodu (elipsa: posun po paprsku ze středu; tvar: kolmý průmět dovnitř). */
export function clampToMap(m: MapBox, p: Vec, pad = 0): Vec {
  const sh = shapeOf(m);
  if (sh) {
    if (shapeSignedDist(sh, p) + pad <= 0) return p;
    const near = nearestOnShape(sh, p);
    const n = edgeNormal(m, p);
    return { x: near.point.x - Math.cos(n) * pad, y: near.point.y - Math.sin(n) * pad };
  }
  const n = ellipseNorm(m, p, pad);
  if (n <= 1) return p;
  const cx = m.width / 2;
  const cy = m.height / 2;
  return { x: cx + (p.x - cx) / n, y: cy + (p.y - cy) / n };
}
