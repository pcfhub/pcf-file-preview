/**
 * Which column holds the file.
 *
 * The maker names it in `fileColumn`, or leaves it blank. Blank takes the
 * table's only File column, and — on a table with none — its only Image
 * column; anything else is a question the control asks back, naming the
 * candidates, rather than a guess. File before Image because nearly every
 * standard table carries an Image column of its own (`entityimage`, the
 * record's picture), and a blank that counted it would be ambiguous on every
 * account and contact.
 *
 * Pure: the suite loads it from source.
 */

import { isLogicalName } from './route';

export type ColumnKind = 'File' | 'Image';

export interface FileColumn {
    name: string;
    kind: ColumnKind;
    /** The column's display name in the user's language, or its logical name. */
    label: string;
}

export type Resolution =
    | { ok: true; column: FileColumn }
    | { ok: false; reason: 'none' | 'ambiguous' | 'notFile' | 'invalid'; asked: string; candidates: FileColumn[] };

const KINDS: Record<string, ColumnKind> = { FileType: 'File', ImageType: 'Image' };

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The File and Image columns among a table's attribute definitions — read by
 * `AttributeTypeName.Value`, since both are `Virtual` underneath. A shadow
 * column (`AttributeOf` set) is never one, whatever it says.
 */
export function fileColumnsOf(attributes: unknown): FileColumn[] {
    if (!Array.isArray(attributes)) {
        return [];
    }

    const out: FileColumn[] = [];

    for (const item of attributes as any[]) {
        const name = typeof item?.LogicalName === 'string' ? item.LogicalName.toLowerCase() : '';
        const kind = KINDS[item?.AttributeTypeName?.Value];

        if (name === '' || kind === undefined || item?.AttributeOf) {
            continue;
        }

        const label = item?.DisplayName?.UserLocalizedLabel?.Label;

        out.push({ name, kind, label: typeof label === 'string' && label !== '' ? label : name });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveColumn(asked: unknown, columns: FileColumn[]): Resolution {
    const name = typeof asked === 'string' ? asked.trim().toLowerCase() : '';

    if (name !== '') {
        if (!isLogicalName(name)) {
            return { ok: false, reason: 'invalid', asked: name, candidates: columns };
        }

        const found = columns.find((column) => column.name === name);

        return found ? { ok: true, column: found } : { ok: false, reason: 'notFile', asked: name, candidates: columns };
    }

    const files = columns.filter((column) => column.kind === 'File');
    const images = columns.filter((column) => column.kind === 'Image');

    if (files.length === 1) {
        return { ok: true, column: files[0] };
    }
    if (files.length === 0 && images.length === 1) {
        return { ok: true, column: images[0] };
    }

    // The candidates are the ones that made it a question: two File columns
    // are the choice, and the record's picture beside them is not part of it.
    return { ok: false, reason: columns.length === 0 ? 'none' : 'ambiguous', asked: '', candidates: files.length > 1 ? files : columns };
}
