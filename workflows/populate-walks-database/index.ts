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
import { logger } from 'utils/logger';
import { createAIClient, batchAnnotate } from "utils/ai";
// Config
import {
  REQUIRED_PROPERTIES,
  FIELD_MAPPINGS,
} from "./config";
// Types
import type { Walk } from "./config";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.WALKS_DATABASE_ID;
const HOME_LOCATION = process.env.HOME_LOCATION;

if (!NOTION_TOKEN) {
  console.error("ERROR: NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!DATABASE_ID) {
  console.error("ERROR: WALKS_DATABASE_ID is not defined");
  process.exit(1);
}

if (!HOME_LOCATION) {
  console.error("ERROR: HOME_LOCATION is not defined");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);
const ai = await createAIClient();

const buildPrompt = async (walks: string[]): Promise<string> => {
  const promptTemplate = await readFile(
    join(__dirname, "prompt.md"),
    "utf-8"
  );
  const walksList = walks.map((w, i) => `${i + 1}. ${w}`).join("\n");
  return promptTemplate
    .replaceAll("{{HOME_LOCATION}}", HOME_LOCATION)
    .replaceAll("{{WALKS_LIST}}", walksList);
};

interface WalksResponse {
  walks: Walk[];
}

const isValidWalksResponse = (obj: unknown): obj is WalksResponse => {
  if (typeof obj !== "object" || obj === null) return false;
  
  const response = obj as Record<string, unknown>;
  if (!Array.isArray(response.walks)) return false;
  
  return response.walks.every((walk) => {
    return (
      typeof walk === "object" &&
      walk !== null &&
      typeof (walk as Record<string, unknown>).distance === "number" &&
      typeof (walk as Record<string, unknown>).transport === "string" &&
      typeof (walk as Record<string, unknown>).type === "string" &&
      typeof (walk as Record<string, unknown>).parking === "string" &&
      typeof (walk as Record<string, unknown>).routes === "string" &&
      typeof (walk as Record<string, unknown>).terrain === "string" &&
      typeof (walk as Record<string, unknown>).pubs === "string"
    );
  });
};

const parseResponse = (json: unknown): Walk[] => {
  if (!isValidWalksResponse(json)) {
    throw new Error("Response missing 'walks' array or invalid structure");
  }
  return json.walks;
};

const run = async () => {
  logger.info("Fetching all pages from database...");
  const pages = await getAllPages(DATABASE_ID, NOTION_TOKEN);

  logger.info(`Total pages retrieved: ${pages.length}`);

  const eligible = pages.filter((page) =>
    hasEmptyProperties(page, [...REQUIRED_PROPERTIES])
  );
  logger.info(`Found ${eligible.length} walk items with empty fields`);

  if (!eligible.length) {
    logger.info("No items need annotation. All done!");
    return;
  }

  await batchAnnotate<Walk>(ai, {
    pages: eligible,
    extractName: extractTitle,
    buildPrompt,
    parseResponse,
    buildUpdates: (page, data) =>
      buildPropertyUpdates(page, data, FIELD_MAPPINGS),
    updatePage: async (page, updates) =>
      updatePage(notion, page.id, updates),
    itemType: "walk",
  });

  logger.info("\n✓ Walk annotation complete");
  logger.info("💡 Sort by 'Distance from home' to see closest walks first.");
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}