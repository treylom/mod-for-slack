// PluginState declarations for mods-harness ($.state keys). One file for the whole mod (manifest `types`).
// Shared file: each lane edits ONLY its own section below and runs `claude plugin validate` before committing.
declare module 'claude-code' {
  interface PluginState {
    'mods-harness': {
      // ── session lane (src/session/) ──
      // This session's registry id when it differs from $.session.id() (child launched with a preset id).
      'mh.registryId': string | null

      // ── ui lane (src/ui/) ──
      // Per-session running totals for 01-spec G7 (one task = thread received → last reply). null until first turn.
      'mh.usage': {
        tokens_in: number | null
        tokens_out: number | null
        cache_read: number | null
        cache_write: number | null
        model_calls: number | null
        wall_ms: number | null
      } | null

      // 10-20 패널 ✕: the order a confirmed 닫기 press on the panel writes as the press goes through; the session lane takes it
      // (reads, then sets null) right after the same press (session/core.js panelOrderCheck). close = those 하위 ids ·
      // hide = take the project off the list (ids empty). at = $.clock.now() of the press · by = the panel's registry id.
      'mh.panelOrder': {
        v: 1
        kind: 'close' | 'hide'
        project: string
        ids: string[]
        at: number
        by: string | null
      } | null

      // ── session lane → ui lane (K3 · 10-21) ──
      // Thread messages that fell to this session although a child was on that thread (two or more · none ready · not
      // delivered · a dispatch error) since this process started; reason = the last one. null until the first.
      'mh.dispatch': {
        failed: number
        at: number
        reason: 'ambiguous' | 'not-ready' | 'not-delivered' | 'error'
      } | null

      // ── memory lane (src/memory/) ──
      // The last recall (봇 ◎ 기억 button reads it; the memory lane writes it after every recall). null until then.
      // state = the five recallStats() values · no error text here (recallStats() keeps that).
      'mh.recall': {
        at: number
        state: 'none' | 'attached' | 'empty' | 'not-connected' | 'error'
        conversations: number
        facts: number
        chars: number
        ms: number
        lines: number
      } | null
    }
  }
}
