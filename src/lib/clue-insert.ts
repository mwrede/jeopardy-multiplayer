/**
 * Inserting a clue, with the source year attached when the database has
 * somewhere to put it.
 *
 * `clues.source_year` arrives via supabase-migration-clue-source-year.sql,
 * which is run by hand in the Supabase dashboard. Until that happens the
 * column doesn't exist and an insert naming it fails outright — so the first
 * such failure latches a flag and every later insert goes without it. Games
 * keep working either way; they just don't show a year yet.
 */

import { supabase } from './supabase'

let hasSourceYear = true

/** The calendar year of an air date like "2001-11-07". */
export function yearOf(airDate: string | null | undefined): number | null {
  if (!airDate) return null
  const y = parseInt(String(airDate).slice(0, 4), 10)
  return Number.isFinite(y) && y > 1900 ? y : null
}

export type ClueInsert = {
  category_id: string
  value: number
  question: string
  answer: string
  is_daily_double?: boolean
  source_year?: number | null
}

/** Insert one clue row; returns its id, or null if the insert failed. */
export async function insertClue(row: ClueInsert): Promise<string | null> {
  const { source_year, ...base } = row

  if (hasSourceYear && source_year != null) {
    const { data, error } = await supabase
      .from('clues')
      .insert({ ...base, source_year })
      .select('id')
      .single()
    if (!error && data) return data.id
    if (error && /source_year/i.test(error.message)) {
      console.warn('[clues] source_year column missing — run supabase-migration-clue-source-year.sql')
      hasSourceYear = false
    } else if (error) {
      return null
    }
  }

  const { data } = await supabase.from('clues').insert(base).select('id').single()
  return data?.id ?? null
}
