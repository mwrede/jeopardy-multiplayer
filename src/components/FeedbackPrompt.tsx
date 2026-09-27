'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/auth'
import { getChallengeIdentity } from '@/lib/challenge'
import { feedbackMailto, FEEDBACK_EMAIL, sendFeedback, type FeedbackMode } from '@/lib/feedback'

const SNOOZE_KEY = 'feedback:snoozed-until'
const SENT_KEY = 'feedback:last-sent'
const DAY = 86_400_000

/**
 * The ask at the end of a game. One person made this and wants to know what
 * to fix, and the moment a game ends is when a player knows. Shown as a
 * card the first time; "Not now" rests it for two days and a sent note rests
 * it for a week, after which it's a one-line link — the ask shouldn't be the
 * thing that gets annoying.
 */
export function FeedbackPrompt({ mode, playerName }: { mode: FeedbackMode; playerName?: string | null }) {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  useEffect(() => {
    try {
      const snoozed = Number(localStorage.getItem(SNOOZE_KEY) || 0)
      const sent = Number(localStorage.getItem(SENT_KEY) || 0)
      setOpen(Date.now() > snoozed && Date.now() - sent > 7 * DAY)
    } catch {
      setOpen(true)
    }
  }, [])

  async function submit() {
    const message = text.trim()
    if (!message || state === 'sending') return
    setState('sending')
    const ok = await sendFeedback({
      mode,
      message,
      contact: contact || user?.email || null,
      name: playerName || null,
      identity: getChallengeIdentity(user?.id),
      page: typeof location !== 'undefined' ? location.pathname : null,
    })
    setState(ok ? 'sent' : 'failed')
    if (ok) { try { localStorage.setItem(SENT_KEY, String(Date.now())) } catch {} }
  }

  function later() {
    setOpen(false)
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 2 * DAY)) } catch {}
  }

  if (!open) {
    return (
      <p className="text-center text-[10px] uppercase tracking-[0.2em] text-white/40">
        <button onClick={() => setOpen(true)} className="transition-colors hover:text-copper">
          Tell the designer what to fix
        </button>
      </p>
    )
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-copper/50 bg-black/40 p-4 text-left">
      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-copper">From the person who made this</p>
      {state === 'sent' ? (
        <p className="mt-2 text-sm text-white">
          Thank you. I read every one of these, and it&apos;s how this gets better.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-snug text-white/85">
            I&apos;m one humble game designer trying to make this better, and you just finished a game — so
            right now you know exactly what was fun and what was annoying. What should I fix or add?
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Anything — a clue graded wrong, a screen that confused you, a mode you wish existed…"
            className="mt-3 w-full resize-none rounded-md border border-white/15 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-copper/70 focus:outline-none"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={200}
            placeholder={user?.email ? `Reply to ${user.email} (or type another)` : 'Email, if you’d like a reply (optional)'}
            className="mt-2 w-full rounded-md border border-white/15 bg-black/50 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:border-copper/70 focus:outline-none"
          />
          {state === 'failed' && (
            <p className="mt-2 text-xs text-red-300">
              Couldn&apos;t send just now —{' '}
              <a href={feedbackMailto(mode, text)} className="underline hover:text-white">email it to {FEEDBACK_EMAIL}</a> instead.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={submit}
              disabled={!text.trim() || state === 'sending'}
              className="btn-stage btn-copper btn-stage-sm px-4 disabled:opacity-40"
            >
              {state === 'sending' ? 'Sending…' : 'Send'}
            </button>
            <button onClick={later} className="btn-stage btn-stage-ghost btn-stage-sm px-3">Not now</button>
          </div>
        </>
      )}
    </div>
  )
}
