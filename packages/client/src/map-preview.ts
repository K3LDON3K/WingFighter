import { generateMap, skyThemeOf, TEAM_COLORS, type MapSettings, type RoomPlayer } from "@wingfighter/shared";
import { h } from "./dom.ts";
import { drawParallax } from "./game/parallax.ts";

/**
 * Náhled generované mapy v místnosti: asteroidy, bouře, startovní body (obsazené barvou týmu + jméno).
 * Klik na volný bod = zvolit start.
 */
/**
 * Náhled generované mapy se startovními body. `myId` = kdo právě vybírá (zvýrazněný bod, klik ho mění);
 * `interactive=false` = jen prohlížení (náhodné umístění, nebo start týmu vybírá velitel).
 */
export function renderMapPreview(settings: MapSettings, players: RoomPlayer[], myId: string, onPick: (index: number | null) => void, width = 520, interactive = true, border = 0): HTMLElement {
  const gen = generateMap(settings);
  // kolem oválu je pás okrajové bouře; do náhledu se vejde i s ním
  const pad = border > 0 ? border * 0.6 : 0;
  const scale = width / (gen.width + 2 * pad);
  /** Měřítko značek a písma vůči základní šířce 520 px. */
  const k = Math.max(1, width / 520);
  const height = Math.round((gen.height + 2 * pad) * scale);
  const canvas = h("canvas", { width, height, class: "map-preview" });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#04060d";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(pad * scale, pad * scale);
  const cx = (gen.width / 2) * scale;
  const cy = (gen.height / 2) * scale;
  const ra = (gen.width / 2) * scale;
  const rb = (gen.height / 2) * scale;
  // vzdálené pozadí (zvolený motiv) – stejné kreslení jako ve hře, oříznuté na hrací plochu (s okrajovou bouří)
  {
    const Bs = border * scale;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, ra + Bs, rb + Bs, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.setTransform(scale, 0, 0, scale, pad * scale, pad * scale);
    drawParallax(ctx, skyThemeOf(settings), settings.seed, gen.width, gen.height, { x: -pad, y: -pad, zoom: scale, viewW: width, viewH: height }, scale, true);
    ctx.restore();
  }
  if (border > 0) {
    // okrajová bouře: tenká fialová hrana (za ní zraňuje) a červený tvrdý okraj
    const Bs = border * scale;
    ctx.save();
    ctx.strokeStyle = "rgba(239,68,68,0.9)";
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ra + Bs, rb + Bs, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // mřížka jen uvnitř oválu
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, ra, rb, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(148,163,184,0.08)";
  for (let x = 0; x < gen.width; x += 400) {
    ctx.beginPath();
    ctx.moveTo(x * scale, 0);
    ctx.lineTo(x * scale, gen.height * scale);
    ctx.stroke();
  }
  for (let y = 0; y < gen.height; y += 400) {
    ctx.beginPath();
    ctx.moveTo(0, y * scale);
    ctx.lineTo(gen.width * scale, y * scale);
    ctx.stroke();
  }
  ctx.restore();
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
      ctx.fillText((p.commander ? "★ " : "") + p.name, x + (x > width / 2 ? -10 : 10) * k, y + 3 * k);
    } else {
      ctx.strokeStyle = "rgba(148,163,184,0.8)";
      ctx.lineWidth = 1.5 * k;
      ctx.setLineDash([2 * k, 2 * k]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  ctx.strokeStyle = border > 0 ? "rgba(192,132,252,0.85)" : "rgba(148,163,184,0.5)";
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ra, rb, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (!interactive) {
    canvas.title = "Náhled mapy";
    canvas.style.cursor = "default";
    return canvas;
  }
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
