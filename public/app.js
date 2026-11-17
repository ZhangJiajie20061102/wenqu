'use strict';

/* ==========================================================================
   知否 · 前端
   原生 JS + 哈希路由。所有用户内容都经过转义再插入，渲染层不用 innerHTML 吃原始数据。
   ========================================================================== */

const app = document.getElementById('app');
const actionsEl = document.getElementById('actions');
const toastEl = document.getElementById('toast');
const navEl = document.getElementById('nav');

const state = { user: null, overview: null };

/* ------------------------------------------------------------------ 工具 */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function timeAgo(ts) {
  const diff = Date.now() - Number(ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' 小时前';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + ' 天前';
  const d = new Date(Number(ts));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function colorOf(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  // 黑金主题：色相锁在 32°~46°，只让明度和饱和度轻微变化来区分不同用户
  const hue = 32 + (h % 15);
  const lum = 22 + (h % 5) * 4;
  const sat = 26 + (h % 4) * 5;
  return `linear-gradient(150deg, hsl(${hue} ${sat}% ${lum + 7}%), hsl(${hue} ${sat + 6}% ${lum}%))`;
}

function avatar(user, cls) {
  const name = (user && user.name) || '?';
  return `<span class="avatar ${cls || ''}" style="background:${colorOf(name)}">${esc(name.slice(0, 1))}</span>`;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const requireLogin = () => {
  if (!state.user) {
    toast('请先登录');
    location.hash = '#/login';
    return false;
  }
  return true;
};

/* ------------------------------------------------------------------ 顶栏 */

function renderTopbar() {
  if (state.user) {
    actionsEl.innerHTML = `
      <a class="btn btn-primary btn-sm" href="#/ask">提问</a>
      <a class="user-menu" href="#/u/${state.user.id}" title="我的主页">
        ${avatar(state.user, 'sm')}
        <span>${esc(state.user.name)}</span>
      </a>
      <button class="btn btn-ghost btn-sm" data-action="logout">退出</button>`;
  } else {
    actionsEl.innerHTML = `
      <a class="btn btn-primary btn-sm" href="#/login">登录</a>
      <a class="btn btn-ghost btn-sm" href="#/register">注册</a>`;
  }

  const path = (location.hash.replace(/^#/, '').split('?')[0]) || '/';
  navEl.querySelectorAll('a').forEach((a) => {
    a.classList.toggle('on', a.dataset.nav === path);
  });
}

/* ------------------------------------------------------------------ 侧栏 */

async function ensureOverview() {
  if (!state.overview) state.overview = await api('/overview');
  return state.overview;
}

function sidebar(o) {
  return `
  <aside class="side">
    <div class="card side-block">
      <h3 class="side-title">社区数据</h3>
      <div class="side-stats">
        <div><b>${o.totals.questions}</b><span>问题</span></div>
        <div><b>${o.totals.answers}</b><span>回答</span></div>
        <div><b>${o.totals.users}</b><span>用户</span></div>
      </div>
    </div>

    <div class="card side-block">
      <h3 class="side-title">热门话题</h3>
      <div class="side-tags">
        ${o.tags.map((t) => `<a class="tag" href="#/tag/${encodeURIComponent(t.name)}">${esc(t.name)}<b>${t.count}</b></a>`).join('')}
      </div>
    </div>

    <div class="card side-block">
      <h3 class="side-title">活跃回答者</h3>
      ${o.users.map((u) => `
        <a class="side-user" href="#/u/${u.id}">
          ${avatar(u, 'sm')}
          <span class="name">${esc(u.name)}</span>
          <span class="count">${u.answers} 回答</span>
        </a>`).join('')}
    </div>

    <div class="card side-block" style="color:var(--muted);font-size:12.5px;line-height:1.7">
      这是一个开源示例项目，数据存在本地 SQLite 里，<br>可以在自己的电脑上跑起来。
    </div>
  </aside>`;
}

/* ------------------------------------------------------------------ 列表页 */

function questionRow(q) {
  return `
  <a class="q-item" href="#/q/${q.id}">
    <h2 class="q-title">${esc(q.title)}</h2>
    ${q.excerpt ? `<p class="q-excerpt">${esc(q.excerpt)}</p>` : ''}
    ${q.tags.length ? `<div class="tags">${q.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="q-meta">
      <span class="answers${q.answer_count ? ' hot' : ''}">${q.answer_count} 个回答</span>
      <span class="dot">·</span>
      <span>${q.views} 浏览</span>
      <span class="dot">·</span>
      <span>赞同 ${q.vote_score}</span>
      <span class="dot">·</span>
      <span>${timeAgo(q.created_at)}</span>
      <span class="dot">·</span>
      <span>${esc(q.author.name)}</span>
    </div>
  </a>`;
}

async function renderFeed({ sort = 'new', tag = '', keyword = '' }) {
  const params = new URLSearchParams({ sort, limit: '20' });
  if (tag) params.set('tag', tag);
  if (keyword) params.set('q', keyword);

  const [data, o] = await Promise.all([api('/questions?' + params.toString()), ensureOverview()]);

  const tabs = `
    <div class="tabs">
      <button data-sort="new" class="${sort === 'new' ? 'on' : ''}">最新</button>
      <button data-sort="hot" class="${sort === 'hot' ? 'on' : ''}">热榜</button>
      <button data-sort="unanswered" class="${sort === 'unanswered' ? 'on' : ''}">待回答</button>
      <span style="margin-left:auto;font-size:12.5px;color:var(--faint);padding-right:4px">共 ${data.total} 个问题</span>
    </div>`;

  let head = '';
  if (tag) head = `<div class="card card-pad" style="padding:16px 20px"><b>话题 · ${esc(tag)}</b>　<span style="color:var(--muted);font-size:13.5px">共 ${data.total} 个问题</span></div>`;
  if (keyword) head = `<div class="card card-pad" style="padding:16px 20px">搜索 “${esc(keyword)}”　<span style="color:var(--muted);font-size:13.5px">命中 ${data.total} 个问题</span></div>`;

  const list = data.items.length
    ? `<div class="q-list">${data.items.map(questionRow).join('')}</div>`
    : `<div class="empty"><strong>这里还没有问题</strong>换个筛选条件，或者去提第一个问题。</div>`;

  app.innerHTML = `
    <div class="main-col">
      ${head}
      <div class="card">
        ${tag || keyword ? '' : tabs}
        ${list}
      </div>
    </div>
    ${sidebar(o)}`;

  // 列表页也保留筛选标签（有话题/搜索时不显示，避免歧义）
  if (!tag && !keyword) {
    app.querySelectorAll('[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.sort;
        location.hash = s === 'new' ? '#/' : `#/${s}`;
      });
    });
  }
}

/* ------------------------------------------------------------------ 详情页 */

function commentsBlock(answer) {
  // 没评论且没登录：整块不渲染，不然会留下一个空灰底
  if (!answer.comments.length && !state.user) return '';

  const shown = answer.comments.slice(0, 2);
  const rest = answer.comments.slice(2);
  return `
  <div class="comments">
    ${shown.map(commentLine).join('')}
    ${rest.length ? `
      <div hidden data-more-comments>
        ${rest.map(commentLine).join('')}
      </div>
      <button class="more" data-action="more-comments">查看全部 ${answer.comments.length} 条评论</button>` : ''}
    ${state.user ? `
      <form class="c-form" data-comment-form="${answer.id}">
        <input name="body" maxlength="500" placeholder="写评论…" aria-label="写评论">
        <button type="submit">发送</button>
      </form>` : ''}
  </div>`;
}

const commentLine = (c) => `
  <div class="c-item"><b>${esc(c.author.name)}</b>：${esc(c.body)}<time>${timeAgo(c.created_at)}</time></div>`;

function voteBar(type, id, score, myVote, style) {
  return `
  <span class="vote-bar" data-votebar data-type="${type}" data-id="${id}" data-myvote="${myVote || 0}"${style ? ' style="' + style + '"' : ''}>
    <button class="vote-mini${myVote === 1 ? ' on' : ''}" data-action="vote" data-vote="1" title="赞同" aria-label="赞同">
      <span aria-hidden="true">▲</span> 赞同 <b>${score}</b>
    </button>
    <button class="vote-mini down${myVote === -1 ? ' on' : ''}" data-action="vote" data-vote="-1" title="反对" aria-label="反对">▼</button>
  </span>`;
}

function answerBlock(a) {
  return `
  <article class="answer" data-answer="${a.id}">
    <div class="a-head">
      ${avatar(a.author, 'sm')}
      <a class="author" href="#/u/${a.author.id}">${esc(a.author.name)}</a>
      <span>·</span>
      <span>${timeAgo(a.created_at)}</span>
    </div>
    <div class="a-body">${esc(a.body)}</div>
    ${voteBar('answer', a.id, a.vote_score, a.my_vote)}
    ${commentsBlock(a)}
  </article>`;
}

async function renderQuestion(id) {
  const [q, o] = await Promise.all([api('/questions/' + id), ensureOverview()]);

  const editor = state.user
    ? `<div class="card card-pad" id="editor">
         <div class="side-title">写回答</div>
         <div class="field">
           <textarea id="answer-body" placeholder="认真写，会被别人看到。支持换行。" maxlength="20000"></textarea>
         </div>
         <div class="form-foot">
           <button class="btn btn-primary" id="answer-submit">发布回答</button>
         </div>
       </div>`
    : `<div class="card card-pad" style="text-align:center;color:var(--muted)">
         <a class="btn btn-primary" href="#/login">登录</a> 后可以写回答
       </div>`;

  app.innerHTML = `
    <div class="main-col">
      <div class="card q-detail">
        <h1>${esc(q.title)}</h1>
        <div class="tags">${q.tags.map((t) => `<a class="tag" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
        <div class="body">${esc(q.body)}</div>
        <div class="q-foot">
          ${voteBar('question', q.id, q.vote_score, q.my_vote, 'margin-right:6px')}
          <span>${q.views} 浏览</span>
          <span class="dot">·</span>
          <span>${timeAgo(q.created_at)} 提问</span>
          <a class="author" href="#/u/${q.author.id}" style="margin-left:auto;color:var(--text-2)">${avatar(q.author, 'sm')} ${esc(q.author.name)}</a>
        </div>
      </div>

      <div class="card">
        <div class="answers-head">
          <span>${q.answers.length} 条回答</span>
          <span class="count">按赞同排序</span>
        </div>
        ${q.answers.length ? q.answers.map(answerBlock).join('') : '<div class="empty"><strong>还没有人回答</strong>成为第一个回答的人。</div>'}
      </div>

      ${editor}
    </div>
    ${sidebar(o)}`;

  const submit = document.getElementById('answer-submit');
  if (submit) {
    submit.addEventListener('click', async () => {
      const body = document.getElementById('answer-body').value.trim();
      if (body.length < 2) return toast('回答至少写两个字');
      submit.disabled = true;
      try {
        await api(`/questions/${q.id}/answers`, { method: 'POST', body: { body } });
        toast('回答已发布');
        await renderQuestion(id);
      } catch (err) {
        toast(err.message);
        submit.disabled = false;
      }
    });
  }

  app.querySelectorAll('[data-comment-form]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const body = input.value.trim();
      if (!body) return;
      try {
        await api(`/answers/${form.dataset.commentForm}/comments`, { method: 'POST', body: { body } });
        toast('评论已发布');
        await renderQuestion(id);
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

/* ------------------------------------------------------------------ 提问 */

function renderAsk() {
  if (!state.user) {
    app.innerHTML = `
      <div class="full card card-pad" style="max-width:440px;margin:32px auto;text-align:center">
        <p style="font-size:16px;margin:8px 0 18px">提问需要先登录</p>
        <a class="btn btn-primary" href="#/login">去登录</a>
        <a class="btn btn-ghost" href="#/register">注册一个</a>
      </div>`;
    return;
  }

  app.innerHTML = `
    <div class="full" style="max-width:720px;margin:16px auto 0">
      <div class="card card-pad">
        <h2 style="margin:0 0 18px;font-size:19px">提问题</h2>
        <div class="form-error" id="ask-error"></div>

        <div class="field">
          <label for="ask-title">问题标题<span class="hint">用一句话把问题说清楚，5 字以上</span></label>
          <input id="ask-title" type="text" maxlength="120" placeholder="例如：刚学完 Python 基础，下一步该刷题还是做项目？">
        </div>

        <div class="field">
          <label for="ask-body">问题描述<span class="hint">可选。补充背景，别人更好回答</span></label>
          <textarea id="ask-body" maxlength="20000" placeholder="你已经试过什么？卡在哪一步？"></textarea>
        </div>

        <div class="field">
          <label for="ask-tags">话题<span class="hint">用逗号或空格分隔，最多 5 个</span></label>
          <input id="ask-tags" type="text" maxlength="120" placeholder="Python, 学习方法">
        </div>

        <div class="form-foot">
          <a class="btn btn-ghost" href="#/">取消</a>
          <button class="btn btn-primary" id="ask-submit">发布问题</button>
        </div>
      </div>
    </div>`;

  document.getElementById('ask-submit').addEventListener('click', async (e) => {
    const errBox = document.getElementById('ask-error');
    errBox.classList.remove('show');
    e.target.disabled = true;
    try {
      const { id } = await api('/questions', {
        method: 'POST',
        body: {
          title: document.getElementById('ask-title').value,
          body: document.getElementById('ask-body').value,
          tags: document.getElementById('ask-tags').value
        }
      });
      toast('问题已发布');
      location.hash = `#/q/${id}`;
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
      e.target.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ 个人页 */

async function renderProfile(id) {
  const [data, o] = await Promise.all([api('/users/' + id), ensureOverview()]);
  const u = data.user;

  app.innerHTML = `
    <div class="main-col">
      <div class="card">
        <div class="profile-head">
          ${avatar(u, 'lg')}
          <div class="info">
            <h1>${esc(u.name)}</h1>
            <div class="bio">${esc(u.bio || '这个人很懒，什么都没写。')}</div>
          </div>
        </div>
        <div class="profile-stats">
          <div><b>${data.stats.questions}</b>提问</div>
          <div><b>${data.stats.answers}</b>回答</div>
          <div><b>${data.stats.upvotes}</b>获得的赞同</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">TA 的问题 <span style="font-weight:400;color:var(--muted);font-size:13px">${data.questions.length} 个</span></div>
        ${data.questions.length ? `<div class="mini-list">${data.questions.map((q) => `
          <a class="mini-item" href="#/q/${q.id}">
            <div class="t">${esc(q.title)}</div>
            <div class="x">${q.answer_count} 个回答　·　赞同 ${q.vote_score}　·　${timeAgo(q.created_at)}</div>
          </a>`).join('')}</div>` : '<div class="empty">还没有提过问题</div>'}
      </div>

      <div class="card">
        <div class="card-title">TA 的回答 <span style="font-weight:400;color:var(--muted);font-size:13px">${data.answers.length} 条</span></div>
        ${data.answers.length ? `<div class="mini-list">${data.answers.map((a) => `
          <a class="mini-item" href="#/q/${a.question_id}">
            <div class="t">${esc(a.excerpt)}…</div>
            <div class="x">回答于《${esc(a.question_title)}》　·　赞同 ${a.vote_score}</div>
          </a>`).join('')}</div>` : '<div class="empty">还没有回答过问题</div>'}
      </div>
    </div>
    ${sidebar(o)}`;
}

/* ------------------------------------------------------------------ 登录 */

function renderAuth(mode) {
  const isLogin = mode === 'login';
  app.innerHTML = `
    <div class="full" style="max-width:420px;margin:32px auto 0">
      <div class="card card-pad">
        <h2 style="margin:0 0 6px;font-size:20px">${isLogin ? '登录知否' : '注册新账号'}</h2>
        <p style="margin:0 0 20px;color:var(--muted);font-size:13.5px">
          ${isLogin ? '演示账号：chenmo@example.com / 123456' : '昵称和邮箱都不能重复，密码至少 6 位'}
        </p>
        <div class="form-error" id="auth-error"></div>

        ${isLogin ? `
          <div class="field">
            <label for="account">邮箱或昵称</label>
            <input id="account" type="text" autocomplete="username" placeholder="chenmo@example.com">
          </div>` : `
          <div class="field">
            <label for="name">昵称</label>
            <input id="name" type="text" maxlength="20" placeholder="2–20 个字">
          </div>
          <div class="field">
            <label for="email">邮箱</label>
            <input id="email" type="email" placeholder="用于登录，不会公开">
          </div>`}

        <div class="field">
          <label for="password">密码</label>
          <input id="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="${isLogin ? '你的密码' : '至少 6 位'}">
        </div>

        <div class="form-foot" style="justify-content:space-between">
          <a href="#/${isLogin ? 'register' : 'login'}" style="color:var(--gold);font-size:13.5px">
            ${isLogin ? '没有账号？注册' : '已有账号？登录'}
          </a>
          <button class="btn btn-primary" id="auth-submit">${isLogin ? '登录' : '注册'}</button>
        </div>
      </div>
    </div>`;

  const submit = async () => {
    const errBox = document.getElementById('auth-error');
    errBox.classList.remove('show');
    const btn = document.getElementById('auth-submit');
    btn.disabled = true;
    try {
      const password = document.getElementById('password').value;
      const payload = isLogin
        ? { account: document.getElementById('account').value, password }
        : {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            password
          };
      const { user } = await api(isLogin ? '/login' : '/register', { method: 'POST', body: payload });
      state.user = user;
      renderTopbar();
      toast(isLogin ? `欢迎回来，${user.name}` : '注册成功');
      location.hash = '#/';
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
      btn.disabled = false;
    }
  };

  document.getElementById('auth-submit').addEventListener('click', submit);
  document.getElementById('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

/* ------------------------------------------------------------------ 投票 */

async function handleVote(btn) {
  if (!state.user) return requireLogin();

  const bar = btn.closest('[data-votebar]');
  const type = bar.dataset.type;
  const id = Number(bar.dataset.id);
  const value = Number(btn.dataset.vote);

  const up = bar.querySelector('[data-vote="1"]');
  const down = bar.querySelector('[data-vote="-1"]');
  const count = up.querySelector('b');

  // 当前状态从 DOM 读，省一次请求
  const current = up.classList.contains('on') ? 1 : (down.classList.contains('on') ? -1 : 0);
  const next = current === value ? 0 : value;

  try {
    const res = await api('/vote', { method: 'POST', body: { targetType: type, targetId: id, value: next } });
    count.textContent = res.score;
    up.classList.toggle('on', res.my_vote === 1);
    down.classList.toggle('on', res.my_vote === -1);
    bar.dataset.myvote = String(res.my_vote);
  } catch (err) {
    toast(err.message);
  }
}

/* ------------------------------------------------------------------ 路由 */

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  return { path: pathPart || '/', query: new URLSearchParams(queryPart || '') };
}

let renderToken = 0;

async function route() {
  const token = ++renderToken;
  const { path, query } = parseRoute();
  const seg = path.split('/').filter(Boolean);

  renderTopbar();

  try {
    let html;
    if (seg.length === 0) {
      await renderFeed({ sort: 'new' });
    } else if (seg[0] === 'hot') {
      await renderFeed({ sort: 'hot' });
    } else if (seg[0] === 'unanswered') {
      await renderFeed({ sort: 'unanswered' });
    } else if (seg[0] === 'tag' && seg[1]) {
      await renderFeed({ sort: 'new', tag: decodeURIComponent(seg[1]) });
    } else if (seg[0] === 'search') {
      await renderFeed({ sort: 'new', keyword: query.get('q') || '' });
    } else if (seg[0] === 'q' && seg[1]) {
      await renderQuestion(Number(seg[1]));
    } else if (seg[0] === 'ask') {
      renderAsk();
    } else if (seg[0] === 'u' && seg[1]) {
      await renderProfile(Number(seg[1]));
    } else if (seg[0] === 'login') {
      renderAuth('login');
    } else if (seg[0] === 'register') {
      renderAuth('register');
    } else {
      app.innerHTML = `<div class="full card empty"><strong>页面不存在</strong><a href="#/" style="color:var(--gold)">回到首页</a></div>`;
    }
    if (token !== renderToken) return; // 路由已经切走，丢弃这次渲染
  } catch (err) {
    if (token !== renderToken) return;
    app.innerHTML = `<div class="full card empty"><strong>加载失败</strong>${esc(err.message)}</div>`;
  }
}

/* ------------------------------------------------------------------ 全局事件 */

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  if (action === 'vote') handleVote(target);
  if (action === 'logout') {
    api('/logout', { method: 'POST' })
      .then(() => {
        state.user = null;
        state.overview = null;
        renderTopbar();
        toast('已退出登录');
        location.hash = '#/';
        route();
      })
      .catch((err) => toast(err.message));
  }
  if (action === 'more-comments') {
    const box = target.parentElement.querySelector('[data-more-comments]');
    if (box) {
      box.hidden = false;
      target.remove();
    }
  }
});

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const keyword = document.getElementById('search-input').value.trim();
  if (keyword) location.hash = `#/search?q=${encodeURIComponent(keyword)}`;
});

window.addEventListener('hashchange', route);

/* ------------------------------------------------------------------ 启动 */

(async function boot() {
  try {
    const me = await api('/me');
    state.user = me.user;
  } catch { /* 未登录 */ }
  renderTopbar();
  await route();
})();
