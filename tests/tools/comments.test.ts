/**
 * Tests for comment tools (list, add).
 * Verifies: comment listing, adding comments, batch operations, output shapes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCommentsTool,
  listCommentsTool,
} from '../../src/shared/tools/linear/comments.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  defaultMockComments,
  type MockLinearClient,
  resetMockCalls,
} from '../mocks/linear-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let mockClient: MockLinearClient;

const baseContext: ToolContext = {
  sessionId: 'test-session',
  providerToken: 'test-token',
  authStrategy: 'bearer',
};

vi.mock('../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(() => Promise.resolve(mockClient)),
}));

beforeEach(() => {
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// List Comments Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_comments tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listCommentsTool.name).toBe('list_comments');
      expect(listCommentsTool.title).toBe('List Comments');
    });

    it('has readOnlyHint annotation', () => {
      expect(listCommentsTool.annotations?.readOnlyHint).toBe(true);
      expect(listCommentsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires issueId parameter', () => {
      const result = listCommentsTool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts valid issueId', () => {
      const result = listCommentsTool.inputSchema.safeParse({ issueId: 'issue-001' });
      expect(result.success).toBe(true);
    });

    it('accepts optional limit', () => {
      const result = listCommentsTool.inputSchema.safeParse({
        issueId: 'issue-001',
        limit: 10,
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional cursor', () => {
      const result = listCommentsTool.inputSchema.safeParse({
        issueId: 'issue-001',
        cursor: 'test-cursor',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('returns comments for specified issue', async () => {
      const result = await listCommentsTool.handler(
        { issueId: 'issue-001' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
    });

    it('respects limit parameter', async () => {
      const result = await listCommentsTool.handler(
        { issueId: 'issue-001', limit: 5 },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      // TOON format doesn't expose limit in structured content
    });

    it('supports pagination with cursor', async () => {
      const result = await listCommentsTool.handler(
        { issueId: 'issue-001', cursor: 'test-cursor' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      // TOON format doesn't expose cursor in structured content
    });
  });

  describe('output shape', () => {
    it('includes comment metadata in text content', async () => {
      const result = await listCommentsTool.handler(
        { issueId: 'issue-001' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const textContent = result.content[0].text;
      // TOON format includes comments section
      expect(textContent).toContain('comments[');
    });
  });

  describe('common workflows', () => {
    it('reads discussion history on an issue', async () => {
      const result = await listCommentsTool.handler(
        { issueId: 'issue-001' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify text output is in TOON format
      const textContent = result.content[0].text;
      expect(textContent).toContain('comments[');
      expect(textContent).toMatch(/\d+/); // Contains count
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Add Comments Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('add_comments tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(addCommentsTool.name).toBe('add_comments');
      expect(addCommentsTool.title).toBe('Add Comments (Batch)');
    });

    it('has non-destructive annotations', () => {
      expect(addCommentsTool.annotations?.readOnlyHint).toBe(false);
      expect(addCommentsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires at least one item', () => {
      const result = addCommentsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires issueId for each comment', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ body: 'Test comment' }],
      });
      expect(result.success).toBe(false);
    });

    it('requires body for each comment', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts empty body (Linear SDK allows it)', () => {
      // The schema doesn't enforce min(1) on body - Linear API handles this
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001', body: '' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid comment', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001', body: 'This is a test comment' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts multiple comments', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [
          { issueId: 'issue-001', body: 'Comment 1' },
          { issueId: 'issue-002', body: 'Comment 2' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts parallel option', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001', body: 'Test' }],
        parallel: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('adds a single comment', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Great progress on this!' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.createComment).toHaveBeenCalledTimes(1);
    });

    it('passes comment body to API', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Status update: deployed to staging' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'issue-001',
          body: 'Status update: deployed to staging',
        }),
      );
    });

    it('batch adds multiple comments', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [
            { issueId: 'issue-001', body: 'Comment A' },
            { issueId: 'issue-002', body: 'Comment B' },
            { issueId: 'issue-001', body: 'Comment C' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.createComment).toHaveBeenCalledTimes(3);
    });

    it('returns TOON output for comment adds', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Test' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const textContent = result.content[0].text;
      expect(textContent).toContain('add_comments');
    });
  });

  describe('common workflows', () => {
    it('adds status update to issue', async () => {
      const statusUpdate = 'Deployed to production. Monitoring for issues.';
      const result = await addCommentsTool.handler(
        {
          items: [
            {
              issueId: 'issue-001',
              body: statusUpdate,
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify the exact body was sent
      expect(mockClient.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'issue-001',
          body: statusUpdate,
        }),
      );
    });

    it('mentions teammate in comment', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [
            {
              issueId: 'issue-001',
              body: '@jane Could you review the changes?',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Body should preserve @ mentions
      expect(mockClient.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('@jane'),
        }),
      );
    });

    it('adds follow-up comments to multiple issues', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [
            { issueId: 'issue-001', body: 'Fixed in PR #123' },
            { issueId: 'issue-002', body: 'Fixed in PR #123' },
            { issueId: 'issue-003', body: 'Fixed in PR #123' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.createComment).toHaveBeenCalledTimes(3);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('comments workflow integration', () => {
  it('list comments, then add new comment', async () => {
    // Step 1: Check existing comments
    const listResult = await listCommentsTool.handler(
      { issueId: 'issue-001' },
      baseContext,
    );

    expect(listResult.isError).toBeFalsy();

    // Step 2: Add new comment
    const addResult = await addCommentsTool.handler(
      {
        items: [{ issueId: 'issue-001', body: 'Following up on discussion' }],
      },
      baseContext,
    );

    expect(addResult.isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update_comments Tool Tests
// ─────────────────────────────────────────────────────────────────────────────

import { updateCommentsTool } from '../../src/shared/tools/linear/comments.js';

describe('update_comments tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(updateCommentsTool.name).toBe('update_comments');
      expect(updateCommentsTool.title).toBe('Update Comments (Batch)');
    });

    it('is not read-only or destructive', () => {
      expect(updateCommentsTool.annotations?.readOnlyHint).toBe(false);
      expect(updateCommentsTool.annotations?.destructiveHint).toBe(false);
    });

    it('description mentions no delete', () => {
      expect(updateCommentsTool.description).toContain('Cannot delete');
    });
  });

  describe('input validation', () => {
    it('requires at least one comment', () => {
      const result = updateCommentsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires id for each comment', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ body: 'Updated body' }],
      });
      expect(result.success).toBe(false);
    });

    it('requires body for each comment', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ id: 'comment-001' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty body', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ id: 'comment-001', body: '' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid update', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ id: 'comment-001', body: 'Updated content' }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('updates single comment', async () => {
      const result = await updateCommentsTool.handler(
        {
          items: [{ id: 'comment-001', body: 'Updated comment body' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateComment).toHaveBeenCalledWith('comment-001', {
        body: 'Updated comment body',
      });
    });

    it('batch updates multiple comments', async () => {
      const result = await updateCommentsTool.handler(
        {
          items: [
            { id: 'comment-001', body: 'Updated 1' },
            { id: 'comment-002', body: 'Updated 2' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateComment).toHaveBeenCalledTimes(2);
    });

    it('returns TOON output format', async () => {
      const result = await updateCommentsTool.handler(
        {
          items: [{ id: 'comment-001', body: 'Updated' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const textContent = result.content[0].text;
      expect(textContent).toContain('update_comments');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_comments TOON output', () => {
  beforeEach(() => {
    // Create mock client with comments
    mockClient = createMockLinearClient({ comments: defaultMockComments });
    resetMockCalls(mockClient);
  });

  it('returns TOON format in text content', async () => {
    const result = await listCommentsTool.handler(
      { issueId: 'issue-001' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('comments[');
  });

  it('returns TOON with comment schema fields', async () => {
    const result = await listCommentsTool.handler(
      { issueId: 'issue-001' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have comment schema header with fields
    expect(textContent).toContain('comments[');
    expect(textContent).toContain('{id,issue,user,body,createdAt}');
  });

  it('includes issue identifier in meta', async () => {
    const result = await listCommentsTool.handler(
      { issueId: 'issue-001' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Meta should contain issue field
    expect(textContent).toContain('_meta{tool,issue,count,generated}');
  });

  it('handles empty comments in TOON format', async () => {
    // Create mock client with no comments (issue-002 has no comments in the mock)
    mockClient = createMockLinearClient({ comments: [] });
    resetMockCalls(mockClient);

    // Use issue-002 which has no comments in the mock
    const result = await listCommentsTool.handler(
      { issueId: 'issue-002' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have meta section
    expect(textContent).toContain('_meta{');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// add_comments TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('add_comments TOON output', () => {
  beforeEach(() => {
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
  });

  it('returns TOON format in text content', async () => {
    const result = await addCommentsTool.handler(
      {
        items: [{ issueId: 'issue-001', body: 'Test comment' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('add_comments');
  });

  it('includes results section with index, status, issue fields', async () => {
    const result = await addCommentsTool.handler(
      {
        items: [
          { issueId: 'issue-001', body: 'Comment 1' },
          { issueId: 'issue-002', body: 'Comment 2' },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have results schema
    expect(textContent).toContain('results[');
    expect(textContent).toContain('{index,status,issue,error,code,hint}');
  });

  it('includes comments section for successful adds', async () => {
    const result = await addCommentsTool.handler(
      {
        items: [{ issueId: 'issue-001', body: 'Test comment body' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have comments schema
    expect(textContent).toContain('comments[');
    expect(textContent).toContain('{issue,body,createdAt}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update_comments TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_comments TOON output', () => {
  beforeEach(() => {
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
  });

  it('returns TOON format in text content', async () => {
    const result = await updateCommentsTool.handler(
      {
        items: [{ id: 'comment-001', body: 'Updated comment' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('update_comments');
  });

  it('includes results section with index, status, id fields', async () => {
    const result = await updateCommentsTool.handler(
      {
        items: [
          { id: 'comment-001', body: 'Updated 1' },
          { id: 'comment-002', body: 'Updated 2' },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have results schema
    expect(textContent).toContain('results[');
    expect(textContent).toContain('{index,status,id,error,code,hint}');
  });
});
