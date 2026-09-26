import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw } from 'lucide-react'
import type { IScannerControls } from '@zxing/browser'
import { Modal } from './Modal'
import { Button } from './Button'
import { playBeep } from '../../lib/beep'

// Camera barcode/QR scanner in a modal. Decodes with @zxing/browser, which is
// imported only when a scanner opens, so it costs nothing on normal page
// loads. On the first successful read it stops the camera, beeps, vibrates
// (phones), and hands the code to onDetected; the caller closes the modal.
//
// Callers should call primeBeep() in the click that opens this, so the beep
// is allowed to play later.

type Status = 'starting' | 'scanning' | 'error'

function describeCameraError(err: unknown): string {
  const name = err instanceof Error || err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'Camera access was blocked. Allow camera access for this site in your browser settings (usually the icon next to the address bar), then try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The camera is being used by another app or tab. Close it and try again.'
    default:
      return err instanceof Error && err.message ? err.message : 'The camera could not be started.'
  }
}

export function CameraScanner({
  title = 'Scan barcode',
  onDetected,
  onClose,
}: {
  title?: string
  onDetected: (code: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected
  const [status, setStatus] = useState<Status>('starting')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let controls: IScannerControls | undefined
    let cancelled = false
    let detected = false

    async function start() {
      setStatus('starting')
      setError(null)
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning needs a secure (https) connection and a browser with camera support.')
        setStatus('error')
        return
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled || !videoRef.current) return
        const reader = new BrowserMultiFormatReader()
        controls = await reader.decodeFromConstraints(
          // Prefer the rear camera on phones; laptops just use their webcam.
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          videoRef.current,
          (result, _err, scanControls) => {
            if (!result || detected) return
            detected = true
            scanControls.stop()
            playBeep()
            navigator.vibrate?.(60)
            onDetectedRef.current(result.getText().trim())
          },
        )
        if (cancelled) controls.stop()
        else setStatus('scanning')
      } catch (err) {
        if (cancelled) return
        setError(describeCameraError(err))
        setStatus('error')
      }
    }

    start()
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [attempt])

  return (
    <Modal title={title} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-primary">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {status === 'scanning' && (
            // Viewfinder guide.
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-2/5 w-4/5 rounded-lg border-2 border-surface/80 shadow-[0_0_0_9999px_rgb(15_23_42/0.35)]" />
            </div>
          )}
          {status === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-surface/90">
              <Camera size={28} />
              Starting camera…
            </div>
          )}
        </div>

        {status === 'error' ? (
          <div className="rounded-lg border border-danger-600/20 bg-danger-50 px-3 py-2.5 text-sm text-danger-600" role="alert">
            {error}
            <p className="mt-1 text-xs text-text-muted">You can still type the code, or use a USB barcode scanner.</p>
          </div>
        ) : (
          <p className="text-center text-sm text-text-muted" role="status">
            {status === 'scanning' ? 'Point the camera at a barcode or QR code.' : 'Waiting for camera permission…'}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {status === 'error' && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
              <RefreshCw size={14} />
              Try again
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
