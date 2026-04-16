'use client'

import { useParams, useRouter } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { ClueText } from '@/components/ClueText'
import { useState, useEffect, useCallback } from 'react'
import type { Category, Clue } from '@/types/game'

interface Team {
  name: string
  score: number
}

type PresentPhase = 'setup' | 'board' | 'clue' | 'answer' | 'daily_double'

export default function PresentPage() {
  const { roomCode } = useParams<{ roomCode: string }>()
  const router = useRouter()
  const { game, categories, clues } = useGameChannel(roomCode)

  // Team state
  const [teams, setTeams] = useState<Team[]>([
    { name: 'Team 1', score: 0 },
    { name: 'Team 2', score: 0 },
    { name: 'Team 3', score: 0 },
  ])
  const [teamCount, setTeamCount] = useState(3)

  // Presentation state
  const [phase, setPhase] = useState<PresentPhase>('setup')
  const [activeClue, setActiveClue] = useState<Clue | null>(null)
  const [activeCategory, setActiveCategory] = useState<Category | null>(null)
  const [answeredClueIds, setAnsweredClueIds] = useState<Set<string>>(new Set())
  const [currentRound, setCurrentRound] = useState(1)
  const [showMenu, setShowMenu] = useState(false)
  const [ddWager, setDdWager] = useState('')

  // Get categories and clues for the current round
  const roundCategories = categories
    .filter((c) => c.round_number === currentRound)
    .sort((a, b) => a.position - b.position)
  const roundClues = clues.filter((c) =>
    roundCategories.some((cat) => cat.id === c.category_id)
  )

  // Check if all clues in current round are answered
  const allAnswered = roundClues.length > 0 && roundClues.every((c) => answeredClueIds.has(c.id))

  // Check if there's a round 2
  const hasRound2 = categories.some((c) => c.round_number === 2)

  // Get clues for a category, sorted by value
  const getCluesForCategory = useCallback(
    (catId: string) =>
      clues
        .filter((c) => c.category_id === catId)
        .sort((a, b) => a.value - b.value),
    [clues]
  )

  // Click a cell on the board
  function handleCellClick(clue: Clue) {
    if (answeredClueIds.has(clue.id)) return
    const cat = categories.find((c) => c.id === clue.category_id)
    setActiveClue(clue)
    setActiveCategory(cat || null)
    if (clue.is_daily_double) {
      setPhase('daily_double')
      setDdWager('')
    } else {
      setPhase('clue')
    }
  }

  // Reveal the answer
  function revealAnswer() {
    setPhase('answer')
  }

  // Award points to a team
  function awardPoints(teamIdx: number, correct: boolean) {
    if (!activeClue) return
    const points = activeClue.is_daily_double && ddWager
      ? parseInt(ddWager) || activeClue.value
      : activeClue.value
    setTeams((prev) =>
      prev.map((t, i) =>
        i === teamIdx ? { ...t, score: t.score + (correct ? points : -points) } : t
      )
    )
  }

  // Return to board, mark clue as answered
  function backToBoard() {
    if (activeClue) {
      setAnsweredClueIds((prev) => new Set([...prev, activeClue.id]))
    }
    setActiveClue(null)
    setActiveCategory(null)
    setPhase('board')
  }

  // Next round
  function advanceRound() {
    setCurrentRound(2)
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (phase === 'setup') return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (phase === 'clue') revealAnswer()
        else if (phase === 'answer') backToBoard()
      }
      if (e.key === 'Escape') {
        if (phase === 'clue' || phase === 'answer' || phase === 'daily_double') backToBoard()
      }
      // Number keys 1-6 to award points
      const num = parseInt(e.key)
      if (phase === 'answer' && num >= 1 && num <= teams.length) {
        awardPoints(num - 1, true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, activeClue, teams.length, ddWager])

  // ---- SETUP SCREEN ----
  if (phase === 'setup') {
    return (
      <div className="min-h-screen bg-jeopardy-blue-cell flex items-center justify-center p-6">
        <div className="bg-jeopardy-dark border border-white/20 rounded-2xl p-8 w-full max-w-md space-y-6">
          <h1 className="text-3xl font-bold text-jeopardy-gold text-center">Presentation Setup</h1>

          <div>
            <label className="text-gray-400 text-sm mb-2 block">Number of Teams</label>
            <div className="flex gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setTeamCount(n)
                    setTeams((prev) => {
                      const next = Array.from({ length: n }, (_, i) =>
                        prev[i] || { name: `Team ${i + 1}`, score: 0 }
                      )
                      return next
                    })
                  }}
                  className={`flex-1 py-2 rounded-lg font-bold transition-colors ${
                    teamCount === n
                      ? 'bg-jeopardy-gold text-black'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-gray-400 text-sm block">Team Names</label>
            {teams.slice(0, teamCount).map((team, i) => (
              <input
                key={i}
                type="text"
                value={team.name}
                onChange={(e) =>
                  setTeams((prev) =>
                    prev.map((t, j) => (j === i ? { ...t, name: e.target.value } : t))
                  )
                }
                className="input-base text-base"
                placeholder={`Team ${i + 1}`}
              />
            ))}
          </div>

          <button
            onClick={() => {
              setTeams((prev) => prev.slice(0, teamCount))
              setPhase('board')
            }}
            className="btn-primary w-full py-4 text-lg"
          >
            Start Presenting
          </button>
        </div>
      </div>
    )
  }

  // ---- CLUE / ANSWER OVERLAY ----
  if ((phase === 'clue' || phase === 'answer' || phase === 'daily_double') && activeClue) {
    return (
      <div className="min-h-screen bg-jeopardy-blue-cell flex flex-col">
        {/* Clue display */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-6">
          {activeCategory && (
            <p className="text-blue-300 text-lg font-bold uppercase tracking-wide mb-2">
              {activeCategory.name}
            </p>
          )}
          <p className="text-jeopardy-gold text-2xl font-bold mb-6">
            ${activeClue.value.toLocaleString()}
            {activeClue.is_daily_double && (
              <span className="ml-3 text-yellow-300 animate-pulse">DAILY DOUBLE!</span>
            )}
          </p>

          {phase === 'daily_double' ? (
            <div className="text-center space-y-4">
              <p className="text-white text-3xl font-serif">Enter wager:</p>
              <input
                type="number"
                value={ddWager}
                onChange={(e) => setDdWager(e.target.value)}
                className="input-base text-3xl text-center w-48 mx-auto"
                placeholder="$0"
                autoFocus
              />
              <button
                onClick={() => setPhase('clue')}
                className="btn-primary px-8 py-3 text-lg block mx-auto"
              >
                Show Clue
              </button>
            </div>
          ) : (
            <>
              <p className="text-4xl md:text-6xl text-white text-center leading-relaxed font-serif max-w-5xl">
                <ClueText text={activeClue.question} />
              </p>

              {phase === 'clue' && (
                <button
                  onClick={revealAnswer}
                  className="mt-8 btn-primary px-8 py-3 text-lg"
                >
                  Reveal Answer
                </button>
              )}

              {phase === 'answer' && (
                <div className="mt-8 text-center">
                  <p className="text-gray-400 text-lg mb-2">Answer:</p>
                  <p className="text-3xl md:text-5xl text-jeopardy-gold font-bold">
                    {activeClue.answer}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom bar: team scoring + back button */}
        <div className="bg-black/50 border-t border-white/10 px-4 py-3">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {phase === 'answer' &&
              teams.map((team, i) => (
                <div key={i} className="flex items-center gap-1 bg-white rounded-lg px-2 py-1">
                  <span className="text-black font-bold text-sm px-1">{team.name}</span>
                  <span className="text-black font-bold text-sm border-t border-black px-1">
                    {team.score.toLocaleString()}
                  </span>
                  <button
                    onClick={() => awardPoints(i, true)}
                    className="text-green-600 font-bold text-lg px-1 hover:scale-110 transition-transform"
                  >
                    +
                  </button>
                  <button
                    onClick={() => awardPoints(i, false)}
                    className="text-red-600 font-bold text-lg px-1 hover:scale-110 transition-transform"
                  >
                    −
                  </button>
                </div>
              ))}
            <button
              onClick={backToBoard}
              className="btn-secondary px-6 py-2 text-sm ml-4"
            >
              Back to Board
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---- BOARD VIEW ----
  const cols = roundCategories.length || 1

  return (
    <div className="min-h-screen bg-jeopardy-blue-cell flex flex-col">
      {/* Board grid */}
      <div className="flex-1 flex flex-col p-1">
        <div
          className="flex-1 grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `auto repeat(${Math.max(
              ...roundCategories.map((cat) => getCluesForCategory(cat.id).length),
              1
            )}, 1fr)`,
          }}
        >
          {/* Category headers */}
          {roundCategories.map((cat) => (
            <div
              key={cat.id}
              className="board-category px-3 py-4 text-white font-bold text-sm md:text-xl lg:text-2xl uppercase tracking-wide"
            >
              {cat.name}
            </div>
          ))}

          {/* Clue cells */}
          {roundCategories.length > 0 &&
            Array.from({
              length: Math.max(
                ...roundCategories.map((cat) => getCluesForCategory(cat.id).length),
                1
              ),
            }).map((_, rowIdx) =>
              roundCategories.map((cat) => {
                const catClues = getCluesForCategory(cat.id)
                const clue = catClues[rowIdx]
                if (!clue) return <div key={`empty-${cat.id}-${rowIdx}`} className="board-cell" />
                const answered = answeredClueIds.has(clue.id)
                return (
                  <button
                    key={clue.id}
                    onClick={() => !answered && handleCellClick(clue)}
                    className={`board-cell text-2xl md:text-4xl lg:text-5xl font-bold ${
                      answered ? 'board-cell-answered' : ''
                    }`}
                  >
                    {answered ? '' : `$${clue.value.toLocaleString()}`}
                  </button>
                )
              })
            )}
        </div>
      </div>

      {/* Team scoreboard + menu */}
      <div className="bg-black/40 border-t-2 border-black px-4 py-2 flex items-center justify-center gap-3 flex-wrap">
        {/* Menu button */}
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="bg-jeopardy-blue-cell border-2 border-white/30 text-white text-xs font-bold px-2 py-3 rounded leading-none tracking-widest"
          style={{ writingMode: 'vertical-lr' }}
        >
          MENU
        </button>

        {/* Team scores */}
        {teams.map((team, i) => (
          <div key={i} className="bg-white rounded-lg overflow-hidden text-center min-w-[100px] md:min-w-[140px]">
            <div className="bg-white border-b-2 border-jeopardy-blue-cell px-3 py-1">
              <p className="text-black font-bold text-sm md:text-base italic">{team.name}</p>
            </div>
            <div className="bg-white px-3 py-1 border-b border-gray-300">
              <p className="text-black font-bold text-lg md:text-xl">
                {team.score < 0 ? `-$${Math.abs(team.score).toLocaleString()}` : `$${team.score.toLocaleString()}`}
              </p>
            </div>
            <div className="flex">
              <button
                onClick={() => setTeams((prev) => prev.map((t, j) => j === i ? { ...t, score: t.score + 100 } : t))}
                className="flex-1 text-green-600 font-bold text-lg py-0.5 hover:bg-green-50 transition-colors"
              >
                +
              </button>
              <button
                onClick={() => setTeams((prev) => prev.map((t, j) => j === i ? { ...t, score: t.score - 100 } : t))}
                className="flex-1 text-red-600 font-bold text-lg py-0.5 hover:bg-red-50 transition-colors"
              >
                −
              </button>
            </div>
          </div>
        ))}

        {/* Round advance / end */}
        {allAnswered && hasRound2 && currentRound === 1 && (
          <button onClick={advanceRound} className="btn-primary px-4 py-2 text-sm ml-2">
            Double Jeopardy! →
          </button>
        )}
      </div>

      {/* Menu overlay */}
      {showMenu && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowMenu(false)}>
          <div className="bg-jeopardy-dark border border-white/20 rounded-2xl p-6 w-full max-w-xs space-y-3"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white text-center">Menu</h3>
            <button
              onClick={() => { setPhase('setup'); setShowMenu(false) }}
              className="btn-secondary w-full py-2 text-sm"
            >
              Edit Teams
            </button>
            <button
              onClick={() => {
                setAnsweredClueIds(new Set())
                setCurrentRound(1)
                setTeams((prev) => prev.map((t) => ({ ...t, score: 0 })))
                setShowMenu(false)
              }}
              className="btn-secondary w-full py-2 text-sm"
            >
              Reset Board
            </button>
            <button
              onClick={() => router.push('/')}
              className="btn-secondary w-full py-2 text-sm text-red-400"
            >
              Exit to Home
            </button>
            <button
              onClick={() => setShowMenu(false)}
              className="btn-secondary w-full py-2 text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
