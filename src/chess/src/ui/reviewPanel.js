/**
 * 复盘报告面板：显示整盘棋的分析结果。
 *
 * 包含：
 * - 准确率统计（白方/黑方/总体）
 * - 各分类计数（错着/漏着/不精确/好棋/最佳）
 * - 关键转折点列表
 * - 走法列表（带颜色标记）
 */

import {
  CLASSIFY_LABEL,
  CLASSIFY_COLOR,
  computeAccuracy,
  countClassifications,
  findCriticalMoments,
} from '../game/review.js';
import { mountEvalGraph } from './evalGraph.js';

/**
 * 挂载复盘面板。
 *
 * @param {HTMLElement} container - 挂载点
 * @param {object} options
 * @param {object[]} options.results - analyzeGame 的返回值
 * @param {string[]} options.sans - 每手棋的 SAN 格式
 * @param {function} options.onPlyClick - 点击走法时的回调 (ply) => void
 * @returns {{ update: function, destroy: function }}
 */
export function mountReviewPanel(container, { results, sans, onPlyClick }) {
  container.innerHTML = '';
  container.classList.add('review-panel');

  // 准确率
  const accuracy = computeAccuracy(results);
  const accuracySection = createSection('准确率');
  accuracySection.appendChild(createAccuracyDisplay(accuracy));
  container.appendChild(accuracySection);

  // 分类统计
  const counts = countClassifications(results);
  const statsSection = createSection('走法统计');
  statsSection.appendChild(createStatsDisplay(counts, results.length));
  container.appendChild(statsSection);

  // 评估曲线
  const graphSection = createSection('评估曲线');
  const graphContainer = document.createElement('div');
  graphContainer.className = 'eval-graph-container';
  graphSection.appendChild(graphContainer);
  container.appendChild(graphSection);

  const graph = mountEvalGraph(graphContainer, results, onPlyClick);

  // 关键转折点
  const moments = findCriticalMoments(results, 5);
  if (moments.length > 0) {
    const momentsSection = createSection('关键转折');
    momentsSection.appendChild(createMomentsList(moments, results, sans, onPlyClick));
    container.appendChild(momentsSection);
  }

  // 走法列表
  const movesSection = createSection('走法详情');
  movesSection.appendChild(createMovesList(results, sans, onPlyClick));
  container.appendChild(movesSection);

  return {
    setCurrentPly(ply) {
      graph.setCurrentPly(ply);
      // 高亮当前走法
      const items = movesSection.querySelectorAll('.review-move-item');
      items.forEach((item) => {
        if (Number(item.dataset.ply) === ply) {
          item.classList.add('current');
        } else {
          item.classList.remove('current');
        }
      });
    },

    destroy() {
      graph.destroy();
      container.innerHTML = '';
    },
  };
}

function createSection(title) {
  const section = document.createElement('div');
  section.className = 'review-section';
  const heading = document.createElement('h3');
  heading.className = 'review-section-title';
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

function createAccuracyDisplay(accuracy) {
  const div = document.createElement('div');
  div.className = 'review-accuracy';

  const items = [
    { label: '白方', value: accuracy.white, color: '#fff' },
    { label: '黑方', value: accuracy.black, color: '#888' },
    { label: '总体', value: accuracy.overall, color: '#4fc3f7' },
  ];

  for (const { label, value, color } of items) {
    const item = document.createElement('div');
    item.className = 'review-accuracy-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'review-accuracy-label';
    labelEl.textContent = label;
    item.appendChild(labelEl);

    const valueEl = document.createElement('span');
    valueEl.className = 'review-accuracy-value';
    valueEl.style.color = color;
    valueEl.textContent = `${value.toFixed(1)}%`;
    item.appendChild(valueEl);

    div.appendChild(item);
  }

  return div;
}

function createStatsDisplay(counts, total) {
  const div = document.createElement('div');
  div.className = 'review-stats';

  const categories = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
  for (const cat of categories) {
    const item = document.createElement('div');
    item.className = 'review-stat-item';

    const dot = document.createElement('span');
    dot.className = 'review-stat-dot';
    dot.style.backgroundColor = CLASSIFY_COLOR[cat];
    item.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'review-stat-label';
    label.textContent = CLASSIFY_LABEL[cat];
    item.appendChild(label);

    const count = document.createElement('span');
    count.className = 'review-stat-count';
    count.textContent = counts[cat] || 0;
    item.appendChild(count);

    const pct = total > 0 ? ((counts[cat] || 0) / total * 100).toFixed(0) : 0;
    const pctEl = document.createElement('span');
    pctEl.className = 'review-stat-pct';
    pctEl.textContent = `(${pct}%)`;
    item.appendChild(pctEl);

    div.appendChild(item);
  }

  return div;
}

function createMomentsList(moments, results, sans, onPlyClick) {
  const list = document.createElement('div');
  list.className = 'review-moments-list';

  for (const moment of moments) {
    const result = results[moment.ply];
    if (!result) continue;

    const item = document.createElement('div');
    item.className = 'review-moment-item';
    item.style.cursor = 'pointer';
    item.dataset.ply = moment.ply;

    const moveNum = Math.floor(moment.ply / 2) + 1;
    const isWhite = moment.ply % 2 === 0;
    const san = sans[moment.ply] || '...';

    const moveEl = document.createElement('span');
    moveEl.className = 'review-moment-move';
    moveEl.textContent = `${moveNum}.${isWhite ? '' : '..'} ${san}`;
    item.appendChild(moveEl);

    const lossEl = document.createElement('span');
    lossEl.className = 'review-moment-loss';
    lossEl.style.color = CLASSIFY_COLOR[result.classification];
    lossEl.textContent = `-${(moment.swing / 100).toFixed(2)}`;
    item.appendChild(lossEl);

    item.addEventListener('click', () => onPlyClick?.(moment.ply));
    list.appendChild(item);
  }

  return list;
}

function createMovesList(results, sans, onPlyClick) {
  const list = document.createElement('div');
  list.className = 'review-moves-list';

  // 按回合分组（每回合两手棋）
  for (let i = 0; i < results.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'review-moves-row';

    // 回合号
    const numEl = document.createElement('span');
    numEl.className = 'review-moves-num';
    numEl.textContent = `${Math.floor(i / 2) + 1}.`;
    row.appendChild(numEl);

    // 白方走法
    if (i < results.length) {
      row.appendChild(createMoveItem(results[i], sans[i], i, onPlyClick));
    }

    // 黑方走法
    if (i + 1 < results.length) {
      row.appendChild(createMoveItem(results[i + 1], sans[i + 1], i + 1, onPlyClick));
    }

    list.appendChild(row);
  }

  return list;
}

function createMoveItem(result, san, ply, onPlyClick) {
  const item = document.createElement('span');
  item.className = 'review-move-item';
  item.dataset.ply = ply;
  item.style.cursor = 'pointer';

  if (result.classification && result.classification !== 'best' && result.classification !== 'good') {
    item.classList.add(`review-move-${result.classification}`);
    item.style.color = CLASSIFY_COLOR[result.classification];
  }

  item.textContent = san || '...';

  // 悬停提示
  if (result.loss !== undefined && result.loss > 0) {
    item.title = `${CLASSIFY_LABEL[result.classification]} (-${(result.loss / 100).toFixed(2)})`;
  }

  item.addEventListener('click', () => onPlyClick?.(ply));
  return item;
}

/**
 * 创建复盘进度条。
 *
 * @param {HTMLElement} container
 * @returns {{ update: function(current, total), destroy: function }}
 */
export function mountReviewProgress(container) {
  container.innerHTML = '';
  container.classList.add('review-progress');

  const bar = document.createElement('div');
  bar.className = 'review-progress-bar';
  container.appendChild(bar);

  const fill = document.createElement('div');
  fill.className = 'review-progress-fill';
  bar.appendChild(fill);

  const text = document.createElement('span');
  text.className = 'review-progress-text';
  text.textContent = '正在分析...';
  container.appendChild(text);

  return {
    update(current, total) {
      const pct = total > 0 ? (current / total) * 100 : 0;
      fill.style.width = `${pct}%`;
      text.textContent = `分析中 ${current}/${total}...`;
    },

    setText(value) {
      text.textContent = value;
    },

    destroy() {
      container.innerHTML = '';
    },
  };
}
