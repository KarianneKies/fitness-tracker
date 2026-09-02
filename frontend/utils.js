// utils.js — shared helpers: the API client and small date/string formatters.
// Everything here is pure or DOM-only and free of app state, so it can be
// imported anywhere without creating cycles.

// ========== API client ==========

/**
 * Thrown for any non-2xx API response. `.status` is the HTTP status and
 * `.message` is the backend's `detail` string when there is one, so callers
 * can show something useful instead of a generic "request failed".
 */
export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

/** Turn FastAPI's `detail` (a string, or a list of validation errors) into one line. */
export function detailToMessage(payload) {
    if (!payload || payload.detail == null) return null;
    const d = payload.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
        return d.map(e => {
            const loc = Array.isArray(e.loc) ? e.loc.filter(x => x !== 'body').join('.') : '';
            return loc ? `${loc}: ${e.msg}` : e.msg;
        }).join('; ');
    }
    return null;
}

export const api = {
    get baseUrl() {
        return window.location.origin;
    },

    /**
     * One request path for every verb. `body` is JSON-encoded when present.
     * Returns parsed JSON (or null for an empty body). Throws an ApiError
     * carrying the backend's `detail` message on any non-2xx.
     */
    async request(method, path, body) {
        const opts = { method };
        if (body !== undefined) {
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify(body);
        }

        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, opts);
        } catch (networkError) {
            console.error(`API ${method} ${path} - network error:`, networkError);
            throw new ApiError('Could not reach the server. Is it running?', 0);
        }

        const text = await response.text();
        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch {
                payload = { detail: text.slice(0, 200) };
            }
        }

        if (!response.ok) {
            const message = detailToMessage(payload) || `Request failed (HTTP ${response.status})`;
            console.error(`API ${method} ${path} -> ${response.status}: ${message}`);
            throw new ApiError(message, response.status);
        }
        return payload;
    },

    get(path) { return this.request('GET', path); },
    post(path, data) { return this.request('POST', path, data ?? {}); },
    patch(path, data) { return this.request('PATCH', path, data ?? {}); },
    put(path, data) { return this.request('PUT', path, data ?? {}); },
    delete(path) { return this.request('DELETE', path); },
};

// ========== String / date formatting ==========

/** HTML-escape a string for safe interpolation into innerHTML. */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Backend timestamps are naive UTC (Python datetime.utcnow().isoformat()
 * with no offset). JS parses an offset-less datetime as LOCAL, shifting it
 * by the local UTC offset; appending "Z" forces the correct interpretation.
 */
export function parseUtcTimestamp(isoString) {
    if (!isoString) return null;
    const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(isoString);
    return new Date(hasTz ? isoString : `${isoString}Z`);
}

/**
 * Format a date-only string (YYYY-MM-DD) for display, e.g. "Wed, 27 Aug 2026".
 * Parsed from calendar components rather than `new Date(dateStr)`, which
 * reads a bare date as UTC midnight and can roll back a day west of UTC.
 */
export function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
}

/** Like formatDate but compact, for chart labels: "Aug 5". */
export function formatShortDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Format a number of seconds as mm:ss. */
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Today's date as YYYY-MM-DD in local time (matches the backend's meal_date). */
export function todayString() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

/** Local YYYY-MM-DD for an arbitrary date/datetime input. */
export function localDateStr(dateInput) {
    const d = new Date(dateInput);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midnight (local) of the Monday that starts the current calendar week. */
export function weekStart() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    const diffToMonday = (day === 0) ? 6 : day - 1;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
}
