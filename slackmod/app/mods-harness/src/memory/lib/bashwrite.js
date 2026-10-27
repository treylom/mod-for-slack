// bashwrite.js — K2 r5 (p7 적대 재검 r1 D1~D4 · D8 · r2 K2-1~K2-10 · r3 K3-1~K3-8 · 10-21 · r4 K4-1~K4-7 · 10-22): where a 하위's Bash command WRITES, read the way a shell reads it.
// Pure (no $, no fs, no process). A best-effort reader, not a shell. Judged = only the paths a command writes:
//   · output redirects: > >> >| &> &>> N> N>> <> >&file (exec N>… too) — not 2>&1, not input redirects
//   · write verbs' target args: tee touch mkdir rm rmdir unlink truncate shred mv cp ln install rsync ditto scp dd(of=) sponge
//     sed -i · perl -i · gawk -i inplace · sort -o · curl -o/-O/-c · wget · tar (x → -C or here · c → -f) · unzip (-d or here) · zip
//     gzip-family (in place) · chmod/chown/chgrp · xattr · find (-delete · -exec <write verb> · -fprint) · git (checkout · restore
//     · rm · mv · clean · reset --hard · stash) · sqlite3 (a writing statement) · mktemp · patch · split
//   · cp/rsync/ditto/mv INTO a folder above a root: what lands there (the source's name, or its contents for «src/» · ditto)
//   · code handed to sh/bash/zsh -c · eval · a heredoc fed to sh/python/node/ruby/perl/php/osascript/sqlite3, and the
//     code of python -c · node -e · ruby -e · perl -e · php -r · osascript -e · awk '…' — when that code names a root (a path
//     literal or a piece joined onto one, its last two folder names joined, argv carrying a root) AND writes anywhere in it;
//     a subprocess/system call counts as writing unless every such call is spelled out whole in string literals and runs
//     only pure readers — no command that can write from its own arguments · git with a reading subcommand · sqlite3 with
//     reading SQL («git log -- <root>» passes) — r4 went back to this whole-code rule (r3's per-statement reading let 15
//     writes through · 3차 재검 K3-1 · K3-2) · r5 narrowed the exception from «a command the shell reading knows» to pure
//     readers (the shell reading misses some writes · 4차 재검 K4-2) · a list is quoted per element · an escape = unread
//   · $(…) `…` <(…) >(…) and «for NAME in …» are read too
// A heredoc fed to any other command (cat > result.md <<'EOF' …) is data: a result file that cites a memory path passes.
// Paths: quotes removed · ~ ~user $HOME ${HOME} $PWD ${PWD} $TMPDIR and NAME=value set earlier in the same command expanded
// · «cd DIR» followed · // . .. /System/Volumes/Data collapsed · compared case-insensitively (this disk is) · simple {a,b}
// expanded · globs matched per part. A path built at run time ($(…), $RANDOM, a variable set elsewhere) counts only if its
// literal tail names a root's last two folders as whole folder names. Not seen (said in the deny line): a script file's own
// writes · xargs / while-read input · a pipe into an interpreter. Code that reads a root and writes elsewhere is refused (rough).

const LOWER = s => String(s).normalize('NFC').toLowerCase()
export function normPath(p) {
  const segs = []
  for (const s of String(p).split('/')) {
    if (!s || s === '.') continue
    if (s === '..') segs.pop(); else segs.push(s)
  }
  return '/' + segs.join('/')
}
const FIRMLINK = /^\/+system\/volumes\/data(?=\/)/i
const TEMP_VARS = new Set(['TMPDIR', 'TMP', 'TEMP'])

// ── lexer ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// word = { t:'w', parts:[{lit,q}|{v}|{sub:true}|{tilde:user}], glob, brace } · op = { t:'op', v } · redirect = { t:'r', op, fd, body? }
function closeOf(src, i, open, close) {   // i = index of the opening char · returns index of its matching close (or src.length)
  let d = 0
  const pend = []   // heredocs opened inside: their bodies are skipped at the next newline (an apostrophe there is text)
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (c === '\\') { j++; continue }
    if (c === "'") { const k = src.indexOf("'", j + 1); if (k < 0) return src.length; j = k; continue }
    if (c === '"') { let k = j + 1; while (k < src.length && src[k] !== '"') { if (src[k] === '\\') k++; k++ } j = k; continue }
    if (c === '<' && src[j + 1] === '<') {
      if (src[j + 2] === '<') { j += 2; continue }
      const m = /^<<(-?)[ \t]*\\?(['"]?)([A-Za-z0-9_.-]+)\2/.exec(src.slice(j, j + 256))
      if (m) { pend.push({ delim: m[3], strip: m[1] === '-' }); j += m[0].length - 1; continue }
    }
    if (c === '\n' && pend.length) {
      let k = j + 1
      for (const p of pend.splice(0)) {
        for (;;) {
          if (k >= src.length) return src.length
          const e = src.indexOf('\n', k); const end = e < 0 ? src.length : e
          const line = src.slice(k, end); k = end + 1
          if ((p.strip ? line.replace(/^\t+/, '') : line) === p.delim) break
        }
      }
      j = k - 1; continue
    }
    if (c === open) d++
    else if (c === close) { d--; if (d === 0) return j }
  }
  return src.length
}
export function lexBash(src, subs = []) {
  const s = String(src || '')
  const toks = []
  const pend = []
  let w = null
  const startW = () => { if (!w) w = { t: 'w', parts: [], glob: false, brace: false } }
  const lit = (x, q) => { startW(); const l = w.parts[w.parts.length - 1]; if (l && l.lit !== undefined && l.q === q) l.lit += x; else w.parts.push({ lit: x, q }) }
  const endW = () => { if (w) { toks.push(w); w = null } }
  const dollar = (i, q) => {   // s[i] === '$' → [part, next index]
    const c = s[i + 1]
    if (c === '(') {
      const e = closeOf(s, i + 1, '(', ')')
      if (s[i + 2] !== '(') subs.push(s.slice(i + 2, e))
      startW(); w.parts.push({ sub: true }); return e + 1
    }
    if (c === '{') {
      const e = closeOf(s, i + 1, '{', '}')
      const inner = s.slice(i + 2, e)
      startW(); w.parts.push(/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) ? { v: inner } : { sub: true }); return e + 1
    }
    if (c === "'" && !q) {   // $'…' ANSI-C quoting, read as plain single quotes
      const e = s.indexOf("'", i + 2); const end = e < 0 ? s.length : e
      lit(s.slice(i + 2, end), true); return end + 1
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i + 1, i + 257))
    if (m) { startW(); w.parts.push({ v: m[0] }); return i + 1 + m[0].length }
    if (c && /[0-9@*#?$!-]/.test(c)) { startW(); w.parts.push({ sub: true }); return i + 2 }
    lit('$', q); return i + 1
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      if (s[i + 1] === '\n') { i += 2; continue }
      if (i + 1 < s.length) lit(s[i + 1], true)
      i += 2; continue
    }
    if (c === "'") {
      const e = s.indexOf("'", i + 1); const end = e < 0 ? s.length : e
      lit(s.slice(i + 1, end), true); startW(); i = end + 1; continue
    }
    if (c === '"') {
      startW(); i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '$`"\\\n'.includes(s[i + 1])) { if (s[i + 1] !== '\n') lit(s[i + 1], true); i += 2; continue }
        if (s[i] === '$') { i = dollar(i, true); continue }
        if (s[i] === '`') { const e = s.indexOf('`', i + 1); const end = e < 0 ? s.length : e; subs.push(s.slice(i + 1, end)); w.parts.push({ sub: true }); i = end + 1; continue }
        lit(s[i], true); i++
      }
      i++; continue
    }
    if (c === '$') { i = dollar(i, false); continue }
    if (c === '`') { const e = s.indexOf('`', i + 1); const end = e < 0 ? s.length : e; subs.push(s.slice(i + 1, end)); startW(); w.parts.push({ sub: true }); i = end + 1; continue }
    if (c === '#' && !w) { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue }
    if ((c === '<' || c === '>') && s[i + 1] === '(' && !w) {   // process substitution
      const e = closeOf(s, i + 1, '(', ')'); subs.push(s.slice(i + 2, e)); startW(); w.parts.push({ sub: true }); i = e + 1; continue
    }
    if (c === '>' || c === '<' || (c === '&' && s[i + 1] === '>')) {
      let fd = ''
      if (w && w.parts.length === 1 && w.parts[0].lit !== undefined && !w.parts[0].q && /^[0-9]+$/.test(w.parts[0].lit)) { fd = w.parts[0].lit; w = null }
      endW()
      const op = /^(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<>|<&|<)/.exec(s.slice(i, i + 4))[0]
      i += op.length
      const r = { t: 'r', op, fd }
      toks.push(r)
      if (op === '<<' || op === '<<-') {
        while (s[i] === ' ' || s[i] === '\t') i++
        let bs = false
        if (s[i] === '\\') { bs = true; i++ }   // <<\EOF = a quoted delimiter
        const m = /^(['"]?)([^\s'";|&<>()\\]*)\1/.exec(s.slice(i, i + 256)) || ['', '', '']
        i += m[0].length
        pend.push({ r, delim: m[2], strip: op === '<<-', quoted: !!m[1] || bs })
      }
      continue
    }
    if (c === ' ' || c === '\t') { endW(); i++; continue }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      endW()
      const op = /^(&&|\|\||;;|\|&|\n|;|\||&|\(|\))/.exec(s.slice(i, i + 2))[0]
      toks.push({ t: 'op', v: op }); i += op.length
      if (op === '\n' && pend.length) {   // heredoc bodies start on the next line
        for (const p of pend.splice(0)) {
          const lines = []
          for (;;) {
            if (i >= s.length) break
            const e = s.indexOf('\n', i); const end = e < 0 ? s.length : e
            const line = s.slice(i, end); i = end + 1
            if ((p.strip ? line.replace(/^\t+/, '') : line) === p.delim) break
            lines.push(line)
          }
          p.r.body = lines.join('\n')
          if (!p.quoted) {   // an unquoted heredoc runs its $(…) and `…` — read those as commands (the text itself stays data)
            const b = p.r.body
            for (let j = 0; j < b.length; j++) {
              if (b[j] === '\\') { j++; continue }
              if (b[j] === '$' && b[j + 1] === '(' && b[j + 2] !== '(') { const e = closeOf(b, j + 1, '(', ')'); subs.push(b.slice(j + 2, e)); j = e }
              else if (b[j] === '`') { const e = b.indexOf('`', j + 1); if (e < 0) break; subs.push(b.slice(j + 1, e)); j = e }
            }
          }
        }
      }
      continue
    }
    if (!w && c === '~') {   // ~ or ~user (up to the next /)
      const m = /^[A-Za-z0-9_.-]*/.exec(s.slice(i + 1, i + 257))
      startW(); w.parts.push({ tilde: m[0] }); i += 1 + m[0].length; continue
    }
    if ('*?['.includes(c)) { startW(); w.glob = true }
    if (c === '{' && /^\{[^{}\s]*,[^{}\s]*\}/.test(s.slice(i, i + 512))) { startW(); w.brace = true }
    lit(c, false); i++
  }
  endW()
  for (const p of pend) if (p.r.body === undefined) p.r.body = ''
  return toks
}

// tokens → simple commands: { words:[w…], redirs:[{op, fd, target:w|null, body}] }
function segments(toks) {
  const out = []
  let cur = { words: [], redirs: [] }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.t === 'op') { if (cur.words.length || cur.redirs.length) out.push(cur); cur = { words: [], redirs: [] }; continue }
    if (t.t === 'r') {
      const nx = toks[k + 1]
      const isHere = t.op === '<<' || t.op === '<<-'
      const target = !isHere && nx && nx.t === 'w' ? nx : null
      if (target) k++
      cur.redirs.push({ op: t.op, fd: t.fd, target, body: t.body })
      continue
    }
    cur.words.push(t)
  }
  if (cur.words.length || cur.redirs.length) out.push(cur)
  return out
}

// ── words → strings ───────────────────────────────────────────────────────────────────────────────────────────────
function tildeOf(user, ctx) {
  if (!ctx.home) return null
  if (!user) return ctx.home
  const base = ctx.home.split('/').pop()
  return user === base ? ctx.home : ctx.home.slice(0, ctx.home.length - base.length) + user
}
// → { s: string|null, tail: literal text after the last unknown part, head: known text before the first unknown part, glob, brace }
function resolveWord(word, ctx) {
  let s = ''; let known = true; let tail = ''; let head = null
  for (const p of word.parts) {
    let v = null
    if (p.lit !== undefined) v = p.lit
    else if (p.tilde !== undefined) v = tildeOf(p.tilde, ctx)
    else if (p.v) v = ctx.vars.has(p.v) ? ctx.vars.get(p.v) : p.v === 'HOME' ? (ctx.home || null) : p.v === 'PWD' ? ctx.cwd : TEMP_VARS.has(p.v) ? '/tmp' : null
    if (v === null || v === undefined) { if (known) head = s; known = false; tail = ''; continue }
    s += v; tail += v
  }
  return { s: known ? s : null, tail, head, glob: word.glob, brace: word.brace }
}
const wstr = (word, ctx) => resolveWord(word, ctx).s
function isAssign(word) {
  const p = word.parts[0]
  return !!(p && p.lit !== undefined && !p.q && /^[A-Za-z_][A-Za-z0-9_]*=/.test(p.lit))
}
function assignOf(word, ctx) {
  const p = word.parts[0]
  const eq = p.lit.indexOf('=')
  const name = p.lit.slice(0, eq)
  const rest = { ...word, parts: [{ lit: p.lit.slice(eq + 1), q: false }, ...word.parts.slice(1)] }
  return [name, resolveWord(rest, ctx).s]
}
function expandBraces(str, cap = 64) {
  if ((String(str).match(/\{[^{}]*,[^{}]*\}/g) || []).length > 16) return [str]   // too many groups: compared as written (no deep recursion)
  const m = /\{([^{}]*,[^{}]*)\}/.exec(str)
  if (!m) return [str]
  const out = []
  for (const alt of m[1].split(',')) {
    for (const e of expandBraces(str.slice(0, m.index) + alt + str.slice(m.index + m[0].length), cap)) { out.push(e); if (out.length >= cap) return out }
  }
  return out
}
function globRe(comp) {   // → RegExp, or null when the pattern is not one (then the part is compared as written)
  let r = ''
  for (let i = 0; i < comp.length; i++) {
    const c = comp[i]
    if (c === '*') r += '[^/]*'
    else if (c === '?') r += '[^/]'
    else if (c === '[') { const e = comp.indexOf(']', i + 1); if (e < 0) { r += '\\['; continue } r += '[' + comp.slice(i + 1, e).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']'; i = e }
    else r += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  try { return new RegExp('^' + r + '$', 'i') } catch { return null }
}

// ── judge one written path ────────────────────────────────────────────────────────────────────────────────────────
// mode 'write' = the path or under it · 'destroy' = also a folder above a root (rm -rf · mv · find -delete · git clean)
function sigOf(root) { const c = root.split('/').filter(Boolean); return LOWER(c.slice(-2).join('/')) }
const NAMECH = /[a-z0-9_.-]/
function sigHit(lowText, root) {   // the root's last two folders as whole folder names (not «…/.internal-diff.md»)
  const sig = sigOf(root)
  if (!sig) return false
  for (let k = lowText.indexOf(sig); k >= 0; k = lowText.indexOf(sig, k + 1)) {
    const b = k > 0 ? lowText[k - 1] : ''; const a = lowText[k + sig.length]
    if ((!b || !NAMECH.test(b)) && (a === undefined || !NAMECH.test(a))) return true
  }
  return false
}
function judgeStr(str, res, ctx, mode, how) {
  if (str === '' || str === '-' || str === '/dev/null' || /^\/dev\/(stdout|stderr|fd\/)/.test(str)) return null
  const abs = str.startsWith('/') ? str : (ctx.cwd ? ctx.cwd.replace(/\/+$/, '') + '/' + str : null)
  if (abs === null) return tailHit(str, ctx, how)
  const norm = LOWER(normPath(abs).replace(FIRMLINK, ''))
  for (const root of ctx.roots) {
    const r = LOWER(normPath(root))
    if (res.glob) {
      const pc = norm.split('/').filter(Boolean); const rc = r.split('/').filter(Boolean)
      let ok = true
      for (let i = 0; i < Math.min(pc.length, rc.length) && ok; i++) {
        if (rc[i].startsWith('.') && !pc[i].startsWith('.')) ok = false
        else if (/[*?[]/.test(pc[i])) { const re = globRe(pc[i]); ok = re ? re.test(rc[i]) : pc[i] === rc[i] }
        else ok = pc[i] === rc[i]
      }
      if (ok && (pc.length >= rc.length || mode === 'destroy')) return { root, target: str, how }
      continue
    }
    if (norm === r || norm.startsWith(r + '/')) return { root, target: str, how }
    if (mode === 'destroy' && (norm === '/' || r.startsWith(norm + '/'))) return { root, target: str, how: how + ' (a folder above the root)' }
  }
  return null
}
function tailHit(text, ctx, how) {
  const t = LOWER(text)
  for (const root of ctx.roots) if (sigHit(t, root)) return { root, target: String(text).slice(0, 400), how: how + ' (a path built at run time that names the folder)' }
  return null
}
function judgeWord(word, ctx, mode, how) {
  if (!word) return null
  const res = resolveWord(word, ctx)
  if (res.s === null) {
    // a path with a run-time part: the folder its known head already names (MEM/$f lands in MEM) · else its literal tail
    if (res.head && res.head.includes('/')) { const h = judgeStr(res.head.slice(0, res.head.lastIndexOf('/') + 1) + '_', { glob: res.glob }, ctx, 'write', how + ' (a name made at run time)'); if (h) return h }
    return res.tail ? tailHit(res.tail, ctx, how) : null
  }
  for (const p of (res.brace ? expandBraces(res.s) : [res.s])) { const h = judgeStr(p, res, ctx, mode, how); if (h) return h }
  return null
}

// ── code given to an interpreter ──────────────────────────────────────────────────────────────────────────────────
export function rootSpellings(root, home = '', cwd = '') {
  const out = [root]
  const h = String(home || '').replace(/\/+$/, '')
  if (h && root.startsWith(h + '/')) { const tail = root.slice(h.length); out.push('~' + tail, '$HOME' + tail, '${HOME}' + tail) }
  const rel = relFrom(cwd, root)
  // a one-segment relative root («mem» under the working directory) counts only as «mem/…» (a bare word is not a path)
  if (rel && rel !== '.') out.push(rel.includes('/') ? rel : rel + '/')
  return [...new Set(out)]
}
function relFrom(cwd, root) {
  const a = String(cwd || '').split('/').filter(Boolean)
  const b = String(root || '').split('/').filter(Boolean)
  if (!a.length) return ''
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (i === 0) return ''
  const rel = [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/')
  return rel || '.'
}
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LIT_RE = /(['"`])((?:\\.|(?!\1)[^\\\n]){0,4000})\1/g
function stripOtherPaths(code, ctx) {
  // a quoted WHOLE absolute path neither under nor above a root (a /tmp mirror named like it) → '' · a piece that starts at one of
  // a root's own folder names (HOME + '/.claude/projects/…' · V + '/notes/…') is a joined piece and is kept (r3 K3-1)
  const comps = new Set()
  for (const root of ctx.roots) for (const c of LOWER(root).split('/').filter(Boolean).slice(1)) comps.add(c)
  return String(code).replace(LIT_RE, (m, q, body) => {
    let p = body
    if (p.startsWith('~/')) p = ctx.home ? ctx.home + p.slice(1) : null
    else if (/^\$\{?HOME\}?\//.test(p)) p = ctx.home ? ctx.home + p.replace(/^\$\{?HOME\}?/, '') : null
    if (!p || !p.startsWith('/')) return m
    const n = LOWER(normPath(p).replace(FIRMLINK, ''))
    if (comps.has(n.split('/').filter(Boolean)[0] || '')) return m
    for (const root of ctx.roots) { const r = LOWER(normPath(root)); if (n === r || n.startsWith(r + '/') || r.startsWith(n + '/')) return m }
    return q + q
  })
}
function codeNamesRoot(code, ctx) {
  const c = LOWER(stripOtherPaths(code, ctx))
  for (const root of ctx.roots) {
    if (sigHit(c, root)) return root
    for (const sp of rootSpellings(root, ctx.home, ctx.cwd || '')) {
      const re = new RegExp('(^|[\\s"\'`=:;&|(<>,])' + escRe(LOWER(sp)) + (sp.endsWith('/') ? '' : '(?=$|[/\\s"\'`;:&|)<>,])'))
      if (re.test(c)) return root
    }
    // pieces joined at run time — Path(vault) / '.internal' · os.path.join(…, 'notes', '.internal'):
    // the last two folder names next to each other with only a joiner between (not anywhere in the code · r3 K3-6)
    const [a, b] = LOWER(root).split('/').filter(Boolean).slice(-2)
    if (a && b && new RegExp('(^|[^a-z0-9_.-])' + escRe(a) + '/?[\'"`]?\\s*\\)?\\s*[,/+]\\s*\\(?\\s*[\'"`]?/?' + escRe(b) + '(?=$|[^a-z0-9_.-])').test(c)) return root
  }
  return ''
}
const STDOUT_W = /(sys\.(stdout|stderr)|process\.(stdout|stderr)|\$std(out|err)|std(out|err))\.write\w*/g
const CODE_WRITES = {
  script: /(\.write\w*|writefile|appendfile|createwritestream|\bf?open\s*\([^)]{0,300},\s*(mode\s*=\s*)?['"][^'"]{0,8}[wax+>|]|\bsysopen\b|file_put_contents|\b(rm|rmdir|unlink|rename|mkdir|mkdtemp|copyfile|cp|symlink|link|truncate|chmod|chown|utimes)sync\s*\(|\bopen\s*\([^)]{300}|shutil\.|os\.(remove|rename|replace|unlink|mkdir|makedirs|rmdir|removedirs|symlink|link|truncate|chmod|utime)|\.(mkdir|touch|unlink|rename|replace|rmdir|symlink_to|hardlink_to|chmod|rm|cp|copyfile|truncate)\s*\(|fs\.\w*(rm|unlink|rename|mkdir|copy|cp|symlink|truncate|chmod|write|append|utimes)|file\.(write|open|delete|rename)|io\.write|fileutils|\bunlink\s*\(|\brename\s*\(|\bmkdir\s*\()/,
  awk: /(>|\bsystem\s*\(|\|\s*")/,
  osa: /(write|do shell script|make new file|save\b|delete\b|move\b|duplicate\b)/,
  sql: /\b(create|insert|update|delete|drop|alter|replace|vacuum|reindex|attach|pragma)\b/,
}
// code that runs a shell command: like r2, it counts as writing when the code names a root — unless EVERY such call is a command
// spelled out whole in string literals (no %s · {} · $x · #{} · bare name · + · chdir) that this check reads as not writing to a root
// and whose commands it knows («git log -- <root>» · «grep -rn x <root>» pass · «rm -rf %s» % R · system("… $r") · cwd=<root> + echo > f refused)
const RUNS_ANY = /(subprocess|os\.(system|popen|exec\w*|spawn\w*)|\bsystem\s*\(|\bexec\w*\s*\(|spawn|child_process|io\.popen|open3|\bpopen\s*\()/
const RUN_CALL = /(subprocess\.(?:run|call|check_call|check_output|popen|getoutput|getstatusoutput)|os\.(?:system|popen)|\b(?:execsync|execfilesync|spawnsync|system)|io\.popen)\s*\(/gi
const RUN_IMPORTS = /(import\s+(?:[\w.]+\s*,\s*)*subprocess(?:\s*,\s*[\w.]+)*|from\s+subprocess\s+import[^\n;]*|require\s*\(\s*['"](node:)?child_process['"]\s*\))/gi
const ARGV = /(sys\.argv|process\.argv|\bargv\b|deno\.args)/
const CHDIR = /(chdir\s*\()/
const READERS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'stat', 'file', 'du', 'df', 'diff', 'cmp', 'jq', 'yq', 'less', 'more', 'test', '[', 'realpath', 'readlink', 'basename', 'dirname', 'shasum', 'sha256sum', 'md5', 'md5sum', 'echo', 'printf', 'pwd', 'date', 'true', 'false', 'which', 'tree', 'uniq', 'cut', 'tr', 'xxd', 'od', 'strings', 'mdls', 'plutil', 'cd', 'pushd', 'popd'])
// the run-call exception (r5 · 4th review K4-2): only commands that cannot write a file from their arguments.
// READERS minus the ones that can (uniq in out · tree -o · yq -i · plutil -convert · xxd in out · file -C · less -o) ·
// git with a reading subcommand (no --output · -c · -O) · sqlite3 with no writing SQL and no dot command but .schema/.tables/…
const CAN_WRITE = new Set(['uniq', 'tree', 'yq', 'plutil', 'xxd', 'file', 'less', 'more'])
const PURE_READERS = new Set([...READERS].filter((c) => !CAN_WRITE.has(c)))
const GIT_READ = new Set(['log', 'show', 'diff', 'status', 'blame', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'grep', 'shortlog', 'describe', 'rev-list', 'show-ref', 'for-each-ref'])
const SQLITE_DOT = /(^|[\s'"])\.(?!(schema|tables|indexes|indices|headers|mode|width)\b)[a-z]/
function readOnlySeg(seg) {
  const w = seg.split(/\s+/).map((t) => t.replace(/^['"]+|['"]+$/g, ''))
  const cmd = w[0].split('/').pop().toLowerCase()
  if (PURE_READERS.has(cmd)) return !(cmd === 'rg' && /(^|\s)'?--pre\b/.test(seg))
  if (cmd === 'git') {
    if (/(^|\s)'?((-c|--config-env|--open-files-in-pager)\b|-O)|--output\b/.test(seg)) return false
    let i = 1
    while (i < w.length && w[i].startsWith('-')) i += /^(-C|--git-dir|--work-tree|--namespace)$/.test(w[i]) ? 2 : 1
    return GIT_READ.has((w[i] || '').toLowerCase())
  }
  if (cmd === 'sqlite3') { const l = seg.toLowerCase(); return !CODE_WRITES.sql.test(l) && !SQLITE_DOT.test(l) }
  return false
}
function allReadOnly(text) {
  for (let seg of String(text).split(/&&|\|\||[;|&\n]/)) {
    seg = seg.trim()
    for (let g = 0; g < 8; g++) { const s2 = seg.replace(/^'?(command|builtin|env|exec|nohup|time|sudo)'?\s+/, '').replace(/^[A-Za-z_]\w*=\S*\s+/, ''); if (s2 === seg) break; seg = s2 }
    if (!seg) continue
    if (!readOnlySeg(seg)) return false
  }
  return true
}
function callEnd(s, i) {   // s[i] === '(' → index of its matching ')' (quotes with \ escapes · ( [ { nesting) or -1
  let d = 0
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (c === '"' || c === "'" || c === '`') { let k = j + 1; while (k < s.length && s[k] !== c) { if (s[k] === '\\') k++; k++ } if (k >= s.length) return -1; j = k; continue }
    if (c === '(' || c === '[' || c === '{') d++
    else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) return c === ')' ? j : -1 }
  }
  return -1
}
function literalCommand(args) {   // → { text, cwd } when the call's arguments are only string literals (+ keyword flags) · else null
  if (/\$\{?[A-Za-z_]|#\{|@[A-Za-z_]|@\{\[/.test(args)) return null   // interpolation inside a string (JS ${} · perl/ruby/php $x #{} @x)
  const parts = []; let cwd = null; let kw = ''; let i = 0; let glue = false
  while (i < args.length) {
    const c = args[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[,[\](){}]/.test(c)) { glue = false; i++; continue }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1; let v = ''
      while (k < args.length && args[k] !== c) {
        if (args[k] === '\\' && k + 1 < args.length) { if (/[nrtvfabe0-7xuUNc]/.test(args[k + 1])) return null; v += args[k + 1]; k += 2; continue }   // \n \x3e … = not what it reads
        v += args[k]; k++
      }
      if (kw === 'cwd') cwd = v; else if (!kw) { if (glue) parts[parts.length - 1] += v; else parts.push(v) }   // 'a' 'b' = one string
      glue = !kw; kw = ''; i = k + 1; continue
    }
    glue = false
    const m = /^[A-Za-z_]\w*/.exec(args.slice(i, i + 64))
    if (m) {
      const after = args.slice(i + m[0].length, i + m[0].length + 8).match(/^\s*(==?|:)?/)
      if (after[1] === '=' || after[1] === ':') { kw = m[0].toLowerCase(); i += m[0].length + after[0].length; continue }
      if (/^(true|false|none|null|undefined)$/i.test(m[0])) { kw = ''; i += m[0].length; continue }
      if (/^(r|b|u|rb|br)$/i.test(m[0]) && /['"]/.test(args[i + m[0].length] || '')) { i += m[0].length; continue }
      return null   // a bare name, an f-string or a call: the command is built at run time
    }
    if (/[0-9]/.test(c)) { const n = /^[0-9.]+/.exec(args.slice(i))[0]; if (!kw) parts.push(n); kw = ''; i += n.length; continue }
    return null      // + . * etc.: an expression
  }
  const q = (v) => (/^[A-Za-z0-9_.\/:=@%+,-]+$/.test(v) ? v : "'" + v.replace(/'/g, "'\\''") + "'")
  return { text: parts.length > 1 ? parts.map(q).join(' ') : parts.join(''), cwd }   // a list = argv: each element quoted (4th review K4-1)
}
function runsOnlyReaders(code, ctx, depth) {   // → true (every run call is a known non-writing command) · a hit · false
  if (CHDIR.test(LOWER(code))) return false
  const src = String(code)
  let rest = src.replace(RUN_IMPORTS, ' ')
  let n = 0
  for (const m of src.matchAll(RUN_CALL)) {
    const open = m.index + m[0].length - 1
    const end = callEnd(src, open)
    if (end < 0) return false
    const lc = literalCommand(src.slice(open + 1, end))
    if (!lc || !lc.text.trim()) return false
    const h = walk(lc.text, { ...ctx, cwd: lc.cwd ? cdTo(lc.cwd, ctx.cwd) : ctx.cwd, vars: new Map(ctx.vars) }, depth + 1)
    if (h) return h
    if (!allReadOnly(lc.text)) return false
    rest = rest.split(src.slice(m.index, end + 1)).join(' ')
    if (++n > 64) return false
  }
  return n > 0 && !RUNS_ANY.test(LOWER(rest))
}
function codeHit(code, kind, ctx, how, depth = 0, argvRoot = '') {
  const low = LOWER(code).replace(STDOUT_W, '')
  const root = codeNamesRoot(code, ctx) || (argvRoot && ARGV.test(low) ? argvRoot : '')
  if (!root) return null
  if (CODE_WRITES[kind].test(low)) return { root, target: '(code)', how }
  if (kind !== 'script' || !RUNS_ANY.test(low)) return null
  const r = runsOnlyReaders(String(code), ctx, depth)
  if (r && r.root) return { ...r, how: `${how} → a command it runs: ${r.how}` }
  return r === true ? null : { root, target: '(code)', how: how + ' (runs a command this check cannot read, naming the folder)' }
}

// ── command table ─────────────────────────────────────────────────────────────────────────────────────────────────
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const SCRIPTS = { python: 'script', python3: 'script', pythonw: 'script', node: 'script', deno: 'script', bun: 'script', ruby: 'script', perl: 'script', php: 'script', osascript: 'osa', awk: 'awk', gawk: 'awk', mawk: 'awk', nawk: 'awk' }
const CODE_FLAG = { python: ['-c'], python3: ['-c'], pythonw: ['-c'], node: ['-e', '--eval', '-p', '--print'], deno: ['eval'], bun: ['-e', '--eval'], ruby: ['-e'], perl: ['-e', '-E'], php: ['-r'], osascript: ['-e'] }
const ALL_TARGETS = new Set(['tee', 'touch', 'mkdir', 'truncate', 'mkfifo', 'mknod', 'ed', 'ex', 'sponge'])
const DESTROY = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash'])
const TO_DEST = new Set(['cp', 'gcp', 'ln', 'gln', 'install', 'ginstall', 'rsync', 'ditto', 'scp'])
const CONTENTS = new Set(['cp', 'gcp', 'rsync', 'ditto', 'scp'])
const GZIP = new Set(['gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'zstd', 'unzstd', 'lz4', 'compress', 'uncompress'])
const VALUE_OPTS = {
  touch: ['-r', '-t', '-d', '-A'], install: ['-m', '-o', '-g', '-B', '-f'], mkdir: ['-m'], cp: ['-S'], mv: ['-S'], ln: ['-S'],
  truncate: ['-s', '-r'], tee: [], rsync: ['-e', '--rsh', '--exclude', '--include', '--filter', '-f', '--files-from', '--exclude-from', '--include-from', '--rsync-path', '--log-file'],
  sed: ['-e', '-f', '--expression', '--file'], gsed: ['-e', '-f', '--expression', '--file'], perl: ['-e', '-E', '-M', '-I', '-m'],
  chmod: [], chown: [], chgrp: [], split: ['-b', '-l', '-n', '-a', '-p'], scp: ['-P', '-i', '-o', '-F', '-c', '-l', '-S'],
  sqlite3: ['-cmd', '-init', '-separator', '-newline', '-nullvalue', '-vfs'], zip: ['-x', '-i', '-b', '-t', '-tt'], patch: ['-p', '-F', '-B', '-V', '-z', '-r'],
  python: ['-m', '-W', '-X'], python3: ['-m', '-W', '-X'], node: ['-r', '--require', '--import'],
}
function argsOf(argv, cmd) {   // → { opts: [[flag, value|null]…], non: [word…] } (values only for the flags in VALUE_OPTS)
  const vo = new Set(VALUE_OPTS[cmd] || [])
  const opts = []; const non = []
  let dd = false
  for (let k = 1; k < argv.length; k++) {
    const a = argv[k].str
    if (dd || a === null || !a.startsWith('-') || a === '-') { non.push(argv[k]); continue }
    if (a === '--') { dd = true; continue }
    if (vo.has(a) && k + 1 < argv.length) { opts.push([a, argv[k + 1]]); k++; continue }
    opts.push([a, null])
  }
  return { opts, non }
}
function optVal(argv, names, shortPrefix) {   // -o X · --output X · --output=X · -oX → [word|{str}]
  const out = []
  for (let k = 1; k < argv.length; k++) {
    const a = argv[k].str
    if (a === null) continue
    if (names.includes(a) && k + 1 < argv.length) { out.push(argv[k + 1]); k++; continue }
    for (const n of names) if (n.startsWith('--') && a.startsWith(n + '=')) out.push(synth(a.slice(n.length + 1), argv[k]))
    if (shortPrefix && a.startsWith(shortPrefix) && a.length > shortPrefix.length && !a.startsWith('--')) out.push(synth(a.slice(shortPrefix.length), argv[k]))
  }
  return out
}
const synth = (str, from) => ({ w: { t: 'w', parts: [{ lit: str, q: true }], glob: false, brace: false }, str, from })
const WRAPPERS = { sudo: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-T'], doas: ['-u', '-C'], nohup: [], command: [], builtin: [], exec: ['-a'], time: [], nice: ['-n'], stdbuf: ['-i', '-o', '-e'], timeout: ['-s', '-k', '--signal', '--kill-after'], caffeinate: ['-t', '-w'], xargs: ['-n', '-I', '-L', '-P', '-s', '-d', '-E', '-a', '-J', '-R', '-S'] }
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '{', '}', '!', 'case', 'esac', 'in', 'for', 'select'])
const cdTo = (d, cwd) => (d === null || d === undefined ? null : d.startsWith('/') ? normPath(d) : (cwd ? normPath(cwd + '/' + d) : null))
function repoWide(gctx) {   // a git command that rewrites the whole work tree: the work tree may be any folder from cwd up to (not incl.) home
  if (!gctx.cwd) return null
  const home = gctx.home ? LOWER(normPath(gctx.home)) : '/'
  let d = normPath(gctx.cwd)
  for (let n = 0; n < 32; n++) {
    const ld = LOWER(d)
    if (ld === home || ld === '/') return null
    const h = judgeStr(d, { glob: false }, gctx, 'destroy', '')
    if (h) return d
    if (/\/\.claude\/worktrees\/[^/]+$/i.test(d)) return null   // an isolated worktree is its own work tree
    d = normPath(d + '/..')
  }
  return null
}

function judgeSegment(seg, ctx, depth) {
  // 1 · redirects
  for (const r of seg.redirs) {
    const writes = ['>', '>>', '>|', '&>', '&>>', '<>'].includes(r.op) || (r.op === '>&' && r.target && !/^([0-9]+|-)$/.test(wstr(r.target, ctx) || ''))
    if (writes) { const h = judgeWord(r.target, ctx, 'write', `the redirect ${r.fd}${r.op}`); if (h) return h }
  }
  // 2 · «for NAME in LIST» (the name takes an item that lands in a root, else the first) · assignments · the command and its wrappers
  const w0 = seg.words.length >= 3 ? wstr(seg.words[0], ctx) : null
  if ((w0 === 'for' || w0 === 'select') && wstr(seg.words[2], ctx) === 'in') {
    const name = wstr(seg.words[1], ctx)
    if (name && /^[A-Za-z_]\w*$/.test(name)) {
      let val
      for (const it of seg.words.slice(3)) {
        const r = resolveWord(it, ctx)
        const h = judgeWord(it, ctx, 'destroy', 'for')
        if (h) { val = r.s !== null ? r.s : h.root; break }
        if (val === undefined) val = r.s
      }
      ctx.vars.set(name, val === undefined ? null : val)
    }
    return null
  }
  let k = 0
  while (k < seg.words.length && isAssign(seg.words[k])) k++
  if (k === seg.words.length) { for (const w of seg.words) { const [n, v] = assignOf(w, ctx); ctx.vars.set(n, v) } return null }
  let argv = seg.words.slice(k).map(w => ({ w, str: wstr(w, ctx) }))
  for (let guard = 0; guard < 8 && argv.length; guard++) {
    const name = argv[0].str === null ? '' : argv[0].str.split('/').pop()
    if (KEYWORDS.has(name)) { argv = argv.slice(1); continue }
    if (name === 'env') {
      let j = 1
      while (j < argv.length) {
        const a = argv[j].str || ''
        if (a === '-C' || a === '--chdir') { const d = argv[j + 1] && argv[j + 1].str; ctx.cwd = d ? cdTo(d, ctx.cwd) : null; j += 2; continue }
        if (a === '-u' || a === '--unset' || a === '-S' || a === '-P') { j += 2; continue }
        if (a.startsWith('-') || isAssign(argv[j].w)) { j++; continue }
        break
      }
      argv = argv.slice(j); continue
    }
    if (WRAPPERS[name]) {
      const vo = new Set(WRAPPERS[name]); let j = 1
      while (j < argv.length && (argv[j].str || '').startsWith('-')) { j += vo.has(argv[j].str) ? 2 : 1 }
      if (name === 'timeout' && j < argv.length) j++   // the duration
      argv = argv.slice(j); continue
    }
    break
  }
  if (!argv.length || argv[0].str === null) return null
  const cmd = argv[0].str.split('/').pop().toLowerCase().replace(/^(python3)\.[0-9]+$/, '$1')
  const here = seg.redirs.find(r => (r.op === '<<' || r.op === '<<-') && typeof r.body === 'string')
  const { opts, non } = argsOf(argv, cmd)
  const has = (...f) => opts.some(([o]) => f.includes(o))
  const J = (word, mode, how) => judgeWord(word && word.w ? word.w : word, ctx, mode, how)
  const cwdWord = () => (ctx.cwd ? synth(ctx.cwd, null) : null)
  const firstHit = (words, mode, how) => { for (const a of words) { const h = J(a, mode, how); if (h) return h } return null }

  if (cmd === 'cd' || cmd === 'pushd') {
    const d = non.length ? non[0].str : ctx.home
    ctx.cwd = d && d !== '-' ? cdTo(d, ctx.cwd) : null
    return null
  }
  if (cmd === 'popd') { ctx.cwd = null; return null }
  if (['export', 'declare', 'local', 'typeset', 'readonly'].includes(cmd)) {
    for (const a of argv.slice(1)) if (isAssign(a.w)) { const [n, v] = assignOf(a.w, ctx); ctx.vars.set(n, v) }
    return null
  }
  if (cmd === 'eval') { const t = argv.slice(1).map(a => a.str); return t.includes(null) ? null : walk(t.join(' '), ctx, depth + 1) }
  if (SHELLS.has(cmd)) {
    const ci = argv.findIndex((a, j) => j > 0 && /^-[a-z]*c[a-z]*$/.test(a.str || ''))
    if (ci > 0 && argv[ci + 1]) return argv[ci + 1].str === null ? null : walk(argv[ci + 1].str, { ...ctx, vars: new Map(ctx.vars) }, depth + 1)
    if (here && !non.length) return walk(here.body, { ...ctx, vars: new Map(ctx.vars) }, depth + 1)
    return null   // a script file: its own writes are not seen
  }
  if (SCRIPTS[cmd]) {
    const kind = SCRIPTS[cmd]
    const hits = []
    if (kind === 'awk') {
      const VAL = new Set(['-v', '-F', '-f', '-i', '--include', '-l', '--load', '-E', '--exec'])
      const fileProg = argv.some(a => a.str === '-f' || a.str === '-E' || a.str === '--exec' || /^-f./.test(a.str || ''))
      let inplace = false; let prog = null; const files = []
      for (let j = 1; j < argv.length; j++) {
        const a = argv[j].str
        if (a !== null && VAL.has(a)) { if ((a === '-i' || a === '--include') && /^inplace(\.awk)?$/.test((argv[j + 1] && argv[j + 1].str) || '')) inplace = true; j++; continue }
        if (a !== null && /^(-i|--include=)inplace/.test(a)) { inplace = true; continue }
        if (a !== null && a.startsWith('-') && a !== '-') continue
        if (prog === null && !fileProg) { prog = argv[j]; continue }
        files.push(argv[j])
      }
      if (prog && prog.str !== null) hits.push(codeHit(prog.str, 'awk', ctx, 'awk code', depth))
      if (inplace) { const h = firstHit(files, 'write', `${cmd} -i inplace`); if (h) return h }
    } else {
      const flags = CODE_FLAG[cmd] || []
      const argvRootOf = words => { for (const a of words) { if ((a.str || '').startsWith('-') && a.str !== '-') continue; const h = J(a, 'write', 'argv'); if (h) return h.root } return '' }
      for (let j = 1; j < argv.length; j++) {
        if (!flags.includes(argv[j].str) || !argv[j + 1] || argv[j + 1].str === null) continue
        hits.push(codeHit(argv[j + 1].str, kind, ctx, `${cmd} ${argv[j].str} code`, depth, argvRootOf(argv.slice(j + 2))))
        break
      }
      const scriptArg = non.find(a => a.str !== '-')
      const dash = non.findIndex(a => a.str === '-')
      if (here && (!scriptArg || dash >= 0)) hits.push(codeHit(here.body, kind, ctx, `${cmd} code on stdin (heredoc)`, depth, dash >= 0 ? argvRootOf(non.slice(dash + 1)) : ''))
    }
    if (cmd === 'perl' && opts.some(([o]) => /^-[a-zA-Z]*i/.test(o))) { const h = firstHit(non, 'write', 'perl -i'); if (h) return h }
    return hits.find(Boolean) || null
  }
  if (ALL_TARGETS.has(cmd)) return firstHit(non, 'write', cmd)
  if (DESTROY.has(cmd)) return firstHit(non, 'destroy', cmd)
  if (cmd === 'mv' || TO_DEST.has(cmd)) {
    const t = optVal(argv, ['-t', '--target-directory'], '')
    if (cmd === 'install' && has('-d')) return firstHit(non, 'write', 'install -d')
    const dest = t.length ? t[0] : (non.length >= 2 ? non[non.length - 1] : null)
    const srcs = t.length ? non : non.slice(0, -1)
    if (dest && !(cmd === 'scp' && /^[^/]*:/.test(dest.str || ''))) {
      const h = J(dest, 'write', `${cmd} (destination)`); if (h) return h
      // into a folder above a root: what lands there = the source's name, or (src/ · src/. · ditto) its contents
      if (dest.str !== null && cmd !== 'install') {
        for (const a of srcs) {
          if (a.str === null) continue
          if (CONTENTS.has(cmd) && (cmd === 'ditto' || a.str === '.' || /\/\.?$/.test(a.str))) { const h2 = J(dest, 'destroy', `${cmd} (a folder's contents into a folder above the root)`); if (h2) return h2; continue }
          const base = a.str.replace(/\/+\.?$/, '').split('/').pop()
          if (!base || base === '.' || base === '..') continue
          const h3 = judgeStr(dest.str.replace(/\/+$/, '') + '/' + base, { glob: !!(a.w && a.w.glob) }, ctx, 'destroy', `${cmd} (into a folder above the root)`)
          if (h3) return h3
        }
      }
    }
    if (cmd === 'mv' || (cmd === 'rsync' && has('--remove-source-files'))) return firstHit(srcs, 'destroy', `${cmd} (source moved away)`)
    return null
  }
  if (cmd === 'dd') { for (const a of argv.slice(1)) if ((a.str || '').startsWith('of=')) { const h = J(synth(a.str.slice(3), a), 'write', 'dd of='); if (h) return h } return null }
  if (cmd === 'sed' || cmd === 'gsed') {
    if (!opts.some(([o]) => /^-[a-zA-Z]*i/.test(o) || o.startsWith('--in-place'))) return null
    return firstHit(non, 'write', `${cmd} -i`)
  }
  if (cmd === 'sort') { for (const v of optVal(argv, ['-o', '--output'], '-o')) { const h = J(v, 'write', 'sort -o'); if (h) return h } return null }
  if (cmd === 'curl') {
    for (const v of optVal(argv, ['-o', '--output', '-c', '--cookie-jar', '-D', '--dump-header', '--output-dir', '--trace', '--trace-ascii', '--stderr'], '-o')) { const h = J(v, 'write', 'curl writes'); if (h) return h }
    if (has('-O', '--remote-name', '--remote-name-all', '-J')) { const h = J(cwdWord(), 'write', 'curl -O (into the working folder)'); if (h) return h }
    return null
  }
  if (cmd === 'wget') {
    const o = optVal(argv, ['-O', '--output-document', '-o', '--output-file', '-a', '--append-output', '-P', '--directory-prefix'], '-O')
    for (const v of o) { const h = J(v, 'write', 'wget writes'); if (h) return h }
    if (!optVal(argv, ['-O', '--output-document', '-P', '--directory-prefix'], '-O').length) { const h = J(cwdWord(), 'write', 'wget (into the working folder)'); if (h) return h }
    return null
  }
  if (cmd === 'tar' || cmd === 'bsdtar' || cmd === 'gtar') {
    const first = argv[1] && argv[1].str ? argv[1].str : ''
    const bundle = first && !first.startsWith('-') ? first : ''
    const flags = argv.slice(1).map(a => a.str || '').filter(a => /^-[a-zA-Z]+$/.test(a)).join('')
    const all = bundle + flags
    const extract = /x/.test(all) || has('--extract', '--get')
    const create = /[cruA]/.test(all.replace(/[^a-zA-Z]/g, '')) || has('--create', '--append', '--update')
    if (extract) {
      const d = optVal(argv, ['-C', '--directory'], '')
      const h = d.length ? J(d[0], 'destroy', 'tar -x -C') : J(cwdWord(), 'destroy', 'tar -x (into the working folder)')
      if (h) return h
    }
    if (create) {
      let f = optVal(argv, ['-f', '--file'], '')
      if (!f.length && /f/.test(bundle) && argv[2]) f = [argv[2]]
      if (!f.length) { const k2 = argv.findIndex(a => /^-[a-zA-Z]*f$/.test(a.str || '')); if (k2 > 0 && argv[k2 + 1]) f = [argv[k2 + 1]] }
      for (const v of f) { const h = J(v, 'write', 'tar (archive file)'); if (h) return h }
    }
    return null
  }
  if (cmd === 'unzip') {
    if (has('-l', '-t', '-p', '-Z', '-v')) return null
    const d = optVal(argv, ['-d'], '')
    return d.length ? J(d[0], 'destroy', 'unzip -d') : J(cwdWord(), 'destroy', 'unzip (into the working folder)')
  }
  if (cmd === 'zip') return non.length ? J(non[0], 'write', 'zip (archive file)') : null
  if (GZIP.has(cmd)) {
    if (opts.some(([o]) => !o.startsWith('--') && /^-[a-zA-Z0-9]*[clt]/.test(o)) || has('--stdout', '--to-stdout', '--list', '--test')) return null
    return firstHit(non, 'write', `${cmd} (in place)`)
  }
  if (cmd === 'chmod' || cmd === 'chown' || cmd === 'chgrp' || cmd === 'chflags') return firstHit(non.slice(1), 'write', cmd)
  if (cmd === 'xattr' || cmd === 'setfile') return non.length && opts.length ? J(non[non.length - 1], 'write', cmd) : null
  if (cmd === 'mktemp') return firstHit([...optVal(argv, ['-p', '--tmpdir'], ''), ...non], 'write', 'mktemp')
  if (cmd === 'split' || cmd === 'csplit') return non.length >= 2 ? J(non[non.length - 1], 'write', `${cmd} (output prefix)`) : null
  if (cmd === 'patch') {
    for (const v of optVal(argv, ['-o', '--output'], '-o')) { const h = J(v, 'write', 'patch -o'); if (h) return h }
    const d = optVal(argv, ['-d', '--directory'], '')
    if (d.length) { const h = J(d[0], 'destroy', 'patch -d'); if (h) return h }
    return non.length ? J(non[0], 'write', 'patch') : J(cwdWord(), 'destroy', 'patch (any file below the working folder)')
  }
  if (cmd === 'sqlite3') {
    if (has('-readonly')) return null
    const db = non[0]; const sql = non[1] ? non[1].str : (here ? here.body : null)
    if (!db) return null
    if (sql !== null && sql !== undefined && !CODE_WRITES.sql.test(LOWER(sql))) return null
    return J(db, 'write', 'sqlite3 (a writing statement)')
  }
  if (cmd === 'find') {
    const starts = []
    let j = 1
    while (j < argv.length && !/^[-(!]/.test(argv[j].str || '-')) starts.push(argv[j++])
    const rest = argv.slice(j).map(a => a.str || '')
    for (const f of ['-fprint', '-fprint0', '-fprintf', '-fls']) { const fi = rest.indexOf(f); if (fi >= 0 && argv[j + fi + 1]) { const h = J(argv[j + fi + 1], 'write', `find ${f}`); if (h) return h } }
    let writes = rest.includes('-delete')
    for (const e of ['-exec', '-execdir', '-ok', '-okdir']) {
      const ei = rest.indexOf(e)
      if (ei >= 0 && rest[ei + 1]) { const x = rest[ei + 1].split('/').pop(); if (DESTROY.has(x) || ALL_TARGETS.has(x) || TO_DEST.has(x) || x === 'mv' || GZIP.has(x) || ((x === 'sed' || x === 'gsed' || x === 'perl') && rest.slice(ei + 2).some(a => /^-[a-zA-Z]*i/.test(a)))) writes = true }
    }
    if (!writes) return null
    return firstHit(starts.length ? starts : [cwdWord()], 'destroy', 'find (-delete or -exec that writes)')
  }
  if (cmd === 'git') {
    const gctx = { ...ctx }
    let j = 1
    while (j < argv.length && (argv[j].str || '').startsWith('-')) {
      const a = argv[j].str
      if (a === '-C' && argv[j + 1]) { gctx.cwd = cdTo(argv[j + 1].str, gctx.cwd); j += 2; continue }
      if (a === '--work-tree' && argv[j + 1]) { gctx.cwd = cdTo(argv[j + 1].str, gctx.cwd); j += 2; continue }
      if (a === '-c' || a === '--git-dir' || a === '--namespace') { j += 2; continue }
      if (a.startsWith('--work-tree=')) gctx.cwd = cdTo(a.slice(12), gctx.cwd)
      j++
    }
    const sub = argv[j] ? argv[j].str : ''
    const rest = argv.slice(j + 1)
    const flag = (...f) => rest.some(a => f.includes(a.str))
    const dd = rest.findIndex(a => a.str === '--')
    const after = dd >= 0 ? rest.slice(dd + 1) : []
    const nonopt = rest.filter((a, q) => (dd < 0 || q < dd) && a.str !== null && !a.str.startsWith('-'))
    let paths = []
    if (sub === 'reset' || sub === 'stash') {   // the whole work tree
      if (sub === 'reset' && !flag('--hard', '--merge', '--keep')) return null
      if (sub === 'stash' && ['list', 'show', 'drop', 'clear', 'create', 'store', 'branch'].includes(nonopt[0] && nonopt[0].str)) return null
      const top = repoWide(gctx)
      return top ? { root: judgeStr(top, { glob: false }, gctx, 'destroy', '').root, target: top, how: `git ${sub}${sub === 'reset' ? ' --hard' : ''} (rewrites the work tree, a folder above the root)` } : null
    }
    if (sub === 'restore' && flag('--staged', '-S') && !rest.some(a => a.str === '--worktree' || /^-[a-zA-Z]*W/.test(a.str || ''))) return null   // the index only
    if (sub === 'rm' && flag('--cached')) return null
    if (sub === 'checkout') paths = dd >= 0 ? after : nonopt   // «git checkout REV PATH» · «git checkout .»
    else if (sub === 'restore' || sub === 'rm' || sub === 'mv' || sub === 'clean' || sub === 'checkout-index') paths = dd >= 0 ? [...nonopt, ...after] : nonopt
    else return null
    if (sub === 'clean' && rest.some(a => a.str === '-n' || a.str === '--dry-run')) return null
    if (sub === 'clean' && !paths.length && gctx.cwd) paths = [synth(gctx.cwd, null)]
    for (const p of paths) { const h = judgeWord(p.w, gctx, 'destroy', `git ${sub}`); if (h) return h }   // «git checkout -- .» rewrites every file below
    return null
  }
  return null
}

function walk(src, ctx, depth) {
  if (depth > 4) return tailHit(String(src), ctx, 'a command nested deeper than this check reads')
  const subs = []
  const segs = segments(lexBash(src, subs))
  for (const seg of segs) { const h = judgeSegment(seg, ctx, depth); if (h) return h }
  for (const t of subs) { const h = walk(t, { ...ctx, vars: new Map(ctx.vars) }, depth + 1); if (h) return h }
  return null
}

// → { root, target, how } | null. Never throws: an unreadable command that still names a root's last two folders = a hit.
export function bashWriteHit(command, writeRoots, home = '', cwd = '') {
  const c = String(command || '')
  if (!c.trim() || !writeRoots || !writeRoots.length) return null
  const ctx = { roots: writeRoots, home: String(home || '').replace(/\/+$/, ''), cwd: cwd ? normPath(cwd) : null, vars: new Map() }
  try { return walk(c, ctx, 0) } catch (err) {
    const t = LOWER(c)
    const root = writeRoots.find(r => sigHit(t, r))
    return root ? { root, target: '?', how: 'a command this check could not read, naming the folder' } : null
  }
}
