'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ActionForm from './ActionForm';
import { createClient } from '@/app/dashboard/wheeler-reports/admin/actions';

export default function NewClientButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="wr-new-client">
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
        {open ? 'Cancel' : 'New client'}
      </button>
      {open && (
        <div className="wr-new-client-panel card">
          <div className="body">
            <ActionForm
              action={async (prev, form) => {
                const res = await createClient(prev, form);
                if (res?.ok) {
                  setOpen(false);
                  router.refresh();
                }
                return res;
              }}
              submit="Add client"
            >
              <label className="field">
                <span>Name</span>
                <input name="name" required placeholder="A&L RV Sales" />
              </label>
              <label className="field">
                <span>Slug (optional)</span>
                <input name="slug" placeholder="al-rv-sales" pattern="[a-z0-9-]+" />
              </label>
              <label className="field">
                <span>Time zone</span>
                <input name="timezone" defaultValue="America/New_York" />
              </label>
            </ActionForm>
          </div>
        </div>
      )}
    </div>
  );
}
