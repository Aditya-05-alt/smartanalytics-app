'use client';
// A form bound to a server action that returns { ok, message }; shows the message under it.
import { useActionState } from 'react';

type Result = { ok: boolean; message: string } | null;

export default function ActionForm({
  action, children, submit, className = 'form-grid',
}: {
  action: (prev: Result, form: FormData) => Promise<Result>;
  children: React.ReactNode;
  submit: string;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run}>
      <div className={className}>
        {children}
        <div><button className="btn" type="submit" disabled={pending}>{pending ? 'Working…' : submit}</button></div>
      </div>
      {state && <p className={'note ' + (state.ok ? 'msg-ok' : 'msg-err')} role="status" style={{ marginTop: 8 }}>{state.message}</p>}
    </form>
  );
}
