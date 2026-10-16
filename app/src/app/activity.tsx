import { Text } from 'react-native';
import { Screen } from '../components/Screen';
import { ListGroup, ListRow, SectionHeader, Segmented } from '../components/ui';
import { usePrefs, type Prefs } from '../lib/prefs';
import { makeStyles } from '../lib/themeContext';

/** How much of the agent's background work shows in the chat. Every change applies at once. */
export default function ActivityScreen() {
  const s = useStyles();
  const prefs = usePrefs((st) => st.prefs);
  const update = usePrefs((st) => st.update);
  const set = <K extends keyof Prefs>(key: K) => (value: Prefs[K]) => update({ [key]: value } as Partial<Prefs>);

  return (
    <Screen title="Chat activity" subtitle="Changes apply straight away and stay on this device.">
      <SectionHeader title="Background work" />
      <Segmented label="Chat activity" value={prefs.activity} onChange={set('activity')} options={[
        { value: 'full', label: 'All steps' },
        { value: 'one', label: 'Latest only' },
        { value: 'off', label: 'Hidden' },
      ]} />
      <Text style={s.note}>
        {prefs.activity === 'full' ? 'Background steps are grouped in a collapsed row. Tap to see them all.'
          : prefs.activity === 'one' ? 'Only the latest background step is shown, updating as your agent works.'
            : 'Background activity is hidden from the chat.'}
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...t.type.caption, fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textSecondary, marginTop: 10, lineHeight: 18 },
}));
