import { addDays, toISODate, formatShortDay, formatDayLabel } from '../lib/recurrence'

// Horizontal strip showing today + the next several days, each a jump-to target.
export default function ForecastStrip({ selectedDate, onSelect, taskCountByDate }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i))
  const selectedISO = toISODate(selectedDate)

  return (
    <div className="plate rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg">Forecast</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSelect(addDays(selectedDate, -1))}
            className="text-[var(--color-muted)] hover:text-[var(--color-paper)] px-2"
            aria-label="Previous day"
          >
            ‹
          </button>
          <span className="text-sm font-medium">{formatDayLabel(selectedDate)}</span>
          <button
            onClick={() => onSelect(addDays(selectedDate, 1))}
            className="text-[var(--color-muted)] hover:text-[var(--color-paper)] px-2"
            aria-label="Next day"
          >
            ›
          </button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const iso = toISODate(d)
          const isSelected = iso === selectedISO
          const count = taskCountByDate[iso] || 0
          return (
            <button
              key={iso}
              onClick={() => onSelect(d)}
              className={
                'flex-shrink-0 w-16 rounded-md py-2 flex flex-col items-center border transition ' +
                (isSelected
                  ? 'bg-[var(--color-ember)] border-[var(--color-ember)] text-[var(--color-ink)]'
                  : 'bg-[var(--color-ink)] border-[var(--color-line)] hover:border-[var(--color-steel)]')
              }
            >
              <span className="text-[10px] [font-family:var(--font-mono)] uppercase opacity-80">{formatShortDay(d)}</span>
              <span className="text-lg [font-family:var(--font-display)] leading-none mt-0.5">{d.getDate()}</span>
              <span className={'text-[10px] mt-1 ' + (isSelected ? 'opacity-80' : 'text-[var(--color-muted)]')}>
                {count ? `${count} task${count > 1 ? 's' : ''}` : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
