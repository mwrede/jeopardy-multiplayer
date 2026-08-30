'use client'

import { useEffect, useMemo, useState } from 'react'
import { useUser, signInWithGoogle } from '@/lib/auth'
import { ProfileMenu } from '@/components/ProfileMenu'
import {
  LINEUP_GAMES,
  MICHAELS_GAMES,
  CHALLENGE_MAX_SCORE,
  TIER_LABELS,
  type ChallengeGame,
} from '@/lib/challenge-data'
import {
  fetchAllChallengeResults,
  getChallengeIdentity,
  overallLeaderboard,
  resultsByGame,
  formatMoney,
  type ChallengeResult,
} from '@/lib/challenge'

/**
 * JEOPARDY CHALLENGE — the hub.
 *
 * Every board on the site, each with its own standings, plus the overall
 * table at the bottom. A board you've played shows your money and rank where
 * its Play button used to be — one shot each is the whole game, so the hub is
 * really a leaderboard you climb one board at a time.
 */
export default function ChallengePage() {
  const { user, loading: userLoading } = useUser()
  const [results, setResults] = useState<ChallengeResult[]>([])
  const [loaded, setLoaded] = useState(false)
  const [identity, setIdentity] = useState<string | null>(null)

  useEffect(() => {
    if (userLoading) return
    setIdentity(getChallengeIdentity(user?.id))
  }, [user, userLoading])

  useEffect(() => {
    fetchAllChallengeResults()
      .then((r) => { setResults(r); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  const byGame = useMemo(() => resultsByGame(results), [results])
  const overall = useMemo(() => overallLeaderboard(results), [results])
  const myOverallRank = identity
    ? overall.findIndex((r) => r.identityKey === identity) + 1
    : 0

  return (
    <main className="stage-page-deep px-4 pb-24 md:px-8">
      <div className="mx-auto w-full max-w-4xl px-1 pt-8 md:pt-12">
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <a href="/" className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper">
            ← Home
          </a>
          <ProfileMenu />
        </div>

        <h1 className="display-chrome text-3xl leading-none md:text-4xl">Jeopardy Challenge</h1>
        <p className="mt-3 max-w-2xl text-sm text-ink-stage">
          Solo 3×3 boards — nine clues, type your answers, keep the money. Each board is
          <strong className="text-white"> one shot</strong>: play it once and your score
          stands forever. You&apos;re racing the real people who played before you, and a
          perfect board is {formatMoney(CHALLENGE_MAX_SCORE)}.
        </p>

        {!userLoading && !user && (
          <div className="mt-6 rounded-xl border border-white/15 bg-black/30 p-4 text-center">
            <p className="text-sm text-ink-stage-2">
              Playing as a guest works, but your one-shot record lives only in this browser.
              Sign in and it follows you everywhere.
            </p>
            <button
              onClick={() => signInWithGoogle('/challenge')}
              className="btn-stage btn-chrome btn-stage-sm mt-3"
            >
              Continue with Google
            </button>
          </div>
        )}

        {/* The Lineup */}
        <div className="mt-10">
          <div className="eyebrow-copper mb-1">The Lineup</div>
          <p className="mb-4 text-center text-xs text-ink-stage-2">
            Kids, Teen, College — and five standard boards for everyone.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {LINEUP_GAMES.map((g) => (
              <GameCard key={g.key} game={g} results={byGame.get(g.key) ?? []} identity={identity} loaded={loaded} />
            ))}
          </div>
        </div>

        {/* Michael's Jeopardy Challenge */}
        <div className="mt-12">
          <div className="eyebrow-copper mb-1">Michael&apos;s Jeopardy Challenge</div>
          <p className="mb-4 text-center text-xs text-ink-stage-2">
            Ten boards. All geography. Run the table.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {MICHAELS_GAMES.map((g) => (
              <GameCard key={g.key} game={g} results={byGame.get(g.key) ?? []} identity={identity} loaded={loaded} />
            ))}
          </div>
        </div>

        {/* Overall standings */}
        <div className="mt-14">
          <div className="eyebrow-copper mb-1">Overall Leaderboard</div>
          <p className="mb-3 text-center text-xs text-ink-stage-2">
            Total money across every board played. {myOverallRank > 0 && (
              <span className="text-jeopardy-gold-light">You&apos;re #{myOverallRank}.</span>
            )}
          </p>

          {overall.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-ink-stage-2">
              {loaded ? 'Nobody has played yet. The first board is yours.' : 'Loading standings…'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-4 py-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-[0.18em] text-ink-stage-2">
                    <th className="py-2 pr-2 font-normal">#</th>
                    <th className="py-2 pr-2 font-normal">Player</th>
                    <th className="py-2 pr-2 text-right font-normal">Total</th>
                    <th className="py-2 pr-2 text-right font-normal">Boards</th>
                    <th className="py-2 text-right font-normal">Best</th>
                  </tr>
                </thead>
                <tbody>
                  {overall.slice(0, 50).map((r, i) => (
                    <tr
                      key={r.identityKey}
                      className={`border-b border-white/5 ${r.identityKey === identity ? 'bg-jeopardy-gold/10' : ''}`}
                    >
                      <td className="py-2 pr-2 tabular-nums text-ink-stage-2">{i + 1}</td>
                      <td className="py-2 pr-2 font-semibold text-white">
                        {r.name}
                        {r.identityKey === identity && (
                          <span className="ml-1.5 text-[9px] uppercase tracking-wider text-jeopardy-gold-light">You</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(r.totalScore)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-ink-stage-2">{r.gamesPlayed}</td>
                      <td className="py-2 text-right tabular-nums text-ink-stage">{formatMoney(r.bestGame)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

const TIER_CHIP: Record<string, string> = {
  kids: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
  teen: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/40',
  college: 'bg-sky-500/20 text-sky-300 border-sky-400/40',
  standard: 'bg-white/10 text-ink-stage border-white/25',
  geography: 'bg-amber-500/20 text-amber-300 border-amber-400/40',
}

/**
 * One board: play state on the left, that board's own top-three on the right.
 * The mini-table is the point — every card is a little leaderboard, so
 * scrolling the hub is scrolling the competition.
 */
function GameCard({
  game,
  results,
  identity,
  loaded,
}: {
  game: ChallengeGame
  results: ChallengeResult[]
  identity: string | null
  loaded: boolean
}) {
  const mine = identity ? results.find((r) => r.identity_key === identity) : undefined
  const myRank = mine ? results.findIndex((r) => r.id === mine.id) + 1 : 0

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 transition-colors hover:border-white/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold leading-tight text-white">{game.title}</h2>
          <p className="mt-1 text-xs text-ink-stage-2">{game.blurb}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${TIER_CHIP[game.tier]}`}>
          {TIER_LABELS[game.tier]}
        </span>
      </div>

      {/* This board's standings — the names you'd be playing against. */}
      <div className="mt-3 min-h-[64px] rounded-lg bg-black/30 px-3 py-2">
        {results.length === 0 ? (
          <p className="py-2 text-center text-[11px] italic text-ink-stage-2">
            {loaded ? 'No one has played this board yet — set the first score.' : '…'}
          </p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {results.slice(0, 3).map((r, i) => (
                <tr key={r.id} className={r.identity_key === identity ? 'text-jeopardy-gold-light' : 'text-ink-stage'}>
                  <td className="w-5 py-0.5 tabular-nums text-ink-stage-2">{i + 1}</td>
                  <td className="py-0.5 font-semibold">
                    {r.player_name}
                    {r.identity_key === identity && <span className="ml-1 text-[9px] uppercase">You</span>}
                  </td>
                  <td className="py-0.5 text-right font-bold tabular-nums">{formatMoney(r.score)}</td>
                </tr>
              ))}
              {results.length > 3 && (
                <tr className="text-ink-stage-2">
                  <td />
                  <td className="py-0.5 text-[10px] italic" colSpan={2}>
                    +{results.length - 3} more player{results.length - 3 === 1 ? '' : 's'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {mine ? (
          <>
            <p className="text-xs text-ink-stage-2">
              Played — <span className="font-bold text-jeopardy-gold-light">{formatMoney(mine.score)}</span>
              {myRank > 0 && <> · #{myRank} of {results.length}</>}
            </p>
            <a href={`/challenge/${game.key}`} className="btn-stage btn-stage-sm btn-stage-ghost">
              Standings
            </a>
          </>
        ) : (
          <>
            <p className="text-[11px] text-ink-stage-2">One shot. 9 clues.</p>
            <a href={`/challenge/${game.key}`} className="btn-stage btn-stage-sm btn-copper">
              Play
            </a>
          </>
        )}
      </div>
    </div>
  )
}
