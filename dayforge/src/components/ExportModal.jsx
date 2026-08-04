/**
 * =============================================================================
 * FILE: src/components/ExportModal.jsx
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Lets the user choose exactly what to include before downloading a
 *   calendar (.ics) export — which date range, which categories
 *   (personal/work), and which task types (to-do/reminder/event).
 *
 * UX DECISION: CATEGORY AND TYPE ARE INDEPENDENT, COMBINABLE FILTERS
 *   A task's category (personal/work) and type (to-do/reminder/event) are
 *   already separate fields in the data model (see supabase/schema.sql) —
 *   a task can be a "work event" or a "personal reminder" independently.
 *   Per user feedback, "event/appointment" should NOT be a third option
 *   mutually exclusive with personal/work (e.g. a radio button group of
 *   Personal / Work / Events would be wrong — a work event would have
 *   nowhere to go). Instead, this modal exposes TWO independent checkbox
 *   groups that combine with AND logic: a task is included only if its
 *   category is checked AND its type is checked. This lets someone export
 *   e.g. "Work, Events only" (work appointments/meetings, skipping work
 *   to-dos) or "Personal + Work, Events only" (every appointment regardless
 *   of category) — any combination the two independent dimensions allow.
 *
 * PROPS
 *   onExport {function} (range, categories, types) -> void
 *     range: 'day' | 'week'
 *     categories: string[] subset of ['personal', 'work']
 *     types: string[] subset of ['todo', 'reminder', 'event']
 *   onClose  {function} () -> void
 *
 * EDGE CASES
 *   - If the user unchecks every category or every type, Export is disabled
 *     rather than silently producing an empty file — an empty .ics is
 *     technically valid but almost certainly not what was intended, so we
 *     prevent the confusing "I exported but nothing showed up" outcome
 *     at the source instead of after the fact.
 * =============================================================================
 */

import { useState } from 'react'

const CATEGORY_OPTIONS = [
  { value: 'personal', label: 'Personal' },
  { value: 'work', label: 'Work' },
]
const TYPE_OPTIONS = [
  { value: 'todo', label: 'To-dos' },
  { value: 'reminder', label: 'Reminders' },
  { value: 'event', label: 'Events / appointments' },
]

export default function ExportModal({ onExport, onClose }) {
  const [range, setRange] = useState('day')
  const [categories, setCategories] = useState(['personal', 'work']) // default: everything
  const [types, setTypes] = useState(['todo', 'reminder', 'event'])   // default: everything

  function toggle(list, setList, value) {
    setList((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  const canExport = categories.length > 0 && types.length > 0

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="plate rounded-lg w-full max-w-sm p-5 rise-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl">Export to calendar</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-paper)]">✕</button>
        </div>

        <label className="blueprint-tick uppercase block mb-1">Range</label>
        <div className="flex gap-2 mb-4">
          {[{ value: 'day', label: 'This day' }, { value: 'week', label: 'This week' }].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={
                'flex-1 text-sm rounded border py-1.5 transition ' +
                (range === opt.value
                  ? 'bg-[var(--color-ember)] border-[var(--color-ember)] text-[var(--color-ink)] font-semibold'
                  : 'border-[var(--color-line)] text-[var(--color-muted)]')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label className="blueprint-tick uppercase block mb-1">Category</label>
        <p className="text-xs text-[var(--color-muted)] mb-2">Choose one or both — combines with the type filter below.</p>
        <div className="flex gap-3 mb-4">
          {CATEGORY_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={categories.includes(opt.value)}
                onChange={() => toggle(categories, setCategories, opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>

        <label className="blueprint-tick uppercase block mb-1">Type</label>
        <p className="text-xs text-[var(--color-muted)] mb-2">
          "Events / appointments" can be combined with either category above — e.g. check
          Work + Events only to export just your work meetings.
        </p>
        <div className="flex flex-col gap-1.5 mb-5">
          {TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={types.includes(opt.value)}
                onChange={() => toggle(types, setTypes, opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>

        {!canExport && (
          <p className="text-xs text-[var(--color-ember)] mb-3">Select at least one category and one type to export.</p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={() => canExport && onExport(range, categories, types)}
            disabled={!canExport}
            className="bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] text-sm font-semibold rounded px-4 py-1.5 hover:brightness-110 transition"
          >
            Download .ics
          </button>
        </div>
      </div>
    </div>
  )
}
