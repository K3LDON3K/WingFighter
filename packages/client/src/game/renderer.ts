import {
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
} from "@spacegame/shared";
import type { Camera } from "./camera.ts";
import { segmentColor, strengthColor } from "./shield-ui.ts";
import { DIFFICULTY_COLOR } from "./planning.ts";
import { drawSprite, shade, SpriteCache } from "./sprites.ts";
import type { ViewModel, ViewShip } from "./view.ts";

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

export interface Overlay {
  selectedShipId?: string;
  hoverId?: string;
  /** Plánované dráhy vlastních lodí; `aiming` = právě se kreslí myší. */
  previews?: { ship: ViewShip; maneuver: Maneuver; aiming: boolean; fire: boolean }[];
  /** Dohled vlastního týmu (fog of war). */
  vision?: { x: number; y: number; r: number }[];
  /** Dosažitelné pozice při zvolené rychlosti (body obarvené náročností). */
  reachable?: { x: number; y: number; color: string }[];
  /** Věneček ikon akcí kolem konce dráhy. */
  icons?: IconSpot[];
  /** Druhý duch – kam loď skočí přídavným posunem/úskokem. */
  actionGhost?: Pose;
  /** Zvýraznit dostřel kolem lodi (žlutá kružnice) a slabší vnější dostřel. */
  rangeCircle?: { radius: number; label: string };
  rangeCircle2?: { radius: number };
  /** Náhled pole miny na startovní pozici lodi. */
  mineField?: { x: number; y: number; timer?: number };
  /** Zvolený cíl (loď / torpédo) a bod pro torpédo. */
  targetId?: string;
  targetPoint?: { x: number; y: number };
  /** Šance laserů na zásah u cíle. */
  laserOdds?: { x: number; y: number; text: string; color: string };
  /** Právě se vybírá cíl kliknutím. */
  picking?: "torpedo" | "lock";
  myTeam?: number;
}

export const ICON_RADIUS = 13;

export class Renderer {
  readonly sprites = new SpriteCache();
  private starPattern: CanvasPattern | null = null;

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

    ctx.save();
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    this.drawBackground(state, cam);
    this.drawGrid(state);
    for (const a of view.asteroids) this.drawAsteroid(a);
    for (const m of view.mines) this.drawMine(m, now);

    const sel = overlay.selectedShipId ? view.ships.find((x) => x.id === overlay.selectedShipId) : undefined;
    if (sel && overlay.rangeCircle2) this.drawRange(sel, overlay.rangeCircle2.radius, "rgba(251,191,36,0.35)", "");
    if (sel && overlay.rangeCircle) this.drawRange(sel, overlay.rangeCircle.radius, "#fbbf24", overlay.rangeCircle.label);
    if (overlay.mineField) this.drawMine({ ...overlay.mineField, radius: MINE.radius, team: sel?.team ?? 0, armed: false }, now);
    if (overlay.reachable) {
      for (const d of overlay.reachable) {
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(d.x - 2, d.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    }
    for (const p of overlay.previews ?? []) this.drawPreview(p.ship, p.maneuver, p.aiming, p.fire);

    for (const t of view.torpedoes) {
      // plamen motoru
      const f = forward(t.heading);
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(now / 40 + t.x));
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(t.x - f.x * 8 - f.y * 2, t.y - f.y * 8 + f.x * 2);
      ctx.lineTo(t.x - f.x * (16 + 6 * Math.random()), t.y - f.y * (16 + 6 * Math.random()));
      ctx.lineTo(t.x - f.x * 8 + f.y * 2, t.y - f.y * 8 - f.x * 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      drawSprite(ctx, this.sprites.torpedo(TEAM_COLORS[t.team]), t.x, t.y, t.heading);
      if (t.targetPoint && (t.team === overlay.myTeam || overlay.myTeam === undefined)) this.drawPointMarker(t.targetPoint, TEAM_COLORS[t.team], 0.5);
      if (overlay.targetId === t.id || overlay.hoverId === t.id) {
        ctx.save();
        ctx.strokeStyle = overlay.targetId === t.id ? "#fbbf24" : "rgba(248,250,252,0.5)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(t.x, t.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const s of view.ships) this.drawShip(s, overlay, now);
    if (overlay.targetPoint) this.drawPointMarker(overlay.targetPoint, "#fbbf24", 1, now);
    if (overlay.actionGhost && sel) {
      drawSprite(ctx, this.sprites.fighter(TEAM_COLORS[sel.team]), overlay.actionGhost.x, overlay.actionGhost.y, overlay.actionGhost.heading, 0.3);
    }
    for (const e of view.effects) this.drawEffect(e, view, now);
    if (overlay.laserOdds) {
      const lo = overlay.laserOdds;
      ctx.save();
      ctx.font = "9px PS2P, ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      const w = ctx.measureText(lo.text).width + 10;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(lo.x - w / 2, lo.y + 22, w, 14);
      ctx.strokeStyle = lo.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(lo.x - w / 2, lo.y + 22, w, 14);
      ctx.fillStyle = lo.color;
      ctx.fillText(lo.text, lo.x, lo.y + 32);
      ctx.restore();
    }
    if (overlay.vision) this.drawFog(overlay.vision, cam);
    if (overlay.icons) this.drawIcons(overlay.icons, cam);

    ctx.restore();
  }

  private fogCanvas: HTMLCanvasElement | null = null;

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
    ctx.save();
    ctx.fillStyle = this.starPattern!;
    const vw = cam.viewW / cam.zoom;
    const vh = cam.viewH / cam.zoom;
    ctx.fillRect(cam.x, cam.y, vw, vh);
    ctx.restore();
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, state.width, state.height);
  }

  private drawGrid(state: GameState) {
    const ctx = this.ctx;
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
  }

  private drawAsteroid(a: Asteroid) {
    drawSprite(this.ctx, this.sprites.asteroid(a), a.x, a.y, 0);
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
      ctx.font = "8px PS2P, ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(`T-${m.timer}`, m.x, m.y - 14);
      ctx.restore();
    }
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

  /** Štít na mapě: celolodní = kruh obarvený podle síly; segmentový = 4 oblouky otáčející se s lodí. */
  private drawShield(s: ViewShip, now: number) {
    const ctx = this.ctx;
    if (s.shieldType === "whole") {
      if (s.shields <= 0) return;
      const frac = s.shields / Math.max(1, s.maxShields);
      const col = strengthColor(frac);
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.1 * frac;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius + 5, 0, Math.PI * 2);
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
    const r = s.radius + 6;
    const half = (40 * Math.PI) / 180;
    ctx.save();
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const hp = s.segments[i] ?? 0;
      const mid = s.heading + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, mid - half, mid + half);
      if (hp <= 0) {
        ctx.strokeStyle = "rgba(239,68,68,0.35)";
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = segmentColor(hp);
        ctx.setLineDash([]);
        ctx.lineWidth = hp >= 3 ? 4 : 3;
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

    if (selected || hovered || targeted) {
      ctx.save();
      ctx.strokeStyle = targeted ? "#fbbf24" : selected ? "#f8fafc" : "rgba(248,250,252,0.5)";
      ctx.lineWidth = selected || targeted ? 2 : 1;
      ctx.setLineDash(targeted ? [4, 4] : []);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawShield(s, now);

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
      for (let i = 1; i <= 2; i++) drawSprite(ctx, this.sprites.fighter(color), -f2.x * i * 9, -f2.y * i * 9, s.heading, 0.12);
      drawSprite(ctx, this.sprites.fighter(color), 0, 0, s.heading, 0.55);
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
    } else drawSprite(ctx, this.sprites.fighter(color), s.x, s.y, s.heading);

    ctx.save();
    ctx.font = "13px Pix, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(248,250,252,0.9)";
    ctx.fillText(s.name, s.x, s.y - s.radius - 16);
    const bw = 34;
    const bx = s.x - bw / 2;
    const by = s.y - s.radius - 12;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    const segTotal = s.segments[0] + s.segments[1] + s.segments[2] + s.segments[3];
    const sw = s.shieldType === "segment" ? (bw * Math.min(1, segTotal / (4 * RULES.segmentHp))) : s.maxShields > 0 ? (bw * s.shields) / s.maxShields : 0;
    ctx.fillStyle = "#60a5fa";
    ctx.fillRect(bx, by, sw, 2);
    const hw = (bw * s.hull) / Math.max(1, s.maxHull);
    ctx.fillStyle = s.hull <= s.maxHull * 0.3 ? "#ef4444" : "#22c55e";
    ctx.fillRect(bx, by + 3, hw, 2);
    // stresové body (jen vlastní tým vidí detail; ostatní také – informace není tajná)
    for (let i = 0; i < STRESS.max; i++) {
      ctx.fillStyle = i < s.stressPoints ? "#f472b6" : "rgba(244,114,182,0.25)";
      ctx.fillRect(s.x + s.radius + 6 + i * 5, s.y - s.radius - 10, 3, 3);
    }
    let tx = s.x + s.radius + 6;
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

  drawArc(p: Pose, color: string, range = LASER.range) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, range, p.heading - LASER.halfArc, p.heading + LASER.halfArc);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    for (let b = 1; b < 3; b++) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, LASER.band * b, p.heading - LASER.halfArc, p.heading + LASER.halfArc);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRange(s: ViewShip, range: number, color: string, label: string) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "8px PS2P, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label.toUpperCase(), s.x, s.y - range - 6);
    ctx.restore();
  }

  private drawPreview(ship: ViewShip, man: Maneuver, aiming: boolean, fire: boolean) {
    const ctx = this.ctx;
    const color = TEAM_COLORS[ship.team];
    const pts = samplePath(maneuverPath(ship, man), 24);
    const end = pts[pts.length - 1];
    ctx.save();
    ctx.strokeStyle = DIFFICULTY_COLOR[man.difficulty];
    ctx.lineWidth = aiming ? 3 : 2;
    ctx.setLineDash(aiming ? [] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    if (fire) this.drawArc(ship, color); // lasery střílí ze startovní pozice, před pohybem
    ctx.save();
    ctx.strokeStyle = shade(color, 1.3);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, ship.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawSprite(ctx, this.sprites.fighter(color), end.x, end.y, end.heading, 0.45);
    // popisek manévru u konce dráhy
    ctx.save();
    ctx.font = "8px PS2P, ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = DIFFICULTY_COLOR[man.difficulty];
    const label = man.koiogran ? `OTOCKA ${man.speed}` : `${man.speed} · ${man.angle === 0 ? "ROVNE" : `${Math.abs(man.angle)}° ${man.angle < 0 ? "L" : "P"}`}`;
    ctx.fillText(label, end.x, end.y - ship.radius - 10);
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
      ctx.font = `${Math.round(r * 1.1)}px Pix, ui-monospace, Menlo, monospace`;
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
        ctx.font = "9px PS2P, ui-monospace, Menlo, monospace";
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
        // záblesk u přídě + oblak výfuku, který se roztahuje dozadu
        const f = forward(e.heading);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.fillStyle = "#fff7ed";
        ctx.beginPath();
        ctx.arc(e.x, e.y, 4 + 10 * t, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.fillStyle = "#cbd5e1";
        for (let i = 0; i < 5; i++) {
          const d = 8 + 40 * t * (0.5 + i / 5);
          const sz = 3 + 4 * t;
          ctx.fillRect(e.x - f.x * d - sz / 2 + ((i % 2) - 0.5) * 6 * f.y, e.y - f.y * d - sz / 2 - ((i % 2) - 0.5) * 6 * f.x, sz, sz);
        }
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 6 + 18 * t, 0, Math.PI * 2);
        ctx.stroke();
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
        const mid = s.heading + (e.segment * Math.PI) / 2;
        const half = (40 * Math.PI) / 180;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 5 + 6 * t;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius + 6 + 4 * t, mid - half, mid + half);
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
        ctx.arc(s.x, s.y, s.radius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
    }
  }
}
