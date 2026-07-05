'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

async function bootstrapGuest() {
  const res = await fetch(`${API}/session/bootstrap`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Bootstrap failed');
  return res.json();
}

async function getSession() {
  const res = await fetch(`${API}/session/me`, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

async function quickstart() {
  const res = await fetch(`${API}/pods/quickstart`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('Quickstart failed');
  const data = await res.json();
  return data.pod.id as string;
}

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [player, setPlayer] = useState<{ isGuest: boolean; username?: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSession().then(setPlayer).catch(() => undefined);
  }, []);

  async function startGuest() {
    try {
      setLoading(true);
      await bootstrapGuest();
      const podId = await quickstart();
      router.push(`/pods/${podId}`);
    } catch {
      setError('Could not start a guest session.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="got-page">
      <section className="got-topbar">
        <div className="got-topbar-inner">
          <div className="got-brand">
            <div className="got-logo-badge">
              <img src="/skins/Gem_Brown.png" alt="Give or Take gem" className="got-gem-image got-logo-gem" />
            </div>
            <div className="got-brand-copy">
              <p className="got-brand-title">GIVE <span className="got-brand-or">OR</span> TAKE</p>
              <p className="got-brand-subtitle">Social experiment game</p>
            </div>
          </div>
        </div>
      </section>

      <div className="got-shell">
        <section className="got-surface got-hero">
          <div className="got-grid-2 got-hero-feature-grid">
            <div className="got-action-card got-action-card-compact got-action-give">
              <div className="got-action-content">
                <div className="got-action-icon"><img src="/skins/Gem_Green.png" alt="Green gem" className="got-gem-image got-action-gem" /></div>
                <div>
                  <p className="got-action-label">Give</p>
                  <p className="got-action-copy">Gives a gem to random players.</p>
                </div>
              </div>
            </div>
            <div className="got-action-card got-action-card-compact got-action-take">
              <div className="got-action-content">
                <div className="got-action-icon"><img src="/skins/Gem_Red.png" alt="Red gem" className="got-gem-image got-action-gem" /></div>
                <div>
                  <p className="got-action-label">Take</p>
                  <p className="got-action-copy">Takes a gem from random players.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="got-divider">
            <img src="/skins/Gem_Small.png" alt="Decorative gem" className="got-gem-image got-divider-gem" />
          </div>
          <h1 className="got-hero-title">Ready to play?</h1>
          <p className="got-hero-copy">Jump into a Classic Pod instantly — no account required.</p>
          {player && <p className="got-muted" style={{ marginTop: 16 }}>Playing as {player.username ?? 'guest'}</p>}
          <div className="got-button-stack">
            <button onClick={startGuest} disabled={loading} className="got-button got-button-gold got-button-span">
              {loading ? 'Starting...' : 'Start now'}
            </button>
            <div className="got-button-row">
              <button onClick={() => router.push('/app')} className="got-button got-button-outline">
                Browse pods
              </button>
              <button onClick={() => router.push('/claim')} className="got-button got-button-dark">
                Save progress
              </button>
            </div>
          </div>
        </section>

        {error && (
          <section className="got-panel got-error" style={{ marginTop: 20 }}>
            {error}
          </section>
        )}
      </div>
    </main>
  );
}
