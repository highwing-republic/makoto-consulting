# 宿泊DXラボ
- このリポジトリは宿泊DXラボ（https://lab.ugatta-llc.com/）です。ugatta-lab へ改名予定です。
- UGATTA公式サイト（https://ugatta-llc.com/）は別リポジトリ highwing-republic/ugatta-homepage です。こちらでは編集しません。
- 公開方式：GitHub Pages（main ブランチ / root、Jekyll）。公開しないファイルは _config.yml の exclude で管理します。
- main は自動ジョブが更新します（平日05:00〜11:00 JSTは20分ごと、毎日06:10、毎週火曜06:17）。push の前に git pull --rebase origin main を実行してください。
- 作業の始め方：git fetch origin → git status → 新しいブランチは origin/main から作ります。
- 公開リポジトリです。個人情報、顧客資料、.env、認証情報はコミットしないでください。
- テスト：python -m pytest -q と node --test tests/*.test.cjs
