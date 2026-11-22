// A small fake of the page the UI kit drives, for the specs: a `document` with
// a real element tree, a jQuery `$` over it, Bootstrap's `.modal()` bridge and
// `CSS.escape`. Not jsdom (the apps do not use it either): just enough of the
// calls dist/ui makes, behaving the way the browser does for them.
//
// installFakeDom() puts the globals in place and returns a handle for the spec
// to build markup, fire keys and read state; restore() takes them away again.
'use strict';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link']);

function decodeEntities(Text) {
  return Text.replace(/&(amp|lt|gt|quot|#39);/g, (_m, Name) => {
    return { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[Name];
  });
}

function escapeText(Text) {
  return Text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Selectors -----------------------------------------------------------------
// Compound selectors (tag, #id, .class, [attr], [attr="value"], :visible) joined
// by the descendant combinator, in a comma-separated list. All the kit uses.

function parseCompound(Source) {
  const Compound = { Tag: null, Id: null, Classes: [], Attrs: [], Visible: false };
  const Pattern =
    /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]|(:visible)/gy;
  let Match;
  while (Pattern.lastIndex < Source.length && (Match = Pattern.exec(Source))) {
    if (Match[1]) Compound.Tag = Match[1].toUpperCase();
    else if (Match[2]) Compound.Id = Match[2];
    else if (Match[3]) Compound.Classes.push(Match[3]);
    else if (Match[4])
      Compound.Attrs.push([
        Match[4],
        Match[5] === undefined ? null : Match[5].replace(/\\(.)/g, '$1'),
      ]);
    else if (Match[6]) Compound.Visible = true;
  }
  if (Pattern.lastIndex !== Source.length)
    throw new Error(`fake-dom: unsupported selector ${Source}`);
  return Compound;
}

function parseSelector(Selector) {
  return Selector.split(',').map((Part) => Part.trim().split(/\s+/).map(parseCompound));
}

function isVisible(El) {
  for (let Node = El; Node; Node = Node.parentNode) {
    if (Node.style && Node.style.display === 'none') return false;
  }
  return El.isConnected;
}

function matchesCompound(El, Compound) {
  if (El.nodeType !== 1) return false;
  if (Compound.Tag && El.tagName !== Compound.Tag) return false;
  if (Compound.Id && El.getAttribute('id') !== Compound.Id) return false;
  for (const Name of Compound.Classes) if (!El.classList.contains(Name)) return false;
  for (const [Name, Value] of Compound.Attrs) {
    if (!El.hasAttribute(Name)) return false;
    if (Value !== null && El.getAttribute(Name) !== Value) return false;
  }
  if (Compound.Visible && !isVisible(El)) return false;
  return true;
}

function matchesChain(El, Chain) {
  if (!matchesCompound(El, Chain[Chain.length - 1])) return false;
  let Rest = Chain.slice(0, -1);
  for (let Up = El.parentNode; Up && Rest.length; Up = Up.parentNode) {
    if (matchesCompound(Up, Rest[Rest.length - 1])) Rest = Rest.slice(0, -1);
  }
  return Rest.length === 0;
}

function matches(El, Selector) {
  return parseSelector(Selector).some((Chain) => matchesChain(El, Chain));
}

function descendants(Root) {
  const Out = [];
  const Walk = (Node) => {
    for (const Child of Node.childNodes) {
      if (Child.nodeType !== 1) continue;
      Out.push(Child);
      Walk(Child);
    }
  };
  Walk(Root);
  return Out;
}

// --- Nodes ---------------------------------------------------------------------

function createDom() {
  const Dom = {
    activeElement: null,
    documentListeners: [],
    modalCalls: [],
  };

  class FakeText {
    constructor(Value) {
      this.nodeType = 3;
      this.nodeValue = Value;
      this.parentNode = null;
    }
    get textContent() {
      return this.nodeValue;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
  }

  class FakeElement {
    constructor(Tag) {
      this.nodeType = 1;
      this.tagName = String(Tag).toUpperCase();
      this.childNodes = [];
      this.parentNode = null;
      this.style = {};
      this.attributeMap = new Map();
      this.listeners = [];
      this.jqHandlers = [];
    }
    get id() {
      return this.getAttribute('id') ?? '';
    }
    set id(Value) {
      this.setAttribute('id', Value);
    }
    get className() {
      return this.getAttribute('class') ?? '';
    }
    set className(Value) {
      this.setAttribute('class', Value);
    }
    get classList() {
      const El = this;
      const List = () => El.className.split(/\s+/).filter(Boolean);
      const Save = (Names) => El.setAttribute('class', [...new Set(Names)].join(' '));
      return {
        add: (...Names) => Save([...List(), ...Names]),
        remove: (...Names) => Save(List().filter((Name) => !Names.includes(Name))),
        contains: (Name) => List().includes(Name),
        toggle(Name, Force) {
          const On = Force === undefined ? !this.contains(Name) : Boolean(Force);
          if (On) this.add(Name);
          else this.remove(Name);
          return On;
        },
      };
    }
    getAttribute(Name) {
      return this.attributeMap.has(Name) ? this.attributeMap.get(Name) : null;
    }
    setAttribute(Name, Value) {
      this.attributeMap.set(Name, String(Value));
    }
    hasAttribute(Name) {
      return this.attributeMap.has(Name);
    }
    removeAttribute(Name) {
      this.attributeMap.delete(Name);
    }
    get children() {
      return this.childNodes.filter((Node) => Node.nodeType === 1);
    }
    appendChild(Node) {
      if (Node.parentNode) Node.parentNode.removeChild(Node);
      Node.parentNode = this;
      this.childNodes.push(Node);
      return Node;
    }
    removeChild(Node) {
      const Index = this.childNodes.indexOf(Node);
      if (Index !== -1) this.childNodes.splice(Index, 1);
      Node.parentNode = null;
      return Node;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    get isConnected() {
      let Node = this;
      while (Node.parentNode) Node = Node.parentNode;
      return Node === Dom.body;
    }
    get textContent() {
      return this.childNodes.map((Node) => Node.textContent).join('');
    }
    set textContent(Value) {
      this.childNodes = [];
      const Text = String(Value ?? '');
      if (Text) this.appendChild(new FakeText(Text));
    }
    get innerHTML() {
      return this.childNodes.map(serialize).join('');
    }
    set innerHTML(Html) {
      this.childNodes = [];
      parseInto(this, String(Html ?? ''));
    }
    addEventListener(Type, Listener, Capture) {
      this.listeners.push({ Type, Listener, Capture: Boolean(Capture) });
    }
    removeEventListener(Type, Listener, Capture) {
      this.listeners = this.listeners.filter(
        (L) => !(L.Type === Type && L.Listener === Listener && L.Capture === Boolean(Capture))
      );
    }
    /** Fire a native event at this element's own listeners (no bubbling). */
    dispatch(Type, Props = {}) {
      const Event = { type: Type, target: this, ...Props };
      for (const L of [...this.listeners]) if (L.Type === Type) L.Listener.call(this, Event);
      return Event;
    }
    querySelector(Selector) {
      return descendants(this).find((El) => matches(El, Selector)) ?? null;
    }
    querySelectorAll(Selector) {
      return descendants(this).filter((El) => matches(El, Selector));
    }
    closest(Selector) {
      for (let Node = this; Node && Node.nodeType === 1; Node = Node.parentNode) {
        if (matches(Node, Selector)) return Node;
      }
      return null;
    }
    focus() {
      Dom.activeElement = this;
    }
  }

  function serialize(Node) {
    if (Node.nodeType === 3) return escapeText(Node.nodeValue);
    const Tag = Node.tagName.toLowerCase();
    const Attrs = [...Node.attributeMap]
      .map(([Name, Value]) => ` ${Name}="${Value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
      .join('');
    if (VOID_TAGS.has(Tag)) return `<${Tag}${Attrs}>`;
    return `<${Tag}${Attrs}>${Node.childNodes.map(serialize).join('')}</${Tag}>`;
  }

  // A forgiving parser for the markup the kit writes: tags, attributes, text.
  function parseInto(Parent, Html) {
    const Stack = [Parent];
    const Token =
      /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    let Match;
    while ((Match = Token.exec(Html))) {
      const Top = Stack[Stack.length - 1];
      if (Match[1]) {
        const Tag = Match[1].toUpperCase();
        const At = Stack.map((El) => El.tagName).lastIndexOf(Tag);
        if (At > 0) Stack.length = At;
      } else if (Match[2]) {
        const El = new FakeElement(Match[2]);
        for (const A of Match[3].matchAll(
          /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
        )) {
          El.setAttribute(A[1], decodeEntities(A[2] ?? A[3] ?? A[4] ?? ''));
        }
        Top.appendChild(El);
        if (!Match[4] && !VOID_TAGS.has(Match[2].toLowerCase())) Stack.push(El);
      } else if (Match[5]) {
        Top.appendChild(new FakeText(decodeEntities(Match[5])));
      }
    }
  }

  Dom.FakeElement = FakeElement;
  Dom.body = new FakeElement('body');
  Dom.parseInto = parseInto;
  return Dom;
}

// --- jQuery ----------------------------------------------------------------------

function parseEventName(Name) {
  const [Type, ...Namespaces] = String(Name).split('.');
  return { Type, Namespaces };
}

function createJQuery(Dom, Document) {
  class FakeQuery {
    constructor(Elements) {
      this.elements = Elements.filter(Boolean);
    }
    get length() {
      return this.elements.length;
    }
    get(Index) {
      return this.elements[Index];
    }
    toArray() {
      return [...this.elements];
    }
    eq(Index) {
      return new FakeQuery([this.elements[Index]]);
    }
    each(Fn) {
      this.elements.forEach((El, Index) => Fn.call(El, Index, El));
      return this;
    }
    text(Value) {
      if (Value === undefined) return this.elements.map((El) => El.textContent).join('');
      for (const El of this.elements) El.textContent = Value;
      return this;
    }
    html(Value) {
      if (Value === undefined) return this.elements[0] ? this.elements[0].innerHTML : undefined;
      for (const El of this.elements) El.innerHTML = Value;
      return this;
    }
    attr(Name, Value) {
      if (Value === undefined) return this.elements[0]?.getAttribute(Name) ?? undefined;
      for (const El of this.elements) El.setAttribute(Name, Value);
      return this;
    }
    css(Name, Value) {
      if (Value === undefined) return this.elements[0]?.style[Name];
      for (const El of this.elements) El.style[Name] = Value;
      return this;
    }
    addClass(Names) {
      for (const El of this.elements) El.classList.add(...Names.split(/\s+/).filter(Boolean));
      return this;
    }
    removeClass(Names) {
      for (const El of this.elements) El.classList.remove(...Names.split(/\s+/).filter(Boolean));
      return this;
    }
    toggleClass(Name, State) {
      for (const El of this.elements) El.classList.toggle(Name, State);
      return this;
    }
    hasClass(Name) {
      return this.elements.some((El) => El.classList.contains(Name));
    }
    is(Selector) {
      return this.elements.some((El) => matches(El, Selector));
    }
    find(Selector) {
      return new FakeQuery(this.elements.flatMap((El) => El.querySelectorAll(Selector)));
    }
    empty() {
      for (const El of this.elements) El.childNodes = [];
      return this;
    }
    append(Content) {
      const Target = this.elements[0];
      if (!Target) return this;
      if (typeof Content === 'string') Dom.parseInto(Target, Content);
      else for (const El of $(Content).elements) Target.appendChild(El);
      return this;
    }
    remove() {
      for (const El of this.elements) El.remove();
      return this;
    }
    on(Events, ...Rest) {
      const Handler = Rest[Rest.length - 1];
      for (const Name of String(Events).split(/\s+/).filter(Boolean)) {
        const { Type, Namespaces } = parseEventName(Name);
        for (const El of this.elements)
          El.jqHandlers.push({ Type, Namespaces, Handler, Once: false });
      }
      return this;
    }
    one(Events, Handler) {
      this.on(Events, Handler);
      for (const El of this.elements) {
        const Count = String(Events).split(/\s+/).filter(Boolean).length;
        for (const H of El.jqHandlers.slice(-Count)) H.Once = true;
      }
      return this;
    }
    off(Events) {
      for (const El of this.elements) {
        if (Events === undefined) {
          El.jqHandlers = [];
          continue;
        }
        for (const Name of String(Events).split(/\s+/).filter(Boolean)) {
          const { Type, Namespaces } = parseEventName(Name);
          El.jqHandlers = El.jqHandlers.filter(
            (H) =>
              !((!Type || H.Type === Type) && Namespaces.every((Ns) => H.Namespaces.includes(Ns)))
          );
        }
      }
      return this;
    }
    /** jQuery's trigger: handlers bubble up the tree; 'focus' also moves the focus. */
    trigger(EventOrName, Props = {}) {
      const Spec = typeof EventOrName === 'string' ? { type: EventOrName } : EventOrName;
      const { Type, Namespaces } = parseEventName(Spec.type);
      for (const El of this.elements) {
        if (Type === 'focus') El.focus();
        // A spec may pass its own preventDefault to see whether a handler called it.
        const Event = {
          target: El,
          defaultPrevented: false,
          propagationStopped: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
          stopPropagation() {
            this.propagationStopped = true;
          },
          ...Props,
          ...Spec,
          type: Type,
        };
        for (let Node = El; Node && !Event.propagationStopped; Node = Node.parentNode) {
          for (const H of [...(Node.jqHandlers || [])]) {
            if (H.Type !== Type) continue;
            if (!Namespaces.every((Ns) => H.Namespaces.includes(Ns))) continue;
            if (H.Once) Node.jqHandlers = Node.jqHandlers.filter((Other) => Other !== H);
            H.Handler.call(Node, Event);
          }
        }
      }
      return this;
    }
    /** Bootstrap's jQuery bridge, with the events it fires around showing and hiding. */
    modal(Action) {
      for (const El of this.elements) {
        Dom.modalCalls.push([El.id, Action]);
        const Shown = El.classList.contains('show');
        if (Action === 'show' && !Shown) {
          new FakeQuery([El]).trigger('show.bs.modal');
          El.classList.add('show');
          El.style.display = 'block';
          new FakeQuery([El]).trigger('shown.bs.modal');
        } else if (Action === 'hide' && Shown) {
          new FakeQuery([El]).trigger('hide.bs.modal');
          El.classList.remove('show');
          El.style.display = 'none';
          new FakeQuery([El]).trigger('hidden.bs.modal');
        }
      }
      return this;
    }
  }

  function $(Arg) {
    if (Arg instanceof FakeQuery) return Arg;
    if (Arg === null || Arg === undefined) return new FakeQuery([]);
    if (typeof Arg === 'string') {
      const Source = Arg.trim();
      if (Source.startsWith('<')) {
        const Holder = new Dom.FakeElement('div');
        Dom.parseInto(Holder, Source);
        return new FakeQuery(Holder.children.map((El) => Holder.removeChild(El)));
      }
      return new FakeQuery(Document.querySelectorAll(Source));
    }
    if (Arg === Document) return new FakeQuery([Dom.body]);
    return new FakeQuery([Arg]);
  }
  return $;
}

// --- Install -----------------------------------------------------------------------

function installFakeDom() {
  const Dom = createDom();
  const Document = {
    body: Dom.body,
    get activeElement() {
      return Dom.activeElement && Dom.activeElement.isConnected ? Dom.activeElement : Dom.body;
    },
    createElement: (Tag) => new Dom.FakeElement(Tag),
    getElementById: (Id) =>
      descendants(Dom.body).find((El) => El.getAttribute('id') === Id) ?? null,
    // From <body> down, <body> included (the fake has no <html> or <head>).
    querySelector: (Selector) => Document.querySelectorAll(Selector)[0] ?? null,
    querySelectorAll: (Selector) =>
      [Dom.body, ...descendants(Dom.body)].filter((El) => matches(El, Selector)),
    addEventListener(Type, Listener, Capture) {
      Dom.documentListeners.push({ Type, Listener, Capture: Boolean(Capture) });
    },
    removeEventListener(Type, Listener, Capture) {
      Dom.documentListeners = Dom.documentListeners.filter(
        (L) => !(L.Type === Type && L.Listener === Listener && L.Capture === Boolean(Capture))
      );
    },
  };
  const $ = createJQuery(Dom, Document);

  const Saved = { document: global.document, $: global.$, jQuery: global.jQuery, CSS: global.CSS };
  global.document = Document;
  global.$ = $;
  global.jQuery = $;
  global.CSS = { escape: (Value) => String(Value).replace(/["\\]/g, '\\$&') };

  return {
    document: Document,
    body: Dom.body,
    $,
    /** Every `.modal(action)` call, as [element id, action]. */
    modalCalls: Dom.modalCalls,
    /** Append markup to <body>. */
    add(Html) {
      Dom.parseInto(Dom.body, Html);
    },
    /** A key pressed with the focus anywhere: what `document` listeners see first. */
    keydown(Props) {
      const Event = {
        type: 'keydown',
        target: Document.activeElement,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.propagationStopped = true;
        },
        ...Props,
      };
      for (const L of [...Dom.documentListeners]) {
        if (L.Type === 'keydown') L.Listener(Event);
      }
      return Event;
    },
    /** How many listeners `document` holds for an event type. */
    documentListenerCount(Type) {
      return Dom.documentListeners.filter((L) => L.Type === Type).length;
    },
    restore() {
      for (const [Name, Value] of Object.entries(Saved)) {
        if (Value === undefined) delete global[Name];
        else global[Name] = Value;
      }
    },
  };
}

module.exports = { installFakeDom };
