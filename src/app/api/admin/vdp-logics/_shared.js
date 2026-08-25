import { normalizeRow, TABLE } from '@/lib/vdpLogics/fields';

export { TABLE, normalizeRow };

export function mapSupabaseError(error) {
  if (!error) return 'Database error';
  if (error.code === '23505') {
    if (String(error.message || '').includes('smart_vdp_logic_dealer_property_uidx')) {
      return 'A VDP logic row already exists for this dealer ID and GA4 property.';
    }
    return 'A row with this dealer name and website URL already exists.';
  }
  return error.message || 'Database error';
}
