---
title: Examples
description: Three complete set-ups of File Preview on a model-driven form.
order: 5
---

# Examples

## A contract on the account form, read-only

The goal: sales see the signed contract on the account without downloading
it, and only the contracts team changes it.

:::steps
1. On **Account**, add a **File** column *Contract* (`cr123_contract`), with
   **Maximum file size** set to the largest contract you expect — it cannot
   be changed later.
2. On the main form, add a tab *Contract*, and on it a second copy of
   **Account Name**. Hide its label.
3. Give that copy **File Preview**: *File column* blank (it is the table's
   only File column), *Allow replace and remove* **No**, *Preview height*
   `700`.
4. For the contracts team, put the platform's own **Contract** control on
   their form, or a second File Preview with *Allow replace and remove*
   **Yes**.
:::

::image{src=media/screenshot-pdf.png alt="The contract drawn on the form, with Open and Download" zoom}

## A product photo, replaceable by drag and drop

The goal: a product's photo at full size on its form, which the catalogue
team replaces by dropping a new one on it.

:::steps
1. On **Product**, add an **Image** column *Photo* (`cr123_photo`) with **Can
   store full images** on. Leave **Primary image** off unless it should be
   the record's picture too.
2. Place File Preview on any column of the form, with *File column*
   `cr123_photo`, *Allow replace and remove* **Yes**, *Preview height* `400`.
3. Users drop a new image on the photo, or press **Replace**. A file that is
   not an image is refused before it is sent.
:::

::image{src=media/screenshot-image.png alt="A full-size photo in an Image column, and a text file with Replace and Remove switched on" zoom}

## Two File columns on one table

The goal: a case form showing both the customer's *Signed form* and the
*Inspection report*, each in its own panel.

:::steps
1. Place two File Preview controls — on two different columns, or two copies
   of one.
2. Set *File column* on each: `cr123_signedform` on one,
   `cr123_inspectionreport` on the other. Left blank on a table with two
   File columns, each would list the two and ask.
3. Give each a section of its own, with the column's label hidden.
:::

::image{src=media/screenshot-narrow.png alt="File Preview in a 300-pixel column: the buttons wrap under the file's name" zoom}
