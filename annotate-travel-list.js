import { Client } from "@notionhq/client";
import { GoogleGenAI } from "@google/genai";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ai = new GoogleGenAI({});
const PAGE_ID = process.env.NOTION_PAGE_ID;

if (!PAGE_ID) {
  console.error("ERROR: NOTION_PAGE_ID is not defined");
  process.exit(1);
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getAllBlocks = async (blockId, allBlocks = []) => {
  const res = await notion.blocks.children.list({ block_id: blockId });
  
  for (const block of res.results) {
    allBlocks.push(block);
    
    if (block.has_children) {
      await getAllBlocks(block.id, allBlocks);
    }
  }
  
  return allBlocks;
};

const isEligiblePlace = (block) => {
  return (
    block.type === "to_do" &&
    !block.to_do.checked &&
    block.to_do.rich_text.length > 0 &&
    !block.has_children
  );
};

const extractText = (block) => {
  return block.to_do.rich_text.map(t => t.plain_text).join("").trim();
};

const annotateAllPlaces = async (blocks) => {
  const places = blocks.map(extractText);
  
  const prompt = `
You are annotating personal travel list items.

For each place below, provide EXACTLY five markdown sub-bullets in this order:
- Best season:
- Typical stay:
- Known for:
- Typical activities:
- Flights from:

Rules:
- Neutral, factual language only
- Each bullet under 12 words
- Activities should be general
- Flights from ONLY Leeds, Manchester, or London
- If none exist say: "No direct flights from Leeds, Manchester, or London"

Places to annotate:
${places.map((place, i) => `${i + 1}. ${place}`).join('\n')}

Format your response as:

### Place 1
- Best season: ...
- Typical stay: ...
- Known for: ...
- Typical activities: ...
- Flights from: ...

### Place 2
- Best season: ...
(etc)
`;

  console.log("Annotating all places in one API call...");
  
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  const text = response.text;
  
  // Split response by place sections
  const sections = text.split(/###\s*Place\s*\d+/i).filter(Boolean);
  
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const place = places[i];
    const section = sections[i];
    
    if (!section) {
      console.log(`⚠ No data for: ${place}`);
      continue;
    }
    
    const lines = section
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("-"));
    
    if (lines.length === 0) {
      console.log(`⚠ No bullets for: ${place}`);
      continue;
    }
    
    const children = lines.map(line => ({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [{ type: "text", text: { content: line.replace(/^-\s*/, "") } }]
      }
    }));
    
    await notion.blocks.children.append({
      block_id: block.id,
      children
    });
    
    console.log(`✓ Annotated: ${place}`);
    await delay(100); // Small delay between Notion writes
  }
};

const run = async () => {
  console.log("Fetching all blocks from page...");
  const allBlocks = await getAllBlocks(PAGE_ID);
  
  const eligibleBlocks = allBlocks.filter(isEligiblePlace);
  console.log(`Found ${eligibleBlocks.length} unchecked to-do items without annotations\n`);

  if (eligibleBlocks.length === 0) {
    console.log("No items need annotation. All done!");
    return;
  }

  await annotateAllPlaces(eligibleBlocks);

  console.log("\n✓ Travel annotation complete");
};

try {
  await run();
} catch (err) {
  console.error("Unexpected error:", err);
  process.exit(1);
}