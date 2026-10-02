---
title: Model-driven apps
description: Adding File Preview to a form, what it shows for each kind of file, and what each property does.
order: 3
---

# Using it on a model-driven form

:::steps
1. Open the form in the modern form designer.
2. Add a column for the control to sit on — **any column**; File Preview
   never reads or writes it. A second copy of a column already on the form
   works well (the designer allows a column more than once).
3. Select it, and under **Components → Add component** choose **File
   Preview**. The first time, **Get more components** lists it.
4. Set **File column** to the logical name of the File or Image column to
   show — `cr123_contract`, not *Contract* — or leave it blank (see below).
5. Switch **Allow replace and remove** on if users should change the file
   here.
6. Save and publish.
:::

## The column it sits on

A File or Image column cannot host a code component — the platform does not
allow it — so File Preview sits on another column and finds the file through
the record. That column is only a place on the form. Hide its label and give
the control a section of its own; it reads as the file's panel.

## Which file it shows

**File column** names it. Left blank, the control takes the table's only
File column — whatever Image columns the table has beside it — or, with no
File column, its only Image column. Anything less clear-cut is a question
for you: with two File columns, or no File column and two Image columns
(the table's own primary image, `entityimage`, counts as one), the control
lists them by name and logical name, and you set **File column** to one:

::image{src=media/screenshot-empty.png alt="An empty column ready for a file, the sentence on a new record, and the list shown when File column is blank on a table with two File columns" zoom}

## What it shows

| The file | Shown as |
| --- | --- |
| **PDF** | The browser's own PDF viewer, at **Preview height**. |
| **Image** — PNG, JPEG, GIF, WebP, BMP, AVIF, ICO, SVG | The image, fitted inside the preview and never enlarged. From an Image column, the full-size copy when the column keeps one; otherwise the 144-pixel thumbnail, with a line saying so. |
| **Text** — TXT, CSV, TSV, JSON, XML, YAML, Markdown, HTML, logs | The first 64 KB as plain text; a line under it says when there is more. HTML is shown as its source, never rendered. |
| **Anything else** — Word, Excel, ZIP… | A card naming the file, its size and type, with Download and Open. |
| **Over 25 MB** | A card with the size. The file is not fetched to be previewed — only when Download or Open is pressed. |

Above every file is its name, its size and type, and the buttons:
**Download** saves it under its name; **Open** hands it to the browser to
open in a new tab (shown for a PDF, a file it cannot preview, and one too
large to preview).

**On the phone app a PDF is not drawn**: a card says it can't be shown
there, with Open and Download, because some phones' in-app browsers have no
PDF viewer. Images and text are drawn as on the web.

## Replacing and removing

With **Allow replace and remove** on:

- **Replace** picks a file; or drop one onto the preview. An empty column
  shows a drop area and a **Choose a file** button.
- **Remove** asks first, in the platform's own confirmation, naming the file.
- Before anything is sent, the file is checked against the **column's
  maximum size**, the **organisation's blocked file types** (Settings →
  Administration → System settings → General, *Set blocked file extensions
  for attachments*), and for an Image column, **being an image**. A refusal
  says which, under the preview.
- After a change the file is read back from the server, so what you see is
  what was saved.

The change is saved to the record **immediately** — it does not wait for
the form's Save, and it does not leave the form with unsaved changes.

Replace and Remove are not offered on a read-only form (an inactive record,
a user without Write on the table), and the drop area is not shown there;
a dropped file is ignored rather than opened over the form.

## A new record

A record that has not been saved has nowhere to keep a file. The control
says *Save the record to see or add a file*, and once the form saves — even
without leaving it — it shows the empty column, ready for one.

## Properties

| Property | What it does |
| --- | --- |
| **Placed on** | The column the control sits on — any column. Never read or written. |
| **File column** | The logical name of the File or Image column to show. Blank: the table's only File column, else its only Image column. |
| **Allow replace and remove** | On: Replace (choose or drop a file) and Remove. Off, the default: shown and downloaded only. |
| **Preview height** | Height of the preview in pixels, 120 to 2000. Default 480. |
| **Record ID**, **Record table** | Leave blank on a form — the control reads the record from the form itself. They exist for a host that does not say which record it is on. |
