#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createNotionClient,
  getAllPages,
  extractTitle,
  hasEmptyProperties,
  buildPropertyUpdates,
  updatePage,
} from 'utils/notion.ts';
import { createAIClient, batchAnnotate } from 'utils/ai.ts';
import { extractText, extractNumber } from 'utils/parsing.ts';
import {
  REQUIRED_PROPERTIES,
  FIELD_PATTERNS,
  FIELD_MAPPINGS,
  SPLIT_PATTERN,
} from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ----------------------------- Environment -------------------------------- */

const DATABASE_ID = process.env.WALKS_DATABASE_ID;
const HOME_LOCATION = process.env.HOME_LOCATION;

if (!DATABASE_ID) {
  console.error('ERROR: WALKS_DATABASE_ID is not defined');
  process.exit(1);
}

if (!HOME_LOCATION) {
  console.error('ERROR: HOME_LOCATION is not defined');
  process.exit(1);
}

const notion = createNotionClient(process.env.NOTION_TOKEN);
const ai = createAIClient();

/* ----------------------------- Helper functions ---------------------------- */

const parseSection = (section) => ({
  distance: extractNumber(section, FIELD_PATTERNS.distance),
  transport: extractText(section, FIELD_PATTERNS.transport),
  type: extractText(section, FIELD_PATTERNS.type),
  parking: extractText(section, FIELD_PATTERNS.parking),
  routes: extractText(section, FIELD_PATTERNS.routes),
  terrain: extractText(section, FIELD_PATTERNS.terrain),
  pubs: extractText(section, FIELD_PATTERNS.pubs),
});

const buildPrompt = async (walks) => {
  const promptTemplate = await readFile(
    join(__dirname, 'prompt.md'),
    'utf-8'
  );

  const walksList = walks.map((w, i) => `${i + 1}. ${w}`).join('\n');

  return promptTemplate
    .replace('{{HOME_LOCATION}}', HOME_LOCATION)
    .replace('{{HOME_LOCATION}}', HOME_LOCATION)
    .replace('{{WALKS_LIST}}', walksList);
};

/* --------------------------------- Runner ---------------------------------- */

export async function run() {
  console.log('Fetching all pages from database...');
  const pages = await getAllPages(DATABASE_ID, process.env.NOTION_TOKEN);

  console.log(`\nTotal pages retrieved: ${pages.length}`);

  const eligible = pages.filter((page) =>
    hasEmptyProperties(page, REQUIRED_PROPERTIES)
  );

  console.log(`Found ${eligible.length} walk items with empty fields\n`);

  if (!eligible.length) {
    console.log('No items need annotation. All done!');
    return;
  }

  await batchAnnotate(ai, {
    pages: eligible,
    extractName: extractTitle,
    buildPrompt,
    splitPattern: SPLIT_PATTERN,
    parseSection,
    buildUpdates: (page, data) =>
      buildPropertyUpdates(page, data, FIELD_MAPPINGS),
    updatePage: async (page, updates) =>
      updatePage(notion, page.id, updates),
    itemType: 'walk',
  });

  console.log('\n✓ Walk annotation complete');
  console.log('💡 Sort by \'Distance from home\' to see closest walks first.');
}

/* ---------------------------- CLI entry point ------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run();
  } catch (err) {
    console.error('Unexpected error:', err);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
}
