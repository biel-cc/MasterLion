---
name: office-documents
description: Create, fill, inspect, validate, preview, and export Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) files with Masterino's pinned OfficeCLI tools. Use for new Office files, deterministic template merges, structured document changes, or visual and OOXML quality checks.
---

# Office Documents

Use the dedicated structured tools backed by OfficeCLI 1.0.143. Never invoke OfficeCLI through shell commands and never install or update it at runtime.

## Select one format guide

Read exactly one reference before creating content:

- Word: `references/word`
- Excel: `references/excel`
- PowerPoint: `references/powerpoint`

## Required workflow

1. Form the content outline and source data.
2. Call `createOfficeDocument`, or call `mergeOfficeTemplate` for an uploaded template.
3. Call `batchOfficeDocument` once with all primary `add`, `set`, `move`, `remove`, or `swap` operations. Batch execution is atomic.
4. Call `inspectOfficeDocument` with `outline`, then `issues`.
5. Call `inspectOfficeDocument` with `screenshot` for visual QA. Make at most two repair batches.
6. Call `validateOfficeDocument`.
7. Call `exportFile` only after validation succeeds. A preview failure may be reported without blocking a validated download.

Keep generated files and previews under `/tmp/masterino-office`. Read uploaded templates and images only from `/mnt/data`; never modify an uploaded original.

Do not use raw OOXML, `raw-set`, `add-part`, plugins, macros, external resources, legacy `.doc/.xls/.ppt`, PDF conversion, or PowerPoint animation. Do not use `--best-effort` semantics. If the dedicated tools explicitly report that OfficeCLI is disabled, use the existing Python fallback for the whole file and do not mix engines.
