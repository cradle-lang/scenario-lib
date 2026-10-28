# CRADLE Scenario Library

Portable CRADLE scenarios with their scenario-specific configs, heuristics,
objects, and preview assets.

## Repository layout

```text
scenario-lib/
├── catalog.json
├── scenarios/
│   ├── hello-world/
│   │   ├── README.md
│   │   ├── HelloWorld.cradle
│   │   ├── preview.svg
│   │   ├── configs/
│   │   └── objects/
│   └── ...
└── scripts/validate.py
```

Each scenario is self-contained and uses the same directory names as CXC:

- `configs/`: scenario-specific configs
- `heuristics/`: scenario-specific heuristics
- `objects/`: files referenced by `object(...)`
- `assets/`: optional diagrams and documentation images

`cradle.toml` and generated deployment directories are intentionally excluded
from Git. Each user creates a local deployment profile for their testbed.

## Scenario metadata

Each scenario's `README.md` starts with machine-readable front matter:

```markdown
---
schema_version: 1
id: hello-world
title: Hello World
description: A short description of the scenario.
tags:
  - example
  - ubuntu
version: 0.1.0
entrypoint: HelloWorld.cradle
preview: preview.svg
---
```

`catalog.json` is generated from these metadata blocks.

## Build a scenario

Create an untracked `cradle.toml` inside the scenario directory and select the
backend available on your testbed. For example:

```toml
name = "HelloWorld"
target = "vagrant"

[backend.vagrant]
provider = "libvirt"

[dependencies]
hello-local = { path = "." }
cradle-lib = { git = "https://github.com/cradle-lang/cradle-lib.git" }
```

Then build from that directory:

```bash
cxc build --output build
```

For OpenStack, select `target = "openstack"` and provide that backend's local
deployment settings. Deployment-specific addresses, credentials, images, and
backend arguments do not belong in this repository.

## Validate

```bash
python3 scripts/validate.py
```

The validator checks README metadata, entrypoints, local configs, heuristic
manifests, object paths, duplicate IDs, and `catalog.json`. It also runs
`cxc validate` when CXC is installed.

