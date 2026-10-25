import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createAcceptor } from '../scanner/acceptor';
import { attachAndPlay, CameraError, cameraErrorFrom, listCameras, openCamera, setTorch, stopStream, tuneTrack } from '../scanner/camera';
import { ENABLED_FORMATS, formatLabel } from '../scanner/decodeCore';
import { DecoderClient, DecoderTimeoutError } from '../scanner/decoderClient';
import { describeIdentifierProblem, normalizeRegistration, redact } from '../scanner/identifier';
import type { Rect, RgbaImage } from '../scanner/imageOps';
import { getNativeDetector, type NativeDetector } from '../scanner/nativeDetector';

export type ScanDetection = { value: string; format: string; source: 'camera' | 'upload' };

type Phase = 'starting' | 'scanning' | 'decoding-upload' | 'invalid' | 'no-code-in-upload' | 'error';
type Stats = { frames: number; lastMs: number; resolution: string; camera: string; decoder: 'loading' | 'ready' | 'failed'; native: string; lastRead: string };

const FRAME_INTERVAL_MS = 60;
const MAX_FRAME_SIDE = 1600;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const DEBUG = import.meta.env.DEV || (() => { try { return localStorage.getItem('smartpick:scanner-debug') === '1'; } catch { return false; } })();
const debug = (...args: unknown[]) => { if (DEBUG) console.debug('[scanner]', ...args); };

/** Reads the current video frame into RGBA pixels, scaled so the longest side is at most MAX_FRAME_SIDE. */
function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): { image: RgbaImage; factor: number } | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (video.readyState < 2 || !vw || !vh) return null;
  const factor = Math.min(1, MAX_FRAME_SIDE / Math.max(vw, vh));
  const w = Math.round(vw * factor), h = Math.round(vh * factor);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return { image: { data: data.data, width: w, height: h }, factor };
}

/** Maps the on-screen guide box onto frame pixels, accounting for object-fit: cover cropping. */
function guideInFrame(video: HTMLVideoElement, guide: HTMLElement, factor: number): Rect | undefined {
  const v = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
  if (!v.width || !v.height || !video.videoWidth) return undefined;
  const s = Math.max(v.width / video.videoWidth, v.height / video.videoHeight);
  const offX = (video.videoWidth * s - v.width) / 2, offY = (video.videoHeight * s - v.height) / 2;
  const x = (g.left - v.left + offX) / s, y = (g.top - v.top + offY) / s;
  // Pad the guide a little so a barcode touching its edge is still fully inside the decoded region.
  const pad = 0.06;
  return { x: (x - g.width / s * pad) * factor, y: (y - g.height / s * pad) * factor, width: g.width / s * (1 + 2 * pad) * factor, height: g.height / s * (1 + 2 * pad) * factor };
}

async function fileToImage(file: File, canvas: HTMLCanvasElement): Promise<RgbaImage> {
  let source: ImageBitmap | HTMLImageElement;
  try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { source = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This file could not be read as an image.')); img.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
  const sw = source.width, sh = source.height;
  const factor = Math.min(1, 2400 / Math.max(sw, sh));
  canvas.width = Math.max(1, Math.round(sw * factor)); canvas.height = Math.max(1, Math.round(sh * factor));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: canvas.width, height: canvas.height };
}

export function BarcodeScanner({ onDetected, onClose, onEditManually }: { onDetected: (d: ScanDetection) => void; onClose: () => void; onEditManually: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderRef = useRef<DecoderClient | null>(null);
  const decoderReadyRef = useRef<Promise<void> | null>(null);
  const sessionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passRef = useRef(0);
  const acceptorRef = useRef(createAcceptor());
  const timeoutsRef = useRef(0);
  const callbacks = useRef({ onDetected, onClose, onEditManually });
  callbacks.current = { onDetected, onClose, onEditManually };

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [invalid, setInvalid] = useState<{ raw: string; format: string; message: string } | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [torch, setTorchState] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [stats, setStats] = useState<Stats>({ frames: 0, lastMs: 0, resolution: '—', camera: '—', decoder: 'loading', native: 'checking…', lastRead: '—' });
  const [slowHint, setSlowHint] = useState(false);
  const nativeRef = useRef<NativeDetector | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvas = () => (canvasRef.current ??= document.createElement('canvas'));

  /** Creates the decoder worker, or recreates it if a previous load failed (so Retry can recover). */
  const ensureDecoder = useCallback(() => {
    if (decoderRef.current && decoderReadyRef.current) return decoderReadyRef.current;
    const decoder = new DecoderClient();
    decoderRef.current = decoder;
    setStats(s => ({ ...s, decoder: 'loading' }));
    const ready = decoder.init().then(
      () => { setStats(s => ({ ...s, decoder: 'ready' })); debug('decoder ready', ENABLED_FORMATS.join(',')); },
      (e: unknown) => {
        setStats(s => ({ ...s, decoder: 'failed' }));
        decoder.terminate();
        if (decoderRef.current === decoder) { decoderRef.current = null; decoderReadyRef.current = null; }
        throw e;
      },
    );
    ready.catch(() => undefined);
    decoderReadyRef.current = ready;
    return ready;
  }, []);

  const stopCamera = useCallback(() => {
    sessionRef.current++;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (slowTimerRef.current) { clearTimeout(slowTimerRef.current); slowTimerRef.current = null; }
    stopStream(streamRef.current); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchState({ supported: false, on: false });
  }, []);

  const fail = useCallback((kind: string, message: string) => { stopCamera(); setError({ kind, message }); setPhase('error'); debug('error', kind); }, [stopCamera]);

  /** Validates an accepted decode and either hands it to the page or shows why it cannot be used. */
  const handleDecoded = useCallback((text: string, format: string, source: ScanDetection['source']) => {
    const check = normalizeRegistration(text);
    setStats(s => ({ ...s, lastRead: `${formatLabel(format)} · ${redact(check.value)}` }));
    debug('decoded', format, redact(check.value), source);
    if (!check.ok) { stopCamera(); setInvalid({ raw: check.value, format, message: describeIdentifierProblem(check) }); setPhase('invalid'); return; }
    stopCamera();
    navigator.vibrate?.(60);
    callbacks.current.onDetected({ value: check.value, format, source });
  }, [stopCamera]);

  const scanLoop = useCallback(async (session: number) => {
    const video = videoRef.current, decoder = decoderRef.current;
    if (session !== sessionRef.current || !video || !decoder) return;
    const native = nativeRef.current;
    if (native && video.readyState >= 2) {
      try {
        const hit = await native.detect(video);
        if (session !== sessionRef.current) return;
        if (hit) {
          const accepted = acceptorRef.current.feed(hit, performance.now());
          if (accepted) { handleDecoded(accepted.text, accepted.format, 'camera'); return; }
        }
      } catch (e) { debug('native detector failed; continuing with zxing only', e); nativeRef.current = null; setStats(s => ({ ...s, native: 'failed, using zxing only' })); }
    }
    const frame = grabFrame(video, canvas());
    if (frame) {
      const guide = guideRef.current ? guideInFrame(video, guideRef.current, frame.factor) : undefined;
      try {
        const { result, ms } = await decoder.decodeFrame(frame.image, passRef.current++, guide);
        if (session !== sessionRef.current) return;
        timeoutsRef.current = 0;
        setStats(s => ({ ...s, frames: s.frames + 1, lastMs: Math.round(ms) }));
        if (result) {
          const accepted = acceptorRef.current.feed({ text: result.text, format: result.format }, performance.now());
          if (accepted) { handleDecoded(accepted.text, accepted.format, 'camera'); return; }
        }
      } catch (e) {
        if (session !== sessionRef.current) return;
        if (e instanceof DecoderTimeoutError && ++timeoutsRef.current < 3) debug('decoder timeout, continuing');
        else { fail('decoder', `The barcode decoder stopped working (${e instanceof Error ? e.message : 'unknown error'}). Press Retry.`); return; }
      }
    }
    if (session === sessionRef.current) timerRef.current = setTimeout(() => void scanLoop(session), FRAME_INTERVAL_MS);
  }, [fail, handleDecoded]);

  const start = useCallback(async (requestedDevice?: string) => {
    stopCamera();
    const session = ++sessionRef.current;
    acceptorRef.current.reset(); passRef.current = 0; timeoutsRef.current = 0;
    setError(null); setInvalid(null); setSlowHint(false); setPhase('starting');
    try {
      const stream = await openCamera(requestedDevice);
      if (session !== sessionRef.current) { stopStream(stream); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stopStream(stream); return; }
      await attachAndPlay(video, stream);
      if (session !== sessionRef.current) return;
      const track = stream.getVideoTracks()[0];
      const { torch: torchSupported } = await tuneTrack(track);
      const settings = track.getSettings();
      setDeviceId(settings.deviceId);
      setTorchState({ supported: torchSupported, on: false });
      setStats(s => ({ ...s, frames: 0, resolution: `${video.videoWidth}×${video.videoHeight}`, camera: track.label || 'Camera' }));
      debug('camera ready', track.label, video.videoWidth, video.videoHeight);
      void listCameras().then(list => { if (session === sessionRef.current) setCameras(list); });
    } catch (e) {
      if (session !== sessionRef.current) return;
      const ce = e instanceof CameraError ? e : cameraErrorFrom(e);
      fail(ce.kind, ce.message);
      return;
    }
    try {
      await ensureDecoder();
    } catch (e) {
      if (session !== sessionRef.current) return;
      fail('decoder', `The barcode decoder could not be loaded (${e instanceof Error ? e.message : 'unknown error'}). Reload the page and try again, or type the registration number.`);
      return;
    }
    nativeRef.current = await getNativeDetector();
    setStats(s => ({ ...s, native: nativeRef.current ? `on (${nativeRef.current.formats.length} formats)` : 'not available in this browser' }));
    if (session !== sessionRef.current) return;
    setPhase('scanning');
    slowTimerRef.current = setTimeout(() => { if (session === sessionRef.current) setSlowHint(true); }, 8000);
    void scanLoop(session);
  }, [ensureDecoder, fail, scanLoop, stopCamera]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    ensureDecoder();
    void start();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); callbacks.current.onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopCamera();
      decoderRef.current?.terminate();
      decoderRef.current = null; decoderReadyRef.current = null;
      previousFocus?.focus?.();
    };
  }, [ensureDecoder, start, stopCamera]);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError({ kind: 'upload', message: 'Choose an image file (a photo or screenshot of the card).' }); setPhase('error'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError({ kind: 'upload', message: 'That image is larger than 15 MB. Choose a smaller photo.' }); setPhase('error'); return; }
    stopCamera();
    const session = sessionRef.current;
    setError(null); setInvalid(null); setPhase('decoding-upload');
    try {
      await ensureDecoder();
      const image = await fileToImage(file, canvas());
      const native = await getNativeDetector();
      const nativeHit = native ? await native.detect(canvas()).catch(() => null) : null;
      if (session !== sessionRef.current) return;
      if (nativeHit) { handleDecoded(nativeHit.text, nativeHit.format, 'upload'); return; }
      const { result } = await decoderRef.current!.decodeStill(image);
      if (session !== sessionRef.current) return;
      if (result) handleDecoded(result.text, result.format, 'upload');
      else setPhase('no-code-in-upload');
    } catch (err) {
      if (session !== sessionRef.current) return;
      setError({ kind: 'upload', message: err instanceof Error ? `The photo could not be scanned: ${err.message}` : 'The photo could not be scanned.' }); setPhase('error');
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await setTorch(track, !torch.on); setTorchState(t => ({ ...t, on: !t.on })); }
    catch { setTorchState({ supported: false, on: false }); }
  }

  const status = {
    starting: 'Starting camera…',
    scanning: 'Scanning — fit the whole card inside the frame, about 15–25 cm from the camera, and hold it steady.',
    'decoding-upload': 'Reading the barcode in your photo…',
    invalid: 'A code was read, but it is not a valid registration number.',
    'no-code-in-upload': 'No supported barcode was found in that photo. Try a sharper, well-lit photo where the barcode fills more of the picture.',
    error: error?.message ?? 'Something went wrong.',
  }[phase];
  const cameraActive = phase === 'starting' || phase === 'scanning';

  return <div className="scanner-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="scanner-title" aria-describedby="scanner-status">
      <div className="section-heading">
        <div><span className="eyebrow">STUDENT ID SCANNER</span><h2 id="scanner-title">Scan student ID card</h2></div>
        <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close scanner">×</button>
      </div>

      <div className={`scanner-stage ${phase}`}>
        <video ref={videoRef} className="scanner-video" muted playsInline aria-hidden="true" />
        <div ref={guideRef} className="scanner-guide" aria-hidden="true"><i /><i /><i /><i />{phase === 'scanning' && <span className="scanner-sweep" />}</div>
        {!cameraActive && <div className="scanner-overlay-message" aria-hidden="true">{phase === 'decoding-upload' ? 'Reading photo…' : 'Camera paused'}</div>}
      </div>

      <p id="scanner-status" className={`scanner-status ${phase === 'error' || phase === 'invalid' || phase === 'no-code-in-upload' ? 'is-error' : ''}`} role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">
        <span className="status-icon" aria-hidden="true">{phase === 'scanning' ? '◉' : phase === 'starting' || phase === 'decoding-upload' ? '…' : '!'}</span>
        {status}
      </p>
      {slowHint && phase === 'scanning' && <p className="scanner-tip" role="status">Not reading yet? Look at the preview: if the bars look fuzzy, the camera can’t focus that close. Move the card <strong>farther away</strong> until the bars look crisp (it’s fine if the card looks small), tilt it slightly to avoid glare, or use <strong>Upload photo</strong> with a phone picture of the barcode.</p>}
      {invalid && <p className="scanner-invalid">Read <code>{invalid.raw.length > 60 ? `${invalid.raw.slice(0, 60)}…` : invalid.raw}</code> ({formatLabel(invalid.format)}). {invalid.message}</p>}

      <div className="scanner-actions">
        {!cameraActive && phase !== 'decoding-upload' && <button type="button" className="btn btn-primary" onClick={() => void start(deviceId)}>{phase === 'error' ? 'Retry camera' : 'Scan again'}</button>}
        {invalid && <button type="button" className="btn btn-secondary" onClick={() => onEditManually(invalid.raw)}>Edit as registration number</button>}
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={phase === 'decoding-upload'}>Upload photo</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => void onUpload(e)} aria-label="Upload a photo of the ID card" />
        {cameras.length > 1 && cameraActive && <label className="camera-select"><span className="visually-hidden">Camera</span>
          <select value={deviceId ?? ''} onChange={e => { setDeviceId(e.target.value); void start(e.target.value); }} aria-label="Choose camera">
            {cameras.map((c, i) => <option key={c.deviceId || i} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>)}
          </select></label>}
        {torch.supported && phase === 'scanning' && <button type="button" className="btn btn-secondary" aria-pressed={torch.on} onClick={() => void toggleTorch()}>{torch.on ? 'Flash off' : 'Flash on'}</button>}
        <button type="button" className="btn btn-ghost" onClick={() => onEditManually('')}>Type it instead</button>
      </div>

      <details className="scanner-diagnostics">
        <summary>Scanner diagnostics</summary>
        <dl>
          <dt>Decoder</dt><dd>{stats.decoder === 'ready' ? 'zxing-cpp (WebAssembly), ready' : stats.decoder === 'loading' ? 'loading…' : 'failed to load'}</dd>
          <dt>Built-in detector</dt><dd data-testid="native-detector">{stats.native}</dd>
          <dt>Formats</dt><dd>{ENABLED_FORMATS.map(formatLabel).join(', ')}</dd>
          <dt>Camera</dt><dd>{stats.camera}</dd>
          <dt>Resolution</dt><dd>{stats.resolution}</dd>
          <dt>Frames decoded</dt><dd data-testid="frames-decoded">{stats.frames}{stats.lastMs ? ` (last ${stats.lastMs} ms)` : ''}</dd>
          <dt>Last read</dt><dd>{stats.lastRead}</dd>
          <dt>State</dt><dd data-testid="scanner-phase">{phase}</dd>
        </dl>
      </details>
    </section>
  </div>;
}
