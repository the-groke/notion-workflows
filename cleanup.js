const { Client } = require("@notionhq/client");

// Read secrets from environment variables
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.NOTION_PAGE_ID;

async function deleteCheckedTodos(parentBlockId) {
  try {
    let cursor = undefined;

    do {
      const response = await notion.blocks.children.list({
        block_id: parentBlockId,
        start_cursor: cursor,
        page_size: 100
      });

      for (const block of response.results) {
        if (block.type === "to_do" && block.to_do.checked) {
          await notion.blocks.delete({ block_id: block.id });
          const textContent = block.to_do.text?.map(t => t.plain_text).join(" ") || "<empty>";
          console.log(`Deleted: ${textContent}`);
        }

        if (block.has_children) {
          await deleteCheckedTodos(block.id);
        }
      }


      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.error("Error deleting checked todos:", error);
  }
}

(async () => {
  console.log("Starting nightly shopping list cleanup...");
  await deleteCheckedTodos(pageId);
  console.log("Cleanup complete!");
})();
