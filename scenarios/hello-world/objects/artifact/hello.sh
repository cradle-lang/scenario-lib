#!/usr/bin/env bash
set -euo pipefail

message="Hello from the CRADLE Hello World scenario"
printf '%s\n' "$message"
printf '%s\n' "$message" > /tmp/hello-world-event.txt

