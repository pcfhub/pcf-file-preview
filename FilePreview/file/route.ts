/**
 * The addresses a File or Image column is reached at, and what comes back.
 *
 * A file is not a property `context.webAPI` can read or write — the five
 * methods take a record and its columns, and a File column's value on a
 * record is only an id. Learn documents the file itself as a resource of its
 * own (*Use file column data*):
 *
 *   GET    <set>(<id>)/<column>/$value          the bytes, in one request
 *   GET    <set>(<id>)/<image>/$value?size=full an Image column's full copy
 *   PATCH  <set>(<id>)/<column>                 replace, under 128 MB
 *   DELETE <set>(<id>)/<column>                 remove
 *
 * Pure: the suite loads it from source.
 */

const LOGICAL_NAME = /^[a-z][a-z0-9_]*$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isLogicalName(name: string): boolean {
    return LOGICAL_NAME.test(name);
}

/** `{ABC-…}` or `abc-…` → `abc-…`; `null` for anything that is not an id. */
export function bareId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const bare = value.replace(/[{}]/g, '').trim().toLowerCase();

    return bare === '' ? null : bare;
}

export function isGuid(value: string): boolean {
    return GUID.test(value);
}

export function valuePath(set: string, id: string, column: string, full: boolean): string {
    return `${set}(${id})/${column}/$value${full ? '?size=full' : ''}`;
}

/**
 * Where a `PATCH` goes, and the headers it carries. The name travels in the
 * `x-ms-file-name` header when it is plain ASCII, and in the query string
 * otherwise: Learn says the header "doesn't support file names outside the
 * ASCII character set", and a browser refuses to send a header value that is
 * not ISO-8859-1 at all — `Übersicht.pdf` would throw before the request left.
 */
export function uploadTarget(set: string, id: string, column: string, name: string): { path: string; headers: Record<string, string> } {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    const path = `${set}(${id})/${column}`;

    if (/^[\x20-\x7e]+$/.test(name)) {
        headers['x-ms-file-name'] = name;

        return { path, headers };
    }

    return { path: `${path}?x-ms-file-name=${encodeURIComponent(name)}`, headers };
}

export function columnPath(set: string, id: string, column: string): string {
    return `${set}(${id})/${column}`;
}

/** The table's columns, with only what deciding which hold files needs. */
export function attributesPath(table: string): string {
    return `EntityDefinitions(LogicalName='${table}')/Attributes?$select=LogicalName,AttributeType,AttributeTypeName,DisplayName`;
}

export function tableDefinitionPath(table: string): string {
    return `EntityDefinitions(LogicalName='${table}')?$select=EntitySetName`;
}

/** A File or Image column's limits, through the column's own cast. */
export function limitsPath(table: string, column: string, kind: 'File' | 'Image'): string {
    const select = kind === 'Image' ? 'MaxSizeInKB,CanStoreFullImage' : 'MaxSizeInKB';

    return `EntityDefinitions(LogicalName='${table}')/Attributes(LogicalName='${column}')/Microsoft.Dynamics.CRM.${kind}AttributeMetadata?$select=${select}`;
}

export const ORGANIZATION_PATH = 'organizations?$select=blockedattachments';

export interface HeaderReader {
    get(name: string): string | null;
}

/** Bytes in a named charset, falling back to UTF-8 for one the browser does not know. */
function decodeBytes(bytes: Uint8Array, charset: string): string {
    try {
        return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
    } catch {
        return new TextDecoder().decode(bytes);
    }
}

/** One RFC 2047 encoded word's text: `B` is base64, `Q` is `=XX` with `_` for a space. */
function decodeWord(charset: string, encoding: string, text: string): string | null {
    let binary: string;

    try {
        binary =
            encoding.toUpperCase() === 'B'
                ? atob(text)
                : text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    } catch {
        return null;
    }

    return decodeBytes(Uint8Array.from(binary, (c) => c.charCodeAt(0)), charset);
}

/**
 * The file's name from `Content-Disposition`, or `null` when it names none.
 * Measured on a form (SPEC.md, 2026-10-02): the service sends an ASCII name
 * bare (`inline; filename=contract.pdf`) and any other as an RFC 2047 encoded
 * word (`filename="=?utf-8?B?w5xiZXJzaWNodC5wZGY=?="`). RFC 5987's
 * `filename*=UTF-8''…` wins where a response carries it; a long name may
 * come as several words, which join with no space between them.
 */
export function nameFromDisposition(header: string | null | undefined): string | null {
    if (!header) {
        return null;
    }

    const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);

    if (extended) {
        try {
            return decodeURIComponent(extended[2]!.trim());
        } catch {
            // Fall through to the plain parameter.
        }
    }

    const plain = /(?:^|;)\s*filename\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/i.exec(header);

    if (!plain) {
        return null;
    }

    let value = plain[1]!.trim();

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    }

    const WORD = /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi;

    if (WORD.test(value)) {
        WORD.lastIndex = 0;

        let failed = false;
        const decoded = value
            // Whitespace between two encoded words is not part of the name.
            .replace(/\?=\s+=\?/g, '?==?')
            .replace(WORD, (_, charset: string, encoding: string, text: string) => {
                const word = decodeWord(charset, encoding, text);

                failed = failed || word === null;

                return word ?? '';
            });

        return failed ? null : decoded;
    }

    return value === '' ? null : value;
}

export interface DownloadFacts {
    /** From `Content-Disposition`, then an ASCII `x-ms-file-name`; `''` when the response named nothing. */
    name: string;
    /** From `x-ms-file-size`, then `Content-Length`; `null` when neither says. */
    size: number | null;
    /** From `mimetype`; `null` when absent. The response's `Content-Type` is not the file's. */
    mime: string | null;
}

/** What the download's headers say about the file, before its body is read. */
export function readDownload(headers: HeaderReader | null | undefined): DownloadFacts {
    const read = (name: string): string | null => {
        try {
            return headers && typeof headers.get === 'function' ? headers.get(name) : null;
        } catch {
            return null;
        }
    };
    const sizeText = read('x-ms-file-size') ?? read('content-length');
    const size = sizeText !== null && /^\d+$/.test(sizeText.trim()) ? Number(sizeText) : null;
    // `x-ms-file-name` mangles any name outside ASCII — `Übersicht.pdf`
    // arrives as `ÃÅbersicht.pdf` — so it is believed only when it is plain
    // ASCII, where it and `Content-Disposition` agree.
    const header = read('x-ms-file-name');
    const name = nameFromDisposition(read('content-disposition')) ?? (header !== null && /^[\x20-\x7e]+$/.test(header) ? header : '');

    return { name, size, mime: read('mimetype') };
}

/**
 * The sentence in an error body, or `null`. Dataverse answers
 * `{ error: { code, message } }`; anything else — an HTML error page, an
 * empty body — has none.
 */
export function errorMessageOf(body: unknown): string | null {
    const message = (body as { error?: { message?: unknown } } | null)?.error?.message;

    return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
}

/** `0x80044a02` and its siblings, for a refusal the control names itself. */
export function errorCodeOf(body: unknown): string | null {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;

    return typeof code === 'string' ? code.toLowerCase() : null;
}
