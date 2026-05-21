'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Profile = { user_id: string; display_name: string }

export async function signUp(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error) throw error
  // Best-effort: insert profile row immediately so it's available everywhere.
  // If email confirmation is required, the session may be null here — we'll
  // create the row on first sign-in instead.
  if (data.user) {
    await supabase.from('profiles').upsert({ user_id: data.user.id, display_name: displayName })
  }
  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
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
  if (error) throw error
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
