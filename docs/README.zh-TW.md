# OpenChamber Argo CD Observer

[English](../README.md) | [简体中文](README.zh-CN.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [עברית](README.he.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (Brasil)](README.pt-BR.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | 繁體中文

一個 **OpenChamber 的唯讀 Argo CD 擴充功能**。無須離開工作區，即可瀏覽應用程式、檢視部署詳細資訊，以及讀取資源日誌和事件。

## 安裝

1. 在 OpenChamber 中開啟 **設定 → 擴充功能**。
2. 在 **資料夾、ZIP 或 URL** 欄位中貼上以下儲存庫網址，點擊 **新增**：

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. 確認所要求的 Service 能力，選擇 **允許並啟用**。
4. 從擴充功能列開啟 **Argo CD**，載入現有的 contexts。

無須在本機建置或安裝相依套件。

也可從 [Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest) 下載 **openchamber-argocd.zip**，在擴充功能設定中新增該 ZIP。請選擇附件中的預先建置套件，而非 GitHub 自動產生的 **Source code (zip)**。

## 必要條件

- **支援擴充功能的 OpenChamber**：擴充功能從 [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0) 引入。此建置目前要求至少 **v2.2.0** 才能安裝，更早版本的相容性尚未驗證。
- **已安裝並設定 Argo CD CLI**：執行 OpenChamber Server 的系統使用者需具備有效憑證，以及讀取所需應用程式、資源、日誌和事件的權限。擴充功能直接讀取現有設定，不執行 CLI，也不另外登入。
- OpenChamber Server 必須能存取設定的 Argo CD API。

## 螢幕截圖

英文介面，使用範例資料。

**桌面 — 應用程式清單與概覽**

![桌面上的 Argo CD 應用程式清單與概覽](applications-desktop.png)

**行動裝置 — 應用程式清單**

![行動裝置上的 Argo CD 應用程式清單](applications-mobile.png)

## 功能

- 切換 Argo CD context，搜尋和篩選應用程式。
- 檢視應用程式設定、執行狀態、部署歷程和資源樹。
- 讀取 Pod／容器日誌、事件、Manifest 和 Diff。
- 預覽疑難排解摘要，並在確認後加入聊天。
- 全程唯讀，跟隨 OpenChamber 的語言與佈景主題。

## 隱私

- 本擴充功能不蒐集個人資訊，也不向開發者回報私人資料；不包含遙測、行為分析或追蹤。
- 僅為驗證傳送至您設定的 Argo CD API 的請求而讀取現有本機憑證，不會將憑證、應用程式資料、日誌或事件上傳至開發者或第三方的資料蒐集服務。
- 瀏覽偏好（目錄、context、應用程式／資源識別碼、應用程式篩選、分頁和版面配置）儲存於 OpenChamber 儲存空間：支援時儲存在目前裝置，否則儲存在連線的 Server。不會在其中儲存憑證、查詢結果、日誌／事件內文或摘要預覽。還原選取項目後會重新查詢資料，日誌跟隨不會自動恢復。
- 將摘要加入聊天需要您明確預覽並確認；若隨後傳送，內容由 OpenChamber 和您選擇的模型服務供應商依各自政策處理。

本聲明僅適用於本擴充功能，不代表 OpenChamber、Argo CD 或模型服務供應商的資料處理政策。

## 授權條款

[MIT](../LICENSE)。隨附的相依套件和 Argo 圖示保留各自的授權條款，詳見[第三方聲明](../THIRD_PARTY_NOTICES.txt)。
