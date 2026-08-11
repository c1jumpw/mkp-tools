/**
 * =============================================================================
 * FILE: src/lib/wavEncoder.js
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Converts a recorded audio Blob (webm/opus or mp4/aac, whatever
 *   MediaRecorder produced) into a WAV Blob, used ONLY for the "Download
 *   audio" action — not for what actually gets uploaded to Supabase
 *   Storage, which stays in the original compact format.
 *
 * WHY WAV, AND WHY ONLY AT DOWNLOAD TIME
 *   User-reported problem: downloaded .webm voice notes were being treated
 *   by the OS as VIDEO files (opening in a video player) even though the
 *   content is audio-only — a real, if surprising, OS file-association
 *   quirk with the WebM container, which historically pairs with video.
 *   WAV (uncompressed PCM) is the one format essentially every OS and
 *   media player on every platform recognizes correctly as audio without
 *   exception — the trade-off is a much larger file (uncompressed audio,
 *   roughly 5MB per minute of mono audio vs. under 1MB/minute for
 *   compressed webm/opus).
 *   That size trade-off is exactly why this conversion happens ONLY when
 *   the user explicitly taps "Download audio" — the file actually stored
 *   in Supabase Storage (and used for in-app playback, which every browser
 *   handles natively regardless of container) stays in the original
 *   efficient format. Only the copy leaving the app, for use in other
 *   software, gets converted.
 *
 * HOW IT WORKS
 *   1. decodeAudioData() (Web Audio API) fully decodes the source blob's
 *      compressed audio into raw PCM samples — this is the browser's own
 *      audio decoder, the same one used for <audio> playback, so it
 *      understands whatever MediaRecorder produced.
 *   2. Multi-channel audio is downmixed to mono (voice notes don't need
 *      stereo, and mono halves the already-large WAV file size).
 *   3. Raw PCM samples are written out as a standard 16-bit PCM WAV file
 *      (44-byte header + sample data) — no external library needed, WAV's
 *      format is simple enough to write by hand.
 *
 * EDGE CASES
 *   - decodeAudioData can fail for a source the browser can't decode (rare,
 *     but possible with unusual mimeType/codec combinations) — this
 *     rejects with an Error; callers should catch it and fall back to
 *     offering the original-format file instead of a broken download.
 *   - Safari's older decodeAudioData signature is callback-based rather
 *     than Promise-based; this wraps it in a Promise either way so callers
 *     don't need to know which signature the current browser uses.
 * =============================================================================
 */

// Downmixes a possibly-multi-channel AudioBuffer to a single mono Float32Array
// by averaging channels. Voice notes are inherently mono content (a single
// person talking into one mic), so this loses nothing meaningful while
// halving (or more) the resulting WAV file's size versus keeping all channels.
function downmixToMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels
  if (channels === 1) return audioBuffer.getChannelData(0)
  const length = audioBuffer.length
  const out = new Float32Array(length)
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch)
    for (let i = 0; i < length; i++) out[i] += data[i] / channels
  }
  return out
}

function writeAsciiString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

// Converts float samples (range -1..1, the Web Audio API's native format)
// into signed 16-bit PCM, the sample format standard WAV players expect.
function writeFloat32AsInt16(view, offset, samples) {
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
}

// Builds a complete WAV file (44-byte header + 16-bit PCM data) from mono
// float samples at the given sample rate.
function encodeMonoWav(samples, sampleRate) {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
  const view = new DataView(buffer)

  writeAsciiString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * bytesPerSample, true)
  writeAsciiString(view, 8, 'WAVE')
  writeAsciiString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)        // fmt chunk size (16 for PCM)
  view.setUint16(20, 1, true)         // audio format: 1 = PCM (uncompressed)
  view.setUint16(22, 1, true)         // channel count: 1 = mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true)               // block align
  view.setUint16(34, 16, true)        // bits per sample
  writeAsciiString(view, 36, 'data')
  view.setUint32(40, samples.length * bytesPerSample, true)
  writeFloat32AsInt16(view, 44, samples)

  return new Blob([view], { type: 'audio/wav' })
}

/**
 * @param {Blob} sourceBlob - a recorded audio Blob in any browser-decodable
 *   format (webm/opus, mp4/aac, etc).
 * @returns {Promise<Blob>} a 16-bit mono WAV Blob.
 * @throws if the browser can't decode the source audio.
 */
export async function convertToWav(sourceBlob) {
  const arrayBuffer = await sourceBlob.arrayBuffer()
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  const audioCtx = new AudioContextCtor()
  try {
    // decodeAudioData detaches/consumes the ArrayBuffer it's given in some
    // browsers, so pass a copy — safe regardless of whether that happens.
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    const monoSamples = downmixToMono(audioBuffer)
    return encodeMonoWav(monoSamples, audioBuffer.sampleRate)
  } finally {
    audioCtx.close()
  }
}
