/**
 * Custom vitest reporter that generates a Markdown report for live test runs.
 *
 * Collects per-test pass/fail/skip results during the run, then on completion
 * reads `testModule.meta()` for skip reasons and entity tracking data
 * (populated by report-collector.ts in the test worker).
 *
 * Reports are written to tests/live/reports/report-YYYY-MM-DD-HHmmss.md.
 * Transcripts are written to tests/live/reports/transcript-YYYY-MM-DD-HHmmss.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SerializedError } from '@vitest/utils';
import type {
  Reporter,
  TestCase,
  TestModule,
  TestRunEndReason,
  TestSpecification,
} from 'vitest/node';

// Re-import the declaration merging so TaskMeta includes our custom fields
import './report-collector.js';

import { ENTITY_EMOJIS, TOOL_DESCRIPTIONS } from './tool-descriptions.js';

// ---------------------------------------------------------------------------
// Types for accumulated results
// ---------------------------------------------------------------------------

interface TestCaseResult {
  fullName: string;
  state: 'passed' | 'failed' | 'skipped';
  duration: number;
  moduleId: string;
}

interface ModuleSummary {
  moduleId: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a value for use inside a markdown table cell.
 * Replaces `|` with `\|`, newlines with spaces, and truncates to maxLen.
 * Returns `(empty)` for blank values (only affects field comparison tables).
 */
function escapeTableValue(value: string, maxLen = 80): string {
  if (value.trim() === '') return '(empty)';
  let escaped = value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  if (escaped.length > maxLen) {
    escaped = `${escaped.slice(0, maxLen - 3)}...`;
  }
  return escaped;
}

/**
 * GitHub-compatible anchor ID generation.
 * Lowercase, replace spaces with hyphens, strip non-alphanumeric except hyphens.
 * Does NOT collapse consecutive hyphens or strip leading/trailing hyphens
 * (GitHub doesn't do this either).
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// ---------------------------------------------------------------------------
// MarkdownReporter
// ---------------------------------------------------------------------------

export class MarkdownReporter implements Reporter {
  private results: TestCaseResult[] = [];
  private startTime = 0;

  onTestRunStart(_specifications: ReadonlyArray<TestSpecification>): void {
    this.startTime = Date.now();
    this.results = [];
  }

  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();
    const diagnostic = testCase.diagnostic();

    this.results.push({
      fullName: testCase.fullName,
      state: result.state === 'pending' ? 'skipped' : result.state,
      duration: diagnostic?.duration ?? 0,
      moduleId: testCase.module.moduleId,
    });
  }

  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    _unhandledErrors: ReadonlyArray<SerializedError>,
    _reason: TestRunEndReason,
  ): void {
    const totalDuration = Date.now() - this.startTime;

    // ------------------------------------------------------------------
    // Aggregate counts
    // ------------------------------------------------------------------
    const passed = this.results.filter((r) => r.state === 'passed').length;
    const failed = this.results.filter((r) => r.state === 'failed').length;
    const skipped = this.results.filter((r) => r.state === 'skipped').length;
    const total = this.results.length;

    // ------------------------------------------------------------------
    // Collect meta from each test module
    // ------------------------------------------------------------------
    const allSkips: Array<{ file: string; test: string; reason: string }> = [];
    const allEntities: Record<string, Set<string>> = {};
    const allLifecycleActions: Array<{
      file: string;
      action: string;
      entity: string;
      id: string;
    }> = [];
    const allCompleteness: Array<{
      file: string;
      tool: string;
      section: string;
      expected: string[];
      actual: string[];
      missing: string[];
    }> = [];
    const allFieldComparisons: Array<{
      file: string;
      entity: string;
      entityLabel?: string;
      entityType?: string;
      testName?: string;
      fields: Array<{
        field: string;
        toon: string;
        api: string;
        match: boolean;
      }>;
    }> = [];
    const allToolCalls: Array<{
      file: string;
      tool: string;
      params: Record<string, unknown>;
      response: string;
      testName?: string;
    }> = [];

    for (const mod of testModules) {
      const meta = mod.meta();
      const shortFile = path.basename(mod.moduleId);

      if (meta.skips) {
        for (const skip of meta.skips) {
          allSkips.push({ file: shortFile, ...skip });
        }
      }

      if (meta.validatedEntities) {
        for (const [section, ids] of Object.entries(meta.validatedEntities)) {
          if (!allEntities[section]) {
            allEntities[section] = new Set();
          }
          for (const id of ids) {
            allEntities[section].add(id);
          }
        }
      }

      if (meta.lifecycleActions) {
        for (const la of meta.lifecycleActions) {
          allLifecycleActions.push({ file: shortFile, ...la });
        }
      }

      if (meta.completenessResults) {
        for (const cr of meta.completenessResults) {
          allCompleteness.push({ file: shortFile, ...cr });
        }
      }

      if (meta.fieldComparisons) {
        for (const fc of meta.fieldComparisons) {
          allFieldComparisons.push({ file: shortFile, ...fc });
        }
      }

      if (meta.toolCalls) {
        for (const tc of meta.toolCalls) {
          allToolCalls.push({ file: shortFile, ...tc });
        }
      }
    }

    // ------------------------------------------------------------------
    // Per-module breakdown
    // ------------------------------------------------------------------
    const moduleMap = new Map<string, ModuleSummary>();

    for (const r of this.results) {
      let mod = moduleMap.get(r.moduleId);
      if (!mod) {
        mod = {
          moduleId: r.moduleId,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0,
        };
        moduleMap.set(r.moduleId, mod);
      }
      if (r.state === 'passed') mod.passed++;
      else if (r.state === 'failed') mod.failed++;
      else mod.skipped++;
      mod.duration += r.duration;
    }

    // ------------------------------------------------------------------
    // Pre-compute field comparison data for ToC and sections
    // ------------------------------------------------------------------

    // Group field comparisons by file
    const fcByFile = new Map<string, typeof allFieldComparisons>();
    for (const fc of allFieldComparisons) {
      const list = fcByFile.get(fc.file) ?? [];
      list.push(fc);
      fcByFile.set(fc.file, list);
    }

    // Per-file stats for ToC
    const fileStats = new Map<string, { entities: number; mismatches: number }>();
    for (const [file, comparisons] of fcByFile) {
      const mismatches = comparisons.reduce(
        (sum, fc) => sum + fc.fields.filter((f) => !f.match).length,
        0,
      );
      fileStats.set(file, { entities: comparisons.length, mismatches });
    }

    // Total field comparison stats
    const totalFcEntities = allFieldComparisons.length;
    const totalFcFields = allFieldComparisons.reduce(
      (sum, fc) => sum + fc.fields.length,
      0,
    );
    const totalFcMismatches = allFieldComparisons.reduce(
      (sum, fc) => sum + fc.fields.filter((f) => !f.match).length,
      0,
    );

    // Collect all mismatches for the summary table
    const allMismatches: Array<{
      file: string;
      entity: string;
      entityType: string;
      field: string;
      toon: string;
      api: string;
    }> = [];
    for (const fc of allFieldComparisons) {
      for (const f of fc.fields) {
        if (!f.match) {
          allMismatches.push({
            file: fc.file,
            entity: fc.entity,
            entityType: fc.entityType ?? 'Unknown',
            field: f.field,
            toon: f.toon,
            api: f.api,
          });
        }
      }
    }

    // Entity sections for Entities Validated
    const entitySections = Object.keys(allEntities).sort();
    const totalEntityCount = entitySections.reduce(
      (sum, s) => sum + allEntities[s].size,
      0,
    );

    // Count unique entity types in mismatches
    const mismatchEntityTypes = new Set(allMismatches.map((m) => m.entityType));

    // ------------------------------------------------------------------
    // Build Markdown
    // ------------------------------------------------------------------
    const now = new Date();
    const timestamp = now.toISOString();
    const lines: string[] = [];

    // ---- Title + Preamble ----
    lines.push('# \uD83D\uDCCA Live Test Report');
    lines.push('');
    lines.push(
      '> This report compares TOON-encoded MCP tool output against direct Linear API',
    );
    lines.push(
      '> responses. Each comparison table shows what the tool returned (TOON) alongside',
    );
    lines.push(
      '> what the API returned (API). Mismatches indicate encoding or transform differences.',
    );
    lines.push('>');
    lines.push(
      '> **TOON notation:** `p2` = priority 2, `e5` = estimate 5, `c9` = cycle 9.',
    );
    lines.push(
      '> Short keys like `s2 (Todo)` and `u0 (Name)` resolve to human-readable names.',
    );
    lines.push('');

    // ---- Table of Contents ----
    lines.push('## \uD83D\uDCD1 Table of Contents');
    lines.push('');
    lines.push(
      `- [\uD83D\uDCCA Summary](#${slugify('\uD83D\uDCCA Summary')}) \u2014 ${total} tests, ${passed} passed`,
    );

    if (allMismatches.length > 0) {
      lines.push(
        `- [\u26A0\uFE0F Mismatches Summary](#${slugify('\u26A0\uFE0F Mismatches Summary')}) \u2014 ${allMismatches.length} mismatch${allMismatches.length !== 1 ? 'es' : ''} across ${mismatchEntityTypes.size} entity type${mismatchEntityTypes.size !== 1 ? 's' : ''}`,
      );
    }

    if (allFieldComparisons.length > 0) {
      lines.push(
        `- [\uD83D\uDD2C Field Comparisons](#${slugify('\uD83D\uDD2C Field Comparisons')}) \u2014 ${totalFcEntities} entities, ${totalFcFields} fields`,
      );
      for (const [file, stats] of fileStats) {
        const desc = TOOL_DESCRIPTIONS[file];
        const emoji = desc?.emoji ?? '\uD83D\uDCC4';
        lines.push(
          `  - [${emoji} ${file}](#${slugify(`${emoji} ${file}`)}) \u2014 ${stats.entities} entities, ${stats.mismatches} mismatch${stats.mismatches !== 1 ? 'es' : ''}`,
        );
      }
    }

    if (entitySections.length > 0) {
      lines.push(
        `- [\uD83D\uDCE6 Entities Validated](#${slugify('\uD83D\uDCE6 Entities Validated')}) \u2014 ${totalEntityCount} across ${entitySections.length} categories`,
      );
    }

    if (allSkips.length > 0) {
      lines.push(
        `- [\u23ED\uFE0F Skipped Validations](#${slugify('\u23ED\uFE0F Skipped Validations')}) \u2014 ${allSkips.length} skipped`,
      );
    }

    if (allLifecycleActions.length > 0) {
      lines.push(
        `- [\uD83D\uDEE0\uFE0F Lifecycle Actions](#${slugify('\uD83D\uDEE0\uFE0F Lifecycle Actions')}) \u2014 ${allLifecycleActions.length} actions`,
      );
    }

    if (allCompleteness.length > 0) {
      lines.push(
        `- [\uD83E\uDDE9 Completeness Results](#${slugify('\uD83E\uDDE9 Completeness Results')})`,
      );
    }

    lines.push(
      `- [\u2705 Test Details](#${slugify('\u2705 Test Details')}) \u2014 ${moduleMap.size} files, ${total} tests`,
    );
    lines.push('');

    // ---- Summary ----
    lines.push('## \uD83D\uDCCA Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Total tests | ${total} |`);
    lines.push(`| Passed | ${passed} |`);
    lines.push(`| Failed | ${failed} |`);
    lines.push(`| Skipped | ${skipped} |`);
    lines.push(`| Duration | ${(totalDuration / 1000).toFixed(1)}s |`);
    lines.push(`| Timestamp | ${timestamp} |`);
    const tokenSuffix = process.env.LINEAR_ACCESS_TOKEN?.slice(-4) ?? '????';
    lines.push(`| Token | ...${tokenSuffix} |`);
    lines.push('');

    // ---- Mismatches Summary ----
    if (allMismatches.length > 0) {
      lines.push('## \u26A0\uFE0F Mismatches Summary');
      lines.push('');
      lines.push('| File | Entity | Type | Field | TOON | API |');
      lines.push('|------|--------|------|-------|------|-----|');
      for (const m of allMismatches) {
        lines.push(
          `| ${m.file} | ${m.entity} | ${m.entityType} | ${escapeTableValue(m.field, 30)} | ${escapeTableValue(m.toon)} | ${escapeTableValue(m.api)} |`,
        );
      }
      lines.push('');
    }

    // ---- Field Comparisons ----
    if (allFieldComparisons.length > 0) {
      lines.push('## \uD83D\uDD2C Field Comparisons');
      lines.push('');
      lines.push(
        `${totalFcEntities} entities, ${totalFcFields} fields compared, ${totalFcMismatches} mismatch${totalFcMismatches !== 1 ? 'es' : ''}`,
      );
      lines.push('');

      for (const [file, comparisons] of fcByFile) {
        const desc = TOOL_DESCRIPTIONS[file];
        const fileEmoji = desc?.emoji ?? '\uD83D\uDCC4';

        lines.push(`### ${fileEmoji} ${file}`);
        lines.push('');

        // File preamble blockquote
        if (desc?.description) {
          lines.push(`> ${desc.description}`);
          lines.push('');
        }

        // Per-file summary table: entity type counts and mismatch counts
        const entityTypeCounts = new Map<
          string,
          { count: number; fields: number; mismatches: number }
        >();
        for (const fc of comparisons) {
          const et = fc.entityType ?? 'Unknown';
          const existing = entityTypeCounts.get(et) ?? {
            count: 0,
            fields: 0,
            mismatches: 0,
          };
          existing.count++;
          existing.fields += fc.fields.length;
          existing.mismatches += fc.fields.filter((f) => !f.match).length;
          entityTypeCounts.set(et, existing);
        }

        lines.push('| Entity Type | Count | Fields | Mismatches |');
        lines.push('|-------------|-------|--------|------------|');
        for (const [et, stats] of entityTypeCounts) {
          const emoji = ENTITY_EMOJIS[et] ?? '';
          lines.push(
            `| ${emoji} ${et} | ${stats.count} | ${stats.fields} | ${stats.mismatches} |`,
          );
        }
        lines.push('');

        // Group by testName, then by entityType
        const byTestName = new Map<string, typeof comparisons>();
        for (const fc of comparisons) {
          const key = fc.testName ?? '';
          const list = byTestName.get(key) ?? [];
          list.push(fc);
          byTestName.set(key, list);
        }

        for (const [testName, testComparisons] of byTestName) {
          // Group by entityType within this testName
          const byEntityType = new Map<string, typeof testComparisons>();
          for (const fc of testComparisons) {
            const et = fc.entityType ?? 'Unknown';
            const list = byEntityType.get(et) ?? [];
            list.push(fc);
            byEntityType.set(et, list);
          }

          for (const [entityType, entities] of byEntityType) {
            const emoji = ENTITY_EMOJIS[entityType] ?? '';
            const plural = entityType.endsWith('s') ? entityType : `${entityType}s`;
            const heading = testName
              ? `#### ${emoji} ${plural} \u2014 ${testName}`
              : `#### ${emoji} ${plural}`;
            lines.push(heading);
            lines.push('');

            // Special case: compact label table
            if (
              entityType === 'Label' &&
              entities.every(
                (e) => e.fields.length === 1 && e.fields[0].field === 'name',
              )
            ) {
              lines.push('| Label | Match |');
              lines.push('|-------|-------|');
              for (const fc of entities) {
                const matchStr = fc.fields[0].match ? 'ok' : '**MISMATCH**';
                lines.push(`| ${escapeTableValue(fc.entity, 60)} | ${matchStr} |`);
              }
              lines.push('');
              continue;
            }

            // Regular entities: collapsible details blocks
            for (const fc of entities) {
              const entityMismatches = fc.fields.filter((f) => !f.match).length;
              const fieldCount = fc.fields.length;
              const statusText =
                entityMismatches > 0
                  ? `${fieldCount} fields, ${entityMismatches} MISMATCH`
                  : `${fieldCount} fields, all ok`;
              const labelSuffix = fc.entityLabel
                ? ` \u2014 ${escapeTableValue(fc.entityLabel, 60)}`
                : '';
              const summaryText = `${fc.entity}${labelSuffix} (${statusText})`;

              if (entityMismatches > 0) {
                lines.push('<details open>');
              } else {
                lines.push('<details>');
              }
              lines.push(`<summary>${summaryText}</summary>`);
              lines.push('');
              lines.push('| Field | TOON | API | Match |');
              lines.push('|-------|------|-----|-------|');
              for (const f of fc.fields) {
                const matchStr = f.match ? 'ok' : '**MISMATCH**';
                lines.push(
                  `| ${escapeTableValue(f.field, 30)} | ${escapeTableValue(f.toon)} | ${escapeTableValue(f.api)} | ${matchStr} |`,
                );
              }
              lines.push('');
              lines.push('</details>');
              lines.push('');
            }
          }
        }
      }
    }

    // ---- Entities Validated ----
    if (entitySections.length > 0) {
      lines.push('## \uD83D\uDCE6 Entities Validated');
      lines.push('');
      lines.push('| Section | Count | Identifiers |');
      lines.push('| --- | --- | --- |');
      for (const section of entitySections) {
        const ids = [...allEntities[section]].sort();
        lines.push(`| ${section} | ${ids.length} | ${ids.join(', ')} |`);
      }
      lines.push('');
    }

    // ---- Skipped Validations ----
    if (allSkips.length > 0) {
      lines.push('## \u23ED\uFE0F Skipped Validations');
      lines.push('');
      lines.push('| File | Test | Reason |');
      lines.push('| --- | --- | --- |');
      for (const skip of allSkips) {
        lines.push(`| ${skip.file} | ${skip.test} | ${skip.reason} |`);
      }
      lines.push('');
    }

    // ---- Lifecycle Actions ----
    if (allLifecycleActions.length > 0) {
      lines.push('## \uD83D\uDEE0\uFE0F Lifecycle Actions');
      lines.push('');
      lines.push('| Action | Entity | ID |');
      lines.push('| --- | --- | --- |');
      for (const la of allLifecycleActions) {
        lines.push(`| ${la.action} | ${la.entity} | ${la.id} |`);
      }
      lines.push('');
    }

    // ---- Completeness Results ----
    const withMissing = allCompleteness.filter((cr) => cr.missing.length > 0);
    if (withMissing.length > 0) {
      lines.push('## \uD83E\uDDE9 Completeness Results');
      lines.push('');
      lines.push('| Tool | Section | Missing Fields |');
      lines.push('| --- | --- | --- |');
      for (const cr of withMissing) {
        lines.push(`| ${cr.tool} | ${cr.section} | ${cr.missing.join(', ')} |`);
      }
      lines.push('');
    } else if (allCompleteness.length > 0) {
      lines.push('## \uD83E\uDDE9 Completeness Results');
      lines.push('');
      lines.push('All tools passed schema completeness checks.');
      lines.push('');
    }

    // ---- Test Details (per module) ----
    lines.push('## \u2705 Test Details');
    lines.push('');

    for (const [moduleId, summary] of moduleMap) {
      const shortFile = path.basename(moduleId);
      const status =
        summary.failed > 0
          ? 'FAIL'
          : summary.skipped === summary.passed + summary.failed + summary.skipped
            ? 'SKIP'
            : 'PASS';

      lines.push(`### ${shortFile} (${status})`);
      lines.push('');
      lines.push(
        `${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped \u2014 ${(summary.duration / 1000).toFixed(1)}s`,
      );
      lines.push('');

      // Individual test results for this module
      const moduleResults = this.results.filter((r) => r.moduleId === moduleId);
      for (const r of moduleResults) {
        const icon =
          r.state === 'passed' ? 'PASS' : r.state === 'failed' ? 'FAIL' : 'SKIP';
        lines.push(`- \`${icon}\` ${r.fullName} (${(r.duration / 1000).toFixed(2)}s)`);
      }
      lines.push('');
    }

    // ------------------------------------------------------------------
    // Write report file
    // ------------------------------------------------------------------
    const reportsDir = path.resolve(import.meta.dirname ?? __dirname, '../reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const reportPath = path.join(reportsDir, `report-${dateStr}.md`);

    fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');

    console.log(`\n  Live test report written to: ${reportPath}`);

    // ------------------------------------------------------------------
    // Write transcript file
    // ------------------------------------------------------------------
    if (allToolCalls.length > 0) {
      const transcriptLines = this.buildTranscript(allToolCalls, timestamp);
      const transcriptPath = path.join(reportsDir, `transcript-${dateStr}.md`);
      fs.writeFileSync(transcriptPath, transcriptLines.join('\n'), 'utf-8');
      console.log(`  Transcript written to: ${transcriptPath}\n`);
    } else {
      console.log('');
    }
  }

  // ------------------------------------------------------------------
  // Transcript generation
  // ------------------------------------------------------------------

  private buildTranscript(
    allToolCalls: Array<{
      file: string;
      tool: string;
      params: Record<string, unknown>;
      response: string;
      testName?: string;
    }>,
    timestamp: string,
  ): string[] {
    const lines: string[] = [];

    lines.push('# TOON Transcript');
    lines.push('');
    lines.push(
      '> Raw request/response pairs for every tool call made during the live test run.',
    );
    lines.push(
      '> Structured identically to what Claude Desktop sees via MCP. Use this file',
    );
    lines.push(
      '> for manual comparison: paste into Claude Desktop and ask it to make the same',
    );
    lines.push('> calls, then compare outputs.');
    lines.push('>');
    lines.push(`> Generated: ${timestamp}`);
    lines.push('');

    // Group by file
    const byFile = new Map<string, typeof allToolCalls>();
    for (const tc of allToolCalls) {
      const list = byFile.get(tc.file) ?? [];
      list.push(tc);
      byFile.set(tc.file, list);
    }

    // Table of Contents
    lines.push('## Table of Contents');
    lines.push('');
    for (const [file, calls] of byFile) {
      lines.push(
        `- [${file}](#${slugify(file)}) (${calls.length} call${calls.length !== 1 ? 's' : ''})`,
      );
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // File sections
    for (const [file, calls] of byFile) {
      lines.push(`## ${file}`);
      lines.push('');

      for (let i = 0; i < calls.length; i++) {
        const tc = calls[i];
        lines.push(`### Call ${i + 1}: ${tc.tool}`);
        lines.push('');
        lines.push(`**Test:** ${tc.testName ?? 'beforeAll setup'}`);
        lines.push('');
        lines.push('**Request**');
        lines.push('```json');
        lines.push(JSON.stringify(tc.params, null, 2));
        lines.push('```');
        lines.push('');
        lines.push('**Response**');
        lines.push('```');
        lines.push(tc.response);
        lines.push('```');
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    }

    return lines;
  }
}
