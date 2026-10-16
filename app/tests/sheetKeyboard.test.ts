import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const KEYBOARD = 320;
const NAV = 48;
const any: any = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : key === 'then' ? undefined : any),
  apply: () => any,
});

// Render the real sheet and keyboard hook with native modules stubbed, including effect cleanup.
function load({ os = 'android', isEdgeToEdge = true, width = 400, keyboard = 0 }:
  { os?: 'android' | 'ios' | 'web'; isEdgeToEdge?: boolean; width?: number; keyboard?: number } = {}) {
  let cursor = 0;
  let dirty = false;
  const slots: any[] = [];
  const pending: (() => void)[] = [];
  const listeners = new Map<string, Set<(event: any) => void>>();
  let drag: (event: any) => void = () => undefined;
  const react = {
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value: any) => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef: (value: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: value };
      return slots[index];
    },
    useEffect: (effect: () => any, deps: any[]) => {
      const index = cursor++;
      if (slots[index]?.deps.every((v: any, i: number) => Object.is(v, deps[i]))) return;
      pending.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': {
      ...Object.fromEntries(['Modal', 'Pressable', 'Text', 'View', 'ScrollView', 'KeyboardAvoidingView'].map((n) => [n, n])),
      Platform: { OS: os }, StyleSheet: { absoluteFill: {} }, useWindowDimensions: () => ({ width, height: 800 }),
      TurboModuleRegistry: { get: () => ({ getConstants: () => ({ isEdgeToEdge }) }) },
      Keyboard: {
        metrics: () => keyboard ? { height: keyboard } : undefined,
        addListener: (name: string, callback: (event: any) => void) => {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name)!.add(callback);
          return { remove: () => listeners.get(name)!.delete(callback) };
        },
      },
    },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'Animated.View' },
      FadeInDown: any, ZoomIn: any,
      useSharedValue: (value: any) => react.useRef({ value }).current,
      useAnimatedStyle: (style: () => any) => style(), runOnJS: (fn: any) => fn,
      withSpring: (value: any) => value, withTiming: (value: any) => value,
    },
    'react-native-gesture-handler': {
      GestureHandlerRootView: 'GestureHandlerRootView', GestureDetector: 'GestureDetector',
      Gesture: { Pan: () => {
        const pan = { activeOffsetY: () => pan, onUpdate: (callback: any) => { drag = callback; return pan; }, onEnd: () => pan };
        return pan;
      } },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: NAV }) },
    'expo-router': { router: any, useLocalSearchParams: () => ({}) },
    '../lib/appLock': { useLock: (select: any) => select({ locked: false }) },
    '../lib/themeContext': { makeStyles: (styles: any) => () => styles(any), useTheme: () => any },
    '../lib/store': { useApp: (select: any) => select({ servers: [] }) },
    '../lib/api': { defaultDeviceName: () => 'Phone' },
    '../lib/push': { isIOS: () => os === 'ios', isStandalone: () => true },
    './Glass': { Glass: 'Glass' },
  };
  const evaluate = (file: string) => {
    const exports: any = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, { exports, require: (name: string) => modules[name] ?? any });
    return exports;
  };
  modules['./keyboard'] = evaluate('lib/keyboard.ts');
  modules['../lib/useKeyboardOffset'] = evaluate('lib/useKeyboardOffset.ts');
  const components = {
    sheet: () => evaluate('components/Sheet.tsx').Sheet({ visible: true, onClose: () => undefined, children: 'input' }),
    pair: () => evaluate('app/pair.tsx').default(),
    screen: () => evaluate('components/Screen.tsx').Screen({ title: 'Form', children: 'input' }),
  };
  return {
    render: (name: keyof typeof components = 'sheet') => {
      let out: any;
      do {
        dirty = false;
        cursor = 0;
        out = components[name]();
        pending.splice(0).forEach((effect) => effect());
      } while (dirty);
      return out;
    },
    emit: (name: string, height = 0) => {
      keyboard = height;
      listeners.get(name)?.forEach((callback) => callback({ endCoordinates: { height } }));
    },
    listenerCount: () => [...listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0),
    drag: (translationY: number) => drag({ translationY }),
    unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
}

function find(node: any, type: string): any {
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === type) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = find(child, type);
    if (hit) return hit;
  }
}

const style = (node: any) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
const geometry = (out: any) => {
  const glass = find(out, 'Glass');
  const host = find(out, 'View');
  return { panel: style(host.props.children.props.children), padding: style(glass).paddingBottom };
};

test('android 15+: sheets use the reported height once, independently of padding and drag animation', () => {
  const app = load();
  app.render();
  app.drag(36);
  const closed = geometry(app.render());
  assert.equal(closed.panel.bottom, 0);
  assert.equal(closed.padding, NAV + 16);
  for (const height of [120, KEYBOARD, 480]) {
    app.emit('keyboardDidShow', height);
    const open = geometry(app.render());
    assert.equal(open.panel.bottom, height, 'the reported height already excludes the navigation bar');
    assert.equal(open.padding, NAV + 16, 'the keyboard must not also go into padding');
    assert.equal(open.panel.bottom + open.padding, height + NAV + 16, 'clear the keyboard and bar with the original content gap');
    assert.equal(JSON.stringify(open.panel.transform), JSON.stringify(closed.panel.transform), 'keyboard events must leave the drag translation alone');
  }
  app.emit('keyboardDidHide');
  assert.equal(geometry(app.render()).panel.bottom, 0, 'closing the keyboard must remove the lift');
});

for (const [label, options] of [
  ['android 14 and below', { isEdgeToEdge: false }],
  ['ios', { os: 'ios' as const }],
  ['web', { os: 'web' as const }],
] as const) {
  test(`${label}: sheets keep their existing geometry and do not subscribe to Android offsets`, () => {
    const app = load(options);
    const closed = geometry(app.render());
    app.emit('keyboardDidShow', KEYBOARD);
    const open = geometry(app.render());
    assert.equal(open.panel.bottom, 0);
    assert.equal(open.padding, closed.padding);
    assert.equal(app.listenerCount(), 0);
  });
}

test('wide sheets stay centred when the keyboard opens, including the 700px boundary', () => {
  for (const width of [699, 700, 1000]) {
    const app = load({ width });
    app.render();
    app.emit('keyboardDidShow', KEYBOARD);
    const open = geometry(app.render());
    assert.equal(open.panel.bottom, width < 700 ? KEYBOARD : 0);
    assert.equal(open.padding, width < 700 ? NAV + 16 : 20);
  }
});

test('sheets opened over an existing keyboard start lifted and remove both listeners on unmount', () => {
  const app = load({ keyboard: KEYBOARD });
  assert.equal(geometry(app.render()).panel.bottom, KEYBOARD);
  assert.equal(app.listenerCount(), 2);
  app.unmount();
  assert.equal(app.listenerCount(), 0);
});

for (const name of ['pair', 'screen'] as const) {
  test(`${name}: shrink the scroll viewport once on edge-to-edge Android, keeping content padding`, () => {
    for (const options of [{}, { isEdgeToEdge: false }, { os: 'ios' as const }]) {
      const app = load(options);
      const closed = app.render(name);
      const scroll = find(closed, 'ScrollView');
      const padding = JSON.stringify(scroll.props.contentContainerStyle);
      assert.equal(style(scroll).marginBottom, 0);
      app.emit('keyboardDidShow', KEYBOARD);
      const open = app.render(name);
      assert.equal(style(find(open, 'ScrollView')).marginBottom, options.os === 'ios' || options.isEdgeToEdge === false ? 0 : KEYBOARD);
      assert.equal(JSON.stringify(find(open, 'ScrollView').props.contentContainerStyle), padding);
      if (name === 'pair') assert.equal(open.props.behavior, options.os === 'ios' ? 'padding' : undefined);
      app.emit('keyboardDidHide');
      assert.equal(style(find(app.render(name), 'ScrollView')).marginBottom, 0);
      app.unmount();
      assert.equal(app.listenerCount(), 0);
    }
  });
}

test('inline Inbox answers on Home and Inbox get room in their own scroll viewport', () => {
  for (const [file, list] of [['app/(tabs)/index.tsx', 'ScrollView'], ['components/InboxView.tsx', 'FlatList']]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /const keyboardHeight = useKeyboardOffset\(\);/);
    assert.match(source, new RegExp(`<${list}\\s+style=\\{\\{ marginBottom: keyboardHeight \\}\\}`));
  }
});
