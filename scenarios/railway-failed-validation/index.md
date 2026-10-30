---
title: Railway validation failure test
description: Intentionally broken Railway contribution exercising missing configs and malformed CRADLE structure.
source: Railway OpenStack fixture, derived from Jia Yi's Railway delivery bundle
category: ICS
tags: [Railway, Validation, Negative-Test]
requirements: CXC, cradle-lib and cradle-lib-cve for static validation; this fixture must fail validation.
draft: true
---

This is a negative validation test based on the same Railway example as PR #1.
The configs, artifacts and original README are imported from the Railway source.
The original Downloads folder is unchanged. Keep this test PR unmerged.

## Intentional failures

- The firewall references `railway-intentionally-missing-config`, which is not
  supplied by the scenario or shared libraries. The config resolver should report
  this name as missing.
- The `networks()` declaration lacks its terminating period after `network("op")`.
  CXC should reject the malformed CRADLE block structure.

Article and catalogue checks should pass so CI reaches compiler and dependency
validation. The validation workflow should fail, retain its `scenario-validation`
report, and skip website snapshot export. The resolver runs even when CXC fails,
so the report should contain both the compiler failure and the missing config.

## Topology and supporting files

The source defines the Railway firewall, PLCs, RTU, physical world simulator and
operator HMIs across the hub, engineering, middleware and operator networks.
See the [original README](./README.md) for setup, dependencies and attribution.

[Download the intentionally invalid specification](./Railway.cradle).

## Validation scope

This fixture is for static CI testing only. Do not deploy or execute it.
No runtime behavior is verified. The bundled assets retain their source contents;
this test does not establish any additional redistribution rights.
