import { PropertyBuilder, propertyBuilders } from "utils/parsing.js";

export interface MealData extends Record<string, string> {
  ingredients: string; // Comma-separated for multi-select
  cookingInstructions: string;
}

export const REQUIRED_PROPERTIES = [
  "Ingredients",
  "Cooking instructions",
] as const;

export const FIELD_MAPPINGS: Array<
  [string, keyof MealData, PropertyBuilder]
> = [
  ["Ingredients", "ingredients", propertyBuilders.multiSelect],
  ["Cooking instructions", "cookingInstructions", propertyBuilders.richText],
];