import {  NotionPropertyRequest } from './notion';

export const parseMultiSelect = (text: string) =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((name) => ({ name }));

export type PropertyBuilder = (value: string | number) => NotionPropertyRequest;

export const propertyBuilders = {
  richText: (value: string | number): NotionPropertyRequest => ({
    rich_text: [{ text: { content: String(value) } }] 
  }),
  select: (value: string | number): NotionPropertyRequest => ({
    select: { name: String(value) } 
  }),
  multiSelect: (value: string | number): NotionPropertyRequest => ({
    multi_select: parseMultiSelect(String(value)) 
  }),
  number: (value: string | number): NotionPropertyRequest => ({
    number: typeof value === 'number' ? value : Number(value) 
  }),
};