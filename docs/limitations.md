---
title: Limitations
description: What File Preview does not do, and why.
order: 6
---

# Limitations

- **Model-driven apps only.** A canvas app gives a code component no
  organisation address and no record to reach a file through; the control
  says so instead of drawing. Power Pages is not supported either.
- **It sits on another column.** No control manifest can bind a File or an
  Image column, so the control is placed on any other column and finds the
  file through the record. It never reads or writes that column.
- **The platform's own File control on the same form does not update.**
  Replace and Remove are saved straight to the record, around the form, so a
  platform File or Image control beside File Preview keeps showing the old
  file until the page is refreshed. (The form is not left with unsaved
  changes; there is nothing for it to save.)
- **On the phone app a PDF is offered, not drawn.** Some phones' in-app
  browsers have no PDF viewer, so a PDF shows Open and Download there.
  Untested on a phone — say so in an issue if yours draws it and you want it
  inline.
- **Uploads go up in one request, so 128 MB is the most.** Dataverse takes a
  larger file only in chunks, which this version does not do; a file over
  128 MB is refused before it is sent, whatever the column allows.
- **25 MB is the most that is previewed.** A larger file is shown as a card
  with its size; Download and Open still fetch the whole file.
- **Text files show their first 64 KB**, as plain text. HTML is shown as its
  source, never rendered.
- **Chrome's PDF viewer titles the preview with an internal id**, and its own
  download icon in the viewer's toolbar saves under that id. Use File
  Preview's **Download** button for the file's real name.
- **One file per column.** A File or Image column holds one file; for
  several files on a record, use Notes and the
  [Attachment List](https://pcfhub.dev/components/pcf-attachment-list)
  control.
- **Not tested:** a user without Write on the table but with Read (the
  buttons should not show; the server refuses if they do), a column under
  column-level security, the phone app, and browsers other than Chrome on
  Windows.
