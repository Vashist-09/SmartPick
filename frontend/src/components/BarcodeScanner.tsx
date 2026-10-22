import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';

export function BarcodeScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let active = true;
    void reader.decodeFromConstraints({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }, videoRef.current!, (result, error, scannerControls) => {
      controls = scannerControls;
      if (result && active) {
        active = false;
        controls.stop();
        onScan(result.getText().trim());
      } else if (error && error.name !== 'NotFoundException' && active) {
        setCameraError(error.message || 'Could not read a barcode.');
      }
    }).catch((error: unknown) => {
      if (active) setCameraError(error instanceof Error ? error.message : 'Could not start the camera.');
    });
    return () => { active = false; controls?.stop(); };
  }, [onScan]);

  return <div className="scanner-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <div className="section-heading"><div><span className="eyebrow">STUDENT ID SCANNER</span><h2 id="scanner-title">Scan student ID card</h2></div><button type="button" className="scanner-close" onClick={onClose} aria-label="Close scanner">×</button></div>
      <video ref={videoRef} className="scanner-video" muted playsInline />
      <p className="hint">Allow camera access and hold the barcode inside the frame.</p>
      {cameraError && <p className="notice error">{cameraError}. Enter the registration number manually instead.</p>}
    </section>
  </div>;
}
