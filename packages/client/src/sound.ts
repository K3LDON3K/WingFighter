/**
 * Zvuky hry: syntetizované přes Web Audio API (8-bit styl, bez souborů).
 * `sfx("laser")` přehraje efekt; hlasitost a ztlumení se pamatují v prohlížeči.
 * Zvuk se odemkne prvním kliknutím/klávesou (vyžadují prohlížeče).
 */
export type SfxName =
  | "click"
  | "toggle"
  | "cancel"
  | "error"
  | "launch"
  | "laser"
  | "laserHit"
  | "laserMiss"
  | "mg"
  | "torpedoLaunch"
  | "explosion"
  | "bigExplosion"
  | "collision"
  | "shieldHit"
  | "hullHit"
  | "evade"
  | "scan"
  | "deepScan"
  | "pickup"
  | "comet"
  | "cometTail"
  | "storm"
  | "mine"
  | "join"
  | "win"
  | "lose"
  | "turnStart"
  | "logoFly";

const KEY_VOL = "wingfighter.sfxVolume";
const KEY_MUTE = "wingfighter.sfxMuted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let music: GainNode | null = null;
let volume = 0.6;
let muted = false;
try {
  const v = localStorage.getItem(KEY_VOL);
  if (v !== null) volume = Math.max(0, Math.min(1, Number(v)));
  muted = localStorage.getItem(KEY_MUTE) === "1";
} catch {
  /* ignore */
}

function ensure(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    music = ctx.createGain();
    music.gain.value = muted ? 0 : 1;
    music.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Zavolej při prvním vstupu uživatele (klik / klávesa), aby prohlížeč zvuk povolil. */
export function unlockAudio() {
  ensure();
}

/** Počká, až je audio skutečně rozběhnuté (resume je asynchronní) – nejvýš ~400 ms. */
export function audioReady(): Promise<void> {
  const c = ensure();
  if (!c || c.state === "running") return Promise.resolve();
  return Promise.race([c.resume().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 400))]);
}

/** Je audio už povolené prohlížečem (běží bez čekání na vstup)? */
export function audioRunning() {
  return ctx?.state === "running";
}

export function getVolume() {
  return volume;
}
export function isMuted() {
  return muted;
}
export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = muted ? 0 : volume;
  try {
    localStorage.setItem(KEY_VOL, String(volume));
  } catch {
    /* ignore */
  }
}
export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = muted ? 0 : volume;
  if (music) music.gain.value = muted ? 0 : 1;
  try {
    localStorage.setItem(KEY_MUTE, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/* ---------- stavební kameny ---------- */

type Wave = OscillatorType;

/** Tón s obálkou: f0→f1 (Hz) za `dur` s, hlasitost `gain`, volitelně schodovitý „arpeggio“ posun. */
function tone(c: AudioContext, bus: AudioNode, opts: { wave?: Wave; f0: number; f1?: number; dur: number; gain?: number; at?: number; attack?: number; decay?: "exp" | "lin" }) {
  const t0 = c.currentTime + (opts.at ?? 0);
  const o = c.createOscillator();
  o.type = opts.wave ?? "square";
  o.frequency.setValueAtTime(Math.max(20, opts.f0), t0);
  if (opts.f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t0 + opts.dur);
  const g = c.createGain();
  const peak = opts.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + (opts.attack ?? 0.005));
  if (opts.decay === "lin") g.gain.linearRampToValueAtTime(0.0001, t0 + opts.dur);
  else g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  o.connect(g).connect(bus);
  o.start(t0);
  o.stop(t0 + opts.dur + 0.02);
}

/** Šum (výbuchy, nárazy) s filtrem a obálkou. */
function noise(c: AudioContext, bus: AudioNode, opts: { dur: number; gain?: number; at?: number; filter?: "lowpass" | "highpass" | "bandpass"; freq?: number; freqEnd?: number; q?: number }) {
  const t0 = c.currentTime + (opts.at ?? 0);
  const len = Math.ceil(c.sampleRate * opts.dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = opts.filter ?? "lowpass";
  f.frequency.setValueAtTime(opts.freq ?? 1000, t0);
  if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
  f.Q.value = opts.q ?? 0.7;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.4, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

/** Bitcrush dojem: krátké „schody“ frekvence (arpeggio). */
function arp(c: AudioContext, bus: AudioNode, notes: number[], step: number, opts: { wave?: Wave; gain?: number; at?: number; dur?: number } = {}) {
  notes.forEach((f, i) => tone(c, bus, { wave: opts.wave ?? "square", f0: f, dur: opts.dur ?? step * 1.2, gain: opts.gain ?? 0.2, at: (opts.at ?? 0) + i * step }));
}

/* ---------- katalog ---------- */

const SFX: Record<SfxName, (c: AudioContext, b: AudioNode) => void> = {
  click: (c, b) => tone(c, b, { wave: "square", f0: 900, f1: 700, dur: 0.05, gain: 0.12 }),
  toggle: (c, b) => arp(c, b, [600, 900], 0.04, { gain: 0.14 }),
  cancel: (c, b) => arp(c, b, [700, 450], 0.05, { gain: 0.14 }),
  error: (c, b) => {
    tone(c, b, { wave: "sawtooth", f0: 220, f1: 180, dur: 0.12, gain: 0.18 });
    tone(c, b, { wave: "sawtooth", f0: 220, f1: 170, dur: 0.14, gain: 0.18, at: 0.14 });
  },
  launch: (c, b) => tone(c, b, { wave: "square", f0: 660, f1: 990, dur: 0.12, gain: 0.16 }),
  turnStart: (c, b) => arp(c, b, [330, 440], 0.08, { wave: "triangle", gain: 0.16, dur: 0.14 }),
  laser: (c, b) => tone(c, b, { wave: "square", f0: 1400, f1: 300, dur: 0.16, gain: 0.22 }),
  laserHit: (c, b) => {
    noise(c, b, { dur: 0.14, gain: 0.3, filter: "bandpass", freq: 1800, freqEnd: 500, q: 1.2 });
    tone(c, b, { wave: "square", f0: 500, f1: 120, dur: 0.12, gain: 0.15 });
  },
  laserMiss: (c, b) => tone(c, b, { wave: "triangle", f0: 400, f1: 250, dur: 0.1, gain: 0.08 }),
  mg: (c, b) => {
    for (let i = 0; i < 6; i++) tone(c, b, { wave: "square", f0: 700 - i * 30, f1: 200, dur: 0.05, gain: 0.13, at: i * 0.045 });
  },
  torpedoLaunch: (c, b) => {
    noise(c, b, { dur: 0.35, gain: 0.25, filter: "lowpass", freq: 600, freqEnd: 2500 });
    tone(c, b, { wave: "sawtooth", f0: 120, f1: 420, dur: 0.35, gain: 0.12 });
  },
  explosion: (c, b) => {
    noise(c, b, { dur: 0.45, gain: 0.5, filter: "lowpass", freq: 2200, freqEnd: 120 });
    tone(c, b, { wave: "square", f0: 160, f1: 40, dur: 0.3, gain: 0.2 });
  },
  bigExplosion: (c, b) => {
    noise(c, b, { dur: 0.9, gain: 0.6, filter: "lowpass", freq: 1800, freqEnd: 60 });
    tone(c, b, { wave: "sawtooth", f0: 110, f1: 30, dur: 0.7, gain: 0.25 });
    noise(c, b, { dur: 0.5, gain: 0.3, at: 0.15, filter: "bandpass", freq: 900, freqEnd: 200 });
  },
  collision: (c, b) => {
    noise(c, b, { dur: 0.18, gain: 0.45, filter: "lowpass", freq: 900, freqEnd: 150 });
    tone(c, b, { wave: "square", f0: 90, f1: 50, dur: 0.15, gain: 0.2 });
  },
  shieldHit: (c, b) => {
    tone(c, b, { wave: "sine", f0: 1200, f1: 600, dur: 0.18, gain: 0.2 });
    tone(c, b, { wave: "sine", f0: 1800, f1: 900, dur: 0.18, gain: 0.1, at: 0.02 });
  },
  hullHit: (c, b) => {
    noise(c, b, { dur: 0.2, gain: 0.4, filter: "bandpass", freq: 700, freqEnd: 200, q: 1 });
    tone(c, b, { wave: "square", f0: 200, f1: 70, dur: 0.18, gain: 0.18 });
  },
  evade: (c, b) => tone(c, b, { wave: "triangle", f0: 300, f1: 1200, dur: 0.25, gain: 0.14 }),
  scan: (c, b) => {
    tone(c, b, { wave: "sine", f0: 1500, dur: 0.08, gain: 0.14 });
    tone(c, b, { wave: "sine", f0: 2200, dur: 0.14, gain: 0.1, at: 0.1 });
  },
  deepScan: (c, b) => {
    tone(c, b, { wave: "sine", f0: 500, f1: 2600, dur: 0.6, gain: 0.14 });
    arp(c, b, [1800, 2200, 2600], 0.1, { wave: "sine", gain: 0.08, at: 0.5 });
  },
  pickup: (c, b) => arp(c, b, [500, 750, 1000], 0.06, { wave: "triangle", gain: 0.16, dur: 0.1 }),
  comet: (c, b) => noise(c, b, { dur: 0.6, gain: 0.18, filter: "highpass", freq: 3000, freqEnd: 800 }),
  cometTail: (c, b) => arp(c, b, [900, 1200, 1500, 1800], 0.05, { wave: "sine", gain: 0.12, dur: 0.12 }),
  storm: (c, b) => {
    for (let i = 0; i < 4; i++) noise(c, b, { dur: 0.06, gain: 0.15, at: i * 0.11 + Math.random() * 0.04, filter: "highpass", freq: 2500 });
  },
  mine: (c, b) => {
    tone(c, b, { wave: "square", f0: 800, dur: 0.05, gain: 0.12 });
    tone(c, b, { wave: "square", f0: 800, dur: 0.05, gain: 0.12, at: 0.12 });
  },
  logoFly: (c, b) => {
    // prolet stíhače: stoupavý šum + tón motoru
    noise(c, b, { dur: 1.3, gain: 0.22, filter: "bandpass", freq: 300, freqEnd: 2400, q: 0.8 });
    tone(c, b, { wave: "sawtooth", f0: 80, f1: 320, dur: 1.2, gain: 0.08, decay: "lin" });
  },
  join: (c, b) => arp(c, b, [523, 659], 0.09, { wave: "triangle", gain: 0.14, dur: 0.15 }),
  win: (c, b) => arp(c, b, [523, 659, 784, 1047, 784, 1047], 0.12, { wave: "square", gain: 0.16, dur: 0.22 }),
  lose: (c, b) => arp(c, b, [392, 349, 311, 262], 0.18, { wave: "sawtooth", gain: 0.14, dur: 0.3 }),
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];

/** Přehraje efekt; `distance` (0–1) ztiší vzdálené události. */
export function sfx(name: SfxName, distance = 0) {
  if (muted) return;
  const c = ensure();
  if (!c || !master) return;
  const bus = c.createGain();
  bus.gain.value = Math.max(0.1, 1 - Math.max(0, Math.min(1, distance)));
  bus.connect(master);
  try {
    SFX[name](c, bus);
  } catch {
    /* ignore */
  }
}

/** Posluchač pro prostorové ztišení: pozice vlastních lodí a dohled. */
let listener: (() => { points: { x: number; y: number }[]; radius: number }) | null = null;
export function setSfxListener(fn: typeof listener) {
  listener = fn;
}
/** Efekt na místě mapy: čím dál od vlastních lodí, tím tišší (za dvojnásobkem dohledu skoro ticho). */
export function sfxAt(name: SfxName, x: number, y: number) {
  const l = listener?.();
  if (!l || l.points.length === 0) return sfx(name);
  const d = Math.min(...l.points.map((p) => Math.hypot(p.x - x, p.y - y)));
  sfx(name, Math.max(0, Math.min(1, (d - l.radius * 0.5) / (l.radius * 1.5))));
}

/** Audio kontext (po odemknutí) a sběrnice hudby (ztlumení M platí i pro ni). */
export function audioContext(): AudioContext | null {
  return ensure();
}
export function musicBus(): AudioNode {
  ensure();
  return music!;
}
