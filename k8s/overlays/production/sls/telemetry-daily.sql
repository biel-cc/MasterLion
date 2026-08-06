* |
SELECT
  date_format(date_trunc('day', from_unixtime(__time__) AT TIME ZONE 'Asia/Shanghai'), '%Y-%m-%d') AS event_day,
  name,
  coalesce(json_extract_scalar(properties, '$.provider'), '') AS provider,
  coalesce(json_extract_scalar(properties, '$.model'), '') AS model,
  count(*) AS event_count,
  count(DISTINCT userId) AS user_count,
  count(DISTINCT traceId) AS trace_count
GROUP BY event_day, name, provider, model
