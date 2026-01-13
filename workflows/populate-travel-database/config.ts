import { NotionPropertyRequest } from 'utils/notion';
import { propertyBuilders } from "utils/parsing";

export interface TravelPlace {
  stayLength: string;
  bestSeason: string;
  knownFor: string;
  activities: string;
  flights: string;
  transportInfo: string;
}

export const REQUIRED_PROPERTIES = [
  "Typical stay length",
  "Best season",
  "Known for",
  "Typical activities",
  "Flights from",
  "Transport information",
] as const;

type PropertyBuilder = (value: string | number) => NotionPropertyRequest;

export const FIELD_MAPPINGS: Array<
  [string, keyof TravelPlace, PropertyBuilder]
> = [
  ["Typical stay length", "stayLength", propertyBuilders.richText],
  ["Best season", "bestSeason", propertyBuilders.select],
  ["Known for", "knownFor", propertyBuilders.richText],
  ["Typical activities", "activities", propertyBuilders.multiSelect],
  ["Flights from", "flights", propertyBuilders.multiSelect],
  ["Transport information", "transportInfo", propertyBuilders.richText],
];