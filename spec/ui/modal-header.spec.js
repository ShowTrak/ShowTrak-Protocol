const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDom } = require('./helpers/fake-dom');

// Covers @showtrak/protocol/ui/modal-header: the titlebar every modal panel in
// ShowTrak Server and ShowTrak Timers builds (back button, centred title, close
// button). Neither app tested it before. The DOM is the small fake in helpers/.
const { buildModalHeader } = require('../../dist/ui/modal-header.js');

function freshDom(t) {
  const Dom = installFakeDom();
  t.after(() => Dom.restore());
  return Dom;
}

const buttons = (Header) =>
  Header.$el
    .find('button')
    .toArray()
    .map((El) => El.getAttribute('data-modal-header-role'));

test('a title-only header has no buttons, and escapes the title', (t) => {
  freshDom(t);
  const Header = buildModalHeader({ title: 'Tags <&> "Groups"' });
  assert.equal(Header.$el.length, 1);
  const Root = Header.$el.get(0);
  assert.equal(Root.className, 'st-modal-header d-flex align-items-stretch gap-2');
  assert.deepEqual(buttons(Header), []);
  const Title = Header.$el.find('.st-modal-header-title h6');
  assert.equal(Title.text(), 'Tags <&> "Groups"');
  assert.equal(Title.attr('class'), 'mb-0 text-center');
  assert.equal(Title.attr('id'), undefined);
});

test('the back and close buttons appear only with their callbacks, in that order', (t) => {
  freshDom(t);
  const Noop = () => {};
  assert.deepEqual(buttons(buildModalHeader({ title: 'x', onBack: Noop })), ['back']);
  assert.deepEqual(buttons(buildModalHeader({ title: 'x', onClose: Noop })), ['close']);
  assert.deepEqual(buttons(buildModalHeader({ title: 'x', onBack: Noop, onClose: Noop })), [
    'back',
    'close',
  ]);
});

test('each button runs its own callback', (t) => {
  freshDom(t);
  const Calls = [];
  const Header = buildModalHeader({
    title: 'Script Manager',
    onBack: () => Calls.push('back'),
    onClose: () => Calls.push('close'),
  });
  Header.$el.find('[data-modal-header-role="close"]').trigger('click');
  Header.$el.find('[data-modal-header-role="back"]').trigger('click');
  assert.deepEqual(Calls, ['close', 'back']);
});

test('the buttons are icons with accessible labels, Back and Close by default', (t) => {
  freshDom(t);
  const Header = buildModalHeader({ title: 'x', onBack() {}, onClose() {} });
  const [Back, Close] = Header.$el.find('button').toArray();
  assert.equal(Back.getAttribute('aria-label'), 'Back');
  assert.equal(Back.querySelector('i').className, 'bi bi-chevron-left');
  assert.equal(Close.getAttribute('aria-label'), 'Close');
  assert.equal(Close.querySelector('i').className, 'bi bi-x-lg');
  for (const Button of [Back, Close]) {
    assert.equal(Button.getAttribute('type'), 'button');
    assert.match(Button.className, /\bst-modal-header-btn\b/);
  }
});

test('custom labels and the title id are escaped into their attributes', (t) => {
  freshDom(t);
  const Header = buildModalHeader({
    title: 'x',
    titleId: 'EDITOR_TITLE"',
    backLabel: 'Back to "List"',
    closeLabel: "Close 'Editor'",
    onBack() {},
    onClose() {},
  });
  const [Back, Close] = Header.$el.find('button').toArray();
  assert.equal(Back.getAttribute('aria-label'), 'Back to "List"');
  assert.equal(Close.getAttribute('aria-label'), "Close 'Editor'");
  assert.equal(Header.$el.find('h6').attr('id'), 'EDITOR_TITLE"');
});

test('setTitle changes the title text, as text', (t) => {
  const Dom = freshDom(t);
  const Header = buildModalHeader({ title: 'Old', titleId: 'PANEL_TITLE' });
  Dom.$('body').append(Header.$el);
  Header.setTitle('<New>');
  assert.equal(Dom.$('#PANEL_TITLE').text(), '<New>');
  assert.equal(Dom.document.querySelectorAll('#PANEL_TITLE new').length, 0);
});
