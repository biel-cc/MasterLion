# SLS product telemetry

`product-telemetry-log.yaml` creates the `product-events` Logstore with 90-day retention and collects the JSONL written by Masterino. The application strips credential-like fields before writing and never sends file bytes.

Create a Scheduled SQL job in SLS using `telemetry-daily.sql` as the query, `product-events` as the source, and `telemetry-daily` as the destination. Configure the destination Logstore for 365-day retention. Run it once per day for the previous complete Shanghai calendar day and use write mode `APPEND` with a deterministic day/name result key so retries can be reconciled.

The SLS dashboard should use `telemetry-daily` for product/operations charts and `product-events` only for 90-day drill-down. Langfuse remains the source for model input/output and call-chain inspection.
