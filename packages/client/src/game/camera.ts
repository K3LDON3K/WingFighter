export class Camera {
  x = 0; // světová souřadnice levého horního rohu
  y = 0;
  zoom = 1;

  constructor(
    public viewW: number,
    public viewH: number,
  ) {}

  fit(worldW: number, worldH: number, margin = 40) {
    const z = Math.min((this.viewW - margin) / worldW, (this.viewH - margin) / worldH);
    this.zoom = Math.max(0.1, z);
    this.x = (worldW - this.viewW / this.zoom) / 2;
    this.y = (worldH - this.viewH / this.zoom) / 2;
  }

  toWorld(sx: number, sy: number) {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  toScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  panBy(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Vycentruje na bod se zadaným zoomem. */
  centerOn(x: number, y: number, zoom?: number) {
    if (zoom !== undefined) this.zoom = Math.max(0.1, Math.min(3, zoom));
    this.x = x - this.viewW / this.zoom / 2;
    this.y = y - this.viewH / this.zoom / 2;
  }

  /** Zoom, při kterém se do okna vejde kruh o poloměru r (s okrajem). */
  zoomForRadius(r: number, margin = 0.05): number {
    const side = Math.min(this.viewW, this.viewH) * (1 - margin);
    return Math.max(0.1, Math.min(3, side / (2 * r)));
  }

  zoomAt(sx: number, sy: number, factor: number, min = 0.1, max = 3) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(min, Math.min(max, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Udrží mapu alespoň částečně v záběru. */
  clampTo(worldW: number, worldH: number) {
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    // vůle až půl okna, aby šla vycentrovat i loď u okraje mapy
    const slackX = Math.max(200, vw / 2);
    const slackY = Math.max(200, vh / 2);
    this.x = Math.max(-slackX, Math.min(worldW - vw + slackX, this.x));
    this.y = Math.max(-slackY, Math.min(worldH - vh + slackY, this.y));
  }
}
