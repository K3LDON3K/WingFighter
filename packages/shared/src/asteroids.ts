import { CRATER_RADIUS } from "./constants.ts";
import type { Vec } from "./geometry.ts";
import type { Asteroid } from "./types.ts";

/** Počet paprsků tvaru asteroidu. */
export const ASTEROID_SEGMENTS = 48;

function seeded(seed: number) {
  let s = (seed * 9301 + 49297) >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Vygeneruje nepravidelný profil asteroidu z poloměru a seedu. */
export function generateProfile(radius: number, seed: number): number[] {
  const rnd = seeded(seed);
  const bumps = 7 + Math.floor(rnd() * 4);
  const offsets = Array.from({ length: bumps }, () => 0.78 + rnd() * 0.24);
  const out: number[] = [];
  for (let i = 0; i < ASTEROID_SEGMENTS; i++) {
    const f = i / ASTEROID_SEGMENTS;
    const bi = Math.floor(f * bumps);
    const t = f * bumps - bi;
    const r0 = offsets[bi];
    const r1 = offsets[(bi + 1) % bumps];
    out.push(radius * (r0 + (r1 - r0) * (0.5 - 0.5 * Math.cos(Math.PI * t))));
  }
  return out;
}

/** Poloměr okraje v daném absolutním úhlu (lineární interpolace mezi paprsky). */
export function radiusAt(a: Asteroid, angle: number): number {
  const n = a.profile.length;
  let f = (angle / (Math.PI * 2)) % 1;
  if (f < 0) f += 1;
  const i = Math.floor(f * n);
  const t = f * n - i;
  return a.profile[i % n] * (1 - t) + a.profile[(i + 1) % n] * t;
}

export function pointInAsteroid(a: Asteroid, p: Vec): boolean {
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d > a.radius) return false;
  return d < radiusAt(a, Math.atan2(dy, dx));
}

/** Překrývá se kruh (loď, torpédo) s asteroidem? Testuje střed a body na obvodu kruhu. */
export function circleHitsAsteroid(a: Asteroid, p: Vec, r: number): boolean {
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  if (d > a.radius + r) return false;
  if (pointInAsteroid(a, p)) return true;
  const n = r > 10 ? 12 : 6;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    if (pointInAsteroid(a, { x: p.x + Math.cos(t) * r, y: p.y + Math.sin(t) * r })) return true;
  }
  return false;
}

/**
 * Výbuch v bodě `c` o poloměru `cr` vykousne z asteroidu kráter: každý paprsek,
 * který kráter protne, se zkrátí na jeho bližší průsečík. Vrací true, když se tvar změnil.
 */
export function carveCrater(a: Asteroid, c: Vec, cr = CRATER_RADIUS): boolean {
  const n = a.profile.length;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const dc = Math.hypot(cx, cy);
  let changed = false;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    // průsečík paprsku (0..r_i) s kružnicí: |t·d − c|² = cr²
    const b = dx * cx + dy * cy;
    const disc = b * b - (dc * dc - cr * cr);
    let newR = a.profile[i];
    if (dc <= cr) newR = 0; // střed v kráteru – paprsek začíná uvnitř
    else if (disc >= 0) {
      const t1 = b - Math.sqrt(disc);
      if (t1 >= 0 && t1 < newR) newR = t1;
    }
    if (newR < a.profile[i]) {
      a.profile[i] = Math.max(0, newR);
      changed = true;
    }
  }
  if (changed) a.version++;
  return changed;
}

/** Zbylá "hmota" asteroidu (poměr plochy vůči kruhu nominálního poloměru). */
export function asteroidMass(a: Asteroid): number {
  let sum = 0;
  for (const r of a.profile) sum += r * r;
  return sum / (a.profile.length * a.radius * a.radius);
}

/** Je asteroid zničený (příliš malý)? */
export function asteroidDestroyed(a: Asteroid): boolean {
  return asteroidMass(a) < 0.12 || Math.max(...a.profile) < 10;
}
