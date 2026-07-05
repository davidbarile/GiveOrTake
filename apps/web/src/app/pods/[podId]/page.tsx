'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

// crypto.randomUUID() only exists in secure contexts (HTTPS or http://localhost) — it's
// undefined on a plain-HTTP raw-IP deployment, so fall back to crypto.getRandomValues()
// (available everywhere) and finally to Math.random() for very old browsers.
function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

interface PodState {
  id: string;
  name: string;
  status: string;
  templateType: string;
  karmaMode: string;
  sizeLimit: number;
  currentPlayerCount: number;
  startingGems?: number;
  actionCooldownSeconds?: number;
}

interface PlayerState {
  currentGems: number;
  totalGiveCount: number;
  totalTakeCount: number;
  nextActionAt: string | null;
  eliminatedAt: string | null;
}

interface FeedItem {
  id: string;
  messageType: string;
  body: string;
  createdAt: string;
  player?: { id: string; username: string };
}

interface LeaderEntry {
  currentGems: number;
  totalGiveCount: number;
  totalTakeCount: number;
  eliminatedAt: string | null;
  player: { id: string; username: string };
}

interface Player {
  id: string;
  username: string;
  email?: string | null;
  isGuest: boolean;
}

interface DebugSettings {
  requireFullPodToStart: boolean;
  playersPerGiveTakeAction: number;
}

async function getSession(): Promise<Player | null> {
  const res = await fetch(`${API}/session/me`, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

async function getDebugSettings(): Promise<DebugSettings> {
  const res = await fetch(`${API}/pods/debug/settings`, { credentials: 'include' });
  if (!res.ok) return { requireFullPodToStart: false, playersPerGiveTakeAction: 5 };
  const data = await res.json();
  return {
    requireFullPodToStart: Boolean(data.requireFullPodToStart),
    playersPerGiveTakeAction: Number(data.playersPerGiveTakeAction) || 5,
  };
}

function actionCopy(action: 'give' | 'take', count: number) {
  const players = count === 1 ? 'player' : 'players';
  return action === 'give'
    ? `Give 1 gem to ${count} random ${players}.`
    : `Take 1 gem from ${count} random ${players}.`;
}

function formatCooldown(nextActionAt: string | null): string {
  if (!nextActionAt) return '';
  const remaining = Math.max(0, Math.ceil((new Date(nextActionAt).getTime() - Date.now()) / 1000));
  return remaining > 0 ? `${remaining}s` : '';
}

function renderFeedBody(body: string) {
  if (body.startsWith('GAVE ')) {
    return <><span className="got-feed-action-give">GAVE</span>{body.slice(4)}</>;
  }
  if (body.startsWith('TOOK ')) {
    return <><span className="got-feed-action-take">TOOK</span>{body.slice(4)}</>;
  }
  return body;
}

function statusTone(status?: string) {
  if (status === 'ACTIVE') return { background: '#e8f7eb', color: '#1f7b3a' };
  if (status === 'FILLING') return { background: '#fff3d8', color: '#9b6715' };
  if (status === 'COMPLETED') return { background: '#efebe7', color: '#6b4b33' };
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

export default function PodPage({ params }: { params: Promise<{ podId: string }> }) {
  const { podId } = use(params);
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);

  const [pod, setPod] = useState<PodState | null>(null);
  const [myState, setMyState] = useState<PlayerState | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [player, setPlayer] = useState<Player | null>(null);
  const [debugSettings, setDebugSettings] = useState<DebugSettings>({ requireFullPodToStart: false, playersPerGiveTakeAction: 5 });
  const [cooldown, setCooldown] = useState('');
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setCooldown(formatCooldown(myState?.nextActionAt ?? null)), 500);
    return () => clearInterval(t);
  }, [myState?.nextActionAt]);

  async function refreshPodData() {
    const [p, s, f, l, settings] = await Promise.all([
      fetch(`${API}/pods/${podId}`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${API}/pods/${podId}/game/state`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/pods/${podId}/feed`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${API}/pods/${podId}/leaderboard`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      getDebugSettings().catch(() => ({ requireFullPodToStart: false, playersPerGiveTakeAction: 5 })),
    ]);
    setPod(p);
    setMyState(s);
    setFeed(Array.isArray(f) ? f.reverse() : []);
    setLeaderboard(Array.isArray(l) ? l : []);
    setDebugSettings(settings);
  }

  useEffect(() => {
    refreshPodData().catch(console.error);
    getSession().then(setPlayer).catch(() => undefined);
  }, [podId]);

  useEffect(() => {
    const socket = io(`${WS_URL}/ws`, { withCredentials: true, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('pod.subscribe', { podId }));
    socket.on('action.result', (data: { newActorGems: number; nextActionAt: string | null }) => {
      setMyState((s) => (s ? { ...s, currentGems: data.newActorGems, nextActionAt: data.nextActionAt } : s));
    });
    socket.on('feed.event', (item: FeedItem) => setFeed((prev) => [...prev, item].slice(-50)));
    socket.on('leaderboard.update', (data: LeaderEntry[]) => setLeaderboard(data));
    socket.on('pod.started', () => setPod((p) => (p ? { ...p, status: 'ACTIVE' } : p)));
    socket.on('pod.completed', () => setPod((p) => (p ? { ...p, status: 'COMPLETED' } : p)));
    // A pod-mate just gave/took — everyone's gems, the feed, and the leaderboard may have
    // changed, not just the actor's, so pull a fresh snapshot instead of patching one field.
    socket.on('pod.sync', () => { refreshPodData().catch(console.error); });

    return () => {
      socket.disconnect();
    };
  }, [podId]);

  async function doAction(action: 'GIVE' | 'TAKE') {
    if (actionLoading) return;
    setActionLoading(true);
    setError('');
    try {
      const requestId = generateRequestId();
      const res = await fetch(`${API}/pods/${podId}/game/action`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, requestId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? 'Action failed');
        return;
      }
      setMyState((s) => (s ? { ...s, currentGems: data.newActorGems, nextActionAt: data.nextActionAt } : s));
      await refreshPodData();
    } catch {
      setError('Action failed');
    } finally {
      setActionLoading(false);
    }
  }

  const isOnCooldown = myState?.nextActionAt ? new Date(myState.nextActionAt) > new Date() : false;
  const isEliminated = !!myState?.eliminatedAt;
  const isActive = pod?.status === 'ACTIVE';
  const canUseDebugBypass = pod?.status === 'FILLING' && !debugSettings.requireFullPodToStart;
  const actionsEnabled = isActive || canUseDebugBypass;
  const livingPlayers = leaderboard.filter((entry) => !entry.eliminatedAt);
  const eligibleTargetCount = player?.id
    ? livingPlayers.filter((entry) => entry.player.id !== player.id).length
    : Math.max(0, livingPlayers.length - 1);
  const isSoloQuickstart = pod?.name === 'Quickstart Classic' && pod.currentPlayerCount <= 1;
  const noEligibleTargets = eligibleTargetCount === 0 && !isSoloQuickstart;
  const actionDisabledReason = !actionsEnabled
    ? pod?.status === 'FILLING'
      ? 'Waiting for pod to fill'
      : 'Actions are unavailable right now'
    : isEliminated
      ? 'You were eliminated'
      : isOnCooldown
        ? `Cooldown: ${cooldown}`
        : noEligibleTargets
          ? 'No eligible players left to target'
          : undefined;
  const status = statusTone(pod?.status);

  return (
    <div className="got-page">
      <header className="got-topbar">
        <div className="got-topbar-inner">
          <div className="got-brand">
            <Link href="/app" className="got-back-button">
              <Gem src="/skins/Gem_Brown.png" alt="Back to lobby" className="got-back-button-gem" />
              <span>Back to Lobby</span>
            </Link>
            <div className="got-brand-copy">
              <p className="got-brand-title got-brand-title-small">{pod?.name ?? 'Loading pod'}</p>
            </div>
          </div>
          <div className="got-topbar-actions">
            {pod && <span className="got-user-chip">{pod.templateType}{pod.karmaMode !== 'NONE' ? ` · Karma ${pod.karmaMode}` : ''}{` · ${pod.currentPlayerCount}/${pod.sizeLimit}`}{typeof pod.actionCooldownSeconds === 'number' ? ` · ${pod.actionCooldownSeconds}s` : ''}</span>}
            <span className="got-pill" style={{ background: status.background, color: status.color, borderColor: 'transparent' }}>{pod?.status ?? '...'}</span>
            {player?.isGuest ? (
              <button onClick={() => router.push(`/claim?returnTo=${encodeURIComponent(`/pods/${podId}`)}`)} className="got-button got-button-light">Save progress</button>
            ) : player ? (
              <span className="got-user-chip got-chip-success">Progress saved</span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="got-shell">
        <div className="got-grid-sidebar">
          <section style={{ display: 'grid', gap: 20 }}>
            <div className="got-surface">
              <div className="got-status-hero">
                <div className="got-gem-counter">
                  <div className="got-counter-gem-wrap"><Gem src="/skins/Gem_Brown.png" alt="Gem total" className="got-counter-gem" /></div>
                  <p className="got-eyebrow got-eyebrow-dark">Your gems</p>
                  <p className="got-gem-counter-value">{myState?.currentGems ?? '—'}</p>
                  {isEliminated ? (
                    <div className="got-info-banner eliminated">You were eliminated</div>
                  ) : isOnCooldown ? (
                    <div className="got-info-banner cooldown"><img src="/skins/Timer_Icon.png" alt="" className="got-inline-icon" aria-hidden="true" />Cooldown: {cooldown}</div>
                  ) : noEligibleTargets ? (
                    <div className="got-info-banner neutral">No eligible players left to target.</div>
                  ) : (
                    <div className="got-info-banner neutral">Act when the timing feels right.</div>
                  )}
                </div>

                <div className="got-status-actions">
                  <button onClick={() => doAction('GIVE')} disabled={!actionsEnabled || isEliminated || isOnCooldown || noEligibleTargets || actionLoading} title={actionDisabledReason} className="got-action-button got-action-give" style={{ border: 'none' }}>
                    <div className="got-action-content"><div className="got-action-icon"><Gem src="/skins/Gem_Green.png" alt="Green gem" className="got-action-gem" /></div><div><p className="got-action-label">Give</p><p className="got-action-copy">{actionCopy('give', debugSettings.playersPerGiveTakeAction)}</p></div></div>
                  </button>
                  <button onClick={() => doAction('TAKE')} disabled={!actionsEnabled || isEliminated || isOnCooldown || noEligibleTargets || actionLoading} title={actionDisabledReason} className="got-action-button got-action-take" style={{ border: 'none' }}>
                    <div className="got-action-content"><div className="got-action-icon"><Gem src="/skins/Gem_Red.png" alt="Red gem" className="got-action-gem" /></div><div><p className="got-action-label">Take</p><p className="got-action-copy">{actionCopy('take', debugSettings.playersPerGiveTakeAction)}</p></div></div>
                  </button>
                </div>
              </div>
            </div>

            {!actionsEnabled && pod?.status === 'FILLING' && <div className="got-panel got-center">Waiting for pod to fill... ({pod.currentPlayerCount}/{pod.sizeLimit})</div>}
            {error && <div className="got-panel got-error">{error}</div>}

            {myState && (
              <div className="got-panel">
                <SectionHeading icon="/skins/Gem_Small.png" title="Your stats" />
                <div className="got-grid-2" style={{ marginTop: 16 }}>
                  <div className="got-kpi give"><p className="got-kpi-label" style={{ color: '#1f7b3a' }}>Gave</p><p className="got-kpi-value" style={{ color: '#1f7b3a' }}>{myState.totalGiveCount}</p></div>
                  <div className="got-kpi take"><p className="got-kpi-label" style={{ color: '#a11c1c' }}>Took</p><p className="got-kpi-value" style={{ color: '#a11c1c' }}>{myState.totalTakeCount}</p></div>
                </div>
              </div>
            )}

            <div className="got-panel">
              <SectionHeading icon="/skins/Gear_icon.png" title="Pod feed" copy="Live action from inside the pod." />
              <div className="got-scroll got-feed-list" style={{ marginTop: 16 }}>
                {feed.length === 0 && <p className="got-muted">No activity yet.</p>}
                {[...feed].reverse().map((item) => (
                  <div
                    key={item.id}
                    className={`got-feed-item${item.player?.id === player?.id ? ' got-feed-item-self' : ''}`}
                  >
                    {item.player && <strong>{item.player.username}: </strong>}
                    {renderFeedBody(item.body)}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="got-panel">
            <SectionHeading icon="/skins/Leaderboard_icon.png" title="Leaderboard" copy="Top stacks in the pod right now." />
            <div className="got-leaderboard" style={{ marginTop: 16 }}>
              {leaderboard.length === 0 && <p className="got-muted">Waiting...</p>}
              {leaderboard.slice(0, 15).map((entry, i) => (
                <div
                  key={entry.player.id}
                  className={`got-leader-item${entry.player.id === player?.id ? ' got-leader-item-self' : ''}`}
                  style={entry.eliminatedAt ? { opacity: 0.5 } : undefined}
                >
                  <span className="got-rank">{i + 1}</span>
                  <span className="got-leader-name" style={{ fontWeight: 700 }}>{entry.player.username}</span>
                  <span className="got-pill got-score-pill"><Gem src="/skins/Gem_Brown.png" alt="" className="got-score-gem" />{entry.currentGems}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
