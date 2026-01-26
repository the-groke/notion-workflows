import 'dotenv/config';
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
import type { PageObjectResponse } from '@notionhq/client';

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

const buildPrompt = async (meals: string[], pages: PageObjectResponse[]): Promise<string> => {
  const promptTemplate = await readFile(
    join(__dirname, "prompt.md"),
    "utf-8"
  );
  
  const mealsList = meals.map((m, i) => {
    const page = pages[i];
    let entry = `${i + 1}. ${m}`;
    
    // Add existing ingredients if present
    const ingredients = page.properties.Ingredients;
    if (ingredients?.multi_select?.length > 0) {
      const existingIngredients = ingredients.multi_select
        .map((tag: any) => tag.name)
        .join(", ");
      entry += `\n   Existing ingredients: ${existingIngredients}`;
    }
    
    return entry;
  }).join("\n");
  
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

const setCoverFromGallery = async (notion: any, page: any) => {
  try {
    // Check if Gallery property exists and has files
    const gallery = page.properties.Gallery;
    if (!gallery || gallery.type !== "files" || !gallery.files?.length) {
      return;
    }

    const firstImage = gallery.files[0];
    if (!firstImage) return;

    // Check if cover already exists
    if (page.cover) return;

    // Set the cover
    const coverUpdate: any = {};
    
    if (firstImage.type === "external") {
      coverUpdate.cover = {
        type: "external",
        external: { url: firstImage.external.url }
      };
    } else if (firstImage.type === "file") {
      coverUpdate.cover = {
        type: "external",
        external: { url: firstImage.file.url }
      };
    }

    if (coverUpdate.cover) {
      await notion.pages.update({
        page_id: page.id,
        ...coverUpdate
      });
      logger.info(`Set cover for ${extractTitle(page)}`);
    }
  } catch (err) {
    logger.warn(`Failed to set cover for ${extractTitle(page)}`, { error: err instanceof Error ? err : undefined });
  }
};

type Page = {
  id: string;
  cover?: Cover;
  properties: { [key: string]: unknown };
}

type Cover = {
  type: string;
  external?: { url: string };
  file?: { url: string };
}

const updateCoversForAllPages = async (pages: PageObjectResponse[]) => {
  logger.info("Checking pages for cover images...");
  let updated = 0;
  
  for (const page of pages) {
    const hadNoCover = !page.cover;
    await setCoverFromGallery(notion, page);
    if (hadNoCover && !page.cover) {
      // Check if it was updated
      const updatedPage = await notion.pages.retrieve({ page_id: page.id });
      if (updatedPage.cover) updated++;
    }
  }
  
  if (updated > 0) {
    logger.info(`Updated ${updated} page cover(s)`);
  } else {
    logger.info("No pages needed cover updates");
  }
};

const run = async () => {
  logger.info("Fetching all pages from meals database...");
  const pages = await getAllPages(DATABASE_ID, NOTION_TOKEN);

  logger.info("Pages retrieved", { count: pages.length });

  // First, update covers for all pages
  await updateCoversForAllPages(pages);

  // Then check for meals that need AI completion
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
    buildPrompt: (meals) => buildPrompt(meals, eligible),
    parseResponse,
    buildUpdates: (page, data) =>
      buildPropertyUpdates(
        page,
        data,
        FIELD_MAPPINGS
      ),
    updatePage: async (page, updates) => {
      await updatePage(notion, page.id, updates);
      // Set cover from Gallery if available (for newly completed meals)
      await setCoverFromGallery(notion, page);
    },
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