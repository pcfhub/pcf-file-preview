---
title: Installation
description: Import the solution and make File Preview available to your forms.
order: 2
---

# Installation

:::steps
1. Download the **managed** solution for your environment.
2. In the Power Platform admin centre, or **Solutions → Import** in the
   maker portal, import the solution.
3. Publish all customizations.
4. Add the control to a form — see [Model-driven apps](model-driven.md).
:::

:::callout{type=warning}
Import the managed solution into production. The unmanaged one is for a
development environment where you intend to change the control itself — it
cannot be cleanly uninstalled.
:::

## Requirements

- A **model-driven app**, and a table with at least one **File** or **Image**
  column. File Preview does not create the column: add it under
  **Tables → your table → Columns** first.
- The column's **Maximum file size** is fixed when the column is created —
  the maker portal cannot change it afterwards. Choose it with the largest
  file you expect in mind.
- An **Image** column shows a full-size image only if the column has **Can
  store full images** on. Otherwise Dataverse keeps a 144-pixel thumbnail,
  which is all there is to show, and the control says so under it.

## Permissions

The import asks for one permission: **Utility**, which lets the control ask
whether the user may write to the table, so that Replace and Remove are not
offered to someone the server would refuse. It is optional: without it the
buttons are shown and the server's refusal is reported in words.

Users need the usual privileges on the record: **Read** to see the file, and
**Write** to replace or remove it.
