import type { Storm } from "@wingfighter/shared";

/**
 * Elektromagnetická bouře – varianta A: měkké fialovo-růžové mraky, řídký pixelový šum, občasné bílé blesky.
 * Šum je předpočítaný (deterministický podle id), blesky jsou náhodné a krátké.
 */
interface StormArt {
  noise: { x: number; y: number; c: string }[];
  bolts: { pts: { x: number; y: number }[]; until: number; color: string }[];
  nextBolt: number;
}

const cache = new Map<string, StormArt>();

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function artFor(storm: Storm): StormArt {
  let a = cache.get(storm.id);
  if (a) return a;
  const r = rng([...storm.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const noise: StormArt["noise"] = [];
  for (const b of storm.blobs) {
    const n = Math.round((b.r * b.r) / 180);
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * b.r;
      noise.push({ x: Math.round((b.x + Math.cos(ang) * d) / 4) * 4, y: Math.round((b.y + Math.sin(ang) * d) / 4) * 4, c: r() < 0.5 ? "rgba(244,114,182,0.45)" : "rgba(192,132,252,0.45)" });
    }
  }
  a = { noise, bolts: [], nextBolt: 0 };
  cache.set(storm.id, a);
  return a;
}

export function drawStorms(ctx: CanvasRenderingContext2D, storms: Storm[], now: number, zoom: number) {
  for (const storm of storms) {
    const art = artFor(storm);
    // měkké mraky
    for (const b of storm.blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, b.r * 0.15, b.x, b.y, b.r);
      g.addColorStop(0, "rgba(168,85,247,0.5)");
      g.addColorStop(0.6, "rgba(236,72,153,0.28)");
      g.addColorStop(1, "rgba(168,85,247,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // pixelový šum (při velkém oddálení ho vynecháme)
    if (zoom > 0.35) {
      const size = 4;
      for (const n of art.noise) {
        ctx.fillStyle = n.c;
        ctx.fillRect(n.x, n.y, size, size);
      }
    }
    // tečkovaný okraj, ať je hranice bouře čitelná
    ctx.save();
    ctx.strokeStyle = "rgba(216,180,254,0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    for (const b of storm.blobs) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    // blesky
    if (now >= art.nextBolt) {
      const b = storm.blobs[Math.floor(Math.random() * storm.blobs.length)];
      const pts = [{ x: b.x + (Math.random() - 0.5) * b.r, y: b.y - b.r * 0.6 }];
      for (let i = 0; i < 6; i++) pts.push({ x: pts[i].x + (Math.random() - 0.5) * 40, y: pts[i].y + b.r * 0.2 });
      art.bolts.push({ pts, until: now + 140 + Math.random() * 120, color: Math.random() < 0.5 ? "#ffffff" : "#fbcfe8" });
      art.nextBolt = now + 900 + Math.random() * 2600;
    }
    art.bolts = art.bolts.filter((bl) => bl.until > now);
    for (const bl of art.bolts) {
      ctx.save();
      ctx.strokeStyle = bl.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(bl.pts[0].x, bl.pts[0].y);
      for (const p of bl.pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Jiskření lodi v bouři + ikona ⚡ nad ní. */
export function drawStormSparks(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, now: number) {
  ctx.save();
  ctx.fillStyle = "#fde047";
  for (let i = 0; i < 6; i++) {
    const a = now / 90 + (i * Math.PI * 2) / 6;
    const d = radius + 2 + 8 * Math.abs(Math.sin(now / 130 + i));
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 50 + i * 1.7);
    ctx.fillRect(x + Math.cos(a) * d - 1, y + Math.sin(a) * d - 1, 2, 2);
  }
  ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now / 120);
  ctx.fillStyle = "#fde047";
  ctx.font = "17px Jersey, ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText("⚡", x + radius + 12, y - radius - 2);
  ctx.restore();
}

/**
 * Okrajová bouře kolem oválné mapy: prstenec šířky `border` (u hrany řídký, směrem ven hustší, kreslený jako
 * soustředné elipsy), za ním tvrdý okraj (elipsa zvětšená o `border`, červeně) a bouře pokračuje dál i za něj.
 */
const borderCache = new Map<string, { noise: { x: number; y: number; c: string }[]; bolts: { pts: { x: number; y: number }[]; until: number; color: string }[]; nextBolt: number }>();
export function drawBorderStorm(ctx: CanvasRenderingContext2D, w: number, h: number, border: number, now: number, zoom: number) {
  const B = border;
  const cx = w / 2;
  const cy = h / 2;
  const a = w / 2;
  const b = h / 2;
  const key = `${w}x${h}:${B}`;
  let art = borderCache.get(key);
  if (!art) {
    const r = rng(w * 31 + h * 7 + B);
    const noise: { x: number; y: number; c: string }[] = [];
    const n = Math.round(((w + h) * 2 * B * 1.6) / 900);
    for (let i = 0; i < n; i++) {
      // bod kolem oválu: úhel + hloubka za hranou (hustěji dál, řidčeji za tvrdým okrajem)
      const ang = r() * Math.PI * 2;
      const depth = Math.sqrt(r()) * B * 1.6;
      if (depth > B && r() < 0.5) continue;
      const x = cx + Math.cos(ang) * (a + depth);
      const y = cy + Math.sin(ang) * (b + depth);
      noise.push({ x: Math.round(x / 4) * 4, y: Math.round(y / 4) * 4, c: r() < 0.5 ? "rgba(244,114,182,0.5)" : "rgba(192,132,252,0.5)" });
    }
    art = { noise, bolts: [], nextBolt: 0 };
    borderCache.set(key, art);
  }
  const FAR = B * 6;
  const ellipse = (ra: number, rb: number) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(1, ra), Math.max(1, rb), 0, 0, Math.PI * 2);
  };
  const col = (t: number) => {
    // 0 = hrana mapy (řídká) … 1 = tvrdý okraj (hustá)
    const al = t < 0.5 ? 0.12 + (0.38 - 0.12) * (t / 0.5) : 0.38 + (0.72 - 0.38) * ((t - 0.5) / 0.5);
    const rr = Math.round(168 + (120 - 168) * t);
    const gg = Math.round(85 + (30 - 85) * t);
    const bb = Math.round(247 + (150 - 247) * t);
    return `rgba(${rr},${gg},${bb},${al})`;
  };
  ctx.save();
  // jen mimo hrací plochu
  ctx.beginPath();
  ctx.rect(-FAR, -FAR, w + 2 * FAR, h + 2 * FAR);
  ctx.ellipse(cx, cy, a, b, 0, 0, Math.PI * 2);
  ctx.clip("evenodd");
  // za tvrdým okrajem: hustá bouře všude
  ctx.save();
  ctx.beginPath();
  ctx.rect(-FAR, -FAR, w + 2 * FAR, h + 2 * FAR);
  ctx.ellipse(cx, cy, a + B, b + B, 0, 0, Math.PI * 2);
  ctx.clip("evenodd");
  ctx.fillStyle = col(1);
  ctx.fillRect(-FAR, -FAR, w + 2 * FAR, h + 2 * FAR);
  ctx.restore();
  // prstenec: soustředné elipsy od tvrdého okraje dovnitř (každá překryje vnitřek – vrstvení dá přechod)
  const N = 26;
  for (let i = N; i >= 1; i--) {
    const t = i / N;
    ellipse(a + B * t, b + B * t);
    ctx.fillStyle = col(t);
    // každá vrstva jen tenký mezikruh: vyříznout menší elipsu
    ctx.ellipse(cx, cy, a + (B * (i - 1)) / N, b + (B * (i - 1)) / N, 0, 0, Math.PI * 2);
    ctx.fill("evenodd");
  }
  if (zoom > 0.3) {
    for (const p of art.noise) {
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, 4, 4);
    }
  }
  // blesky v pásu i za ním
  if (now >= art.nextBolt) {
    const ang = Math.random() * Math.PI * 2;
    const depth = B * (0.3 + Math.random() * 1.1);
    const sx = cx + Math.cos(ang) * (a + depth);
    const sy = cy + Math.sin(ang) * (b + depth);
    const pts = [{ x: sx, y: sy - 60 }];
    for (let i = 0; i < 6; i++) pts.push({ x: pts[i].x + (Math.random() - 0.5) * 50, y: pts[i].y + 24 });
    art.bolts.push({ pts, until: now + 140 + Math.random() * 120, color: Math.random() < 0.5 ? "#ffffff" : "#fbcfe8" });
    art.nextBolt = now + 500 + Math.random() * 1200;
  }
  art.bolts = art.bolts.filter((bl) => bl.until > now);
  for (const bl of art.bolts) {
    ctx.strokeStyle = bl.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(bl.pts[0].x, bl.pts[0].y);
    for (const p of bl.pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  const k = 1 / Math.min(1, zoom); // tloušťka čar nezávislá na oddálení
  // vnitřní hranice pásu: jemná tečkovaná fialová (začátek bouře)
  ctx.save();
  ctx.strokeStyle = "rgba(216,180,254,0.45)";
  ctx.lineWidth = 1.5 * k;
  ctx.setLineDash([4 * k, 6 * k]);
  ellipse(a, b);
  ctx.stroke();
  ctx.restore();
  // tvrdý okraj: elipsa, červená přerušovaná čára s běžícími čárkami + matný lem
  ctx.save();
  ellipse(a + B, b + B);
  ctx.strokeStyle = "rgba(239,68,68,0.35)";
  ctx.lineWidth = 10 * k;
  ctx.stroke();
  ctx.strokeStyle = "rgba(239,68,68,0.95)";
  ctx.lineWidth = 3 * k;
  ctx.setLineDash([14 * k, 10 * k]);
  ctx.lineDashOffset = -now / 40;
  ctx.stroke();
  ctx.restore();
}
