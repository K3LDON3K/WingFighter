/**
 * Vzdálená paralaxní vrstva: galaxie, mlhoviny a planety hluboko za mapou. Hýbe se pomaleji než mapa
 * (čím dál, tím pomaleji), nic z toho nemá vliv na hru. Vše je pixel-art generovaný ze seedu mapy,
 * sprity se vyrábí jednou a pak se jen kreslí (vrstva je součástí statické mezipaměti pozadí).
 */
import type { Camera } from "./camera.ts";
import { SKY_THEMES, type SkyTheme } from "@wingfighter/shared";

/** Objekt vrstvy: pozice ve světových jednotkách (vůči mapě), hloubka 0..1 (0 = nekonečně daleko = nehýbe se, 1 = v rovině mapy). Velikost = obrazové pixely při zoomu 1 (vzdálené objekty se zoomem skoro nemění). */
interface SkyObject {
  x: number;
  y: number;
  depth: number;
  sprite: HTMLCanvasElement;
  /** Velikost ve světových jednotkách (při zoomu 1). */
  size: number;
  alpha: number;
}

interface Sky {
  theme: SkyTheme;
  seed: number;
  w: number;
  h: number;
  objects: SkyObject[];
}

function rngOf(seed: number): () => number {
  let s = (seed * 2654435761 + 1013904223) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const PLANET_PALETTES: [string, string, string][] = [
  ["#7c3aed", "#a78bfa", "#3b0764"], // fialová
  ["#0ea5e9", "#7dd3fc", "#0c4a6e"], // ledově modrá
  ["#f97316", "#fdba74", "#7c2d12"], // oranžový plynný obr
  ["#22c55e", "#86efac", "#14532d"], // zelená
  ["#e11d48", "#fda4af", "#4c0519"], // rudá
  ["#eab308", "#fde68a", "#713f12"], // žlutá
  ["#64748b", "#cbd5e1", "#1e293b"], // šedý kámen
  ["#14b8a6", "#99f6e4", "#134e4a"], // tyrkys
];

/** Pixelová planeta: koule se stínem, volitelně pásy a prstenec. Sprite má velikost n×n pixelů (pixel = 1 jednotka spritu). */
function planetSprite(rnd: () => number, n: number, pal: [string, string, string], bands: boolean, ring: boolean): HTMLCanvasElement {
  const pad = ring ? Math.round(n * 0.45) : 2;
  const c = document.createElement("canvas");
  c.width = n + pad * 2;
  c.height = n + pad * 2;
  const x = c.getContext("2d")!;
  const r = n / 2;
  const cx = pad + r;
  const cy = pad + r;
  const lx = -0.5 - rnd() * 0.4; // směr světla (vlevo nahoře)
  const ly = -0.6;
  const [base, light, dark] = pal;
  const bandPhase = rnd() * 10;
  for (let py = 0; py < n; py++) {
    for (let px = 0; px < n; px++) {
      const dx = (px + 0.5 - r) / r;
      const dy = (py + 0.5 - r) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      let shade = dx * lx + dy * ly + nz * 0.7; // -1..1
      if (bands) shade += Math.sin(dy * 7 + bandPhase + dx * 0.6) * 0.18;
      x.fillStyle = shade > 0.55 ? light : shade > -0.05 ? base : dark;
      if (d2 > 0.86 && shade < 0.3) x.fillStyle = dark;
      x.fillRect(pad + px, pad + py, 1, 1);
    }
  }
  if (ring) {
    // prstenec: elipsa kolem rovníku, přední část překryje planetu
    const rw = r * 1.75;
    const rh = r * 0.45;
    const tilt = (rnd() - 0.5) * 0.5;
    for (let i = 0; i < 360; i += 1) {
      const a = (i * Math.PI) / 180;
      for (let k = 0; k < 3; k++) {
        const rr = 1 + k * 0.12;
        const ex = Math.cos(a) * rw * rr;
        const ey = Math.sin(a) * rh * rr;
        const sx = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
        const sy = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt);
        const front = Math.sin(a) > 0; // přední půlka (dole) překrývá kouli
        const inside = (sx - cx) ** 2 + (sy - cy) ** 2 < r * r;
        if (!front && inside) continue;
        x.fillStyle = k === 1 ? light : base;
        x.globalAlpha = k === 1 ? 0.9 : 0.55;
        x.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
    }
    x.globalAlpha = 1;
  }
  return c;
}

/** Spirální galaxie: jádro + dvě až tři ramena z pixelů. */
function galaxySprite(rnd: () => number, n: number, tint: [string, string], arms = 2): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const x = c.getContext("2d")!;
  const cx = n / 2;
  const cy = n / 2;
  const [core, arm] = tint;
  const tilt = 0.45 + rnd() * 0.3; // zploštění (pohled šikmo)
  const rot = rnd() * Math.PI;
  const put = (px: number, py: number, col: string, a: number) => {
    const rx = px * Math.cos(rot) - py * Math.sin(rot);
    const ry = (px * Math.sin(rot) + py * Math.cos(rot)) * tilt;
    x.fillStyle = col;
    x.globalAlpha = a;
    x.fillRect(Math.round(cx + rx), Math.round(cy + ry), 1, 1);
  };
  const R = n * 0.48;
  for (let i = 0; i < n * n * 0.9; i++) {
    const t = rnd();
    const armIdx = Math.floor(rnd() * arms);
    const ang = t * Math.PI * 2.6 + (armIdx * Math.PI * 2) / arms;
    const rad = t * R;
    const spread = (rnd() - 0.5) * (4 + t * n * 0.16);
    const px = Math.cos(ang) * rad + spread;
    const py = Math.sin(ang) * rad + spread * 0.6;
    put(px, py, rnd() < 0.15 ? "#ffffff" : arm, 0.25 + (1 - t) * 0.45);
  }
  // jádro
  for (let i = 0; i < n * 14; i++) {
    const a = rnd() * Math.PI * 2;
    const rad = Math.abs(rnd() + rnd() - 1) * n * 0.14;
    put(Math.cos(a) * rad, Math.sin(a) * rad, rnd() < 0.3 ? "#fff7ed" : core, 0.5 + rnd() * 0.5);
  }
  x.globalAlpha = 1;
  return c;
}

/** Eliptická / drobná vzdálená galaxie. */
function blobGalaxySprite(rnd: () => number, n: number, col: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const x = c.getContext("2d")!;
  const ex = 0.5 + rnd() * 0.5;
  const rot = rnd() * Math.PI;
  for (let i = 0; i < n * n * 0.6; i++) {
    const a = rnd() * Math.PI * 2;
    const rad = Math.abs(rnd() + rnd() - 1) * n * 0.5;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad * ex;
    const rx = px * Math.cos(rot) - py * Math.sin(rot);
    const ry = px * Math.sin(rot) + py * Math.cos(rot);
    x.fillStyle = rnd() < 0.1 ? "#ffffff" : col;
    x.globalAlpha = 0.2 + (1 - rad / (n * 0.5)) * 0.6;
    x.fillRect(Math.round(n / 2 + rx), Math.round(n / 2 + ry), 1, 1);
  }
  x.globalAlpha = 1;
  return c;
}

/** Mlhovina: měkké pixelové mraky dvou barev. */
function nebulaSprite(rnd: () => number, n: number, cols: string[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const x = c.getContext("2d")!;
  const blobs = 6 + Math.floor(rnd() * 5);
  const centers = Array.from({ length: blobs }, () => ({ x: n * (0.25 + rnd() * 0.5), y: n * (0.25 + rnd() * 0.5), r: n * (0.12 + rnd() * 0.2), col: cols[Math.floor(rnd() * cols.length)] }));
  const cell = 2; // hrubší pixely = mlhavější
  for (let py = 0; py < n; py += cell) {
    for (let px = 0; px < n; px += cell) {
      let best = 0;
      let col = cols[0];
      for (const b of centers) {
        const d = Math.hypot(px - b.x, py - b.y) / b.r;
        const v = Math.max(0, 1 - d * d) * (0.7 + rnd() * 0.3);
        if (v > best) {
          best = v;
          col = b.col;
        }
      }
      if (best < 0.08) continue;
      x.fillStyle = col;
      x.globalAlpha = Math.min(0.85, best * 0.95);
      x.fillRect(px, py, cell, cell);
    }
  }
  // jasné hvězdy v mlhovině
  for (let i = 0; i < n / 3; i++) {
    x.fillStyle = "#ffffff";
    x.globalAlpha = 0.5 + rnd() * 0.5;
    x.fillRect(Math.floor(rnd() * n), Math.floor(rnd() * n), 1, 1);
  }
  x.globalAlpha = 1;
  return c;
}

/** Slunce: žhavý kotouč s korónou. */
function sunSprite(rnd: () => number, n: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const x = c.getContext("2d")!;
  const r = n * 0.28;
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      const d = Math.hypot(px + 0.5 - n / 2, py + 0.5 - n / 2);
      if (d < r) {
        x.fillStyle = d < r * 0.7 ? "#fff7cc" : "#fde047";
        x.globalAlpha = 1;
      } else if (d < n / 2) {
        const t = (d - r) / (n / 2 - r);
        if (rnd() > 1 - t * 0.9) continue;
        x.fillStyle = t < 0.3 ? "#fb923c" : "#f97316";
        x.globalAlpha = (1 - t) * 0.5;
      } else continue;
      x.fillRect(px, py, 1, 1);
    }
  x.globalAlpha = 1;
  return c;
}

const cache = new Map<string, Sky>();

function buildSky(theme: SkyTheme, seed: number, w: number, h: number): Sky {
  const rnd = rngOf(seed * 7 + SKY_THEMES.indexOf(theme) * 101);
  const objects: SkyObject[] = [];
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const planet = (size: number, depth: number, opts?: { ring?: boolean; bands?: boolean; pal?: [string, string, string] }) => {
    const n = Math.max(10, Math.min(64, Math.round(size / 6)));
    objects.push({ x: rnd() * w, y: rnd() * h, depth, size, alpha: 0.75 + depth * 0.25, sprite: planetSprite(rnd, n, opts?.pal ?? pick(PLANET_PALETTES), opts?.bands ?? rnd() < 0.5, opts?.ring ?? rnd() < 0.3) });
  };
  if (theme === "spirala") {
    objects.push({ x: w * (0.3 + rnd() * 0.4), y: h * (0.3 + rnd() * 0.4), depth: 0.06, size: 820, alpha: 0.7, sprite: galaxySprite(rnd, 340, ["#c4b5fd", "#818cf8"], 2 + Math.floor(rnd() * 2)) });
    planet(140 + rnd() * 120, 0.22);
    planet(70 + rnd() * 60, 0.3);
    planet(40 + rnd() * 30, 0.4);
  } else if (theme === "mlhovina") {
    objects.push({ x: w * (0.2 + rnd() * 0.6), y: h * (0.2 + rnd() * 0.6), depth: 0.05, size: 1100, alpha: 0.9, sprite: nebulaSprite(rnd, 360, ["#7e22ce", "#0891b2", "#be185d"]) });
    objects.push({ x: w * rnd(), y: h * rnd(), depth: 0.08, size: 650, alpha: 0.75, sprite: nebulaSprite(rnd, 240, ["#0e7490", "#4338ca"]) });
    planet(180 + rnd() * 120, 0.2, { bands: true });
    planet(50 + rnd() * 40, 0.35);
  } else if (theme === "soustava") {
    objects.push({ x: w * (rnd() < 0.5 ? 0.1 : 0.9), y: h * (0.1 + rnd() * 0.3), depth: 0.04, size: 520, alpha: 0.9, sprite: sunSprite(rnd, 96) });
    planet(320 + rnd() * 160, 0.18, { ring: true, bands: true, pal: pick([PLANET_PALETTES[2], PLANET_PALETTES[5], PLANET_PALETTES[0]]) });
    planet(90 + rnd() * 50, 0.28);
    planet(60 + rnd() * 40, 0.33);
    planet(30 + rnd() * 20, 0.45, { ring: false, bands: false, pal: PLANET_PALETTES[6] });
    planet(24 + rnd() * 16, 0.5, { ring: false, bands: false, pal: PLANET_PALETTES[6] });
  } else {
    const tints = ["#93c5fd", "#c4b5fd", "#fda4af", "#99f6e4", "#fde68a"];
    for (let i = 0; i < 9; i++) {
      const spiral = rnd() < 0.5;
      const n = 60 + Math.floor(rnd() * 60);
      objects.push({ x: rnd() * w, y: rnd() * h, depth: 0.03 + rnd() * 0.1, size: 140 + rnd() * 240, alpha: 0.7 + rnd() * 0.3, sprite: spiral ? galaxySprite(rnd, n, [pick(tints), pick(tints)], 2) : blobGalaxySprite(rnd, n, pick(tints)) });
    }
    planet(60 + rnd() * 50, 0.3);
  }
  // nejdál (nejmenší depth) se kreslí první
  objects.sort((a, b) => a.depth - b.depth);
  return { theme, seed, w, h, objects };
}

/** Vykreslí vrstvu do kontextu, který už má světovou transformaci (scale zoom, translate -cam). */
export function drawParallax(ctx: CanvasRenderingContext2D, theme: SkyTheme, seed: number, w: number, h: number, cam: Camera): void {
  const key = `${theme}|${seed}|${w}x${h}`;
  let sky = cache.get(key);
  if (!sky) {
    sky = buildSky(theme, seed, w, h);
    cache.clear();
    cache.set(key, sky);
  }
  // kamera (střed obrazu) ve světě
  const ccx = cam.x + cam.viewW / cam.zoom / 2;
  const ccy = cam.y + cam.viewH / cam.zoom / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const o of sky.objects) {
    // paralaxa: objekt se vůči středu obrazu posouvá jen zlomkem (depth) pohybu kamery
    const px = ccx + (o.x - ccx) * o.depth;
    const py = ccy + (o.y - ccy) * o.depth;
    // zoom na vzdálené objekty působí míň (depth 0 = nemění velikost)
    const zoomEff = 1 + (cam.zoom - 1) * o.depth;
    const s = (o.size * zoomEff) / cam.zoom; // velikost ve světových jednotkách při aktuálním zoomu
    const sw = (s * o.sprite.width) / Math.max(o.sprite.width, o.sprite.height);
    const sh = (s * o.sprite.height) / Math.max(o.sprite.width, o.sprite.height);
    // pixelový krok ≈ 1 obrazový pixel × 2 (ať je vidět pixel-art) – kreslíme bez vyhlazení
    ctx.globalAlpha = o.alpha;
    ctx.drawImage(o.sprite, Math.round(px - sw / 2), Math.round(py - sh / 2), Math.round(sw), Math.round(sh));
  }
  ctx.restore();
}
