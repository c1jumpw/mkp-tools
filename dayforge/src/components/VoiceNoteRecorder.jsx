/**
 * =============================================================================
 * FILE: src/components/VoiceNoteRecorder.jsx
 * VERSION: v1 (new file)
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
 *   (no key, no server, runs during recording) at the cost of narrower
 *   browser support: it works in Chrome, Edge, and Safari, but NOT Firefox
 *   (as of this writing). When unsupported, recording still works — the
 *   transcript field just starts blank and the user can type it manually.
 *   TODO: if a specific browser's transcription quality proves
 *   insufficient, swapping in a cloud STT service is possible later, but
 *   requires standing up a small backend proxy first — flagged as a
 *   deliberate scope boundary, not an oversight.
 *
 * STATE MACHINE
 *   'idle' -> (user taps Record) -> 'recording' -> (user taps Stop) ->
 *   'reviewing' (blob + transcript ready, not yet handed to parent) ->
 *   (user taps Use this recording) -> onRecorded() called -> back to 'idle'.
 *   'reviewing' also offers "Discard & re-record" -> back to 'idle' without
 *   calling onRecorded.
 *
 * PROPS
 *   onRecorded {function} (blob, transcript, durationSeconds, mimeType) -> void
 *     Called once, when the user confirms a completed recording.
 *   disabled   {boolean}  Optional. Disables the Record button (e.g. while
 *                         a previous recording is still uploading).
 *
 * BROWSER SUPPORT / PERMISSIONS
 *   Requires navigator.mediaDevices.getUserMedia and window.MediaRecorder.
 *   If either is missing (very old browser, or a non-HTTPS context — mic
 *   access requires a secure origin), shows a plain explanatory message
 *   instead of the recording controls. The user will also see the browser's
 *   own microphone-permission prompt on first use; a denial surfaces via
 *   the try/catch in startRecording() as a friendly inline error rather
 *   than an uncaught exception.
 * =============================================================================
 */

import { useEffect, useRef, useState } from 'react'

// Feature detection, computed once at module load (these don't change
// during the page's lifetime).
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
const canRecordAudio = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)

// Picks the first MediaRecorder-supported MIME type from a preference list.
// Browsers vary in what they support — Chrome/Firefox generally offer
// webm/opus, Safari offers mp4 — so we ask the browser rather than assuming.
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

export default function VoiceNoteRecorder({ onRecorded, disabled }) {
  const [status, setStatus] = useState('idle') // 'idle' | 'recording' | 'reviewing'
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [reviewBlob, setReviewBlob] = useState(null)
  const [reviewUrl, setReviewUrl] = useState(null)
  const [reviewTranscript, setReviewTranscript] = useState('')
  const [error, setError] = useState('')

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const recognitionRef = useRef(null)
  const finalTranscriptRef = useRef('') // accumulates FINAL speech results across the whole recording
  const startTimeRef = useRef(null)
  const tickIntervalRef = useRef(null)
  const mimeTypeRef = useRef('')

  // Cleanup on unmount: stop any in-progress recording/recognition and
  // release the review object URL, so nothing keeps the mic active or
  // leaks memory after the component is gone (e.g. modal closed mid-recording).
  useEffect(() => {
    return () => {
      stopMediaTracks()
      if (recognitionRef.current) recognitionRef.current.stop()
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
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
      // above — entirely separate browser API, not derived from the
      // MediaRecorder's output.
      finalTranscriptRef.current = ''
      setLiveTranscript('')
      if (SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = navigator.language || 'en-US'
        recognition.onresult = (event) => {
          let interim = ''
          // event.resultIndex marks where NEW results start since the last
          // callback — only that slice needs (re)processing, not the whole
          // results list every time.
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
        recognition.onerror = () => {
          // Non-fatal: recording continues regardless of transcription
          // errors (e.g. a brief network hiccup for the recognition
          // service) — the user can still type/fix the transcript after.
        }
        recognition.onend = () => {
          // Some browsers auto-stop recognition after a pause in speech
          // even with continuous:true. If we're still actively recording,
          // restart it so a long recording doesn't silently lose
          // transcription partway through.
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            try { recognition.start() } catch { /* already starting/stopping; ignore */ }
          }
        }
        recognition.start()
        recognitionRef.current = recognition
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
          {SpeechRecognitionCtor ? (
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
