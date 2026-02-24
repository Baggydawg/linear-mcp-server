/**
 * Lifecycle test: create -> read -> update -> verify -> cleanup
 *
 * Tests all write tools with real API calls, then cleans up all test data.
 * All test entities use [LIVE-TEST] prefix for manual identification.
 *
 * Run with: bun test tests/live/lifecycle.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addCommentsTool,
  listCommentsTool,
  updateCommentsTool,
} from '../../src/shared/tools/linear/comments.js';
import { createIssuesTool } from '../../src/shared/tools/linear/create-issues.js';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { manageRelationsTool } from '../../src/shared/tools/linear/manage-relations.js';
import {
  createProjectUpdateTool,
  listProjectUpdatesTool,
} from '../../src/shared/tools/linear/project-updates.js';
import { updateIssuesTool } from '../../src/shared/tools/linear/update-issues.js';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { deleteIssue, deleteProjectUpdate, fetchIssue } from './helpers/linear-api.js';
import { reportSkip } from './helpers/report-collector.js';
import { parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('write tool lifecycle', () => {
  let context: ToolContext;
  let suiteRef: Readonly<Suite | File> | null = null;

  // Tracked UUIDs for cleanup
  let issueAIdentifier: string | null = null;
  let issueBIdentifier: string | null = null;
  let issueAUuid: string | null = null;
  let issueBUuid: string | null = null;
  let commentAId: string | null = null;
  let projectUpdateId: string | null = null;
  let relationCreated = false;

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    // 1. Populate registry
    const metaResult = await workspaceMetadataTool.handler({}, context);
    expect(metaResult.isError).not.toBe(true);

    // 2. Create test issues
    const createResult = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'SQT',
            title: '[LIVE-TEST] Lifecycle A',
            description: 'Automated lifecycle test issue A',
            priority: 2,
            estimate: 3,
          },
          {
            teamId: 'SQT',
            title: '[LIVE-TEST] Lifecycle B',
            description: 'Automated lifecycle test issue B',
            priority: 3,
            estimate: 5,
          },
        ],
      },
      context,
    );

    expect(createResult.isError).not.toBe(true);
    const createParsed = parseToonText(createResult.content[0].text);

    // Extract identifiers and UUIDs from results
    const resultsSection = createParsed.sections.get('results');
    expect(resultsSection).toBeDefined();
    if (!resultsSection) return;

    const resultRows = resultsSection.rows;
    expect(resultRows.length).toBe(2);
    expect(resultRows[0].status).toBe('ok');
    expect(resultRows[1].status).toBe('ok');

    issueAIdentifier = resultRows[0].identifier;
    issueBIdentifier = resultRows[1].identifier;

    // We need UUIDs for cleanup — fetch via direct API
    const apiIssueA = await fetchIssue(issueAIdentifier);
    const apiIssueB = await fetchIssue(issueBIdentifier);
    issueAUuid = apiIssueA.id;
    issueBUuid = apiIssueB.id;

    // 3. Add comments
    const commentResult = await addCommentsTool.handler(
      {
        items: [
          {
            issueId: issueAIdentifier,
            body: '[LIVE-TEST] Comment on issue A',
          },
          {
            issueId: issueBIdentifier,
            body: '[LIVE-TEST] Comment on issue B with some extra text for validation',
          },
        ],
      },
      context,
    );
    expect(commentResult.isError).not.toBe(true);

    // 4. Get comment ID for issue A (needed for update_comments test)
    const commentsListResult = await listCommentsTool.handler(
      { issueId: issueAIdentifier },
      context,
    );
    expect(commentsListResult.isError).not.toBe(true);
    const commentsParsed = parseToonText(commentsListResult.content[0].text);
    const commentsSection = commentsParsed.sections.get('comments');
    if (commentsSection && commentsSection.rows.length > 0) {
      // Find our test comment by body
      const testComment = commentsSection.rows.find((c) =>
        c.body.includes('[LIVE-TEST]'),
      );
      if (testComment) {
        commentAId = testComment.id;
      }
    }

    // 5. Create relation: A blocks B
    const relationResult = await manageRelationsTool.handler(
      {
        items: [
          {
            action: 'create',
            from: issueAIdentifier,
            to: issueBIdentifier,
            type: 'blocks',
          },
        ],
      },
      context,
    );
    expect(relationResult.isError).not.toBe(true);
    relationCreated = true;

    // 6. Create project update on pr0
    const projectUpdateResult = await createProjectUpdateTool.handler(
      {
        project: 'pr0',
        body: '[LIVE-TEST] Test project update for lifecycle validation',
        health: 'onTrack',
      },
      context,
    );
    expect(projectUpdateResult.isError).not.toBe(true);

    const puParsed = parseToonText(projectUpdateResult.content[0].text);
    const createdSection = puParsed.sections.get('created');
    if (createdSection && createdSection.rows.length > 0) {
      projectUpdateId = createdSection.rows[0].id;
    }
  }, 120_000);

  afterAll(async () => {
    // Cleanup in reverse order with try/catch per item
    if (projectUpdateId) {
      try {
        await deleteProjectUpdate(projectUpdateId);
      } catch (e) {
        console.warn('Failed to delete project update:', e);
      }
    }

    if (relationCreated && issueAIdentifier && issueBIdentifier) {
      try {
        await manageRelationsTool.handler(
          {
            items: [
              {
                action: 'delete',
                from: issueAIdentifier,
                to: issueBIdentifier,
                type: 'blocks',
              },
            ],
          },
          context,
        );
      } catch (e) {
        console.warn('Failed to delete relation:', e);
      }
    }

    if (issueAUuid) {
      try {
        await deleteIssue(issueAUuid);
      } catch (e) {
        console.warn('Failed to delete issue A:', e);
      }
    }
    if (issueBUuid) {
      try {
        await deleteIssue(issueBUuid);
      } catch (e) {
        console.warn('Failed to delete issue B:', e);
      }
    }

    if (context) clearRegistry(context.sessionId);
  }, 60_000);

  // ─── Test 1: Created issues readable ────────────────────
  it('created issues are readable via get_issues', async () => {
    if (!issueAIdentifier || !issueBIdentifier) {
      if (suiteRef)
        reportSkip(suiteRef, 'created issues readable', 'issues not created');
      return;
    }

    const result = await getIssuesTool.handler(
      { ids: [issueAIdentifier, issueBIdentifier] },
      context,
    );
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    const issuesSection = parsed.sections.get('issues');
    expect(issuesSection).toBeDefined();
    if (!issuesSection) return;

    expect(issuesSection.rows.length).toBe(2);

    const issueA = issuesSection.rows.find((r) => r.identifier === issueAIdentifier);
    const issueB = issuesSection.rows.find((r) => r.identifier === issueBIdentifier);

    expect(issueA).toBeDefined();
    expect(issueB).toBeDefined();

    if (issueA) {
      expect(issueA.title).toBe('[LIVE-TEST] Lifecycle A');
      expect(issueA.priority).toBe('p2');
      expect(issueA.estimate).toBe('e3');
    }
    if (issueB) {
      expect(issueB.title).toBe('[LIVE-TEST] Lifecycle B');
      expect(issueB.priority).toBe('p3');
      expect(issueB.estimate).toBe('e5');
    }
  }, 30_000);

  // ─── Test 2: Comments readable ──────────────────────────
  it('created comments are readable via list_comments', async () => {
    if (!issueAIdentifier) {
      if (suiteRef)
        reportSkip(suiteRef, 'created comments readable', 'issue A not created');
      return;
    }

    const result = await listCommentsTool.handler(
      { issueId: issueAIdentifier },
      context,
    );
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    const commentsSection = parsed.sections.get('comments');
    expect(commentsSection).toBeDefined();
    if (!commentsSection) return;

    const testComment = commentsSection.rows.find((c) =>
      c.body.includes('[LIVE-TEST] Comment on issue A'),
    );
    expect(testComment, 'Test comment on issue A should exist').toBeDefined();
  }, 30_000);

  // ─── Test 3: Relation readable ──────────────────────────
  it('created relation is readable via get_issues', async () => {
    if (!issueAIdentifier || !issueBIdentifier || !relationCreated) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'created relation readable',
          'issues or relation not created',
        );
      return;
    }

    // Use get_issues to get the relation data
    const result = await getIssuesTool.handler({ ids: [issueAIdentifier] }, context);
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    const relationsSection = parsed.sections.get('relations');
    expect(relationsSection, 'relations section should exist').toBeDefined();
    if (!relationsSection) return;

    const blocksRelation = relationsSection.rows.find(
      (r) =>
        r.from === issueAIdentifier && r.to === issueBIdentifier && r.type === 'blocks',
    );
    expect(
      blocksRelation,
      `Should find blocks relation: ${issueAIdentifier} -> ${issueBIdentifier}`,
    ).toBeDefined();
  }, 30_000);

  // ─── Test 4: Project update readable ────────────────────
  it('created project update is readable via list_project_updates', async () => {
    if (!projectUpdateId) {
      if (suiteRef)
        reportSkip(suiteRef, 'project update readable', 'project update not created');
      return;
    }

    const result = await listProjectUpdatesTool.handler({ project: 'pr0' }, context);
    expect(result.isError).not.toBe(true);
    const parsed = parseToonText(result.content[0].text);

    const updatesSection = parsed.sections.get('projectUpdates');
    expect(updatesSection).toBeDefined();
    if (!updatesSection) return;

    const testUpdate = updatesSection.rows.find((r) => r.body?.includes('[LIVE-TEST]'));
    expect(testUpdate, 'Test project update should be found').toBeDefined();
    if (testUpdate) {
      expect(testUpdate.health).toBe('onTrack');
    }
  }, 30_000);

  // ─── Test 5: Update issues ──────────────────────────────
  it('update_issues changes fields correctly', async () => {
    if (!issueAIdentifier) {
      if (suiteRef) reportSkip(suiteRef, 'update issues', 'issue A not created');
      return;
    }

    const updateResult = await updateIssuesTool.handler(
      {
        items: [
          {
            id: issueAIdentifier,
            title: '[LIVE-TEST] Lifecycle A (updated)',
            priority: 1,
            estimate: 8,
          },
        ],
      },
      context,
    );
    expect(updateResult.isError).not.toBe(true);

    // Verify changes section in TOON output
    const updateParsed = parseToonText(updateResult.content[0].text);
    const changesSection = updateParsed.sections.get('changes');
    expect(changesSection, 'changes section should exist after update').toBeDefined();
    if (changesSection) {
      const titleChange = changesSection.rows.find((r) => r.field === 'title');
      expect(titleChange).toBeDefined();
      if (titleChange) {
        expect(titleChange.after).toBe('[LIVE-TEST] Lifecycle A (updated)');
      }
    }

    // Verify via get_issues
    const verifyResult = await getIssuesTool.handler(
      { ids: [issueAIdentifier] },
      context,
    );
    expect(verifyResult.isError).not.toBe(true);
    const verifyParsed = parseToonText(verifyResult.content[0].text);
    const issuesSection = verifyParsed.sections.get('issues');
    expect(issuesSection).toBeDefined();
    if (issuesSection) {
      const issueA = issuesSection.rows.find((r) => r.identifier === issueAIdentifier);
      expect(issueA).toBeDefined();
      if (issueA) {
        expect(issueA.title).toBe('[LIVE-TEST] Lifecycle A (updated)');
        expect(issueA.priority).toBe('p1');
        expect(issueA.estimate).toBe('e8');
      }
    }
  }, 30_000);

  // ─── Test 6: Update comment ─────────────────────────────
  it('update_comments changes body correctly', async () => {
    if (!commentAId || !issueAIdentifier) {
      if (suiteRef) reportSkip(suiteRef, 'update comments', 'comment ID not available');
      return;
    }

    const updateResult = await updateCommentsTool.handler(
      {
        items: [
          {
            id: commentAId,
            body: '[LIVE-TEST] Updated comment on issue A',
          },
        ],
      },
      context,
    );
    expect(updateResult.isError).not.toBe(true);

    // Verify via list_comments
    const verifyResult = await listCommentsTool.handler(
      { issueId: issueAIdentifier },
      context,
    );
    expect(verifyResult.isError).not.toBe(true);
    const verifyParsed = parseToonText(verifyResult.content[0].text);
    const commentsSection = verifyParsed.sections.get('comments');
    expect(commentsSection).toBeDefined();
    if (commentsSection) {
      const updatedComment = commentsSection.rows.find((c) =>
        c.body.includes('[LIVE-TEST] Updated comment'),
      );
      expect(updatedComment, 'Updated comment should be readable').toBeDefined();
    }
  }, 30_000);

  // ─── Test 7: Delete relation ────────────────────────────
  it('delete relation works', async () => {
    if (!issueAIdentifier || !issueBIdentifier || !relationCreated) {
      if (suiteRef) reportSkip(suiteRef, 'delete relation', 'relation not created');
      return;
    }

    const deleteResult = await manageRelationsTool.handler(
      {
        items: [
          {
            action: 'delete',
            from: issueAIdentifier,
            to: issueBIdentifier,
            type: 'blocks',
          },
        ],
      },
      context,
    );
    expect(deleteResult.isError).not.toBe(true);

    // Verify relation is gone
    const verifyResult = await getIssuesTool.handler(
      { ids: [issueAIdentifier] },
      context,
    );
    expect(verifyResult.isError).not.toBe(true);
    const verifyParsed = parseToonText(verifyResult.content[0].text);
    const relationsSection = verifyParsed.sections.get('relations');
    if (relationsSection) {
      const blocksRelation = relationsSection.rows.find(
        (r) =>
          r.from === issueAIdentifier &&
          r.to === issueBIdentifier &&
          r.type === 'blocks',
      );
      expect(blocksRelation, 'blocks relation should be deleted').toBeUndefined();
    }

    // Mark as deleted so afterAll doesn't try to delete again
    relationCreated = false;
  }, 30_000);
});
