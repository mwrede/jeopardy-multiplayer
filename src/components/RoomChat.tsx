'use client'

import { useEffect, useRef, useState } from 'react'
import { useChat } from '@/hooks/useChat'
import { useUser } from '@/lib/auth'
import { MAX_MESSAGE_LENGTH } from '@/lib/chat'

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/**
 * The standing group chat, embedded in the page rather than floating over it.
 *
 * One room, shared by the home page and Community Play, for the talk that
 * happens AROUND games: who's up for one tonight, what was brutal last night,
 * what the site should do next. The in-game chat is a different thing and
 * stays its own overlay.
 *
 * Renders nothing until supabase-migration-chat.sql has been run — the hook
 * reports the table missing and this backs out rather than showing an empty
 * box people can't type into.
 */
export function RoomChat({ room, prompt }: { room: string; prompt: string }) {
  const { user } = useUser()
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // The name you play under, if this browser has one; otherwise ask once.
  useEffect(() => {
    try { setName(localStorage.getItem('playerName') || '') } catch {}
  }, [])

  const { messages, available, send } = useChat({ room }, user?.id ?? null, name || 'Guest', false)

  // Stick to the newest message, but only if the reader was already at the
  // bottom — nobody wants the list yanked out from under them mid-scroll.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages.length])

  if (!available) return null

  async function submit() {
    const body = draft.trim()
    if (!body || sending || !name.trim()) return
    try { localStorage.setItem('playerName', name.trim()) } catch {}
    setSending(true)
    setDraft('')
    const ok = await send(body)
    if (!ok) setDraft(body)
    setSending(false)
  }

  return (
    <section className="banner !block !px-0 !py-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 border-b border-white/10 px-3 py-2">
        <span className="banner-title text-jeopardy-gold-light">💬 The room</span>
        <span className="banner-sub shrink-0 text-blue-100/60">{prompt}</span>
      </div>

      <div ref={listRef} className="h-[240px] space-y-2 overflow-y-auto overscroll-contain px-3 py-2.5">
        {messages.length === 0 && (
          <p className="py-10 text-center text-[12px] leading-relaxed text-blue-100/60">
            Nobody&apos;s said anything yet. Who&apos;s playing tonight? What should this site do next?
          </p>
        )}
        {messages.map((m) => {
          const mine = (user?.id && m.player_id === user.id) || (!user && m.player_name === name && !!name)
          return (
            <div key={m.id}>
              <span className="text-[10px] uppercase tracking-wider text-blue-100/50">
                <span className={mine ? 'text-jeopardy-gold-light' : 'text-copper'}>{m.player_name}</span> · {clock(m.created_at)}
              </span>
              <p className="text-[13px] leading-snug text-white/90">{m.body}</p>
            </div>
          )
        })}
      </div>

      <div className="flex gap-1.5 border-t border-white/10 p-2">
        {!name && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            className="field-stage h-9 w-[110px] shrink-0 px-2 text-sm"
          />
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
          placeholder={name ? 'Say something…' : 'Add your name, then say something…'}
          maxLength={MAX_MESSAGE_LENGTH}
          className="field-stage h-9 min-w-0 flex-1 px-3 text-sm"
        />
        <button
          onClick={() => void submit()}
          disabled={!draft.trim() || !name.trim() || sending}
          className="btn-stage btn-copper btn-stage-sm shrink-0 px-3 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </section>
  )
}
