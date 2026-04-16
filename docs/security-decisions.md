# Security Decisions

## SQLite Encryption

**Decision (2026-04-16):** SQLite is not encrypted at rest via SQLCipher. We accept residual risk.

**Rationale:**

- `android:allowBackup="false"` prevents the database from appearing in Android cloud backups.
- `android:fullBackupContent="@xml/secure_store_backup_rules"` and `android:dataExtractionRules="@xml/secure_store_data_extraction_rules"` restrict what ADB/D2D backup can capture.
- Sensitive credentials (Supabase tokens) are stored in `expo-secure-store` (Keystore-backed), not SQLite.
- SQLite contains envelope names, amounts, and transaction records — financial metadata but not payment-card or credential data.
- Installing SQLCipher (`op-sqlite` fork) would require a bare-workflow native module, a significant migration of the Drizzle schema, and a key-derivation strategy (key pinning in Keystore). This is deferred to a dedicated security sprint.

**Residual risk:** A rooted device or physical access to an unlocked device could read the database file. Acceptable for internal beta; re-evaluate before general availability.

**Owner:** Henza Kruger — revisit when MAU > 100 or first enterprise inquiry.
