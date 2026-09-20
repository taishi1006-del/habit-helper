# 認証・ユーザー別データ分離の設定

1. Supabaseでプロジェクトを作成します。
2. SQL Editorで`supabase/schema.sql`を実行します。
3. Supabase AuthのEmail設定を確認します。メール確認を有効にする場合、登録後に確認メールが届きます。
4. ローカルではプロジェクトルートの`.env.local`に`.env.example`の値を設定します。Viteの`pnpm dev`だけでは`/api`は動かないため、認証を含めて確認するときはVercelのローカル実行環境を使います。
5. VercelのEnvironment Variablesに`.env.example`の3つを登録します。
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`（サーバー側だけに登録し、公開・クライアント側へ絶対に出さない）
   - 旧キーを使う場合は`SUPABASE_ANON_KEY`と`SUPABASE_SERVICE_ROLE_KEY`も利用できます。
6. Production / Preview / Developmentで使う環境にチェックを入れて保存し、Vercelを再デプロイします。

この構成ではブラウザからSupabaseへ直接接続しません。そのため、`VITE_SUPABASE_URL`や`VITE_SUPABASE_ANON_KEY`は使用していません。APIはBearerアクセストークンをSupabase Authへ照会してログインユーザーを確定します。習慣・記録のDB操作では、リクエスト本文の`userId`を受け付けず、検証済みトークンのユーザーIDをサーバー側で付与・検索条件に使います。
