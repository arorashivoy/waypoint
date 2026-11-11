import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { AUTO_REFRESH_HOUR, indiaDay, queueDailyRefresh } from '@/lib/tasks/auto-refresh';
import { makeUser } from './helpers/http';

// All test files share one database. Each test makes its own user and passes it as the scope,
// so the function never queues a refresh for a user of another test. No worker runs these tasks.
// A new user has its countries on.
async function userWithCountry(on = true) {
  const { user } = await makeUser();
  if (!on) await db.countryPref.updateMany({ where: { userId: user.id }, data: { on: false } });
  expect(await db.countryPref.count({ where: { userId: user.id, on: true } }) > 0).toBe(on);
  return { userId: user.id };
}
const refreshes = (userId: string) => db.task.findMany({ where: { userId, kind: 'refresh' } });

// 07:00 in India is 01:30 UTC.
const at = (utc: string) => new Date(`2026-11-10T${utc}:00Z`);

describe('indiaDay', () => {
  it('gives the date and the hour in India', () => {
    expect(indiaDay(at('01:29'))).toEqual({ day: '2026-11-10', hour: 6 });
    expect(indiaDay(at('01:30'))).toEqual({ day: '2026-11-10', hour: 7 });
    // 18:30 UTC is midnight in India: the next date.
    expect(indiaDay(at('18:29'))).toEqual({ day: '2026-11-10', hour: 23 });
    expect(indiaDay(at('18:30'))).toEqual({ day: '2026-11-11', hour: 0 });
  });

  it('starts the refresh at 7', () => {
    expect(AUTO_REFRESH_HOUR).toBe(7);
  });
});

describe('queueDailyRefresh', () => {
  it('queues nothing before the hour', async () => {
    const scope = await userWithCountry();
    expect(await queueDailyRefresh(at('01:29'), scope)).toBe(0);
    expect(await refreshes(scope.userId)).toHaveLength(0);
  });

  it('queues the task of the Refresh button one time each day', async () => {
    const scope = await userWithCountry();
    expect(await queueDailyRefresh(at('01:30'), scope)).toBe(1);
    const [task] = await refreshes(scope.userId);
    expect(task.status).toBe('queued');
    expect(JSON.parse(task.payload)).toEqual({ force: false });
    expect(task.dedupeKey).toBe(`refresh:${scope.userId}`);
    // Later on the same day: nothing, also after the first task is done.
    await db.task.update({ where: { id: task.id }, data: { status: 'done' } });
    expect(await queueDailyRefresh(at('09:00'), scope)).toBe(0);
    expect(await refreshes(scope.userId)).toHaveLength(1);
  });

  it('queues again on the next day', async () => {
    const scope = await userWithCountry();
    await queueDailyRefresh(at('02:00'), scope);
    await db.task.updateMany({ where: { userId: scope.userId, kind: 'refresh' }, data: { status: 'done' } });
    // 18:30 UTC is 00:00 of the next day in India: before the hour.
    expect(await queueDailyRefresh(at('18:30'), scope)).toBe(0);
    expect(await queueDailyRefresh(new Date('2026-11-11T01:30:00Z'), scope)).toBe(1);
    expect(await refreshes(scope.userId)).toHaveLength(2);
  });

  it('runs later on the same day when the worker was off at the hour', async () => {
    const scope = await userWithCountry();
    expect(await queueDailyRefresh(at('12:00'), scope)).toBe(1);
  });

  it('does not make a second task while a refresh is open', async () => {
    const scope = await userWithCountry();
    const open = await db.task.create({
      data: { kind: 'refresh', userId: scope.userId, payload: '{"force":true}', dedupeKey: `refresh:${scope.userId}`, status: 'running' },
    });
    expect(await queueDailyRefresh(at('02:00'), scope)).toBe(1);
    expect((await refreshes(scope.userId)).map((t) => t.id)).toEqual([open.id]);
  });

  it('skips a user with every country paused, and a disabled user', async () => {
    const paused = await userWithCountry(false);
    expect(await queueDailyRefresh(at('02:00'), paused)).toBe(0);
    const off = await userWithCountry();
    await db.user.update({ where: { id: off.userId }, data: { disabledAt: new Date() } });
    expect(await queueDailyRefresh(at('02:00'), off)).toBe(0);
    expect(await refreshes(paused.userId)).toHaveLength(0);
    expect(await refreshes(off.userId)).toHaveLength(0);
  });
});
