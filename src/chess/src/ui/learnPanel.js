/**
 * 自学教程的界面：左边那张卡上的五个按钮 + 一个读正文的对话框。
 *
 * 教程对所有人开放 —— 这里不查登录、不查教练资格，也不发任何请求。
 * 正文在 game/learnContent.js 里，这一层只管摆出来和翻页。
 */

import { LEARN_TOPICS, learnTopicProgress } from '../game/learnContent.js';
import { getAllProgress } from '../game/tacticsStore.js';

const $ = (id) => document.getElementById(id);

function progressLabel(progress) {
  return progress.complete ? '已完成' : `练习 ${progress.solved}/${progress.total}`;
}

export function mountLearnPanel({ onPractice } = {}) {
  const card = $('learn-card');
  const dialog = $('learn-dialog');
  const el = {
    step: $('learn-dialog-step'),
    title: $('learn-dialog-title'),
    body: $('learn-dialog-body'),
    prev: $('learn-prev-btn'),
    next: $('learn-next-btn'),
    close: $('learn-close-btn'),
  };

  let current = 0;
  let practiceStatus = null;
  let practiceButton = null;

  function paintCard() {
    const progress = getAllProgress();
    for (const button of card.querySelectorAll('[data-learn-topic]')) {
      const topic = LEARN_TOPICS.find((item) => item.id === button.dataset.learnTopic);
      if (!topic) continue;
      const state = learnTopicProgress(topic, progress);
      const label = document.createElement('span');
      label.textContent = topic.label;
      const badge = document.createElement('span');
      badge.className = 'learn-topic-progress';
      badge.textContent = progressLabel(state);
      button.replaceChildren(label, badge);
      button.classList.toggle('is-complete', state.complete);
      button.setAttribute('aria-label', `${topic.label}，${progressLabel(state)}`);
    }
  }

  function updatePractice(topic) {
    const state = learnTopicProgress(topic, getAllProgress());
    practiceStatus.textContent = `本节${progressLabel(state)}`;
    practiceStatus.classList.toggle('is-complete', state.complete);
    if (practiceButton) {
      practiceButton.textContent = `${state.complete ? '再练一次' : '练一练'}：${topic.label}`;
    }
  }

  function paint() {
    const topic = LEARN_TOPICS[current];
    el.step.textContent = `第 ${current + 1} / ${LEARN_TOPICS.length} 节`;
    el.title.textContent = topic.title;

    el.body.replaceChildren();
    const lead = document.createElement('p');
    lead.className = 'learn-lead';
    lead.textContent = topic.lead;
    el.body.appendChild(lead);

    practiceStatus = document.createElement('p');
    practiceStatus.className = 'learn-practice-status';
    el.body.appendChild(practiceStatus);

    for (const section of topic.sections) {
      const heading = document.createElement('h3');
      heading.textContent = section.heading;
      el.body.appendChild(heading);

      const list = document.createElement('ul');
      for (const item of section.items) {
        const line = document.createElement('li');
        line.textContent = item;
        list.appendChild(line);
      }
      el.body.appendChild(list);
    }

    practiceButton = null;
    if (onPractice) {
      practiceButton = document.createElement('button');
      practiceButton.type = 'button';
      practiceButton.className = 'btn btn-primary learn-practice';
      practiceButton.addEventListener('click', () => {
        dialog.close();
        onPractice(topic.id);
      });
      el.body.appendChild(practiceButton);
    }
    updatePractice(topic);

    el.body.scrollTop = 0;
  }

  function open(id) {
    const index = LEARN_TOPICS.findIndex((topic) => topic.id === id);
    current = index >= 0 ? index : 0;
    paint();
    if (!dialog.open) dialog.showModal();
  }

  function step(delta) {
    current = (current + delta + LEARN_TOPICS.length) % LEARN_TOPICS.length;
    paint();
  }

  for (const button of card.querySelectorAll('[data-learn-topic]')) {
    button.addEventListener('click', () => open(button.dataset.learnTopic));
  }
  el.prev.addEventListener('click', () => step(-1));
  el.next.addEventListener('click', () => step(1));
  el.close.addEventListener('click', () => dialog.close());

  paintCard();

  return {
    open,
    refresh() {
      paintCard();
      if (dialog.open) updatePractice(LEARN_TOPICS[current]);
    },
  };
}