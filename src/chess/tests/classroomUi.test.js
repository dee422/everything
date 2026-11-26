import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const classCallSource = source.match(/async function classCall\(what\) \{[\s\S]*?\n\}/)?.[0];
if (!classCallSource) throw new Error('main.js 里找不到 classCall');

function makeHarness() {
  const busyDuringRepaint = [];
  const { classCall, updateModeUi } = new Function(
    'busyDuringRepaint',
    `let classRequestOut = false;
     const updateModeUi = () => busyDuringRepaint.push(classRequestOut);
     ${classCallSource}
     return { classCall, updateModeUi };`,
  )(busyDuringRepaint);
  return { classCall, updateModeUi, busyDuringRepaint };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('课堂请求结束后的界面刷新', () => {
  it('快照在请求期间禁用按钮，请求结束后立即重新启用', async () => {
    const harness = makeHarness();
    const answer = deferred();
    const call = harness.classCall(async () => {
      harness.updateModeUi();
      await answer.promise;
      harness.updateModeUi();
      return 'ok';
    });
    expect(harness.busyDuringRepaint).toEqual([true]);
    answer.resolve('ok');
    await expect(call).resolves.toBe('ok');
    expect(harness.busyDuringRepaint).toEqual([true, true, false]);
  });

  it('请求失败也要刷新，不能把禁用状态留在屏幕上', async () => {
    const harness = makeHarness();
    const answer = deferred();
    const call = harness.classCall(() => answer.promise);
    answer.reject(new Error('network'));
    await expect(call).rejects.toThrow('network');
    expect(harness.busyDuringRepaint.at(-1)).toBe(false);
  });

  it('每次轮询都先禁用、结束后再恢复', async () => {
    const harness = makeHarness();
    for (let i = 0; i < 3; i++) {
      const answer = deferred();
      const call = harness.classCall(() => {
        harness.updateModeUi();
        return answer.promise;
      });
      answer.resolve();
      await call;
    }
    expect(harness.busyDuringRepaint).toEqual([true, false, true, false, true, false]);
  });
});
