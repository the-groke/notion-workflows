import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Utils
import {
  createNotionClient,
  getAllPages,
  extractTitle,
  hasEmptyProperties,
  buildPropertyUpdates,
  updatePage,
} from "utils/notion";
import { createAIClient, batchAnnotate, type AIClient } from "utils/ai";
import { logger } from "utils/logger";
// Config
import {
  REQUIRED_PROPERTIES,
  FIELD_MAPPINGS,
} from "./config";
// Types
import type { TravelPlace } from "./config";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.TRAVEL_DATABASE_ID;

if (!NOTION_TOKEN) {
  logger.error("NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!DATABASE_ID) {
  logger.error("TRAVEL_DATABASE_ID is not defined");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);
const ai: AIClient = await createAIClient();

const buildPrompt = async (places: string[]): Promise<string> => {
  const promptTemplate = await readFile(
    join(__dirname, "prompt.md"),
    "utf-8"
  );
  const placesList = places.map((p, i) => `${i + 1}. ${p}`).join("\n");
  return promptTemplate.replace("{{PLACES_LIST}}", placesList);
};

interface TravelPlacesResponse {
  places: TravelPlace[];
}

const isValidTravelPlacesResponse = (obj: unknown): obj is TravelPlacesResponse => {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  
  const response = obj as Record<string, JsonValue>;
  if (!Array.isArray(response.places)) return false;
  
  return response.places.every((place) => {
    if (typeof place !== "object" || place === null || Array.isArray(place)) return false;
    const p = place as Record<string, JsonValue>;
    return (
      typeof p.stayLength === "string" &&
      typeof p.bestSeason === "string" &&
      typeof p.knownFor === "string" &&
      typeof p.activities === "string" &&
      typeof p.flights === "string" &&
      typeof p.transportInfo === "string"
    );
  });
};

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

const parseResponse = (response: unknown): TravelPlace[] => {
  const json = response as JsonValue;
  if (!isValidTravelPlacesResponse(json)) {
    throw new Error("Response missing 'places' array or invalid structure");
  }
  return json.places;
};

const run = async () => {
  logger.info("Fetching all pages from database...");
  const pages = await getAllPages(DATABASE_ID, NOTION_TOKEN);

  logger.info("Pages retrieved", { count: pages.length });

  const eligible = pages.filter((page) =>
    hasEmptyProperties(page, [...REQUIRED_PROPERTIES])
  );
  logger.info("Found place items with empty fields", { count: eligible.length });

  if (!eligible.length) {
    logger.info("No items need annotation. All done!");
    return;
  }

  await batchAnnotate<TravelPlace>(ai, {
    pages: eligible,
    extractName: extractTitle,
    buildPrompt,
    parseResponse,
    buildUpdates: (page, data) =>
      buildPropertyUpdates(page, data, FIELD_MAPPINGS),
    updatePage: async (page, updates) =>
      updatePage(notion, page.id, updates),
    itemType: "place",
  });

  logger.success("Place annotation complete");
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}