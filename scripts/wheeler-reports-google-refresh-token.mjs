// Gets a Google Ads API refresh token. Run on your own computer (it opens a browser):
//   GOOGLE_ADS_CLIENT_ID=... GOOGLE_ADS_CLIENT_SECRET=... node scripts/google-refresh-token.mjs
// The OAuth client must be a "Desktop app" client in Google Cloud Console.
// Sign in with a Google user that has access to the Wheeler MCC.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const id = process.env.GOOGLE_ADS_CLIENT_ID, secret = process.env.GOOGLE_ADS_CLIENT_SECRET;
if (!id || !secret) { console.error('Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET first.'); process.exit(1); }
const port = 8765, redirect = `http://127.0.0.1:${port}`, state = randomBytes(16).toString('hex');
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/adwords',
  access_type: 'offline', prompt: 'consent', state,
});
console.log('\nOpen this address in your browser and allow access:\n\n' + url + '\n');

http.createServer(async (req, res) => {
  const q = new URL(req.url, redirect).searchParams;
  if (!q.get('code')) { res.end('Waiting for Google…'); return; }
  if (q.get('state') !== state) { res.end('State mismatch, try again.'); return; }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: q.get('code'), client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const body = await r.json();
  res.end(body.refresh_token ? 'Done. Go back to the terminal.' : 'No refresh token returned; see the terminal.');
  console.log(body.refresh_token ? `\nGOOGLE_ADS_REFRESH_TOKEN=${body.refresh_token}\n` : body);
  process.exit(0);
}).listen(port, '127.0.0.1');
