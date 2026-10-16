import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { handlesKeyboardOffset } from './keyboard';

/** Edge-to-edge windows need room for the keyboard; older Android and iOS already resize. */
export function useKeyboardOffset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!handlesKeyboardOffset) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    // A sheet can open while another input already has the keyboard up.
    setHeight(Keyboard.metrics()?.height ?? 0);
    return () => { show.remove(); hide.remove(); };
  }, []);
  return Math.max(0, height);
}
