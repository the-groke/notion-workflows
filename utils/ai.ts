import type { PageObjectResponse, PartialPageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { NotionPropertyRequest } from './notion';

type PageResponse = PageObjectResponse | PartialPageObjectResponse;

interface BatchAnnotateConfig<T> {
  pages: PageResponse[];
  extractName: (page: PageResponse) => string;
  buildPrompt: (names: string[]) => Promise<string>;
  parseResponse: (response: unknown) => T[];
  buildUpdates: (page: PageResponse, data: T) => Record<string, NotionPropertyRequest>;
  updatePage: (page: PageResponse, updates: Record<string, NotionPropertyRequest>) => Promise<void>;
  itemType?: string;
}

interface AIResponse {
  text?: string;
}

interface AIModel {
  generateContent: (config: {
    model: string;
    contents: string;
    generationConfig: {
      response_mime_type: string;
    };
  }) => Promise<AIResponse>;
}

export interface AIClient {
  models: AIModel;
}

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

const isJsonPrimitive = (value: JsonValue): value is JsonPrimitive => {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
};

const isJsonObject = (value: JsonValue): value is JsonObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isJsonArray = (value: JsonValue): value is JsonArray => {
  return Array.isArray(value);
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
};

export const createAIClient = async (): Promise<AIClient> => {
  const { GoogleGenAI: Client } = await import("@google/genai");
  return new Client({});
};

export const batchAnnotate = async <T>(
  ai: AIClient,
  config: BatchAnnotateConfig<T>
): Promise<void> => {
  const {
    pages,
    extractName,
    buildPrompt,
    parseResponse,
    buildUpdates,
    updatePage,
    itemType = "item",
  } = config;

  const names = pages.map(extractName);
  const prompt = await buildPrompt(names);

  console.log(`\nAnnotating all ${itemType}s in one API call...`);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    generationConfig: {
      response_mime_type: "application/json",
    },
  });

  if (process.env.DEBUG) {
    console.log("\n--- AI Response ---");
    console.log(response.text ?? "");
    console.log("--- End Response ---\n");
  }

  let parsedData: T[];
 try {
    // Strip markdown code fences if present
        const rawText = response.text ?? "";
        let cleanedText = rawText.trim();
        if (!cleanedText) {
          throw new Error("AI returned an empty response");
        }
        if (cleanedText.startsWith("```json")) {
          cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (cleanedText.startsWith("```")) {
          cleanedText = cleanedText.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }
        
        const jsonResponse: unknown = JSON.parse(cleanedText);
        
        if (!isJsonValue(jsonResponse)) {
          throw new Error("Response is not valid JSON");
        }
        parsedData = parseResponse(jsonResponse);
  } catch (error) {
    console.error("Failed to parse AI response as JSON:", error);
    console.error("Raw response:", response.text);
    throw new Error("AI did not return valid JSON");
  }

  if (parsedData.length !== pages.length) {
    console.warn(
      `Warning: Expected ${pages.length} items but got ${parsedData.length}`
    );
  }

  for (let i = 0; i < pages.length; i++) {
    const data = parsedData[i];
    const page = pages[i];
    const name = names[i];

    if (!data) {
      console.log(`⚠ No data for: ${name}`);
      continue;
    }

    const updates = buildUpdates(page, data);

    if (!Object.keys(updates).length) {
      console.log(`⊘ Skipped ${name} - all fields already filled`);
      continue;
    }

    await updatePage(page, updates);
    console.log(`✓ Updated ${Object.keys(updates).length} fields for: ${name}`);
  }
};