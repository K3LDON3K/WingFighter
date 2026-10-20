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

let settings: MusicSettings = { menuTrackId: SYNTH_MENU.id, gameTrackIds: [SYNTH_GAME.id], volume: 0.5 };
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
  return [SYNTH_MENU, SYNTH_GAME, ...files];
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
  playing = t.kind === "file" ? startFile(c, t) : t.id === SYNTH_MENU.id ? startSynth(c, MENU_SONG) : startSynth(c, GAME_SONG);
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

interface Song {
  bpm: number;
  /** Délka smyčky v dobách (čtvrťových). */
  beats: number;
  /** Basa: [doba, délka, frekvence] */
  bass: [number, number, number][];
  /** Melodie / arpeggio: [doba, délka, frekvence, hlasitost?] */
  lead: [number, number, number, number?][];
  /** Bicí: doby s kopákem / hi-hatem. */
  kick: number[];
  hat: number[];
  leadWave: OscillatorType;
  bassWave: OscillatorType;
}

const N = (n: number) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

/** Hlavní menu: pomalé, atmosférické (A moll), ~84 BPM, 32 dob. */
const MENU_SONG: Song = (() => {
  const bass: Song["bass"] = [];
  const lead: Song["lead"] = [];
  const roots = [45, 41, 43, 40]; // A2 F2 G2 E2
  roots.forEach((r, bar) => {
    bass.push([bar * 8, 7.5, N(r)]);
    const chord = bar === 0 ? [57, 60, 64, 67] : bar === 1 ? [53, 57, 60, 64] : bar === 2 ? [55, 59, 62, 67] : [52, 56, 59, 64];
    for (let i = 0; i < 16; i++) lead.push([bar * 8 + i * 0.5, 0.45, N(chord[i % 4] + (i >= 8 ? 12 : 0)), 0.09]);
  });
  // horní melodie
  const mel: [number, number, number][] = [[0, 2, 76], [2, 1, 79], [3, 3, 81], [8, 2, 77], [10, 1, 76], [11, 3, 72], [16, 2, 74], [18, 1, 76], [19, 3, 79], [24, 4, 76], [28, 4, 71]];
  for (const [b, l, n] of mel) lead.push([b, l * 0.95, N(n), 0.13]);
  return { bpm: 84, beats: 32, bass, lead, kick: [0, 4, 8, 12, 16, 20, 24, 28], hat: Array.from({ length: 32 }, (_, i) => i + 0.5), leadWave: "triangle", bassWave: "triangle" };
})();

/** Bitva: rychlé, napínavé (E moll → C), 128 BPM, 32 dob. */
const GAME_SONG: Song = (() => {
  const bass: Song["bass"] = [];
  const lead: Song["lead"] = [];
  const roots = [40, 40, 36, 38]; // E2 E2 C2 D2
  roots.forEach((r, bar) => {
    for (let i = 0; i < 8; i++) bass.push([bar * 8 + i, 0.45, N(i % 2 ? r + 12 : r)]);
    const chord = bar < 2 ? [64, 67, 71] : bar === 2 ? [60, 64, 67] : [62, 66, 69];
    for (let i = 0; i < 16; i++) lead.push([bar * 8 + i * 0.5, 0.25, N(chord[i % 3] + 12), 0.07]);
  });
  const mel: [number, number, number][] = [[0, 1, 76], [1, 0.5, 79], [1.5, 0.5, 83], [2, 2, 81], [4, 1, 79], [5, 1, 76], [6, 2, 74], [8, 1, 76], [9, 0.5, 79], [9.5, 0.5, 83], [10, 2, 84], [12, 1, 83], [13, 1, 81], [14, 2, 79], [16, 1.5, 72], [17.5, 0.5, 76], [18, 2, 79], [20, 1, 77], [21, 1, 76], [22, 2, 74], [24, 1.5, 74], [25.5, 0.5, 78], [26, 2, 81], [28, 1, 79], [29, 1, 78], [30, 2, 76]];
  for (const [b, l, n] of mel) lead.push([b, l * 0.9, N(n), 0.12]);
  return { bpm: 128, beats: 32, bass, lead, kick: Array.from({ length: 16 }, (_, i) => i * 2), hat: Array.from({ length: 64 }, (_, i) => i * 0.5 + 0.25), leadWave: "square", bassWave: "sawtooth" };
})();

function startSynth(c: AudioContext, song: Song): Playing {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(settings.volume, c.currentTime + 1.5);
  g.connect(musicBus());
  const spb = 60 / song.bpm;
  const loopSec = song.beats * spb;
  let loopStart = c.currentTime + 0.1;
  let scheduledUntil = loopStart;
  let stopped = false;
  const note = (wave: OscillatorType, f: number, t0: number, dur: number, vol: number) => {
    const o = c.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f, t0);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, t0);
    e.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    e.gain.setValueAtTime(vol, t0 + Math.max(0.02, dur * spb - 0.05));
    e.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * spb);
    o.connect(e).connect(g);
    o.start(t0);
    o.stop(t0 + dur * spb + 0.02);
  };
  const drum = (t0: number, kick: boolean) => {
    if (kick) {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t0);
      o.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
      const e = c.createGain();
      e.gain.setValueAtTime(0.25, t0);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      o.connect(e).connect(g);
      o.start(t0);
      o.stop(t0 + 0.16);
    } else {
      const len = Math.ceil(c.sampleRate * 0.04);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource();
      s.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 6000;
      const e = c.createGain();
      e.gain.value = 0.05;
      s.connect(f).connect(e).connect(g);
      s.start(t0);
    }
  };
  const scheduleLoop = (t0: number) => {
    for (const [b, l, f] of song.bass) note(song.bassWave, f, t0 + b * spb, l, 0.11);
    for (const [b, l, f, v] of song.lead) note(song.leadWave, f, t0 + b * spb, l, v ?? 0.1);
    for (const b of song.kick) drum(t0 + b * spb, true);
    for (const b of song.hat) drum(t0 + b * spb, false);
  };
  const tick = () => {
    if (stopped) return;
    while (scheduledUntil < c.currentTime + 1.5) {
      scheduleLoop(loopStart);
      loopStart += loopSec;
      scheduledUntil = loopStart;
    }
    timer = window.setTimeout(tick, 400);
  };
  let timer = window.setTimeout(tick, 0);
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
