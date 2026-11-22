const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDom } = require('./helpers/fake-dom');

// Covers @showtrak/protocol/ui/toasts: the alert-style toasts and Notify of
// ShowTrak Server and ShowTrak Timers, in each app's configuration (Server's
// outline icons, Timers' filled ones), and the message clean-up both apps'
// tests covered (WithFullStop). The DOM is the small fake in helpers/.
const {
  CreateToasts,
  RemoveAlertToastById,
  WithFullStop,
  ensureToastHost,
} = require('../../dist/ui/toasts.js');
const { StyledGlyph } = require('../../dist/ui/icons.js');

const Server = CreateToasts({ IconStyle: 'outline' });
const Timers = CreateToasts({ IconStyle: 'fill' });

// A fresh page per test, on mock timers: toasts time out by themselves.
function freshDom(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const Dom = installFakeDom();
  t.after(() => Dom.restore());
  return Dom;
}

const toastsIn = (Dom) => Dom.document.querySelectorAll('#ALERTS_TOAST_HOST .alert-toast');

// --- WithFullStop -----------------------------------------------------------

test('WithFullStop closes a dynamic toast message with a full stop', () => {
  assert.equal(WithFullStop('Client not found'), 'Client not found.');
  assert.equal(WithFullStop('Timer not found'), 'Timer not found.');
  assert.equal(WithFullStop('Failed to delete tag: in use  '), 'Failed to delete tag: in use.');
  assert.equal(WithFullStop('Line one\n'), 'Line one.');
});

test('WithFullStop leaves sentence punctuation alone', () => {
  assert.equal(WithFullStop('Saved show file.'), 'Saved show file.');
  assert.equal(WithFullStop('Done!'), 'Done!');
  assert.equal(WithFullStop('Really?'), 'Really?');
  assert.equal(WithFullStop('Running checks...'), 'Running checks...');
  assert.equal(WithFullStop('Loading…'), 'Loading…');
});

test('WithFullStop passes empty, blank and non-string messages through', () => {
  assert.equal(WithFullStop(''), '');
  assert.equal(WithFullStop('   '), '   ');
  assert.equal(WithFullStop(null), null);
  assert.equal(WithFullStop(undefined), undefined);
  assert.equal(WithFullStop(404), 404);
  const Err = { message: 'x' };
  assert.equal(WithFullStop(Err), Err);
});

// --- Icons, per app ----------------------------------------------------------

test("Server's toasts keep their outline icons", () => {
  assert.equal(Server.iconForType('success'), '<i class="bi bi-check-circle"></i>');
  assert.equal(Server.iconForType('warning'), '<i class="bi bi-exclamation-triangle"></i>');
  assert.equal(Server.iconForType('error'), '<i class="bi bi-x-circle"></i>');
  assert.equal(Server.iconForType('info'), '<i class="bi bi-info-circle"></i>');
});

test("Timers' toasts keep their filled icons", () => {
  assert.equal(Timers.iconForType('success'), '<i class="bi bi-check-circle-fill"></i>');
  assert.equal(Timers.iconForType('warning'), '<i class="bi bi-exclamation-triangle-fill"></i>');
  assert.equal(Timers.iconForType('error'), '<i class="bi bi-x-circle-fill"></i>');
  assert.equal(Timers.iconForType('info'), '<i class="bi bi-info-circle-fill"></i>');
});

test('an unknown, missing or differently cased type gets the info icon or its own', () => {
  for (const Type of [undefined, null, '', 'nonsense']) {
    assert.equal(Server.iconForType(Type), '<i class="bi bi-info-circle"></i>', String(Type));
  }
  assert.equal(Timers.iconForType('ERROR'), '<i class="bi bi-x-circle-fill"></i>');
});

test('StyledGlyph names the outline or the filled glyph', () => {
  assert.equal(StyledGlyph('bi-check-circle', 'outline'), 'bi-check-circle');
  assert.equal(StyledGlyph('bi-check-circle', 'fill'), 'bi-check-circle-fill');
});

// --- The toast host ---------------------------------------------------------

test('the toast host is created once, at the end of the body', (t) => {
  const Dom = freshDom(t);
  Dom.add('<div id="APP"></div>');
  const Host = ensureToastHost();
  assert.equal(Host.id, 'ALERTS_TOAST_HOST');
  assert.equal(Dom.body.children.at(-1), Host);
  assert.equal(ensureToastHost(), Host);
  assert.equal(Dom.document.querySelectorAll('#ALERTS_TOAST_HOST').length, 1);
});

// --- showAlertStyleToast -----------------------------------------------------

test('a toast shows its escaped title and message, with the type as its severity', (t) => {
  const Dom = freshDom(t);
  Server.showAlertStyleToast({ title: '<b>Rig</b>', message: 'Went "offline"', type: 'Warning' });
  const [Toast] = toastsIn(Dom);
  assert.equal(Toast.className, 'alert-item alert-toast');
  assert.equal(Toast.getAttribute('data-severity'), 'warning');
  assert.equal(Toast.querySelector('.alert-content strong').textContent, '<b>Rig</b>');
  assert.equal(Toast.querySelector('.alert-meta').textContent, 'Went "offline"');
  assert.equal(Toast.querySelector('.alert-icon i').className, 'bi bi-exclamation-triangle');
  assert.equal(Toast.classList.contains('single-line'), false);
});

test('a toast without a message is single-line, and an empty title reads Notice', (t) => {
  const Dom = freshDom(t);
  Timers.showAlertStyleToast({ title: '', message: '   ' });
  const [Toast] = toastsIn(Dom);
  assert.equal(Toast.classList.contains('single-line'), true);
  assert.equal(Toast.querySelector('strong').textContent, 'Notice');
  assert.equal(Toast.getAttribute('data-severity'), 'info');
  assert.equal(Toast.querySelector('.alert-icon i').className, 'bi bi-info-circle-fill');
});

test('a toast keeps the markup both apps style', (t) => {
  const Dom = freshDom(t);
  Server.showAlertStyleToast({ title: 'T', message: 'M', type: 'success' });
  const [Toast] = toastsIn(Dom);
  assert.equal(
    Toast.innerHTML.replace(/\s+</g, '<'),
    '<div class="alert-icon"><i class="bi bi-check-circle"></i></div>' +
      '<div class="alert-content"><div><strong>T</strong></div><div class="alert-meta">M</div></div>' +
      '<div class="alert-dismiss"><button class="btn-dismiss" title="Dismiss" aria-label="Dismiss">✕</button></div>'
  );
});

test('icon markup passed in replaces the type icon', (t) => {
  const Dom = freshDom(t);
  Server.showAlertStyleToast({ title: 'USB', iconHtml: '<i class="bi bi-usb-symbol"></i>' });
  assert.equal(toastsIn(Dom)[0].querySelector('.alert-icon i').className, 'bi bi-usb-symbol');
});

test('only a linked toast with an id is tagged, and RemoveAlertToastById finds it', (t) => {
  const Dom = freshDom(t);
  Server.showAlertStyleToast({ id: 'a"1', title: 'Linked', linkAlert: true });
  Server.showAlertStyleToast({ id: 'b', title: 'Not linked' });
  Server.showAlertStyleToast({ title: 'No id', linkAlert: true });
  const Toasts = toastsIn(Dom);
  assert.deepEqual(
    Toasts.map((El) => El.getAttribute('data-alert-id')),
    ['a"1', null, null]
  );
  RemoveAlertToastById('a"1');
  assert.deepEqual(
    toastsIn(Dom).map((El) => El.querySelector('strong').textContent),
    ['Not linked', 'No id']
  );
});

test('RemoveAlertToastById does nothing before any toast was shown', (t) => {
  freshDom(t);
  assert.doesNotThrow(() => RemoveAlertToastById('missing'));
});

test('the dismiss button removes the toast and runs onDismiss', (t) => {
  // Server's alerts tray: a toast mirroring a tray entry dismisses the entry too.
  const Dom = freshDom(t);
  const Dismissed = [];
  Server.showAlertStyleToast({
    id: 'alert-1',
    title: 'Client offline',
    linkAlert: true,
    onDismiss: () => Dismissed.push('alert-1'),
  });
  const [Toast] = toastsIn(Dom);
  Toast.querySelector('.btn-dismiss').dispatch('click');
  assert.equal(toastsIn(Dom).length, 0);
  assert.deepEqual(Dismissed, ['alert-1']);
});

test('a toast that times out does not run onDismiss', (t) => {
  const Dom = freshDom(t);
  let Dismissed = 0;
  Server.showAlertStyleToast({ title: 'x', duration: 6000, onDismiss: () => Dismissed++ });
  t.mock.timers.tick(6000);
  assert.equal(toastsIn(Dom).length, 0);
  assert.equal(Dismissed, 0);
});

// --- Auto-dismiss ------------------------------------------------------------

test('a toast goes after its duration, 5 seconds by default', (t) => {
  const Dom = freshDom(t);
  Timers.showAlertStyleToast({ title: 'default' });
  Timers.showAlertStyleToast({ title: 'long', duration: 20000 });
  t.mock.timers.tick(4999);
  assert.equal(toastsIn(Dom).length, 2);
  t.mock.timers.tick(1);
  assert.deepEqual(
    toastsIn(Dom).map((El) => El.querySelector('strong').textContent),
    ['long']
  );
  t.mock.timers.tick(15000);
  assert.equal(toastsIn(Dom).length, 0);
});

test('a duration of 0 or less keeps the toast until it is dismissed', (t) => {
  const Dom = freshDom(t);
  Server.showAlertStyleToast({ title: 'stays', duration: 0 });
  Server.showAlertStyleToast({ title: 'stays too', duration: -1 });
  t.mock.timers.tick(60000);
  assert.equal(toastsIn(Dom).length, 2);
});

test('hovering pauses the countdown, and leaving resumes it with the time left', (t) => {
  const Dom = freshDom(t);
  Server.showAlertStyleToast({ title: 'x', duration: 5000 });
  const [Toast] = toastsIn(Dom);
  t.mock.timers.tick(3000);
  Toast.dispatch('mouseenter');
  t.mock.timers.tick(60000);
  assert.equal(toastsIn(Dom).length, 1, 'paused while hovered');
  Toast.dispatch('mouseleave');
  t.mock.timers.tick(1999);
  assert.equal(toastsIn(Dom).length, 1);
  t.mock.timers.tick(1);
  assert.equal(toastsIn(Dom).length, 0, 'gone once the remaining 2 seconds have run');
});

// --- Notify --------------------------------------------------------------------

test('Notify shows a title-only toast closed off as a sentence', async (t) => {
  const Dom = freshDom(t);
  await Timers.Notify('Port in use', 'error', 8000);
  const [Toast] = toastsIn(Dom);
  assert.equal(Toast.querySelector('strong').textContent, 'Port in use.');
  assert.equal(Toast.querySelector('.alert-meta'), null);
  assert.equal(Toast.classList.contains('single-line'), true);
  assert.equal(Toast.getAttribute('data-severity'), 'error');
  assert.equal(Toast.querySelector('.alert-icon i').className, 'bi bi-x-circle-fill');
  t.mock.timers.tick(7999);
  assert.equal(toastsIn(Dom).length, 1);
  t.mock.timers.tick(1);
  assert.equal(toastsIn(Dom).length, 0);
});

test("Notify defaults to an info toast in the app's style", async (t) => {
  const Dom = freshDom(t);
  await Server.Notify('Saved.');
  const [Toast] = toastsIn(Dom);
  assert.equal(Toast.getAttribute('data-severity'), 'info');
  assert.equal(Toast.querySelector('.alert-icon i').className, 'bi bi-info-circle');
  assert.equal(Toast.querySelector('strong').textContent, 'Saved.');
});
