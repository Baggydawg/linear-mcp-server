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
import { reportSkip, reportToolCall } from './helpers/report-collector.js';
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
    const metaParams = {};
    const metaResult = await workspaceMetadataTool.handler(metaParams, context);
    expect(metaResult.isError).not.toBe(true);
    reportToolCall(suite, 'workspace_metadata', metaParams, metaResult.content[0].text);

    // 2. Create test issues
    const createParams = {
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
    };
    const createResult = await createIssuesTool.handler(
      createParams,
      context,
    );

    expect(createResult.isError).not.toBe(true);
    reportToolCall(suite, 'create_issues', createParams, createResult.content[0].text);
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
    const addCommentsParams = {
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
    };
    const commentResult = await addCommentsTool.handler(
      addCommentsParams,
      context,
    );
    expect(commentResult.isError).not.toBe(true);
    reportToolCall(suite, 'add_comments', addCommentsParams, commentResult.content[0].text);

    // 4. Get comment ID for issue A (needed for update_comments test)
    const listCommentsParams1 = { issueId: issueAIdentifier };
    const commentsListResult = await listCommentsTool.handler(
      listCommentsParams1,
      context,
    );
    expect(commentsListResult.isError).not.toBe(true);
    reportToolCall(suite, 'list_comments', listCommentsParams1, commentsListResult.content[0].text);
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
    const createRelationParams = {
      items: [
        {
          action: 'create' as const,
          from: issueAIdentifier,
          to: issueBIdentifier,
          type: 'blocks',
        },
      ],
    };
    const relationResult = await manageRelationsTool.handler(
      createRelationParams,
      context,
    );
    expect(relationResult.isError).not.toBe(true);
    reportToolCall(suite, 'manage_relations', createRelationParams, relationResult.content[0].text);
    relationCreated = true;

    // 6. Create project update on pr0
    const createPuParams = {
      project: 'pr0',
      body: '[LIVE-TEST] Test project update for lifecycle validation',
      health: 'onTrack',
    };
    const projectUpdateResult = await createProjectUpdateTool.handler(
      createPuParams,
      context,
    );
    expect(projectUpdateResult.isError).not.toBe(true);
    reportToolCall(suite, 'create_project_update', createPuParams, projectUpdateResult.content[0].text);

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
        const cleanupRelationParams = {
          items: [
            {
              action: 'delete' as const,
              from: issueAIdentifier,
              to: issueBIdentifier,
              type: 'blocks',
            },
          ],
        };
        const cleanupRelationResult = await manageRelationsTool.handler(
          cleanupRelationParams,
          context,
        );
        if (suiteRef) reportToolCall(suiteRef, 'manage_relations', cleanupRelationParams, cleanupRelationResult.content[0].text);
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

    const getIssuesParams1 = { ids: [issueAIdentifier, issueBIdentifier] };
    const result = await getIssuesTool.handler(
      getIssuesParams1,
      context,
    );
    expect(result.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'get_issues', getIssuesParams1, result.content[0].text);
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

    const listCommentsParams2 = { issueId: issueAIdentifier };
    const result = await listCommentsTool.handler(
      listCommentsParams2,
      context,
    );
    expect(result.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'list_comments', listCommentsParams2, result.content[0].text);
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
    const getIssuesParams2 = { ids: [issueAIdentifier] };
    const result = await getIssuesTool.handler(getIssuesParams2, context);
    expect(result.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'get_issues', getIssuesParams2, result.content[0].text);
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

    const listPuParams = { project: 'pr0' };
    const result = await listProjectUpdatesTool.handler(listPuParams, context);
    expect(result.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'list_project_updates', listPuParams, result.content[0].text);
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

    const updateIssuesParams = {
      items: [
        {
          id: issueAIdentifier,
          title: '[LIVE-TEST] Lifecycle A (updated)',
          priority: 1,
          estimate: 8,
        },
      ],
    };
    const updateResult = await updateIssuesTool.handler(
      updateIssuesParams,
      context,
    );
    expect(updateResult.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'update_issues', updateIssuesParams, updateResult.content[0].text);

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
    const verifyIssuesParams = { ids: [issueAIdentifier] };
    const verifyResult = await getIssuesTool.handler(
      verifyIssuesParams,
      context,
    );
    expect(verifyResult.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'get_issues', verifyIssuesParams, verifyResult.content[0].text);
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

    const updateCommentsParams = {
      items: [
        {
          id: commentAId,
          body: '[LIVE-TEST] Updated comment on issue A',
        },
      ],
    };
    const updateResult = await updateCommentsTool.handler(
      updateCommentsParams,
      context,
    );
    expect(updateResult.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'update_comments', updateCommentsParams, updateResult.content[0].text);

    // Verify via list_comments
    const verifyCommentsParams = { issueId: issueAIdentifier };
    const verifyResult = await listCommentsTool.handler(
      verifyCommentsParams,
      context,
    );
    expect(verifyResult.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'list_comments', verifyCommentsParams, verifyResult.content[0].text);
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

    const deleteRelationParams = {
      items: [
        {
          action: 'delete' as const,
          from: issueAIdentifier,
          to: issueBIdentifier,
          type: 'blocks',
        },
      ],
    };
    const deleteResult = await manageRelationsTool.handler(
      deleteRelationParams,
      context,
    );
    expect(deleteResult.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'manage_relations', deleteRelationParams, deleteResult.content[0].text);

    // Verify relation is gone
    const verifyRelationParams = { ids: [issueAIdentifier] };
    const verifyResult = await getIssuesTool.handler(
      verifyRelationParams,
      context,
    );
    expect(verifyResult.isError).not.toBe(true);
    if (suiteRef) reportToolCall(suiteRef, 'get_issues', verifyRelationParams, verifyResult.content[0].text);
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
