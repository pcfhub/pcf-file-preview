# File Preview

See the PDF or image in a File or Image column on the form — and download, replace or remove it.

> **Reference example · built with AI.** This control was written with AI (Claude) and tested on a live Dataverse form; its code has not been reviewed line by line. It is published as a worked example and is not maintained — read the source and [`SPEC.md`](SPEC.md) (what was measured on the form) before you use it. Fixes are not guaranteed.

[![Build](https://github.com/pcfhub/pcf-file-preview/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-file-preview/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-file-preview/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-file-preview/actions/workflows/release.yml)

[![Try it live on PCFHub](https://pcfhub.dev/badges/try-it-live.svg)](https://pcfhub.dev/components/pcf-file-preview)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-file-preview), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.

## What it does

Placed on a model-driven form, it shows the file in a File or Image column:
a PDF in the browser's own viewer, an image at full size, the first 64 KB
of a text file, and a card with Download and Open for anything else. With
**Allow replace and remove** on, a file can be replaced — chosen, or dropped
on the preview — and removed behind the platform's confirmation. The
platform's own control shows a file name and a button; this shows the file.

Three decisions a reader will otherwise question. **It sits on another
column.** No manifest can bind a File or Image column, so the control is
placed on any column (the 17-type group `pcf-audit-history` uses), never
reads or writes it, and reaches the file through the record with the Web
API's own file routes — `GET …/$value`, a single `PATCH`, `DELETE` — over a
same-origin `fetch`. **The name comes from `Content-Disposition`.** Measured
on a form, the service mangles any name outside ASCII in `x-ms-file-name`
(`Übersicht.pdf` arrives as `ÃÅbersicht.pdf`) and sends it correctly only as
an RFC 2047 word in `Content-Disposition`; a non-ASCII name goes *up* in the
query string, because a browser will not send it in a header. **The bytes
are re-typed.** The download is `application/octet-stream` whatever the
file; an untyped blob in a frame is not drawn — the browser downloads it on
every draw — so the type is taken from the `mimetype` header first.

What a form does not do by itself is notice: a write goes around the form,
so the platform's File control beside this one shows the old file until
the page is refreshed. Every answer this control relies on was measured on
a live form by the 0.0.1 probe; `SPEC.md` has them, dated, and what is
still unverified (the phone app, above all).

## Properties

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `value` | any column (type group) | bound, **required** | — | The column the control sits on. Never read or written. |
| `fileColumn` | SingleLine.Text | input | — | Logical name of the File or Image column. Blank: the table's only File column, else its only Image column. |
| `allowChanges` | TwoOptions | input | off | On: Replace (choose or drop) and Remove, behind the platform's confirmation. |
| `previewHeight` | Whole.None | input | `480` | Height of the preview in pixels, clamped to 120–2000. |
| `recordId`, `recordEntity` | SingleLine.Text | input | — | The record, for a host that does not say which it is on. A form supplies it. |

A standard control: direct DOM, no framework bundled, styled from the
Fluent tokens a model-driven form publishes. Strings ship in English,
German, French, Japanese and Spanish. One feature is declared, optional:
`Utility`, to ask `hasEntityPrivilege` whether the user may write the table,
so Replace and Remove are not offered to a user the server would refuse. No
`WebAPI` feature — every request is a same-origin `fetch`, which no feature
gates.

## On the hub

`demo.fidelity` is **limited**. The demo's Dataverse is a fixture
(`demo/fixture.json`): one account with a contract PDF, a photo with its
thumbnail, a CSV price list and an empty column, answered by the hub's
harness the way a form answers — including the mangled header and the
refusals. What is real there: images and text drawn, Replace by choosing or
dropping, Remove behind the confirmation, every refusal. What is not: **a
PDF cannot be drawn** — the demo frame is sandboxed, and Chrome will not
run its PDF viewer in one, so the control shows the card it shows on a
phone — and Open and Download are reported rather than performed. Five
presets: an image, a PDF, a CSV, Replace and Remove on, and an empty column
ready for a drop.

## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-file-preview/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
npm run smoke      # assertions against the built bundle — see dev/
npm run harness    # serves dev/harness.html and opens it
```

`npm start` renders the control; `dev/` is for the states it cannot reach. Build
first, then `npm run smoke` for the assertions, or `npm run harness` for the
switches — field-level security, a failed business rule, a host that publishes
no theme or no column metadata, and for a dataset control, more than one page.
Both read the bundle `npm run build` wrote, and both are described in the header
of `dev/smoke.js`.

`npm run harness` serves the repository over `http://` rather than leaving you to
open the file: over `file://` a dataset fixture cannot be fetched and a module
script is refused, and both arrive as an empty control with a CORS error. It
takes `--port` and `--no-open`, and needs no dependency — `dev/serve.js` is
`node:http`. A React (virtual) control gets one too: `dev/fluent-stub.js` stands
in for the Fluent the platform would supply, and its header says exactly where
the stand-in is less capable than the real thing.

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

```bash
npm run bump -- --minor      # every version location, in one edit
npm run release -- --draft   # .release-notes.md, from the commits since the last tag
# …rewrite the notes, commit the bump…
npm run release -- --push
```

**On PowerShell, call the scripts directly** — `node scripts/version.mjs --minor`.
npm swallows a `--` flag there, warns *"Unknown cli config"*, and runs the
script with no arguments: it prints the report, changes nothing, and reads as a
bump that found nothing to do.

`npm run bump` with no argument is a **read**: it prints every place the version
lives and exits 1 if they disagree. Worth running before anything else, because
the same check otherwise happens in CI — on a Windows runner, after the pack, on
a tag that has already been pushed. `npm run check` now runs it too.

The version lives in **three** places, more in a repository holding several
controls, and they are checked against each other:

- `FilePreview/ControlManifest.Input.xml` → `<control version="…">`
- `Solution/src/Other/Solution.xml` → `<Version>`
- `package.json` → `"version"`

Doing it by hand is still fine, and then the thing to get right is the tag:

```bash
git tag -a --cleanup=verbatim v1.2.3 -F notes.md && git push origin v1.2.3
```

**Without `--cleanup=verbatim`, git drops every `## Heading` in the notes as a
comment, silently.** `npm run release` passes it, and then reads the tag back to
confirm the headings survived — because the failure is invisible in the command
that caused it.

**The tag message is the release body, and the release body is the changelog
on the hub.** A lightweight tag gets GitHub's generated notes instead, which
for a repository without pull requests is a single compare link — and the
workflow warns when that is about to happen.

There is deliberately no `CHANGELOG.md`. The hub builds the changelog from
release notes, and `docs/changelog.md` is a hard failure in `npm run check`.

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `FilePreview/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `dev/` | A stand-in host: `npm run smoke` asserts, `harness.html` shows |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
