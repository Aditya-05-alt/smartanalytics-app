import FreezeScreen from '@/components/dashboard/wheeler-reports/FreezeScreen';

/** Route loading — solid freeze overlay (no blank black screen). */
export default function ClientSectionLoading() {
  return (
    <div className="wr-loading-slot" data-wr-loading="1" aria-busy="true">
      <FreezeScreen active />
    </div>
  );
}
