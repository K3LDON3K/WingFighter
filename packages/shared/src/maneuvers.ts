import { MOVE_UNIT, STRESS } from "./constants.ts";
import { makePath, type Pose } from "./geometry.ts";
import type { Difficulty, Maneuver, ManeuverProfile } from "./types.ts";

/** Krok směru ve stupních. */
export const ANGLE_STEP = 10;
export const MAX_ANGLE = 90;

/** Profil stíhače – co motor dovolí. Index pole = rychlost. (maxSpeed ladí `applyTuning`.) */
export const FIGHTER_PROFILE: ManeuverProfile = {
  maxSpeed: 5,
  maxAngle: [0, 90, 90, 90, 60, 40],
  /** Otočka 180° jde od rychlosti 2 (při libovolném úhlu, který rychlost dovolí). */
  koiogranSpeeds: [2, 3, 4, 5],
};
/** Profil bitevníku: pomalejší a těžkopádnější, otočka jen z rychlosti 2–3. */
export const BATTLESHIP_PROFILE: ManeuverProfile = {
  maxSpeed: 4,
  maxAngle: [0, 90, 80, 60, 40, 30],
  koiogranSpeeds: [2, 3],
};

export function maneuverId(speed: number, angle: number, koiogran = false): string {
  return koiogran ? (angle ? `k${speed}a${angle}` : `k${speed}`) : `m${speed}a${angle}`;
}

export function parseManeuverId(id: string): { speed: number; angle: number; koiogran: boolean } | null {
  let m = /^k(\d)$/.exec(id);
  if (m) return { speed: Number(m[1]), angle: 0, koiogran: true };
  m = /^k(\d)a(-?\d+)$/.exec(id);
  if (m) return { speed: Number(m[1]), angle: Number(m[2]), koiogran: true };
  m = /^m(\d)a(-?\d+)$/.exec(id);
  if (m) return { speed: Number(m[1]), angle: Number(m[2]), koiogran: false };
  return null;
}

/** Je úhel "ostrý" (sám o sobě červený)? */
export function isSharp(speed: number, angle: number, koiogran = false): boolean {
  const a = Math.abs(angle);
  return koiogran || a >= 70 || (speed >= 4 && a >= 40);
}

/**
 * Náročnost křivky podle rychlosti, úhlu a změny rychlosti oproti minulému kolu; null = loď to nezvládne.
 * zelený = mírný (odstraní stres), oranžový („red“) = prudký (stres),
 * nebezpečný (červený) = změna rychlosti o 2+ spolu s ostrým úhlem (jako oranžový + zranění).
 * Otočka (koiogran) na konci křivky: jde od rychlosti 2; výsledek je oranžový (nebezpečná křivka zůstává nebezpečná),
 * stres viz `maneuverStress`.
 */
export function classifyManeuver(profile: ManeuverProfile, speed: number, angle: number, koiogran: boolean, prevSpeed: number): Difficulty | null {
  const base = classifyCurve(profile, speed, angle, prevSpeed);
  if (!base) return null;
  if (!koiogran) return base;
  if (!profile.koiogranSpeeds.includes(speed)) return null;
  return base === "danger" ? "danger" : "red";
}

/** Náročnost samotné křivky (bez otočky). */
export function classifyCurve(profile: ManeuverProfile, speed: number, angle: number, prevSpeed: number): Difficulty | null {
  if (!Number.isInteger(speed) || speed < 1 || speed > profile.maxSpeed || speed >= profile.maxAngle.length) return null;
  if (!Number.isInteger(angle) || angle % ANGLE_STEP !== 0) return null;
  if (Math.abs(angle) > profile.maxAngle[speed]) return null;
  const a = Math.abs(angle);
  const bigChange = Math.abs(speed - prevSpeed) >= 2;
  const sharp = isSharp(speed, angle, false);
  if (bigChange && sharp) return "danger";
  if (bigChange || sharp) return "red";
  if ((speed <= 2 && a <= 40) || (speed === 3 && a === 0)) return "green";
  return "white";
}

export function makeManeuver(profile: ManeuverProfile, speed: number, angle: number, koiogran: boolean, prevSpeed: number): Maneuver | null {
  const difficulty = classifyManeuver(profile, speed, angle, koiogran, prevSpeed);
  if (!difficulty) return null;
  const man: Maneuver = { id: maneuverId(speed, angle, koiogran), speed, angle, koiogran, difficulty };
  if (koiogran) man.base = classifyCurve(profile, speed, angle, prevSpeed) ?? "white";
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
  return makeManeuver(profile, p.speed, p.angle, p.koiogran, prevSpeed);
}

/** Všechny povolené manévry profilu z dané rychlosti (pro bota a nápovědu). */
export function listManeuvers(profile: ManeuverProfile, prevSpeed: number): Maneuver[] {
  const out: Maneuver[] = [];
  for (let speed = 1; speed <= profile.maxSpeed; speed++) {
    for (let angle = -MAX_ANGLE; angle <= MAX_ANGLE; angle += ANGLE_STEP) {
      const m = makeManeuver(profile, speed, angle, false, prevSpeed);
      if (m) out.push(m);
    }
    for (let angle = -MAX_ANGLE; angle <= MAX_ANGLE; angle += ANGLE_STEP) {
      const k = makeManeuver(profile, speed, angle, true, prevSpeed);
      if (k) out.push(k);
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
  const base = makePath(start, maneuverLength(man), (man.angle * Math.PI) / 180);
  if (!man.koiogran) return base;
  return (t) => {
    const p = base(t);
    if (t >= 1) return { ...p, heading: p.heading + Math.PI };
    return p;
  };
}

export function maneuverEnd(start: Pose, man: Maneuver): Pose {
  return maneuverPath(start, man)(1);
}

export function maneuverLabel(man: Maneuver): string {
  if (man.koiogran) return man.angle === 0 ? `Otočka ${man.speed}` : `Rychlost ${man.speed}, ${Math.abs(man.angle)}° ${man.angle < 0 ? "vlevo" : "vpravo"} + otočka`;
  if (man.angle === 0) return `Rovně ${man.speed}`;
  return `Rychlost ${man.speed}, ${Math.abs(man.angle)}° ${man.angle < 0 ? "vlevo" : "vpravo"}`;
}

/** Kolik stresových bodů manévr stojí (záporné = dobije). */
export function stressCost(d: Difficulty): number {
  return d === "danger" ? STRESS.costDanger : d === "red" ? STRESS.costRed : d === "green" ? -STRESS.regenGreen : 0;
}
