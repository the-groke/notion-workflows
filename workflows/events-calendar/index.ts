import 'dotenv/config';
// Utils
import { logger } from 'utils/logger';
import { createNotionClient, getAllPages } from 'utils/notion';
import { generatedEventExists, getNthWeekdayOfMonth, getText, getTitle } from './utils';
// Config
import { MONTH_NAMES, WEEKDAY_MAP } from './config';


const NOTION_TOKEN = process.env.NOTION_TOKEN;
const EVENTS_DATABASE_ID = process.env.EVENTS_DATABASE_ID;
const REPEAT_EVENTS_DATABASE_ID = process.env.REPEAT_EVENTS_DATABASE_ID;

if (!NOTION_TOKEN) {
  logger.error("NOTION_TOKEN is not defined");
  process.exit(1);
}

if (!EVENTS_DATABASE_ID) {
  logger.error("EVENTS_DATABASE_ID is not defined");
  process.exit(1);
}

if (!REPEAT_EVENTS_DATABASE_ID) {
  logger.error("REPEAT_EVENTS_DATABASE_ID is not defined");
  process.exit(1);
}

const notion = createNotionClient(NOTION_TOKEN);

const createEvent = async (args: {
  event: string;
  date: Date;
  generatedId: string;
  where?: string;
  geolocation?: any;
  startTime?: string;
  endTime?: string;
  overview?: string;
  website?: string;
}) => {
  // Use local date formatting to avoid timezone shifts
  const year = args.date.getFullYear();
  const month = String(args.date.getMonth() + 1).padStart(2, '0');
  const day = String(args.date.getDate()).padStart(2, '0');
  const isoDate = `${year}-${month}-${day}`;

  logger.info(`Creating event with date: ${isoDate} (from Date object: ${args.date.toString()})`);

  await notion.pages.create({
    parent: { database_id: EVENTS_DATABASE_ID },
    properties: {
      Event: {
        title: [{ text: { content: args.event } }],
      },

      Date: {
        date: { start: isoDate },
      },

      "Generated id": {
        rich_text: [{ text: { content: args.generatedId } }],
      },

      ...(args.startTime && {
        "Start time": {
          rich_text: [{ text: { content: args.startTime } }],
        },
      }),

      ...(args.endTime && {
        "End time": {
          rich_text: [{ text: { content: args.endTime } }],
        },
      }),

      ...(args.where && {
        Where: {
          rich_text: [{ text: { content: args.where } }],
        },
      }),

      ...(args.overview && {
        Overview: {
          rich_text: [{ text: { content: args.overview } }],
        },
      }),

      ...(args.website && {
        Website: {
          url: args.website,
        },
      }),

      ...(args.geolocation && {
        Geolocation: {
          location: args.geolocation,
        },
      }),
    },
  });
}

const run = async () => {
  logger.info("Starting event generation process");
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 12);
  logger.info(`Processing events from ${now.toISOString()} to ${end.toISOString()}`);

  logger.info(`Fetching repeat events from database: ${REPEAT_EVENTS_DATABASE_ID}`);
  const repeatEvents = await getAllPages(REPEAT_EVENTS_DATABASE_ID, NOTION_TOKEN);
  logger.info(`Found ${repeatEvents.length} repeat events to process`);

  for (const page of repeatEvents) {
    // @ts-ignore – Notion SDK types are useless here
    const props = page.properties;

    const event = getTitle(props.Event);
    if (!event) {
      logger.warn(`Skipping page - no event title found`);
      continue;
    }
    logger.info(`Processing repeat event: "${event}"`);

    // Use page ID as template ID
    const templateId = page.id;
    logger.info(`Template ID: ${templateId}`);

    const weekdayName = props.Weekday?.select?.name;
    if (!weekdayName) {
      logger.warn(`Skipping event "${event}" - no weekday specified`);
      continue;
    }
    logger.info(`Weekday: ${weekdayName}`);

    const weekday = WEEKDAY_MAP[weekdayName];

    // Week ordinal is a single select, not multi_select
    const ordinalValue = props["Week ordinal"]?.select?.name;
    const ordinals: string[] = ordinalValue ? [ordinalValue] : [];
    logger.info(`Week ordinals: ${ordinals.join(', ')}`);

    if (ordinals.length === 0) {
      logger.warn(`Skipping event "${event}" - no week ordinal specified`);
      continue;
    }

    const excludedMonths = new Set<string>(
      props["Excluded months"]?.multi_select?.map((m: any) => m.name) ?? []
    );
    logger.info(`Excluded months: ${Array.from(excludedMonths).join(', ') || 'none'}`);

    const where = getText(props.Where);
    const overview = getText(props.Overview);
    const startTime = getText(props["Start time"]);
    const endTime = getText(props["End time"]);
    const website = props.Website?.url ?? undefined;
    const geolocation = props.Geolocation?.location ?? undefined;

    const cursor = new Date(now);
    let eventsCreated = 0;
    let eventsSkipped = 0;

    while (cursor <= end) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const monthName = MONTH_NAMES[month];

      if (!excludedMonths.has(monthName)) {
        for (const ordinal of ordinals) {
          const date = getNthWeekdayOfMonth(
            year,
            month,
            weekday,
            ordinal
          );

          if (!date) {
            logger.warn(`Could not find ${ordinal} ${weekdayName} in ${monthName} ${year}`);
            continue;
          }

          const generatedId = `${templateId}_${date
            .toISOString()
            .split("T")[0]}`;

          logger.info(`Checking if event exists: ${generatedId}`);
          if (!(await generatedEventExists(generatedId, EVENTS_DATABASE_ID, NOTION_TOKEN))) {
            logger.info(`Creating event: ${event} on ${date.toISOString().split("T")[0]}`);
            await createEvent({
              event,
              date,
              generatedId,
              where,
              geolocation,
              startTime,
              endTime,
              overview,
              website,
            });
            eventsCreated++;
            logger.info(`Successfully created event: ${generatedId}`);
          } else {
            eventsSkipped++;
            logger.info(`Event already exists, skipping: ${generatedId}`);
          }
        }
      } else {
        logger.info(`Skipping ${monthName} ${year} - month is excluded`);
      }

      cursor.setMonth(cursor.getMonth() + 1);
    }

    logger.info(`Completed "${event}": Created ${eventsCreated} events, Skipped ${eventsSkipped} existing events`);
  }

  logger.info("Event generation process completed");
}

run().catch((err) => {
  logger.error("Fatal error in event generation:", err);
  console.error(err);
  process.exit(1);
});