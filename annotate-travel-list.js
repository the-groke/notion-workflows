import { Client } from "@notionhq/client";
import { GoogleGenerativeAI } from "@google/generative-ai";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const PAGE_ID = process.env.NOTION_PAGE_ID;

if (!PAGE_ID) {
  console.error("ERROR: NOTION_PAGE_ID is not defined");
  process.exit(1);
}

// List available models
const listAvailableModels = async () => {
  try {
    console.log("Fetching available models...\n");
    const models = await genAI.listModels();
    
    console.log("Available models:");
    for (const model of models) {
      console.log(`- ${model.name}`);
      console.log(`  Supported methods: ${model.supportedGenerationMethods.join(", ")}`);
    }
    console.log("");
    
    return models;
  } catch (err) {
    console.error("Error listing models:", err);
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
    !block.has_children
  );
};

const extractText = (block) => {
  return block.to_do.rich_text.map(t => t.plain_text).join("").trim();
};

// Annotate one place
const annotatePlace = async (block, model) => {
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
    console.error(`✗ Error for "${place}":`, err.message);
  }
};

const run = async () => {
  // First, list available models
  const models = await listAvailableModels();
  
  // Find a model that supports generateContent
  const availableModel = models.find(m => 
    m.supportedGenerationMethods.includes("generateContent")
  );
  
  if (!availableModel) {
    console.error("No models support generateContent!");
    process.exit(1);
  }
  
  console.log(`Using model: ${availableModel.name}\n`);
  const model = genAI.getGenerativeModel({ model: availableModel.name });
  
  console.log("Fetching all blocks from page...");
  const allBlocks = await getAllBlocks(PAGE_ID);
  
  const eligibleBlocks = allBlocks.filter(isEligiblePlace);
  console.log(`Found ${eligibleBlocks.length} unchecked to-do items without annotations\n`);

  if (eligibleBlocks.length === 0) {
    console.log("No items need annotation. All done!");
    return;
  }

  for (const block of eligibleBlocks) {
    await annotatePlace(block, model);
    await delay(2000);
  }

  console.log("\n✓ Travel annotation complete");
};

run().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});