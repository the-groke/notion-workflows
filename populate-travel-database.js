import { Client } from "@notionhq/client";
import { GoogleGenAI } from "@google/genai";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ai = new GoogleGenAI({});
const DATABASE_ID = process.env.TRAVEL_DATABASE_ID;

if (!DATABASE_ID) {
  console.error("ERROR: TRAVEL_DATABASE_ID is not defined");
  process.exit(1);
}

/* ----------------------------- Notion helpers ----------------------------- */

const getAllPages = async () => {
  const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to query database: ${error.message}`);
  }
  
  const data = await response.json();
  console.log(`Found ${data.results.length} pages in database`);
  return data.results;
};

const isEmpty = (property) => {
  if (!property) return true;
  if (property.rich_text) return property.rich_text.length === 0;
  if (property.select) return !property.select;
  if (property.multi_select) return property.multi_select.length === 0;
  return true;
};

const isEligiblePlace = (page) => {
  const p = page.properties;
  return (
    isEmpty(p["Typical stay length"]) ||
    isEmpty(p["Best season"]) ||
    isEmpty(p["Known for"]) ||
    isEmpty(p["Typical activities"]) ||
    isEmpty(p["Flights from"]) ||
    isEmpty(p["Transport information"])
  );
};

const extractPlaceName = (page) => {
  const title = page.properties?.Name?.title;
  return title?.length ? title[0].plain_text : "Unnamed Place";
};

/* ----------------------------- Parsing helpers ----------------------------- */

const extractText = (text, regex) =>
  text.match(regex)?.[1]?.trim() ?? "";

const parseSection = (section) => ({
  stayLength: extractText(section, /Typical stay length:\s*(.+?)(?=\n|$)/i),
  bestSeason: extractText(section, /Best season:\s*(.+?)(?=\n|$)/i),
  knownFor: extractText(section, /Known for:\s*(.+?)(?=\n|$)/i),
  activities: extractText(section, /Typical activities:\s*(.+?)(?=\n|$)/i),
  flights: extractText(section, /Flights from:\s*(.+?)(?=\n|$)/i),
  transportInfo: extractText(section, /Transport information:\s*(.+?)(?=\n|$)/i),
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
    ["Typical stay length", data.stayLength, v => ({ rich_text: [{ text: { content: v } }] })],
    ["Best season", data.bestSeason, v => ({ select: { name: v } })],
    ["Known for", data.knownFor, v => ({ rich_text: [{ text: { content: v } }] })],
    ["Typical activities", data.activities, v => ({ multi_select: parseMultiSelect(v) })],
    ["Flights from", data.flights, v => ({ multi_select: parseMultiSelect(v) })],
    ["Transport information", data.transportInfo, v => ({ rich_text: [{ text: { content: v } }] })],
  ];

  return fields.reduce((updates, [key, value, builder]) => {
    if (isEmpty(props[key]) && value) {
      updates[key] = builder(value);
    }
    return updates;
  }, {});
};

/* ----------------------------- Prompt builder ------------------------------ */

const buildPrompt = (places) => `
You are annotating personal travel destination list items.

Rules:
- Typical stay length: How long people typically spend (e.g., "3-5 days", "1 week", "Long weekend")
- Best season: Choose ONE from: Spring, Summer, Autumn, Winter, Year-round
- Known for: What the place is famous for or notable attractions
- Typical activities: Comma-separated list of activities (e.g., Hiking, Kayaking, Skiing, Sightseeing, Beach, Culture, Food, Shopping)
- Flights from: Comma-separated list from ONLY: London, Leeds, Manchester (only include if direct flights exist)
- Transport information: Detailed flight info prioritizing Leeds > Manchester > London. Specify:
  * If no direct flights from Leeds, mention this and give Manchester/London alternatives
  * If flights are seasonal (e.g., Leeds to Iceland summer only), specify when available
  * If no direct flights exist (e.g., Cappadocia), explain connection options like "Fly to Istanbul from Leeds/Manchester/London, then 1-hour flight or 10-hour bus to Cappadocia"
  * Keep under 50 words
- Keep concise and factual

Places to annotate:
${places.map((p, i) => `${i + 1}. ${p}`).join("\n")}

IMPORTANT: Format your response EXACTLY like this:

### Place 1
Typical stay length: 3-5 days
Best season: Summer
Known for: Stunning fjords and northern lights
Typical activities: Hiking, Kayaking, Sightseeing
Flights from: London, Manchester
Transport information: Direct flights from Manchester and London year-round. No direct flights from Leeds; connect via Manchester (1h 30m).

### Place 2
Typical stay length: 1 week
Best season: Year-round
Known for: Beautiful beaches and wine
Typical activities: Beach, Food, Sightseeing
Flights from: London
Transport information: No direct flights from Leeds or Manchester. Fly from London Gatwick (2h 30m) or connect via Lisbon.

(Continue for all places using ### Place N format)
`;

/* ----------------------------- Place updater -------------------------------- */

const updatePlace = async (page, section, name) => {
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
    `✓ Updated ${Object.keys(updates).length} fields for: ${name}`
  );
};

/* --------------------------- Main annotation flow --------------------------- */

const annotateAllPlaces = async (pages) => {
  const places = pages.map(extractPlaceName);
  const prompt = buildPrompt(places);

  console.log("\nAnnotating all places in one API call...");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  console.log("\n--- AI Response ---");
  console.log(response.text);
  console.log("--- End Response ---\n");

  const sections = response.text
    .split(/###\s*(?:Place\s*)?\d+\.?\s*/i)  // Matches both "### Place 1" and "### 1."
    .filter(Boolean);
  
  console.log(`Parsed ${sections.length} sections from response`);

  for (let i = 0; i < pages.length; i++) {
    await updatePlace(pages[i], sections[i], places[i]);
  }
};

/* --------------------------------- Runner ---------------------------------- */

const run = async () => {
  console.log("Fetching all pages from database...");
  const pages = await getAllPages();

  console.log(`\nTotal pages retrieved: ${pages.length}`);

  const eligible = pages.filter(isEligiblePlace);
  console.log(`Found ${eligible.length} place items with empty fields\n`);

  if (!eligible.length) {
    console.log("No items need annotation. All done!");
    return;
  }

  await annotateAllPlaces(eligible);

  console.log("\n✓ Place annotation complete");
};

try {
  await run();
} catch (err) {
  console.error("Unexpected error:", err);
  console.error("Stack:", err.stack);
  process.exit(1);
}