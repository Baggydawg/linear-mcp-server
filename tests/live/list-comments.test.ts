/**
 * Live data validation test for list_comments.
 *
 * Calls the list_comments tool handler with a real API token, parses the
 * TOON output, then compares every field against a direct Linear SDK fetch.
 *
 * Run with: bun test tests/live/list-comments.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCommentsTool } from '../../src/shared/tools/linear/comments.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import { stripMarkdownImages } from '../../src/shared/toon/encoder.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import {
  expectDateMatch,
  type FieldContext,
  normalizeEmpty,
} from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchComments, fetchUsers } from './helpers/linear-api.js';
import {
  reportEntitiesValidated,
  reportSkip,
  reportToolCall,
} from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('list_comments live data validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ToolContext;
  let commentsParsed: ParsedToon | null = null;
  let issueIdentifier: string | null = null;
  let hasComments = false;
  const validatedCommentIds: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    // First, call list_issues to find issues (we need one with comments)
    const listParams = { team: 'SQT', limit: 20 };
    const issuesResult = await listIssuesTool.handler(listParams, context);
    reportToolCall(suite, 'list_issues', listParams, issuesResult.content[0].text);
    expect(issuesResult.isError).not.toBe(true);

    const issuesParsed = parseToonText(issuesResult.content[0].text);
    const issuesSection = issuesParsed.sections.get('issues');

    if (!issuesSection || issuesSection.rows.length === 0) {
      console.warn('No issues found, skipping comments tests');
      // reportSkip deferred to individual tests via hasComments check
      return;
    }

    // Try each issue until we find one with comments
    for (const issueRow of issuesSection.rows) {
      const identifier = issueRow.identifier;

      const commentParams = { issueId: identifier };
      const commentsResult = await listCommentsTool.handler(commentParams, context);
      reportToolCall(
        suite,
        'list_comments',
        commentParams,
        commentsResult.content[0].text,
      );

      if (commentsResult.isError) continue;

      const text = commentsResult.content[0].text;
      const parsed = parseToonText(text);
      const commentsSection = parsed.sections.get('comments');

      if (commentsSection && commentsSection.rows.length > 0) {
        commentsParsed = parsed;
        issueIdentifier = identifier;
        hasComments = true;
        break;
      }
    }

    if (!hasComments) {
      console.warn('No issues with comments found in SQT team, tests will be skipped');
    }
  }, 60000);

  afterAll((suite) => {
    if (validatedCommentIds.length > 0) {
      reportEntitiesValidated(suite, 'comments', validatedCommentIds);
    }
    if (context) {
      clearRegistry(context.sessionId);
    }
  });

  it('issue comments match API data', async () => {
    if (!hasComments || !commentsParsed || !issueIdentifier) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'issue comments match API data',
          'no issues with comments found',
        );
      return;
    }

    const commentsSection = commentsParsed.sections.get('comments');
    expect(commentsSection).toBeDefined();
    if (!commentsSection) return;

    // Verify schema fields match COMMENT_SCHEMA_WITH_ID
    expect(commentsSection.fields).toEqual(
      expect.arrayContaining(['id', 'issue', 'user', 'body', 'createdAt']),
    );

    // Fetch comments via direct API
    const apiComments = await fetchComments(issueIdentifier);

    // Build users lookup from TOON output for short key resolution
    const usersSection = commentsParsed.sections.get('_users');
    const shortKeyToUserName = new Map<string, string>();
    if (usersSection) {
      for (const row of usersSection.rows) {
        shortKeyToUserName.set(row.key, row.name);
      }
    }

    // Build API user map
    const apiUsers = await fetchUsers();
    const userIdToName = new Map<string, string>();
    for (const u of apiUsers) {
      userIdToName.set(u.id, u.name);
    }

    for (const toonRow of commentsSection.rows) {
      const commentId = toonRow.id;

      // Match by UUID
      const apiComment = apiComments.find((c) => c.id === commentId);

      expect(
        apiComment,
        `Comment id="${commentId}" from TOON not found in API response for issue ${issueIdentifier}`,
      ).toBeDefined();
      if (!apiComment) continue;

      validatedCommentIds.push(commentId);

      const ctx = (field: string): FieldContext => ({
        entity: 'Comment',
        identifier: `id=${commentId}`,
        field,
      });

      // Compare body (NOT truncated in list_comments, unlike inline comments in list_issues)
      const apiBody =
        stripMarkdownImages((apiComment as unknown as { body?: string }).body ?? '') ??
        '';
      expect(
        normalizeEmpty(toonRow.body),
        `Comment id=${commentId} field "body": lengths TOON=${toonRow.body?.length} API=${apiBody.length}`,
      ).toBe(normalizeEmpty(apiBody));

      // Compare createdAt
      expectDateMatch(toonRow.createdAt, apiComment.createdAt, ctx('createdAt'));

      // Verify issue field matches our issue identifier
      expect(
        toonRow.issue,
        `Comment id=${commentId} field "issue" should be "${issueIdentifier}"`,
      ).toBe(issueIdentifier);

      // Verify user short key resolves correctly
      if (toonRow.user && toonRow.user !== '') {
        const toonUserName = shortKeyToUserName.get(toonRow.user);
        // Resolve the API user (lazy-loaded in SDK)
        const apiUser = await (
          apiComment as unknown as {
            user?: Promise<{ id: string; name?: string } | null>;
          }
        ).user;
        if (apiUser) {
          const apiUserName = apiUser.name ?? userIdToName.get(apiUser.id);
          expect(
            toonUserName,
            `Comment id=${commentId} field "user": short key "${toonRow.user}" should resolve to "${apiUserName}"`,
          ).toBe(apiUserName);
        }
      }
    }
  }, 30000);

  it('comment count matches API', async () => {
    if (!hasComments || !commentsParsed || !issueIdentifier) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'comment count matches API',
          'no issues with comments found',
        );
      return;
    }

    const commentsSection = commentsParsed.sections.get('comments');
    if (!commentsSection) return;

    // Fetch comments via direct API
    const apiComments = await fetchComments(issueIdentifier);

    // TOON section count should match declared count
    if (commentsSection.count !== undefined) {
      expect(
        commentsSection.count,
        `Comment section declared count=${commentsSection.count} vs actual rows=${commentsSection.rows.length}`,
      ).toBe(commentsSection.rows.length);
    }

    // Both should return the same number of comments (up to default limit of 20)
    expect(
      commentsSection.rows.length,
      `TOON comments count=${commentsSection.rows.length} vs API count=${apiComments.length}`,
    ).toBe(apiComments.length);
  }, 30000);
});
