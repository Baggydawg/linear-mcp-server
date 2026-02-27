/**
 * Tests for document tools (list, create, update).
 * Verifies: document listing, creation, updates, TOON output shapes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentTool,
  listDocumentsTool,
  updateDocumentTool,
} from '../../src/shared/tools/linear/documents.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  defaultMockDocuments,
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
// List Documents Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_documents tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listDocumentsTool.name).toBe('list_documents');
      expect(listDocumentsTool.title).toBe('List Documents');
    });

    it('has readOnlyHint annotation', () => {
      expect(listDocumentsTool.annotations?.readOnlyHint).toBe(true);
      expect(listDocumentsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('handler behavior', () => {
    it('lists documents globally in TOON format', async () => {
      const result = await listDocumentsTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeUndefined();
    });

    it('lists documents filtered by project', async () => {
      const result = await listDocumentsTool.handler(
        { project: 'project-001' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      expect(mockClient.documents).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { project: { id: { eq: 'project-001' } } },
        }),
      );
    });

    it('handles empty results', async () => {
      mockClient = createMockLinearClient({ documents: [] });
      const result = await listDocumentsTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();
    });

    it('supports pagination with cursor', async () => {
      const result = await listDocumentsTool.handler(
        { cursor: 'test-cursor' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      expect(mockClient.documents).toHaveBeenCalledWith(
        expect.objectContaining({ after: 'test-cursor' }),
      );
    });

    it('respects limit parameter', async () => {
      const result = await listDocumentsTool.handler({ limit: 5 }, baseContext);
      expect(result.isError).toBeFalsy();
      expect(mockClient.documents).toHaveBeenCalledWith(
        expect.objectContaining({ first: 5 }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Document Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_document tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(createDocumentTool.name).toBe('create_document');
      expect(createDocumentTool.title).toBe('Create Document');
    });

    it('has correct annotations (not readOnly, not destructive)', () => {
      expect(createDocumentTool.annotations?.readOnlyHint).toBe(false);
      expect(createDocumentTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires title', () => {
      const result = createDocumentTool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts minimal input (title only)', () => {
      const result = createDocumentTool.inputSchema.safeParse({
        title: 'Test Document',
      });
      expect(result.success).toBe(true);
    });

    it('accepts title with content', () => {
      const result = createDocumentTool.inputSchema.safeParse({
        title: 'Test Document',
        content: '## Hello\n\nWorld',
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional cycle', () => {
      const result = createDocumentTool.inputSchema.safeParse({
        title: 'Sprint Summary',
        cycle: 'current',
      });
      expect(result.success).toBe(true);
    });

    it('accepts cycle as number', () => {
      const result = createDocumentTool.inputSchema.safeParse({
        title: 'Sprint Summary',
        cycle: 5,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('creates document with title only', async () => {
      const result = await createDocumentTool.handler(
        { title: 'Test Document' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      expect(mockClient.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Test Document' }),
      );
    });

    it('creates document with content', async () => {
      const result = await createDocumentTool.handler(
        { title: 'Test Document', content: 'Hello world' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      expect(mockClient.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Document',
          content: 'Hello world',
        }),
      );
    });

    it('returns created document in TOON format', async () => {
      const result = await createDocumentTool.handler(
        { title: 'Test Document' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      const textContent = result.content[0].text;
      expect(textContent).toContain('_meta{');
      expect(result.structuredContent).toBeUndefined();
    });

    it('returns error for unknown project short key', async () => {
      mockClient = createMockLinearClient();
      resetMockCalls(mockClient);
      const result = await createDocumentTool.handler(
        { title: 'Test', project: 'pr999' },
        baseContext,
      );
      expect(result.isError).toBe(true);
      const structured = result.structuredContent as Record<string, unknown>;
      const error = structured.error as Record<string, unknown>;
      expect(error.code).toBe('PROJECT_RESOLUTION_FAILED');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Document Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_document tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(updateDocumentTool.name).toBe('update_document');
      expect(updateDocumentTool.title).toBe('Update Document');
    });

    it('has correct annotations', () => {
      expect(updateDocumentTool.annotations?.readOnlyHint).toBe(false);
      expect(updateDocumentTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires id', () => {
      const result = updateDocumentTool.inputSchema.safeParse({
        title: 'Updated Title',
      });
      expect(result.success).toBe(false);
    });

    it('accepts id with title', () => {
      const result = updateDocumentTool.inputSchema.safeParse({
        id: 'doc-001',
        title: 'Updated Title',
      });
      expect(result.success).toBe(true);
    });

    it('accepts id with content', () => {
      const result = updateDocumentTool.inputSchema.safeParse({
        id: 'doc-001',
        content: 'Updated content',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('updates title', async () => {
      const result = await updateDocumentTool.handler(
        { id: 'doc-001', title: 'New Title' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      expect(mockClient.updateDocument).toHaveBeenCalledWith(
        'doc-001',
        expect.objectContaining({ title: 'New Title' }),
      );
    });

    it('updates content', async () => {
      const result = await updateDocumentTool.handler(
        { id: 'doc-001', content: 'New content here.' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      expect(mockClient.updateDocument).toHaveBeenCalledWith(
        'doc-001',
        expect.objectContaining({ content: 'New content here.' }),
      );
    });

    it('updates both title and content', async () => {
      const result = await updateDocumentTool.handler(
        { id: 'doc-001', title: 'New Title', content: 'New content' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      expect(mockClient.updateDocument).toHaveBeenCalledWith(
        'doc-001',
        expect.objectContaining({ title: 'New Title', content: 'New content' }),
      );
    });

    it('returns error when no fields to update', async () => {
      const result = await updateDocumentTool.handler({ id: 'doc-001' }, baseContext);
      expect(result.isError).toBe(true);
      const structured = result.structuredContent as Record<string, unknown>;
      const error = structured.error as Record<string, unknown>;
      expect(error.code).toBe('NO_FIELDS_TO_UPDATE');
    });

    it('returns TOON format on success', async () => {
      const result = await updateDocumentTool.handler(
        { id: 'doc-001', title: 'New Title' },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      const textContent = result.content[0].text;
      expect(textContent).toContain('_meta{');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_documents TOON output', () => {
  it('returns TOON format with schema headers', async () => {
    mockClient = createMockLinearClient({ documents: defaultMockDocuments });
    resetMockCalls(mockClient);
    const result = await listDocumentsTool.handler({}, baseContext);
    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('create_document TOON output', () => {
  it('returns TOON format with action indicator', async () => {
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
    const result = await createDocumentTool.handler(
      { title: 'Test Document', content: 'Test content.' },
      baseContext,
    );
    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('update_document TOON output', () => {
  it('returns TOON format with action indicator', async () => {
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
    const result = await updateDocumentTool.handler(
      { id: 'doc-001', content: 'Updated content.' },
      baseContext,
    );
    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(result.structuredContent).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// list_documents API Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_documents API error handling', () => {
  it('returns structured error when documents fetch fails', async () => {
    mockClient.documents = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await listDocumentsTool.handler(
      { project: 'some-project-id' },
      baseContext,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBeDefined();
  });
});
