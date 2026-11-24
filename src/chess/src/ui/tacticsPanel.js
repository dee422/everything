/**
 * 题库面板：导入题目、做题、判题、管理。
 *
 * 包含：
 * - 导入区域（文件上传、PGN/FEN 文本输入）
 * - 做题模式（棋盘局面 + 提示 + 判定）
 * - 列表模式（题目列表 + 筛选 + 收藏 + 进度）
 * - 导航（上一题/下一题/重做）
 */

import { Chess } from '../engine/chess.js';
import { importFromPgn, importAuto, validateProblem, problemFromFen, sanToUci } from '../game/tactics.js';
import {
  toggleFavorite,
  isFavorite,
  getFavorites,
  recordAttempt,
  getProgress,
  getAllProgress,
  saveProblemSet,
  getProblemSetNames,
  loadProblemSet,
  deleteProblemSet,
  getStats,
  getUserRating,
  updateRating,
  getRecommendedDifficultyRange,
} from '../game/tacticsStore.js';

/**
 * 挂载题库面板。
 *
 * @param {HTMLElement} container - 挂载点
 * @param {object} options
 * @param {function} options.onMove - 玩家走棋回调 (uci) => void
 * @param {function} options.setFen - 设置棋盘 FEN 的回调 (fen) => void
 * @returns {{ update: function, destroy: function, loadProblems: function }}
 */
export function mountTacticsPanel(container, { onMove, setFen }) {
  container.innerHTML = '';
  container.classList.add('tactics-panel');

  const state = {
    problems: [],
    currentIndex: 0,
    currentMoveIndex: 0,
    status: 'idle', // idle | solving | correct | incorrect | complete
    importMode: 'file', // file | text
    viewMode: 'practice', // practice | list
    filter: {
      favoritesOnly: false,
      unsolvedOnly: false,
      searchText: '',
      difficultyMode: 'auto', // auto | all | easy | medium | hard
    },
    setFen,
  };

  // 视图切换
  const viewToggle = createViewToggle(state, () => renderPanel(state, container));
  container.appendChild(viewToggle);

  // 导入区域
  const importSection = createImportSection(state, () => {
    if (state.problems.length > 0) {
      showProblem(state, 0);
      state.viewMode = 'practice';
      renderPanel(state, container);
    }
  });
  container.appendChild(importSection);

  // 主内容区域（做题或列表）
  const contentArea = document.createElement('div');
  contentArea.className = 'tactics-content';
  contentArea.id = 'tactics-content';
  container.appendChild(contentArea);

  // 初始渲染
  renderPanel(state, container);

  return {
    update(newProblems) {
      state.problems = newProblems;
      state.currentIndex = 0;
      if (newProblems.length > 0) {
        showProblem(state, 0);
      }
      renderPanel(state, container);
    },
    destroy() {
      container.innerHTML = '';
    },
    loadProblems(problems) {
      state.problems = problems;
      state.currentIndex = 0;
      if (problems.length > 0) {
        showProblem(state, 0);
      }
      renderPanel(state, container);
    },
    getState() {
      return { ...state };
    },
    checkMove(uci) {
      return handlePlayerMove(state, uci, () => renderPanel(state, container));
    },
  };
}

function renderPanel(state, container) {
  const contentArea = container.querySelector('#tactics-content') || container.querySelector('.tactics-content');
  if (!contentArea) return;

  contentArea.innerHTML = '';

  if (state.viewMode === 'practice') {
    renderPracticeView(state, contentArea, container);
  } else {
    renderListView(state, contentArea, container);
  }
}

function createViewToggle(state, onRender) {
  const div = document.createElement('div');
  div.className = 'tactics-view-toggle';

  const practiceBtn = document.createElement('button');
  practiceBtn.type = 'button';
  practiceBtn.className = `btn btn-ghost ${state.viewMode === 'practice' ? 'active' : ''}`;
  practiceBtn.textContent = '做题';
  practiceBtn.addEventListener('click', () => {
    state.viewMode = 'practice';
    onRender();
  });

  const listBtn = document.createElement('button');
  listBtn.type = 'button';
  listBtn.className = `btn btn-ghost ${state.viewMode === 'list' ? 'active' : ''}`;
  listBtn.textContent = '列表';
  listBtn.addEventListener('click', () => {
    state.viewMode = 'list';
    onRender();
  });

  div.appendChild(practiceBtn);
  div.appendChild(listBtn);

  return div;
}

function renderPracticeView(state, contentArea, container) {
  // 题目展示区域
  const problemSection = createProblemSection(state);
  contentArea.appendChild(problemSection);

  // 导航区域
  const navSection = createNavSection(state, () => renderPanel(state, container));
  contentArea.appendChild(navSection);

  // 更新显示
  updateDisplay(state, container);
}

function renderListView(state, contentArea, container) {
  // 筛选控制
  const filterSection = createFilterSection(state, () => renderPanel(state, container));
  contentArea.appendChild(filterSection);

  // 统计信息
  const statsSection = createStatsSection(state, () => renderPanel(state, container));
  contentArea.appendChild(statsSection);

  // 题目集管理
  const setsSection = createProblemSetsSection(state, () => renderPanel(state, container));
  contentArea.appendChild(setsSection);

  // 题目列表
  const listSection = createProblemListSection(state, () => renderPanel(state, container));
  contentArea.appendChild(listSection);
}

function createFilterSection(state, onRender) {
  const section = document.createElement('div');
  section.className = 'tactics-section tactics-filter';

  const title = document.createElement('h3');
  title.textContent = '筛选';
  section.appendChild(title);

  // 搜索框
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'tactics-search';
  searchInput.placeholder = '搜索题目 ID 或标签...';
  searchInput.value = state.filter.searchText;
  searchInput.addEventListener('input', (e) => {
    state.filter.searchText = e.target.value;
    onRender();
  });
  section.appendChild(searchInput);

  // 筛选选项
  const options = document.createElement('div');
  options.className = 'tactics-filter-options';

  const favLabel = document.createElement('label');
  favLabel.className = 'tactics-filter-option';
  const favCheckbox = document.createElement('input');
  favCheckbox.type = 'checkbox';
  favCheckbox.checked = state.filter.favoritesOnly;
  favCheckbox.addEventListener('change', () => {
    state.filter.favoritesOnly = favCheckbox.checked;
    onRender();
  });
  favLabel.appendChild(favCheckbox);
  favLabel.appendChild(document.createTextNode('仅收藏'));
  options.appendChild(favLabel);

  const unsolvedLabel = document.createElement('label');
  unsolvedLabel.className = 'tactics-filter-option';
  const unsolvedCheckbox = document.createElement('input');
  unsolvedCheckbox.type = 'checkbox';
  unsolvedCheckbox.checked = state.filter.unsolvedOnly;
  unsolvedCheckbox.addEventListener('change', () => {
    state.filter.unsolvedOnly = unsolvedCheckbox.checked;
    onRender();
  });
  unsolvedLabel.appendChild(unsolvedCheckbox);
  unsolvedLabel.appendChild(document.createTextNode('仅未做'));
  options.appendChild(unsolvedLabel);

  section.appendChild(options);

  // 难度选择器
  const difficultyLabel = document.createElement('div');
  difficultyLabel.className = 'tactics-difficulty-label';
  difficultyLabel.textContent = '难度模式';
  section.appendChild(difficultyLabel);

  const difficultyOptions = document.createElement('div');
  difficultyOptions.className = 'tactics-filter-options';

  const userRating = getUserRating();
  const range = getRecommendedDifficultyRange(userRating);
  const difficultyModes = [
    { value: 'auto', label: `自动 (${range.min}-${range.max})` },
    { value: 'all', label: '全部' },
    { value: 'easy', label: '简单' },
    { value: 'medium', label: '中等' },
    { value: 'hard', label: '困难' },
  ];

  for (const mode of difficultyModes) {
    const label = document.createElement('label');
    label.className = 'tactics-filter-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'difficulty-mode';
    radio.value = mode.value;
    radio.checked = state.filter.difficultyMode === mode.value;
    radio.addEventListener('change', () => {
      state.filter.difficultyMode = mode.value;
      onRender();
    });
    label.appendChild(radio);
    label.appendChild(document.createTextNode(mode.label));
    difficultyOptions.appendChild(label);
  }

  section.appendChild(difficultyOptions);

  return section;
}

function createStatsSection(state, onRender) {
  const section = document.createElement('div');
  section.className = 'tactics-section tactics-stats';

  const stats = getStats();

  const title = document.createElement('h3');
  title.textContent = '统计';
  section.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'tactics-stats-grid';

  const userRating = getUserRating();
  const items = [
    { label: '总题目', value: stats.total },
    { label: '已收藏', value: stats.favorites },
    { label: '已解决', value: stats.solved },
    { label: '总尝试', value: stats.attempts },
    { label: '我的评级', value: userRating },
  ];

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'tactics-stat';
    div.innerHTML = `<span class="stat-value">${item.value}</span><span class="stat-label">${item.label}</span>`;
    grid.appendChild(div);
  }

  section.appendChild(grid);

  // 随机练习按钮
  const filtered = state ? getFilteredProblems(state) : [];
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'btn btn-primary tactics-random-btn';
  randomBtn.textContent = `🎲 开始随机练习${filtered.length > 0 ? ` (${filtered.length} 题)` : ''}`;
  randomBtn.disabled = filtered.length === 0;
  randomBtn.addEventListener('click', () => {
    if (filtered.length === 0) return;
    // 随机选择一道题
    const randomIndex = Math.floor(Math.random() * filtered.length);
    const randomProblem = filtered[randomIndex];
    const actualIndex = state.problems.findIndex(p => p.id === randomProblem.id);
    if (actualIndex !== -1) {
      showProblem(state, actualIndex);
      state.viewMode = 'practice';
      onRender();
    }
  });
  section.appendChild(randomBtn);

  return section;
}

function createProblemSetsSection(state, onRender) {
  const section = document.createElement('div');
  section.className = 'tactics-section tactics-sets';

  const title = document.createElement('h3');
  title.textContent = '题目集';
  section.appendChild(title);

  const setNames = getProblemSetNames();

  if (setNames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tactics-empty';
    empty.textContent = '暂无保存的题目集';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'tactics-sets-list';

    for (const name of setNames) {
      const item = document.createElement('div');
      item.className = 'tactics-set-item';

      const info = document.createElement('span');
      info.textContent = name;
      item.appendChild(info);

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-ghost btn-sm';
      loadBtn.textContent = '加载';
      loadBtn.addEventListener('click', () => {
        const problems = loadProblemSet(name);
        if (problems) {
          state.problems = problems;
          state.currentIndex = 0;
          state.viewMode = 'practice';
          if (problems.length > 0) {
            showProblem(state, 0);
          }
          onRender();
        }
      });
      item.appendChild(loadBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-ghost btn-sm btn-danger';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', () => {
        if (confirm(`确定删除题目集"${name}"？`)) {
          deleteProblemSet(name);
          onRender();
        }
      });
      item.appendChild(deleteBtn);

      list.appendChild(item);
    }

    section.appendChild(list);
  }

  // 保存当前题目集
  if (state.problems.length > 0) {
    const saveArea = document.createElement('div');
    saveArea.className = 'tactics-save-set';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tactics-set-name-input';
    input.placeholder = '输入题目集名称...';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-primary btn-sm';
    saveBtn.textContent = '保存当前';
    saveBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        alert('请输入题目集名称');
        return;
      }
      saveProblemSet(name, state.problems);
      input.value = '';
      onRender();
    });

    saveArea.appendChild(input);
    saveArea.appendChild(saveBtn);
    section.appendChild(saveArea);
  }

  return section;
}

function createProblemListSection(state, onRender) {
  const section = document.createElement('div');
  section.className = 'tactics-section tactics-list';

  const title = document.createElement('h3');
  title.textContent = `题目列表 (${getFilteredProblems(state).length})`;
  section.appendChild(title);

  const filtered = getFilteredProblems(state);

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tactics-empty';
    empty.textContent = state.problems.length === 0 ? '暂无题目，请先导入' : '没有匹配的题目';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'tactics-problem-list';

    for (const problem of filtered) {
      const item = createProblemListItem(problem, state, onRender);
      list.appendChild(item);
    }

    section.appendChild(list);
  }

  return section;
}

function getFilteredProblems(state) {
  let filtered = [...state.problems];

  // 收藏筛选
  if (state.filter.favoritesOnly) {
    filtered = filtered.filter(p => isFavorite(p.id));
  }

  // 未做筛选
  if (state.filter.unsolvedOnly) {
    filtered = filtered.filter(p => {
      const prog = getProgress(p.id);
      return !prog || !prog.solved;
    });
  }

  // 难度筛选
  if (state.filter.difficultyMode !== 'all') {
    const userRating = getUserRating();
    const range = getRecommendedDifficultyRange(userRating);

    if (state.filter.difficultyMode === 'auto') {
      // 自动模式：推荐难度范围
      filtered = filtered.filter(p => {
        const diff = p.difficulty || 1000;
        return diff >= range.min && diff <= range.max;
      });
    } else if (state.filter.difficultyMode === 'easy') {
      // 简单：低于用户评级 200+
      filtered = filtered.filter(p => {
        const diff = p.difficulty || 1000;
        return diff < userRating - 100;
      });
    } else if (state.filter.difficultyMode === 'medium') {
      // 中等：用户评级附近 ±200
      filtered = filtered.filter(p => {
        const diff = p.difficulty || 1000;
        return diff >= userRating - 200 && diff <= userRating + 200;
      });
    } else if (state.filter.difficultyMode === 'hard') {
      // 困难：高于用户评级 200+
      filtered = filtered.filter(p => {
        const diff = p.difficulty || 1000;
        return diff > userRating + 100;
      });
    }
  }

  // 搜索
  if (state.filter.searchText) {
    const search = state.filter.searchText.toLowerCase();
    filtered = filtered.filter(p => {
      if (p.id.toLowerCase().includes(search)) return true;
      if (p.tags && p.tags.some(t => t.toLowerCase().includes(search))) return true;
      return false;
    });
  }

  return filtered;
}

function createProblemListItem(problem, state, onRender) {
  const item = document.createElement('div');
  item.className = 'tactics-problem-item';

  const progress = getProgress(problem.id);
  const fav = isFavorite(problem.id);

  // 左侧信息
  const info = document.createElement('div');
  info.className = 'problem-info';

  const idSpan = document.createElement('span');
  idSpan.className = 'problem-id';
  idSpan.textContent = problem.id;
  info.appendChild(idSpan);

  if (problem.tags && problem.tags.length > 0) {
    const tagsSpan = document.createElement('span');
    tagsSpan.className = 'problem-tags';
    tagsSpan.textContent = problem.tags.join(', ');
    info.appendChild(tagsSpan);
  }

  if (problem.difficulty) {
    const diffSpan = document.createElement('span');
    diffSpan.className = 'problem-difficulty';
    diffSpan.textContent = `难度 ${problem.difficulty}`;
    info.appendChild(diffSpan);
  }

  item.appendChild(info);

  // 右侧状态
  const status = document.createElement('div');
  status.className = 'problem-status';

  if (progress) {
    const progSpan = document.createElement('span');
    progSpan.className = `problem-progress ${progress.solved ? 'solved' : 'attempted'}`;
    progSpan.textContent = progress.solved ? `✓ ${progress.attempts}次` : `${progress.attempts}次`;
    status.appendChild(progSpan);
  }

  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = `btn-icon fav-btn ${fav ? 'active' : ''}`;
  favBtn.textContent = fav ? '★' : '☆';
  favBtn.title = fav ? '取消收藏' : '收藏';
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(problem.id);
    onRender();
  });
  status.appendChild(favBtn);

  item.appendChild(status);

  // 点击加载题目
  item.addEventListener('click', () => {
    const idx = state.problems.findIndex(p => p.id === problem.id);
    if (idx >= 0) {
      state.currentIndex = idx;
      state.viewMode = 'practice';
      showProblem(state, idx);
      onRender();
    }
  });

  return item;
}

function createImportSection(state, onLoaded) {
  const section = document.createElement('div');
  section.className = 'tactics-section tactics-import';

  const title = document.createElement('h3');
  title.textContent = '导入题目';
  section.appendChild(title);

  // 模式切换
  const modeTabs = document.createElement('div');
  modeTabs.className = 'tactics-tabs';

  const fileTab = document.createElement('button');
  fileTab.type = 'button';
  fileTab.className = 'tactics-tab active';
  fileTab.textContent = '文件上传';
  fileTab.addEventListener('click', () => switchImportMode(state, section, 'file'));

  const textTab = document.createElement('button');
  textTab.type = 'button';
  textTab.className = 'tactics-tab';
  textTab.textContent = '文本粘贴';
  textTab.addEventListener('click', () => switchImportMode(state, section, 'text'));

  modeTabs.appendChild(fileTab);
  modeTabs.appendChild(textTab);
  section.appendChild(modeTabs);

  // 文件上传
  const fileArea = document.createElement('div');
  fileArea.className = 'tactics-file-area';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pgn,.txt';
  fileInput.className = 'tactics-file-input';
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const problems = importAuto(ev.target.result);
          state.problems = problems;
          state.currentIndex = 0;
          if (problems.length > 0) {
            showProblem(state, 0);
          }
          showImportResult(section, `成功导入 ${problems.length} 道题目`);
          onLoaded();
        } catch (err) {
          showImportResult(section, `导入失败：${err.message}`, true);
        }
      };
      reader.readAsText(file);
    }
  });

  const fileLabel = document.createElement('label');
  fileLabel.className = 'tactics-file-label';
  fileLabel.textContent = '点击选择 PGN 文件';
  fileLabel.appendChild(fileInput);

  fileArea.appendChild(fileLabel);
  section.appendChild(fileArea);

  // 文本输入
  const textArea = document.createElement('div');
  textArea.className = 'tactics-text-area';
  textArea.style.display = 'none';

  const textarea = document.createElement('textarea');
  textarea.className = 'tactics-textarea';
  textarea.placeholder = '粘贴 PGN 或 FEN 内容...\n\nPGN 示例：\n1. e4 e5 2. Nf3 Nc6\n\nFEN 示例（需附带解法）：\nfen: r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4\nsolution: Qxf7+';
  textarea.rows = 6;

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn btn-primary';
  importBtn.textContent = '导入';
  importBtn.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) return;

    try {
      // 尝试检测格式
      if (text.startsWith('fen:') || text.includes('\nsolution:')) {
        // FEN + solution 格式
        const problems = parseFenSolutionFormat(text);
        state.problems = problems;
        state.currentIndex = 0;
        if (problems.length > 0) {
          showProblem(state, 0);
        }
        showImportResult(section, `成功导入 ${problems.length} 道题目`);
      } else {
        // PGN 格式
        const problems = importAuto(text);
        state.problems = problems;
        state.currentIndex = 0;
        if (problems.length > 0) {
          showProblem(state, 0);
        }
        showImportResult(section, `成功导入 ${problems.length} 道题目`);
      }
      onLoaded();
    } catch (err) {
      showImportResult(section, `导入失败：${err.message}`, true);
    }
  });

  textArea.appendChild(textarea);
  textArea.appendChild(importBtn);
  section.appendChild(textArea);

  // 结果提示
  const resultDiv = document.createElement('div');
  resultDiv.className = 'tactics-import-result';
  section.appendChild(resultDiv);

  return section;
}

function switchImportMode(state, section, mode) {
  state.importMode = mode;
  const tabs = section.querySelectorAll('.tactics-tab');
  tabs.forEach((tab, i) => {
    tab.classList.toggle('active', (i === 0 && mode === 'file') || (i === 1 && mode === 'text'));
  });

  const fileArea = section.querySelector('.tactics-file-area');
  const textArea = section.querySelector('.tactics-text-area');
  if (fileArea) fileArea.style.display = mode === 'file' ? '' : 'none';
  if (textArea) textArea.style.display = mode === 'text' ? '' : 'none';
}

function showImportResult(section, message, isError = false) {
  const resultDiv = section.querySelector('.tactics-import-result');
  if (resultDiv) {
    resultDiv.textContent = message;
    resultDiv.className = `tactics-import-result ${isError ? 'error' : 'success'}`;
  }
}

function parseFenSolutionFormat(text) {
  const problems = [];
  const blocks = text.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let fen = null;
    let solution = null;
    let difficulty = null;

    for (const line of lines) {
      if (line.startsWith('fen:')) {
        fen = line.slice(4).trim();
      } else if (line.startsWith('solution:')) {
        const solText = line.slice(9).trim();
        solution = solText.split(/[\s,]+/).filter(Boolean);
      } else if (line.startsWith('difficulty:')) {
        const diffText = line.slice(11).trim();
        const parsed = parseInt(diffText, 10);
        if (!isNaN(parsed) && parsed >= 100 && parsed <= 3000) {
          difficulty = parsed;
        }
      }
    }

    if (fen && solution) {
      try {
        // 检查 solution 是 UCI 还是 SAN 格式，如果是 SAN 则转换为 UCI
        const isUci = solution.every(m => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
        let uciSolution;
        if (isUci) {
          uciSolution = solution;
        } else {
          uciSolution = sanToUci(fen, solution);
        }
        const options = {};
        if (difficulty !== null) {
          options.difficulty = difficulty;
        }
        const problem = problemFromFen(fen, uciSolution, options);
        problems.push(problem);
      } catch (e) {
        console.warn(`Skipping invalid problem: ${e.message}`);
      }
    }
  }

  return problems;
}

function createProblemSection(state) {
  const section = document.createElement('div');
  section.className = 'tactics-section tactics-problem';

  const header = document.createElement('div');
  header.className = 'tactics-problem-header';

  const counter = document.createElement('span');
  counter.className = 'tactics-counter';
  header.appendChild(counter);

  const statusBadge = document.createElement('span');
  statusBadge.className = 'tactics-status';
  header.appendChild(statusBadge);

  section.appendChild(header);

  const hint = document.createElement('div');
  hint.className = 'tactics-hint';
  section.appendChild(hint);

  const feedback = document.createElement('div');
  feedback.className = 'tactics-feedback';
  section.appendChild(feedback);

  return section;
}

function createNavSection(state, onUpdate) {
  const section = document.createElement('div');
  section.className = 'tactics-section tactics-nav';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'btn btn-ghost';
  prevBtn.textContent = '← 上一题';
  prevBtn.addEventListener('click', () => {
    if (state.currentIndex > 0) {
      showProblem(state, state.currentIndex - 1);
      onUpdate();
    }
  });

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-ghost';
  retryBtn.textContent = '重做';
  retryBtn.addEventListener('click', () => {
    showProblem(state, state.currentIndex);
    onUpdate();
  });

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'btn btn-primary';
  nextBtn.textContent = '下一题 →';
  nextBtn.addEventListener('click', () => {
    if (state.currentIndex < state.problems.length - 1) {
      showProblem(state, state.currentIndex + 1);
      onUpdate();
    }
  });

  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'btn btn-ghost';
  randomBtn.textContent = '🎲 随机一题';
  randomBtn.addEventListener('click', () => {
    const filtered = getFilteredProblems(state);
    if (filtered.length === 0) return;
    const randomIndex = Math.floor(Math.random() * filtered.length);
    const randomProblem = filtered[randomIndex];
    const actualIndex = state.problems.findIndex(p => p.id === randomProblem.id);
    if (actualIndex !== -1) {
      showProblem(state, actualIndex);
      onUpdate();
    }
  });

  const showSolutionBtn = document.createElement('button');
  showSolutionBtn.type = 'button';
  showSolutionBtn.className = 'btn btn-ghost';
  showSolutionBtn.textContent = '显示答案';
  showSolutionBtn.addEventListener('click', () => {
    state.status = 'showing-solution';
    onUpdate();
  });

  const btnGroup = document.createElement('div');
  btnGroup.className = 'tactics-btn-group';
  btnGroup.appendChild(prevBtn);
  btnGroup.appendChild(retryBtn);
  btnGroup.appendChild(showSolutionBtn);
  btnGroup.appendChild(nextBtn);
  btnGroup.appendChild(randomBtn);

  section.appendChild(btnGroup);

  return section;
}

function showProblem(state, index) {
  state.currentIndex = index;
  state.currentMoveIndex = 0;
  state.status = 'solving';
  // 设置棋盘到题目局面
  const problem = state.problems[index];
  if (problem && state.setFen) {
    state.setFen(problem.fen);
  }
}

function updateDisplay(state, container) {
  const problem = state.problems[state.currentIndex];

  // 更新计数器
  const counter = container.querySelector('.tactics-counter');
  if (counter) {
    if (state.problems.length === 0) {
      counter.textContent = '暂无题目';
    } else {
      counter.textContent = `第 ${state.currentIndex + 1} / ${state.problems.length} 题`;
    }
  }

  // 更新状态徽章
  const statusBadge = container.querySelector('.tactics-status');
  if (statusBadge) {
    const statusMap = {
      idle: '',
      solving: '解题中',
      correct: '✓ 正确',
      incorrect: '✗ 错误',
      complete: '已完成',
      'showing-solution': '查看答案',
    };
    statusBadge.textContent = statusMap[state.status] || '';
    statusBadge.className = `tactics-status status-${state.status}`;
  }

  // 更新提示
  const hint = container.querySelector('.tactics-hint');
  if (hint) {
    if (problem) {
      const turn = problem.fen.split(' ')[1] === 'w' ? '白方' : '黑方';
      hint.textContent = `${turn}走棋，找到最佳走法`;
      if (problem.tags && problem.tags.length > 0) {
        hint.textContent += ` (${problem.tags.join(', ')})`;
      }
    } else {
      hint.textContent = '';
    }
  }

  // 更新反馈
  const feedback = container.querySelector('.tactics-feedback');
  if (feedback) {
    if (state.status === 'correct') {
      feedback.textContent = '正确！';
      feedback.className = 'tactics-feedback feedback-correct';
    } else if (state.status === 'incorrect') {
      feedback.textContent = '不对，再想想？或者点击"显示答案"';
      feedback.className = 'tactics-feedback feedback-incorrect';
    } else if (state.status === 'showing-solution' && problem) {
      feedback.textContent = `答案：${problem.solution.join(', ')}`;
      feedback.className = 'tactics-feedback feedback-solution';
    } else {
      feedback.textContent = '';
      feedback.className = 'tactics-feedback';
    }
  }

  // 更新导航按钮状态
  const prevBtn = container.querySelector('.tactics-nav button:first-child');
  const nextBtn = container.querySelector('.tactics-nav .btn-primary');
  if (prevBtn) prevBtn.disabled = state.currentIndex === 0;
  if (nextBtn) nextBtn.disabled = state.currentIndex >= state.problems.length - 1;
}

function handlePlayerMove(state, uci, onUpdate) {
  if (state.status !== 'solving') return false;

  const problem = state.problems[state.currentIndex];
  if (!problem) return false;

  const expectedMove = problem.solution[state.currentMoveIndex];
  if (!expectedMove) return false;

  if (uci === expectedMove) {
    state.currentMoveIndex++;
    if (state.currentMoveIndex >= problem.solution.length) {
      state.status = 'correct';
      // 记录成功尝试
      recordAttempt(problem.id, true);
      // 更新评级
      const difficulty = problem.difficulty || 1000;
      const result = updateRating(difficulty, true);
      console.log(`Rating: ${result.oldRating} → ${result.newRating} (+${result.change})`);
    }
    onUpdate();
    return true;
  } else {
    state.status = 'incorrect';
    // 记录失败尝试
    recordAttempt(problem.id, false);
    // 更新评级（仅首次错误时扣一次，避免重复扣分）
    if (state.currentMoveIndex === 0) {
      const difficulty = problem.difficulty || 1000;
      const result = updateRating(difficulty, false);
      console.log(`Rating: ${result.oldRating} → ${result.newRating} (${result.change})`);
    }
    onUpdate();
    return false;
  }
}
