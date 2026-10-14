# dz-pk Docker 远程部署（方案 C）

## Goal

将 Texas Hold'em 训练站以 Docker 部署到个人远程服务器，端口 **1111**，多台电脑可共享服务器上的资金余额。

## Architecture

- **web**：Nginx 托管 Vite 静态构建产物；`/api/bankroll` 反代到 api
- **api**：Node 单文件 HTTP 服务，读写挂载卷中的 `bankroll.json`
- **volume**：`./data` → 容器 `/data`，持久化余额
- **port**：宿主机 `1111` → web `80`

## Out of scope

- 多用户账号隔离（多机共享同一份余额）
- HTTPS / 域名

## Deploy path

`/home/ubuntu/apps/dz-pk`，`docker compose up -d --build`
