/**
 * The 0.0.x measurement build's recorder — deleted, with every call to it,
 * before 0.1.0. SPEC.md's P1–P10 are the questions; this is how the form
 * answers them.
 *
 * On the form, after using the control:
 *
 *     copy(JSON.stringify(__pcfFilePreviewProbe.dump(), null, 2))
 *
 * and paste the result. Last mounted wins, so test one control at a time.
 */

export const PROBE = true;

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Entry {
    at: number;
    kind: string;
    [key: string]: unknown;
}

const entries: Entry[] = [];
const started = Date.now();

function headersOf(headers: any): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }

    const out: Record<string, string> = {};

    try {
        if (typeof headers.forEach === 'function') {
            headers.forEach((value: string, key: string) => {
                out[key] = value;
            });

            return out;
        }
    } catch {
        // Fall through to the named ones.
    }

    for (const name of ['content-type', 'content-length', 'x-ms-file-name', 'x-ms-file-size', 'mimetype', 'access-control-expose-headers']) {
        try {
            const value = headers.get?.(name);

            if (value !== null && value !== undefined) {
                out[name] = String(value);
            }
        } catch {
            // Not readable.
        }
    }

    return out;
}

/** A request and its answer: P1, P3, P4, P5, P6, P9. */
export function probeRecord(entry: { method: string; path: string; status: number; ms: number; headers?: any; error?: string }): void {
    if (!PROBE) {
        return;
    }

    note('request', { method: entry.method, path: entry.path, status: entry.status, ms: entry.ms, headers: headersOf(entry.headers), error: entry.error });
}

/** Anything else worth reading back: a render's outcome, a pass's identity, an error body. */
export function note(kind: string, data: Record<string, unknown>): void {
    if (!PROBE) {
        return;
    }

    entries.push({ at: Date.now() - started, kind, ...data });

    if (entries.length > 400) {
        entries.shift();
    }
}

/**
 * P4 wants the server's own refusals, and the control refuses a blocked or
 * oversized file before it sends a byte. `__pcfFilePreviewProbe.force = true`
 * in the console lets the next uploads through to be refused there instead.
 */
export function probeForce(): boolean {
    return PROBE && typeof window !== 'undefined' && (window as any).__pcfFilePreviewProbe?.force === true;
}

let installed = false;

/**
 * Hangs `dump()` on the window, and listens for the content-security policy
 * refusing anything — P2's question is whether a form lets a `blob:` frame,
 * object or image draw, and a refusal says so here before anyone has to
 * describe what they saw.
 */
export function installProbe(): void {
    if (!PROBE || installed || typeof window === 'undefined') {
        return;
    }

    installed = true;

    try {
        document.addEventListener('securitypolicyviolation', (event: any) => {
            note('csp', {
                blockedURI: String(event.blockedURI || '').slice(0, 60),
                violatedDirective: event.violatedDirective,
                effectiveDirective: event.effectiveDirective,
                disposition: event.disposition,
            });
        });
    } catch {
        // A host without the event.
    }

    (window as any).__pcfFilePreviewProbe = {
        force: false,
        dump: () => ({
            build: '0.0.1',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
            entries: entries.slice(),
        }),
        entries,
    };
}
