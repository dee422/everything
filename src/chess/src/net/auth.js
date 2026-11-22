/**
 * The account API: /api/v1/chess_*.php on the origin that serves this board.
 *
 * Same origin as the page, so nothing to configure: no CORS preflight, no CSP
 * change, and the session cookie is HttpOnly — this module never sees a token,
 * the browser attaches the cookie by itself.
 *
 * Every failure carries a stable `code` (see CHESS_ERRORS in the backend's
 * chess_guard.php), and the sentence shown here is looked up from that code.
 * The API answers in Chinese because its other readers are Chinese pages; this
 * panel is part of an English board, so it words the same codes in English
 * instead of pasting the server's text into the middle of it. An unknown code
 * becomes a generic line rather than leaking a foreign-language string.
 */

export const API_BASE = '/api/v1/';

const PROBLEM_TEXT = {
  bad_email: 'That email address doesn’t look right.',
  short_nickname: 'A nickname needs at least two characters.',
  short_password: 'Use at least 8 characters.',
  long_password: 'That password is too long.',
  weak_password: 'That password is too easy to guess — try another.',
  missing_fields: 'Fill in both the email and the password.',
  bad_credentials: 'Email or password is not right.',
  sign_in_required: 'Sign in first.',
  no_such_player: 'That account is no longer there.',
  too_many_logins: 'Too many failed tries. Wait 15 minutes and try again.',
  too_many_registrations:
    'Too many accounts opened from this network just now. Try again in an hour, or write to admin@ichessgeek.com.',
  too_many_sends: 'Too many emails sent from here. Try again in an hour.',
  mail_failed: 'The email could not be sent. Please write to admin@ichessgeek.com.',
  method: 'The browser could not send that. Please try again.',
  content_type: 'The browser could not send that. Please try again.',
  bad_body: 'The browser could not send that. Please try again.',
  service: 'The server is not answering. Try again in a minute.',
  verify_failed: 'Verification is not available right now. Try again in a minute.',
  network: 'Could not reach the server. Check your connection and try again.',
  server: 'Something went wrong. Please try again.',
};

/**
 * What to say for a reply. Never the server's own wording: an unexpected code
 * (or no code at all) lands on the generic line.
 */
export function problemText(reply) {
  return PROBLEM_TEXT[reply?.code] ?? PROBLEM_TEXT.server;
}

/**
 * One call, one shape: the server's JSON plus `ok`, or `{ok:false, code:'network'}`
 * when the request itself failed or the body was not JSON. It never throws, so
 * callers branch on `reply.ok` and nothing else.
 *
 * The HTTP status is deliberately not passed up: register answers with its own
 * `status` field ('created' or 'submitted'), and a number from here would
 * replace it.
 */
async function call(endpoint, { method = 'POST', body, fetchImpl } = {}) {
  const fetchJson = fetchImpl ?? globalThis.fetch;
  const init = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchJson(API_BASE + endpoint, init);
  } catch {
    return { ok: false, code: 'network', message: problemText({ code: 'network' }) };
  }

  let reply = null;
  try {
    reply = await response.json();
  } catch {
    reply = null;
  }
  if (!reply || typeof reply !== 'object') {
    const offline = response.status >= 500 ? 'service' : 'server';
    return { ok: false, code: offline, message: problemText({ code: offline }) };
  }
  if (reply.ok === false || !response.ok) {
    return { ...reply, ok: false, message: problemText(reply) };
  }
  return reply;
}

/**
 * The five calls the panel makes. `fetchImpl` is there for the tests, which
 * run without a DOM and have no fetch.
 */
export function makeAccountApi({ fetchImpl } = {}) {
  return {
    who: () => call('chess_me.php', { method: 'GET', fetchImpl }),
    signIn: (email, password) => call('chess_login.php', { body: { email, password }, fetchImpl }),
    create: (email, password, nickname) =>
      call('chess_register.php', { body: { email, password, nickname }, fetchImpl }),
    signOut: () => call('chess_logout.php', { body: {}, fetchImpl }),
    resend: () => call('chess_resend.php', { body: {}, fetchImpl }),
  };
}

/**
 * The verification link lands back here as /chess/?verify=… (chess_verify.php
 * redirects rather than printing a page, so the API never has to know the
 * board's markup). Returns the sentence to show, or null for a plain visit.
 */
export function verifyNews(search) {
  const kind = new URLSearchParams(search ?? '').get('verify');
  if (kind === 'ok') {
    return { verified: true, text: 'Email confirmed. You can close this tab now.' };
  }
  if (kind === 'already') {
    return { verified: true, text: 'That email was already confirmed.' };
  }
  if (kind === 'expired') {
    return {
      verified: false,
      text: 'That link has expired. Press Resend email for a new one.',
    };
  }
  if (kind === 'bad') {
    return { verified: false, text: 'That link is not one of ours.' };
  }
  return null;
}
