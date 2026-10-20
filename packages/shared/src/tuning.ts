/**
 * Ladicí parametry hry (balanc). Host je může měnit v lobby i během bitvy;
 * server je aplikuje před každým vyhodnocením, klient před vykreslením.
 */
import { CARGO, COMET, CRATER_RADIUS_REF, LASER, MG, MINE, RULES, SCANNER, STRESS, TORPEDO } from "./constants.ts";
import { VISION_REF } from "./fog.ts";
import { HULLS, LASER_DICE, MODULE_HP_PCT, MODULES, WEIGHT } from "./ships.ts";

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
  laserArcSideDeg: number;
  laserArcBackDeg: number;
  torpedoLockRange: number;
  torpedoPointRange: number;
  torpedoSpeed: number;
  torpedoTurnDeg: number;
  torpedoLife: number;
  torpedoSafeTurns: number;
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
  // kulomet
  mgAmmo: number;
  mgRange: number;
  mgArcDeg: number;
  mgBurst: number;
  mgDamage: number;
  mgSpreadDeg: number;
  mgHitNear: number;
  mgHitFar: number;
  priceMg: number;
  weightMg: number;
  weightPerMgRound: number;
  // skener
  scannerCharges: number;
  scannerRange: number;
  scannerDeepRange: number;
  scannerCooldown: number;
  priceScanner: number;
  weightScanner: number;
  // komety
  cometSpeed: number;
  cometHull: number;
  cometDamage: number;
  cometRadius: number;
  cometReward: number;
  cometTailLength: number;
  cometTailWidth: number;
  cometShieldPct: number;
  cometHullPct: number;
  cometBonusCredits: number;
  cometNoShieldCredits: number;
  cometChanceFew: number;
  cometChanceMedium: number;
  cometChanceMany: number;
  cometMaxFew: number;
  cometMaxMedium: number;
  cometMaxMany: number;
  /** 1 = komety naráží do asteroidů (jako nastavení mapy) a také do sebe navzájem. */
  cometCollide: number;
  // náklad
  cargoRange: number;
  cargoMaxSpeed: number;
  cargoFighter: number;
  // ekonomika
  startBudget: number;
  creditsPerKill: number;
  creditsPerTurn: number;
  debrisRewardPct: number;
  // moduly
  moduleDamagePct: number;
  moduleDropChance: number;
  brokenSellPct: number;
  moduleHpPct: number;
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
  laserArcSideDeg: 15,
  laserArcBackDeg: 10,
  torpedoLockRange: 320,
  torpedoPointRange: 1200,
  torpedoSpeed: 240,
  torpedoTurnDeg: 45,
  torpedoLife: 5,
  torpedoSafeTurns: 2,
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
  mgAmmo: 100,
  mgRange: 150,
  mgArcDeg: 45,
  mgBurst: 10,
  mgDamage: 3,
  mgSpreadDeg: 8,
  mgHitNear: 70,
  mgHitFar: 35,
  priceMg: 120,
  weightMg: 1,
  weightPerMgRound: 0.02,
  scannerCharges: 2,
  scannerRange: 600,
  scannerDeepRange: 2000,
  scannerCooldown: 3,
  priceScanner: 130,
  weightScanner: 1,
  cometSpeed: 300,
  cometHull: 30,
  cometDamage: 30,
  cometRadius: 12,
  cometReward: 25,
  cometTailLength: 180,
  cometTailWidth: 40,
  cometShieldPct: 25,
  cometHullPct: 10,
  cometBonusCredits: 50,
  cometNoShieldCredits: 100,
  cometChanceFew: 25,
  cometChanceMedium: 50,
  cometChanceMany: 100,
  cometMaxFew: 2,
  cometMaxMedium: 4,
  cometMaxMany: 6,
  cometCollide: 0,
  cargoRange: 120,
  cargoMaxSpeed: 2,
  cargoFighter: 1,
  startBudget: 500,
  creditsPerKill: 200,
  creditsPerTurn: 10,
  debrisRewardPct: 50,
  moduleDamagePct: 50,
  moduleDropChance: 45,
  brokenSellPct: 10,
  moduleHpPct: 100,
};

export interface TuningField {
  key: keyof Tuning;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  /** Zaškrtávátko (0/1) místo čísla. */
  bool?: boolean;
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
  { key: "laserArcDeg", label: "Výseč dopředu ± °", group: "Lasery", min: 5, max: 180, step: 5, hint: "modul natočený na příď" },
  { key: "laserArcSideDeg", label: "Výseč do boku ± °", group: "Lasery", min: 5, max: 180, step: 5, hint: "modul natočený na levobok / pravobok" },
  { key: "laserArcBackDeg", label: "Výseč dozadu ± °", group: "Lasery", min: 5, max: 180, step: 5, hint: "modul natočený na záď" },
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
  { key: "torpedoSafeTurns", label: "Ochranná lhůta (kola)", group: "Fázové torpédo", min: 0, max: 10, step: 1, hint: "po vypuštění nemůže zranit vlastníka – proletí jeho loděmi, výbuch je mine" },
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
  // --- kulomet ---
  { key: "mgAmmo", label: "Nábojů na modul", group: "Kulomet", min: 10, max: 500, step: 10, hint: "projeví se u nových lodí; dávka spotřebuje tolik nábojů, kolik má projektilů" },
  { key: "mgBurst", label: "Projektilů v dávce", group: "Kulomet", min: 1, max: 30, step: 1 },
  { key: "mgDamage", label: "Zranění za projektil", group: "Kulomet", min: 1, max: 20, step: 1 },
  { key: "mgRange", label: "Dosah", group: "Kulomet", min: 50, max: 600, step: 10 },
  { key: "mgArcDeg", label: "Výseč ± °", group: "Kulomet", min: 10, max: 180, step: 5 },
  { key: "mgSpreadDeg", label: "Rozptyl ± ° (animace)", group: "Kulomet", min: 0, max: 45, step: 1 },
  { key: "mgHitNear", label: "Šance zásahu zblízka %", group: "Kulomet", min: 0, max: 100, step: 5 },
  { key: "mgHitFar", label: "Šance zásahu na hranici dosahu %", group: "Kulomet", min: 0, max: 100, step: 5, hint: "mezi tím lineárně; úhyb cíle šanci snižuje o 'Úhyb – snížení zranění %'" },
  { key: "priceMg", label: "Modul – cena", group: "Kulomet", min: 0, max: 2000, step: 10 },
  { key: "weightMg", label: "Modul – váha (prázdný)", group: "Kulomet", min: 0, max: 20, step: 0.5 },
  { key: "weightPerMgRound", label: "Váha jednoho náboje", group: "Kulomet", min: 0, max: 1, step: 0.01 },
  // --- skener ---
  { key: "scannerCharges", label: "Náboje (max)", group: "Skener", min: 1, max: 6, step: 1, hint: "start plné; +1 za zelený manévr; po cooldownu plné" },
  { key: "scannerRange", label: "Sken lodi – dosah", group: "Skener", min: 50, max: 4000, step: 50, hint: "cíl musí být navíc v dohledu" },
  { key: "scannerDeepRange", label: "Hluboký sken – dosah", group: "Skener", min: 100, max: 6000, step: 100, hint: "odkryje mapu týmu do konce kola" },
  { key: "scannerCooldown", label: "Cooldown po hlubokém skenu (kola)", group: "Skener", min: 1, max: 10, step: 1, hint: "vynucený cooldown = tato hodnota − zbývající náboje" },
  { key: "priceScanner", label: "Modul – cena", group: "Skener", min: 0, max: 2000, step: 10 },
  { key: "weightScanner", label: "Modul – váha", group: "Skener", min: 0, max: 20, step: 0.5 },
  // --- komety ---
  { key: "cometSpeed", label: "Rychlost / kolo", group: "Komety", min: 50, max: 1000, step: 10, hint: "torpédo má 240" },
  { key: "cometHull", label: "Odolnost (trup komety)", group: "Komety", min: 5, max: 300, step: 5 },
  { key: "cometDamage", label: "Zranění lodi při nárazu", group: "Komety", min: 0, max: 200, step: 5 },
  { key: "cometRadius", label: "Poloměr jádra", group: "Komety", min: 4, max: 40, step: 1 },
  { key: "cometReward", label: "Odměna za sestřelení", group: "Komety", min: 0, max: 500, step: 5 },
  { key: "cometTailLength", label: "Ocas – délka", group: "Komety", min: 0, max: 600, step: 10 },
  { key: "cometTailWidth", label: "Ocas – šířka", group: "Komety", min: 10, max: 200, step: 5 },
  { key: "cometShieldPct", label: "Průlet ocasem – % štítu", group: "Komety", min: 0, max: 100, step: 5, hint: "celolodní: % maxima; segmentový: +1 bod náhodnému segmentu" },
  { key: "cometHullPct", label: "Průlet – % trupu (když je štít plný)", group: "Komety", min: 0, max: 100, step: 5 },
  { key: "cometBonusCredits", label: "Průlet – kredity (když není co doplnit)", group: "Komety", min: 0, max: 1000, step: 10 },
  { key: "cometNoShieldCredits", label: "Průlet bez štítového modulu – kredity", group: "Komety", min: 0, max: 1000, step: 10, hint: "loď bez štítu dostane navíc plný stres" },
  { key: "cometCollide", label: "Naráží do asteroidů i do sebe", group: "Komety", min: 0, max: 1, step: 1, bool: true, hint: "zapnuto: kometa se roztříští o asteroid (vykousne kráter) a dvě komety se při srážce zničí navzájem; doplňuje volbu v nastavení mapy" },
  { key: "cometChanceFew", label: "Málo – šance za kolo %", group: "Komety", min: 0, max: 100, step: 5 },
  { key: "cometMaxFew", label: "Málo – max. na mapě", group: "Komety", min: 1, max: 20, step: 1 },
  { key: "cometChanceMedium", label: "Středně – šance za kolo %", group: "Komety", min: 0, max: 100, step: 5 },
  { key: "cometMaxMedium", label: "Středně – max. na mapě", group: "Komety", min: 1, max: 20, step: 1 },
  { key: "cometChanceMany", label: "Hodně – šance za kolo %", group: "Komety", min: 0, max: 100, step: 5 },
  { key: "cometMaxMany", label: "Hodně – max. na mapě", group: "Komety", min: 1, max: 20, step: 1 },
  // --- náklad ---
  { key: "cargoRange", label: "Dosah zvednutí", group: "Náklad", min: 20, max: 600, step: 10, hint: "kruh kolem lodi ze startovní pozice kola" },
  { key: "cargoMaxSpeed", label: "Max. rychlost při zvedání", group: "Náklad", min: 1, max: 5, step: 1 },
  { key: "cargoFighter", label: "Kapacita stíhače (modulů)", group: "Náklad", min: 0, max: 4, step: 1 },
  // --- ekonomika ---
  { key: "startBudget", label: "Rozpočet na výbavu", group: "Ekonomika", min: 0, max: 5000, step: 50, hint: "co hráč neutratí, má jako kredity ve hře" },
  { key: "creditsPerKill", label: "Odměna za sestřel", group: "Ekonomika", min: 0, max: 5000, step: 10 },
  { key: "creditsPerTurn", label: "Odměna za přežité kolo", group: "Ekonomika", min: 0, max: 500, step: 5 },
  { key: "debrisRewardPct", label: "Sestřelený vyhozený modul – % ceny", group: "Ekonomika", min: 0, max: 200, step: 10 },
  // --- moduly ---
  { key: "moduleHpPct", label: "Životy modulů (% základu)", group: "Moduly", min: 10, max: 500, step: 10, hint: "základ: lasery 30, torpédomet 20, miny 20, kulomet 25, skener 15, štíty 40" },
  { key: "moduleDamagePct", label: "Podíl zranění trupu do modulu (%)", group: "Moduly", min: 0, max: 200, step: 5, hint: "směrovaný zásah poškodí modul na zasažené straně, výbuch/náraz náhodný modul" },
  { key: "moduleDropChance", label: "Šance, že modul vypadne ze zničené lodi (%)", group: "Moduly", min: 0, max: 100, step: 5, hint: "každý modul zvlášť: při 45 % vypadne ze 4 modulů aspoň jeden v 91 %, všechny jen ve 4 %" },
  { key: "brokenSellPct", label: "Prodej zničeného modulu (% ceny)", group: "Moduly", min: 0, max: 100, step: 5 },
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
  TORPEDO.safeTurns = t.torpedoSafeTurns;
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
  LASER.halfArcSide = (t.laserArcSideDeg * Math.PI) / 180;
  LASER.halfArcBack = (t.laserArcBackDeg * Math.PI) / 180;
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
  MG.range = t.mgRange;
  MG.halfArc = (t.mgArcDeg * Math.PI) / 180;
  MG.burst = t.mgBurst;
  MG.damage = t.mgDamage;
  MG.spread = (t.mgSpreadDeg * Math.PI) / 180;
  MG.hitNear = t.mgHitNear;
  MG.hitFar = t.mgHitFar;
  MODULES.mg.ammo = t.mgAmmo;
  MODULES.mg.price = t.priceMg;
  MODULES.mg.weight = t.weightMg;
  MODULES.mg.ammoWeight = t.weightPerMgRound;
  SCANNER.charges = t.scannerCharges;
  SCANNER.range = t.scannerRange;
  SCANNER.deepRange = t.scannerDeepRange;
  SCANNER.cooldown = t.scannerCooldown;
  MODULES.scanner.price = t.priceScanner;
  MODULES.scanner.weight = t.weightScanner;
  COMET.speed = t.cometSpeed;
  COMET.hull = t.cometHull;
  COMET.damage = t.cometDamage;
  COMET.radius = t.cometRadius;
  COMET.reward = t.cometReward;
  COMET.tailLength = t.cometTailLength;
  COMET.tailWidth = t.cometTailWidth;
  COMET.shieldPct = t.cometShieldPct;
  COMET.hullPct = t.cometHullPct;
  COMET.bonusCredits = t.cometBonusCredits;
  COMET.noShieldCredits = t.cometNoShieldCredits;
  COMET.chance = { few: t.cometChanceFew, medium: t.cometChanceMedium, many: t.cometChanceMany };
  COMET.max = { few: t.cometMaxFew, medium: t.cometMaxMedium, many: t.cometMaxMany };
  COMET.collide = t.cometCollide > 0;
  CARGO.range = t.cargoRange;
  CARGO.maxSpeed = t.cargoMaxSpeed;
  CARGO.fighter = t.cargoFighter;
  RULES.creditsPerKill = t.creditsPerKill;
  RULES.creditsPerTurn = t.creditsPerTurn;
  RULES.debrisRewardPct = t.debrisRewardPct;
  RULES.moduleDamagePct = t.moduleDamagePct;
  RULES.moduleDropChance = t.moduleDropChance;
  RULES.brokenSellPct = t.brokenSellPct;
  MODULE_HP_PCT.value = t.moduleHpPct;
}
