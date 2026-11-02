import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Database, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Fund } from '../domain/types';
import App from './App';
import { unlockSnapshot, lockSnapshot, getUnlockedSnapshotManifest, prefetchSnapshot, restoreSnapshotOnDevice, checkForSnapshotUpdate } from '../adapters/snapshot/browserReader';
import type { SnapshotManifest } from '../adapters/snapshot/types';
import { clearDeviceSession, updateDeviceSessionDuration } from '../adapters/snapshot/deviceSession';

interface SnapshotSource { fetchedAt: number | null; dataAsOf: number | null; status: string; detail: string | null }
interface SnapshotData { funds: Fund[]; manifest: SnapshotManifest; source: SnapshotSource; timings?: Record<string, number> }

export default function WebSnapshotGate() {
  const [ready, setReady] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState('');
  const [remember, setRemember] = useState(true);
  const [sessionDays, setSessionDays] = useState(() => { try { return localStorage.getItem('fundscope-session-days') ?? '30'; } catch { return '30'; } });
  const [manifest, setManifest] = useState<ReturnType<typeof getUnlockedSnapshotManifest>>(null);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<{ keyChanged: boolean } | null>(null);
  const [unlockTimings, setUnlockTimings] = useState<Record<string, number>>({});
  const unlockStartedAt = useRef<number | null>(null);

  useEffect(() => {
    prefetchSnapshot();
    let current = true;
    const restoreStarted = performance.now();
    unlockStartedAt.current = restoreStarted;
    void restoreSnapshotOnDevice().then((restored) => {
      if (!current || !restored) return;
      const fetchedAt = Date.parse(restored.manifest.generated_at);
      const timings = { deviceRestoreMs: performance.now() - restoreStarted };
      setUnlockTimings(timings);
      setManifest(restored.manifest);
      setSnapshot({ funds: restored.funds, manifest: restored.manifest, source: {
        fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null,
        dataAsOf: restored.manifest.data_as_of,
        status: 'ok',
        detail: `${restored.manifest.fund_count.toLocaleString('en-IN')} schemes · restored with this device key.`,
      }, timings });
      setReady(true);
    }).catch(() => undefined);
    return () => { current = false; lockSnapshot(); };
  }, []);

  useEffect(() => {
    if (!ready || !snapshot) return;
    let current = true;
    const check = async () => {
      try {
        const latest = await checkForSnapshotUpdate();
        if (!current) return;
        const oldId = snapshot.manifest.snapshot_id ?? snapshot.manifest.generated_at;
        const newId = latest.snapshot_id ?? latest.generated_at;
        if (newId !== oldId) setUpdateAvailable({ keyChanged: latest.encryption.keyId !== snapshot.manifest.encryption.keyId });
      } catch { /* Keep the current working snapshot when update checks are offline. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15 * 60_000);
    return () => { current = false; window.clearInterval(timer); };
  }, [ready, snapshot]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    unlockStartedAt.current = performance.now();
    performance.mark?.('unlock.submit');
    setBusy(true); setError(''); setPhase('Deriving key…');
    try {
      const unlocked = await unlockSnapshot(passphrase, undefined, { remember, rememberDays: sessionDays === 'never' ? null : Number(sessionDays), onProgress: setPhase });
      if (!remember) await clearDeviceSession();
      setUnlockTimings(unlocked.timings);
      setPhase('Preparing your workspace…');
      const fetchedAt = Date.parse(unlocked.manifest.generated_at);
      const source = {
        fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null,
        dataAsOf: unlocked.manifest.data_as_of,
        status: 'ok',
        detail: `${unlocked.manifest.fund_count.toLocaleString('en-IN')} schemes · ${unlocked.manifest.history_count.toLocaleString('en-IN')} encrypted NAV histories.`,
      };
      try {
        localStorage.setItem('fundscope-amfi-aum-status', unlocked.manifest.disclosures?.aum ?? 'Not checked in this snapshot');
        localStorage.setItem('fundscope-amfi-ter-status', unlocked.manifest.disclosures?.ter ?? 'Not checked in this snapshot');
      } catch { /* Storage may be unavailable in private browsing; snapshot unlock still works. */ }
      setManifest(unlocked.manifest);
      setPassphrase('');
      setSnapshot({ funds: unlocked.funds, manifest: unlocked.manifest, source, timings: unlocked.timings });
      setReady(true);
    } catch (cause) {
      lockSnapshot();
      setError(cause instanceof Error ? cause.message : 'Could not unlock the FundScope data snapshot.');
    } finally { setBusy(false); setPhase(''); }
  };

  const lockAndClear = async () => {
    await clearDeviceSession();
    lockSnapshot(); setSnapshot(null); setReady(false); setPassphrase(''); setManifest(null); setError(''); setUnlockTimings({});
  };
  const openAvailableUpdate = async () => {
    if (!updateAvailable) return;
    if (!updateAvailable.keyChanged) { window.location.reload(); return; }
    lockSnapshot(); setReady(false); setSnapshot(null); setPassphrase(''); setUpdateAvailable(null); setError('The snapshot key has changed. Enter the updated passphrase to continue.');
  };
  const changeSessionDays = (value: string) => {
    setSessionDays(value);
    try { localStorage.setItem('fundscope-session-days', value); } catch { /* The current session remains usable without storage. */ }
    void updateDeviceSessionDuration(value === 'never' ? null : Number(value));
  };

  if (ready && snapshot) return <><App initialFunds={snapshot.funds} initialSource={snapshot.source} onLock={lockAndClear} sessionDays={sessionDays} onSessionDaysChange={changeSessionDays} onFirstRows={() => setUnlockTimings(current => ({ ...current, firstRowsMs: unlockStartedAt.current === null ? 0 : performance.now() - unlockStartedAt.current }))} />{updateAvailable && <button className="snapshot-update-chip" onClick={()=>void openAvailableUpdate()}>{updateAvailable.keyChanged?'Snapshot key changed · Unlock':'New data available · Update'}</button>}{new URLSearchParams(window.location.search).get('perf') === '1' && <aside className="unlock-perf-hud"><b>Unlock timing</b>{Object.entries(unlockTimings).map(([name, milliseconds]) => <span key={name}>{name}: {milliseconds.toFixed(1)} ms</span>)}</aside>}</>;
  return <main className="snapshot-gate">
    <form className="snapshot-card" onSubmit={submit}>
      <div className="snapshot-brand"><span className="snapshot-brand-mark"><Database size={19}/></span><span>Fund<span>Scope</span></span><small>WEB</small></div>
      <div className="snapshot-lock"><LockKeyhole size={22}/></div>
      <p className="eyebrow">PRIVATE DATA · PUBLIC APP</p>
      <h1>Unlock FundScope</h1>
      <p className="snapshot-copy">The nightly data snapshot is encrypted. Enter the shared passphrase to unlock this browser session.</p>
      <input className="snapshot-username" type="text" name="username" autoComplete="username" value="FundScope" readOnly tabIndex={-1} aria-hidden="true" />
      <label htmlFor="snapshot-passphrase">Data passphrase</label>
      <div className="snapshot-password-row"><input id="snapshot-passphrase" type={showPassword ? 'text' : 'password'} name="password" autoComplete="current-password" autoFocus required minLength={16} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="At least 16 characters" enterKeyHint="go" autoCapitalize="off" autoCorrect="off" spellCheck={false} /><button type="button" className="snapshot-password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide passphrase' : 'Show passphrase'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
      <label className="snapshot-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)}/><span><b>Stay unlocked on this device</b><small>A non-extractable device key will unlock future visits in this browser profile.</small></span></label>
      {remember && <label className="snapshot-session-length">Ask again after <select value={sessionDays} onChange={(event) => changeSessionDays(event.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="never">Never</option></select></label>}
      {error && <div role="alert" className="snapshot-error">{error}</div>}
      <button className="button primary snapshot-submit" type="submit" disabled={busy || passphrase.length < 16}>{busy ? phase || 'Loading encrypted data…' : 'Unlock data'}</button>
      <p className="snapshot-security"><ShieldCheck size={14}/> The passphrase stays in this tab and is never sent to the server. Anyone using an unlocked browser profile can read its data.</p>
      {manifest && <p className="snapshot-meta">{manifest.fund_count.toLocaleString('en-IN')} schemes · {manifest.history_count.toLocaleString('en-IN')} NAV histories</p>}
    </form>
  </main>;
}
