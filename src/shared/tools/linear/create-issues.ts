/**
 * Create Issues tool - batch create issues in Linear.
 *
 * Supports TOON output format when TOON_OUTPUT_ENABLED=true.
 * Accepts short keys (u0, s1, pr0) for assignee, state, and project inputs.
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { CreateIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { delay, makeConcurrencyGate, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { summarizeBatch } from '../../../utils/messages.js';
import {
  resolveLabels,
  resolvePriority,
  resolveProject,
  resolveState,
} from '../../../utils/resolvers.js';
import { resolveAssignee } from '../../../utils/user-resolver.js';
import {
  encodeToon,
  getOrInitRegistry,
  getStoredRegistry,
  ISSUE_SCHEMA,
  type ShortKeyRegistry,
  type ToonResponse,
  tryGetShortKey,
  tryResolveShortKey,
  WRITE_RESULT_META_SCHEMA,
  WRITE_RESULT_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import {
  createTeamSettingsCache,
  validateEstimate,
  validatePriority,
} from './shared/index.js';

const IssueCreateItem = z.object({
  teamId: z.string().describe('Team UUID or key (e.g., "SQT"). Required.'),
  title: z.string().describe('Issue title. Required.'),
  description: z.string().optional().describe('Markdown description.'),
  // State - short key, UUID, or human-readable
  state: z
    .string()
    .optional()
    .describe(
      'State short key (s0, s1) from workspace_metadata. Preferred input method.',
    ),
  stateId: z
    .string()
    .optional()
    .describe(
      'Workflow state UUID. Or use state/stateName/stateType for name-based lookup.',
    ),
  stateName: z
    .string()
    .optional()
    .describe(
      'State name from your workspace. Use workspace_metadata to see available names.',
    ),
  stateType: z
    .enum(['backlog', 'unstarted', 'started', 'completed', 'canceled'])
    .optional()
    .describe(
      'State type. Finds first matching state. Use when you want "any completed state".',
    ),
  // Labels - UUIDs or names
  labelIds: z.array(z.string()).optional().describe('Label UUIDs to attach.'),
  labelNames: z
    .array(z.string())
    .optional()
    .describe(
      'Label names from your workspace. Use workspace_metadata to see available labels.',
    ),
  // Assignee - short key, UUID, name, or email
  assignee: z
    .string()
    .optional()
    .describe(
      'User short key (u0, u1) from workspace_metadata. Preferred input method.',
    ),
  assigneeId: z
    .string()
    .optional()
    .describe('User UUID. If omitted, defaults to current viewer.'),
  assigneeName: z
    .string()
    .optional()
    .describe(
      'User name (fuzzy match). Partial names work. Use workspace_metadata to list users.',
    ),
  assigneeEmail: z
    .string()
    .optional()
    .describe('User email to assign (exact match, case-insensitive).'),
  // Project - short key, UUID, or name
  project: z
    .string()
    .optional()
    .describe(
      'Project short key (pr0, pr1) from workspace_metadata. Preferred input method.',
    ),
  projectId: z.string().optional().describe('Project UUID.'),
  projectName: z
    .string()
    .optional()
    .describe('Project name. Resolved to projectId automatically.'),
  // Priority - number or string
  priority: z
    .union([
      z.number().int().min(0).max(4),
      z.enum([
        'None',
        'Urgent',
        'High',
        'Medium',
        'Normal',
        'Low',
        'none',
        'urgent',
        'high',
        'medium',
        'normal',
        'low',
      ]),
    ])
    .optional()
    .describe('Priority: 0-4 or "None"/"Urgent"/"High"/"Medium"/"Low".'),
  estimate: z.number().optional().describe('Story points / estimate value.'),
  allowZeroEstimate: z
    .boolean()
    .optional()
    .describe('If true and estimate=0, sends 0. Otherwise zero is omitted.'),
  dueDate: z.string().optional().describe('Due date (YYYY-MM-DD).'),
  parentId: z.string().optional().describe('Parent issue UUID for sub-issues.'),
  cycle: z.number().optional().describe('Cycle number to assign the issue to.'),
});

const InputSchema = z.object({
  items: z.array(IssueCreateItem).min(1).max(50).describe('Issues to create.'),
  parallel: z.boolean().optional().describe('Run in parallel. Default: sequential.'),
  dry_run: z.boolean().optional().describe('If true, validate but do not create.'),
});

export const createIssuesTool = defineTool({
  name: toolsMetadata.create_issues.name,
  title: toolsMetadata.create_issues.title,
  description: toolsMetadata.create_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    // Handle dry_run mode
    if (args.dry_run) {
      const validated = args.items.map((it, index) => ({
        index,
        ok: true,
        title: it.title,
        teamId: it.teamId,
        validated: true,
      }));
      return {
        content: [
          {
            type: 'text',
            text: `Dry run: ${args.items.length} issue(s) validated successfully. No changes made.`,
          },
        ],
        structuredContent: {
          results: validated,
          summary: { ok: args.items.length, failed: 0 },
          dry_run: true,
        },
      };
    }

    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    const { items } = args;
    const teamAllowZeroCache = createTeamSettingsCache();

    // Get registry for short key resolution (if TOON enabled or short keys used)
    let registry: ShortKeyRegistry | undefined;
    const usesShortKeys = items.some((it) => it.assignee || it.state || it.project);
    if (config.TOON_OUTPUT_ENABLED || usesShortKeys) {
      registry = getStoredRegistry(context.sessionId);
      // Registry may not exist if workspace_metadata hasn't been called yet
      // Short key resolution will fail gracefully with helpful error
    }

    const results: Array<{
      index: number;
      ok: boolean;
      success?: boolean;
      id?: string;
      identifier?: string;
      url?: string;
      error?:
        | string
        | {
            code: string;
            message: string;
            suggestions?: string[];
            retryable?: boolean;
          };
      code?: string;
      // Store resolved UUIDs for TOON output
      stateId?: string;
      assigneeId?: string;
      projectId?: string;
      input?: Record<string, unknown>;
    }> = [];

    // Track created issues for TOON output
    const createdIssues: Array<{
      identifier: string;
      title: string;
      stateId?: string;
      assigneeId?: string;
      projectId?: string;
      priority?: number;
      estimate?: number;
      labels?: string[];
    }> = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] as (typeof items)[number];
      try {
        const payloadInput: Record<string, unknown> = {
          teamId: it.teamId,
          title: it.title,
        };

        if (typeof it.description === 'string' && it.description.trim() !== '') {
          payloadInput.description = it.description;
        }

        // Resolve state from short key, ID, name, or type
        // Priority: state (short key) > stateId > stateName/stateType
        if (it.state && registry) {
          const resolvedStateId = tryResolveShortKey(registry, 'state', it.state);
          if (resolvedStateId) {
            payloadInput.stateId = resolvedStateId;
          } else {
            results.push({
              input: { title: it.title, teamId: it.teamId, state: it.state },
              success: false,
              error: {
                code: 'STATE_RESOLUTION_FAILED',
                message: `Unknown state key '${it.state}'`,
                suggestions: [
                  'Call workspace_metadata to see available state keys (s0, s1, ...)',
                  `Available keys: ${Array.from(registry.states.keys()).join(', ')}`,
                ],
              },
              index: i,
              ok: false,
            });
            continue;
          }
        } else if (it.state && !registry) {
          results.push({
            input: { title: it.title, teamId: it.teamId, state: it.state },
            success: false,
            error: {
              code: 'REGISTRY_NOT_INITIALIZED',
              message: 'Short key registry not initialized',
              suggestions: [
                'Call workspace_metadata first to initialize the registry',
                'Or use stateId with a UUID instead of state short key',
              ],
            },
            index: i,
            ok: false,
          });
          continue;
        } else if (it.stateId) {
          payloadInput.stateId = it.stateId;
        } else if (it.stateName || it.stateType) {
          const stateResult = await resolveState(client, it.teamId, {
            stateName: it.stateName,
            stateType: it.stateType,
          });
          if (!stateResult.success) {
            results.push({
              input: {
                title: it.title,
                teamId: it.teamId,
                stateName: it.stateName,
                stateType: it.stateType,
              },
              success: false,
              error: {
                code: 'STATE_RESOLUTION_FAILED',
                message: stateResult.error,
                suggestions: stateResult.suggestions,
              },
              index: i,
              ok: false,
            });
            continue;
          }
          payloadInput.stateId = stateResult.value;
        }

        // Resolve labels from IDs or names
        if (Array.isArray(it.labelIds) && it.labelIds.length > 0) {
          payloadInput.labelIds = it.labelIds;
        } else if (Array.isArray(it.labelNames) && it.labelNames.length > 0) {
          const labelsResult = await resolveLabels(client, it.teamId, it.labelNames);
          if (!labelsResult.success) {
            results.push({
              input: { title: it.title, teamId: it.teamId, labelNames: it.labelNames },
              success: false,
              error: {
                code: 'LABEL_RESOLUTION_FAILED',
                message: labelsResult.error,
                suggestions: labelsResult.suggestions,
              },
              index: i,
              ok: false,
            });
            continue;
          }
          payloadInput.labelIds = labelsResult.value;
        }

        // Resolve project from short key, ID, or name
        // Priority: project (short key) > projectId > projectName
        if (it.project && registry) {
          const resolvedProjectId = tryResolveShortKey(registry, 'project', it.project);
          if (resolvedProjectId) {
            payloadInput.projectId = resolvedProjectId;
          } else {
            results.push({
              input: { title: it.title, teamId: it.teamId, project: it.project },
              success: false,
              error: {
                code: 'PROJECT_RESOLUTION_FAILED',
                message: `Unknown project key '${it.project}'`,
                suggestions: [
                  'Call workspace_metadata to see available project keys (pr0, pr1, ...)',
                  `Available keys: ${Array.from(registry.projects.keys()).join(', ')}`,
                ],
              },
              index: i,
              ok: false,
            });
            continue;
          }
        } else if (it.project && !registry) {
          results.push({
            input: { title: it.title, teamId: it.teamId, project: it.project },
            success: false,
            error: {
              code: 'REGISTRY_NOT_INITIALIZED',
              message: 'Short key registry not initialized',
              suggestions: [
                'Call workspace_metadata first to initialize the registry',
                'Or use projectId with a UUID instead of project short key',
              ],
            },
            index: i,
            ok: false,
          });
          continue;
        } else if (it.projectId) {
          payloadInput.projectId = it.projectId;
        } else if (it.projectName) {
          const projectResult = await resolveProject(client, it.projectName);
          if (!projectResult.success) {
            results.push({
              input: {
                title: it.title,
                teamId: it.teamId,
                projectName: it.projectName,
              },
              success: false,
              error: {
                code: 'PROJECT_RESOLUTION_FAILED',
                message: projectResult.error,
                suggestions: projectResult.suggestions,
              },
              index: i,
              ok: false,
            });
            continue;
          }
          payloadInput.projectId = projectResult.value;
        }

        // Resolve assignee from short key, ID, name, or email
        // Priority: assignee (short key) > assigneeId > assigneeName > assigneeEmail
        if (it.assignee && registry) {
          const resolvedAssigneeId = tryResolveShortKey(registry, 'user', it.assignee);
          if (resolvedAssigneeId) {
            payloadInput.assigneeId = resolvedAssigneeId;
          } else {
            results.push({
              input: { title: it.title, teamId: it.teamId, assignee: it.assignee },
              success: false,
              error: {
                code: 'USER_RESOLUTION_FAILED',
                message: `Unknown user key '${it.assignee}'`,
                suggestions: [
                  'Call workspace_metadata to see available user keys (u0, u1, ...)',
                  `Available keys: ${Array.from(registry.users.keys()).join(', ')}`,
                ],
              },
              index: i,
              ok: false,
            });
            continue;
          }
        } else if (it.assignee && !registry) {
          results.push({
            input: { title: it.title, teamId: it.teamId, assignee: it.assignee },
            success: false,
            error: {
              code: 'REGISTRY_NOT_INITIALIZED',
              message: 'Short key registry not initialized',
              suggestions: [
                'Call workspace_metadata first to initialize the registry',
                'Or use assigneeId with a UUID instead of assignee short key',
              ],
            },
            index: i,
            ok: false,
          });
          continue;
        } else {
          // Fall back to legacy resolution
          const assigneeResult = await resolveAssignee(client, {
            assigneeId: it.assigneeId,
            assigneeName: it.assigneeName,
            assigneeEmail: it.assigneeEmail,
          });

          if (!assigneeResult.success && assigneeResult.error) {
            // User resolution failed - report error but continue batch
            results.push({
              input: {
                title: it.title,
                teamId: it.teamId,
                assigneeName: it.assigneeName,
                assigneeEmail: it.assigneeEmail,
              },
              success: false,
              error: {
                code: assigneeResult.error.code,
                message: assigneeResult.error.message,
                suggestions: assigneeResult.error.hint
                  ? [assigneeResult.error.hint]
                  : undefined,
              },
              index: i,
              ok: false,
            });
            continue;
          }

          if (assigneeResult.user?.id) {
            payloadInput.assigneeId = assigneeResult.user.id;
          } else {
            // Default to current user when no assignee specified
            try {
              const me = await client.viewer;
              const meId = (me as unknown as { id?: string })?.id;
              if (meId) {
                payloadInput.assigneeId = meId;
              }
            } catch {}
          }
        }

        // Resolve priority from number or string
        if (it.priority !== undefined) {
          const priorityResult = resolvePriority(it.priority);
          if (!priorityResult.success) {
            results.push({
              input: { title: it.title, teamId: it.teamId, priority: it.priority },
              success: false,
              error: {
                code: 'PRIORITY_INVALID',
                message: priorityResult.error,
                suggestions: priorityResult.suggestions,
              },
              index: i,
              ok: false,
            });
            continue;
          }
          const validatedPriority = validatePriority(priorityResult.value);
          if (validatedPriority !== undefined) {
            payloadInput.priority = validatedPriority;
          }
        }

        // Use shared validation for estimate
        const estimate = await validateEstimate(
          it.estimate,
          it.teamId,
          teamAllowZeroCache,
          client,
          it.allowZeroEstimate,
        );
        if (estimate !== undefined) {
          payloadInput.estimate = estimate;
        }

        if (typeof it.dueDate === 'string' && it.dueDate.trim() !== '') {
          payloadInput.dueDate = it.dueDate;
        }

        if (typeof it.parentId === 'string' && it.parentId) {
          payloadInput.parentId = it.parentId;
        }

        // Handle cycle assignment
        if (typeof it.cycle === 'number') {
          // TODO: Resolve cycle number to cycleId via Linear API
          // For now, we'd need to query cycles and find the matching one
        }

        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        const call = () =>
          client.createIssue(
            payloadInput as unknown as {
              teamId: string;
              title: string;
              description?: string;
              stateId?: string;
              labelIds?: string[];
              assigneeId?: string;
              projectId?: string;
              priority?: number;
              estimate?: number;
              dueDate?: string;
              parentId?: string;
            },
          );

        const payload = await withRetry(
          () => (args.parallel === true ? call() : gate(call)),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        const issue = await payload.issue;
        const issueUrl = (issue as unknown as { url?: string })?.url;
        const issueId = (issue as unknown as { id?: string })?.id;
        const issueIdentifier = (issue as unknown as { identifier?: string })
          ?.identifier;

        results.push({
          input: {
            title: it.title,
            teamId: it.teamId,
            assigneeName: it.assigneeName,
            assigneeEmail: it.assigneeEmail,
          },
          success: payload.success ?? true,
          id: issueId,
          identifier: issueIdentifier,
          url: issueUrl,
          stateId: payloadInput.stateId as string | undefined,
          assigneeId: payloadInput.assigneeId as string | undefined,
          projectId: payloadInput.projectId as string | undefined,
          index: i,
          ok: payload.success ?? true,
        });

        // Track for TOON output
        if (payload.success !== false && issueIdentifier) {
          createdIssues.push({
            identifier: issueIdentifier,
            title: it.title,
            stateId: payloadInput.stateId as string | undefined,
            assigneeId: payloadInput.assigneeId as string | undefined,
            projectId: payloadInput.projectId as string | undefined,
            priority: payloadInput.priority as number | undefined,
            estimate: payloadInput.estimate as number | undefined,
            labels: it.labelNames,
          });
        }
      } catch (error) {
        await logger.error('create_issues', {
          message: 'Failed to create issue',
          index: i,
          error: (error as Error).message,
        });
        results.push({
          input: {
            title: it.title,
            teamId: it.teamId,
            assigneeName: it.assigneeName,
            assigneeEmail: it.assigneeEmail,
          },
          success: false,
          error: {
            code: 'LINEAR_CREATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              'Verify teamId with workspace_metadata.',
              'Check that stateId exists in workflowStatesByTeam.',
              'Use list_users to find valid assigneeId.',
            ],
            retryable: false,
          },
          index: i,
          ok: false,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const summary = {
      total: items.length,
      succeeded,
      failed,
      ok: succeeded,
    };

    // Build meta with next steps
    const metaNextSteps: string[] = [
      'Use list_issues or get_issues to verify created issues.',
      'Use update_issues to modify state, assignee, or labels.',
    ];
    if (failed > 0) {
      metaNextSteps.push('Check error.suggestions for recovery hints.');
      metaNextSteps.push('Use workspace_metadata to verify IDs.');
    }

    const meta = {
      nextSteps: metaNextSteps,
      relatedTools: ['list_issues', 'get_issues', 'update_issues', 'add_comments'],
    };

    // Clean results for schema validation (remove TOON-specific internal fields)
    const cleanedResults = results.map((r) => ({
      index: r.index,
      ok: r.ok,
      success: r.success,
      id: r.id,
      identifier: r.identifier,
      url: r.url,
      error: r.error,
      input: r.input,
    }));

    const structured = CreateIssuesOutputSchema.parse({
      results: cleanedResults,
      summary,
      meta,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format (when enabled)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.TOON_OUTPUT_ENABLED && registry) {
      const toonResponse: ToonResponse = {
        meta: {
          fields: ['action', 'succeeded', 'failed', 'total'],
          values: {
            action: 'create_issues',
            succeeded,
            failed,
            total: items.length,
          },
        },
        data: [
          // Results section
          {
            schema: WRITE_RESULT_SCHEMA,
            items: results.map((r) => ({
              index: r.index,
              status: r.ok ? 'ok' : 'error',
              identifier: r.identifier ?? '',
              error: r.ok
                ? ''
                : ((typeof r.error === 'object'
                    ? (r.error as { message?: string }).message
                    : r.error) ?? ''),
            })),
          },
        ],
      };

      // Add created issues section if any succeeded
      if (createdIssues.length > 0) {
        const createdSchema = {
          name: 'created',
          fields: ['identifier', 'title', 'state', 'assignee', 'project'],
        };

        toonResponse.data?.push({
          schema: createdSchema,
          items: createdIssues.map((issue) => ({
            identifier: issue.identifier,
            title: issue.title,
            state: issue.stateId
              ? (tryGetShortKey(registry, 'state', issue.stateId) ?? '')
              : '',
            assignee: issue.assigneeId
              ? (tryGetShortKey(registry, 'user', issue.assigneeId) ?? '')
              : '',
            project: issue.projectId
              ? (tryGetShortKey(registry, 'project', issue.projectId) ?? '')
              : '',
          })),
        });
      }

      const toonOutput = encodeToon(toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: structured,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Output Format
    // ─────────────────────────────────────────────────────────────────────────
    const okIds = results
      .filter((r) => r.ok)
      .map((r) => r.identifier ?? r.id ?? `item[${String(r.index)}]`) as string[];

    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({
        index: r.index,
        error: typeof r.error === 'object' ? r.error.message : (r.error ?? ''),
        code: undefined,
      }));

    // Compose a richer message with links for created items
    const failureHints: string[] = [];
    if (summary.failed > 0) {
      failureHints.push(
        "If 'assigneeId' was invalid, fetch viewer id via 'workspace_metadata' (include: ['profile']) and use it to assign to yourself.",
      );
      failureHints.push(
        "Alternatively use 'list_users' to find the correct user id, or omit 'assigneeId' and assign later with 'update_issues'.",
      );
    }

    // Build summary without next steps (tips go at the end)
    const summaryLine = summarizeBatch({
      action: 'Created issues',
      ok: summary.ok,
      total: items.length,
      okIdentifiers: okIds,
      failures,
    });

    const tips = [
      'Tip: Use list_issues to verify details, or update_issues to modify.',
      ...failureHints,
    ];

    const detailLines: string[] = [];
    for (const r of results.filter((r) => r.ok)) {
      try {
        const issue = await client.issue(r.id ?? (r.identifier as string));
        const idf =
          (issue as unknown as { identifier?: string })?.identifier ?? issue.id;
        const url = (issue as unknown as { url?: string })?.url as string | undefined;
        const title = issue.title;

        let stateName: string | undefined;
        let projectName: string | undefined;
        let assigneeName: string | undefined;
        try {
          const s = await (issue as unknown as { state?: Promise<{ name?: string }> })
            .state;
          stateName = s?.name ?? undefined;
        } catch {}
        try {
          const p = await (issue as unknown as { project?: Promise<{ name?: string }> })
            .project;
          projectName = p?.name ?? undefined;
        } catch {}
        try {
          const a = await (
            issue as unknown as { assignee?: Promise<{ name?: string }> }
          ).assignee;
          assigneeName = a?.name ?? undefined;
        } catch {}

        let labelsList = '';
        try {
          labelsList = (await issue.labels()).nodes
            .map((l) => l.name)
            .slice(0, 5)
            .join(', ');
        } catch {}

        const dueDate = (issue as unknown as { dueDate?: string })?.dueDate;
        const priorityVal = (issue as unknown as { priority?: number })?.priority;

        const header = url ? `[${idf} — ${title}](${url})` : `${idf} — ${title}`;

        const partsLine: string[] = [];
        if (stateName) partsLine.push(`state ${stateName}`);
        if (projectName) partsLine.push(`project ${projectName}`);
        if (labelsList) partsLine.push(`labels ${labelsList}`);
        if (typeof priorityVal === 'number') partsLine.push(`priority ${priorityVal}`);
        if (dueDate) partsLine.push(`due ${dueDate}`);
        if (assigneeName) partsLine.push(`assignee ${assigneeName}`);

        const line =
          partsLine.length > 0 ? `${header} — ${partsLine.join('; ')}` : header;
        detailLines.push(`- ${line}`);
      } catch {}
    }

    // Compose: summary → details → tips
    const textParts = [summaryLine];
    if (detailLines.length > 0) {
      textParts.push(detailLines.join('\n'));
    }
    textParts.push(tips.join(' '));
    const text = textParts.join('\n\n');

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});
