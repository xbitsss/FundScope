export interface SnapshotFileRef {
  path: string;
  sha256: string;
  encryptedBytes: number;
  compressedBytes: number;
  plaintextBytes: number;
}

export interface SnapshotManifest {
  schema_version: 1;
  generated_at: string;
  data_as_of: number | null;
  fund_count: number;
  history_count: number;
  disclosures?: { aum: string; ter: string };
  encryption: {
    algorithm: 'AES-256-GCM';
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    canary: SnapshotFileRef & { plaintext: 'FundScope snapshot canary:v1' };
  };
  index: SnapshotFileRef;
  histories: Record<string, SnapshotFileRef>;
}
