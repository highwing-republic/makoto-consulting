宿泊DXラボ / 誠コンサルティング 完成版
========================================

このフォルダは、既存の GitHub Pages リポジトリへ上書きするためのファイルです。

構成
----
/                         宿泊DXラボ トップ
/consulting/              誠コンサルティング
/privacy/                 プライバシーポリシー
/favicon.* ほか           favicon / Apple / Android用アイコン
/site.webmanifest         Web App manifest
/robots.txt               クローラー設定
/sitemap.xml              sitemap
/404.html                 404ページ
/styles.css               共通CSS
/CNAME                    lab.ugatta-llc.com

重要
----
既存リポジトリの images フォルダは削除しないでください。
この完成版は次の既存画像を使用します。
  images/hero.jpg
  images/room.jpg
  images/onsen-town.jpg
  images/meeting.jpg

GA4
---
測定ID: G-QS9HSHCY33
トップ・consulting・privacy・404に組み込み済みです。
分析ツール、コンサルティング、問い合わせ主要リンクはGA4イベントも送信します。

反映方法
--------
1. このZIPを展開
2. 展開した中身を既存のサイトリポジトリ直下へコピーして上書き
3. images フォルダはそのまま残す
4. VS Code ターミナルで以下を実行

   git status
   git add .
   git commit -m "Redesign site as Shukuhaku DX Lab"
   git push origin main

5. 数分後 https://lab.ugatta-llc.com/ を確認
6. faviconが古い場合は Ctrl + F5 で強制再読み込み
