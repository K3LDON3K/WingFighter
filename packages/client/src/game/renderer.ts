import { ICONS } from "../icons.ts";
import type { Segments } from "@wingfighter/shared";
import {
  shipCircles,
  hitRadiusAt,
  ASTEROID_HIT_REF,
  STATION,
  COMET,
  LASER,
  MINE,
  STRESS,
  TEAM_COLORS,
  TORPEDO,
  forward,
  maneuverPath,
  samplePath,
  type Asteroid,
  type GameState,
  type Maneuver,
  type Pose,
  RULES,
  MODULES,
  pointInStorm,
  skyThemeOf,
} from "@wingfighter/shared";
import type { Camera } from "./camera.ts";
import { segmentColor, strengthColor } from "./shield-ui.ts";
import { drawBorderStorm, drawStormBolts, drawStormClouds, drawStormSparks } from "./storm-draw.ts";
import { DIFFICULTY_COLOR } from "./planning.ts";
import { drawSprite, shade, SpriteCache } from "./sprites.ts";
import type { ViewComet, ViewDebris, ViewModel, ViewShip, ViewStation } from "./view.ts";
import { drawParallax } from "./parallax.ts";
import { parallaxEnabled } from "../display.ts";

export interface IconSpot {
  id: string;
  shipId: string;
  /** "mine" = náhled miny s polem (místo kruhové ikony). */
  kind?: "icon" | "mine";
  x: number;
  y: number;
  glyph: string;
  active: boolean;
  disabled: boolean;
  hover: boolean;
}

/** Barvy a ikonky zbraní pro značku cíle (stejné jako v liště akcí). */
const WEAPON_COLOR: Record<string, string> = { laser: "#f87171", mg: "#fde047", torpedo: "#fb923c", mine: "#fbbf24", "torpedo-in": "#fb923c", "torpedo-enemy": "#f87171" };
const WEAPON_ICON: Record<string, string> = { laser: "laser", mg: "mg", torpedo: "torpedo", mine: "mine", "torpedo-in": "torpedo", "torpedo-enemy": "torpedo" };

export interface Overlay {
  /** Ladění: vykreslit kolizní kruhy lodí. */
  showHitboxes?: boolean;
  /** Ladění: kroužek kolem vybrané lodi / při najetí myší. */
  showSelectRing?: boolean;
  selectedShipId?: string;
  hoverId?: string;
  /** Plánované dráhy vlastních lodí; `aiming` = právě se kreslí myší. */
  previews?: { ship: ViewShip; maneuver: Maneuver; aiming: boolean; fire: boolean; stopNow?: boolean; laserArcs?: { x: number; y: number; heading: number; halfArc: number; range?: number }[]; mgArcs?: { x: number; y: number; heading: number; halfArc: number; range: number }[] }[];
  /** Režim DOSAHY: další kruhy dosahu kolem vybrané lodi (každý s barvou a popiskem). */
  rangeRings?: { radius: number; label: string; color: string }[];
  /** Náhled výsečí při najetí myší na tlačítko zbraně (čárkovaně, bez zapnutí střelby). */
  hoverArcs?: { x: number; y: number; heading: number; halfArc: number; range?: number; color: string }[];
  /** Dohled vlastního týmu (fog of war). */
  vision?: { x: number; y: number; r: number }[];
  /** Kreslit slabý kruh dohledu kolem vlastních lodí. */
  visionRing?: boolean;
  /** Dosažitelné pozice při zvolené rychlosti (body obarvené náročností). */
  reachable?: { x: number; y: number; color: string }[];
  /** Věneček ikon akcí kolem konce dráhy. */
  icons?: IconSpot[];
  /** Druhý duch – kam loď skočí přídavným posunem/úskokem. */
  actionGhost?: Pose;
  /** Zvýraznit dostřel kolem lodi (žlutá kružnice) a slabší vnější dostřel. */
  rangeCircle?: { radius: number; label: string };
  rangeCircle2?: { radius: number };
  /** Dosahy skeneru (tyrkysová): sken lodi a hluboký sken. */
  scanRanges?: { ship: number; deep: number };
  /** Náhled pole miny na startovní pozici lodi. */
  mineField?: { x: number; y: number; timer?: number };
  /** Plánovaná úprava štítu vlastních lodí (platí od začátku kola) – kreslí se hned. */
  plannedSegments?: Record<string, Segments>;
  /** Některá vlastní loď je v bouři → kreslí se blesky (jinak ne, šetří výkon). */
  stormActive?: boolean;
  /** Zvolený cíl (loď / torpédo) a bod pro torpédo. */
  targetId?: string;
  targetPoint?: { x: number; y: number };
  /** Šance laserů na zásah u cíle. */
  laserOdds?: { x: number; y: number; text: string; color: string; sub?: string };
  /** Které zbraně míří na který cíl (id → zbraně); cíl dostane zaměřovací závorky a ikonky zbraní. */
  targetWeapons?: Record<string, string[]>;
  /** Cíl jen částečně ve výseči: část lodi mimo výseč se ztlumí. */
  partialTarget?: { id: string; x: number; y: number; heading: number; range: number; halfArc: number };
  /** Právě se vybírá cíl kliknutím. */
  picking?: "torpedo" | "lock";
  myTeam?: number;
  /** Plánování: kreslit předpověď dráhy komet v tomto kole. */
  cometPredict?: boolean;
  /** Předpověď skeneru: naplánované manévry nepřátelských botů (čárkovaná dráha + duch). */
  botPlans?: { ship: ViewShip; maneuver: Maneuver }[];
  /** Torpéda v letu: čára k cíli (vlastní vždy, cizí s předpovědí skeneru), `reach` = dolet v tomto kole. */
  torpedoLines?: { from: { x: number; y: number }; to: { x: number; y: number }; color: string; reach: number; enemy: boolean }[];
  /** Průběh přehrávání kola 0..1 (undefined = plánování, nic se nehýbe). */
  animating?: number;
  /** Vlastní lodě (ocas komety, který už využily, se kreslí vybledle). */
  myShipIds?: string[];
}

export const ICON_RADIUS = 13;
/** Odstup štítu od trupu lodi na mapě (herní jednotky). */
export const SHIELD_GAP = 14;

/** Deterministický generátor 0..1 z textu (tvar ocasu komety je pevný, ale pro každou jiný). */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let s = h >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

export class Renderer {
  readonly sprites = new SpriteCache();
  private stormsRef: import("@wingfighter/shared").Storm[] | null = null;
  private starPattern: CanvasPattern | null = null;
  /** Mezipaměť statické vrstvy (hvězdy, mřížka, okrajová bouře, mraky bouří) v obrazovkových pixelech. */
  private staticCanvas: HTMLCanvasElement | null = null;
  private staticKey = "";
  private onScreen: (x: number, y: number, r: number) => boolean = () => true;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {}

  draw(state: GameState, view: ViewModel, cam: Camera, overlay: Overlay, now: number, dpr = 1) {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#04060d";
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // statická vrstva: překreslí se jen při změně kamery / velikosti / mapy, jinak jen jeden drawImage
    this.stormsRef = state.storms ?? null;
    const key = `${width}x${height}|${cam.x.toFixed(2)},${cam.y.toFixed(2)},${cam.zoom.toFixed(4)}|${state.width}x${state.height}|${state.border ?? 0}|${(state.storms ?? []).map((st) => st.id).join(",")}|${parallaxEnabled() ? (state.settings.map ? (skyThemeOf(state.settings.map) ?? "none") + state.settings.map.seed : "") : "-"}`;
    if (!this.staticCanvas || this.staticKey !== key) {
      if (!this.staticCanvas) this.staticCanvas = document.createElement("canvas");
      const sc = this.staticCanvas;
      if (sc.width !== width || sc.height !== height) {
        sc.width = width;
        sc.height = height;
      }
      const sx = sc.getContext("2d")!;
      // vždy od čistého stavu (ořez a transformace z minulého překreslení nesmí zůstat)
      sx.reset?.();
      sx.setTransform(1, 0, 0, 1, 0, 0);
      sx.clearRect(0, 0, width, height);
      sx.fillStyle = "#04060d";
      sx.fillRect(0, 0, width, height);
      sx.save();
      sx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sx.scale(cam.zoom, cam.zoom);
      sx.translate(-cam.x, -cam.y);
      const saved = this.ctx;
      this.ctx = sx;
      if (state.border) {
        sx.beginPath();
        sx.ellipse(state.width / 2, state.height / 2, state.width / 2 + state.border, state.height / 2 + state.border, 0, 0, Math.PI * 2);
        sx.clip();
      }
      this.drawBackground(state, cam);
      const sky = state.settings.map ? skyThemeOf(state.settings.map) : null;
      if (parallaxEnabled() && sky) drawParallax(sx, sky, state.settings.map!.seed, state.width, state.height, cam);
      this.drawGrid(state);
      if (state.border) drawBorderStorm(sx, state.width, state.height, state.border, cam.zoom);
      if (state.storms?.length) drawStormClouds(sx, state.storms, cam.zoom);
      this.ctx = saved;
      sx.restore();
      this.staticKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.staticCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.save();
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    // za tvrdým okrajem se nekreslí vůbec nic
    if (state.border) {
      ctx.beginPath();
      ctx.ellipse(state.width / 2, state.height / 2, state.width / 2 + state.border, state.height / 2 + state.border, 0, 0, Math.PI * 2);
      ctx.clip();
    }
    // ořez na viditelný výřez: objekty mimo obraz se nekreslí (velké mapy, hodně hráčů)
    const vx0 = cam.x;
    const vy0 = cam.y;
    const vx1 = cam.x + cam.viewW / cam.zoom;
    const vy1 = cam.y + cam.viewH / cam.zoom;
    const onScreen = (x: number, y: number, r: number) => x + r >= vx0 && x - r <= vx1 && y + r >= vy0 && y - r <= vy1;
    this.onScreen = onScreen;
    if (state.storms?.length && overlay.stormActive) drawStormBolts(ctx, state.storms, now);
    for (const st of view.stations ?? []) if (onScreen(st.x, st.y, st.radius + STATION.pickupRange + 10)) this.drawStation(st, overlay, now);
    for (const a of view.asteroids) if (onScreen(a.x, a.y, a.radius + 4)) this.drawAsteroid(a, !!overlay.showHitboxes);
    for (const m of view.mines) if (onScreen(m.x, m.y, m.radius + 20)) this.drawMine(m, now);
    this.marks = [];
    for (const d of view.debris) if (onScreen(d.x, d.y, 60)) this.drawDebris(d, overlay, now);
    for (const c of view.comets) if (onScreen(c.x, c.y, c.radius + COMET.tailLength + 40)) this.drawComet(c, overlay, now);

    const sel = overlay.selectedShipId ? view.ships.find((x) => x.id === overlay.selectedShipId) : undefined;
    if (sel && overlay.rangeCircle2) this.drawRange(sel, overlay.rangeCircle2.radius, "rgba(251,191,36,0.35)", "");
    if (sel && overlay.rangeCircle) this.drawRange(sel, overlay.rangeCircle.radius, "#fbbf24", overlay.rangeCircle.label);
    if (sel) for (const r of overlay.rangeRings ?? []) this.drawRange(sel, r.radius, r.color, r.label, 0.7, 1.5);
    if (sel && overlay.scanRanges) {
      ctx.save();
      ctx.fillStyle = "rgba(45,212,191,0.07)";
      ctx.beginPath();
      ctx.arc(sel.x, sel.y, overlay.scanRanges.ship, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.drawRange(sel, overlay.scanRanges.ship, "#2dd4bf", `sken lodi ${overlay.scanRanges.ship}`, 0.9, 2.5);
      this.drawRange(sel, overlay.scanRanges.deep, "#5eead4", `hluboký sken ${overlay.scanRanges.deep}`, 0.7, 2);
    }
    if (overlay.mineField) this.drawMine({ ...overlay.mineField, radius: MINE.radius, team: sel?.team ?? 0, armed: false }, now);
    if (overlay.reachable) {
      for (const d of overlay.reachable) {
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(d.x - 2, d.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    }
    for (const p of overlay.previews ?? []) this.drawPreview(p.ship, p.maneuver, p.aiming, p.fire, p.laserArcs, p.mgArcs, p.stopNow);
    for (const a of overlay.hoverArcs ?? []) this.drawArc({ x: a.x, y: a.y, heading: a.heading }, a.color, a.range ?? LASER.range, a.halfArc, true);
    for (const p of overlay.botPlans ?? []) this.drawBotPlan(p.ship, p.maneuver);
    for (const l of overlay.torpedoLines ?? []) this.drawTorpedoLine(l);

    for (const t of view.torpedoes) {
      // plamen motoru
      const f = forward(t.heading);
      ctx.save();
      // délka plamene podle rychlosti (výlet/zaměření = krátký, let = dlouhý); ztracený cíl = bledý plamen
      const thrust = Math.max(0.25, Math.min(1, (t.speed ?? TORPEDO.speed) / Math.max(1, TORPEDO.speed)));
      ctx.globalAlpha = (0.5 + 0.5 * Math.abs(Math.sin(now / 40 + t.x))) * (t.lost ? 0.5 : 1);
      ctx.fillStyle = t.phase === "cruise" ? "#fbbf24" : "#fb923c";
      ctx.beginPath();
      ctx.moveTo(t.x - f.x * 8 - f.y * 2, t.y - f.y * 8 + f.x * 2);
      ctx.lineTo(t.x - f.x * (8 + (8 + 6 * Math.random()) * thrust * 1.6), t.y - f.y * (8 + (8 + 6 * Math.random()) * thrust * 1.6));
      ctx.lineTo(t.x - f.x * 8 + f.y * 2, t.y - f.y * 8 - f.x * 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      drawSprite(ctx, this.sprites.torpedo(TEAM_COLORS[t.team]), t.x, t.y, t.heading);
      if (t.targetPoint && (t.team === overlay.myTeam || overlay.myTeam === undefined)) this.drawPointMarker(t.targetPoint, TEAM_COLORS[t.team], 0.5);
      const tw = overlay.targetWeapons?.[t.id];
      if (tw?.length) this.marks.push({ x: t.x, y: t.y, r: 8, weapons: tw });
      else if (overlay.targetId === t.id || overlay.hoverId === t.id) {
        ctx.save();
        ctx.strokeStyle = overlay.targetId === t.id ? "#fbbf24" : "rgba(248,250,252,0.5)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const s of view.ships) if (this.onScreen(s.x, s.y, s.radius + 120)) this.drawShip(s, overlay, now);
    if (overlay.showHitboxes) this.drawHitboxes(view);
    if (overlay.targetPoint) this.drawPointMarker(overlay.targetPoint, "#fbbf24", 1, now);
    if (overlay.actionGhost && sel) {
      drawSprite(ctx, this.sprites.ship(sel.hullId, sel.team, TEAM_COLORS[sel.team]), overlay.actionGhost.x, overlay.actionGhost.y, overlay.actionGhost.heading, 0.3);
    }
    for (const e of view.effects) this.drawEffect(e, view, now);
    for (const mk of this.marks) this.drawTargetMark(mk.x, mk.y, mk.r, mk.weapons);
    this.marks = [];
    if (overlay.laserOdds) {
      const lo = overlay.laserOdds;
      ctx.save();
      ctx.font = "15px Jersey, ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      const w = ctx.measureText(lo.text).width + 10;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(lo.x - w / 2, lo.y + 22, w, 14);
      ctx.strokeStyle = lo.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(lo.x - w / 2, lo.y + 22, w, 14);
      ctx.fillStyle = lo.color;
      ctx.fillText(lo.text, lo.x, lo.y + 32);
      if (lo.sub) {
        ctx.font = "11px Jersey, ui-monospace, Menlo, monospace";
        const w2 = ctx.measureText(lo.sub).width + 8;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(lo.x - w2 / 2, lo.y + 37, w2, 12);
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText(lo.sub, lo.x, lo.y + 46);
      }
      ctx.restore();
    }
    if (overlay.vision) this.drawFog(overlay.vision, cam);
    if (overlay.vision && overlay.visionRing) {
      ctx.save(); // stále ve světových souřadnicích
      ctx.strokeStyle = "rgba(148,163,184,0.28)";
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.setLineDash([6 / cam.zoom, 10 / cam.zoom]);
      for (const v of overlay.vision) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (overlay.icons) this.drawIcons(overlay.icons, cam);

    ctx.restore();
  }

  private fogCanvas: HTMLCanvasElement | null = null;
  private fogKey = "";

  /** Fog of war: ztmaví vše mimo dohled vlastních lodí. */
  private drawFog(vision: { x: number; y: number; r: number }[], cam: Camera) {
    const ctx = this.ctx;
    const w = Math.ceil(cam.viewW);
    const h = Math.ceil(cam.viewH);
    if (!this.fogCanvas) this.fogCanvas = document.createElement("canvas");
    const fc = this.fogCanvas;
    if (fc.width !== w || fc.height !== h) {
      fc.width = w;
      fc.height = h;
    }
    // mlha se přepočítá jen při změně kamery nebo dohledu (jinak jen jeden drawImage)
    const key = `${w}x${h}|${cam.x.toFixed(2)},${cam.y.toFixed(2)},${cam.zoom.toFixed(4)}|${vision.map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.r}`).join(";")}`;
    if (this.fogKey !== key) {
      this.fogKey = key;
      const f = fc.getContext("2d")!;
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.globalCompositeOperation = "source-over";
      f.clearRect(0, 0, w, h);
      f.fillStyle = "rgba(2,4,10,0.78)";
      f.fillRect(0, 0, w, h);
      f.globalCompositeOperation = "destination-out";
      for (const v of vision) {
        const c = cam.toScreen(v.x, v.y);
        const r = v.r * cam.zoom;
        const grad = f.createRadialGradient(c.x, c.y, r * 0.85, c.x, c.y, r);
        grad.addColorStop(0, "rgba(0,0,0,1)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        f.fillStyle = grad;
        f.beginPath();
        f.arc(c.x, c.y, r, 0, Math.PI * 2);
        f.fill();
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = this.canvas.width / w;
    ctx.scale(dpr, dpr);
    ctx.drawImage(fc, 0, 0);
    ctx.restore();
    // hranice dohledu
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.25)";
    ctx.setLineDash([4, 8]);
    ctx.lineWidth = 1;
    for (const v of vision) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBackground(state: GameState, cam: Camera) {
    const ctx = this.ctx;
    if (!this.starPattern) this.starPattern = ctx.createPattern(this.sprites.stars, "repeat");
    const vw = cam.viewW / cam.zoom;
    const vh = cam.viewH / cam.zoom;
    if (parallaxEnabled()) {
      // hvězdy patří do vzdálené vrstvy: dvě hloubky – matné daleké (skoro se nehýbou) a jasnější bližší
      const layer = (depth: number, alpha: number, scale: number, shift: number) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cam.x, cam.y, vw, vh);
        ctx.clip();
        // paralaxa dlaždicového vzoru: posun počátku vzoru o (1 − hloubka) pohybu kamery
        ctx.translate(cam.x * (1 - depth) + shift, cam.y * (1 - depth) + shift);
        ctx.scale(scale, scale);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.starPattern!;
        const x0 = (cam.x - cam.x * (1 - depth) - shift) / scale;
        const y0 = (cam.y - cam.y * (1 - depth) - shift) / scale;
        ctx.fillRect(x0 - 2, y0 - 2, vw / scale + 4, vh / scale + 4);
        ctx.restore();
      };
      layer(0.12, 0.4, 0.7, 37);
      layer(0.3, 0.85, 1, 0);
    } else {
      // bez vzdáleného pozadí: nehybné hvězdy jako dřív
      ctx.save();
      ctx.fillStyle = this.starPattern!;
      ctx.fillRect(cam.x, cam.y, vw, vh);
      ctx.restore();
    }
    // hrací plocha je ovál
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(state.width / 2, state.height / 2, state.width / 2, state.height / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawGrid(state: GameState) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(state.width / 2, state.height / 2, state.width / 2, state.height / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(148,163,184,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= state.width; x += 100) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, state.height);
    }
    for (let y = 0; y <= state.height; y += 100) {
      ctx.moveTo(0, y);
      ctx.lineTo(state.width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Ladění: kolizní obrysy torpéd, min a komet (ocas = obdélník sběru bonusu). Lodě a asteroidy mají obrys u sebe. */
  private drawHitboxes(view: ViewModel) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(248,113,113,0.95)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 3]);
    for (const t of view.torpedoes) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, TORPEDO.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const m of view.mines) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const c of view.comets) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.stroke();
      // ocas: obdélník za jádrem (délka × šířka), kde se sbírá bonus
      const f = { x: Math.cos(c.heading), y: Math.sin(c.heading) };
      const n = { x: -f.y, y: f.x };
      const w = COMET.tailWidth / 2;
      const a0 = c.radius;
      const a1 = c.radius + COMET.tailLength;
      ctx.strokeStyle = "rgba(103,232,249,0.8)";
      ctx.beginPath();
      ctx.moveTo(c.x - f.x * a0 + n.x * w, c.y - f.y * a0 + n.y * w);
      ctx.lineTo(c.x - f.x * a1 + n.x * w, c.y - f.y * a1 + n.y * w);
      ctx.lineTo(c.x - f.x * a1 - n.x * w, c.y - f.y * a1 - n.y * w);
      ctx.lineTo(c.x - f.x * a0 - n.x * w, c.y - f.y * a0 - n.y * w);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = "rgba(248,113,113,0.9)";
    }
    ctx.restore();
  }

  /** Vesmírná stanice: pomalu se otáčí (i mimo přehrávání), funkční má tyrkysový štít; čárkovaný okruh sběru; lišta trupu po poškození. */
  private drawStation(st: ViewStation, overlay: Overlay, now: number) {
    const ctx = this.ctx;
    // okruh sběru
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.radius + STATION.pickupRange, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const heading = ((now / 24000) * Math.PI * 2) % (Math.PI * 2) * (st.broken ? 0.4 : 1);
    drawSprite(ctx, this.sprites.station(st.broken), st.x, st.y, heading);
    if (!st.broken && st.maxShields > 0) {
      const f = st.shields / st.maxShields;
      ctx.save();
      ctx.strokeStyle = "#2dd4bf";
      ctx.globalAlpha = 0.25 + 0.6 * f;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.radius + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (overlay.showHitboxes) {
      ctx.save();
      ctx.strokeStyle = "rgba(248,113,113,0.9)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(st.x, st.y, (st.radius * ASTEROID_HIT_REF.pct) / 100, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // popisek + stav
    ctx.save();
    ctx.font = "12px Jersey, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = st.broken ? "#94a3b8" : "#a5f3fc";
    ctx.fillText(st.broken ? "ROZBITÁ STANICE" : "STANICE", st.x, st.y - st.radius - 22);
    if (!st.broken && st.hull < st.maxHull) {
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(st.x - 30, st.y - st.radius - 18, 60, 5);
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(st.x - 30, st.y - st.radius - 18, (60 * st.hull) / st.maxHull, 5);
    }
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px Jersey, ui-monospace, Menlo, monospace";
    ctx.fillText(`moduly ${st.stock}`, st.x, st.y + st.radius + 22);
    ctx.restore();
    const weapons = overlay.targetWeapons?.[st.id];
    if (weapons?.length) this.marks.push({ x: st.x, y: st.y, r: st.radius, weapons });
    else if (overlay.targetId === st.id || overlay.hoverId === st.id) {
      ctx.save();
      ctx.strokeStyle = overlay.targetId === st.id ? "#fbbf24" : "rgba(248,250,252,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawAsteroid(a: Asteroid, hitbox = false) {
    drawSprite(this.ctx, this.sprites.asteroid(a), a.x, a.y, 0);
    if (!hitbox) return;
    // ladění: kolizní obrys (o pár % menší než obrázek)
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(248,113,113,0.95)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const n = a.profile.length;
    for (let i = 0; i <= n; i++) {
      const ang = ((i % n) / n) * Math.PI * 2;
      const r = hitRadiusAt(a, ang);
      const x = a.x + Math.cos(ang) * r;
      const y = a.y + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawMine(m: { x: number; y: number; radius: number; team: number; armed: boolean; timer?: number }, now: number) {
    const ctx = this.ctx;
    const color = TEAM_COLORS[m.team];
    ctx.save();
    ctx.globalAlpha = m.armed ? 0.18 : 0.08;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    drawSprite(ctx, this.sprites.mine(color), m.x, m.y, 0);
    if (m.armed && Math.floor(now / 400) % 2 === 0) {
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
    }
    if (m.timer !== undefined) {
      ctx.save();
      ctx.font = "14px Jersey, ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(`T-${m.timer}`, m.x, m.y - 14);
      ctx.restore();
    }
  }

  /** Pixelová ikonka (z icons.ts) na plátně: 8×8 buněk o velikosti `s`. */
  private drawPixelIcon(name: string, cx: number, cy: number, s: number, color: string) {
    const ctx = this.ctx;
    const rows = ICONS[name] ?? ICONS.target;
    ctx.fillStyle = color;
    // sousední pixely na sebe navazují (bez mezer při neceločíselném měřítku)
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== "#") return;
        const x0 = Math.round(cx - 4 * s + x * s);
        const y0 = Math.round(cy - 4 * s + y * s);
        ctx.fillRect(x0, y0, Math.round(cx - 4 * s + (x + 1) * s) - x0, Math.round(cy - 4 * s + (y + 1) * s) - y0);
      }),
    );
  }

  /**
   * Značka cíle (varianta D): čtyři rohové závorky v barvě zbraně (více zbraní = žlutá) a v pravém horním rohu
   * plné čtverečky s ikonkami všech zbraní, které na cíl míří.
   */
  /** Značky cílů se kreslí až nad vším ostatním (lodě, štíty, efekty), aby ikonky zbraní nic nepřekrývalo. */
  private marks: { x: number; y: number; r: number; weapons: string[] }[] = [];

  private drawTargetMark(x: number, y: number, r: number, weapons: string[]) {
    const ctx = this.ctx;
    const R = r + 6;
    // "laser#2" = druhý laser (číslo se vykreslí do rohu ikony)
    const base = (w: string) => w.split("#")[0];
    const col = weapons.length === 1 ? WEAPON_COLOR[base(weapons[0])] ?? "#fbbf24" : "#fbbf24";
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(x + dx * R, y + dy * (R - 7));
      ctx.lineTo(x + dx * R, y + dy * R);
      ctx.lineTo(x + dx * (R - 7), y + dy * R);
      ctx.stroke();
    }
    const s = 1.4;
    weapons.forEach((w, i) => {
      const bx = x + R + i * (14 * s + 2);
      const by = y - R;
      const [kind, num] = w.split("#");
      const wc = WEAPON_COLOR[kind] ?? "#fbbf24";
      ctx.fillStyle = wc;
      ctx.fillRect(bx - 7 * s, by - 7 * s, 14 * s, 14 * s);
      this.drawPixelIcon(WEAPON_ICON[kind] ?? kind, bx, by, s, "#0b1020");
      if (num) {
        // číslo modulu v rohu ikony
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(bx + 7 * s - 9, by + 7 * s - 10, 9, 10);
        ctx.fillStyle = "#ffffff";
        ctx.font = "10px Jersey, ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText(num, bx + 7 * s - 4.5, by + 7 * s - 1);
      }
    });
    ctx.restore();
  }

  private drawPointMarker(p: { x: number; y: number }, color: string, alpha: number, now = 0) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const r = 10 + (now ? 3 * Math.sin(now / 200) : 0);
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y);
    ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x, p.y + r);
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, TORPEDO.blastRadius, 0, Math.PI * 2);
    ctx.globalAlpha = alpha * 0.5;
    ctx.stroke();
    ctx.restore();
  }

  /** Vyhozený modul: pomalu rotující šedý blok s ikonou; jde zaměřit lasery. */
  /** Kometa (ledová, varianta C): zóna ocasu, pixelový ohon s krystaly, kámen, předpověď dráhy. */
  private drawComet(c: ViewComet, overlay: Overlay, now: number) {
    const ctx = this.ctx;
    const f = forward(c.heading);
    const n = { x: -f.y, y: f.x };
    const L = COMET.tailLength;
    const W = COMET.tailWidth;
    const used = overlay.myShipIds?.length ? overlay.myShipIds.every((id) => c.tailUsed.includes(id)) : false;
    // ocas: mírně zvlněný (malá sinusoida podél osy, fáze pro každou kometu jiná) – bez animace
    const rnd = seeded(c.id);
    const phase = rnd() * Math.PI * 2;
    const amp = 5; // amplituda vlny (herní jednotky)
    const waves = 1.6; // počet period na délku ocasu
    // ocas se kývá jako vlajka jen během pohybu (animace kola); při plánování stojí – obálka sin(π·p) kývání plynule rozjede i zastaví
    const env = overlay.animating === undefined ? 0 : Math.sin(Math.PI * overlay.animating);
    const sway = 1 + env * (Math.sin((now / 1000) * 2.4 + phase) - 1);
    const axisY = (k: number) => Math.sin(phase + k * waves * Math.PI * 2) * amp * (0.3 + k) * sway;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.heading);
    const steps = 16;
    const top: { x: number; y: number }[] = [];
    const bot: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      // šířka: u jádra užší, v první třetině plná, ke konci se zužuje
      const half = (W / 2) * (k < 0.3 ? 0.5 + k * 1.67 : 1 - (k - 0.3) * 0.85);
      const x = -c.radius - k * L;
      const y = axisY(k);
      top.push({ x, y: y - half });
      bot.push({ x, y: y + half });
    }
    ctx.beginPath();
    ctx.moveTo(-c.radius * 0.6, 0);
    for (const p of top) ctx.lineTo(p.x, p.y);
    ctx.lineTo(-c.radius - L - 8, axisY(1));
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
    ctx.fillStyle = used ? "rgba(148,163,184,0.06)" : "rgba(103,232,249,0.10)";
    ctx.fill();
    ctx.strokeStyle = used ? "rgba(148,163,184,0.25)" : "rgba(103,232,249,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    // pixelový ohon: jasná osa sleduje vlnu + krystaly po stranách
    const step = 4;
    const cnt = Math.floor(L / step);
    for (let i = 0; i < cnt; i++) {
      const x = -c.radius - i * step;
      const k = i / cnt;
      const y = Math.round(axisY(k));
      ctx.fillStyle = k < 0.3 ? "#f0f9ff" : k < 0.6 ? "#a5f3fc" : "#0e7490";
      ctx.globalAlpha = (used ? 0.4 : 1) * (1 - k * 0.6);
      ctx.fillRect(x, y - 2, step, k < 0.5 ? 4 : 3);
      if (i % 3 === 0 && i % 2 === 0) {
        ctx.fillStyle = "#67e8f9";
        const off = 4 + (i % 4) * 2 + k * (W / 2 - 10);
        ctx.fillRect(x, y - off - 2, 3, 3);
        ctx.fillRect(x + 2, y + off, 3, 3);
      }
      if (i > 10 && i % 5 === 0) {
        ctx.fillStyle = "#164e63";
        ctx.fillRect(x - 1, y - W / 2 + 6 + (i % 4) * 3, 3, 3);
        ctx.fillRect(x + 1, y + W / 2 - 9 - (i % 3) * 3, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // jádro: pixelový kámen
    const ROCK = ["...###...", ".#######.", ".##L####.", "###LL####", "####K####", "####KK###", ".###KK##.", ".#######.", "...###..."];
    const pal: Record<string, string> = { "#": "#a8a29e", L: "#f5f5f4", K: "#57534e" };
    const px = (c.radius * 2) / 9;
    ctx.save();
    ctx.translate(c.x, c.y); // jádro se neotáčí
    ROCK.forEach((row, yy) =>
      [...row].forEach((ch, xx) => {
        const col = pal[ch];
        if (!col) return;
        ctx.fillStyle = col;
        ctx.fillRect((xx - 4.5) * px, (yy - 4.5) * px, px + 0.5, px + 0.5);
      }),
    );
    ctx.restore();
    // odolnost (jen pokud je poškozená)
    if (c.hull < c.maxHull) {
      ctx.save();
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(c.x - 12, c.y + c.radius + 4, 24, 3);
      ctx.fillStyle = "#67e8f9";
      ctx.fillRect(c.x - 12, c.y + c.radius + 4, (24 * c.hull) / c.maxHull, 3);
      ctx.restore();
    }
    // předpověď dráhy v tomto kole
    if (overlay.cometPredict) {
      ctx.save();
      ctx.strokeStyle = "rgba(165,243,252,0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(c.x + f.x * c.radius, c.y + f.y * c.radius);
      ctx.lineTo(c.x + f.x * c.speed, c.y + f.y * c.speed);
      ctx.stroke();
      ctx.setLineDash([]);
      const tip = { x: c.x + f.x * c.speed, y: c.y + f.y * c.speed };
      ctx.fillStyle = "rgba(165,243,252,0.7)";
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - f.x * 8 + n.x * 4, tip.y - f.y * 8 + n.y * 4);
      ctx.lineTo(tip.x - f.x * 8 - n.x * 4, tip.y - f.y * 8 - n.y * 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const targeted = overlay.targetId === c.id;
    const hovered = overlay.hoverId === c.id;
    const cw = overlay.targetWeapons?.[c.id];
    if (cw?.length) this.marks.push({ x: c.x, y: c.y, r: c.radius, weapons: cw });
    else if (targeted || hovered) {
      ctx.save();
      ctx.strokeStyle = targeted ? "#fbbf24" : "rgba(248,250,252,0.6)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.font = "12px Jersey, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#a5f3fc";
    ctx.fillText(`KOMETA${targeted ? " · CIL" : ""}`, c.x, c.y - c.radius - 6);
    ctx.restore();
  }

  private drawDebris(d: ViewDebris, overlay: Overlay, now: number) {
    const ctx = this.ctx;
    const targeted = overlay.targetId === d.id;
    const hovered = overlay.hoverId === d.id;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(now / 2500 + d.x);
    // zničený modul je načervenalý
    const broken = !!d.module && (d.module.hp ?? 1) <= 0;
    ctx.fillStyle = broken ? "#7f1d1d" : "#475569";
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = broken ? "#dc8a8a" : "#94a3b8";
    ctx.fillRect(-5, -5, 10, 10);
    ctx.fillStyle = TEAM_COLORS[d.team];
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
    const dw = overlay.targetWeapons?.[d.id];
    if (dw?.length) this.marks.push({ x: d.x, y: d.y, r: 8, weapons: dw });
    else if (targeted || hovered) {
      ctx.save();
      ctx.strokeStyle = targeted ? "#fbbf24" : "rgba(248,250,252,0.6)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(d.x, d.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.font = "12px Jersey, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`${MODULES[d.type]?.short ?? "?"} +${d.value}`, d.x, d.y + 22);
    ctx.restore();
  }

  /** Tvar štítu: stíhač kruh, bitevník elipsa protažená ve směru letu (otáčí se s lodí). */
  private shieldShape(s: ViewShip): { rx: number; ry: number } {
    const GAP = SHIELD_GAP;
    if (s.hullId === "battleship") return { rx: s.radius + GAP + 24, ry: s.radius + GAP - 6 };
    return { rx: s.radius + GAP, ry: s.radius + GAP };
  }

  /** Štít na mapě: energetický = elipsa/kruh obarvený podle síly; segmentový = 4 oblouky otáčející se s lodí. */
  private drawShield(s: ViewShip, now: number, planned?: Segments) {
    const ctx = this.ctx;
    // loď bez štítu (žádný funkční modul štítu): nic nekreslit
    if (s.shieldType === "none") return;
    const { rx, ry } = this.shieldShape(s);
    if (this.stormsRef && pointInStorm(this.stormsRef, s)) {
      // v bouři štít nefunguje: jen slabý fialový tečkovaný obrys tam, kde býval
      ctx.save();
      ctx.strokeStyle = "rgba(168,85,247,0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rx, ry, s.heading, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (s.shieldType === "whole") {
      if (s.shields <= 0) return;
      const frac = s.shields / Math.max(1, s.maxShields);
      const col = strengthColor(frac);
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.1 * frac;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rx, ry, s.heading, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.45 + 0.35 * frac;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -now / 60;
      ctx.stroke();
      ctx.restore();
      return;
    }
    const half = (40 * Math.PI) / 180;
    ctx.save();
    ctx.lineWidth = 3;
    const segs = planned ?? s.segments;
    for (let i = 0; i < 4; i++) {
      const hp = segs[i] ?? 0;
      // oblouky v souřadnicích lodi (elipsa se otáčí s lodí): předek 0, pravobok 90°, záď 180°, levobok 270°
      const mid = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rx, ry, s.heading, mid - half, mid + half);
      if (hp <= 0) {
        ctx.strokeStyle = "rgba(239,68,68,0.35)";
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = segmentColor(hp);
        ctx.setLineDash([]);
        ctx.lineWidth = hp >= 3 ? 6.5 : 3; // 3 vrstvy = výrazně silnější čára
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawShip(s: ViewShip, overlay: Overlay, now: number) {
    const ctx = this.ctx;
    const color = TEAM_COLORS[s.team];
    const selected = overlay.selectedShipId === s.id;
    const hovered = overlay.hoverId === s.id;
    const targeted = overlay.targetId === s.id;

    const weapons = overlay.targetWeapons?.[s.id];
    if (weapons?.length) this.marks.push({ x: s.x, y: s.y, r: s.radius, weapons });
    else if (targeted || ((selected || hovered) && overlay.showSelectRing)) {
      // kroužek cíle vždy; kroužek výběru / najetí jen když je zapnutý v ladění → Zobrazení
      ctx.save();
      ctx.strokeStyle = targeted ? "#fbbf24" : selected ? "#f8fafc" : "rgba(248,250,252,0.5)";
      ctx.lineWidth = selected || targeted ? 2 : 1;
      ctx.setLineDash(targeted ? [4, 4] : []);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawShield(s, now, overlay.plannedSegments?.[s.id]);

    const f = forward(s.heading);
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 90 + s.x);
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.arc(s.x - f.x * (s.radius + 4), s.y - f.y * (s.radius + 4), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (s.evading) {
      // varianta E: poloprůhledná loď se sudovým překrutem, pulzující modrý obrys a jiskry
      const roll = s.roll ?? 0;
      const squash = 0.35 + 0.65 * Math.abs(Math.cos(roll));
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.heading);
      ctx.scale(1, squash * (Math.cos(roll) < 0 ? -1 : 1));
      ctx.rotate(-s.heading);
      // bledé kopie (motion blur) za lodí
      const f2 = forward(s.heading);
      for (let i = 1; i <= 2; i++) drawSprite(ctx, this.sprites.ship(s.hullId, s.team, color), -f2.x * i * 9, -f2.y * i * 9, s.heading, 0.12);
      drawSprite(ctx, this.sprites.ship(s.hullId, s.team, color), 0, 0, s.heading, 0.55);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "#7dd3fc";
      ctx.globalAlpha = 0.45 + 0.4 * Math.sin(now / 70);
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#bae6fd";
      for (let i = 0; i < 5; i++) {
        const a = now / 120 + (i * Math.PI * 2) / 5;
        const rr = s.radius + 4 + 6 * Math.sin(now / 90 + i);
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 60 + i * 2);
        ctx.fillRect(s.x + Math.cos(a) * rr - 1, s.y + Math.sin(a) * rr - 1, 2, 2);
      }
      ctx.restore();
    } else drawSprite(ctx, this.sprites.ship(s.hullId, s.team, color), s.x, s.y, s.heading);
    const pt = overlay.partialTarget;
    if (pt && pt.id === s.id) {
      // část cíle mimo výseč laseru/kulometu ztlumíme (evenodd: čtverec kolem lodi minus výseč)
      const R = s.radius + 10;
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x - R, s.y - R, 2 * R, 2 * R);
      ctx.moveTo(pt.x, pt.y);
      ctx.arc(pt.x, pt.y, pt.range, pt.heading - pt.halfArc, pt.heading + pt.halfArc);
      ctx.closePath();
      ctx.clip("evenodd");
      ctx.fillStyle = "rgba(5,7,15,0.65)";
      ctx.fillRect(s.x - R, s.y - R, 2 * R, 2 * R);
      ctx.restore();
    }
    // vybraná vlastní loď: pulzující bílý překryv siluety (varianta A)
    if (selected && s.alive) drawSprite(ctx, this.sprites.shipSilhouette(s.hullId, s.team), s.x, s.y, s.heading, 0.3 + 0.2 * Math.sin(now / 260));
    if (overlay.showHitboxes) {
      // ladění: kolizní model (kruhy v souřadnicích lodi) – přes sprite, ať je vidět
      ctx.save();
      ctx.strokeStyle = "rgba(74,222,128,0.95)";
      ctx.fillStyle = "rgba(74,222,128,0.12)";
      ctx.lineWidth = 2;
      for (const c of shipCircles(s, s.colliders)) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    if (this.stormsRef && pointInStorm(this.stormsRef, s)) drawStormSparks(ctx, s.x, s.y, s.radius, now);

    ctx.save();
    ctx.font = "13px Jersey, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(248,250,252,0.9)";
    const top = s.radius + SHIELD_GAP + 4; // nad štítem
    ctx.fillText(s.name, s.x, s.y - top - 10);
    {
      // značky vedle jména: naskenovaná cizí loď (tým ji může hackovat), hacknutý systém (vidí jen tým hackera)
      const tw = ctx.measureText(s.name).width;
      let mx = s.x + tw / 2 + 10;
      if (s.scanned) { this.drawPixelIcon("scan", mx, s.y - top - 14, 1.2, "#a5f3fc"); mx += 16; }
      if (s.hacked) this.drawPixelIcon("hack", mx, s.y - top - 14, 1.2, "#f87171");
    }
    const bw = 34;
    const bx = s.x - bw / 2;
    const by = s.y - top - 6;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    const segTotal = s.segments[0] + s.segments[1] + s.segments[2] + s.segments[3];
    const sw = s.shieldType === "segment" ? (bw * Math.min(1, segTotal / (4 * RULES.segmentHp))) : s.maxShields > 0 ? (bw * s.shields) / s.maxShields : 0;
    ctx.fillStyle = this.stormsRef && pointInStorm(this.stormsRef, s) ? "rgba(96,165,250,0.3)" : "#60a5fa";
    ctx.fillRect(bx, by, sw, 2);
    const hw = (bw * s.hull) / Math.max(1, s.maxHull);
    ctx.fillStyle = s.hull <= s.maxHull * 0.3 ? "#ef4444" : "#22c55e";
    ctx.fillRect(bx, by + 3, hw, 2);
    // stresové body (jen vlastní tým vidí detail; ostatní také – informace není tajná)
    for (let i = 0; i < (s.stressMax ?? STRESS.max); i++) {
      ctx.fillStyle = i < s.stressPoints ? "#f472b6" : "rgba(244,114,182,0.25)";
      ctx.fillRect(s.x + s.radius + SHIELD_GAP + 4 + i * 5, s.y - top - 4, 3, 3);
    }
    let tx = s.x + s.radius + SHIELD_GAP + 4;
    const ty = s.y - s.radius + 2;
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    if (s.tokens.focus) {
      ctx.fillStyle = "#4ade80";
      ctx.fillText("◎", tx, ty);
      tx += 10;
    }
    if (s.tokens.evade) {
      ctx.fillStyle = "#86efac";
      ctx.fillText("◇", tx, ty);
      tx += 10;
    }
    if (s.lockTargetId) {
      ctx.fillStyle = "#fbbf24";
      ctx.fillText("⌖", tx, ty);
    }
    ctx.restore();
  }

  drawArc(p: Pose, color: string, range = LASER.range, halfArc = LASER.halfArc, hover = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = hover ? 0.08 : 0.14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, range, p.heading - halfArc, p.heading + halfArc);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = hover ? 0.9 : 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = hover ? 2 : 1;
    if (hover) ctx.setLineDash([6, 5]);
    ctx.stroke();
    if (hover) {
      // popisek dostřelu u oblouku
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.95;
      ctx.font = "13px Jersey, ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      const lx = p.x + Math.cos(p.heading) * (range + 14);
      const ly = p.y + Math.sin(p.heading) * (range + 14);
      ctx.fillText(`DOSTŘEL ${range}`, lx, ly + 4);
      ctx.restore();
      return;
    }
    ctx.globalAlpha = 0.25;
    for (let b = 1; b < 3; b++) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, LASER.band * b, p.heading - halfArc, p.heading + halfArc);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRange(s: ViewShip, range: number, color: string, label: string, alpha = 0.5, width = 1.5) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(s.x, s.y, range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "14px Jersey, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label.toUpperCase(), s.x, s.y - range - 6);
    ctx.restore();
  }

  private drawPreview(ship: ViewShip, man: Maneuver, aiming: boolean, fire: boolean, laserArcs?: { x: number; y: number; heading: number; halfArc: number; range?: number }[], mgArcs?: { x: number; y: number; heading: number; halfArc: number; range: number }[], stopBadge = false) {
    const ctx = this.ctx;
    const color = TEAM_COLORS[ship.team];
    if (man.speed === 0 && !man.koiogran) {
      // stojící loď: jen výseče zbraní, žádná dráha ani duch; při zastavení hned odznak stopky u lodi
      for (const a of laserArcs ?? []) this.drawArc({ x: a.x, y: a.y, heading: a.heading }, color, a.range ?? LASER.range, a.halfArc);
      for (const a of mgArcs ?? []) this.drawArc({ x: a.x, y: a.y, heading: a.heading }, "#fbbf24", a.range, a.halfArc);
      if (stopBadge) this.drawStopBadge(ship.x + ship.radius + 6, ship.y - ship.radius - 2);
      return;
    }
    const pts = samplePath(maneuverPath(ship, man), 24);
    const end = pts[pts.length - 1];
    // dráha: tenká souvislá čára; rychlost = tečky v místech ujetých dílů (poslední u ducha lodi)
    const dcol = DIFFICULTY_COLOR[man.difficulty];
    ctx.save();
    ctx.strokeStyle = dcol;
    ctx.lineWidth = aiming ? 2.5 : 1.5;
    ctx.globalAlpha = aiming ? 0.9 : 0.6;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = dcol;
    const last = pts.length - 1;
    for (let k = 1; k <= man.speed; k++) {
      const q = pts[Math.round((k / man.speed) * last)];
      ctx.beginPath();
      ctx.arc(q.x, q.y, aiming ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // výseče zbraní: každá z pozice svého modulu na trupu (lasery střílí ze startovní pozice, před pohybem)
    for (const a of laserArcs ?? []) this.drawArc({ x: a.x, y: a.y, heading: a.heading }, color, a.range ?? LASER.range, a.halfArc);
    for (const a of mgArcs ?? []) this.drawArc({ x: a.x, y: a.y, heading: a.heading }, "#fbbf24", a.range, a.halfArc);
    ctx.save();
    ctx.strokeStyle = shade(color, 1.3);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, ship.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawSprite(ctx, this.sprites.ship(ship.hullId, ship.team, color), end.x, end.y, end.heading, 0.45);
    if (man.koiogran) {
      // otočka: žlutý odznak s ikonou ⟲ vedle otočeného ducha (vpravo nahoře)
      const s = 1.4;
      const bx = end.x + ship.radius + 6;
      const by = end.y - ship.radius - 2;
      ctx.save();
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(bx - 8 * s, by - 8 * s, 16 * s, 16 * s);
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(bx - 7 * s, by - 7 * s, 14 * s, 14 * s);
      this.drawPixelIcon("turn", bx, by, s, "#0b1020");
      ctx.restore();
    }
    if (man.stop) this.drawStopBadge(end.x + ship.radius + 6, end.y - ship.radius - 2); // zastavení na konci dráhy: stopka vedle ducha
  }

  /** Odznak zastavení (červená stopka). */
  private drawStopBadge(bx: number, by: number) {
    const ctx = this.ctx;
    const s = 1.4;
    ctx.save();
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(bx - 8 * s, by - 8 * s, 16 * s, 16 * s);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(bx - 7 * s, by - 7 * s, 14 * s, 14 * s);
    this.drawPixelIcon("stop", bx, by, s, "#f8fafc");
    ctx.restore();
  }

  /** Torpédo v letu: čárkovaná čára k cíli se šipkou, plná část = dolet v tomto kole (tečka na konci). */
  private drawTorpedoLine(l: { from: { x: number; y: number }; to: { x: number; y: number }; color: string; reach: number; enemy: boolean }) {
    const ctx = this.ctx;
    const dx = l.to.x - l.from.x;
    const dy = l.to.y - l.from.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const ux = dx / d;
    const uy = dy / d;
    const reach = Math.min(l.reach, d);
    ctx.save();
    ctx.strokeStyle = l.color;
    ctx.globalAlpha = l.enemy ? 0.75 : 0.9;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(l.from.x, l.from.y);
    ctx.lineTo(l.to.x, l.to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // dolet v tomto kole: plná čára + tečka
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(l.from.x, l.from.y);
    ctx.lineTo(l.from.x + ux * reach, l.from.y + uy * reach);
    ctx.stroke();
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(l.from.x + ux * reach, l.from.y + uy * reach, 4, 0, Math.PI * 2);
    ctx.fill();
    // šipka u cíle
    const tip = { x: l.to.x - ux * 14, y: l.to.y - uy * 14 };
    ctx.beginPath();
    ctx.moveTo(tip.x + ux * 10, tip.y + uy * 10);
    ctx.lineTo(tip.x - uy * 5, tip.y + ux * 5);
    ctx.lineTo(tip.x + uy * 5, tip.y - ux * 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Předpověď skeneru: čárkovaná dráha v barvě nepřítele, tečky po dílech, průsvitný duch na konci. */
  private drawBotPlan(ship: ViewShip, man: Maneuver) {
    const ctx = this.ctx;
    const color = TEAM_COLORS[ship.team];
    const pts = samplePath(maneuverPath(ship, man), 24);
    const end = pts[pts.length - 1];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    const last = pts.length - 1;
    for (let k = 1; k <= man.speed; k++) {
      const q = pts[Math.round((k / man.speed) * last)];
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = shade(color, 1.3);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, ship.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawSprite(ctx, this.sprites.ship(ship.hullId, ship.team, color), end.x, end.y, end.heading, 0.35);
    // štítek „sken“ nad duchem
    ctx.save();
    ctx.font = "11px Jersey, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#a78bfa";
    ctx.globalAlpha = 0.9;
    ctx.fillText("SKEN", end.x, end.y - ship.radius - 6);
    ctx.restore();
  }

  private drawIcons(icons: IconSpot[], cam: Camera) {
    const ctx = this.ctx;
    const r = ICON_RADIUS / Math.min(1, cam.zoom); // ikony drží čitelnou velikost i při oddálení
    for (const ic of icons) {
      if (ic.kind === "mine") {
        // náhled odhození miny: pole + sprite, aktivní zvýrazněné
        ctx.save();
        ctx.globalAlpha = ic.active ? 0.9 : ic.hover ? 0.7 : 0.4;
        ctx.strokeStyle = ic.active ? "#fbbf24" : "#e2e8f0";
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = ic.active ? 2 : 1;
        ctx.beginPath();
        ctx.arc(ic.x, ic.y, MINE.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        drawSprite(ctx, this.sprites.mine(ic.active ? "#fbbf24" : "#94a3b8"), ic.x, ic.y, 0, ic.active ? 1 : 0.6);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = ic.disabled ? 0.35 : 1;
      ctx.fillStyle = ic.active ? "#0ea5e9" : "rgba(13,18,34,0.92)";
      ctx.strokeStyle = ic.active ? "#7dd3fc" : ic.hover ? "#f8fafc" : "rgba(148,163,184,0.7)";
      ctx.lineWidth = (ic.hover || ic.active ? 2 : 1) / Math.min(1, cam.zoom);
      ctx.beginPath();
      ctx.arc(ic.x, ic.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ic.active ? "#03111c" : "#e2e8f0";
      ctx.font = `${Math.round(r * 1.1)}px Jersey, ui-monospace, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ic.glyph, ic.x, ic.y + 1);
      ctx.restore();
    }
  }

  private drawEffect(e: ViewModel["effects"][number], view: ViewModel, now: number) {
    const ctx = this.ctx;
    const t = Math.min(1, Math.max(0, (now - e.start) / e.duration));
    if (t <= 0) return;
    switch (e.kind) {
      case "explosion": {
        const r = e.size * (0.4 + 0.6 * t);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = e.color ?? "#fbbf24";
        const n = 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + e.start;
          const d = r * (0.3 + 0.7 * ((i * 7) % 5) / 5);
          const sz = Math.max(2, e.size * 0.25 * (1 - t));
          ctx.fillRect(e.x + Math.cos(a) * d - sz / 2, e.y + Math.sin(a) * d - sz / 2, sz, sz);
        }
        ctx.fillStyle = "#fff7ed";
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "tracer": {
        // stopa letí od střelce k cíli; rozptyl = úhlová odchylka od směru na cíl
        const base = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x) + e.angle;
        const len = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y) + (e.hit ? 0 : 40);
        const head = Math.min(1, t * 1.15) * len;
        const tail = Math.max(0, head - 22);
        ctx.save();
        ctx.globalAlpha = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15;
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(e.from.x + Math.cos(base) * (tail + 14), e.from.y + Math.sin(base) * (tail + 14));
        ctx.lineTo(e.from.x + Math.cos(base) * (head + 14), e.from.y + Math.sin(base) * (head + 14));
        ctx.stroke();
        if (e.hit && t > 0.8) {
          ctx.fillStyle = "#fff7ae";
          ctx.fillRect(e.to.x + Math.cos(base) * 0 - 2 + (Math.random() - 0.5) * 8, e.to.y - 2 + (Math.random() - 0.5) * 8, 3, 3);
        }
        ctx.restore();
        break;
      }
      case "laser": {
        ctx.save();
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 8;
        const f = forward(e.from.heading);
        ctx.beginPath();
        ctx.moveTo(e.from.x + f.x * 14, e.from.y + f.y * 14);
        ctx.lineTo(e.to.x, e.to.y);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "ring": {
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (0.2 + 0.8 * t), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "text": {
        ctx.save();
        ctx.globalAlpha = 1 - t * t;
        ctx.fillStyle = e.color;
        ctx.font = "15px Jersey, ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText(e.text, e.x, e.y - 30 - t * 25);
        ctx.restore();
        break;
      }
      case "drop": {
        // mina letí po mírném oblouku a zmenšuje se "do dálky"
        const x = e.from.x + (e.to.x - e.from.x) * t;
        const y = e.from.y + (e.to.y - e.from.y) * t - Math.sin(t * Math.PI) * 18;
        const scale = 1.25 - 0.25 * t;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * Math.PI * 2);
        ctx.scale(scale, scale);
        drawSprite(ctx, this.sprites.mine(e.color), 0, 0, 0);
        ctx.restore();
        // stín/stopa
        ctx.save();
        ctx.globalAlpha = 0.35 * (1 - t);
        ctx.strokeStyle = e.color;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(e.from.x, e.from.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "launch": {
        // krátký záblesk motoru torpéda + pár jisker dozadu (žádný rozpínající se kruh – vypadalo to jako výbuch)
        const f = forward(e.heading);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.fillStyle = "#fff7ed";
        ctx.beginPath();
        ctx.arc(e.x - f.x * 4, e.y - f.y * 4, 2 + 2 * (1 - t), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.fillStyle = e.color;
        for (let i = 0; i < 4; i++) {
          const d = 6 + 18 * t * (0.5 + i / 4);
          const sz = 2;
          ctx.fillRect(e.x - f.x * d - sz / 2 + ((i % 2) - 0.5) * 4 * f.y, e.y - f.y * d - sz / 2 - ((i % 2) - 0.5) * 4 * f.x, sz, sz);
        }
        ctx.restore();
        break;
      }
      case "ripple": {
        ctx.save();
        ctx.strokeStyle = e.color;
        for (let i = 0; i < 3; i++) {
          const tt = Math.max(0, Math.min(1, t * 1.6 - i * 0.25));
          if (tt <= 0) continue;
          ctx.globalAlpha = (1 - tt) * 0.8;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 6 + 30 * tt, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case "segmentHit": {
        const s = view.ships.find((x) => x.id === e.shipId);
        if (!s) return;
        const mid = (e.segment * Math.PI) / 2;
        const half = (40 * Math.PI) / 180;
        const sh = this.shieldShape(s);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 5 + 6 * t;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, sh.rx + 4 * t, sh.ry + 4 * t, s.heading, mid - half, mid + half);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case "shield": {
        const s = view.ships.find((x) => x.id === e.shipId);
        if (!s) return;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.strokeStyle = "#93c5fd";
        ctx.lineWidth = 3;
        ctx.beginPath();
        {
          const sh = this.shieldShape(s);
          ctx.ellipse(s.x, s.y, sh.rx, sh.ry, s.heading, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.restore();
        break;
      }
    }
  }
}
