import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

// The Android keyboard fix (src/lib/keyboard.ts) is pure, so it can be tested directly. Platform is
// stubbed so the test can cover both branches without a device.

function loadPlatform(os: 'android' | 'ios') {
  const exports: any = {};
  const source = readFileSync(new URL('../src/lib/keyboard.ts', import.meta.url), 'utf8')
    .replace(/import \{ Platform \} from 'react-native';/, `const Platform = { OS: ${JSON.stringify(os)} };`);
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Platform: { OS: os } });
  return exports;
}

test('android: the box lifts by the keyboard height, so it clears the keyboard', () => {
  const { composerBottom } = loadPlatform('android');
  // Keyboard covers the bottom 320px: the box must sit 320px up, not at the screen bottom.
  assert.equal(composerBottom(320, 0), 320);
  assert.equal(composerBottom(320, 48), 320, 'the keyboard covers the nav bar, so it replaces the inset');
});

test('android: no keyboard means the ordinary safe-area inset', () => {
  const { composerBottom } = loadPlatform('android');
  assert.equal(composerBottom(0, 48), 48);
  assert.equal(composerBottom(0, 0), 0);
});

test('ios: KeyboardAvoidingView already handles it, so the box is not moved again', () => {
  const { composerBottom, handlesKeyboardOffset } = loadPlatform('ios');
  assert.equal(handlesKeyboardOffset, false);
  assert.equal(composerBottom(320, 48), 48, 'must not double-offset on iOS');
  assert.equal(composerBottom(0, 48), 48);
});

test('the composer applies the offset to its own bottom, not as padding on the parent', () => {
  // Padding an absolutely-positioned child's parent does not move the child (verified against
  // Yoga), so the fix has to set `bottom` on the composer itself or it silently does nothing.
  const src = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');
  assert.match(src, /style=\{\[s\.wrap, \{ bottom,/, 'composer must set its own bottom');
});

test('the message list gets room matching the composer lift', () => {
  const src = readFileSync(new URL('../src/components/ChatView.tsx', import.meta.url), 'utf8');
  assert.match(src, /bottom=\{composerH \+ composerLift\}/, 'list padding must follow the lift');
  assert.match(src, /onBottomChange=\{setComposerLift\}/, 'composer must report its lift');
});