'use client';

import { useState } from 'react';

export default function CampaignExportButton({
  clientId,
  from,
  to,
  pageType,
  dealerName,
  disabled = false,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isDisabled = disabled || loading || !clientId || !from || !to;

  const onDownload = async () => {
    setError(null);
    setLoading(true);
    try {
      const { downloadCampaignsXlsx } = await import('@/lib/api/campaignExport');
      await downloadCampaignsXlsx({
        clientId,
        from,
        to,
        pageType,
        dealerName,
      });
    } catch (err) {
      setError(err?.message || 'Download failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="campaigns-export-wrap">
      <button
        type="button"
        className="ga4-count-export-btn vdp-export-btn"
        onClick={onDownload}
        disabled={isDisabled}
        title="Download WA campaign views as XLSX (Campaign Detail, Daily, Date x Campaign)"
      >
        {loading ? 'Preparing…' : 'Export as XLSX'}
      </button>
      {error ? (
        <span className="vdp-export-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
