import { Platform, TurboModuleRegistry } from 'react-native';

/**
 * Whether this Android build needs the app to keep the message box clear of the keyboard itself.
 *
 * From Android 15 (API 35) an app targeting that SDK runs edge-to-edge and the system no longer
 * shrinks the window for the keyboard: `adjustResize` stops having any effect and the keyboard is
 * simply drawn over the app. The chat's `KeyboardAvoidingView` only pads on iOS, so on Android 15+
 * nothing moved the box and the keyboard landed on it.
 *
 * On Android 14 and below the window still resizes, so the box is already above the keyboard and
 * applying our own offset would lift it twice. That is why this is the runtime edge-to-edge flag
 * rather than a Platform check: the app targets a recent SDK, so the answer depends on the phone,
 * not on which platform the code is running for.
 *
 * iOS is false because `KeyboardAvoidingView` already works there; adding this on top would
 * double-offset it.
 */
function detectEdgeToEdge(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    const deviceInfo = TurboModuleRegistry.get('DeviceInfo') as { getConstants?: () => { isEdgeToEdge?: boolean } } | null;
    return deviceInfo?.getConstants?.().isEdgeToEdge ?? false;
  } catch {
    // No flag available: assume the older, resizing behaviour so we don't double-offset.
    return false;
  }
}

export const handlesKeyboardOffset = detectEdgeToEdge();

/**
 * The bottom inset for the composer.
 *
 * Two things stack below the box, and each belongs in exactly one place:
 *
 *   - The navigation bar. The window is drawn edge-to-edge behind it, so the box must clear it with
 *     `paddingBottom` (a visible gap). It is deliberately NOT part of `bottom`.
 *   - The keyboard, which sits above the navigation bar. React Native reports its height excluding
 *     the bar (`imeInsets.bottom - barInsets.bottom`), so the reported value is used as-is.
 *
 * Putting the navigation bar in both `bottom` and the padding leaves a gap one bar-height tall under
 * the box, which follows the keyboard up. Each inset is counted once and only once.
 */
export function composerBottom(keyboardHeight: number, baseInset: number): number {
  if (!handlesKeyboardOffset) return baseInset;
  return Math.max(0, keyboardHeight);
}

/**
 * Extra room for the message list so the newest messages stay clear of the composer once it
 * has moved up. The list is inverted, so its `contentContainerStyle` padding at the top is the
 * gap under the last message.
 */
export function listExtra(keyboardHeight: number): number {
  return handlesKeyboardOffset ? Math.max(0, keyboardHeight) : 0;
}