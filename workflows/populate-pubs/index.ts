import 'dotenv/config';
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Utils
import {
  createNotionClient,
  getAllPages,
  extractTitle,
  updatePage,
  getAllBlocks,
} from "utils/notion";
import { createAIClient, batchAnnotate, type AIClient } from "utils/ai";
import { logger } from "utils/logger";
// Config
import {
  type PubData,
} from "./config";
// Types
import type { PageObjectResponse, BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRIVATE_INTEGRATION_TOKEN = process.env.PRIVATE_INTEGRATION_TOKEN
const STATION_WAYPOINT = process.env.STATION_WAYPOINT;
const LOCATION = process.env.LOCATION;
const DATABASE_ID = process.env.PUBS_DATABASE_ID;
const PAGE_ID = process.env.PUBS_PAGE_ID;

if (!PRIVATE_INTEGRATION_TOKEN) {
  logger.error("PRIVATE_INTEGRATION_TOKEN is not defined");
  process.exit(1);
}

if (!DATABASE_ID) {
  logger.error("PUBS_DATABASE_ID is not defined");
  process.exit(1);
}

if (!PAGE_ID) {
  logger.error("PUBS_PAGE_ID is not defined");
  process.exit(1);
}

if (!STATION_WAYPOINT) {
  logger.error("STATION_WAYPOINT is not defined");
  process.exit(1);
}

if (!process.env.LOCATION) {
  logger.error("LOCATION is not defined");
  process.exit(1);
}

const notion = createNotionClient(PRIVATE_INTEGRATION_TOKEN);
const ai: AIClient = await createAIClient();

const buildPrompt = async (pubs: string[]): Promise<string> => {
  const promptTemplate = await readFile(
    join(__dirname, "prompt.md"),
    "utf-8"
  );
  const pubsList = pubs.map((p, i) => `${i + 1}. ${p}`).join("\n");
  // replace {{PUBS_LIST}} in the prompt with the actual list of pubs and {{LOCATION}} with the home location
  return promptTemplate
    .replace("{{PUBS_LIST}}", pubsList)
    .replace("{{LOCATION}}", LOCATION ?? "");
};

interface PubsResponse {
  pubs: PubData[];
}

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

const isValidPubsResponse = (obj: JsonValue): obj is PubsResponse => {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  
  const response = obj as Record<string, JsonValue>;
  if (!Array.isArray(response.pubs)) return false;
  
  return response.pubs.every((pub) => {
    if (typeof pub !== "object" || pub === null || Array.isArray(pub)) return false;
    const p = pub as Record<string, JsonValue>;
    return (
      typeof p.overview === "string" &&
      typeof p.distanceFromStation === "number" &&
      typeof p.routeOrder === "number"
    );
  });
};

const parseResponse = (json: JsonValue): PubData[] => {
  if (!isValidPubsResponse(json)) {
    throw new Error("Response missing 'pubs' array or invalid structure");
  }
  return json.pubs;
};

// Delete existing route blocks from the page
const deleteExistingRouteBlocks = async (): Promise<void> => {
  try {
    logger.info("Fetching existing blocks...");
    const blocks = await getAllBlocks(notion, PAGE_ID);
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      // Look for our route heading
      if ("type" in block && block.type === "heading_2" && "heading_2" in block) {
        const heading = (block as BlockObjectResponse & { type: "heading_2" }).heading_2;
        const headingText = heading.rich_text?.[0];
        
        if (headingText && "plain_text" in headingText && headingText.plain_text === "🗺️ Pub Crawl Route") {
          logger.info("Found existing route heading, deleting...");
          // Delete the heading
          await notion.blocks.delete({ block_id: block.id });
          
          // Delete the next block (should be the bookmark)
          if (i + 1 < blocks.length && "id" in blocks[i + 1]) {
            await notion.blocks.delete({ block_id: blocks[i + 1].id });
          }
          
          logger.info("Deleted existing route blocks");
          return;
        }
      }
    }
    
    logger.info("No existing route blocks found");
  } catch (error) {
    logger.error("Error in deleteExistingRouteBlocks:", error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
};

const run = async () => {
  logger.info("Fetching all pages from pubs database...");
  const pages = await getAllPages(DATABASE_ID, PRIVATE_INTEGRATION_TOKEN);

  logger.info("Pages retrieved", { count: pages.length });

  const allPubs = pages.filter((p): p is PageObjectResponse => "properties" in p);

  // Always recalculate route for ALL pubs
  logger.info("Recalculating optimal route for all pubs...");

  // Store the annotation data to use for route building
  const pubDataMap = new Map<string, PubData>();

  await batchAnnotate<PubData>(ai, {
    pages: allPubs,
    extractName: extractTitle,
    buildPrompt,
    parseResponse,
    buildUpdates: (page, data) => {
      // Store the data for route building later
      pubDataMap.set(page.id, data);
      
      // Force update route order and distance, only skip overview if already filled
      const props = page.properties;
      const updates: Record<string, unknown> = {};
      
      // Always update route order and distance
      updates["Route order"] = { number: data.routeOrder };
      updates["Distance from station (metres)"] = { number: data.distanceFromStation };
      
      // Only update overview if empty
      const overviewEmpty = props.Overview?.type === "rich_text" 
        && props.Overview.rich_text.length === 0;
      if (overviewEmpty) {
        updates["Overview"] = { rich_text: [{ text: { content: data.overview } }] };
      }
      
      return updates;
    },
    updatePage: async (page, updates) =>
      updatePage(notion, page.id, updates),
    itemType: "pub",
  });

  logger.success("Pubs completion complete");

  // Build route from the data we just calculated
  logger.info("Updating pub crawl route...");
  logger.info("Captured data for pubs:", { count: pubDataMap.size });
  
  const pubsForRoute = allPubs
    .map(page => {
      const data = pubDataMap.get(page.id);
      if (!data) {
        logger.warn("No data found for page:", { id: page.id });
        return null;
      }
      
      const nameProperty = page.properties.Name;
      const locationProperty = page.properties.Location;
      
      const name = nameProperty?.type === "title" 
        ? nameProperty.title[0]?.plain_text || ""
        : "";
      
      const location = locationProperty?.type === "rich_text"
        ? locationProperty.rich_text[0]?.plain_text || ""
        : "";
      
      logger.info("Processing pub for route:", { 
        name, 
        location, 
        routeOrder: data.routeOrder,
        hasName: !!name,
        hasLocation: !!location,
        routeOrderGreaterThanZero: data.routeOrder > 0
      });
      
      return {
        name,
        location: location || name,
        routeOrder: data.routeOrder
      };
    })
    .filter((p): p is { name: string; location: string; routeOrder: number } => {
      const isValid = p !== null && p.name !== "" && p.routeOrder > 0;
      if (p && !isValid) {
        logger.warn("Filtering out pub:", { pub: p, reason: !p.name ? "no name" : !p.routeOrder ? "no route order" : "route order <= 0" });
      }
      return isValid;
    })
    .sort((a, b) => a.routeOrder - b.routeOrder);

  logger.info("Pubs after filtering:", { count: pubsForRoute.length, pubs: pubsForRoute });

  if (pubsForRoute.length === 0) {
    logger.warn("No pubs with route order found");
  } else {
    const waypoints = pubsForRoute
      .map(p => encodeURIComponent(p.location))
      .join("/");
    
    const routeUrl = `https://www.google.com/maps/dir/${STATION_WAYPOINT}/${waypoints}`;
    
    logger.info("Generated route URL:", { url: routeUrl, length: routeUrl.length, pubCount: pubsForRoute.length });

    if (routeUrl.length > 2000) {
      logger.warn("Route URL is very long, it may not work properly:", { length: routeUrl.length });
    }

    await deleteExistingRouteBlocks();
    
    logger.info("Appending new blocks to page...", { pageId: PAGE_ID });
    await notion.blocks.children.append({
      block_id: PAGE_ID,
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: {
            rich_text: [{ type: "text", text: { content: "🗺️ Pub Crawl Route" } }]
          }
        },
        {
          object: "block",
          type: "bookmark",
          bookmark: {
            url: routeUrl
          }
        }
      ]
    });

    logger.success("Added Google Maps route to page");
  }
  
  logger.success("✓ Done! Check your Notion page for the complete route map.");
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}