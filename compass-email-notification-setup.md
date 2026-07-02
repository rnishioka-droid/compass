# Compass メール通知セットアップ

Compass内通知が作られたとき、同じ内容を宛先担当者へメール送信します。
送信にはSupabase Edge FunctionsとGoogle Apps ScriptのGmail送信機能を使用します。
スプレッドシートは使用しません。Resendの設定も不要です。

## 1. 送信履歴テーブル

SupabaseのSQL Editorで `compass-email-notification-setup.sql` を実行します。

## 2. Gmail送信用Apps Scriptを作成

1. `https://script.google.com/` を開きます。
2. 「新しいプロジェクト」を作成します。
3. `google-apps-script-compass-mail.js` の内容を貼り付けて保存します。
4. 関数一覧から `initializeCompassMailSecret` を選び、1回実行します。
5. 権限を許可し、実行ログに表示された `GAS_MAIL_SECRET` を安全に控えます。
6. `sendCompassTestMail` を実行し、自分のGmailへテストメールが届くことを確認します。
7. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選択します。
8. 実行ユーザーは「自分」、アクセスできるユーザーは「全員」にします。
9. 発行された `/exec` で終わるウェブアプリURLを控えます。

秘密値はチャットや公開ファイルへ貼らないでください。

## 3. Edge Functionを配置

`supabase/functions/compass-email-notification/index.ts` をSupabaseプロジェクトへ配置し、
次のコマンドでデプロイします。

```bash
supabase functions deploy compass-email-notification
```

## 4. Supabase Secretsを登録

```bash
supabase secrets set GAS_MAIL_WEB_APP_URL="https://script.google.com/macros/s/...../exec"
supabase secrets set GAS_MAIL_SECRET="initializeCompassMailSecretで発行した秘密値"
supabase secrets set COMPASS_APP_URL="https://rnishioka-droid.github.io/compass/"
supabase secrets set COMPASS_OWNER_EMAILS='{"大類":"担当メール","福島":"担当メール","西岡":"担当メール","佐藤":"担当メール"}'
```

Supabase標準の `SUPABASE_URL`、`SUPABASE_ANON_KEY`、
`SUPABASE_SERVICE_ROLE_KEY` はEdge Function内で利用されます。

## 動作

- Compass内通知は従来どおり保存されます。
- 新規通知だけがメール送信されます。
- 通知ID単位で二重送信を防止します。
- メール送信に失敗してもCompass内通知は残ります。
- メールはApps Scriptを実行したGoogleアカウントのGmailから送信されます。
- 送信結果は `compass_notification_mail_log` と
  `compass_notifications.mailed / mail_error` に記録されます。
