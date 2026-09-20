# 認証・ユーザー別データ分離の設定

1. Supabaseでプロジェクトを作成します。
2. SQL Editorで`supabase/schema.sql`を実行します。
3. Supabase AuthのEmail設定を確認します。メール確認を有効にする場合、登録後に確認メールが届きます。
4. VercelのEnvironment Variablesに`.env.example`の3つを登録します。
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（サーバー側だけに登録し、公開・クライアント側へ絶対に出さない）
5. Vercelを再デプロイします。

APIはBearerアクセストークンをSupabase Authへ照会してログインユーザーを確定します。習慣・記録のDB操作では、リクエスト本文の`userId`を受け付けず、検証済みトークンのユーザーIDをサーバー側で付与・検索条件に使います。
