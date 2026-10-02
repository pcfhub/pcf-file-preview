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

Every row of that table came from Learn and was then **measured on the form
on 2026-10-02** (the probe below), with two corrections Learn does not make:
a non-ASCII name must be read from `Content-Disposition`, not
`x-ms-file-name`, and an empty Image column answers 204 where an empty File
column answers 404.

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

Measured 2026-10-02, cll365, Chrome 154 on Windows, round 1 (reads):

- **P1** A full File column answers **200**, `Content-Type: application/octet-stream`
  (so the blob must be re-typed — confirmed), `mimetype: application/pdf`,
  `x-ms-file-name`, `x-ms-file-size: 307160`, `Content-Disposition: inline;
  filename=…`, **no `Content-Length`** — the size is `x-ms-file-size`. Every
  header is readable (same origin; `Access-Control-Expose-Headers` lists the
  three anyway). An empty File column answers **404**, JSON,
  `0x80040217` *No file attachment found for attribute*. Non-Latin-1 names:
  round 2.
- **P1b** `$expand=account_FileAttachments(...)` answers 200 with `filename`,
  `filesizeinbytes`, `mimetype`, `regardingfieldname` — a size without the
  download (0.2.0 material). `<column>_name` exists for a File column, **not
  for an Image column** (400 `0x80060888`); an Image column's full copy is
  not listed in `FileAttachments`.
- **P2** **The typed `blob:` PDF draws inline** in an `<iframe>`, `<object>`
  and `<embed>`; no CSP refusal. The **untyped** (octet-stream) blob in an
  iframe drew nothing and fired no `load`. An untyped image blob *does* draw
  (`<img>` sniffs). Cosmetic: Chrome's viewer titles the frame with the
  blob's UUID, and its own save button would save under that name.
- **P5** The casts answer: `MaxSizeInKB` 65536 / 1024, Image 10240 with
  `CanStoreFullImage: true`. Whether `getEntityMetadata` carries them: the
  probe cut its answer at 600 characters — asked again in round 2.
  It reports `IsValidForUpdate: false` for `cll_smallfile` and `true` for
  `cll_contract` — round 2's PATCH will say whether that means anything.
- **P6** `?size=full` answers 200 with the full 1600 × 1200 copy (plus
  `x-ms-image-pixel-width/height`, `x-ms-color-depth-bits`). An **empty Image
  column answers 204** to both the full and the plain request — not the File
  column's 404.
- **P8** `navigation.openFile` takes both: `openMode` 1 opens the PDF in a new
  browser tab, 2 downloads it under its own name. Open earns its button.
- In passing: the table definition, entity set and limits are fetched once
  per page and survive record-to-record navigation (the module stays loaded).

Round 2 (writes), same day:

- **P1, names outside ASCII.** **`x-ms-file-name` is unusable for them**:
  `Übersicht — 2026.pdf`, uploaded by the platform's own control and stored
  correctly (`cll_contract_name` and `FileAttachments.filename` both read
  right), arrives as `ÃÅbersicht Ã¢â¬â 2026.pdf` — UTF-8 read as
  Windows-1252, encoded to UTF-8 again, handed over as Latin-1. The same
  response's **`Content-Disposition` carries it correctly**, RFC 2047:
  `inline; filename="=?utf-8?B?w5xiZXJzaWNodCDigJQgMjAyNi5wZGY=?="` (an ASCII
  name comes bare: `filename=contract.pdf`). So the name is read from
  `Content-Disposition` first. The rig's and the hub harness's
  percent-encoded `x-ms-file-name` was the wrong guess: both should model
  this response. The 200 here *did* carry `Content-Length`; round 1's did not.
- **P2, the untyped variant downloads.** An `octet-stream` blob in an
  `<iframe>` is not drawn — Chrome **downloads it, under the blob's UUID**,
  every time the tab is drawn. Probe only (0.1.0 types every blob), but it is
  the strongest reason the re-typing must never be skipped.
- **P3** After a `PATCH` or a `DELETE`: the preview follows (the re-GET); the
  **form does not go dirty**; `updateView` does **not** fire; and **the
  platform's own File control on the same form keeps showing the old file**
  until the page is refreshed. A limitation to document, not to fix — there
  is no PCF call that refreshes another control.
- **P4** The server's refusals, forced past the control's own checks: a
  blocked type answers **400 `0x80043e09`** *The attachment is either not a
  valid type or is too large…* (the control showed it raw — 0.1.0 maps it to
  `FilePreview_Blocked`); over `MaxSizeInKB` answers **400 `0x80044a02`**
  *Attachment file size is too big.*, which the control already maps to
  `FilePreview_TooBig`. `organizations?$select=blockedattachments` answers
  200. `DELETE` answers **204** (2.4 s here), and the re-GET is 404 → empty.
  `cll_smallfile`'s `IsValidForUpdate: false` did not stop the `PATCH`
  reaching the size check.

Round 3 (moving, large files), same day:

- **P7** This app shows no record-set arrows on the form. Opening another
  record from the view **remounts every control** (the pass counter restarts
  at 1 with the new `entityId`), so a stale request cannot reach the new
  record on that path. The one path that keeps the instance while the record
  changes — saving a new record — is asked separately.
- **P9** A 20 MB PDF drew "fast" (the user's word). A 30 MB one: the headers
  answered in 577 ms, the control read `x-ms-file-size` 31457244, abandoned
  the body (`tooLarge`) and showed `FilePreview_TooLarge`; **Download fetched
  the whole file** (headers 444 ms, handed to `openFile` 2.3 s later) under
  its own name. The 25 MB preview limit stands.
- **P10** Not run: no Power Apps mobile app to hand. Stays in *Not verified*;
  0.1.0 decides the phone's behaviour without it.

Final run, same day:

- **P5** `getEntityMetadata`'s attribute for a File or Image column carries
  **neither `MaxSizeInKB` nor `CanStoreFullImage`** (its full descriptor read:
  type, flags, `ColumnNumber`, securing flags; an Image column is
  `IsLogical`, `AttributeOf: <column>id`). The two cast reads stay.
- **P3, names on the way up.** `PATCH …/cll_contract?x-ms-file-name=%C3%9Cbersicht.pdf`
  answered 204, and the record reads `Übersicht.pdf` — **the query parameter
  stores a non-ASCII name correctly**. Only reading needs the
  `Content-Disposition` route (`=?utf-8?B?w5xiZXJzaWNodC5wZGY=?=` here).
- **`IsValidForUpdate` means nothing for a File column**: `cll_smallfile`
  reports `false`, and a 300 KB `PATCH` to it answered 204 and drew. The
  control must not read it.
- **P7, a new record saved.** Before the save every instance showed
  `FilePreview_SaveFirst` (beside the platform's own *This record hasn't been
  created yet*). On **Save** the **same instances** (pass counters carried on)
  received the new `entityId` with `keyChanged: true`, loaded, and showed
  *No file yet.* without a reload. The load key follows the record.

**The probe is complete.** What 0.1.0 changes because of it: the name comes
from `Content-Disposition` (RFC 2047 `B` and `Q` words, RFC 5987 `filename*`,
then a bare `filename`), `x-ms-file-name` only when it is plain ASCII;
`0x80043e09` maps to `FilePreview_Blocked`; the probe goes — its untyped frame
downloaded the file on every draw; docs name the platform File control that
stays stale after a write; the rig and the hub harness answer non-ASCII names
the way the service does.

Decided with the user after the probe, 2026-10-02, not to reopen:

- **Phones get the card.** When `context.client.getClient()` is `Mobile`, a
  PDF shows the Open/Download card the sandboxed demo already uses; images
  still draw inline. P10 was not run, and Android's WebView has no PDF viewer.
- **Chrome's PDF toolbar stays.** Zoom, pages, search and print are worth the
  blob's UUID in the viewer's title; File Preview's own Download keeps the
  real name.

## Walkthrough 0.1.0 — on the form, before the tag

The probe's set-up stays (Accounts form, the *File Preview probe* tab, the
two accounts, `.probe-kit/file-preview/`). Import 0.1.0 over the probe.

| | Do | Expect |
| --- | --- | --- |
| W1 | Open *Probe full* | The PDF drawn once — no variant frames under it — and **no file downloaded** by opening the tab |
| W2 | Replace with `Übersicht — 2026.pdf`; then Download | The bar reads `Übersicht — 2026.pdf`, and the download saves under that name |
| W3 | Drop `test.exe` on the contract | *test.exe cannot be uploaded: this organisation blocks files of that type.* — the file is never sent |
| W4 | Drop `two-megabytes.pdf` on Small file | *…is larger than this column allows (1 MB).* — the file is never sent |
| W5 | Remove the contract, confirm | *No file yet.*; the form shows no unsaved changes |
| W6 | **+ New**, the probe tab, Save | *Save the record…*, then *No file yet.* after the save, without a reload |

**Answered 2026-10-02 on cll365 (Chrome 154, Windows): W1–W6 all as expected.**

## Demo

`demo.fidelity` is `limited`. The hub's harness answers File and Image
columns from `demo/fixture.json`'s `dataverse.files` — pcfhub branch
`feat/demo-file-columns` (`c373422`, `626d23b`, `9fc4e49`), **not yet
deployed**: until it is, the hub's demo answers these requests with its
"no Dataverse behind this demo" refusal. The fixture: one account, a contract
PDF, a storefront photo with its thumbnail, a CSV price list and an empty
column (`cr123_signedcopy`), each column 1 MB.

**Measured 2026-10-02, the 0.1.0 build inside the real harness** (the branch
at `9fc4e49`, `dev/hub-demo.html` as the parent, headless): the photo drawn
full size; the CSV as text; the PDF as its card with Open and Download, and
Download reaching the parent as `harness:navigate` under its name; on the
empty column `.exe` and a 2 MB file refused before sending, and
`Übersicht — 2026.txt` uploaded through the query string and read back
right through `Content-Disposition`; on the photo a text file refused, then
Remove → the confirm dialog → `DELETE` → the empty state (an Image column's
204).

**On the live hub (2026-10-02, after pcfhub #74 deployed) the photo was a
broken image** — not seen in the stand-in run, because the local dev server
sends no content-security policy and `demos.pcfhub.dev` does:
`img-src 'self' https://cdn.pcfhub.dev data:`, no `blob:`. The PDF card was
right. 0.1.1 keeps the blob URL first (a form draws it, measured) and on the
image's `error` draws the same bytes once as a `data:` URL, as
pcf-file-drop's preview always does — verified in Chrome under that exact
`img-src` (data URL, 960 px drawn) and without it (blob URL kept).

The 0.0.1 build's run in the same harness found that **a PDF cannot draw in
the demo** (Chrome runs no PDF viewer in a sandboxed document) — hence the
card on an opaque origin — and the stand-in-parent technique itself; both
are in the skill now (*The demo block* in `pcfhub-manifest.md`).

## Not verified

- A user without Write on the table, or with the column secured: no Basic
  User on the test environment.
- The phone client (P10): no Power Apps mobile app was to hand.
- Browsers other than Chrome 154 on Windows: Edge, Firefox and Safari were
  not opened.
- The route table, the inline PDF and the 25 MB limit were measured on
  2026-10-02 (above) and are no longer in this list.
