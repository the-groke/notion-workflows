# Pubs Database Completion

You are completing information for a pub crawl database in {{}}, UK.

## Rules

### Overview
- Write a 100-word description of the pub
- Include: atmosphere, notable features, beer selection, food (if known), historical significance
- Use British English
- Be concise and informative
- Focus on what makes this pub unique or worth visiting

### Distance from Station
- Calculate walking distance in **metres** from {{}} Railway Station to the pub
- Use actual distances based on {{}}'s street layout
- Be as accurate as possible

### Route Order
- Calculate the most efficient pub crawl route starting from {{}} Railway Station
- Visit each pub only once
- Minimize total walking distance
- Return to the station is NOT required
- Use nearest-neighbor algorithm (always go to the closest unvisited pub)
- Assign numbers 1, 2, 3, etc. in visiting order

## Pubs to complete

{{PUBS_LIST}}

## Output Format

**IMPORTANT**: You MUST respond with ONLY valid JSON in this exact format (no markdown, no explanation):

```json
{
  "pubs": [
    {
      "overview": "The Golden Fleece is one of York's most haunted pubs, dating back to at least 1503. Located on Pavement, this historic timber-framed building oozes character with low beams and creaky floors. Known for its excellent selection of real ales and traditional pub atmosphere, it's a must-visit for history enthusiasts. The pub serves classic British fare and hosts regular ghost tours. Its central location makes it perfect for exploring York's medieval streets.",
      "distanceFromStation": 850,
      "routeOrder": 3
    },
    {
      "overview": "Situated just outside the station, The York Tap occupies the former first-class waiting room and features stunning Victorian architecture with ornate ceilings. Specializing in craft beers and real ales, it offers 20+ taps and an extensive bottled selection. The elegant interior with original features creates a sophisticated atmosphere. Perfect for starting or ending a pub crawl, it's renowned among beer enthusiasts for quality and variety.",
      "distanceFromStation": 50,
      "routeOrder": 1
    }
  ]
}
```

Return one object per pub in the "pubs" array, in the same order as provided.