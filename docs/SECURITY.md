# FundScope snapshot security

## Threat model

The hosted app and encrypted snapshot are public static files. Anyone can download the ciphertext and attempt guesses offline. Encryption does not protect a low-entropy passphrase, and the client-side cooldown is only protection against accidental repeated attempts in one open page. Users should treat the shared `DATA_PASSPHRASE` as a secret and store it in a password manager.

`pnpm passphrase:generate` creates 20 random characters from a 32-symbol Base32 alphabet (100 bits before formatting). The ETL and secret scan use a heuristic estimate based on length and the observed character set, with reductions for repeated characters, sequences, repeated patterns, and known common words. This estimate is a gate, not a proof of entropy. `ALLOW_WEAK_PASSPHRASE=true` is accepted only for local testing and is rejected in GitHub Actions.

## Snapshot keys

Schema v2 derives a 256-bit PBKDF2-SHA256 KEK (100,000 iterations by default; the manifest carries the actual iteration count and salt). The passphrase is generated with high entropy because the public ciphertext permits offline guessing. The KEK wraps a random 256-bit AES-GCM DEK. Snapshot files are compressed, then encrypted with the DEK; authenticated additional data binds each ciphertext to its relative path and snapshot ID. The stable `keyId` and wrapped DEK are retained in the encrypted SQLite ETL state so nightly data updates do not normally require a new passphrase. V1 manifests with a canary and direct file key remain readable for migration.

The ETL fails closed if it cannot unwrap the stored DEK. Passphrase/key rotation is not automatic: it requires an intentional data-key rotation and regeneration of all encrypted snapshot files. Do not simply change the GitHub secret while keeping the old encrypted ETL state.

## Remember this device

If enabled, FundScope generates a non-extractable AES-GCM browser key and stores that `CryptoKey` in IndexedDB. The snapshot DEK is wrapped by that device key; it is not stored in plaintext. The passphrase and raw DEK are not written to `localStorage`. Session expiry is 7, 30, 90 days, or never (30 days by default). “Lock & clear” removes the saved device-session record and returns to the passphrase screen. If IndexedDB or WebCrypto storage is unavailable, FundScope falls back to passphrase unlock for that visit.

Anyone who can use an unlocked browser profile can read the data, just as with any “remember me” session. Use this only on a device/profile you control. The in-memory failure cooldown is convenience friction, not a security control; the public ciphertext still permits offline guessing.

## Data handling

No API key is needed for static hosted usage. Do not put `DATA_PASSPHRASE` in source files or `VITE_` variables. Static data remains encrypted at rest and is decrypted only in the browser. Detail and NAV files are fetched lazily; their plaintext exists in memory after a user opens or loads them.
