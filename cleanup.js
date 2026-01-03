import { Client } from "@notionhq/client";

// Read secrets from environment variables
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.NOTION_PAGE_ID;

async function deleteCheckedTodos(parentBlockId) {
  try {
    let cursor = undefined;
    const allBlocks = [];

    // First, get all blocks
    do {
      const response = await notion.blocks.children.list({
        block_id: parentBlockId,
        start_cursor: cursor,
        page_size: 100
      });

      allBlocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    // Delete checked to-dos
    for (const block of allBlocks) {
      if (block.type === "to_do" && block.to_do.checked) {
        await notion.blocks.delete({ block_id: block.id });
        const textContent = block.to_do.text?.map(t => t.plain_text).join(" ") || "<empty>";
        console.log(`Deleted: ${textContent}`);
      }

      // Recursively process nested blocks
      if (block.has_children) {
        await deleteCheckedTodos(block.id);
      }
    }

    // Check each h2 heading to see if it's followed by any to-dos
    for (let i = 0; i < allBlocks.length; i++) {
      const block = allBlocks[i];
      
      if (block.type === "heading_2") {
        // Check if this heading was deleted (if it was a to-do)
        if (block.type === "to_do" && block.to_do?.checked) continue;
        
        // Look at the next block
        const nextBlock = allBlocks[i + 1];
        
        // If next block is another heading or doesn't exist, this section is empty
        const isNextBlockHeading = nextBlock && (nextBlock.type === "heading_1" || nextBlock.type === "heading_2" || nextBlock.type === "heading_3");
        const hasNoNextBlock = !nextBlock;
        
        if (isNextBlockHeading || hasNoNextBlock) {
          // Add an empty to-do after this heading
          await notion.blocks.children.append({
            block_id: parentBlockId,
            children: [
              {
                type: "to_do",
                to_do: {
                  rich_text: [],
                  checked: false
                }
              }
            ],
            after: block.id
          });
          const blockText = block.heading_2?.rich_text?.map(t => t.plain_text).join(" ") || "section";
          console.log(`Added empty to-do under: ${blockText}`);
        }
      }
    }
  } catch (error) {
    console.error("Error deleting checked todos:", error);
  }
}

console.log("Starting nightly shopping list cleanup...");
await deleteCheckedTodos(pageId);
console.log("Cleanup complete!");