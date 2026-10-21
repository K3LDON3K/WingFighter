/**
 * Vítězná animace: tři stíhače vyletí zpoza výsledkové tabulky nahoru, za sebou nechávají pruhy v barvách
 * vítězného týmu, nahoře se odkryje pixelový nápis VÍTĚZSTVÍ (stejný styl jako logo) a spustí se ohňostroj.
 * Kreslí se v nízkém rozlišení (1 px = jeden „velký“ pixel) a zvětšuje přes CSS (image-rendering: pixelated).
 */
import { sfx } from "./sound.ts";

const FIGHTER = ["..GG............", "..GPG...........", "..GPPG..........", "EEDPPPG.........", "..GPPPPGGG......", "...GPPPPPPGGGG..", "EEDDPWWPPPPPPPGG", "EEDDPWWPPPPPPPGG", "...GPPPPPPGGGG..", "..GPPPPGGG......", "EEDPPPG.........", "..GPPG..........", "..GPG...........", "..GG............"];

/** Měřítko: jeden pixel animace = PX obrazovkových pixelů. */
const PX = 4;
const DUR = 5200;

function small(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}
function crisp(c: HTMLCanvasElement) {
  const x = c.getContext("2d")!;
  const d = x.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  for (let i = 3; i < a.length; i += 4) a[i] = a[i] < 110 ? 0 : 255;
  x.putImageData(d, 0, 0);
  return c;
}

/** Nápis ve stylu loga: obrys, vytažený 3D stín, barevný přechod – vše pixelově ostré. */
function bigText(txt: string, w: number, h: number, font: string, stops: [number, string][], shadowColor: string, shadowN = 4): HTMLCanvasElement {
  const [c, x] = small(w, h);
  const layer = (col: string, dx: number, dy: number) => {
    const [l, lx] = small(w, h);
    lx.font = font;
    lx.textBaseline = "middle";
    lx.textAlign = "center";
    lx.fillStyle = col;
    lx.fillText(txt, w / 2 + dx, h / 2 + dy);
    crisp(l);
    x.drawImage(l, 0, 0);
  };
  const offs: [number, number][] = [[0, 0]];
  for (let i = 1; i <= shadowN; i++) offs.push([i, i]);
  for (const [ox, oy] of offs) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as [number, number][]) layer("#05070f", ox + dx, oy + dy);
  for (let i = shadowN; i >= 1; i--) layer(shadowColor, i, i);
  const [m, mx] = small(w, h);
  mx.font = font;
  mx.textBaseline = "middle";
  mx.textAlign = "center";
  mx.fillStyle = "#fff";
  mx.fillText(txt, w / 2, h / 2);
  crisp(m);
  mx.globalCompositeOperation = "source-in";
  const g = mx.createLinearGradient(0, h * 0.3, 0, h * 0.7);
  for (const [p, col] of stops) g.addColorStop(p, col);
  mx.fillStyle = g;
  mx.fillRect(0, 0, w, h);
  x.drawImage(m, 0, 0);
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex: string, to: [number, number, number], k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (a: number, c: number) => Math.round(a + (c - a) * k);
  return `rgb(${f(r, to[0])},${f(g, to[1])},${f(b, to[2])})`;
}

/** Stíhač mířící nahoru (šablona míří doprava → otočit o −90°), trup v barvě týmu. */
function drawShipUp(x: CanvasRenderingContext2D, cx: number, cy: number, team: string) {
  const pal: Record<string, string> = { P: team, G: "#9aa3ad", D: "#4b5563", W: "#dbeafe", E: "#fb923c" };
  FIGHTER.forEach((row, yy) =>
    [...row].forEach((ch, xx) => {
      if (!pal[ch]) return;
      // otočení: (xx, yy) → (yy, -xx)
      x.fillStyle = pal[ch];
      x.fillRect(Math.round(cx + (yy - 7)), Math.round(cy - (xx - 8)), 1, 1);
    }),
  );
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: string;
}

let active: { stop: () => void } | null = null;

/** Spustí vítěznou animaci přes celou obrazovku (pod výsledkovou tabulkou). Vrací funkci pro ukončení. */
export function playVictory(host: HTMLElement, teamColor: string, opts: { sound?: boolean; title?: string } = {}): () => void {
  active?.stop();
  const W = Math.ceil(host.clientWidth / PX) || 320;
  const H = Math.ceil(host.clientHeight / PX) || 200;
  const [c, x] = small(W, H);
  c.className = "victory-canvas";
  host.prepend(c);
  host.classList.add("celebrate");
  const title = opts.title ?? "VÍTĚZSTVÍ";
  const light = mix(teamColor, [255, 255, 255], 0.55);
  const dark = mix(teamColor, [0, 0, 0], 0.45);
  const trails = [light, teamColor, dark];
  // nápis: přechod světlá → týmová → tmavá, stín tmavý týmový
  const textW = Math.min(W, 320);
  const text = bigText(title, textW, 72, "40px Jersey, ui-monospace, monospace", [[0, light], [0.5, teamColor], [1, dark]], mix(teamColor, [0, 0, 0], 0.7));
  const sparks: Spark[] = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  const burst = (bx: number, by: number) => {
    const cols = [light, teamColor, "#fff", "#fde68a"];
    const n = 34 + Math.floor(rnd() * 16);
    const big = rnd() < 0.4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
      const v = (big ? 0.9 : 0.6) + rnd() * 1.2;
      sparks.push({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 34 + rnd() * 26, col: cols[Math.floor(rnd() * cols.length)] });
    }
  };
  // stíhače: startují pod spodním okrajem (zpoza tabulky), vedoucí uprostřed, křídla níž a do stran
  const cx = W / 2;
  const ships = [
    { dx: 0, delay: 0 },
    { dx: -26, delay: 0.08 },
    { dx: 26, delay: 0.08 },
  ];
  const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 2.2);
  const trail: { x: number; y: number; col: string; age: number }[] = [];
  let start = performance.now();
  let last = start;
  let raf = 0;
  let nextBurst = 0.42;
  let burstsLeft = 18;
  let stopped = false;
  if (opts.sound) sfx("win");
  const draw = (now: number) => {
    if (stopped) return;
    const t = (now - start) / DUR;
    const dt = Math.min(2, (now - last) / 16.7);
    last = now;
    x.clearRect(0, 0, W, H);
    // pruhy za stíhači: každý snímek přidáme bod, starší blednou a odtečou dolů
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      const tt = (t - s.delay) / 0.62;
      if (tt <= 0 || tt > 1.05) continue;
      const y = H + 12 - (H + 60) * ease(tt);
      trail.push({ x: cx + s.dx, y: y + 8, col: trails[i], age: 0 });
    }
    for (const p of trail) {
      p.age += dt;
      const alpha = Math.max(0, 1 - p.age / 90);
      if (alpha <= 0) continue;
      x.globalAlpha = alpha;
      x.fillStyle = p.col;
      x.fillRect(Math.round(p.x) - 1, Math.round(p.y), 3, 2);
    }
    x.globalAlpha = 1;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      const tt = (t - s.delay) / 0.62;
      if (tt <= 0 || tt > 1.05) continue;
      const y = H + 12 - (H + 60) * ease(tt);
      // plamen
      const flick = Math.floor(now / 60) % 2;
      x.fillStyle = flick ? "#fde047" : "#fb923c";
      x.fillRect(Math.round(cx + s.dx) - 1, Math.round(y) + 8, 2, 3 + flick);
      drawShipUp(x, cx + s.dx, y, teamColor);
    }
    // nápis: od t≈0.35 se odkrývá zdola nahoru (jako by ho stíhače „vytáhly“)
    const reveal = ease((t - 0.3) / 0.35);
    if (reveal > 0) {
      // nápis nad výsledkovou tabulkou (okno uprostřed); když je místa málo, poloviční velikost
      const card = host.querySelector<HTMLElement>(".card");
      const cardTop = card ? (card.getBoundingClientRect().top - host.getBoundingClientRect().top) / PX : H * 0.5;
      const avail = cardTop - 4;
      const sc = avail >= 68 ? 1 : avail >= 38 ? 0.5 : 0;
      if (sc > 0) {
        const th = Math.round(72 * sc);
        const tw = Math.round(textW * sc);
        const ty = Math.max(2, Math.round(cardTop - 6 - th));
        x.save();
        x.beginPath();
        x.rect(0, ty + th - Math.round(th * reveal), W, Math.round(th * reveal) + 1);
        x.clip();
        x.drawImage(text, Math.round((W - tw) / 2), ty, tw, th);
        x.restore();
      }
    }
    // ohňostroj: od t≈0.45 výbuchy v horní polovině, pak doznívají
    if (t >= nextBurst && burstsLeft > 0) {
      burst(W * (0.1 + rnd() * 0.8), H * (0.06 + rnd() * 0.5));
      burstsLeft--;
      nextBurst = t + 0.02 + rnd() * 0.04;
    }
    for (const p of sparks) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.025 * dt;
      p.vx *= 0.985;
      const k = p.life / p.max;
      if (k >= 1) continue;
      x.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      x.fillStyle = k > 0.85 ? "#64748b" : p.col;
      const sz = k < 0.55 ? 2 : 1;
      x.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
    }
    x.globalAlpha = 1;
    const sparksAlive = sparks.some((p) => p.life < p.max);
    if (t < 1 || sparksAlive) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    c.remove();
    host.classList.remove("celebrate");
    if (active?.stop === stop) active = null;
  };
  active = { stop };
  return stop;
}

/** Ladicí hák: náhled animace přes celou stránku (např. `__victory("#f87171")`). */
(window as unknown as { __victory?: (color: string) => () => void }).__victory = (color: string) => {
  let host = document.querySelector<HTMLElement>(".victory-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "victory-host";
    host.style.cssText = "position:fixed;inset:0;z-index:999;background:#05070f";
    document.body.append(host);
  }
  const stop = playVictory(host, color, { sound: false });
  return () => {
    stop();
    host?.remove();
  };
};
