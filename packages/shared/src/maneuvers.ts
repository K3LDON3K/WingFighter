import { MOVE_UNIT } from "./constants.ts";
import { makePath, type Pose } from "./geometry.ts";
import type { Difficulty, Maneuver, ManeuverProfile } from "./types.ts";

/** Krok směru ve stupních. */
export const ANGLE_STEP = 15;
export const MAX_ANGLE = 90;

/** Profil stíhače – co motor dovolí. Index pole = rychlost. */
export const FIGHTER_PROFILE: ManeuverProfile = {
  maxSpeed: 5,
  maxAngle: [0, 90, 90, 90, 60, 45],
  koiogranSpeeds: [3, 4],
};

export function maneuverId(speed: number, angle: number, koiogran = false): string {
  return koiogran ? `k${speed}` : `m${speed}a${angle}`;
}

export function parseManeuverId(id: string): { speed: number; angle: number; koiogran: boolean } | null {
  let m = /^k(\d)$/.exec(id);
  if (m) return { speed: Number(m[1]), angle: 0, koiogran: true };
  m = /^m(\d)a(-?\d+)$/.exec(id);
  if (m) return { speed: Number(m[1]), angle: Number(m[2]), koiogran: false };
  return null;
}

/** Je úhel "ostrý" (sám o sobě červený)? */
export function isSharp(speed: number, angle: number, koiogran = false): boolean {
  const a = Math.abs(angle);
  return koiogran || a >= 75 || (speed >= 4 && a >= 45);
}

/**
 * Náročnost manévru podle rychlosti, úhlu a změny rychlosti oproti minulému kolu; null = loď to nezvládne.
 * zelený = mírný (odstraní stres), červený = prudký (stres, bez akce),
 * nebezpečný = změna rychlosti o 2+ spolu s ostrým úhlem (jako červený + 1 zranění).
 */
export function classifyManeuver(profile: ManeuverProfile, speed: number, angle: number, koiogran: boolean, prevSpeed: number): Difficulty | null {
  if (!Number.isInteger(speed) || speed < 1 || speed > profile.maxSpeed) return null;
  if (koiogran) {
    if (!profile.koiogranSpeeds.includes(speed) || angle !== 0) return null;
  } else {
    if (!Number.isInteger(angle) || angle % ANGLE_STEP !== 0) return null;
    if (Math.abs(angle) > profile.maxAngle[speed]) return null;
  }
  const a = Math.abs(angle);
  const bigChange = Math.abs(speed - prevSpeed) >= 2;
  const sharp = isSharp(speed, angle, koiogran);
  if (bigChange && sharp) return "danger";
  if (bigChange || sharp) return "red";
  if ((speed <= 2 && a <= 45) || (speed === 3 && a === 0)) return "green";
  return "white";
}

export function makeManeuver(profile: ManeuverProfile, speed: number, angle: number, koiogran: boolean, prevSpeed: number): Maneuver | null {
  const difficulty = classifyManeuver(profile, speed, angle, koiogran, prevSpeed);
  if (!difficulty) return null;
  return { id: maneuverId(speed, angle, koiogran), speed, angle, koiogran, difficulty };
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
    const k = makeManeuver(profile, speed, 0, true, prevSpeed);
    if (k) out.push(k);
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
  if (man.koiogran) return `Otočka ${man.speed}`;
  if (man.angle === 0) return `Rovně ${man.speed}`;
  return `Rychlost ${man.speed}, ${Math.abs(man.angle)}° ${man.angle < 0 ? "vlevo" : "vpravo"}`;
}
