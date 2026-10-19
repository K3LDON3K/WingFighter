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
    this.zoom = Math.max(0.2, z);
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

  zoomAt(sx: number, sy: number, factor: number, min = 0.3, max = 3) {
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
    const slack = 200;
    this.x = Math.max(-slack, Math.min(worldW - vw + slack, this.x));
    this.y = Math.max(-slack, Math.min(worldH - vh + slack, this.y));
  }
}
