# Step 4: Add GitHub through Token Vault (optional)

Link a GitHub account to your user so the `github_profile` and `github_open_prs` tools work. The server exchanges your Auth0 token for your GitHub token inside Token Vault. The agent gets the result and never the GitHub credential. About ten minutes.

## 1. Create a GitHub OAuth app

Create an [OAuth app on GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app). Its callback URL is the one Auth0 shows for your tenant's GitHub connection.

You need your own app. Auth0's development keys are refused at the linking step with `The connect flow cannot be used with dev keys.`

## 2. Configure the GitHub connection

In your tenant's GitHub social connection:

- Enter the OAuth app's client ID and secret.
- Turn on Token Vault (connected accounts) for the connection.

Docs: [GitHub social connection](https://marketplace.auth0.com/integrations/github-social-connection) · [Connected accounts for Token Vault](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault/connected-accounts-for-token-vault)

## 3. Get a My Account API token

Linking uses the My Account API, with a token that has `create:me:connected_accounts`. The login needs a client grant to the My Account API with subject type **user**, not client. Save the token to `.tokens/me-token`, the `ME_TOKEN_FILE` in `.env`.

Docs: [My Account API](https://auth0.com/docs/manage-users/my-account-api)

## 4. Link the account

```bash
npm run connect:github
```

The browser opens GitHub's consent screen. Approve it, and the script completes the link.

## 5. Check the GitHub tools

Add `read:github` to `LOGIN_SCOPE` in `.env`. With both servers running (step 3), sign in again and require the GitHub checks:

```bash
npm run login
npm run check -- --github
```

```
github_profile: {"github_login":"your-github-login"}
github_open_prs: {"open_prs":[ ... ]}
```

`github_open_prs` lists open pull requests on public repositories only, because the connection requests no GitHub scopes.

Docs: [Token Vault](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault)

Next: [Step 5: Present it live](05-present-it-live.md)
