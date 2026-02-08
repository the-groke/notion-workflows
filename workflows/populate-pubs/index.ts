import 'dotenv/config';
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
// Utils
import {
  createNotionClient,
  getAllPages,
  updatePage,
  getAllBlocks,
} from "utils/notion";
import { logger } from "utils/logger";
// Types
import type { PageObjectResponse, BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRIVATE_INTEGRATION_TOKEN = process.env.PRIVATE_INTEGRATION_TOKEN;
const STATION_WAYPOINT = process.env.STATION_WAYPOINT;
const LOCATION = process.env.LOCATION;
const DATABASE_ID = process.env.PUBS_DATABASE_ID;
const PAGE_ID = process.env.PUBS_PAGE_ID;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

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

if (!LOCATION) {
  logger.error("LOCATION is not defined");
  process.exit(1);
}

if (!GOOGLE_MAPS_API_KEY) {
  logger.error("GOOGLE_MAPS_API_KEY is not defined");
  process.exit(1);
}

const notion = createNotionClient(PRIVATE_INTEGRATION_TOKEN);

interface PubInfo {
  id: string;
  name: string;
  location: string;
  originalIndex: number;
}

interface GoogleMapsDirectionsResponse {
  routes: Array<{
    waypoint_order: number[];
    legs: Array<{
      distance: {
        value: number; // in metres
      };
    }>;
  }>;
  status: string;
}

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

// Optimize route using Google Maps Directions API
const optimizeRouteWithGoogle = async (pubs: PubInfo[]): Promise<{
  optimizedOrder: number[];
  distances: number[];
}> => {
  if (pubs.length === 0) {
    return { optimizedOrder: [], distances: [] };
  }

  // Google Maps API has a limit of 25 waypoints
  if (pubs.length > 25) {
    logger.warn(`Too many pubs (${pubs.length}). Google Maps API supports max 25 waypoints. Using first 25.`);
    pubs = pubs.slice(0, 25);
  }

  const waypoints = pubs.map(p => p.location).join('|');
  
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', STATION_WAYPOINT);
  url.searchParams.set('destination', STATION_WAYPOINT); // circular route back to station
  url.searchParams.set('waypoints', `optimize:true|${waypoints}`);
  url.searchParams.set('mode', 'walking');
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY!);

  logger.info("Calling Google Maps Directions API...");
  
  const response = await fetch(url.toString());
  const data: GoogleMapsDirectionsResponse = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Google Maps API error: ${data.status}`);
  }

  const route = data.routes[0];
  const optimizedOrder = route.waypoint_order;
  
  // Extract distances (first leg is from station to first pub)
  const distances = route.legs.map(leg => leg.distance.value);

  logger.success(`Route optimized! Order: ${optimizedOrder.map(i => pubs[i].name).join(' → ')}`);

  return { optimizedOrder, distances };
};

// Update Notion pages with route order and distances
const updatePubsWithRouteData = async (
  pubs: PubInfo[],
  optimizedOrder: number[],
  distances: number[]
): Promise<void> => {
  logger.info("Updating pub pages with route data...");

  for (let routeOrder = 0; routeOrder < optimizedOrder.length; routeOrder++) {
    const pubIndex = optimizedOrder[routeOrder];
    const pub = pubs[pubIndex];
    const distanceFromStation = distances[routeOrder]; // distance from previous waypoint

    const updates = {
      "Route order": { number: routeOrder + 1 }, // 1-indexed for humans
      "Distance from station (metres)": { number: distanceFromStation }
    };

    await updatePage(notion, pub.id, updates);
    
    logger.info(`Updated ${pub.name}: order=${routeOrder + 1}, distance=${distanceFromStation}m`);
  }

  logger.success("All pubs updated with route data");
};

// Generate Google Maps route URL and update the page
const updatePageWithRoute = async (pubs: PubInfo[], optimizedOrder: number[]): Promise<void> => {
  if (pubs.length === 0) {
    logger.warn("No pubs to create route");
    return;
  }

  const orderedPubs = optimizedOrder.map(i => pubs[i]);
  const waypoints = orderedPubs
    .map(p => encodeURIComponent(p.location))
    .join("/");
  
  const routeUrl = `https://www.google.com/maps/dir/${STATION_WAYPOINT}/${waypoints}`;

  // Delete old route blocks first
  await deleteExistingRouteBlocks();
  
  // Update page with embedded bookmark to Google Maps route
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
  logger.info("Route URL:", { url: routeUrl });
};

const run = async () => {
  logger.info("Fetching all pages from pubs database...");
  const pages = await getAllPages(DATABASE_ID, PRIVATE_INTEGRATION_TOKEN);

  logger.info("Pages retrieved", { count: pages.length });

  const allPubs = pages.filter((p): p is PageObjectResponse => "properties" in p);

  // Extract pub information
  const pubs: PubInfo[] = allPubs
    .map((page, index) => {
      const nameProperty = page.properties.Pub;
      const locationProperty = page.properties.Location;

      const name = nameProperty?.type === "title" 
        ? nameProperty.title[0]?.plain_text || ""
        : "";
      
      const location = locationProperty?.type === "rich_text"
        ? locationProperty.rich_text[0]?.plain_text || ""
        : "";

      return {
        id: page.id,
        name,
        location: location || name, // fallback to name if no specific location
        originalIndex: index
      };
    })
    .filter(p => p.name); // only include pubs with names

  if (pubs.length === 0) {
    logger.warn("No pubs found in database");
    return;
  }

  logger.info(`Found ${pubs.length} pubs, optimizing route...`);

  // Get optimized route from Google
  const { optimizedOrder, distances } = await optimizeRouteWithGoogle(pubs);

  // Update Notion pages with route data
  await updatePubsWithRouteData(pubs, optimizedOrder, distances);

  // Update the page with the route map
  logger.info("Updating pub crawl route map...");
  await updatePageWithRoute(pubs, optimizedOrder);
  
  logger.success("✓ Done! Check your Notion page for the complete route map.");
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}