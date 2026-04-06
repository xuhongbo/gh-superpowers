import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PLUGIN_ROOT = path.resolve(path.join(import.meta.dirname, '../..'));

describe('hooks', () => {
  describe('session-start', () => {
    it('outputs valid JSON with additional_context', async () => {
      const { stdout } = await execFileAsync('bash', [
        path.join(PLUGIN_ROOT, 'hooks/session-start'),
      ], {
        cwd: PLUGIN_ROOT,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      });

      const parsed = JSON.parse(stdout);
      assert(parsed.additional_context || parsed.hookSpecificOutput?.additionalContext || parsed.additionalContext,
        'Expected one of additional_context, hookSpecificOutput.additionalContext, or additionalContext');
    });

    it('includes superpowers context in the output', async () => {
      const { stdout } = await execFileAsync('bash', [
        path.join(PLUGIN_ROOT, 'hooks/session-start'),
      ], {
        cwd: PLUGIN_ROOT,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      });

      assert(stdout.includes('superpowers'), 'Output should mention superpowers');
    });

    it('warns about legacy skills directory when present', async () => {
      const legacyDir = path.join(os.tmpdir(), 'test-legacy-skills');
      await fs.mkdir(legacyDir, { recursive: true });
      try {
        const { stdout } = await execFileAsync('bash', [
          path.join(PLUGIN_ROOT, 'hooks/session-start'),
        ], {
          cwd: PLUGIN_ROOT,
          env: {
            ...process.env,
            CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
            HOME: os.tmpdir(), // Override HOME so legacy dir check uses tmpdir
          },
        });

        // Create the legacy dir under the tmpdir HOME
        const testHome = os.tmpdir();
        const testLegacyDir = path.join(testHome, '.config', 'superpowers', 'skills');
        await fs.mkdir(testLegacyDir, { recursive: true });

        const { stdout: stdout2 } = await execFileAsync('bash', [
          path.join(PLUGIN_ROOT, 'hooks/session-start'),
        ], {
          cwd: PLUGIN_ROOT,
          env: {
            ...process.env,
            CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
            HOME: testHome,
          },
        });

        assert(stdout2.includes('WARNING') || stdout2.includes('.claude/skills'),
          'Output should warn about legacy skills directory');
      } finally {
        await fs.rm(legacyDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe('pre-commit-check', () => {
    it('exits 0 when no session file exists', async () => {
      const { stdout } = await execFileAsync('bash', [
        path.join(PLUGIN_ROOT, 'hooks/pre-commit-check'),
      ], {
        cwd: PLUGIN_ROOT,
        env: { ...process.env },
      });

      assert(stdout.includes('未找到 session') || stdout.includes('检查完成'));
    });

    it('detects task-link markers in commit message', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'commit-msg-'));
      try {
        const msgFile = path.join(tmp, 'commit-msg');
        await fs.writeFile(msgFile, 'feat: add feature\n<!-- gh-superpowers:task-links {"tasks":["T1"]} -->');

        const { stdout } = await execFileAsync('bash', [
          path.join(PLUGIN_ROOT, 'hooks/pre-commit-check'),
          msgFile,
        ], {
          cwd: PLUGIN_ROOT,
        });

        assert(stdout.includes('任务关联标记') || stdout.includes('检查完成'),
          'Should process commit message');
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('warns when commit message lacks task-link markers', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'commit-msg-'));
      try {
        const msgFile = path.join(tmp, 'commit-msg');
        await fs.writeFile(msgFile, 'feat: add feature without any links');

        const { stdout } = await execFileAsync('bash', [
          path.join(PLUGIN_ROOT, 'hooks/pre-commit-check'),
          msgFile,
        ], {
          cwd: PLUGIN_ROOT,
        });

        assert(stdout.includes('未检测到') || stdout.includes('提示'),
          'Should warn about missing task-link markers');
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('hooks.json', () => {
    it('is valid JSON with expected hook definitions', async () => {
      const raw = await fs.readFile(path.join(PLUGIN_ROOT, 'hooks/hooks.json'), 'utf8');
      const config = JSON.parse(raw);

      assert(config.hooks, 'Should have hooks key');
      assert(config.hooks.SessionStart, 'Should define SessionStart hook');
      assert(config.hooks.PreCommit, 'Should define PreCommit hook');
    });

    it('references existing hook script files', async () => {
      const raw = await fs.readFile(path.join(PLUGIN_ROOT, 'hooks/hooks.json'), 'utf8');
      const config = JSON.parse(raw);

      for (const [eventName, hookList] of Object.entries(config.hooks)) {
        for (const hook of hookList) {
          if (hook.command) {
            // Extract script path from command string
            const match = hook.command.match(/["']?([^"'\s]+run-hook\.cmd|[^"'\s]+\.sh|[^"'\s]+\/[\w-]+)["']?/);
            if (match) {
              const scriptPath = path.join(PLUGIN_ROOT, 'hooks', match[1].split('/').pop());
              const exists = await fs.access(scriptPath).then(() => true).catch(() => false);
              assert(exists, `Hook script ${scriptPath} for ${eventName} should exist`);
            }
          }
        }
      }
    });
  });

  describe('run-hook.cmd (unix path)', () => {
    it('delegates to the named hook script', async () => {
      const { stdout } = await execFileAsync('bash', [
        path.join(PLUGIN_ROOT, 'hooks/run-hook.cmd'),
        'session-start',
      ], {
        cwd: PLUGIN_ROOT,
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      });

      const parsed = JSON.parse(stdout);
      assert(parsed.additional_context || parsed.hookSpecificOutput?.additionalContext || parsed.additionalContext,
        'Should output valid JSON with context');
    });
  });
});
