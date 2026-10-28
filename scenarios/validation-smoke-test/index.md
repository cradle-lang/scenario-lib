---
title: Validation workflow smoke test
description: A minimal draft scenario for testing compiler and shared content checks in CI.
source: scenario_library contributors
category: Testing
tags: [Validation, CI]
requirements: CradleXC and the checked-out cradle-lib content library.
draft: true
---

## Purpose

This draft exercises the GitHub source validation workflow with one Ubuntu host
and one network. It references the shared `linux-python3` configuration and
`heuristic("cve", "CVE-2021-41773")`. The heuristic manifest implies
`linux-auditd`, allowing CI to check indirect configuration dependencies too.

[Download the specification](./scenario.cradle).

## Validation evidence

Compiler results are recorded by the PR's validation Action. This fixture has
not been deployed or tested at runtime. It declares no exercise events.

## Attribution and licensing

Created for this repository's validation workflow. The repository license applies.
