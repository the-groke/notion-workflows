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
} from "utils/notion.js";
import { createAIClient, batchAnnotate, type AIClient } from "utils/ai.js";
import { logger } from "utils/logger.js";
// Config
import {
  REQUIRED_PROPERTIES,
  FIELD_MAPPINGS,
} from "./config.js";
// Types
import type { MealData }from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.MEALS_DATABASE_ID;

if (!NOTION_TOKEN) {
  logger.error("NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!DATABASE_ID) {
  logger.error("MEALS_DATABASE_ID is not defined");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);
const ai: AIClient = await createAIClient();

const buildPrompt = async (meals: string[]): Promise<string> => {
  const promptTemplate = await readFile(
    join(__dirname, "prompt.md"),
    "utf-8"
  );
  const mealsList = meals.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return promptTemplate.replace("{{MEALS_LIST}}", mealsList);
};

interface MealsResponse {
  meals: MealData[];
}

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

const isValidMealsResponse = (obj: unknown): obj is MealsResponse => {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  
  const response = obj as Record<string, JsonValue>;
  if (!Array.isArray(response.meals)) return false;
  
  return response.meals.every((meal) => {
    if (typeof meal !== "object" || meal === null || Array.isArray(meal)) return false;
    const m = meal as Record<string, JsonValue>;
    return (
      typeof m.ingredients === "string" &&
      typeof m.cookingInstructions === "string"
    );
  });
};

const parseResponse = (json: unknown): MealData[] => {
  if (!isValidMealsResponse(json)) {
    throw new Error("Response missing 'meals' array or invalid structure");
  }
  return json.meals;
};

const run = async () => {
  logger.info("Fetching all pages from meals database...");
  const pages = await getAllPages(DATABASE_ID, NOTION_TOKEN);

  logger.info("Pages retrieved", { count: pages.length });

  const eligible = pages.filter((page) =>
    hasEmptyProperties(page, [...REQUIRED_PROPERTIES])
  );
  logger.info("Found meals with empty fields", { count: eligible.length });

  if (!eligible.length) {
    logger.info("No meals need completion. All done!");
    return;
  }

  await batchAnnotate<MealData>(ai, {
    pages: eligible,
    extractName: extractTitle,
    buildPrompt,
    parseResponse,
    buildUpdates: (page, data) =>
      buildPropertyUpdates(
        page,
        data,
        FIELD_MAPPINGS
      ),
    updatePage: async (page, updates) =>
      updatePage(notion, page.id, updates),
    itemType: "meal",
  });

  logger.success("Meal completion complete");
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}