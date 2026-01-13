import { NotionPropertyRequest } from 'utils/notion';
import { propertyBuilders } from "utils/parsing";

export interface Walk {
  distance: number;
  transport: string;
  type: string;
  parking: string;
  routes: string;
  terrain: string;
  pubs: string;
}

export const REQUIRED_PROPERTIES = [
  "Distance from home (miles)",
  "Transport options",
  "Type",
  "Parking",
  "Routes",
  "Terrain",
  "Pubs",
] as const;

export const FIELD_MAPPINGS: Array<
  [string, keyof Walk, (value: string | number) => NotionPropertyRequest]
> = [
  ["Distance from home (miles)", "distance", propertyBuilders.number],
  ["Transport options", "transport", propertyBuilders.multiSelect],
  ["Type", "type", propertyBuilders.multiSelect],
  ["Parking", "parking", propertyBuilders.richText],
  ["Routes", "routes", propertyBuilders.richText],
  ["Terrain", "terrain", propertyBuilders.multiSelect],
  ["Pubs", "pubs", propertyBuilders.richText],
];