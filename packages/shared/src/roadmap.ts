/**
 * Roadmapa – sdílený model položek. Data žijí v souboru roadmap.json v kořeni projektu (na serveru),
 * klient je čte a upravuje přes HTTP API /api/roadmap.
 */

export type RoadmapStatus = "doing" | "next" | "mid" | "later";

export interface RoadmapItem {
  id: string;
  /** oblast (nový droid, nový modul, nová loď, herní mód, prvky na mapě, UI…) – štítek před názvem */
  group: string;
  title: string;
  text: string;
  status: RoadmapStatus;
  /** hotovo – položka se přesune do sekce Hotovo */
  done: boolean;
  /** datum (YYYY-MM-DD) označení jako hotové */
  doneAt?: string;
}

export const ROADMAP_STATUSES: RoadmapStatus[] = ["doing", "next", "mid", "later"];

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  doing: "Stále probíhá",
  next: "Budeme vypracovávat",
  mid: "Střednědobý vývoj",
  later: "Pozdější vývoj",
};

export const ROADMAP_GROUPS = ["Nový droid", "Nový modul", "Nová loď", "Herní mód", "Prvky na mapě", "UI", "Zpětná vazba", "Jiné"];

export const ROADMAP_MAX = 200;

/** Výchozí obsah – použije se, když roadmap.json ještě neexistuje. */
export const ROADMAP_DEFAULT: RoadmapItem[] = [
  { id: "ui", status: "doing", group: "UI", title: "Úprava UI", text: "Průběžné zpřehledňování a zkompaktnění obrazovek.", done: false },
  { id: "droid-strelec", status: "next", group: "Nový droid", title: "Droid Střelec", text: "", done: false },
  { id: "hyperpohon", status: "next", group: "Nový modul", title: "Velký modul – Hyperpohon", text: "", done: false },
  { id: "atomovka", status: "next", group: "Nový modul", title: "Velký modul – Atomová bomba", text: "", done: false },
  { id: "mapa-vizual", status: "next", group: "Prvky na mapě", title: "Vizuální prvky bez efektů", text: "", done: false },
  { id: "feedback", status: "next", group: "Zpětná vazba", title: "Zpětná vazba po zápase", text: "Po dokončení zápasu může hráč napsat zpětnou vazbu; admin ji uvidí v roadmapě jako seznam zpráv.", done: false },
  { id: "droid-hacker", status: "mid", group: "Nový droid", title: "Droid Hacker", text: "", done: false },
  { id: "stredni-lod", status: "mid", group: "Nová loď", title: "Střední loď", text: "", done: false },
  { id: "mapa-budovy", status: "mid", group: "Prvky na mapě", title: "Budovy, vesmírné stanice", text: "", done: false },
  { id: "mapa-hazard", status: "mid", group: "Prvky na mapě", title: "Nové druhy hazardu", text: "Slunce, planety.", done: false },
  { id: "mapa-suroviny", status: "mid", group: "Prvky na mapě", title: "Skryté suroviny či moduly v asteroidech", text: "", done: false },
  { id: "velka-lod", status: "later", group: "Nová loď", title: "Velká loď", text: "", done: false },
  { id: "mod-obrana", status: "later", group: "Herní mód", title: "Obrana Velké lodi", text: "", done: false },
  { id: "mod-utok", status: "later", group: "Herní mód", title: "Útok na Velkou loď", text: "", done: false },
];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Očistí seznam z klienta/souboru; vrátí null, když to není pole. */
export function sanitizeRoadmap(raw: unknown): RoadmapItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RoadmapItem[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, ROADMAP_MAX)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = str(o.title, 120);
    if (!title) continue;
    let id = str(o.id, 40) || newRoadmapId();
    while (seen.has(id)) id = newRoadmapId();
    seen.add(id);
    const status = ROADMAP_STATUSES.includes(o.status as RoadmapStatus) ? (o.status as RoadmapStatus) : "later";
    const item: RoadmapItem = { id, group: str(o.group, 40) || "Jiné", title, text: str(o.text, 400), status, done: o.done === true };
    const doneAt = str(o.doneAt, 10);
    if (item.done && /^\d{4}-\d{2}-\d{2}$/.test(doneAt)) item.doneAt = doneAt;
    out.push(item);
  }
  return out;
}

export function newRoadmapId(): string {
  return Math.random().toString(36).slice(2, 10);
}
