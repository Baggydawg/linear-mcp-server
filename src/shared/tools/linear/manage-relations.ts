/**
 * Manage Relations tool - create or delete issue relations.
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
  RELATION_SCHEMA,
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
  from: z
    .string()
    .describe('Source issue identifier (e.g. SQT-123). "from" blocks/duplicates "to".'),
  to: z.string().describe('Target issue identifier (e.g. SQT-456).'),
  type: z
    .enum(['blocks', 'related', 'duplicate'])
    .describe(
      'Relation type. "blocks": from blocks to. "duplicate": from is duplicate of to. "related": bidirectional.',
    ),
});

const DeleteAction = z.object({
  action: z.literal('delete'),
  from: z.string().describe('Source issue identifier (e.g. SQT-123).'),
  to: z.string().describe('Target issue identifier (e.g. SQT-456).'),
  type: z.enum(['blocks', 'related', 'duplicate']).describe('Relation type to delete.'),
});

const RelationItem = z.discriminatedUnion('action', [CreateAction, DeleteAction]);

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
            const sourceIssue = await client.issue(it.from);
            sourceUUID = sourceIssue.id;
            sourceIdentifier =
              (sourceIssue as unknown as { identifier?: string }).identifier ?? it.from;
          } catch {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'create',
              from: it.from,
              type: it.type,
              to: it.to,
              error: {
                code: 'ISSUE_NOT_FOUND',
                message: `Source issue '${it.from}' not found.`,
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
            const targetIssue = await client.issue(it.to);
            targetUUID = targetIssue.id;
            targetIdentifier =
              (targetIssue as unknown as { identifier?: string }).identifier ?? it.to;
          } catch {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'create',
              from: sourceIdentifier,
              type: it.type,
              to: it.to,
              error: {
                code: 'ISSUE_NOT_FOUND',
                message: `Target issue '${it.to}' not found.`,
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

          await withRetry(() => gate(call), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          results.push({
            index: i,
            ok: true,
            success: true,
            action: 'create',
            from: sourceIdentifier,
            type: it.type,
            to: targetIdentifier,
          });
        } else if (it.action === 'delete') {
          // ── Delete ──────────────────────────────────────────────────────
          // Resolve source issue
          let sourceIdentifier: string;
          let sourceIssue: { id: string; identifier?: string };
          try {
            const resolved = await client.issue(it.from);
            sourceIssue = resolved as unknown as { id: string; identifier?: string };
            sourceIdentifier =
              (resolved as unknown as { identifier?: string }).identifier ?? it.from;
          } catch {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'delete',
              from: it.from,
              type: it.type,
              to: it.to,
              error: {
                code: 'ISSUE_NOT_FOUND',
                message: `Source issue '${it.from}' not found.`,
                suggestions: ['Verify identifier with list_issues or get_issues.'],
              },
              code: 'ISSUE_NOT_FOUND',
            });
            continue;
          }

          // Resolve target issue
          let targetIdentifier: string;
          let targetIssue: { id: string; identifier?: string };
          try {
            const resolved = await client.issue(it.to);
            targetIssue = resolved as unknown as { id: string; identifier?: string };
            targetIdentifier =
              (resolved as unknown as { identifier?: string }).identifier ?? it.to;
          } catch {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'delete',
              from: sourceIdentifier,
              type: it.type,
              to: it.to,
              error: {
                code: 'ISSUE_NOT_FOUND',
                message: `Target issue '${it.to}' not found.`,
                suggestions: ['Verify identifier with list_issues or get_issues.'],
              },
              code: 'ISSUE_NOT_FOUND',
            });
            continue;
          }

          // Fetch relations for the source issue via SDK lazy-loading
          const relationsData = await (
            sourceIssue as unknown as {
              relations?: () => Promise<{
                nodes: Array<{
                  id: string;
                  type: string;
                  _relatedIssue?: { id: string };
                  relatedIssue?: { id: string };
                }>;
              }>;
            }
          ).relations?.();

          const relNodes = relationsData?.nodes ?? [];

          // Match by type + target UUID.
          // The raw SDK object stores _relatedIssue.id synchronously (production).
          // In mocks, relatedIssue is a plain object, so we fall back to relatedIssue?.id.
          const match = relNodes.find(
            (r) =>
              r.type === it.type &&
              ((r as unknown as { _relatedIssue?: { id: string } })._relatedIssue
                ?.id === targetIssue.id ||
                (r as unknown as { relatedIssue?: { id: string } }).relatedIssue?.id ===
                  targetIssue.id),
          );

          if (!match) {
            results.push({
              index: i,
              ok: false,
              success: false,
              action: 'delete',
              from: sourceIdentifier,
              type: it.type,
              to: targetIdentifier,
              error: {
                code: 'RELATION_NOT_FOUND',
                message: `No '${it.type}' relation found from '${sourceIdentifier}' to '${targetIdentifier}'.`,
                suggestions: [
                  'Verify relation exists with list_issues or get_sprint_context.',
                ],
              },
              code: 'RELATION_NOT_FOUND',
            });
            continue;
          }

          // Delete using the resolved UUID
          await withRetry(() => gate(() => client.deleteIssueRelation(match.id)), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          results.push({
            index: i,
            ok: true,
            success: true,
            action: 'delete',
            from: sourceIdentifier,
            type: it.type,
            to: targetIdentifier,
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
          from: 'from' in it ? it.from : undefined,
          type: 'type' in it ? it.type : undefined,
          to: 'to' in it ? it.to : undefined,
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
          ? [{ schema: RELATION_SCHEMA, items: createdRelations }]
          : []),
      ],
    };

    const toonOutput = encodeToon(toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
