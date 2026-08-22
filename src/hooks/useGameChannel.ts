'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Game, Player, Category, Clue } from '@/types/game'

interface GameState {
  game: Game | null
  players: Player[]
  categories: Category[]
  clues: Clue[]
  myPlayerId: string | null
}

/**
 * Fetch the complete game state from the DB.
 * This is the single source of truth.
 */
async function fetchFullState(gameId: string) {
  const [gameRes, playersRes, categoriesRes, catIdsRes] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    supabase.from('players').select('*').eq('game_id', gameId).order('join_order'),
    supabase.from('categories').select('*').eq('game_id', gameId).order('position'),
    supabase.from('categories').select('id').eq('game_id', gameId),
  ])

  const catIds = catIdsRes.data?.map((c) => c.id) || []
  let cluesData: Clue[] = []
  if (catIds.length > 0) {
    const { data } = await supabase
      .from('clues')
      .select('id, category_id, value, question, answer, is_daily_double, is_answered, answered_by, answered_correct')
      .in('category_id', catIds)
    cluesData = (data as Clue[]) || []
  }

  return {
    game: gameRes.data as Game,
    players: (playersRes.data as Player[]) || [],
    categories: (categoriesRes.data as Category[]) || [],
    clues: cluesData,
  }
}

/**
 * Core game state hook.
 *
 * Sync strategy (mirrors Jackbox's server-push model):
 * 1. DB is the source of truth (like Jackbox's central server)
 * 2. postgres_changes pushes DB updates to all subscribers automatically
 * 3. Polling every 2s as a fallback to catch anything missed
 * 4. Any client action = just write to DB, the push handles the rest
 */
export function useGameChannel(roomCode: string) {
  const [state, setState] = useState<GameState>({
    game: null,
    players: [],
    categories: [],
    clues: [],
    myPlayerId: null,
  })
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  /**
   * Players with the game open right now, by player id.
   *
   * Realtime Presence, not a database column: a websocket that goes away is
   * the only reliable signal that someone closed the tab. players.is_connected
   * was never trustworthy — it was set true on join and nothing ever set it
   * back, so every player looked present forever.
   *
   * Treat this as a hint rather than a verdict. Backgrounding a phone browser
   * can drop the socket for a few seconds, so presence is used to grey someone
   * out and to shorten the wait before others may act — never to take a turn
   * away the instant it blinks.
   *
   * The set is debounced through lastSeenRef: a player only counts as away
   * after AWAY_AFTER_MS of continuous absence. The raw presence set lies in
   * exactly the case that matters — a phone whose realtime socket is
   * reconnecting still plays fine over REST (the buzzer works, polling keeps
   * the screen fresh), so acting on a momentary blink greys someone who is
   * sitting right there holding a live buzzer.
   */
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  /** playerId -> epoch ms they were last seen in presence (or optimistically seeded). */
  const lastSeenRef = useRef<Map<string, number>>(new Map())
  const gameIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Full refresh from DB.
  // A late-arriving poll can clobber fresher state pushed by realtime, which
  // shows up as "wrong clue flashes for a moment" on the party display. Guard
  // by comparing updated_at — if what we already have is newer, keep it.
  const refreshState = useCallback(async () => {
    const gameId = gameIdRef.current
    if (!gameId) return

    const fullState = await fetchFullState(gameId)
    setState((s) => {
      const localTs = s.game?.updated_at ? new Date(s.game.updated_at).getTime() : 0
      const fetchedTs = fullState.game?.updated_at
        ? new Date(fullState.game.updated_at).getTime()
        : 0
      // Keep the fresher game row; still merge players/clues/categories since
      // those don't have a shared timestamp and are additive/idempotent.
      const game = fetchedTs >= localTs ? fullState.game : s.game
      return {
        ...s,
        ...fullState,
        game,
      }
    })
  }, [])

  // 1. Initial load: find the game by room code
  useEffect(() => {
    const playerId = localStorage.getItem('playerId')
    setState((s) => ({ ...s, myPlayerId: playerId }))

    async function loadState() {
      const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('room_code', roomCode)
        .single()

      if (!game) return

      gameIdRef.current = game.id

      const fullState = await fetchFullState(game.id)
      // Everyone starts with a fresh last-seen clock: a screen that loads
      // mid-game must not grey the whole scoreboard while presence is still
      // syncing. A player who is truly gone fades AWAY_AFTER_MS later.
      const now = Date.now()
      for (const p of fullState.players) {
        if (!lastSeenRef.current.has(p.id)) lastSeenRef.current.set(p.id, now)
      }
      setState((s) => ({
        ...s,
        ...fullState,
      }))
    }

    loadState()
  }, [roomCode])

  // 2. Subscribe to postgres_changes (server-push, like Jackbox's WebSocket)
  useEffect(() => {
    if (!state.game?.id) return

    const gameId = state.game.id

    const myId = state.myPlayerId
    const channel = supabase.channel(`game:${gameId}`, {
      // Keyed by player so a player's second tab doesn't read as a second
      // person, and so closing one tab doesn't mark them gone.
      config: { presence: { key: myId ?? `viewer:${Math.random().toString(36).slice(2)}` } },
    })

    // A player is "online" if presence has seen them within the grace window.
    // Absence must be continuous to count: brief socket flaps (backgrounded
    // phones, wifi blips, our own reconnects) come and go well inside it.
    const AWAY_AFTER_MS = 20_000

    const recomputeOnline = () => {
      const now = Date.now()
      const online = new Set<string>()
      for (const [id, seen] of lastSeenRef.current) {
        if (now - seen < AWAY_AFTER_MS) online.add(id)
      }
      setOnlineIds((prev) => {
        if (prev.size === online.size && [...online].every((id) => prev.has(id))) return prev
        return online
      })
    }

    channel.on('presence', { event: 'sync' }, () => {
      const now = Date.now()
      const presenceState = channel.presenceState() as Record<string, any[]>
      for (const entries of Object.values(presenceState)) {
        for (const entry of entries) {
          if (entry?.playerId) lastSeenRef.current.set(entry.playerId as string, now)
        }
      }
      recomputeOnline()
    })

    // Game row changes → refresh game state
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`,
      },
      (payload) => {
        setState((s) => ({
          ...s,
          game: s.game ? { ...s.game, ...payload.new } : null,
        }))
      }
    )

    // Player changes (join, ready up, score updates)
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'players',
        filter: `game_id=eq.${gameId}`,
      },
      (payload) => {
        // A brand-new player hasn't announced presence yet — give them the
        // full grace window rather than greying them the moment they join.
        lastSeenRef.current.set((payload.new as Player).id, Date.now())
        setState((s) => ({
          ...s,
          players: [...s.players.filter((p) => p.id !== (payload.new as Player).id), payload.new as Player],
        }))
      }
    )

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'players',
        filter: `game_id=eq.${gameId}`,
      },
      (payload) => {
        setState((s) => ({
          ...s,
          players: s.players.map((p) =>
            p.id === (payload.new as Player).id ? { ...p, ...payload.new } : p
          ),
        }))
      }
    )

    // Clue changes (answered, etc.)
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'clues',
      },
      () => {
        // For clue changes, do a full refresh since we need to filter by game
        refreshState()
      }
    )

    channel.subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
      if (status === 'SUBSCRIBED') {
        // Our own socket just (re)connected. Any absence we recorded while it
        // was down says nothing about the other players — reset their clocks
        // and let the sync that follows sort out who is really here.
        const now = Date.now()
        for (const id of lastSeenRef.current.keys()) lastSeenRef.current.set(id, now)
        recomputeOnline()
        // Spectator screens (the TV in party mode) watch without announcing
        // themselves — they aren't playing, so they shouldn't count as present.
        if (myId) channel.track({ playerId: myId })
      }
    })

    // Absence only shows with time, so presence needs a clock as well as
    // events: re-evaluate every few seconds, and periodically re-announce
    // ourselves — a channel revived from a backgrounded phone can come back
    // without ever re-firing SUBSCRIBED, leaving us a silent ghost.
    let tick = 0
    const presenceTimer = setInterval(() => {
      recomputeOnline()
      tick++
      if (myId && tick % 3 === 0) {
        channel.track({ playerId: myId }).catch(() => {})
      }
    }, 5000)

    // A phone coming back from the lock screen should re-announce right away,
    // not up to 15s later.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && myId) {
        channel.track({ playerId: myId }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    channelRef.current = channel

    return () => {
      clearInterval(presenceTimer)
      document.removeEventListener('visibilitychange', onVisible)
      channel.unsubscribe()
    }
  }, [state.game?.id, state.myPlayerId, refreshState])

  // 3. Polling fallback: refresh every 2 seconds to catch anything missed
  useEffect(() => {
    if (!state.game?.id) return

    pollRef.current = setInterval(() => {
      refreshState()
    }, 2000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [state.game?.id, refreshState])

  const myPlayer = state.players.find((p) => p.id === state.myPlayerId) || null
  const isMyTurn = state.game?.current_player_id === state.myPlayerId

  return {
    ...state,
    myPlayer,
    isMyTurn,
    connected,
    onlineIds,
    refreshState,
  }
}
