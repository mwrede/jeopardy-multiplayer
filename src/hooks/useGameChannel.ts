'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { RealtimeEvent, Game, Player, Category, Clue } from '@/types/game'

interface GameState {
  game: Game | null
  players: Player[]
  categories: Category[]
  clues: Clue[]
  myPlayerId: string | null
}

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

  // Load initial state
  useEffect(() => {
    const playerId = localStorage.getItem('playerId')
    setState((s) => ({ ...s, myPlayerId: playerId }))

    async function loadState() {
      // Get game by room code
      const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('room_code', roomCode)
        .single()

      if (!game) return

      const [playersRes, categoriesRes, cluesRes] = await Promise.all([
        supabase.from('players').select('*').eq('game_id', game.id).order('join_order'),
        supabase.from('categories').select('*').eq('game_id', game.id).order('position'),
        supabase
          .from('clues')
          .select('id, category_id, value, question, answer, is_daily_double, is_answered, answered_by')
          .in(
            'category_id',
            (await supabase.from('categories').select('id').eq('game_id', game.id)).data?.map((c) => c.id) || []
          ),
      ])

      setState((s) => ({
        ...s,
        game: game as Game,
        players: playersRes.data as Player[] || [],
        categories: categoriesRes.data as Category[] || [],
        clues: cluesRes.data as Clue[] || [],
      }))
    }

    loadState()
  }, [roomCode])

  // Subscribe to realtime updates
  useEffect(() => {
    if (!state.game?.id) return

    const channel = supabase.channel(`game:${state.game.id}`, {
      config: { broadcast: { self: true } },
    })

    // Listen for broadcast events (low-latency game events)
    channel.on('broadcast', { event: 'game_event' }, ({ payload }) => {
      const event = payload as RealtimeEvent
      handleEvent(event)
    })

    // Listen for DB changes on the game row
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${state.game.id}`,
      },
      (payload) => {
        setState((s) => ({
          ...s,
          game: { ...s.game!, ...payload.new },
        }))
      }
    )

    // Listen for player changes
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'players',
        filter: `game_id=eq.${state.game.id}`,
      },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          setState((s) => ({
            ...s,
            players: [...s.players, payload.new as Player],
          }))
        } else if (payload.eventType === 'UPDATE') {
          setState((s) => ({
            ...s,
            players: s.players.map((p) =>
              p.id === (payload.new as Player).id ? { ...p, ...payload.new } : p
            ),
          }))
        }
      }
    )

    // Listen for clue changes
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'clues',
      },
      (payload) => {
        setState((s) => ({
          ...s,
          clues: s.clues.map((c) =>
            c.id === (payload.new as Clue).id ? { ...c, ...payload.new } : c
          ),
        }))
      }
    )

    channel.subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
    })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [state.game?.id])

  function handleEvent(event: RealtimeEvent) {
    switch (event.type) {
      case 'game_state':
        setState((s) => ({
          ...s,
          game: s.game ? { ...s.game, ...event.payload } : null,
        }))
        break
      case 'player_joined':
        setState((s) => ({
          ...s,
          players: [...s.players.filter((p) => p.id !== event.payload.id), event.payload],
        }))
        break
      case 'score_update':
        setState((s) => ({
          ...s,
          players: s.players.map((p) => {
            const update = event.payload.players.find((u) => u.id === p.id)
            return update ? { ...p, score: update.score } : p
          }),
        }))
        break
      case 'answer_result':
        setState((s) => ({
          ...s,
          players: s.players.map((p) =>
            p.id === event.payload.player_id
              ? { ...p, score: event.payload.new_score }
              : p
          ),
        }))
        break
    }
  }

  const broadcast = useCallback(
    (event: RealtimeEvent) => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'game_event',
        payload: event,
      })
    },
    []
  )

  const myPlayer = state.players.find((p) => p.id === state.myPlayerId) || null
  const isMyTurn = state.game?.current_player_id === state.myPlayerId

  return {
    ...state,
    myPlayer,
    isMyTurn,
    connected,
    broadcast,
  }
}
