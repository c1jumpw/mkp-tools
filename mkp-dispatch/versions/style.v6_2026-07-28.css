/**
 * =========================================================================
 * style.css — Dispatch visual identity ("dispatch manifest" theme)
 * =========================================================================
 * PURPOSE
 *   All styling for the app, token-based (see :root below) so colors/
 *   spacing/type stay consistent across every screen in app.js. Dark
 *   ink surface, brass/amber signal accent, mono labels for tags and
 *   headers (evokes a shipping-manifest/luggage-tag feel matching the
 *   "Dispatch" name), humanist sans for body copy and form fields.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - Assumes IBM Plex Mono / IBM Plex Sans are loaded via Google Fonts
 *     in index.html's <head> — falls back to system fonts if that
 *     fails to load (see --font-mono/--font-sans fallback stacks).
 *   - Uses the CSS color-mix() function (for tag tint backgrounds) —
 *     supported in modern Chrome/Edge/Safari, not in older browsers;
 *     degrades to a plain surface color there, not a hard failure.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial visual identity: home/picker/form/success
 *                    screens, ticket-notch "New Capture" button.
 *   v2  2026-07-24  Added styles for: the passcode lock screen (.lock*),
 *                    the tappable chip-flag button (was a non-
 *                    interactive <span>, now a real <button> needing
 *                    explicit padding/border reset), and Settings'
 *                    good/bad status hints (.hint--good/.hint--bad).
 *   v3  2026-07-25  Added .recent-link (the "View in ClickUp" icon on
 *                    each Recent item).
 *   v4  2026-07-25  Added styles for the subtask-of-existing-task
 *                    feature: .subtask-panel/.subtask-search/
 *                    .subtask-results/.subtask-result* (the search UI)
 *                    and .subtask-chip (the selected-parent summary).
 *   v5  2026-07-25  Added .icon-btn.spinning + @keyframes spin for the
 *                    new Home refresh/check-for-updates icon. Removed
 *                    the now-dead `.topbar .brand:first-child` rule —
 *                    Home's topbar gained a leading icon (matching
 *                    every other screen's back-btn/brand/action
 *                    layout), so .brand is never first-child anymore.
 *   v6  2026-07-28  Added .segmented/.segmented-btn (the "Add to
 *                    Accounts" destination toggle: Chat review channel
 *                    vs. direct to List).
 * =========================================================================
 */

/* -------------------------------------------------------------------
   Design tokens — "dispatch manifest" identity: dark ink surface,
   brass/amber signal accent, mono labels for tags, humanist sans body.
------------------------------------------------------------------- */
:root {
  --ink: #12141A;
  --surface: #1B1E27;
  --surface-raised: #232733;
  --line: #2E323F;
  --text: #F3F1EA;
  --text-dim: #9AA0AE;
  --amber: #E8A33D;
  --amber-dim: #7A5B2A;
  --green: #4CAF7D;
  --red: #E2604F;

  --font-mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --font-sans: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  --radius: 14px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  background: var(--ink);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-tap-highlight-color: transparent;
}

body {
  overscroll-behavior-y: contain;
}

#app {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  position: relative;
}

button {
  font-family: inherit;
  cursor: pointer;
  color: inherit;
  border: none;
  background: none;
}

a { color: var(--amber); }

/* --------------------------- Topbar --------------------------- */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px 10px;
  gap: 10px;
}

.brand {
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
  flex: 1;
  text-align: center;
}

/* Note: previously had a `.topbar .brand:first-child { text-align: left; }`
   rule here for Home's topbar specifically — removed in style.css v5
   since Home's topbar now has a leading refresh icon like every other
   screen, so .brand is never first-child anymore; the default centered
   rule above already applies correctly everywhere. */

.icon-btn.spinning svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.icon-btn, .icon-btn-spacer {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--text-dim);
}
.icon-btn svg { width: 20px; height: 20px; }
.icon-btn:active { background: var(--surface); }

/* --------------------------- Home --------------------------- */
.home {
  flex: 1;
  padding: 8px 20px calc(24px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  border: 1px solid var(--amber-dim);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--amber);
}
.link-btn {
  color: var(--amber);
  text-decoration: underline;
  font-size: 13px;
}

.fab-primary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: var(--amber);
  color: #1A1200;
  border-radius: var(--radius);
  padding: 34px 20px;
  font-weight: 600;
  font-size: 17px;
  box-shadow: 0 10px 30px -10px rgba(232, 163, 61, 0.55);
  position: relative;
  overflow: hidden;
}
.fab-primary::after {
  /* torn-stub notch, signature element */
  content: '';
  position: absolute;
  right: -12px;
  top: 50%;
  width: 24px;
  height: 24px;
  background: var(--ink);
  border-radius: 50%;
  transform: translateY(-50%);
}
.fab-primary::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  width: 24px;
  height: 24px;
  background: var(--ink);
  border-radius: 50%;
  transform: translateY(-50%);
}
.fab-plus { font-size: 30px; line-height: 1; font-weight: 300; }
.fab-primary:active { transform: scale(0.98); }

.recent h2 {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin: 0 0 12px;
}

.recent-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 14px;
}
.recent-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-type { color: var(--text-dim); font-size: 12px; }
.recent-link {
  color: var(--text-dim);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.recent-link svg { width: 15px; height: 15px; }
.recent-link:active { color: var(--amber); }

.empty { color: var(--text-dim); font-size: 14px; }

.tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--tag-color) 22%, var(--surface));
  color: var(--tag-color);
  white-space: nowrap;
}

/* --------------------------- Pickers --------------------------- */
.picker { flex: 1; padding: 8px 20px calc(24px + var(--safe-bottom)); }

.tile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.tile {
  aspect-ratio: 1.1;
  border-radius: var(--radius);
  background: var(--surface);
  border-top: 3px solid var(--tile-color);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  padding: 14px;
  text-align: left;
  gap: 2px;
}
.tile:active { background: var(--surface-raised); }
.tile-name { font-weight: 600; font-size: 15px; }
.tile-sub { font-size: 12px; color: var(--text-dim); }

.chip-list { display: flex; flex-direction: column; gap: 10px; }
.chip {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border-left: 3px solid var(--tile-color);
  border-radius: 10px;
  padding: 16px 16px;
  font-size: 15px;
  text-align: left;
  position: relative;
}
.chip:active { background: var(--surface-raised); }
.chip-icon svg { width: 20px; height: 20px; color: var(--tile-color); }
.chip-flag {
  margin-left: auto;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--red);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* --------------------------- Lock screen --------------------------- */
.lock {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}
.lock-mark svg { width: 40px; height: 40px; color: var(--amber); }
.lock-title {
  font-family: var(--font-mono);
  font-size: 15px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin: 4px 0 0;
}
.lock-sub { color: var(--text-dim); font-size: 14px; margin: 0 0 12px; }
.lock-input {
  width: 100%;
  max-width: 260px;
  font-size: 18px;
  text-align: center;
  letter-spacing: 0.2em;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px;
  color: var(--text);
}
.lock-input:focus { outline: none; border-color: var(--amber); }
.lock-error { color: var(--red); font-size: 13px; margin: 0; }
.lock .send-btn { max-width: 260px; margin-top: 8px; }

/* --------------------------- Form --------------------------- */
.form {
  flex: 1;
  padding: 8px 20px calc(120px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.field input,
.field textarea,
.field select {
  font-family: var(--font-sans);
  font-size: 16px;
  text-transform: none;
  letter-spacing: normal;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  color: var(--text);
  width: 100%;
}
.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: var(--amber);
}
.field textarea { resize: vertical; min-height: 90px; }

.voice-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 9px 16px;
  font-size: 13px;
  color: var(--text-dim);
}
.pill-btn svg { width: 15px; height: 15px; }
.pill-btn.active { color: var(--red); border-color: var(--red); }

.attachment-list { display: flex; flex-wrap: wrap; gap: 8px; }
.attachment-pill {
  background: var(--surface-raised);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-dim);
}
.attachment-pill button { color: var(--red); margin-left: 4px; font-size: 14px; }

.recording-indicator {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--red);
}
.hidden { display: none; }

.form-footer {
  position: sticky;
  bottom: 0;
  padding: 14px 20px calc(14px + var(--safe-bottom));
  background: linear-gradient(180deg, transparent, var(--ink) 30%);
}
.send-btn {
  width: 100%;
  background: var(--amber);
  color: #1A1200;
  font-weight: 600;
  font-size: 16px;
  border-radius: 12px;
  padding: 16px;
}
.send-btn:active { transform: scale(0.98); }
.send-btn:disabled { opacity: 0.6; }

.hint { color: var(--text-dim); font-size: 13px; line-height: 1.5; }
.hint--good { color: var(--green); }
.hint--bad { color: var(--red); }

/* --------------------------- Subtask picker --------------------------- */
#subtask-block { margin-top: -4px; }

.subtask-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subtask-search {
  font-family: var(--font-sans);
  font-size: 15px;
  background: var(--surface-raised);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text);
  width: 100%;
}
.subtask-search:focus { outline: none; border-color: var(--amber); }

.subtask-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}
.subtask-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--surface-raised);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  text-align: left;
}
.subtask-result:active { background: var(--line); }
.subtask-result-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.subtask-result-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  flex-shrink: 0;
}
.subtask-result--lookup { color: var(--amber); justify-content: center; }

.subtask-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--amber-dim);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
}
.subtask-chip svg { width: 15px; height: 15px; vertical-align: -2px; margin-right: 4px; color: var(--amber); }
.subtask-chip button {
  color: var(--red);
  font-size: 12px;
  text-decoration: underline;
  flex-shrink: 0;
}

.segmented {
  display: flex;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
  margin-bottom: 2px;
}
.segmented-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 8px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.segmented-btn svg { width: 14px; height: 14px; }
.segmented-btn.active {
  background: var(--amber);
  color: #1A1200;
}

.pill-btn--wide {
  width: 100%;
  justify-content: center;
  background: var(--amber);
  color: #1A1200;
  border: none;
  padding: 13px 16px;
  font-weight: 600;
}

.field-optional {
  text-transform: none;
  letter-spacing: normal;
  font-family: var(--font-sans);
  color: var(--text-dim);
  font-size: 11px;
}

/* --------------------------- Success --------------------------- */
.success {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.success-mark svg { width: 64px; height: 64px; color: var(--green); }
.success-text { font-size: 15px; color: var(--text-dim); }

/* --------------------------- Misc --------------------------- */
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
