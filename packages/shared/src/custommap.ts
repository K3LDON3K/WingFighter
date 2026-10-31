/**
 * Vlastní mapa z editoru: obrys (nebo elipsa), ručně umístěné asteroidy, bouře, startovní body (s týmem),
 * startovní zóny, stanice a dráhy komet. Ukládá se na serveru (maps.json) a vybírá v lobby místo generované mapy.
 */
import { generateProfile } from "./asteroids.ts";
import type { Vec } from "./geometry.ts";
import type { GeneratedMap } from "./mapgen.ts";
import { insideMap, polygonArea, shapeOf, type MapShape } from "./mapshape.ts";
import { SKY_THEMES, type Asteroid, type SkyChoice, type Storm } from "./types.ts";

export interface CustomAsteroid {
  x: number;
  y: number;
  radius: number;
  /** Seed tvaru (🎲 přehodit = nový seed). */
  seed: number;
}
export interface CustomStart {
  x: number;
  y: number;
  heading: number;
  /** Tým, pro který je start určený (chybí = kdokoliv). */
  team?: number;
}
export interface CustomZone {
  team: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type CometLaneSpeed = "slow" | "normal" | "fast";
export type CometLaneSize = "small" | "medium" | "large";
export interface CometLane {
  id: string;
  /** Body dráhy (první = vstup za okrajem, poslední = výstup). */
  points: Vec[];
  /** Kometa přiletí každých `every` kol, poprvé v kole `first`. */
  every: number;
  first: number;
  speed: CometLaneSpeed;
  size: CometLaneSize;
}

export interface CustomMap {
  id: string;
  name: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  /** Volný obrys (starší zápis); chybí = elipsa width × height. */
  outline?: Vec[];
  /** Tvar: kusy s dírami; má přednost před `outline`. */
  shape?: MapShape;
  asteroids: CustomAsteroid[];
  storms: Storm[];
  starts: CustomStart[];
  zones: CustomZone[];
  stations: Vec[];
  cometLanes: CometLane[];
  /** Náhodné komety od okraje navíc (jako u generované mapy). */
  randomComets: boolean;
  sky?: SkyChoice;
}

/** Souhrn mapy do seznamu v lobby / editoru (bez těžkých dat). */
export interface CustomMapSummary {
  id: string;
  name: string;
  author: string;
  updatedAt: number;
  width: number;
  height: number;
  /** Počet týmů, pro které má mapa vlastní starty (0 = jen „kdokoliv“). */
  teams: number;
  starts: number;
}

export const CUSTOM_MAP_LIMITS = { minSize: 1200, maxSize: 8000, maxAsteroids: 300, maxStormBlobs: 400, maxStarts: 32, maxZones: 8, maxStations: 4, maxLanes: 8, maxOutline: 300, maxShapePoints: 1200, maxPieces: 12, minPieceArea: 40000, nameLen: 40 } as const;

export function newCustomMap(name: string, author: string, width = 3600, height = 2400): CustomMap {
  const now = Date.now();
  return { id: `map-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, name, author, createdAt: now, updatedAt: now, width, height, asteroids: [], storms: [], starts: [], zones: [], stations: [], cometLanes: [], randomComets: false, sky: "none" };
}

export function summarizeMap(m: CustomMap): CustomMapSummary {
  const teams = new Set(m.starts.map((s) => s.team).filter((t): t is number => typeof t === "number"));
  for (const z of m.zones) teams.add(z.team);
  return { id: m.id, name: m.name, author: m.author, updatedAt: m.updatedAt, width: m.width, height: m.height, teams: teams.size, starts: m.starts.length };
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
const vec = (v: unknown, w: number, h: number): Vec | null => {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.x !== "number" || typeof r.y !== "number" || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return null;
  return { x: Math.round(Math.max(-w, Math.min(2 * w, r.x))), y: Math.round(Math.max(-h, Math.min(2 * h, r.y))) };
};

/** Ověří a ořeže mapu z klienta / souboru; null = nepoužitelné. */
export function sanitizeCustomMap(raw: unknown): CustomMap | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const L = CUSTOM_MAP_LIMITS;
  const width = Math.round(num(r.width, L.minSize, L.maxSize, 3600));
  const height = Math.round(num(r.height, L.minSize, L.maxSize, 2400));
  const name = (typeof r.name === "string" ? r.name : "Mapa").trim().slice(0, L.nameLen) || "Mapa";
  const author = (typeof r.author === "string" ? r.author : "").trim().slice(0, 32);
  const id = typeof r.id === "string" && /^[\w-]{3,64}$/.test(r.id) ? r.id : newCustomMap(name, author).id;
  const now = Date.now();
  const out: CustomMap = { id, name, author, createdAt: num(r.createdAt, 0, 1e13, now), updatedAt: num(r.updatedAt, 0, 1e13, now), width, height, asteroids: [], storms: [], starts: [], zones: [], stations: [], cometLanes: [], randomComets: r.randomComets === true, sky: "none" };
  if (r.sky === "random" || r.sky === "none" || (typeof r.sky === "string" && (SKY_THEMES as string[]).includes(r.sky))) out.sky = r.sky as SkyChoice;
  if (Array.isArray(r.outline)) {
    const pts = r.outline.map((p) => vec(p, width, height)).filter((p): p is Vec => !!p).slice(0, L.maxOutline);
    if (pts.length >= 3) out.outline = pts;
  }
  if (Array.isArray(r.shape)) {
    const shape: MapShape = [];
    let total = 0;
    for (const poly of r.shape.slice(0, L.maxPieces)) {
      if (!Array.isArray(poly)) continue;
      const rings: Vec[][] = [];
      for (const ring of poly.slice(0, 16)) {
        if (!Array.isArray(ring)) continue;
        const pts = ring.map((p) => vec(p, width, height)).filter((p): p is Vec => !!p);
        if (pts.length < 3 || total + pts.length > L.maxShapePoints) continue;
        if (Math.abs(polygonArea(pts)) < (rings.length ? 2000 : L.minPieceArea)) continue;
        rings.push(pts);
        total += pts.length;
      }
      if (rings.length) shape.push(rings);
    }
    if (shape.length) {
      out.shape = shape;
      delete out.outline;
    }
  }
  if (Array.isArray(r.asteroids)) {
    for (const a of r.asteroids.slice(0, L.maxAsteroids)) {
      const p = vec(a, width, height);
      if (!p) continue;
      const ar = a as Record<string, unknown>;
      out.asteroids.push({ x: p.x, y: p.y, radius: Math.round(num(ar.radius, 12, 200, 40)), seed: Math.round(num(ar.seed, 0, 1e9, 1)) });
    }
  }
  if (Array.isArray(r.storms)) {
    let blobs = 0;
    for (const s of r.storms) {
      const sr = s as Record<string, unknown>;
      if (!sr || !Array.isArray(sr.blobs)) continue;
      const bl: Storm["blobs"] = [];
      for (const b of sr.blobs) {
        if (blobs >= L.maxStormBlobs) break;
        const p = vec(b, width, height);
        if (!p) continue;
        bl.push({ x: p.x, y: p.y, r: Math.round(num((b as Record<string, unknown>).r, 20, 600, 120)) });
        blobs++;
      }
      if (bl.length) out.storms.push({ id: `storm${out.storms.length + 1}`, blobs: bl });
    }
  }
  if (Array.isArray(r.starts)) {
    for (const s of r.starts.slice(0, L.maxStarts)) {
      const p = vec(s, width, height);
      if (!p) continue;
      const sr = s as Record<string, unknown>;
      const st: CustomStart = { x: p.x, y: p.y, heading: num(sr.heading, -Math.PI * 2, Math.PI * 2, 0) };
      if (typeof sr.team === "number" && Number.isFinite(sr.team)) st.team = Math.max(0, Math.min(7, Math.round(sr.team)));
      out.starts.push(st);
    }
  }
  if (Array.isArray(r.zones)) {
    for (const z of r.zones.slice(0, L.maxZones)) {
      const p = vec(z, width, height);
      if (!p) continue;
      const zr = z as Record<string, unknown>;
      out.zones.push({ team: Math.max(0, Math.min(7, Math.round(num(zr.team, 0, 7, 0)))), x: p.x, y: p.y, w: Math.round(num(zr.w, 60, width, 300)), h: Math.round(num(zr.h, 60, height, 300)) });
    }
  }
  if (Array.isArray(r.stations)) for (const s of r.stations.slice(0, L.maxStations)) {
    const p = vec(s, width, height);
    if (p) out.stations.push(p);
  }
  if (Array.isArray(r.cometLanes)) {
    for (const l of r.cometLanes.slice(0, L.maxLanes)) {
      const lr = l as Record<string, unknown>;
      if (!lr || !Array.isArray(lr.points)) continue;
      const pts = lr.points.map((p) => vec(p, width, height)).filter((p): p is Vec => !!p).slice(0, 32);
      if (pts.length < 2) continue;
      out.cometLanes.push({
        id: typeof lr.id === "string" ? lr.id.slice(0, 32) : `lane${out.cometLanes.length + 1}`,
        points: pts,
        every: Math.round(num(lr.every, 1, 99, 4)),
        first: Math.round(num(lr.first, 1, 99, 2)),
        speed: lr.speed === "slow" || lr.speed === "fast" ? lr.speed : "normal",
        size: lr.size === "small" || lr.size === "large" ? lr.size : "medium",
      });
    }
  }
  return out;
}

/** Mapa pro bitvu z vlastní mapy (stejný tvar jako z generátoru + obrys). */
export function customToGenerated(m: CustomMap): GeneratedMap & { outline?: Vec[]; shape?: MapShape; startTeams: (number | undefined)[] } {
  const box = { width: m.width, height: m.height, outline: m.outline, shape: m.shape };
  const asteroids: Asteroid[] = m.asteroids
    .filter((a) => insideMap(box, a, a.radius * 0.5))
    .map((a, i) => ({ id: `a${i + 1}`, x: a.x, y: a.y, radius: a.radius, vx: 0, vy: 0, seed: a.seed, profile: generateProfile(a.radius, a.seed), version: 0 }));
  const storms: Storm[] = m.storms.map((s, i) => ({ id: `storm${i + 1}`, blobs: s.blobs.map((b) => ({ ...b })) }));
  const starts = m.starts.map((s) => ({ x: s.x, y: s.y, heading: s.heading }));
  const sh = shapeOf(box);
  return { width: m.width, height: m.height, outline: undefined, shape: sh ? sh.map((poly) => poly.map((ring) => ring.map((p) => ({ ...p })))) : undefined, asteroids, storms, starts, startTeams: m.starts.map((s) => s.team), stations: m.stations.map((p) => ({ ...p })) };
}
