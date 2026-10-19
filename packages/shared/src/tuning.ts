/**
 * Ladicí parametry hry (balanc). Host je může měnit v lobby i během bitvy;
 * server je aplikuje před každým vyhodnocením, klient před vykreslením.
 */
import { CRATER_RADIUS_REF, LASER, MINE, RULES, STRESS, TORPEDO } from "./constants.ts";
import { VISION_REF } from "./fog.ts";
import { HULLS, LASER_DICE, MODULES, WEIGHT } from "./ships.ts";

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
  // moduly: ceny a váhy
  priceLaser: number;
  priceTorpedo: number;
  priceMine: number;
  priceShieldSegment: number;
  priceShieldWhole: number;
  weightLaser: number;
  weightTorpedo: number;
  weightPerTorpedo: number;
  weightMine: number;
  weightPerMine: number;
  weightShield: number;
  weightPerSpeed: number;
  // ekonomika
  startBudget: number;
  creditsPerKill: number;
  creditsPerTurn: number;
  debrisRewardPct: number;
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
  priceLaser: 100,
  priceTorpedo: 150,
  priceMine: 100,
  priceShieldSegment: 120,
  priceShieldWhole: 120,
  weightLaser: 2,
  weightTorpedo: 1,
  weightPerTorpedo: 1,
  weightMine: 1,
  weightPerMine: 0.5,
  weightShield: 2,
  weightPerSpeed: 6,
  startBudget: 500,
  creditsPerKill: 200,
  creditsPerTurn: 10,
  debrisRewardPct: 50,
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
  // --- loď ---
  { key: "hull", label: "Trup lodi", group: "Loď", min: 10, max: 1000, step: 10 },
  { key: "agility", label: "Obratnost (kostky obrany)", group: "Loď", min: 0, max: 6, step: 1 },
  { key: "vision", label: "Dohled (fog of war)", group: "Loď", min: 100, max: 4000, step: 50 },
  { key: "weightPerSpeed", label: "Váha na −1 max. rychlosti", group: "Loď", min: 1, max: 30, step: 1, hint: "součet váhy modulů / tato hodnota = o kolik klesne max. rychlost" },
  { key: "collisionShip", label: "Náraz loď–loď", group: "Loď", min: 0, max: 100, step: 5 },
  { key: "collisionAsteroid", label: "Náraz do asteroidu", group: "Loď", min: 0, max: 100, step: 5 },
  { key: "collisionEdge", label: "Náraz do okraje mapy", group: "Loď", min: 0, max: 100, step: 5 },
  { key: "craterRadius", label: "Kráter v asteroidu – poloměr", group: "Loď", min: 0, max: 150, step: 5 },
  // --- akce a stres ---
  { key: "actionPoints", label: "Akce na kolo", group: "Akce a stres", min: 1, max: 5, step: 1 },
  { key: "stressMax", label: "Stresové body – max", group: "Akce a stres", min: 1, max: 10, step: 1 },
  { key: "stressCostRed", label: "Červený manévr – cena", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "stressCostDanger", label: "Nebezpečný manévr – cena", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "dangerHullPercent", label: "Nebezpečný manévr – % trupu", group: "Akce a stres", min: 0, max: 50, step: 1 },
  { key: "stressRegenGreen", label: "Zelený manévr – dobití", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "koiogranSpeedDrop", label: "Otočka 180° – pokles rychlosti", group: "Akce a stres", min: 0, max: 4, step: 1 },
  { key: "evadeStressCost", label: "Úhyb – cena (stres)", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "evadePassStress", label: "Úhyb – stres lodi, kterou proletí", group: "Akce a stres", min: 0, max: 5, step: 1 },
  { key: "evadeDamageReduction", label: "Úhyb – snížení zranění minou/torpédem %", group: "Akce a stres", min: 0, max: 100, step: 5 },
  // --- lasery ---
  { key: "laserDice", label: "Kostky útoku", group: "Lasery", min: 0, max: 6, step: 1 },
  { key: "laserPerHit", label: "Zranění za zásah", group: "Lasery", min: 0, max: 100, step: 5 },
  { key: "laserRange", label: "Dostřel", group: "Lasery", min: 50, max: 1000, step: 10 },
  { key: "laserArcDeg", label: "Výseč ± °", group: "Lasery", min: 5, max: 180, step: 5 },
  { key: "priceLaser", label: "Modul – cena", group: "Lasery", min: 0, max: 2000, step: 10 },
  { key: "weightLaser", label: "Modul – váha", group: "Lasery", min: 0, max: 20, step: 0.5 },
  // --- fázové torpédo ---
  { key: "torpedoAmmo", label: "Torpéd na modul", group: "Fázové torpédo", min: 0, max: 20, step: 1, hint: "projeví se u nových lodí" },
  { key: "torpedoDirect", label: "Přímý zásah", group: "Fázové torpédo", min: 0, max: 200, step: 5 },
  { key: "torpedoBlast", label: "Plošný výbuch – zranění", group: "Fázové torpédo", min: 0, max: 200, step: 5 },
  { key: "torpedoBlastRadius", label: "Plošný výbuch – poloměr", group: "Fázové torpédo", min: 10, max: 300, step: 10 },
  { key: "torpedoLockRange", label: "Zaměření lodi – dosah", group: "Fázové torpédo", min: 50, max: 2000, step: 10 },
  { key: "torpedoPointRange", label: "Dolet na bod", group: "Fázové torpédo", min: 100, max: 4000, step: 50 },
  { key: "torpedoLife", label: "Životnost (kola)", group: "Fázové torpédo", min: 1, max: 20, step: 1 },
  { key: "torpedoLaunchDist", label: "Výlet – délka rovně z lodi", group: "Fázové torpédo", min: 0, max: 300, step: 10, hint: "1. fáze: letí rovně ve směru přídě" },
  { key: "torpedoLaunchSpeed", label: "Výlet – startovní rychlost / kolo", group: "Fázové torpédo", min: 20, max: 400, step: 10 },
  { key: "torpedoLockTurnDeg", label: "Zaměření – otáčení ° / kolo", group: "Fázové torpédo", min: 0, max: 360, step: 5, hint: "2. fáze: točí se na cíl startovní rychlostí" },
  { key: "torpedoLockAngleDeg", label: "Zaměření – hotovo pod úhlem °", group: "Fázové torpédo", min: 1, max: 90, step: 1, hint: "odchylka od cíle, při které končí zaměření" },
  { key: "torpedoAccel", label: "Let – zrychlení / kolo", group: "Fázové torpédo", min: 10, max: 800, step: 10, hint: "3. fáze: zrychluje na plnou rychlost" },
  { key: "torpedoSpeed", label: "Let – plná rychlost / kolo", group: "Fázové torpédo", min: 50, max: 800, step: 10 },
  { key: "torpedoTurnDeg", label: "Let – zatáčení ° / kolo", group: "Fázové torpédo", min: 0, max: 180, step: 5 },
  { key: "torpedoTrackArcDeg", label: "Let – výseč sledování ± °", group: "Fázové torpédo", min: 10, max: 180, step: 5, hint: "cíl mimo výseč = torpédo ho ztratí a letí rovně" },
  { key: "priceTorpedo", label: "Modul – cena", group: "Fázové torpédo", min: 0, max: 2000, step: 10 },
  { key: "weightTorpedo", label: "Modul – váha (prázdný)", group: "Fázové torpédo", min: 0, max: 20, step: 0.5 },
  { key: "weightPerTorpedo", label: "Váha jednoho torpéda", group: "Fázové torpédo", min: 0, max: 10, step: 0.5 },
  // --- miny ---
  { key: "mineAmmo", label: "Min na modul", group: "Miny", min: 0, max: 20, step: 1, hint: "projeví se u nových lodí" },
  { key: "mineDamage", label: "Zranění", group: "Miny", min: 0, max: 200, step: 5 },
  { key: "mineRadius", label: "Poloměr pole", group: "Miny", min: 10, max: 300, step: 10 },
  { key: "priceMine", label: "Modul – cena", group: "Miny", min: 0, max: 2000, step: 10 },
  { key: "weightMine", label: "Modul – váha (prázdný)", group: "Miny", min: 0, max: 20, step: 0.5 },
  { key: "weightPerMine", label: "Váha jedné miny", group: "Miny", min: 0, max: 10, step: 0.5 },
  // --- štíty ---
  { key: "shields", label: "Celolodní – zásoba na modul", group: "Štíty", min: 0, max: 500, step: 10 },
  { key: "shieldRecharge", label: "Celolodní – dobíjení za kolo", group: "Štíty", min: 0, max: 100, step: 5 },
  { key: "wholeEffDrop", label: "Celolodní – pokles účinnosti za zásah %", group: "Štíty", min: 0, max: 50, step: 5 },
  { key: "segmentHp", label: "Segmentový – životy segmentu na modul", group: "Štíty", min: 0, max: 4, step: 1, hint: "projeví se u nových lodí" },
  { key: "segmentMax", label: "Segmentový – max životů (úprava štítu)", group: "Štíty", min: 1, max: 6, step: 1 },
  { key: "priceShieldSegment", label: "Segmentový – cena", group: "Štíty", min: 0, max: 2000, step: 10 },
  { key: "priceShieldWhole", label: "Celolodní – cena", group: "Štíty", min: 0, max: 2000, step: 10 },
  { key: "weightShield", label: "Štít – váha modulu", group: "Štíty", min: 0, max: 20, step: 0.5 },
  // --- ekonomika ---
  { key: "startBudget", label: "Rozpočet na výbavu", group: "Ekonomika", min: 0, max: 5000, step: 50, hint: "co hráč neutratí, má jako kredity ve hře" },
  { key: "creditsPerKill", label: "Odměna za sestřel", group: "Ekonomika", min: 0, max: 5000, step: 10 },
  { key: "creditsPerTurn", label: "Odměna za přežité kolo", group: "Ekonomika", min: 0, max: 500, step: 5 },
  { key: "debrisRewardPct", label: "Sestřelený vyhozený modul – % ceny", group: "Ekonomika", min: 0, max: 200, step: 10 },
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
  HULLS.fighter.agility = t.agility;
  LASER_DICE.value = t.laserDice;
  MODULES["shield-whole"].shields = t.shields;
  MODULES.torpedo.ammo = t.torpedoAmmo;
  MODULES.mine.ammo = t.mineAmmo;
  MODULES.laser.price = t.priceLaser;
  MODULES.torpedo.price = t.priceTorpedo;
  MODULES.mine.price = t.priceMine;
  MODULES["shield-segment"].price = t.priceShieldSegment;
  MODULES["shield-whole"].price = t.priceShieldWhole;
  MODULES.laser.weight = t.weightLaser;
  MODULES.torpedo.weight = t.weightTorpedo;
  MODULES.torpedo.ammoWeight = t.weightPerTorpedo;
  MODULES.mine.weight = t.weightMine;
  MODULES.mine.ammoWeight = t.weightPerMine;
  MODULES["shield-segment"].weight = t.weightShield;
  MODULES["shield-whole"].weight = t.weightShield;
  WEIGHT.perSpeed = t.weightPerSpeed;
  RULES.creditsPerKill = t.creditsPerKill;
  RULES.creditsPerTurn = t.creditsPerTurn;
  RULES.debrisRewardPct = t.debrisRewardPct;
}
