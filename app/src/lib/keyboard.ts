import { Platform } from 'react-native';

/**
 * Where the message box sits above the bottom of the screen.
 *
 * The box is drawn with `position: absolute; bottom: 0`, and on Android the app runs
 * edge-to-edge (targetSdk 35), so the system no longer shrinks the window for the keyboard:
 * `adjustResize` stops working and `KeyboardAvoidingView`'s padding is applied to its own
 * view, which does not move an absolutely-positioned child. The keyboard then simply draws
 * over the box. So on Android the offset is applied to the box itself.
 *
 * Padding a parent does NOT move an absolute child (verified against Yoga, the layout engine
 * React Native uses), which is why this is the composer's own bottom inset and not a padding.
 *
 * iOS is left to `KeyboardAvoidingView`, which works there; adding this on top would double it.
 */
export const handlesKeyboardOffset = Platform.OS === 'android';

/**
 * The bottom inset for the composer. With the keyboard open the keyboard covers the navigation
 * bar, so its height replaces the inset rather than adding to it.
 */
export function composerBottom(keyboardHeight: number, baseInset: number): number {
  if (!handlesKeyboardOffset) return baseInset;
  if (keyboardHeight > 0) return keyboardHeight;
  return baseInset;
}

/**
 * Extra room for the message list so the newest messages stay clear of the composer once it
 * has moved up. The list is inverted, so its `contentContainerStyle` padding at the top is the
 * gap under the last message.
 */
export function listExtra(keyboardHeight: number): number {
  return handlesKeyboardOffset ? Math.max(0, keyboardHeight) : 0;
}