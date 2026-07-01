'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { useActionState, useState, useCallback, memo, useEffect } from 'react';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { signInAction } from '@/lib/auth/actions';
import { resetDealerToAll } from '@/lib/dashboard/dashboardPrefs';

const initialState = { ok: false, error: null };

const MailIcon = memo(() => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
));
MailIcon.displayName = 'MailIcon';

const LockIcon = memo(() => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
));
LockIcon.displayName = 'LockIcon';

const GoogleIcon = memo(() => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.5 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h5.92a5.07 5.07 0 0 1-2.2 3.33v2.77h3.56c2.08-1.92 3.22-4.74 3.22-8.13z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.28-1.93-6.15-4.52H2.18v2.85A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.85 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.35-2.1V7.05H2.18a11 11 0 0 0 0 9.9l3.67-2.85z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05L5.85 9.9C6.72 7.31 9.14 5.38 12 5.38z" />
  </svg>
));
GoogleIcon.displayName = 'GoogleIcon';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      Sign in
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </Button>
  );
}

export default function LoginForm({ demoMode = false, demoEmail = '', demoPassword = '' }) {
  const [state, formAction] = useActionState(signInAction, initialState);
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onRememberToggle = useCallback((e) => setRemember(e.target.checked), []);
  const onEmailChange = useCallback((e) => setEmail(e.target.value), []);
  const onPasswordChange = useCallback((e) => setPassword(e.target.value), []);

  useEffect(() => {
    resetDealerToAll();
  }, []);

  const fillDemo = useCallback(() => {
    setEmail(demoEmail);
    setPassword(demoPassword);
  }, [demoEmail, demoPassword]);

  return (
    <div className="auth-card">
      <header className="mb-6">
        <h2 className="font-display font-bold text-[22px] leading-tight" style={{ color: 'var(--t)' }}>
          Welcome back
        </h2>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--t2)' }}>
          Sign in to access your dealer analytics.
        </p>
      </header>

      {demoMode && (
        <div
          className="mb-5 rounded-[10px] p-3 animate-fade-in"
          style={{
            background: 'var(--acc-soft)',
            border: '1px solid rgba(200,232,122,.28)',
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse-soft"
              style={{ background: 'var(--acc)' }}
            />
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--acc)' }}
            >
              Demo mode · Supabase not configured
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] leading-snug" style={{ color: 'var(--t2)' }}>
              <div>
                Email:{' '}
                <code
                  className="px-1 py-[1px] rounded text-[11.5px]"
                  style={{ background: 'var(--s3)', color: 'var(--t)' }}
                >
                  {demoEmail}
                </code>
              </div>
              <div className="mt-0.5">
                Password:{' '}
                <code
                  className="px-1 py-[1px] rounded text-[11.5px]"
                  style={{ background: 'var(--s3)', color: 'var(--t)' }}
                >
                  {demoPassword}
                </code>
              </div>
            </div>
            <button
              type="button"
              onClick={fillDemo}
              className="shrink-0 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors"
              style={{
                background: 'var(--acc)',
                color: '#14171C',
              }}
            >
              Fill
            </button>
          </div>
        </div>
      )}

      <form action={formAction} className="space-y-3.5" noValidate>
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@dealership.com"
          icon={<MailIcon />}
          value={email}
          onChange={onEmailChange}
        />
        <Input
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          icon={<LockIcon />}
          showPasswordToggle
          value={password}
          onChange={onPasswordChange}
        />

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              name="remember"
              className="checkbox"
              checked={remember}
              onChange={onRememberToggle}
            />
            <span className="text-[12px]" style={{ color: 'var(--t2)' }}>
              Remember me
            </span>
          </label>
          <Link href="/forgot-password" className="text-[12px] link">
            Forgot password?
          </Link>
        </div>

        {state?.error && (
          <div
            role="alert"
            className="text-[12px] px-3 py-2 rounded-lg animate-fade-in"
            style={{
              background: 'rgba(255,133,133,.10)',
              border: '1px solid rgba(255,133,133,.30)',
              color: 'var(--red)',
            }}
          >
            {state.error}
          </div>
        )}

        <div className="pt-2">
          <SubmitButton />
        </div>
      </form>

      <div className="my-5">
        <div className="soft-divider">or continue with</div>
      </div>

      <Button variant="ghost" type="button" disabled>
        <GoogleIcon />
        Google
      </Button>

      <p className="mt-6 text-center text-[13px]" style={{ color: 'var(--t2)' }}>
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="link font-semibold">
          Create one
        </Link>
      </p>
    </div>
  );
}
