---
schema_version: 1
id: hello-world
title: Hello World
description: A minimal CRADLE scenario combining local and cradle-lib configs, heuristics, and an event object.
tags:
  - hello-world
  - beginner
  - ubuntu
version: 0.1.0
entrypoint: HelloWorld.cradle
preview: preview.svg
---

# Hello World

This scenario is the smallest end-to-end example in the catalogue. It
demonstrates:

- one Ubuntu instance on a private network
- a scenario-local `config` that writes a readiness marker
- a reused `linux-unzip` config from remote `cradle-lib`
- a scenario-local `ttp/T1059.004` heuristic
- a reused `ttp/T1105` heuristic from remote `cradle-lib`
- a scenario-local `object` executed by `mainEvent()`
- a testbed-independent scenario with no committed deployment profile

## Local deployment profile

Create `cradle.toml` in this directory. It is ignored by Git.

For Vagrant with libvirt:

```toml
name = "HelloWorld"
target = "vagrant"

[backend.vagrant]
provider = "libvirt"

[dependencies]
hello-local = { path = "." }
cradle-lib = { git = "https://github.com/cradle-lang/cradle-lib.git" }
```

For OpenStack, choose `target = "openstack"` and add the settings required by
that OpenStack deployment.

## Run

```bash
cxc build --output build
```

Run the boot, provision, and event commands printed by CXC. After provisioning,
the guest contains `/opt/cradle/hello-world/ready.txt`. Running the event also
creates `/tmp/hello-world-event.txt`.

The remote `T1105` heuristic downloads the AVML binary during provisioning, so
the target VM needs network access to GitHub at that stage.

