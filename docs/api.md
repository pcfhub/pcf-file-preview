---
title: API reference
description: Properties, generated from the control manifest, and the notes the manifest cannot carry.
order: 4
---

# API reference

## Input properties

::props-table{kind=input}

## Bound properties

::props-table{kind=bound}

## Notes

- **Placed on** (`value`) accepts any column type in the platform's usual
  set — text, number, date, choice, yes/no, lookup and the rest. It is a
  place on the form only: the control never reads or writes it.
- **File column** (`fileColumn`) takes a logical name — lower case, as
  *Name* shows it under **Tables → Columns**. An unknown name, or one that is
  not a File or Image column, is reported in the control rather than
  ignored.
- **Preview height** (`previewHeight`) is clamped to 120–2000 pixels.
- **Record ID** and **Record table** (`recordId`, `recordEntity`) are read
  only when the form does not say which record the control is on. On a
  model-driven form, leave them blank.
- **Features.** The control declares **Utility**, optional, to ask whether
  the user may write to the table. It declares no **WebAPI** feature: the
  file is read and written with same-origin requests to the Web API, which no
  feature gates.

## Requests it makes

For a reader auditing what the control does on the network — every request
goes to the environment's own Web API, under the signed-in user:

| When | Request |
| --- | --- |
| Once per table | `EntityDefinitions(LogicalName='<table>')/Attributes` — which columns are File or Image; `?$select=EntitySetName` |
| Once per column | the column's `FileAttributeMetadata` or `ImageAttributeMetadata` — `MaxSizeInKB`, `CanStoreFullImage` |
| Each record | `GET <set>(<id>)/<column>/$value` (`?size=full` for an Image column that keeps full-size copies) |
| Before an upload | `organizations?$select=blockedattachments`, once per page |
| Replace | `PATCH <set>(<id>)/<column>`, the file as the body |
| Remove | `DELETE <set>(<id>)/<column>` |
