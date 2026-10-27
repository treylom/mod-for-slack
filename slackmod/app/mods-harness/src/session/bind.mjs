#!/usr/bin/env node
// lane: session · G2 (봇 10-19 16:0x): attach sessions or threads to a project AFTER the fact — Node only, not a mod file
// (hooks/register.js never imports it). It appends to the shared binding log (session.binding_file) the lane and the ui tree
// fold over the registry rows; it never rewrites a registry row (one writer per row: the session itself).
//
//   node src/session/bind.mjs attach --project <name> --ids <id,id,…> [--by <who>] [--write] [--config <path>]
//   node src/session/bind.mjs thread --channel <C…> --ts <thread_ts> --project <name> [--by <who>] [--write] [--config <path>]
//   node src/session/bind.mjs show [--config <path>]
// Without --write nothing is written (DRY: prints the plan and the exact lines). --project none = unbind.
// Config = --config, else $MODS_HARNESS_CONFIG. Exit: 0 ok · 2 bad input · 3 nothing to write (all refused) · 4 write check failed.
import fs from 'node:fs'
import path from 'node:path'
import { sessionConfig, attachPlan, bindingLine, foldBindings, projectName, projectListText, kstNow } from './core.js'

function args(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i]
    else out._.push(a)
  }
  return out
}
const fail = (code, msg) => { process.stderr.write(msg + '\n'); process.exit(code) }

const a = args(process.argv.slice(2))
const cmd = a._[0]
const cfgPath = a.config || process.env.MODS_HARNESS_CONFIG
if (!['attach', 'thread', 'show'].includes(cmd)) fail(2, 'usage: bind.mjs attach|thread|show … (see the head of this file)')
if (!cfgPath || !fs.existsSync(cfgPath)) fail(2, `config not found: ${cfgPath || '(none — pass --config or set MODS_HARNESS_CONFIG)'}`)
const cfg = sessionConfig(JSON.parse(fs.readFileSync(cfgPath, 'utf8')), process.env.HOME || '')
if (!cfg.binding_file) fail(2, 'session.binding_file is off in this config')
const logText = () => (fs.existsSync(cfg.binding_file) ? fs.readFileSync(cfg.binding_file, 'utf8') : '')

if (cmd === 'show') {
  const f = foldBindings(logText())
  for (const [k, r] of Object.entries(f.threads)) console.log(`thread ${k} → ${r.project} (${r.how} · ${r.by || '?'} · ${r.at || '?'})`)
  for (const [k, r] of Object.entries(f.sessions)) console.log(`session ${k} → ${r.project} (${r.how} · ${r.by || '?'} · ${r.at || '?'})`)
  process.exit(0)
}

const by = a.by || process.env.MODS_HARNESS_BOT || 'manual'
const at = kstNow(Date.now())
const project = a.project === 'none' ? null : a.project
if (project === undefined) fail(2, '--project <name> required (none = unbind)')
let lines = []
if (cmd === 'attach') {
  const ids = String(a.ids || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!ids.length) fail(2, '--ids <id,id,…> required')
  const rows = []
  for (const n of fs.existsSync(cfg.registry_dir) ? fs.readdirSync(cfg.registry_dir) : []) {
    if (!n.endsWith('.json')) continue
    try { rows.push(JSON.parse(fs.readFileSync(path.join(cfg.registry_dir, n), 'utf8'))) } catch (err) { /* a broken row is not a session */ }
  }
  const plan = attachPlan(rows, ids, project, cfg.projects, by, at)
  if (plan.error) fail(2, plan.error)
  for (const l of plan.lines) console.log(`attach ${l.id}: ${l.before || '(none)'} → ${l.after || '(none)'}`)
  for (const r of plan.refused) console.log(`refused ${r}`)
  lines = plan.lines.map((l) => l.line)
} else {
  const p = project === null ? null : projectName(cfg.projects, project)
  if (project !== null && !p) fail(2, `project "${project}" is not in the project list — use one of: ${projectListText(cfg.projects)}`)
  const line = bindingLine({ kind: 'thread', channel: a.channel, ts: a.ts, project: p, by, how: 'manual', at })
  if (!line) fail(2, 'bad --channel / --ts')
  console.log(`thread ${a.channel}/${a.ts}: → ${p || '(none)'}`)
  lines = [line]
}
if (!lines.length) fail(3, 'nothing to write')
for (const l of lines) process.stdout.write('line ' + l)
if (!a.write) { console.log(`DRY — nothing written (${lines.length} line(s) above would be appended to ${cfg.binding_file}; add --write)`); process.exit(0) }
fs.mkdirSync(path.dirname(cfg.binding_file), { recursive: true, mode: 0o700 })
for (const l of lines) fs.appendFileSync(cfg.binding_file, l, { mode: 0o600 })     // one write per line (O_APPEND)
const f = foldBindings(logText())
const bad = lines.map((l) => JSON.parse(l)).filter((r) => (r.kind === 'session' ? f.sessions[r.id] : f.threads[`${r.channel}/${r.ts}`])?.project !== r.project)
if (bad.length) fail(4, `write check failed for ${bad.length} line(s) — another writer may have bound the same key since`)
console.log(`written ${lines.length} line(s) to ${cfg.binding_file}`)
