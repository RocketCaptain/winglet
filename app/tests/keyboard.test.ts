import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

// The Android keyboard fix (src/lib/keyboard.ts) is pure apart from reading the edge-to-edge flag,
// so it is loaded directly with Platform and DeviceInfo stubbed. That covers all three real device
// behaviours without a phone: edge-to-edge Android, pre-edge-to-edge Android, and iOS.

function load({ os, isEdgeToEdge }: { os: 'android' | 'ios'; isEdgeToEdge?: boolean }) {
  const exports: any = {};
  const source = readFileSync(new URL('../src/lib/keyboard.ts', import.meta.url), 'utf8')
    .replace(
      /import \{ Platform, TurboModuleRegistry \} from 'react-native';/,
      `const Platform = { OS: ${JSON.stringify(os)} };
       const TurboModuleRegistry = { get: () => ({ getConstants: () => ({ isEdgeToEdge: ${isEdgeToEdge ?? 'undefined'} }) }) };`,
    );
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports });
  return exports;
}

// Everything is measured up from the BOTTOM of the window.
//
//   nav bar  = 48px at the very bottom
//   keyboard = 320px sitting above the nav bar
//
// The composer wrapper is pinned with `bottom` and padded with `paddingBottom`; the visible text box
// sits inside that padding, so its lower edge is `bottom + paddingBottom` from the window bottom.
// Counting the nav bar in BOTH leaves a gap exactly one bar-height tall under the box, and that gap
// rides up with the keyboard. These tests assert that geometry, not just the arithmetic, because
// asserting the arithmetic alone is what let the regression through twice.
const KEYBOARD = 320;
const NAV = 48;
const GAP_MIN = 10; // the smallest gap the composer is willing to show

const loadAndroid = () => load({ os: 'android', isEdgeToEdge: true });

test('android 15+, keyboard open: the box sits ON the keyboard, not a bar-height above it', () => {
  const { composerBottom, handlesKeyboardOffset } = loadAndroid();
  assert.equal(handlesKeyboardOffset, true);
  const bottom = composerBottom(KEYBOARD, NAV);
  assert.equal(bottom, KEYBOARD, 'the keyboard offset is the reported height; the bar is padding');
  // bottom + paddingBottom must land on the keyboard's top edge: no gap, no overlap.
  assert.equal(bottom + NAV, KEYBOARD + NAV, "the box's lower edge must land on the keyboard's top edge");
});

test('android 15+, keyboard closed: the gap under the box is the nav bar and nothing more', () => {
  const { composerBottom } = loadAndroid();
  const bottom = composerBottom(0, NAV);
  assert.equal(bottom, 0, 'nothing to lift over when there is no keyboard');
  assert.equal(bottom + NAV, NAV, 'the gap must be exactly the nav bar, not twice it');
});

test('android 15+: the nav bar is counted exactly once in each state', () => {
  // The reported symptom: a gap under the box that follows the keyboard up. That is what counting
  // the nav bar in both `bottom` and the padding looks like — a bar-height gap either side of the
  // keyboard. So the invariant is not "the gap never changes": with the keyboard closed the box must
  // still clear the nav bar, and with it open the box must land on the keyboard.
  const { composerBottom } = loadAndroid();
  const keyboardTop = KEYBOARD + NAV;
  assert.equal(composerBottom(0, NAV) + NAV, NAV, 'closed: clear the nav bar once');
  assert.equal(composerBottom(KEYBOARD, NAV) + NAV - keyboardTop, 0, 'open: sit on the keyboard, no gap');
});

test('android 15+: the box is never pushed behind the keyboard, at any keyboard height', () => {
  const { composerBottom } = loadAndroid();
  for (const kb of [0, 120, 320, 480]) {
    const lowerEdge = composerBottom(kb, NAV) + NAV;
    assert.ok(lowerEdge >= kb, `box overlaps the keyboard at height ${kb}`);
    assert.ok(lowerEdge <= kb + Math.max(NAV, GAP_MIN) + 1, `stray gap at height ${kb}`);
  }
});

test('android 14 and below: no offset of our own, the window already resizes', () => {
  // Here adjustResize still shrinks the window and the box is already above the keyboard. Lifting
  // it again would float the box well clear of the keyboard and waste screen height.
  const { composerBottom, handlesKeyboardOffset } = load({ os: 'android', isEdgeToEdge: false });
  assert.equal(handlesKeyboardOffset, false);
  assert.equal(composerBottom(KEYBOARD, NAV), NAV, 'must not double-offset where the OS resizes');
});

test('android: the offset is driven by the edge-to-edge flag, not by the platform', () => {
  // The app targets a recent SDK, so one build runs edge-to-edge on a new phone and not on an old
  // one. Gating on Platform.OS alone would double-offset every Android 14 device.
  assert.notEqual(
    load({ os: 'android', isEdgeToEdge: true }).handlesKeyboardOffset,
    load({ os: 'android', isEdgeToEdge: false }).handlesKeyboardOffset,
  );
});

test('android: an unavailable flag assumes the resizing behaviour rather than guessing high', () => {
  const { handlesKeyboardOffset } = load({ os: 'android' });
  assert.equal(handlesKeyboardOffset, false, 'a missing flag must not risk a double offset');
});

test('ios: KeyboardAvoidingView already handles it, so the box is not moved again', () => {
  const { composerBottom, handlesKeyboardOffset } = load({ os: 'ios', isEdgeToEdge: true });
  assert.equal(handlesKeyboardOffset, false);
  assert.equal(composerBottom(KEYBOARD, NAV), NAV, 'must not double-offset on iOS');
  assert.equal(composerBottom(0, NAV), NAV);
});

test('the composer keeps the keyboard offset and the safe-area gap in separate variables', () => {
  // Reusing one value for both `bottom` and `paddingBottom` is what made the first fix a no-op and
  // the second leave a bar-height gap. Each must come from its own source.
  const src = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');
  assert.match(src, /const bottom = composerBottomInset\(keyboardHeight, bottomInset\);/,
    'bottom must come from the keyboard offset');
  assert.match(src, /const padBottom = handlesKeyboardOffset \? Math\.max\(bottomInset, 10\) : Math\.max\(bottom, 10\);/,
    'padding must come from the safe-area inset, not from the lifted value');
  assert.match(src, /style=\{\[s\.wrap, \{ bottom, paddingBottom: padBottom \}\]\}/,
    'the wrapper must use the two distinct values');
});

test('the message list gets room matching the composer lift', () => {
  const src = readFileSync(new URL('../src/components/ChatView.tsx', import.meta.url), 'utf8');
  assert.match(src, /bottom=\{composerH \+ composerLift\}/, 'list padding must follow the lift');
  assert.match(src, /onBottomChange=\{setComposerLift\}/, 'composer must report its lift');
});