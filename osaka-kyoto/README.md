# 大阪・京都 2026 行程網站

手機可用的靜態行程網站。點選地點名稱或地圖按鈕，會在 Google Maps 搜尋該地點；IG 按鈕保留 Word 文件內的原始連結。

## 功能

- 依日期瀏覽、搜尋、收藏與標記完成。
- 新增、編輯、刪除、移動日期與調整順序。
- 每次修改先儲存在這台裝置。可下載及匯入 JSON 備份。
- 設定 Firebase 後，以同一 Google 帳號跨裝置同步。

## 雲端同步設定

1. 在 Firebase Console 建立專案，新增 Web App，複製 `firebaseConfig` 物件到 `firebase-config.js`，取代 `null`。
2. Authentication → Sign-in method：啟用 Google。
3. Authentication → Settings → Authorized domains：加入 `mitsuiwei.github.io`。
4. Firestore Database：建立資料庫，將 `firestore.rules` 的內容貼到「規則」並發布。
5. 網站使用者在「同步」頁以 Google 登入。同一個帳號在其他裝置登入後，會讀取相同行程。

Firebase Web App 設定值可公開；安全性取決於 Firestore 規則。不要把服務帳戶私鑰或其他機密放進此儲存庫。

## 本機預覽

在這個資料夾執行 `node preview.mjs`，開啟 `http://127.0.0.1:4173/`。

