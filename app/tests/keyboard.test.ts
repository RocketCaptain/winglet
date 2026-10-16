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

// A 320px keyboard on a screen with a 48px navigation bar. RN reports the keyboard as 320 (it
// subtracts the bar), so the box must clear 320 + 48 = 368 from the bottom of the window.
const KEYBOARD = 320;
const NAV = 48;
const SCREEN = 800;
const BOX = 60;
const keyboardTop = SCREEN - (KEYBOARD + NAV);

test('android 15+: the box clears both the keyboard and the navigation bar under it', () => {
  const { composerBottom, handlesKeyboardOffset } = load({ os: 'android', isEdgeToEdge: true });
  assert.equal(handlesKeyboardOffset, true);
  const bottom = composerBottom(KEYBOARD, NAV);
  assert.equal(bottom, KEYBOARD + NAV, 'RN reports the keyboard without the nav bar, so add it back');
  assert.ok(SCREEN - bottom - BOX <= keyboardTop, 'the box must sit entirely above the keyboard');
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

test('android: no keyboard means the ordinary safe-area inset, applied once', () => {
  const { composerBottom } = load({ os: 'android', isEdgeToEdge: true });
  assert.equal(composerBottom(0, NAV), NAV);
  assert.equal(composerBottom(0, 0), 0);
});

test('ios: KeyboardAvoidingView already handles it, so the box is not moved again', () => {
  const { composerBottom, handlesKeyboardOffset } = load({ os: 'ios', isEdgeToEdge: true });
  assert.equal(handlesKeyboardOffset, false);
  assert.equal(composerBottom(KEYBOARD, NAV), NAV, 'must not double-offset on iOS');
  assert.equal(composerBottom(0, NAV), NAV);
});

test('the composer lifts the box with `bottom` and keeps padding at the safe-area gap', () => {
  // Padding a parent does not move an absolute child (verified against Yoga), so the offset has to
  // be `bottom` on the composer itself. The two must not be the same value: reusing the lifted
  // value as padding pushes the box back down by exactly what it moved up, so the keyboard covers
  // it again. That regression shipped once; this test exists to keep it dead.
  const src = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');
  assert.match(src, /style=\{\[s\.wrap, \{ bottom, paddingBottom: Math\.max\(bottomInset, 10\) \}\]\}/,
    'bottom must be the keyboard offset while padding stays at the safe-area gap');
});

test('the message list gets room matching the composer lift', () => {
  const src = readFileSync(new URL('../src/components/ChatView.tsx', import.meta.url), 'utf8');
  assert.match(src, /bottom=\{composerH \+ composerLift\}/, 'list padding must follow the lift');
  assert.match(src, /onBottomChange=\{setComposerLift\}/, 'composer must report its lift');
});