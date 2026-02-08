import { logger } from 'utils/logger';

export const getText = (prop: any): string | undefined => {
  return prop?.rich_text?.[0]?.plain_text;
}

export const getTitle = (prop: any): string | undefined => {
  return prop?.title?.[0]?.plain_text;
}

export const getNthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  ordinal: string
): Date | null => {
  const matches: Date[] = [];
  const d = new Date(year, month, 1);

  while (d.getMonth() === month) {
    if (d.getDay() === weekday) {
      matches.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  if (ordinal === "last") {
    return matches.at(-1) ?? null;
  }

  const index = Number(ordinal) - 1;
  return matches[index] ?? null;
}

export const generatedEventExists = async (generatedId: string, eventsDbId: string, token: string): Promise<boolean> => {
  logger.info(`Checking existence of event: ${generatedId}`);
  
  const response = await fetch(
    `https://api.notion.com/v1/databases/${eventsDbId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
          property: "Generated id",
          rich_text: { equals: generatedId },
        },
        page_size: 1,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    logger.error(`Failed to check event existence: ${error.message}`);
    throw new Error(`Failed to query database: ${error.message}`);
  }

  const data = await response.json();
  const exists = data.results.length > 0;
  logger.info(`Event ${generatedId} exists: ${exists}`);
  return exists;
};