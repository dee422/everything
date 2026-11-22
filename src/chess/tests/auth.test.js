import { describe, expect, it, vi } from 'vitest';
import { API_BASE, makeAccountApi, problemText, verifyNews } from '../src/net/auth.js';

/** A fetch that answers with fixed JSON and records what it was asked for. */
function recordingFetch(reply = { ok: true }, status = 200) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 400,
      status,
      json: async () => reply,
    };
  });
  return { fn, calls };
}

describe('what each call asks the server for', () => {
  it('asks who I am with a plain GET', async () => {
    const { fn, calls } = recordingFetch({ ok: true, signed_in: false });
    const api = makeAccountApi({ fetchImpl: fn });
    await api.who();
    expect(calls[0].url).toBe(`${API_BASE}chess_me.php`);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('sends a JSON body and keeps the session cookie', async () => {
    const { fn, calls } = recordingFetch({ ok: true, signed_in: true });
    const api = makeAccountApi({ fetchImpl: fn });
    await api.signIn('joe@example.com', 'Knight2026!');
    const { init } = calls[0];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      email: 'joe@example.com',
      password: 'Knight2026!',
    });
  });

  it('posts an empty object for the calls that take nothing', async () => {
    const { fn, calls } = recordingFetch();
    const api = makeAccountApi({ fetchImpl: fn });
    await api.signOut();
    await api.resend();
    expect(calls.map((c) => c.url)).toEqual([
      `${API_BASE}chess_logout.php`,
      `${API_BASE}chess_resend.php`,
    ]);
    expect(calls.map((c) => c.init.body)).toEqual(['{}', '{}']);
  });

  it('sends the nickname with a new account', async () => {
    const { fn, calls } = recordingFetch();
    const api = makeAccountApi({ fetchImpl: fn });
    await api.create('joe@example.com', 'Knight2026!', '乔');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      email: 'joe@example.com',
      password: 'Knight2026!',
      nickname: '乔',
    });
  });
});

describe('what comes back', () => {
  it('passes a good reply through, status field and all', async () => {
    const reply = {
      ok: true,
      status: 'created',
      signed_in: true,
      mail_sent: true,
      player: { nickname: 'Joe', verified: false },
    };
    const { fn } = recordingFetch(reply);
    const api = makeAccountApi({ fetchImpl: fn });
    expect(await api.who()).toEqual(reply);
  });

  it('turns a server error into the sentence for its code', async () => {
    const { fn } = recordingFetch({ ok: false, code: 'bad_credentials' }, 401);
    const api = makeAccountApi({ fetchImpl: fn });
    const reply = await api.signIn('a@b.co', 'nope');
    expect(reply.ok).toBe(false);
    expect(reply.message).toBe('Email or password is not right.');
  });

  it('does not paste the server’s own wording into an English panel', async () => {
    const { fn } = recordingFetch({ ok: false, code: 'no_such_code', error: '请先登录' }, 400);
    const api = makeAccountApi({ fetchImpl: fn });
    const reply = await api.signIn('a@b.co', 'pw');
    expect(reply.error).toBe('请先登录'); // the raw field is still there…
    expect(reply.message).toBe('Something went wrong. Please try again.'); // …but not shown
  });

  it('says the network failed when nothing answered', async () => {
    const api = makeAccountApi({ fetchImpl: vi.fn(async () => { throw new Error('off line'); }) });
    const reply = await api.signOut();
    expect(reply).toEqual({
      ok: false,
      code: 'network',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  });

  it('says the server answered strangely when the body was not JSON', async () => {
    const api = makeAccountApi({
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('html'); } })),
    });
    expect((await api.who()).code).toBe('server');

    const down = makeAccountApi({
      fetchImpl: vi.fn(async () => ({
        ok: false, status: 503, json: async () => { throw new Error('html'); },
      })),
    });
    const reply = await down.who();
    expect(reply.code).toBe('service');
    expect(reply.ok).toBe(false);
  });

  it('treats an HTTP failure with no code as an error anyway', async () => {
    const { fn } = recordingFetch({ ok: true }, 500);
    const api = makeAccountApi({ fetchImpl: fn });
    expect((await api.resend()).ok).toBe(false);
  });
});

describe('problemText', () => {
  it('knows a sentence for every code the backend can answer with', () => {
    // The codes chess_guard.php's CHESS_ERRORS table holds. Renaming one on
    // either side without the other shows up here as a missing sentence.
    const codes = [
      'service', 'server', 'method', 'content_type', 'bad_body', 'sign_in_required',
      'no_such_player', 'too_many_logins', 'too_many_registrations', 'too_many_sends',
      'mail_failed', 'bad_credentials', 'missing_fields', 'bad_email', 'short_nickname',
      'short_password', 'long_password', 'weak_password', 'verify_failed',
    ];
    // Every code but 'server' has to say something the fallback does not,
    // because 'server' is exactly what the fallback says.
    for (const code of codes.filter((code) => code !== 'server')) {
      expect(problemText({ code })).not.toBe(problemText({}));
    }
    for (const code of codes) {
      expect(problemText({ code })).toMatch(/\w/);
    }
  });

  it('falls back without a code', () => {
    expect(problemText(undefined)).toBe('Something went wrong. Please try again.');
  });
});

describe('verifyNews', () => {
  it('reads each outcome the verification link can bring', () => {
    expect(verifyNews('?verify=ok').verified).toBe(true);
    expect(verifyNews('?verify=already').verified).toBe(true);
    expect(verifyNews('?verify=expired').verified).toBe(false);
    expect(verifyNews('?verify=bad').text).toBe('That link is not one of ours.');
  });

  it('has nothing to say about a plain visit', () => {
    expect(verifyNews('')).toBe(null);
    expect(verifyNews('?mode=online')).toBe(null);
    expect(verifyNews(undefined)).toBe(null);
  });

  it('ignores a value that is not one of ours', () => {
    expect(verifyNews('?verify=%3Cscript%3E')).toBe(null);
  });
});
