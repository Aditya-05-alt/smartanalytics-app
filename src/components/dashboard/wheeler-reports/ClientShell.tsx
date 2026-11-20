'use client';

import TopNav from './TopNav';
import { FreezeProvider } from './FreezeContext';
import type { Viewer } from '@/lib/wheelerReports/auth';

type Dealer = { slug: string; name: string };

type Props = {
  viewer: Pick<Viewer, 'role'>;
  client: Dealer;
  dealers?: Dealer[];
  children: React.ReactNode;
};

/** Fixed TopNav + cached tab panels (instant switches, no double loader). */
export default function ClientShell({ viewer, client, dealers = [], children }: Props) {
  return (
    <FreezeProvider header={<TopNav viewer={viewer} client={client} dealers={dealers} />}>
      {children}
    </FreezeProvider>
  );
}
