/**
 * Geometrie herního světa.
 * Souřadnice: x doprava, y dolů (jako na canvasu). Kurz (heading) v radiánech,
 * 0 = míří doprava (+x), kladný směr otáčí po směru hodinových ručiček na obrazovce.
 * "Vlevo" z pohledu pilota = záporná změna kurzu.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Pose extends Vec {
  heading: number;
}

export const TAU = Math.PI * 2;

export function forward(heading: number): Vec {
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

/** Jednotkový vektor doprava (pravobok) od daného kurzu. */
export function rightOf(heading: number): Vec {
  return { x: -Math.sin(heading), y: Math.cos(heading) };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Normalizuje úhel do intervalu (-PI, PI]. */
export function normalizeAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

/** Úhel z pozice `from` s kurzem `heading` k bodu `to`, relativně k přídi (0 = přímo před přídí). */
export function bearingTo(from: Pose, to: Vec): number {
  const abs = Math.atan2(to.y - from.y, to.x - from.x);
  return normalizeAngle(abs - from.heading);
}

/** Je bod `to` ve výseči ±halfAngle od přídě? */
export function inArc(from: Pose, to: Vec, halfAngle: number): boolean {
  return Math.abs(bearingTo(from, to)) <= halfAngle + 1e-9;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Dráha pohybu: rovně nebo po oblouku.
 * `length` je ujetá vzdálenost, `angle` celková změna kurzu (0 = rovně, kladná = vpravo).
 * Vrací funkci t∈[0,1] → poloha a kurz.
 */
export function makePath(start: Pose, length: number, angle: number): (t: number) => Pose {
  if (Math.abs(angle) < 1e-6) {
    const f = forward(start.heading);
    return (t) => ({
      x: start.x + f.x * length * t,
      y: start.y + f.y * length * t,
      heading: start.heading,
    });
  }
  const radius = length / Math.abs(angle);
  const side = Math.sign(angle);
  const r = rightOf(start.heading);
  const center = { x: start.x + r.x * radius * side, y: start.y + r.y * radius * side };
  // vektor od středu k lodi
  const vx = start.x - center.x;
  const vy = start.y - center.y;
  return (t) => {
    const a = angle * t;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return {
      x: center.x + vx * c - vy * s,
      y: center.y + vx * s + vy * c,
      heading: start.heading + a,
    };
  };
}

/** Vzorkování dráhy do N+1 bodů (včetně začátku a konce). */
export function samplePath(path: (t: number) => Pose, steps: number): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i <= steps; i++) out.push(path(i / steps));
  return out;
}

export function circlesOverlap(a: Vec, ra: number, b: Vec, rb: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = ra + rb;
  return dx * dx + dy * dy < r * r;
}
