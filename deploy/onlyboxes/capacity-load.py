#!/usr/bin/env python3
"""Run the repeatable 30-session Onlyboxes capacity acceptance workload."""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import json
import math
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone


JIT_TOKEN_PREFIX = "obx_jit_v1."
CAPACITY_MARKERS = (
    "capacity_exhausted",
    "no online worker capacity",
    "no online worker supports",
    "no compatible worker",
    "no_worker",
    "session_capacity_exceeded",
    "worker_offline",
)
COMMANDS = (
    "python3 -c \"import pandas,polars,duckdb; print(pandas.Series([1,2,3]).sum())\"",
    "officecli --version",
    "python3 -c \"import pyarrow,statsmodels,pptx,xlsxwriter; print('imports-ok')\"",
    "printf 'terminal-ok\\n'",
)


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def create_jit_token(key: str, issuer: str, subject: str, ttl_seconds: int = 300) -> str:
    now_ms = int(time.time() * 1000)
    payload = b64url(
        json.dumps(
            {"exp": now_ms + ttl_seconds * 1000, "iss": issuer, "sub": subject},
            separators=(",", ":"),
        ).encode()
    )
    signed = f"{JIT_TOKEN_PREFIX}{payload}"
    signature = b64url(hmac.new(key.encode(), signed.encode(), hashlib.sha256).digest())
    return f"{signed}.{signature}"


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def is_capacity_error(message: str) -> bool:
    normalized = message.lower()
    return any(marker in normalized for marker in CAPACITY_MARKERS)


@dataclass
class LaneResult:
    capacity_errors: int = 0
    durations_ms: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    failures: int = 0
    requests: int = 0


class OnlyboxesClient:
    def __init__(self, base_url: str, issuer: str, key: str, timeout_seconds: int):
        self.base_url = base_url.rstrip("/")
        self.issuer = issuer
        self.key = key
        self.timeout_seconds = timeout_seconds
        self.ssl_context = ssl.create_default_context()

    def terminal(self, lane: int, session_id: str, command: str) -> float:
        subject = f"capacity-acceptance-{lane}"
        payload = json.dumps(
            {
                "command": command,
                "create_if_missing": True,
                "lease_ttl_sec": 900,
                "session_id": session_id,
                "timeout_ms": self.timeout_seconds * 1000,
            }
        ).encode()
        request = urllib.request.Request(
            f"{self.base_url}/api/v1/commands/terminal",
            data=payload,
            headers={
                "Authorization": f"Bearer {create_jit_token(self.key, self.issuer, subject)}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(
                request,
                context=self.ssl_context,
                timeout=self.timeout_seconds + 5,
            ) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {error.code}: {body[:500]}") from error
        duration_ms = (time.perf_counter() - started) * 1000
        result = json.loads(body or "{}")
        if result.get("error"):
            raise RuntimeError(json.dumps(result["error"], ensure_ascii=False))
        if result.get("exit_code") not in (None, 0):
            raise RuntimeError(str(result.get("stderr") or result.get("stdout") or result))
        return duration_ms


def run_lane(
    lane: int,
    client: OnlyboxesClient,
    deadline: float,
    start: threading.Barrier,
    run_id: str,
) -> LaneResult:
    result = LaneResult()
    session_id = f"masterino-capacity-{run_id}-{lane}"
    start.wait()
    iteration = 0
    while time.monotonic() < deadline:
        command = COMMANDS[(lane + iteration) % len(COMMANDS)]
        try:
            duration_ms = client.terminal(lane, session_id, command)
            result.durations_ms.append(duration_ms)
            result.requests += 1
        except Exception as error:  # noqa: BLE001 - report every remote failure
            message = str(error)
            result.failures += 1
            result.requests += 1
            if is_capacity_error(message):
                result.capacity_errors += 1
            if len(result.errors) < 20:
                result.errors.append(message[:500])
        iteration += 1
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("ONLYBOXES_BASE_URL", ""))
    parser.add_argument("--concurrency", type=int, default=30)
    parser.add_argument("--duration-seconds", type=int, default=1800)
    parser.add_argument("--issuer", default=os.environ.get("ONLYBOXES_JIT_ISSUER", "masterino-capacity"))
    parser.add_argument("--jit-key", default=os.environ.get("ONLYBOXES_JIT_SIGNING_KEY", ""))
    parser.add_argument("--max-p95-ms", type=float, default=3000)
    parser.add_argument("--output", default="capacity-report.json")
    parser.add_argument("--request-timeout-seconds", type=int, default=120)
    parser.add_argument("--allow-http", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.base_url or not args.jit_key:
        raise SystemExit("ONLYBOXES_BASE_URL and ONLYBOXES_JIT_SIGNING_KEY are required")
    if not args.allow_http and not args.base_url.lower().startswith("https://"):
        raise SystemExit("Onlyboxes URL must use HTTPS; use --allow-http only for loopback tests")
    if args.concurrency < 1 or args.duration_seconds < 1:
        raise SystemExit("concurrency and duration must be positive")

    run_id = uuid.uuid4().hex[:12]
    started_at = datetime.now(timezone.utc)
    deadline = time.monotonic() + args.duration_seconds
    start = threading.Barrier(args.concurrency)
    client = OnlyboxesClient(
        args.base_url,
        args.issuer,
        args.jit_key,
        args.request_timeout_seconds,
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        results = list(
            executor.map(
                lambda lane: run_lane(lane, client, deadline, start, run_id),
                range(args.concurrency),
            )
        )

    durations = [duration for result in results for duration in result.durations_ms]
    errors = [error for result in results for error in result.errors]
    capacity_errors = sum(result.capacity_errors for result in results)
    p95_ms = percentile(durations, 0.95)
    passed = capacity_errors == 0 and p95_ms is not None and p95_ms < args.max_p95_ms
    report = {
        "capacityErrors": capacity_errors,
        "concurrency": args.concurrency,
        "durationSeconds": args.duration_seconds,
        "endedAt": datetime.now(timezone.utc).isoformat(),
        "errorSamples": errors[:50],
        "failedRequests": sum(result.failures for result in results),
        "latencyMs": {
            "max": max(durations) if durations else None,
            "p50": percentile(durations, 0.5),
            "p95": p95_ms,
        },
        "note": "Latency is Console round-trip time, used as a conservative scheduling-wait proxy.",
        "passed": passed,
        "requests": sum(result.requests for result in results),
        "runId": run_id,
        "startedAt": started_at.isoformat(),
    }
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(report, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
