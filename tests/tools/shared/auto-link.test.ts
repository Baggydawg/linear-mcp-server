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
  autoLinkProjectReferences,
  autoLinkWithRegistry,
} from '../../../src/shared/tools/linear/shared/auto-link.js';
import { stripIssueUrls, stripProjectUrls } from '../../../src/shared/toon/encoder.js';
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
    projectsBySlugId: new Map(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Project Auto-Link Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map of project short key to slugId for autoLinkProjectReferences tests. */
const PROJECT_KEY_TO_SLUG = new Map([
  ['pr0', 'mvp-platform-abc123'],
  ['pr71', 'design-system-def456'],
]);

/** Map of project slugId to short key for stripProjectUrls tests.
 *  Includes full slugs, hash suffixes, and lowercase project names
 *  to match the enriched projectsBySlugId map. */
const SLUG_TO_SHORT_KEY = new Map([
  ['mvp-platform-abc123', 'pr0'], // full slug
  ['abc123', 'pr0'], // hash suffix
  ['mvp platform', 'pr0'], // lowercase name
  ['design-system-def456', 'pr71'], // full slug
  ['def456', 'pr71'], // hash suffix
  ['design system', 'pr71'], // lowercase name
]);

/** Build a Linear project URL. */
function projectUrl(slugId: string): string {
  return `https://linear.app/${URL_KEY}/project/${slugId}`;
}

/**
 * Create a mock registry with project entries for autoLinkWithRegistry tests.
 */
function createMockRegistryWithProjects(urlKey?: string): ShortKeyRegistry {
  const registry = createMockRegistry(urlKey);
  // Add project entries
  registry.projects.set('pr0', 'proj-uuid-1');
  registry.projects.set('pr71', 'proj-uuid-2');
  registry.projectsByUuid.set('proj-uuid-1', 'pr0');
  registry.projectsByUuid.set('proj-uuid-2', 'pr71');
  registry.projectsBySlugId.set('mvp-platform-abc123', 'pr0');
  registry.projectsBySlugId.set('design-system-def456', 'pr71');
  registry.projectMetadata.set('proj-uuid-1', {
    name: 'MVP Platform',
    state: 'started',
    slugId: 'mvp-platform-abc123',
  });
  registry.projectMetadata.set('proj-uuid-2', {
    name: 'Design System',
    state: 'planned',
    slugId: 'design-system-def456',
  });
  return registry;
}

// ─────────────────────────────────────────────────────────────────────────────
// autoLinkProjectReferences (write path)
// ─────────────────────────────────────────────────────────────────────────────

describe('autoLinkProjectReferences', () => {
  /** Shorthand for autoLinkProjectReferences with standard test params. */
  function autoLinkProject(text: string): string {
    return autoLinkProjectReferences(text, URL_KEY, PROJECT_KEY_TO_SLUG);
  }

  describe('basic linking', () => {
    it('links a single project reference', () => {
      expect(autoLinkProject('See pr0')).toBe(
        `See ${projectUrl('mvp-platform-abc123')}`,
      );
    });

    it('links multiple project references', () => {
      expect(autoLinkProject('pr0 and pr71')).toBe(
        `${projectUrl('mvp-platform-abc123')} and ${projectUrl('design-system-def456')}`,
      );
    });

    it('converts uppercase PR71 to URL (case insensitive)', () => {
      expect(autoLinkProject('See PR71')).toBe(
        `See ${projectUrl('design-system-def456')}`,
      );
    });

    it('links project at start of text', () => {
      expect(autoLinkProject('pr0 is important')).toBe(
        `${projectUrl('mvp-platform-abc123')} is important`,
      );
    });

    it('links project at end of text', () => {
      expect(autoLinkProject('blocked by pr71')).toBe(
        `blocked by ${projectUrl('design-system-def456')}`,
      );
    });

    it('links project in the middle of text', () => {
      expect(autoLinkProject('Project pr0 needs review')).toBe(
        `Project ${projectUrl('mvp-platform-abc123')} needs review`,
      );
    });
  });

  describe('protected regions', () => {
    it('does not link inside markdown link text', () => {
      const text = '[See pr0](https://example.com)';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('does not link inside markdown link URL', () => {
      const text = '[link](https://linear.app/ws/project/pr0)';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('does not link inside bare URL', () => {
      const text = 'https://linear.app/workspace/project/pr0';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('does not link inside inline code', () => {
      const text = '`pr0`';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('does not link inside fenced code block', () => {
      const text = '```\npr0\n```';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('links identifiers adjacent to but outside protected regions', () => {
      const text = 'pr0 [link](https://example.com) pr71';
      expect(autoLinkProject(text)).toBe(
        `${projectUrl('mvp-platform-abc123')} [link](https://example.com) ${projectUrl('design-system-def456')}`,
      );
    });
  });

  describe('false positive prevention', () => {
    it('does not link expr71 (letters before pr)', () => {
      const text = 'expr71 is a variable';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('does not link improve0 (letters before pr)', () => {
      const text = 'improve0 results';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('does not link sprint71 (letters before pr)', () => {
      const text = 'sprint71 is active';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('does not link pr999 (not in map) — left unchanged', () => {
      const text = 'pr999 is unknown';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('links pr0 inside parentheses', () => {
      expect(autoLinkProject('(pr0)')).toBe(`(${projectUrl('mvp-platform-abc123')})`);
    });
  });

  describe('edge cases', () => {
    it('returns empty string unchanged', () => {
      expect(autoLinkProject('')).toBe('');
    });

    it('returns text without project refs unchanged', () => {
      const text = 'No project references here.';
      expect(autoLinkProject(text)).toBe(text);
    });

    it('empty projectKeyToSlug map returns text unchanged', () => {
      const text = 'pr0 should stay';
      expect(autoLinkProjectReferences(text, URL_KEY, new Map())).toBe(text);
    });

    it('is idempotent (no double-linking)', () => {
      const once = autoLinkProject('pr0');
      const twice = autoLinkProject(once);
      expect(twice).toBe(once);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stripProjectUrls (read path)
// ─────────────────────────────────────────────────────────────────────────────

describe('stripProjectUrls', () => {
  describe('bare URLs', () => {
    it('strips bare project URL to short key', () => {
      expect(
        stripProjectUrls(`See ${projectUrl('mvp-platform-abc123')}`, SLUG_TO_SHORT_KEY),
      ).toBe('See pr0');
    });

    it('strips bare project URL with trailing path (e.g., /updates)', () => {
      expect(
        stripProjectUrls(
          `${projectUrl('mvp-platform-abc123')}/updates`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('pr0');
    });

    it('strips multiple bare project URLs', () => {
      expect(
        stripProjectUrls(
          `Check ${projectUrl('mvp-platform-abc123')} and ${projectUrl('design-system-def456')}`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('Check pr0 and pr71');
    });

    it('leaves unknown slug as URL (slug not in map)', () => {
      const unknownUrl = `https://linear.app/${URL_KEY}/project/unknown-slug-xyz`;
      expect(stripProjectUrls(unknownUrl, SLUG_TO_SHORT_KEY)).toBe(unknownUrl);
    });
  });

  describe('markdown links', () => {
    it('strips markdown link where text matches short key', () => {
      expect(
        stripProjectUrls(
          `[pr0](${projectUrl('mvp-platform-abc123')})`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('pr0');
    });

    it('strips markdown link where text is the project URL (Linear cross-ref format)', () => {
      const url = projectUrl('mvp-platform-abc123');
      expect(stripProjectUrls(`[${url}](<${url}>)`, SLUG_TO_SHORT_KEY)).toBe('pr0');
    });

    it('preserves markdown link with custom text', () => {
      const text = `[my project](${projectUrl('mvp-platform-abc123')})`;
      expect(stripProjectUrls(text, SLUG_TO_SHORT_KEY)).toBe(text);
    });
  });

  describe('hash suffix stripping (Linear shortened URLs)', () => {
    it('strips bare URL with hash-only slug', () => {
      expect(
        stripProjectUrls(
          `See https://linear.app/${URL_KEY}/project/abc123`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('See pr0');
    });

    it('strips markdown link with hash-only slug', () => {
      expect(
        stripProjectUrls(
          `[pr0](https://linear.app/${URL_KEY}/project/abc123)`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('pr0');
    });

    it('strips bare URL with hash-only slug and trailing path', () => {
      expect(
        stripProjectUrls(
          `https://linear.app/${URL_KEY}/project/def456/updates`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('pr71');
    });
  });

  describe('named link stripping (Linear description reformatting)', () => {
    it('strips markdown link where text is project name', () => {
      expect(
        stripProjectUrls(
          `[MVP Platform](https://linear.app/${URL_KEY}/project/abc123)`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('pr0');
    });

    it('case insensitive name matching', () => {
      expect(
        stripProjectUrls(
          `[mvp platform](https://linear.app/${URL_KEY}/project/abc123)`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('pr0');
    });

    it('strips named link with hash suffix slug', () => {
      expect(
        stripProjectUrls(
          `[Design System](https://linear.app/${URL_KEY}/project/def456)`,
          SLUG_TO_SHORT_KEY,
        ),
      ).toBe('pr71');
    });

    it('preserves markdown link with unrecognized text', () => {
      const text = `[custom docs](https://linear.app/${URL_KEY}/project/abc123)`;
      expect(stripProjectUrls(text, SLUG_TO_SHORT_KEY)).toBe(text);
    });

    it('preserves named link when name resolves to different project than URL', () => {
      // Link text says "MVP Platform" (pr0) but URL points to def456 (pr71)
      const text = `[MVP Platform](https://linear.app/${URL_KEY}/project/design-system-def456)`;
      expect(stripProjectUrls(text, SLUG_TO_SHORT_KEY)).toBe(text);
    });
  });

  describe('round-trip with Linear description reformatting', () => {
    it('write pr0 → autoLink → simulate Linear reformat → strip → pr0', () => {
      // Write path: pr0 → full URL
      const linked = autoLinkProjectReferences('see pr0', URL_KEY, PROJECT_KEY_TO_SLUG);
      expect(linked).toBe(`see ${projectUrl('mvp-platform-abc123')}`);

      // Simulate Linear reformatting: full URL → [Project Name](hash-url)
      const linearReformatted = `see [MVP Platform](https://linear.app/${URL_KEY}/project/abc123)`;

      // Read path: strip back to pr0
      expect(stripProjectUrls(linearReformatted, SLUG_TO_SHORT_KEY)).toBe('see pr0');
    });
  });

  describe('null/empty handling', () => {
    it('returns null for null input', () => {
      expect(stripProjectUrls(null, SLUG_TO_SHORT_KEY)).toBe(null);
    });

    it('returns null for undefined input', () => {
      expect(stripProjectUrls(undefined, SLUG_TO_SHORT_KEY)).toBe(null);
    });

    it('returns empty string for empty string', () => {
      expect(stripProjectUrls('', SLUG_TO_SHORT_KEY)).toBe('');
    });

    it('returns text unchanged when slugToShortKey is null', () => {
      const text = projectUrl('mvp-platform-abc123');
      expect(stripProjectUrls(text, null)).toBe(text);
    });

    it('returns text unchanged when slugToShortKey is undefined', () => {
      const text = projectUrl('mvp-platform-abc123');
      expect(stripProjectUrls(text, undefined)).toBe(text);
    });

    it('returns text unchanged when slugToShortKey is empty map', () => {
      const text = projectUrl('mvp-platform-abc123');
      expect(stripProjectUrls(text, new Map())).toBe(text);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// autoLinkWithRegistry — project linking
// ─────────────────────────────────────────────────────────────────────────────

describe('autoLinkWithRegistry — project linking', () => {
  it('links project references when registry has projects with slugIds', () => {
    const registry = createMockRegistryWithProjects('ws');
    expect(autoLinkWithRegistry('See pr0', registry)).toBe(
      `See ${projectUrl('mvp-platform-abc123')}`,
    );
  });

  it('does not link projects when registry has no urlKey', () => {
    const registry = createMockRegistryWithProjects(undefined);
    expect(autoLinkWithRegistry('See pr0', registry)).toBe('See pr0');
  });

  it('does not link projects when registry has empty projects', () => {
    const registry = createMockRegistry('ws');
    // registry has no project entries
    expect(autoLinkWithRegistry('See pr0', registry)).toBe('See pr0');
  });

  it('links both issue and project references in the same text', () => {
    const registry = createMockRegistryWithProjects('ws');
    expect(autoLinkWithRegistry('SQT-297 depends on pr0', registry)).toBe(
      `${issueUrl('SQT-297')} depends on ${projectUrl('mvp-platform-abc123')}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: autoLink project then stripProjectUrls
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: autoLink project then stripProjectUrls', () => {
  function autoLinkProject(text: string): string {
    return autoLinkProjectReferences(text, URL_KEY, PROJECT_KEY_TO_SLUG);
  }

  it('single project ref round-trips', () => {
    const original = 'see pr0';
    const linked = autoLinkProject(original);
    expect(linked).not.toBe(original); // sanity: was actually linked
    expect(stripProjectUrls(linked, SLUG_TO_SHORT_KEY)).toBe('see pr0');
  });

  it('multiple project refs round-trip', () => {
    const original = 'pr0 and pr71';
    const linked = autoLinkProject(original);
    expect(stripProjectUrls(linked, SLUG_TO_SHORT_KEY)).toBe('pr0 and pr71');
  });

  it('mixed issue + project refs round-trip', () => {
    const original = 'SQT-1 depends on pr0';
    const linkedIssues = autoLink(original);
    const linkedAll = autoLinkProjectReferences(
      linkedIssues,
      URL_KEY,
      PROJECT_KEY_TO_SLUG,
    );
    const strippedIssues = stripIssueUrls(linkedAll)!;
    const strippedAll = stripProjectUrls(strippedIssues, SLUG_TO_SHORT_KEY);
    expect(strippedAll).toBe(original);
  });

  it('protected regions with project refs round-trip', () => {
    const original = 'pr0 see `pr71` and pr0';
    const linked = autoLinkProject(original);
    // pr0 was linked (twice), pr71 was protected by inline code
    expect(linked).toContain(projectUrl('mvp-platform-abc123'));
    expect(linked).toContain('`pr71`');
    // After stripping, we get back the original
    expect(stripProjectUrls(linked, SLUG_TO_SHORT_KEY)).toBe(original);
  });
});
