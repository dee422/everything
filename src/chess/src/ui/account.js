/**
 * The account panel: the chip in the top bar, the sign-in / create-account
 * dialog it opens, and the card that nags until the email is confirmed.
 *
 * Everything here is driven by what the API says (see net/auth.js): the page
 * holds no token and no notion of who is signed in beyond the last reply, so
 * a reload asks the server again rather than trusting localStorage.
 *
 * The markup lives in index.html next to the rest of the board's chrome, and
 * the strings are English because the board is English. Failure wording comes
 * from the error codes, never from the server's own Chinese text.
 */

import { makeAccountApi, verifyNews } from '../net/auth.js';

const $ = (id) => document.getElementById(id);

const TITLES = {
  signin: 'Sign in',
  signup: 'Create account',
  account: 'Your account',
};

/**
 * Wire the panel to the board's chrome. `showToast` is the board's own
 * transient notice, so signing in and capturing a piece tell the player the
 * same way.
 *
 * @param {{showToast(text: string): void}} deps
 */
export function mountAccount({ showToast }) {
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
    el.chipLabel.textContent = player ? player.nickname : 'Sign in';
    el.flag.hidden = !player || player.verified;
    el.verifyCard.classList.toggle('hidden', !player || player.verified);
    if (player) el.verifyEmail.textContent = player.email;
    el.name.textContent = player ? player.nickname : '';
    el.mail.textContent = player?.email ?? '';
    el.stateLine.textContent = player
      ? player.verified
        ? 'Email confirmed.'
        : 'Not confirmed yet — check your inbox.'
      : '';
    el.stateLine.classList.toggle('confirmed', !!player?.verified);
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

  function openDialog() {
    showPane(player ? 'account' : 'signin');
    el.dialog.showModal();
    const first = player ? el.closeBtn : el.signinEmail;
    first.focus();
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
      message: 'Could not reach the server. Check your connection and try again.',
    }));
    setBusy(false);
    onReply(reply);
  }

  function acceptSignIn(reply) {
    player = reply.player ?? null;
    paint();
    el.signinPassword.value = '';
    el.dialog.close();
    showToast(`Signed in as ${player?.nickname ?? 'you'}.`);
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

  el.chip.addEventListener('click', openDialog);
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
          showToast('Done. If that address is new, a confirmation email is on its way.');
          return;
        }
        player = reply.player ?? null;
        paint();
        el.signupPassword.value = '';
        el.dialog.close();
        if (reply.mail_sent === false) {
          showError(el.verifyError, 'The confirmation email did not go out. Press Resend email.');
        }
        showToast('Account created. Pick a clock and play.');
      },
    );
  });

  el.signOutBtn.addEventListener('click', () => {
    run(api.signOut(), () => {
      player = null;
      paint();
      el.dialog.close();
      showPane('signin');
      showToast('Signed out.');
    });
  });

  el.resendBtn.addEventListener('click', () => {
    showError(el.verifyError, '');
    run(api.resend(), (reply) => {
      if (!reply.ok) {
        if (reply.code === 'sign_in_required') refresh();
        showError(el.verifyError, reply.message ?? problemText(reply));
        return;
      }
      if (reply.verified) {
        refresh();
        showToast('That email is already confirmed.');
        return;
      }
      showToast('Confirmation email sent — check the junk folder too.');
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

  paint(); // the chip says "Sign in" until the server answers
  refresh();
}
