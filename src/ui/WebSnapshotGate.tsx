import { useEffect, useState, type FormEvent } from 'react';
import { Database, LockKeyhole, ShieldCheck } from 'lucide-react';
import App from './App';
import { unlockSnapshot, lockSnapshot, getUnlockedSnapshotManifest } from '../adapters/snapshot/browserReader';
import { initializeRepository, replaceFunds, setSourceStatus } from '../app/persistence';

export default function WebSnapshotGate() {
  const [ready, setReady] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState<ReturnType<typeof getUnlockedSnapshotManifest>>(null);

  useEffect(() => () => lockSnapshot(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const snapshot = await unlockSnapshot(passphrase);
      await initializeRepository();
      await replaceFunds(snapshot.funds, snapshot.manifest.snapshot_id ?? snapshot.manifest.generated_at);
      const fetchedAt = Date.parse(snapshot.manifest.generated_at);
      await setSourceStatus({
        fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null,
        dataAsOf: snapshot.manifest.data_as_of,
        status: 'ok',
        detail: `${snapshot.manifest.fund_count.toLocaleString('en-IN')} schemes · ${snapshot.manifest.history_count.toLocaleString('en-IN')} encrypted NAV histories.`,
      });
      localStorage.setItem('fundscope-amfi-aum-status', snapshot.manifest.disclosures?.aum ?? 'Not checked in this snapshot');
      localStorage.setItem('fundscope-amfi-ter-status', snapshot.manifest.disclosures?.ter ?? 'Not checked in this snapshot');
      setManifest(snapshot.manifest);
      setPassphrase('');
      setReady(true);
    } catch (cause) {
      lockSnapshot();
      setError(cause instanceof Error ? cause.message : 'Could not unlock the FundScope data snapshot.');
    } finally { setBusy(false); }
  };

  if (ready) return <App />;
  return <main className="snapshot-gate">
    <form className="snapshot-card" onSubmit={submit}>
      <div className="snapshot-brand"><span className="snapshot-brand-mark"><Database size={19}/></span><span>Fund<span>Scope</span></span><small>WEB</small></div>
      <div className="snapshot-lock"><LockKeyhole size={22}/></div>
      <p className="eyebrow">PRIVATE DATA · PUBLIC APP</p>
      <h1>Unlock FundScope</h1>
      <p className="snapshot-copy">The nightly data snapshot is encrypted. Enter the shared passphrase to unlock this browser session.</p>
      <label htmlFor="snapshot-passphrase">Data passphrase</label>
      <input id="snapshot-passphrase" type="password" autoComplete="current-password" autoFocus required minLength={16} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="At least 16 characters" />
      {error && <div role="alert" className="snapshot-error">{error}</div>}
      <button className="button primary snapshot-submit" type="submit" disabled={busy || passphrase.length < 16}>{busy ? 'Loading encrypted data…' : 'Unlock data'}</button>
      <p className="snapshot-security"><ShieldCheck size={14}/> The passphrase stays in this tab and is never sent to the server.</p>
      {manifest && <p className="snapshot-meta">{manifest.fund_count.toLocaleString('en-IN')} schemes · {manifest.history_count.toLocaleString('en-IN')} NAV histories</p>}
    </form>
  </main>;
}
