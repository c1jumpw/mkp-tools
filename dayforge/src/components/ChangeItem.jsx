/**
 * =============================================================================
 * FILE: src/components/ChangeItem.jsx
 * VERSION: v1 (2026-11-20)
 * =============================================================================
 * PURPOSE
 *   One line of the change log — a colored kind pill (New / Improved /
 *   Fixed / …), the sentence, and an "Admins" tag when the item is
 *   admin-only. Shared by the What's new card and the admin Change log so
 *   both read the same way.
 *
 * PROPS
 *   item       { text, kind, audience } from changelog.json
 *   showAudience  show the "Admins" tag (only ever true for admins)
 * =============================================================================
 */

import { KIND_META } from '../lib/changelog'

/** Small uppercase pill for a kind of change. Unknown kinds fall back to Improved. */
export function KindPill({ kind }) {
  const meta = KIND_META[kind] || KIND_META.improved
  return (
    <span className={`inline-flex items-center justify-center shrink-0 w-[4.6rem] rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide [font-family:var(--font-mono)] ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

export default function ChangeItem({ item, showAudience }) {
  return (
    <li className="flex items-start gap-2.5 py-1">
      <KindPill kind={item.kind} />
      <span className="text-sm leading-snug min-w-0">
        {item.text}
        {showAudience && item.audience === 'admins' && (
          <span className="ml-1.5 align-middle inline-block rounded-sm border border-[var(--color-line)] px-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)] [font-family:var(--font-mono)]">
            Admins
          </span>
        )}
      </span>
    </li>
  )
}
