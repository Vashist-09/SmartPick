const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export class ApiError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}
export async function api<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, { ...init, credentials: 'include', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'x-smartpick-client': 'operator', ...init.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && path !== '/api/auth/session')
            window.dispatchEvent(new Event('session-expired'));
        throw new ApiError(data.error || `Request failed (${response.status})`, response.status);
    }
    return data as T;
}
