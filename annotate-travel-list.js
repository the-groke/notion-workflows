import { Client } from "@notionhq/client";
import OpenAI from "openai";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PAGE_ID = process.env.TRAVEL_LIST_PAGE_ID

async function getBlocks(blockId) {
  const res = await notion.blocks.children.list({ block_id: blockId });
  return res.results;
}

function isEligiblePlace(block) {
  return (
    block.type === "to_do" &&
    !block.to_do.checked &&
    !block.has_children &&
    block.to_do.rich_text.length > 0
  );
}

function extractText(block) {
  return block.to_do.rich_text.map(t => t.plain_text).join("").trim();
}

async function annotatePlace(block) {
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

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2
  });

  const lines = response.choices[0].message.content
    .split("\n")
    .filter(Boolean);

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

  console.log(`Annotated: ${place}`);
}

async function run() {
  const blocks = await getBlocks(PAGE_ID);

  for (const block of blocks) {
    if (isEligiblePlace(block)) {
      await annotatePlace(block);
    }
  }

  console.log("Travel annotation complete");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
