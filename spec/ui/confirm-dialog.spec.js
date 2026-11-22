const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDom } = require('./helpers/fake-dom');

// Covers @showtrak/protocol/ui/confirm-dialog: the confirmation dialog of
// ShowTrak Server and ShowTrak Timers, in each app's configuration: its
// OnActiveChange hook (Server also redraws its identify banner) and Timers'
// third choice (AltLabel). The DOM is the small fake in helpers/; Enter and
// Space on a focused button are the browser's own click, so they are clicks
// here.
const {
  CancelConfirmation,
  ConfirmationDialogHtml,
  CreateConfirmationDialog,
} = require('../../dist/ui/confirm-dialog.js');
const { Safe } = require('../../dist/ui/html.js');

// What each app drew before the kit, copied from its lib/toasts.ts.
const ServerMarkupBefore = (Message, Options) =>
  `
			<div id="SHOWTRAK_CONFIRM_TOAST" role="alertdialog" aria-modal="true" aria-labelledby="CONFIRM_TOAST_MESSAGE" class="confirm-toast no-drag">
				<div class="confirm-toast-body">
					<div class="confirm-toast-msg" id="CONFIRM_TOAST_MESSAGE">${Safe(Message)}</div>
					<div class="confirm-toast-actions">
						<button type="button" class="btn btn-sm btn-secondary" id="CONFIRM_TOAST_CANCEL">Cancel</button>
						<button type="button" class="btn btn-sm btn-danger" id="CONFIRM_TOAST_CONFIRM">${Safe(
              Options.ConfirmLabel
            )}</button>
					</div>
				</div>
			</div>`;
const TimersMarkupBefore = (Message, Options) =>
  `
			<div id="SHOWTRAK_CONFIRM_TOAST" role="alertdialog" aria-modal="true" aria-labelledby="CONFIRM_TOAST_MESSAGE" class="confirm-toast no-drag">
				<div class="confirm-toast-body">
					<div class="confirm-toast-msg" id="CONFIRM_TOAST_MESSAGE">${Safe(Message)}</div>
					<div class="confirm-toast-actions">
						<button type="button" class="btn btn-sm btn-secondary" id="CONFIRM_TOAST_CANCEL">Cancel</button>
						${
              Options.AltLabel
                ? `<button type="button" class="btn btn-sm btn-secondary" id="CONFIRM_TOAST_ALT">${Safe(Options.AltLabel)}</button>`
                : ''
            }
						<button type="button" class="btn btn-sm btn-danger" id="CONFIRM_TOAST_CONFIRM">${Safe(
              Options.ConfirmLabel
            )}</button>
					</div>
				</div>
			</div>`;

// Each app's hooks, recording what they would do.
function serverDialog(Log) {
  return CreateConfirmationDialog({
    OnActiveChange: (Active) => {
      Log.push(`setConfirmDialogActive(${Active})`);
      Log.push('UpdateIdentifyStatusBanner');
    },
  });
}
function timersDialog(Log) {
  return CreateConfirmationDialog({
    OnActiveChange: (Active) => Log.push(`setConfirmDialogActive(${Active})`),
  });
}

function freshDom(t) {
  const Dom = installFakeDom();
  t.after(() => {
    CancelConfirmation();
    Dom.restore();
  });
  return Dom;
}

// The dialog focuses Confirm on a setTimeout(0); a later one runs after it.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const toast = (Dom) => Dom.document.getElementById('SHOWTRAK_CONFIRM_TOAST');
const button = (Dom, Id) => Dom.$('#' + Id);
const focused = (Dom) => Dom.document.activeElement.id;

// --- Markup --------------------------------------------------------------------

test("without a third choice the markup is exactly Server's", () => {
  for (const [Message, Label] of [
    ['Delete tag "<Stage>"?', 'Delete Tag'],
    ["Run 'Shutdown' on 4 clients?", 'Run Script'],
  ]) {
    assert.equal(
      ConfirmationDialogHtml(Message, { ConfirmLabel: Label }),
      ServerMarkupBefore(Message, { ConfirmLabel: Label })
    );
  }
});

test("with a third choice the markup is exactly Timers'", () => {
  const Options = { ConfirmLabel: 'Save', AltLabel: "Don't Save" };
  assert.equal(
    ConfirmationDialogHtml('Save changes to "Main"?', Options),
    TimersMarkupBefore('Save changes to "Main"?', Options)
  );
});

test("without a third choice Timers' markup differs from before only in whitespace", () => {
  const Options = { ConfirmLabel: 'Stop All Timers' };
  const Squash = (Html) => Html.replace(/\s+/g, ' ');
  assert.equal(
    Squash(ConfirmationDialogHtml('Stop all timers?', Options)),
    Squash(TimersMarkupBefore('Stop all timers?', Options))
  );
});

test('the message and labels are escaped', (t) => {
  const Dom = freshDom(t);
  const Ask = timersDialog([]);
  void Ask('<img src=x onerror=alert(1)>', { ConfirmLabel: '<b>Go</b>', AltLabel: '"Alt"' });
  assert.equal(Dom.$('#CONFIRM_TOAST_MESSAGE').text(), '<img src=x onerror=alert(1)>');
  assert.equal(button(Dom, 'CONFIRM_TOAST_CONFIRM').text(), '<b>Go</b>');
  assert.equal(button(Dom, 'CONFIRM_TOAST_ALT').text(), '"Alt"');
  assert.equal(Dom.document.querySelectorAll('img').length, 0);
});

// --- Answers -------------------------------------------------------------------

test('Confirm resolves true and Cancel false, and the dialog goes', async (t) => {
  const Dom = freshDom(t);
  const Ask = serverDialog([]);
  const Yes = Ask('Delete?', { ConfirmLabel: 'Delete Tag' });
  button(Dom, 'CONFIRM_TOAST_CONFIRM').trigger('click');
  assert.equal(await Yes, true);
  assert.equal(toast(Dom), null);

  const No = Ask('Delete?', { ConfirmLabel: 'Delete Tag' });
  button(Dom, 'CONFIRM_TOAST_CANCEL').trigger('click');
  assert.equal(await No, false);
  assert.equal(toast(Dom), null);
});

test("Timers' third choice resolves 'alt'", async (t) => {
  const Dom = freshDom(t);
  const Ask = timersDialog([]);
  const Answer = Ask('Save changes?', { ConfirmLabel: 'Save', AltLabel: "Don't Save" });
  assert.deepEqual(
    Dom.$('#SHOWTRAK_CONFIRM_TOAST')
      .find('button')
      .toArray()
      .map((El) => El.id),
    ['CONFIRM_TOAST_CANCEL', 'CONFIRM_TOAST_ALT', 'CONFIRM_TOAST_CONFIRM']
  );
  button(Dom, 'CONFIRM_TOAST_ALT').trigger('click');
  assert.equal(await Answer, 'alt');
});

test('without AltLabel there is no third button', (t) => {
  const Dom = freshDom(t);
  void serverDialog([])('Delete?', { ConfirmLabel: 'Delete Tag' });
  assert.equal(button(Dom, 'CONFIRM_TOAST_ALT').length, 0);
});

// --- Each app's hook -------------------------------------------------------------

test("Server's hook marks the dialog active and redraws the identify banner, open and closed", async (t) => {
  const Dom = freshDom(t);
  const Log = [];
  const Answer = serverDialog(Log)('Delete?', { ConfirmLabel: 'Delete Tag' });
  assert.deepEqual(Log, ['setConfirmDialogActive(true)', 'UpdateIdentifyStatusBanner']);
  button(Dom, 'CONFIRM_TOAST_CANCEL').trigger('click');
  await Answer;
  assert.deepEqual(Log, [
    'setConfirmDialogActive(true)',
    'UpdateIdentifyStatusBanner',
    'setConfirmDialogActive(false)',
    'UpdateIdentifyStatusBanner',
  ]);
});

test("Timers' hook marks the dialog active while it is open", async (t) => {
  const Dom = freshDom(t);
  const Log = [];
  const Answer = timersDialog(Log)('Stop all timers?', { ConfirmLabel: 'Stop All Timers' });
  assert.deepEqual(Log, ['setConfirmDialogActive(true)']);
  button(Dom, 'CONFIRM_TOAST_CONFIRM').trigger('click');
  await Answer;
  assert.deepEqual(Log, ['setConfirmDialogActive(true)', 'setConfirmDialogActive(false)']);
});

test('a dialog with no hooks still works', async (t) => {
  const Dom = freshDom(t);
  const Answer = CreateConfirmationDialog()('Sure?', { ConfirmLabel: 'Do It' });
  button(Dom, 'CONFIRM_TOAST_CONFIRM').trigger('click');
  assert.equal(await Answer, true);
});

// --- Placement and focus ---------------------------------------------------------

test('with no modal open the dialog goes in the body, and Confirm takes the focus', async (t) => {
  const Dom = freshDom(t);
  Dom.add('<button id="OPENER">Delete</button>');
  Dom.$('#OPENER').trigger('focus');
  void serverDialog([])('Delete?', { ConfirmLabel: 'Delete Tag' });
  assert.equal(toast(Dom).parentNode, Dom.body);
  assert.equal(focused(Dom), 'OPENER', 'not until the next tick');
  await tick();
  assert.equal(focused(Dom), 'CONFIRM_TOAST_CONFIRM');
});

test('inside an open modal the dialog goes in that modal, where Bootstrap keeps the focus', (t) => {
  const Dom = freshDom(t);
  Dom.add('<div class="modal" id="CLOSED"></div><div class="modal show" id="OPEN"></div>');
  void timersDialog([])('Delete?', { ConfirmLabel: 'Delete Timer' });
  assert.equal(toast(Dom).parentNode.id, 'OPEN');
});

test('the focus goes back to where it was once the dialog is answered', async (t) => {
  const Dom = freshDom(t);
  Dom.add('<input id="FIELD">');
  Dom.$('#FIELD').trigger('focus');
  const Answer = serverDialog([])('Delete?', { ConfirmLabel: 'Delete Tag' });
  await tick();
  button(Dom, 'CONFIRM_TOAST_CANCEL').trigger('click');
  await Answer;
  assert.equal(focused(Dom), 'FIELD');
});

test('an answer before the next tick leaves the focus alone', async (t) => {
  const Dom = freshDom(t);
  Dom.add('<input id="FIELD">');
  Dom.$('#FIELD').trigger('focus');
  const Answer = timersDialog([])('Delete?', { ConfirmLabel: 'Delete Timer' });
  button(Dom, 'CONFIRM_TOAST_CANCEL').trigger('click');
  await Answer;
  await tick();
  assert.equal(focused(Dom), 'FIELD');
});

// --- Keys ----------------------------------------------------------------------

test('Escape anywhere cancels, before the modal behind sees it', async (t) => {
  const Dom = freshDom(t);
  const Answer = serverDialog([])('Delete?', { ConfirmLabel: 'Delete Tag' });
  const Event = Dom.keydown({ key: 'Escape' });
  assert.equal(await Answer, false);
  assert.equal(Event.defaultPrevented, true);
  assert.equal(Event.propagationStopped, true);
  assert.equal(Dom.documentListenerCount('keydown'), 0, 'the listener goes with the dialog');
});

test('other keys pressed elsewhere never answer it', async (t) => {
  const Dom = freshDom(t);
  let Settled = false;
  const Answer = timersDialog([])('Delete?', { ConfirmLabel: 'Delete Timer' });
  void Answer.then(() => (Settled = true));
  for (const key of ['Enter', ' ', 'a', 'Tab']) {
    assert.equal(Dom.keydown({ key }).defaultPrevented, false, key);
  }
  await tick();
  assert.equal(Settled, false);
  assert.ok(toast(Dom));
});

for (const [App, Make] of [
  ['Server', serverDialog],
  ['Timers', timersDialog],
]) {
  test(`${App}: Escape with the right-click menu open closes just the menu`, async (t) => {
    const Dom = freshDom(t);
    Dom.add('<div id="SHOWTRAK_CONTEXT_MENU"></div>');
    let Settled = false;
    const Answer = Make([])('Delete?', { ConfirmLabel: 'Delete' });
    void Answer.then(() => (Settled = true));
    const Event = Dom.keydown({ key: 'Escape' });
    assert.equal(Event.defaultPrevented, false, "the menu's own handler takes it");
    await tick();
    assert.equal(Settled, false);
    // Once the menu has closed, Escape cancels the question again.
    Dom.$('#SHOWTRAK_CONTEXT_MENU').css('display', 'none');
    Dom.keydown({ key: 'Escape' });
    assert.equal(await Answer, false);
  });
}

test('the arrow keys and Tab move the focus round the buttons', async (t) => {
  const Dom = freshDom(t);
  void timersDialog([])('Save changes?', { ConfirmLabel: 'Save', AltLabel: "Don't Save" });
  await tick();
  const Press = (key, Extra = {}) => {
    const Event = { type: 'keydown', key, ...Extra };
    Dom.$(Dom.document.activeElement).trigger(Event);
    return focused(Dom);
  };
  assert.equal(focused(Dom), 'CONFIRM_TOAST_CONFIRM');
  assert.equal(Press('ArrowLeft'), 'CONFIRM_TOAST_ALT');
  assert.equal(Press('ArrowLeft'), 'CONFIRM_TOAST_CANCEL');
  assert.equal(Press('ArrowLeft'), 'CONFIRM_TOAST_CONFIRM', 'wraps');
  assert.equal(Press('ArrowRight'), 'CONFIRM_TOAST_CANCEL', 'wraps the other way');
  assert.equal(Press('Tab'), 'CONFIRM_TOAST_ALT');
  assert.equal(Press('Tab', { shiftKey: true }), 'CONFIRM_TOAST_CANCEL');
  assert.equal(
    Press('Tab', { shiftKey: true }),
    'CONFIRM_TOAST_CONFIRM',
    'Tab stays in the dialog'
  );
});

test('with the focus outside its buttons, the keys pick a button to start from', async (t) => {
  const Dom = freshDom(t);
  void serverDialog([])('Delete?', { ConfirmLabel: 'Delete Tag' });
  const Toast = Dom.$('#SHOWTRAK_CONFIRM_TOAST');
  Toast.trigger({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(focused(Dom), 'CONFIRM_TOAST_CONFIRM', 'an arrow goes to the last');
  Dom.body.focus();
  Toast.trigger({ type: 'keydown', key: 'Tab' });
  assert.equal(focused(Dom), 'CONFIRM_TOAST_CANCEL', 'Tab goes to the first');
});

test('a held-down Enter or Space repeating into the dialog is swallowed', async (t) => {
  const Dom = freshDom(t);
  void serverDialog([])('Delete?', { ConfirmLabel: 'Delete Tag' });
  await tick();
  for (const key of ['Enter', ' ']) {
    const Event = { type: 'keydown', key, originalEvent: { repeat: true } };
    let Prevented = false;
    Event.preventDefault = () => (Prevented = true);
    Dom.$('#CONFIRM_TOAST_CONFIRM').trigger(Event);
    assert.equal(Prevented, true, key);
  }
  // A fresh press is left to the button.
  let Prevented = false;
  Dom.$('#CONFIRM_TOAST_CONFIRM').trigger({
    type: 'keydown',
    key: 'Enter',
    originalEvent: { repeat: false },
    preventDefault: () => (Prevented = true),
  });
  assert.equal(Prevented, false);
});

// --- Questions that go away --------------------------------------------------------

test('opening a second dialog cancels the first', async (t) => {
  const Dom = freshDom(t);
  const Log = [];
  const Ask = timersDialog(Log);
  const First = Ask('First?', { ConfirmLabel: 'One' });
  const Second = Ask('Second?', { ConfirmLabel: 'Two' });
  assert.equal(await First, false);
  assert.equal(Dom.document.querySelectorAll('#SHOWTRAK_CONFIRM_TOAST').length, 1);
  assert.equal(Dom.$('#CONFIRM_TOAST_MESSAGE').text(), 'Second?');
  button(Dom, 'CONFIRM_TOAST_CONFIRM').trigger('click');
  assert.equal(await Second, true);
  assert.deepEqual(Log, [
    'setConfirmDialogActive(true)',
    'setConfirmDialogActive(false)',
    'setConfirmDialogActive(true)',
    'setConfirmDialogActive(false)',
  ]);
});

test("one app module's dialog cancels another's: there is only ever one question", async (t) => {
  freshDom(t);
  const First = serverDialog([])('First?', { ConfirmLabel: 'One' });
  void CreateConfirmationDialog()('Second?', { ConfirmLabel: 'Two' });
  assert.equal(await First, false);
});

test('CancelConfirmation answers the open question with false, and is harmless without one', async (t) => {
  const Dom = freshDom(t);
  assert.doesNotThrow(() => CancelConfirmation());
  const Answer = serverDialog([])('Delete?', { ConfirmLabel: 'Delete Tag' });
  CancelConfirmation();
  assert.equal(await Answer, false);
  assert.equal(toast(Dom), null);
  assert.doesNotThrow(() => CancelConfirmation());
});

test('closing the modal it sits in cancels it', async (t) => {
  const Dom = freshDom(t);
  Dom.add('<div class="modal show" id="EDITOR"></div>');
  const Answer = timersDialog([])('Delete?', { ConfirmLabel: 'Delete Timer' });
  Dom.$('#EDITOR').modal('hide');
  assert.equal(await Answer, false);
});

test('once answered, the modal it sat in no longer cancels anything', async (t) => {
  const Dom = freshDom(t);
  Dom.add('<div class="modal show" id="EDITOR"></div>');
  const Ask = serverDialog([]);
  const First = Ask('Delete?', { ConfirmLabel: 'Delete Tag' });
  button(Dom, 'CONFIRM_TOAST_CONFIRM').trigger('click');
  assert.equal(await First, true);
  assert.equal(Dom.$('#EDITOR').get(0).jqHandlers.length, 0);
});

test('a stale dialog element left in the page is replaced', (t) => {
  const Dom = freshDom(t);
  Dom.add('<div id="SHOWTRAK_CONFIRM_TOAST">stale</div>');
  void serverDialog([])('Fresh?', { ConfirmLabel: 'Go' });
  assert.equal(Dom.document.querySelectorAll('#SHOWTRAK_CONFIRM_TOAST').length, 1);
  assert.equal(Dom.$('#CONFIRM_TOAST_MESSAGE').text(), 'Fresh?');
});
