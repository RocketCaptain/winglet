import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityKind, chatMessages, filterInboxMessages, groupActivity, inSheet, isActivity, markFailed, mergeMessages } from '../src/lib/messages.ts';
import type { InboxItem, Message } from '../src/lib/types.ts';

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id, chat_id: 'general', role: 'bot', text: id, status: 'final', meta: {}, created_at: 1, updated_at: 1, ...over,
});

test('a stale history snapshot does not erase a newer live reply', () => {
  const live = [msg('a'), msg('b', { created_at: 5, updated_at: 5 })];
  const snapshot = [msg('a')]; // taken before "b" arrived over the socket
  assert.deepEqual(mergeMessages(live, snapshot).map((m) => m.id), ['a', 'b']);
});

test('the most recently updated copy of a streaming message wins', () => {
  const live = [msg('a', { text: 'Hello world', status: 'final', updated_at: 9 })];
  const snapshot = [msg('a', { text: 'Hel', status: 'streaming', updated_at: 3 })];
  assert.equal(mergeMessages(live, snapshot)[0].text, 'Hello world');
});

test('older pages stay loaded when the latest page is reloaded', () => {
  const current = [msg('old', { created_at: 0 }), msg('a')];
  assert.deepEqual(mergeMessages(current, [msg('a')]).map((m) => m.id), ['old', 'a']);
});

test('confirmed sends replace their optimistic row', () => {
  const optimistic = msg('c-1', { role: 'user', status: 'pending', meta: { client_id: 'c-1' } });
  const server = msg('srv1', { role: 'user', meta: { client_id: 'c-1' } });
  assert.deepEqual(mergeMessages([optimistic], [server]).map((m) => m.id), ['srv1']);
});

test('a send the server already confirmed is never marked failed', () => {
  const confirmed = [msg('srv1', { role: 'user', meta: { client_id: 'c-1' } })];
  assert.equal(markFailed(confirmed, 'c-1')[0].status, 'final');
  const pending = [msg('c-1', { role: 'user', status: 'pending', meta: { client_id: 'c-1' } })];
  assert.equal(markFailed(pending, 'c-1')[0].status, 'failed');
});

test('server positions order equal-timestamp pages and optimistic rows stay last', () => {
  const current = [msg('later', { position: 3 }), msg('c-1', { role: 'user', status: 'pending', created_at: 0 })];
  const incoming = [msg('oldest', { position: 1 }), msg('middle', { position: 2 })];
  assert.deepEqual(mergeMessages(current, incoming).map(m => m.id), ['oldest', 'middle', 'later', 'c-1']);
});

test('older servers still keep older equal-timestamp pages before the current page', () => {
  assert.deepEqual(mergeMessages([msg('later')], [msg('earlier')], [], true).map(m => m.id), ['earlier', 'later']);
});

test('durable deletion removes cached older history without erasing a newer live reply', () => {
  const current = [msg('deleted', { position: 1 }), msg('older', { position: 2 }), msg('live', { position: 4 })];
  const snapshot = [msg('latest', { position: 3 })];
  assert.deepEqual(mergeMessages(current, snapshot, ['deleted']).map(m => m.id), ['older', 'latest', 'live']);
});

test('a stale history response cannot resurrect a live deletion', () => {
  assert.deepEqual(mergeMessages([], [msg('deleted')], ['deleted']), []);
});

test('a merge keeps the same objects for messages that did not change, so their rows do not re-render', () => {
  const a = msg('a', { position: 1 });
  const b = msg('b', { position: 2 });
  const merged = mergeMessages([a, b], [msg('b', { position: 2, text: 'b!', updated_at: 2 })]);
  assert.equal(merged[0], a);
  assert.notEqual(merged[1], b);
  // A copy without a position still gets the one it had.
  const relabeled = mergeMessages([a], [msg('a', { updated_at: 2 })]);
  assert.equal(relabeled[0].position, 1);
});

const say = (id: string, text: string, over: Partial<Message> = {}) => msg(id, { text, ...over });

test("Hermes's tool progress is activity, and so is a status note it keeps updating", () => {
  assert.ok(isActivity(say('a', '🔍 web_search: "cats in space"')));
  assert.ok(isActivity(say('b', '📖 read_file: "notes.md"\n💻 terminal: "ls -la"\n⚡ skill_view...')));
  assert.ok(isActivity(say('c', '🧰 make_bot')));
  assert.ok(isActivity(say('d', 'Context is 80% full', { role: 'system', meta: { status_key: 'ctx' } })));
  assert.ok(isActivity(say('e', 'anything', { meta: { activity: true } })));
});

test('a real reply is never folded away, even one that looks a little like progress', () => {
  assert.ok(!isActivity(say('a', 'Here is what I found.')));
  assert.ok(!isActivity(say('b', '🎉 done')));
  assert.ok(!isActivity(say('c', '✅ Deployed to staging')));
  assert.ok(!isActivity(say('d', '🔍 web_search: "cats"\nThe results show three breeds.')));
  assert.ok(!isActivity(say('e', '🔍 web_search: "cats"', { role: 'user' })));
  assert.ok(!isActivity(say('f', '🔍 web_search: "cats"', { meta: { reply_to: { id: 'x', role: 'user', text: 'hi' } } })));
  assert.ok(!isActivity(say('g', 'Wants to run a command', { role: 'system', meta: { inbox_id: 'i1' } })));
  assert.ok(!isActivity(say('h', 'Only an owner can use that.', { role: 'system' })));
  assert.ok(!isActivity(say('i', 'x', { meta: { activity: true, picker: { id: 'p', kind: 'model', status: 'open', expires_at: 1 } } })));
});

test('runs of activity fold into one entry between the replies', () => {
  const list = [
    say('u', 'find cats', { role: 'user' }),
    say('p1', '🔍 web_search: "cats"'), say('p2', '📖 read_file: "a.md"'),
    say('r', 'Found three.'),
    say('p3', '💻 terminal: "ls"'),
  ];
  const out = groupActivity(list);
  assert.deepEqual(out.map((e) => (e.kind === 'msg' ? e.m.id : `${e.id}+${e.items.length}`)), ['u', 'p1+2', 'r', 'p3+1']);
  assert.equal(groupActivity([]).length, 0);
});

test('grouping preserves ambiguous answers and streaming replies', () => {
  const u = say('u', 'what should I read?', { role: 'user' });
  const friendly = say('p', '📖 Reading skill pdf');
  const streaming = say('r', '📖 Reading list for this week', { status: 'streaming' });
  const system = say('s', 'Only an owner can use that.', { role: 'system' });
  const list = [u, streaming, system, friendly];
  assert.deepEqual(groupActivity(list), list.map((m) => ({ kind: 'msg', m })));
  assert.deepEqual(groupActivity(list, true), [
    { kind: 'msg', m: u }, { kind: 'msg', m: streaming }, { kind: 'msg', m: system },
    { kind: 'activity', id: 'p', items: [friendly] },
  ]);
});

const card = (id: string, kind: InboxItem['kind'], over: Partial<InboxItem> = {}): InboxItem => ({
  id, kind, chat_id: 'general', title: id, body: id, payload: {}, status: 'pending', resolution: '',
  created_at: 1, updated_at: 1, ...over,
});
const cardMessage = (item: InboxItem) => msg(`message-${item.id}`, {
  role: 'system', meta: { inbox_id: item.id },
});
const inboxOf = (items: InboxItem[]) => Object.fromEntries(items.map((item) => [item.id, item]));
const cardIds = (messages: Message[]) => messages.map((m) => m.meta.inbox_id);

for (const mode of ['full', 'one', 'off'] as const) {
  test(`approval cards always appear in ${mode}, alongside pending questions and results`, () => {
    // Both sides of the shared slot: approvals neither take it nor get displaced by it.
    const items = [card('a1', 'approval'), card('q', 'question'), card('r', 'result'), card('a2', 'approval')];
    const visible = filterInboxMessages(items.map(cardMessage), inboxOf(items), mode);
    assert.deepEqual(cardIds(visible), mode === 'full' ? ['a1', 'q', 'r', 'a2']
      : mode === 'one' ? ['a1', 'r', 'a2'] : ['a1', 'a2']);
  });

  for (const kind of ['question', 'result'] as const) {
    test(`${mode} shows the expected pending ${kind} cards`, () => {
      const items = [card('old', kind), card('middle', kind), card('new', kind)];
      const messages = items.map(cardMessage);
      assert.deepEqual(cardIds(filterInboxMessages(messages, inboxOf(items), mode)),
        mode === 'full' ? ['old', 'middle', 'new'] : mode === 'one' ? ['new'] : []);
    });
  }

  test(`answered and expired cards remain visible in ${mode}`, () => {
    const items = (['approval', 'question', 'result'] as const).flatMap((kind) =>
      (['resolved', 'expired'] as const).map((status) => card(`${kind}-${status}`, kind, { status, resolution: 'yes' })));
    items.push(card('pending', 'question'));
    const visible = filterInboxMessages(items.map(cardMessage), inboxOf(items), mode);
    assert.deepEqual(cardIds(visible), [...items.slice(0, -1).map((item) => item.id), ...(mode === 'off' ? [] : ['pending'])]);
  });

  test(`${mode} safely preserves ordinary messages and cards whose inbox data has not loaded`, () => {
    const messages = [msg('user', { role: 'user' }), msg('reply'), msg('notice', { role: 'system' }),
      msg('missing-question', { role: 'system', meta: { inbox_id: 'not-loaded', kind: 'question' } }),
      msg('missing-approval', { role: 'system', meta: { inbox_id: 'approval-not-loaded', kind: 'approval' } })];
    assert.deepEqual(filterInboxMessages([], {}, mode), []);
    assert.deepEqual(filterInboxMessages(messages, {}, mode), messages);
    assert.deepEqual(filterInboxMessages(messages, undefined, mode), messages);
  });
}

test('full is the default for inbox cards', () => {
  const items = [card('q1', 'question'), card('q2', 'question'), card('r', 'result')];
  const messages = items.map(cardMessage);
  assert.deepEqual(filterInboxMessages(messages, inboxOf(items)), messages);
});

test('questions and results share one slot, chosen by transcript order rather than item update time', () => {
  const r = card('r', 'result', { created_at: 100, updated_at: 200 });
  const q = card('q', 'question', { created_at: 1, updated_at: 1 });
  const unrelated = card('other-chat', 'question', { chat_id: 'other', created_at: 999 });
  const inbox = inboxOf([q, r, unrelated]); // Dictionary order is not transcript order.
  assert.deepEqual(cardIds(filterInboxMessages([cardMessage(r), cardMessage(q)], inbox, 'one')), ['q']);
  assert.deepEqual(cardIds(filterInboxMessages([cardMessage(q), cardMessage(r)], inbox, 'one')), ['r']);
});

test('one reserves a single message slot even if the same pending card was posted twice', () => {
  const q = card('q', 'question');
  const older = cardMessage(q);
  const newer = { ...older, id: 'reposted' };
  assert.deepEqual(filterInboxMessages([older, newer], inboxOf([q]), 'one'), [newer]);
});

test('later historical cards do not occupy the pending slot', () => {
  const items = [card('pending', 'question'), card('answered', 'result', { status: 'resolved' }),
    card('expired', 'question', { status: 'expired' })];
  const messages = items.map(cardMessage);
  assert.deepEqual(filterInboxMessages(messages, inboxOf(items), 'one'), messages);
});

test('a new pending card replaces the slot and resolved cards return to the transcript', () => {
  const q1 = card('q1', 'question');
  const q2 = card('q2', 'question');
  const messages = Object.freeze([cardMessage(q1), cardMessage(q2)]);
  const inbox = Object.freeze(inboxOf([Object.freeze(q1), Object.freeze(q2)]));
  assert.deepEqual(cardIds(filterInboxMessages(messages.slice(0, 1), inbox, 'one')), ['q1']);
  assert.deepEqual(cardIds(filterInboxMessages(messages, inbox, 'one')), ['q2']);
  const answered: Record<string, InboxItem> = { ...inbox, q1: { ...q1, status: 'resolved', resolution: 'yes' } };
  assert.deepEqual(cardIds(filterInboxMessages(messages, answered, 'one')), ['q1', 'q2']);
  assert.deepEqual(cardIds(filterInboxMessages(messages, answered, 'off')), ['q1']);
  answered.q2 = { ...q2, status: 'resolved', resolution: 'yes' };
  assert.deepEqual(cardIds(filterInboxMessages(messages, answered, 'off')), ['q1', 'q2']);
  assert.equal(inbox.q1.status, 'pending');
  assert.equal(inbox.q2.status, 'pending');
});

test("the model sheet's pickers stay out of the chat, and only the reasoning card it asked for", () => {
  const picker = (id: string, kind: 'model' | 'choice') => msg(id, { meta: { picker: { id, kind, status: 'open', expires_at: 9 } } });
  assert.ok(!inSheet(picker('m', 'model'), undefined)); // typed by hand: stays in the chat
  assert.ok(!inSheet(picker('c', 'choice'), undefined));
  assert.ok(inSheet(picker('m', 'model'), undefined, 0, true)); // answers the sheet's own /model
  assert.ok(inSheet(picker('c', 'choice'), undefined, 0, true));
  const waiting = { before: ['old'], until: 1000 };
  assert.ok(inSheet(picker('new', 'choice'), waiting, 500));
  assert.ok(!inSheet(picker('old', 'choice'), waiting, 500)); // was already there
  assert.ok(!inSheet(picker('late', 'choice'), waiting, 2000)); // the sheet gave up waiting
  assert.ok(inSheet(picker('new', 'choice'), { ...waiting, claimed: 'new', until: 0 }, 2000)); // claimed stays claimed
  assert.ok(!inSheet(picker('other', 'choice'), { ...waiting, claimed: 'new' }, 500));
  assert.ok(!inSheet(say('t', 'hi'), waiting, 500));
});

test('the chat keeps a picker typed by hand and drops the ones the sheet asked for', () => {
  const picker = (id: string, kind: 'model' | 'choice' | 'confirm') => msg(id, { meta: { picker: { id, kind, status: 'open', expires_at: 9 } } });
  const list = [
    msg('ask1', { role: 'user', text: '/model', meta: { hidden: true } }), picker('m1', 'model'),
    msg('ask2', { role: 'user', text: '/model' }), picker('m2', 'model'),
    msg('ask3', { role: 'user', text: '/reasoning', meta: { hidden: true } }), picker('r1', 'choice'), picker('x', 'confirm'),
    msg('hi', { role: 'user', text: 'hi' }), say('reply', 'Hello'),
  ];
  assert.deepEqual(chatMessages(list, undefined).map((m) => m.id), ['ask2', 'm2', 'x', 'hi', 'reply']);
  assert.deepEqual(chatMessages([], undefined), []);
});

test('repeated tool lines still count as progress', () => {
  assert.ok(isActivity(say('a', '🔍 web_search: "cats" (×3)')));
  assert.ok(isActivity(say('b', '⚡ read_file... (×2)')));
});

test("Hermes's friendly wording folds only where an answer follows it", () => {
  const friendly = say('p', '🔍 Searching the web for cats in space\n📖 Reading skill pdf');
  assert.equal(activityKind(friendly), 'maybe');
  assert.ok(!isActivity(friendly)); // not certain on its own
  const ids = (list: Message[], typing = false) => groupActivity(list, typing).map((e) => (e.kind === 'msg' ? e.m.id : `${e.id}+${e.items.length}`));
  const u = say('u', 'find cats', { role: 'user' });
  const answer = say('r', 'There are three breeds.');
  assert.deepEqual(ids([u, friendly, answer]), ['u', 'p+1', 'r']); // the answer came
  assert.deepEqual(ids([u, friendly], true), ['u', 'p+1']); // still working on it
  assert.deepEqual(ids([u, friendly]), ['u', 'p']); // ended on it: it may be the answer, so it shows
  assert.deepEqual(ids([u, friendly, say('u2', 'thanks', { role: 'user' })], true), ['u', 'p', 'u2']); // an old turn that ended on it
});

test('an answer that merely starts like progress is not folded', () => {
  const u = say('u', 'status?', { role: 'user' });
  for (const text of ['📖 Reading is fun, but the report says otherwise.\nIt is done.', '🎉 Running late, sorry!\nHere you go.', '✅ Writing the file took a while']) {
    const m = say('a', text);
    // all lines must look like progress; the second line of the first two doesn't, the third is a lone line
    const out = groupActivity([u, m, say('b', 'Done.')]).map((e) => e.kind);
    if (text.includes('\n')) assert.deepEqual(out, ['msg', 'msg', 'msg']);
    else assert.equal(activityKind(m), 'maybe'); // alone it can't be told apart; it folds only with an answer after it
  }
});

test('a reply still streaming in is not taken for friendly progress, even if its first line reads like it', () => {
  const u = say('u', 'what should I read?', { role: 'user' });
  const streaming = say('a', '📖 Reading list for this week', { status: 'streaming' });
  assert.equal(activityKind(streaming), null);
  assert.deepEqual(groupActivity([u, streaming], true).map((e) => e.kind), ['msg', 'msg']);
  // Tool lines with the tool's own name are progress however they arrive.
  assert.equal(activityKind(say('p', '🔍 web_search: "cats"', { status: 'streaming' })), 'sure');
});
