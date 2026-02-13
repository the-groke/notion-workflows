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

// Parse station coordinates from STATION_WAYPOINT
// Expected format: "lat,lng" or a location name we'll need to geocode
const parseStationCoordinates = async (): Promise<{ lat: number; lon: number }> => {
  // Try parsing as coordinates first
  const coords = STATION_WAYPOINT.split(',').map(s => parseFloat(s.trim()));
  if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
    return { lat: coords[0], lon: coords[1] };
  }
  
  // If not coordinates, we need to geocode the station name
  // Using Nominatim (OpenStreetMap's free geocoding service)
  logger.info(`Geocoding station: ${STATION_WAYPOINT}`);
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(STATION_WAYPOINT)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'PubCrawlOptimizer/1.0' } }
  );
  
  const results = await response.json();
  if (!results || results.length === 0) {
    throw new Error(`Could not geocode station: ${STATION_WAYPOINT}`);
  }
  
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
};

// Calculate distance between two coordinates using Haversine formula
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // Earth's radius in metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in metres
};

interface PubWithCoords {
  page: PageObjectResponse;
  name: string;
  location: string;
  lat: number;
  lon: number;
}

interface RouteResult {
  pub: PubWithCoords;
  distanceFromStation: number;
  routeOrder: number;
}

// Nearest Neighbor algorithm to find optimal route
const optimizeRoute = (
  stationCoords: { lat: number; lon: number },
  pubs: PubWithCoords[]
): RouteResult[] => {
  const unvisited = [...pubs];
  const route: RouteResult[] = [];
  let current = stationCoords;
  let order = 1;

  logger.info("Optimizing route using Nearest Neighbor algorithm...");

  while (unvisited.length > 0) {
    // Find nearest unvisited pub
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = calculateDistance(
        current.lat,
        current.lon,
        unvisited[i].lat,
        unvisited[i].lon
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const nearest = unvisited.splice(nearestIdx, 1)[0];
    
    // Calculate distance from station (not from previous pub)
    const distanceFromStation = calculateDistance(
      stationCoords.lat,
      stationCoords.lon,
      nearest.lat,
      nearest.lon
    );
    
    route.push({
      pub: nearest,
      distanceFromStation: Math.round(distanceFromStation),
      routeOrder: order++
    });
    
    logger.info(`  ${order - 1}. ${nearest.name} (${Math.round(nearestDist)}m from previous)`);
    
    current = { lat: nearest.lat, lon: nearest.lon };
  }

  const totalDistance = route.reduce((sum, r, i) => {
    if (i === 0) return sum;
    const prev = route[i - 1];
    return sum + calculateDistance(prev.pub.lat, prev.pub.lon, r.pub.lat, r.pub.lon);
  }, calculateDistance(stationCoords.lat, stationCoords.lon, route[0].pub.lat, route[0].pub.lon));

  logger.success(`Total crawl distance: ${Math.round(totalDistance)}m`);

  return route;
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

// Generate Google Maps route URL and update the page
const updatePageWithRoute = async (route: RouteResult[]): Promise<void> => {
  if (route.length === 0) {
    logger.warn("No pubs in route");
    return;
  }

  // Use the official Google Maps URL API format
  // First waypoint is origin, last is destination, rest are waypoints
  const origin = `${route[0].pub.lat},${route[0].pub.lon}`;
  const destination = route.length > 1 
    ? `${route[route.length - 1].pub.lat},${route[route.length - 1].pub.lon}`
    : origin;
  
  // Middle waypoints (if any)
  const waypoints = route.length > 2
    ? route.slice(1, -1).map(r => `${r.pub.lat},${r.pub.lon}`).join("|")
    : "";
  
  // Build URL using Google Maps URL API format
  let routeUrl = `https://www.google.com/maps/dir/?api=1&origin=${STATION_WAYPOINT}&destination=${destination}&travelmode=walking`;
  
  if (waypoints) {
    routeUrl += `&waypoints=${waypoints}`;
  }

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

  if (allPubs.length === 0) {
    logger.warn("No pubs found in database");
    return;
  }

  // Get station coordinates
  const stationCoords = await parseStationCoordinates();
  logger.success(`Station coordinates: ${stationCoords.lat}, ${stationCoords.lon}`);

  // Extract coordinates from Place properties
  logger.info("Extracting pub locations from Notion Place properties...");
  const pubsWithCoords: PubWithCoords[] = [];
  
  for (const page of allPubs) {
    const nameProperty = page.properties.Pub;
    const locationProperty = page.properties.Location;
    
    const name = nameProperty?.type === "title" 
      ? nameProperty.title[0]?.plain_text || ""
      : "";
    
    if (!name) {
      logger.warn("Skipping pub with no name");
      continue;
    }

    // Extract coordinates from Place property
    if (locationProperty?.type === "place" && locationProperty.place) {
      const place = locationProperty.place;
      
      if (place.lat && place.lon) {
        const locationName = place.name || place.address || name;
        
        pubsWithCoords.push({
          page,
          name,
          location: locationName,
          lat: place.lat,
          lon: place.lon
        });
        
        logger.info(`  ✓ ${name}: ${locationName}`);
      } else {
        logger.warn(`  ✗ ${name}: Place property missing coordinates`);
      }
    } else {
      logger.warn(`  ✗ ${name}: No Place property found`);
    }
  }

  logger.success(`Successfully extracted ${pubsWithCoords.length}/${allPubs.length} pub locations`);

  if (pubsWithCoords.length === 0) {
    logger.error("No pubs with Place properties containing coordinates. Cannot calculate route.");
    logger.info("Make sure your pubs have a 'Location' property of type 'Place' with coordinates set.");
    return;
  }

  // Calculate optimal route
  const route = optimizeRoute(stationCoords, pubsWithCoords);

  // Update Notion pages with route order and distance
  logger.info("Updating Notion pages with route information...");
  for (const { pub, distanceFromStation, routeOrder } of route) {
    await updatePage(notion, pub.page.id, {
      "Route order": { number: routeOrder },
      "Distance from station (metres)": { number: distanceFromStation }
    });
    logger.info(`  Updated ${pub.name}: order ${routeOrder}, ${distanceFromStation}m from station`);
  }

  logger.success("All pub pages updated");

  // Update the route map on the page
  logger.info("Updating pub crawl route map...");
  await updatePageWithRoute(route);
  
  logger.success("✓ Done! Check your Notion page for the complete route map.");
};

try {
  await run();
} catch (err) {
  logger.error("Unexpected error", err instanceof Error ? err : undefined);
  process.exit(1);
}