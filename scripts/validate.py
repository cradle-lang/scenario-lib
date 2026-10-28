#!/usr/bin/env python3
"""Validate scenario metadata and local content."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ROOT / "scenarios"
CATALOG = ROOT / "catalog.json"
REQUIRED_METADATA = {
    "schema_version",
    "id",
    "title",
    "description",
    "tags",
    "version",
    "entrypoint",
}
OBJECT_PATH = re.compile(r'location\("(?:\$\{uriLocal\})/([^"]+)"\)')
REPOSITORY_LOCAL = re.compile(r'repositoryLocal\("([^"]*)"\)')


def fail(message: str) -> None:
    raise ValueError(message)


def parse_scalar(value: str):
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        body = value[1:-1].strip()
        if not body:
            return []
        return [part.strip().strip("'\"") for part in body.split(",")]
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    if value.isdigit():
        return int(value)
    return value


def read_front_matter(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        fail(f"{path}: README.md must start with YAML front matter")
    try:
        end = next(
            index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"
        )
    except StopIteration:
        fail(f"{path}: unterminated YAML front matter")

    metadata: dict = {}
    current_list: str | None = None
    for line in lines[1:end]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- "):
            if current_list is None:
                fail(f"{path}: list item outside a list field: {line}")
            item = stripped[2:].strip().strip("'\"")
            metadata[current_list].append(item)
            continue
        key, separator, value = stripped.partition(":")
        if not separator or not key.strip():
            fail(f"{path}: malformed front matter line: {line}")
        key = key.strip()
        value = value.strip()
        if value:
            metadata[key] = parse_scalar(value)
            current_list = None
        else:
            metadata[key] = []
            current_list = key
    return metadata


def validate_configs(scenario: Path) -> None:
    configs = scenario / "configs"
    if not configs.exists():
        return
    for config in sorted(path for path in configs.iterdir() if path.is_dir()):
        templates = [
            config / "ansible" / f"{config.name}.{suffix}"
            for suffix in ("j2", "yml", "yaml")
        ]
        if not any(template.is_file() for template in templates):
            fail(f"{config}: missing ansible/{config.name}.j2|yml|yaml")


def validate_heuristics(scenario: Path) -> None:
    heuristics = scenario / "heuristics"
    if not heuristics.exists():
        return
    for framework in sorted(path for path in heuristics.iterdir() if path.is_dir()):
        for heuristic in sorted(path for path in framework.iterdir() if path.is_dir()):
            templates = [
                heuristic / "ansible" / f"{heuristic.name}.{suffix}"
                for suffix in ("j2", "yml", "yaml")
            ]
            if not any(template.is_file() for template in templates):
                fail(f"{heuristic}: missing ansible/{heuristic.name}.j2|yml|yaml")
            manifest_path = heuristic / "manifest.json"
            if not manifest_path.is_file():
                fail(f"{heuristic}: missing manifest.json")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("framework") != framework.name:
                fail(f"{manifest_path}: framework does not match {framework.name!r}")
            if manifest.get("value") != heuristic.name:
                fail(f"{manifest_path}: value does not match {heuristic.name!r}")


def validate_objects(scenario: Path, cradle_text: str) -> None:
    scenario_root = scenario.resolve()
    repository_match = REPOSITORY_LOCAL.search(cradle_text)
    repository = repository_match.group(1) if repository_match else ""
    object_root = (scenario / repository).resolve()
    for relative in OBJECT_PATH.findall(cradle_text):
        target = (object_root / relative).resolve()
        try:
            target.relative_to(scenario_root)
        except ValueError:
            fail(f"{scenario}: object path escapes the scenario directory: {relative}")
        if not target.is_file():
            fail(f"{scenario}: object file does not exist: {relative}")


def run_cxc(scenario: Path, entrypoint: Path) -> None:
    cxc = shutil.which("cxc")
    if not cxc:
        return
    result = subprocess.run(
        [cxc, "validate", "--input", entrypoint.name],
        cwd=scenario,
        text=True,
        capture_output=True,
    )
    if result.returncode:
        fail(f"{entrypoint}: cxc validate failed:\n{result.stdout}{result.stderr}")


def scenario_entry(scenario: Path) -> dict:
    readme = scenario / "README.md"
    if not readme.is_file():
        fail(f"{scenario}: missing README.md")
    metadata = read_front_matter(readme)
    missing = sorted(REQUIRED_METADATA - metadata.keys())
    if missing:
        fail(f"{readme}: missing metadata fields: {', '.join(missing)}")
    if metadata["schema_version"] != 1:
        fail(f"{readme}: unsupported schema_version {metadata['schema_version']!r}")
    if metadata["id"] != scenario.name:
        fail(f"{readme}: id must match directory name {scenario.name!r}")

    entrypoint = scenario / metadata["entrypoint"]
    if not entrypoint.is_file() or entrypoint.suffix != ".cradle":
        fail(f"{readme}: entrypoint is not a .cradle file: {metadata['entrypoint']}")

    cradle_text = entrypoint.read_text(encoding="utf-8")
    if "repositoryLocal(" not in cradle_text:
        fail(f"{entrypoint}: expected repositoryLocal(...) for portable object paths")

    validate_configs(scenario)
    validate_heuristics(scenario)
    validate_objects(scenario, cradle_text)
    run_cxc(scenario, entrypoint)

    catalog_entry = {
        key: metadata[key]
        for key in (
            "id",
            "title",
            "description",
            "tags",
            "version",
            "entrypoint",
        )
    }
    catalog_entry["path"] = scenario.relative_to(ROOT).as_posix()
    if metadata.get("preview"):
        preview = scenario / metadata["preview"]
        if not preview.is_file():
            fail(f"{readme}: preview does not exist: {metadata['preview']}")
        catalog_entry["preview"] = metadata["preview"]
    return catalog_entry


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true", help="regenerate catalog.json")
    args = parser.parse_args()

    scenario_dirs = sorted(path for path in SCENARIOS.iterdir() if path.is_dir())
    entries = [scenario_entry(path) for path in scenario_dirs]
    ids = [entry["id"] for entry in entries]
    if len(ids) != len(set(ids)):
        fail("duplicate scenario IDs")

    expected = {"schema_version": 1, "scenarios": entries}
    if args.update:
        CATALOG.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
        print(f"updated {CATALOG}")
        return 0

    actual = json.loads(CATALOG.read_text(encoding="utf-8"))
    if actual != expected:
        fail("catalog.json is stale; run python3 scripts/validate.py --update")
    print(f"validated {len(entries)} scenario(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"validation error: {error}", file=sys.stderr)
        raise SystemExit(1)

