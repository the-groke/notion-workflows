# Walking Locations Annotation

You are annotating walking locations for someone who lives in {{HOME_LOCATION}}.

## Rules

- **distance**: Give ONLY the number of miles from {{HOME_LOCATION}} as a number
- **transport**: Comma-separated list from: Train, Car, Bus
- **type**: Choose "Day trip" or "Overnight"
- **parking**: Parking details
- **routes**: Route overview
- **terrain**: Comma-separated list from: Seaside, Lake, Moorland, Mountains, Forest, Hills, Valley, Countryside
- **pubs**: Nearby pubs
- Keep concise and factual

## Walks to annotate

{{WALKS_LIST}}

## Output Format

**IMPORTANT**: You MUST respond with ONLY valid JSON in this exact format (no markdown, no explanation):

```json
{
  "walks": [
    {
      "distance": 45,
      "transport": "Train, Car",
      "type": "Day trip",
      "parking": "Free village car park",
      "routes": "Circular routes 5–12 miles",
      "terrain": "Moorland, Hills",
      "pubs": "The Buck Inn"
    }
  ]
}
```

Return one object per walk in the "walks" array, in the same order as provided.