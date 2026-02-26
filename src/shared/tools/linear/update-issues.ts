/**
 * Update Issues tool - batch update issues in Linear.
 *
 * Returns TOON output format.
 * Accepts short keys (u0, s1, pr0) for assignee, state, and project inputs.
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { delay, makeConcurrencyGate, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import {
  getIssueTeamId,
  normalizeCycleSelector,
  resolveCycleNumber,
  resolveCycleNumberToId,
  resolveCycleSelector,
  resolveEstimate,
  resolveLabels,
  resolvePriority,
  resolveProject,
  resolveState,
} from '../../../utils/resolvers.js';
import { resolveAssignee } from '../../../utils/user-resolver.js';
import {
  CHANGES_SCHEMA,
  encodeToon,
  formatEstimateToon,
  formatPriorityToon,
  getStoredRegistry,
  type ShortKeyRegistry,
  type ToonResponse,
  tryGetShortKey,
  tryResolveShortKey,
  WRITE_RESULT_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import {
  captureIssueSnapshot,
  computeFieldChanges,
  createTeamSettingsCache,
  validateEstimate,
  validateLabelKeyPrefix,
  validatePriority,
  validateStateBelongsToTeam,
  validateStateKeyPrefix,
} from './shared/index.js';

const IssueUpdateItem = z.object({
  id: z.string().describe('Issue UUID or identifier (e.g. ENG-123). Required.'),
  title: z.string().optional().describe('New title.'),
  description: z.string().optional().describe('New markdown description.'),
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
      "State name from issue's team. Use workspace_metadata to see available names.",
    ),
  stateType: z
    .enum(['backlog', 'unstarted', 'started', 'completed', 'canceled'])
    .optional()
    .describe('State type. Finds first matching state.'),
  // Labels - UUIDs or names (use workspace_metadata to see available labels)
  labelIds: z
    .array(z.string())
    .optional()
    .describe('Replace all labels with these UUIDs.'),
  labelNames: z
    .array(z.string())
    .optional()
    .describe('Replace all labels with these names from your workspace.'),
  addLabelIds: z
    .array(z.string())
    .optional()
    .describe('Add these label UUIDs (incremental).'),
  addLabelNames: z
    .array(z.string())
    .optional()
    .describe('Add these label names (incremental).'),
  removeLabelIds: z
    .array(z.string())
    .optional()
    .describe('Remove these label UUIDs (incremental).'),
  removeLabelNames: z
    .array(z.string())
    .optional()
    .describe('Remove these label names (incremental).'),
  // Assignee - short key, UUID, name, or email (use workspace_metadata to list users)
  assignee: z
    .string()
    .optional()
    .describe(
      'User short key (u0, u1) from workspace_metadata. Preferred input method.',
    ),
  assigneeId: z.string().optional().describe('New assignee user UUID.'),
  assigneeName: z
    .string()
    .optional()
    .describe('User name (fuzzy match). Partial names work.'),
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
  projectId: z.string().optional().describe('New project UUID.'),
  projectName: z.string().optional().describe('Project name. Resolved to projectId.'),
  // Priority - number or string
  priority: z
    .union([z.number().int().min(0).max(4), z.string()])
    .optional()
    .describe('Priority (0-4 or p0-p4)'),
  estimate: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Estimate points (number or e-prefixed like e5)'),
  allowZeroEstimate: z
    .boolean()
    .optional()
    .describe('If true and estimate=0, sends 0. Otherwise zero is omitted.'),
  dueDate: z
    .string()
    .optional()
    .describe('New due date (YYYY-MM-DD) or empty string to clear.'),
  parentId: z.string().optional().describe('New parent issue UUID.'),
  archived: z
    .boolean()
    .optional()
    .describe(
      'Set true to archive (Linear equivalent of delete - removes from active views but preserves history), false to unarchive.',
    ),
  cycle: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .describe(
      'Cycle: number (5), c-prefixed ("c5"), selector ("current", "next", "previous", "last", "upcoming"), or null/0 to remove.',
    ),
});

const InputSchema = z.object({
  items: z
    .array(IssueUpdateItem)
    .min(1)
    .max(50)
    .describe('Issues to update. Batch up to 50.'),
  parallel: z.boolean().optional().describe('Run in parallel. Default: sequential.'),
});

export const updateIssuesTool = defineTool({
  name: toolsMetadata.update_issues.name,
  title: toolsMetadata.update_issues.title,
  description: toolsMetadata.update_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    const { items } = args;

    // Get registry for short key resolution
    // Registry may not exist if workspace_metadata hasn't been called yet
    const registry = getStoredRegistry(context.sessionId);

    const results: Array<{
      index: number;
      ok: boolean;
      success?: boolean;
      id?: string;
      identifier?: string;
      error?:
        | string
        | {
            code: string;
            message: string;
            suggestions?: string[];
            retryable?: boolean;
          };
      code?: string;
      input?: Record<string, unknown>;
    }> = [];

    const teamAllowZeroCache = createTeamSettingsCache();

    // Track changes for TOON output (use index signature for ToonRow compatibility)
    const toonChanges: Array<{
      identifier: string;
      field: string;
      before: string;
      after: string;
      [key: string]: unknown;
    }> = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] as (typeof items)[number];
      try {
        // Capture BEFORE snapshot using shared utility
        const beforeSnapshot = await gate(() => captureIssueSnapshot(client, it.id));
        const issueIdentifier = beforeSnapshot?.identifier ?? it.id;

        const payloadInput: Record<string, unknown> = {};

        if (typeof it.title === 'string' && it.title.trim() !== '') {
          payloadInput.title = it.title;
        }

        if (typeof it.description === 'string' && it.description.trim() !== '') {
          payloadInput.description = it.description;
        }

        // Get team ID for resolution (needed for state/labels)
        const teamId = await getIssueTeamId(client, it.id);

        // Resolve state from short key, ID, name, or type
        // Priority: state (short key) > stateId > stateName/stateType
        if (it.state && registry) {
          // Pre-validate state key prefix before resolution (if we have teamId)
          if (teamId) {
            const prefixValidation = validateStateKeyPrefix(it.state, teamId, registry);
            if (!prefixValidation.valid) {
              results.push({
                index: i,
                ok: false,
                success: false,
                id: it.id,
                identifier: issueIdentifier,
                error: {
                  code: 'CROSS_TEAM_STATE_ERROR',
                  message: prefixValidation.error ?? 'State belongs to different team',
                  suggestions: prefixValidation.suggestion
                    ? [prefixValidation.suggestion]
                    : ['Check workspace_metadata for available states'],
                },
              });
              continue;
            }
          }

          const resolvedStateId = tryResolveShortKey(registry, 'state', it.state);
          if (resolvedStateId) {
            // Post-validate that resolved state belongs to the issue's team
            if (teamId) {
              const teamValidation = validateStateBelongsToTeam(
                it.state,
                resolvedStateId,
                teamId,
                registry,
              );
              if (!teamValidation.valid) {
                results.push({
                  index: i,
                  ok: false,
                  success: false,
                  id: it.id,
                  identifier: issueIdentifier,
                  error: {
                    code: 'CROSS_TEAM_STATE_ERROR',
                    message: teamValidation.error ?? 'State belongs to different team',
                    suggestions: teamValidation.suggestion
                      ? [teamValidation.suggestion]
                      : ['Check workspace_metadata for available states'],
                  },
                });
                continue;
              }
            }
            payloadInput.stateId = resolvedStateId;
          } else {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'STATE_RESOLUTION_FAILED',
                message: `Unknown state key '${it.state}'`,
                suggestions: [
                  'Call workspace_metadata to see available state keys (s0, s1, ...)',
                ],
              },
            });
            continue;
          }
        } else if (it.state && !registry) {
          results.push({
            index: i,
            ok: false,
            success: false,
            id: it.id,
            identifier: issueIdentifier,
            error: {
              code: 'REGISTRY_NOT_INITIALIZED',
              message:
                'Short key registry not initialized. Call workspace_metadata first.',
              suggestions: ['Call workspace_metadata first to initialize the registry'],
            },
          });
          continue;
        } else if (it.stateId) {
          payloadInput.stateId = it.stateId;
        } else if (it.stateName || it.stateType) {
          if (!teamId) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'TEAM_RESOLUTION_FAILED',
                message: 'Cannot resolve state: failed to get issue team',
                suggestions: [
                  'Verify the issue exists using list_issues or get_issues',
                ],
              },
            });
            continue;
          }
          const stateResult = await resolveState(client, teamId, {
            stateName: it.stateName,
            stateType: it.stateType,
          });
          if (!stateResult.success) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'STATE_RESOLUTION_FAILED',
                message: stateResult.error,
                suggestions: ['Use workspace_metadata to see available states'],
              },
            });
            continue;
          }
          payloadInput.stateId = stateResult.value;
        }

        // Resolve labels from IDs or names
        if (Array.isArray(it.labelIds) && it.labelIds.length > 0) {
          payloadInput.labelIds = it.labelIds;
        } else if (Array.isArray(it.labelNames) && it.labelNames.length > 0) {
          if (!teamId) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'TEAM_RESOLUTION_FAILED',
                message: 'Cannot resolve labels: failed to get issue team',
                suggestions: [
                  'Verify the issue exists using list_issues or get_issues',
                ],
              },
            });
            continue;
          }

          // Pre-validate label key prefixes before resolution
          if (registry) {
            let labelPrefixError: { error: string; suggestion?: string } | null = null;
            for (const labelName of it.labelNames) {
              const labelPrefixValidation = validateLabelKeyPrefix(
                labelName,
                teamId,
                registry,
              );
              if (!labelPrefixValidation.valid) {
                labelPrefixError = {
                  error:
                    labelPrefixValidation.error ?? 'Label belongs to different team',
                  suggestion: labelPrefixValidation.suggestion,
                };
                break;
              }
            }
            if (labelPrefixError) {
              results.push({
                index: i,
                ok: false,
                success: false,
                id: it.id,
                identifier: issueIdentifier,
                error: {
                  code: 'CROSS_TEAM_LABEL_ERROR',
                  message: labelPrefixError.error,
                  suggestions: labelPrefixError.suggestion
                    ? [labelPrefixError.suggestion]
                    : ['Check workspace_metadata for available labels'],
                },
              });
              continue;
            }
          }

          const labelsResult = await resolveLabels(client, teamId, it.labelNames);
          if (!labelsResult.success) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'LABEL_RESOLUTION_FAILED',
                message: labelsResult.error,
                suggestions: ['Use workspace_metadata to see available labels'],
              },
            });
            continue;
          }
          payloadInput.labelIds = labelsResult.value;
        }

        // Resolve addLabelNames
        if (Array.isArray(it.addLabelIds) && it.addLabelIds.length > 0) {
          payloadInput.addedLabelIds = it.addLabelIds;
        } else if (Array.isArray(it.addLabelNames) && it.addLabelNames.length > 0) {
          if (!teamId) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'TEAM_RESOLUTION_FAILED',
                message: 'Cannot resolve labels: failed to get issue team',
                suggestions: [
                  'Verify the issue exists using list_issues or get_issues',
                ],
              },
            });
            continue;
          }

          // Pre-validate label key prefixes before resolution
          if (registry) {
            let labelPrefixError: { error: string; suggestion?: string } | null = null;
            for (const labelName of it.addLabelNames) {
              const labelPrefixValidation = validateLabelKeyPrefix(
                labelName,
                teamId,
                registry,
              );
              if (!labelPrefixValidation.valid) {
                labelPrefixError = {
                  error:
                    labelPrefixValidation.error ?? 'Label belongs to different team',
                  suggestion: labelPrefixValidation.suggestion,
                };
                break;
              }
            }
            if (labelPrefixError) {
              results.push({
                index: i,
                ok: false,
                success: false,
                id: it.id,
                identifier: issueIdentifier,
                error: {
                  code: 'CROSS_TEAM_LABEL_ERROR',
                  message: labelPrefixError.error,
                  suggestions: labelPrefixError.suggestion
                    ? [labelPrefixError.suggestion]
                    : ['Check workspace_metadata for available labels'],
                },
              });
              continue;
            }
          }

          const addResult = await resolveLabels(client, teamId, it.addLabelNames);
          if (!addResult.success) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'LABEL_RESOLUTION_FAILED',
                message: addResult.error,
                suggestions: ['Use workspace_metadata to see available labels'],
              },
            });
            continue;
          }
          payloadInput.addedLabelIds = addResult.value;
        }

        // Resolve removeLabelNames
        if (Array.isArray(it.removeLabelIds) && it.removeLabelIds.length > 0) {
          payloadInput.removedLabelIds = it.removeLabelIds;
        } else if (
          Array.isArray(it.removeLabelNames) &&
          it.removeLabelNames.length > 0
        ) {
          if (!teamId) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'TEAM_RESOLUTION_FAILED',
                message: 'Cannot resolve labels: failed to get issue team',
                suggestions: [
                  'Verify the issue exists using list_issues or get_issues',
                ],
              },
            });
            continue;
          }

          // Pre-validate label key prefixes before resolution
          if (registry) {
            let labelPrefixError: { error: string; suggestion?: string } | null = null;
            for (const labelName of it.removeLabelNames) {
              const labelPrefixValidation = validateLabelKeyPrefix(
                labelName,
                teamId,
                registry,
              );
              if (!labelPrefixValidation.valid) {
                labelPrefixError = {
                  error:
                    labelPrefixValidation.error ?? 'Label belongs to different team',
                  suggestion: labelPrefixValidation.suggestion,
                };
                break;
              }
            }
            if (labelPrefixError) {
              results.push({
                index: i,
                ok: false,
                success: false,
                id: it.id,
                identifier: issueIdentifier,
                error: {
                  code: 'CROSS_TEAM_LABEL_ERROR',
                  message: labelPrefixError.error,
                  suggestions: labelPrefixError.suggestion
                    ? [labelPrefixError.suggestion]
                    : ['Check workspace_metadata for available labels'],
                },
              });
              continue;
            }
          }

          const removeResult = await resolveLabels(client, teamId, it.removeLabelNames);
          if (!removeResult.success) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'LABEL_RESOLUTION_FAILED',
                message: removeResult.error,
                suggestions: ['Use workspace_metadata to see available labels'],
              },
            });
            continue;
          }
          payloadInput.removedLabelIds = removeResult.value;
        }

        // Resolve assignee from short key, ID, name, or email
        // Priority: assignee (short key) > assigneeId > assigneeName > assigneeEmail
        if (it.assignee && registry) {
          const resolvedAssigneeId = tryResolveShortKey(registry, 'user', it.assignee);
          if (resolvedAssigneeId) {
            payloadInput.assigneeId = resolvedAssigneeId;
          } else {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'USER_RESOLUTION_FAILED',
                message: `Unknown user key '${it.assignee}'`,
                suggestions: [
                  'Call workspace_metadata to see available user keys (u0, u1, ...)',
                ],
              },
            });
            continue;
          }
        } else if (it.assignee && !registry) {
          results.push({
            index: i,
            ok: false,
            success: false,
            id: it.id,
            identifier: issueIdentifier,
            error: {
              code: 'REGISTRY_NOT_INITIALIZED',
              message:
                'Short key registry not initialized. Call workspace_metadata first.',
              suggestions: ['Call workspace_metadata first to initialize the registry'],
            },
          });
          continue;
        } else if (it.assigneeId || it.assigneeName || it.assigneeEmail) {
          const assigneeResult = await resolveAssignee(client, {
            assigneeId: it.assigneeId,
            assigneeName: it.assigneeName,
            assigneeEmail: it.assigneeEmail,
          });

          if (!assigneeResult.success && assigneeResult.error) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: assigneeResult.error.code,
                message: assigneeResult.error.message,
                suggestions: ['Use workspace_metadata to see available users'],
              },
            });
            continue;
          }

          if (assigneeResult.user?.id) {
            payloadInput.assigneeId = assigneeResult.user.id;
          }
        }

        // Resolve project from short key, ID, or name
        // Priority: project (short key) > projectId > projectName
        if (it.project && registry) {
          const resolvedProjectId = tryResolveShortKey(registry, 'project', it.project);
          if (resolvedProjectId) {
            payloadInput.projectId = resolvedProjectId;
          } else {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'PROJECT_RESOLUTION_FAILED',
                message: `Unknown project key '${it.project}'`,
                suggestions: [
                  'Call workspace_metadata to see available project keys (pr0, pr1, ...)',
                ],
              },
            });
            continue;
          }
        } else if (it.project && !registry) {
          results.push({
            index: i,
            ok: false,
            success: false,
            id: it.id,
            identifier: issueIdentifier,
            error: {
              code: 'REGISTRY_NOT_INITIALIZED',
              message:
                'Short key registry not initialized. Call workspace_metadata first.',
              suggestions: ['Call workspace_metadata first to initialize the registry'],
            },
          });
          continue;
        } else if (it.projectId) {
          payloadInput.projectId = it.projectId;
        } else if (it.projectName) {
          const projectResult = await resolveProject(client, it.projectName);
          if (!projectResult.success) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'PROJECT_RESOLUTION_FAILED',
                message: projectResult.error,
                suggestions: ['Use workspace_metadata to see available projects'],
              },
            });
            continue;
          }
          payloadInput.projectId = projectResult.value;
        }

        // Handle cycle assignment (supports number, "c5" format, or null to remove)
        if (it.cycle !== undefined) {
          // Handle cycle removal: null, 0, or empty string removes from cycle
          if (it.cycle === null || it.cycle === 0 || it.cycle === '') {
            payloadInput.cycleId = null;
          } else {
            if (!teamId) {
              results.push({
                index: i,
                ok: false,
                success: false,
                id: it.id,
                identifier: issueIdentifier,
                error: {
                  code: 'TEAM_RESOLUTION_FAILED',
                  message: 'Cannot resolve cycle: failed to get issue team',
                  suggestions: ['Ensure the issue exists and belongs to a team'],
                },
              });
              continue;
            }

            // Check if input is a natural language selector
            const selectorValue =
              typeof it.cycle === 'string' ? normalizeCycleSelector(it.cycle) : null;

            let cycleNumber: number;

            if (selectorValue !== null) {
              // Resolve selector to cycle number via API
              const selectorResult = await resolveCycleSelector(
                client,
                teamId,
                selectorValue,
              );
              if (!selectorResult.success) {
                results.push({
                  index: i,
                  ok: false,
                  success: false,
                  id: it.id,
                  identifier: issueIdentifier,
                  error: {
                    code: 'CYCLE_RESOLUTION_FAILED',
                    message: selectorResult.error,
                    suggestions: selectorResult.suggestions,
                  },
                });
                continue;
              }
              cycleNumber = selectorResult.value;
            } else {
              // Parse numeric input (5, "5", "c5")
              const cycleNumberResult = resolveCycleNumber(it.cycle);
              if (!cycleNumberResult.success) {
                results.push({
                  index: i,
                  ok: false,
                  success: false,
                  id: it.id,
                  identifier: issueIdentifier,
                  error: {
                    code: 'CYCLE_INVALID',
                    message: cycleNumberResult.error,
                    suggestions: [
                      'Use a number like 5, prefixed format like "c5", selector like "current", or null to remove',
                    ],
                  },
                });
                continue;
              }
              cycleNumber = cycleNumberResult.value;
            }

            const cycleResult = await resolveCycleNumberToId(
              client,
              teamId,
              cycleNumber,
            );
            if (!cycleResult.success) {
              results.push({
                index: i,
                ok: false,
                success: false,
                id: it.id,
                identifier: issueIdentifier,
                error: {
                  code: 'CYCLE_RESOLUTION_FAILED',
                  message: cycleResult.error,
                  suggestions: cycleResult.suggestions,
                },
              });
              continue;
            }
            payloadInput.cycleId = cycleResult.value;
          }
        }

        // Resolve priority from number or string
        if (it.priority !== undefined) {
          const priorityResult = resolvePriority(it.priority);
          if (!priorityResult.success) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'PRIORITY_INVALID',
                message: priorityResult.error,
                suggestions: [
                  'Priority must be 0-4: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low',
                ],
              },
            });
            continue;
          }
          const validatedPriority = validatePriority(priorityResult.value);
          if (validatedPriority !== undefined) {
            payloadInput.priority = validatedPriority;
          }
        }

        // Use shared validation for estimate (resolve string inputs first)
        if (it.estimate !== undefined) {
          const estimateResult = resolveEstimate(it.estimate);
          if (!estimateResult.success) {
            results.push({
              index: i,
              ok: false,
              success: false,
              id: it.id,
              identifier: issueIdentifier,
              error: {
                code: 'ESTIMATE_INVALID',
                message: estimateResult.error,
              },
            });
            continue;
          }

          // Try to get team ID from the issue
          let estimateTeamId: string | undefined;
          try {
            const issue = await client.issue(it.id);
            estimateTeamId = (issue as unknown as { teamId?: string })?.teamId;
          } catch {}

          const estimate = await validateEstimate(
            estimateResult.value,
            estimateTeamId,
            teamAllowZeroCache,
            client,
            it.allowZeroEstimate,
          );
          if (estimate !== undefined) {
            payloadInput.estimate = estimate;
          }
        }

        if (typeof it.dueDate === 'string' && it.dueDate.trim() !== '') {
          payloadInput.dueDate = it.dueDate;
        }

        if (typeof it.parentId === 'string' && it.parentId) {
          payloadInput.parentId = it.parentId;
        }

        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        const payload = await withRetry(
          () =>
            args.parallel === true
              ? client.updateIssue(it.id, payloadInput)
              : gate(() => client.updateIssue(it.id, payloadInput)),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        // Handle incremental label updates
        const resolvedAddLabelIds = payloadInput.addedLabelIds as string[] | undefined;
        const resolvedRemoveLabelIds = payloadInput.removedLabelIds as
          | string[]
          | undefined;
        if (resolvedAddLabelIds?.length || resolvedRemoveLabelIds?.length) {
          const issue = await gate(() => client.issue(it.id));
          const current = new Set((await issue.labels()).nodes.map((l) => l.id));
          resolvedAddLabelIds?.forEach((id) => current.add(id));
          resolvedRemoveLabelIds?.forEach((id) => current.delete(id));
          await (args.parallel === true
            ? client.updateIssue(it.id, { labelIds: Array.from(current) })
            : gate(() => client.updateIssue(it.id, { labelIds: Array.from(current) })));
        }

        // Handle archive/unarchive
        if (typeof it.archived === 'boolean') {
          try {
            const targetArchived = it.archived === true;
            if (targetArchived) {
              const anyClient = client as unknown as {
                archiveIssue?: (id: string) => Promise<unknown>;
              };
              if (typeof anyClient.archiveIssue === 'function') {
                await (args.parallel === true
                  ? anyClient.archiveIssue?.(it.id)
                  : gate(() => anyClient.archiveIssue?.(it.id) as Promise<unknown>));
              }
            } else {
              const anyClient = client as unknown as {
                unarchiveIssue?: (id: string) => Promise<unknown>;
              };
              if (typeof anyClient.unarchiveIssue === 'function') {
                await (args.parallel === true
                  ? anyClient.unarchiveIssue?.(it.id)
                  : gate(() => anyClient.unarchiveIssue?.(it.id) as Promise<unknown>));
              }
            }
          } catch {
            // Ignore archive errors to preserve other updates
          }
        }

        // Build input echo (only include provided fields)
        const inputEcho: Record<string, unknown> = { id: it.id };
        if (it.title) inputEcho.title = it.title;
        if (it.state) inputEcho.state = it.state;
        if (it.stateId) inputEcho.stateId = it.stateId;
        if (it.assignee) inputEcho.assignee = it.assignee;
        if (it.assigneeId) inputEcho.assigneeId = it.assigneeId;
        if (it.assigneeName) inputEcho.assigneeName = it.assigneeName;
        if (it.assigneeEmail) inputEcho.assigneeEmail = it.assigneeEmail;
        if (it.project) inputEcho.project = it.project;
        if (it.projectId) inputEcho.projectId = it.projectId;
        if (it.addLabelIds) inputEcho.addLabelIds = it.addLabelIds;
        if (it.removeLabelIds) inputEcho.removeLabelIds = it.removeLabelIds;

        results.push({
          input: inputEcho,
          success: payload.success ?? true,
          id: it.id,
          identifier: issueIdentifier,
          index: i,
          ok: payload.success ?? true,
        });

        // Capture AFTER snapshot using shared utility
        const afterSnapshot = await gate(() => captureIssueSnapshot(client, it.id));

        // Compute changes using shared utility
        if (afterSnapshot) {
          const requestedFields = new Set(Object.keys(it));
          // Map short key field names to legacy field names for computeFieldChanges
          if (requestedFields.has('state')) requestedFields.add('stateId');
          if (requestedFields.has('assignee')) requestedFields.add('assigneeId');
          if (requestedFields.has('project')) requestedFields.add('projectId');

          // Map name-based input fields to legacy field names for computeFieldChanges
          // Label name mappings
          if (requestedFields.has('labelNames')) requestedFields.add('labelIds');
          if (requestedFields.has('addLabelNames')) requestedFields.add('addLabelIds');
          if (requestedFields.has('removeLabelNames'))
            requestedFields.add('removeLabelIds');
          // State name mappings (for completeness with existing short key mapping)
          if (requestedFields.has('stateName') || requestedFields.has('stateType'))
            requestedFields.add('stateId');
          // Assignee name mappings (for completeness with existing short key mapping)
          if (
            requestedFields.has('assigneeName') ||
            requestedFields.has('assigneeEmail')
          )
            requestedFields.add('assigneeId');
          // Project name mapping (for completeness with existing short key mapping)
          if (requestedFields.has('projectName')) requestedFields.add('projectId');
          if (requestedFields.has('cycle')) requestedFields.add('cycleId');

          const changes = computeFieldChanges(
            beforeSnapshot,
            afterSnapshot,
            requestedFields,
          );

          // Track changes for TOON output (when registry is available for short keys)
          if (registry) {
            const finalIdentifier = afterSnapshot.identifier ?? it.id;

            // State change
            if (changes.state) {
              const beforeKey = beforeSnapshot?.stateId
                ? (tryGetShortKey(registry, 'state', beforeSnapshot.stateId) ?? beforeSnapshot?.stateName ?? '')
                : '';
              const afterKey = afterSnapshot.stateId
                ? (tryGetShortKey(registry, 'state', afterSnapshot.stateId) ?? afterSnapshot.stateName ?? '')
                : '';
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'state',
                before: beforeKey,
                after: afterKey,
              });
            }

            // Assignee change
            if (changes.assignee) {
              const beforeKey = beforeSnapshot?.assigneeId
                ? (tryGetShortKey(registry, 'user', beforeSnapshot.assigneeId) ?? beforeSnapshot?.assigneeName ?? '(departed)')
                : '';
              const afterKey = afterSnapshot.assigneeId
                ? (tryGetShortKey(registry, 'user', afterSnapshot.assigneeId) ?? afterSnapshot.assigneeName ?? '(departed)')
                : '';
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'assignee',
                before: beforeKey,
                after: afterKey,
              });
            }

            // Project change
            if (changes.project) {
              const beforeKey = beforeSnapshot?.projectId
                ? (tryGetShortKey(registry, 'project', beforeSnapshot.projectId) ?? beforeSnapshot?.projectName ?? '')
                : '';
              const afterKey = afterSnapshot.projectId
                ? (tryGetShortKey(registry, 'project', afterSnapshot.projectId) ?? afterSnapshot.projectName ?? '')
                : '';
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'project',
                before: beforeKey,
                after: afterKey,
              });
            }

            // Priority change
            if (changes.priority) {
              const beforePriority =
                changes.priority.before === '—'
                  ? null
                  : typeof changes.priority.before === 'number'
                    ? changes.priority.before
                    : parseInt(String(changes.priority.before), 10);
              const afterPriority =
                changes.priority.after === '—'
                  ? null
                  : typeof changes.priority.after === 'number'
                    ? changes.priority.after
                    : parseInt(String(changes.priority.after), 10);
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'priority',
                before: formatPriorityToon(beforePriority) ?? '',
                after: formatPriorityToon(afterPriority) ?? '',
              });
            }

            // Estimate change
            if (changes.estimate) {
              const beforeEstimate =
                changes.estimate.before === '—'
                  ? null
                  : typeof changes.estimate.before === 'number'
                    ? changes.estimate.before
                    : parseInt(String(changes.estimate.before), 10);
              const afterEstimate =
                changes.estimate.after === '—'
                  ? null
                  : typeof changes.estimate.after === 'number'
                    ? changes.estimate.after
                    : parseInt(String(changes.estimate.after), 10);
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'estimate',
                before: formatEstimateToon(beforeEstimate) ?? '',
                after: formatEstimateToon(afterEstimate) ?? '',
              });
            }

            // Title change
            if (changes.title) {
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'title',
                before: changes.title.before,
                after: changes.title.after,
              });
            }

            // Due date change
            if (changes.dueDate) {
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'dueDate',
                before: changes.dueDate.before === '—' ? '' : changes.dueDate.before,
                after: changes.dueDate.after === '—' ? '' : changes.dueDate.after,
              });
            }

            // Labels change (split into added/removed for clarity)
            if (changes.labels) {
              if (changes.labels.added.length > 0) {
                toonChanges.push({
                  identifier: finalIdentifier,
                  field: 'labels+', // "+" indicates additions
                  before: '',
                  after: changes.labels.added.join(','),
                });
              }
              if (changes.labels.removed.length > 0) {
                toonChanges.push({
                  identifier: finalIdentifier,
                  field: 'labels-', // "-" indicates removals
                  before: changes.labels.removed.join(','),
                  after: '',
                });
              }
            }

            // Archived change
            if (changes.archived) {
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'archived',
                before: changes.archived.before ? 'true' : 'false',
                after: changes.archived.after ? 'true' : 'false',
              });
            }

            // Cycle change
            if (changes.cycle) {
              toonChanges.push({
                identifier: finalIdentifier,
                field: 'cycle',
                before: changes.cycle.before === '—' ? '' : changes.cycle.before,
                after: changes.cycle.after === '—' ? '' : changes.cycle.after,
              });
            }
          }
        }
      } catch (error) {
        await logger.error('update_issues', {
          message: 'Failed to update issue',
          id: it.id,
          error: (error as Error).message,
        });
        results.push({
          input: { id: it.id },
          success: false,
          id: it.id,
          identifier: it.id,
          error: {
            code: 'LINEAR_UPDATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              'Verify the issue ID exists with list_issues or get_issues.',
              'Check that stateId exists in workflowStatesByTeam.',
              'Use workspace_metadata to find valid assigneeId.',
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
      'Use list_issues or get_issues to verify changes.',
    ];
    if (failed > 0) {
      metaNextSteps.push('Check error.suggestions for recovery hints.');
    }

    const meta = {
      nextSteps: metaNextSteps,
      relatedTools: ['list_issues', 'get_issues', 'add_comments'],
    };

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format
    // ─────────────────────────────────────────────────────────────────────────
    const toonResponse: ToonResponse = {
      meta: {
        fields: ['action', 'succeeded', 'failed', 'total'],
        values: {
          action: 'update_issues',
          succeeded,
          failed,
          total: items.length,
        },
      },
      data: [
        // Results section
        {
          schema: WRITE_RESULT_SCHEMA,
          items: results.map((r) => {
            const errObj =
              typeof r.error === 'object'
                ? (r.error as {
                    code?: string;
                    message?: string;
                    suggestions?: string[];
                  })
                : null;
            return {
              index: r.index,
              status: r.ok ? 'ok' : 'error',
              identifier: r.identifier ?? r.id ?? '',
              error: r.ok
                ? ''
                : (errObj?.message ?? (typeof r.error === 'string' ? r.error : '')),
              code: r.ok ? '' : (errObj?.code ?? ''),
              hint: r.ok ? '' : (errObj?.suggestions?.[0] ?? ''),
            };
          }),
        },
      ],
    };

    // Add changes section if any changes were tracked
    if (toonChanges.length > 0) {
      toonResponse.data?.push({
        schema: CHANGES_SCHEMA,
        items: toonChanges as Array<Record<string, string>>,
      });
    }

    const toonOutput = encodeToon(toonResponse);

    // Build structured content for MCP response
    const structured = {
      _format: 'toon',
      _version: '1',
      results: results.map((r) => ({
        index: r.index,
        ok: r.ok,
        success: r.success,
        id: r.id,
        identifier: r.identifier,
        error: r.error,
        input: r.input,
      })),
      summary,
      meta,
    };

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
