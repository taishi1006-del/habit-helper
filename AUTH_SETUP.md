# 認証・ユーザー別データ分離の設定

1. Supabaseでプロジェクトを作成します。
2. Authだけを確認する間は、SQL Editorで`supabase/schema.sql`を実行しません。
3. Supabase AuthのEmail設定を確認します。メール確認を有効にする場合、登録後に確認メールが届きます。
4. ローカルではプロジェクトルートの`.env.local`に、Auth用の次の2つだけを設定します。
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
5. VercelでもAuth用の2つだけを設定します。Production / Preview / Developmentで使う環境にチェックを入れます。

ブラウザのログイン・新規登録は`@supabase/supabase-js`の`signInWithPassword`と`signUp`を使います。確認メール後のURLセッション復元にも対応しています。

DB APIでは、サーバーがログインユーザーのJWTを検証し、そのJWTと`SUPABASE_PUBLISHABLE_KEY`でSupabase REST APIへアクセスします。現在の習慣APIにSecret Keyは不要です。将来、RLSを迂回する管理処理を追加する場合だけSecret Keyをサーバー専用環境変数として使い、`VITE_`で始まる名前にしたりブラウザへ公開したりしません。

DB作成後も、ローカル・Vercelで必要な設定は上記の`VITE_SUPABASE_URL`と`VITE_SUPABASE_PUBLISHABLE_KEY`です。APIは同じ2変数をサーバー側でも参照できます。既存の`SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`を設定している場合はそちらが優先されるため、ブラウザ用と同じプロジェクトの値に合わせてください。

`pnpm run dev`はViteで画面と`/api`の両方を起動します。ローカルのAPIも本番と同じ認証・保存処理を使い、ユーザーJWTとRLSを維持します。静的プレビュー（`pnpm run preview`）にはAPIがないため、習慣保存の検証は開発サーバーで行ってください。

ブラウザのAuth接続が成功しても、開発サーバーのプロセスが外部通信を許可されていなければデータAPIは失敗します。HTTP 502 / `SUPABASE_NETWORK_DENIED` / `EACCES` はこの通信拒否を示します。環境変数やRLSを変更せず、通信が許可された実行環境（例：VS Codeの通常のターミナル）から開発サーバーを起動し直してください。Codexから起動する場合は外部通信の実行許可が必要です。

APIは設定不足（`SUPABASE_ENV_MISSING`）、公開キー不正（`SUPABASE_KEY_INVALID`）、セッション不正（`SESSION_INVALID`）、権限拒否（`SUPABASE_RLS_DENIED`）を別のエラーとして返します。診断ログにキーやJWTの値は出力しません。
