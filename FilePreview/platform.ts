/**
 * Everything read off `context`, and every request, in one file — because
 * every member here is one a host can withhold: `utils` behind an optional
 * feature, `contextInfo` and `page` undocumented, `openFile` and the dialogs
 * model-driven only. The rest of the control is written against what this
 * file returns, never against `context`.
 *
 * It is also the **only** file that calls `fetch`. The file is a URL of its
 * own on the organisation (`<set>(<id>)/<column>/$value`) that
 * `context.webAPI` cannot address, and so are the table's definition and the
 * column's limits; one same-origin helper writes the headers once.
 */

import { IInputs } from './generated/ManifestTypes';
import { FileColumn, fileColumnsOf } from './file/column';
import { blockedList } from './file/limits';
import {
    attributesPath,
    bareId,
    DownloadFacts,
    isGuid,
    isLogicalName,
    limitsPath,
    ORGANIZATION_PATH,
    readDownload,
    tableDefinitionPath,
} from './file/route';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface HostReading {
    /** The organisation URL every request starts from; `null` on a host that gives none (canvas, the hub's demo before it learns files). */
    clientUrl: string | null;
    /** The record's table, from `contextInfo` or the `recordEntity` input; `''` when neither says. */
    table: string;
    /** The record's id, bare and lower-case; `null` on an unsaved record. */
    recordId: string | null;
    /** The `fileColumn` input, as typed. */
    askedColumn: string;
    allowChanges: boolean;
    /** The `previewHeight` input, clamped. */
    previewHeight: number;
    /** `mode.isControlDisabled` — a read-only form, where a write has no business. */
    disabled: boolean;
    /**
     * `utils.hasEntityPrivilege(table, Write, Basic)` — `false` is the user who
     * may not, `null` a host that cannot say (no Utility, no table). One hides
     * Replace and Remove; the other leaves them to the server's refusal.
     */
    writePrivilege: boolean | null;
    /** The platform's confirm dialog, or `null` where there is none — then Remove is not offered. */
    confirm: ((strings: ConfirmStrings) => Promise<boolean>) | null;
    /** `navigation.openFile`, or `null` where the host has none. */
    openFile: ((file: OpenFileArgs, openMode: 1 | 2) => Promise<void>) | null;
    label: string;
    visible: boolean;
    isRTL: boolean;
    /** `true`, `false`, or `undefined` for a host that publishes no theme. */
    dark: boolean | undefined;
    /** `client.getClient() === 'Mobile'` — the phone and tablet app, where a PDF gets a card, not a frame. */
    mobile: boolean;
    /** The user's locale for numbers, from the platform's formatting, else the browser's. */
    locale: string | undefined;
}

export interface ConfirmStrings {
    title?: string;
    text: string;
    confirmButtonLabel?: string;
    cancelButtonLabel?: string;
}

export interface OpenFileArgs {
    fileName: string;
    /** Base64, no `data:` prefix. */
    fileContent: string;
    /** In KB — the one field that reads as bytes. */
    fileSize: number;
    mimeType: string;
}

/** Write = 3, Basic = 0 — from the typings' `PrivilegeType` and `PrivilegeDepth` (Read is 2). */
export const PRIVILEGE_WRITE = 3;
export const DEPTH_BASIC = 0;

const HEIGHT_DEFAULT = 480;

export function clampHeight(raw: unknown): number {
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : HEIGHT_DEFAULT;

    return Math.min(2000, Math.max(120, value));
}

export function readHost(context: ComponentFramework.Context<IInputs>): HostReading {
    const { table, recordId } = resolveRecord(context);
    const inputs: any = context.parameters;

    return {
        clientUrl: lookupClientUrl(context),
        table,
        recordId,
        askedColumn: typeof inputs?.fileColumn?.raw === 'string' ? inputs.fileColumn.raw : '',
        allowChanges: inputs?.allowChanges?.raw === true,
        previewHeight: clampHeight(inputs?.previewHeight?.raw),
        disabled: context.mode?.isControlDisabled === true,
        writePrivilege: readWritePrivilege(context, table),
        confirm: confirmReader(context),
        openFile: openFileReader(context),
        label: typeof context.mode?.label === 'string' ? context.mode.label : '',
        visible: context.mode?.isVisible !== false,
        isRTL: context.userSettings?.isRTL === true,
        dark: context.fluentDesignLanguage?.isDarkTheme,
        mobile: clientOf(context) === 'Mobile',
        locale: localeOf(context),
    };
}

/** `Web`, `Outlook` or `Mobile`; `''` where the host does not say. */
function clientOf(context: ComponentFramework.Context<IInputs>): string {
    try {
        const client = context.client?.getClient?.();

        return typeof client === 'string' ? client : '';
    } catch {
        return '';
    }
}

function localeOf(context: ComponentFramework.Context<IInputs>): string | undefined {
    const tag = (context.userSettings as any)?.locale;

    return typeof tag === 'string' && tag !== '' ? tag : undefined;
}

/**
 * The record's identity: `mode.contextInfo` first — undocumented, present on
 * a model-driven form, measured bare and lower-case — then the two inputs
 * the platform's FAQ says to bind. The maker's inputs are held to a GUID,
 * because a `recordId` bound to the wrong column would otherwise be sent as
 * part of a URL. The same order as pcf-audit-history.
 */
export function resolveRecord(context: ComponentFramework.Context<IInputs>): { table: string; recordId: string | null } {
    const info = (context.mode as any)?.contextInfo;
    const inputs: any = context.parameters;
    const candidates: Array<[unknown, unknown, (id: string) => boolean]> = [
        [info?.entityId, info?.entityTypeName, (id) => /^[0-9a-z-]+$/.test(id)],
        [inputs?.recordId?.raw, inputs?.recordEntity?.raw, isGuid],
    ];

    for (const [id, table, shape] of candidates) {
        const bare = bareId(id);
        const name = typeof table === 'string' ? table.trim().toLowerCase() : '';

        if (bare !== null && shape(bare) && isLogicalName(name)) {
            return { table: name, recordId: bare };
        }
    }

    // A table without a record is still worth knowing: it lets the column be
    // resolved — and a misconfigured one named — on a record not yet saved.
    const table = typeof info?.entityTypeName === 'string'
        ? info.entityTypeName.toLowerCase()
        : typeof inputs?.recordEntity?.raw === 'string' ? inputs.recordEntity.raw.trim().toLowerCase() : '';

    return { table: isLogicalName(table) ? table : '', recordId: null };
}

/**
 * `page.getClientUrl()` first — not in the typings, present on a model-driven
 * form, and the only honest answer on an on-premises organisation whose URL
 * carries the organisation in the path — then the `Xrm` global, then `null`.
 * Canvas publishes `page` and throws from the call (measured 2026-09-25), so
 * the call is guarded and the answer tested, not the method.
 */
export function lookupClientUrl(context: ComponentFramework.Context<IInputs>): string | null {
    const page = (context as any).page;

    try {
        const fromPage = typeof page?.getClientUrl === 'function' ? page.getClientUrl() : undefined;

        if (typeof fromPage === 'string' && fromPage !== '') {
            return fromPage.replace(/\/$/, '');
        }
    } catch {
        // Fall through to the global.
    }

    try {
        const fromGlobal = (globalThis as any).Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.();

        if (typeof fromGlobal === 'string' && fromGlobal !== '') {
            return fromGlobal.replace(/\/$/, '');
        }
    } catch {
        // No global either.
    }

    return null;
}

/**
 * `utils.hasEntityPrivilege` is synchronous and answers about the user's
 * roles; a host without `utils`, or one whose method throws — it does when
 * Utility is not declared — is `null`.
 */
export function readWritePrivilege(context: ComponentFramework.Context<IInputs>, table: string): boolean | null {
    const utils = (context as any).utils;

    if (table === '' || typeof utils?.hasEntityPrivilege !== 'function') {
        return null;
    }

    try {
        const answer = utils.hasEntityPrivilege(table, PRIVILEGE_WRITE, DEPTH_BASIC);

        return typeof answer === 'boolean' ? answer : null;
    } catch {
        return null;
    }
}

/**
 * `openConfirmDialog` resolves `{ confirmed }` — **a cancel is a resolve** —
 * and a host that refuses to open the dialog rejects; both are "nothing
 * happened" here, never an error the user did not cause.
 */
function confirmReader(context: ComponentFramework.Context<IInputs>): HostReading['confirm'] {
    const navigation = (context as any).navigation;

    if (typeof navigation?.openConfirmDialog !== 'function') {
        return null;
    }

    return (strings) =>
        Promise.resolve()
            .then(() => navigation.openConfirmDialog(strings))
            .then((response: any) => response?.confirmed === true, () => false);
}

/**
 * `openFile` — documented model-driven only, and published on canvas, where
 * it throws from the call. A throw becomes a rejection so the caller has one
 * failure channel; the anchor fallback in `saveBlob` takes over.
 */
function openFileReader(context: ComponentFramework.Context<IInputs>): HostReading['openFile'] {
    const navigation = (context as any).navigation;

    if (typeof navigation?.openFile !== 'function') {
        return null;
    }

    return (file, openMode) => Promise.resolve().then(() => navigation.openFile(file, { openMode })).then(() => undefined);
}

/**
 * Whether this document is sandboxed without `allow-same-origin` — an opaque
 * origin, which reads as the string `"null"`. Chrome will not run its PDF
 * viewer in a sandboxed document, so a PDF framed there draws the blocked-page
 * icon instead of the file (measured 2026-10-02 in PCFHub's demo, whose frame
 * is sandboxed so). A model-driven form is not; this is the demo's case.
 */
export function isSandboxed(): boolean {
    try {
        return (globalThis as any).origin === 'null';
    } catch {
        return false;
    }
}

/* ---- requests ------------------------------------------------------------ */

const API = '/api/data/v9.2/';

const ODATA_HEADERS: Record<string, string> = {
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
};

export interface Answer {
    ok: boolean;
    status: number;
    body: any;
}

/**
 * Every request goes through here: same origin, the form's session
 * (`credentials: 'same-origin'`). Resolves on any HTTP status — a refusal is
 * an answer the control names — and rejects only when there is no response
 * at all (offline, a blocked origin), which `fetch` delivers as a `TypeError`.
 */
function send(clientUrl: string, path: string, init: RequestInit): Promise<Response> {
    if (typeof fetch !== 'function') {
        return Promise.reject(new TypeError('fetch is not available'));
    }

    return fetch(`${clientUrl}${API}${path}`, { credentials: 'same-origin', ...init });
}

function asAnswer(response: Response): Promise<Answer> {
    return response.text().then(
        (text) => {
            let body: any = null;

            try {
                body = text === '' ? null : JSON.parse(text);
            } catch {
                body = null;
            }

            return { ok: response.ok, status: response.status, body };
        },
        () => ({ ok: response.ok, status: response.status, body: null }),
    );
}

export function getJson(clientUrl: string, path: string): Promise<Answer> {
    return send(clientUrl, path, { headers: ODATA_HEADERS }).then(asAnswer);
}

/* ---- what the organisation says, cached per page ------------------------ */

/*
 * Read once per organisation and table for the life of the page, because a
 * form that moves between records keeps asking the same questions. A failure
 * is not cached: the next record asks again.
 */
const cache = new Map<string, Promise<any>>();

function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = cache.get(key);

    if (hit) {
        return hit;
    }

    const answer = load().then(
        (value) => {
            if (value === null) {
                cache.delete(key);
            }

            return value;
        },
        () => {
            cache.delete(key);

            return null;
        },
    );

    cache.set(key, answer);

    return answer;
}

/** For the suite, and for a page that changes organisation under the control — which no form does. */
export function forgetDefinitions(): void {
    cache.clear();
}

/** The table's File and Image columns, or `null` when the definition could not be read. */
export function fileColumns(clientUrl: string, table: string): Promise<FileColumn[] | null> {
    return cached(`columns|${clientUrl}|${table}`, () =>
        getJson(clientUrl, attributesPath(table)).then((answer) => (answer.ok && Array.isArray(answer.body?.value) ? fileColumnsOf(answer.body.value) : null)));
}

/** `accounts` for `account` — read, never guessed from the logical name. */
export function entitySet(clientUrl: string, table: string): Promise<string | null> {
    return cached(`set|${clientUrl}|${table}`, () =>
        getJson(clientUrl, tableDefinitionPath(table)).then((answer) => {
            const set = answer.ok ? answer.body?.EntitySetName : undefined;

            return typeof set === 'string' && set !== '' ? set : null;
        }));
}

export interface ColumnLimits {
    maxSizeInKB: number | null;
    /** An Image column only: whether `?size=full` has anything to answer. */
    canStoreFullImage: boolean;
}

export function columnLimits(clientUrl: string, table: string, column: FileColumn): Promise<ColumnLimits | null> {
    return cached(`limits|${clientUrl}|${table}|${column.name}`, () =>
        getJson(clientUrl, limitsPath(table, column.name, column.kind)).then((answer) => {
            if (!answer.ok || !answer.body) {
                return null;
            }

            const max = answer.body.MaxSizeInKB;

            return {
                maxSizeInKB: typeof max === 'number' && max > 0 ? max : null,
                canStoreFullImage: answer.body.CanStoreFullImage === true,
            };
        }));
}

/** `organization.blockedattachments`, split; `[]` when it could not be read — then the server decides. */
export function blockedAttachments(clientUrl: string): Promise<string[]> {
    return cached(`blocked|${clientUrl}`, () =>
        getJson(clientUrl, ORGANIZATION_PATH).then((answer) => {
            const row = answer.ok && Array.isArray(answer.body?.value) ? answer.body.value[0] : undefined;

            return row ? blockedList(row.blockedattachments) : null;
        })).then((list) => list ?? []);
}

/* ---- the file ------------------------------------------------------------ */

export interface Download {
    status: number;
    facts: DownloadFacts;
    /** The bytes, typed from `mimetype`; `null` when the file was over `limit` or the answer was not a file. */
    blob: Blob | null;
    /** Over the limit by its headers, so its body was never read. */
    tooLarge: boolean;
    /** The error body, for a refusal. */
    body: any;
}

/**
 * One `GET …/$value`. The headers decide whether the body is read: a file
 * over `limit` by `x-ms-file-size` is answered without its bytes and the
 * stream is cancelled, so an oversized file costs a request, not a download.
 * A browser types a blob from `Content-Type`, which for this route is not the
 * file's type — so the bytes are re-typed from `mimetype`, or a PDF in a
 * frame would be offered as a download instead of drawn.
 */
export function download(clientUrl: string, path: string, limit: number, signal?: AbortSignal): Promise<Download> {
    return send(clientUrl, path, { headers: { ...ODATA_HEADERS, Accept: '*/*' }, signal }).then((response) => {
        const facts = readDownload(response.headers);

        if (response.status === 204) {
            return { status: 204, facts, blob: null, tooLarge: false, body: null };
        }
        if (!response.ok) {
            return asAnswer(response).then((answer) => ({ status: answer.status, facts, blob: null, tooLarge: false, body: answer.body }));
        }
        if (facts.size !== null && facts.size > limit) {
            try {
                void response.body?.cancel();
            } catch {
                // Nothing to cancel.
            }

            return { status: response.status, facts, blob: null, tooLarge: true, body: null };
        }

        return response.blob().then((raw) => ({
            status: response.status,
            facts,
            blob: raw,
            tooLarge: false,
            body: null,
        }));
    });
}

export function upload(clientUrl: string, path: string, headers: Record<string, string>, file: Blob): Promise<Answer> {
    return send(clientUrl, path, { method: 'PATCH', headers: { ...ODATA_HEADERS, ...headers }, body: file }).then(asAnswer);
}

export function remove(clientUrl: string, path: string): Promise<Answer> {
    return send(clientUrl, path, { method: 'DELETE', headers: ODATA_HEADERS }).then(asAnswer);
}

/* ---- handing the file to the user --------------------------------------- */

/** A blob as base64, without the `data:` prefix — what `openFile` takes. */
export function base64Of(blob: Blob): Promise<string> {
    return blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';

        // In slices: `String.fromCharCode(...bytes)` overflows the stack on a
        // file of a few hundred KB.
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        }

        return btoa(binary);
    });
}

/**
 * Save (2) or open (1) the file through the platform where it can, else a
 * `Blob` + `<a download>` — a model-driven form is an iframe the control does
 * not own, so whether a browser download works there is the host's sandbox,
 * not this code. `false` when neither route was available.
 */
export function handOver(reading: HostReading, name: string, mime: string, blob: Blob, openMode: 1 | 2): Promise<boolean> {
    const viaPlatform = reading.openFile
        ? base64Of(blob).then((fileContent) =>
            reading.openFile!({ fileName: name, fileContent, fileSize: Math.max(1, Math.ceil(blob.size / 1024)), mimeType: mime }, openMode))
        : Promise.reject(new Error('no openFile'));

    return viaPlatform.then(
        () => true,
        () => anchorDownload(name, blob),
    );
}

function anchorDownload(name: string, blob: Blob): boolean {
    try {
        if (typeof URL?.createObjectURL !== 'function' || typeof document === 'undefined') {
            return false;
        }

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = name;
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);

        return true;
    } catch {
        return false;
    }
}
