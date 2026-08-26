#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';

const CONFIRMATION = 'production-aihub-iam-repair';
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const execute = hasFlag('--execute');
const batchSize = Number(readArg('--batch-size') || 20);
const employeeNumberFilter = readArg('--employee-number');
const outputDir = path.resolve(readArg('--output-dir') || 'artifacts/aihub-binding-reconciliation');
const providerId = Number(process.env.AIHUB_IAM_PROVIDER_ID || 1);
const databaseUrl = process.env.DATABASE_URL;
const bridgeUrl = process.env.AIHUB_BRIDGE_URL?.replace(/\/+$/, '');
const bridgeToken = process.env.AIHUB_BRIDGE_TOKEN;

if (!databaseUrl || !bridgeUrl || !bridgeToken) {
  throw new Error('DATABASE_URL, AIHUB_BRIDGE_URL and AIHUB_BRIDGE_TOKEN are required');
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) {
  throw new Error('--batch-size must be an integer between 1 and 20');
}
if (execute && readArg('--confirm') !== CONFIRMATION) {
  throw new Error(`--execute requires --confirm ${CONFIRMATION}`);
}

const bridgeRequest = async (pathname, init) => {
  const response = await fetch(`${bridgeUrl}${pathname}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${bridgeToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok || body?.success === false) {
    const error = new Error(
      body?.error?.message || `Bridge request failed with ${response.status}`,
    );
    error.code = body?.error?.code || 'bridge_request_failed';
    throw error;
  }
  return body?.data;
};
const maskEmployeeNumber = (value) => {
  const text = String(value || '');
  if (text.length <= 3) return '***';
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
};

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const report = {
  dryRun: !execute,
  generatedAt: new Date().toISOString(),
  results: [],
  rollbackCandidates: [],
};

try {
  const values = [];
  const filter = employeeNumberFilter
    ? `and p.employee_number = $${values.push(employeeNumberFilter)}`
    : '';
  values.push(batchSize);
  const { rows } = await pool.query(
    `select b.user_id, b.new_api_user_id, b.iam_oauth_binding_status,
            p.employee_number, p.employment_status, u.username
       from new_api_bindings b
       join enterprise_user_profiles p on p.user_id = b.user_id and p.provider = 'wecom'
       join users u on u.id = b.user_id
      where b.new_api_user_id is not null
        and b.iam_oauth_binding_status in ('unknown', 'error', 'conflict')
        ${filter}
      order by b.user_id
      limit $${values.length}`,
    values,
  );

  for (const row of rows) {
    const result = {
      aihubUserId: row.new_api_user_id,
      employeeNumber: maskEmployeeNumber(row.employee_number),
      localStatusBefore: row.iam_oauth_binding_status,
      masterinoUserId: row.user_id,
    };
    try {
      if (
        row.employment_status !== 'active' ||
        !row.employee_number ||
        row.username !== row.employee_number
      ) {
        report.results.push({ ...result, category: 'skipped', reason: 'identity_mismatch' });
        continue;
      }

      const aihubUser = await bridgeRequest(`/v1/users/${row.new_api_user_id}`);
      if (aihubUser?.username !== row.employee_number) {
        report.results.push({ ...result, category: 'skipped', reason: 'aihub_username_mismatch' });
        continue;
      }
      const resolvedAihubUser = await bridgeRequest(
        `/v1/users/resolve?${new URLSearchParams({ username: row.employee_number })}`,
      );
      if (resolvedAihubUser?.id !== row.new_api_user_id) {
        report.results.push({
          ...result,
          category: 'skipped',
          reason: 'aihub_identity_not_unique',
        });
        continue;
      }

      const query = new URLSearchParams({
        providerId: String(providerId),
        providerUserId: row.employee_number,
      });
      const before = await bridgeRequest(`/v1/users/${row.new_api_user_id}/oauth-binding?${query}`);
      if (before.status === 'existing') {
        if (execute) {
          await pool.query(
            `update new_api_bindings
                set iam_oauth_binding_status = 'active', iam_oauth_binding_error_code = null,
                    iam_oauth_binding_error = null, iam_oauth_binding_synced_at = now(),
                    updated_at = now()
              where user_id = $1 and new_api_user_id = $2`,
            [row.user_id, row.new_api_user_id],
          );
        }
        report.results.push({ ...result, before, category: 'already-correct' });
        continue;
      }
      if (before.status === 'conflict') {
        if (execute) {
          await pool.query(
            `update new_api_bindings
                set iam_oauth_binding_status = 'conflict',
                    iam_oauth_binding_error_code = 'binding_conflict',
                    iam_oauth_binding_error = $3, iam_oauth_binding_synced_at = now(),
                    updated_at = now()
              where user_id = $1 and new_api_user_id = $2`,
            [row.user_id, row.new_api_user_id, before.reason],
          );
        }
        report.results.push({ ...result, before, category: 'conflict' });
        continue;
      }
      if (!execute) {
        report.results.push({ ...result, before, category: 'repairable' });
        continue;
      }

      const repair = await bridgeRequest(`/v1/users/${row.new_api_user_id}/oauth-binding`, {
        body: JSON.stringify({ providerId, providerUserId: row.employee_number }),
        method: 'POST',
      });
      const verified = await bridgeRequest(
        `/v1/users/${row.new_api_user_id}/oauth-binding?${query}`,
      );
      if (verified.status !== 'existing') {
        throw Object.assign(new Error('OAuth binding read-back verification failed'), {
          code: 'verification_failed',
        });
      }
      await pool.query(
        `update new_api_bindings
            set iam_oauth_binding_status = 'active', iam_oauth_binding_error_code = null,
                iam_oauth_binding_error = null, iam_oauth_binding_synced_at = now(),
                updated_at = now()
          where user_id = $1 and new_api_user_id = $2`,
        [row.user_id, row.new_api_user_id],
      );
      report.results.push({
        ...result,
        before,
        category: 'repairable',
        executed: true,
        repair,
        verified,
      });
      report.rollbackCandidates.push({
        ...result,
        action: repair.status,
        note: 'Manual review required before reverting an OAuth binding',
      });
    } catch (error) {
      report.results.push({
        ...result,
        category: error.code === 'binding_conflict' ? 'conflict' : 'skipped',
        reason: error.code || 'unexpected_error',
      });
    }
  }
} finally {
  await pool.end();
}

report.summary = Object.fromEntries(
  ['repairable', 'conflict', 'skipped', 'already-correct'].map((category) => [
    category,
    report.results.filter((item) => item.category === category).length,
  ]),
);
await mkdir(outputDir, { recursive: true });
const reportPath = path.join(outputDir, `${Date.now()}-${execute ? 'execute' : 'dry-run'}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));
