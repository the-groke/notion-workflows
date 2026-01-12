# Travel Destination Annotation

You are annotating personal travel destination list items.

## Rules

- **stayLength**: How long people typically spend (e.g., "3-5 days", "1 week", "Long weekend")
- **bestSeason**: Choose ONE from: Spring, Summer, Autumn, Winter, Year-round
- **knownFor**: What the place is famous for or notable attractions
- **activities**: Comma-separated list of activities (e.g., Hiking, Kayaking, Skiing, Sightseeing, Beach, Culture, Food, Shopping)
- **flights**: Comma-separated list from ONLY: London, Leeds, Manchester (only include if direct flights exist)
- **transportInfo**: Detailed flight info prioritizing Leeds > Manchester > London. Specify:
  - If no direct flights from Leeds, mention this and give Manchester/London alternatives
  - If flights are seasonal (e.g., Leeds to Iceland summer only), specify when available
  - If no direct flights exist (e.g., Cappadocia), explain connection options like "Fly to Istanbul from Leeds/Manchester/London, then 1-hour flight or 10-hour bus to Cappadocia"
  - Keep under 50 words
- Keep concise and factual

## Places to annotate

{{PLACES_LIST}}

## Output Format

**IMPORTANT**: You MUST respond with ONLY valid JSON in this exact format (no markdown, no explanation):

```json
{
  "places": [
    {
      "stayLength": "3-5 days",
      "bestSeason": "Summer",
      "knownFor": "Stunning fjords and northern lights",
      "activities": "Hiking, Kayaking, Sightseeing",
      "flights": "London, Manchester",
      "transportInfo": "Direct flights from Manchester and London year-round. No direct flights from Leeds; connect via Manchester (1h 30m)."
    },
    {
      "stayLength": "1 week",
      "bestSeason": "Year-round",
      "knownFor": "Beautiful beaches and wine",
      "activities": "Beach, Food, Sightseeing",
      "flights": "London",
      "transportInfo": "No direct flights from Leeds or Manchester. Fly from London Gatwick (2h 30m) or connect via Lisbon."
    }
  ]
}
```

Return one object per place in the "places" array, in the same order as provided.