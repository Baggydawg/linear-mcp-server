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
