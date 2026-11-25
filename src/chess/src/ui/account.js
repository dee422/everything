/**
 * The account panel: the chip in the top bar, the sign-in / create-account
 * dialog it opens, and the card that nags until the email is confirmed.
 *
 * Everything here is driven by what the API says (see net/auth.js): the page
 * holds no token and no notion of who is signed in beyond the last reply, so
 * a reload asks the server again rather than trusting localStorage.
 *
 * The markup lives in index.html next to the rest of the board's chrome, and
 * the strings are Chinese because the board is Chinese. Failure wording comes
 * from the error codes (net/auth.js), never from the server's own text.
 */

import { makeAccountApi, verifyNews } from '../net/auth.js';
import { syncFromServer } from '../game/library.js';

const $ = (id) => document.getElementById(id);

const TITLES = {
  signin: '登录',
  signup: '注册',
  account: '我的账号',
};

/**
 * Wire the panel to the board's chrome.
 *
 * @param {{
 *   showToast(text: string): void,
 *   onSignOut?(): void,  // so online play can let go of a room it cannot poll any more
 *   onIdentity?(): void, // 每次"这个人是谁"变了就叫一声（登录/注册/退出/首屏问到）
 * }} deps
 * @returns {{open(which?: 'signin'|'signup'|'account'): void}} how the rest of
 *   the board opens the panel. It deliberately does not report who is signed
 *   in: online play asks the server instead, so a click that lands before the
 *   first reply arrives cannot be talked out of the game it is entitled to.
 */
export function mountAccount({ showToast, onSignOut = () => {}, onIdentity = () => {} }) {
  const api = makeAccountApi();

  const el = {
    chip: $('account-chip'),
    chipLabel: $('account-chip-label'),
    flag: $('account-flag'),
    dialog: $('account-dialog'),
    title: $('account-title'),
    tabs: $('account-tabs'),
    signinPane: $('signin-pane'),
    signupPane: $('signup-pane'),
    accountPane: $('account-pane'),
    signinEmail: $('signin-email'),
    signinPassword: $('signin-password'),
    signinError: $('signin-error'),
    signinBtn: $('signin-btn'),
    signupNickname: $('signup-nickname'),
    signupEmail: $('signup-email'),
    signupPassword: $('signup-password'),
    signupError: $('signup-error'),
    signupBtn: $('signup-btn'),
    name: $('account-name'),
    mail: $('account-mail'),
    stateLine: $('account-state'),
    signOutBtn: $('account-signout-btn'),
    closeBtn: $('account-close-btn'),
    verifyCard: $('verify-card'),
    verifyEmail: $('verify-email'),
    resendBtn: $('resend-btn'),
    verifyError: $('verify-error'),
  };

  let player = null;

  function showError(line, text) {
    line.textContent = text;
    line.hidden = !text;
  }

  /** One request at a time: a double click would sign in twice. */
  function setBusy(on) {
    for (const button of [el.signinBtn, el.signupBtn, el.resendBtn, el.signOutBtn, el.chip]) {
      button.disabled = on;
    }
  }

  function paint() {
    el.chipLabel.textContent = player ? player.nickname : '登录';
    el.flag.hidden = !player || player.verified;
    el.verifyCard.classList.toggle('hidden', !player || player.verified);
    if (player) el.verifyEmail.textContent = player.email;
    el.name.textContent = player ? player.nickname : '';
    el.mail.textContent = player?.email ?? '';
    el.stateLine.textContent = player
      ? player.verified
        ? '邮箱已确认。'
        : '还没确认 —— 请收一下邮件。'
      : '';
    el.stateLine.classList.toggle('confirmed', !!player?.verified);
    // paint() 是这里唯一一处"身份落定"的地方：登录、注册、退出、首屏问到的
    // 四条路都要经过它，所以别的面板挂在这一点上，而不是各自去猜哪儿会改。
    onIdentity();
  }

  function showPane(which) {
    el.title.textContent = TITLES[which];
    // The signed-in pane is not a choice between two ways in, so the switch
    // that offers them goes with it.
    el.tabs.classList.toggle('hidden', which === 'account');
    for (const button of el.tabs.querySelectorAll('button')) {
      const selected = button.dataset.pane === which;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    el.signinPane.classList.toggle('hidden', which !== 'signin');
    el.signupPane.classList.toggle('hidden', which !== 'signup');
    el.accountPane.classList.toggle('hidden', which !== 'account');
    showError(el.signinError, '');
    showError(el.signupError, '');
    showError(el.verifyError, '');
  }

  const FIRST_INPUT = {
    signin: () => el.signinEmail,
    signup: () => el.signupNickname,
    account: () => el.closeBtn,
  };

  /**
   * @param {'signin'|'signup'|'account'} [which] where to start; by default the
   *   pane a player of this account would want. Online play asks for one, since
   *   it is the panel's other reason for existing.
   */
  function openDialog(which) {
    const pane = which ?? (player ? 'account' : 'signin');
    showPane(pane);
    el.dialog.showModal();
    FIRST_INPUT[pane]().focus();
  }

  /**
   * @param {Promise<object>} request the API call to make
   * @param {(reply: object) => void} onReply
   */
  async function run(request, onReply) {
    setBusy(true);
    // auth.js resolves with an error reply rather than throwing; this keeps
    // the panel honest even if that ever changes.
    const reply = await request.catch(() => ({
      ok: false,
      code: 'network',
      message: '连不上服务器。请检查网络后再试。',
    }));
    setBusy(false);
    onReply(reply);
  }

  function acceptSignIn(reply) {
    player = reply.player ?? null;
    paint();
    el.signinPassword.value = '';
    el.dialog.close();
    showToast(`已登录为 ${player?.nickname ?? '你'}。`);
    // Pull the server library into localStorage so the panel shows all games
    // across devices, not just the ones from this browser.
    syncFromServer();
  }

  /**
   * @returns {Promise<void>} asks the server who this is; called on load, and
   *   after a verification link was clicked in another tab.
   */
  async function refresh() {
    await run(api.who(), (reply) => {
      player = reply?.ok && reply.signed_in ? reply.player : null;
      paint();
    });
  }

  el.chip.addEventListener('click', () => openDialog());
  el.closeBtn.addEventListener('click', () => el.dialog.close());

  for (const button of el.tabs.querySelectorAll('button')) {
    button.addEventListener('click', () => showPane(button.dataset.pane));
  }

  el.signinPane.addEventListener('submit', (e) => {
    e.preventDefault();
    run(
      api.signIn(el.signinEmail.value.trim(), el.signinPassword.value),
      (reply) => {
        if (reply.ok && reply.signed_in) {
          acceptSignIn(reply);
          return;
        }
        showError(el.signinError, reply.message);
        el.signinEmail.focus();
      },
    );
  });

  el.signupPane.addEventListener('submit', (e) => {
    e.preventDefault();
    run(
      api.create(
        el.signupEmail.value.trim(),
        el.signupPassword.value,
        el.signupNickname.value.trim(),
      ),
      (reply) => {
        if (!reply.ok) {
          showError(el.signupError, reply.message);
          return;
        }
        if (reply.status === 'submitted') {
          // Either the address was taken or it was not — the API says the same
          // thing either way so nobody can use this form to look up a class.
          el.dialog.close();
          showToast('好了。如果这个邮箱是新注册的，确认邮件已经在路上。');
          return;
        }
        player = reply.player ?? null;
        paint();
        el.signupPassword.value = '';
        el.dialog.close();
        if (reply.mail_sent === false) {
          showError(el.verifyError, '确认邮件没能发出去。请按「重发邮件」。');
        }
        showToast('账号建好了。选一个时限就能开局。');
      },
    );
  });

  el.signOutBtn.addEventListener('click', () => {
    run(api.signOut(), () => {
      player = null;
      paint();
      el.dialog.close();
      showPane('signin');
      onSignOut();
      showToast('已退出登录。');
    });
  });

  el.resendBtn.addEventListener('click', () => {
    showError(el.verifyError, '');
    run(api.resend(), (reply) => {
      if (!reply.ok) {
        if (reply.code === 'sign_in_required') refresh();
        showError(el.verifyError, reply.message);
        return;
      }
      if (reply.verified) {
        refresh();
        showToast('这个邮箱之前已经确认过了。');
        return;
      }
      showToast('确认邮件已发出 —— 垃圾箱也看一眼。');
    });
  });

  // The link in the email opens its own tab. Coming back here is the moment
  // the board learns it worked, and a player should not have to reload to find
  // out — especially on a phone, where the mail app is a different window.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && player && !player.verified) refresh();
  });

  // /chess/?verify=… is where chess_verify.php sends people after the link.
  const news = verifyNews(window.location.search);
  if (news) {
    // The news is a one-time message; leaving it in the address would repeat it
    // on every reload and let a screenshot of the URL carry the story.
    history.replaceState(null, '', window.location.pathname);
    showToast(news.text);
  }

  paint(); // the chip says 登录 until the server answers
  refresh();

  return { player: () => player, open: (which) => openDialog(which) };
}
