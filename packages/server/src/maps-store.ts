import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeCustomMap, summarizeMap, type CustomMap, type CustomMapSummary } from "@wingfighter/shared";

/** Vlastní mapy z editoru: soubor maps.json v kořeni projektu (vedle tuning.json). */
const here = fileURLToPath(new URL(".", import.meta.url));
export const MAPS_FILE = resolve(here, "../../../maps.json");
const MAX_MAPS = 200;

let maps = new Map<string, CustomMap>();

export function loadMaps(): number {
  maps = new Map();
  try {
    if (!existsSync(MAPS_FILE)) return 0;
    const raw = JSON.parse(readFileSync(MAPS_FILE, "utf8"));
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.maps) ? raw.maps : [];
    for (const r of list) {
      const m = sanitizeCustomMap(r);
      if (m) maps.set(m.id, m);
    }
  } catch (e) {
    console.warn("maps.json se nepodařilo načíst:", e);
  }
  return maps.size;
}

function persist(): void {
  writeFileSync(MAPS_FILE, JSON.stringify({ maps: [...maps.values()] }, null, 1) + "\n", "utf8");
}

export function listMaps(): CustomMapSummary[] {
  return [...maps.values()].map(summarizeMap).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMap(id: string): CustomMap | undefined {
  return maps.get(id);
}

/** Uloží (nová nebo přepis stejného id). Vrací uloženou mapu, nebo chybu. */
export function saveMap(raw: unknown, author: string): { map?: CustomMap; error?: string } {
  const m = sanitizeCustomMap(raw);
  if (!m) return { error: "neplatná mapa" };
  if (!maps.has(m.id) && maps.size >= MAX_MAPS) return { error: `příliš mnoho map (max. ${MAX_MAPS})` };
  const prev = maps.get(m.id);
  m.author = prev?.author || author || m.author || "neznámý";
  m.createdAt = prev?.createdAt ?? m.createdAt;
  m.updatedAt = Date.now();
  maps.set(m.id, m);
  persist();
  return { map: m };
}

export function deleteMap(id: string): boolean {
  const ok = maps.delete(id);
  if (ok) persist();
  return ok;
}
