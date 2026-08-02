# 发版与自动更新

更新源：[Alex-Lee-morning/GIF_WEB](https://github.com/Alex-Lee-morning/GIF_WEB) Releases  
模版配置：[`update-config.json`](./update-config.json)

## 朋友端行为

- 每次打开**已安装**的应用会自动检查 GitHub Releases
- 有新版本则下载，设置页底部可点「重启并安装」
- **Windows portable 绿色版不支持自动更新**，请让朋友使用 NSIS 安装包（`像素桌宠-*-win-x64.exe`）
- Mac 自动更新使用 zip 通道（`latest-mac.yml`）

## 发版步骤

1. 修改根目录 `package.json` 的 `version`（例如 `1.0.0` → `1.0.1`）
2. 打包：
   ```bash
   npm run dist      # Mac → release/
   npm run dist:win  # Windows → Windows版/
   ```
3. 首次需要：
   ```bash
   gh auth login
   git remote add origin https://github.com/Alex-Lee-morning/GIF_WEB.git   # 若尚未添加
   ```
4. 上传 Release（会创建 `vX.Y.Z` 并上传 `latest.yml` / `latest-mac.yml` 与安装包）：
   ```bash
   npm run release:publish
   ```

## 必需产物

| 平台 | 自动更新需要 |
|------|----------------|
| Mac | `release/latest-mac.yml` + `像素桌宠-*-mac.zip` / `*-arm64-mac.zip` |
| Windows | `Windows版/latest.yml`（或 `release/latest.yml`）+ `像素桌宠-*-win-x64.exe`（NSIS）及 `.blockmap` |

`electron-builder` 打包时会自动生成 `latest.yml` / `latest-mac.yml`。

## 说明

- 开发模式（`npm run dev`）不检查更新
- 检查失败（网络/GitHub）时静默记错误，不阻断使用
- 未签名 Mac 应用更新可能被系统拦截；Windows NSIS 更稳
