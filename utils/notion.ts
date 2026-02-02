import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  BlockObjectResponse,
  PartialBlockObjectResponse,
  RichTextItemResponse,
  SelectPropertyItemObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
// Utils
import { logger } from 'utils/logger';
// Types
import type { PropertyBuilder } from "utils/parsing";

type PageResponse = PageObjectResponse;
type BlockResponse = BlockObjectResponse | PartialBlockObjectResponse;

interface DatabaseQueryResponse {
  results: PageResponse[];
  has_more: boolean;
  next_cursor: string | null;
}

export type NotionPropertyResponse =
  | { type: "number"; number: number | null }
  | { type: "rich_text"; rich_text: RichTextItemResponse[] }
  | { type: "select"; select: SelectPropertyItemObjectResponse | null }
  | { type: "multi_select"; multi_select: SelectPropertyItemObjectResponse[] }
  | { type: "title"; title: RichTextItemResponse[] }
  | PageObjectResponse["properties"][string];

export type NotionPropertyRequest =
  | { type?: "number"; number: number | null }
  | { type?: "rich_text"; rich_text: Array<{ text: { content: string; link?: { url: string } | null } }> }
  | { type?: "select"; select: { name: string } | null }
  | { type?: "multi_select"; multi_select: Array<{ name: string }> }
  | { type?: "title"; title: Array<{ text: { content: string; link?: { url: string } | null } }> };

export const createNotionClient = (token: string): Client => 
  new Client({ auth: token });

export const getAllPages = async (
  databaseId: string,
  token: string
): Promise<PageResponse[]> => {
  logger.info("Using token");

  const allPages: PageResponse[] = [];
  let hasMore = true;
  let startCursor: string | undefined = undefined;

  while (hasMore) {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_cursor: startCursor,
          page_size: 100,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to query database: ${error.message}`);
    }

    const data = await response.json() as DatabaseQueryResponse;
    allPages.push(...data.results);
    
    hasMore = data.has_more;
    startCursor = data.next_cursor || undefined;
    
    logger.info(`Fetched ${data.results.length} pages (total so far: ${allPages.length})`);
  }

  logger.info(`Found ${allPages.length} pages in database`);
  return allPages;
};

export const getAllBlocks = async (
  notion: Client,
  parentBlockId: string
): Promise<BlockResponse[]> => {
  const allBlocks: BlockResponse[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: parentBlockId,
      start_cursor: cursor,
      page_size: 100,
    });

    allBlocks.push(...response.results);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return allBlocks;
};

export const isEmpty = (property: NotionPropertyResponse | undefined): boolean => {
  if (!property) return true;
  
  if (property.type === "number") {
    return property.number === null;
  }
  if (property.type === "rich_text") {
    return property.rich_text.length === 0;
  }
  if (property.type === "select") {
    return !property.select;
  }
  if (property.type === "multi_select") {
    return property.multi_select.length === 0;
  }
  if (property.type === "title") {
    return property.title.length === 0;
  }
  
  return true;
};

export const extractTitle = (page: PageResponse, fallback = "Unnamed"): string => {
  if (!("properties" in page)) return fallback;
  
  const nameProperty = page.properties.Name;
  if (!nameProperty || nameProperty.type !== "title") return fallback;
  
  return nameProperty.title.length > 0
    ? nameProperty.title[0].plain_text
    : fallback;
};

export const hasEmptyProperties = (
  page: PageResponse,
  propertyNames: string[]
): boolean => {
  if (!("properties" in page)) return false;
  
  return propertyNames.some((name) => {
    const property = page.properties[name];
    return isEmpty(property as NotionPropertyResponse);
  });
};

export const buildPropertyUpdates = <T extends { [K in keyof T]: string | number }>(
  page: PageResponse,
  data: T,
  fieldMappings: Array<[string, keyof T, PropertyBuilder]>
): Record<string, NotionPropertyRequest> => {
  if (!("properties" in page)) return {};
  
  return fieldMappings.reduce((updates, [propertyName, dataKey, builder]) => {
    const value = data[dataKey];
    const property = page.properties[propertyName];
    
    if (isEmpty(property as NotionPropertyResponse) && value !== null && value !== undefined) {
      updates[propertyName] = builder(value);
    }
    return updates;
  }, {} as Record<string, NotionPropertyRequest>);
};

export const updatePage = async (
  notion: Client,
  pageId: string,
  properties: Record<string, NotionPropertyRequest>
): Promise<void> => {
  await notion.pages.update({
    page_id: pageId,
    properties,
  });
};