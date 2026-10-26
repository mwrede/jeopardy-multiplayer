'use client'

/**
 * CSV import modal.
 *
 * Somebody shows up with a spreadsheet of clues — written for a family party,
 * exported from another trivia tool, pasted out of Excel. This takes the file,
 * says out loud what it made of it, and only then puts it in the editor. The
 * preview is the point: a silent import that quietly mangles a hundred clues
 * is worse than no import at all.
 *
 * `parseBoardCsv` does the reading; everything here is about showing its work.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  parseBoardCsv,
  boardToCsv,
  CSV_TEMPLATE,
  type CsvImportResult,
} from '@/lib/csv-board'
import type { CustomBoard } from '@/types/game'

/** A game's worth of clues is a few KB. Anything this big is a different file. */
const MAX_FILE_BYTES = 2 * 1024 * 1024

const LAYOUT_LABEL: Record<CsvImportResult['layout'], string> = {
  long: 'one clue per row',
  pairs: 'one category per row, clues across',
  grid: 'a board grid',
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  onClose: () => void
  /** Hand the parsed board to the editor. */
  onLoad: (result: CsvImportResult) => void
  /** The board currently in the editor, offered back as a CSV to edit outside. */
  current?: { title: string; board: CustomBoard }
}

export function CsvImport({ onClose, onLoad, current }: Props) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [reading, setReading] = useState(false)
  /** null = let the parser decide which column holds the clue. */
  const [swap, setSwap] = useState<boolean | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => {
    if (!text.trim()) return null
    try {
      return {
        ok: true as const,
        result: parseBoardCsv(text, { fileName, swap: swap ?? undefined }),
      }
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not read that file.' }
    }
  }, [text, fileName, swap])

  const takeFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setFileName(file.name)
      setText('')
      alert('That file is far bigger than a game\'s worth of clues — pick the sheet with the clues in it.')
      return
    }
    setReading(true)
    try {
      const raw = await file.text()
      setFileName(file.name)
      setSwap(null)
      setText(raw)
    } catch {
      alert('Could not read that file.')
    } finally {
      setReading(false)
    }
  }, [])

  const result = parsed?.ok ? parsed.result : null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="plate my-6 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="plate-surface p-5 sm:p-6">
          <h3 className="text-xl font-bold text-white">Import a CSV</h3>
          <p className="mt-1 text-sm text-ink-stage">
            Already have your clues in a spreadsheet? Drop the file in and we&apos;ll read it. Nothing
            lands in the editor until you say so.
          </p>

          {/* Drop zone / file picker */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) takeFile(f)
            }}
            className={`mt-4 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver ? 'border-copper bg-white/10' : 'border-white/25 bg-black/20'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) takeFile(f) }}
            />
            <p className="text-sm text-ink-stage-2">Drag a .csv or .tsv here</p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              className="btn-stage btn-chrome btn-stage-sm mt-3"
            >
              {reading ? 'Reading…' : 'Choose file'}
            </button>
            {fileName && (
              <p className="mt-2 truncate text-xs text-ink-stage-3" title={fileName}>
                {fileName}
              </p>
            )}
          </div>

          {/* Paste box — copying cells straight out of a sheet is tab-separated
              and lands here without ever becoming a file. */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs uppercase tracking-wider text-ink-stage-3 hover:text-copper">
              Or paste rows from a spreadsheet
            </summary>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setSwap(null) }}
              rows={5}
              spellCheck={false}
              placeholder={'Category,Value,Clue,Answer\nWORLD CAPITALS,200,This city on the Seine…,Paris'}
              className="field-stage mt-2 h-auto resize-y py-2 font-mono text-xs font-normal leading-relaxed"
            />
          </details>

          {/* What we made of it */}
          {parsed && !parsed.ok && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 p-3">
              <p className="text-sm font-bold text-red-300">Couldn&apos;t read that</p>
              <p className="mt-1 text-sm text-red-200/90">{parsed.error}</p>
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-lg border border-white/15 bg-black/25 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-bold text-white">{result.title}</p>
                <p className="text-xs uppercase tracking-wider text-ink-stage-3">
                  Read as {LAYOUT_LABEL[result.layout]}
                </p>
              </div>
              <p className="mt-1 text-sm text-ink-stage-2">
                {result.stats.clues} clue{result.stats.clues === 1 ? '' : 's'} ·{' '}
                {result.stats.categories} categor{result.stats.categories === 1 ? 'y' : 'ies'} ·{' '}
                {result.stats.rounds === 2 ? 'two rounds' : 'one round'}
                {result.stats.hasFinal ? ' + Final' : ''}
                {result.stats.dailyDoubles > 0 && ` · ${result.stats.dailyDoubles} Daily Double${result.stats.dailyDoubles === 1 ? '' : 's'}`}
                {result.stats.blanks > 0 && ` · ${result.stats.blanks} empty cell${result.stats.blanks === 1 ? '' : 's'}`}
              </p>

              {/* The board as dots: a column per category, a row per value.
                  Filled cells are copper, gaps are outlines — you can see a
                  half-read file at a glance instead of discovering it later. */}
              {result.board.rounds.map((round, ri) => (
                <div key={ri} className="mt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-stage-3">
                    {ri === 0 ? 'Jeopardy' : 'Double Jeopardy'}
                  </p>
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                    {round.categories.map((cat, ci) => (
                      <div key={ci} className="w-[76px] shrink-0">
                        <p
                          className="truncate text-[9px] uppercase leading-tight text-ink-stage-2"
                          title={cat.name}
                        >
                          {cat.name}
                        </p>
                        <div className="mt-1 space-y-1">
                          {cat.clues.map((clue, qi) => (
                            <div
                              key={qi}
                              title={clue.question ? `$${clue.value} — ${clue.question}` : `$${clue.value} — empty`}
                              className={`h-3 rounded-sm ${
                                clue.question || clue.answer
                                  ? clue.isDailyDouble
                                    ? 'bg-jeopardy-gold ring-1 ring-inset ring-white/70'
                                    : 'bg-copper'
                                  : 'border border-white/20 bg-transparent'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* A sample clue, so the orientation question answers itself. */}
              {(() => {
                const first = result.board.rounds[0].categories
                  .flatMap((c) => c.clues)
                  .find((c) => c.question || c.answer)
                if (!first) return null
                return (
                  <div className="mt-3 rounded border border-white/10 bg-black/30 p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-stage-3">First clue</p>
                    <p className="mt-1 text-sm text-white">{first.question || <em className="text-ink-stage-3">(blank)</em>}</p>
                    <p className="mt-0.5 text-sm text-copper">{first.answer || <em className="text-ink-stage-3">(blank)</em>}</p>
                  </div>
                )
              })()}

              {result.layout !== 'grid' && (
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-ink-stage-2">
                  <input
                    type="checkbox"
                    checked={result.swapped}
                    onChange={(e) => setSwap(e.target.checked)}
                    className="mt-0.5 accent-jeopardy-gold"
                  />
                  <span>
                    Clue and answer are swapped in this file
                    <span className="block text-xs text-ink-stage-3">
                      Tick this if the clue above is showing up as the answer.
                    </span>
                  </span>
                </label>
              )}

              {result.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-white/10 pt-3">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="text-xs leading-relaxed text-amber-200/90">
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              onClick={() => result && onLoad(result)}
              disabled={!result}
              className="btn-stage btn-copper btn-stage-sm flex-1"
            >
              Load into editor
            </button>
            <button onClick={onClose} className="btn-stage btn-stage-ghost btn-stage-sm">
              Cancel
            </button>
          </div>

          {result && (
            <p className="mt-2 text-center text-xs text-ink-stage-3">
              This replaces what&apos;s in the editor now. Undo brings it back.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-xs">
            <button
              onClick={() => download('jeopardy-board-template.csv', CSV_TEMPLATE)}
              className="text-copper underline underline-offset-2 hover:text-copper-bright"
            >
              Download a template
            </button>
            {current && (
              <button
                onClick={() =>
                  download(
                    `${(current.title || 'board').replace(/[^\w\- ]+/g, '').trim() || 'board'}.csv`,
                    boardToCsv(current.title, current.board),
                  )
                }
                className="text-copper underline underline-offset-2 hover:text-copper-bright"
              >
                Export this board as CSV
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-stage-3">
            Columns can be named Round, Category, Value, Clue, Answer, Daily Double — in any order,
            with extras ignored. A board grid with &ldquo;clue | answer&rdquo; in each cell works too.
          </p>
        </div>
      </div>
    </div>
  )
}
