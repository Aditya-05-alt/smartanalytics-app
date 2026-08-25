'use client';

import { useState } from 'react';
import { downloadGa4BigqCompareXlsx } from '@/lib/api/vdpGa4VsBigqExport';

export default function Ga4BigqCompareExportButton({
  rows,
  meta,
  loading = false,
  fetchAllRows,
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const disabled = exporting || loading || (!rows?.length && !fetchAllRows);

  const onDownload = async () => {
    setError(null);
    setExporting(true);
    try {
      let exportRows = rows;
      let exportMeta = meta;
      if (fetchAllRows) {
        const result = await fetchAllRows();
        exportRows = result.rows;
        exportMeta = result.meta;
      }
      if (!exportRows?.length) {
        throw new Error('No rows to export.');
      }
      await downloadGa4BigqCompareXlsx({ rows: exportRows, meta: exportMeta });
    } catch (err) {
      setError(err?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="ga4-count-export-btn vdp-export-btn"
        onClick={onDownload}
        disabled={disabled}
        title={
          loading
            ? 'Wait for the table to finish loading'
            : 'Download full GA4 vs BigQuery compare as XLSX (BigQ through today − 2)'
        }
      >
        {exporting ? 'Preparing…' : loading ? 'Loading data…' : 'Export XLSX'}
      </button>
      {error && (
        <span className="vdp-export-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
