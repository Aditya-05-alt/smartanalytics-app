'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy Transfer path → /dashboard/campaigns */
export default function CampaignsAdvanceRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/campaigns');
  }, [router]);
  return null;
}
