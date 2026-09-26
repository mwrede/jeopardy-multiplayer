'use client'

import { useEffect, useState } from 'react'
import { loadStats, type Slice, type Stats } from '@/lib/stats'

/** One headline number. */
function Tile({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="plate h-full">
      <div className="plate-surface h-full px-4 py-4 text-center">
        <p className="display-chrome text-3xl leading-none text-jeopardy-gold-light md:text-4xl">
          {value}
        </p>
        <p className="mt-1.5 text-[9px] font-bold uppercase leading-tight tracking-[0.1em] text-ink-stage-2 sm:text-[10px] sm:tracking-[0.2em]">
          {label}
        </p>
        {hint && <p className="mt-1 text-[11px] text-ink-stage-2/80">{hint}</p>}
      </div>
    </div>
  )
}

/**
 * A ranked breakdown. Bars are drawn against the biggest row rather than the
 * total, so a small second place is still visible instead of a sliver.
 */
function Breakdown({
  title,
  rows,
  total,
}: {
  title: string
  rows: Slice[]
  total: number
}) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <section className="plate h-full">
      <div className="plate-surface h-full p-5">
        <div className="eyebrow-copper mb-4">{title}</div>
        {rows.length === 0 && <p className="text-sm text-ink-stage-2">Nothing yet.</p>}
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-semibold text-white">{r.label}</span>
                <span className="shrink-0 tabular-nums text-ink-stage-2">
                  {r.count}
                  {total > 0 && (
                    <span className="ml-1.5 text-[11px] opacity-70">
                      {Math.round((r.count / total) * 100)}%
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/50">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#F58A2C] to-[#FFC57A]"
                  style={{ width: `${Math.max(3, (r.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadStats()
      .then(setStats)
      .catch((e) => setError(e?.message || 'Could not load stats.'))
  }, [])

  const body = () => {
    if (error) return <p className="py-16 text-center text-sm text-copper-glow">{error}</p>
    if (!stats) return <p className="py-16 text-center text-ink-stage-2">Counting…</p>

    const { totals, funnel, byWeek, modes, sizes, sources, seatsPerGame, topBoards, answers, reaction } = stats
    const top = funnel[0]?.count || 1
    const maxWeek = Math.max(1, ...byWeek.map((w) => w.games))
    const judged = answers.correct + answers.wrong
    const since = stats.firstGame
      ? new Date(stats.firstGame).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null

    return (
      <>
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile value={totals.games.toLocaleString()} label="Games" hint={since ? `since ${since}` : undefined} />
          <Tile
            value={totals.games ? `${Math.round((totals.finished / totals.games) * 100)}%` : '—'}
            label="Played to the end"
            hint={`${totals.finished} finished`}
          />
          <Tile value={totals.people.toLocaleString()} label="Distinct names" hint={`${totals.seats} seats filled`} />
          <Tile value={totals.buzzes.toLocaleString()} label="Buzzes" hint={`${totals.judged} judged`} />
        </div>

        {/* ── Funnel ─────────────────────────────────────────────────────── */}
        <section className="plate mb-6">
          <div className="plate-surface p-5">
            <div className="eyebrow-copper mb-1.5">How far games get</div>
            <p className="mb-5 text-[11px] text-ink-stage-2">
              Every room ever made, and where each one stopped.
            </p>
            <div className="space-y-3">
              {funnel.map((f) => (
                <div key={f.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-sm font-semibold text-white">
                      {f.label}
                      <span className="ml-1 hidden text-[11px] font-normal text-ink-stage-2 sm:inline">
                        — {f.note}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-ink-stage-2">
                      {f.count}
                      <span className="ml-1.5 text-[11px] opacity-70">
                        {Math.round((f.count / top) * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-5 overflow-hidden rounded-md border border-black bg-black/50">
                    <div
                      className="h-full bg-jeopardy-blue-cell"
                      style={{ width: `${Math.max(2, (f.count / top) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Weekly volume ──────────────────────────────────────────────── */}
        <section className="plate mb-6">
          <div className="plate-surface p-5">
            <div className="eyebrow-copper mb-1.5">Games a week</div>
            <p className="mb-5 text-[11px] text-ink-stage-2">Last {byWeek.length} weeks.</p>
            <div className="flex h-36 items-end gap-[3px]">
              {byWeek.map((w) => (
                <div key={w.week} className="group relative flex-1" title={`Week of ${w.week}: ${w.games}`}>
                  <div
                    className="w-full rounded-t-sm bg-gradient-to-t from-[#F58A2C] to-[#FFC57A]"
                    style={{ height: `${Math.max(4, (w.games / maxWeek) * 128)}px` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-ink-stage-2">
              <span>{byWeek[0]?.week}</span>
              <span className="tabular-nums">peak {maxWeek}/wk</span>
              <span>{byWeek[byWeek.length - 1]?.week}</span>
            </div>
          </div>
        </section>

        <div className="mb-6 grid gap-6 md:grid-cols-2">
          <Breakdown title="How they played" rows={modes} total={totals.games} />
          <Breakdown title="Where the board came from" rows={sources} total={totals.games} />
          <Breakdown title="Board size" rows={sizes} total={totals.games} />
          <Breakdown title="People per game" rows={seatsPerGame} total={totals.games} />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* ── Answers ──────────────────────────────────────────────────── */}
          <section className="plate h-full">
            <div className="plate-surface h-full p-5">
              <div className="eyebrow-copper mb-4">Answers</div>
              {judged === 0 ? (
                <p className="text-sm text-ink-stage-2">Nobody has answered anything yet.</p>
              ) : (
                <>
                  <p className="display-chrome text-4xl leading-none text-jeopardy-gold-light">
                    {Math.round((answers.correct / judged) * 100)}%
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-ink-stage-2">
                    of judged answers were right
                  </p>
                  {/* Never colour alone: each figure is labelled. */}
                  <div className="mt-4 space-y-1.5 text-sm">
                    <p className="text-green-300">✓ Right — <span className="tabular-nums">{answers.correct}</span></p>
                    <p className="text-red-300">✗ Wrong — <span className="tabular-nums">{answers.wrong}</span></p>
                    <p className="text-ink-stage-2">— Passed — <span className="tabular-nums">{answers.passed}</span></p>
                  </div>
                  {reaction.n > 0 && (
                    <p className="mt-4 border-t border-white/10 pt-3 text-[11px] text-ink-stage-2">
                      Typical buzz <span className="font-bold text-white tabular-nums">{reaction.median}ms</span>
                      {reaction.quick != null && (
                        <> · the quickest tenth beat{' '}
                          <span className="font-bold text-white tabular-nums">{reaction.quick}ms</span>
                        </>
                      )}
                      <span className="opacity-70"> · {reaction.n} timed buzzes</span>
                    </p>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ── Most played ──────────────────────────────────────────────── */}
          <section className="plate h-full">
            <div className="plate-surface h-full p-5">
              <div className="eyebrow-copper mb-4">Most played boards</div>
              {topBoards.length === 0 ? (
                <p className="text-sm text-ink-stage-2">Nothing has been played twice yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {topBoards.map((b) => (
                    <div
                      key={`${b.kind}:${b.key}`}
                      className="flex items-center gap-2 border-b border-white/5 pb-1.5 text-sm last:border-b-0"
                    >
                      <span className="w-[68px] shrink-0 text-[9px] font-bold uppercase tracking-wider text-copper">
                        {b.kind === 'game' ? 'Episode' : b.kind === 'mashup' ? 'Mashup' : 'Custom'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-white">
                        {b.kind === 'game' ? `Show #${b.key}` : b.key.replace(/^(mix|topics?):/, '')}
                      </span>
                      <span className="shrink-0 tabular-nums text-jeopardy-gold-light">{b.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {totals.capped && (
          <p className="mt-6 text-center text-[11px] text-copper-glow">
            Showing the most recent rows only — the tables have outgrown a single read.
          </p>
        )}
      </>
    )
  }

  return (
    <main className="stage-page-deep p-4 pb-24 md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="frame">
          <span className="led-strip led-strip-left" />
          <span className="led-strip led-strip-right" />
          <div className="frame-inner p-5 md:p-9">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
              <a
                href="/"
                className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper"
              >
                ← Home
              </a>
              {/* Wraps into the back link at phone width, and it's a caption,
                  not information — so it sits this one out. */}
              <span className="hidden text-[10px] uppercase tracking-[0.22em] text-ink-stage-2 sm:inline">
                Straight from the database
              </span>
            </div>

            <header className="mb-7 text-center">
              <h1 className="display-chrome text-3xl leading-none md:text-4xl">Who&apos;s playing</h1>
              <p className="mt-2 text-xs text-ink-stage-2">
                Real games, real people — not a tracking script&apos;s guess at them.
              </p>
            </header>

            {body()}
          </div>
        </div>
      </div>
    </main>
  )
}
