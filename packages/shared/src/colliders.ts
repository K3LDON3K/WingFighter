/**
 * Kolizní model lodi: místo jednoho kruhu sada kruhů v souřadnicích lodi (+x = příď, +y = pravobok).
 * Každý trup si definuje vlastní rozmístění; výpočty zůstávají kruh × kruh.
 */
import { insideMap } from "./mapshape.ts";
import type { Asteroid } from "./types.ts";
import { circleHitsAsteroid } from "./asteroids.ts";
import { circlesOverlap, type Pose, type Vec } from "./geometry.ts";

export interface Collider {
  x: number;
  y: number;
  r: number;
}

export interface WorldCircle extends Vec {
  r: number;
}

/** Kruhy lodi přepočtené do světa podle její pozice a natočení. */
export function shipCircles(p: Pose, cols: Collider[]): WorldCircle[] {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  return cols.map((k) => ({ x: p.x + k.x * c - k.y * s, y: p.y + k.x * s + k.y * c, r: k.r }));
}

export function shipHitsCircle(p: Pose, cols: Collider[], c: Vec, r: number): boolean {
  return shipCircles(p, cols).some((k) => circlesOverlap(k, k.r, c, r));
}

export function shipsOverlap(a: Pose, ca: Collider[], b: Pose, cb: Collider[]): boolean {
  const bc = shipCircles(b, cb);
  return shipCircles(a, ca).some((k) => bc.some((m) => circlesOverlap(k, k.r, m, m.r)));
}

export function shipHitsAsteroid(a: Asteroid, p: Pose, cols: Collider[]): boolean {
  return shipCircles(p, cols).some((k) => circleHitsAsteroid(a, k, k.r));
}

/** Celá loď (všechny kruhy) je uvnitř mapy. */
export function shipInsideMap(width: number, height: number, p: Pose, cols: Collider[]): boolean {
  const m = { width, height };
  return shipCircles(p, cols).every((k) => insideMap(m, k, k.r));
}

/** Poloměr opsané kružnice (pro hrubé testy a kreslení). */
export function boundingRadius(cols: Collider[]): number {
  return Math.max(...cols.map((k) => Math.hypot(k.x, k.y) + k.r));
}
