import { offsetShape, shapeOf, type MapBox } from "@wingfighter/shared";

/**
 * Hranice hrací plochy do aktuální cesty: elipsa vepsaná do width × height, nebo tvar vlastní mapy
 * (kusy s dírami; `grow` = posun hranice ven, např. o šířku okrajové bouře – spočítaný jako rovnoměrný odstup).
 * Volající si sám dělá beginPath / stroke / clip; u tvaru s dírami je třeba clip / fill s pravidlem "evenodd".
 */
export function traceMap(ctx: CanvasRenderingContext2D, m: MapBox, grow = 0): void {
  const sh = shapeOf(m);
  if (sh) {
    const shape = grow ? offsetShape(sh, grow) : sh;
    for (const poly of shape)
      for (const ring of poly) {
        if (ring.length < 3) continue;
        ctx.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
        ctx.closePath();
      }
    return;
  }
  ctx.ellipse(m.width / 2, m.height / 2, m.width / 2 + grow, m.height / 2 + grow, 0, 0, Math.PI * 2);
}
