/**
 * TOON (Token-Oriented Object Notation) Parser
 *
 * Parses TOON-formatted text back into structured data for live data
 * validation tests. This is the inverse of the TOON encoder.
 *
 * Format reference:
 * - Meta header:   `_meta{field1,field2}:`       (no count bracket)
 * - Data header:   `name[count]{field1,field2}:`  (with count bracket)
 * - Data rows:     `  value1,value2,...`           (2-space indent)
 * - Sections separated by blank lines
 * - Backslash escaping: \" for quotes, \\ for backslash, \n for newlines
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A parsed TOON section with header metadata and row data. */
export interface ParsedSection {
  /** Section name (e.g., "_meta", "_users", "issues") */
  name: string;
  /** Row count from header bracket, undefined for _meta sections */
  count: number | undefined;
  /** Ordered field names from the header */
  fields: string[];
  /** Parsed data rows, each as a field-name-to-value record */
  rows: Record<string, string>[];
}

/** Result of parsing a complete TOON text block. */
export interface ParsedToon {
  /** The _meta section flattened to a key-value record */
  meta: Record<string, string>;
  /** All sections (including _meta) keyed by section name */
  sections: Map<string, ParsedSection>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value Splitting State Machine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a TOON data row into individual field values.
 *
 * Uses a character-by-character state machine to handle:
 * - Comma delimiters outside quotes
 * - Quoted values containing commas (e.g., `"value,with,commas"`)
 * - Backslash escape sequences: `\"` `\\` `\n`
 *
 * @param line - A single TOON data row (without leading indent)
 * @returns Array of decoded string values
 */
export function splitToonValues(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let state: 'NORMAL' | 'QUOTED' | 'ESCAPE' = 'NORMAL';

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (state === 'ESCAPE') {
      // Process escape sequence inside a quoted value
      if (ch === 'n') {
        current += '\n';
      } else if (ch === '\\') {
        current += '\\';
      } else if (ch === '"') {
        current += '"';
      } else {
        // Unknown escape: keep literal
        current += ch;
      }
      state = 'QUOTED';
    } else if (state === 'QUOTED') {
      if (ch === '\\') {
        state = 'ESCAPE';
      } else if (ch === '"') {
        state = 'NORMAL';
      } else {
        current += ch;
      }
    } else {
      // NORMAL state
      if (ch === ',') {
        values.push(current);
        current = '';
      } else if (ch === '"' && current === '') {
        // Opening quote at start of a value
        state = 'QUOTED';
      } else {
        current += ch;
      }
    }
  }

  // Push the final value (there is always at least one)
  values.push(current);

  return values;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Header Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Regex for parsing TOON section headers.
 *
 * Matches both formats:
 * - `_meta{field1,field2}:`          — meta section, no count bracket
 * - `name[count]{field1,field2}:`    — data section, with count bracket
 *
 * Groups:
 * 1. Section name (e.g., "_meta", "_users", "issues")
 * 2. Optional count (e.g., "3")
 * 3. Comma-separated field names (e.g., "key,name,email")
 */
const HEADER_RE = /^(\S+?)(?:\[(\d+)\])?\{([^}]+)\}:\s*$/;

interface ParsedHeader {
  name: string;
  count: number | undefined;
  fields: string[];
}

/**
 * Parse a TOON section header line.
 *
 * @param line - The header line to parse
 * @returns Parsed header or null if the line is not a valid header
 */
function parseHeader(line: string): ParsedHeader | null {
  const match = HEADER_RE.exec(line);
  if (!match) {
    return null;
  }

  return {
    name: match[1],
    count: match[2] !== undefined ? Number.parseInt(match[2], 10) : undefined,
    fields: match[3].split(','),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a complete TOON text block into structured data.
 *
 * Handles:
 * - Meta sections (no count bracket, single data row)
 * - Data sections with count brackets and multiple rows
 * - Empty sections (header only, zero rows)
 * - Trailing whitespace and newlines
 *
 * @param text - Raw TOON text output from the MCP server
 * @returns Parsed structure with meta key-values and all sections
 * @throws Error if the text is JSON fallback or contains no valid sections
 */
export function parseToonText(text: string): ParsedToon {
  // Detect JSON fallback
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    throw new Error('Received JSON fallback instead of TOON output');
  }

  const sections = new Map<string, ParsedSection>();
  let meta: Record<string, string> = {};

  // Split on blank lines to get section blocks
  const blocks = trimmed.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length === 0) continue;

    // First line is the header
    const headerLine = lines[0].trim();
    if (!headerLine) continue;

    const header = parseHeader(headerLine);
    if (!header) continue;

    // Remaining lines are data rows (strip 2-space indent)
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i];
      // Strip the 2-space indent
      const dataLine = rawLine.startsWith('  ') ? rawLine.slice(2) : rawLine.trim();
      if (dataLine === '') continue;

      const values = splitToonValues(dataLine);
      const row: Record<string, string> = {};
      for (let f = 0; f < header.fields.length; f++) {
        row[header.fields[f]] = f < values.length ? values[f] : '';
      }
      rows.push(row);
    }

    const section: ParsedSection = {
      name: header.name,
      count: header.count,
      fields: header.fields,
      rows,
    };

    sections.set(header.name, section);

    // If this is the _meta section, flatten to key-value record
    if (header.name === '_meta' && rows.length > 0) {
      meta = { ...rows[0] };
    }
  }

  return { meta, sections };
}
