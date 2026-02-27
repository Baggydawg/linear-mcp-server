/**
 * Tests for auto-link issue references (write path) and strip issue URLs (read path).
 *
 * Write path: autoLinkIssueReferences / autoLinkWithRegistry
 *   Converts bare issue identifiers (SQT-297) to full Linear URLs.
 *
 * Read path: stripIssueUrls
 *   Converts Linear URLs back to bare identifiers for TOON output.
 */

import { describe, expect, it } from 'vitest';
import {
  autoLinkIssueReferences,
  autoLinkWithRegistry,
} from '../../../src/shared/tools/linear/shared/auto-link.js';
import { stripIssueUrls } from '../../../src/shared/toon/encoder.js';
import type { ShortKeyRegistry } from '../../../src/shared/toon/registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Standard team keys used across tests. */
const TEAM_KEYS = new Set(['SQT', 'SQM', 'DO', 'SQO']);

/** Workspace URL key for constructing Linear URLs. */
const URL_KEY = 'ws';

/** Shorthand for autoLinkIssueReferences with standard test params. */
function autoLink(text: string): string {
  return autoLinkIssueReferences(text, URL_KEY, TEAM_KEYS);
}

/** Build a Linear issue URL. */
function issueUrl(identifier: string): string {
  return `https://linear.app/${URL_KEY}/issue/${identifier}`;
}

/**
 * Create a minimal mock ShortKeyRegistry for autoLinkWithRegistry tests.
 */
function createMockRegistry(
  urlKey?: string,
  teamKeysMap?: Map<string, string>,
): ShortKeyRegistry {
  return {
    users: new Map(),
    states: new Map(),
    projects: new Map(),
    usersByUuid: new Map(),
    statesByUuid: new Map(),
    projectsByUuid: new Map(),
    userMetadata: new Map(),
    stateMetadata: new Map(),
    projectMetadata: new Map(),
    generatedAt: new Date(),
    workspaceId: 'test-workspace',
    teamKeys:
      teamKeysMap ??
      new Map([
        ['team-1', 'sqt'],
        ['team-2', 'sqm'],
        ['team-3', 'do'],
        ['team-4', 'sqo'],
      ]),
    urlKey,
  } as ShortKeyRegistry;
}

// ─────────────────────────────────────────────────────────────────────────────
// autoLinkIssueReferences (write path)
// ─────────────────────────────────────────────────────────────────────────────

describe('autoLinkIssueReferences', () => {
  describe('basic linking', () => {
    it('links a single identifier', () => {
      expect(autoLink('See SQT-297')).toBe(`See ${issueUrl('SQT-297')}`);
    });

    it('links multiple identifiers', () => {
      expect(autoLink('SQT-297 and SQM-450')).toBe(
        `${issueUrl('SQT-297')} and ${issueUrl('SQM-450')}`,
      );
    });

    it('links identifiers from different teams', () => {
      const text = 'DO-10 SQO-99 SQM-1 SQT-500';
      const expected = [
        issueUrl('DO-10'),
        issueUrl('SQO-99'),
        issueUrl('SQM-1'),
        issueUrl('SQT-500'),
      ].join(' ');
      expect(autoLink(text)).toBe(expected);
    });

    it('converts lowercase identifiers to uppercase in URL', () => {
      expect(autoLink('see sqt-297')).toBe(`see ${issueUrl('SQT-297')}`);
    });

    it('converts mixed-case identifiers to uppercase in URL', () => {
      expect(autoLink('Sqt-100')).toBe(issueUrl('SQT-100'));
    });

    it('links identifier at start of text', () => {
      expect(autoLink('SQT-1 is important')).toBe(`${issueUrl('SQT-1')} is important`);
    });

    it('links identifier at end of text', () => {
      expect(autoLink('blocked by SQT-1')).toBe(`blocked by ${issueUrl('SQT-1')}`);
    });

    it('links identifier in the middle of text', () => {
      expect(autoLink('Issue SQT-1 needs review')).toBe(
        `Issue ${issueUrl('SQT-1')} needs review`,
      );
    });
  });

  describe('protected regions', () => {
    it('does not link inside markdown link text', () => {
      const text = '[See SQT-297](https://example.com)';
      expect(autoLink(text)).toBe(text);
    });

    it('does not link inside markdown link URL', () => {
      const text = '[link](https://linear.app/ws/issue/SQT-297)';
      expect(autoLink(text)).toBe(text);
    });

    it('does not link inside bare URL', () => {
      const text = 'https://linear.app/workspace/issue/SQT-297';
      expect(autoLink(text)).toBe(text);
    });

    it('does not link inside inline code', () => {
      const text = '`SQT-297`';
      expect(autoLink(text)).toBe(text);
    });

    it('does not link inside fenced code block', () => {
      const text = '```\nSQT-297\n```';
      expect(autoLink(text)).toBe(text);
    });

    it('links identifiers adjacent to but outside a markdown link', () => {
      const text = 'SQT-297 [link](https://example.com) SQT-298';
      expect(autoLink(text)).toBe(
        `${issueUrl('SQT-297')} [link](https://example.com) ${issueUrl('SQT-298')}`,
      );
    });

    it('does not link inside inline code with surrounding text', () => {
      const text = 'Check `SQT-123` for details';
      expect(autoLink(text)).toBe(text);
    });

    it('does not link inside fenced code block with language tag', () => {
      const text = '```ts\nconst id = "SQT-297";\n```';
      expect(autoLink(text)).toBe(text);
    });

    it('does not link inside angle-bracket markdown link', () => {
      const text =
        '[https://linear.app/ws/issue/SQM-1](<https://linear.app/ws/issue/SQM-1>)';
      expect(autoLink(text)).toBe(text);
    });
  });

  describe('unknown teams', () => {
    it('does not link identifiers from unknown teams', () => {
      const text = 'ABC-123 is unrelated';
      expect(autoLink(text)).toBe(text);
    });

    it('links known team but leaves unknown team unchanged', () => {
      const text = 'SQT-1 and ABC-123';
      expect(autoLink(text)).toBe(`${issueUrl('SQT-1')} and ABC-123`);
    });
  });

  describe('edge cases', () => {
    it('returns empty string unchanged', () => {
      expect(autoLink('')).toBe('');
    });

    it('returns text without identifiers unchanged', () => {
      const text = 'No issue references here.';
      expect(autoLink(text)).toBe(text);
    });

    it('links identifier inside parentheses', () => {
      expect(autoLink('(SQT-297)')).toBe(`(${issueUrl('SQT-297')})`);
    });

    it('links multiple occurrences of the same identifier', () => {
      expect(autoLink('SQT-1 and SQT-1')).toBe(
        `${issueUrl('SQT-1')} and ${issueUrl('SQT-1')}`,
      );
    });

    it('returns text unchanged when teamKeys is empty', () => {
      const text = 'SQT-297';
      expect(autoLinkIssueReferences(text, URL_KEY, new Set())).toBe(text);
    });

    it('does not link identifier embedded in a longer word', () => {
      expect(autoLink('NOSQT-297 and SQT-297abc')).toBe('NOSQT-297 and SQT-297abc');
    });

    it('is idempotent (no double-linking)', () => {
      const once = autoLink('SQT-297');
      const twice = autoLink(once);
      expect(twice).toBe(once);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stripIssueUrls (read path)
// ─────────────────────────────────────────────────────────────────────────────

describe('stripIssueUrls', () => {
  describe('bare URLs', () => {
    it('strips a single bare Linear URL', () => {
      expect(stripIssueUrls('See https://linear.app/ws/issue/SQT-297')).toBe(
        'See SQT-297',
      );
    });

    it('strips a bare URL with a title slug', () => {
      expect(
        stripIssueUrls('See https://linear.app/ws/issue/SQT-297/some-title-slug'),
      ).toBe('See SQT-297');
    });

    it('strips multiple bare URLs', () => {
      expect(
        stripIssueUrls(
          'Check https://linear.app/ws/issue/SQT-1 and https://linear.app/ws/issue/SQM-2',
        ),
      ).toBe('Check SQT-1 and SQM-2');
    });
  });

  describe('markdown links', () => {
    it('strips markdown link where text matches identifier', () => {
      expect(
        stripIssueUrls('[SQT-297](https://linear.app/ws/issue/SQT-297/slug)'),
      ).toBe('SQT-297');
    });

    it('preserves markdown link with custom text', () => {
      // Custom link text — user deliberately chose different text, keep the full link
      const text = '[custom text](https://linear.app/ws/issue/SQT-297)';
      expect(stripIssueUrls(text)).toBe(text);
    });

    it('strips markdown link with case-insensitive identifier match', () => {
      expect(stripIssueUrls('[sqt-297](https://linear.app/ws/issue/SQT-297)')).toBe(
        'SQT-297',
      );
    });
  });

  describe('angle-bracket URL references (Linear cross-team format)', () => {
    it('strips [url](<url>) where both are same Linear issue URL', () => {
      expect(
        stripIssueUrls(
          '[https://linear.app/ws/issue/SQM-1](<https://linear.app/ws/issue/SQM-1>)',
        ),
      ).toBe('SQM-1');
    });

    it('strips [url](<url>) with slug in link text', () => {
      expect(
        stripIssueUrls(
          '[https://linear.app/ws/issue/SQM-1/some-title](<https://linear.app/ws/issue/SQM-1>)',
        ),
      ).toBe('SQM-1');
    });

    it('preserves [custom text](<url>) with angle-bracket URL', () => {
      const text = '[custom text](<https://linear.app/ws/issue/SQT-160>)';
      expect(stripIssueUrls(text)).toBe(text);
    });

    it('strips actual Linear API cross-team format in context', () => {
      expect(
        stripIssueUrls(
          'Blocked by [https://linear.app/sophiq/issue/SQM-1](<https://linear.app/sophiq/issue/SQM-1>). Also related to [DO-10](https://linear.app/sophiq/issue/DO-10).',
        ),
      ).toBe('Blocked by SQM-1. Also related to DO-10.');
    });
  });

  describe('non-Linear URLs', () => {
    it('leaves non-Linear URLs unchanged', () => {
      const text = 'https://example.com/SQT-297';
      expect(stripIssueUrls(text)).toBe(text);
    });
  });

  describe('null/empty handling', () => {
    it('returns null for null input', () => {
      expect(stripIssueUrls(null)).toBe(null);
    });

    it('returns null for undefined input', () => {
      expect(stripIssueUrls(undefined)).toBe(null);
    });

    it('returns empty string for empty string input', () => {
      expect(stripIssueUrls('')).toBe('');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// autoLinkWithRegistry (graceful degradation)
// ─────────────────────────────────────────────────────────────────────────────

describe('autoLinkWithRegistry', () => {
  const text = 'See SQT-297';

  it('returns text unchanged when registry is null', () => {
    expect(autoLinkWithRegistry(text, null)).toBe(text);
  });

  it('returns text unchanged when registry is undefined', () => {
    expect(autoLinkWithRegistry(text, undefined)).toBe(text);
  });

  it('returns text unchanged when registry has no urlKey', () => {
    const registry = createMockRegistry(undefined);
    expect(autoLinkWithRegistry(text, registry)).toBe(text);
  });

  it('transforms text when registry has urlKey and teamKeys', () => {
    const registry = createMockRegistry('ws');
    expect(autoLinkWithRegistry(text, registry)).toBe(`See ${issueUrl('SQT-297')}`);
  });

  it('returns text unchanged when registry has urlKey but empty teamKeys', () => {
    const registry = createMockRegistry('ws', new Map());
    expect(autoLinkWithRegistry('SQT-297', registry)).toBe('SQT-297');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip tests (write -> read)
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: autoLink then stripIssueUrls', () => {
  it('single identifier round-trips cleanly', () => {
    const original = 'blocked by SQT-123';
    const linked = autoLink(original);
    expect(linked).not.toBe(original); // sanity: was actually linked
    expect(stripIssueUrls(linked)).toBe('blocked by SQT-123');
  });

  it('multiple identifiers round-trip cleanly', () => {
    const original = 'SQT-1 depends on SQM-2';
    const linked = autoLink(original);
    expect(stripIssueUrls(linked)).toBe('SQT-1 depends on SQM-2');
  });

  it('mixed content with protected regions round-trips cleanly', () => {
    const original = 'SQT-1 see `SQT-2` and SQT-3';
    const linked = autoLink(original);
    // SQT-1 and SQT-3 were linked, SQT-2 was protected
    expect(linked).toContain(issueUrl('SQT-1'));
    expect(linked).toContain('`SQT-2`');
    expect(linked).toContain(issueUrl('SQT-3'));
    // After stripping, we get back the original identifiers
    expect(stripIssueUrls(linked)).toBe(original);
  });

  it('text without identifiers round-trips unchanged', () => {
    const original = 'No issues here.';
    const linked = autoLink(original);
    expect(stripIssueUrls(linked)).toBe(original);
  });
});
