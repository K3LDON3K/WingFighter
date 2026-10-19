import {
  LASER,
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
} from "@spacegame/shared";
import type { Camera } from "./camera.ts";
import { DIFFICULTY_COLOR } from "./planning.ts";
import { drawSprite, shade, SpriteCache } from "./sprites.ts";
import type { ViewModel, ViewShip } from "./view.ts";

export interface IconSpot {
  id: string;
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
  /** Náhled manévru vybrané lodi. */
  preview?: { ship: ViewShip; maneuver: Maneuver };
  /** Dosažitelné pozice při zvolené rychlosti (body obarvené náročností). */
  reachable?: { x: number; y: number; color: string }[];
  /** Právě se míří myší (manévr ještě nepotvrzen). */
  aiming?: boolean;
  /** Věneček ikon akcí kolem konce dráhy. */
  icons?: IconSpot[];
  /** Druhý duch – kam loď skočí přídavným posunem/úskokem. */
  actionGhost?: Pose;
  /** Zvýraznit dostřel kolem lodi (žlutá kružnice). */
  rangeCircle?: { radius: number; label: string };
  /** Zvolený cíl (loď / torpédo) a bod pro torpédo. */
  targetId?: string;
  targetPoint?: { x: number; y: number };
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
    if (sel && overlay.rangeCircle) this.drawRange(sel, overlay.rangeCircle.radius, "#fbbf24", overlay.rangeCircle.label);
    if (overlay.reachable) {
      for (const d of overlay.reachable) {
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(d.x - 2, d.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    }
    if (overlay.preview) this.drawPreview(overlay.preview.ship, overlay.preview.maneuver, overlay);

    for (const t of view.torpedoes) {
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
    if (overlay.icons) this.drawIcons(overlay.icons, cam);

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

  private drawMine(m: { x: number; y: number; radius: number; team: number; armed: boolean }, now: number) {
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

    if (s.shields > 0) {
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.08 * (s.shields / Math.max(1, s.maxShields));
      ctx.fillStyle = "#60a5fa";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const f = forward(s.heading);
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 90 + s.x);
    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.arc(s.x - f.x * (s.radius + 4), s.y - f.y * (s.radius + 4), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawSprite(ctx, this.sprites.fighter(color), s.x, s.y, s.heading);

    ctx.save();
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(248,250,252,0.85)";
    ctx.fillText(s.name, s.x, s.y - s.radius - 16);
    const bw = 34;
    const bx = s.x - bw / 2;
    const by = s.y - s.radius - 12;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    const sw = s.maxShields > 0 ? (bw * s.shields) / s.maxShields : 0;
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
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, s.x, s.y - range - 6);
    ctx.restore();
  }

  private drawPreview(ship: ViewShip, man: Maneuver, overlay: Overlay) {
    const ctx = this.ctx;
    const color = TEAM_COLORS[ship.team];
    const pts = samplePath(maneuverPath(ship, man), 24);
    const end = pts[pts.length - 1];
    ctx.save();
    ctx.strokeStyle = DIFFICULTY_COLOR[man.difficulty];
    ctx.lineWidth = overlay.aiming ? 3 : 2;
    ctx.setLineDash(overlay.aiming ? [] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    this.drawArc(end, color);
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
    ctx.font = "bold 11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = DIFFICULTY_COLOR[man.difficulty];
    const label = man.koiogran ? `otočka ${man.speed}` : `${man.speed} · ${man.angle === 0 ? "rovně" : `${Math.abs(man.angle)}° ${man.angle < 0 ? "L" : "P"}`}`;
    ctx.fillText(label, end.x, end.y - ship.radius - 10);
    ctx.restore();
  }

  private drawIcons(icons: IconSpot[], cam: Camera) {
    const ctx = this.ctx;
    const r = ICON_RADIUS / Math.min(1, cam.zoom); // ikony drží čitelnou velikost i při oddálení
    for (const ic of icons) {
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
      ctx.font = `${Math.round(r * 1.1)}px ui-monospace, Menlo, monospace`;
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
        ctx.font = "bold 14px ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText(e.text, e.x, e.y - 30 - t * 25);
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
