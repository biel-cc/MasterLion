# Excel

Use `.xlsx` for structured data, calculations, trackers, and dashboards.

- Create and name worksheets first, then write headers and data ranges.
- Distinguish input cells, calculated cells, and totals with consistent number formats and styles.
- Use formulas only for local workbook calculations. Never create formulas that call external data, links, DDE, RTD, or web services.
- Prefer Excel tables and filters for datasets; freeze the header row for long sheets.
- Add data validation where users must choose or enter constrained values.
- Add basic charts only after their source ranges exist and keep chart labels readable.
- Inspect every worksheet for formula errors, truncated columns, hidden data, and misleading number formats.

Batch operations address paths such as `/Sheet1`, cell or range descendants, and chart/table descendants. Use exact sheet names and inspect structure before repairing uncertain paths.
