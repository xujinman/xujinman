const STORAGE_KEYS = {
  tasks: 'yantu.tasks.v1',
  school: 'yantu.school.v1',
  progress: 'yantu.progress.v1',
  notes: 'yantu.notes.v1',
  scores: 'yantu.scores.v1',
  focus: 'yantu.focus.v1'
};
const LEGACY_STORAGE_KEYS = { ...STORAGE_KEYS };
let activeUser = null;
const remoteSyncTimers = new Map();
const remoteSyncPayloads = new Map();

const subjectMeta = {
  '数学': { className: 'math', defaultNote: '高数强化、线代基础' },
  '英语': { className: 'english', defaultNote: '阅读真题、单词二轮' },
  '政治': { className: 'politics', defaultNote: '马原基础、每日选择题' },
  '专业课': { className: 'major', defaultNote: '知识框架、真题整理' }
};

const scoreSubjects = ['政治', '英语', '数学', '专业课'];
const scoreSubjectClasses = { '政治': 'politics', '英语': 'english', '数学': 'math', '专业课': 'major' };
const scoreFullMarks = { '政治': 100, '英语': 100, '数学': 150, '专业课': 150 };

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function storageTypeFromKey(key) {
  return Object.keys(STORAGE_KEYS).find(type => STORAGE_KEYS[type] === key) || null;
}

async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body !== undefined && !(options.body instanceof Blob) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers });
  if (!response.ok) {
    let message = '请求失败，请稍后重试';
    try { message = (await response.json()).error || message; } catch { /* ignore invalid error response */ }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function flushRemoteWrite(type) {
  if (!activeUser || !remoteSyncPayloads.has(type)) return;
  const payload = remoteSyncPayloads.get(type);
  remoteSyncPayloads.delete(type);
  remoteSyncTimers.delete(type);
  try {
    await api(`/data/${type}`, { method: 'PUT', body: JSON.stringify(payload) });
  } catch (error) {
    console.error(error);
    showToast(`保存失败：${error.message}`);
  }
}

function queueRemoteWrite(type, value) {
  remoteSyncPayloads.set(type, cloneData(value));
  clearTimeout(remoteSyncTimers.get(type));
  remoteSyncTimers.set(type, setTimeout(() => flushRemoteWrite(type), 220));
}

async function flushAllRemoteWrites() {
  [...remoteSyncTimers.values()].forEach(clearTimeout);
  await Promise.all([...remoteSyncPayloads.keys()].map(flushRemoteWrite));
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    const type = storageTypeFromKey(key);
    if (activeUser && type) queueRemoteWrite(type, value);
    return true;
  } catch {
    return false;
  }
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const today = formatLocalDate();
const defaultTasks = [
  { id: 1, title: '高数：完成多元函数微分练习', subject: '数学', duration: 90, priority: '高', date: today, done: true },
  { id: 2, title: '英语：背诵核心词汇 100 个', subject: '英语', duration: 45, priority: '中', date: today, done: true },
  { id: 3, title: '专业课：整理第三章知识框架', subject: '专业课', duration: 120, priority: '高', date: today, done: true },
  { id: 4, title: '政治：完成马原选择题 30 道', subject: '政治', duration: 40, priority: '中', date: today, done: false },
  { id: 5, title: '英语：精读 2019 年真题阅读', subject: '英语', duration: 60, priority: '高', date: today, done: false },
  { id: 6, title: '数学：复盘昨日错题', subject: '数学', duration: 35, priority: '低', date: today, done: false }
];

let tasks = readStorage(STORAGE_KEYS.tasks, defaultTasks).map(task => ({
  priority: '中', date: today, ...task
}));

const defaultSchool = {
  schoolName: '浙江大学',
  majorName: '计算机科学与技术',
  examDate: '2026-12-19',
  scores: { '政治': 70, '英语': 75, '数学': 130, '专业课': 125 }
};
let school = readStorage(STORAGE_KEYS.school, cloneData(defaultSchool));

const defaultProgress = {
  '数学': { percent: 68, stage: '强化阶段', note: '高数强化、线代基础' },
  '英语': { percent: 74, stage: '强化阶段', note: '阅读真题、单词二轮' },
  '政治': { percent: 35, stage: '基础阶段', note: '马原基础、每日选择题' },
  '专业课': { percent: 61, stage: '强化阶段', note: '知识框架、真题整理' }
};
let progress = readStorage(STORAGE_KEYS.progress, cloneData(defaultProgress));

const defaultNotes = [
  { id: 101, title: '二重积分换元法易错点', subject: '数学', type: '错题', content: '换元后不要忘记乘雅可比行列式，并重新判断积分区域。做题时先画出区域，再决定积分次序。', images: [], pinned: true, createdAt: Date.now() - 86400000 * 2, updatedAt: Date.now() - 86400000 * 2 },
  { id: 102, title: '英语阅读：主旨题判断方法', subject: '英语', type: '知识点', content: '优先关注首尾段、各段首句和转折之后的内容。选项如果只覆盖某一段，通常不是全文主旨。', images: [], pinned: false, createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000 },
  { id: 103, title: '本周复习复盘', subject: '其他', type: '复盘', content: '数学计算速度有所提升，下周继续强化线代；政治选择题需要增加每日练习量。', images: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }
];
let notes = readStorage(STORAGE_KEYS.notes, cloneData(defaultNotes));

const defaultScoreRecords = [
  { id: 'p-1', name: '6 月政治摸底', date: '2026-06-15', subject: '政治', score: 61, review: '选择题中的马原部分失分较多。' },
  { id: 'p-2', name: '7 月政治阶段测验', date: '2026-07-06', subject: '政治', score: 65, review: '选择题正确率有所提高。' },
  { id: 'p-3', name: '7 月政治综合测验', date: '2026-07-27', subject: '政治', score: 68, review: '继续巩固易混知识点。' },
  { id: 'e-1', name: '6 月英语真题测验', date: '2026-06-16', subject: '英语', score: 66, review: '阅读速度需要提升。' },
  { id: 'e-2', name: '7 月英语阶段测验', date: '2026-07-08', subject: '英语', score: 69, review: '长难句理解更加稳定。' },
  { id: 'e-3', name: '7 月英语真题测验', date: '2026-07-28', subject: '英语', score: 72, review: '作文仍需积累表达。' },
  { id: 'm-1', name: '6 月数学摸底', date: '2026-06-18', subject: '数学', score: 91, review: '基础题计算失分较多。' },
  { id: 'm-2', name: '7 月数学阶段测验', date: '2026-07-10', subject: '数学', score: 99, review: '线代部分需要加强。' },
  { id: 'm-3', name: '7 月数学综合测验', date: '2026-07-29', subject: '数学', score: 106, review: '注意提高计算准确率。' },
  { id: 'z-1', name: '6 月专业课摸底', date: '2026-06-20', subject: '专业课', score: 88, review: '主观题答题框架不够完整。' },
  { id: 'z-2', name: '7 月专业课阶段测验', date: '2026-07-12', subject: '专业课', score: 93, review: '知识点覆盖仍有遗漏。' },
  { id: 'z-3', name: '7 月专业课综合测验', date: '2026-07-30', subject: '专业课', score: 96, review: '继续补充真题答题模板。' }
];

function normalizeScoreRecords(records) {
  return records.flatMap(record => {
    if (!record.scores) return [{ ...record, score: Number(record.score) || 0 }];
    return scoreSubjects.map((subject, index) => ({
      id: `${record.id}-${index}`,
      name: record.name,
      date: record.date,
      subject,
      score: Number(record.scores[subject]) || 0,
      review: record.review || ''
    }));
  });
}

const storedScoreRecords = readStorage(STORAGE_KEYS.scores, defaultScoreRecords);
const scoreDataNeededMigration = storedScoreRecords.some(record => record.scores);
let scoreRecords = normalizeScoreRecords(storedScoreRecords);
if (scoreDataNeededMigration) writeStorage(STORAGE_KEYS.scores, scoreRecords);

function normalizeFocusSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).filter(session => {
    const duration = Number(session.durationSeconds);
    return session.id && ['countdown', 'stopwatch'].includes(session.mode) && Number.isFinite(duration) && duration > 0 && !Number.isNaN(new Date(session.endedAt).getTime());
  }).map(session => ({
    id: String(session.id),
    subject: String(session.subject || '其他'),
    mode: session.mode,
    startedAt: session.startedAt || session.endedAt,
    endedAt: session.endedAt,
    durationSeconds: Math.round(Number(session.durationSeconds))
  }));
}

let focusSessions = normalizeFocusSessions(readStorage(STORAGE_KEYS.focus, []));

const legacyDataSnapshot = {
  tasks: cloneData(tasks),
  school: cloneData(school),
  progress: cloneData(progress),
  notes: cloneData(notes),
  scores: cloneData(scoreRecords),
  focus: cloneData(focusSessions)
};
const emptyUserSnapshot = {
  tasks: [],
  school: { schoolName: '', majorName: '', examDate: '', scores: { '政治': 0, '英语': 0, '数学': 0, '专业课': 0 } },
  progress: Object.fromEntries(Object.keys(subjectMeta).map(subject => [subject, { percent: 0, stage: '基础阶段', note: '' }])),
  notes: [],
  scores: [],
  focus: []
};

const taskList = document.getElementById('taskList');
const allTaskList = document.getElementById('allTaskList');
const completedCount = document.getElementById('completedCount');
const totalCount = document.getElementById('totalCount');
const taskRate = document.getElementById('taskRate');
const taskDateFilter = document.getElementById('taskDateFilter');
let taskStatus = 'all';

function getSelectedDateTasks() {
  const date = taskDateFilter.value || today;
  return tasks.filter(task => task.date === date);
}

function taskMarkup(task, full = false) {
  return `
    <div class="task-item ${task.done ? 'done' : ''}" data-id="${task.id}">
      <input class="task-check" type="checkbox" ${task.done ? 'checked' : ''} aria-label="${task.done ? '恢复' : '完成'}任务" />
      <div class="task-main"><strong>${escapeHtml(task.title)}</strong><span>预计 ${task.duration} 分钟${full ? ` · ${escapeHtml(task.priority)}优先级` : ''}</span></div>
      <span class="subject-tag ${task.subject}">${escapeHtml(task.subject)}</span>
      ${full ? '<button class="delete-task" type="button" aria-label="删除任务">×</button>' : ''}
    </div>`;
}

function bindTaskInteractions(container) {
  container.querySelectorAll('.task-item').forEach(item => {
    const task = tasks.find(entry => String(entry.id) === item.dataset.id);
    if (!task) return;
    item.querySelector('.task-check').addEventListener('change', event => {
      task.done = event.target.checked;
      saveAndRenderTasks();
    });
    item.querySelector('.delete-task')?.addEventListener('click', () => {
      tasks = tasks.filter(entry => entry.id !== task.id);
      saveAndRenderTasks();
      showToast('任务已删除');
    });
  });
}

function renderTasks() {
  const todayTasks = tasks.filter(task => task.date === today);
  taskList.innerHTML = todayTasks.slice(0, 6).map(task => taskMarkup(task)).join('');
  if (!todayTasks.length) taskList.innerHTML = '<div class="dashboard-empty">今天还没有任务，点击右上角开始规划吧。</div>';
  bindTaskInteractions(taskList);

  const done = todayTasks.filter(task => task.done).length;
  const rate = todayTasks.length ? Math.round(done / todayTasks.length * 100) : 0;
  completedCount.textContent = done;
  totalCount.textContent = todayTasks.length;
  taskRate.textContent = `${rate}%`;

  const selectedTasks = getSelectedDateTasks();
  const visibleTasks = selectedTasks.filter(task => taskStatus === 'all' || (taskStatus === 'done' ? task.done : !task.done));
  allTaskList.innerHTML = visibleTasks.map(task => taskMarkup(task, true)).join('');
  bindTaskInteractions(allTaskList);
  document.getElementById('taskEmptyState').classList.toggle('show', visibleTasks.length === 0);

  const selectedDone = selectedTasks.filter(task => task.done).length;
  document.getElementById('taskPageTotal').textContent = selectedTasks.length;
  document.getElementById('taskPageDone').textContent = selectedDone;
  document.getElementById('taskPageMinutes').textContent = `${selectedTasks.reduce((sum, task) => sum + Number(task.duration), 0)} 分钟`;
  document.getElementById('taskPageRate').textContent = `${selectedTasks.length ? Math.round(selectedDone / selectedTasks.length * 100) : 0}%`;
}

function saveAndRenderTasks() {
  writeStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
}

function daysUntil(dateString) {
  const target = new Date(`${dateString}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Number.isNaN(target.getTime()) ? 0 : Math.max(0, Math.ceil((target - now) / 86400000));
}

function updateDate() {
  const date = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  document.getElementById('todayText').textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`;
  const days = daysUntil(school.examDate);
  document.getElementById('daysLeft').textContent = days;
  document.getElementById('previewDays').textContent = `${days} 天`;
  document.getElementById('countdownDescription').textContent = school.schoolName ? `目标 ${school.schoolName} · ${school.majorName}` : '设置目标院校，让努力更有方向';
}

const modal = document.getElementById('taskModal');
function openTaskModal() {
  document.getElementById('taskDate').value = document.getElementById('tasks-page').classList.contains('active') ? taskDateFilter.value : today;
  modal.classList.add('show');
  setTimeout(() => document.getElementById('taskTitle').focus(), 50);
}

document.getElementById('openTaskModal').addEventListener('click', openTaskModal);
document.querySelector('.page-add-task').addEventListener('click', openTaskModal);
document.getElementById('closeTaskModal').addEventListener('click', () => modal.classList.remove('show'));
modal.addEventListener('click', event => { if (event.target === modal) modal.classList.remove('show'); });

document.getElementById('taskForm').addEventListener('submit', event => {
  event.preventDefault();
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) return;
  tasks.unshift({
    id: Date.now(),
    title,
    subject: document.getElementById('taskSubject').value,
    duration: Math.max(10, Number(document.getElementById('taskDuration').value) || 60),
    date: document.getElementById('taskDate').value || today,
    priority: document.getElementById('taskPriority').value,
    done: false
  });
  saveAndRenderTasks();
  event.target.reset();
  modal.classList.remove('show');
  showToast('新任务已加入计划');
});

taskDateFilter.value = today;
taskDateFilter.addEventListener('change', renderTasks);
document.getElementById('taskStatusFilter').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  taskStatus = button.dataset.status;
  document.querySelectorAll('#taskStatusFilter button').forEach(item => item.classList.toggle('active', item === button));
  renderTasks();
});

function renderProgress() {
  const editor = document.getElementById('progressEditor');
  editor.innerHTML = Object.entries(subjectMeta).map(([subject, meta]) => {
    const item = progress[subject] || { percent: 0, stage: '基础阶段', note: meta.defaultNote };
    return `
      <article class="panel progress-editor-card ${meta.className}" data-subject="${subject}">
        <div class="progress-card-head"><div class="subject-symbol"><i class="dot ${meta.className}"></i></div><div><span>复习科目</span><h3>${subject}</h3></div><strong>${item.percent}%</strong></div>
        <input class="progress-range" type="range" min="0" max="100" value="${item.percent}" aria-label="${subject}复习进度" />
        <div class="progress-scale"><span>0%</span><span>当前进度</span><span>100%</span></div>
        <div class="progress-fields">
          <label>当前阶段<select class="progress-stage"><option ${item.stage === '基础阶段' ? 'selected' : ''}>基础阶段</option><option ${item.stage === '强化阶段' ? 'selected' : ''}>强化阶段</option><option ${item.stage === '冲刺阶段' ? 'selected' : ''}>冲刺阶段</option><option ${item.stage === '查漏补缺' ? 'selected' : ''}>查漏补缺</option></select></label>
          <label>当前复习内容<input class="progress-note" value="${escapeAttribute(item.note)}" placeholder="例如：高数强化、线代基础" /></label>
        </div>
      </article>`;
  }).join('');

  editor.querySelectorAll('.progress-editor-card').forEach(card => {
    const subject = card.dataset.subject;
    const range = card.querySelector('.progress-range');
    const stage = card.querySelector('.progress-stage');
    const note = card.querySelector('.progress-note');
    const paintRange = () => {
      range.style.background = `linear-gradient(to right, var(--range-color) 0%, var(--range-color) ${range.value}%, #e9eef5 ${range.value}%, #e9eef5 100%)`;
    };
    const save = () => {
      progress[subject] = { percent: Number(range.value), stage: stage.value, note: note.value.trim() };
      card.querySelector('.progress-card-head > strong').textContent = `${range.value}%`;
      paintRange();
      writeStorage(STORAGE_KEYS.progress, progress);
      syncProgressToDashboard();
    };
    paintRange();
    range.addEventListener('input', save);
    stage.addEventListener('change', save);
    note.addEventListener('change', save);
  });
  syncProgressToDashboard();
}

function syncProgressToDashboard() {
  let total = 0;
  Object.entries(progress).forEach(([subject, item]) => {
    total += Number(item.percent) || 0;
    const row = document.querySelector(`[data-dashboard-subject="${subject}"]`);
    if (!row) return;
    row.querySelector('b').textContent = `${item.percent}%`;
    row.querySelector('.progress-track span').style.width = `${item.percent}%`;
    row.querySelector('small').textContent = `${item.stage} · ${item.note || '暂未填写复习内容'}`;
  });
  document.getElementById('overallProgress').textContent = `${Math.round(total / Object.keys(subjectMeta).length)}%`;
}

function scoreTotal() {
  return ['scorePolitics', 'scoreEnglish', 'scoreMath', 'scoreMajor'].reduce((sum, id) => sum + (Number(document.getElementById(id).value) || 0), 0);
}

function fillSchoolForm() {
  document.getElementById('schoolName').value = school.schoolName || '';
  document.getElementById('majorName').value = school.majorName || '';
  document.getElementById('examDate').value = school.examDate || '';
  document.getElementById('scorePolitics').value = school.scores['政治'] ?? 0;
  document.getElementById('scoreEnglish').value = school.scores['英语'] ?? 0;
  document.getElementById('scoreMath').value = school.scores['数学'] ?? 0;
  document.getElementById('scoreMajor').value = school.scores['专业课'] ?? 0;
  updateScorePreview();
}

function updateScorePreview() {
  const total = scoreTotal();
  document.getElementById('targetScoreTotal').textContent = total;
  document.getElementById('previewTotalScore').textContent = total;
}

['scorePolitics', 'scoreEnglish', 'scoreMath', 'scoreMajor'].forEach(id => document.getElementById(id).addEventListener('input', updateScorePreview));

document.getElementById('schoolForm').addEventListener('submit', event => {
  event.preventDefault();
  school = {
    schoolName: document.getElementById('schoolName').value.trim(),
    majorName: document.getElementById('majorName').value.trim(),
    examDate: document.getElementById('examDate').value,
    scores: {
      '政治': Number(document.getElementById('scorePolitics').value),
      '英语': Number(document.getElementById('scoreEnglish').value),
      '数学': Number(document.getElementById('scoreMath').value),
      '专业课': Number(document.getElementById('scoreMajor').value)
    }
  };
  writeStorage(STORAGE_KEYS.school, school);
  syncSchoolPreview();
  renderScores();
  const status = document.getElementById('schoolSaveStatus');
  status.textContent = '刚刚已保存';
  status.classList.add('saved');
  setTimeout(() => { status.textContent = '自动保存至本机'; status.classList.remove('saved'); }, 2200);
  showToast('目标院校与分数已保存');
});

function syncSchoolPreview() {
  const total = Object.values(school.scores).reduce((sum, score) => sum + Number(score), 0);
  document.getElementById('previewSchoolName').textContent = school.schoolName || '尚未设置目标院校';
  document.getElementById('previewMajorName').textContent = school.majorName || '请先设置报考专业';
  document.getElementById('previewTotalScore').textContent = total || '--';
  document.getElementById('dashboardScoreTarget').textContent = total ? `/ ${total} 目标` : '/ 暂无目标';
  updateDate();
  syncScoresToDashboard();
}

const scoreModal = document.getElementById('scoreModal');

function sortedScoreRecords() {
  return [...scoreRecords].sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
}

function renderScores() {
  const subject = document.getElementById('trendSubject').value;
  const sorted = sortedScoreRecords().filter(record => record.subject === subject);
  const latest = sorted[0];
  const values = sorted.map(record => Number(record.score) || 0);
  const target = Number(school.scores[subject]) || scoreFullMarks[subject];
  const latestScore = latest ? Number(latest.score) : 0;
  const best = values.length ? Math.max(...values) : 0;
  const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const gap = target - latestScore;

  document.getElementById('latestScoreLabel').textContent = `${subject}最近成绩`;
  document.getElementById('latestScoreSummary').textContent = latestScore;
  document.getElementById('latestExamName').textContent = latest?.name || '暂无记录';
  document.getElementById('bestScoreSummary').textContent = best;
  document.getElementById('averageScoreSummary').textContent = average;
  document.getElementById('scoreFullMarkHint').textContent = `/ ${scoreFullMarks[subject]} 分`;
  document.getElementById('scoreRecordCount').textContent = `共 ${sorted.length} 次${subject}记录`;
  document.getElementById('scoreGapSummary').textContent = latest ? Math.abs(gap) : target;
  document.getElementById('scoreGapHint').textContent = !latest ? '录入成绩后开始分析' : gap > 0 ? `距离 ${target} 分目标` : `已超过目标 ${Math.abs(gap)} 分`;
  document.getElementById('trendChartTitle').textContent = `${subject}成绩曲线`;
  document.getElementById('scoreHistoryTitle').textContent = `${subject}成绩记录`;

  renderScoreTrend();
  renderSubjectScoreAnalysis();
  renderScoreHistory(sorted);
  syncScoresToDashboard();
}

function renderScoreTrend() {
  const subject = document.getElementById('trendSubject').value;
  const records = scoreRecords.filter(record => record.subject === subject).sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const svg = document.getElementById('scoreTrendChart');
  const wrap = document.getElementById('scoreChartWrap');
  const empty = document.getElementById('emptyScoreChart');
  if (!records.length) {
    svg.innerHTML = '';
    wrap.style.display = 'none';
    empty.classList.add('show');
    return;
  }
  wrap.style.display = 'block';
  empty.classList.remove('show');
  const values = records.map(record => Number(record.score) || 0);
  const fullMark = scoreFullMarks[subject];
  const padding = { left: 48, right: 24, top: 24, bottom: 42 };
  const chartWidth = 720 - padding.left - padding.right;
  const chartHeight = 250 - padding.top - padding.bottom;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const stepSize = 10;
  let minValue = Math.max(0, Math.floor((rawMin - stepSize * 2) / stepSize) * stepSize);
  let maxValue = Math.min(fullMark, Math.ceil((rawMax + stepSize * 2) / stepSize) * stepSize);
  if (maxValue <= minValue) maxValue = Math.min(fullMark, minValue + stepSize * 4);
  const xAt = index => records.length === 1 ? padding.left + chartWidth / 2 : padding.left + (chartWidth * index / (records.length - 1));
  const yAt = value => padding.top + chartHeight - ((value - minValue) / (maxValue - minValue) * chartHeight);
  const points = values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ');
  const areaPoints = `${padding.left},${padding.top + chartHeight} ${points} ${xAt(records.length - 1)},${padding.top + chartHeight}`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = padding.top + chartHeight * index / 4;
    const label = Math.round(maxValue - (maxValue - minValue) * index / 4);
    return `<line x1="${padding.left}" y1="${y}" x2="${720 - padding.right}" y2="${y}" class="chart-grid-line"/><text x="${padding.left - 9}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${label}</text>`;
  }).join('');
  const labels = records.map((record, index) => `<text x="${xAt(index)}" y="${250 - 14}" text-anchor="middle" class="chart-axis-label">${escapeHtml(record.date.slice(5).replace('-', '.'))}</text>`).join('');
  const dots = values.map((value, index) => `<g class="score-chart-point"><circle cx="${xAt(index)}" cy="${yAt(value)}" r="5"/><text x="${xAt(index)}" y="${yAt(value) - 11}" text-anchor="middle">${value}</text></g>`).join('');
  svg.innerHTML = `<defs><linearGradient id="scoreAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3567f0" stop-opacity=".25"/><stop offset="1" stop-color="#3567f0" stop-opacity="0"/></linearGradient></defs>${grid}<polygon points="${areaPoints}" fill="url(#scoreAreaGradient)"/><polyline points="${points}" class="score-trend-line"/>${dots}${labels}`;
}

function renderSubjectScoreAnalysis() {
  const container = document.getElementById('subjectScoreAnalysis');
  if (!scoreRecords.length) {
    container.innerHTML = '<div class="analysis-empty">录入成绩后展示单科目标达成情况</div>';
    return;
  }
  container.innerHTML = scoreSubjects.map(subject => {
    const latest = sortedScoreRecords().find(record => record.subject === subject);
    const score = Number(latest?.score) || 0;
    const target = Number(school.scores[subject]) || scoreFullMarks[subject];
    const rate = target ? Math.round(score / target * 100) : 0;
    return `<div class="subject-analysis-row"><div class="subject-analysis-head"><span><i class="dot ${scoreSubjectClasses[subject]}"></i>${subject}</span><b>${latest ? score : '--'} <small>/ ${target} 目标</small></b></div><div class="progress-track"><span class="${scoreSubjectClasses[subject]}-bar" style="width:${latest ? Math.min(rate, 100) : 0}%"></span></div><p><span>${latest ? `更新于 ${latest.date}` : '尚未录入'}</span><em class="${latest && score >= target ? 'reached' : ''}">${!latest ? '等待记录' : score >= target ? '已达标' : `还差 ${target - score} 分`}</em></p></div>`;
  }).join('');
}

function renderScoreHistory(sorted) {
  const body = document.getElementById('scoreHistoryBody');
  body.innerHTML = sorted.map(record => `
    <tr data-id="${record.id}">
      <td><div class="exam-cell"><strong>${escapeHtml(record.name)}</strong>${record.review ? `<small title="${escapeAttribute(record.review)}">${escapeHtml(record.review)}</small>` : ''}</div></td>
      <td>${escapeHtml(record.date)}</td>
      <td><span class="subject-tag ${record.subject}">${escapeHtml(record.subject)}</span></td>
      <td><b class="table-total">${Number(record.score) || 0}</b> / ${scoreFullMarks[record.subject]}</td>
      <td>${Number(school.scores[record.subject]) || scoreFullMarks[record.subject]}</td>
      <td>${Math.round((Number(record.score) || 0) / (Number(school.scores[record.subject]) || scoreFullMarks[record.subject]) * 100)}%</td>
      <td><div class="table-actions"><button class="edit-score" type="button">编辑</button><button class="delete-score" type="button">删除</button></div></td>
    </tr>`).join('');
  document.getElementById('scoreEmptyState').classList.toggle('show', sorted.length === 0);
  document.querySelector('.score-table').classList.toggle('hidden', sorted.length === 0);
  body.querySelectorAll('tr').forEach(row => {
    const record = scoreRecords.find(item => String(item.id) === row.dataset.id);
    if (!record) return;
    row.querySelector('.edit-score').addEventListener('click', () => openScoreEditor(record));
    row.querySelector('.delete-score').addEventListener('click', () => {
      if (!window.confirm(`确定删除“${record.name}”的成绩吗？`)) return;
      scoreRecords = scoreRecords.filter(item => item.id !== record.id);
      writeStorage(STORAGE_KEYS.scores, scoreRecords);
      renderScores();
      showToast('成绩记录已删除');
    });
  });
}

function syncScoresToDashboard() {
  if (!document.getElementById('dashboardLatestTotal')) return;
  const sorted = sortedScoreRecords();
  const latest = sorted[0];
  const latestBySubject = Object.fromEntries(scoreSubjects.map(subject => [subject, sorted.find(record => record.subject === subject)]));
  const currentTotal = scoreSubjects.reduce((sum, subject) => sum + (Number(latestBySubject[subject]?.score) || 0), 0);
  const sameSubjectRecords = latest ? sorted.filter(record => record.subject === latest.subject) : [];
  const previous = sameSubjectRecords[1];
  const delta = latest && previous ? Number(latest.score) - Number(previous.score) : 0;
  document.getElementById('dashboardLatestTotal').textContent = latest ? `${latest.subject} ${latest.score} 分` : '暂无成绩';
  document.getElementById('dashboardScoreDelta').textContent = previous ? `较该科上次${delta >= 0 ? '提升' : '下降'} ${Math.abs(delta)} 分` : '该科录入两次后显示变化';
  document.querySelector('.score-main strong').textContent = currentTotal;
  const deltaBadge = document.getElementById('dashboardScoreChange');
  const recordedSubjectCount = scoreSubjects.filter(subject => latestBySubject[subject]).length;
  deltaBadge.textContent = `${recordedSubjectCount} 科`;
  deltaBadge.classList.remove('negative');
  const scoreIds = { '政治': 'dashboardPoliticsScore', '英语': 'dashboardEnglishScore', '数学': 'dashboardMathScore', '专业课': 'dashboardMajorScore' };
  scoreSubjects.forEach(subject => document.getElementById(scoreIds[subject]).textContent = latestBySubject[subject]?.score ?? '--');
  if (recordedSubjectCount) {
    const weakest = scoreSubjects.filter(subject => latestBySubject[subject]).map(subject => ({ subject, rate: Number(latestBySubject[subject].score) / (Number(school.scores[subject]) || scoreFullMarks[subject]) })).sort((a, b) => a.rate - b.rate)[0];
    document.getElementById('dashboardScoreTip').textContent = `下阶段优先提升：${weakest.subject}，当前达到目标分数的 ${Math.round(weakest.rate * 100)}%`;
  } else {
    document.getElementById('dashboardScoreTip').textContent = '录入首次模考成绩后，这里会自动分析薄弱科目。';
  }
}

function updateScoreEntryConfig() {
  const subject = document.getElementById('entrySubject').value;
  const fullMark = scoreFullMarks[subject];
  const input = document.getElementById('entryScore');
  input.max = fullMark;
  document.getElementById('selectedSubjectFullMark').textContent = fullMark;
}

function openScoreEditor(record = null) {
  document.getElementById('scoreForm').reset();
  document.getElementById('scoreRecordId').value = record?.id || '';
  document.getElementById('scoreModalTitle').textContent = record ? '编辑单科成绩' : '录入单科成绩';
  document.getElementById('examName').value = record?.name || '';
  document.getElementById('scoreExamDate').value = record?.date || today;
  document.getElementById('entrySubject').value = record?.subject || document.getElementById('trendSubject').value;
  document.getElementById('entryScore').value = record?.score ?? '';
  document.getElementById('scoreReview').value = record?.review || '';
  updateScoreEntryConfig();
  scoreModal.classList.add('show');
  setTimeout(() => document.getElementById('examName').focus(), 50);
}

function closeScoreEditor() {
  scoreModal.classList.remove('show');
}

document.getElementById('openScoreModal').addEventListener('click', () => openScoreEditor());
document.getElementById('closeScoreModal').addEventListener('click', closeScoreEditor);
document.getElementById('cancelScore').addEventListener('click', closeScoreEditor);
scoreModal.addEventListener('click', event => { if (event.target === scoreModal) closeScoreEditor(); });
document.getElementById('entrySubject').addEventListener('change', updateScoreEntryConfig);
document.getElementById('trendSubject').addEventListener('change', renderScores);

document.getElementById('scoreForm').addEventListener('submit', event => {
  event.preventDefault();
  const editingId = document.getElementById('scoreRecordId').value;
  const existing = scoreRecords.find(record => String(record.id) === editingId);
  const previousRecords = [...scoreRecords];
  const nextRecord = {
    id: existing?.id || Date.now(),
    name: document.getElementById('examName').value.trim(),
    date: document.getElementById('scoreExamDate').value,
    subject: document.getElementById('entrySubject').value,
    score: Number(document.getElementById('entryScore').value),
    review: document.getElementById('scoreReview').value.trim()
  };
  scoreRecords = existing ? scoreRecords.map(record => record.id === existing.id ? nextRecord : record) : [nextRecord, ...scoreRecords];
  if (!writeStorage(STORAGE_KEYS.scores, scoreRecords)) {
    scoreRecords = previousRecords;
    showToast('成绩保存失败，请检查浏览器存储空间');
    return;
  }
  closeScoreEditor();
  document.getElementById('trendSubject').value = nextRecord.subject;
  renderScores();
  showToast(existing ? '成绩记录已更新' : '成绩已录入');
});

const noteModal = document.getElementById('noteModal');
const notesGrid = document.getElementById('notesGrid');
const noteSearch = document.getElementById('noteSearch');
const noteSubjectFilter = document.getElementById('noteSubjectFilter');
const noteImageInput = document.getElementById('noteImages');
const imagePreviewGrid = document.getElementById('imagePreviewGrid');
let draftImages = [];

function formatNoteDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return '今天';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function renderNotes() {
  const keyword = noteSearch.value.trim().toLowerCase();
  const subject = noteSubjectFilter.value;
  const visibleNotes = [...notes]
    .filter(note => subject === 'all' || note.subject === subject)
    .filter(note => !keyword || `${note.title} ${note.content} ${note.type}`.toLowerCase().includes(keyword))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

  notesGrid.innerHTML = visibleNotes.map(note => {
    const images = Array.isArray(note.images) ? note.images : [];
    const gallery = images.length ? `
      <div class="note-card-images image-count-${Math.min(images.length, 3)}">
        ${images.slice(0, 3).map((source, index) => `<div><img src="${source}" alt="${escapeAttribute(note.title)}的图片 ${index + 1}" />${index === 2 && images.length > 3 ? `<span>+${images.length - 3}</span>` : ''}</div>`).join('')}
      </div>` : '';
    return `
      <article class="note-card ${note.pinned ? 'pinned' : ''}" data-id="${note.id}">
        <div class="note-card-top"><div><span class="subject-tag ${note.subject}">${escapeHtml(note.subject)}</span><span class="note-type">${escapeHtml(note.type)}</span></div><button class="pin-note ${note.pinned ? 'active' : ''}" type="button" title="${note.pinned ? '取消置顶' : '置顶'}">⌖</button></div>
        <h3>${escapeHtml(note.title)}</h3>
        <p>${escapeHtml(note.content || '暂未填写文字内容')}</p>
        ${gallery}
        <div class="note-card-footer"><span>${formatNoteDate(note.updatedAt)}${images.length ? ` · ${images.length} 张图片` : ''}</span><div><button class="edit-note" type="button">编辑</button><button class="delete-note" type="button">删除</button></div></div>
      </article>`;
  }).join('');

  document.getElementById('noteEmptyState').classList.toggle('show', visibleNotes.length === 0);
  document.getElementById('noteTotalCount').textContent = notes.length;
  document.getElementById('noteImageCount').textContent = notes.reduce((sum, note) => sum + (note.images?.length || 0), 0);
  document.getElementById('notePinnedCount').textContent = notes.filter(note => note.pinned).length;
  bindNoteActions();
}

function bindNoteActions() {
  notesGrid.querySelectorAll('.note-card').forEach(card => {
    const note = notes.find(item => String(item.id) === card.dataset.id);
    if (!note) return;
    card.querySelector('.pin-note').addEventListener('click', () => {
      note.pinned = !note.pinned;
      note.updatedAt = Date.now();
      if (!writeStorage(STORAGE_KEYS.notes, notes)) showToast('保存失败，请检查浏览器存储空间');
      renderNotes();
    });
    card.querySelector('.edit-note').addEventListener('click', () => openNoteEditor(note));
    card.querySelector('.delete-note').addEventListener('click', () => {
      if (!window.confirm(`确定删除“${note.title}”吗？`)) return;
      notes = notes.filter(item => item.id !== note.id);
      writeStorage(STORAGE_KEYS.notes, notes);
      renderNotes();
      showToast('笔记已删除');
    });
  });
}

function openNoteEditor(note = null) {
  document.getElementById('noteForm').reset();
  document.getElementById('noteId').value = note?.id || '';
  document.getElementById('noteModalTitle').textContent = note ? '编辑学习笔记' : '新建学习笔记';
  document.getElementById('noteTitle').value = note?.title || '';
  document.getElementById('noteSubject').value = note?.subject || '数学';
  document.getElementById('noteType').value = note?.type || '知识点';
  document.getElementById('noteContent').value = note?.content || '';
  draftImages = [...(note?.images || [])];
  renderImagePreviews();
  noteModal.classList.add('show');
  setTimeout(() => document.getElementById('noteTitle').focus(), 50);
}

function closeNoteEditor() {
  noteModal.classList.remove('show');
  noteImageInput.value = '';
  draftImages = [];
}

function renderImagePreviews() {
  document.getElementById('noteImageLimit').textContent = `${draftImages.length} / 4`;
  document.getElementById('imageDropzone').classList.toggle('hidden', draftImages.length >= 4);
  imagePreviewGrid.innerHTML = draftImages.map((source, index) => `
    <div class="image-preview-item"><img src="${source}" alt="待上传图片 ${index + 1}" /><button type="button" data-index="${index}" aria-label="移除图片">×</button></div>`).join('');
  imagePreviewGrid.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    draftImages.splice(Number(button.dataset.index), 1);
    renderImagePreviews();
  }));
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('图片读取失败')); };
    image.src = objectUrl;
  });
}

async function uploadNoteImage(dataUrl) {
  const blob = await fetch(dataUrl).then(response => response.blob());
  const result = await api('/uploads', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob
  });
  return result.url;
}

async function addNoteImages(fileList) {
  const available = 4 - draftImages.length;
  const files = [...fileList].filter(file => file.type.startsWith('image/')).slice(0, available);
  if (!files.length) {
    showToast(available ? '请选择有效的图片文件' : '每篇笔记最多上传 4 张图片');
    return;
  }
  if (files.some(file => file.size > 10 * 1024 * 1024)) {
    showToast('单张图片不能超过 10MB');
    return;
  }
  const saveButton = document.getElementById('saveNoteButton');
  saveButton.disabled = true;
  saveButton.textContent = '正在处理图片…';
  try {
    const compressed = await Promise.all(files.map(compressImage));
    const uploaded = await Promise.all(compressed.map(uploadNoteImage));
    draftImages.push(...uploaded);
    renderImagePreviews();
  } catch {
    showToast('有图片处理失败，请重新选择');
  } finally {
    noteImageInput.value = '';
    saveButton.disabled = false;
    saveButton.textContent = '保存笔记';
  }
}

document.getElementById('openNoteModal').addEventListener('click', () => openNoteEditor());
document.getElementById('closeNoteModal').addEventListener('click', closeNoteEditor);
document.getElementById('cancelNote').addEventListener('click', closeNoteEditor);
noteModal.addEventListener('click', event => { if (event.target === noteModal) closeNoteEditor(); });
noteImageInput.addEventListener('change', event => addNoteImages(event.target.files));
const imageDropzone = document.getElementById('imageDropzone');
imageDropzone.addEventListener('dragover', event => { event.preventDefault(); imageDropzone.classList.add('dragging'); });
imageDropzone.addEventListener('dragleave', () => imageDropzone.classList.remove('dragging'));
imageDropzone.addEventListener('drop', event => {
  event.preventDefault();
  imageDropzone.classList.remove('dragging');
  addNoteImages(event.dataTransfer.files);
});
noteSearch.addEventListener('input', renderNotes);
noteSubjectFilter.addEventListener('change', renderNotes);

document.getElementById('noteForm').addEventListener('submit', event => {
  event.preventDefault();
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  if (!title || (!content && !draftImages.length)) {
    showToast('请填写笔记内容或至少上传一张图片');
    return;
  }
  const editingId = document.getElementById('noteId').value;
  const previousNotes = [...notes];
  const existing = notes.find(note => String(note.id) === editingId);
  const nextNote = {
    id: existing?.id || Date.now(),
    title,
    subject: document.getElementById('noteSubject').value,
    type: document.getElementById('noteType').value,
    content,
    images: [...draftImages],
    pinned: existing?.pinned || false,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  notes = existing ? notes.map(note => note.id === existing.id ? nextNote : note) : [nextNote, ...notes];
  if (!writeStorage(STORAGE_KEYS.notes, notes)) {
    notes = previousNotes;
    showToast('图片占用空间较大，保存失败，请减少图片后重试');
    return;
  }
  closeNoteEditor();
  renderNotes();
  showToast(existing ? '笔记已更新' : '笔记已保存');
});

const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(nav => nav.classList.remove('active'));
    pages.forEach(page => page.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`${item.dataset.page}-page`).classList.add('active');
    history.replaceState(null, '', `#${item.dataset.page}`);
    document.querySelector('.sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

document.getElementById('viewAllTasks').addEventListener('click', () => document.querySelector('[data-page="tasks"]').click());
document.getElementById('menuButton').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

function showToast(message) {
  const toast = document.getElementById('focusToast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.hideTimer);
  showToast.hideTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

let focusTimer;
let focusState = createDefaultFocusState();

function createDefaultFocusState(overrides = {}) {
  return {
    mode: 'countdown',
    targetSeconds: 25 * 60,
    subject: '数学',
    accumulatedSeconds: 0,
    running: false,
    startedAt: null,
    sessionStartedAt: null,
    completed: false,
    ...overrides
  };
}

function focusTimerStorageKey() {
  return activeUser ? `yantu.user.${activeUser.id}.focus-timer.v1` : null;
}

function saveFocusTimerState() {
  const key = focusTimerStorageKey();
  if (key) localStorage.setItem(key, JSON.stringify(focusState));
}

function currentFocusElapsed() {
  const runningSeconds = focusState.running && focusState.startedAt ? Math.floor((Date.now() - focusState.startedAt) / 1000) : 0;
  return Math.max(0, Math.min(86400, Number(focusState.accumulatedSeconds || 0) + runningSeconds));
}

function formatTimerValue(seconds, alwaysHours = false) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const remainingSeconds = value % 60;
  if (alwaysHours || hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function renderFocusTimer() {
  const elapsed = currentFocusElapsed();
  const countdown = focusState.mode === 'countdown';
  const displaySeconds = countdown ? Math.max(0, focusState.targetSeconds - elapsed) : elapsed;
  const progress = countdown ? Math.min(1, elapsed / focusState.targetSeconds) : (elapsed % 3600) / 3600;
  document.getElementById('focusClock').textContent = formatTimerValue(displaySeconds, !countdown && elapsed >= 3600);
  document.getElementById('focusModeLabel').textContent = countdown ? '倒计时' : '从 0 开始计时';
  document.getElementById('focusClockStatus').textContent = focusState.completed ? '本次已记录' : focusState.running ? `正在专注 · ${focusState.subject}` : elapsed > 0 ? '已暂停' : '准备开始';
  const ring = document.getElementById('focusClockRing');
  ring.style.setProperty('--focus-progress', `${Math.round(progress * 360)}deg`);
  ring.classList.toggle('running', focusState.running);

  document.querySelectorAll('[data-focus-mode]').forEach(button => button.classList.toggle('active', button.dataset.focusMode === focusState.mode));
  document.getElementById('focusDurationSettings').classList.toggle('hidden', !countdown);
  document.querySelectorAll('[data-minutes]').forEach(button => button.classList.toggle('active', Number(button.dataset.minutes) * 60 === focusState.targetSeconds));
  document.getElementById('focusCustomMinutes').value = Math.round(focusState.targetSeconds / 60);
  document.getElementById('focusSubject').value = focusState.subject;

  const configurationLocked = focusState.running || (elapsed > 0 && !focusState.completed);
  document.getElementById('focusSubject').disabled = configurationLocked;
  document.querySelectorAll('#focusModeTabs button, #focusDurationButtons button').forEach(button => button.disabled = configurationLocked);
  document.getElementById('focusCustomMinutes').disabled = configurationLocked;
  const startPause = document.getElementById('focusStartPause');
  startPause.textContent = focusState.running ? '暂停' : focusState.completed ? '再来一次' : elapsed > 0 ? '继续' : '开始专注';
  document.getElementById('focusFinish').disabled = elapsed < 1 || focusState.completed;
  document.getElementById('focusReset').disabled = elapsed < 1 && !focusState.running;

  const badge = document.getElementById('focusLiveBadge');
  badge.className = `focus-live-badge ${focusState.running ? 'running' : elapsed > 0 && !focusState.completed ? 'paused' : ''}`;
  badge.querySelector('span').textContent = focusState.running ? `${focusState.subject} · ${formatTimerValue(elapsed)}` : elapsed > 0 && !focusState.completed ? '计时已暂停' : '尚未开始';
}

function ensureFocusTicker() {
  clearInterval(focusTimer);
  if (!focusState.running) return;
  focusTimer = setInterval(() => {
    const elapsed = currentFocusElapsed();
    if ((focusState.mode === 'countdown' && elapsed >= focusState.targetSeconds) || elapsed >= 86400) {
      finishFocusSession(true);
      return;
    }
    renderFocusTimer();
  }, 500);
}

function restoreFocusTimerState() {
  clearInterval(focusTimer);
  const key = focusTimerStorageKey();
  const stored = key ? readStorage(key, null) : null;
  focusState = createDefaultFocusState(stored && typeof stored === 'object' ? stored : {});
  if (!['countdown', 'stopwatch'].includes(focusState.mode)) focusState.mode = 'countdown';
  focusState.targetSeconds = Math.max(60, Math.min(4 * 3600, Number(focusState.targetSeconds) || 1500));
  focusState.subject = ['数学', '英语', '政治', '专业课', '其他'].includes(focusState.subject) ? focusState.subject : '其他';
  if (focusState.running && ((focusState.mode === 'countdown' && currentFocusElapsed() >= focusState.targetSeconds) || currentFocusElapsed() >= 86400)) {
    finishFocusSession(true);
    return;
  }
  renderFocusTimer();
  ensureFocusTicker();
}

function startOrPauseFocus() {
  if (focusState.running) {
    focusState.accumulatedSeconds = currentFocusElapsed();
    focusState.running = false;
    focusState.startedAt = null;
    saveFocusTimerState();
    ensureFocusTicker();
    renderFocusTimer();
    return;
  }
  if (focusState.completed) {
    focusState.accumulatedSeconds = 0;
    focusState.completed = false;
    focusState.sessionStartedAt = null;
  }
  focusState.subject = document.getElementById('focusSubject').value;
  focusState.running = true;
  focusState.startedAt = Date.now();
  focusState.sessionStartedAt ||= new Date().toISOString();
  saveFocusTimerState();
  ensureFocusTicker();
  renderFocusTimer();
}

function finishFocusSession(automatic = false, silent = false) {
  let elapsed = currentFocusElapsed();
  if (automatic && focusState.mode === 'countdown') elapsed = focusState.targetSeconds;
  clearInterval(focusTimer);
  focusState.running = false;
  focusState.startedAt = null;
  focusState.accumulatedSeconds = elapsed;
  if (elapsed < 1) {
    renderFocusTimer();
    return;
  }
  const endedAt = new Date();
  const fallbackStart = new Date(endedAt.getTime() - elapsed * 1000);
  focusSessions = [{
    id: crypto.randomUUID(),
    subject: focusState.subject,
    mode: focusState.mode,
    startedAt: focusState.sessionStartedAt || fallbackStart.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: elapsed
  }, ...focusSessions];
  focusState.completed = true;
  saveFocusTimerState();
  writeStorage(STORAGE_KEYS.focus, focusSessions);
  renderFocusTimer();
  renderFocusStats();
  if (!silent) showToast(automatic ? '倒计时完成，本次专注已记录' : `已记录 ${formatFocusDuration(elapsed)}的专注`);
}

function resetFocusTimer() {
  clearInterval(focusTimer);
  focusState = createDefaultFocusState({ mode: focusState.mode, targetSeconds: focusState.targetSeconds, subject: focusState.subject });
  saveFocusTimerState();
  renderFocusTimer();
}

function formatFocusDuration(seconds) {
  if (seconds > 0 && seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (!minutes) return '0 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} 小时${remainder ? ` ${remainder} 分` : ''}`;
}

function sessionLocalDate(session) {
  return formatLocalDate(new Date(session.endedAt));
}

function focusSecondsBetween(start, end) {
  return focusSessions.reduce((sum, session) => {
    const endedAt = new Date(session.endedAt);
    return endedAt >= start && endedAt < end ? sum + session.durationSeconds : sum;
  }, 0);
}

function startOfLocalDay(date = new Date()) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfLocalWeek(date = new Date()) {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function focusStreak() {
  const activeDates = new Set(focusSessions.map(sessionLocalDate));
  const cursor = startOfLocalDay();
  let streak = 0;
  while (activeDates.has(formatLocalDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderFocusChart() {
  const period = document.getElementById('focusPeriod').value;
  const now = new Date();
  const todayDate = startOfLocalDay(now);
  let dates = [];
  if (period === 'month') {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    dates = Array.from({ length: daysInMonth }, (_, index) => new Date(now.getFullYear(), now.getMonth(), index + 1));
  } else {
    dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayDate);
      date.setDate(date.getDate() - 6 + index);
      return date;
    });
  }
  const values = dates.map(date => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return focusSecondsBetween(date, next);
  });
  const max = Math.max(...values, 1);
  const chart = document.getElementById('focusChart');
  const hasData = values.some(Boolean);
  chart.style.display = hasData ? 'flex' : 'none';
  document.getElementById('focusChartEmpty').classList.toggle('show', !hasData);
  document.getElementById('focusChartTitle').textContent = period === 'month' ? `${now.getMonth() + 1} 月每日专注` : '最近 7 天';
  chart.innerHTML = dates.map((date, index) => {
    const seconds = values[index];
    const height = seconds ? Math.max(3, Math.round(seconds / max * 100)) : 0;
    const valueLabel = seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : seconds >= 60 ? `${Math.round(seconds / 60)}m` : seconds ? `${seconds}s` : '';
    const dayLabel = period === 'month' ? `${date.getDate()}日` : ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    return `<div class="focus-chart-column ${formatLocalDate(date) === formatLocalDate(todayDate) ? 'today' : ''}"><b>${valueLabel}</b><div class="focus-chart-bar-track"><i style="height:${height}%"></i></div><small>${dayLabel}</small></div>`;
  }).join('');
}

function renderFocusHistory() {
  const list = document.getElementById('focusHistoryList');
  const visible = focusSessions.slice(0, 30);
  list.innerHTML = visible.map(session => {
    const endedAt = new Date(session.endedAt);
    return `<div class="focus-history-item" data-focus-id="${escapeAttribute(session.id)}">
      <div class="focus-history-date"><div><b>${String(endedAt.getDate()).padStart(2, '0')}</b><small>${endedAt.getMonth() + 1}月</small></div></div>
      <div class="focus-history-main"><strong>${escapeHtml(session.subject)}</strong><span>${session.mode === 'countdown' ? '倒计时' : '正计时'} · ${String(endedAt.getHours()).padStart(2, '0')}:${String(endedAt.getMinutes()).padStart(2, '0')}</span></div>
      <b class="focus-history-duration">${formatFocusDuration(session.durationSeconds)}</b>
      <button class="delete-focus-record" type="button" aria-label="删除专注记录">×</button>
    </div>`;
  }).join('');
  document.getElementById('focusHistoryCount').textContent = `${focusSessions.length} 条`;
  document.getElementById('focusHistoryEmpty').classList.toggle('show', !visible.length);
  list.style.display = visible.length ? 'block' : 'none';
  list.querySelectorAll('.delete-focus-record').forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-focus-id]').dataset.focusId;
    focusSessions = focusSessions.filter(session => session.id !== id);
    writeStorage(STORAGE_KEYS.focus, focusSessions);
    renderFocusStats();
    showToast('专注记录已删除');
  }));
}

function renderFocusStats() {
  const todayStart = startOfLocalDay();
  const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekStart = startOfLocalWeek();
  const nextWeek = new Date(weekStart); nextWeek.setDate(nextWeek.getDate() + 7);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const nextMonth = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 1);
  const todaySeconds = focusSecondsBetween(todayStart, tomorrow);
  const weekSeconds = focusSecondsBetween(weekStart, nextWeek);
  const monthSeconds = focusSecondsBetween(monthStart, nextMonth);
  const todaySessions = focusSessions.filter(session => sessionLocalDate(session) === formatLocalDate(todayStart));
  const monthSessions = focusSessions.filter(session => {
    const date = new Date(session.endedAt);
    return date >= monthStart && date < nextMonth;
  });
  const todayMinutes = Math.round(todaySeconds / 60);
  const todayPercent = Math.min(100, Math.round(todaySeconds / (4 * 3600) * 100));
  const weekHours = weekSeconds / 3600;
  const weekPercent = Math.min(100, Math.round(weekHours / 35 * 100));

  const todayLargeValue = todaySeconds > 0 && todaySeconds < 60 ? todaySeconds : todayMinutes >= 60 ? (todaySeconds / 3600).toFixed(1) : todayMinutes;
  const todayLargeUnit = todaySeconds > 0 && todaySeconds < 60 ? '秒' : todayMinutes >= 60 ? '小时' : '分钟';
  document.getElementById('focusTodayLarge').innerHTML = `${todayLargeValue}<small>${todayLargeUnit}</small>`;
  document.getElementById('focusTodaySessions').textContent = todaySessions.length ? `今天已完成 ${todaySessions.length} 次专注` : '尚无专注记录';
  document.getElementById('focusTodayPercent').textContent = `${todayPercent}%`;
  document.getElementById('focusTodayBar').style.width = `${todayPercent}%`;
  document.getElementById('focusSummaryToday').textContent = formatFocusDuration(todaySeconds);
  document.getElementById('focusSummaryTodayCount').textContent = `${todaySessions.length} 次记录`;
  document.getElementById('focusSummaryWeek').textContent = `${weekHours.toFixed(1)} 小时`;
  document.getElementById('focusSummaryMonth').textContent = `${(monthSeconds / 3600).toFixed(1)} 小时`;
  document.getElementById('focusSummaryMonthCount').textContent = `${monthSessions.length} 次记录`;
  document.getElementById('focusSummaryStreak').textContent = `${focusStreak()} 天`;

  document.getElementById('todayHours').textContent = todayMinutes >= 60 ? `${(todaySeconds / 3600).toFixed(1)} 小时` : `${todayMinutes} 分钟`;
  document.getElementById('todayFocusHint').textContent = todaySessions.length ? `已完成 ${todaySessions.length} 次专注` : '今天还没有专注记录';
  document.getElementById('weeklyPercent').textContent = `${weekPercent}%`;
  document.getElementById('weeklyGoalBar').style.width = `${weekPercent}%`;
  document.getElementById('weeklyFocusHours').textContent = weekHours.toFixed(1);
  renderFocusChart();
  renderFocusHistory();
}

document.getElementById('focusButton').addEventListener('click', () => document.querySelector('[data-page="focus"]').click());
document.getElementById('focusStartPause').addEventListener('click', startOrPauseFocus);
document.getElementById('focusFinish').addEventListener('click', () => finishFocusSession(false));
document.getElementById('focusReset').addEventListener('click', resetFocusTimer);
document.getElementById('focusSubject').addEventListener('change', event => {
  focusState.subject = event.target.value;
  saveFocusTimerState();
  renderFocusTimer();
});
document.querySelectorAll('[data-focus-mode]').forEach(button => button.addEventListener('click', () => {
  if (focusState.running) return;
  focusState = createDefaultFocusState({ mode: button.dataset.focusMode, targetSeconds: focusState.targetSeconds, subject: focusState.subject });
  saveFocusTimerState();
  renderFocusTimer();
}));
document.querySelectorAll('[data-minutes]').forEach(button => button.addEventListener('click', () => {
  if (focusState.running) return;
  focusState.targetSeconds = Number(button.dataset.minutes) * 60;
  focusState.accumulatedSeconds = 0;
  focusState.completed = false;
  saveFocusTimerState();
  renderFocusTimer();
}));
document.getElementById('focusCustomMinutes').addEventListener('change', event => {
  if (focusState.running) return;
  const minutes = Math.max(1, Math.min(240, Number(event.target.value) || 25));
  focusState.targetSeconds = Math.round(minutes) * 60;
  focusState.accumulatedSeconds = 0;
  focusState.completed = false;
  saveFocusTimerState();
  renderFocusTimer();
});
document.getElementById('focusPeriod').addEventListener('change', renderFocusChart);

function setUserStorageKeys(userId) {
  Object.keys(LEGACY_STORAGE_KEYS).forEach(type => {
    STORAGE_KEYS[type] = `yantu.user.${userId}.${type}.v1`;
  });
}

function legacySnapshotForUsername(username) {
  const legacyUsers = readStorage('yantu.auth.users.v1', []);
  const matchedUser = legacyUsers.find(user => String(user.username).toLowerCase() === username.toLowerCase());
  if (!matchedUser) return legacyDataSnapshot;
  const prefix = `yantu.user.${matchedUser.id}`;
  return {
    tasks: readStorage(`${prefix}.tasks.v1`, []),
    school: readStorage(`${prefix}.school.v1`, cloneData(emptyUserSnapshot.school)),
    progress: readStorage(`${prefix}.progress.v1`, cloneData(emptyUserSnapshot.progress)),
    notes: readStorage(`${prefix}.notes.v1`, []),
    scores: normalizeScoreRecords(readStorage(`${prefix}.scores.v1`, [])),
    focus: normalizeFocusSessions(readStorage(`${prefix}.focus.v1`, []))
  };
}

async function migrateLegacyDataOnce(username) {
  const migrationKey = `yantu.backend.migrated.${username.toLowerCase()}.v1`;
  if (localStorage.getItem(migrationKey)) return;
  const snapshot = legacySnapshotForUsername(username);
  await Promise.all(Object.entries(snapshot).map(([type, value]) => api(`/data/${type}`, { method: 'PUT', body: JSON.stringify(value) })));
  localStorage.setItem(migrationKey, 'true');
}

async function loadActiveUserData() {
  const response = await api('/bootstrap');
  const data = response.data || {};
  activeUser = response.user || activeUser;
  tasks = (data.tasks || []).map(task => ({ priority: '中', date: today, ...task }));
  school = data.school || cloneData(emptyUserSnapshot.school);
  progress = { ...cloneData(emptyUserSnapshot.progress), ...(data.progress || {}) };
  notes = data.notes || [];
  scoreRecords = normalizeScoreRecords(data.scores || []);
  focusSessions = normalizeFocusSessions(data.focus || []);

  taskDateFilter.value = today;
  taskStatus = 'all';
  document.querySelectorAll('#taskStatusFilter button').forEach(button => button.classList.toggle('active', button.dataset.status === 'all'));
  noteSearch.value = '';
  noteSubjectFilter.value = 'all';
  document.getElementById('trendSubject').value = '政治';
  fillSchoolForm();
  syncSchoolPreview();
  renderProgress();
  renderTasks();
  renderNotes();
  renderScores();
  restoreFocusTimerState();
  renderFocusStats();
}

function setAuthMessage(message, type = 'error') {
  const element = document.getElementById('authMessage');
  element.textContent = message;
  element.className = `auth-message ${message ? 'show' : ''} ${type}`;
}

function setAuthLoading(form, loading, text) {
  const button = form.querySelector('.auth-submit');
  button.disabled = loading;
  button.textContent = loading ? '正在验证…' : text;
}

function updateUserInterface() {
  if (!activeUser) return;
  const displayName = activeUser.displayName || activeUser.username;
  const initial = displayName.trim().charAt(0).toUpperCase() || '研';
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  document.getElementById('sidebarAvatar').textContent = initial;
  document.getElementById('sidebarDisplayName').textContent = displayName;
  document.getElementById('sidebarUsername').textContent = `@${activeUser.username}`;
  document.getElementById('greetingText').textContent = `${greeting}，${displayName}`;
}

async function activateUser(user) {
  activeUser = user;
  setUserStorageKeys(user.id);
  await loadActiveUserData();
  updateUserInterface();
  document.body.classList.remove('auth-locked');
  setAuthMessage('');
  const initialPage = location.hash.slice(1);
  const initialNav = document.querySelector(`.nav-item[data-page="${initialPage}"]`);
  if (initialNav && initialPage !== 'dashboard') initialNav.click();
}

document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.classList.toggle('active', tab === button));
  document.getElementById('loginForm').classList.toggle('hidden', button.dataset.authTab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', button.dataset.authTab !== 'register');
  setAuthMessage('');
}));

document.querySelectorAll('.toggle-password').forEach(button => button.addEventListener('click', () => {
  const input = button.previousElementSibling;
  input.type = input.type === 'password' ? 'text' : 'password';
  button.classList.toggle('visible', input.type === 'text');
}));

document.getElementById('registerForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const username = document.getElementById('registerUsername').value.trim().toLowerCase();
  const displayName = document.getElementById('registerDisplayName').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirmation = document.getElementById('registerPasswordConfirm').value;
  const inviteCode = document.getElementById('registerInviteCode').value;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    setAuthMessage('账号只能使用 3-20 位字母、数字或下划线');
    return;
  }
  if (password.length < 8) {
    setAuthMessage('密码至少需要 8 位');
    return;
  }
  if (password !== confirmation) {
    setAuthMessage('两次输入的密码不一致');
    return;
  }
  setAuthLoading(form, true, '注册并进入');
  try {
    const response = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username, displayName, password, inviteCode }) });
    activeUser = response.user;
    setUserStorageKeys(activeUser.id);
    let migrationFailed = false;
    try { await migrateLegacyDataOnce(username); } catch (error) { console.error(error); migrationFailed = true; }
    await activateUser(activeUser);
    form.reset();
    showToast(migrationFailed ? '账户已创建，旧版数据未能完全迁移' : '个人账户创建成功');
  } catch (error) {
    setAuthMessage(error.message);
  } finally {
    setAuthLoading(form, false, '注册并进入');
  }
});

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const username = document.getElementById('loginUsername').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  setAuthLoading(form, true, '登录');
  try {
    const response = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    await activateUser(response.user);
    form.reset();
  } catch (error) {
    setAuthMessage(error.message);
  } finally {
    setAuthLoading(form, false, '登录');
  }
});

const profileModal = document.getElementById('profileModal');
function openProfileCenter() {
  if (!activeUser) return;
  const displayName = activeUser.displayName || activeUser.username;
  const createdDate = new Date(activeUser.createdAt);
  document.getElementById('profileLargeAvatar').textContent = displayName.charAt(0).toUpperCase();
  document.getElementById('profileDisplayName').textContent = displayName;
  document.getElementById('profileUsername').textContent = activeUser.username;
  document.getElementById('profileCreatedAt').textContent = `创建于 ${createdDate.getFullYear()}.${String(createdDate.getMonth() + 1).padStart(2, '0')}.${String(createdDate.getDate()).padStart(2, '0')}`;
  document.getElementById('profileDisplayNameInput').value = displayName;
  document.getElementById('profileTaskCount').textContent = tasks.length;
  document.getElementById('profileScoreCount').textContent = scoreRecords.length;
  document.getElementById('profileNoteCount').textContent = notes.length;
  document.getElementById('passwordForm').reset();
  profileModal.classList.add('show');
}

document.getElementById('openProfileModal').addEventListener('click', openProfileCenter);
document.getElementById('closeProfileModal').addEventListener('click', () => profileModal.classList.remove('show'));
profileModal.addEventListener('click', event => { if (event.target === profileModal) profileModal.classList.remove('show'); });

document.getElementById('profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const displayName = document.getElementById('profileDisplayNameInput').value.trim();
  if (!displayName) return;
  try {
    const response = await api('/profile', { method: 'PUT', body: JSON.stringify({ displayName }) });
    activeUser = response.user;
    updateUserInterface();
    openProfileCenter();
    showToast('个人资料已更新');
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById('passwordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  if (newPassword.length < 8) {
    showToast('新密码至少需要 8 位');
    return;
  }
  try {
    await api('/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
    event.currentTarget.reset();
    showToast('密码已更新');
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  if (!focusState.completed && currentFocusElapsed() >= 1) finishFocusSession(false, true);
  await flushAllRemoteWrites();
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* local UI still logs out */ }
  activeUser = null;
  clearInterval(focusTimer);
  profileModal.classList.remove('show');
  document.body.classList.add('auth-locked');
  document.querySelector('[data-auth-tab="login"]').click();
  document.getElementById('loginUsername').focus();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    modal.classList.remove('show');
    closeNoteEditor();
    closeScoreEditor();
    profileModal.classList.remove('show');
  }
});

(async function restoreServerSession() {
  try {
    const response = await api('/auth/me');
    await activateUser(response.user);
  } catch (error) {
    document.body.classList.add('auth-locked');
    document.getElementById('loginUsername').focus();
    if (!error.status) setAuthMessage('无法连接后端，请使用 npm start 启动后访问 http://127.0.0.1:3000');
  }
})();
