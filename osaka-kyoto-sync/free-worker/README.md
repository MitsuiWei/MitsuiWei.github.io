# 免費同步方案：Cloudflare Workers Free

取代需 Blaze 的 Firebase Functions 方案。現有網站仍直接寫入 Firebase Firestore，無需更改網站或 Firestore 規則。Worker 每分鐘以公開讀取規則讀取唯一行程文件，只有來源 updateTime 較新才更新私人 GitHub 的 latest-itinerary.json。這是輪詢，不是保證即時；Cron 延遲、服務故障、免費額度／CPU 限制均可能延長同步。正常每日約 1440 次 Firestore 文件讀取，衝突重試另計，需和其他功能合併計算。不得升級任何付費方案。無公開 Worker HTTP 入口，不接受外部資料，不寫回 Firebase。不複製獨立照片集合。

## 一次性操作

1. 新建私人 GitHub repo MitsuiWei/osaka-kyoto-private-sync，初始化 README，讓 ChatGPT GitHub 連線能讀該 repo。
2. 建立只限該 repo 的 fine-grained PAT，Contents read/write、Metadata read。勿貼入聊天或源碼。
3. 確認 Cloudflare 帳號保持 Workers Free、Firebase 保持 Spark。此資料夾使用 Wrangler CLI 登入與部署：

```sh
node --test worker.test.mjs
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

如果首次設定 secret 時提示建立 Worker，確認名稱為 osaka-kyoto-free-sync；若 CLI 需要先部署，先執行 deploy 再設定 secret。不要使用前一版 Firebase Functions 部署指令。若目的 repo 改名，調整 wrangler.toml 的 MIRROR_REPO。

4. 到 Cloudflare Worker 的 Cron 與日誌核對執行狀態；確認私人庫首次同步出現 latest-itinerary.json。若 REST 讀取失敗（如 API 或實際安全規則限制），停止驗收，不要放寬規則或改用公開鏡像。
5. 在網站修改一筆測試行程、確認私人庫時間戳與內容更新，再還原。ChatGPT 每次應重新取該鏡像；sourceUpdatedAt 是來源修改時間而非最近一次健康檢查。不能確認同步成功時，不得宣稱為最新資料。

目前只有原始碼，尚未部署及執行實際端到端驗收。測試為模擬，不代表真實 Firebase 或 GitHub 已連通。免費 Worker 有 CPU 等限制，超限可能停止同步；不可自動轉付費。