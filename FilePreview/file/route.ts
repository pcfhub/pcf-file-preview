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

export interface DownloadFacts {
    /** From `x-ms-file-name`; `''` when the response named nothing. */
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
    let name = read('x-ms-file-name') ?? '';

    // A name the server percent-encoded comes back decoded; a name with a
    // stray `%` in it is left as it came.
    if (/%[0-9a-f]{2}/i.test(name)) {
        try {
            name = decodeURIComponent(name);
        } catch {
            // As it came.
        }
    }

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
