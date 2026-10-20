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
  /** Podíl cíle uvnitř výseče (0–1); zásahy mimo tento podíl propadnou. Výchozí 1. */
  coverage?: number;
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
  // cíl jen částečně ve výseči: každý zásah se počítá jen s pravděpodobností podílu v dosahu
  const cov = ctx.coverage ?? 1;
  if (cov < 1) {
    let kept = 0;
    for (let i = 0; i < hits; i++) if (rng.next() < cov) kept++;
    hits = kept;
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

/** Rozdělení počtu úspěchů na n kostkách s pravděpodobností p (binomické). */
function binomial(n: number, p: number): number[] {
  const out = new Array(n + 1).fill(0);
  for (let k = 0; k <= n; k++) {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    out[k] = c * p ** k * (1 - p) ** (n - k);
  }
  return out;
}

/** Přesná šance na aspoň jeden čistý zásah a očekávaný počet čistých zásahů pro daný souboj kostek. */
export function attackOdds(ctx: AttackContext): { hitChance: number; expectedHits: number } {
  const pHitRaw = (ctx.attackerFocus ? 6 : 4) / 8;
  // zámek přehazuje všechny kostky bez zásahu/kritu (i oči), až po přehození se oči se zaměřením počítají
  const pHit = (ctx.attackerLock ? 0.5 + 0.5 * pHitRaw : pHitRaw) * (ctx.coverage ?? 1);
  const pEvade = (ctx.defenderFocus ? 5 : 3) / 8;
  const A = binomial(Math.max(0, ctx.attackDice), pHit);
  const D = binomial(Math.max(0, ctx.defenseDice), pEvade);
  const extra = ctx.defenderEvade ? 1 : 0;
  let hitChance = 0;
  let expectedHits = 0;
  A.forEach((pa, h) =>
    D.forEach((pd, e) => {
      const dmg = Math.max(0, h - e - extra);
      if (dmg > 0) hitChance += pa * pd;
      expectedHits += pa * pd * dmg;
    }),
  );
  return { hitChance, expectedHits };
}
