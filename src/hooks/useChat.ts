'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { loadMessages, sendMessage, type ChatMessage } from '@/lib/chat'

/**
 * A room's chat: history, live arrivals, and what you haven't read.
 *
 * Its own realtime channel rather than a binding on the game channel. That
 * channel carries the board, the buzzers and presence — everything the game
 * needs to be correct — and chat is the one part of this app that genuinely
 * doesn't matter. A chat subscription failing must not take the game with it.
 */
export function useChat(
  gameId: string | null | undefined,
  myPlayerId: string | null,
  myName: string,
  /** While true, arrivals are counted as unread. */
  hidden: boolean,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [available, setAvailable] = useState(false)
  const [unread, setUnread] = useState(0)
  /** The latest message from someone else, for the peek shown while hidden. */
  const [latest, setLatest] = useState<ChatMessage | null>(null)

  const hiddenRef = useRef(hidden)
  useEffect(() => { hiddenRef.current = hidden }, [hidden])

  const add = useCallback((m: ChatMessage, mine: boolean) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    if (mine) return
    if (hiddenRef.current) {
      setUnread((n) => n + 1)
      setLatest(m)
    }
  }, [])

  // History
  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    loadMessages(gameId).then((res) => {
      if (cancelled) return
      if (!res.ok) { setAvailable(false); return }
      setAvailable(true)
      setMessages(res.messages)
    })
    return () => { cancelled = true }
  }, [gameId])

  // Live arrivals
  useEffect(() => {
    if (!gameId || !available) return
    const channel = supabase
      .channel(`chat:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const m = payload.new as ChatMessage
          add(m, !!myPlayerId && m.player_id === myPlayerId)
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [gameId, available, myPlayerId, add])

  // Realtime can drop a message during a socket flap, and chat is not worth a
  // reconnect dance — a slow poll while the panel is open closes the gap.
  useEffect(() => {
    if (!gameId || !available || hidden) return
    const t = setInterval(() => {
      loadMessages(gameId).then((res) => { if (res.ok) setMessages(res.messages) })
    }, 6000)
    return () => clearInterval(t)
  }, [gameId, available, hidden])

  useEffect(() => { if (!hidden) { setUnread(0); setLatest(null) } }, [hidden])

  const send = useCallback(
    async (body: string) => {
      if (!gameId) return false
      return sendMessage(gameId, myPlayerId, myName, body)
    },
    [gameId, myPlayerId, myName],
  )

  return { messages, available, unread, latest, send, dismissPeek: () => setLatest(null) }
}
