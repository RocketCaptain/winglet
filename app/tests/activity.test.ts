import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as messagesLib from '../src/lib/messages.ts';
import type { InboxItem, Message } from '../src/lib/types.ts';

const any: any = new Proxy(function () {}, {
  get: (_t, key) => key === Symbol.toPrimitive ? () => 0 : key === 'then' ? undefined : any,
  apply: () => any,
});
const message = (id: string, role: Message['role'] = 'bot', activity = false): Message => ({
  id, chat_id: 'general', role, text: id, status: 'final', meta: activity ? { activity: true } : {},
  created_at: 1, updated_at: 1,
});
const steps = [message('Reading files', 'bot', true), message('Running tests', 'bot', true)];

// Render the real list and row with native dependencies stubbed, like the other UI tests.
function load(mode: 'full' | 'one' | 'off', os: 'android' | 'ios') {
  let cursor = 0;
  let slots: any[] = [];
  const states = new Map<string, any[]>();
  let inbox: Record<string, InboxItem> = {};
  const slot = (initial: any) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return index;
  };
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    react: {
      memo: (fn: any) => fn, useCallback: (fn: any) => fn,
      useMemo: (fn: any, deps: any[]) => {
        const index = slot(undefined);
        if (!slots[index] || !deps.every((dep, i) => Object.is(dep, slots[index].deps[i]))) {
          slots[index] = { deps, value: fn() };
        }
        return slots[index].value;
      },
      useEffect: () => undefined,
      useRef: (value: any) => slots[slot({ current: value })],
      useState: (value: any) => {
        const index = slot(value);
        const state = slots;
        return [state[index], (next: any) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', Text: 'Text', FlatList: 'FlatList', Platform: { OS: os } },
    '../lib/messages': messagesLib,
    '../lib/prefs': { usePrefs: (select: any) => select({ prefs: { activity: mode, layout: 'bubbles' } }) },
    '../lib/store': { useApp: (select: any) => select({ runtime: { server: { inbox, messages: {} } } }) },
    '../lib/history': { newPaging: () => ({}), atStart: () => true },
    '../lib/themeContext': { makeStyles: () => () => any, useTheme: () => any },
    './ui': { Tap: 'Tap' },
  };
  const exports: any = {};
  const source = readFileSync(new URL('../src/components/ChatView.tsx', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(`${source}\nexport { ActivityRow, MessageList };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: (name: string) => modules[name] ?? any });
  const render = (name: string, props: any) => {
    cursor = 0;
    if (!states.has(name)) states.set(name, []);
    slots = states.get(name)!;
    return exports[name](props);
  };
  const list = (messages: Message[], typing: boolean) => find(render('MessageList', {
    server: { id: 'server', bot: { title: 'Agent' } }, chatId: 'general', messages, typing,
    loaded: true, top: 0, bottom: 0, focus: null, offline: false,
  }), 'FlatList')!;
  return { render, list, setMode: (value: typeof mode) => { mode = value; },
    setInbox: (value: typeof inbox) => { inbox = value; } };
}

function nodes(tree: any): any[] {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree: any, type: string) => nodes(tree).find((node) => node?.type === type);
const text = (tree: any) => nodes(tree).filter((node) => typeof node === 'string').join(' ');
const activityRows = (list: any) => list.props.data.filter((row: any) => row.kind === 'activity');
const rowProps = (list: any, row = activityRows(list)[0]) => list.props.renderItem({ item: row }).props;

for (const os of ['android', 'ios'] as const) {
  for (const mode of ['full', 'one'] as const) {
    test(`${os} ${mode}: no step text mid-turn; completion retains every step and shows the selected summary`, () => {
      const ui = load(mode, os);
      const input = [message('ask', 'user'), ...steps];
      let list = ui.list(input.slice(0, 2), true);
      const key = activityRows(list)[0].key;
      let row = ui.render('ActivityRow', rowProps(list));
      assert.equal(text(row), 'Working');
      assert.equal(find(row, 'Tap').props.disabled, true);
      list = ui.list(input, true);
      assert.equal(activityRows(list)[0].key, key);
      row = ui.render('ActivityRow', rowProps(list));
      assert.equal(text(row), 'Working');
      list = ui.list(input, false);
      assert.deepEqual(Array.from(activityRows(list)[0].items), steps);
      row = ui.render('ActivityRow', rowProps(list));
      assert.equal(text(row), mode === 'one' ? steps[1].text : '2 steps');
      if (mode === 'full') {
        find(row, 'Tap').props.onPress();
        row = ui.render('ActivityRow', rowProps(list));
        for (const step of steps) assert.ok(text(row).includes(step.text));
        // An already-expanded row must also hide its steps when work resumes.
        row = ui.render('ActivityRow', rowProps(ui.list(input, true)));
        assert.equal(text(row), 'Working');
      }
      assert.deepEqual(input, [message('ask', 'user'), ...steps]);
    });

    test(`${os} ${mode}: cards and separate activity runs cannot expose steps before the turn ends`, () => {
      const ui = load(mode, os);
      const card = { ...message('approval', 'system'), meta: { inbox_id: 'not-loaded' } };
      const list = ui.list([message('ask', 'user'), steps[0], card, steps[1]], true);
      assert.equal(activityRows(list).length, 2);
      for (const entry of activityRows(list)) {
        assert.equal(text(ui.render('ActivityRow', rowProps(list, entry))), 'Working');
      }
    });
  }

  test(`${os} off: no progress row during or after work; grouping still retains the record`, () => {
    const ui = load('off', os);
    for (const typing of [true, false]) {
      const list = ui.list([message('ask', 'user'), ...steps], typing);
      assert.equal(activityRows(list).length, 0);
      assert.equal(list.props.ListHeaderComponent, null);
      assert.deepEqual(messagesLib.groupActivity(steps, typing), [
        { kind: 'activity', id: steps[0].id, items: steps },
      ]);
    }
  });

  test(`${os}: changing the setting updates cards and progress immediately, without losing history`, () => {
    const ui = load('full', os);
    const items = (['question', 'result', 'approval'] as const).map((kind): InboxItem => ({
      id: kind, kind, chat_id: 'general', title: kind, body: kind, payload: {}, status: 'pending',
      resolution: '', created_at: 1, updated_at: 1,
    }));
    const inbox = Object.fromEntries(items.map((item) => [item.id, item]));
    ui.setInbox(inbox);
    const input = [message('ask', 'user'), ...steps, ...items.map((item) => ({
      ...message(item.id, 'system'), meta: { inbox_id: item.id },
    }))];
    const ids = (list: any) => Array.from(list.props.data)
      .filter((row: any) => row.kind === 'msg').map((row: any) => row.m.id);
    assert.deepEqual(ids(ui.list(input, false)), ['approval', 'result', 'question', 'ask']);
    ui.setMode('one');
    let list = ui.list(input, false);
    assert.deepEqual(ids(list), ['approval', 'result', 'ask']);
    assert.equal(text(ui.render('ActivityRow', rowProps(list))), steps[1].text);
    ui.setMode('off');
    list = ui.list(input, false);
    assert.deepEqual(ids(list), ['approval', 'ask']);
    assert.equal(activityRows(list).length, 0);
    // Answering a hidden card changes only its inbox data, not the transcript.
    ui.setInbox({ ...inbox, question: { ...inbox.question, status: 'resolved' } });
    assert.deepEqual(ids(ui.list(input, false)), ['approval', 'question', 'ask']);
    ui.setMode('full');
    list = ui.list(input, false);
    const props = rowProps(list);
    let row = ui.render('ActivityRow', props);
    find(row, 'Tap').props.onPress();
    row = ui.render('ActivityRow', props);
    for (const step of steps) assert.ok(text(row).includes(step.text));
  });

  test(`${os}: earlier turns stay readable while the current turn works`, () => {
    const ui = load('full', os);
    const list = ui.list([steps[0], message('old reply'), message('ask', 'user'), steps[1]], true);
    const older = activityRows(list).find((row: any) => row.items[0].id === steps[0].id);
    const row = ui.render('ActivityRow', rowProps(list, older));
    assert.equal(text(row), '1 step');
    find(row, 'Tap').props.onPress();
    assert.ok(text(ui.render('ActivityRow', rowProps(list, older))).includes(steps[0].text));
  });
}
