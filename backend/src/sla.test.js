const test = require('node:test');
const assert = require('node:assert/strict');
const { addWorkingMinutes, workingMinutesBetween, targets } = require('./sla');
const d = s => new Date(s);
test('adds working time across weekend without counting it', () => {
  const due = addWorkingMinutes(d('2026-11-20T17:30:00+05:30'),120);
  assert.equal(due.toISOString(), d('2026-11-23T10:30:00+05:30').toISOString());
});
test('excludes non-working hours from elapsed time', () => {
  assert.equal(workingMinutesBetween(d('2026-11-20T17:30:00+05:30'),d('2026-11-23T10:30:00+05:30')),120);
});
test('honors configured holidays', () => {
  const holidays = new Set(['2026-11-23']);
  const due = addWorkingMinutes(d('2026-11-20T17:30:00+05:30'),120,holidays);
  assert.equal(due.toISOString(), d('2026-11-24T10:30:00+05:30').toISOString());
});
test('urgent resolution target is end of same working day', () => {
  const due = targets('URGENT',d('2026-11-20T10:00:00+05:30')).resolutionDueAt;
  assert.equal(due.toISOString(),d('2026-11-20T18:30:00+05:30').toISOString());
});
test('starts from next working day when ticket is created after working hours', () => {
  const due = addWorkingMinutes(
    d('2026-11-20T18:45:00+05:30'),
    120
  );

  assert.equal(
    due.toISOString(),
    d('2026-11-23T11:30:00+05:30').toISOString()
  );
});
test('starts from working hours when ticket is created before opening', () => {
  const due = addWorkingMinutes(
    d('2026-11-23T08:00:00+05:30'),
    120
  );

  assert.equal(
    due.toISOString(),
    d('2026-11-23T11:30:00+05:30').toISOString()
  );
});
test('calculates medium priority SLA deadlines correctly', () => {
  const result = targets(
    'MEDIUM',
    d('2026-11-23T09:30:00+05:30')
  );

  assert.equal(
    result.responseDueAt.toISOString(),
    d('2026-11-23T14:00:00+05:30').toISOString()
  );

  assert.equal(
    result.resolutionDueAt.toISOString(),
    d('2026-11-25T18:30:00+05:30').toISOString()
  );
});
test('calculates small priority SLA deadlines correctly', () => {
  const result = targets(
    'SMALL',
    d('2026-11-23T09:30:00+05:30')
  );

  assert.equal(
    result.responseDueAt.toISOString(),
    d('2026-11-23T18:30:00+05:30').toISOString()
  );

  assert.equal(
    result.resolutionDueAt.toISOString(),
    d('2026-11-27T18:30:00+05:30').toISOString()
  );
});
test('skips both weekend and holiday when calculating SLA', () => {
  const holidays = new Set(['2026-11-23']);

  const due = addWorkingMinutes(
    d('2026-11-20T17:30:00+05:30'),
    120,
    holidays
  );

  assert.equal(
    due.toISOString(),
    d('2026-11-24T10:30:00+05:30').toISOString()
  );
});
test('excludes configured holidays when calculating elapsed working time', () => {
  const holidays = new Set(['2026-11-23']);

  const elapsed = workingMinutesBetween(
    d('2026-11-20T17:30:00+05:30'),
    d('2026-11-24T10:30:00+05:30'),
    holidays
  );

  assert.equal(elapsed, 120);
});
test('starts immediately when ticket is created exactly at opening time', () => {
  const due = addWorkingMinutes(
    d('2026-11-23T09:30:00+05:30'),
    60
  );

  assert.equal(
    due.toISOString(),
    d('2026-11-23T10:30:00+05:30').toISOString()
  );
});

test('moves to next working day when ticket is created exactly at closing time', () => {
  const due = addWorkingMinutes(
    d('2026-11-23T18:30:00+05:30'),
    60
  );

  assert.equal(
    due.toISOString(),
    d('2026-11-24T10:30:00+05:30').toISOString()
  );
});
test('starts from Monday when ticket is created on Saturday', () => {
  const due = addWorkingMinutes(
    d('2026-11-21T12:00:00+05:30'),
    60
  );

  assert.equal(
    due.toISOString(),
    d('2026-11-23T10:30:00+05:30').toISOString()
  );
});