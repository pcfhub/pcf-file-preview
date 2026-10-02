/**
 * What a file is, for the purpose of drawing it — decided from the type the
 * server reports and, failing that, from the name.
 *
 * Pure: no `context`, no DOM, no `fetch`. The suite loads it from source.
 */

export type FileKind = 'image' | 'pdf' | 'text' | 'other';

const BY_EXTENSION: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    log: 'text/plain',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    yaml: 'application/yaml',
    yml: 'application/yaml',
    html: 'text/html',
    htm: 'text/html',
};

/** Images a browser draws in an `<img>` on every host this runs on. */
const IMAGE = /^image\/(png|jpeg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon|svg\+xml)$/;

/** Text the control shows as text — never as markup, whatever it is. */
const TEXT = /^(text\/[\w.+-]+|application\/(json|xml|yaml|x-yaml|[\w.-]+\+(json|xml)))$/;

/** The extension, lower-case and without the dot; `''` when there is none. */
export function extensionOf(name: string): string {
    const base = String(name || '').split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');

    return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** The type a name implies, or `null` for a name that implies none. */
export function mimeFromName(name: string): string | null {
    return BY_EXTENSION[extensionOf(name)] ?? null;
}

/**
 * The type to draw by. The server's `mimetype` wins, except where it says
 * nothing — empty, or `application/octet-stream`, which is what an upload
 * that named no type is stored as — and then the name decides. Lower-case,
 * parameters dropped.
 */
export function effectiveMime(reported: string | null | undefined, name: string): string {
    const bare = String(reported || '').split(';')[0].trim().toLowerCase();

    if (bare !== '' && bare !== 'application/octet-stream' && bare !== 'binary/octet-stream') {
        return bare;
    }

    return mimeFromName(name) ?? 'application/octet-stream';
}

export function kindOf(mime: string): FileKind {
    if (mime === 'application/pdf') {
        return 'pdf';
    }
    if (IMAGE.test(mime)) {
        return 'image';
    }
    if (TEXT.test(mime)) {
        return 'text';
    }

    return 'other';
}
