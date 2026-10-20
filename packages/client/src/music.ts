/**
 * Hudba: dvě vestavěné chip-tune skladby (syntetizované) + vlastní soubory nahrané v prohlížeči (IndexedDB).
 * Výběr: jedna skladba pro hlavní menu, playlist pro bitvu. Hlasitost a volby se pamatují v prohlížeči.
 */
import { audioContext, musicBus } from "./sound.ts";

export interface Track {
  id: string;
  name: string;
  kind: "synth" | "file";
  /** Jen u souborů: nahraná data. */
  blob?: Blob;
}

export interface MusicSettings {
  menuTrackId: string | null;
  gameTrackIds: string[];
  volume: number;
}

const KEY = "wingfighter.music";
const DB_NAME = "wingfighter-music";
const STORE = "tracks";

export const SYNTH_MENU: Track = { id: "synth-menu", name: "Wingfighter – hlavní menu", kind: "synth" };
export const SYNTH_GAME: Track = { id: "synth-game", name: "Wingfighter – bitva", kind: "synth" };
export const SYNTH_GAME2: Track = { id: "synth-game2", name: "Wingfighter – bitva II (Rangers)", kind: "synth" };

let settings: MusicSettings = { menuTrackId: SYNTH_MENU.id, gameTrackIds: [SYNTH_GAME.id, SYNTH_GAME2.id], volume: 0.5 };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) settings = { ...settings, ...(JSON.parse(raw) as Partial<MusicSettings>) };
} catch {
  /* ignore */
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
export function getMusicSettings(): MusicSettings {
  return settings;
}
export function setMusicVolume(v: number) {
  settings.volume = Math.max(0, Math.min(1, v));
  save();
  applyVolume();
}
export function setMenuTrack(id: string | null) {
  settings.menuTrackId = id;
  save();
  if (mode === "menu") restart();
}
export function toggleGameTrack(id: string, on: boolean) {
  const set = new Set(settings.gameTrackIds);
  if (on) set.add(id);
  else set.delete(id);
  settings.gameTrackIds = [...set];
  save();
  if (mode === "game" && (!current || !settings.gameTrackIds.includes(current.id))) restart();
}

/* ---------- knihovna (IndexedDB) ---------- */

let files: Track[] = [];
const listeners = new Set<() => void>();
export function onLibraryChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) fn();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function loadLibrary() {
  try {
    const db = await openDb();
    const rows = await new Promise<{ id: string; name: string; blob: Blob }[]>((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => res(req.result as { id: string; name: string; blob: Blob }[]);
      req.onerror = () => rej(req.error);
    });
    files = rows.map((r) => ({ id: r.id, name: r.name, kind: "file" as const, blob: r.blob }));
    notify();
  } catch {
    files = [];
  }
}

export async function addFiles(list: FileList | File[]) {
  const db = await openDb();
  for (const f of Array.from(list)) {
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id, name: f.name.replace(/\.[^.]+$/, ""), blob: f });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    files.push({ id, name: f.name.replace(/\.[^.]+$/, ""), kind: "file", blob: f });
  }
  notify();
}

export async function removeFile(id: string) {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  files = files.filter((f) => f.id !== id);
  if (settings.menuTrackId === id) settings.menuTrackId = null;
  settings.gameTrackIds = settings.gameTrackIds.filter((x) => x !== id);
  save();
  if (current?.id === id) restart();
  notify();
}

export function allTracks(): Track[] {
  return [SYNTH_MENU, SYNTH_GAME, SYNTH_GAME2, ...files];
}

/* ---------- přehrávání ---------- */

type Mode = "off" | "menu" | "game";
let mode: Mode = "off";
let current: Track | null = null;
let playlistPos = 0;

interface Playing {
  stop(fadeSec: number): void;
  setVolume(v: number): void;
}
let playing: Playing | null = null;

function applyVolume() {
  playing?.setVolume(settings.volume);
}

export function currentTrackName(): string | null {
  return current?.name ?? null;
}

/** Přepne režim (menu / bitva / nic) s prolnutím. */
export function playMode(m: Mode) {
  if (m === mode && playing) return;
  mode = m;
  restart();
}

function restart() {
  playing?.stop(0.8);
  playing = null;
  current = null;
  if (mode === "off") return;
  const tracks = allTracks();
  if (mode === "menu") {
    const t = tracks.find((x) => x.id === settings.menuTrackId);
    if (t) start(t);
    return;
  }
  const list = settings.gameTrackIds.map((id) => tracks.find((x) => x.id === id)).filter((x): x is Track => !!x);
  if (list.length === 0) return;
  playlistPos = playlistPos % list.length;
  start(list[playlistPos]);
}

function next() {
  if (mode !== "game") {
    restart();
    return;
  }
  const list = settings.gameTrackIds.map((id) => allTracks().find((x) => x.id === id)).filter((x): x is Track => !!x);
  if (list.length === 0) return;
  playlistPos = (playlistPos + 1) % list.length;
  playing = null;
  start(list[playlistPos]);
}

function start(t: Track) {
  const c = audioContext();
  if (!c) return;
  current = t;
  playing = t.kind === "file" ? startFile(c, t) : startSynth(c, songOf(t.id));
  applyVolume();
}

/* --- soubory --- */
function startFile(c: AudioContext, t: Track): Playing {
  const el = new Audio();
  el.src = URL.createObjectURL(t.blob!);
  el.loop = false;
  const src = c.createMediaElementSource(el);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(settings.volume, c.currentTime + 1);
  src.connect(g).connect(musicBus());
  el.addEventListener("ended", () => next());
  void el.play().catch(() => undefined);
  return {
    stop(fade) {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.linearRampToValueAtTime(0.0001, c.currentTime + fade);
      setTimeout(() => {
        el.pause();
        URL.revokeObjectURL(el.src);
      }, fade * 1000 + 50);
    },
    setVolume(v) {
      g.gain.setValueAtTime(v, c.currentTime);
    },
  };
}

/* --- syntetizované skladby (sekvencer) --- */

/* ---------- syntetizované skladby (chiptune sekvencer) ---------- */

type Voice = "bass" | "sub" | "lead" | "brass" | "harm" | "arp" | "pad" | "riser";
interface Ev {
  v: Voice;
  b: number; // doba
  l: number; // délka v dobách
  n: number; // MIDI
  vel: number;
}
interface Drums {
  kick: number[];
  snare: number[];
  hat: number[];
  ohat: number[];
}
interface Song {
  bpm: number;
  beats: number;
  ev: Ev[];
  drums: Drums;
  /** Charakter: menu = měkčí vlny, bitva = ostré pulzy. */
  bright: boolean;
}

const N = (n: number) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz
const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "E5" → MIDI 76 */
function midi(s: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error(`nota ${s}`);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
/** Melodie zapsaná jako "E5:2 G5:1 -:1" (nota:délka, - = pauza), od doby `at`. */
function phrase(v: Voice, at: number, txt: string, vel: number, out: Ev[], legato = 0.92) {
  let b = at;
  for (const tok of txt.trim().split(/\s+/)) {
    const [name, len] = tok.split(":");
    const l = Number(len ?? 1);
    if (name !== "-") out.push({ v, b, l: l * legato, n: midi(name), vel });
    b += l;
  }
  return b;
}
/** Akord: kořen (MIDI) + typ. */
const CH: Record<string, number[]> = { m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], sus: [0, 5, 7], dom: [0, 4, 7, 10] };
function chordNotes(root: string, type: keyof typeof CH) {
  const r = midi(root);
  return CH[type].map((i) => r + i);
}
/** Arpeggio přes akord: vzor indexů do akordu (+12 = o oktávu výš), krok v dobách. */
function arp(at: number, len: number, chord: number[], pattern: number[], step: number, vel: number, out: Ev[], v: Voice = "arp") {
  for (let b = 0, i = 0; b < len - 1e-6; b += step, i++) {
    const p = pattern[i % pattern.length];
    out.push({ v, b: at + b, l: step * 0.8, n: chord[p % chord.length] + 12 * Math.floor(p / chord.length), vel });
  }
}
function pad(at: number, len: number, chord: number[], vel: number, out: Ev[]) {
  for (const n of chord) out.push({ v: "pad", b: at, l: len * 0.98, n, vel });
}
/** Harmonie k melodii: nejbližší tón akordu 3–5 půltónů pod melodií. */
function harmonize(ev: Ev[], from: number, to: number, chordAt: (b: number) => number[], vel: number, out: Ev[]) {
  for (const e of ev) {
    if ((e.v !== "lead" && e.v !== "brass") || e.b < from || e.b >= to) continue;
    const ch = chordAt(e.b);
    let best = e.n - 4;
    let bd = 99;
    for (const c of ch) for (const o of [-24, -12, 0, 12, 24]) {
      const d = e.n - (c + o);
      if (d >= 3 && d <= 5 && Math.abs(d - 4) < bd) (bd = Math.abs(d - 4)), (best = c + o);
    }
    out.push({ ...e, v: "harm", n: best, vel });
  }
}
const rep = (base: number[], len: number, times: number, off = 0) => Array.from({ length: times }, (_, k) => base.map((b) => off + k * len + b)).flat();

/* ===== Hlavní menu: A moll, 88 BPM, 128 dob (~87 s), klidné ale s tahem ===== */
const MENU_SONG: Song = (() => {
  const ev: Ev[] = [];
  const d: Drums = { kick: [], snare: [], hat: [], ohat: [] };
  type Bar = [string, keyof typeof CH];
  // části po 8 dobách na akord
  const intro: Bar[] = [["A2", "m"], ["E2", "m"]];
  const secA: Bar[] = [["A2", "m"], ["F2", "M"], ["G2", "M"], ["E2", "m"]];
  const secB: Bar[] = [["F2", "M"], ["G2", "M"], ["C3", "M"], ["E2", "dom"]];
  const bridge: Bar[] = [["D2", "m"], ["A2", "m"]];
  const plan: { bars: Bar[]; drums: 0 | 1 | 2; arpPat: number[]; arpStep: number; padVel: number }[] = [
    { bars: intro, drums: 0, arpPat: [0, 1, 2, 4], arpStep: 1, padVel: 0.05 },
    { bars: secA, drums: 1, arpPat: [0, 1, 2, 4, 2, 1], arpStep: 0.5, padVel: 0.045 },
    { bars: secB, drums: 2, arpPat: [0, 2, 4, 5, 4, 2], arpStep: 0.5, padVel: 0.05 },
    { bars: secA, drums: 2, arpPat: [0, 1, 2, 4, 5, 4, 2, 1], arpStep: 0.5, padVel: 0.045 },
    { bars: bridge, drums: 0, arpPat: [0, 2, 4, 2], arpStep: 1, padVel: 0.06 },
  ];
  const chordMap: [number, number[]][] = [];
  let b = 0;
  for (const sec of plan) {
    for (const [root, type] of sec.bars) {
      const ch = chordNotes(root, type).map((n) => n + 12); // akord kolem C4
      chordMap.push([b, ch]);
      // basa: kořen + oktáva, lehce synkopovaná
      const r = midi(root);
      if (sec.drums === 0) ev.push({ v: "bass", b, l: 7.5, n: r, vel: 0.12 });
      else for (const [bb, l, up] of [[0, 1.5, 0], [1.5, 0.5, 12], [2, 1.5, 0], [3.5, 0.5, 7], [4, 1.5, 0], [5.5, 0.5, 12], [6, 1, 0], [7, 1, 7]] as [number, number, number][]) ev.push({ v: "bass", b: b + bb, l: l * 0.9, n: r + up, vel: 0.12 });
      pad(b, 8, ch, sec.padVel, ev);
      ev.push({ v: "sub", b, l: 7.9, n: r - 12, vel: 0.09 }); // hluboký dron pod vším (vesmírná atmosféra)
      arp(b, 8, ch, sec.arpPat, sec.arpStep, 0.055, ev);
      if (sec.drums >= 1) {
        d.kick.push(b, b + 4, b + 5.5);
        d.snare.push(b + 2, b + 6);
        d.hat.push(...rep([0.5, 1.5, 2.5, 3.5], 4, 2, b));
      }
      if (sec.drums === 2) {
        d.hat.push(...rep([0, 1, 2, 3], 4, 2, b));
        d.ohat.push(b + 7.5);
      }
      b += 8;
    }
  }
  const melA = "E5:2 G5:1 A5:3 G5:1 E5:1  F5:2 E5:1 C5:3 D5:1 E5:1  D5:2 E5:1 G5:3 A5:1 G5:1  E5:4 B4:2 C5:1 D5:1";
  const melB = "C5:1.5 D5:0.5 E5:2 G5:2 A5:2  B5:3 A5:1 G5:2 E5:2  A5:2 G5:1 E5:2 D5:1 C5:2  B4:3 G#4:1 B4:2 -:2";
  const melA2 = "E5:2 G5:1 A5:2 B5:1 C6:2  A5:2 G5:1 E5:2 F5:1 E5:2  D5:2 E5:1 G5:2 A5:1 B5:2  E5:3 B4:1 C5:1 D5:1 E5:2";
  phrase("lead", 16, melA, 0.1, ev);
  phrase("lead", 48, melB, 0.1, ev);
  phrase("lead", 80, melA2, 0.1, ev);
  const chordAt = (x: number) => [...chordMap].reverse().find(([s]) => s <= x)?.[1] ?? [];
  harmonize(ev, 80, 112, chordAt, 0.055, ev);
  return { bpm: 88, beats: b, ev, drums: d, bright: false };
})();

/* ===== Bitva: E moll, 140 BPM, 184 dob (~79 s), hnací basa, ostré pulzy ===== */
const GAME_SONG: Song = (() => {
  const ev: Ev[] = [];
  const d: Drums = { kick: [], snare: [], hat: [], ohat: [] };
  type Bar = [string, keyof typeof CH];
  const A: Bar[] = [["E2", "m"], ["E2", "m"], ["C2", "M"], ["D2", "M"]];
  const B: Bar[] = [["A2", "m"], ["A2", "m"], ["C2", "M"], ["B1", "M"]];
  const C: Bar[] = [["G2", "M"], ["D2", "M"], ["E2", "m"], ["C2", "M"]];
  const brk: Bar[] = [["E2", "m"], ["C2", "M"]];
  type Style = "intro" | "drive" | "tense" | "chorus" | "break";
  const plan: { bars: Bar[]; style: Style; times: number }[] = [
    { bars: [["E2", "m"], ["E2", "m"]], style: "intro", times: 1 },
    { bars: A, style: "drive", times: 2 },
    { bars: B, style: "tense", times: 2 },
    { bars: C, style: "chorus", times: 2 },
    { bars: A, style: "drive", times: 2 },
    { bars: brk, style: "break", times: 2 },
    { bars: C, style: "chorus", times: 2 },
  ];
  const chordMap: [number, number[]][] = [];
  let b = 0;
  const sections: [number, Style][] = [];
  for (const sec of plan) {
    sections.push([b, sec.style]);
    for (let t = 0; t < sec.times; t++)
      for (const [root, type] of sec.bars) {
        const r = midi(root);
        const ch = chordNotes(root, type).map((n) => n + 24);
        chordMap.push([b, ch]);
        const s = sec.style;
        // basa
        if (s === "break") ev.push({ v: "bass", b, l: 3.8, n: r, vel: 0.1 });
        else if (s === "intro") for (let i = 0; i < 8; i++) ev.push({ v: "bass", b: b + i * 0.5, l: 0.4, n: r, vel: 0.11 });
        else {
          const pat = s === "chorus" ? [0, 12, 0, 7, 0, 12, 7, 12] : [0, 0, 12, 0, 0, 12, 0, 10];
          for (let i = 0; i < 8; i++) ev.push({ v: "bass", b: b + i * 0.5, l: 0.4, n: r + pat[i], vel: 0.12 });
        }
        // arpeggia / pad
        if (s === "drive") arp(b, 4, ch, [0, 1, 2, 3, 2, 1], 0.25, 0.045, ev);
        if (s === "tense") arp(b, 4, ch, [0, 2, 1, 3], 0.5, 0.05, ev);
        if (s === "chorus") (arp(b, 4, ch, [0, 1, 2, 4, 5, 4, 2, 1], 0.25, 0.04, ev), pad(b, 4, ch, 0.035, ev));
        if (s === "break") (pad(b, 4, ch, 0.05, ev), arp(b, 4, ch, [0, 2, 4, 2], 0.5, 0.04, ev));
        // bicí
        if (s === "intro") {
          d.hat.push(...rep([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4, 1, b));
          d.kick.push(b, b + 2);
          if (b >= 4) d.snare.push(b + 2, b + 3, b + 3.25, b + 3.5, b + 3.75);
        } else if (s === "break") {
          d.hat.push(...rep([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4, 1, b));
          if (b - sections[sections.length - 1][0] >= 4) d.snare.push(...rep([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4, 1, b));
        } else {
          d.kick.push(b, b + 1.5, b + 2, b + 3.5);
          d.snare.push(b + 1, b + 3);
          d.hat.push(...rep([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4, 1, b));
          if (s === "chorus") (d.ohat.push(b + 2.5), d.snare.push(b + 2.5, b + 2.75)); // pochodový „ra-ta“
          if (s === "tense") d.snare.push(b + 3.75);
        }
        b += 4;
      }
  }
  // melodie (po 32 dobách)
  const melA = "E5:1 G5:0.5 B5:0.5 A5:2  G5:1 E5:1 D5:2  E5:1 G5:0.5 B5:0.5 C6:2  B5:1 A5:1 G5:2  C5:1.5 E5:0.5 G5:2  F#5:1 E5:1 D5:2  D5:1.5 F#5:0.5 A5:2  G5:1 F#5:1 E5:2";
  const melB = "A5:0.5 -:0.5 A5:0.5 -:0.5 C6:1 B5:1  A5:0.5 G5:0.5 E5:2 -:1  C6:0.5 -:0.5 C6:0.5 -:0.5 D6:1 C6:1  B5:1 D#5:1 F#5:2  A5:0.5 -:0.5 A5:0.5 -:0.5 E6:1 D6:1  C6:1 B5:1 A5:2  G5:1 E5:1 C6:1 B5:1  D#5:1 F#5:1 B5:2";
  // refrén: fanfára – skoky o kvartu/kvintu, tečkovaný rytmus (pochodový, hrdinský charakter)
  const melC = "G5:1.5 D6:0.5 G6:2  F#6:0.75 D6:0.25 A5:1 D6:2  E6:0.75 E6:0.25 E6:0.5 B5:1.5 G5:1  C6:0.5 D6:0.5 E6:1 G6:2  G6:1.5 D6:0.5 B5:2  A5:0.75 A5:0.25 D6:1 F#6:2  G6:1 F#6:0.5 E6:0.5 B5:2  C6:1 E6:1 D6:1 B5:1";
  const melA2 = "E6:0.5 -:0.5 E6:0.5 D6:0.5 B5:2  G5:1 A5:1 B5:2  E6:0.5 -:0.5 E6:0.5 D6:0.5 C6:2  B5:0.5 C6:0.5 B5:0.5 A5:0.5 G5:2  C6:1 E6:1 G6:2  F#6:1 E6:1 D6:2  D6:1 F#6:1 A6:1 F#6:1  G6:0.5 F#6:0.5 E6:0.5 D6:0.5 E6:2";
  const starts = sections.map(([s]) => s);
  phrase("lead", starts[1], melA, 0.1, ev, 0.85);
  phrase("lead", starts[2], melB, 0.1, ev, 0.8);
  phrase("brass", starts[3], melC, 0.12, ev, 0.9);
  phrase("lead", starts[4], melA2, 0.1, ev, 0.85);
  phrase("brass", starts[6], melC, 0.12, ev, 0.9);
  phrase("lead", starts[6], melC, 0.05, ev, 0.9); // zdvojení ostrým pulzem o stejné výšce = lesk
  const chordAt = (x: number) => [...chordMap].reverse().find(([s]) => s <= x)?.[1] ?? [];
  harmonize(ev, starts[3], starts[4], chordAt, 0.06, ev);
  harmonize(ev, starts[6], b, chordAt, 0.06, ev);
  // v breaku melodie o oktávu níž, tiše (ozvěna motivu A)
  phrase("lead", starts[5] + 8, "E5:1 G5:0.5 B5:0.5 A5:2 G5:1 E5:1 D5:2", 0.06, ev);
  return { bpm: 140, beats: b, ev, drums: d, bright: true };
})();

/* ===== Bitva II: D moll, 138 BPM, 176 dob (~77 s) – elektronika ve stylu Space Rangers:
   offbeatová basa, šestnáctinová arpeggia, pumpující kopák, build-up s nájezdem a drop ===== */
const GAME2_SONG: Song = (() => {
  const ev: Ev[] = [];
  const d: Drums = { kick: [], snare: [], hat: [], ohat: [] };
  type Bar = [string, keyof typeof CH];
  const A: Bar[] = [["D2", "m"], ["D2", "m"], ["Bb1", "M"], ["C2", "M"]];
  const B: Bar[] = [["F2", "M"], ["C2", "M"], ["D2", "m"], ["A1", "M"]];
  const brk: Bar[] = [["Bb1", "M7"], ["C2", "M"], ["D2", "m7"], ["D2", "m7"]];
  type Style = "intro" | "groove" | "build" | "drop" | "break" | "drop2";
  const plan: { bars: Bar[]; style: Style; times: number }[] = [
    { bars: [["D2", "m"], ["D2", "m"], ["D2", "m"], ["D2", "m"]], style: "intro", times: 1 },
    { bars: A, style: "groove", times: 2 },
    { bars: B, style: "build", times: 1 },
    { bars: A, style: "drop", times: 2 },
    { bars: brk, style: "break", times: 1 },
    { bars: B, style: "build", times: 1 },
    { bars: A, style: "drop2", times: 2 },
  ];
  const chordMap: [number, number[]][] = [];
  const sections: [number, Style][] = [];
  let b = 0;
  for (const sec of plan) {
    sections.push([b, sec.style]);
    const secStart = b;
    for (let t = 0; t < sec.times; t++)
      for (const [root, type] of sec.bars) {
        const r = midi(root);
        const ch = chordNotes(root, type).map((n) => n + 24);
        chordMap.push([b, ch]);
        const s = sec.style;
        const rel = b - secStart; // doba v rámci sekce
        // basa: offbeat osminy (trance), v breaku dlouhý tón
        if (s === "break") ev.push({ v: "bass", b, l: 3.8, n: r, vel: 0.09 });
        else if (s === "intro") { if (rel >= 4) for (let i = 0; i < 8; i++) ev.push({ v: "bass", b: b + i * 0.5, l: 0.3, n: r + (i % 4 === 3 ? 12 : 0), vel: 0.08 + rel * 0.004 }); }
        else for (let i = 0; i < 8; i++) ev.push({ v: "bass", b: b + i * 0.5 + 0.25, l: 0.22, n: r + (s === "drop2" && i % 4 === 3 ? 12 : 0), vel: 0.13 });
        ev.push({ v: "sub", b, l: 3.9, n: r - 12, vel: s === "break" ? 0.06 : 0.09 });
        // arpeggia: šestnáctiny, v dropu výš a hlasitěji
        if (s === "intro") { if (rel >= 8) arp(b, 4, ch, [0, 1, 2, 3], 0.25, 0.03 + (rel - 8) * 0.003, ev); }
        else if (s === "groove") arp(b, 4, ch, [0, 2, 1, 3, 2, 4, 3, 5], 0.25, 0.045, ev);
        else if (s === "build") arp(b, 4, ch, [0, 1, 2, 3, 4, 5, 6, 7], 0.25, 0.04 + rel * 0.002, ev);
        else if (s === "break") (pad(b, 4, ch, 0.05, ev), arp(b, 4, ch, [0, 4, 2, 5], 0.5, 0.035, ev));
        else (arp(b, 4, ch, [3, 5, 4, 6, 3, 7, 5, 6], 0.25, 0.05, ev), pad(b, 4, ch, 0.03, ev));
        // bicí: čtyřčtvrťový kopák, offbeat otevřený hi-hat, snare na 2 a 4
        if (s === "intro") {
          d.hat.push(...rep([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4, 1, b));
          if (rel >= 8) d.kick.push(b, b + 1, b + 2, b + 3);
          if (rel >= 12) d.snare.push(b + 1, b + 3);
        } else if (s === "break") {
          d.hat.push(...rep([0.5, 1.5, 2.5, 3.5], 4, 1, b));
          if (rel >= 8) d.kick.push(b, b + 2);
        } else if (s === "build") {
          d.kick.push(b, b + 1, b + 2, b + 3);
          d.hat.push(...rep([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4, 1, b));
          // snare se zhušťuje: 2 a 4 → osminy → šestnáctiny
          if (rel < 8) d.snare.push(b + 1, b + 3);
          else if (rel < 12) d.snare.push(...rep([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4, 1, b));
          else d.snare.push(...Array.from({ length: 16 }, (_, i) => b + i * 0.25));
        } else {
          d.kick.push(b, b + 1, b + 2, b + 3);
          d.ohat.push(b + 0.5, b + 1.5, b + 2.5, b + 3.5);
          d.hat.push(...rep([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75], 4, 1, b));
          d.snare.push(b + 1, b + 3);
          if (s === "drop2" && rel % 16 === 12) d.snare.push(b + 3.5, b + 3.75);
        }
        b += 4;
      }
    if (sec.style === "build") ev.push({ v: "riser", b: secStart, l: 16, n: 0, vel: 0.12 });
  }
  const starts = sections.map(([s]) => s);
  // melodie: groove – krátké syntetické motivy s pauzami; drop – široký lead (žesťový sbor = supersaw)
  const melG = "D5:0.5 -:0.5 F5:0.5 -:0.5 A5:1 G5:0.5 F5:0.5  -:1 D5:0.5 F5:0.5 E5:1 -:1  Bb4:0.5 -:0.5 D5:0.5 -:0.5 F5:1 E5:0.5 D5:0.5  C5:1 E5:1 G5:1.5 -:0.5  D5:0.5 -:0.5 F5:0.5 -:0.5 A5:1 C6:0.5 A5:0.5  -:1 G5:0.5 F5:0.5 E5:1 -:1  Bb4:0.5 D5:0.5 F5:0.5 Bb5:0.5 A5:1 F5:1  G5:0.5 E5:0.5 C5:1 E5:1 G5:1";
  const melD = "A5:1.5 D6:0.5 C6:1 A5:1  F5:1 G5:1 A5:2  Bb5:1.5 D6:0.5 F6:1 D6:1  E6:1 C6:1 G5:2  A5:1.5 D6:0.5 C6:1 A5:1  F5:1 G5:1 A5:1 C6:1  D6:1 F6:1 D6:0.5 C6:0.5 A5:1  G5:1 E6:1 G6:1 E6:1";
  const melD2 = "A6:0.5 -:0.5 A6:0.5 G6:0.5 F6:1 D6:1  C6:0.5 D6:0.5 F6:1 E6:1 C6:1  D6:0.5 -:0.5 D6:0.5 C6:0.5 Bb5:1 D6:1  F6:1 E6:0.5 C6:0.5 G5:2  A5:0.5 C6:0.5 D6:0.5 F6:0.5 A6:1 G6:1  F6:1 E6:1 D6:2  Bb5:1 D6:1 F6:1 Bb6:1  A6:1 G6:1 E6:1 C6:1";
  phrase("lead", starts[1], melG, 0.085, ev, 0.7);
  phrase("brass", starts[3], melD, 0.11, ev, 0.9);
  phrase("brass", starts[6], melD2, 0.11, ev, 0.9);
  phrase("lead", starts[6], melD2, 0.04, ev, 0.9);
  const chordAt = (x: number) => [...chordMap].reverse().find(([s]) => s <= x)?.[1] ?? [];
  harmonize(ev, starts[3], starts[4], chordAt, 0.05, ev);
  harmonize(ev, starts[6], b, chordAt, 0.05, ev);
  // v breaku tichá ozvěna hlavního motivu
  phrase("lead", starts[4] + 4, "A5:1.5 D6:0.5 C6:1 A5:1 F5:1 G5:1 A5:2", 0.05, ev);
  return { bpm: 138, beats: b, ev, drums: d, bright: true };
})();

function songOf(id: string): Song {
  return id === SYNTH_MENU.id ? MENU_SONG : id === SYNTH_GAME2.id ? GAME2_SONG : GAME_SONG;
}

/** Pulzní vlna s danou střídou (klasický chiptune zvuk). */
const pulseCache = new Map<string, PeriodicWave>();
function pulse(c: BaseAudioContext, duty: number): PeriodicWave {
  const key = `${duty}`;
  let w = pulseCache.get(key);
  if (!w) {
    const n = 32;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    w = c.createPeriodicWave(re, im, { disableNormalization: false });
    pulseCache.set(key, w);
  }
  return w;
}

function startSynth(c: BaseAudioContext, song: Song, dest: AudioNode = musicBus(), offlineSeconds = 0): Playing {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(offlineSeconds ? 0.8 : settings.volume, c.currentTime + 1.5);
  // limiter proti přebuzení v hutných místech (refrén s žesti + bicí)
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const mix = c.createGain();
  mix.gain.value = 0.85;
  mix.connect(comp).connect(g);
  g.connect(dest);
  const spb = 60 / song.bpm;
  // sběrnice: lead/arp přes tempovou ozvěnu (vesmírný prostor), pad přes lowpass
  const echoIn = c.createGain();
  const delay = c.createDelay(2);
  delay.delayTime.value = spb * 0.75;
  const fb = c.createGain();
  fb.gain.value = song.bright ? 0.28 : 0.35;
  const wet = c.createGain();
  wet.gain.value = 0.35;
  const dampen = c.createBiquadFilter();
  dampen.type = "lowpass";
  dampen.frequency.value = 2400;
  echoIn.connect(mix);
  echoIn.connect(delay);
  delay.connect(dampen).connect(fb).connect(delay);
  dampen.connect(wet).connect(mix);
  const brassBus = c.createBiquadFilter();
  brassBus.type = "lowpass";
  brassBus.frequency.value = 2200;
  brassBus.Q.value = 1.2;
  brassBus.connect(echoIn);
  const padBus = c.createBiquadFilter();
  padBus.type = "lowpass";
  padBus.frequency.value = song.bright ? 1400 : 900;
  padBus.connect(mix);
  const leadWave = pulse(c, song.bright ? 0.25 : 0.5);
  const arpWave = pulse(c, 0.125);
  const harmWave = pulse(c, 0.25);
  const note = (e: Ev, t0: number) => {
    const dur = e.l * spb;
    if (e.v === "riser") {
      // šumový nájezd s rostoucím filtrem (build-up před dropem)
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.5;
      f.frequency.setValueAtTime(200, t0);
      f.frequency.exponentialRampToValueAtTime(6000, t0 + dur);
      const en = c.createGain();
      en.gain.setValueAtTime(0.0001, t0);
      en.gain.exponentialRampToValueAtTime(e.vel, t0 + dur);
      en.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.1);
      s.connect(f).connect(en).connect(mix);
      s.start(t0);
      s.stop(t0 + dur + 0.15);
      return;
    }
    const o = c.createOscillator();
    const f = N(e.n);
    let dest: AudioNode = mix;
    let vel = e.vel;
    if (e.v === "bass") o.type = song.bright ? "sawtooth" : "triangle";
    else if (e.v === "sub") o.type = "sine";
    else if (e.v === "brass") (o.type = "sawtooth"), (dest = brassBus);
    else if (e.v === "lead") (o.setPeriodicWave(leadWave), (dest = echoIn));
    else if (e.v === "harm") (o.setPeriodicWave(harmWave), (dest = echoIn));
    else if (e.v === "arp") (o.setPeriodicWave(arpWave), (dest = echoIn));
    else (o.type = "triangle"), (dest = padBus);
    o.frequency.setValueAtTime(f, t0);
    if ((e.v === "lead" || e.v === "brass") && dur > 0.35) {
      // vibrato na delších tónech
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t0);
      lg.gain.linearRampToValueAtTime(f * 0.012, t0 + 0.25);
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    if (e.v === "pad" || e.v === "brass") {
      // lehké rozladění pro šířku (pad) / „žesťový“ sbor (brass)
      const o2 = c.createOscillator();
      o2.type = e.v === "pad" ? "triangle" : "sawtooth";
      o2.frequency.setValueAtTime(f * (e.v === "pad" ? 1.004 : 0.994), t0);
      const e2 = c.createGain();
      const a2 = e.v === "pad" ? 0.6 : 0.04;
      e2.gain.setValueAtTime(0.0001, t0);
      e2.gain.linearRampToValueAtTime(vel * 0.8, t0 + a2);
      e2.gain.setValueAtTime(vel * 0.8, t0 + Math.max(a2 + 0.05, dur - (e.v === "pad" ? 0.5 : 0.06)));
      e2.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      o2.connect(e2).connect(dest);
      o2.start(t0);
      o2.stop(t0 + dur + 0.05);
    }
    const env = c.createGain();
    const atk = e.v === "pad" ? 0.6 : e.v === "sub" ? 0.3 : e.v === "brass" ? 0.04 : 0.008;
    const rel = e.v === "pad" ? 0.5 : e.v === "sub" ? 0.4 : e.v === "bass" ? 0.03 : 0.06;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(vel, t0 + atk);
    if (e.v === "arp" || e.v === "bass") env.gain.exponentialRampToValueAtTime(vel * 0.5, t0 + Math.max(atk + 0.01, dur * 0.7)); // perkusivní
    env.gain.setValueAtTime(e.v === "arp" || e.v === "bass" ? vel * 0.5 : vel, t0 + Math.max(atk + 0.01, dur - rel));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.01);
    o.connect(env).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  };
  const noiseBuf = (() => {
    const len = Math.ceil(c.sampleRate * 0.3);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const dd = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
    return buf;
  })();
  const drum = (kind: "kick" | "snare" | "hat" | "ohat", t0: number) => {
    if (kind === "kick") {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(160, t0);
      o.frequency.exponentialRampToValueAtTime(42, t0 + 0.11);
      const e = c.createGain();
      e.gain.setValueAtTime(song.bright ? 0.32 : 0.24, t0);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(e).connect(mix);
      o.start(t0);
      o.stop(t0 + 0.18);
      // klik na začátku
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      const eg = c.createGain();
      eg.gain.setValueAtTime(0.08, t0);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02);
      s.connect(eg).connect(mix);
      s.start(t0);
      s.stop(t0 + 0.03);
      return;
    }
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    const e = c.createGain();
    let len = 0.04;
    if (kind === "snare") {
      f.type = "bandpass";
      f.frequency.value = 1800;
      f.Q.value = 0.7;
      len = 0.16;
      e.gain.setValueAtTime(song.bright ? 0.2 : 0.14, t0);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(220, t0);
      o.frequency.exponentialRampToValueAtTime(120, t0 + 0.08);
      const eo = c.createGain();
      eo.gain.setValueAtTime(0.15, t0);
      eo.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      o.connect(eo).connect(mix);
      o.start(t0);
      o.stop(t0 + 0.1);
    } else {
      f.type = "highpass";
      f.frequency.value = 7000;
      len = kind === "ohat" ? 0.22 : 0.035;
      e.gain.setValueAtTime(kind === "ohat" ? 0.06 : 0.045, t0);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    }
    s.connect(f).connect(e).connect(mix);
    s.start(t0);
    s.stop(t0 + len + 0.01);
  };
  // seřazený seznam událostí jedné smyčky; plánujeme vždy jen ~1,5 s dopředu
  type Item = { b: number; run: (t: number) => void };
  const items: Item[] = [];
  for (const e of song.ev) items.push({ b: e.b, run: (t) => note(e, t) });
  for (const k of ["kick", "snare", "hat", "ohat"] as const) for (const b of song.drums[k]) items.push({ b, run: (t) => drum(k, t) });
  items.sort((x, y) => x.b - y.b);
  const loopSec = song.beats * spb;
  let loopStart = c.currentTime + 0.1;
  let pos = 0;
  let stopped = false;
  const schedule = (horizon: number) => {
    for (;;) {
      if (pos >= items.length) {
        loopStart += loopSec;
        pos = 0;
      }
      const it = items[pos];
      const t = loopStart + it.b * spb;
      if (t > horizon) break;
      if (t >= c.currentTime) it.run(t);
      pos++;
    }
  };
  const tick = () => {
    if (stopped) return;
    schedule(c.currentTime + 1.5);
    timer = window.setTimeout(tick, 300);
  };
  let timer = 0;
  if (offlineSeconds) schedule(offlineSeconds);
  else timer = window.setTimeout(tick, 0);
  return {
    stop(fade) {
      stopped = true;
      clearTimeout(timer);
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.linearRampToValueAtTime(0.0001, c.currentTime + fade);
      setTimeout(() => g.disconnect(), fade * 1000 + 100);
    },
    setVolume(v) {
      g.gain.setValueAtTime(v, c.currentTime);
    },
  };
}

/** Ladicí export: vyrenderuje vestavěnou skladbu do WAV (offline), např. pro poslech mimo hru. */
export async function renderSynth(id: string, seconds: number): Promise<Blob> {
  const song = songOf(id);
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  startSynth(off, song, off.destination, seconds);
  const buf = await off.startRendering();
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); out.setUint32(4, 36 + n * 4, true); str(8, "WAVE"); str(12, "fmt "); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return new Blob([out], { type: "audio/wav" });
}
