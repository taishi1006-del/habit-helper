# 認証・ユーザー別データ分離の設定

1. Supabaseでプロジェクトを作成します。
2. Authだけを確認する間は、SQL Editorで`supabase/schema.sql`を実行しません。
3. Supabase AuthのEmail設定を確認します。メール確認を有効にする場合、登録後に確認メールが届きます。
4. ローカルではプロジェクトルートの`.env.local`に、Auth用の次の2つだけを設定します。
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
5. VercelでもAuth用の2つだけを設定します。Production / Preview / Developmentで使う環境にチェックを入れます。

ブラウザのログイン・新規登録は`@supabase/supabase-js`の`signInWithPassword`と`signUp`を使います。確認メール後のURLセッション復元にも対応しています。

DB APIを後で有効にする場合だけ、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`をサーバー側へ追加します。Secret Keyを`VITE_`で始まる名前にしたり、ブラウザへ公開したりしません。
