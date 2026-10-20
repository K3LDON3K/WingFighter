/**
 * Pixel art logo WINGFIGHTER (varianta A): dvoubarevný nápis s 3D stínem, lasery a stíhač.
 * Při prvním zobrazení stíhač přiletí zleva a nápis se za ním „odkrývá“; pak je logo statické.
 * Kreslí se v rozlišení 1 px = 1 pixel loga (150×40) a zvětšuje se přes CSS (image-rendering: pixelated).
 */
const W = 150;
const H = 40;
const SHIP_X = 124;
const SHIP_Y = 21;

const FIGHTER = ["..GG............", "..GPG...........", "..GPPG..........", "EEDPPPG.........", "..GPPPPGGG......", "...GPPPPPPGGGG..", "EEDDPWWPPPPPPPGG", "EEDDPWWPPPPPPPGG", "...GPPPPPPGGGG..", "..GPPPPGGG......", "EEDPPPG.........", "..GPPG..........", "..GPG...........", "..GG............"];

function small(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

/** Ořízne antialiasing – každý pixel je buď plný, nebo prázdný. */
function crisp(c: HTMLCanvasElement) {
  const x = c.getContext("2d")!;
  const d = x.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  for (let i = 3; i < a.length; i += 4) a[i] = a[i] < 110 ? 0 : 255;
  x.putImageData(d, 0, 0);
  return c;
}

interface Grad {
  y0: number;
  y1: number;
  stops: [number, string][];
}

/** Nápis: obrys + vytažený stín + barevný přechod, vše pixelově ostré. */
function textLayer(txt: string, x0: number, y0: number, fill: Grad, stroke: string, shadow: { n: number; color: string }): HTMLCanvasElement {
  const [c, x] = small(W, H);
  const font = "8px PS2P, monospace";
  const layer = (col: string, dx: number, dy: number) => {
    const [l, lx] = small(W, H);
    lx.font = font;
    lx.textBaseline = "top";
    lx.fillStyle = col;
    lx.fillText(txt, x0 + dx, y0 + dy);
    crisp(l);
    x.drawImage(l, 0, 0);
  };
  const offs: [number, number][] = [[0, 0]];
  for (let i = 1; i <= shadow.n; i++) offs.push([i, i]);
  for (const [ox, oy] of offs)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as [number, number][]) layer(stroke, ox + dx, oy + dy);
  for (let i = shadow.n; i >= 1; i--) layer(shadow.color, i, i);
  const [m, mx] = small(W, H);
  mx.font = font;
  mx.textBaseline = "top";
  mx.fillStyle = "#fff";
  mx.fillText(txt, x0, y0);
  crisp(m);
  mx.globalCompositeOperation = "source-in";
  const g = mx.createLinearGradient(0, fill.y0, 0, fill.y1);
  for (const [p, col] of fill.stops) g.addColorStop(p, col);
  mx.fillStyle = g;
  mx.fillRect(0, 0, W, H);
  x.drawImage(m, 0, 0);
  return c;
}

function drawShip(x: CanvasRenderingContext2D, ox: number, oy: number) {
  const pal: Record<string, string> = { P: "#3b82f6", G: "#9aa3ad", D: "#4b5563", W: "#dbeafe", E: "#fb923c" };
  FIGHTER.forEach((row, yy) =>
    [...row].forEach((ch, xx) => {
      if (pal[ch]) {
        x.fillStyle = pal[ch];
        x.fillRect(ox + xx - 8, oy + yy - 7, 1, 1);
      }
    }),
  );
}

function stars(x: CanvasRenderingContext2D) {
  let s = 7;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = r() < 0.3 ? "#cbd5e1" : "#475569";
    x.fillRect(Math.floor(r() * W), Math.floor(r() * H), 1, 1);
  }
}

function laser(x: CanvasRenderingContext2D, x0: number, y: number, len: number, col: string) {
  if (len <= 0) return;
  x.fillStyle = col;
  x.fillRect(x0, y, len, 1);
  x.fillStyle = "#fff";
  x.fillRect(x0 + Math.max(0, len - 3), y, Math.min(3, len), 1);
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

import { sfx } from "./sound.ts";

let singleton: HTMLCanvasElement | null = null;
let replay: ((withSound: boolean) => void) | null = null;

/** Přehraje animaci loga znovu (se zvukem); vrací délku animace v ms. */
export function replayLogo(withSound = true): number {
  replay?.(withSound);
  return 1700;
}

/** Logo jako canvas; animace proběhne jen jednou za načtení stránky (prvek se znovu používá). */
export function logoCanvas(scale = 4, still = false): HTMLCanvasElement {
  if (singleton) {
    singleton.style.width = `${W * scale}px`;
    singleton.style.height = `${H * scale}px`;
    return singleton;
  }
  const [c, x] = small(W, H);
  c.className = "logo";
  c.style.width = `${W * scale}px`;
  c.style.height = `${H * scale}px`;
  c.setAttribute("aria-label", "Wingfighter");
  singleton = c;

  const [bg, bx] = small(W, H);
  stars(bx);
  let wing: HTMLCanvasElement | null = null;
  let fighter: HTMLCanvasElement | null = null;
  const buildText = () => {
    wing = textLayer("WING", 9, 14, { y0: 14, y1: 22, stops: [[0, "#bae6fd"], [0.5, "#38bdf8"], [1, "#0369a1"]] }, "#05070f", { n: 3, color: "#1e3a8a" });
    fighter = textLayer("FIGHTER", 47, 14, { y0: 14, y1: 22, stops: [[0, "#fde68a"], [0.5, "#f97316"], [1, "#b91c1c"]] }, "#05070f", { n: 3, color: "#7f1d1d" });
  };

  const DUR = 1500;
  // still = vykreslit rovnou konečný snímek (úvodní obrazovka), animace až na vyžádání
  let start = performance.now() - (still ? DUR * 1.3 : 0);
  let sound = false;
  let laserPlayed = false;
  let rafId = 0;
  const draw = (now: number) => {
    const t = (now - start) / DUR;
    if (sound && t >= 0.55 && !laserPlayed) {
      laserPlayed = true;
      sfx("laser");
      setTimeout(() => sfx("laser"), 90);
    }
    x.clearRect(0, 0, W, H);
    x.drawImage(bg, 0, 0);
    const shipX = -20 + (SHIP_X + 20) * ease(t);
    // nápis se odkrývá za stíhačem
    if (wing && fighter) {
      x.save();
      x.beginPath();
      x.rect(0, 0, Math.max(0, Math.floor(shipX - 6)), H);
      x.clip();
      x.drawImage(wing, 0, 0);
      x.drawImage(fighter, 0, 0);
      x.restore();
    }
    // lasery vystřelí, až stíhač prolétne
    const lt = (t - 0.55) / 0.45;
    laser(x, 10, 27, Math.round(90 * ease(lt)), "#ef4444");
    laser(x, 30, 29, Math.round(50 * ease(lt - 0.1)), "#f87171");
    // plamen za motory
    if (t < 1) {
      const flick = Math.floor(now / 60) % 2;
      x.fillStyle = flick ? "#fde047" : "#fb923c";
      x.fillRect(Math.round(shipX) - 11 - flick, SHIP_Y - 1, 3 + flick, 1);
      x.fillRect(Math.round(shipX) - 11 - flick, SHIP_Y, 3 + flick, 1);
      x.fillStyle = "#f87171";
      x.fillRect(Math.round(shipX) - 10, SHIP_Y - 4, 2, 1);
      x.fillRect(Math.round(shipX) - 10, SHIP_Y + 3, 2, 1);
    }
    drawShip(x, Math.round(shipX), SHIP_Y);
    if (t < 1.2) rafId = requestAnimationFrame(draw);
  };
  replay = (withSound) => {
    cancelAnimationFrame(rafId);
    start = performance.now();
    sound = withSound;
    laserPlayed = false;
    if (withSound) sfx("logoFly");
    rafId = requestAnimationFrame(draw);
  };

  // nejdřív počkáme na font (jinak by se nápis vykreslil náhradním písmem)
  const ready = document.fonts?.load ? document.fonts.load("8px PS2P").catch(() => undefined) : Promise.resolve();
  ready.then(() => {
    buildText();
    rafId = requestAnimationFrame(draw);
  });
  return c;
}
