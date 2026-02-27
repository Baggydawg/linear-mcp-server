/**
 * TOON (Token-Oriented Object Notation) Encoder
 *
 * Encodes structured data into the TOON format for token-efficient LLM output.
 * Handles escaping, truncation, and graceful fallback to JSON on encoding failure.
 *
 * Format specification:
 * - Schema header: `name[count]{field1,field2,...}:`
 * - Data rows: `  value1,value2,...` (indented with 2 spaces)
 * - Lookup tables prefixed with `_` (e.g., `_users`, `_states`)
 */

import { ToonEncodingError } from './errors.js';
import type {
  ToonEncodingOptions,
  ToonEncodingResult,
  ToonFallbackResponse,
  ToonMeta,
  ToonResponse,
  ToonRow,
  ToonSchema,
  ToonSection,
  ToonValue,
} from './types.js';

/**
 * Default encoding options.
 */
const DEFAULT_OPTIONS: Required<ToonEncodingOptions> = {
  indent: '  ',
  includeEmptySections: false,
  truncation: {
    title: 500,
    desc: 3000,
    default: undefined,
  },
  truncationIndicator: '... [truncated]',
};

/**
 * Characters that require quoting in TOON values.
 */
const QUOTE_TRIGGERS = /[,"\n\r\\]/;

/**
 * Encode a single value for TOON output.
 *
 * Escaping rules:
 * 1. Commas in values: Wrap in double quotes
 * 2. Quotes in values: Escape with backslash \"
 * 3. Backslashes in values: Escape with backslash \\
 * 4. Newlines in values: Replace with \n literal
 * 5. Empty values: Return empty string (blank between commas)
 * 6. Boolean values: Use true/false lowercase
 *
 * @param value - The value to encode
 * @returns Encoded string safe for TOON output
 */
export function encodeToonValue(value: ToonValue): string {
  // Handle null/undefined as empty
  if (value === null || value === undefined) {
    return '';
  }

  // Handle booleans as lowercase true/false
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  // Handle numbers directly
  if (typeof value === 'number') {
    // Handle special numeric values
    if (Number.isNaN(value)) {
      return '';
    }
    if (!Number.isFinite(value)) {
      return '';
    }
    return String(value);
  }

  // Handle Date objects
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return '';
    }
    return value.toISOString();
  }

  // Handle arrays (comma-separated within quotes if needed)
  if (Array.isArray(value)) {
    // Filter out null/undefined, encode each value, join with commas
    const encoded = value
      .filter((v) => v !== null && v !== undefined)
      .map((v) => {
        if (typeof v === 'string') {
          // For array items, just escape quotes and backslashes
          return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        }
        return String(v);
      })
      .join(',');

    // Arrays with commas need quoting
    if (encoded.includes(',')) {
      return `"${encoded}"`;
    }
    return encoded;
  }

  // Handle strings
  const str = String(value);

  // Empty string stays empty
  if (str === '') {
    return '';
  }

  // Check if value needs quoting
  if (QUOTE_TRIGGERS.test(str)) {
    // Step 1: Escape backslashes first (must be done before other escapes)
    let escaped = str.replace(/\\/g, '\\\\');

    // Step 2: Escape double quotes
    escaped = escaped.replace(/"/g, '\\"');

    // Step 3: Replace newlines with \n literal
    escaped = escaped.replace(/\r\n/g, '\\n').replace(/[\r\n]/g, '\\n');

    // Wrap in quotes
    return `"${escaped}"`;
  }

  return str;
}

/**
 * Strip markdown image syntax from text and replace with image count.
 *
 * Markdown images: ![alt text](url)
 * Linear uploads: ![](https://uploads.linear.app/...)
 *
 * @param text - The text to process
 * @returns Text with images stripped and count appended if any were removed
 *
 * @example
 * stripMarkdownImages("See ![screenshot](https://...) here")
 * // Returns: "See  here [1 image]"
 */
export function stripMarkdownImages(text: string | null | undefined): string | null {
  if (!text) {
    return text === '' ? '' : null;
  }

  // Pattern: ![optional alt text](url)
  const imagePattern = /!\[[^\]]*\]\([^)]+\)/g;

  // Count matches
  const matches = text.match(imagePattern);
  const imageCount = matches?.length ?? 0;

  if (imageCount === 0) {
    return text;
  }

  // Strip images
  let result = text.replace(imagePattern, '');

  // Clean up multiple consecutive spaces left by removal
  result = result.replace(/ {2,}/g, ' ');

  // Append count
  const suffix = imageCount === 1 ? '[1 image]' : `[${imageCount} images]`;

  // If the result is just whitespace, return just the suffix
  if (result.trim() === '') {
    return suffix;
  }

  return `${result.trimEnd()} ${suffix}`;
}

/**
 * Strip Linear issue URLs from text and replace with bare identifiers.
 *
 * Handles three formats:
 * - Markdown links: [text](https://linear.app/.../SQT-297/slug) → SQT-297
 * - Angle-bracket links: [url](<url>) → identifier (Linear's cross-team format)
 * - Bare URLs: https://linear.app/ws/issue/SQT-297/some-slug → SQT-297
 *
 * Preserves markdown links with custom text (non-identifier link text).
 *
 * @param text - The text to process
 * @returns Text with Linear issue URLs replaced by identifiers
 */
export function stripIssueUrls(text: string | null | undefined): string | null {
  if (!text) {
    return text === '' ? '' : null;
  }

  let result = text;

  // 1. Handle markdown links where URL is a Linear issue URL
  //    [SQT-297](https://linear.app/ws/issue/SQT-297/slug) → SQT-297
  //    [custom text](https://linear.app/ws/issue/SQT-297) → preserved via placeholder
  const placeholders: string[] = [];
  const PH_PRE = '\u200B\u200BMDLNK';
  const PH_SUF = '\u200B\u200B';
  result = result.replace(
    /\[([^\]]*)\]\(<?https?:\/\/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)(?:\/[^)>]*)?>?\)/gi,
    (match, linkText: string, identifier: string) => {
      const upperIdentifier = identifier.toUpperCase();
      // If link text matches the identifier, collapse to just the identifier
      if (linkText.toUpperCase() === upperIdentifier) {
        return upperIdentifier;
      }
      // If link text is a Linear URL for the same issue, collapse
      // (Linear returns cross-team refs as [url](<url>))
      const urlMatch = linkText.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
      if (urlMatch && urlMatch[1].toUpperCase() === upperIdentifier) {
        return upperIdentifier;
      }
      // Custom link text — protect from step 2 with placeholder
      const idx = placeholders.length;
      placeholders.push(match);
      return `${PH_PRE}${idx}${PH_SUF}`;
    },
  );

  // 2. Handle bare Linear issue URLs (not inside protected markdown links)
  //    https://linear.app/ws/issue/SQT-297/some-slug → SQT-297
  result = result.replace(
    /https?:\/\/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)(?:\/[^\s)>\]]*)?/gi,
    (_match, identifier: string) => identifier.toUpperCase(),
  );

  // 3. Restore protected markdown links
  if (placeholders.length > 0) {
    const restorePattern = new RegExp(
      `${PH_PRE.replace(/\u200B/g, '\\u200B')}(\\d+)${PH_SUF.replace(/\u200B/g, '\\u200B')}`,
      'g',
    );
    result = result.replace(restorePattern, (_match, idx: string) => {
      return placeholders[parseInt(idx, 10)] ?? '';
    });
  }

  return result;
}

/**
 * Truncate a string value if it exceeds the maximum length.
 *
 * @param value - The value to potentially truncate
 * @param maxLength - Maximum allowed length (undefined = no limit)
 * @param indicator - Truncation indicator to append
 * @returns Original or truncated value
 */
function truncateValue(
  value: string,
  maxLength: number | undefined,
  indicator: string,
): string {
  if (maxLength === undefined || value.length <= maxLength) {
    return value;
  }

  // Truncate and append indicator
  const truncateAt = maxLength - indicator.length;
  if (truncateAt <= 0) {
    return indicator;
  }

  return value.slice(0, truncateAt) + indicator;
}

/**
 * Get the truncation limit for a field.
 */
function getTruncationLimit(
  fieldName: string,
  options: Required<ToonEncodingOptions>,
): number | undefined {
  const { truncation } = options;

  if (fieldName === 'title') {
    return truncation.title;
  }
  if (fieldName === 'desc' || fieldName === 'description') {
    return truncation.desc;
  }

  return truncation.default;
}

/**
 * Encode a single row of data according to a schema.
 *
 * @param row - Data object with field values
 * @param schema - Schema defining field order
 * @param options - Encoding options
 * @returns Encoded row string (without leading indent)
 */
export function encodeToonRow(
  row: ToonRow,
  schema: ToonSchema,
  options: Required<ToonEncodingOptions> = DEFAULT_OPTIONS,
): string {
  const values: string[] = [];

  for (const field of schema.fields) {
    let value = row[field];

    // Strip Linear issue URLs and markdown images from description fields
    if (
      (field === 'desc' || field === 'description' || field === 'body') &&
      typeof value === 'string'
    ) {
      value = stripIssueUrls(value);
      value = stripMarkdownImages(value);
    }

    let encoded = encodeToonValue(value);

    // Apply truncation for string values
    if (typeof value === 'string' && encoded !== '') {
      const limit = getTruncationLimit(field, options);
      if (limit !== undefined) {
        // Need to truncate before encoding to get accurate length
        const truncated = truncateValue(value, limit, options.truncationIndicator);
        if (truncated !== value) {
          // Re-encode the truncated value
          encoded = encodeToonValue(truncated);
        }
      }
    }

    values.push(encoded);
  }

  return values.join(',');
}

/**
 * Encode a complete TOON section (schema header + data rows).
 *
 * @param section - Section with schema and items
 * @param options - Encoding options
 * @returns Encoded section string
 */
export function encodeToonSection<T extends ToonRow>(
  section: ToonSection<T>,
  options: ToonEncodingOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { schema, items } = section;

  // Skip empty sections unless explicitly included
  if (items.length === 0 && !opts.includeEmptySections) {
    return '';
  }

  // Build header: name[count]{field1,field2,...}:
  const header = `${schema.name}[${items.length}]{${schema.fields.join(',')}}:`;

  // Build data rows
  const rows = items.map((item) => {
    const encoded = encodeToonRow(item as ToonRow, schema, opts);
    return `${opts.indent}${encoded}`;
  });

  return [header, ...rows].join('\n');
}

/**
 * Encode a metadata section.
 *
 * @param meta - Metadata fields and values
 * @param options - Encoding options
 * @returns Encoded metadata string
 */
export function encodeToonMeta(
  meta: ToonMeta,
  options: ToonEncodingOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Build header: _meta{field1,field2,...}:
  const header = `_meta{${meta.fields.join(',')}}:`;

  // Build value row
  const values = meta.fields.map((field) => {
    const value = meta.values[field];
    return encodeToonValue(value as ToonValue);
  });

  const row = `${opts.indent}${values.join(',')}`;

  return `${header}\n${row}`;
}

/**
 * Encode a complete TOON response with metadata, lookups, and data sections.
 *
 * @param response - Complete response structure
 * @param options - Encoding options
 * @returns Encoded TOON string
 */
export function encodeToon(
  response: ToonResponse,
  options: ToonEncodingOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sections: string[] = [];

  // 1. Encode metadata (always first if present)
  if (response.meta) {
    sections.push(encodeToonMeta(response.meta, opts));
  }

  // 2. Encode lookup tables
  if (response.lookups) {
    for (const lookup of response.lookups) {
      const encoded = encodeToonSection(lookup, opts);
      if (encoded) {
        sections.push(encoded);
      }
    }
  }

  // 3. Encode data sections
  if (response.data) {
    for (const data of response.data) {
      const encoded = encodeToonSection(data, opts);
      if (encoded) {
        sections.push(encoded);
      }
    }
  }

  return sections.join('\n\n');
}

/**
 * Safe wrapper that falls back to JSON on encoding failure.
 *
 * This ensures Claude always receives usable data, even if TOON
 * encoding encounters an edge case.
 *
 * @param data - Data to encode
 * @param response - TOON response structure
 * @param options - Encoding options
 * @returns TOON string or JSON fallback
 */
export function encodeResponse(
  data: unknown,
  response: ToonResponse,
  options: ToonEncodingOptions = {},
): string {
  try {
    return encodeToon(response, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown encoding error';
    console.error('TOON encoding failed, falling back to JSON:', error);

    const fallback: ToonFallbackResponse = {
      _fallback: 'json',
      _reason: reason,
      data,
    };

    return JSON.stringify(fallback, null, 2);
  }
}

/**
 * Encode a simple section directly from an array of items.
 * Convenience function for single-section responses.
 *
 * @param schemaName - Name for the section (e.g., 'issues', '_users')
 * @param fields - Ordered list of field names
 * @param items - Array of data items
 * @param options - Encoding options
 * @returns Encoded TOON section string
 */
export function encodeSimpleSection<T extends ToonRow>(
  schemaName: string,
  fields: string[],
  items: T[],
  options: ToonEncodingOptions = {},
): string {
  return encodeToonSection(
    {
      schema: { name: schemaName, fields },
      items,
    },
    options,
  );
}

/**
 * Validate that a row contains all schema fields.
 * Useful for debugging schema mismatches.
 *
 * @param row - Data row to validate
 * @param schema - Schema to validate against
 * @returns Array of missing field names (empty if valid)
 */
export function validateRowAgainstSchema(row: ToonRow, schema: ToonSchema): string[] {
  const missing: string[] = [];

  for (const field of schema.fields) {
    if (!(field in row)) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Safely encode with validation and detailed error reporting.
 *
 * @param response - TOON response to encode
 * @param options - Encoding options
 * @returns Encoding result with success/failure status
 */
export function safeEncode(
  response: ToonResponse,
  options: ToonEncodingOptions = {},
): ToonEncodingResult {
  try {
    // Validate all sections before encoding
    const allSections = [...(response.lookups || []), ...(response.data || [])];

    for (const section of allSections) {
      for (let i = 0; i < section.items.length; i++) {
        const row = section.items[i] as ToonRow;
        const missing = validateRowAgainstSchema(row, section.schema);

        if (missing.length > 0) {
          throw new ToonEncodingError({
            code: 'FIELD_MISMATCH',
            message: `Row ${i} in section '${section.schema.name}' is missing fields: ${missing.join(', ')}`,
            hint: 'Ensure data objects have all fields defined in schema',
            schemaName: section.schema.name,
            rowIndex: i,
          });
        }
      }
    }

    const output = encodeToon(response, options);
    return { success: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Format priority for TOON output with 'p' prefix.
 * @example formatPriorityToon(1) // "p1"
 */
export function formatPriorityToon(priority: number | null | undefined): string | null {
  return priority !== null && priority !== undefined ? `p${priority}` : null;
}

/**
 * Format estimate for TOON output with 'e' prefix.
 * @example formatEstimateToon(5) // "e5"
 */
export function formatEstimateToon(estimate: number | null | undefined): string | null {
  return estimate !== null && estimate !== undefined ? `e${estimate}` : null;
}

/**
 * Format cycle number for TOON output with 'c' prefix.
 * @example formatCycleToon(5) // "c5"
 */
export function formatCycleToon(cycleNumber: number | null | undefined): string | null {
  return cycleNumber !== null && cycleNumber !== undefined ? `c${cycleNumber}` : null;
}
