'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

interface Pod {
  id: string;
  name: string;
  templateType: string;
  karmaMode: string;
  sizeLimit: number;
  currentPlayerCount: number;
  status: string;
  startingGems?: number;
  actionCooldownSeconds?: number;
  creator?: { username: string } | null;
}

interface DebugSettings {
  defaultPodStartingGems: number;
  defaultPodActionCooldownSeconds: number;
  requireFullPodToStart: boolean;
  playersPerGiveTakeAction: number;
}

interface Membership {
  membershipStatus: string;
  pod: Pod;
}

interface Player {
  id: string;
  username: string;
  email?: string | null;
  isGuest: boolean;
  ownedPodSlots?: number;
  extraSlotsPurchased?: number;
  currentOwnedPodCount?: number;
  maxOwnedPods?: number;
}

interface DebugUser {
  id: string;
  username: string;
  email?: string | null;
  isGuest: boolean;
  createdAt: string;
  _count: {
    memberships: number;
    createdPods: number;
    sessions: number;
  };
}

async function getSession(): Promise<Player | null> {
  const res = await fetch(`${API}/session/me`, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

async function bootstrapGuest(): Promise<Player> {
  const res = await fetch(`${API}/session/bootstrap`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Bootstrap failed');
  const data = await res.json();
  return data.player;
}

async function ensureSession(): Promise<Player> {
  const existing = await getSession();
  if (existing) return existing;
  return bootstrapGuest();
}

async function listPods(): Promise<Pod[]> {
  const res = await fetch(`${API}/pods`, { credentials: 'include' });
  if (!res.ok) return [];
  return res.json();
}

async function listMyPods(): Promise<Membership[]> {
  const res = await fetch(`${API}/pods/my`, { credentials: 'include' });
  if (!res.ok) return [];
  return res.json();
}

async function joinPod(podId: string, inviteCode?: string) {
  const res = await fetch(`${API}/pods/${podId}/join`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode }),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Join failed');
  return res.json();
}

async function createPod(data: { name: string; sizeLimit: number; templateType: string; visibility: string; startingGems: number; actionCooldownSeconds: number; }) {
  const res = await fetch(`${API}/pods`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Create failed');
  return res.json();
}

async function getDebugSettings(): Promise<DebugSettings> {
  const res = await fetch(`${API}/pods/debug/settings`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load debug settings');
  return res.json();
}

async function updateDebugSettings(data: Partial<DebugSettings>): Promise<DebugSettings> {
  const res = await fetch(`${API}/pods/debug/settings`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to update debug settings');
  return res.json();
}

async function resetAllPods() {
  const res = await fetch(`${API}/pods/debug/reset-pods`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to reset pods');
}

async function listDebugUsers(): Promise<DebugUser[]> {
  const res = await fetch(`${API}/session/debug/users`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load debug users');
  return res.json();
}

async function switchDebugUser(playerId: string): Promise<Player> {
  const res = await fetch(`${API}/session/debug/switch-user`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to switch user');
  const data = await res.json();
  return data.player;
}

async function quickstart() {
  const res = await fetch(`${API}/pods/quickstart`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Quickstart failed');
  const data = await res.json();
  return data.pod.id;
}

async function addDebugUser(): Promise<Player> {
  const res = await fetch(`${API}/session/debug/add-user`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to add debug user');
  const data = await res.json();
  return data.player;
}

async function deleteAllUsers(): Promise<Player> {
  const res = await fetch(`${API}/session/debug/delete-all-users`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to delete users');
  const data = await res.json();
  return data.player;
}

async function deleteAnonymousUsers(): Promise<Player> {
  const res = await fetch(`${API}/session/debug/delete-anonymous-users`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to delete anonymous users');
  const data = await res.json();
  return data.player;
}

function templateTone(templateType: string) {
  if (templateType === 'POWER') return { background: '#e9f4ff', color: '#2367aa' };
  if (templateType === 'KARMA') return { background: '#fff0fd', color: '#9c2aa0' };
  if (templateType === 'HYBRID') return { background: '#fff4df', color: '#9b6715' };
  return { background: '#f2eee8', color: '#6b4b33' };
}

function Gem({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} className={`got-gem-image ${className}`.trim()} />;
}

function SectionHeading({ icon, title, copy }: { icon?: string; title: string; copy?: string }) {
  return (
    <div className="got-section-heading">
      <div className="got-section-heading-title">
        {icon ? <img src={icon} alt="" className="got-inline-icon" aria-hidden="true" /> : null}
        <h3 className="got-section-title">{title}</h3>
      </div>
      {copy ? <p className="got-section-copy">{copy}</p> : null}
    </div>
  );
}

function PodCard({ pod, membershipStatus, onOpen }: { pod: Pod; membershipStatus?: string; onOpen: (pod: Pod, isMember: boolean) => void; }) {
  const isMember = !!membershipStatus;
  const isEliminated = membershipStatus === 'ELIMINATED';
  const isJoinable = pod.status === 'FILLING' || pod.status === 'ACTIVE';
  const tone = templateTone(pod.templateType);
  const subtitle = pod.creator?.username ?? 'System pod';

  return (
    <button type="button" className="got-panel got-pod-card-button" onClick={() => onOpen(pod, isMember)}>
      <div className="got-pod-card">
        <div>
          <div className="got-badge-row" style={{ marginBottom: 10 }}>
            <span className="got-pill" style={{ background: tone.background, color: tone.color, borderColor: 'transparent' }}>{pod.templateType}</span>
            {isMember && (
              <span
                className="got-pill"
                style={isEliminated
                  ? { background: '#ffe1e1', color: '#a11c1c', borderColor: 'transparent' }
                  : { background: '#e8f7eb', color: '#1f7b3a', borderColor: 'transparent' }}
              >
                {isEliminated ? 'You\'ve been eliminated' : 'You\'re in this pod'}
              </span>
            )}
            {pod.karmaMode !== 'NONE' && <span className="got-pill" style={{ background: '#fff0fd', color: '#9c2aa0', borderColor: 'transparent' }}>Karma {pod.karmaMode}</span>}
          </div>
          <p className="got-pod-name">{pod.name}</p>
          <p className="got-pod-subtitle">{subtitle}</p>
          <p className="got-meta-line">
            {pod.currentPlayerCount}/{pod.sizeLimit} players · {pod.status.toLowerCase()}
            {typeof pod.startingGems === 'number' && ` · ${pod.startingGems} gems`}
            {typeof pod.actionCooldownSeconds === 'number' && ` · ${pod.actionCooldownSeconds}s timeout`}
            {membershipStatus && ` · ${membershipStatus.toLowerCase()}`}
          </p>
        </div>
        <span className={`got-button ${isMember ? 'got-button-dark' : isJoinable ? 'got-button-gold' : 'got-button-outline'}`} style={{ whiteSpace: 'nowrap' }}>
          {isEliminated ? 'View pod' : isMember ? 'Re-enter' : isJoinable ? 'Join pod' : pod.status}
        </span>
      </div>
    </button>
  );
}

export default function AppPage() {
  const router = useRouter();
  const [pods, setPods] = useState<Pod[]>([]);
  const [myPods, setMyPods] = useState<Membership[]>([]);
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBrowse, setShowBrowse] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugUsers, setDebugUsers] = useState<DebugUser[]>([]);
  const [switchingUserId, setSwitchingUserId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', sizeLimit: 25, templateType: 'CLASSIC', visibility: 'PUBLIC', startingGems: 10, actionCooldownSeconds: 10 });
  const [debugSettings, setDebugSettings] = useState<DebugSettings>({ defaultPodStartingGems: 10, defaultPodActionCooldownSeconds: 10, requireFullPodToStart: false, playersPerGiveTakeAction: 5 });
  const [debugSaved, setDebugSaved] = useState('');
  const [error, setError] = useState('');

  const membershipByPodId = useMemo(() => new Map(myPods.map((membership) => [membership.pod.id, membership.membershipStatus])), [myPods]);
  const publicPods = useMemo(() => pods.filter((pod) => !membershipByPodId.has(pod.id)), [pods, membershipByPodId]);
  const hasReachedPodLimit = !player?.isGuest && !!player && (player.currentOwnedPodCount ?? 0) >= (player.maxOwnedPods ?? ((player.ownedPodSlots ?? 0) + (player.extraSlotsPurchased ?? 0)));
  const createPodTitle = !player
    ? 'Loading player'
    : player.isGuest
      ? 'Login to enable Creating Pods'
      : hasReachedPodLimit
        ? 'Max pods created'
        : undefined;
  const orderedDebugUsers = useMemo(() => {
    if (!player) return debugUsers;
    return [...debugUsers].sort((a, b) => Number(b.id === player.id) - Number(a.id === player.id));
  }, [debugUsers, player]);

  const refresh = async () => {
    const currentPlayer = await ensureSession();
    const [publicList, memberships, settings, users] = await Promise.all([
      listPods(), listMyPods(), getDebugSettings().catch(() => ({ ...debugSettings })), listDebugUsers().catch(() => []),
    ]);
    setPlayer(currentPlayer);
    setPods(publicList);
    setMyPods(memberships);
    setDebugSettings(settings);
    setDebugUsers(users);
    setLoading(false);
  };

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const t = setInterval(() => refresh().catch(() => undefined), 10000);
    return () => clearInterval(t);
  }, []);

  async function handleQuickstart() {
    try { router.push(`/pods/${await quickstart()}`); } catch (e: any) { setError(e.message); }
  }

  async function handleOpenPod(pod: Pod, isMember: boolean) {
    try {
      if (!isMember && (pod.status === 'FILLING' || pod.status === 'ACTIVE')) await joinPod(pod.id);
      router.push(`/pods/${pod.id}`);
    } catch (e: any) { setError(e.message); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const pod = await createPod(createForm);
      setShowCreate(false);
      router.push(`/pods/${pod.id}`);
    } catch (err: any) { setError(err.message); }
  }

  async function handleDebugChange(next: Partial<DebugSettings>) {
    const optimistic = { ...debugSettings, ...next };
    setDebugSettings(optimistic);
    setDebugSaved('Saving...');
    try {
      const saved = await updateDebugSettings(optimistic);
      setDebugSettings(saved);
      setDebugSaved('Saved');
      await refresh();
      setTimeout(() => setDebugSaved(''), 1200);
    } catch (err: any) { setDebugSaved(''); setError(err.message); }
  }

  async function handleResetPods() {
    if (!window.confirm('Reset all pods? This clears every pod, membership, action, feed item, and leaderboard state.')) return;
    try { await resetAllPods(); await refresh(); setDebugSaved('All pods reset'); setTimeout(() => setDebugSaved(''), 1600); } catch (err: any) { setError(err.message); }
  }

  async function handleSwitchUser(nextPlayerId: string) {
    setSwitchingUserId(nextPlayerId);
    setDebugSaved('Switching user...');
    setError('');
    try {
      await switchDebugUser(nextPlayerId);
      await refresh();
      setDebugSaved('Switched user');
      setTimeout(() => setDebugSaved(''), 1400);
    } catch (err: any) {
      setDebugSaved('');
      setError(err.message);
    } finally {
      setSwitchingUserId(null);
    }
  }

  async function handleAddDebugUser() {
    setDebugSaved('Adding user...');
    setError('');
    try {
      await addDebugUser();
      await refresh();
      setDebugSaved('Debug user added');
      setTimeout(() => setDebugSaved(''), 1600);
    } catch (err: any) {
      setDebugSaved('');
      setError(err.message);
    }
  }

  async function handleDeleteAllUsers() {
    if (!window.confirm('Delete all users? This will clear every test account and sign this browser into a fresh guest.')) return;
    setDebugSaved('Deleting users...');
    setError('');
    try {
      await deleteAllUsers();
      await refresh();
      setDebugSaved('All users deleted');
      setTimeout(() => setDebugSaved(''), 1600);
    } catch (err: any) {
      setDebugSaved('');
      setError(err.message);
    }
  }

  async function handleDeleteAnonymousUsers() {
    if (!window.confirm('Delete anonymous users? This clears every guest account (and any pods they created) but keeps saved accounts, then signs this browser into a fresh guest.')) return;
    setDebugSaved('Deleting anonymous users...');
    setError('');
    try {
      await deleteAnonymousUsers();
      await refresh();
      setDebugSaved('Anonymous users deleted');
      setTimeout(() => setDebugSaved(''), 1600);
    } catch (err: any) {
      setDebugSaved('');
      setError(err.message);
    }
  }

  return (
    <div className="got-page">
      <header className="got-topbar">
        <div className="got-topbar-inner">
          <div className="got-brand">
            <div className="got-logo-badge"><Gem src="/skins/Gem_Brown.png" alt="Give or Take gem" className="got-logo-gem" /></div>
            <div className="got-brand-copy">
              <p className="got-brand-title">GIVE <span className="got-brand-or">OR</span> TAKE</p>
            </div>
          </div>
            <div className="got-topbar-actions">
              {player && <span className="got-user-chip">{player.username} {player.isGuest ? '· guest' : '· saved'}</span>}
              {player?.isGuest ? (
                <button onClick={() => router.push(`/claim?returnTo=${encodeURIComponent('/app')}`)} className="got-button got-button-light">Save progress</button>
              ) : player ? (
                <span className="got-user-chip got-chip-success">Progress saved</span>
              ) : null}
              <button onClick={() => setShowDebug(true)} className="got-button got-button-light got-button-with-icon"><img src="/skins/Debug_Icon.png" alt="" className="got-button-icon" aria-hidden="true" />Debug panel</button>
            </div>
        </div>
      </header>

      <main className="got-shell">
        <section className="got-surface got-hero">
          <div className="got-divider"><Gem src="/skins/Gem_Small.png" alt="Decorative gem" className="got-divider-gem" /></div>
          <h2 className="got-hero-title">Ready to play?</h2>
          <p className="got-hero-copy">Jump into a Classic Pod instantly — no account required.</p>
          <div className="got-button-stack">
            <button onClick={handleQuickstart} className="got-button got-button-gold got-button-span">Start now</button>
            <div className="got-button-row">
              <button onClick={() => setShowBrowse((v) => !v)} className="got-button got-button-outline">{showBrowse ? 'Hide pods' : 'Browse pods'}</button>
              <button
                onClick={() => setShowCreate(true)}
                className="got-button got-button-dark"
                disabled={!player || !!player.isGuest || hasReachedPodLimit}
                title={createPodTitle}
              >
                Create pod
              </button>
            </div>
          </div>
        </section>

        {error && <section className="got-panel got-error" style={{ marginTop: 20 }}>{error}</section>}

        {myPods.length > 0 && (
          <section className="got-panel" style={{ marginTop: 20 }}>
            <SectionHeading icon="/skins/Gem_Green.png" title="Your active pods" copy="Pods you've joined or can re-enter immediately." />
            <div className="got-card-list" style={{ marginTop: 16 }}>
              {myPods.map((membership) => <PodCard key={membership.pod.id} pod={membership.pod} membershipStatus={membership.membershipStatus} onOpen={handleOpenPod} />)}
            </div>
          </section>
        )}

        <section className="got-panel" style={{ marginTop: 20 }}>
          <div className="got-pod-card" style={{ marginBottom: 16 }}>
            <SectionHeading icon="/skins/Leaderboard_icon.png" title="Browse pods" copy="Open public pods available now." />
          </div>
          {showBrowse ? (
            loading ? <p className="got-muted">Loading pods...</p> : publicPods.length === 0 ? <p className="got-muted">No open pods right now.</p> : (
              <div className="got-card-list">{publicPods.map((pod) => <PodCard key={pod.id} pod={pod} membershipStatus={membershipByPodId.get(pod.id)} onOpen={handleOpenPod} />)}</div>
            )
          ) : <p className="got-muted">Tap Browse Pods to expand the lobby list.</p>}
        </section>
      </main>

      {showDebug && (
        <div className="got-overlay" onClick={() => setShowDebug(false)}>
          <section className="got-panel-muted got-modal got-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="got-modal-header">
              <SectionHeading icon="/skins/Debug_Icon.png" title="Debug panel" copy="Adjust game settings and parameters." />
              <button onClick={() => setShowDebug(false)} className="got-close-x" aria-label="Close debug panel">X</button>
            </div>
            <div className="got-form-grid got-debug-grid">
              <label className="got-form-field"><span className="got-form-label">Default pod gems</span><input type="number" min={1} max={1000000} value={debugSettings.defaultPodStartingGems} onChange={(e) => handleDebugChange({ defaultPodStartingGems: Number(e.target.value) })} /></label>
              <label className="got-form-field"><span className="got-form-label">Default pod timeout (seconds)</span><input type="number" min={0} max={86400} value={debugSettings.defaultPodActionCooldownSeconds} onChange={(e) => handleDebugChange({ defaultPodActionCooldownSeconds: Number(e.target.value) })} /></label>
              <label className="got-form-field"><span className="got-form-label"># People to gain or lose Gems on Give/Take</span><input type="number" min={1} max={1000} value={debugSettings.playersPerGiveTakeAction} onChange={(e) => handleDebugChange({ playersPerGiveTakeAction: Number(e.target.value) })} /></label>
              <label className="got-form-field got-checkbox-field">
                <span className="got-form-label">Pod start rules</span>
                <label className="got-checkbox-row">
                  <input
                    type="checkbox"
                    checked={debugSettings.requireFullPodToStart}
                    onChange={(e) => handleDebugChange({ requireFullPodToStart: e.target.checked })}
                  />
                  <span>Require Full Pod to Start</span>
                </label>
              </label>
              <button onClick={handleResetPods} className="got-button got-button-outline">Reset All Pods</button>
              <button onClick={handleAddDebugUser} className="got-button got-button-outline" title="Create a fresh guest user and switch this browser to it">Add Debug User</button>
              <button onClick={handleDeleteAllUsers} className="got-button got-button-outline" title="Clear all test accounts and start fresh">Delete All Users</button>
              <button onClick={handleDeleteAnonymousUsers} className="got-button got-button-outline" title="Clear guest accounts and any pods they created; saved accounts are kept">Delete Anonymous Users</button>
            </div>
            <div className="got-debug-users-section">
              <SectionHeading icon="/skins/Leaderboard_icon.png" title="Test users" copy="Switch the current browser session between fake users for multiplayer testing." />
              <div className="got-card-list got-debug-users-scroll" style={{ marginTop: 16 }}>
                {orderedDebugUsers.map((debugUser) => {
                  const isCurrent = player?.id === debugUser.id;
                  return (
                    <div key={debugUser.id} className="got-panel got-debug-user-row">
                      <div className="got-debug-user-main">
                        <div className="got-debug-user-head">
                          <strong className="got-debug-user-name">{debugUser.username}</strong>
                          <div className="got-badge-row">
                            <span className="got-pill">{debugUser.isGuest ? 'Guest' : 'Saved'}</span>
                            {isCurrent ? <span className="got-pill got-score-pill">Current user</span> : null}
                          </div>
                        </div>
                        <p className="got-muted" style={{ margin: 0 }}>
                          {debugUser.email ?? 'No email claimed'} · {debugUser._count.memberships} memberships · {debugUser._count.createdPods} created pods · {debugUser._count.sessions} sessions
                        </p>
                      </div>
                      <button
                        onClick={() => handleSwitchUser(debugUser.id)}
                        disabled={isCurrent || switchingUserId === debugUser.id}
                        className={`got-button ${isCurrent ? 'got-button-outline' : 'got-button-dark'}`}
                      >
                        {isCurrent ? 'Current user' : switchingUserId === debugUser.id ? 'Switching...' : 'Switch to user'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            {debugSaved && <p className="got-success" style={{ marginTop: 14, padding: 12 }}>{debugSaved}</p>}
          </section>
        </div>
      )}

      {showCreate && (
        <div className="got-overlay" onClick={() => setShowCreate(false)}>
          <div className="got-panel got-modal" onClick={(e) => e.stopPropagation()}>
            <div className="got-modal-header" style={{ marginBottom: 18 }}>
              <SectionHeading icon="/skins/Gear_icon.png" title="Create pod" copy="Set up a custom pod with your preferred rules." />
              <button onClick={() => setShowCreate(false)} className="got-close-x" aria-label="Close create pod dialog">X</button>
            </div>
            <form onSubmit={handleCreate} className="got-card-list">
              <label className="got-form-field"><span className="got-form-label">Pod name</span><input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="My Pod" maxLength={40} required /></label>
              <div className="got-grid-2">
                <label className="got-form-field"><span className="got-form-label">Size</span><select value={createForm.sizeLimit} onChange={(e) => setCreateForm({ ...createForm, sizeLimit: Number(e.target.value) })}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} players</option>)}</select></label>
                <label className="got-form-field"><span className="got-form-label">Visibility</span><select value={createForm.visibility} onChange={(e) => setCreateForm({ ...createForm, visibility: e.target.value })}><option value="PUBLIC">Public</option><option value="PRIVATE">Private (invite code)</option></select></label>
              </div>
              <div className="got-grid-2">
                <label className="got-form-field"><span className="got-form-label">Starting gems</span><input type="number" min={1} max={1000000} value={createForm.startingGems} onChange={(e) => setCreateForm({ ...createForm, startingGems: Number(e.target.value) })} /></label>
                <label className="got-form-field"><span className="got-form-label">Timeout seconds</span><input type="number" min={0} max={86400} value={createForm.actionCooldownSeconds} onChange={(e) => setCreateForm({ ...createForm, actionCooldownSeconds: Number(e.target.value) })} /><p className="got-helper">10 suggested. 0 means no timeout.</p></label>
              </div>
              <label className="got-form-field"><span className="got-form-label">Template</span><select value={createForm.templateType} onChange={(e) => setCreateForm({ ...createForm, templateType: e.target.value })}><option value="CLASSIC">Classic — No karma, no powers</option><option value="KARMA">Karma — Karma enabled</option><option value="POWER">Power — Power-ups enabled</option><option value="HYBRID">Hybrid — Full featured</option></select></label>
              <button type="submit" className="got-button got-button-gold">Create pod</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
