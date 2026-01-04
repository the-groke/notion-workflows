import { Client } from "@notionhq/client";
import { GoogleGenAI } from "@google/genai";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ai = new GoogleGenAI({});
const DATABASE_ID = process.env.WALKS_DATABASE_ID;
const HOME_LOCATION = process.env.HOME_LOCATION;

if (!DATABASE_ID) {
  console.error("ERROR: WALKS_DATABASE_ID is not defined");
  process.exit(1);
}

if (!HOME_LOCATION) {
  console.error("ERROR: HOME_LOCATION is not defined");
  process.exit(1);
}

/* ----------------------------- Notion helpers ----------------------------- */

const getAllPages = async () => {
  // Use the databases.query method instead of request
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
  });
  
  console.log(`Found ${response.results.length} pages in database`);
  return response.results;
};

const isEmpty = (property) => {
  if (!property) return true;
  if (property.number !== undefined) return property.number === null;
  if (property.rich_text) return property.rich_text.length === 0;
  if (property.multi_select) return property.multi_select.length === 0;
  return true;
};

const isEligibleWalk = (page) => {
  const p = page.properties;
  return (
    isEmpty(p["Distance from home"]) ||
    isEmpty(p["Transport options"]) ||
    isEmpty(p["Type"]) ||
    isEmpty(p["Parking"]) ||
    isEmpty(p["Routes"]) ||
    isEmpty(p["Terrain"]) ||
    isEmpty(p["Pubs"])
  );
};

const extractWalkName = (page) => {
  const title = page.properties?.Name?.title;
  return title?.length ? title[0].plain_text : "Unnamed Walk";
};

/* ----------------------------- Parsing helpers ----------------------------- */

const extractText = (text, regex) =>
  text.match(regex)?.[1]?.trim() ?? "";

const extractNumber = (text, regex) =>
  text.match(regex) ? Number.parseFloat(RegExp.$1) : null;

const parseSection = (section) => ({
  distance: extractNumber(section, /Distance:\s*(\d+(?:\.\d+)?)/i),
  transport: extractText(section, /Transport:\s*(.+?)(?=\n|$)/i),
  type: extractText(section, /Type:\s*(.+?)(?=\n|$)/i),
  parking: extractText(section, /Parking:\s*(.+?)(?=\n|$)/i),
  routes: extractText(section, /Routes:\s*(.+?)(?=\n|$)/i),
  terrain: extractText(section, /Terrain:\s*(.+?)(?=\n|$)/i),
  pubs: extractText(section, /Pubs:\s*(.+?)(?=\n|$)/i),
});

const parseMultiSelect = (text) =>
  text
    .split(",")
    .map(t => t.trim())
    .filter(Boolean)
    .map(name => ({ name }));

/* --------------------------- Update construction --------------------------- */

const buildUpdates = (page, data) => {
  const props = page.properties;

  const fields = [
    ["Distance from home", data.distance, v => ({ number: v })],
    ["Transport options", data.transport, v => ({ multi_select: parseMultiSelect(v) })],
    ["Type", data.type, v => ({ multi_select: parseMultiSelect(v) })],
    ["Parking", data.parking, v => ({ rich_text: [{ text: { content: v } }] })],
    ["Routes", data.routes, v => ({ rich_text: [{ text: { content: v } }] })],
    ["Terrain", data.terrain, v => ({ multi_select: parseMultiSelect(v) })],
    ["Pubs", data.pubs, v => ({ rich_text: [{ text: { content: v } }] })],
  ];

  return fields.reduce((updates, [key, value, builder]) => {
    if (isEmpty(props[key]) && value) {
      updates[key] = builder(value);
    }
    return updates;
  }, {});
};

/* ----------------------------- Prompt builder ------------------------------ */

const buildPrompt = (walks) => `
You are annotating walking locations for someone who lives in ${HOME_LOCATION}.

Rules:
- Distance: Give ONLY the number of miles from ${HOME_LOCATION}
- Transport: Comma-separated list from: Train, Car, Bus
- Type: Choose "Day trip" or "Overnight"
- Parking: Parking details
- Routes: Route overview
- Terrain: Comma-separated list from: Seaside, Lake, Moorland, Mountains, Forest, Hills, Valley, Countryside
- Pubs: Nearby pubs
- Keep concise and factual

Walks to annotate:
${walks.map((w, i) => `${i + 1}. ${w}`).join("\n")}

Format:

### Walk 1
Distance: 45
Transport: Train, Car
Type: Day trip
Parking: Free village car park
Routes: Circular routes 5–12 miles
Terrain: Moorland, Hills
Pubs: The Buck Inn
`;

/* ----------------------------- Walk updater -------------------------------- */

const updateWalk = async (page, section, name) => {
  if (!section) {
    console.log(`⚠ No data for: ${name}`);
    return;
  }

  const parsed = parseSection(section);
  const updates = buildUpdates(page, parsed);

  if (!Object.keys(updates).length) {
    console.log(`⊘ Skipped ${name} - all fields already filled`);
    return;
  }

  await notion.pages.update({
    page_id: page.id,
    properties: updates,
  });

  console.log(
    `✓ Updated ${Object.keys(updates).length} fields for: ${name} (${parsed.distance ?? "?"} miles)`
  );
};

/* --------------------------- Main annotation flow --------------------------- */

const annotateAllWalks = async (pages) => {
  const walks = pages.map(extractWalkName);
  const prompt = buildPrompt(walks);

  console.log("\nAnnotating all walks in one API call...");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  const sections = response.text
    .split(/###\s*Walk\s*\d+/i)
    .filter(Boolean);

  for (let i = 0; i < pages.length; i++) {
    await updateWalk(pages[i], sections[i], walks[i]);
  }
};

/* --------------------------------- Runner ---------------------------------- */

const run = async () => {
  console.log("Fetching all pages from database...");
  const pages = await getAllPages();

  console.log(`\nTotal pages retrieved: ${pages.length}`);

  const eligible = pages.filter(isEligibleWalk);
  console.log(`Found ${eligible.length} walk items with empty fields\n`);

  if (!eligible.length) {
    console.log("No items need annotation. All done!");
    return;
  }

  await annotateAllWalks(eligible);

  console.log("\n✓ Walk annotation complete");
  console.log("💡 Sort by 'Distance from home' to see closest walks first.");
};

try {
  await run();
} catch (err) {
  console.error("Unexpected error:", err);
  console.error("Stack:", err.stack);
  process.exit(1);
}