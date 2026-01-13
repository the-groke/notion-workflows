# Meal Recipe Completion

You are completing missing recipe information for a personal meal database.

## Rules

### Ingredients
- List all ingredients needed for the recipe
- **Output as comma-separated list** (this will become multi-select tags in Notion)
- Use **sentence case** (e.g., "Heavy cream", not "heavy cream" or "Heavy Cream")
- **Normalize ingredient names** to avoid duplicates:
  - Use "Heavy cream" not "Double cream" or "Whipping cream"
  - Use "Chicken thighs (boneless, skinless)" not "Boneless skinless chicken thighs"
  - Use "Tomatoes (canned, diced)" not "Canned diced tomatoes" or "Diced tomatoes"
  - Use "Bell pepper (red)" not "Red bell pepper"
  - Use "Olive oil" not "Extra virgin olive oil" or "EVOO"
  - Use "Garlic" not "Garlic cloves" (quantities don't go in ingredient names)
  - Use "Onion (yellow)" not "Yellow onion"
  - Use "Pasta (penne)" not "Penne pasta"
- **Do NOT include quantities** in ingredient names (those go in cooking instructions)
- Keep ingredient names concise but specific
- Example: "Heavy cream, Chicken thighs (boneless, skinless), Tomatoes (canned, diced), Garlic, Olive oil, Salt, Black pepper"

### Cooking Instructions
- Clear, step-by-step instructions with quantities
- **Maximum 300 words**
- Concise but complete
- Include cooking times and temperatures
- Number the steps

## Meals to complete

{{MEALS_LIST}}

## Output Format

**IMPORTANT**: You MUST respond with ONLY valid JSON in this exact format (no markdown, no explanation):

```json
{
  "meals": [
    {
      "ingredients": "Heavy cream, Chicken thighs (boneless, skinless), Tomatoes (canned, diced), Garlic, Olive oil, Salt, Black pepper",
      "cookingInstructions": "1. Heat 1 tbsp olive oil in a large pan over medium heat.\n2. Season 4 chicken thighs with salt and pepper, sear 4-5 minutes per side until golden.\n3. Remove chicken and set aside.\n4. Add 2 cloves minced garlic, cook 30 seconds until fragrant.\n5. Pour in 2 cups heavy cream and 1 can diced tomatoes, bring to a simmer.\n6. Return chicken to pan, reduce heat to low.\n7. Simmer 15-20 minutes until chicken reaches 165°F and sauce thickens.\n8. Serve hot with rice or pasta."
    }
  ]
}
```

Return one object per meal in the "meals" array, in the same order as provided.