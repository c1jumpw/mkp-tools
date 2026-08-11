/**
 * =============================================================================
 * FILE: src/components/VoiceNoteRecorder.jsx
 * VERSION: v3 (previously v1-v2 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Self-contained recording widget: captures microphone audio via
 *   MediaRecorder AND (where supported) live-transcribes it via the
 *   browser's built-in SpeechRecognition API, at the same time. When
 *   recording stops, hands the resulting {blob, transcript, durationSeconds,
 *   mimeType} up to the parent (TaskModal) via onRecorded — this component
 *   does NOT talk to Supabase itself; storage/persistence is the parent's
 *   responsibility (see voiceNotes.js and TaskModal.jsx).
 *
 * WHY THE WEB SPEECH API (AND ITS LIMITS)
 *   Automatic transcription needs SOME speech-to-text engine. Sending audio
 *   to a paid cloud STT API (e.g. Whisper) would require a secret API key,
 *   which can never be safely embedded in client-side code — it would need
 *   a backend proxy (e.g. a Supabase Edge Function) to hold that secret,
 *   which is real additional infrastructure beyond this app's current
 *   scope. The browser's own SpeechRecognition API sidesteps that entirely
 *   (no key, no server, runs during recording), but browser support is
 *   UNEVEN and this matters in practice:
 *     - Desktop Chrome/Edge: reliable.
 *     - Firefox: not supported at all — recording still works, transcript
 *       just starts blank for manual typing.
 *     - Safari / iOS (ALL browsers on iOS, since they're all WebKit under
 *       the hood regardless of "Chrome"/"Firefox" branding): support is
 *       inconsistent and, on many iOS versions, effectively non-functional
 *       even though the `webkitSpeechRecognition` symbol exists — this is a
 *       known platform limitation, not something fixable from application
 *       code. v1 silently swallowed recognition errors, which made this
 *       look like a silent bug rather than a browser limitation; v2 now
 *       surfaces a visible message when recognition errors out (see
 *       recognition.onerror below) so it's clear what happened.
 *   Given this unreliability, the workflow no longer treats a full,
 *   accurate live transcript as something to depend on — see the "Copy
 *   transcript" and "Download audio" actions added in v2, which make the
 *   RECORDING ITSELF (always reliable) the dependable artifact, with
 *   transcription as a best-effort bonus you can fall back from.
 *
 * STATE MACHINE
 *   'idle' -> (user taps Record) -> 'recording' -> (user taps Stop) ->
 *   'reviewing' (blob + transcript ready, not yet handed to parent) ->
 *   (user taps Use this recording) -> onRecorded() called -> back to 'idle'.
 *   'reviewing' also offers "Discard & re-record" -> back to 'idle' without
 *   calling onRecorded, "Copy transcript" (clipboard, no state change), and
 *   "Download audio" (browser file save, no state change).
 *
 * PROPS
 *   onRecorded {function} (blob, transcript, durationSeconds, mimeType) -> void
 *     Called once, when the user confirms a completed recording.
 *   disabled   {boolean}  Optional. Disables the Record button (e.g. while
 *                         a previous recording is still uploading).
 *
 * REVISION HISTORY
 *   v1 (initial build) — record + live-transcribe + review, silently
 *       swallowed SpeechRecognition errors.
 *   v2 (this version), per user feedback that automatic transcription
 *       "isn't loading" (traced to iOS/mobile Safari's inconsistent
 *       SpeechRecognition support — see WHY THE WEB SPEECH API above):
 *     - recognition.onerror now sets a visible `transcriptionNote` instead
 *       of failing silently, so a real failure is distinguishable from
 *       "nothing was said yet".
 *     - recognition.start() calls are now wrapped in try/catch, since some
 *       browsers throw synchronously rather than firing onerror if
 *       recognition can't start at all.
 *     - Added "Copy transcript" (clipboard) and "Download audio" (file
 *       save) actions to the reviewing step, so the recording and whatever
 *       transcript WAS captured are both easy to get out of the app
 *       immediately, independent of whether the user chooses to keep a
 *       permanent copy attached to the task (see TaskModal.jsx v4).
 *   v3 (this version), per continued mobile feedback:
 *     - The transcript box was still empty on mobile with NO error message
 *       at all — traced to a failure mode v2 didn't cover: some browsers
 *       accept recognition.start() without throwing AND never fire
 *       onerror, but also never produce a single onresult (a true silent
 *       no-op). Added a 6-second grace-period timeout that checks whether
 *       any result has arrived yet; if not, shows a plain "not detected,
 *       may not be supported on this device" message instead of leaving
 *       the box empty with no explanation.
 *     - "Download audio" now converts the recording to WAV before saving
 *       (via lib/wavEncoder.js), fixing the reported issue where
 *       downloaded .webm files were opened as VIDEO files by the OS (a
 *       real WebM-container file-association quirk) even though the
 *       content is audio-only. WAV is universally recognized as audio by
 *       every OS/player, at the cost of a larger file — an acceptable
 *       trade-off since this only affects the explicit download action,
 *       not what's stored in Supabase or played back in-app.
 * =============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import { convertToWav } from '../lib/wavEncoder'

// Feature detection, computed once at module load (these don't change
// during the page's lifetime).
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
const canRecordAudio = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)

// Picks the first MediaRecorder-supported MIME type from a preference list.
function pickSupportedMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  return '' // let the browser pick its own default
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Same extension-guessing logic as lib/voiceNotes.js's uploadVoiceNote, used
// here only for the download filename (not for the actual upload path).
function extensionForMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

export default function VoiceNoteRecorder({ onRecorded, disabled }) {
  const [status, setStatus] = useState('idle') // 'idle' | 'recording' | 'reviewing'
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [reviewBlob, setReviewBlob] = useState(null)
  const [reviewUrl, setReviewUrl] = useState(null)
  const [reviewTranscript, setReviewTranscript] = useState('')
  const [error, setError] = useState('')
  const [transcriptionNote, setTranscriptionNote] = useState('') // best-effort status/error for the SpeechRecognition side specifically
  const [copyStatus, setCopyStatus] = useState('') // '' | 'copied' — transient button feedback
  const [downloadBusy, setDownloadBusy] = useState(false)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const recognitionRef = useRef(null)
  const finalTranscriptRef = useRef('') // accumulates FINAL speech results across the whole recording
  const startTimeRef = useRef(null)
  const tickIntervalRef = useRef(null)
  const mimeTypeRef = useRef('')
  const hasReceivedResultRef = useRef(false) // did recognition.onresult ever fire this session?
  const silentCheckTimeoutRef = useRef(null)

  useEffect(() => {
    return () => {
      stopMediaTracks()
      if (recognitionRef.current) recognitionRef.current.stop()
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
      if (silentCheckTimeoutRef.current) clearTimeout(silentCheckTimeoutRef.current)
      if (reviewUrl) URL.revokeObjectURL(reviewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopMediaTracks() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  async function startRecording() {
    setError('')
    setTranscriptionNote('')
    setCopyStatus('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickSupportedMimeType()
      mimeTypeRef.current = mimeType
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setReviewBlob(blob)
        setReviewUrl(url)
        setReviewTranscript(finalTranscriptRef.current.trim())
        setStatus('reviewing')
      }
      mediaRecorderRef.current = recorder
      recorder.start()

      // Live transcription, running IN PARALLEL with the audio recording
      // above. See WHY THE WEB SPEECH API in the file header for why this
      // is treated as best-effort rather than guaranteed.
      finalTranscriptRef.current = ''
      hasReceivedResultRef.current = false
      setLiveTranscript('')
      if (SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = navigator.language || 'en-US'
        recognition.onresult = (event) => {
          hasReceivedResultRef.current = true
          let interim = ''
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i]
            if (res.isFinal) {
              finalTranscriptRef.current += res[0].transcript + ' '
            } else {
              interim += res[0].transcript
            }
          }
          setLiveTranscript((finalTranscriptRef.current + interim).trim())
        }
        // v2: surface the error instead of swallowing it, so "nothing is
        // appearing" is distinguishable from "recognition actually failed".
        // Common event.error values: 'not-allowed' (mic/permission denied
        // specifically for recognition), 'network', 'no-speech', 'aborted'.
        recognition.onerror = (event) => {
          setTranscriptionNote(
            `Live transcription stopped (${event.error}). The recording itself is unaffected — you can type the transcript below, or use "Copy transcript" for whatever was captured.`
          )
        }
        recognition.onend = () => {
          // Some browsers auto-stop recognition after a pause even with
          // continuous:true. If we're still actively recording, restart it.
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            try {
              recognition.start()
            } catch {
              // Restart failed (e.g. browser refuses a rapid restart) —
              // recording continues regardless; transcription just stops
              // gaining new text from this point.
            }
          }
        }
        try {
          recognition.start()
          recognitionRef.current = recognition
          // v2 fix for the "transcript box just stays empty, no error at
          // all" report: some browsers (notably several mobile Safari
          // versions) accept recognition.start() without throwing AND never
          // fire onerror, but also never produce a single onresult — a
          // silent do-nothing failure mode neither try/catch nor onerror
          // can detect on their own. After a grace period, if nothing has
          // come through yet, tell the user plainly instead of leaving them
          // staring at an empty box wondering if it's working.
          silentCheckTimeoutRef.current = setTimeout(() => {
            if (!hasReceivedResultRef.current && mediaRecorderRef.current?.state === 'recording') {
              setTranscriptionNote(
                'No speech detected yet by this browser\'s transcription — it may not be supported on this device. The recording itself continues normally; you can type the transcript after stopping.'
              )
            }
          }, 6000)
        } catch (err) {
          // Some browsers (notably several iOS Safari versions) throw
          // synchronously here rather than firing onerror.
          setTranscriptionNote('Live transcription could not start on this device/browser. Recording will continue normally.')
        }
      }

      startTimeRef.current = Date.now()
      setElapsedSeconds(0)
      tickIntervalRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)

      setStatus('recording')
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Check your browser/site permissions and try again.'
          : 'Could not start recording: ' + (err.message || 'unknown error')
      )
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop() // triggers onstop above, which sets status to 'reviewing'
    }
    stopMediaTracks()
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }
    if (silentCheckTimeoutRef.current) {
      clearTimeout(silentCheckTimeoutRef.current)
      silentCheckTimeoutRef.current = null
    }
  }

  function discardAndReset() {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl)
    setReviewBlob(null)
    setReviewUrl(null)
    setReviewTranscript('')
    setElapsedSeconds(0)
    setStatus('idle')
  }

  function confirmUse() {
    onRecorded(reviewBlob, reviewTranscript.trim(), elapsedSeconds, mimeTypeRef.current || 'audio/webm')
    // Don't revoke reviewUrl here — TaskModal may still want to show it
    // briefly, and it'll be released naturally on next recording/unmount.
    setReviewBlob(null)
    setElapsedSeconds(0)
    setStatus('idle')
  }

  // Converts the just-recorded blob to WAV for maximum OS/player
  // compatibility, then triggers a real file-save. See lib/wavEncoder.js
  // for why this conversion happens (webm downloads were being opened as
  // video files by the OS) and why it's WAV specifically, not another
  // compressed format.
  async function downloadRecording() {
    setDownloadBusy(true)
    setError('')
    let url
    let filename
    try {
      const wavBlob = await convertToWav(reviewBlob)
      url = URL.createObjectURL(wavBlob)
      filename = `dayforge-voice-note-${Date.now()}.wav`
    } catch {
      // Conversion failed (rare — an undecodable source) — fall back to the
      // original recording rather than blocking the download entirely.
      url = reviewUrl
      filename = `dayforge-voice-note-${Date.now()}.${extensionForMimeType(mimeTypeRef.current)}`
      setError('Could not convert to WAV — downloaded in the original recording format instead.')
    }
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    if (url !== reviewUrl) URL.revokeObjectURL(url)
    setDownloadBusy(false)
  }

  // Copies whatever transcript text exists (even if partial/empty) to the
  // clipboard, so it can be pasted elsewhere without needing to keep it
  // permanently attached to the task — see file header REVISION HISTORY.
  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(reviewTranscript)
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus(''), 2000)
    } catch {
      setError('Could not copy to clipboard — your browser may require a manual copy.')
    }
  }

  if (!canRecordAudio) {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        Voice recording isn't supported in this browser. Try Chrome, Edge, or Safari.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-[var(--color-ember)]">{error}</p>}

      {status === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          className="flex items-center gap-2 text-sm border border-[var(--color-line)] rounded px-3 py-1.5 hover:border-[var(--color-ember)] disabled:opacity-40 transition"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-ember)]" />
          Record voice note
        </button>
      )}

      {status === 'recording' && (
        <div className="border border-[var(--color-line)] rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-ember)] animate-pulse" />
            <span className="text-sm font-medium">Recording… {formatDuration(elapsedSeconds)}</span>
            <button
              type="button"
              onClick={stopRecording}
              className="ml-auto text-sm bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-3 py-1 hover:brightness-110 transition"
            >
              Stop
            </button>
          </div>
          {transcriptionNote ? (
            <p className="text-xs text-[var(--color-ember)]">{transcriptionNote}</p>
          ) : SpeechRecognitionCtor ? (
            <p className="text-xs text-[var(--color-muted)] italic min-h-[1.5em]">
              {liveTranscript || 'Listening…'}
            </p>
          ) : (
            <p className="text-xs text-[var(--color-muted)]">
              Live transcription isn't available in this browser — you can type the transcript after stopping.
            </p>
          )}
        </div>
      )}

      {status === 'reviewing' && (
        <div className="border border-[var(--color-line)] rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Recorded — {formatDuration(elapsedSeconds)}</span>
          </div>
          <audio controls src={reviewUrl} className="w-full h-8" />
          <div>
            <label className="blueprint-tick uppercase block mb-1">Transcript (edit if needed)</label>
            <textarea
              value={reviewTranscript}
              onChange={(e) => setReviewTranscript(e.target.value)}
              rows={3}
              placeholder={SpeechRecognitionCtor ? '' : 'Type a transcript manually — automatic transcription is unavailable in this browser.'}
              className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm resize-none focus:border-[var(--color-ember)] outline-none"
            />
          </div>
          {/* Copy/Download work regardless of whether this recording is
              ultimately kept attached to the task — an immediate way to get
              the artifact out of the app. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copyTranscript}
              disabled={!reviewTranscript.trim()}
              className="text-xs text-[var(--color-steel)] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
            >
              {copyStatus === 'copied' ? 'Copied!' : 'Copy transcript'}
            </button>
            <a
              href={reviewUrl}
              onClick={(e) => { e.preventDefault(); downloadRecording() }}
              className={'text-xs text-[var(--color-steel)] hover:brightness-110 ' + (downloadBusy ? 'opacity-40 pointer-events-none' : '')}
            >
              {downloadBusy ? 'Converting…' : 'Download audio (.wav)'}
            </a>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={discardAndReset}
              className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] px-3 py-1"
            >
              Discard &amp; re-record
            </button>
            <button
              type="button"
              onClick={confirmUse}
              className="text-sm bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-3 py-1 hover:brightness-110 transition"
            >
              Use this recording
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
