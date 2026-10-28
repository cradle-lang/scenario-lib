---
title: Railway PR validation example
description: A Railway ICS topology imported to exercise pull request metadata, compiler and module validation.
source: Jia Yi's Railway delivery bundle, as attributed by the supplied README
category: ICS
tags: [Railway, ICS, Validation]
requirements: CradleXC, cradle-lib, the bundled Railway configs, Ubuntu 22.04 and Windows Server 2019 images, and the backend and package services documented in the source README.
draft: true
---

## Purpose

This contribution tests the normal PR workflow by adding the Railway scenario
and its bundled application configurations. The source was imported from the
supplied Railway folder; the specification contents are unchanged and the
entrypoint was renamed from Railway.cradle to scenario.cradle.

## Topology and exercise

The specification defines ten guests: a router, four PLCs, one RTU, a Physical
World host and three HMI hosts. Four networks connect the hub, engineering,
management and operations roles. No attack events are declared.

[Download the specification](./scenario.cradle).
See the [original README](./README.md) for role details and the recorded deployment.

## Requirements and setup

Use the bundled configs with the shared cradle-lib modules referenced by the
specification. A runtime deployment needs the images, OpenStack backend and
package services described in the original README. The import omits the local
cradle.toml deployment profile; configure a deployment separately if required.
CI validates source and module references without provisioning infrastructure.

## Expected results and validation evidence

The PR should trigger article metadata checks, cxc validate for syntax and
structure, and config/heuristic reference resolution against bundled modules
and cradle-lib. Railway contains config references but no heuristic calls;
existing hello-world and validation-smoke-test scenarios exercise heuristic
resolution in the same all-scenario validation run.

The original README reports OpenStack deployment results dated 2026-10-21.
Those are supplied historical claims, not runtime tests performed for this PR.
Inspect this PR's Actions logs and scenario-validation artifact for current
compiler and dependency results. This entry remains a draft during testing.

## Attribution and licensing

The supplied README attributes the migration to Jia Yi's Railway delivery bundle
and the specification credits Cyber-range-deployment-system-2 for the topology.
A redistribution license is not documented in the supplied README. Confirm the
rights and licensing for the scenario and bundled payloads before publication.
