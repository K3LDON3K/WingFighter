import { MOVE_UNIT, STRESS } from "./constants.ts";
import { makePath, type Pose } from "./geometry.ts";
import type { Difficulty, Maneuver, ManeuverProfile, ManeuverSplit } from "./types.ts";

/** Krok směru ve stupních. */
export const ANGLE_STEP = 10;
export const MAX_ANGLE = 90;

/** Profil stíhače – co motor dovolí. Index pole = rychlost. (maxSpeed ladí `applyTuning`.) */
export const FIGHTER_PROFILE: ManeuverProfile = {
  maxSpeed: 5,
  maxAngle: [0, 90, 90, 90, 60, 40],
  /** Otočka 180° jde od rychlosti 2 (při libovolném úhlu, který rychlost dovolí). */
  koiogranSpeeds: [2, 3, 4, 5],
  /** Zrychlení/brzdění: ±1 bílé, ±2 oranžové, ±3 nebezpečné, víc nelze; z 0 až na 2. */
  deltaDanger: 3,
  deltaMax: 3,
  startMax: 2,
  stopMax: 2,
  split: true,
};
/**
 * Profil bitevníku: pomalejší a těžkopádnější – rozjetý zatáčí jen mírně (90/70/50/30°), otočka jen z rychlosti 2–3;
 * zrychluje i brzdí hůř (±2 = nebezpečné, ±3 nelze), z 0 jen na 1, a setrvačnost: už brzdění o 1 je prudké (oranžové).
 */
export const BATTLESHIP_PROFILE: ManeuverProfile = {
  maxSpeed: 4,
  maxAngle: [0, 90, 70, 50, 30, 30],
  koiogranSpeeds: [2, 3],
  deltaDanger: 2,
  deltaMax: 2,
  startMax: 1,
  stopMax: 1,
  brakeRed: true,
};

export function maneuverId(speed: number, angle: number, koiogran = false, stop = false, split?: ManeuverSplit | null): string {
  const z = split ? `z${split.at}a${split.angle2}` : "";
  if (koiogran) return angle || split ? `k${speed}a${angle}${z}` : `k${speed}`;
  return `${stop ? "s" : "m"}${speed}a${angle}${z}`;
}

export interface ParsedManeuver {
  speed: number;
  angle: number;
  koiogran: boolean;
  stop: boolean;
  split?: ManeuverSplit;
}

export function parseManeuverId(id: string): ParsedManeuver | null {
  let m = /^k(\d)$/.exec(id);
  if (m) return { speed: Number(m[1]), angle: 0, koiogran: true, stop: false };
  m = /^([msk])(\d)a(-?\d+)(?:z(\d)a(-?\d+))?$/.exec(id);
  if (!m) return null;
  const out: ParsedManeuver = { speed: Number(m[2]), angle: Number(m[3]), koiogran: m[1] === "k", stop: m[1] === "s" };
  if (m[4] !== undefined) out.split = { at: Number(m[4]), angle2: Number(m[5]) };
  return out;
}

/** Pořadí náročností (pro „horší z obou částí“). */
const DIFF_ORDER: Difficulty[] = ["green", "white", "red", "danger"];
export function worseDifficulty(a: Difficulty, b: Difficulty): Difficulty {
  return DIFF_ORDER.indexOf(a) >= DIFF_ORDER.indexOf(b) ? a : b;
}

/** Je úhel "ostrý" (sám o sobě červený)? */
export function isSharp(speed: number, angle: number, koiogran = false): boolean {
  const a = Math.abs(angle);
  return koiogran || a >= 70 || (speed >= 4 && a >= 40);
}

/**
 * Náročnost děleného manévru: součet úhlů obou částí nesmí přesáhnout max. úhel dané rychlosti
 * a barva je jako u běžného oblouku se stejným součtem úhlů (zlom sám nic nezhoršuje). null = nejde.
 */
export function classifySplitCurve(profile: ManeuverProfile, speed: number, angle: number, split: ManeuverSplit, prevSpeed: number): Difficulty | null {
  if (!profile.split) return null;
  if (!Number.isInteger(split.at) || split.at < 1 || split.at > speed - 1) return null;
  if (!Number.isInteger(split.angle2) || split.angle2 % ANGLE_STEP !== 0) return null;
  if (!Number.isInteger(angle) || angle % ANGLE_STEP !== 0) return null;
  if (speed > profile.maxSpeed || speed >= profile.maxAngle.length) return null;
  const total = Math.abs(angle) + Math.abs(split.angle2);
  if (total > profile.maxAngle[speed]) return null;
  return classifyCurve(profile, speed, total, prevSpeed);
}

/**
 * Náročnost křivky podle rychlosti, úhlu a změny rychlosti oproti minulému kolu; null = loď to nezvládne.
 * zelený = mírný (odstraní stres), oranžový („red“) = prudký (stres),
 * nebezpečný (červený) = změna rychlosti o 2+ spolu s ostrým úhlem (jako oranžový + zranění).
 * Otočka (koiogran) na konci křivky: jde od rychlosti 2; výsledek je oranžový (nebezpečná křivka zůstává nebezpečná),
 * stres viz `maneuverStress`.
 */
export function classifyManeuver(profile: ManeuverProfile, speed: number, angle: number, koiogran: boolean, prevSpeed: number, stop = false, split?: ManeuverSplit | null): Difficulty | null {
  const base = split ? classifySplitCurve(profile, speed, angle, split, prevSpeed) : classifyCurve(profile, speed, angle, prevSpeed);
  if (!base) return null;
  if (stop) {
    // zastavení na konci dráhy: jen bez otočky, z rychlosti 1 (bílé/zelené → bílé) nebo stopMax (oranžové)
    if (koiogran || speed < 1 || speed > (profile.stopMax ?? 1)) return null;
    if (speed >= 2) return base === "danger" ? "danger" : "red";
    return base === "green" ? "white" : base;
  }
  if (!koiogran) return base;
  if (prevSpeed === 0) return null; // stojící loď otočku 180° nezvládne
  if (!profile.koiogranSpeeds.includes(speed)) return null;
  return base === "danger" ? "danger" : "red";
}

/** Náročnost samotné křivky (bez otočky). */
export function classifyCurve(profile: ManeuverProfile, speed: number, angle: number, prevSpeed: number): Difficulty | null {
  if (!Number.isInteger(speed) || speed < 0 || speed > profile.maxSpeed || speed >= profile.maxAngle.length) return null;
  if (!Number.isInteger(angle) || angle % ANGLE_STEP !== 0) return null;
  if (Math.abs(angle) > profile.maxAngle[speed]) return null;
  const delta = Math.abs(speed - prevSpeed);
  if (delta > (profile.deltaMax ?? 3)) return null;
  // zastavení: nejvýš z rychlosti stopMax (z 2 oranžově); rozjezd z 0 nejvýš na startMax
  if (speed === 0 && prevSpeed > (profile.stopMax ?? 1)) return null;
  if (prevSpeed === 0 && speed > (profile.startMax ?? 2)) return null;
  if (speed === 0) return delta >= 2 ? "red" : "white";
  const a = Math.abs(angle);
  const bigChange = delta >= 2;
  const sharp = isSharp(speed, angle, false);
  if (delta >= (profile.deltaDanger ?? 3)) return "danger";
  if (bigChange && sharp) return "danger";
  if (bigChange || sharp) return "red";
  // setrvačnost (bitevník): už brzdění o 1 je prudké
  if (profile.brakeRed && speed < prevSpeed) return "red";
  if ((speed <= 2 && a <= 40) || (speed === 3 && a === 0)) return "green";
  return "white";
}

export function makeManeuver(profile: ManeuverProfile, speed: number, angle: number, koiogran: boolean, prevSpeed: number, stop = false, split?: ManeuverSplit | null): Maneuver | null {
  const difficulty = classifyManeuver(profile, speed, angle, koiogran, prevSpeed, stop, split);
  if (!difficulty) return null;
  const man: Maneuver = { id: maneuverId(speed, angle, koiogran, stop, split), speed, angle, koiogran, difficulty };
  if (stop) man.stop = true;
  if (split) man.split = { at: split.at, angle2: split.angle2 };
  if (koiogran) man.base = (split ? classifySplitCurve(profile, speed, angle, split, prevSpeed) : classifyCurve(profile, speed, angle, prevSpeed)) ?? "white";
  return man;
}

/**
 * Stres za manévr (záporné = dobije). Otočka: 1 na zelené/bílé křivce, červená křivka +1 (= 2),
 * nebezpečná +1 (= 3).
 */
export function maneuverStress(man: Maneuver): number {
  if (!man.koiogran) return stressCost(man.difficulty);
  const b = man.base ?? "white";
  return b === "danger" ? STRESS.costDanger + 1 : b === "red" ? STRESS.costRed + 1 : STRESS.costRed;
}

export function resolveManeuver(profile: ManeuverProfile, id: string, prevSpeed: number): Maneuver | null {
  const p = parseManeuverId(id);
  if (!p) return null;
  return makeManeuver(profile, p.speed, p.angle, p.koiogran, prevSpeed, p.stop, p.split);
}

/** Všechny povolené manévry profilu z dané rychlosti (pro bota a nápovědu). */
export function listManeuvers(profile: ManeuverProfile, prevSpeed: number): Maneuver[] {
  const out: Maneuver[] = [];
  for (let speed = 0; speed <= profile.maxSpeed; speed++) {
    for (let angle = -MAX_ANGLE; angle <= MAX_ANGLE; angle += ANGLE_STEP) {
      const m = makeManeuver(profile, speed, angle, false, prevSpeed);
      if (m) out.push(m);
    }
    for (let angle = -MAX_ANGLE; angle <= MAX_ANGLE; angle += ANGLE_STEP) {
      const k = makeManeuver(profile, speed, angle, true, prevSpeed);
      if (k) out.push(k);
      const st = makeManeuver(profile, speed, angle, false, prevSpeed, true);
      if (st) out.push(st);
    }
  }
  return out;
}

export function isRed(d: Difficulty): boolean {
  return d === "red" || d === "danger";
}

export function maneuverLength(man: Maneuver): number {
  return man.speed * MOVE_UNIT;
}

/** Dráha manévru: t∈[0,1] → poloha. Otočka (koiogran) na konci otočí loď o 180°. */
export function maneuverPath(start: Pose, man: Maneuver): (t: number) => Pose {
  const base = man.split ? splitPath(start, man.speed, man.angle, man.split) : makePath(start, maneuverLength(man), (man.angle * Math.PI) / 180);
  if (!man.koiogran) return base;
  return (t) => {
    const p = base(t);
    if (t >= 1) return { ...p, heading: p.heading + Math.PI };
    return p;
  };
}

/** Dráha děleného manévru: první oblouk `at` políček s `angle`, druhý zbytek s `angle2`; t∈[0,1] přes celou délku. */
export function splitPath(start: Pose, speed: number, angle: number, split: ManeuverSplit): (t: number) => Pose {
  const f1 = (split.at / speed);
  const p1 = makePath(start, split.at * MOVE_UNIT, (angle * Math.PI) / 180);
  const p2 = makePath(p1(1), (speed - split.at) * MOVE_UNIT, (split.angle2 * Math.PI) / 180);
  return (t) => (t <= f1 ? p1(f1 > 0 ? t / f1 : 1) : p2((t - f1) / (1 - f1)));
}

/** Bod zlomu děleného manévru (pro vykreslení ◆). */
export function splitPoint(start: Pose, man: Maneuver): Pose | null {
  if (!man.split) return null;
  return makePath(start, man.split.at * MOVE_UNIT, (man.angle * Math.PI) / 180)(1);
}

export function maneuverEnd(start: Pose, man: Maneuver): Pose {
  return maneuverPath(start, man)(1);
}

export function maneuverLabel(man: Maneuver): string {
  if (man.split) {
    const part = (a: number, n: number) => (a === 0 ? `${n} rovně` : `${n} ${Math.abs(a)}° ${a < 0 ? "vlevo" : "vpravo"}`);
    return `Dělený: ${part(man.angle, man.split.at)}, pak ${part(man.split.angle2, man.speed - man.split.at)}${man.koiogran ? " + otočka" : man.stop ? " + zastavit" : ""}`;
  }
  if (man.koiogran) return man.angle === 0 ? `Otočka ${man.speed}` : `Rychlost ${man.speed}, ${Math.abs(man.angle)}° ${man.angle < 0 ? "vlevo" : "vpravo"} + otočka`;
  if (man.speed === 0) return "Stát (rychlost 0)";
  if (man.stop) return `${man.angle === 0 ? `Rovně ${man.speed}` : `Rychlost ${man.speed}, ${Math.abs(man.angle)}° ${man.angle < 0 ? "vlevo" : "vpravo"}`} + zastavit`;
  if (man.angle === 0) return `Rovně ${man.speed}`;
  return `Rychlost ${man.speed}, ${Math.abs(man.angle)}° ${man.angle < 0 ? "vlevo" : "vpravo"}`;
}

/** Kolik stresových bodů manévr stojí (záporné = dobije). */
export function stressCost(d: Difficulty): number {
  return d === "danger" ? STRESS.costDanger : d === "red" ? STRESS.costRed : d === "green" ? -STRESS.regenGreen : 0;
}
