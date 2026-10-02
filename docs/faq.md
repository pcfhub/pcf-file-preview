---
title: FAQ
description: Questions that come up more than once.
order: 7
---

# FAQ

## Why can't I put it on the File column itself?

The platform does not let any code component bind a File or Image column —
the control manifest has no type for either. File Preview sits on another
column and reaches the file through the record instead. See
[Model-driven apps](model-driven.md#the-column-it-sits-on).

## It says to set File column — what goes there?

The column's **logical name**, as the message lists it in brackets:
`cr123_contract`, not *Contract*. You find it under **Tables → your table →
Columns**, in the *Name* column.

## I replaced the file, but the form's own File control still shows the old one.

That is expected: the change was saved straight to the record, and the
platform's control does not know. Refresh the page and it catches up. See
[Limitations](limitations.md).

## Why is a PDF not drawn in the demo?

The demo runs in a sandboxed frame, and Chrome will not run its PDF viewer in
one. On a model-driven form it is drawn.

## Does it work offline / on mobile?

On the phone app it is built to — with a PDF offered to Open or Download
rather than drawn — but it has not yet been tested on a phone; an issue
saying how it behaves on yours is welcome. Offline, the file cannot be
fetched, and the control says the file could not be reached, with **Try
again**.

## How do I report a bug?

Open an issue at <https://github.com/pcfhub/pcf-file-preview/issues>, with the
platform version and the control version from the solution.
