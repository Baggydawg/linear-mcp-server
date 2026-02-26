/**
 * Custom vitest reporter that generates a Markdown report for live test runs.
 *
 * Collects per-test pass/fail/skip results during the run, then on completion
 * reads `testModule.meta()` for skip reasons and entity tracking data
 * (populated by report-collector.ts in the test worker).
 *
 * Reports are written to tests/live/reports/report-YYYY-MM-DD-HHmmss.md.
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
 */
function escapeTableValue(value: string, maxLen = 80): string {
  let escaped = value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  if (escaped.length > maxLen) {
    escaped = `${escaped.slice(0, maxLen - 3)}...`;
  }
  return escaped;
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
      fields: Array<{
        field: string;
        toon: string;
        api: string;
        match: boolean;
      }>;
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
    // Build Markdown
    // ------------------------------------------------------------------
    const now = new Date();
    const timestamp = now.toISOString();
    const lines: string[] = [];

    lines.push('# Live Test Report');
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Total tests | ${total} |`);
    lines.push(`| Passed | ${passed} |`);
    lines.push(`| Failed | ${failed} |`);
    lines.push(`| Skipped | ${skipped} |`);
    lines.push(`| Duration | ${(totalDuration / 1000).toFixed(1)}s |`);
    lines.push(`| Timestamp | ${timestamp} |`);
    const tokenSuffix = process.env.LINEAR_ACCESS_TOKEN?.slice(-4) ?? '????';
    lines.push(`| Token | ...${tokenSuffix} |`);
    lines.push('');

    // Entities Validated
    const entitySections = Object.keys(allEntities).sort();
    if (entitySections.length > 0) {
      lines.push('## Entities Validated');
      lines.push('');
      lines.push('| Section | Count | Identifiers |');
      lines.push('| --- | --- | --- |');
      for (const section of entitySections) {
        const ids = [...allEntities[section]].sort();
        lines.push(`| ${section} | ${ids.length} | ${ids.join(', ')} |`);
      }
      lines.push('');
    }

    // Skipped Validations
    if (allSkips.length > 0) {
      lines.push('## Skipped Validations');
      lines.push('');
      lines.push('| File | Test | Reason |');
      lines.push('| --- | --- | --- |');
      for (const skip of allSkips) {
        lines.push(`| ${skip.file} | ${skip.test} | ${skip.reason} |`);
      }
      lines.push('');
    }

    // Lifecycle Actions
    if (allLifecycleActions.length > 0) {
      lines.push('## Lifecycle Actions');
      lines.push('');
      lines.push('| Action | Entity | ID |');
      lines.push('| --- | --- | --- |');
      for (const la of allLifecycleActions) {
        lines.push(`| ${la.action} | ${la.entity} | ${la.id} |`);
      }
      lines.push('');
    }

    // Completeness Results
    const withMissing = allCompleteness.filter((cr) => cr.missing.length > 0);
    if (withMissing.length > 0) {
      lines.push('## Completeness Results');
      lines.push('');
      lines.push('| Tool | Section | Missing Fields |');
      lines.push('| --- | --- | --- |');
      for (const cr of withMissing) {
        lines.push(`| ${cr.tool} | ${cr.section} | ${cr.missing.join(', ')} |`);
      }
      lines.push('');
    } else if (allCompleteness.length > 0) {
      lines.push('## Completeness Results');
      lines.push('');
      lines.push('All tools passed schema completeness checks.');
      lines.push('');
    }

    // Field Comparisons
    if (allFieldComparisons.length > 0) {
      const totalFields = allFieldComparisons.reduce(
        (sum, fc) => sum + fc.fields.length,
        0,
      );
      const totalMismatches = allFieldComparisons.reduce(
        (sum, fc) => sum + fc.fields.filter((f) => !f.match).length,
        0,
      );

      lines.push('## Field Comparisons');
      lines.push('');
      lines.push(
        `${allFieldComparisons.length} entities, ${totalFields} fields compared, ${totalMismatches} mismatch${totalMismatches !== 1 ? 'es' : ''}`,
      );
      lines.push('');

      // Group by file
      const byFile = new Map<
        string,
        typeof allFieldComparisons
      >();
      for (const fc of allFieldComparisons) {
        const list = byFile.get(fc.file) ?? [];
        list.push(fc);
        byFile.set(fc.file, list);
      }

      for (const [file, comparisons] of byFile) {
        lines.push(`### ${file}`);
        lines.push('');
        for (const fc of comparisons) {
          const heading = fc.entityLabel
            ? `#### ${fc.entity} — ${escapeTableValue(fc.entityLabel, 60)}`
            : `#### ${fc.entity}`;
          lines.push(heading);
          lines.push('| Field | TOON | API | Match |');
          lines.push('|-------|------|-----|-------|');
          for (const f of fc.fields) {
            const matchStr = f.match ? 'ok' : '**MISMATCH**';
            lines.push(
              `| ${escapeTableValue(f.field, 30)} | ${escapeTableValue(f.toon, 80)} | ${escapeTableValue(f.api, 80)} | ${matchStr} |`,
            );
          }
          lines.push('');
        }
      }
    }

    // Test Details (per module)
    lines.push('## Test Details');
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
        `${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped — ${(summary.duration / 1000).toFixed(1)}s`,
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
    // Write file
    // ------------------------------------------------------------------
    const reportsDir = path.resolve(import.meta.dirname ?? __dirname, '../reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const reportPath = path.join(reportsDir, `report-${dateStr}.md`);

    fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');

    // Also print to console so it's visible
    console.log(`\n  Live test report written to: ${reportPath}\n`);
  }
}
