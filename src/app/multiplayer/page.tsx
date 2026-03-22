'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createGame, joinGame, listPublicGames, listCustomBoards, loadCustomBoard } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'
import type { GameLength } from '@/types/game'

type Screen = 'landing' | 'join' | 'host'
type JoinTab = 'code' | 'public'
type GameType = 'regular' | 'kids' | 'teen' | 'toc'
type CategoryTheme = '' | 'geography' | 'history' | 'corporate' | 'science' | 'sports' | 'pop_culture' | 'food' | 'literature' | 'music'

interface PublicGame {
  id: string
  room_code: string
  gameLength: string
  playerCount: number
  creatorName: string
  created_at: string
}

export default function MultiplayerPage() {
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>('landing')
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [gameLength, setGameLength] = useState<GameLength>('rapid')
  const [isPublic, setIsPublic] = useState(true)
  const [gameType, setGameType] = useState<GameType>('regular')
  const [categoryTheme, setCategoryTheme] = useState<CategoryTheme>('')
  const [customBoardId, setCustomBoardId] = useState<string | null>(null)
  const [customBoards, setCustomBoards] = useState<Array<{ id: string; title: string; created_at: string }>>([])
  const [customSearch, setCustomSearch] = useState('')
  const [loadingCustom, setLoadingCustom] = useState(false)
  const [joinTab, setJoinTab] = useState<JoinTab>('public')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [publicGames, setPublicGames] = useState<PublicGame[]>([])
  const [loadingGames, setLoadingGames] = useState(false)

  // Load saved name
  useEffect(() => {
    const saved = localStorage.getItem('playerName')
    if (saved) setPlayerName(saved)
  }, [])

  // Fetch public games when on join screen
  const fetchPublicGames = useCallback(async () => {
    setLoadingGames(true)
    try {
      const games = await listPublicGames()
      setPublicGames(games)
    } catch {
      // Silently fail
    } finally {
      setLoadingGames(false)
    }
  }, [])

  useEffect(() => {
    if (screen === 'join' && joinTab === 'public') {
      fetchPublicGames()
      const interval = setInterval(fetchPublicGames, 5000)
      return () => clearInterval(interval)
    }
  }, [screen, joinTab, fetchPublicGames])

  async function searchCustom() {
    setLoadingCustom(true)
    try {
      const boards = await listCustomBoards(customSearch || undefined)
      setCustomBoards(boards)
    } catch (e) {
      console.error('Failed to load custom boards:', e)
    } finally {
      setLoadingCustom(false)
    }
  }

  async function handleHost() {
    if (!playerName.trim()) { setError('Enter your name'); return }
    setLoading(true)
    setError('')
    try {
      const settings: any = {
        ...DEFAULT_CASUAL_SETTINGS,
        gameMode: 'multiplayer' as const,
        gameLength,
        gameType,
        ...(categoryTheme && { categoryTheme }),
      }
      const { game } = await createGame(settings, isPublic)

      // If a custom board is selected, store its data in settings
      if (customBoardId) {
        const board = await loadCustomBoard(customBoardId)
        await supabase.from('games').update({
          settings: { ...settings, customBoard: board.board_data, customBoardId },
        }).eq('id', game.id)
      }

      const { player } = await joinGame(game.room_code, playerName.trim())
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      router.push(`/game/${game.room_code}/play`)
    } catch (e: any) {
      setError(e.message || 'Failed to create game')
    } finally {
      setLoading(false)
    }
  }

  async function handleJoinByCode() {
    if (!playerName.trim()) { setError('Enter your name'); return }
    if (!roomCode.trim() || roomCode.trim().length < 4) { setError('Enter a room code'); return }
    setLoading(true)
    setError('')
    try {
      const { game, player } = await joinGame(roomCode.trim(), playerName.trim())
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      router.push(`/game/${game.room_code}/play`)
    } catch (e: any) {
      setError(e.message || 'Failed to join game')
    } finally {
      setLoading(false)
    }
  }

  async function handleJoinPublic(code: string) {
    if (!playerName.trim()) { setError('Enter your name first'); return }
    setLoading(true)
    setError('')
    try {
      const { game, player } = await joinGame(code, playerName.trim())
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      router.push(`/game/${game.room_code}/play`)
    } catch (e: any) {
      setError(e.message || 'Failed to join game')
    } finally {
      setLoading(false)
    }
  }

  const gameLengthOptions: Array<{ id: GameLength; label: string; desc: string }> = [
    { id: 'full', label: 'Full', desc: '6x5' },
    { id: 'half', label: 'Half', desc: '6x3' },
    { id: 'rapid', label: 'Rapid', desc: '3x3' },
  ]

  // === LANDING SCREEN ===
  if (screen === 'landing') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-jeopardy-dark">
        <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-20 md:h-32 w-auto mb-8" />
        <h2 className="text-2xl font-bold text-white mb-10">Multiplayer</h2>

        <div className="w-full max-w-sm space-y-4">
          <button
            onClick={() => setScreen('join')}
            className="btn-primary w-full py-5 text-xl"
          >
            Join Game
          </button>
          <button
            onClick={() => setScreen('host')}
            className="btn-secondary w-full py-5 text-xl"
          >
            Host Game
          </button>
        </div>

        <a href="/" className="text-gray-500 hover:text-white text-sm mt-10 transition-colors">
          Back
        </a>
      </main>
    )
  }

  // === JOIN SCREEN ===
  if (screen === 'join') {
    return (
      <main className="min-h-screen flex flex-col items-center p-6 bg-jeopardy-dark">
        <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-16 w-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-6">Join Game</h2>

        {/* Name input */}
        <div className="w-full max-w-sm mb-6">
          <input
            type="text"
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={30}
            className="input-base text-lg"
            autoFocus
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 w-full max-w-sm">
          <button
            onClick={() => setJoinTab('public')}
            className={`flex-1 py-3 rounded-xl font-medium transition-all ${
              joinTab === 'public'
                ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                : 'bg-white/5 border-2 border-transparent text-gray-400'
            }`}
          >
            Public Games
          </button>
          <button
            onClick={() => setJoinTab('code')}
            className={`flex-1 py-3 rounded-xl font-medium transition-all ${
              joinTab === 'code'
                ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                : 'bg-white/5 border-2 border-transparent text-gray-400'
            }`}
          >
            Enter Code
          </button>
        </div>

        <div className="w-full max-w-sm">
          {joinTab === 'code' ? (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Room code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="input-base text-2xl tracking-[0.3em] text-center font-mono"
              />
              <button
                onClick={handleJoinByCode}
                disabled={loading}
                className="btn-primary w-full py-4 text-lg"
              >
                {loading ? 'Joining...' : 'Join'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {loadingGames ? (
                <p className="text-gray-500 text-center py-8">Loading games...</p>
              ) : publicGames.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-2">No open games right now</p>
                  <button
                    onClick={() => setScreen('host')}
                    className="text-jeopardy-gold hover:text-jeopardy-gold/80 text-sm"
                  >
                    Host your own game
                  </button>
                </div>
              ) : (
                publicGames.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => handleJoinPublic(g.room_code)}
                    disabled={loading}
                    className="w-full text-left bg-white/5 hover:bg-white/10 rounded-2xl p-4 transition-all border border-white/10 hover:border-jeopardy-gold/30"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-white font-semibold">{g.creatorName}&apos;s Game</p>
                        <p className="text-gray-500 text-sm">
                          {g.playerCount} player{g.playerCount !== 1 ? 's' : ''} &middot; {g.gameLength}
                        </p>
                      </div>
                      <span className="text-jeopardy-gold font-mono text-sm">{g.room_code}</span>
                    </div>
                  </button>
                ))
              )}
              <button
                onClick={fetchPublicGames}
                disabled={loadingGames}
                className="w-full text-gray-500 hover:text-white text-sm py-2 transition-colors"
              >
                Refresh
              </button>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-center text-sm mt-4">{error}</p>}

        <button
          onClick={() => { setScreen('landing'); setError('') }}
          className="text-gray-500 hover:text-white text-sm mt-8 transition-colors"
        >
          Back
        </button>
      </main>
    )
  }

  // === HOST SCREEN ===
  return (
    <main className="min-h-screen flex flex-col items-center p-6 bg-jeopardy-dark">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-16 w-auto mb-4" />
      <h2 className="text-xl font-bold text-white mb-6">Host Game</h2>

      {/* Name input */}
      <div className="w-full max-w-sm mb-6">
        <input
          type="text"
          placeholder="Your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={30}
          className="input-base text-lg"
          autoFocus
        />
      </div>

      {/* Game type */}
      <div className="w-full max-w-sm mb-6">
        <p className="text-gray-400 text-sm mb-2 text-center">Game Type</p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { id: 'regular' as GameType, label: 'Regular' },
            { id: 'kids' as GameType, label: 'Kids' },
            { id: 'teen' as GameType, label: 'Teen' },
            { id: 'toc' as GameType, label: 'Tournament of Champions' },
          ]).map((gt) => (
            <button
              key={gt.id}
              onClick={() => setGameType(gt.id)}
              className={`px-4 py-3 rounded-xl text-center transition-all text-sm font-medium ${
                gameType === gt.id
                  ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                  : 'bg-white/5 border-2 border-transparent text-gray-400 hover:bg-white/10'
              }`}
            >
              {gt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category theme (optional) */}
      <div className="w-full max-w-sm mb-6">
        <p className="text-gray-400 text-sm mb-2 text-center">Category Theme <span className="text-gray-600">(optional)</span></p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { id: '' as CategoryTheme, label: 'Any' },
            { id: 'geography' as CategoryTheme, label: 'Geography' },
            { id: 'history' as CategoryTheme, label: 'History' },
            { id: 'science' as CategoryTheme, label: 'Science' },
            { id: 'sports' as CategoryTheme, label: 'Sports' },
            { id: 'pop_culture' as CategoryTheme, label: 'Pop Culture' },
            { id: 'food' as CategoryTheme, label: 'Food & Drink' },
            { id: 'literature' as CategoryTheme, label: 'Literature' },
            { id: 'music' as CategoryTheme, label: 'Music' },
            { id: 'corporate' as CategoryTheme, label: 'Corporate' },
          ]).map((ct) => (
            <button
              key={ct.id}
              onClick={() => setCategoryTheme(ct.id)}
              className={`px-4 py-3 rounded-xl text-center transition-all text-sm font-medium ${
                categoryTheme === ct.id
                  ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                  : 'bg-white/5 border-2 border-transparent text-gray-400 hover:bg-white/10'
              }`}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom board (optional) */}
      <div className="w-full max-w-sm mb-6">
        <p className="text-gray-400 text-sm mb-2 text-center">Custom Board <span className="text-gray-600">(optional)</span></p>
        <div className="flex gap-2 mb-2">
          <input type="text" value={customSearch}
            onChange={(e) => setCustomSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchCustom() }}
            placeholder="Search custom boards..." className="input-base text-sm flex-1 py-2" />
          <button onClick={searchCustom} disabled={loadingCustom}
            className="btn-secondary px-3 py-2 text-xs">{loadingCustom ? '...' : 'Search'}</button>
        </div>
        {customBoards.length > 0 && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {customBoards.map((cb) => (
              <button key={cb.id}
                onClick={() => setCustomBoardId(customBoardId === cb.id ? null : cb.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                  customBoardId === cb.id
                    ? 'bg-green-900/30 border border-green-500 text-green-400'
                    : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10'
                }`}>
                {cb.title}
              </button>
            ))}
          </div>
        )}
        {customBoardId && (
          <p className="text-green-400 text-xs text-center mt-1">
            Custom board selected — will use this instead of random categories
          </p>
        )}
      </div>

      {/* Game length */}
      <div className="w-full max-w-sm mb-6">
        <p className="text-gray-400 text-sm mb-2 text-center">Game Length</p>
        <div className="flex gap-3">
          {gameLengthOptions.map((gl) => (
            <button
              key={gl.id}
              onClick={() => setGameLength(gl.id)}
              className={`flex-1 px-4 py-3 rounded-xl text-center transition-all ${
                gameLength === gl.id
                  ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                  : 'bg-white/5 border-2 border-transparent text-gray-400 hover:bg-white/10'
              }`}
            >
              <span className="font-bold block">{gl.label}</span>
              <span className="text-xs opacity-60">{gl.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Public / Private */}
      <div className="w-full max-w-sm mb-8">
        <p className="text-gray-400 text-sm mb-2 text-center">Visibility</p>
        <div className="flex gap-3">
          <button
            onClick={() => setIsPublic(true)}
            className={`flex-1 px-4 py-3 rounded-xl text-center transition-all ${
              isPublic
                ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                : 'bg-white/5 border-2 border-transparent text-gray-400 hover:bg-white/10'
            }`}
          >
            <span className="font-bold block">Public</span>
            <span className="text-xs opacity-60">Anyone can join</span>
          </button>
          <button
            onClick={() => setIsPublic(false)}
            className={`flex-1 px-4 py-3 rounded-xl text-center transition-all ${
              !isPublic
                ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                : 'bg-white/5 border-2 border-transparent text-gray-400 hover:bg-white/10'
            }`}
          >
            <span className="font-bold block">Private</span>
            <span className="text-xs opacity-60">Share code</span>
          </button>
        </div>
      </div>

      {/* Create button */}
      <div className="w-full max-w-sm">
        <button
          onClick={handleHost}
          disabled={loading}
          className="btn-primary w-full py-4 text-lg"
        >
          {loading ? 'Creating...' : 'Create Game'}
        </button>
      </div>

      {error && <p className="text-red-400 text-center text-sm mt-4">{error}</p>}

      <button
        onClick={() => { setScreen('landing'); setError('') }}
        className="text-gray-500 hover:text-white text-sm mt-8 transition-colors"
      >
        Back
      </button>
    </main>
  )
}
