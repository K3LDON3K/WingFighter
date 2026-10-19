/**
 * Procedurální pixel art. Každý sprite se nakreslí do malého offscreen canvasu
 * a při vykreslení se zvětší bez vyhlazování. Všechny šablony míří doprava (+x).
 * Později jde každý sprite nahradit ručně kresleným PNG se stejnými rozměry.
 */

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Měřítko: 1 pixel šablony = `scale` herních jednotek. */
  scale: number;
  /** Střed (v pixelech šablony). */
  cx: number;
  cy: number;
}

const FIGHTER_TEMPLATE = [
  "..GG............",
  "..GPG...........",
  "..GPPG..........",
  "EEDPPPG.........",
  "..GPPPPGGG......",
  "...GPPPPPPGGGG..",
  "EEDDPWWPPPPPPPGG",
  "EEDDPWWPPPPPPPGG",
  "...GPPPPPPGGGG..",
  "..GPPPPGGG......",
  "EEDPPPG.........",
  "..GPPG..........",
  "..GPG...........",
  "..GG............",
];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c * factor))));
  return `rgb(${r},${g},${b})`;
}

function paint(template: string[], palette: Record<string, string>): HTMLCanvasElement {
  const h = template.length;
  const w = template[0].length;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = template[y][x];
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export function fighterSprite(teamColor: string): Sprite {
  const canvas = paint(FIGHTER_TEMPLATE, {
    P: teamColor,
    G: "#9aa3ad",
    D: "#4b5563",
    W: "#dbeafe",
    E: "#fb923c",
  });
  // světlejší hrana nahoře pro plastičnost
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = shade(teamColor, 1.35);
  for (let y = 0; y < FIGHTER_TEMPLATE.length; y++) {
    for (let x = 0; x < FIGHTER_TEMPLATE[0].length; x++) {
      if (FIGHTER_TEMPLATE[y][x] === "P" && (y === 0 || FIGHTER_TEMPLATE[y - 1][x] !== "P")) ctx.fillRect(x, y, 1, 1);
    }
  }
  return { canvas, scale: 3, cx: 7, cy: 7 };
}

export function torpedoSprite(teamColor: string): Sprite {
  const canvas = paint(["EEGGGPW", "EEGGGPW"], { G: "#cbd5e1", P: teamColor, W: "#f8fafc", E: "#fbbf24" });
  return { canvas, scale: 2, cx: 3, cy: 1 };
}

export function mineSprite(teamColor: string): Sprite {
  const t = [
    "...G...",
    ".G.D.G.",
    "..DDD..",
    "GDDPDDG",
    "..DDD..",
    ".G.D.G.",
    "...G...",
  ];
  const canvas = paint(t, { G: "#9aa3ad", D: "#374151", P: teamColor });
  return { canvas, scale: 3, cx: 3, cy: 3 };
}

/** Asteroid: nepravidelný tvar z deterministického seedu, se stínováním. */
export function asteroidSprite(radius: number, seed: number): Sprite {
  const scale = 3;
  const r = Math.ceil(radius / scale);
  const size = r * 2 + 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  // obrys: poloměr kolísá podle úhlu
  const bumps = 7 + Math.floor(rnd() * 4);
  const offsets = Array.from({ length: bumps }, () => 0.78 + rnd() * 0.24);
  const radiusAt = (a: number) => {
    const f = ((a / (Math.PI * 2)) % 1 + 1) % 1;
    const i = Math.floor(f * bumps);
    const t = f * bumps - i;
    const r0 = offsets[i];
    const r1 = offsets[(i + 1) % bumps];
    return r * (r0 + (r1 - r0) * (0.5 - 0.5 * Math.cos(Math.PI * t)));
  };
  const cx = r + 1;
  const cy = r + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const rr = radiusAt(a);
      if (d > rr) continue;
      // stínování: světlo zleva shora
      const light = (-dx - dy) / (rr * 1.5);
      const n = rnd();
      let base = 0.55 + light * 0.3 + (n - 0.5) * 0.15;
      if (d > rr - 1.2) base -= 0.2;
      const v = Math.max(0.2, Math.min(0.95, base));
      const g = Math.round(90 + v * 110);
      ctx.fillStyle = `rgb(${g},${Math.round(g * 0.93)},${Math.round(g * 0.82)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // pár kráterů
  const craters = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < craters; i++) {
    const a = rnd() * Math.PI * 2;
    const dd = rnd() * r * 0.6;
    const px = Math.round(cx + Math.cos(a) * dd);
    const py = Math.round(cy + Math.sin(a) * dd);
    const cr = 1 + Math.floor(rnd() * Math.max(1, r / 5));
    ctx.fillStyle = "rgba(40,35,30,0.55)";
    ctx.beginPath();
    ctx.arc(px, py, cr, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas: c, scale, cx, cy };
}

/** Hvězdné pozadí jako dlaždice. */
export function starfieldTile(size = 512, seed = 7): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#070a14";
  ctx.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * size);
    const y = Math.floor(rnd() * size);
    const b = rnd();
    const sz = b > 0.93 ? 2 : 1;
    const col = b > 0.8 ? "#e2e8f0" : b > 0.5 ? "#94a3b8" : "#475569";
    ctx.fillStyle = col;
    ctx.fillRect(x, y, sz, sz);
  }
  return c;
}

export class SpriteCache {
  private fighters = new Map<string, Sprite>();
  private torpedoes = new Map<string, Sprite>();
  private mines = new Map<string, Sprite>();
  private asteroids = new Map<string, Sprite>();
  readonly stars = starfieldTile();

  fighter(color: string): Sprite {
    let s = this.fighters.get(color);
    if (!s) this.fighters.set(color, (s = fighterSprite(color)));
    return s;
  }
  torpedo(color: string): Sprite {
    let s = this.torpedoes.get(color);
    if (!s) this.torpedoes.set(color, (s = torpedoSprite(color)));
    return s;
  }
  mine(color: string): Sprite {
    let s = this.mines.get(color);
    if (!s) this.mines.set(color, (s = mineSprite(color)));
    return s;
  }
  asteroid(radius: number, seed: number): Sprite {
    const key = `${radius}:${seed}`;
    let s = this.asteroids.get(key);
    if (!s) this.asteroids.set(key, (s = asteroidSprite(radius, seed)));
    return s;
  }
}

/** Vykreslí sprite se středem v (x, y) a natočením. */
export function drawSprite(ctx: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, heading: number, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sp.canvas, -sp.cx * sp.scale - sp.scale / 2, -sp.cy * sp.scale - sp.scale / 2, sp.canvas.width * sp.scale, sp.canvas.height * sp.scale);
  ctx.restore();
}
