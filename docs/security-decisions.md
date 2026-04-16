# Security Decisions

## SQLite Encryption

**Decision (2026-04-16):** SQLite is not encrypted at rest via SQLCipher. We accept residual risk.

**Rationale:**

- `android:allowBackup="false"` prevents the database from appearing in standard Android cloud backups (API < 31).
- On Android 12+ (API 31+), cloud backup is governed by `dataExtractionRules` rather than `allowBackup`. The manifest references `@xml/secure_store_data_extraction_rules` and `@xml/secure_store_backup_rules`, but **those XML files do not currently exist in the repository** — creating them with explicit exclusions is a follow-up task. Until they exist, D2D backup behaviour on Android 12+ is undefined (treat as a known gap, not a guarantee).
- Sensitive credentials (Supabase tokens) are stored in `expo-secure-store` (Keystore-backed), not SQLite.
- SQLite contains envelope names, amounts, and transaction records — financial metadata but not payment-card or credential data.
- Installing SQLCipher (`op-sqlite` fork) would require a bare-workflow native module, a significant migration of the Drizzle schema, and a key-derivation strategy (key pinning in Keystore). This is deferred to a dedicated security sprint.

**Residual risk:** A rooted device or physical access to an unlocked device could read the database file. On Android 12+ devices, D2D backup may also expose the database until `secure_store_data_extraction_rules.xml` is created. Acceptable for internal beta; re-evaluate before general availability.

**Owner:** Henza Kruger — revisit when MAU > 100 or first enterprise inquiry.
