'use strict';

/**
 * 演示数据：10 个用户、10 个问题、20 条回答，带投票与评论。
 * 用法：
 *   npm run seed          已有数据就跳过
 *   npm run reset         删库重建（会丢掉 data.db）
 */

const fs = require('node:fs');
const path = require('node:path');

const RESET = process.argv.includes('--reset');
if (RESET) {
  for (const f of ['data.db', 'data.db-wal', 'data.db-shm']) {
    try { fs.unlinkSync(path.join(__dirname, f)); } catch { /* 不存在就算了 */ }
  }
  console.log('已删除旧的 data.db');
}

const { init, get, run, tx } = require('./db');
const { hashPassword } = require('./auth');

init();

if (!RESET && get('SELECT COUNT(*) AS c FROM users').c > 0) {
  console.log('数据库里已经有数据了，跳过。要重建请用 npm run reset');
  process.exit(0);
}

const HOUR = 3600 * 1000;
const now = Date.now();

/* ------------------------------------------------------------------ 用户 */

const USERS = [
  { name: '陈墨', email: 'chenmo@example.com', bio: '写了六年前端，最近在折腾小程序和云开发' },
  { name: '江隼', email: 'jiangxun@example.com', bio: '后端工程师，Java 和 Node 都写，偏爱简单方案' },
  { name: '林小满', email: 'linxiaoman@example.com', bio: '大三在读，正在从课本往项目上爬' },
  { name: '老周', email: 'laozhou@example.com', bio: '做了十年零售数据分析，现在自己开小店' },
  { name: '阿岚', email: 'alan@example.com', bio: '产品经理，喜欢把需求拆到能实现为止' },
  { name: '苏叶', email: 'suye@example.com', bio: '算法方向，刷题上瘾，偶尔写点技术笔记' },
  { name: '何充', email: 'hechong@example.com', bio: '运维转开发，折腾过各种部署方案' },
  { name: '宋一', email: 'songyi@example.com', bio: '刚工作一年，前端切图仔，正在补基础' },
  { name: '顾言', email: 'guyan@example.com', bio: '喜欢把复杂的事讲简单' },
  { name: '白露', email: 'bailu@example.com', bio: '数据可视化爱好者，Power BI 与 ECharts 都用' }
];

/* ------------------------------------------------------------------ 内容 */

const QUESTIONS = [
  {
    author: '林小满',
    hoursAgo: 2,
    title: '刚学完 Python 基础，下一步该刷算法题还是直接做项目？',
    body: '语法看完了，能写点小脚本。现在有两条路：一是刷算法题打基础，二是直接找个东西做出来。时间有限，只能选一个先走，想听听过来人的意见。',
    tags: ['Python', '学习方法', '编程入门'],
    answers: [
      {
        author: '江隼', hoursAgo: 1, votes: 9,
        body: '两个都要，但顺序很重要：先做一个小项目，再回头刷题。\n\n原因是刚学完语法的人最缺的不是算法，而是「把一堆零散语法组织成一个能跑的东西」的经验。写一个能用的命令行记账工具、爬个天气、做个本地待办，哪怕三百行，你都会第一次真正遇到状态怎么存、错误怎么处理、文件路径为什么在别人电脑上就找不到。\n\n等你被这些问题咬过一遍，再去刷题，效率会高很多——因为你知道自己在补什么，而不是为了刷而刷。',
        comments: [
          { author: '林小满', body: '这个顺序我没想到，那我先找个能跑起来的小东西。' },
          { author: '宋一', body: '同意，我当初就是先刷了三百题，写项目还是不会拆文件。' }
        ]
      },
      {
        author: '苏叶', hoursAgo: 1, votes: 6,
        body: '补充一个判断标准：如果你刷题时经常卡在「知道思路但写不出来」，那是代码量不够，去做项目；如果卡在「完全想不到思路」，那才是需要系统学算法。\n\n这两种卡点对应的训练方式完全不同，别混着练。',
        comments: []
      }
    ]
  },
  {
    author: '宋一',
    hoursAgo: 5,
    title: '为什么 TCP 会粘包，而 UDP 不会？',
    body: '看资料都说 TCP 是字节流、没有消息边界，所以会粘包。但为什么 UDP 就有边界？两者不都是走 IP 包吗？',
    tags: ['网络编程', 'TCP'],
    answers: [
      {
        author: '江隼', hoursAgo: 4, votes: 15,
        body: '关键差别不在底层，在于「上层看到的是什么」。\n\nTCP 向上提供的是字节流：它只保证你发的一串字节按顺序到达，但不会保留你每次调用 send 的边界。三次发送 100 字节，对方一次 recv 拿回 300 字节，完全合法——TCP 只对字节负责，不对「消息」负责。\n\nUDP 是数据报：每次 sendto 就对应一个独立的数据报，接收方一次 recvfrom 最多拿到一个完整数据报，边界由协议本身保留。代价是不保证到达、不保证顺序。\n\n所以「粘包」其实不是 TCP 的缺陷，而是你把它当消息流用却没自己定义边界。解决办法是加分帧：长度前缀，或者用换行、JSON 之类的分隔符。',
        comments: [
          { author: '宋一', body: '所以是我用错了，不是协议的锅。' },
          { author: '顾言', body: '一句话总结：TCP 只管字节，不管消息。' }
        ]
      }
    ]
  },
  {
    author: '陈墨',
    hoursAgo: 9,
    title: '小程序云开发的数据到底存在哪，能不能自己导出来做分析？',
    body: '用云开发存了几个集合，现在想看历史流水做点统计。后台能看数据，但一条条看没意义，想知道正规的导出方式。',
    tags: ['微信小程序', '云开发', '数据'],
    answers: [
      {
        author: '白露', hoursAgo: 8, votes: 11,
        body: '能导。云开发控制台里进数据库，选中集合，右上角有导出，格式一般是 JSON 或者 CSV。\n\n两个坑要提醒：\n\n一是导出的是嵌套结构的 JSON 时，日期字段会变成 {"$date": 1699999999999} 这种形式，直接丢进 Excel 会是一列乱码，得先转成时间戳或标准时间字符串。\n\n二是量大的话控制台导出会限条数，要分页导，或者写个云函数按时间区间分批查、打包成文件传到云存储再下载。\n\n如果你只是要几张图，导成 CSV 后丢进 Power BI 或者 Excel 数据透视就够，别一上来就建数据仓库。',
        comments: [
          { author: '陈墨', body: '就是那个 $date 让我卡了半天，谢谢。' }
        ]
      },
      {
        author: '老周', hoursAgo: 6, votes: 4,
        body: '做经营分析的话，建议顺手把商品表也导出来。流水里只有商品名和成交价，品类、进价这些在商品表里，两张表按 ID 关联才分析得出毛利。',
        comments: []
      }
    ]
  },
  {
    author: '老周',
    hoursAgo: 14,
    title: '给夫妻小店做库存管理，最该先做哪三个功能？',
    body: '想给家里的小店写个工具，功能越列越多，怕做不完也怕做出来没人用。如果只做三个功能，你会选什么？',
    tags: ['产品设计', '库存管理'],
    answers: [
      {
        author: '阿岚', hoursAgo: 12, votes: 18,
        body: '按「不做会立刻出事」排序：\n\n一、开单出库。这是店员每天用几十次的动作，必须两步能完成：选商品、改数量、确认。任何多一步的确认框都会被骂。\n\n二、进货入库并更新成本。不做这个，毛利就是错的；而毛利错了，后面所有报表都不可信。\n\n三、库存不足的提醒。不用做预测模型，就一个阈值，低于它就红着显示在首页。\n\n这三件事的共同点：它们都直接对应「今天要不要报警」。至于会员、优惠券、多店管理，等这三件事做到店员不抱怨了再说。',
        comments: [
          { author: '老周', body: '「不做会立刻出事」这个排序法很好用。' },
          { author: '林小满', body: '我们课程项目正好在做这个，第三条被我漏了。' }
        ]
      },
      {
        author: '陈墨', hoursAgo: 10, votes: 7,
        body: '补一句实现层面的：出库这一步千万别用「先查库存再更新」。两个人同时开单，都查到库存 1，就会卖出去两份。要用带条件的原子更新，比如库存 >= 数量才扣减，看影响行数判断成不成功。',
        comments: []
      }
    ]
  },
  {
    author: '林小满',
    hoursAgo: 20,
    title: '移动加权平均成本到底怎么算，能举个具体例子吗？',
    body: '课本上是公式，看得懂但不会用。比如先进了 10 个单价 2 元，又进了 30 个单价 2.4 元，那现在的成本是多少？',
    tags: ['会计', '库存管理', '算法'],
    answers: [
      {
        author: '老周', hoursAgo: 18, votes: 13,
        body: '先算总金额再除总数量：\n\n第一次：10 × 2 = 20 元\n第二次：30 × 2.4 = 72 元\n合计：40 个，92 元 → 成本 92 / 40 = 2.3 元/个\n\n关键点在于「移动」两个字：每次进货都重算一次，而不是月底统一算。这样任何时刻卖出一个，你都知道它的成本是多少。\n\n有个容易错的地方：卖出的时候不要再改成本，只减库存。成本只在进货时变。很多人的实现里卖一次就把成本算乱了。',
        comments: [
          { author: '林小满', body: '原来卖出不用改成本，我之前一直跟着改。' }
        ]
      }
    ]
  },
  {
    author: '顾言',
    hoursAgo: 28,
    title: 'Java Web 还有必要学 Servlet 吗，现在都是 Spring 满天飞？',
    body: '想搞明白 Web 请求到底怎么进来的。直接上 Spring Boot 是不是也行，还是说必须从 Servlet 学起？',
    tags: ['Java', '后端', 'Spring'],
    answers: [
      {
        author: '江隼', hoursAgo: 26, votes: 10,
        body: '不必学到能写生产代码，但值得花两小时搞懂它是什么。\n\n因为 Spring MVC 底下跑的还是 Servlet：DispatcherServlet 就是一个 Servlet。你不了解它的生命周期，就永远不明白为什么过滤器能改请求、为什么 request body 只能读一次、为什么线程池配错了会串数据。\n\n建议的做法：写一个最小的 Servlet，用 doGet 返回一句 hello，打成 war 丢进 Tomcat，再用浏览器访问一次。整个过程不到一小时，但你从此知道「容器」是什么东西。\n\n然后立刻回到 Spring Boot，别在 XML 配置上耗时间。',
        comments: [
          { author: '顾言', body: '「打到 war 丢进 Tomcat 一次」这个建议很具体。' }
        ]
      }
    ]
  },
  {
    author: '白露',
    hoursAgo: 34,
    title: '用 Power BI 做小店的经营看板，哪几个图最值得放？',
    body: '数据有销售流水、进货记录和商品表。想做一个一页纸的看板，不知道放什么才不会变成「什么都放了但没人看」。',
    tags: ['Power BI', '数据可视化'],
    answers: [
      {
        author: '老周', hoursAgo: 30, votes: 12,
        body: '一页纸最多四块，按「看完要做什么决定」来选：\n\n一、销售额趋势（按周）。看的是有没有在掉。\n二、毛利排行前几名和倒数几名。看的是该推什么、该砍什么。\n三、品类占比。看的是结构有没有偏。\n四、库存预警清单。看的是明天该进什么货。\n\n至于总数、平均数这些，放在卡片上做标题就行，不用单独占一个图。\n\n另外记得建一张日期表，否则按周、按月、同比环比全都不好算。',
        comments: [
          { author: '白露', body: '日期表这一步我确实跳过了，难怪按周汇总不对。' }
        ]
      },
      {
        author: '陈墨', hoursAgo: 29, votes: 5,
        body: '补一个细节：销售流水里要存下单时的成本快照（buyPrice），不要查询时再去商品表取当前进价。不然一进货涨价，历史毛利全变了。',
        comments: []
      }
    ]
  },
  {
    author: '何充',
    hoursAgo: 40,
    title: '第一次把 Docker 应用部署到云平台，最容易踩什么坑？',
    body: '本地跑得好好的，一上云就各种问题。想提前知道雷在哪。',
    tags: ['Docker', '部署', '运维'],
    answers: [
      {
        author: '江隼', hoursAgo: 38, votes: 14,
        body: '按踩雷频率排：\n\n一、端口写死。云平台会用 PORT 环境变量告诉你该监听哪个端口，你写死 8080 就永远连不上。启动脚本里读环境变量。\n\n二、只监听 127.0.0.1。容器里必须监听 0.0.0.0，不然外面进不来。\n\n三、文件写进容器。容器一重启，写进去的数据全没了。数据库文件要挂卷，或者用平台提供的持久化存储。\n\n四、镜像太大。把 node_modules、.git 一起 COPY 进去，构建慢还容易失败，写好 .dockerignore。\n\n五、忘了健康检查。免费实例会休眠，冷启动那几秒没处理好，第一个访问的人会看到错误页。',
        comments: [
          { author: '何充', body: '第一条我就中了，一直在等 8080。' },
          { author: '宋一', body: '第三条太真实了，我签到数据重启就没。' }
        ]
      }
    ]
  },
  {
    author: '宋一',
    hoursAgo: 52,
    title: '写代码总是改一处坏一处，有什么办法？',
    body: '功能一多就不敢动了，改完 A 发现 B 挂了。感觉不是不会写，是管不住。',
    tags: ['工程实践', '重构', '测试'],
    answers: [
      {
        author: '江隼', hoursAgo: 48, votes: 16,
        body: '这不是能力问题，是缺一张安全网。\n\n最直接的办法：给「不能坏的东西」写测试。不用追求覆盖率，先挑三个最核心的动作，比如登录、下单、扣库存，写成能一键跑的脚本。以后每次改完跑一遍，绿了再提交。\n\n第二个办法是把大函数拆小。一个函数超过五十行，你大概率说不清它到底负责几件事；拆开之后，改哪一块影响面是清楚的。\n\n第三个是习惯性小步提交。一次改一个问题，改完就提交，出事了能精确回退，而不是在两百行 diff 里找凶手。',
        comments: [
          { author: '林小满', body: '我们那个聊天程序就是加了测试之后才敢继续改的。' }
        ]
      },
      {
        author: '苏叶', hoursAgo: 44, votes: 8,
        body: '还有个信号：如果你每次改动都要「先读半小时代码才敢动」，说明命名和目录结构已经在拖你了。花半天把名字改准，比后面十次 bug 划算。',
        comments: []
      }
    ]
  },
  {
    author: '陈墨',
    hoursAgo: 70,
    title: '有什么值得长期坚持的编程习惯？',
    body: '想养成几个真正有用的习惯，不是那种「每天刷一题」的口号。',
    tags: ['学习方法', '职业成长'],
    answers: [
      {
        author: '顾言', hoursAgo: 66, votes: 20,
        body: '三个我坚持了五年还在用的：\n\n一、遇到报错先读完整信息，包括最后一行和文件行号，不要直接复制去搜。九成的错误信息其实已经说清楚了。\n\n二、把「为什么这么写」写进提交信息，而不是注释。半年后你会感谢当时的自己，因为 diff 里能看出决策过程。\n\n三、任何要重复第三次的手工操作，就停下来写脚本。第三次是分水岭：第一次学，第二次确认，第三次该自动化了。',
        comments: [
          { author: '宋一', body: '第三条我打算从改密码开始……' }
        ]
      },
      {
        author: '白露', hoursAgo: 60, votes: 9,
        body: '再加一个：给项目写一份「别人能照着跑起来」的 README。写的过程会逼你把环境依赖、启动步骤、数据初始化全部理清，很多隐藏的坑就在这一步暴露。',
        comments: []
      }
    ]
  }
];

/* ------------------------------------------------------------------ 写入 */

tx(() => {
  const idOf = new Map();
  for (const u of USERS) {
    const r = run(
      'INSERT INTO users (name, email, password, bio, created_at) VALUES (?, ?, ?, ?, ?)',
      u.name, u.email, hashPassword('123456'), u.bio, now - 90 * 24 * HOUR
    );
    idOf.set(u.name, Number(r.lastInsertRowid));
  }

  const others = (authorName) => USERS.filter((u) => u.name !== authorName).map((u) => idOf.get(u.name));

  for (const q of QUESTIONS) {
    const qid = Number(run(
      'INSERT INTO questions (user_id, title, body, views, created_at) VALUES (?, ?, ?, ?, ?)',
      idOf.get(q.author), q.title, q.body,
      Math.floor(60 + q.hoursAgo * 37), now - q.hoursAgo * HOUR
    ).lastInsertRowid);

    for (const name of q.tags) {
      run('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
      const tagId = get('SELECT id FROM tags WHERE name = ?', name).id;
      run('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)', qid, tagId);
    }

    // 问题本身也投票，热榜才有区分度
    const qVoters = others(q.author).slice(0, 2 + (q.tags.length % 4) + (Math.floor(q.hoursAgo) % 3));
    for (const uid of qVoters) {
      run(
        'INSERT OR IGNORE INTO votes (user_id, target_type, target_id, value) VALUES (?, ?, ?, ?)',
        uid, 'question', qid, 1
      );
    }

    for (const a of q.answers || []) {
      const aid = Number(run(
        'INSERT INTO answers (question_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
        qid, idOf.get(a.author), a.body, now - a.hoursAgo * HOUR
      ).lastInsertRowid);

      // 投票：从其他用户里取若干个，最多 9 个（总共 10 个用户）
      const voters = others(a.author).slice(0, Math.min(a.votes || 0, 9));
      for (const uid of voters) {
        run(
          'INSERT OR IGNORE INTO votes (user_id, target_type, target_id, value) VALUES (?, ?, ?, ?)',
          uid, 'answer', aid, 1
        );
      }
      // 再给个踩，让分数别太整齐
      if ((a.votes || 0) % 5 === 0 && others(a.author).length > 7) {
        run(
          'INSERT OR IGNORE INTO votes (user_id, target_type, target_id, value) VALUES (?, ?, ?, ?)',
          others(a.author)[7], 'answer', aid, -1
        );
      }

      for (const c of a.comments || []) {
        run(
          'INSERT INTO comments (answer_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
          aid, idOf.get(c.author), c.body, now - (a.hoursAgo - 0.3) * HOUR
        );
      }
    }
  }
});

const counts = {
  用户: get('SELECT COUNT(*) AS c FROM users').c,
  问题: get('SELECT COUNT(*) AS c FROM questions').c,
  回答: get('SELECT COUNT(*) AS c FROM answers').c,
  评论: get('SELECT COUNT(*) AS c FROM comments').c,
  投票: get('SELECT COUNT(*) AS c FROM votes').c,
  标签: get('SELECT COUNT(*) AS c FROM tags').c
};

console.log('演示数据写入完成：', counts);
console.log('登录示例 → 邮箱 chenmo@example.com，密码 123456');
