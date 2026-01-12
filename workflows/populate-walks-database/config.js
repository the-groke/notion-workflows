import { propertyBuilders } from 'utils/parsing.js';

export const REQUIRED_PROPERTIES = [
  'Distance from home (miles)',
  'Transport options',
  'Type',
  'Parking',
  'Routes',
  'Terrain',
  'Pubs',
];

export const FIELD_PATTERNS = {
  distance: /Distance:\s*(\d+(?:\.\d+)?)/i,
  transport: /Transport:\s*(.+?)(?=\n|$)/i,
  type: /Type:\s*(.+?)(?=\n|$)/i,
  parking: /Parking:\s*(.+?)(?=\n|$)/i,
  routes: /Routes:\s*(.+?)(?=\n|$)/i,
  terrain: /Terrain:\s*(.+?)(?=\n|$)/i,
  pubs: /Pubs:\s*(.+?)(?=\n|$)/i,
};

export const FIELD_MAPPINGS = [
  ['Distance from home (miles)', 'distance', propertyBuilders.number],
  ['Transport options', 'transport', propertyBuilders.multiSelect],
  ['Type', 'type', propertyBuilders.multiSelect],
  ['Parking', 'parking', propertyBuilders.richText],
  ['Routes', 'routes', propertyBuilders.richText],
  ['Terrain', 'terrain', propertyBuilders.multiSelect],
  ['Pubs', 'pubs', propertyBuilders.richText],
];

export const SPLIT_PATTERN = /###\s*Walk\s*\d+/i;