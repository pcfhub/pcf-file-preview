/**
 * What may be uploaded, and how much is worth drawing — decided before a
 * byte is sent, because the server's own refusal arrives after the whole file
 * has gone up and says nothing a user can act on.
 *
 * Pure: the suite loads it from source.
 */

import { effectiveMime, extensionOf, kindOf } from './kind';

/**
 * The largest file one `PATCH` carries. Above it Learn's answer is the
 * chunked upload, which this control does not do — and a File column's own
 * ceiling is usually far lower, so this is the second check, not the first.
 */
export const ONE_REQUEST_LIMIT = 128 * 1024 * 1024;

/**
 * The largest file the control downloads in order to draw it. A preview holds
 * the whole file in memory, and a form is not where a 300 MB scan should be
 * opened; above this the control offers Download and draws nothing. The size
 * is read off the response's headers before the body is read, so a file over
 * it costs one aborted request, not a download.
 */
export const PREVIEW_LIMIT = 25 * 1024 * 1024;

/** How much of a text file is shown. The rest is a Download away. */
export const TEXT_LIMIT = 64 * 1024;

export type Refusal = 'empty' | 'blocked' | 'notImage' | 'tooBig' | 'tooBigForOneRequest';

export interface UploadLimits {
    /** The column's `MaxSizeInKB`, or `null` when it could not be read — then only the server decides. */
    maxSizeInKB: number | null;
    /** `organization.blockedattachments`, split; `[]` when it could not be read. */
    blocked: string[];
    /** An Image column, which takes image types only (Learn, *Use image column data*). */
    imageOnly?: boolean;
}

/** `"ade;exe;js"` → `['ade', 'exe', 'js']` — lower-case, dots and blanks dropped. */
export function blockedList(raw: unknown): string[] {
    if (typeof raw !== 'string') {
        return [];
    }

    return raw
        .split(/[;,]/)
        .map((part) => part.trim().replace(/^\./, '').toLowerCase())
        .filter((part) => part !== '');
}

/**
 * Why a file may not be uploaded, or `null` when nothing here refuses it. The
 * order is the order a user can do something about: a blocked type is
 * blocked whatever its size.
 */
export function refusalFor(file: { name: string; size: number; type?: string }, limits: UploadLimits): Refusal | null {
    if (limits.blocked.includes(extensionOf(file.name))) {
        return 'blocked';
    }
    if (file.size === 0) {
        return 'empty';
    }
    if (limits.imageOnly && kindOf(effectiveMime(file.type, file.name)) !== 'image') {
        return 'notImage';
    }
    if (limits.maxSizeInKB !== null && file.size > limits.maxSizeInKB * 1024) {
        return 'tooBig';
    }
    if (file.size > ONE_REQUEST_LIMIT) {
        return 'tooBigForOneRequest';
    }

    return null;
}

/**
 * A size as a person reads it: `512 bytes`, `1.4 KB`, `12 MB`. Binary
 * multiples, as Windows and the maker portal show a file — one decimal under
 * ten, none above.
 */
export function formatSize(bytes: number, locale?: string): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '';
    }
    if (bytes < 1024) {
        return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
    }

    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    const digits = value < 10 ? 1 : 0;
    let text: string;

    try {
        text = value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    } catch {
        text = value.toFixed(digits);
    }

    return `${text} ${units[unit]}`;
}
