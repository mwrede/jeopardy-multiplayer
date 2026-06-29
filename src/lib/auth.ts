'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Profile = { user_id: string; display_name: string }

export async function signUp(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  })
  if (error) throw error

  // Only insert the profile row when we actually have a session. The
  // profiles RLS policy requires auth.uid() = user_id, so this upsert
  // fails if email confirmation is on (no session yet). In that case the
  // row gets created on first sign-in by useUser() instead.
  //
  // CRUCIAL: this insert is non-fatal — if it fails for any reason, we
  // still return success because the auth user is what matters. Otherwise
  // a bad RLS / missing-table state would block all signups.
  if (data.user && data.session) {
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert({ user_id: data.user.id, display_name: displayName })
    if (profileErr) console.warn('[signUp] profile upsert failed (non-fatal):', profileErr.message)
  }
  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Surface a clearer hint for the common cases.
    if (/email not confirmed/i.test(error.message)) {
      throw new Error('Your email isn\'t confirmed yet. Check your inbox for the confirmation link, then sign in.')
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

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const u = data.session?.user ?? null
      setUser(u)
      if (u) {
        getProfile(u.id).then((p) => {
          if (cancelled) return
          // If profile row is missing (e.g. created before profiles table), seed it from auth metadata.
          if (!p) {
            const name = (u.user_metadata?.display_name as string) || u.email?.split('@')[0] || 'Player'
            upsertProfile(u.id, name).then(() => getProfile(u.id).then(setProfile)).catch(() => {})
          } else {
            setProfile(p)
          }
        })
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null
      setUser(u)
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
