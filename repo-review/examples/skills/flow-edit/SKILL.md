---
name: flow-edit
description: Safely edit function-node JavaScript inside the NutSync Node-RED flow. Loads the flow, patches one named function node's `func` (or its `initialize`/`finalize`), re-serializes with 2-space indent and NO trailing newline for a minimal diff, applies the SAME edit to BOTH nutsync-flow.json and flows.json, syntax-validates the edited node with vm.Script, and runs npm test. Never reformats the whole file. Grounded in how the backdoor (HUB-SEC-02) and SQLi (HUB-SEC-03) were fixed.
version: 1.0.0
category: flow
tags:
  - node-red
  - flows.json
  - function-node
  - minimal-diff
  - security
  - vm-validate
---

# /flow-edit — Surgically edit a Node-RED function node

> **Stack-specific adaptable EXAMPLE (Node-RED flow editing).** Not part of the portable kit — it shows how a deep review turns a fragile, stack-specific edit (function-node JS inside flow JSON) into a safe, minimal-diff skill. Adapt the load → patch → re-serialize → validate → test loop to your own stack; don't copy verbatim.

This skill demonstrates the shape and depth of a stack-specific guarding skill
that a deep review can author. See the full version in the remote repository for
the complete step-by-step workflow including: node identification, twin-file editing,
vm.Script validation, diff verification, and test execution.
