import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROADMAP_DEFAULT, sanitizeRoadmap, type RoadmapItem } from "@wingfighter/shared";

/** Roadmapa: roadmap.json v kořeni projektu (vedle tuning.json). Upravuje se ve hře i ručně v souboru. */
const here = fileURLToPath(new URL(".", import.meta.url));
export const ROADMAP_FILE = resolve(here, "../../../roadmap.json");

export function loadRoadmap(): RoadmapItem[] {
  try {
    if (existsSync(ROADMAP_FILE)) {
      const list = sanitizeRoadmap(JSON.parse(readFileSync(ROADMAP_FILE, "utf8")));
      if (list) return list;
    } else {
      saveRoadmap(ROADMAP_DEFAULT);
      return ROADMAP_DEFAULT;
    }
  } catch (e) {
    console.warn("roadmap.json se nepodařilo načíst:", e);
  }
  return ROADMAP_DEFAULT;
}

export function saveRoadmap(list: RoadmapItem[]): void {
  writeFileSync(ROADMAP_FILE, JSON.stringify(list, null, 2) + "\n", "utf8");
}
