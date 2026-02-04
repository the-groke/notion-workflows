import { propertyBuilders, type PropertyBuilder } from "utils/parsing";

export interface PubData extends Record<string, string | number> {
  overview: string;
  distanceFromStation: number;
  routeOrder: number;
}

export const REQUIRED_PROPERTIES = [
  "Overview",
  "Distance from station (metres)",
  "Route order",
] as const;

export const FIELD_MAPPINGS: Array<
  [string, keyof PubData, PropertyBuilder]
> = [
  ["Overview", "overview", propertyBuilders.richText],
  ["Distance from station (metres)", "distanceFromStation", propertyBuilders.number],
  ["Route order", "routeOrder", propertyBuilders.number],
];