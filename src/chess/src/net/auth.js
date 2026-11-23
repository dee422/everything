/**
 * The account API: /api/v1/chess_*.php on the origin that serves this board.
 *
 * Same origin as the page, so nothing to configure: no CORS preflight, no CSP
 * change, and the session cookie is HttpOnly — this module never sees a token,
 * the browser attaches the cookie by itself.
 *
 * Every failure carries a stable `code` (see CHESS_ERRORS in the backend's
 * chess_guard.php), and the sentence shown here is looked up from that code
 * rather than pasted from the server. The two wordings are independent on
 * purpose: the API's own text is written for the Chinese pages beside this one
 * and says things like "操作失败", while the board speaks to a player sitting in
 * front of a chess position and wants to say which field to fix. An unknown
 * code lands on the generic line, so a renamed code shows a plain "出了点问题"
 * instead of a sentence from another part of the site.
 */

export const API_BASE = '/api/v1/';

const PROBLEM_TEXT = {
  bad_email: '这个邮箱地址看着不太对。',
  short_nickname: '昵称至少两个字。',
  short_password: '密码至少 8 位。',
  long_password: '密码太长了。',
  weak_password: '这个密码太容易被猜到，换一个。',
  missing_fields: '邮箱和密码都要填。',
  bad_credentials: '邮箱或密码不对。',
  sign_in_required: '请先登录。',
  no_such_player: '这个账号已经不在了。',
  too_many_logins: '失败次数太多，请 15 分钟后再试。',
  too_many_registrations:
    '这个网络这一小时注册的次数太多了。请一小时后再试，或写信到 admin@ichessgeek.com。',
  too_many_sends: '这一小时从这里发的邮件太多了，稍后再试。',
  mail_failed: '邮件发不出去，请联系 admin@ichessgeek.com。',
  method: '浏览器没能把这一步发出去，请再试一次。',
  content_type: '浏览器没能把这一步发出去，请再试一次。',
  bad_body: '浏览器没能把这一步发出去，请再试一次。',
  service: '服务器暂时没响应，过一分钟再试。',
  verify_failed: '验证暂时不可用，请稍后再试。',
  network: '连不上服务器。请检查网络后再试。',
  server: '出了点问题，请再试一次。',

  // Rooms. The referee's codes, worded for the player looking at the board.
  verify_required:
    '先把邮箱确认了 —— 我们发你的那封邮件里的链接，点一下就能和人下棋。',
  bad_room_code: '这不是房间码：六位字母和数字，中间不要空格。',
  no_such_room: '没有这个房间码的对局。请核对一下再试。',
  room_full: '这一局已经坐满两个人了。',
  room_not_active: '这一局现在不走棋。',
  room_over: '这一局已经结束了。',
  not_room_member: '这一局里没有你。',
  not_your_turn: '该对方走棋了。',
  illegal_move: '这一步在当前的局面上不合法。',
  flagged: '有一边的钟走完了，这一局已经结束。',
  stale_move: '你这一步落下去之前，局面已经往前走了。',
  bad_room_time: '一局的时间在一方 10 秒到 1 小时之间。',
  bad_room_color: '请选白方、黑方或随机。',
  too_many_rooms: '你刚刚开好几局了。请一小时后再试。',
  too_many_joins: '短时间内试的房间码太多，等几分钟再试。',
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
export async function call(endpoint, { method = 'POST', body, fetchImpl } = {}) {
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
    return { verified: true, text: '邮箱已经确认好了。这个标签页可以关了。' };
  }
  if (kind === 'already') {
    return { verified: true, text: '这个邮箱之前已经确认过了。' };
  }
  if (kind === 'expired') {
    return { verified: false, text: '那个链接已经过期了。请回棋盘按「重发邮件」。' };
  }
  if (kind === 'bad') {
    return { verified: false, text: '那个链接不是我们发出来的。' };
  }
  return null;
}
