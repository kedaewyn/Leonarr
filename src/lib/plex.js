import { load } from '../backend.js';

const CLIENT_ID = 'leonarr-discord';
const AUTH_URL_TMPL =
  'https://app.plex.tv/auth#?clientID={clientId}&code={code}&context%5Bdevice%5D%5Bproduct%5D=Oscarr';

/** Create a new Plex PIN and return `{ pin, authUrl }`. */
export async function createPin() {
  const { createPlexPin } = await load('services/plex.js');
  const pin = await createPlexPin(CLIENT_ID);
  const authUrl = AUTH_URL_TMPL
    .replace('{clientId}', encodeURIComponent(CLIENT_ID))
    .replace('{code}', encodeURIComponent(pin.code));
  return { pin, authUrl };
}

export async function waitForPin(pinId, opts = {}) {
  const { checkPlexPin, getPlexUser } = await load('services/plex.js');
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 3000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) return null;
    const token = await checkPlexPin(pinId, CLIENT_ID).catch(() => null);
    if (token) {
      const account = await getPlexUser(token);
      return { authToken: token, account };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
