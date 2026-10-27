// Shared, non-secret per-bot table. Both the bridge and approval registry read
// the same provisioned JSON file. Only verified rows may be enabled; stage 1
// provisions bot alone. Paths identify credentials but never contain them.

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { loadButtonKey, ReceiptRejected, type ApprovalBotConfig } from './approval-button-receipt.js';

const ROW_FIELDS = [
  'app_id', 'bot_user_id', 'enabled', 'key_file', 'owner_dm', 'owner_id', 'token_env_file',
] as const;

function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function regularOwnedFile(path: string): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new ReceiptRejected('bot table must be a regular file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino
        || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600
        || info.size > 32_768) throw new ReceiptRejected('bot table owner, mode, or size invalid');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

export interface ActiveButtonBot { config: ApprovalBotConfig; key: Buffer; }

export interface SkippedButtonRow { botId: string; reason: string; }

// r2(봇 검증 FAIL ③ 한 행 오류가 모든 봇 승인을 막던 것): 이 브리지 봇 행만 엄격 · 다른 켜진 행 오류 = 건너뜀.
// 마지막 loadActiveButtonBot 호출에서 건너뛴 다른 행과 사유(로그·진단용 — 판정에 안 씀 · 호출부 영향 0).
let skippedRows: SkippedButtonRow[] = [];
export function lastSkippedButtonRows(): readonly SkippedButtonRow[] { return skippedRows; }

interface CheckedRow { config: ApprovalBotConfig; key: Buffer; keyHash: string; }

// 켜진 행 1개 엄격 검사(칸·정규식·절대 경로·키 파일). 꺼진 행 = null. 실패 = ReceiptRejected(종전 문구 그대로).
function checkRow(botId: string, rawRow: unknown): CheckedRow | null {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(botId) || rawRow === null
      || typeof rawRow !== 'object' || Array.isArray(rawRow)) throw new ReceiptRejected('bot row invalid');
  const row = rawRow as Record<string, unknown>;
  if (!sameKeys(row, ROW_FIELDS) || typeof row.enabled !== 'boolean') throw new ReceiptRejected('bot row fields invalid');
  if (!row.enabled) return null;
  const fields = ROW_FIELDS.filter((name) => name !== 'enabled');
  if (!fields.every((name) => typeof row[name] === 'string')) throw new ReceiptRejected('enabled bot row fields invalid');
  const config: ApprovalBotConfig = {
    bot_id: botId,
    enabled: true,
    app_id: row.app_id as string,
    owner_id: row.owner_id as string,
    owner_dm: row.owner_dm as string,
    bot_user_id: row.bot_user_id as string,
    token_env_file: row.token_env_file as string,
    key_file: row.key_file as string,
  };
  if (!/^A[A-Z0-9]{8,}$/.test(config.app_id) || !/^U[A-Z0-9]{8,}$/.test(config.owner_id)
      || !/^U[A-Z0-9]{8,}$/.test(config.bot_user_id) || !/^D[A-Z0-9]{8,}$/.test(config.owner_dm)
      || !isAbsolute(config.token_env_file) || !isAbsolute(config.key_file)) {
    throw new ReceiptRejected('enabled bot identity invalid');
  }
  const key = loadButtonKey(config.key_file);
  return { config, key, keyHash: createHash('sha256').update(key).digest('hex') };
}

function rowBotUserId(rawRow: unknown): unknown {
  return rawRow !== null && typeof rawRow === 'object' && !Array.isArray(rawRow)
    ? (rawRow as Record<string, unknown>).bot_user_id : undefined;
}

export function loadActiveButtonBot(
  tableFile: string, actualBotUserId: string, actualTokenEnvFile: string, keyFileEnv: string,
): ActiveButtonBot | null {
  skippedRows = [];
  if (!isAbsolute(tableFile) || !isAbsolute(actualTokenEnvFile) || !isAbsolute(keyFileEnv)) {
    throw new ReceiptRejected('bot table or key path must be absolute');
  }
  const parsed = JSON.parse(regularOwnedFile(tableFile).toString('utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ReceiptRejected('bot table invalid');
  const root = parsed as Record<string, unknown>;
  if (!sameKeys(root, ['schema', 'bots']) || root.schema !== 'button-bots-v1'
      || root.bots === null || typeof root.bots !== 'object' || Array.isArray(root.bots)) {
    throw new ReceiptRejected('bot table schema invalid');
  }
  const rows = root.bots as Record<string, unknown>;
  // 1) 이 브리지 봇 행(bot_user_id 일치) = 엄격: 오류 그대로 throw · 켜진 행 2개 이상 = 신원 재사용.
  let selected: CheckedRow | null = null;
  for (const [botId, rawRow] of Object.entries(rows)) {
    if (rowBotUserId(rawRow) !== actualBotUserId) continue;
    const checked = checkRow(botId, rawRow);
    if (!checked) continue;
    if (selected) throw new ReceiptRejected('enabled bot identity reused');
    if (checked.config.token_env_file !== actualTokenEnvFile || checked.config.key_file !== keyFileEnv) {
      throw new ReceiptRejected('current bridge bot table mismatch');
    }
    selected = checked;
  }
  // 2) 다른 켜진 행 = 검사 시도 → 실패하면 건너뜀(사유 모음).
  const others: CheckedRow[] = [];
  for (const [botId, rawRow] of Object.entries(rows)) {
    if (rowBotUserId(rawRow) === actualBotUserId) continue;
    try {
      const checked = checkRow(botId, rawRow);
      if (checked) others.push(checked);
    } catch (error) {
      skippedRows.push({ botId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!selected) return null;
  // 3) 겹침: 검사 통과한 다른 행이 이 봇 행과 겹치면 = 이 봇도 거부(위조 신호) · 다른 행끼리만 겹치면 = 그 행들 건너뜀.
  for (const other of others) {
    if (other.config.app_id === selected.config.app_id) throw new ReceiptRejected('enabled bot identity reused');
    if (other.keyHash === selected.keyHash) throw new ReceiptRejected('button signing key shared by bots');
  }
  for (const other of others) {
    if (others.some((o) => o !== other && (o.config.app_id === other.config.app_id
        || o.config.bot_user_id === other.config.bot_user_id || o.keyHash === other.keyHash))) {
      skippedRows.push({ botId: other.config.bot_id, reason: 'shared key or identity with another row' });
    }
  }
  return { config: selected.config, key: selected.key };
}
