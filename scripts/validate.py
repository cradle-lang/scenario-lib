#!/usr/bin/env python3
"""Compatibility entry point for the Node catalogue and asset checks."""
from __future__ import annotations
import argparse
import json
import shutil
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true", help="regenerate catalog.json")
    parser.add_argument("--skip-cxc", action="store_true", help="check metadata/assets only")
    args = parser.parse_args()
    node = shutil.which("node")
    if not node:
        parser.error("Node.js 22+ is required; install it and run npm ci first")
    command = [node, str(ROOT / "scripts/catalog.mjs")]
    if args.update:
        command.append("--update")
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode or args.skip_cxc:
        return result.returncode
    cxc = shutil.which("cxc")
    if cxc:
        entries = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))["scenarios"]
        for entry in entries:
            directory = ROOT / entry["path"]
            result = subprocess.run([cxc, "validate", "--input", str(directory / entry["entrypoint"])], cwd=directory)
            if result.returncode:
                return result.returncode
    else:
        print("CXC is not installed: metadata/assets checked only. CI requires CXC and runs full validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
