import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  BlockObjectResponse,
  PartialBlockObjectResponse,
  RichTextItemResponse,
  SelectPropertyItemObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

type PageResponse = PageObjectResponse | PartialPageObjectResponse;
type BlockResponse = BlockObjectResponse | PartialBlockObjectResponse;

interface DatabaseQueryResponse {
  results: PageResponse[];
  has_more: boolean;
  next_cursor: string | null;
}

type NotionProperty =
  | { type: "number"; number: number | null }
  | { type: "rich_text"; rich_text: RichTextItemResponse[] }
  | { type: "select"; select: SelectPropertyItemObjectResponse | null }
  | { type: "multi_select"; multi_select: SelectPropertyItemObjectResponse[] }
  | { type: "title"; title: RichTextItemResponse[] }
  | PageObjectResponse["properties"][string];

export const createNotionClient = (token: string): Client => 
  new Client({ auth: token });

export const getAllPages = async (
  databaseId: string,
  token: string
): Promise<PageResponse[]> => {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to query database: ${error.message}`);
  }

  const data = await response.json() as DatabaseQueryResponse;
  console.log(`Found ${data.results.length} pages in database`);
  return data.results;
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

export const isEmpty = (property: NotionProperty | undefined): boolean => {
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
    return isEmpty(property as NotionProperty);
  });
};

type PropertyValue = 
  | { rich_text: Array<{ text: { content: string } }> }
  | { select: { name: string } }
  | { multi_select: Array<{ name: string }> }
  | { number: number };

type PropertyBuilder = (value: string | number) => PropertyValue;

export const buildPropertyUpdates = <T extends Record<string, string | number>>(
  page: PageResponse,
  data: T,
  fieldMappings: Array<[string, keyof T, PropertyBuilder]>
): Record<string, PropertyValue> => {
  if (!("properties" in page)) return {};
  
  return fieldMappings.reduce((updates, [propertyName, dataKey, builder]) => {
    const value = data[dataKey];
    const property = page.properties[propertyName];
    
    if (isEmpty(property as NotionProperty) && value !== null && value !== undefined) {
      updates[propertyName] = builder(value);
    }
    return updates;
  }, {} as Record<string, PropertyValue>);
};

export const updatePage = async (
  notion: Client,
  pageId: string,
  properties: Record<string, PropertyValue>
): Promise<void> => {
  await notion.pages.update({
    page_id: pageId,
    properties,
  });
};