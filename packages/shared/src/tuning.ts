/**
 * Ladicí parametry hry (balanc). Host je může měnit v lobby i během bitvy;
 * server je aplikuje před každým vyhodnocením, klient před vykreslením.
 */
import { CRATER_RADIUS_REF, LASER, MINE, RULES, STRESS, TORPEDO } from "./constants.ts";
import { VISION_REF } from "./fog.ts";
import { HULLS, MODULES } from "./ships.ts";

export interface Tuning {
  // zranění
  laserPerHit: number;
  torpedoDirect: number;
  torpedoBlast: number;
  torpedoBlastRadius: number;
  mineDamage: number;
  mineRadius: number;
  collisionShip: number;
  collisionAsteroid: number;
  collisionEdge: number;
  dangerHullPercent: number;
  craterRadius: number;
  // loď
  hull: number;
  shields: number;
  shieldRecharge: number;
  laserDice: number;
  agility: number;
  torpedoAmmo: number;
  mineAmmo: number;
  vision: number;
  // dosahy a rychlosti
  laserRange: number;
  laserArcDeg: number;
  torpedoLockRange: number;
  torpedoPointRange: number;
  torpedoSpeed: number;
  torpedoTurnDeg: number;
  torpedoLife: number;
  torpedoLaunchDist: number;
  torpedoLaunchSpeed: number;
  torpedoLockTurnDeg: number;
  torpedoLockAngleDeg: number;
  torpedoAccel: number;
  torpedoTrackArcDeg: number;
  // akce a stres
  actionPoints: number;
  stressMax: number;
  stressCostRed: number;
  stressCostDanger: number;
  stressRegenGreen: number;
  // otočka a úhybný manévr
  koiogranSpeedDrop: number;
  evadeStressCost: number;
  evadePassStress: number;
  evadeDamageReduction: number;
  // štíty
  wholeEffDrop: number;
  segmentHp: number;
  segmentMax: number;
}

export const DEFAULT_TUNING: Tuning = {
  laserPerHit: 15,
  torpedoDirect: 45,
  torpedoBlast: 30,
  torpedoBlastRadius: 70,
  mineDamage: 30,
  mineRadius: 70,
  collisionShip: 15,
  collisionAsteroid: 15,
  collisionEdge: 15,
  dangerHullPercent: 5,
  craterRadius: 45,
  hull: 100,
  shields: 50,
  shieldRecharge: 0,
  laserDice: 2,
  agility: 3,
  torpedoAmmo: 3,
  mineAmmo: 2,
  vision: 960,
  laserRange: 300,
  laserArcDeg: 20,
  torpedoLockRange: 320,
  torpedoPointRange: 1200,
  torpedoSpeed: 240,
  torpedoTurnDeg: 45,
  torpedoLife: 5,
  torpedoLaunchDist: 60,
  torpedoLaunchSpeed: 120,
  torpedoLockTurnDeg: 90,
  torpedoLockAngleDeg: 15,
  torpedoAccel: 120,
  torpedoTrackArcDeg: 90,
  actionPoints: 2,
  stressMax: 3,
  stressCostRed: 1,
  stressCostDanger: 2,
  stressRegenGreen: 1,
  koiogranSpeedDrop: 2,
  evadeStressCost: 1,
  evadePassStress: 1,
  evadeDamageReduction: 50,
  wholeEffDrop: 10,
  segmentHp: 2,
  segmentMax: 3,
};

export interface TuningField {
  key: keyof Tuning;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
}

/** Popis polí pro UI (pořadí = pořadí v menu). */
export const TUNING_FIELDS: TuningField[] = [
  { key: "laserPerHit", label: "Laser – zranění za zásah", group: "Zranění", min: 0, max: 100, step: 5 },
  { key: "torpedoDirect", label: "Torpédo – přímý zásah", group: "Zranění", min: 0, max: 200, step: 5 },
  { key: "torpedoBlast", label: "Torpédo – plošný výbuch", group: "Zranění", min: 0, max: 200, step: 5 },
  { key: "torpedoBlastRadius", label: "Torpédo – poloměr výbuchu", group: "Zranění", min: 10, max: 300, step: 10 },
  { key: "mineDamage", label: "Mina – zranění", group: "Zranění", min: 0, max: 200, step: 5 },
  { key: "mineRadius", label: "Mina – poloměr pole", group: "Zranění", min: 10, max: 300, step: 10 },
  { key: "collisionShip", label: "Náraz loď–loď", group: "Zranění", min: 0, max: 100, step: 5 },
  { key: "collisionAsteroid", label: "Náraz do asteroidu", group: "Zranění", min: 0, max: 100, step: 5 },
  { key: "collisionEdge", label: "Náraz do okraje mapy", group: "Zranění", min: 0, max: 100, step: 5 },
  { key: "dangerHullPercent", label: "Nebezpečný manévr – % trupu", group: "Zranění", min: 0, max: 50, step: 1 },
  { key: "craterRadius", label: "Kráter v asteroidu – poloměr", group: "Zranění", min: 0, max: 150, step: 5 },
  { key: "hull", label: "Trup lodi", group: "Loď", min: 10, max: 1000, step: 10 },
  { key: "shields", label: "Celolodní štít – zásoba", group: "Štíty", min: 0, max: 500, step: 10 },
  { key: "shieldRecharge", label: "Celolodní štít – dobíjení za kolo", group: "Štíty", min: 0, max: 100, step: 5 },
  { key: "wholeEffDrop", label: "Celolodní štít – pokles účinnosti za zásah %", group: "Štíty", min: 0, max: 50, step: 5 },
  { key: "segmentHp", label: "Segment – výchozí životy", group: "Štíty", min: 0, max: 4, step: 1, hint: "projeví se u nových lodí" },
  { key: "segmentMax", label: "Segment – max životů (úprava štítu)", group: "Štíty", min: 1, max: 6, step: 1 },
  { key: "laserDice", label: "Laser – kostky útoku", group: "Loď", min: 0, max: 6, step: 1 },
  { key: "agility", label: "Obratnost (kostky obrany)", group: "Loď", min: 0, max: 6, step: 1 },
  { key: "torpedoAmmo", label: "Torpéda na bitvu", group: "Loď", min: 0, max: 20, step: 1, hint: "projeví se u nových lodí" },
  { key: "mineAmmo", label: "Miny na bitvu", group: "Loď", min: 0, max: 20, step: 1, hint: "projeví se u nových lodí" },
  { key: "vision", label: "Dohled (fog of war)", group: "Loď", min: 100, max: 4000, step: 50 },
  { key: "laserRange", label: "Laser – dostřel", group: "Dosahy", min: 50, max: 1000, step: 10 },
  { key: "laserArcDeg", label: "Laser – výseč ± °", group: "Dosahy", min: 5, max: 180, step: 5 },
  { key: "torpedoLockRange", label: "Torpédo – zaměření lodi", group: "Dosahy", min: 50, max: 2000, step: 10 },
  { key: "torpedoPointRange", label: "Torpédo – dolet na bod", group: "Dosahy", min: 100, max: 4000, step: 50 },
  { key: "torpedoLife", label: "Torpédo – životnost (kola)", group: "Dosahy", min: 1, max: 20, step: 1 },
  { key: "torpedoLaunchDist", label: "Výlet – délka rovně z lodi", group: "Fázové torpédo", min: 0, max: 300, step: 10, hint: "1. fáze: letí rovně ve směru přídě" },
  { key: "torpedoLaunchSpeed", label: "Výlet – startovní rychlost / kolo", group: "Fázové torpédo", min: 20, max: 400, step: 10 },
  { key: "torpedoLockTurnDeg", label: "Zaměření – otáčení ° / kolo", group: "Fázové torpédo", min: 0, max: 360, step: 5, hint: "2. fáze: točí se na cíl startovní rychlostí" },
  { key: "torpedoLockAngleDeg", label: "Zaměření – hotovo pod úhlem °", group: "Fázové torpédo", min: 1, max: 90, step: 1, hint: "odchylka od cíle, při které končí zaměření" },
  { key: "torpedoAccel", label: "Let – zrychlení / kolo", group: "Fázové torpédo", min: 10, max: 800, step: 10, hint: "3. fáze: zrychluje na plnou rychlost" },
  { key: "torpedoSpeed", label: "Let – plná rychlost / kolo", group: "Fázové torpédo", min: 50, max: 800, step: 10 },
  { key: "torpedoTurnDeg", label: "Let – zatáčení ° / kolo", group: "Fázové torpédo", min: 0, max: 180, step: 5 },
  { key: "torpedoTrackArcDeg", label: "Let – výseč sledování ± °", group: "Fázové torpédo", min: 10, max: 180, step: 5, hint: "cíl mimo výseč = torpédo ho ztratí a letí rovně" },
  { key: "actionPoints", label: "Akce na kolo", group: "Akce a stres", min: 1, max: 5, step: 1 },
  { key: "stressMax", label: "Stresové body – max", group: "Akce a stres", min: 1, max: 10, step: 1 },
  { key: "stressCostRed", label: "Červený manévr – cena", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "stressCostDanger", label: "Nebezpečný manévr – cena", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "stressRegenGreen", label: "Zelený manévr – dobití", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "koiogranSpeedDrop", label: "Otočka – pokles rychlosti po otočce", group: "Akce a stres", min: 0, max: 4, step: 1 },
  { key: "evadeStressCost", label: "Úhybný manévr – cena (stres)", group: "Akce a stres", min: 0, max: 3, step: 1 },
  { key: "evadePassStress", label: "Úhyb – stres lodi, skrz kterou proletím", group: "Akce a stres", min: 0, max: 3, step: 1 },
  { key: "evadeDamageReduction", label: "Úhyb – snížení zranění minou/torpédem %", group: "Akce a stres", min: 0, max: 100, step: 5 },
];

/** Ořeže neznámé/nesmyslné hodnoty podle TUNING_FIELDS. */
export function sanitizeTuning(input: unknown, base: Tuning = DEFAULT_TUNING): Tuning {
  const out: Tuning = { ...base };
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const f of TUNING_FIELDS) {
    const v = Number(src[f.key]);
    if (!Number.isFinite(v)) continue;
    out[f.key] = Math.max(f.min, Math.min(f.max, Math.round(v / f.step) * f.step));
  }
  return out;
}

/**
 * Promítne parametry do sdílených konstant (ty jsou záměrně mutovatelné).
 * Volá se před každým vyhodnocením / vykreslením pro daný stav hry.
 */
export function applyTuning(t: Tuning): void {
  RULES.damagePerHit = t.laserPerHit;
  TORPEDO.damage = t.torpedoDirect;
  TORPEDO.blastDamage = t.torpedoBlast;
  TORPEDO.blastRadius = t.torpedoBlastRadius;
  TORPEDO.lockRange = t.torpedoLockRange;
  TORPEDO.pointRange = t.torpedoPointRange;
  TORPEDO.speed = t.torpedoSpeed;
  TORPEDO.maxTurn = (t.torpedoTurnDeg * Math.PI) / 180;
  TORPEDO.launchDist = t.torpedoLaunchDist;
  TORPEDO.launchSpeed = t.torpedoLaunchSpeed;
  TORPEDO.lockTurn = (t.torpedoLockTurnDeg * Math.PI) / 180;
  TORPEDO.lockAngle = (t.torpedoLockAngleDeg * Math.PI) / 180;
  TORPEDO.accel = t.torpedoAccel;
  TORPEDO.trackArc = (t.torpedoTrackArcDeg * Math.PI) / 180;
  TORPEDO.lifeTurns = t.torpedoLife;
  TORPEDO.trackTurns = t.torpedoLife;
  MINE.damage = t.mineDamage;
  MINE.radius = t.mineRadius;
  RULES.collisionShip = t.collisionShip;
  RULES.collisionAsteroid = t.collisionAsteroid;
  RULES.collisionEdge = t.collisionEdge;
  STRESS.dangerHullPercent = t.dangerHullPercent;
  STRESS.max = t.stressMax;
  STRESS.costRed = t.stressCostRed;
  STRESS.costDanger = t.stressCostDanger;
  STRESS.regenGreen = t.stressRegenGreen;
  CRATER_RADIUS_REF.value = t.craterRadius;
  RULES.shieldRecharge = t.shieldRecharge;
  RULES.actionPoints = t.actionPoints;
  RULES.koiogranSpeedDrop = t.koiogranSpeedDrop;
  RULES.evadeStressCost = t.evadeStressCost;
  RULES.evadePassStress = t.evadePassStress;
  RULES.evadeDamageReduction = t.evadeDamageReduction;
  RULES.wholeEffDrop = t.wholeEffDrop;
  RULES.segmentHp = t.segmentHp;
  RULES.segmentMax = t.segmentMax;
  LASER.range = t.laserRange;
  LASER.halfArc = (t.laserArcDeg * Math.PI) / 180;
  LASER.band = t.laserRange / 3;
  VISION_REF.value = t.vision;
  HULLS.fighter.hull = t.hull;
  MODULES["shield-mk1"].stats.shields = t.shields;
  MODULES["laser-mk1"].stats.attack = t.laserDice;
  MODULES["engine-mk1"].stats.agility = t.agility;
  MODULES["torpedo-rack"].stats.torpedoes = t.torpedoAmmo;
  MODULES["mine-layer"].stats.mines = t.mineAmmo;
}
