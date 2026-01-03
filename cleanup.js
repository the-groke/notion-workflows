import { Client } from "@notionhq/client";

// Read secrets from environment variables
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.NOTION_PAGE_ID;

const getAllBlocks = async (parentBlockId) => {
  const allBlocks = [];
  let cursor;

  do {
    const response = await notion.blocks.children.list({
      block_id: parentBlockId,
      start_cursor: cursor,
      page_size: 100
    });

    allBlocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return allBlocks;
};

const deleteCheckedTodoBlock = async (block) => {
  if (block.type !== "to_do" || !block.to_do.checked) {
    return false;
  }

  await notion.blocks.delete({ block_id: block.id });
  const textContent = block.to_do.text?.map(t => t.plain_text).join(" ") || "<empty>";
  console.log(`Deleted: ${textContent}`);
  return true;
};

const processNestedBlocks = async (block) => {
  if (block.has_children) {
    await deleteCheckedTodos(block.id);
  }
};

const hasTodoAfterHeading = (allBlocks, headingIndex) => {
  let j = headingIndex + 1;

  while (j < allBlocks.length) {
    const nextBlock = allBlocks[j];

    if (nextBlock.type === "paragraph") {
      j++;
      continue;
    }

    if (nextBlock.type === "to_do") {
      return true;
    }

    if (nextBlock.type.startsWith("heading_")) {
      return false;
    }

    return false;
  }

  return false;
};

const addEmptyTodoAfterHeading = async (parentBlockId, headingBlock) => {
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
    after: headingBlock.id
  });

  const blockText = headingBlock.heading_2?.rich_text?.map(t => t.plain_text).join(" ") || "section";
  console.log(`Added empty to-do under: ${blockText}`);
};

const processEmptyHeadings = async (parentBlockId, allBlocks) => {
  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i];

    if (block.type === "heading_2") {
      const foundTodo = hasTodoAfterHeading(allBlocks, i);

      if (!foundTodo) {
        await addEmptyTodoAfterHeading(parentBlockId, block);
      }
    }
  }
};

const deleteCheckedTodos = async (parentBlockId) => {
  try {
    const allBlocks = await getAllBlocks(parentBlockId);

    for (const block of allBlocks) {
      await deleteCheckedTodoBlock(block);
      await processNestedBlocks(block);
    }

    await processEmptyHeadings(parentBlockId, allBlocks);
  } catch (error) {
    console.error("Error deleting checked todos:", error);
  }
};

console.log("Starting nightly shopping list cleanup...");
await deleteCheckedTodos(pageId);
console.log("Cleanup complete!");