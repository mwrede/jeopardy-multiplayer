'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Profile = { user_id: string; display_name: string }

/**
 * Google is the only way in. Email/password was a second identity to remember
 * for an app that otherwise needs no account at all — signing in exists here
 * only so your boards follow you between devices.
 *
 * Requires the Google provider to be enabled in Supabase
 * (Authentication → Providers → Google) with a Google Cloud OAuth client.
 */
export async function signInWithGoogle(next?: string) {
  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${next && next.startsWith('/') ? next : '/'}`
      : undefined

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw error
}

/**
 * Guest sign-in. Creates a real Supabase user with its own id — no email, no
 * password — so a guest can be ranked and told apart from other players like
 * anyone else.
 *
 * Each browser gets a distinct guest, which makes it the practical way to test
 * a three-player game without three Google accounts: one normal window plus
 * two private ones.
 *
 * The account lives in that browser only. Clear site data and it's gone,
 * along with anything it won — that's the trade for not signing up.
 *
 * Requires Anonymous sign-ins to be enabled in Supabase
 * (Authentication → Providers → Anonymous sign-ins).
 */
export async function signInAsGuest() {
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) {
    if (/disabled|not enabled/i.test(error.message)) {
      throw new Error(
        'Guest play is off. Enable Anonymous sign-ins in Supabase under ' +
        'Authentication → Providers.',
      )
    }
    throw error
  }
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as Profile | null) ?? null
}

export async function upsertProfile(userId: string, displayName: string) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: displayName, updated_at: new Date().toISOString() })
  if (error) {
    // Non-fatal — the auth metadata still has the display name so the app
    // works even if the profiles row can't be written (RLS race on first
    // sign-in, missing table, etc.).
    console.warn('[upsertProfile] failed (non-fatal):', error.message)
  }
}

/**
 * Hook: current Supabase user + cached profile. Re-renders on auth changes.
 * `loading` is true while the initial session is being resolved.
 */
export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    // .catch is essential: without it a rejected getSession leaves `loading`
    // true forever, and the profile menu renders as a dead grey circle with no
    // way to sign in or out.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const u = data.session?.user ?? null
      setUser(u)
      if (u) {
        getProfile(u.id).then((p) => {
          if (cancelled) return
          // If profile row is missing (e.g. created before profiles table), seed it from auth metadata.
          if (!p) {
            const meta = u.user_metadata ?? {}
            const name =
              (meta.display_name as string) ||
              (meta.full_name as string) ||
              (meta.name as string) ||
              u.email?.split('@')[0] ||
              'Player'
            upsertProfile(u.id, name).then(() => getProfile(u.id).then(setProfile)).catch(() => {})
          } else {
            setProfile(p)
          }
        })
      }
      setLoading(false)
    }).catch((e) => {
      console.warn('[useUser] getSession failed:', e)
      if (!cancelled) { setUser(null); setLoading(false) }
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) {
        const p = await getProfile(u.id)
        setProfile(p)
      } else {
        setProfile(null)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return { user, profile, loading }
}
