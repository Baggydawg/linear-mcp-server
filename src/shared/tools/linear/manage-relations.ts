/**
 * Manage Relations tool - create, update, or delete issue relations.
 *
 * Uses TOON output format (Tier 2):
 * - Returns TOON format with per-item results and created relations
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { delay, makeConcurrencyGate, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import {
  encodeToon,
  RELATION_SCHEMA_WITH_ID,
  RELATION_WRITE_RESULT_SCHEMA,
  type ToonResponse,
  type ToonRow,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input Schema (Discriminated Union)
// ─────────────────────────────────────────────────────────────────────────────

const CreateAction = z.object({
  action: z.literal('create'),
  issueId: z.string().describe('Source issue identifier (e.g. SQT-123) or UUID.'),
  relatedIssueId: z
    .string()
    .describe('Target issue identifier (e.g. SQT-456) or UUID.'),
  type: z
    .enum(['blocks', 'related', 'duplicate'])
    .describe(
      'Relation type. "blocks": issueId blocks relatedIssueId. "duplicate": issueId is duplicate of relatedIssueId. "related": bidirectional.',
    ),
});

const UpdateAction = z.object({
  action: z.literal('update'),
  id: z
    .string()
    .describe('Relation UUID (from get_sprint_context with includeRelations: true).'),
  type: z
    .enum(['blocks', 'related', 'duplicate'])
    .optional()
    .describe('New relation type.'),
  issueId: z.string().optional().describe('New source issue identifier or UUID.'),
  relatedIssueId: z
    .string()
    .optional()
    .describe('New target issue identifier or UUID.'),
});

const DeleteAction = z.object({
  action: z.literal('delete'),
  id: z.string().describe('Relation UUID to delete.'),
});

const RelationItem = z.discriminatedUnion('action', [
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

const InputSchema = z.object({
  items: z
    .array(RelationItem)
    .min(1)
    .max(50)
    .describe('Relation operations. Batch up to 50.'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────────────────

export const manageRelationsTool = defineTool({
  name: toolsMetadata.manage_relations.name,
  title: toolsMetadata.manage_relations.title,
  description: toolsMetadata.manage_relations.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);

    // Track results for TOON output
    const results: {
      index: number;
      ok: boolean;
      action: string;
      from?: string;
      type?: string;
      to?: string;
      id?: string;
      error?: string | { code: string; message: string; suggestions: string[] };
      code?: string;
      success?: boolean;
    }[] = [];

    for (let i = 0; i < args.items.length; i++) {
      const it = args.items[i];
      if (!it) continue;

      try {
        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        if (it.action === 'create') {
          // ── Create ──────────────────────────────────────────────────────
          // Resolve source issue
          let sourceUUID: string;
          let sourceIdentifier: string;
          try {
            const sourceIssue = await client.issue(it.issueId);
            sourceUUID = sourceIssue.id;
            sourceIdentifier =
              (sourceIssue as unknown as { identifier?: string }).identifier ??
              it.issueId;
          } catch {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'create',
              from: it.issueId,
              type: it.type,
              to: it.relatedIssueId,
              error: {
                code: 'ISSUE_NOT_FOUND',
                message: `Source issue '${it.issueId}' not found.`,
                suggestions: ['Verify identifier with list_issues or get_issues.'],
              },
              code: 'ISSUE_NOT_FOUND',
            });
            continue;
          }

          // Resolve target issue
          let targetUUID: string;
          let targetIdentifier: string;
          try {
            const targetIssue = await client.issue(it.relatedIssueId);
            targetUUID = targetIssue.id;
            targetIdentifier =
              (targetIssue as unknown as { identifier?: string }).identifier ??
              it.relatedIssueId;
          } catch {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'create',
              from: sourceIdentifier,
              type: it.type,
              to: it.relatedIssueId,
              error: {
                code: 'ISSUE_NOT_FOUND',
                message: `Target issue '${it.relatedIssueId}' not found.`,
                suggestions: ['Verify identifier with list_issues or get_issues.'],
              },
              code: 'ISSUE_NOT_FOUND',
            });
            continue;
          }

          const call = () =>
            client.createIssueRelation({
              issueId: sourceUUID,
              relatedIssueId: targetUUID,
              type: it.type as unknown as Parameters<
                typeof client.createIssueRelation
              >[0]['type'],
            });

          const payload = await withRetry(() => gate(call), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          const relationId = (payload as unknown as { issueRelation?: { id?: string } })
            .issueRelation?.id;

          results.push({
            index: i,
            ok: true,
            success: true,
            action: 'create',
            from: sourceIdentifier,
            type: it.type,
            to: targetIdentifier,
            id: relationId,
          });
        } else if (it.action === 'update') {
          // ── Update ──────────────────────────────────────────────────────
          const updateInput: Record<string, unknown> = {};

          if (it.type) {
            updateInput.type = it.type;
          }

          if (it.issueId) {
            try {
              const sourceIssue = await client.issue(it.issueId);
              updateInput.issueId = sourceIssue.id;
            } catch {
              results.push({
                index: i,
                ok: false,
                success: false,
                action: 'update',
                id: it.id,
                error: {
                  code: 'ISSUE_NOT_FOUND',
                  message: `Source issue '${it.issueId}' not found.`,
                  suggestions: ['Verify identifier with list_issues or get_issues.'],
                },
                code: 'ISSUE_NOT_FOUND',
              });
              continue;
            }
          }

          if (it.relatedIssueId) {
            try {
              const targetIssue = await client.issue(it.relatedIssueId);
              updateInput.relatedIssueId = targetIssue.id;
            } catch {
              results.push({
                index: i,
                ok: false,
                success: false,
                action: 'update',
                id: it.id,
                error: {
                  code: 'ISSUE_NOT_FOUND',
                  message: `Target issue '${it.relatedIssueId}' not found.`,
                  suggestions: ['Verify identifier with list_issues or get_issues.'],
                },
                code: 'ISSUE_NOT_FOUND',
              });
              continue;
            }
          }

          if (Object.keys(updateInput).length === 0) {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'update',
              id: it.id,
              error: {
                code: 'NO_FIELDS_TO_UPDATE',
                message: 'No fields provided to update.',
                suggestions: [
                  'Provide at least one of: type, issueId, relatedIssueId.',
                ],
              },
              code: 'NO_FIELDS_TO_UPDATE',
            });
            continue;
          }

          const call = () => client.updateIssueRelation(it.id, updateInput);

          await withRetry(() => gate(call), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          results.push({
            index: i,
            ok: true,
            success: true,
            action: 'update',
            id: it.id,
          });
        } else if (it.action === 'delete') {
          // ── Delete ──────────────────────────────────────────────────────
          const call = () => client.deleteIssueRelation(it.id);

          await withRetry(() => gate(call), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          results.push({
            index: i,
            ok: true,
            success: true,
            action: 'delete',
            id: it.id,
          });
        }
      } catch (error) {
        await logger.error('manage_relations', {
          message: `Failed to ${it.action} relation`,
          index: i,
          error: (error as Error).message,
        });
        results.push({
          index: i,
          ok: false,
          success: false,
          action: it.action,
          id: 'id' in it ? it.id : undefined,
          error: {
            code: 'LINEAR_RELATION_ERROR',
            message: (error as Error).message,
            suggestions: ['Verify inputs with get_sprint_context or list_issues.'],
          },
          code: 'LINEAR_RELATION_ERROR',
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // ── Build TOON results section ──────────────────────────────────────────
    const toonResults: ToonRow[] = results.map((r) => {
      const errObj =
        typeof r.error === 'object'
          ? (r.error as { code?: string; message?: string; suggestions?: string[] })
          : null;
      return {
        index: r.index,
        status: r.success ? 'ok' : 'error',
        action: r.action,
        from: r.from ?? '',
        type: r.type ?? '',
        to: r.to ?? '',
        id: r.id ?? '',
        error: r.success
          ? ''
          : (errObj?.message ?? (typeof r.error === 'string' ? r.error : '')),
        code: r.success ? '' : (errObj?.code ?? ''),
        hint: r.success ? '' : (errObj?.suggestions?.[0] ?? ''),
      };
    });

    // ── Build created relations section (only successful creates) ───────────
    const createdRelations: ToonRow[] = results
      .filter((r) => r.success && r.action === 'create')
      .map((r) => ({
        id: r.id ?? '',
        from: r.from ?? '',
        type: r.type ?? '',
        to: r.to ?? '',
      }));

    // ── Build TOON response ─────────────────────────────────────────────────
    const toonResponse: ToonResponse = {
      meta: {
        fields: ['action', 'succeeded', 'failed', 'total'],
        values: {
          action: 'manage_relations',
          succeeded,
          failed,
          total: args.items.length,
        },
      },
      data: [
        { schema: RELATION_WRITE_RESULT_SCHEMA, items: toonResults },
        ...(createdRelations.length > 0
          ? [{ schema: RELATION_SCHEMA_WITH_ID, items: createdRelations }]
          : []),
      ],
    };

    const toonOutput = encodeToon(toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
