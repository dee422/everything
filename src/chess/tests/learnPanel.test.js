import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEARN_TOPICS, learnTopicProgress } from '../src/game/learnContent.js';
import { recordAttempt } from '../src/game/tacticsStore.js';
import { mountLearnPanel } from '../src/ui/learnPanel.js';

function fakeNode() {
  const classes = new Set();
  const listeners = new Map();
  const attributes = new Map();
  const node = {
    children: [],
    className: '',
    dataset: {},
    open: false,
    scrollTop: 0,
    classList: {
      add: (value) => classes.add(value),
      toggle: (value, on) => (on ? classes.add(value) : classes.delete(value)),
      contains: (value) => classes.has(value),
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    emit(type) { listeners.get(type)?.(); },
    append(...children) { node.children.push(...children); },
    appendChild(child) { node.children.push(child); return child; },
    replaceChildren(...children) { node.children = children; },
    querySelectorAll(selector) {
      const attribute = selector.match(/^\[data-([\w-]+)\]$/)?.[1];
      return descendants(node).filter((child) => attribute && child.dataset[attribute] !== undefined);
    },
    showModal() { node.open = true; },
    close() { node.open = false; },
  };
  Object.defineProperty(node, 'textContent', {
    get: () => text(node),
    set: (value) => { node._text = String(value); node.children = []; },
  });
  return node;
}

function descendants(node) {
  return [node, ...(node.children ?? []).flatMap(descendants)];
}

function text(node) {
  if (node.text === undefined && node.children && node.children.length) {
    return node.children.map(text).join('');
  }
  return node.text ?? node._text ?? '';
}

function mount({ stored = null, onPractice = () => {} } = {}) {
  const ids = [
    'learn-card', 'learn-dialog', 'learn-dialog-step', 'learn-dialog-title',
    'learn-dialog-body', 'learn-prev-btn', 'learn-next-btn', 'learn-close-btn',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeNode()]));
  const topics = LEARN_TOPICS.map((topic) => {
    const button = fakeNode();
    button.dataset.learnTopic = topic.id;
    return button;
  });
  elements['learn-card'].querySelectorAll = () => topics;
  vi.stubGlobal('document', {
    getElementById: (id) => elements[id],
    createElement: () => fakeNode(),
    createTextNode: (value) => ({ textContent: String(value) }),
  });
  const data = new Map();
  if (stored !== null) data.set('chess-tactics-store', JSON.stringify(stored));
  vi.stubGlobal('localStorage', {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  });
  return { panel: mountLearnPanel({ onPractice }), topics, body: elements['learn-dialog-body'] };
}

function findText(node, value) {
  return descendants(node).find((child) => text(child) === value);
}

beforeEach(() => vi.unstubAllGlobals());

describe('教程练习进度', () => {
  it('缺少进度字段的旧存档按零进度显示', () => {
    const { topics } = mount({ stored: { favorites: [], problemSets: {} } });
    for (const topic of topics) {
      expect(text(topic)).toContain('练习 0/');
      expect(topic.getAttribute('aria-label')).toContain('练习 0/');
    }
  });

  it('多题课程按已解决题数显示部分进度', () => {
    const { topics } = mount({
      stored: {
        favorites: [], problemSets: {}, userRating: 1000,
        progress: { 'basic-rules-castle': { attempts: 1, solved: true, lastAttempt: 1 } },
      },
    });
    expect(text(topics[2])).toContain('练习 1/2');
    expect(topics[2].classList.contains('is-complete')).toBe(false);
  });

  it('答题后刷新卡片和已打开弹窗，全部完成后允许再练', () => {
    const { panel, topics, body } = mount();
    panel.open('rules');
    body.scrollTop = 120;

    recordAttempt('basic-rules-castle', true);
    panel.refresh();
    expect(text(topics[2])).toContain('练习 1/2');
    expect(findText(body, '本节练习 1/2')).toBeTruthy();
    expect(body.scrollTop).toBe(120);

    recordAttempt('basic-rules-back-rank', true);
    panel.refresh();
    expect(text(topics[2])).toContain('已完成');
    expect(topics[2].classList.contains('is-complete')).toBe(true);
    expect(findText(body, '本节已完成')).toBeTruthy();
    expect(findText(body, '再练一次：特殊规则')).toBeTruthy();
  });

  it('没有推荐题的课程不会误报完成', () => {
    expect(learnTopicProgress({ practiceIds: [] }, {})).toEqual({
      solved: 0, total: 0, complete: false,
    });
  });
});
