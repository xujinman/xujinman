研途 · 考研学习管理平台

技术结构：
- 前端：HTML / CSS / JavaScript
- 后端：Node.js / Express
- 数据库：Node.js 内置 SQLite
- 登录：服务端 Session + HttpOnly Cookie
- 密码：服务端 scrypt 加盐哈希，不保存明文
- 图片：本机 uploads 目录（可在生产环境替换成对象存储）

启动方法：
1. 双击 start-server.cmd。
2. 看到“研途服务已启动”后不要关闭该窗口。
3. 浏览器打开：http://127.0.0.1:3000
4. 首次使用先注册账号。

注意：接入后端后不能再直接双击 index.html，必须通过上面的地址访问，否则无法连接 API。

若在另一台电脑运行：
1. 安装 Node.js 24 或更新版本。
2. 在项目目录执行 npm install。
3. 执行 npm start。

数据位置：
- SQLite 数据库：data/yantu.db
- 笔记图片：uploads/<用户ID>/
- 备份时请先停止服务，再同时复制 data 和 uploads 目录。

账户与安全：
- 注册、登录、退出和修改密码均在服务端完成。
- 登录状态保存在 HttpOnly、SameSite=Lax Cookie 中。
- 每条目标、任务、进度、成绩和笔记记录均关联 user_id。
- 所有数据查询和写入都从服务端 Session 获取当前用户，不接受前端伪造 user_id。
- 登录失败带有基础频率限制。
- 第一次注册服务端账号时，网页会尝试迁移旧版 LocalStorage 学习数据。

主要 API：
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET  /api/auth/me
- PUT  /api/profile
- PUT  /api/password
- GET  /api/bootstrap
- PUT  /api/data/tasks
- PUT  /api/data/school
- PUT  /api/data/progress
- PUT  /api/data/scores
- PUT  /api/data/notes
- POST /api/uploads

当前功能：
- 多账号独立学习空间
- 目标院校、专业、初试日期和四科目标分
- 每日任务与完成状态
- 四科复习进度
- 单科成绩录入、趋势图和目标分析
- 学习笔记、搜索筛选、置顶及图片上传
- 个人中心、昵称和密码修改
- 手机端自适应布局

生产部署说明：
- 项目根目录已提供 render.yaml 和 DEPLOY_RENDER.md，可通过 Render Blueprint 部署。
- 设置 NODE_ENV=production 后 Cookie 会启用 Secure，因此必须通过 HTTPS 访问。
- 可使用 HOST、PORT、DATABASE_PATH、UPLOAD_ROOT 环境变量修改监听地址、端口、数据库和图片目录。
- 设置 REGISTRATION_INVITE_CODE 后，新用户必须填写正确邀请码才能注册。
- 笔记图片接口需要登录，并且只能读取当前账户自己的图片。
- 当前 SQLite 适合本机或单机部署；多人公网使用时建议将 server/database.js 替换为 PostgreSQL/Prisma 实现。
- 图片较多时应将 /api/uploads 改为 S3 兼容对象存储的预签名上传。
