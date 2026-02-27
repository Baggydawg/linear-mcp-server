/**
 * Static map of test file basenames to emoji + description for report preambles.
 * Keys must match the exact `*.test.ts` filenames under tests/live/.
 */
export const TOOL_DESCRIPTIONS: Record<string, { emoji: string; description: string }> =
  {
    'list-issues.test.ts': {
      emoji: '\u{1F4CB}',
      description:
        'Tests `list_issues` \u2014 queries issues with filters (team, cycle, state). Returns paginated issue list with metadata sections (_users, _states). Validates each issue field against direct API fetch.',
    },
    'get-issues.test.ts': {
      emoji: '\u{1F50D}',
      description:
        'Tests `get_issues` \u2014 fetches full detail for specific issues by identifier. Returns complete issue data including non-truncated descriptions, relations, and all metadata.',
    },
    'get-sprint-context.test.ts': {
      emoji: '\u{1F3C3}',
      description:
        'Tests `get_sprint_context` \u2014 returns current sprint issues with gap analysis (no_estimate, no_assignee, stale, blocked, priority_mismatch). Validates issue fields and gap computations against API.',
    },
    'workspace-metadata.test.ts': {
      emoji: '\u{1F3E2}',
      description:
        'Tests `workspace_metadata` \u2014 returns all workspace entities (teams, users, states, labels, projects, cycles). Validates each entity type field-by-field against direct API queries.',
    },
    'list-comments.test.ts': {
      emoji: '\u{1F4AC}',
      description:
        'Tests `list_comments` \u2014 fetches comments for issues. Validates comment body, author, and timestamps against the Linear API.',
    },
    'list-cycles.test.ts': {
      emoji: '\u{1F504}',
      description:
        'Tests `list_cycles` \u2014 fetches cycles for a team. Validates cycle number, dates, and progress fields against the API.',
    },
    'list-projects.test.ts': {
      emoji: '\u{1F4C1}',
      description:
        'Tests `list_projects` \u2014 fetches projects with optional team filter. Validates project name, state, lead, and other fields against the API.',
    },
    'list-project-updates.test.ts': {
      emoji: '\u{1F4E3}',
      description:
        'Tests `list_project_updates` \u2014 fetches status updates for projects. Validates update body, health, and user fields against the API.',
    },
    'get-issue-history.test.ts': {
      emoji: '\u{1F4DC}',
      description:
        'Tests `get_issue_history` \u2014 fetches change history for issues. Validates history entries (field changes, actor, timestamps) against the API.',
    },
    'lifecycle.test.ts': {
      emoji: '\u{1F6E0}\uFE0F',
      description:
        'Tests full CRUD lifecycle \u2014 creates issues, adds comments, manages relations, creates project updates, then cleans up. Validates each mutation result against the API.',
    },
    'edge-cases.test.ts': {
      emoji: '\u{26A0}\uFE0F',
      description:
        'Tests edge cases \u2014 invalid inputs, empty results, boundary conditions, and error handling across multiple tools.',
    },
    'completeness.test.ts': {
      emoji: '\u{2705}',
      description:
        'Tests schema completeness \u2014 calls every read tool and validates that all expected TOON sections and fields are present in the response.',
    },
    'smoke.test.ts': {
      emoji: '\u{1F6A8}',
      description:
        'Smoke test \u2014 single `workspace_metadata` call to verify API connectivity and basic TOON encoding.',
    },
  };

/** Entity type emoji map for report rendering. */
export const ENTITY_EMOJIS: Record<string, string> = {
  Issue: '\u{1F4CC}',
  User: '\u{1F464}',
  State: '\u{1F535}',
  Label: '\u{1F3F7}\uFE0F',
  Project: '\u{1F4C1}',
  Cycle: '\u{1F504}',
  Team: '\u{1F3E0}',
  Gap: '\u{1F4CA}',
};
