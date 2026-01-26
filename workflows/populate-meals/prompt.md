# Meal Recipe Completion

You are completing missing recipe information for a personal meal database.

## Rules

### Ingredients
- List all ingredients needed for the recipe
- **Output as comma-separated list** (this will become multi-select tags in Notion)
- Use **sentence case** (e.g., "Chicken stock", not "chicken stock" or "Chicken Stock")
- Use British English and UK names for cuts of meat and ingredients

**CRITICAL: Ingredient Naming Rules**
- **Check the existing database for similar ingredients FIRST**
- **Never create variations of existing ingredients**
- If an ingredient exists, use its EXACT name even if you would word it differently
- **Avoid parentheses entirely** - they cause parsing errors and create duplicates
- Use descriptive adjectives instead: "Red pepper" NOT "Bell peppers (red)" or "Pepper (red)"
- Use prefix descriptions: "Canned chickpeas" NOT "Chickpeas (canned)"

**Form/Preparation Descriptors**
- Only specify form when it materially changes the ingredient:
  - "Ground cumin" vs "Cumin seeds" (different forms of same spice)
  - "Ground coriander" vs "Coriander" (leaf vs seed - different ingredients)
  - "Tomato paste" vs "Canned diced tomatoes" (very different products)
  - "Grated parmesan" vs "Parmesan block" (if this distinction exists in the database)
- **Do NOT specify fresh/dried for herbs** - just use "Basil", "Parsley", "Thyme"
  - Exception: Only specify if genuinely different ingredients (e.g., "Ground coriander" is from seeds, "Coriander" is the leaf)
- **Do NOT specify shredded/grated for cheese unless** it already exists that way in the database
  - Use "Mozzarella" NOT "Shredded mozzarella" or "Fresh mozzarella (shredded)"
  - Use "Cheddar" NOT "Grated cheddar"

**Ingredient Standardization**
- "Double cream" (not Heavy cream, Whipping cream)
- "Red pepper" or "Green pepper" (not Bell pepper, Capsicum)
- "Olive oil" (not Extra virgin olive oil, EVOO)
- "Garlic" (not Garlic cloves)
- "Yellow onion" (not Onion)
- "Penne pasta" (not Pasta)

**Do NOT include quantities** in ingredient names - those belong in cooking instructions only

Example output: "Double cream, Boneless chicken thighs, Canned diced tomatoes, Garlic, Olive oil, Salt, Black pepper, Basil, Ground cumin"

### Cooking Instructions
- Clear, step-by-step instructions with quantities
- **Maximum 300 words**
- Concise but complete
- Include cooking times and temperatures
- Number the steps

## Meals to complete

{{MEALS_LIST}}

**IMPORTANT**: If a meal already has ingredients listed under "Existing ingredients", you MUST:
1. Use those EXACT ingredients in your cooking instructions
2. DO NOT add ingredients that aren't in the existing list
3. Write instructions that only use what's provided
4. If the ingredients or title suggest a variation (e.g., only vegetables for "Faux fry-up"), adapt the recipe accordingly

If no existing ingredients are listed, provide a complete ingredient list and instructions as normal.

## Output Format

**IMPORTANT**: You MUST respond with ONLY valid JSON in this exact format (no markdown, no explanation). Do not wrap the JSON in ````` ``` `````:
```json
{
  "meals": [
    {
      "ingredients": "Double cream, Boneless chicken thighs, Canned diced tomatoes, Garlic, Olive oil, Salt, Black pepper",
      "cookingInstructions": "1. Heat 1 tbsp olive oil in a large pan over medium heat.\n2. Season 4 chicken thighs with salt and pepper, sear 4-5 minutes per side until golden.\n3. Remove chicken and set aside.\n4. Add 2 cloves minced garlic, cook 30 seconds until fragrant.\n5. Pour in 2 cups heavy cream and 1 can diced tomatoes, bring to a simmer.\n6. Return chicken to pan, reduce heat to low.\n7. Simmer 15-20 minutes until chicken reaches 165°F and sauce thickens.\n8. Serve hot with rice or pasta."
    }
  ]
}
```

Return one object per meal in the "meals" array, in the same order as provided.