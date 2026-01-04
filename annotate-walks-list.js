import { Client } from "@notionhq/client";
import { GoogleGenAI } from "@google/genai";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ai = new GoogleGenAI({});
const PAGE_ID = process.env.NOTION_PAGE_ID;
const HOME_LOCATION = process.env.HOME_LOCATION;

if (!PAGE_ID) {
  console.error("ERROR: WALKS_PAGE_ID is not defined");
  process.exit(1);
}

if (!HOME_LOCATION) {
  console.error("ERROR: HOME_LOCATION is not defined");
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

const isEligibleWalk = (block) => {
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

const extractDistance = (text) => {
  const milesMatch = text.match(/(\d+(?:\.\d+)?)\s*miles?/i);
  if (milesMatch) return Number.parseFloat(milesMatch[1]);
  
  const kmMatch = text.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (kmMatch) return Number.parseFloat(kmMatch[1]) * 0.621371;
  
  return 999;
};

const annotateWalk = async (block) => {
  const walk = extractText(block);

  const prompt = `
You are annotating a walking location for someone who lives in ${HOME_LOCATION}.

Walk: "${walk}"

Add EXACTLY six markdown sub-bullets in this order:

- Distance from home:
- Transport:
- Day trip:
- Parking:
- Walk length:
- Pubs:

Rules:
- Distance: Give driving distance in miles from ${HOME_LOCATION}
- Transport: State if accessible by train or if car is necessary. If by train, mention the station name
- Day trip: State if feasible as a day trip or if overnight stay recommended
- Parking: Provide parking details (car parks, costs, or street parking availability)
- Walk length: Estimated walk distance/duration if it's a known trail
- Pubs: Mention any pubs on the walk route or nearby
- Keep each bullet under 15 words
- Be specific and factual
- Output markdown sub-bullets ONLY
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  const text = response.text;
  const lines = text.split("\n").filter(Boolean);

  if (lines.length === 0) {
    console.log(`Skipped ${walk}: AI returned nothing`);
    return { block, distance: 999 };
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

  const distance = extractDistance(text);
  console.log(`✓ Annotated: ${walk} (${distance} miles)`);
  
  return { block, distance };
};

const reorderBlocks = async (blocksWithDistances) => {
  const sorted = blocksWithDistances.sort((a, b) => a.distance - b.distance);
  
  console.log("\nReordering walks by distance...");
  
  for (const { block } of sorted) {
    await notion.blocks.delete({ block_id: block.id });
    await delay(100);
  }
  
  for (const { block } of sorted) {
    const children = await notion.blocks.children.list({ block_id: block.id });
    
    const newBlock = await notion.blocks.children.append({
      block_id: PAGE_ID,
      children: [{
        type: "to_do",
        to_do: {
          rich_text: block.to_do.rich_text,
          checked: block.to_do.checked,
          color: block.to_do.color
        }
      }]
    });
    
    if (children.results.length > 0) {
      await notion.blocks.children.append({
        block_id: newBlock.results[0].id,
        children: children.results.map(child => ({
          type: child.type,
          [child.type]: child[child.type]
        }))
      });
    }
    
    await delay(200);
  }
  
  console.log("✓ Walks reordered by distance");
};

const run = async () => {
  console.log("Fetching all blocks from page...");
  const allBlocks = await getAllBlocks(PAGE_ID);
  
  const eligibleBlocks = allBlocks.filter(isEligibleWalk);
  console.log(`Found ${eligibleBlocks.length} unchecked walk items without annotations\n`);

  if (eligibleBlocks.length === 0) {
    console.log("No items need annotation. All done!");
    return;
  }

  const blocksWithDistances = [];
  
  for (const block of eligibleBlocks) {
    const result = await annotateWalk(block);
    blocksWithDistances.push(result);
    await delay(2000);
  }

  console.log("\n✓ Walk annotation complete");
  
  await reorderBlocks(blocksWithDistances);
  
  console.log("\n✓ All done!");
};

try {
  await run();
} catch (err) {
  console.error("Unexpected error:", err);
  process.exit(1);
}