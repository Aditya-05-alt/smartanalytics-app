import { redirect } from 'next/navigation';

/** Legacy lab route — Compare now hosts the VDP channel trends UI. */
export default function VdpLabPage() {
  redirect('/dashboard/compare');
}
