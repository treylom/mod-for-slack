// lane: ui · owner: 봇 — pure XML property-list reader (no `$`, no imports).
// Reads the subset launchd plists use: dict · array · string · integer · real · true · false · date · data.
// Binary plists start with "bplist00"; isBinaryPlist() lets the caller convert those with `plutil` instead.

export function isBinaryPlist(text) {
  return typeof text === 'string' && text.startsWith('bplist')
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" }
function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (m) => ENTITIES[m])
}

// Tokenizer: yields { kind: 'open'|'close'|'empty', name } and { kind: 'text', value }.
function tokenize(xml) {
  const out = []
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<(\/?)([A-Za-z_][\w.-]*)([^>]*?)(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(xml)) !== null) {
    if (m[2]) {
      if (m[1]) out.push({ kind: 'close', name: m[2] })
      else if (m[4] === '/') out.push({ kind: 'empty', name: m[2] })
      else out.push({ kind: 'open', name: m[2] })
    } else if (m[5] !== undefined) {
      out.push({ kind: 'text', value: m[5] })
    }
  }
  return out
}

// Parse a plist XML document → JS value (the top-level object), or throw on malformed input.
export function parsePlistXml(xml) {
  if (typeof xml !== 'string') throw new Error('plist: not text')
  const toks = tokenize(xml)
  let i = 0
  const skipWs = () => { while (i < toks.length && toks[i].kind === 'text' && !toks[i].value.trim()) i++ }
  const textUntilClose = (name) => {
    let s = ''
    while (i < toks.length && toks[i].kind === 'text') { s += toks[i].value; i++ }
    if (!toks[i] || toks[i].kind !== 'close' || toks[i].name !== name) throw new Error('plist: unclosed <' + name + '>')
    i++
    return unescapeXml(s)
  }
  const value = () => {
    skipWs()
    const t = toks[i]
    if (!t) throw new Error('plist: unexpected end')
    if (t.kind === 'empty') {
      i++
      if (t.name === 'true') return true
      if (t.name === 'false') return false
      if (t.name === 'string') return ''
      if (t.name === 'dict') return {}
      if (t.name === 'array') return []
      throw new Error('plist: unexpected <' + t.name + '/>')
    }
    if (t.kind !== 'open') throw new Error('plist: expected a value')
    i++
    switch (t.name) {
      case 'dict': {
        const obj = {}
        for (;;) {
          skipWs()
          const k = toks[i]
          if (!k) throw new Error('plist: unclosed <dict>')
          if (k.kind === 'close' && k.name === 'dict') { i++; return obj }
          if (k.kind === 'empty' && k.name === 'key') { i++; obj[''] = value(); continue }
          if (k.kind !== 'open' || k.name !== 'key') throw new Error('plist: expected <key>')
          i++
          const key = textUntilClose('key')
          obj[key] = value()
        }
      }
      case 'array': {
        const arr = []
        for (;;) {
          skipWs()
          const k = toks[i]
          if (!k) throw new Error('plist: unclosed <array>')
          if (k.kind === 'close' && k.name === 'array') { i++; return arr }
          arr.push(value())
        }
      }
      case 'string': return textUntilClose('string')
      case 'integer': {
        const s = textUntilClose('integer').trim()
        if (!/^[+-]?\d+$/.test(s)) throw new Error('plist: bad integer')
        return Number(s)
      }
      case 'real': {
        const n = Number(textUntilClose('real').trim())
        if (Number.isNaN(n)) throw new Error('plist: bad real')
        return n
      }
      case 'date': return textUntilClose('date').trim()
      case 'data': return textUntilClose('data').replace(/\s+/g, '')
      case 'plist': {
        const v = value()
        skipWs()
        if (!toks[i] || toks[i].kind !== 'close' || toks[i].name !== 'plist') throw new Error('plist: unclosed <plist>')
        i++
        return v
      }
      default: throw new Error('plist: unknown <' + t.name + '>')
    }
  }
  skipWs()
  const top = value()
  return top
}
