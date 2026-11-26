/**
 * 自学教程的界面：左边那张卡上的五个按钮 + 一个读正文的对话框。
 *
 * 教程对所有人开放 —— 这里不查登录、不查教练资格，也不发任何请求。
 * 正文在 game/learnContent.js 里，这一层只管摆出来和翻页。
 */

import { LEARN_TOPICS } from '../game/learnContent.js';

const $ = (id) => document.getElementById(id);

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

  function paint() {
    const topic = LEARN_TOPICS[current];
    el.step.textContent = `第 ${current + 1} / ${LEARN_TOPICS.length} 节`;
    el.title.textContent = topic.title;

    el.body.replaceChildren();
    const lead = document.createElement('p');
    lead.className = 'learn-lead';
    lead.textContent = topic.lead;
    el.body.appendChild(lead);

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

    if (onPractice) {
      const practice = document.createElement('button');
      practice.type = 'button';
      practice.className = 'btn btn-primary learn-practice';
      practice.textContent = `练一练：${topic.label}`;
      practice.addEventListener('click', () => {
        dialog.close();
        onPractice(topic.id);
      });
      el.body.appendChild(practice);
    }

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

  return { open };
}