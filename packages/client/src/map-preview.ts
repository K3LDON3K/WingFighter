import { generateMap, TEAM_COLORS, type MapSettings, type RoomPlayer } from "@wingfighter/shared";
import { h } from "./dom.ts";

/**
 * Náhled generované mapy v místnosti: asteroidy, bouře, startovní body (obsazené barvou týmu + jméno).
 * Klik na volný bod = zvolit start.
 */
export function renderMapPreview(settings: MapSettings, players: RoomPlayer[], myId: string, onPick: (index: number | null) => void, width = 520): HTMLElement {
  const gen = generateMap(settings);
  const scale = width / gen.width;
  /** Měřítko značek a písma vůči základní šířce 520 px. */
  const k = Math.max(1, width / 520);
  const height = Math.round(gen.height * scale);
  const canvas = h("canvas", { width, height, class: "map-preview" });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#04060d";
  ctx.fillRect(0, 0, width, height);
  // mřížka
  ctx.strokeStyle = "rgba(148,163,184,0.08)";
  for (let x = 0; x < gen.width; x += 400) {
    ctx.beginPath();
    ctx.moveTo(x * scale, 0);
    ctx.lineTo(x * scale, height);
    ctx.stroke();
  }
  for (let y = 0; y < gen.height; y += 400) {
    ctx.beginPath();
    ctx.moveTo(0, y * scale);
    ctx.lineTo(width, y * scale);
    ctx.stroke();
  }
  // bouře
  for (const s of gen.storms) {
    for (const b of s.blobs) {
      const g = ctx.createRadialGradient(b.x * scale, b.y * scale, 1, b.x * scale, b.y * scale, b.r * scale);
      g.addColorStop(0, "rgba(168,85,247,0.55)");
      g.addColorStop(1, "rgba(236,72,153,0.05)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x * scale, b.y * scale, b.r * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // asteroidy
  for (const a of gen.asteroids) {
    ctx.fillStyle = "#8a7f6a";
    ctx.beginPath();
    ctx.arc(a.x * scale, a.y * scale, Math.max(1.5, a.radius * scale), 0, Math.PI * 2);
    ctx.fill();
  }
  // startovní body
  const byIndex = new Map<number, RoomPlayer>();
  for (const p of players) if (p.startIndex !== undefined) byIndex.set(p.startIndex, p);
  gen.starts.forEach((st, i) => {
    const p = byIndex.get(i);
    const x = st.x * scale;
    const y = st.y * scale;
    ctx.beginPath();
    ctx.arc(x, y, (p ? 7 : 5) * k, 0, Math.PI * 2);
    if (p) {
      ctx.fillStyle = TEAM_COLORS[p.team];
      ctx.fill();
      if (p.id === myId) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 * k;
        ctx.stroke();
      }
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `${Math.round(9 * k)}px Jersey, ui-monospace, monospace`;
      ctx.textAlign = x > width / 2 ? "right" : "left";
      ctx.fillText(p.name, x + (x > width / 2 ? -10 : 10) * k, y + 3 * k);
    } else {
      ctx.strokeStyle = "rgba(148,163,184,0.8)";
      ctx.lineWidth = 1.5 * k;
      ctx.setLineDash([2 * k, 2 * k]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  ctx.strokeStyle = "rgba(148,163,184,0.5)";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  canvas.addEventListener("click", (ev) => {
    const r = canvas.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * width;
    const my = ((ev.clientY - r.top) / r.height) * height;
    let best = -1;
    let bd = 14 * k;
    gen.starts.forEach((st, i) => {
      const d = Math.hypot(st.x * scale - mx, st.y * scale - my);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return;
    const taken = byIndex.get(best);
    if (taken && taken.id === myId) onPick(null);
    else if (!taken) onPick(best);
  });
  canvas.title = "Klik na startovní bod = zvolit start (znovu klik na svůj = uvolnit)";
  return canvas;
}
