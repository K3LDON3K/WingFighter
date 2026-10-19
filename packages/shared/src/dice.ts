import type { Rng } from "./rng.ts";
import type { DieFace } from "./types.ts";

const ATTACK_FACES: DieFace[] = ["hit", "hit", "hit", "crit", "focus", "focus", "blank", "blank"];
const DEFENSE_FACES: DieFace[] = ["evade", "evade", "evade", "focus", "focus", "blank", "blank", "blank"];

export function rollAttack(rng: Rng, n: number): DieFace[] {
  return Array.from({ length: n }, () => rng.pick(ATTACK_FACES));
}

export function rollDefense(rng: Rng, n: number): DieFace[] {
  return Array.from({ length: n }, () => rng.pick(DEFENSE_FACES));
}

export interface AttackContext {
  attackDice: number;
  defenseDice: number;
  attackerFocus: boolean;
  attackerLock: boolean;
  defenderFocus: boolean;
  defenderEvade: boolean;
}

export interface AttackOutcome {
  attackDice: DieFace[];
  defenseDice: DieFace[];
  hits: number;
  evades: number;
  damage: number;
}

/**
 * Souboj kostek ve stylu X-Wing:
 * - zámek cíle: přehodí všechny kostky bez zásahu
 * - zaměření útočníka: oči → zásah; zaměření obránce: oči → úhyb
 * - úhyb: +1 úhyb
 * - zranění = zásahy − úhyby
 */
export function resolveAttack(rng: Rng, ctx: AttackContext): AttackOutcome {
  let attackDice = rollAttack(rng, Math.max(0, ctx.attackDice));
  if (ctx.attackerLock) {
    attackDice = attackDice.map((f) => (f === "hit" || f === "crit" ? f : rng.pick(ATTACK_FACES)));
  }
  let hits = 0;
  for (const f of attackDice) {
    if (f === "hit" || f === "crit") hits++;
    else if (f === "focus" && ctx.attackerFocus) hits++;
  }
  const defenseDice = rollDefense(rng, Math.max(0, ctx.defenseDice));
  let evades = 0;
  for (const f of defenseDice) {
    if (f === "evade") evades++;
    else if (f === "focus" && ctx.defenderFocus) evades++;
  }
  if (ctx.defenderEvade) evades++;
  const damage = Math.max(0, hits - evades);
  return { attackDice, defenseDice, hits, evades, damage };
}
