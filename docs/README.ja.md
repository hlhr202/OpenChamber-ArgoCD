# OpenChamber Argo CD Observer

[English](../README.md) | [简体中文](README.zh-CN.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [עברית](README.he.md) | 日本語 | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português (Brasil)](README.pt-BR.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [繁體中文](README.zh-TW.md)

**OpenChamber 向けの読み取り専用 Argo CD 拡張機能**です。ワークスペースを離れずに、アプリケーションやデプロイの確認、リソースのログやイベントの閲覧ができます。

## インストール

1. OpenChamber で **設定 → 拡張機能**を開きます。
2. **フォルダー、ZIP、または URL** に次のリポジトリ URL を貼り付け、**追加**をクリックします。

   ```text
   https://github.com/hlhr202/OpenChamber-ArgoCD
   ```

3. 要求された Service 機能を確認し、**許可して有効化**を選択します。
4. 拡張機能バーから **Argo CD** を開き、既存のコンテキストを読み込みます。

ローカルでのビルドや依存関係のインストールは不要です。

または、[Releases](https://github.com/hlhr202/OpenChamber-ArgoCD/releases/latest) から **openchamber-argocd.zip** をダウンロードし、拡張機能に追加してください。GitHub の **Source code (zip)** ではなく、添付のビルド済み ZIP を使用してください。

## 前提条件

- **拡張機能に対応した OpenChamber**。拡張機能は [v1.24.0](https://github.com/openchamber/openchamber/releases/tag/v1.24.0) で導入されました。このビルドのインストール要件は現在 **v2.2.0 以降**で、それ以前のバージョンとの互換性は未検証です。
- OpenChamber Server を実行する OS ユーザーで **Argo CD CLI がインストール・設定済み**であること。有効な認証情報と、必要なアプリケーション、リソース、ログ、イベントの読み取り権限が必要です。拡張機能は既存の設定を読み取るだけで、CLI の実行や別途のログインは行いません。
- OpenChamber Server から設定済みの Argo CD API にアクセスできること。

## スクリーンショット

サンプルデータを使用した英語の画面です。

**デスクトップ — アプリケーション一覧と概要**

![デスクトップでの Argo CD アプリケーション一覧と概要](applications-desktop.png)

**モバイル — アプリケーション一覧**

![モバイルでの Argo CD アプリケーション一覧](applications-mobile.png)

## 機能

- Argo CD コンテキストの切り替え、アプリケーションの検索と絞り込み。
- アプリケーション設定、状態、デプロイ履歴、リソースツリーの確認。
- Pod／コンテナのログ、イベント、マニフェスト、差分の閲覧。
- トラブルシューティング要約のプレビューと、確認後のチャットへの追加。
- 設計上読み取り専用で、OpenChamber の言語とテーマに追従。

## プライバシー

- 本拡張機能は個人情報を収集せず、非公開データを開発者に送信しません。テレメトリ、分析、追跡機能は含まれていません。
- 既存のローカル認証情報は、設定済み Argo CD API へのリクエスト認証のためだけに読み取ります。認証情報、アプリケーションデータ、ログ、イベントは、開発者や第三者が運営するデータ収集サービスにはアップロードされません。
- 閲覧設定（ディレクトリ、コンテキスト、アプリケーション／リソース ID、フィルター、タブ、レイアウト）は OpenChamber ストレージに保存されます。対応している場合はこの端末に、それ以外は接続先の Server に保存されます。認証情報、クエリ結果、ログ／イベント本文、要約プレビューはそこには保存されません。選択状態の復元時にはデータを再取得し、ログの追従は自動再開しません。
- 要約のチャットへの追加には、明示的なプレビューと確認が必要です。その後送信した場合、OpenChamber と選択したモデル提供者が、それぞれのポリシーに従って内容を処理します。

この説明は本拡張機能のみを対象とし、OpenChamber、Argo CD、モデル提供者のデータ処理方針を対象とするものではありません。

## ライセンス

[MIT](../LICENSE)。同梱の依存関係と Argo アイコンにはそれぞれのライセンスが適用されます。[第三者に関する通知](../THIRD_PARTY_NOTICES.txt)をご覧ください。
