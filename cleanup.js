const { Client } = require("@notionhq/client");

// Read secrets from environment variables
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.NOTION_PAGE_ID;

async function deleteCheckedTodos(parentBlockId) {
  try {
    let cursor = undefined;
    const blocksToCheck = [];

    do {
      const response = await notion.blocks.children.list({
        block_id: parentBlockId,
        start_cursor: cursor,
        page_size: 100
      });

      for (const block of response.results) {
        // Track blocks that might need empty to-dos added
        if (block.type === "heading_2" || block.type === "heading_3") {
          blocksToCheck.push(block);
        }

        // Delete checked to-dos
        if (block.type === "to_do" && block.to_do.checked) {
          await notion.blocks.delete({ block_id: block.id });
          const textContent = block.to_do.text?.map(t => t.plain_text).join(" ") || "<empty>";
          console.log(`Deleted: ${textContent}`);
        }

        // Recursively process children
        if (block.has_children) {
          await deleteCheckedTodos(block.id);
        }
      }

      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    // After processing all blocks, check headings for empty sections
    for (const block of blocksToCheck) {
      const children = await notion.blocks.children.list({
        block_id: block.id,
        page_size: 1
      });

      if (children.results.length === 0) {
        await notion.blocks.children.append({
          block_id: block.id,
          children: [
            {
              type: "to_do",
              to_do: {
                rich_text: [],
                checked: false
              }
            }
          ]
        });
        const blockText = block[block.type]?.rich_text?.map(t => t.plain_text).join(" ") || "section";
        console.log(`Added empty to-do under: ${blockText}`);
      }
    }
  } catch (error) {
    console.error("Error deleting checked todos:", error);
  }
}

(async () => {
  console.log("Starting nightly shopping list cleanup...");
  await deleteCheckedTodos(pageId);
  console.log("Cleanup complete!");
})();