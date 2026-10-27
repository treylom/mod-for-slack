#!/usr/bin/env node
// owner lane 기록 셈 — «실제로 걸린 봇 수» (mod 밖 CLI · mod import 그래프에 안 들어감).
// 쓰기: node src/owner/count.mjs <logDir> [--since YYYY-MM-DD]
import { readdirSync, readFileSync } from 'node:fs'
const [dir, ...rest] = process.argv.slice(2)
if (!dir) { console.error('usage: count.mjs <logDir> [--since YYYY-MM-DD]'); process.exit(2) }
const since = rest[0] === '--since' ? Date.parse(rest[1] + 'T00:00:00+09:00') : 0
const per = {}
for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
  let r; try { r = JSON.parse(readFileSync(dir + '/' + f, 'utf8')) } catch { continue }
  if (since && Number(r.at) < since) continue
  const b = (per[r.bot || '?'] ||= {})
  const k = `${r.kind}:${r.decision}`
  b[k] = (b[k] || 0) + 1
}
const blocked = Object.entries(per).filter(([, v]) => Object.keys(v).some(k => /:(block|deny)$/.test(k))).map(([b]) => b)
console.log(JSON.stringify({ dir, bots: per, blocked_bots: blocked.length, blocked_names: blocked.sort() }, null, 1))
