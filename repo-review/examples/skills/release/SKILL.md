---
name: release
description: Cut a NutSync desktop release — bump the version (committed in git first), build the Electron NSIS installer via deploy.ps1, compute the installer SHA-256, and publish version.json with the pinned hash over an HTTPS dl.dropboxusercontent.com URL so the in-app auto-updater (NS-SEC-01) will actually accept it.
---

# Release (NutSync desktop / Electron)

> **Stack-specific adaptable EXAMPLE (Electron / NSIS auto-update).** Not part of the portable kit — it shows how a deep review turns a release process into a skill. Adapt the version-bump, build, hash-and-pin, and manifest-publish steps to your own stack; don't copy verbatim.

This skill demonstrates the shape and depth of a stack-specific release skill
that a deep review can author. See the full version in the remote repository for
the complete workflow including: version rule, build steps, SHA-256 + version.json
manifest creation, publish order, end-to-end verification, and anti-patterns.
