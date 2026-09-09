---
description: Surveillance — inspect telemetry: errors, injection flags, tool usage. Usage: /observe [hours]
agent: general
---

Surveillance report.

1. Read the telemetry files under ~/.config/opencode/telemetry/ (today's run-YYYY-MM-DD.jsonl plus previous days as needed).
2. Summarize: top tools by usage count, tool failures, injection flags, error/idle events.
3. Flag anomalies: repeating failures, unusually long tool arguments, unexpected injection flags.
4. Note cost-relevant volume if visible in the logs (tokens per tool call).

Keep the report tight — one table and 3-5 bullet findings. Do not dump raw logs.