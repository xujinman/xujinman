# Render + Supabase 免费部署

云端结构：Render 免费 Node.js 服务 + Supabase 免费 PostgreSQL + Supabase 私有 Storage。本地开发仍然使用 SQLite 和本地 `uploads/`，无需配置 Supabase。

## 1. 创建 Supabase 免费项目

1. 登录 https://supabase.com/dashboard 并创建 Free Plan 项目。
2. 保存项目的数据库密码。
3. 在项目顶部点击 `Connect`，复制 **Session pooler** 连接串（端口 5432），将其中的 `[YOUR-PASSWORD]` 换成数据库密码。这就是 `DATABASE_URL`。
4. 打开 `Project Settings` -> `API`：
   - Project URL 是 `SUPABASE_URL`。
   - `service_role` Secret 是 `SUPABASE_SERVICE_ROLE_KEY`。

`service_role` 拥有管理权限，只能放在 Render Secret 中，绝不能写入前端、Git 仓库或发给其他人。

如果数据库密码包含 `@`、`#`、`:`、`/` 等 URL 特殊字符，需要先进行 URL 编码后再放入连接串；最省事的做法是在创建项目时使用足够长的字母和数字组合。

无需手动建表或创建 Storage bucket。服务第一次启动时会自动创建数据库表、启用 RLS，并创建私有的 `yantu-uploads` bucket。

## 2. 在 Render 创建免费 Blueprint

1. 如果之前停在付款窗口，点击 `Cancel` 并删除未创建成功的付费 Blueprint。
2. 登录 Render，点击 `New` -> `Blueprint`。
3. 连接 GitHub 仓库 `xujinman/xujinman`。
4. Render 读取 `render.yaml` 后会要求填写：
   - `DATABASE_URL`：Supabase Session pooler 连接串。
   - `SUPABASE_URL`：Supabase Project URL。
   - `SUPABASE_SERVICE_ROLE_KEY`：Supabase `service_role` Secret。
   - `REGISTRATION_INVITE_CODE`：自己设置至少 12 位的邀请码。
5. 确认创建。配置中的 `plan: free` 不需要持久化磁盘或付费实例。

## 3. 上线验证

部署完成后：

1. 打开 `https://你的服务.onrender.com/api/health`。
2. 应看到 `database: "postgres"` 和 `storage: "supabase"`。
3. 使用邀请码注册，录入目标、任务和成绩，并上传一张笔记图片。
4. 刷新页面确认数据存在。
5. 在 Render 控制台重新部署，再确认数据仍存在。

## 4. 免费版本限制

- Render 免费 Web Service 长时间无访问会休眠，下一次打开可能需要等待约一分钟。
- Render 本地文件会被清空，因此云端不能依赖 SQLite 或本地 `uploads/`；本项目的云端数据已全部改存 Supabase。
- Supabase Free Plan 有数据库、存储和流量额度，个人学习用途通常够用，仍需关注控制台用量。
- 免费服务不等同于具备 SLA 的生产服务，重要数据建议定期导出备份。

## 5. 本地启动

本地不设置云端环境变量时，继续使用：

```powershell
npm install
npm start
```

本地数据仍位于：

```text
data/yantu.db
uploads/<用户ID>/
```
