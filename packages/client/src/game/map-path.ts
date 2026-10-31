import { offsetPolygon, type MapBox } from "@wingfighter/shared";

/**
 * Obrys hrací plochy do aktuální cesty: elipsa vepsaná do width × height, nebo volný obrys vlastní mapy
 * (`grow` = posun hranice ven, např. o šířku okrajové bouře). Volající si sám dělá beginPath / stroke / clip.
 */
export function traceMap(ctx: CanvasRenderingContext2D, m: MapBox, grow = 0): void {
  if (m.outline && m.outline.length >= 3) {
    const pts = grow ? offsetPolygon(m.outline, grow) : m.outline;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    return;
  }
  ctx.ellipse(m.width / 2, m.height / 2, m.width / 2 + grow, m.height / 2 + grow, 0, 0, Math.PI * 2);
}
