import { radiusAt, type Asteroid } from "@wingfighter/shared";

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

/** Společná paleta: P tělo (barva týmu), S tmavší spára, L světlejší nástavba, G hrana, D tmavý kov, K černé sání, W okno, E plamen, Y jádro plamene. */
function shipPalette(teamColor: string): Record<string, string> {
  return { P: teamColor, S: shade(teamColor, 0.72), L: shade(teamColor, 1.35), G: "#9aa3ad", D: "#4b5563", K: "#1f2937", W: "#dbeafe", E: "#fb923c", Y: "#fde68a" };
}

function paintShip(template: string[], teamColor: string, scale: number): Sprite {
  const canvas = paint(template, shipPalette(teamColor));
  // světlejší hrana nahoře pro plastičnost
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = shade(teamColor, 1.35);
  for (let y = 0; y < template.length; y++) {
    for (let x = 0; x < template[0].length; x++) {
      if (template[y][x] === "P" && (y === 0 || template[y - 1][x] !== "P")) ctx.fillRect(x, y, 1, 1);
    }
  }
  return { canvas, scale, cx: Math.floor(template[0].length / 2) - (template[0].length === 16 ? 1 : 1), cy: Math.floor(template.length / 2) - (template.length === 14 ? 0 : 0) };
}

/** Stíhač – modrý tým (F1: šípová křídla, motory na koncích). 24×20, měřítko 2. */
const FIGHTER_F1 = [
  "........................",
  "..DDGGGGG...............",
  "EEDDSPPG................",
  "EEDDPSPPG...............",
  "..DDGPSPPG..............",
  ".....GSPPPG.............",
  ".....GPSPPPG............",
  ".....GPPSPPPG...........",
  "..GGGPPPPPPPPGGGGG......",
  "..DDPPPPPDDDDPPPPPGGGG..",
  "EYDDLLLLLDWWWLLLLLLLPPGG",
  "..DDPPPPPDDDDPPPPPGGGG..",
  "..GGGPPPPPPPPGGGGG......",
  ".....GPPSPPPG...........",
  ".....GPSPPPG............",
  ".....GSPPPG.............",
  "..DDGPSPPG..............",
  "EEDDPSPPG...............",
  "EEDDSPPG................",
  "..DDGGGGG...............",
];
/** Stíhač – zelený tým (F2: delta interceptor). */
const FIGHTER_F2 = [
  "........................",
  "........................",
  "...GGGGGG...............",
  "...GKKPPSGG.............",
  "...GKKPPPSSGG...........",
  "...GKKPPPPPSSGG.........",
  "...GKKPPPPPPPSGGGGGG....",
  "...DDPPPPPPPPPPSSG......",
  "EEEDDPPPPPPPPPPPPSGG....",
  "EYYDDPPPDDDDLLLLLLLLGG..",
  "EYYDDSSSDWWWSSSSSSSSPPGG",
  "EYYDDPPPDDDDPPPPPPPSGG..",
  "EEEDDPPPPPPPPPPPPSGG....",
  "...DDPPPPPPPPPPSSG......",
  "...GKKPPPPPPPSGGGGGG....",
  "...GKKPPPPPSSGG.........",
  "...GKKPPPSSGG...........",
  "...GKKPPSGG.............",
  "...GGGGGG...............",
  "........................",
];
/** Stíhač – další týmy (F3: kachní plochy). */
const FIGHTER_F3 = [
  "........................",
  "........................",
  "........................",
  "..DDGGG.................",
  "EEDDPPPG................",
  "EYDDPPPG.....GGGG.......",
  "..DDPPPPG....GPPPG......",
  "....GPPPG.....GPPG......",
  "....GPPPPGGGGGPPPPG.....",
  "...GPPPPPPDDDDPPPPPGGGG.",
  "..GPPSSSSSDWWWLLLLLLPPPG",
  "...GPPPPPPDDDDPPPPPGGGG.",
  "....GPPPPGGGGGPPPPG.....",
  "....GPPPG.....GPPG......",
  "..DDPPPPG....GPPPG......",
  "EYDDPPPG.....GGGG.......",
  "EEDDPPPG................",
  "..DDGGG.................",
  "........................",
  "........................",
];
/** Bitevník (C3: křižníkový trup, věžová nástavba, gondoly). 50×40, měřítko 3. */
/** Vesmírná stanice 40×40 (×3): prstenec, čtyři ramena, náboj s okny, solární panely, doky. Funkční / rozbitá. */
export const STATION_TEMPLATE = [
  "........................................",
  "...............DDDWWWDDD................",
  "............DDDGGGWYWGGGDDD.............",
  "..........DDGGGDDDWWWDDDGGGDD...........",
  ".........DGGGDDD..DGD..DDDGGGD..........",
  ".......DDGGDD.....DGD.....DDGGDD........",
  "......DDGDD.......DGD.......DDGDD.......",
  ".....DDGDD........DGD........DDGDD......",
  ".....DGDD.........DGD.........DDGD......",
  "....DGDD..........DGD..........DDGD.....",
  "...DGGD..BSB......DGD.......BSB.DGGD....",
  "...DGD....BSB.....DGD......BSB...DGD....",
  "..DGGD.....BSB....DGD.....BSB....DGGD...",
  "..DGD.......BSB..GGGGG...BSB......DGD...",
  "..DGD..........GGGGGGGGG..........DGD...",
  ".DGDD.........GGGDDDDDGGG.........DDGD..",
  ".DGD..........GGDDDDYDDGG..........DGD..",
  ".DGD.........GGDDYWWWDYDGG.........DGD..",
  ".DGDDDDDDDDDDGGDDWWWWWDDGGDDDDDDDDDDGD..",
  ".WWWGGGGGGGGGGGDDWWWWWDDGGGGGGGGGGGWWW..",
  ".WYWDDDDDDDDDGGDYWWWWWDYGGDDDDDDDDDWYW..",
  ".WWW.........GGDDDWWWDDDGG.........WWW..",
  ".DGD..........GGDYDDDDYGG..........DGD..",
  ".DGDD.........GGGDDDYDGGG.........DDGD..",
  "..DGD..........GGGGGGGGG..........DGD...",
  "..DGD............GGGGG............DGD...",
  "..DGGD......BSB...DGD....BSB.....DGGD...",
  "...DGD.....BSB....DGD.....BSB....DGD....",
  "...DGGD...BSB.....DGD......BSB..DGGD....",
  "....DGDD.BSB......DGD.......BSBDDGD.....",
  ".....DGDD.........DGD.........DDGD......",
  ".....DDGDD........DGD........DDGDD......",
  "......DDGDD.......DGD.......DDGDD.......",
  ".......DDGGDD.....DGD.....DDGGDD........",
  ".........DGGGDDD..DGD..DDDGGGD..........",
  "..........DDGGGDDDDWWWDDGGGDD...........",
  "............DDDGGGGWYWGGDDD.............",
  "...............DDDDWWWDD................",
  "........................................",
  "........................................",
];
export const STATION_BROKEN_TEMPLATE = [
  "........................................",
  "...............DDDDDDDDD................",
  "............DDDGGGDRDGGGDDD.............",
  "..........DDGGGDDDDDDDDDGGGDD...........",
  ".........DGGGDDD..DGD..DDDGGGD..........",
  ".......DDGGDD.....DGD.....DDGGDD........",
  "......KDGDK.......DKD.......DDGDD.......",
  ".....DDGDD........DGD........DDGDD......",
  ".....DGDD.........DGD.........DDGD......",
  "....DGDD..........DGD......ER..DDGD.....",
  "...DGGD..KDK......DGD...........DGGD....",
  "...DGD....KDK.....DGD............DGD....",
  "..DGGD.....KDK....DGD............DGGD...",
  "..DGD.......KDK..GGGEG...K........DGD...",
  "..DGD..........GGGGGGGGG..........DGD...",
  ".DGDD.........GGGDDDDDGGG.........DDGD..",
  ".DGD..........GGDDDDKDDGG..........DGD..",
  ".DGD.........GGDDKKKKDKDGG.........DGD..",
  ".DGDDDDDDDDDDGGDDKKKKKDDGGDDDDDDDDDDGD..",
  ".DDDGGGGGGGGGGGDDKKKKKDDGGGGGGGGGGGDDD..",
  ".DRDDDDDDDDDDGGDKKKKKKDKGGDDDDDDDDDDRD..",
  ".DDD.........GGDDDKKKDDDGE.........DDD..",
  ".DGD..........GGDKDDDDKGG..........DGD..",
  ".DGDD.........GGGDDDKDGGG.........DDGD..",
  "..DGD..........GGGGGGGGG..........DGD...",
  "..DGD............GGGGG............DGD...",
  "..DGGD........K...DGD....KDK.....DGGD...",
  "...DGD............DGD.....KDK....DGD....",
  "...DGGD...........DGD......KDK..DGGD....",
  "....DGDD.K...ER...DGD.......KDKDDGD.....",
  ".....DGDD.........DGD.........DKGD......",
  ".....DDGDD........DG..ER.....DDGDD......",
  "......DDGDD.......D.........DDGDD.......",
  ".......DDGGDD.............DDEGDD........",
  ".........DGGGDDD..D....DDDGGGD..........",
  "..........DDGGGDDDDD.DDDGGGDD...........",
  "............DDDGGGGDRDGGDDD.............",
  "...............DDDDDDDDD................",
  "........................................",
  "........................................",
];
const STATION_PALETTE: Record<string, string> = { G: "#9aa3ad", D: "#4b5563", K: "#1f2937", W: "#dbeafe", Y: "#fde68a", E: "#fb923c", B: "#60a5fa", S: "#38bdf8", R: "#f87171", T: "#2dd4bf", X: "#111827" };
export function stationSprite(broken: boolean): Sprite {
  const canvas = paint(broken ? STATION_BROKEN_TEMPLATE : STATION_TEMPLATE, STATION_PALETTE);
  return { canvas, cx: 20, cy: 20, scale: 3 };
}

export const BATTLESHIP_TEMPLATE = [
  "..................................................",
  "..................................................",
  "..................................................",
  "..................................................",
  "........GGGGGGGGGGGGGGGGGGG.......................",
  "........GPPPPPPPPPPPPPPPPPPG......................",
  "....DDDDPPDDDDDDDPPPPPPPPPPPG.....................",
  "EEE.KDDDPPDDDDDDDGGGGGGGGGGGGG....................",
  "EEEYKDDDPPDDDDDDDGGGGGGGGGGGGGG...................",
  "EEE.KDDDPPDDDDDDDGGGGGGGGGGGGG....................",
  "....DDDDPPDDDDDDDPPPPPPPPPPPG.....................",
  "........GPPPPPPPPPPPPPPPPPPG......................",
  "........GGGGSSSSGGGGSSSSPPG.......................",
  "............GSSG....GSSSLLLGGGGGGGG...............",
  "............GSSG....GSSSLLLLLLLLLLG...............",
  "..........GGSSSSGGGGSSSSLLSSSSSSSLG...............",
  "...DDDDGGGSSSSSSSSSSSSSSLLSSSSSSSLLGGGGGGGGGG.....",
  "EE.KDDDPPPPPPPPPPPPPPPPPLLSDDDDDSLLPPPPPKKKKKKK...",
  "EEYKDDDPPPPPPPPPPPPPPPPPLLSDWWWDSLLPPPPPPPPPPPG...",
  "EE.KDDDPPPPPPPPPPPPPPPPPLLSDWWWDSLLPWPWPPPPPPPPGG.",
  "...DDDDPPPSSSSSSSSSSSSSSLLSDWWWDSLLSWSWSSSSPPPPPPG",
  "EE.KDDDPPPPPPPPPPPPPPPPPLLSDWWWDSLLPWPWPPPPPPPPGG.",
  "EEYKDDDPPPPPPPPPPPPPPPPPLLSDWWWDSLLPPPPPPPPPPPG...",
  "EE.KDDDPPPPPPPPPPPPPPPPPLLSDDDDDSLLPPPPPKKKKKKK...",
  "...DDDDGGGSSSSSSSSSSSSSSLLSSSSSSSLLGGGGGGGGGG.....",
  "..........GGSSSSGGGGSSSSLLSSSSSSSLG...............",
  "............GSSG....GSSSLLLLLLLLLLG...............",
  "............GSSG....GSSSLLLGGGGGGGG...............",
  "........GGGGSSSSGGGGSSSSPPG.......................",
  "........GPPPPPPPPPPPPPPPPPPG......................",
  "....DDDDPPDDDDDDDPPPPPPPPPPPG.....................",
  "EEE.KDDDPPDDDDDDDGGGGGGGGGGGGG....................",
  "EEEYKDDDPPDDDDDDDGGGGGGGGGGGGGG...................",
  "EEE.KDDDPPDDDDDDDGGGGGGGGGGGGG....................",
  "....DDDDPPDDDDDDDPPPPPPPPPPPG.....................",
  "........GPPPPPPPPPPPPPPPPPPG......................",
  "........GGGGGGGGGGGGGGGGGGG.......................",
  "..................................................",
  "..................................................",
  "..................................................",
];

/** Šablona stíhače podle týmu: modří F1, červení původní, zelení F2, ostatní F3. */
export function fighterTemplate(team: number): { template: string[]; scale: number } {
  const t = ((team % 4) + 4) % 4;
  if (t === 1) return { template: FIGHTER_TEMPLATE, scale: 3 };
  if (t === 0) return { template: FIGHTER_F1, scale: 2 };
  if (t === 2) return { template: FIGHTER_F2, scale: 2 };
  return { template: FIGHTER_F3, scale: 2 };
}

export function fighterSprite(teamColor: string, team = 1): Sprite {
  const { template, scale } = fighterTemplate(team);
  const sp = paintShip(template, teamColor, scale);
  // střed: původní šablona 16×14 má střed na (7,7); nové 24×20 na (11,10)
  if (template === FIGHTER_TEMPLATE) {
    sp.cx = 7;
    sp.cy = 7;
  } else {
    sp.cx = 11;
    sp.cy = 10;
  }
  return sp;
}

/** Bitevník: jedna šablona pro všechny týmy (barva týmu), střed na (25,20). */
export function battleshipSprite(teamColor: string): Sprite {
  const sp = paintShip(BATTLESHIP_TEMPLATE, teamColor, 3);
  sp.cx = 25;
  sp.cy = 20;
  return sp;
}

/** Sprite lodi podle trupu a týmu. */
export function shipSprite(hullId: string, teamColor: string, team: number): Sprite {
  return hullId === "battleship" ? battleshipSprite(teamColor) : fighterSprite(teamColor, team);
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

/** Asteroid: tvar z paprskového profilu (krátery ho mění), se stínováním. */
export function asteroidSprite(a: Asteroid): Sprite {
  const scale = 3;
  const r = Math.ceil(a.radius / scale);
  const size = r * 2 + 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  let s = a.seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const cx = r + 1;
  const cy = r + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const rr = radiusAt(a, Math.atan2(dy, dx)) / scale;
      if (d > rr) continue;
      const light = (-dx - dy) / (Math.max(1, rr) * 1.5);
      const n = rnd();
      let base = 0.55 + light * 0.3 + (n - 0.5) * 0.15;
      if (d > rr - 1.2) base -= 0.2;
      const v = Math.max(0.2, Math.min(0.95, base));
      const g = Math.round(90 + v * 110);
      ctx.fillStyle = `rgb(${g},${Math.round(g * 0.93)},${Math.round(g * 0.82)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const craters = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < craters; i++) {
    const ang = rnd() * Math.PI * 2;
    const dd = rnd() * r * 0.6;
    const px = Math.round(cx + Math.cos(ang) * dd);
    const py = Math.round(cy + Math.sin(ang) * dd);
    if (Math.hypot(px - cx, py - cy) * scale > radiusAt(a, Math.atan2(py - cy, px - cx)) - 4) continue;
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

  /** Sprite lodi podle trupu, týmu a barvy. */
  ship(hullId: string, team: number, color: string): Sprite {
    const key = `${hullId}:${team}:${color}`;
    let s = this.fighters.get(key);
    if (!s) this.fighters.set(key, (s = shipSprite(hullId, color, team)));
    return s;
  }
  /** @deprecated stíhač bez ohledu na tým (ghosty a podobně); použij `ship`. */
  fighter(color: string, team = 1): Sprite {
    return this.ship("fighter", team, color);
  }
  /** Bílá silueta lodi (bez plamenů) – překryv vybrané lodi. */
  private silhouettes = new Map<string, Sprite>();
  shipSilhouette(hullId: string, team: number): Sprite {
    const key = `${hullId}:${team}`;
    let sil = this.silhouettes.get(key);
    if (!sil) {
      const base = shipSprite(hullId, "#ffffff", team);
      const template = hullId === "battleship" ? BATTLESHIP_TEMPLATE : fighterTemplate(team).template;
      const c = document.createElement("canvas");
      c.width = base.canvas.width;
      c.height = base.canvas.height;
      const x = c.getContext("2d")!;
      for (let yy = 0; yy < template.length; yy++) for (let xx = 0; xx < template[0].length; xx++) if (template[yy][xx] !== "." && template[yy][xx] !== "E" && template[yy][xx] !== "Y") x.fillRect(xx, yy, 1, 1);
      x.fillStyle = "#ffffff";
      x.globalCompositeOperation = "source-in";
      x.fillRect(0, 0, c.width, c.height);
      sil = { canvas: c, scale: base.scale, cx: base.cx, cy: base.cy };
      this.silhouettes.set(key, sil);
    }
    return sil;
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
  private stations = new Map<string, Sprite>();
  station(broken: boolean): Sprite {
    const key = broken ? "broken" : "ok";
    let s = this.stations.get(key);
    if (!s) this.stations.set(key, (s = stationSprite(broken)));
    return s;
  }
  asteroid(a: Asteroid): Sprite {
    const key = `${a.id}:${a.version}`;
    let s = this.asteroids.get(key);
    if (!s) {
      // starší verze téhož asteroidu zahodit
      for (const k of [...this.asteroids.keys()]) if (k.startsWith(`${a.id}:`)) this.asteroids.delete(k);
      this.asteroids.set(key, (s = asteroidSprite(a)));
    }
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
