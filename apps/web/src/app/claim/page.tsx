'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/app';
  return value;
}

export default function ClaimPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState('/app');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextReturnTo = safeReturnTo(params.get('returnTo'));
    setReturnTo(nextReturnTo);

    fetch(`${API}/session/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((player) => {
        if (player?.username) setUsername(player.username);
        if (player && !player.isGuest) {
          setDone(true);
          setTimeout(() => router.replace(nextReturnTo), 700);
        }
      })
      .catch(() => undefined);
  }, [router]);

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch(`${API}/session/claim`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.message ?? 'Failed');
      return;
    }
    setDone(true);
    setTimeout(() => router.replace(returnTo), 900);
  }

  function cancel() {
    router.replace(returnTo);
  }

  return (
    <main className="got-page">
      <div className="got-topbar">
        <div className="got-topbar-inner">
          <div className="got-brand">
            <div className="got-logo-badge">
              <img src="/skins/Gem_Brown.png" alt="Give or Take gem" className="got-gem-image got-logo-gem" />
            </div>
            <div className="got-brand-copy">
              <p className="got-brand-title">GIVE <span className="got-brand-or">OR</span> TAKE</p>
              <p className="got-brand-subtitle">Save your progress</p>
            </div>
          </div>
        </div>
      </div>

      <section className="got-shell got-centered-shell">
        <div className="got-panel got-claim-panel">
          <div className="got-divider">
            <img src="/skins/Gem_Small.png" alt="Decorative gem" className="got-gem-image got-divider-gem" />
          </div>
          <div className="got-claim-headline">
            <h2 className="got-hero-title got-claim-title">Save Your Progress</h2>
            <p className="got-hero-copy got-claim-copy">
              Optional: link an email to keep your stats and pods across devices. You can keep playing as a guest.
            </p>
          </div>

          {done ? (
            <p className="got-success got-claim-message">Progress already saved. Returning...</p>
          ) : (
            <form onSubmit={handleClaim} className="got-claim-form" autoComplete="off">
              <label className="got-form-field">
                <span className="got-form-label">Username</span>
                <input
                  type="text"
                  required
                  maxLength={20}
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your display name"
                />
              </label>
              <label className="got-form-field">
                <span className="got-form-label">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label className="got-form-field">
                <span className="got-form-label">Create password</span>
                <div className="got-password-row">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="8+ characters"
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="got-button got-button-outline got-password-toggle">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>
              {error && <p className="got-error got-claim-message">{error}</p>}
              <button type="submit" className="got-button got-button-gold got-button-span">
                Save progress
              </button>
            </form>
          )}

          <button onClick={cancel} className="got-button got-button-dark got-button-span" style={{ marginTop: 16 }}>
            Cancel — keep playing as guest
          </button>
        </div>
      </section>
    </main>
  );
}
