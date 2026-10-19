import { MOVE_UNIT } from "./constants.ts";
import { makePath, type Pose } from "./geometry.ts";
import type { Difficulty, Maneuver, ManeuverKind, Side } from "./types.ts";

function m(kind: ManeuverKind, speed: number, difficulty: Difficulty, side?: Side): Maneuver {
  const id = side ? `${kind}-${speed}-${side}` : `${kind}-${speed}`;
  return { id, kind, speed, side, difficulty };
}

/** Ciferník stíhače. */
export const FIGHTER_DIAL: Maneuver[] = [
  m("straight", 1, "green"),
  m("straight", 2, "green"),
  m("straight", 3, "white"),
  m("straight", 4, "white"),
  m("straight", 5, "white"),
  m("bank", 1, "green", "left"),
  m("bank", 1, "green", "right"),
  m("bank", 2, "white", "left"),
  m("bank", 2, "white", "right"),
  m("bank", 3, "white", "left"),
  m("bank", 3, "white", "right"),
  m("turn", 1, "white", "left"),
  m("turn", 1, "white", "right"),
  m("turn", 2, "white", "left"),
  m("turn", 2, "white", "right"),
  m("turn", 3, "red", "left"),
  m("turn", 3, "red", "right"),
  m("koiogran", 3, "red"),
  m("koiogran", 4, "red"),
];

export function findManeuver(dial: Maneuver[], id: string): Maneuver | undefined {
  return dial.find((x) => x.id === id);
}

/** Celková změna kurzu manévru (bez otočky u koiogranu, ta se přičte na konci). */
export function maneuverAngle(man: Maneuver): number {
  const sign = man.side === "left" ? -1 : 1;
  switch (man.kind) {
    case "straight":
    case "koiogran":
      return 0;
    case "bank":
      return (sign * Math.PI) / 4;
    case "turn":
      return (sign * Math.PI) / 2;
  }
}

export function maneuverLength(man: Maneuver): number {
  return man.speed * MOVE_UNIT;
}

/**
 * Dráha manévru: t∈[0,1] → poloha. Koiogran na konci (t=1) otočí loď o 180°.
 */
export function maneuverPath(start: Pose, man: Maneuver): (t: number) => Pose {
  const base = makePath(start, maneuverLength(man), maneuverAngle(man));
  if (man.kind !== "koiogran") return base;
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
  const side = man.side === "left" ? "vlevo" : man.side === "right" ? "vpravo" : "";
  switch (man.kind) {
    case "straight":
      return `Rovně ${man.speed}`;
    case "bank":
      return `Oblouk ${man.speed} ${side}`;
    case "turn":
      return `Zatáčka ${man.speed} ${side}`;
    case "koiogran":
      return `Otočka ${man.speed}`;
  }
}
