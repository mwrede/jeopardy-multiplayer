'use client'

import { useEffect, useRef, useState } from 'react'
import { useUser } from '@/lib/auth'
import { getChallengeIdentity } from '@/lib/challenge'
import { feedbackMailto, FEEDBACK_EMAIL, sendFeedback, type FeedbackMode } from '@/lib/feedback'

const SNOOZE_KEY = 'feedback:snoozed-until'
const SENT_KEY = 'feedback:last-sent'
const DAY = 86_400_000

/**
 * The ask at the end of a game, as a pop-up. One person made this and wants
 * to know what to fix, and the moment a game ends is when a player knows.
 *
 * The close button is a small joke: the first tap sends it scurrying to the
 * other corner, three seconds later the card says "just kidding" and lets
 * itself out. A second tap on the moved X closes it at once, and so does
 * Escape — the joke is a beat, not a trap. Closing rests the ask for two
 * days, a sent note for a week; after that it's a one-line link.
 */
export function FeedbackPrompt({ mode, playerName }: { mode: FeedbackMode; playerName?: string | null }) {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  // The X: where it is, and whether the joke has played out.
  const [dodged, setDodged] = useState(false)
  const [kidding, setKidding] = useState(false)
  const [dx, setDx] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    try {
      const snoozed = Number(localStorage.getItem(SNOOZE_KEY) || 0)
      const sent = Number(localStorage.getItem(SENT_KEY) || 0)
      setOpen(Date.now() > snoozed && Date.now() - sent > 7 * DAY)
    } catch {
      setOpen(true)
    }
    return () => { timers.current.forEach(clearTimeout) }
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function rest(ms: number) {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms)) } catch {}
  }

  function close() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    rest(2 * DAY)
    setOpen(false)
    setDodged(false)
    setKidding(false)
    setDx(0)
  }

  function reopen() {
    setState('idle')
    setDodged(false)
    setKidding(false)
    setDx(0)
    setOpen(true)
  }

  /** First tap: the X runs to the far corner. Three seconds on, the card owns up and leaves. */
  function onX() {
    if (dodged) { close(); return }
    const w = cardRef.current?.clientWidth ?? 320
    setDx(w - 32 - 16) // button is 32px, 8px in from each edge
    setDodged(true)
    timers.current.push(setTimeout(() => setKidding(true), 3000))
    timers.current.push(setTimeout(close, 4600))
  }

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
    if (ok) {
      try { localStorage.setItem(SENT_KEY, String(Date.now())) } catch {}
      timers.current.push(setTimeout(() => { setOpen(false) }, 2200))
    }
  }

  if (!open) {
    return (
      <p className="text-center text-[10px] uppercase tracking-[0.2em] text-white/40">
        <button onClick={reopen} className="transition-colors hover:text-copper">
          Tell the designer what to fix
        </button>
      </p>
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div ref={cardRef} className="relative w-full max-w-sm rounded-xl border border-copper/50 bg-[#050b3a] p-4 pt-5 text-left shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
        <button
          onClick={onX}
          aria-label="Close"
          className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/40 text-sm text-white/70 transition-transform duration-300 ease-out hover:text-white"
          style={{ transform: `translateX(${dx}px)` }}
        >
          ✕
        </button>

        {kidding ? (
          <div className="py-6 text-center">
            <p className="text-2xl font-bold text-jeopardy-gold-light">Just kidding.</p>
            <p className="mt-1 text-sm text-white/75">Thanks for playing — go enjoy your night.</p>
          </div>
        ) : state === 'sent' ? (
          <div className="py-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-copper">From the person who made this</p>
            <p className="mt-2 text-sm text-white">Thank you. I read every one of these, and it&apos;s how this gets better.</p>
          </div>
        ) : (
          <>
            <p className="pl-9 text-[10px] font-bold uppercase tracking-[0.24em] text-copper">From the person who made this</p>
            <p className="mt-3 text-sm leading-snug text-white/85">
              I&apos;m one humble game designer trying to make this better, and you just finished a game — so
              right now you know exactly what was fun and what was annoying. What should I fix or add?
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={2000}
              autoFocus
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
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                onClick={submit}
                disabled={!text.trim() || state === 'sending'}
                className="btn-stage btn-copper btn-stage-sm px-5 disabled:opacity-40"
              >
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
              {dodged && !kidding && <span className="text-[11px] text-white/40">…</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
