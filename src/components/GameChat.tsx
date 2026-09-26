'use client'

import { useEffect, useRef, useState } from 'react'
import { useChat } from '@/hooks/useChat'
import { MAX_MESSAGE_LENGTH } from '@/lib/chat'

/** hh:mm, local. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/**
 * Chat for a game, as a thing that gets out of the way.
 *
 * An OVERLAY, not a modal. It has no backdrop and never covers the board or
 * the buzzer: the game carries on underneath and stays fully playable with the
 * chat open, which is the point — people want to talk WHILE they play, not
 * instead of it. It docks to a top corner and stays narrow so the buzzer, which
 * nothing may compete with, keeps the middle of the phone to itself.
 *
 * Closed, it's a pill one line high, and a new message peeks out beside it for
 * a few seconds before leaving on its own.
 *
 * Renders nothing at all until supabase-migration-chat.sql has been run.
 */
export function GameChat({
  gameId,
  myPlayerId,
  myName,
}: {
  gameId: string
  myPlayerId: string | null
  myName: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const { messages, available, unread, latest, send, dismissPeek } = useChat(
    gameId, myPlayerId, myName, !open,
  )

  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Stick to the newest message whenever the panel is open.
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [open, messages.length])

  // Escape closes, wherever focus is.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The peek is a glance, not a notification — it goes by itself.
  useEffect(() => {
    if (!latest) return
    const t = setTimeout(dismissPeek, 5000)
    return () => clearTimeout(t)
  }, [latest, dismissPeek])

  if (!available) return null

  async function submit() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setDraft('')
    const ok = await send(body)
    // Put it back rather than swallowing what someone typed.
    if (!ok) setDraft(body)
    setSending(false)
    inputRef.current?.focus()
  }

  /* No autoFocus on the field. Opening the chat should show the conversation,
     not throw a phone keyboard up over the buzzer — typing is a second,
     deliberate tap. */

  return (
    <>
      {/* ── Closed: a pill, plus a peek at anything new ─────────────────── */}
      {!open && (
        <div className="pointer-events-none fixed right-2 top-2 z-40 flex flex-col items-end gap-1.5">
          <button
            onClick={() => setOpen(true)}
            aria-label={unread > 0 ? `Open chat, ${unread} unread` : 'Open chat'}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/20 bg-black/70 px-3 py-1.5 text-xs font-bold text-white/80 backdrop-blur transition-colors hover:border-copper hover:text-white"
          >
            <span aria-hidden>💬</span>
            {unread > 0 && (
              <span className="rounded-full bg-copper px-1.5 py-0.5 text-[10px] font-black leading-none text-black">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {latest && (
            <button
              onClick={() => setOpen(true)}
              className="pointer-events-auto max-w-[220px] animate-[fadeIn_200ms_ease-out] rounded-xl border border-white/15 bg-black/80 px-3 py-2 text-left backdrop-blur"
            >
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-copper">
                {latest.player_name}
              </span>
              <span className="mt-0.5 block line-clamp-2 text-xs text-white/90">{latest.body}</span>
            </button>
          )}
        </div>
      )}

      {/* ── Open: an overlay. No backdrop, so the game underneath keeps
             working — clicks, the board, the buzzer, all of it. ─────────── */}
      {open && (
        <div className="fixed right-2 top-2 z-40 w-[260px] sm:w-[320px]">
          <div className="flex max-h-[58vh] flex-col rounded-xl border border-copper/40 bg-jeopardy-dark/95 shadow-2xl backdrop-blur sm:max-h-[440px]">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-copper">
                💬 Chat
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Hide chat"
                className="-mr-2 px-3 py-1 text-2xl leading-none text-gray-500 transition-colors hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
              {messages.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-500">
                  Nothing yet. Say something.
                </p>
              )}
              {messages.map((m) => {
                const mine = !!myPlayerId && m.player_id === myPlayerId
                return (
                  <div key={m.id} className={mine ? 'text-right' : ''}>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">
                      {mine ? 'You' : m.player_name} · {clock(m.created_at)}
                    </span>
                    <p
                      className={`mt-0.5 inline-block max-w-[85%] break-words rounded-xl px-3 py-1.5 text-sm ${
                        mine
                          ? 'bg-copper/20 text-white'
                          : 'bg-white/10 text-white/90'
                      }`}
                    >
                      {m.body}
                    </p>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>

            <div className="flex shrink-0 gap-1.5 border-t border-white/10 p-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
                placeholder="Say something…"
                maxLength={MAX_MESSAGE_LENGTH}
                className="input-base min-w-0 flex-1 text-sm"
              />
              <button
                onClick={() => void submit()}
                disabled={!draft.trim() || sending}
                className="btn-stage btn-copper btn-stage-sm shrink-0 px-3 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
