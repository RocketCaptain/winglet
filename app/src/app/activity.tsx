import { Text } from 'react-native';
import { Screen } from '../components/Screen';
import { SectionHeader, Segmented } from '../components/ui';
import { usePrefs, type Prefs } from '../lib/prefs';
import { makeStyles } from '../lib/themeContext';

/** Which pending questions and results show in the chat. Every change applies at once. */
export default function ActivityScreen() {
  const s = useStyles();
  const prefs = usePrefs((st) => st.prefs);
  const update = usePrefs((st) => st.update);
  const set = <K extends keyof Prefs>(key: K) => (value: Prefs[K]) => update({ [key]: value } as Partial<Prefs>);

  return (
    <Screen title="Chat activity" subtitle="Changes apply straight away and stay on this device.">
      <SectionHeader title="Questions and results" />
      <Segmented label="Chat activity" value={prefs.activity} onChange={set('activity')} options={[
        { value: 'full', label: 'All' },
        { value: 'one', label: 'Latest only' },
        { value: 'off', label: 'Hidden' },
      ]} />
      <Text style={s.note}>
        {prefs.activity === 'full' ? 'Every question and result the agent posts shows in the chat.'
          : prefs.activity === 'one' ? 'Only the latest unanswered question shows at a time. Pending results share that slot.'
            : 'Questions and results are kept out of the chat.'}
        {' Answered and expired cards stay in the chat. Approval requests always appear, whatever this is set to.'}
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...t.type.caption, fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textSecondary, marginTop: 10, lineHeight: 18 },
}));
