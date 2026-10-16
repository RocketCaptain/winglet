import { Text } from 'react-native';
import { Screen } from '../components/Screen';
import { SectionHeader, Segmented } from '../components/ui';
import { usePrefs, type Prefs } from '../lib/prefs';
import { makeStyles } from '../lib/themeContext';

/** How finished work and pending questions/results show in chat. Changes apply at once. */
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
        Working steps stay hidden while your agent is busy.
        {prefs.activity === 'full' ? ' Afterwards, tap the steps summary to read everything it did. Every pending question and result appears in the chat.'
          : prefs.activity === 'one' ? ' Afterwards, only the latest working step appears. Only the newest pending question or result appears at a time; it replaces the previous one.'
            : ' Working summaries and pending questions and results are hidden. Choose All to read the working steps later.'}
        {' Answered and expired cards stay in the chat. Approval requests always appear, whatever this is set to.'}
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  note: { ...t.type.caption, fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textSecondary, marginTop: 10, lineHeight: 18 },
}));
