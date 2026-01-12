
import { createNotionClient, getAllPages } from 'utils/notion.js';
import { MEAL_PLANNER_WINDOW_DAYS, type MealPlanDay } from "./config.js";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { logger } from 'utils/logger.js';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.MEAL_PLANNER_DATABASE_ID;

if (!NOTION_TOKEN) {
  logger.error("NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!DATABASE_ID) {
  logger.error("MEAL_PLANNER_DATABASE_ID is not defined");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);

// Format date as "Mon 1 Jan"
const formatDayName = (date: Date): string => {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const day = dayNames[date.getDay()];
  const month = monthNames[date.getMonth()];
  const dateNum = date.getDate();
  
  return `${day} ${dateNum} ${month}`;
};

// Get date string in ISO format (YYYY-MM-DD)
const toISODate = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

// Parse existing meal plan pages
const parseExistingPages = (pages: PageObjectResponse[]): MealPlanDay[] => {
  return pages
    .map((page) => {
      const nameProperty = page.properties.Name;
      const dateProperty = page.properties.Date;

      if (nameProperty?.type !== "title" || dateProperty?.type !== "date") {
        return null;
      }

      const name = nameProperty.title[0]?.plain_text || "";
      const date = dateProperty.date?.start || "";

      return { id: page.id, name, date };
    })
    .filter((day): day is MealPlanDay => day !== null && day.date !== "");
};

// Get today at midnight
const getToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

// Add days to a date
const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Generate date range for the meal plan window
const generateDateRange = (startDate: Date, days: number): Date[] => {
  const dates: Date[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(addDays(startDate, i));
  }
  return dates;
};

// Delete pages older than today
const deleteOldPages = async (existingDays: MealPlanDay[]): Promise<number> => {
  const today = toISODate(getToday());
  const oldPages = existingDays.filter((day) => day.date < today);

  for (const page of oldPages) {
    await notion.pages.update({
      page_id: page.id,
      archived: true,
    });
    logger.info("Deleted old meal plan day", { name: page.name, date: page.date });
  }

  return oldPages.length;
};

// Create missing pages
const createMissingPages = async (
  existingDays: MealPlanDay[],
  targetDates: Date[]
): Promise<number> => {
  const existingDateSet = new Set(existingDays.map((day) => day.date));
  let created = 0;

  for (const date of targetDates) {
    const isoDate = toISODate(date);
    
    if (!existingDateSet.has(isoDate)) {
      await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: {
          Name: {
            title: [
              {
                text: {
                  content: formatDayName(date),
                },
              },
            ],
          },
          Date: {
            date: {
              start: isoDate,
            },
          },
        },
      });
      
      logger.info("Created meal plan day", { name: formatDayName(date), date: isoDate });
      created++;
    }
  }

  return created;
};

// Update names for existing pages that might be incorrectly formatted
const updatePageNames = async (existingDays: MealPlanDay[]): Promise<number> => {
  let updated = 0;

  for (const day of existingDays) {
    const date = new Date(day.date + "T00:00:00");
    const correctName = formatDayName(date);

    if (day.name !== correctName) {
      await notion.pages.update({
        page_id: day.id,
        properties: {
          Name: {
            title: [
              {
                text: {
                  content: correctName,
                },
              },
            ],
          },
        },
      });
      
      logger.info("Updated meal plan day name", { 
        oldName: day.name, 
        newName: correctName, 
        date: day.date 
      });
      updated++;
    }
  }

  return updated;
};

const run = async () => {
  logger.info("Fetching meal plan pages from database...");
  const pages = await getAllPages(DATABASE_ID, NOTION_TOKEN);

  const existingDays = parseExistingPages(
    pages.filter((p): p is PageObjectResponse => "properties" in p)
  );

  logger.info("Current meal plan days", { count: existingDays.length });

  // Delete old pages (before today)
  const deletedCount = await deleteOldPages(existingDays);
  if (deletedCount > 0) {
    logger.success("Deleted old days", { count: deletedCount });
  }

  // Get remaining pages after deletion
  const remainingDays = existingDays.filter((day) => day.date >= toISODate(getToday()));

  // Generate target date range (today + next 27 days = 28 days total)
  const today = getToday();
  const targetDates = generateDateRange(today, MEAL_PLANNER_WINDOW_DAYS);

  // Create missing pages
  const createdCount = await createMissingPages(remainingDays, targetDates);
  if (createdCount > 0) {
    logger.success("Created missing days", { count: createdCount });
  }

  // Update incorrectly formatted names
  const updatedCount = await updatePageNames(remainingDays);
  if (updatedCount > 0) {
    logger.success("Updated day names", { count: updatedCount });
  }

  if (deletedCount === 0 && createdCount === 0 && updatedCount === 0) {
    logger.info("Meal planner is up to date - no changes needed");
  } else {
    logger.success("Meal planner maintenance complete", {
      deleted: deletedCount,
      created: createdCount,
      updated: updatedCount,
    });
  }
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}