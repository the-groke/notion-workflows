import { propertyBuilders } from 'utils/parsing.ts';

export const REQUIRED_PROPERTIES = [
  'Typical stay length',
  'Best season',
  'Known for',
  'Typical activities',
  'Flights from',
  'Transport information',
];

export const FIELD_PATTERNS = {
  stayLength: /Typical stay length:\s*(.+?)(?=\n|$)/i,
  bestSeason: /Best season:\s*(.+?)(?=\n|$)/i,
  knownFor: /Known for:\s*(.+?)(?=\n|$)/i,
  activities: /Typical activities:\s*(.+?)(?=\n|$)/i,
  flights: /Flights from:\s*(.+?)(?=\n|$)/i,
  transportInfo: /Transport information:\s*(.+?)(?=\n|$)/i,
};

export const FIELD_MAPPINGS = [
  ['Typical stay length', 'stayLength', propertyBuilders.richText],
  ['Best season', 'bestSeason', propertyBuilders.select],
  ['Known for', 'knownFor', propertyBuilders.richText],
  ['Typical activities', 'activities', propertyBuilders.multiSelect],
  ['Flights from', 'flights', propertyBuilders.multiSelect],
  ['Transport information', 'transportInfo', propertyBuilders.richText],
];

export const SPLIT_PATTERN = /###\s*(?:Place\s*)?\d+\.?\s*/i;