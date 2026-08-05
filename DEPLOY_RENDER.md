# Render 正式部署

项目已包含 `render.yaml`，推荐通过 Render Blueprint 创建服务。该配置会创建一个新加坡区域的 Starter Web Service 和 1 GB 持久化磁盘。

## 1. 上传 GitHub

在项目目录执行：

```powershell
git init
git add .
git commit -m "准备 Render 部署"
git branch -M main
git remote add origin https://github.com/你的用户名/kaoyan-dashboard.git
git push -u origin main
```

`data/`、`uploads/`、`.env` 和 `node_modules/` 已被忽略，不会进入仓库。

## 2. 创建 Render Blueprint

1. 登录 Render，点击 `New` -> `Blueprint`。
2. 连接上一步的 GitHub 仓库。
3. Render 会读取仓库根目录的 `render.yaml`。
4. 在首次创建时填写 `REGISTRATION_INVITE_CODE`，建议使用至少 12 位、难以猜测的随机内容。
5. 确认创建付费的 Starter 服务和 1 GB 持久化磁盘。

部署完成后访问 Render 提供的 `https://*.onrender.com` 地址，通过邀请码注册第一个账号。

## 3. 部署检查

- 打开 `/api/health`，应返回 `ok: true`。
- 注册、退出并重新登录。
- 新建任务和成绩，刷新页面确认仍存在。
- 上传笔记图片，退出登录后直接访问图片地址应返回 401。
- 在 Render 控制台重启服务，再次确认数据仍存在。

## 4. 本地数据迁移

云端默认创建空数据库。如果需要保留本地数据，先停止本地与云端服务，再把以下内容传入持久化磁盘：

```text
data/yantu.db  -> /var/data/yantu.db
uploads/       -> /var/data/uploads/
```

SQLite 数据迁移时不要在服务运行期间直接覆盖数据库。若已有重要数据，迁移前另存一份完整备份。

## 5. 环境变量

`render.yaml` 已设置：

```text
NODE_ENV=production
HOST=0.0.0.0
DATABASE_PATH=/var/data/yantu.db
UPLOAD_ROOT=/var/data/uploads
```

`REGISTRATION_INVITE_CODE` 作为 Render Secret 单独填写，不会写入 Git 仓库。

## 6. 更新与备份

- 推送到 GitHub 的 `main` 分支后，Render 会自动部署。
- 持久化磁盘每天自动生成快照，但重要数据仍建议定期导出到另一处存储。
- 当前架构只能运行一个实例。用户规模增大后，应把 SQLite 迁移到 PostgreSQL，并把图片迁移到 S3 兼容对象存储。
