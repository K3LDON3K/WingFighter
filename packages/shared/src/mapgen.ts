import { generateProfile } from "./asteroids.ts";
import type { Vec } from "./geometry.ts";
import { createRng } from "./rng.ts";
import type { Asteroid, MapSettings, Storm } from "./types.ts";

/**
 * Generátor map: velikost, asteroidy (hustota, shluky), elektromagnetické bouře (shluky kruhů),
 * startovní body po obvodu. Deterministický podle seedu – stejný seed = stejná mapa.
 */

export const MAP_SIZES: Record<MapSettings["size"], { w: number; h: number; label: string; starts: number }> = {
  small: { w: 2400, h: 1600, label: "Malá 2400×1600", starts: 12 },
  medium: { w: 3600, h: 2400, label: "Střední 3600×2400", starts: 16 },
  large: { w: 4800, h: 3200, label: "Velká 4800×3200", starts: 20 },
  huge: { w: 6400, h: 4000, label: "Obří 6400×4000", starts: 24 },
};

/** Startovní pásmo u okraje mapy (startovní body leží v této vzdálenosti od okraje). */
export const START_MARGIN = 160;

export const DEFAULT_MAP: MapSettings = { size: "medium", asteroids: "medium", clusters: false, storms: 2, stormSize: "medium", seed: 1, symmetric: false };

export interface GeneratedMap {
  width: number;
  height: number;
  asteroids: Asteroid[];
  storms: Storm[];
  /** Startovní body po obvodu (pozice + kurz do středu). */
  starts: { x: number; y: number; heading: number }[];
}

export function sanitizeMapSettings(raw: unknown, base: MapSettings = DEFAULT_MAP): MapSettings {
  const out = { ...base };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.size === "string" && r.size in MAP_SIZES) out.size = r.size as MapSettings["size"];
  if (r.asteroids === "none" || r.asteroids === "few" || r.asteroids === "medium" || r.asteroids === "many") out.asteroids = r.asteroids;
  if (typeof r.clusters === "boolean") out.clusters = r.clusters;
  if (typeof r.storms === "number" && Number.isFinite(r.storms)) out.storms = Math.max(0, Math.min(5, Math.round(r.storms)));
  if (r.stormSize === "small" || r.stormSize === "medium" || r.stormSize === "large") out.stormSize = r.stormSize;
  if (typeof r.seed === "number" && Number.isFinite(r.seed)) out.seed = Math.max(0, Math.min(999999, Math.round(r.seed)));
  if (typeof r.symmetric === "boolean") out.symmetric = r.symmetric;
  return out;
}

export function pointInStorm(storms: Storm[], p: Vec, pad = 0): boolean {
  for (const s of storms) for (const b of s.blobs) if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r + pad) return true;
  return false;
}

/** Protíná úsečka bouři? (vzorkování po `step`) */
export function lineCrossesStorm(storms: Storm[], a: Vec, b: Vec, step = 10): boolean {
  if (storms.length === 0) return false;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (pointInStorm(storms, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return true;
  }
  return false;
}

export function generateMap(settings: MapSettings): GeneratedMap {
  const size = MAP_SIZES[settings.size] ?? MAP_SIZES.medium;
  const width = size.w;
  const height = size.h;
  const rng = createRng(settings.seed * 7919 + 13);
  const area = (width * height) / 1_000_000; // v milionech jednotek²
  const density = { none: 0, few: 3, medium: 6, many: 10 }[settings.asteroids];
  const asteroidCount = Math.round(density * area);
  // generuje se v oblasti mimo startovní pásmo; při symetrii jen v levé polovině a zrcadlí se
  const inner = { x0: START_MARGIN + 160, y0: START_MARGIN + 120, x1: width - START_MARGIN - 160, y1: height - START_MARGIN - 120 };
  const genW = settings.symmetric ? width / 2 - 60 : inner.x1;

  const asteroids: Asteroid[] = [];
  let aid = 1;
  const addAsteroid = (x: number, y: number, radius: number) => {
    const seed = Math.floor(rng.next() * 100000);
    asteroids.push({ id: `a${aid++}`, x: Math.round(x), y: Math.round(y), radius, vx: 0, vy: 0, seed, profile: generateProfile(radius, seed), version: 0 });
  };
  const fits = (x: number, y: number, r: number) => asteroids.every((a) => Math.hypot(a.x - x, a.y - y) > a.radius + r + 50);
  const target = settings.symmetric ? Math.ceil(asteroidCount / 2) : asteroidCount;
  let guard = 0;
  if (settings.clusters) {
    // několik shluků, uvnitř hustě
    const clusters = Math.max(1, Math.round(target / 6));
    for (let c = 0; c < clusters && asteroids.length < target && guard < 5000; c++) {
      const cx = inner.x0 + rng.next() * (genW - inner.x0);
      const cy = inner.y0 + rng.next() * (inner.y1 - inner.y0);
      const spread = 180 + rng.next() * 160;
      for (let k = 0; k < 8 && asteroids.length < target; k++) {
        guard++;
        const x = cx + (rng.next() - 0.5) * 2 * spread;
        const y = cy + (rng.next() - 0.5) * 2 * spread;
        const r = 24 + Math.floor(rng.next() * 50);
        if (x < inner.x0 || x > genW || y < inner.y0 || y > inner.y1) continue;
        if (fits(x, y, r)) addAsteroid(x, y, r);
      }
    }
  }
  while (asteroids.length < target && guard < 5000) {
    guard++;
    const x = inner.x0 + rng.next() * (genW - inner.x0);
    const y = inner.y0 + rng.next() * (inner.y1 - inner.y0);
    const r = 24 + Math.floor(rng.next() * (rng.next() < 0.2 ? 70 : 40));
    if (fits(x, y, r)) addAsteroid(x, y, r);
  }
  if (settings.symmetric) {
    for (const a of [...asteroids]) {
      const mx = width - a.x;
      if (Math.abs(mx - a.x) < a.radius * 2 + 40) continue;
      asteroids.push({ ...a, id: `a${aid++}`, x: mx, profile: [...a.profile] });
    }
  }

  // bouře: shluky 2–4 kruhů
  const storms: Storm[] = [];
  const stormR = { small: 150, medium: 220, large: 320 }[settings.stormSize];
  const stormTarget = settings.symmetric ? Math.ceil(settings.storms / 2) : settings.storms;
  guard = 0;
  while (storms.length < stormTarget && guard < 2000) {
    guard++;
    const cx = inner.x0 + stormR + rng.next() * Math.max(1, genW - inner.x0 - 2 * stormR);
    const cy = inner.y0 + stormR + rng.next() * Math.max(1, inner.y1 - inner.y0 - 2 * stormR);
    if (storms.some((s) => s.blobs.some((b) => Math.hypot(b.x - cx, b.y - cy) < stormR * 2.6))) continue;
    const blobs: Storm["blobs"][number][] = [{ x: Math.round(cx), y: Math.round(cy), r: stormR }];
    const n = 1 + Math.floor(rng.next() * 3);
    for (let k = 0; k < n; k++) {
      const a = rng.next() * Math.PI * 2;
      const d = stormR * (0.5 + rng.next() * 0.5);
      blobs.push({ x: Math.round(cx + Math.cos(a) * d), y: Math.round(cy + Math.sin(a) * d), r: Math.round(stormR * (0.55 + rng.next() * 0.35)) });
    }
    storms.push({ id: `storm${storms.length + 1}`, blobs });
  }
  if (settings.symmetric) {
    for (const s of [...storms]) storms.push({ id: `${s.id}m`, blobs: s.blobs.map((b) => ({ ...b, x: width - b.x })) });
  }
  // asteroidy uvnitř bouře odstraníme (bouře je "prázdná" překážka)
  const cleaned = asteroids.filter((a) => !pointInStorm(storms, a, a.radius));

  // startovní body po obvodu, rovnoměrně; vynechat ty v asteroidu / bouři
  const starts: GeneratedMap["starts"] = [];
  const perim = 2 * (width - 2 * START_MARGIN) + 2 * (height - 2 * START_MARGIN);
  const count = size.starts;
  for (let i = 0; i < count; i++) {
    let d = (i / count) * perim + perim / (2 * count);
    let x: number;
    let y: number;
    const w = width - 2 * START_MARGIN;
    const hh = height - 2 * START_MARGIN;
    if (d < w) {
      x = START_MARGIN + d;
      y = START_MARGIN;
    } else if ((d -= w) < hh) {
      x = width - START_MARGIN;
      y = START_MARGIN + d;
    } else if ((d -= hh) < w) {
      x = width - START_MARGIN - d;
      y = height - START_MARGIN;
    } else {
      d -= w;
      x = START_MARGIN;
      y = height - START_MARGIN - d;
    }
    const p = { x: Math.round(x), y: Math.round(y) };
    if (pointInStorm(storms, p, 40)) continue;
    if (cleaned.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < a.radius + 60)) continue;
    starts.push({ ...p, heading: Math.atan2(height / 2 - p.y, width / 2 - p.x) });
  }
  return { width, height, asteroids: cleaned, storms, starts };
}
