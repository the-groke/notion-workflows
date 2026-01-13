// Utils
import { createNotionClient, getAllBlocks } from 'utils/notion';
// Types
import type {
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

type BlockResponse = BlockObjectResponse | PartialBlockObjectResponse;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const PAGE_ID = process.env.NOTION_PAGE_ID;

if (!NOTION_TOKEN) {
  console.error('ERROR: NOTION_TOKEN is not defined');
  process.exit(1);
}

if (!PAGE_ID) {
  console.error('ERROR: NOTION_PAGE_ID is not defined');
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);

const isToDoBlock = (
  block: BlockResponse
): block is BlockObjectResponse & { type: 'to_do' } => {
  return 'type' in block && block.type === 'to_do';
};

const isHeading2Block = (
  block: BlockResponse
): block is BlockObjectResponse & { type: 'heading_2' } => {
  return 'type' in block && block.type === 'heading_2';
};

const isParagraphBlock = (
  block: BlockResponse
): block is BlockObjectResponse & { type: 'paragraph' } => {
  return 'type' in block && block.type === 'paragraph';
};

const deleteCheckedTodoBlock = async (block: BlockResponse): Promise<boolean> => {
  if (!isToDoBlock(block) || !block.to_do.checked) {
    return false;
  }

  await notion.blocks.delete({ block_id: block.id });
  const textContent =
    (block.to_do.rich_text?.map((t) => ('plain_text' in t ? t.plain_text : '')).join(' ')) ||
    '<empty>';
  console.log(`Deleted: ${textContent}`);
  return true;
};

const processNestedBlocks = async (block: BlockResponse): Promise<void> => {
  if ('has_children' in block && block.has_children) {
    await deleteCheckedTodos(block.id);
  }
};

interface TodoSearchResult {
  hasTodo: boolean;
  paragraphs: Array<BlockObjectResponse & { type: 'paragraph' }>;
}

const findTodoOrParagraphsAfterHeading = (
  allBlocks: BlockResponse[],
  headingIndex: number
): TodoSearchResult => {
  let j = headingIndex + 1;
  const paragraphs: Array<BlockObjectResponse & { type: 'paragraph' }> = [];

  while (j < allBlocks.length) {
    const nextBlock = allBlocks[j];

    if (isParagraphBlock(nextBlock)) {
      paragraphs.push(nextBlock);
      j++;
      continue;
    }

    if (isToDoBlock(nextBlock)) {
      return { hasTodo: true, paragraphs };
    }

    if ('type' in nextBlock && nextBlock.type.startsWith('heading_')) {
      return { hasTodo: false, paragraphs };
    }

    return { hasTodo: false, paragraphs };
  }

  return { hasTodo: false, paragraphs };
};

const addEmptyTodoAfterHeading = async (
  parentBlockId: string,
  headingBlock: BlockObjectResponse & { type: 'heading_2' },
  paragraphsToDelete: Array<BlockObjectResponse & { type: 'paragraph' }> = []
): Promise<void> => {
  for (const para of paragraphsToDelete) {
    await notion.blocks.delete({ block_id: para.id });
  }

  await notion.blocks.children.append({
    block_id: parentBlockId,
    children: [
      {
        type: 'to_do',
        to_do: {
          rich_text: [],
          checked: false,
        },
      },
    ],
    after: headingBlock.id,
  });

  const blockText =
    (headingBlock.heading_2.rich_text?.map((t) => ('plain_text' in t ? t.plain_text : '')).join(' ')) ||
    'section';
  console.log(`Added empty to-do under: ${blockText}`);
};

const processEmptyHeadings = async (
  parentBlockId: string,
  allBlocks: BlockResponse[]
): Promise<void> => {
  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i];

    if (isHeading2Block(block)) {
      const { hasTodo, paragraphs } = findTodoOrParagraphsAfterHeading(
        allBlocks,
        i
      );

      if (!hasTodo) {
        await addEmptyTodoAfterHeading(parentBlockId, block, paragraphs);
      }
    }
  }
};

const deleteCheckedTodos = async (parentBlockId: string): Promise<void> => {
  try {
    const allBlocks = await getAllBlocks(notion, parentBlockId);

    for (const block of allBlocks) {
      await deleteCheckedTodoBlock(block);
      await processNestedBlocks(block);
    }

    await processEmptyHeadings(parentBlockId, allBlocks);
  } catch (error) {
    console.error('Error deleting checked todos:', error);
    throw error;
  }
};

console.log('Starting nightly shopping list cleanup...');
await deleteCheckedTodos(PAGE_ID);
console.log('Cleanup complete!');