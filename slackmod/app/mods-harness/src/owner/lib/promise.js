// 주인행 «약속»·«미루는 말» 판정 — 순수 함수(파일·네트워크 0). 볼트 .claude/scripts/promise_gate.py 의 규칙을 그대로 옮김
// (같은 시험 벡터 = tests/promise-vectors.json · 볼트판 `promise_gate.py --vectors` 로 뽑은 사본).
// 근거: 주인 요청(10-25 · 10-26) — 주인께 가는 글의 앞일 약속엔 실제 수리 장치 근거를 붙이고, 일을 뒤로
//       미루는 말은 막는다.
// JS 주의: \b 는 한글을 낱말 글자로 안 봄 → 한글 경계는 (?![가-힣A-Za-z0-9_]) 로 씀 · (?i:…) 대신 대소문자 둘 다 적음.

const TRIGGER_RE = /앞으로|다음\s*부터|다음\s*번(?:에는|엔|부터)|이제\s*부터|재발\s*(?:방지|않|없)|다시는|주의하겠|주의할게|조심하겠|조심할게|명심/g
const NUM = '(?:약\\s*|대략\\s*)?(?:\\d+(?:[.,]\\d+)?|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|몇|며칠|수십|수백|수)'
const UNIT = '(?:분|초|시간|일|주|주일|개월|달|년|해|번|회|건|차례|장|명|곳|단계|칸|봇|개|판)'
const SCHEDULE_RE = new RegExp('앞으로\\s*' + NUM + '\\s*' + UNIT + '|' +
  '앞으로\\s*(?:남은|남았|남을|나아가|나아갈|나아감|나가|나간|당기|숙이|가기|가서|가면|가다|가고|걸어|다가올|다가오|굴러|쏠리|기울|밀려|넘어지|튀어)', 'y')
const QUESTION_RE = /\?\s*$|？\s*$|할까요|할지(?![가-힣A-Za-z0-9_])|할지요|어떻게\s*할|여쭙니다|여쭤요|여쭈어요|정해\s*주|해\s*주세요|해\s*주시면|주실\s*수|알려\s*주|말씀해\s*주|원하시/
const DISCOURSE_RE = /이제\s*부터\s*(?:설명|말씀|보고|정리|요약|보여|소개|짚|풀어|읽어)/y
const QUOTE_RE = /«[^»\n]*»|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』|`[^`\n]*`|'[^'\n]{1,40}'/g
const BARE_WORD_QUOTE_RE = /[«"“‘「『'`]\s*(?:앞으로(?:는)?|다음\s*부터(?:는)?|이제\s*부터|재발\s*방지|다시는|명심|아침에|내일|나중에)\s*[»"”’」』'`]/g
const ATTRIB_RE = /하셨|하신|말씀|라고|이라는|라는|표현|원문|지시|인용|낱말|문구|단어|적으셨|쓰셨/
const MENTION_RE = /[»"”’」』]\s*(?:같은|류의|꼴의?)\s*(?:약속|말|표현|낱말|문장)/
const BASIS_LINE_RE = /^[ \t>*·•-]*\**수리\s*근거\**\s*[:：]\s*(.*)$/gm
const FRACTION_RE = /(?:시험|테스트|검사)\s*(?:결과)?\s*[:：]?\s*(\d{1,4})\s*\/\s*(\d{1,4})(?![\d/])|(?<![\d/])(\d{1,4})\s*\/\s*(\d{1,4})\s*(?=통과|[Pp][Aa][Ss][Ss])/g
const PASS_WORD_RE = /통과|(?<![A-Za-z])[Pp][Aa][Ss][Ss](?:[Ee][Dd])?(?![A-Za-z])/
const SENT_SPLIT_RE = /(?<=[.!?。！？])\s+|\n+/
export const BAD_NAME_RE = /[/\\]|\.(?:md|py|json|sh|html)(?![A-Za-z0-9_])|[a-fA-F0-9]{7,}/

const DEFER_WORD_RE = /(?<![가-힣])(?:내일|낼|모레)\s*(?:아침|오전|오후|저녁|밤)?|(?<![가-힣])아침\s*(?:에|까지|쯤|중|이면)|오전\s*(?:중|에)|나중에|이따(?:가)?|밤\s*사이|밤새(?:워)?|자고\s*(?:나서|일어나|나면)|날\s*밝으면|푹\s*자고|하룻밤/
const FUTURE_RE = /겠|[가-힣]게요|[가-힣]게(?=\s*$|[.!~,])|예정|계획|려고|려\s*합|할\s*것|(?:드립|올립|보냅|정리합|진행합|처리합|이어갑|이어\s*갑|돌립|마무리합|확인합|살펴봅|시작합|끝냅)니다/
const PAST_ONLY_RE = /(?:했|었|았|였|됐|왔|갔|봤|썼)(?:습니다|어요|다|음|고|는데|지만)/g

export function sentences(text) {
  const body = String(text || '').replace(BASIS_LINE_RE, '')
  const out = []
  for (let s of body.split(SENT_SPLIT_RE)) {
    s = (s || '').trim()
    if (!s) continue
    if (ATTRIB_RE.test(s.replace(QUOTE_RE, ' ')) || MENTION_RE.test(s)) s = s.replace(QUOTE_RE, ' ')
    else s = s.replace(BARE_WORD_QUOTE_RE, ' ')
    out.push(s)
  }
  return out
}

function stickyAt(re, s, i) { re.lastIndex = i; return re.test(s) }

export function promiseSentences(text) {
  const hits = []
  for (const sent of sentences(text)) {
    TRIGGER_RE.lastIndex = 0
    let m
    while ((m = TRIGGER_RE.exec(sent))) {
      const word = m[0]
      if (word.startsWith('앞으로') && stickyAt(SCHEDULE_RE, sent, m.index)) continue
      if (word.startsWith('이제') && stickyAt(DISCOURSE_RE, sent, m.index)) continue
      if (QUESTION_RE.test(sent)) continue
      hits.push([word, sent.slice(0, 60)])
      break
    }
  }
  return hits
}

export function deferSentences(text) {
  const hits = []
  for (const sent of sentences(text)) {
    const m = DEFER_WORD_RE.exec(sent)
    if (!m) continue
    const tail = sent.slice(m.index)
    if (!FUTURE_RE.test(tail)) continue
    if (new RegExp(PAST_ONLY_RE.source).test(tail) && !FUTURE_RE.test(tail.replace(PAST_ONLY_RE, ''))) continue
    hits.push([m[0].trim(), sent.slice(0, 60)])
  }
  return hits
}

// registry = { 이름: {file, enabled} } · exists(name,row) = 그 장치 파일이 있나(호출하는 쪽이 판단 — 순수성 유지)
export function checkBasis(text, registry, exists) {
  const lines = []
  BASIS_LINE_RE.lastIndex = 0
  let m
  while ((m = BASIS_LINE_RE.exec(String(text || '')))) lines.push(m[1])
  if (!lines.length) return { ok: false, why: '«수리 근거:» 줄이 없음', names: [] }
  const problems = []
  for (const line of lines) {
    const names = Object.keys(registry).filter(n => line.includes(n)).sort((a, b) => b.length - a.length)
    if (!names.length) { problems.push('근거 줄에 등록된 장치 이름이 없음'); continue }
    const off = names.filter(n => registry[n] && registry[n].enabled === false)
    if (off.length) { problems.push('아직 켜지지 않은 장치: ' + off.join(', ')); continue }
    const missing = names.filter(n => !exists(n, registry[n]))
    if (missing.length) { problems.push('등록 장치의 실제 파일이 없음: ' + missing.join(', ')); continue }
    const fracs = []
    FRACTION_RE.lastIndex = 0
    let f
    while ((f = FRACTION_RE.exec(line))) fracs.push([Number(f[1] || f[3]), Number(f[2] || f[4])])
    if (fracs.some(([a, b]) => b === 0 || a !== b)) { problems.push('시험 결과가 다 통과가 아님(N/N 이어야 함)'); continue }
    if (!fracs.length && !PASS_WORD_RE.test(line)) { problems.push('근거 줄에 시험 결과(N/N 또는 통과)가 없음'); continue }
    return { ok: true, why: '', names }
  }
  return { ok: false, why: problems[0], names: [] }
}

export function cleanRegistry(devices) {
  const out = {}
  for (const [name, row] of Object.entries(devices && typeof devices === 'object' ? devices : {})) {
    if (!row || typeof row !== 'object' || typeof name !== 'string' || !name.trim() || BAD_NAME_RE.test(name)) continue
    out[name.trim()] = row
  }
  return out
}

// → {decision:'allow'|'block', kind:'defer'|'promise'|'', reason, hits, devices}
export function judge(text, registry, exists, ownerLabel = '주인') {
  const deferred = deferSentences(text)
  if (deferred.length) {
    return { decision: 'block', kind: 'defer', hits: deferred, devices: [],
      reason: `발신 차단(미루는 말): ${ownerLabel}께 가는 글에 «${deferred[0][0]}» 로 일을 미루는 문장이 있어요 — «${deferred[0][1]}».\n` +
        '고칠 길 = 미루지 말고 «지금 하는 다음 걸음»으로 바꿔 쓰기(지금 무엇을 돌리고 있고 언제 무엇이 끝나는지). 이 갈래는 «수리 근거:» 줄로 풀리지 않아요.' }
  }
  const hits = promiseSentences(text)
  if (!hits.length) return { decision: 'allow', kind: '', reason: '', hits: [], devices: [] }
  const b = checkBasis(text, registry, exists)
  if (b.ok) return { decision: 'allow', kind: 'promise', reason: 'basis', hits, devices: b.names }
  const known = Object.keys(registry).sort().join(' · ') || '(등록된 장치 없음)'
  return { decision: 'block', kind: 'promise', hits, devices: [],
    reason: `발신 차단(약속 검사): ${ownerLabel}께 가는 글에 «${hits[0][0]}» 꼴 약속이 있는데 ${b.why}.\n` +
      '고치는 길 둘 — ① 실제 장치를 만들어 등록표에 올리고 같은 글에 한 줄: «수리 근거: <장치 이름> · 시험 N/N 통과»  ② 약속을 빼고 지금 한 일·사실만 쓰기.\n' +
      `등록된 장치: ${known}` }
}
