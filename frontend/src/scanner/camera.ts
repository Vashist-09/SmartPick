// Camera helpers: secure-context checks, stream start/stop, readiness, error translation.

export type CameraErrorKind = 'insecure' | 'unsupported' | 'permission' | 'not-found' | 'in-use' | 'timeout' | 'unknown';
export class CameraError extends Error {
  constructor(public kind: CameraErrorKind, message: string) { super(message); this.name = 'CameraError'; }
}

export function cameraErrorFrom(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError':
      return new CameraError('permission', 'Camera access was blocked. Allow camera access for this site in your browser’s address bar or site settings, then press Retry.');
    case 'NotFoundError': case 'DevicesNotFoundError': case 'OverconstrainedError':
      return new CameraError('not-found', 'No usable camera was found on this device. Upload a photo of the card or type the registration number instead.');
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      return new CameraError('in-use', 'The camera is in use by another app or tab, or the hardware failed to start. Close other apps using the camera, then press Retry.');
    default:
      return new CameraError('unknown', `The camera could not be started${error instanceof Error && error.message ? ` (${error.message})` : ''}. Press Retry, or upload a photo instead.`);
  }
}

export function assertCameraAvailable() {
  if (typeof window !== 'undefined' && !window.isSecureContext) throw new CameraError('insecure', 'Camera access needs a secure (https://) connection. Open SmartPick over HTTPS, or upload a photo of the card instead.');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', 'This browser does not support camera access. Upload a photo of the card or type the registration number instead.');
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach(t => t.stop());
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  assertCameraAvailable();
  const base: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const video: MediaTrackConstraints = deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: 'environment' } };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (error) {
    // Some cameras reject resolution hints; retry with the plainest request before giving up.
    if (error instanceof DOMException && (error.name === 'OverconstrainedError' || error.name === 'NotReadableError') && !deviceId) {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    throw error;
  }
}

/** Attaches the stream, starts playback and waits until real frames (non-zero size) are available. */
export async function attachAndPlay(video: HTMLVideoElement, stream: MediaStream, timeoutMs = 10000) {
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CameraError('timeout', 'The camera started but sent no picture. Press Retry or pick a different camera.')), timeoutMs);
    const check = () => { if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) { clearTimeout(timer); cleanup(); resolve(); } };
    const cleanup = () => { video.removeEventListener('loadeddata', check); video.removeEventListener('playing', check); video.removeEventListener('resize', check); };
    video.addEventListener('loadeddata', check); video.addEventListener('playing', check); video.addEventListener('resize', check);
    check();
  });
  try { await video.play(); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) throw error; }
  await ready;
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { return []; }
}

type ExtendedCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };

/** Best-effort continuous autofocus; returns whether the track supports a torch. */
export async function tuneTrack(track: MediaStreamTrack): Promise<{ torch: boolean }> {
  const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as ExtendedCapabilities;
  if (caps.focusMode?.includes('continuous')) {
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }); } catch { /* optional */ }
  }
  return { torch: caps.torch === true };
}

export async function setTorch(track: MediaStreamTrack, on: boolean) {
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}
