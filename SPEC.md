# File Preview

See the PDF or image in a File or Image column on the form — and download,
replace or remove it.

## The route, and why the control sits on another column

**No manifest can bind a File or an Image column.** `of-type` has no File
(the manifest reference: *"At this time File columns are not supported"*),
and `ImageObject` is canvas only. So the control is placed on **any** column —
the 17-type group pcf-audit-history uses — never reads or writes it, and
reaches the file through the Web API by the record's id:

| | Request | Source |
| --- | --- | --- |
| Read | `GET <set>(<id>)/<column>/$value` (`?size=full` for an Image column's full copy) | Learn, *Use file column data* / *Use image column data* |
| Replace | `PATCH <set>(<id>)/<column>`, `application/octet-stream`, the name in `x-ms-file-name` (header when ASCII, query parameter otherwise) — under 128 MB | Learn |
| Remove | `DELETE <set>(<id>)/<column>` | Learn |
| Limits | `EntityDefinitions(…)/Attributes(LogicalName='c')/Microsoft.Dynamics.CRM.FileAttributeMetadata?$select=MaxSizeInKB` (and `ImageAttributeMetadata` with `CanStoreFullImage`) | Learn |
| Blocked types | `organizations?$select=blockedattachments`, fetched — no WebAPI feature for one read | — |

`context.webAPI` addresses records and their columns; a file is neither, so
every request is a same-origin `fetch`, in `platform.ts` alone. The record's
identity is `mode.contextInfo` first, then the `recordId`/`recordEntity`
inputs — pcf-audit-history's order.

Everything in that table is **Learn's**, not measured: the probe below asks
the form.

## Probe 0.0.1 — what the form has to answer

Built with `PROBE = true` in `FilePreview/probe.ts`. It records every request
(status, every readable header, time), every pass's record identity, what each
P2 element reported after loading, and any content-security-policy refusal.

**Set-up, once, on the Accounts test form (cll365):**

The maker portal cannot change a File column's maximum size once the column
exists (Learn, *Work with file column definitions*: only the API can), so the
two sizes P4 and P9 need are two columns, each made at its size.

1. On **Account**, add two **File** columns — *Contract*, `cll_contract`,
   maximum **65,536 KB** (64 MB, for P9's 30 MB file), and *Small file*,
   `cll_smallfile`, maximum **1,024 KB** (for P4's over-limit refusal) — and an
   **Image** column — *Photo*, `cll_photo`, **Can store full images** on,
   *Primary image* off. Publish.
2. Import `FilePreview_0.0.1_probe_unmanaged.zip`, publish.
3. On the form, a new tab *File Preview probe*: `cll_contract` and `cll_photo`
   themselves (the platform's own controls — for uploading, and for P3's
   comparison), then three File Preview instances, each on a second copy of
   any text column, *Allow replace and remove* **Yes**: *File column*
   `cll_contract` (preview height 600), `cll_photo`, `cll_smallfile`.
4. Two accounts: *Probe full*, with `contract.pdf` and the 1600 × 1200 photo
   uploaded through the platform's controls; *Probe empty*, left empty.

The files are generated, not found: `.probe-kit/file-preview/` in the
workspace root (not a repository) holds the zip, PDFs of 300 KB, 2 MB, 20 MB
and 30 MB, the two non-Latin-1 names, a renamed `test.exe` and the photo.

Then, for each P below, do what it says and finally, in the console with the
control's frame selected:

```js
copy(JSON.stringify(__pcfFilePreviewProbe.dump(), null, 2))
```

| | Question | What to do | What it decides |
| --- | --- | --- | --- |
| P1 | `GET …/$value` on a full column and an empty one: status, which headers are readable (`x-ms-file-name`, `x-ms-file-size`, `mimetype`, `Content-Type`), the empty column's answer — and **how a name outside Latin-1 arrives in `x-ms-file-name`** (a header cannot carry `—` or `ü`; the rig and the hub's harness percent-encode it, which is a guess) | Open the account with the PDF, then the empty one; upload a file named `Übersicht — 2026.pdf` through the platform's File control and open it | The empty state (404 by the rig; 204 possible), whether the blob must be re-typed (the rig says yes: octet-stream), and how the name is decoded |
| P1b | Does `$expand=account_FileAttachments(…)` answer, under that name? | Nothing — the probe asks on every load | Whether a size can be had without the download (0.2.0 material) |
| P2 | Does the PDF draw in an `<iframe>` from a typed `blob:` URL inside the form? And `<object>`, `<embed>`, an untyped `<iframe>`, an untyped `<img>`? Any CSP refusal? | Look at the PDF account: the probe shows the variants under the main frame — say which drew | **Inline PDF or an Open button** (decided with the user: no PDF.js) |
| P3 | `PATCH` with an ASCII name and a non-ASCII one: status, the name and `mimetype` afterwards; does `updateView` fire; is the form dirty; does the platform's own File control show the new file? | Replace with `test.pdf`, then with `Übersicht.pdf` | Whether a replace needs a form refresh, and the mimetype the server keeps |
| P4 | The server's refusals: a blocked extension, a file over `MaxSizeInKB` | `__pcfFilePreviewProbe.force = true`, then drop `test.exe` on the contract instance and `two-megabytes.pdf` on the small-file one; then Remove the contract | Which faults to name, and their codes |
| P5 | `MaxSizeInKB` and `CanStoreFullImage` through the casts; does `utils.getEntityMetadata` carry either? | Nothing — the probe asks on load | Whether the cast reads can go |
| P6 | The Image column: `?size=full` answers the full copy; what an empty Image column answers | Open the account with the photo, then the empty one | The Image empty state |
| P7 | Record to record on the same form: does `contextInfo.entityId` follow, and does the old request get dropped? | Use the form's next/previous record arrows twice, quickly | The load key |
| P8 | `navigation.openFile` with `openMode` 1 (Open) and 2 (Download) on a PDF | Press Open, then Download | Whether Open earns its button |
| P9 | A 20 MB PDF: time to draw; a 30 MB one: the too-large card, and Download fetching it | Upload both through the platform's File control (`cll_contract` is 64 MB) | The preview limit (25 MB) |
| P10 | The phone client: does the PDF frame draw? (Android's WebView has no PDF viewer) | Open the account in Power Apps mobile | Whether phones get the Open button instead |

**Answers go here, dated, one line each, before any 0.1.0 code changes.**

## Demo

The hub's harness answers File and Image columns from `demo/fixture.json`'s
`dataverse.files` — pcfhub branch `feat/demo-file-columns` (`c373422`,
`626d23b`), not yet deployed; until it is, `demo.fidelity` stays `none`. Then
`limited`: the bytes are the fixture's.

**Measured 2026-10-02, the 0.0.1 build inside the real harness** (pcfhub dev
server, `dev/hub-demo.html` as the parent, driven headless): the definition,
the column's limit through its cast and `$value` all answered; Image full
size drawn; Download reached the parent as `harness:navigate`; a dropped text
file was PATCHed and read back; a blocked `.exe` and an over-limit file were
refused before sending; Remove went through the harness's confirm dialog,
DELETE, and the empty state. **A PDF did not draw**: the frame showed Chrome's
blocked-page icon, because Chrome does not run its PDF viewer in a sandboxed
document and the demo frame is sandboxed without `allow-same-origin`. The
control now reads the opaque origin (`origin === 'null'`) and shows a card with
Open and Download instead. Two harness fixes came from the same run: an empty
column's 404 is logged as answered, and a non-image into an Image column is
refused (the control refuses it first now, too). The probe's `$expand` (P1b)
is the one request the demo refuses — it goes with the probe.

## Not verified

- Every row of the route table above (P1–P6).
- That the browser's PDF viewer draws inside a model-driven form (P2) — the
  rig cannot know, and the harness page only shows it draws outside one.
- A user without Write on the table, or with the column secured: no Basic
  User on the test environment.
- The phone client (P10).
