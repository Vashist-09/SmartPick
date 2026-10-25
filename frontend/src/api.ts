export class ApiError extends Error {
  constructor(message: string, public status: number, public kind: 'http' | 'network' | 'timeout' | 'aborted' = 'http') {
    super(message);
    this.name = 'ApiError';
  }
}

export const UNAUTHORIZED_EVENT = 'smartpick:unauthorized';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Same-origin JSON request with a timeout. Throws ApiError with the server's message on failure.
 * A 401 on any operator route also broadcasts UNAUTHORIZED_EVENT so the app can return to sign-in.
 */
export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { ...(rest.body ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json', ...rest.headers },
    });
  } catch {
    if (timedOut) throw new ApiError('The server took too long to respond. Check your connection and try again.', 0, 'timeout');
    if (signal?.aborted) throw new ApiError('Request cancelled.', 0, 'aborted');
    throw new ApiError('Could not reach the SmartPick server. Check your connection and try again.', 0, 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const message = typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`;
    throw new ApiError(response.status === 401 && !path.startsWith('/api/auth/') ? 'Your session has expired. Sign in again.' : message, response.status);
  }
  return data as T;
}

export const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
