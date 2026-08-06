# Word

Use `.docx` for reports, proposals, policies, letters, and other flowing documents.

- Create semantic headings before body paragraphs so outline inspection is meaningful.
- Prefer paragraphs and runs for text, list structures for bullets or numbering, and explicit page breaks between major sections.
- Use tables for aligned data, not for general page layout.
- Keep images inside `/mnt/data` or `/tmp/masterino-office`; use descriptive alternative text when supported.
- Add headers, footers, page numbers, hyperlinks, and basic charts only when requested or useful.
- Check page breaks, clipped tables, orphan headings, inconsistent fonts, and missing image resources in the screenshot and issues views.

Batch operations address OfficeCLI document paths such as `/body`, `/body/p[1]`, and table descendants. Use 1-based indexes and inspect the outline again before repairing uncertain paths.
