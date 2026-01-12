export const parseMultiSelect = (text: string) =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((name) => ({ name }));

export const propertyBuilders = {
  richText: (value: string) => ({ rich_text: [{ text: { content: value } }] }),
  select: (value: string) => ({ select: { name: value } }),
  multiSelect: (value: string) => ({ multi_select: parseMultiSelect(value) }),
  number: (value: number) => ({ number: value }),
};