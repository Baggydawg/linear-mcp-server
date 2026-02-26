/**
 * TOON Completeness Checks
 *
 * Verifies that every tool's TOON output contains the expected section headers
 * with the correct fields, catching accidental field omissions.
 *
 * This is a schema-level validation -- it does not check field values,
 * just that the right columns are present in the right order.
 *
 * Run with: bun test tests/live/completeness.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCommentsTool } from '../../src/shared/tools/linear/comments.js';
import { listCyclesTool } from '../../src/shared/tools/linear/cycles.js';
import { getIssueHistoryTool } from '../../src/shared/tools/linear/get-issue-history.js';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { getSprintContextTool } from '../../src/shared/tools/linear/get-sprint-context.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { listProjectUpdatesTool } from '../../src/shared/tools/linear/project-updates.js';
import { listProjectsTool } from '../../src/shared/tools/linear/projects.js';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import {
  COMMENT_SCHEMA,
  COMMENT_SCHEMA_WITH_ID,
  CYCLE_LOOKUP_SCHEMA,
  CYCLE_SCHEMA,
  GAP_SCHEMA,
  HISTORY_ENTRY_SCHEMA,
  ISSUE_SCHEMA,
  LABEL_LOOKUP_SCHEMA,
  PAGINATION_SCHEMA,
  PROJECT_LOOKUP_SCHEMA,
  PROJECT_SCHEMA,
  PROJECT_UPDATE_SCHEMA,
  RELATION_SCHEMA,
  STATE_LOOKUP_SCHEMA,
  TEAM_LOOKUP_SCHEMA,
  USER_LOOKUP_SCHEMA,
} from '../../src/shared/toon/schemas.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { reportToolCall } from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a required section exists and has exactly the expected fields
 * (in order), minus any intentional omissions.
 */
function expectSchemaFields(
  parsed: ParsedToon,
  sectionName: string,
  expectedFields: string[],
  intentionalOmissions: string[] = [],
) {
  const section = parsed.sections.get(sectionName);
  expect(section, `Section "${sectionName}" should exist`).toBeDefined();
  if (!section) return;

  const expected = expectedFields.filter((f) => !intentionalOmissions.includes(f));
  expect(
    section.fields,
    `Section "${sectionName}" fields mismatch.\n` +
      `Expected: [${expected.join(', ')}]\n` +
      `Actual: [${section.fields.join(', ')}]`,
  ).toEqual(expected);
}

/**
 * Assert that an optional section, if present, has exactly the expected fields.
 * If the section is absent, the test passes silently.
 */
function expectOptionalSchemaFields(
  parsed: ParsedToon,
  sectionName: string,
  expectedFields: string[],
) {
  const section = parsed.sections.get(sectionName);
  if (!section) return; // Section is optional, not present is fine

  expect(
    section.fields,
    `Optional section "${sectionName}" fields mismatch.\n` +
      `Expected: [${expectedFields.join(', ')}]\n` +
      `Actual: [${section.fields.join(', ')}]`,
  ).toEqual(expectedFields);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!canRunLiveTests)('TOON completeness checks', () => {
  let context: ToolContext;
  let suiteRef: Readonly<Suite | File> | null = null;

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();
    // Call workspace_metadata first to populate registry (needed by many tools)
    const wmParams = {};
    const wmResult = await workspaceMetadataTool.handler(wmParams, context);
    reportToolCall(suite, 'workspace_metadata', wmParams, wmResult.content[0].text);
  }, 30000);

  afterAll(() => {
    if (context) clearRegistry(context.sessionId);
  });

  // ─── workspace_metadata ─────────────────────────────────────────────────
  it('workspace_metadata has correct section schemas', async () => {
    const params = { forceRefresh: true };
    const result = await workspaceMetadataTool.handler(params, context);
    if (suiteRef)
      reportToolCall(suiteRef, 'workspace_metadata', params, result.content[0].text);
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    expectSchemaFields(parsed, '_teams', TEAM_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_users', USER_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_states', STATE_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_labels', LABEL_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_projects', PROJECT_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_cycles', CYCLE_LOOKUP_SCHEMA.fields);
  }, 30000);

  // ─── list_issues ────────────────────────────────────────────────────────
  it('list_issues has correct section schemas', async () => {
    const params = {};
    const result = await listIssuesTool.handler(params, context);
    if (suiteRef)
      reportToolCall(suiteRef, 'list_issues', params, result.content[0].text);
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    expectSchemaFields(parsed, 'issues', ISSUE_SCHEMA.fields);
    expectSchemaFields(parsed, '_users', USER_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_states', STATE_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_pagination', PAGINATION_SCHEMA.fields);

    // Conditional sections -- only present when issues reference projects/labels
    expectOptionalSchemaFields(parsed, '_projects', PROJECT_LOOKUP_SCHEMA.fields);
    expectOptionalSchemaFields(parsed, '_labels', LABEL_LOOKUP_SCHEMA.fields);

    // Comments section exists when issues have recent comments
    expectOptionalSchemaFields(parsed, 'comments', COMMENT_SCHEMA.fields);
    // Relations section exists when issues have relations
    expectOptionalSchemaFields(parsed, 'relations', RELATION_SCHEMA.fields);
  }, 30000);

  // ─── get_issues ─────────────────────────────────────────────────────────
  it('get_issues has correct section schemas', async () => {
    // Need an issue identifier first
    const listParams = { limit: 1 };
    const listResult = await listIssuesTool.handler(listParams, context);
    if (suiteRef)
      reportToolCall(suiteRef, 'list_issues', listParams, listResult.content[0].text);
    const listParsed = parseToonText(listResult.content[0].text);
    const issuesSection = listParsed.sections.get('issues');
    if (!issuesSection || issuesSection.rows.length === 0) return;

    const identifier = issuesSection.rows[0].identifier;
    const getParams = { ids: [identifier] };
    const result = await getIssuesTool.handler(getParams, context);
    if (suiteRef)
      reportToolCall(suiteRef, 'get_issues', getParams, result.content[0].text);
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    expectSchemaFields(parsed, 'issues', ISSUE_SCHEMA.fields);
    expectSchemaFields(parsed, '_users', USER_LOOKUP_SCHEMA.fields);
    expectSchemaFields(parsed, '_states', STATE_LOOKUP_SCHEMA.fields);

    // get_issues should NOT have _pagination or inline comments
    expect(parsed.sections.has('_pagination')).toBe(false);

    // Optional sections
    expectOptionalSchemaFields(parsed, '_projects', PROJECT_LOOKUP_SCHEMA.fields);
    expectOptionalSchemaFields(parsed, '_labels', LABEL_LOOKUP_SCHEMA.fields);
    expectOptionalSchemaFields(parsed, 'relations', RELATION_SCHEMA.fields);
  }, 30000);

  // ─── get_sprint_context ─────────────────────────────────────────────────
  it('get_sprint_context has correct section schemas', async () => {
    const sprintParams = { team: 'SQT' };
    const result = await getSprintContextTool.handler(sprintParams, context);
    if (suiteRef)
      reportToolCall(
        suiteRef,
        'get_sprint_context',
        sprintParams,
        result.content[0].text,
      );
    if (result.isError) return; // No active sprint -- acceptable

    const parsed = parseToonText(result.content[0].text);

    // Sprint context uses ISSUE_SCHEMA minus dueDate, team, url
    expectSchemaFields(parsed, 'issues', ISSUE_SCHEMA.fields, [
      'dueDate',
      'team',
      'url',
    ]);

    expectOptionalSchemaFields(parsed, 'comments', COMMENT_SCHEMA.fields);
    expectOptionalSchemaFields(parsed, 'relations', RELATION_SCHEMA.fields);
    expectOptionalSchemaFields(parsed, '_gaps', GAP_SCHEMA.fields);

    // Sprint context should NOT have _labels
    expect(parsed.sections.has('_labels')).toBe(false);
  }, 30000);

  // ─── list_cycles ────────────────────────────────────────────────────────
  it('list_cycles has correct section schemas', async () => {
    const cyclesParams = { teamId: 'SQT' };
    const result = await listCyclesTool.handler(cyclesParams, context);
    if (suiteRef)
      reportToolCall(suiteRef, 'list_cycles', cyclesParams, result.content[0].text);
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    expectSchemaFields(parsed, 'cycles', CYCLE_SCHEMA.fields);
  }, 30000);

  // ─── list_projects ──────────────────────────────────────────────────────
  it('list_projects has correct section schemas', async () => {
    const projParams = { team: 'SQT' };
    const result = await listProjectsTool.handler(projParams, context);
    if (suiteRef)
      reportToolCall(suiteRef, 'list_projects', projParams, result.content[0].text);
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    expectSchemaFields(parsed, 'projects', PROJECT_SCHEMA.fields);
  }, 30000);

  // ─── list_project_updates ───────────────────────────────────────────────
  it('list_project_updates has correct section schemas', async () => {
    // Need a project first
    const projListParams = { team: 'SQT' };
    const projResult = await listProjectsTool.handler(projListParams, context);
    if (suiteRef)
      reportToolCall(
        suiteRef,
        'list_projects',
        projListParams,
        projResult.content[0].text,
      );
    const projParsed = parseToonText(projResult.content[0].text);
    const projSection = projParsed.sections.get('projects');
    if (!projSection || projSection.rows.length === 0) return;

    const updatesParams = { project: projSection.rows[0].key };
    const result = await listProjectUpdatesTool.handler(updatesParams, context);
    if (suiteRef)
      reportToolCall(
        suiteRef,
        'list_project_updates',
        updatesParams,
        result.content[0].text,
      );
    if (result.isError) return; // No updates acceptable
    const parsed = parseToonText(result.content[0].text);

    const updatesSection = parsed.sections.get('projectUpdates');
    if (updatesSection) {
      expectSchemaFields(parsed, 'projectUpdates', PROJECT_UPDATE_SCHEMA.fields);
    }
  }, 30000);

  // ─── list_comments ──────────────────────────────────────────────────────
  it('list_comments has correct section schemas', async () => {
    // Need an issue with comments
    const commListParams = { limit: 10 };
    const listResult = await listIssuesTool.handler(commListParams, context);
    if (suiteRef)
      reportToolCall(
        suiteRef,
        'list_issues',
        commListParams,
        listResult.content[0].text,
      );
    const listParsed = parseToonText(listResult.content[0].text);
    const issuesSection = listParsed.sections.get('issues');
    if (!issuesSection) return;

    for (const issue of issuesSection.rows) {
      const commentParams = { issueId: issue.identifier };
      const result = await listCommentsTool.handler(commentParams, context);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'list_comments',
          commentParams,
          result.content[0].text,
        );
      if (result.isError) continue;
      const parsed = parseToonText(result.content[0].text);
      const commentsSection = parsed.sections.get('comments');
      if (commentsSection && commentsSection.rows.length > 0) {
        expectSchemaFields(parsed, 'comments', COMMENT_SCHEMA_WITH_ID.fields);
        expectSchemaFields(parsed, '_users', USER_LOOKUP_SCHEMA.fields);
        return; // Found and validated
      }
    }
    // No issues with comments found -- not a failure
  }, 45000);

  // ─── get_issue_history ──────────────────────────────────────────────────
  it('get_issue_history has correct section schemas', async () => {
    const histListParams = { limit: 5 };
    const listResult = await listIssuesTool.handler(histListParams, context);
    if (suiteRef)
      reportToolCall(
        suiteRef,
        'list_issues',
        histListParams,
        listResult.content[0].text,
      );
    const listParsed = parseToonText(listResult.content[0].text);
    const issuesSection = listParsed.sections.get('issues');
    if (!issuesSection) return;

    for (const issue of issuesSection.rows) {
      const historyParams = { issueIds: [issue.identifier] };
      const result = await getIssueHistoryTool.handler(historyParams, context);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'get_issue_history',
          historyParams,
          result.content[0].text,
        );
      if (result.isError) continue;
      const parsed = parseToonText(result.content[0].text);
      const historySection = parsed.sections.get('history');
      if (historySection && historySection.rows.length > 0) {
        expectSchemaFields(parsed, 'history', HISTORY_ENTRY_SCHEMA.fields);
        return; // Found and validated
      }
    }
  }, 45000);
});
