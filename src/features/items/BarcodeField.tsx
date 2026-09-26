import { useState } from 'react'
import { ScanLine } from 'lucide-react'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { CameraScanner } from '../../components/ui/CameraScanner'
import { primeBeep } from '../../lib/beep'

// The item Barcode input with a "Scan" button beside it: opens the camera
// scanner and fills the field with whatever it reads. Typing (or a USB
// scanner) still works as before.
export function BarcodeField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string | null) => void
}) {
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)

  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Barcode"
            value={value}
            onChange={(e) => {
              setScanned(false)
              onChange(e.target.value || null)
            }}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          onClick={() => {
            primeBeep()
            setScanning(true)
          }}
        >
          <ScanLine size={16} />
          Scan
        </Button>
      </div>
      {scanned && (
        <p className="mt-1 text-xs text-success-600" role="status">
          Barcode scanned.
        </p>
      )}
      {scanning && (
        <CameraScanner
          title="Scan item barcode"
          onDetected={(code) => {
            onChange(code || null)
            setScanned(true)
            setScanning(false)
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  )
}
