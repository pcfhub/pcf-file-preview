---
title: Overview
description: See the PDF, image or text file in a File or Image column on a model-driven form — and download, replace or remove it.
order: 1
---

# File Preview

A File or Image column on a model-driven form shows a file name and a button.
File Preview shows the **file**: a PDF in the browser's own viewer, an image
at full size, the first 64 KB of a text or CSV file — with **Download** and
**Open**, and, when you switch them on, **Replace** and **Remove**.

::image{src=media/screenshot-pdf.png alt="A contract PDF drawn on the form by the browser's own viewer, with Open and Download above it" zoom}

## Why this one

- **The file, where the record is.** Nobody downloads a contract to check
  which version it is. The PDF is drawn in the same viewer the browser uses
  for any PDF — zoom, pages, search and print included.
- **The name it was saved under.** Download and Open hand the file over as
  `Übersicht — 2026.pdf`, not as a random id or a mangled one. (The header
  most code reads the name from garbles any name outside plain English
  letters; File Preview reads the one that does not.)
- **Refusals before the upload.** A file over the column's size limit, or of
  a type the organisation blocks, is refused before a byte is sent — with a
  sentence that says which — instead of failing after the whole file has
  gone up.
- **Image columns at full size.** When the column keeps full-size images,
  that is what is shown — not the 144-pixel thumbnail.
- **Read-only unless you say otherwise.** Replace and Remove are off until a
  maker switches them on, and Remove asks first, in the platform's own
  confirmation.

::image{src=media/screenshot-image.png alt="An Image column's full-size photo, and a text file with Replace and Remove switched on" zoom}

## How it reaches the file

No control manifest can bind a File or an Image column — the platform does
not allow it. So File Preview is placed on **any other column** of the form
(it never reads or writes that column) and reaches the file through the
record, with the same Web API requests Microsoft documents for file columns:
download, upload in one request, delete. Nothing is copied into another
column, and the file stays where Dataverse keeps it.

## What it works with

:::callout{type=info}
**Model-driven apps only** — a model-driven form, in the browser or the
phone app. Canvas apps and Power Pages are not supported: a canvas app gives
a code component no organisation address to reach the file at, and the
control says so instead of drawing a broken frame.

**On the phone app a PDF is offered to Open or Download** rather than drawn
— some phones' in-app browsers have no PDF viewer. Images and text draw as
on the web.
:::

See [Limitations](limitations.md) for the rest, including what happens to
the platform's own File control on the same form after a Replace.
