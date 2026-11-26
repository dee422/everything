import { describe, expect, it } from 'vitest';
import { BASIC_PROBLEMS, basicProblem } from '../src/game/basicProblems.js';
import { LEARN_TOPICS, learnTopic } from '../src/game/learnContent.js';
import { validateProblem } from '../src/game/tactics.js';

describe('内置基础题', () => {
  it('每道题的 FEN 和逐手解法都合法，且有明确标题与指令', () => {
    expect(BASIC_PROBLEMS.length).toBeGreaterThanOrEqual(8);
    for (const problem of BASIC_PROBLEMS) {
      expect(validateProblem(problem), problem.id).toMatchObject({ valid: true });
      expect(problem.title).toEqual(expect.any(String));
      expect(problem.prompt).toEqual(expect.any(String));
      expect(problem.title.length).toBeGreaterThan(0);
      expect(problem.prompt.length).toBeGreaterThan(0);
    }
  });

  it('题目 ID 唯一，也能按教程推荐 ID 找到', () => {
    const ids = BASIC_PROBLEMS.map((problem) => problem.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(basicProblem(id)?.id).toBe(id);
    expect(basicProblem('not-a-problem')).toBeNull();
  });
});

describe('教程到练习的映射', () => {
  it('五节教程都有推荐题，且每个推荐都指向内置题', () => {
    expect(LEARN_TOPICS.map((topic) => topic.id)).toEqual([
      'setup', 'pieces', 'rules', 'opening', 'tactics',
    ]);
    for (const topic of LEARN_TOPICS) {
      expect(topic.practiceIds?.length, topic.id).toBeGreaterThan(0);
      for (const id of topic.practiceIds) expect(basicProblem(id), `${topic.id}: ${id}`).not.toBeNull();
      expect(learnTopic(topic.id)).toBe(topic);
    }
  });

  it('每道内置题至少被一节教程推荐', () => {
    const recommended = new Set(LEARN_TOPICS.flatMap((topic) => topic.practiceIds));
    for (const problem of BASIC_PROBLEMS) expect(recommended.has(problem.id), problem.id).toBe(true);
  });
});
