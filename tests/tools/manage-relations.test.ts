/**
 * Tests for manage_relations tool (create, update, delete issue relations).
 * Verifies: tool metadata, input validation, handler behavior, TOON output, error handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manageRelationsTool } from '../../src/shared/tools/linear/manage-relations.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
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
// Tool Metadata Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('manage_relations tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(manageRelationsTool.name).toBe('manage_relations');
      expect(manageRelationsTool.title).toBe('Manage Issue Relations');
    });

    it('has correct annotations', () => {
      expect(manageRelationsTool.annotations?.readOnlyHint).toBe(false);
      expect(manageRelationsTool.annotations?.destructiveHint).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Input Validation Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('input validation', () => {
    it('accepts valid create item', () => {
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [
          {
            action: 'create',
            issueId: 'SQT-123',
            relatedIssueId: 'SQT-124',
            type: 'blocks',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid update item', () => {
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [
          {
            action: 'update',
            id: 'relation-001',
            type: 'related',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid delete item', () => {
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [
          {
            action: 'delete',
            id: 'relation-001',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts mixed batch (create + delete)', () => {
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [
          {
            action: 'create',
            issueId: 'SQT-123',
            relatedIssueId: 'SQT-124',
            type: 'blocks',
          },
          {
            action: 'delete',
            id: 'relation-001',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty items array', () => {
      const result = manageRelationsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('rejects create without required fields', () => {
      // Missing relatedIssueId and type
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [{ action: 'create', issueId: 'SQT-123' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid type value', () => {
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [
          {
            action: 'create',
            issueId: 'SQT-123',
            relatedIssueId: 'SQT-124',
            type: 'invalid_type',
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects update without id', () => {
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [{ action: 'update', type: 'related' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects delete without id', () => {
      const result = manageRelationsTool.inputSchema.safeParse({
        items: [{ action: 'delete' }],
      });
      expect(result.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Handler Behavior Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('handler behavior', () => {
    it('create resolves identifiers and calls createIssueRelation with UUIDs', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'create',
              issueId: 'SQT-123',
              relatedIssueId: 'SQT-124',
              type: 'blocks',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient._calls.createIssueRelation.length).toBe(1);
      expect(mockClient._calls.createIssueRelation[0]).toEqual(
        expect.objectContaining({
          issueId: 'issue-001',
          relatedIssueId: 'issue-002',
          type: 'blocks',
        }),
      );
    });

    it('update calls updateIssueRelation with correct id and input', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'update',
              id: 'relation-001',
              type: 'duplicate',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient._calls.updateIssueRelation.length).toBe(1);
      expect(mockClient._calls.updateIssueRelation[0]).toEqual({
        id: 'relation-001',
        input: { type: 'duplicate' },
      });
    });

    it('delete calls deleteIssueRelation with correct id', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'delete',
              id: 'relation-001',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient._calls.deleteIssueRelation.length).toBe(1);
      expect(mockClient._calls.deleteIssueRelation[0]).toBe('relation-001');
    });

    it('mixed batch processes all items with correct succeeded/failed counts', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'create',
              issueId: 'SQT-123',
              relatedIssueId: 'SQT-124',
              type: 'related',
            },
            {
              action: 'delete',
              id: 'relation-001',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('succeeded');
      expect(text).toContain('2');
      expect(mockClient._calls.createIssueRelation.length).toBe(1);
      expect(mockClient._calls.deleteIssueRelation.length).toBe(1);
    });

    it('create with nonexistent issue returns ISSUE_NOT_FOUND', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'create',
              issueId: 'NONEXISTENT-999',
              relatedIssueId: 'SQT-124',
              type: 'blocks',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('ISSUE_NOT_FOUND');
      expect(text).toContain('error');
    });

    it('update with no fields provided returns NO_FIELDS_TO_UPDATE', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'update',
              id: 'relation-001',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('NO_FIELDS_TO_UPDATE');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TOON Output Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('TOON output', () => {
    it('output contains _meta section with correct fields', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'create',
              issueId: 'SQT-123',
              relatedIssueId: 'SQT-124',
              type: 'blocks',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('_meta{action,succeeded,failed,total}:');
    });

    it('output contains results section with correct schema', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'delete',
              id: 'relation-001',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('results[');
      expect(text).toContain('{index,status,action,from,type,to,id,error,code,hint}');
    });

    it('successful create includes relations section with relation UUID', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'create',
              issueId: 'SQT-123',
              relatedIssueId: 'SQT-124',
              type: 'blocks',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('relations[');
      expect(text).toContain('relation-new-');
    });

    it('error result includes error code and hint', async () => {
      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'create',
              issueId: 'NONEXISTENT-999',
              relatedIssueId: 'SQT-124',
              type: 'blocks',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('ISSUE_NOT_FOUND');
      expect(text).toContain('Verify identifier');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Error Handling Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('API error on create returns LINEAR_RELATION_ERROR', async () => {
      (mockClient.createIssueRelation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API rate limit exceeded'),
      );

      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'create',
              issueId: 'SQT-123',
              relatedIssueId: 'SQT-124',
              type: 'blocks',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('LINEAR_RELATION_ERROR');
    });

    it('API error on delete returns LINEAR_RELATION_ERROR', async () => {
      (mockClient.deleteIssueRelation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Relation not found'),
      );

      const result = await manageRelationsTool.handler(
        {
          items: [
            {
              action: 'delete',
              id: 'relation-nonexistent',
            },
          ],
        },
        baseContext,
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('LINEAR_RELATION_ERROR');
    });
  });
});
