// Short "scan accepted" beep, synthesized with the Web Audio API (no sound
// file to host). Browsers only let audio start after a user gesture, so call
// primeBeep() from the click that opens a scanner; playBeep() can then fire
// later from the scan callback.

let context: AudioContext | null = null

function audioContext() {
  if (context) return context
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  context = new Ctor()
  return context
}

export function primeBeep() {
  try {
    void audioContext()?.resume()
  } catch {
    // No audio available -- scanning still works silently.
  }
}

export function playBeep() {
  try {
    const ctx = audioContext()
    if (!ctx) return
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 1320
    // Quick fade in/out so it clicks less and sounds like a scanner.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.15)
  } catch {
    // Ignore -- the beep is a nicety.
  }
}
