import { IInputs, IOutputs } from './generated/ManifestTypes';
import { FileColumn, resolveColumn } from './file/column';
import { effectiveMime, FileKind, kindOf } from './file/kind';
import { formatSize, PREVIEW_LIMIT, refusalFor, TEXT_LIMIT } from './file/limits';
import { columnPath, errorCodeOf, errorMessageOf, uploadTarget, valuePath } from './file/route';
import * as P from './platform';

/**
 * A File or Image column, drawn on the form: the PDF in a frame, the image
 * itself, the first 64 KB of a text file — with Download, Open, and (opt-in)
 * Replace and Remove.
 *
 * No manifest can bind a File or Image column, so this control is placed on
 * any other column and reaches the file through the Web API by the record's
 * id: `GET <set>(<id>)/<column>/$value` for the bytes, `PATCH` to replace,
 * `DELETE` to remove. Every request is in `platform.ts`; every decision that
 * does not need the DOM is in `file/`.
 *
 * The state is one `View`, and the DOM is drawn from it in `draw()`. A load
 * is keyed on what identifies the file — organisation, table, record, column
 * — and a pass that changes none of them changes nothing: `updateView` runs
 * on every change to any bound value on the form, and a PDF frame rebuilt on
 * each would reload with every keystroke elsewhere.
 */

type Blocked = 'saveFirst' | 'needsForm' | 'noAccess' | 'none' | 'ambiguous' | 'notFile' | 'invalid';

interface Shown {
    name: string;
    size: number | null;
    mime: string;
    kind: FileKind;
    /** The bytes, typed from `mimetype`; `null` for a file too large to fetch for a preview. */
    blob: Blob | null;
    /** An object URL for an image or a PDF; revoked when the file is replaced or the control goes. */
    url: string | null;
    text: string | null;
    truncated: boolean;
    tooLarge: boolean;
    /** An Image column that keeps no full-size copy: what is shown is its 144px thumbnail. */
    thumbnailOnly: boolean;
}

type View =
    | { phase: 'loading' }
    | { phase: 'blocked'; reason: Blocked; detail: string }
    | { phase: 'empty' }
    | { phase: 'file'; file: Shown }
    | { phase: 'error'; message: string };

interface Target {
    clientUrl: string;
    table: string;
    recordId: string;
    set: string;
    column: FileColumn;
    limits: P.ColumnLimits | null;
}

const SVG = 'http://www.w3.org/2000/svg';

/** 16px outline icons, drawn in `currentColor` so they follow the theme. */
const ICONS: Record<string, string> = {
    document: 'M4.5 1.5h5l3 3v10h-8zM9.5 1.5v3h3',
    download: 'M8 2v8.5M4.5 7l3.5 3.5L11.5 7M3 13.5h10',
    open: 'M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v4H2.5V4h4',
    replace: 'M8 13.5V5M4.5 8.5 8 5l3.5 3.5M3 2.5h10',
    remove: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9',
};

export class FilePreview implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private context!: ComponentFramework.Context<IInputs>;
    private reading!: P.HostReading;
    private container!: HTMLDivElement;
    private bar!: HTMLDivElement;
    private nameText!: HTMLSpanElement;
    private factsText!: HTMLSpanElement;
    private openButton!: HTMLButtonElement;
    private downloadButton!: HTMLButtonElement;
    private replaceButton!: HTMLButtonElement;
    private removeButton!: HTMLButtonElement;
    private stage!: HTMLDivElement;
    private status!: HTMLParagraphElement;
    private picker!: HTMLInputElement;

    private view: View = { phase: 'loading' };
    private target: Target | null = null;
    /** What the current load is for; a pass with the same key leaves the file alone. */
    private key: string | null = null;
    /** Bumped by every load and by `destroy`, so a late answer for an earlier one is dropped. */
    private token = 0;
    private aborter: AbortController | null = null;
    private busy: 'uploading' | 'removing' | 'saving' | null = null;
    private busyName = '';
    /** A sentence about the last write or download that went wrong; cleared by the next action. */
    private notice: string | null = null;
    /** What the stage was last drawn for, so a pass that changes nothing rebuilds nothing. */
    private stageKey = '';
    private dragDepth = 0;
    private destroyed = false;

    public init(
        context: ComponentFramework.Context<IInputs>,
        _notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.container = container;
        this.container.classList.add('FilePreview');

        this.bar = this.element('div', 'FilePreview-bar');

        const title = this.element('div', 'FilePreview-title');

        this.nameText = this.element('span', 'FilePreview-name');
        this.factsText = this.element('span', 'FilePreview-facts');
        title.append(this.nameText, this.factsText);

        const actions = this.element('div', 'FilePreview-actions');

        this.openButton = this.button('open', this.onOpen);
        this.downloadButton = this.button('download', this.onDownload);
        this.replaceButton = this.button('replace', this.onChoose);
        this.removeButton = this.button('remove', this.onRemove);
        actions.append(this.openButton, this.downloadButton, this.replaceButton, this.removeButton);

        this.bar.append(this.icon('document', 'FilePreview-emblem'), title, actions);

        this.stage = this.element('div', 'FilePreview-stage');

        // Polite, and the one place a state is announced: loading, uploading,
        // what went wrong. A screen reader hears the change, not the layout.
        this.status = this.element('p', 'FilePreview-status');
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');

        // Visually hidden rather than `display: none`, which is not reliably
        // clickable from script; out of the tab order and the accessibility
        // tree, because the buttons are what a person reaches.
        this.picker = document.createElement('input');
        this.picker.type = 'file';
        this.picker.className = 'FilePreview-picker';
        this.picker.tabIndex = -1;
        this.picker.setAttribute('aria-hidden', 'true');
        this.picker.addEventListener('change', this.onPicked);

        this.container.append(this.bar, this.stage, this.status, this.picker);

        // The whole control is the drop target. `dragover` must prevent the
        // default or `drop` never fires — and it is prevented even where a
        // drop is not taken, so a file dropped on a read-only preview is
        // refused here instead of opened by the browser in place of the form.
        this.container.addEventListener('dragenter', this.onDragEnter);
        this.container.addEventListener('dragover', this.onDragOver);
        this.container.addEventListener('dragleave', this.onDragLeave);
        this.container.addEventListener('drop', this.onDrop);

        this.render(context);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.render(context);
    }

    /** Nothing: the bound column is where the control sits, not what it changes. */
    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {
        this.destroyed = true;
        this.token += 1;
        this.aborter?.abort();
        this.release(this.view);
        this.picker.removeEventListener('change', this.onPicked);
        this.container.removeEventListener('dragenter', this.onDragEnter);
        this.container.removeEventListener('dragover', this.onDragOver);
        this.container.removeEventListener('dragleave', this.onDragLeave);
        this.container.removeEventListener('drop', this.onDrop);
    }

    /* ---- passes ----------------------------------------------------------- */

    private render(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;
        this.reading = P.readHost(context);

        const r = this.reading;
        // Measured: saving a new record keeps this instance and hands it the
        // new id, so the key moves and the load follows; opening another
        // record from a view mounts a new instance instead.
        const key = [r.clientUrl, r.table, r.recordId, r.askedColumn.trim().toLowerCase()].join('|');

        this.container.classList.toggle('FilePreview--hidden', !r.visible);
        this.container.classList.toggle('FilePreview--dark', r.dark === true);
        this.container.dir = r.isRTL ? 'rtl' : 'ltr';
        this.container.setAttribute('role', 'group');
        this.container.setAttribute('aria-label', r.label || this.str('FilePreview_Name'));
        this.stage.style.setProperty('--FilePreview-height', `${r.previewHeight}px`);

        if (key !== this.key) {
            this.key = key;
            this.notice = null;
            void this.load();
        }

        this.draw();
    }

    /**
     * Resolve what to show, then fetch it. Each step's answer is checked
     * against the token: a record changed under a slow download is a later
     * load's business, and the earlier one's bytes are dropped.
     */
    private async load(): Promise<void> {
        const token = ++this.token;
        const r = this.reading;

        this.aborter?.abort();
        this.aborter = typeof AbortController === 'function' ? new AbortController() : null;
        this.target = null;
        this.show({ phase: 'loading' });

        if (r.clientUrl === null || r.table === '') {
            this.show({ phase: 'blocked', reason: 'needsForm', detail: '' });

            return;
        }

        const clientUrl = r.clientUrl;
        let columns: FileColumn[] | null;

        try {
            columns = await P.fileColumns(clientUrl, r.table);
        } catch {
            columns = null;
        }

        if (token !== this.token) {
            return;
        }
        if (columns === null) {
            this.show({ phase: 'error', message: this.str('FilePreview_DefinitionFailed') });

            return;
        }

        const resolution = resolveColumn(r.askedColumn, columns);

        if (!resolution.ok) {
            const names = resolution.candidates.map((c) => `${c.label} (${c.name})`).join(', ');

            this.show({
                phase: 'blocked',
                reason: resolution.reason,
                detail: resolution.reason === 'ambiguous' ? names : resolution.asked,
            });

            return;
        }
        if (r.recordId === null) {
            this.show({ phase: 'blocked', reason: 'saveFirst', detail: '' });

            return;
        }

        const [set, limits] = await Promise.all([
            P.entitySet(clientUrl, r.table),
            P.columnLimits(clientUrl, r.table, resolution.column),
        ]);

        if (token !== this.token) {
            return;
        }
        if (set === null) {
            this.show({ phase: 'error', message: this.str('FilePreview_DefinitionFailed') });

            return;
        }

        this.target = { clientUrl, table: r.table, recordId: r.recordId, set, column: resolution.column, limits };

        await this.fetchFile(token);
    }

    private async fetchFile(token: number): Promise<void> {
        const t = this.target;

        if (!t) {
            return;
        }

        const image = t.column.kind === 'Image';
        const wantsFull = image && t.limits?.canStoreFullImage === true;
        const signal = this.aborter?.signal;
        let answer: P.Download;
        let thumbnailOnly = image && !wantsFull;

        try {
            answer = await P.download(t.clientUrl, valuePath(t.set, t.recordId, t.column.name, wantsFull), PREVIEW_LIMIT, signal);

            // An Image column that says it keeps a full copy and has none for
            // this record answers 204: the thumbnail is what there is.
            if (wantsFull && answer.status === 204 && token === this.token) {
                thumbnailOnly = true;
                answer = await P.download(t.clientUrl, valuePath(t.set, t.recordId, t.column.name, false), PREVIEW_LIMIT, signal);
            }
        } catch (error) {
            if (token === this.token) {
                this.show({ phase: 'error', message: this.str('FilePreview_Offline') });
            }

            return;
        }

        if (token !== this.token) {
            return;
        }

        // Measured: an empty File column is 404 `0x80040217`, an empty Image
        // column 204 — to the full and the plain request alike.
        if (answer.status === 404 || answer.status === 204) {
            this.show({ phase: 'empty' });

            return;
        }
        if (answer.status === 403) {
            this.show({ phase: 'blocked', reason: 'noAccess', detail: '' });

            return;
        }
        if (answer.status < 200 || answer.status >= 300) {
            this.show({ phase: 'error', message: this.str('FilePreview_LoadFailed', errorMessageOf(answer.body) ?? `HTTP ${answer.status}`) });

            return;
        }

        const name = answer.facts.name || t.column.label;
        const mime = effectiveMime(answer.facts.mime, name);
        const kind = kindOf(mime);
        const blob = answer.blob ? new Blob([answer.blob], { type: mime }) : null;
        const file: Shown = {
            name,
            size: answer.facts.size ?? blob?.size ?? null,
            mime,
            kind,
            blob,
            url: null,
            text: null,
            truncated: false,
            tooLarge: answer.tooLarge,
            thumbnailOnly,
        };

        // Typed, always: measured, an untyped (octet-stream) blob in a frame
        // is not drawn — the browser downloads it on every draw.
        if (blob && (kind === 'image' || kind === 'pdf')) {
            file.url = objectUrl(blob);
        }
        if (blob && kind === 'text') {
            file.text = await blob.slice(0, TEXT_LIMIT).text();
            file.truncated = blob.size > TEXT_LIMIT;

            if (token !== this.token) {
                return;
            }
        }

        this.show({ phase: 'file', file });
    }

    private show(view: View): void {
        if (this.destroyed) {
            return;
        }

        if (this.view !== view) {
            this.release(this.view);
        }

        this.view = view;
        this.draw();
    }

    private release(view: View): void {
        if (view.phase === 'file') {
            revoke(view.file.url);
        }
    }

    /* ---- what may be done ------------------------------------------------- */

    /** Replace and Remove: opted in, an editable form, a user who may write, a saved record the control has resolved. */
    private canChange(): boolean {
        const r = this.reading;

        return r.allowChanges && !r.disabled && r.writePrivilege !== false && this.target !== null
            && (this.view.phase === 'file' || this.view.phase === 'empty');
    }

    /* ---- drawing ---------------------------------------------------------- */

    private draw(): void {
        if (this.destroyed) {
            return;
        }

        const view = this.view;
        const changeable = this.canChange();
        const file = view.phase === 'file' ? view.file : null;

        this.container.classList.toggle('FilePreview--filled', file !== null);
        this.container.classList.toggle('FilePreview--droppable', changeable && this.busy === null);
        this.container.classList.toggle('FilePreview--busy', this.busy !== null);

        this.bar.hidden = file === null;

        if (file) {
            this.nameText.textContent = file.name;
            this.nameText.title = file.name;
            this.factsText.textContent = [file.size !== null ? formatSize(file.size, this.reading.locale) : '', typeLabel(file)].filter(Boolean).join(' · ');
        }

        const idle = this.busy === null;

        // Labelled here rather than in init, which has no `context` yet; the
        // title carries the label for a bar too narrow to show it.
        [this.openButton, this.downloadButton, this.replaceButton, this.removeButton].forEach((button) => {
            const text = this.str(button.dataset.key ?? '');
            const label = button.querySelector('.FilePreview-actionLabel');

            if (label && label.textContent !== text) {
                label.textContent = text;
                button.title = text;
            }
        });

        this.openButton.hidden = !(file && (file.kind === 'pdf' || file.kind === 'other' || file.tooLarge) && this.reading.openFile !== null);
        this.downloadButton.hidden = file === null;
        this.replaceButton.hidden = !(file && changeable);
        this.removeButton.hidden = !(file && changeable && this.reading.confirm !== null);
        [this.openButton, this.downloadButton, this.replaceButton, this.removeButton].forEach((button) => {
            button.disabled = !idle;
        });

        this.drawStage(changeable);
        this.drawStatus();
    }

    private drawStatus(): void {
        let text = '';

        if (this.busy === 'uploading') {
            text = this.str('FilePreview_Uploading', this.busyName);
        } else if (this.busy === 'removing') {
            text = this.str('FilePreview_Removing');
        } else if (this.busy === 'saving') {
            text = this.str('FilePreview_Saving', this.busyName);
        } else if (this.notice) {
            text = this.notice;
        } else if (this.view.phase === 'loading') {
            text = this.str('FilePreview_Loading');
        }

        this.status.textContent = text;
        this.status.hidden = text === '';
        this.status.classList.toggle('FilePreview-status--error', this.busy === null && this.notice !== null);
    }

    private drawStage(changeable: boolean): void {
        const view = this.view;
        const key = [
            view.phase,
            view.phase === 'file' ? view.file.url ?? view.file.name : '',
            view.phase === 'blocked' ? `${view.reason}:${view.detail}` : '',
            view.phase === 'error' ? view.message : '',
            changeable && view.phase === 'empty' ? 'droppable' : '',
            this.busy === null ? '' : 'busy',
        ].join('|');

        if (key === this.stageKey) {
            return;
        }

        this.stageKey = key;
        // Cleared, not replaced: `replaceChildren` is newer than some hosts.
        this.stage.innerHTML = '';
        this.stage.className = `FilePreview-stage FilePreview-stage--${view.phase}`;

        switch (view.phase) {
            case 'loading':
                this.stage.append(this.element('div', 'FilePreview-placeholder'));
                break;

            case 'blocked':
                this.stage.append(this.paragraph('FilePreview-note', this.blockedText(view.reason, view.detail)));
                break;

            case 'error': {
                const retry = this.textButton(this.str('FilePreview_Retry'), () => {
                    this.key = null;
                    this.render(this.context);
                });

                this.stage.append(this.paragraph('FilePreview-note FilePreview-note--error', view.message), retry);
                break;
            }

            case 'empty': {
                const box = this.element('div', 'FilePreview-empty');

                box.append(this.icon('document', 'FilePreview-emptyEmblem'), this.paragraph('FilePreview-prompt', this.str('FilePreview_Empty')));

                if (changeable) {
                    const choose = this.textButton(this.str('FilePreview_Choose'), this.onChoose);

                    choose.disabled = this.busy !== null;
                    box.append(this.paragraph('FilePreview-detail', this.str('FilePreview_DropHint')), choose);
                }

                this.stage.append(box);
                break;
            }

            case 'file':
                this.drawFile(view.file);
                break;
        }
    }

    private drawFile(file: Shown): void {
        if (file.tooLarge || file.blob === null) {
            this.stage.append(this.card(this.str('FilePreview_TooLarge', file.size !== null ? formatSize(file.size, this.reading.locale) : '')));

            return;
        }

        switch (file.kind) {
            case 'image': {
                const img = document.createElement('img');

                img.className = 'FilePreview-image';
                img.alt = file.name;
                img.decoding = 'async';
                img.src = file.url ?? '';
                this.stage.append(img);

                if (file.thumbnailOnly) {
                    this.stage.append(this.paragraph('FilePreview-detail', this.str('FilePreview_ThumbnailOnly')));
                }
                break;
            }

            case 'pdf': {
                // Measured: a typed PDF draws inline on a model-driven form.
                // Two hosts cannot: a sandboxed document (the hub's demo),
                // where Chrome shows its blocked-page icon instead, and — by
                // decision, unmeasured — the phone app, whose WebView may have
                // no PDF viewer. Both get a sentence beside Open and Download.
                if (P.isSandboxed() || this.reading.mobile) {
                    this.stage.append(this.card(this.str('FilePreview_PdfNotHere')));
                    break;
                }

                const frame = document.createElement('iframe');

                frame.className = 'FilePreview-frame';
                frame.title = this.str('FilePreview_PreviewOf', file.name);
                frame.src = file.url ?? '';
                this.stage.append(frame);
                break;
            }

            case 'text': {
                const pre = this.element('pre', 'FilePreview-text');

                pre.textContent = file.text ?? '';
                pre.tabIndex = 0;
                pre.setAttribute('aria-label', this.str('FilePreview_PreviewOf', file.name));
                this.stage.append(pre);

                if (file.truncated) {
                    this.stage.append(this.paragraph('FilePreview-detail', this.str('FilePreview_TextCut', formatSize(TEXT_LIMIT, this.reading.locale))));
                }
                break;
            }

            default:
                this.stage.append(this.card(this.str('FilePreview_NoPreview')));
        }
    }

    private card(text: string): HTMLElement {
        const card = this.element('div', 'FilePreview-card');

        card.append(this.icon('document', 'FilePreview-emptyEmblem'), this.paragraph('FilePreview-prompt', text));

        return card;
    }

    private blockedText(reason: Blocked, detail: string): string {
        switch (reason) {
            case 'saveFirst':
                return this.str('FilePreview_SaveFirst');
            case 'needsForm':
                return this.str('FilePreview_NeedsForm');
            case 'noAccess':
                return this.str('FilePreview_NoAccess');
            case 'none':
                return this.str('FilePreview_NoColumn');
            case 'ambiguous':
                return this.str('FilePreview_Ambiguous', detail);
            case 'notFile':
            case 'invalid':
                return this.str('FilePreview_NotFileColumn', detail);
        }
    }

    /* ---- actions ---------------------------------------------------------- */

    private onOpen = (): void => {
        void this.handOver(1);
    };

    private onDownload = (): void => {
        void this.handOver(2);
    };

    /**
     * Open (1) or save (2). A file too large to have been fetched for the
     * preview is fetched now, without the limit — the user asked for it.
     */
    private async handOver(openMode: 1 | 2): Promise<void> {
        const view = this.view;
        const t = this.target;

        if (view.phase !== 'file' || !t || this.busy !== null) {
            return;
        }

        const file = view.file;
        let blob = file.blob;

        this.notice = null;

        if (!blob) {
            this.busy = 'saving';
            this.busyName = file.name;
            this.draw();

            try {
                const full = t.column.kind === 'Image' && t.limits?.canStoreFullImage === true && !file.thumbnailOnly;
                const answer = await P.download(t.clientUrl, valuePath(t.set, t.recordId, t.column.name, full), Number.POSITIVE_INFINITY);

                blob = answer.blob ? new Blob([answer.blob], { type: file.mime }) : null;
            } catch {
                blob = null;
            }

            this.busy = null;
        }

        const handed = blob ? await P.handOver(this.reading, file.name, file.mime, blob, openMode) : false;

        if (!handed) {
            this.notice = this.str('FilePreview_DownloadFailed');
        }

        this.draw();
    }

    private onChoose = (): void => {
        if (!this.canChange() || this.busy !== null) {
            return;
        }

        this.picker.value = '';
        this.picker.click();
    };

    private onPicked = (): void => {
        const file = this.picker.files?.[0];

        if (file) {
            void this.upload(file);
        }
    };

    private async upload(file: File): Promise<void> {
        const t = this.target;

        if (!t || !this.canChange() || this.busy !== null) {
            return;
        }

        // Busy before the first await: the blocked list is a request, and a
        // second drop arriving while it is out would otherwise pass the guard
        // above and upload too (the suite's two-drop case).
        this.notice = null;
        this.busy = 'uploading';
        this.busyName = file.name;
        this.draw();

        const blocked = await P.blockedAttachments(t.clientUrl);
        const refusal = refusalFor(
            { name: file.name, size: file.size, type: file.type },
            { maxSizeInKB: t.limits?.maxSizeInKB ?? null, blocked, imageOnly: t.column.kind === 'Image' },
        );

        if (refusal) {
            this.busy = null;
            this.notice = this.refusalText(refusal, file.name, t.limits?.maxSizeInKB ?? null);
            this.draw();

            return;
        }

        const { path, headers } = uploadTarget(t.set, t.recordId, t.column.name, file.name);
        let answer: P.Answer | null = null;

        try {
            answer = await P.upload(t.clientUrl, path, headers, file);
        } catch {
            answer = null;
        }

        this.busy = null;

        if (this.destroyed) {
            return;
        }

        if (answer && answer.ok) {
            await this.reload();

            return;
        }

        this.notice = answer === null ? this.str('FilePreview_Offline') : this.writeFailure('FilePreview_UploadFailed', answer, file.name);
        this.draw();
    }

    private onRemove = (): void => {
        void this.removeFile();
    };

    private async removeFile(): Promise<void> {
        const t = this.target;
        const view = this.view;
        const confirm = this.reading.confirm;

        if (!t || view.phase !== 'file' || !confirm || !this.canChange() || this.busy !== null) {
            return;
        }

        this.notice = null;

        const confirmed = await confirm({
            title: this.str('FilePreview_ConfirmTitle'),
            text: this.str('FilePreview_ConfirmText', view.file.name),
            confirmButtonLabel: this.str('FilePreview_Remove'),
        });

        if (!confirmed || this.destroyed || this.busy !== null) {
            return;
        }

        this.busy = 'removing';
        this.draw();

        let answer: P.Answer | null = null;

        try {
            answer = await P.remove(t.clientUrl, columnPath(t.set, t.recordId, t.column.name));
        } catch {
            answer = null;
        }

        this.busy = null;

        if (this.destroyed) {
            return;
        }

        if (answer && answer.ok) {
            await this.reload();

            return;
        }

        this.notice = answer === null ? this.str('FilePreview_Offline') : this.writeFailure('FilePreview_RemoveFailed', answer, view.file.name);
        this.draw();
    }

    /** After a write, the file is read again — the server's answer is the proof, not the request's. */
    private reload(): Promise<void> {
        const token = ++this.token;

        this.aborter?.abort();
        this.aborter = typeof AbortController === 'function' ? new AbortController() : null;

        return this.fetchFile(token);
    }

    private refusalText(refusal: ReturnType<typeof refusalFor>, name: string, maxSizeInKB: number | null): string {
        switch (refusal) {
            case 'blocked':
                return this.str('FilePreview_Blocked', name);
            case 'empty':
                return this.str('FilePreview_EmptyFile', name);
            case 'notImage':
                return this.str('FilePreview_NotImage', name);
            case 'tooBig':
                return this.str('FilePreview_TooBig', name, formatSize((maxSizeInKB ?? 0) * 1024, this.reading.locale));
            default:
                return this.str('FilePreview_TooBigOneRequest', name);
        }
    }

    /**
     * The server's refusal in the control's words where it has them — the
     * two codes the form answered (SPEC.md, 2026-10-02): over `MaxSizeInKB`,
     * and a blocked type, whose own message ("not a valid type or is too
     * large") names neither.
     */
    private writeFailure(key: string, answer: P.Answer, name: string): string {
        const code = errorCodeOf(answer.body);

        if (code === '0x80044a02') {
            return this.str('FilePreview_TooBig', name, formatSize((this.target?.limits?.maxSizeInKB ?? 0) * 1024, this.reading.locale));
        }
        if (code === '0x80043e09') {
            return this.str('FilePreview_Blocked', name);
        }
        if (answer.status === 403) {
            return this.str('FilePreview_NotPermitted');
        }

        return this.str(key, errorMessageOf(answer.body) ?? `HTTP ${answer.status}`);
    }

    /* ---- drag and drop ---------------------------------------------------- */

    private onDragEnter = (event: DragEvent): void => {
        event.preventDefault();
        this.dragDepth += 1;
        this.container.classList.toggle('FilePreview--over', this.canChange() && this.busy === null);
    };

    private onDragOver = (event: DragEvent): void => {
        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = this.canChange() && this.busy === null ? 'copy' : 'none';
        }
    };

    private onDragLeave = (): void => {
        this.dragDepth = Math.max(0, this.dragDepth - 1);

        if (this.dragDepth === 0) {
            this.container.classList.remove('FilePreview--over');
        }
    };

    private onDrop = (event: DragEvent): void => {
        event.preventDefault();
        this.dragDepth = 0;
        this.container.classList.remove('FilePreview--over');

        const file = event.dataTransfer?.files?.[0];

        if (file && this.canChange() && this.busy === null) {
            void this.upload(file);
        }
    };

    /* ---- small DOM helpers ------------------------------------------------ */

    private str(key: string, ...args: string[]): string {
        const text = this.context.resources.getString(key);

        return args.reduce((out, arg, i) => out.split(`{${i}}`).join(arg), text);
    }

    private element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);

        node.className = className;

        return node;
    }

    private paragraph(className: string, text: string): HTMLParagraphElement {
        const p = this.element('p', className);

        p.textContent = text;

        return p;
    }

    private icon(name: string, className: string): SVGSVGElement {
        const svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
        const path = document.createElementNS(SVG, 'path');

        svg.setAttribute('class', className);
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        path.setAttribute('d', ICONS[name]);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.append(path);

        return svg;
    }

    /** An action in the bar: icon and label, the label kept for a narrow bar to hide. */
    private button(name: 'open' | 'download' | 'replace' | 'remove', onClick: () => void): HTMLButtonElement {
        const button = this.element('button', `FilePreview-action FilePreview-action--${name}`);
        const label = this.element('span', 'FilePreview-actionLabel');
        const keys = { open: 'FilePreview_Open', download: 'FilePreview_Download', replace: 'FilePreview_Replace', remove: 'FilePreview_Remove' };

        button.type = 'button';
        button.dataset.key = keys[name];
        button.append(this.icon(name, 'FilePreview-actionIcon'), label);
        button.addEventListener('click', onClick);

        return button;
    }

    private textButton(text: string, onClick: () => void): HTMLButtonElement {
        const button = this.element('button', 'FilePreview-action FilePreview-action--text');

        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', onClick);

        return button;
    }
}

function objectUrl(blob: Blob): string | null {
    try {
        return typeof URL?.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
    } catch {
        return null;
    }
}

function revoke(url: string | null): void {
    if (url) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            // Already gone.
        }
    }
}

/** `PDF`, `PNG`, `TXT` — the extension a person recognises, else the type's subtype. */
function typeLabel(file: Shown): string {
    const dot = file.name.lastIndexOf('.');

    if (dot > 0 && dot < file.name.length - 1) {
        return file.name.slice(dot + 1).toUpperCase();
    }

    return file.mime.split('/')[1]?.toUpperCase() ?? '';
}
