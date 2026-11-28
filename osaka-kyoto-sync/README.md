# 大阪京都行程：Firestore → 私人 GitHub 即時同步

現有網站的每次行程操作已寫入 Firestore `sharedTrips/osaka-kyoto-2026`。本獨立 Firebase Functions codebase 不修改前端或資料庫規則；監聽該文件所有寫入，把完整行程及清單資料鏡像至私人 GitHub 的 `latest-itinerary.json`。照片檔案在另一個集合，只同步主文件中的照片 ID／資料，不複製該集合的圖片二進位內容。

## 一次性部署（需專案管理者）

1. 在 MitsuiWei 帳號建立 **Private** 儲存庫 `osaka-kyoto-private-sync`，勾選 Add a README 以初始化預設分支。授權 ChatGPT GitHub 連線讀取該儲存庫。
2. 建立 GitHub fine-grained PAT：只選該私人儲存庫，Contents: Read and write，Metadata: Read（自動）。設定合理到期日。不得貼入聊天或程式碼。
3. 確認 Firebase 專案 `project-ad1d2` 啟用 Blaze 計費方案及必要 IAM/API。確認 Firestore 資料庫位置並選擇支援的近鄰 Functions region（預設 us-central1，依專案實況調整）。部署身份須有部署 Functions、設定 Secret、使用 Eventarc/Scheduler 等所需權限；執行身份須能讀取 Firestore 及使用指定 Secret。
4. 在此資料夾（osaka-kyoto-sync）執行：

```sh
npm install -g firebase-tools
firebase login
cd functions
npm install
npm test
cd ..
firebase functions:secrets:set TRIP_MIRROR_GITHUB_TOKEN --project project-ad1d2
firebase deploy --only functions:osaka-kyoto-sync --project project-ad1d2
```

在 Secret 指令提示時安全輸入 PAT。部署參數 TRIP_MIRROR_REPO 預設為上述私人庫，TRIP_MIRROR_REGION 預設 us-central1，可依實際狀況設定。切勿使用公開儲存庫作鏡像；程式會檢查並拒絕。

## 驗收

- 部署完成後首次排程 15 分鐘內執行（或透過網站真實修改觸發；不需要清空資料）。
- 確認私人儲存庫出現 latest-itinerary.json，sourceUpdatedAt 對應 Firestore 的文件更新時間。
- 在網站新增或修改一筆可辨識的測試項目，確認 Firestore 及 GitHub 資料在事件傳遞後一致，再透過網站還原。不要在 GitHub 手動編輯鏡像。
- 確認 ChatGPT 能透過 GitHub 讀取這個檔案並回報 sourceUpdatedAt；未能確認同步健康時，不將鏡像冒充即時資料。

事件驅動接近即時（不是零延遲保證）；每 15 分鐘補同步以修復漏同步和初始化。使用 Firestore 文件更新時間、GitHub SHA compare-and-swap、重試，防止舊事件覆蓋新內容。兩種觸發都只讀 Firestore 並寫入私人 GitHub，不會改動行程。Cloud Functions、Scheduler、Secret Manager、Firestore 和 GitHub 可能產生用量或費用；部署前確認計費及額度。私人 Git 歷史會保留過往行程內容，不適合存放不希望被版本留存的秘密。

## 未部署前

此程式只是待部署原始碼；不會自動啟用雲端資源，也不會改變現有網站。部署後仍必須驗證實際同步與權限。
