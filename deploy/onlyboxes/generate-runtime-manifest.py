#!/usr/bin/env python3
"""Generate the immutable capability inventory embedded in the runtime image."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


TOOLS = (
    "ffmpeg",
    "fc-list",
    "libreoffice",
    "node",
    "officecli",
    "pandoc",
    "pdftoppm",
    "python3",
)
REQUIREMENTS_PATH = Path("/opt/masterino/runtime-requirements.txt")


def sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command_version(command: str) -> str | None:
    path = shutil.which(command)
    if not path:
        return None

    for arguments in ([command, "--version"], [command, "-version"], [command, "-v"]):
        try:
            result = subprocess.run(
                arguments,
                capture_output=True,
                check=False,
                text=True,
                timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue

        output = (result.stdout or result.stderr).strip().splitlines()
        if output:
            return output[0][:500]

    return path


def installed_packages() -> list[dict[str, str]]:
    packages: list[dict[str, str]] = []
    for distribution in importlib.metadata.distributions():
        metadata = distribution.metadata
        name = metadata.get("Name")
        if not name:
            continue

        license_value = metadata.get("License-Expression") or metadata.get("License") or ""
        packages.append(
            {
                "license": " ".join(license_value.split())[:500],
                "name": name,
                "version": distribution.version,
            }
        )

    return sorted(packages, key=lambda package: package["name"].lower())


def installed_fonts() -> list[str]:
    if not shutil.which("fc-list"):
        return []

    try:
        result = subprocess.run(
            ["fc-list", ":", "family"],
            capture_output=True,
            check=False,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []

    families = {
        family.strip()
        for line in result.stdout.splitlines()
        for family in line.split(",")
        if family.strip()
    }
    return sorted(families)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    built_at = os.environ.get("MASTERINO_RUNTIME_BUILD_DATE")
    if not built_at:
        built_at = datetime.now(timezone.utc).isoformat()

    manifest = {
        "baseImage": os.environ.get("MASTERINO_RUNTIME_BASE_IMAGE", "unknown"),
        "builtAt": built_at,
        # An OCI image cannot know its own digest while it is being built. The
        # release process records the pushed digest beside this manifest.
        "imageDigest": os.environ.get("MASTERINO_RUNTIME_IMAGE_DIGEST") or None,
        "officeCliVersion": command_version("officecli"),
        "packages": installed_packages(),
        "platform": {
            "architecture": platform.machine(),
            "os": platform.platform(),
            "python": platform.python_version(),
        },
        "runtimeVersion": os.environ.get("MASTERINO_RUNTIME_VERSION", "unknown"),
        "requirementsSha256": sha256_file(REQUIREMENTS_PATH),
        "sourceRevision": os.environ.get("MASTERINO_RUNTIME_SOURCE_REVISION", "unknown"),
        "systemTools": {tool: command_version(tool) for tool in TOOLS},
        "fonts": installed_fonts(),
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
