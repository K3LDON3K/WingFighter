/** Herní konstanty – tady se ladí čísla. Vše v herních jednotkách (1 jednotka ≈ 1 px při zoomu 1). */

export const MAP = {
  width: 2400,
  height: 1600,
};

/** Délka jednoho "dílku" manévru – rychlost 3 = 3 dílky. */
export const MOVE_UNIT = 45;

/** Počet vzorků při simultánním pohybu (detekce kolizí po dráze). */
export const MOVE_STEPS = 24;

export const LASER = {
  /** Poloviční úhel palebné výseče (±20°). */
  halfArc: (20 * Math.PI) / 180,
  /** Maximální dostřel. */
  range: 300,
  /** Délka jednoho dostřelového pásma (pásmo 1 = bonus útočníka, pásmo 3 = bonus obránce). */
  band: 100,
};

/** Mutovatelná pravidla, která ladí `applyTuning` (viz tuning.ts). */
export const RULES = {
  /** Zranění za jeden čistý zásah laserem (zásahy − úhyby). */
  damagePerHit: 15,
  /** Zranění za náraz. */
  collisionShip: 15,
  collisionAsteroid: 15,
  collisionEdge: 15,
  shieldRecharge: 0,
  /** Počet akcí na kolo. */
  actionPoints: 2,
  /** O kolik klesne rychlost po otočce o 180°. */
  koiogranSpeedDrop: 2,
  /** Úhybný manévr: cena ve stresových bodech, stres pro loď, skrz kterou se proletí, snížení zranění minou/torpédem v %. */
  evadeStressCost: 1,
  evadePassStress: 1,
  evadeDamageReduction: 50,
  /** Štíty: pokles účinnosti celolodního štítu za zásah (%), výchozí a max. životy segmentu. */
  wholeEffDrop: 10,
  segmentHp: 2,
  segmentMax: 3,
  /** Ekonomika: odměna za sestřel, za přežité kolo, za sestřelený vyhozený modul (% ceny). */
  creditsPerKill: 200,
  creditsPerTurn: 10,
  debrisRewardPct: 50,
};

export const TORPEDO = {
  /** Zaměřovací dostřel na loď/torpédo při plánování (měří se z pozic na začátku kola). */
  lockRange: 320,
  /** Max. vzdálenost bodu na mapě, na který lze torpédo vystřelit (celý dolet). */
  pointRange: 1200,
  /** Plná rychlost (ujetá vzdálenost za kolo). */
  speed: 240,
  /** Fázové torpédo – výlet: délka rovného letu z lodi a startovní rychlost (j./kolo). */
  launchDist: 60,
  launchSpeed: 120,
  /** Zaměření: max. otočení (rad/kolo) a úhel, pod kterým je cíl „zaměřen“ (rad). */
  lockTurn: (90 * Math.PI) / 180,
  lockAngle: (15 * Math.PI) / 180,
  /** Let: zrychlení (j./kolo za kolo) na plnou `speed`, zatáčení při letu (rad/kolo), výseč sledování (rad, ±). */
  accel: 120,
  maxTurn: (45 * Math.PI) / 180,
  trackArc: (90 * Math.PI) / 180,
  /** Kolik kol torpédo sleduje cíl. */
  trackTurns: 5,
  /** Celková životnost v kolech. */
  lifeTurns: 5,
  /** Kolik kol po vypuštění torpédo nemůže zranit vlastníka. */
  safeTurns: 2,
  /** Zranění při přímém zásahu lodi (fyzické, bez kostek). */
  damage: 45,
  /** Poloměr pro detekci zásahu. */
  radius: 5,
  /** Plošný výbuch (na bodě, o asteroid, na konci života): poloměr a zranění všem lodím v poli. */
  blastRadius: 70,
  blastDamage: 30,
};

export const MINE = {
  /** Poloměr pole působnosti. */
  radius: 70,
  /** Jak daleko od startovní pozice lodi se mina odhodí (za sebe / do strany). */
  dropBehind: 40,
  dropSide: 70,
  /** Zranění všem lodím v poli. */
  damage: 30,
};

/** Kráter, který výbuch torpéda/miny vykousne z asteroidu (mutovatelné kvůli ladění). */
export const CRATER_RADIUS_REF = { value: 45 };

/** Stresové body: zásoba, cena manévrů, dobití za zelený manévr, poškození za nebezpečný (% trupu). */
export const STRESS = {
  max: 3,
  costRed: 1,
  costDanger: 2,
  regenGreen: 1,
  dangerHullPercent: 5,
};
/** Max. náhodná odchylka směru po odmrštění (radiány). */
export const COLLISION_SCATTER = (40 * Math.PI) / 180;
/** Kolikrát se loď může v jednom kole odrazit, než se zastaví. */
export const MAX_DEFLECTIONS = 4;
/** Obranné kostky torpéda při pokusu o sestřelení laserem. */
export const TORPEDO_AGILITY = 2;

/** Rozsah dostřelu zaměřovače (akce "zámek cíle"). */
export const LOCK_RANGE = 300;

/** Barvy týmů (index = číslo týmu). */
export const TEAM_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#f97316", "#06b6d4", "#ec4899"];
export const TEAM_NAMES = ["Modří", "Červení", "Zelení", "Žlutí", "Fialoví", "Oranžoví", "Tyrkysoví", "Růžoví"];
export const MAX_TEAMS_TDM = 3;
