import { supabase } from '@/lib/supabase'

/** Which game the note is about. */
export type FeedbackMode = 'party' | 'multiplayer' | 'community' | 'challenge' | 'campaign' | 'other'

export const FEEDBACK_EMAIL = 'canyoureallywinj@gmail.com'

/**
 * Leave a note for the person who made this. True if it landed. False when
 * it didn't — most likely supabase-migration-feedback.sql hasn't been run —
 * so the card can offer email instead of losing what they wrote.
 */
export async function sendFeedback(f: {
  mode: FeedbackMode
  message: string
  contact?: string | null
  name?: string | null
  identity?: string | null
  page?: string | null
}): Promise<boolean> {
  const message = f.message.trim().slice(0, 2000)
  if (!message) return false
  const { error } = await supabase.from('feedback').insert({
    mode: f.mode,
    message,
    contact: f.contact?.trim().slice(0, 200) || null,
    player_name: f.name?.trim().slice(0, 60) || null,
    identity_key: f.identity || null,
    page: f.page || null,
  })
  if (error) {
    console.warn('[feedback] send failed:', error.message)
    return false
  }
  return true
}

/** A mailto with the note already in the body, for when the table isn't there. */
export function feedbackMailto(mode: FeedbackMode, message: string): string {
  const subject = encodeURIComponent(`Jeopardy — feedback after a ${mode} game`)
  const body = encodeURIComponent(message)
  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`
}
