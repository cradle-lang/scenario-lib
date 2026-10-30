# Railway OpenStack fixture

This project is the role-oriented CradleXC migration of Jia Yi's Railway
delivery bundle. It contains the infrastructure topology and application
services, but intentionally has no attack events yet.

Application payloads are split into narrow configs:

- generic Python dependencies use `pip` and contain no wheels;
- Railway common modules are separate function-oriented configs;
- each PLC, RTU, HMI, and Physical World role contains only its own files;
- no complete `railway_linux.zip` or `railway_windows.zip` is committed.

The current tree contains 24 configs, 191 files, and about 4.5 MiB of
payload. Host-to-role mapping exists only in `Railway.cradle`.

Python dependencies are installed from the configured package index. The
kentridge `proxpi` endpoint is `http://172.19.125.31:3141/index/`. The backend
writes the guest pip configuration and allowlists only that index address; no
general Internet egress is required.

Regenerate the role assets from the original delivery bundle with:

```bash
python3 ../../../scripts/split-railway-payload.py
```

Build with both the shared content library and this project's configs:

```bash
export PATH=/path/to/cxc-backend-openstack/target/debug:$PATH
cxc build \
  --output build/openstack
```

The project-local `configs/` directory is the first dependency and therefore
the primary config source. The shared `cradle-lib` repository is fetched from
its default branch into the CXC content cache; a local `cradle-lib` checkout is
not required.

Each build generates deployment-specific Linux and Windows SSH keys under
`_internal/keys`. For a Windows scenario, extraction downloads the pinned
WinPmem release, verifies its SHA-256 on the controller, and copies it into
the guest.

Non-user-run assets are grouped under `_internal/`. Provisioning references
config assets through `{{ playbook_dir }}/_internal/configs/...`, so the
output can be transferred to the deployment host without also copying the
original config repositories.

## Validation record

Validated against OpenStack 2025.1 on kentridge on 2026-10-21:

- 10 scenario guests plus one bastion reached `ACTIVE`;
- initial provisioning completed with `failed=0` on every host;
- PLC services listened on TCP 502, 503, 504, and 505, and the RTU listened
  on TCP 102;
- Physical World listened on UDP 3001 and the three HMI processes were
  running under startup scheduled tasks;
- an ED guest reached the MD/OP Windows WinRM endpoints through Fw-rail;
- kentridge SSH, swl SSH, Keystone, and direct Internet HTTPS were blocked,
  while apt-cacher-ng and the internal pip index remained reachable;
- truncate and the empty event play completed on all hosts;
- Linux log and AVML memory extraction completed with matching controller-side
  source/raw metadata, hash sidecars, and file permissions.

The project still intentionally declares no attack events. Event authoring is
separate work from validating the OpenStack deployment and application-role
configuration path.
