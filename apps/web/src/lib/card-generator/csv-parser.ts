import type { Card, CardType, ParsedCSVResult } from "./types";

const VALID_CARD_TYPES: CardType[] = [
  "action",
  "task",
  "event",
  "role",
  "badge",
  "resource",
  "vibe",
];

export function parseCSV(csvText: string): ParsedCSVResult {
  const cards: Card[] = [];
  const errors: string[] = [];

  const lines = csvText.trim().split(/\r?\n/);

  if (lines.length < 2) {
    errors.push("CSV must have at least a header row and one data row");
    return { cards, errors };
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map((h) => h.toLowerCase().trim());

  // Validate required headers
  const requiredHeaders = ["id", "title", "type", "description"];
  const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));

  if (missingHeaders.length > 0) {
    errors.push(`Missing required columns: ${missingHeaders.join(", ")}`);
    return { cards, errors };
  }

  const idIndex = headers.indexOf("id");
  const titleIndex = headers.indexOf("title");
  const typeIndex = headers.indexOf("type");
  const descriptionIndex = headers.indexOf("description");
  const imageUrlIndex = headers.indexOf("imageurl");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const rowNumber = i + 1;

    const id = values[idIndex]?.trim() || "";
    const title = values[titleIndex]?.trim() || "";
    const rawType = values[typeIndex]?.trim().toLowerCase() || "";
    const description = values[descriptionIndex]?.trim() || "";
    const imageUrl =
      imageUrlIndex >= 0 ? values[imageUrlIndex]?.trim() || "" : "";

    // Validate required fields
    if (!id) {
      errors.push(`Row ${rowNumber}: Missing id`);
      continue;
    }
    if (!title) {
      errors.push(`Row ${rowNumber}: Missing title`);
      continue;
    }
    if (!rawType) {
      errors.push(`Row ${rowNumber}: Missing type`);
      continue;
    }

    // Validate type
    const type = rawType as CardType;
    if (!VALID_CARD_TYPES.includes(type)) {
      errors.push(
        `Row ${rowNumber}: Invalid type "${rawType}". Must be one of: ${VALID_CARD_TYPES.join(", ")}`,
      );
      continue;
    }

    cards.push({
      id,
      title,
      type,
      description,
      imageUrl: imageUrl || undefined,
    });
  }

  return { cards, errors };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
      } else if (char === ",") {
        // Field separator
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }

  // Add the last field
  result.push(current);

  return result;
}

export function generateSampleCSV(): string {
  return `id,title,type,description,imageUrl
1,Clean Kitchen,action,Keep the kitchen tidy and organized,
2,Weekly Team Sync,event,Every Monday at 10am,
3,Project Lead,role,Oversees project timeline and deliverables,
4,First Contribution,badge,Awarded for first completed task,
5,Meeting Room,resource,Conference room on 2nd floor,
6,Good Vibes,vibe,Spread positivity in the workspace,`;
}
