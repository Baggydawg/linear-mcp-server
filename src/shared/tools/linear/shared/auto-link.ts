/**
 * Auto-Link Issue References
 *
 * Write path: Converts bare issue identifiers (SQT-297) to full Linear URLs
 * that render as rich clickable mention buttons in Linear's UI.
 *
 * Read path (stripIssueUrls) lives in encoder.ts alongside stripMarkdownImages.
 */

import type { ShortKeyRegistry } from '../../../toon/registry.js';

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace bare issue identifiers with full Linear URLs.
 *
 * Only replaces identifiers matching known team keys.
 * Skips identifiers inside markdown links, URLs, inline code, or fenced code blocks.
 *
 * @param text - The text to transform
 * @param urlKey - Workspace URL slug (e.g., 'sophiq-tech')
 * @param teamKeys - Set of known team keys (uppercase, e.g., 'SQT', 'SQM')
 * @returns Text with issue identifiers replaced by Linear URLs
 */
export function autoLinkIssueReferences(
  text: string,
  urlKey: string,
  teamKeys: Set<string>,
): string {
  if (!text || teamKeys.size === 0) return text;

  // Build team keys pattern with escapeRegExp for safety
  const teamPattern = Array.from(teamKeys).map(escapeRegExp).join('|');

  // Sequential masking approach:
  // 1. Find all protected regions and replace with placeholders
  // 2. Run the identifier replacement on the masked text
  // 3. Restore protected regions

  const placeholders: string[] = [];
  let masked = text;

  // Sentinel for placeholder markers — uses a pattern unlikely to appear in user text
  const PH_PREFIX = '\u200B\u200BPROT';
  const PH_SUFFIX = '\u200B\u200B';

  function mask(pattern: RegExp): void {
    masked = masked.replace(pattern, (match) => {
      const idx = placeholders.length;
      placeholders.push(match);
      return `${PH_PREFIX}${idx}${PH_SUFFIX}`;
    });
  }

  // Order matters: highest precedence first
  // 1. Fenced code blocks (```...```)
  mask(/```[\s\S]*?```/g);
  // 2. Inline code (`...`)
  mask(/`[^`]+`/g);
  // 3. Markdown links [text](url) — protect both text and URL parts
  mask(/\[[^\]]*\]\([^)]*\)/g);
  // 4. Bare URLs
  mask(/https?:\/\/[^\s)>\]]+/g);

  // Now replace bare issue identifiers in the unprotected text
  const identifierPattern = new RegExp(`\\b(${teamPattern})-(\\d+)\\b`, 'gi');

  masked = masked.replace(identifierPattern, (_match, team: string, num: string) => {
    const upperTeam = team.toUpperCase();
    return `https://linear.app/${urlKey}/issue/${upperTeam}-${num}`;
  });

  // Restore protected regions
  const restorePattern = new RegExp(
    `${PH_PREFIX.replace(/\u200B/g, '\\u200B')}(\\d+)${PH_SUFFIX.replace(/\u200B/g, '\\u200B')}`,
    'g',
  );
  masked = masked.replace(restorePattern, (_match, idx: string) => {
    return placeholders[parseInt(idx, 10)] ?? '';
  });

  return masked;
}

/**
 * Convenience wrapper that extracts urlKey and teamKeys from the registry.
 * Returns original text unchanged if registry data is missing (graceful degradation).
 *
 * @param text - The text to transform
 * @param registry - The short key registry (may be null/undefined)
 * @returns Text with issue identifiers replaced by Linear URLs, or original text
 */
export function autoLinkWithRegistry(
  text: string,
  registry: ShortKeyRegistry | null | undefined,
): string {
  if (!registry?.urlKey) return text;

  // Build Set of known team keys (uppercase) from registry.teamKeys values
  const teamKeys = new Set<string>();
  for (const key of registry.teamKeys.values()) {
    teamKeys.add(key.toUpperCase());
  }

  if (teamKeys.size === 0) return text;

  return autoLinkIssueReferences(text, registry.urlKey, teamKeys);
}
