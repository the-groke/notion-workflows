export const MEAL_PLANNER_WINDOW_DAYS = 28;

export interface MealPlanDay {
  id: string;
  name: string; // Format: "Mon 1 Jan"
  date: string; // ISO date string
}