import 'dotenv/config';
// Utils
import {
  createNotionClient,
  getAllPages,
  getAllBlocks,
} from "utils/notion";
import { logger } from "utils/logger";
import { createAIClient, type AIClient } from "utils/ai";
// Types
import type { 
  PageObjectResponse,
  BlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const MEAL_PLANNER_DATABASE_ID = process.env.MEAL_PLANNER_DATABASE_ID;
const MEALS_DATABASE_ID = process.env.MEALS_DATABASE_ID;
const SHOPPING_HELPER_DATABASE_ID = process.env.SHOPPING_HELPER_DATABASE_ID;
const GROCERY_SHOPPING_LIST_PAGE_ID = process.env.GROCERY_SHOPPING_LIST_PAGE_ID;
const TURKISH_SUPERMARKET_LIST_PAGE_ID = process.env.TURKISH_SUPERMARKET_LIST_PAGE_ID;
const ASIAN_SUPERMARKET_LIST_PAGE_ID = process.env.ASIAN_SUPERMARKET_LIST_PAGE_ID;

if (!NOTION_TOKEN) {
  logger.error("NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!MEAL_PLANNER_DATABASE_ID) {
  logger.error("MEAL_PLANNER_DATABASE_ID is not defined");
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

if (!GROCERY_SHOPPING_LIST_PAGE_ID) {
  logger.error("GROCERY_SHOPPING_LIST_PAGE_ID is not defined");
  process.exit(1);
}

if (!TURKISH_SUPERMARKET_LIST_PAGE_ID) {
  logger.error("TURKISH_SUPERMARKET_LIST_PAGE_ID is not defined");
  process.exit(1);
}

if (!ASIAN_SUPERMARKET_LIST_PAGE_ID) {
  logger.error("ASIAN_SUPERMARKET_LIST_PAGE_ID is not defined");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);
const ai: AIClient = await createAIClient();

interface Meal {
  id: string;
  name: string;
  date: string;
  ingredients: string[];
}

interface HelperItem {
  id: string;
  item: string;
  addToShoppingList: boolean;
  addToTurkishList: boolean;
  addToAsianList: boolean;
  delete: boolean;
  mealId?: string;
  createdTime: string;
}

type ShoppingListType = 'grocery' | 'turkish' | 'asian';

// Get meals for the next 7 days by querying the meal planner and following relations
const getUpcomingMeals = async (): Promise<Meal[]> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const sevenDaysFromNow = new Date(today);
  sevenDaysFromNow.setDate(today.getDate() + 7);

  // Query the Meal Planner database for the next 7 days
  const response = await fetch(
    `https://api.notion.com/v1/databases/${MEAL_PLANNER_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
          and: [
            {
              property: "Date",
              date: {
                on_or_after: today.toISOString().split('T')[0],
              },
            },
            {
              property: "Date",
              date: {
                before: sevenDaysFromNow.toISOString().split('T')[0],
              },
            },
          ],
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to query meal planner database: ${error.message}`);
  }

  const data = await response.json();
  const plannerPages = data.results.filter(
    (page: unknown): page is PageObjectResponse => {
      return typeof page === "object" && page !== null && "properties" in page;
    }
  );

  // Collect all meal IDs from Breakfast, Lunch, and Dinner relations
  const mealIds = new Set<string>();
  const mealIdToDate = new Map<string, string>();

  for (const page of plannerPages) {
    const dateProperty = page.properties.Date;
    const date = dateProperty?.type === "date" ? dateProperty.date?.start || "" : "";

    const breakfastProp = page.properties.Breakfast;
    const lunchProp = page.properties.Lunch;
    const dinnerProp = page.properties.Dinner;

    if (breakfastProp?.type === "relation") {
      for (const rel of breakfastProp.relation) {
        mealIds.add(rel.id);
        mealIdToDate.set(rel.id, date);
      }
    }

    if (lunchProp?.type === "relation") {
      for (const rel of lunchProp.relation) {
        mealIds.add(rel.id);
        mealIdToDate.set(rel.id, date);
      }
    }

    if (dinnerProp?.type === "relation") {
      for (const rel of dinnerProp.relation) {
        mealIds.add(rel.id);
        mealIdToDate.set(rel.id, date);
      }
    }
  }

  if (mealIds.size === 0) {
    logger.info("No meals found in the next 7 days");
    return [];
  }

  // Fetch all the actual meal pages from the Meals database
  const meals: Meal[] = [];

  for (const mealId of mealIds) {
    try {
      const mealPage = await notion.pages.retrieve({ page_id: mealId });

      if (!("properties" in mealPage)) {
        continue;
      }

      const nameProperty = mealPage.properties.Name;
      const ingredientsProperty = mealPage.properties.Ingredients;

      const name = nameProperty?.type === "title"
        ? nameProperty.title[0]?.plain_text || ""
        : "";

      const ingredients = ingredientsProperty?.type === "multi_select"
        ? ingredientsProperty.multi_select.map((i) => i.name)
        : [];

      const date = mealIdToDate.get(mealId) || "";

      if (name && ingredients.length > 0) {
        meals.push({ id: mealId, name, date, ingredients });
      }
    } catch (error) {
      logger.warn("Failed to fetch meal", { mealId, error });
    }
  }

  return meals;
};

// Get existing helper items
const getHelperItems = async (): Promise<HelperItem[]> => {
  const pages = await getAllPages(SHOPPING_HELPER_DATABASE_ID, NOTION_TOKEN);

  return pages
    .filter((page): page is PageObjectResponse => "properties" in page)
    .map((page) => {
      const itemProperty = page.properties.Item;
      const groceryCheckboxProperty = page.properties["Add to shopping list"];
      const turkishCheckboxProperty = page.properties["Add to Turkish supermarket shopping list"];
      const asianCheckboxProperty = page.properties["Add to Asian supermarket shopping list"];
      const deleteProperty = page.properties.Delete;
      const mealProperty = page.properties.Meal;

      const item = itemProperty?.type === "title"
        ? itemProperty.title[0]?.plain_text || ""
        : "";

      const addToShoppingList = groceryCheckboxProperty?.type === "checkbox"
        ? groceryCheckboxProperty.checkbox
        : false;

      const addToTurkishList = turkishCheckboxProperty?.type === "checkbox"
        ? turkishCheckboxProperty.checkbox
        : false;

      const addToAsianList = asianCheckboxProperty?.type === "checkbox"
        ? asianCheckboxProperty.checkbox
        : false;

      const deleteFlag = deleteProperty?.type === "checkbox"
        ? deleteProperty.checkbox
        : false;

      const mealId = mealProperty?.type === "relation"
        ? mealProperty.relation[0]?.id
        : undefined;

      const createdTime = page.created_time;

      return { 
        id: page.id, 
        item, 
        addToShoppingList, 
        addToTurkishList,
        addToAsianList,
        delete: deleteFlag, 
        mealId, 
        createdTime 
      };
    });
};

// Populate helper database with upcoming meal ingredients
const populateHelperDatabase = async (
  meals: Meal[],
  existingItems: HelperItem[]
): Promise<void> => {
  const existingItemNames = new Set(existingItems.map((i) => i.item.toLowerCase()));
  const currentMealIds = new Set(meals.map((m) => m.id));
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Create a map of all current ingredients from upcoming meals
  const upcomingIngredients = new Set<string>();
  for (const meal of meals) {
    for (const ingredient of meal.ingredients) {
      upcomingIngredients.add(ingredient.toLowerCase());
    }
  }

  // Delete items that meet any of these criteria:
  // 1. Related to meals no longer in the next 7 days
  // 2. Older than 7 days AND not checked for any shopping list
  // 3. Marked as "Delete" AND older than 7 days (to prevent re-adding)
  for (const item of existingItems) {
    const itemCreatedDate = new Date(item.createdTime);
    const isOlderThan7Days = itemCreatedDate < sevenDaysAgo;
    const isCheckedForAnyList = item.addToShoppingList || item.addToTurkishList || item.addToAsianList;
    
    const shouldDelete = 
      (item.mealId && !currentMealIds.has(item.mealId)) ||
      (isOlderThan7Days && !isCheckedForAnyList) ||
      (item.delete && isOlderThan7Days);

    if (shouldDelete) {
      await notion.pages.update({
        page_id: item.id,
        archived: true,
      });
      logger.info("Removed item", { 
        item: item.item,
        reason: item.delete ? "marked for deletion (>7 days)" : 
                isOlderThan7Days ? "older than 7 days" : 
                "meal no longer upcoming"
      });
    }
  }

  // Resurrect items: Uncheck "Delete" for items that appear in new upcoming meals
  for (const item of existingItems) {
    if (item.delete && upcomingIngredients.has(item.item.toLowerCase())) {
      await notion.pages.update({
        page_id: item.id,
        properties: {
          Delete: {
            checkbox: false,
          },
        },
      });
      logger.info("Resurrected item (unchecked Delete)", { item: item.item });
    }
  }

  // Deduplicate ingredients before adding
  const ingredientsToAdd = new Map<string, { meal: Meal; ingredient: string }>();
  
  for (const meal of meals) {
    for (const ingredient of meal.ingredients) {
      const normalizedIngredient = ingredient.toLowerCase();
      if (!existingItemNames.has(normalizedIngredient) && !ingredientsToAdd.has(normalizedIngredient)) {
        ingredientsToAdd.set(normalizedIngredient, { meal, ingredient });
      }
    }
  }

  // Add new ingredients
  for (const [_, { meal, ingredient }] of ingredientsToAdd) {
    await notion.pages.create({
      parent: { database_id: SHOPPING_HELPER_DATABASE_ID },
      properties: {
        Item: {
          title: [{ text: { content: ingredient } }],
        },
        "Add to shopping list": {
          checkbox: false,
        },
        "Add to Turkish supermarket shopping list": {
          checkbox: false,
        },
        "Add to Asian supermarket shopping list": {
          checkbox: false,
        },
        Delete: {
          checkbox: false,
        },
        Meal: {
          relation: [{ id: meal.id }],
        },
      },
    });
    existingItemNames.add(ingredient.toLowerCase());
    logger.info("Added ingredient to helper", { ingredient, meal: meal.name });
  }

  if (ingredientsToAdd.size > 0) {
    logger.success("Added new ingredients", { count: ingredientsToAdd.size });
  }
};

// Get existing shopping list headings
const getShoppingListHeadings = async (pageId: string): Promise<string[]> => {
  const blocks = await getAllBlocks(notion, pageId);
  const headings: string[] = [];

  for (const block of blocks) {
    if ("type" in block && block.type === "heading_2" && "heading_2" in block) {
      const heading = (block as BlockObjectResponse & { type: "heading_2" }).heading_2;
      const headingText = heading.rich_text?.[0];
      if (headingText && "plain_text" in headingText) {
        headings.push(headingText.plain_text);
      }
    }
  }

  return headings;
};

// Get existing shopping list items (all unchecked to-dos across all headings)
const getExistingShoppingListItems = async (pageId: string): Promise<Set<string>> => {
  const blocks = await getAllBlocks(notion, pageId);
  const existingItems = new Set<string>();

  for (const block of blocks) {
    if ("type" in block && block.type === "to_do" && "to_do" in block) {
      const todo = (block as BlockObjectResponse & { type: "to_do" }).to_do;
      const itemText = todo.rich_text?.[0];
      if (itemText && "plain_text" in itemText && !todo.checked) {
        existingItems.add(itemText.plain_text.toLowerCase());
      }
    }
  }

  return existingItems;
};

// Use AI to categorize items into headings
const categorizeItems = async (
  items: string[],
  headings: string[]
): Promise<Record<string, string[]>> => {
  const prompt = `You are organizing a shopping list. Given these items and existing category headings, assign each item to the most appropriate heading.

Items to categorize:
${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}

Existing headings:
${headings.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Rules:
- Assign each item to exactly one existing heading
- Use common sense (e.g., "Chicken" → "Meat & Fish", "Milk" → "Dairy")
- If an item could fit multiple categories, choose the most specific one
- Do NOT create new headings

Respond with ONLY valid JSON (no markdown):
{
  "categorized": {
    "Heading Name": ["item1", "item2"],
    "Another Heading": ["item3"]
  }
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    generationConfig: {
      response_mime_type: "application/json",
    },
  });

  let cleanedText = response.text.trim();
  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  const parsed = JSON.parse(cleanedText);
  return parsed.categorized as Record<string, string[]>;
};

// Add items to shopping list under appropriate headings
const addItemsToShoppingList = async (
  categorized: Record<string, string[]>,
  pageId: string
): Promise<void> => {
  const blocks = await getAllBlocks(notion, pageId);

  for (const [heading, items] of Object.entries(categorized)) {
    // Find the heading block
    let headingBlockId: string | null = null;
    let headingIndex = -1;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if ("type" in block && block.type === "heading_2" && "heading_2" in block) {
        const h = (block as BlockObjectResponse & { type: "heading_2" }).heading_2;
        const headingText = h.rich_text?.[0];
        if (headingText && "plain_text" in headingText && headingText.plain_text === heading) {
          headingBlockId = block.id;
          headingIndex = i;
          break;
        }
      }
    }

    if (!headingBlockId) {
      logger.warn("Heading not found, skipping items", { heading, items });
      continue;
    }

    // Find the next block after the heading that's NOT a to_do (or end of list)
    // We want to insert before the next heading or other non-todo block
    let insertBeforeBlockId: string | null = null;
    
    for (let i = headingIndex + 1; i < blocks.length; i++) {
      const block = blocks[i];
      if ("type" in block && block.type !== "to_do") {
        insertBeforeBlockId = block.id;
        break;
      }
    }

    // Create todo blocks
    const todoBlocks = items.map((item) => ({
      object: "block" as const,
      type: "to_do" as const,
      to_do: {
        rich_text: [{ type: "text" as const, text: { content: item } }],
        checked: false,
      },
    }));

    // If we found a block to insert before, use that; otherwise append to the page
    if (insertBeforeBlockId) {
      // Insert before the next block
      for (const todoBlock of todoBlocks) {
        await notion.blocks.children.append({
          block_id: pageId,
          children: [todoBlock],
          after: headingBlockId,
        });
      }
    } else {
      // Append to the end of the page (after heading)
      await notion.blocks.children.append({
        block_id: pageId,
        children: todoBlocks,
      });
    }

    logger.success("Added items to shopping list", { heading, count: items.length });
  }
};

// Process items for a specific shopping list type
const processShoppingList = async (
  items: HelperItem[],
  listType: ShoppingListType,
  pageId: string
): Promise<number> => {
  const listName = listType === 'grocery' ? 'grocery' : 
                   listType === 'turkish' ? 'Turkish' : 'Asian';

  if (items.length === 0) {
    logger.info(`No items checked for ${listName} shopping list`);
    return 0;
  }

  logger.info(`Found items for ${listName} list`, { count: items.length });

  // Get existing shopping list items to avoid duplicates
  const existingShoppingListItems = await getExistingShoppingListItems(pageId);
  
  // Filter out items that already exist on the shopping list
  const newItemsToAdd = items.filter(
    item => !existingShoppingListItems.has(item.item.toLowerCase())
  );

  if (newItemsToAdd.length === 0) {
    logger.info(`All checked items already exist on ${listName} shopping list`);
    return 0;
  }

  logger.info(`Items to add to ${listName} shopping list`, { 
    total: items.length,
    new: newItemsToAdd.length,
    duplicate: items.length - newItemsToAdd.length
  });

  const headings = await getShoppingListHeadings(pageId);
  logger.info(`Found ${listName} shopping list headings`, { headings });

  const itemNames = newItemsToAdd.map((item) => item.item);
  const categorized = await categorizeItems(itemNames, headings);

  await addItemsToShoppingList(categorized, pageId);

  logger.success(`${listName} shopping list updated`, {
    added: newItemsToAdd.length,
    skipped: items.length - newItemsToAdd.length,
  });

  return newItemsToAdd.length;
};

const run = async () => {
  // Step 1: Populate helper database with upcoming meal ingredients
  logger.info("Fetching upcoming meals (next 7 days)...");
  const upcomingMeals = await getUpcomingMeals();
  logger.info("Found upcoming meals", { count: upcomingMeals.length });

  logger.info("Updating shopping helper database...");
  const existingHelperItems = await getHelperItems();
  await populateHelperDatabase(upcomingMeals, existingHelperItems);

  // Step 2: Process items for each shopping list type
  const groceryItems = existingHelperItems.filter((item) => item.addToShoppingList);
  const turkishItems = existingHelperItems.filter((item) => item.addToTurkishList);
  const asianItems = existingHelperItems.filter((item) => item.addToAsianList);

  let totalAdded = 0;

  // Process grocery list
  totalAdded += await processShoppingList(
    groceryItems, 
    'grocery', 
    GROCERY_SHOPPING_LIST_PAGE_ID
  );

  // Process Turkish supermarket list
  totalAdded += await processShoppingList(
    turkishItems, 
    'turkish', 
    TURKISH_SUPERMARKET_LIST_PAGE_ID
  );

  // Process Asian supermarket list
  totalAdded += await processShoppingList(
    asianItems, 
    'asian', 
    ASIAN_SUPERMARKET_LIST_PAGE_ID
  );

  // Delete ALL checked items from helper database (from any list)
  const allCheckedItems = existingHelperItems.filter(
    (item) => item.addToShoppingList || item.addToTurkishList || item.addToAsianList
  );

  for (const item of allCheckedItems) {
    await notion.pages.update({
      page_id: item.id,
      archived: true,
    });
  }

  logger.success("Shopping helper workflow complete", {
    totalAdded,
    itemsProcessed: allCheckedItems.length,
  });
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}