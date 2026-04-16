'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { saveCustomBoard } from '@/lib/game-api'
import type { CustomBoard } from '@/types/game'

interface CellData {
  question: string
  answer: string
  isDailyDouble?: boolean
}

interface BoardState {
  title: string
  categories: string[]
  values: number[]
  cells: (CellData | null)[][] // [row][col]
  isPublic: boolean
  // Full game extras
  isFullGame: boolean
  dj_categories: string[]
  dj_values: number[]
  dj_cells: (CellData | null)[][]
  fj_category: string
  fj_question: string
  fj_answer: string
}

function createEmptyCells(rows: number, cols: number): (CellData | null)[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))
}

function defaultValues(rows: number, multiplier: number = 1): number[] {
  return Array.from({ length: rows }, (_, i) => (i + 1) * 100 * multiplier)
}

const INITIAL_COLS = 5
const INITIAL_ROWS = 5

function initialState(): BoardState {
  return {
    title: '',
    categories: Array(INITIAL_COLS).fill(''),
    values: defaultValues(INITIAL_ROWS),
    cells: createEmptyCells(INITIAL_ROWS, INITIAL_COLS),
    isPublic: true,
    isFullGame: false,
    dj_categories: Array(INITIAL_COLS).fill(''),
    dj_values: defaultValues(INITIAL_ROWS, 2),
    dj_cells: createEmptyCells(INITIAL_ROWS, INITIAL_COLS),
    fj_category: '',
    fj_question: '',
    fj_answer: '',
  }
}

export default function CreateBoardPage() {
  const router = useRouter()
  const [board, setBoard] = useState<BoardState>(initialState)
  const [editingCell, setEditingCell] = useState<{ round: 1 | 2; row: number; col: number } | null>(null)
  const [cellQuestion, setCellQuestion] = useState('')
  const [cellAnswer, setCellAnswer] = useState('')
  const [cellIsDailyDouble, setCellIsDailyDouble] = useState(false)
  const [history, setHistory] = useState<BoardState[]>([])
  const [future, setFuture] = useState<BoardState[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showInstructions, setShowInstructions] = useState(true)
  const [activeRound, setActiveRound] = useState<1 | 2 | 'fj'>(1)
  const [editingValue, setEditingValue] = useState<{ round: 1 | 2; row: number } | null>(null)
  const [valueInput, setValueInput] = useState('')

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-30), board])
    setFuture([])
  }, [board])

  function undo() {
    if (history.length === 0) return
    setFuture((f) => [board, ...f])
    setBoard(history[history.length - 1])
    setHistory((h) => h.slice(0, -1))
  }

  function redo() {
    if (future.length === 0) return
    setHistory((h) => [...h, board])
    setBoard(future[0])
    setFuture((f) => f.slice(1))
  }

  function addColumn() {
    pushHistory()
    setBoard((b) => ({
      ...b,
      categories: [...b.categories, ''],
      cells: b.cells.map((row) => [...row, null]),
      dj_categories: [...b.dj_categories, ''],
      dj_cells: b.dj_cells.map((row) => [...row, null]),
    }))
  }

  function removeColumn(idx: number) {
    if (board.categories.length <= 1) return
    pushHistory()
    setBoard((b) => ({
      ...b,
      categories: b.categories.filter((_, i) => i !== idx),
      cells: b.cells.map((row) => row.filter((_, i) => i !== idx)),
      dj_categories: b.dj_categories.filter((_, i) => i !== idx),
      dj_cells: b.dj_cells.map((row) => row.filter((_, i) => i !== idx)),
    }))
  }

  function addRow() {
    pushHistory()
    const cols = board.categories.length
    const lastVal = board.values[board.values.length - 1] || 500
    const lastDjVal = board.dj_values[board.dj_values.length - 1] || 1000
    setBoard((b) => ({
      ...b,
      values: [...b.values, lastVal + 100],
      cells: [...b.cells, Array(cols).fill(null)],
      dj_values: [...b.dj_values, lastDjVal + 200],
      dj_cells: [...b.dj_cells, Array(cols).fill(null)],
    }))
  }

  function removeRow(idx: number) {
    if (board.values.length <= 1) return
    pushHistory()
    setBoard((b) => ({
      ...b,
      values: b.values.filter((_, i) => i !== idx),
      cells: b.cells.filter((_, i) => i !== idx),
      dj_values: b.dj_values.filter((_, i) => i !== idx),
      dj_cells: b.dj_cells.filter((_, i) => i !== idx),
    }))
  }

  function updateCategory(round: 1 | 2, idx: number, name: string) {
    pushHistory()
    if (round === 1) {
      setBoard((b) => ({ ...b, categories: b.categories.map((c, i) => (i === idx ? name : c)) }))
    } else {
      setBoard((b) => ({ ...b, dj_categories: b.dj_categories.map((c, i) => (i === idx ? name : c)) }))
    }
  }

  function openCell(round: 1 | 2, row: number, col: number) {
    const cells = round === 1 ? board.cells : board.dj_cells
    const cell = cells[row][col]
    setEditingCell({ round, row, col })
    setCellQuestion(cell?.question || '')
    setCellAnswer(cell?.answer || '')
    setCellIsDailyDouble(cell?.isDailyDouble || false)
  }

  function insertTag(tag: string) {
    const textarea = document.getElementById('clue-editor') as HTMLTextAreaElement | null
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = cellQuestion.substring(start, end)
    let insert: string
    if (tag === 'img') {
      const url = prompt('Enter image URL:')
      if (!url) return
      insert = `[img:${url}]`
    } else if (tag === 'big') {
      insert = `[big]${selected}[/big]`
    } else {
      const open = tag === 'b' ? '**' : '*'
      insert = `${open}${selected}${open}`
    }
    const newQ = cellQuestion.substring(0, start) + insert + cellQuestion.substring(end)
    setCellQuestion(newQ)
    // Restore focus after React re-render
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + insert.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  function saveCell() {
    if (!editingCell) return
    pushHistory()
    const { round, row, col } = editingCell
    const cellData = cellQuestion.trim() || cellAnswer.trim()
      ? { question: cellQuestion.trim(), answer: cellAnswer.trim(), isDailyDouble: cellIsDailyDouble }
      : null
    if (round === 1) {
      setBoard((b) => ({
        ...b,
        cells: b.cells.map((r, ri) => ri === row ? r.map((c, ci) => (ci === col ? cellData : c)) : r),
      }))
    } else {
      setBoard((b) => ({
        ...b,
        dj_cells: b.dj_cells.map((r, ri) => ri === row ? r.map((c, ci) => (ci === col ? cellData : c)) : r),
      }))
    }
    setEditingCell(null)
  }

  function startEditValue(round: 1 | 2, row: number) {
    const val = round === 1 ? board.values[row] : board.dj_values[row]
    setEditingValue({ round, row })
    setValueInput(String(val))
  }

  function saveValue() {
    if (!editingValue) return
    pushHistory()
    const num = parseInt(valueInput) || 0
    const { round, row } = editingValue
    if (round === 1) {
      setBoard((b) => ({ ...b, values: b.values.map((v, i) => (i === row ? num : v)) }))
    } else {
      setBoard((b) => ({ ...b, dj_values: b.dj_values.map((v, i) => (i === row ? num : v)) }))
    }
    setEditingValue(null)
  }

  async function handleSave() {
    if (!board.title.trim()) {
      setError('Please enter a title for your board')
      return
    }

    // Build the CustomBoard object
    const round1Categories = board.categories.map((name, colIdx) => ({
      name: name || `Category ${colIdx + 1}`,
      clues: board.values.map((value, rowIdx) => {
        const cell = board.cells[rowIdx][colIdx]
        return {
          question: cell?.question || '',
          answer: cell?.answer || '',
          value,
          isDailyDouble: cell?.isDailyDouble || false,
        }
      }),
    }))

    const customBoard: CustomBoard = {
      rounds: [{ categories: round1Categories }],
    }

    if (board.isFullGame) {
      const round2Categories = board.dj_categories.map((name, colIdx) => ({
        name: name || `Category ${colIdx + 1}`,
        clues: board.dj_values.map((value, rowIdx) => {
          const cell = board.dj_cells[rowIdx][colIdx]
          return {
            question: cell?.question || '',
            answer: cell?.answer || '',
            value,
            isDailyDouble: cell?.isDailyDouble || false,
          }
        }),
      }))
      customBoard.rounds.push({ categories: round2Categories })

      if (board.fj_question.trim()) {
        customBoard.finalJeopardy = {
          categoryName: board.fj_category || 'Final Jeopardy',
          question: board.fj_question,
          answer: board.fj_answer,
        }
      }
    }

    setSaving(true)
    setError('')
    try {
      await saveCustomBoard(board.title.trim(), customBoard, board.isPublic)
      router.push('/?saved=1')
    } catch (e: any) {
      setError(e.message || 'Failed to save board')
    } finally {
      setSaving(false)
    }
  }

  const cols = board.categories.length
  const rows = board.values.length
  const currentCategories = activeRound === 1 ? board.categories : board.dj_categories
  const currentValues = activeRound === 1 ? board.values : board.dj_values
  const currentCells = activeRound === 1 ? board.cells : board.dj_cells

  return (
    <div className="min-h-screen bg-jeopardy-dark flex flex-col">
      {/* Instructions banner */}
      {showInstructions && (
        <div className="bg-blue-900/40 border-b border-blue-500/30 px-4 py-3 text-sm">
          <strong>Instructions:</strong> Enter your Jeopardy game title and category names.
          Click a cell to enter your question/answer (it&apos;s OK to leave some blank).
          When you&apos;re done, click Save &amp; Finish.{' '}
          <button onClick={() => setShowInstructions(false)} className="text-blue-400 underline">Dismiss</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-wrap">
        <button onClick={undo} disabled={history.length === 0}
          className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-30">Undo</button>
        <button onClick={redo} disabled={future.length === 0}
          className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-30">Redo</button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <button onClick={addRow} className="btn-secondary px-3 py-1.5 text-xs">+ Add Row</button>
        <button onClick={addColumn} className="btn-secondary px-3 py-1.5 text-xs">+ Add Column</button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <span className="text-gray-400 text-xs">Visibility:</span>
        <button onClick={() => { pushHistory(); setBoard((b) => ({ ...b, isPublic: !b.isPublic })) }}
          className="text-blue-400 text-xs underline">{board.isPublic ? 'Public' : 'Private'}</button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={board.isFullGame}
            onChange={(e) => { pushHistory(); setBoard((b) => ({ ...b, isFullGame: e.target.checked })) }}
            className="accent-jeopardy-gold" />
          Full Game (J! + DJ! + FJ!)
        </label>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving}
          className="btn-primary px-5 py-2 text-sm">{saving ? 'Saving...' : 'Save & Finish'}</button>
      </div>

      {error && <p className="text-red-400 text-center text-sm py-2">{error}</p>}

      {/* Round tabs (only if full game) */}
      {board.isFullGame && (
        <div className="flex gap-1 px-4 pt-3">
          <button onClick={() => setActiveRound(1)}
            className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${
              activeRound === 1 ? 'bg-jeopardy-blue-cell text-white' : 'bg-white/5 text-gray-500 hover:text-white'
            }`}>Jeopardy!</button>
          <button onClick={() => setActiveRound(2)}
            className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${
              activeRound === 2 ? 'bg-jeopardy-blue-cell text-white' : 'bg-white/5 text-gray-500 hover:text-white'
            }`}>Double Jeopardy!</button>
          <button onClick={() => setActiveRound('fj')}
            className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${
              activeRound === 'fj' ? 'bg-jeopardy-blue-cell text-white' : 'bg-white/5 text-gray-500 hover:text-white'
            }`}>Final Jeopardy</button>
        </div>
      )}

      {/* Title */}
      <div className="text-center py-4">
        <input
          type="text"
          value={board.title}
          onChange={(e) => { pushHistory(); setBoard((b) => ({ ...b, title: e.target.value })) }}
          placeholder="Enter Title"
          className="bg-transparent text-3xl md:text-4xl font-bold text-jeopardy-gold text-center
                     border-none outline-none placeholder:text-jeopardy-gold/40 w-full max-w-2xl px-4"
        />
      </div>

      {activeRound === 'fj' ? (
        /* Final Jeopardy editor */
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4 max-w-lg mx-auto w-full">
          <h2 className="text-2xl font-bold text-jeopardy-gold">Final Jeopardy</h2>
          <input type="text" value={board.fj_category}
            onChange={(e) => { pushHistory(); setBoard((b) => ({ ...b, fj_category: e.target.value })) }}
            placeholder="Category name" className="input-base text-lg" />
          <textarea value={board.fj_question}
            onChange={(e) => { pushHistory(); setBoard((b) => ({ ...b, fj_question: e.target.value })) }}
            placeholder="Enter the clue..." rows={3} className="input-base text-base" />
          <input type="text" value={board.fj_answer}
            onChange={(e) => { pushHistory(); setBoard((b) => ({ ...b, fj_answer: e.target.value })) }}
            placeholder="Answer" className="input-base text-lg" />
        </div>
      ) : (
        /* Board grid */
        <div className="flex-1 px-4 pb-4 overflow-auto">
          <div className="board-wrapper max-w-6xl mx-auto">
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: `60px repeat(${cols}, 1fr)` }}>
              {/* Header row: empty corner + category names */}
              <div /> {/* empty corner */}
              {currentCategories.map((cat, ci) => (
                <div key={ci} className="board-category px-2 py-3 relative group">
                  <input
                    type="text"
                    value={cat}
                    onChange={(e) => updateCategory(activeRound as 1 | 2, ci, e.target.value)}
                    placeholder="Category"
                    className="bg-transparent text-center text-white font-bold text-xs md:text-sm uppercase
                               tracking-wide w-full outline-none placeholder:text-white/30"
                    style={{ textShadow: '1px 2px 3px rgba(0,0,0,0.5)' }}
                  />
                  {cols > 1 && (
                    <button onClick={() => removeColumn(ci)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-600 text-white text-xs
                                 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      x
                    </button>
                  )}
                </div>
              ))}

              {/* Clue rows */}
              {currentValues.map((val, ri) => (
                <>
                  {/* Row value label */}
                  <div key={`val-${ri}`} className="flex items-center justify-center relative group">
                    {editingValue?.round === (activeRound as 1 | 2) && editingValue?.row === ri ? (
                      <input type="number" value={valueInput}
                        onChange={(e) => setValueInput(e.target.value)}
                        onBlur={saveValue}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveValue() }}
                        className="w-14 bg-white/10 text-jeopardy-gold-light text-center text-sm font-bold
                                   rounded border border-jeopardy-gold/50 outline-none"
                        autoFocus />
                    ) : (
                      <button onClick={() => startEditValue(activeRound as 1 | 2, ri)}
                        className="text-jeopardy-gold-light text-sm font-bold hover:underline">
                        {val}
                      </button>
                    )}
                    {rows > 1 && (
                      <button onClick={() => removeRow(ri)}
                        className="absolute -left-1 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-red-600 text-white text-[10px]
                                   opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        x
                      </button>
                    )}
                  </div>
                  {/* Clue cells */}
                  {currentCategories.map((_, ci) => {
                    const cell = currentCells[ri]?.[ci]
                    const filled = cell && (cell.question || cell.answer)
                    return (
                      <button
                        key={`${ri}-${ci}`}
                        onClick={() => openCell(activeRound as 1 | 2, ri, ci)}
                        className={`board-cell aspect-[4/3] relative overflow-hidden ${
                          filled ? 'ring-2 ring-green-500/40' : 'text-lg md:text-xl'
                        } ${cell?.isDailyDouble ? 'ring-2 ring-jeopardy-gold' : ''}`}
                      >
                        {cell?.isDailyDouble && (
                          <span className="absolute top-0.5 right-0.5 text-[8px] md:text-[10px] bg-jeopardy-gold/90 text-black font-bold px-1 rounded">
                            DD
                          </span>
                        )}
                        {filled ? (
                          <span className="text-[10px] md:text-xs text-white/80 leading-tight line-clamp-3 px-1 text-center"
                            style={{ textShadow: 'none' }}>
                            {cell!.question}
                          </span>
                        ) : (
                          val
                        )}
                      </button>
                    )
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cell editor modal */}
      {editingCell && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) saveCell() }}>
          <div className="bg-jeopardy-dark border border-white/20 rounded-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-jeopardy-gold">
                {editingCell.round === 1 ? '' : 'DJ! — '}
                {(editingCell.round === 1 ? board.categories : board.dj_categories)[editingCell.col] || `Category ${editingCell.col + 1}`}
                {' — $'}
                {(editingCell.round === 1 ? board.values : board.dj_values)[editingCell.row]}
              </h3>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={cellIsDailyDouble}
                  onChange={(e) => setCellIsDailyDouble(e.target.checked)}
                  className="accent-jeopardy-gold w-4 h-4" />
                <span className={`text-sm font-bold ${cellIsDailyDouble ? 'text-jeopardy-gold' : 'text-gray-500'}`}>
                  Daily Double
                </span>
              </label>
            </div>
            <div>
              <label className="text-gray-400 text-sm mb-1 block">Clue (shown to players)</label>
              {/* Formatting toolbar */}
              <div className="flex items-center gap-1 mb-1.5">
                <button type="button" onClick={() => insertTag('b')}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-sm font-bold transition-colors"
                  title="Bold — wraps selection in **">B</button>
                <button type="button" onClick={() => insertTag('i')}
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-sm italic transition-colors"
                  title="Italic — wraps selection in *">I</button>
                <button type="button" onClick={() => insertTag('big')}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs transition-colors"
                  title="Large text — wraps in [big]...[/big]">
                  <span className="text-sm">A</span><span className="text-[10px]">A</span>
                </button>
                <button type="button" onClick={() => insertTag('img')}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
                  title="Insert image URL">🖼️</button>
                <span className="text-gray-600 text-[10px] ml-2">**bold** *italic* [big]...[/big] [img:url]</span>
              </div>
              <textarea id="clue-editor" value={cellQuestion} onChange={(e) => setCellQuestion(e.target.value)}
                placeholder="Enter the clue..."
                rows={3} className="input-base text-base font-mono" autoFocus />
            </div>
            <div>
              <label className="text-gray-400 text-sm mb-1 block">Answer</label>
              <input type="text" value={cellAnswer} onChange={(e) => setCellAnswer(e.target.value)}
                placeholder="What is..."
                className="input-base text-base"
                onKeyDown={(e) => { if (e.key === 'Enter') saveCell() }} />
            </div>
            <div className="flex gap-2">
              <button onClick={saveCell} className="btn-primary flex-1 py-3">Save</button>
              <button onClick={() => setEditingCell(null)} className="btn-secondary flex-1 py-3">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
