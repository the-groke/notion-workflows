import 'dotenv/config';
import { createNotionClient, getAllPages } from "utils/notion";
import { logger } from "utils/logger";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const MEALS_DATABASE_ID = process.env.MEALS_DATABASE_ID;
const SHOPPING_HELPER_DATABASE_ID = process.env.SHOPPING_HELPER_DATABASE_ID;
const MEAL_PLANNER_DATABASE_ID = process.env.MEAL_PLANNER_DATABASE_ID;

if (!NOTION_TOKEN) {
  logger.error("NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!MEALS_DATABASE_ID) {
  logger.error("MEALS_DATABASE_ID is not defined");
  process.exit(1);
}

if (!SHOPPING_HELPER_DATABASE_ID) {
  logger.error("SHOPPING_HELPER_DATABASE_ID is not defined");
  process.exit(1);
}

if (!MEAL_PLANNER_DATABASE_ID) {
  logger.error("MEAL_PLANNER_DATABASE_ID is not defined");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);

const MEAL_ICON = "🍲"; // Shallow bowl of food
const INGREDIENT_ICON = "🥫"; // Can of tomatoes
const PLANNER_DAY_ICON = "📅"; // Calendar day

const setDefaultIcons = async () => {
  logger.info("Setting default icons for recipes and ingredients...");

  // Process Meals database
  logger.info("Fetching meals database...");
  const mealPages = await getAllPages(MEALS_DATABASE_ID, NOTION_TOKEN);
  const mealPagesWithoutIcons = mealPages.filter(
    (page): page is PageObjectResponse => "properties" in page && !page.icon
  );

  logger.info(`Found ${mealPagesWithoutIcons.length} meals without icons`);

  for (const page of mealPagesWithoutIcons) {
    const nameProperty = page.properties.Name;
    const name = nameProperty?.type === "title"
      ? nameProperty.title[0]?.plain_text || "Unknown"
      : "Unknown";

    await notion.pages.update({
      page_id: page.id,
      icon: {
        type: "emoji",
        emoji: MEAL_ICON,
      },
    });

    logger.info(`Set icon for meal: ${name}`);
  }

  logger.success(`Updated ${mealPagesWithoutIcons.length} meals with icons`);

  // Process Ingredients database (Shopping Helper)
  logger.info("Fetching ingredients database...");
  const ingredientPages = await getAllPages(SHOPPING_HELPER_DATABASE_ID, NOTION_TOKEN);
  const ingredientPagesWithoutIcons = ingredientPages.filter(
    (page): page is PageObjectResponse => "properties" in page && !page.icon
  );

  logger.info(`Found ${ingredientPagesWithoutIcons.length} ingredients without icons`);

  for (const page of ingredientPagesWithoutIcons) {
    const itemProperty = page.properties.Item;
    const item = itemProperty?.type === "title"
      ? itemProperty.title[0]?.plain_text || "Unknown"
      : "Unknown";

    await notion.pages.update({
      page_id: page.id,
      icon: {
        type: "emoji",
        emoji: INGREDIENT_ICON,
      },
    });

    logger.info(`Set icon for ingredient: ${item}`);
  }

  logger.success(`Updated ${ingredientPagesWithoutIcons.length} ingredients with icons`);

  // Process Meal Planner database
  logger.info("Fetching meal planner database...");
  const plannerPages = await getAllPages(MEAL_PLANNER_DATABASE_ID, NOTION_TOKEN);
  const plannerPagesWithoutIcons = plannerPages.filter(
    (page): page is PageObjectResponse => "properties" in page && !page.icon
  );

  logger.info(`Found ${plannerPagesWithoutIcons.length} planner days without icons`);

  for (const page of plannerPagesWithoutIcons) {
    const dayProperty = page.properties.Day;
    const day = dayProperty?.type === "title"
      ? dayProperty.title[0]?.plain_text || "Unknown"
      : "Unknown";

    await notion.pages.update({
      page_id: page.id,
      icon: {
        type: "emoji",
        emoji: PLANNER_DAY_ICON,
      },
    });

    logger.info(`Set icon for planner day: ${day}`);
  }

  logger.success(`Updated ${plannerPagesWithoutIcons.length} planner days with icons`);

  logger.success("All default icons set!");
};

try {
  await setDefaultIcons();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}
