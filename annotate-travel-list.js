import { Client } from "@notionhq/client";
import { GoogleGenerativeAI } from "@google/generative-ai";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" }); // Changed model name
const PAGE_ID = process.env.NOTION_PAGE_ID;

if (!PAGE_ID) {
  console.error("ERROR: NOTION_PAGE_ID is not defined");
  process.exit(1);
}

// Test API key
const testAPIKey = async () => {
  try {
    console.log("Testing Gemini API key...");
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
    });
    console.log("✓ API key works! Response:", result.response.text());
    console.log("");
  } catch (err) {
    console.error("✗ API key test failed:");
    console.error("Error code:", err.status);
    console.error("Error message:", err.message);
    console.error("Full error:", err);
    process.exit(1);
  }
};

// Helper to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Recursively fetch all blocks
const getAllBlocks = async (blockId, allBlocks = []) => {
  const res = await notion.blocks.children.list({ block_id: blockId });
  
  for (const block of res.results) {
    allBlocks.push(block);
    
    // If block has children, recursively fetch them
    if (block.has_children) {
      await getAllBlocks(block.id, allBlocks);
    }
  }
  
  return allBlocks;
};

// Only annotate unchecked to-do blocks that don't already have children
const isEligiblePlace = (block) => {
  return (
    block.type === "to_do" &&
    !block.to_do.checked &&
    block.to_do.rich_text.length > 0 &&
    !block.has_children  // Skip if already has AI-generated content
  );
};

const extractText = (block) => {
  return block.to_do.rich_text.map(t => t.plain_text).join("").trim();
};

// Annotate one place, with quota / rate-limit handling
const annotatePlace = async (block) => {
  const place = extractText(block);

  const prompt = `
You are annotating a personal travel list item.

Place: "${place}"

Add EXACTLY five markdown sub-bullets in this order:

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
- If none exist say:
  "No direct flights from Leeds, Manchester, or London"
- Output markdown sub-bullets ONLY
`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 500,
      },
    });

    const response = result.response;
    const text = response.text();
    
    const lines = text
      .split("\n")
      .filter(Boolean);

    if (lines.length === 0) {
      console.log(`Skipped ${place}: AI returned nothing`);
      return;
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
  } catch (err) {
    console.error(`✗ Full error for "${place}":`, {
      status: err.status,
      message: err.message,
      code: err.code,
      details: err.details,
      stack: err.stack
    });
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

  for (const block of eligibleBlocks) {
    await annotatePlace(block);
    await delay(2000); // Wait 2 seconds between requests
  }

  console.log("\n✓ Travel annotation complete");
};

// Run with API key test first
await testAPIKey();
run().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});