# Step 0: Prerequisites

## For the local demo (step 1)

- [Node.js](https://nodejs.org/en/download) 22 or later and npm. Check with `node -v`.
- [git](https://git-scm.com)

That's all. Step 1 runs a stand-in for Auth0 on your machine and needs no account or internet once installed.

## For the Auth0 steps (2 to 4)

- A free [Auth0 account](https://auth0.com/signup) and a development tenant.
- A browser, for signing in during step 3.
- The [Auth0 CLI](https://auth0.github.io/auth0-cli/) is optional. The official MCP quickstarts use it, but every setting in step 2 can also be made in the Auth0 Dashboard.

### Which Auth0 plan you need

Sign up at [auth0.com/signup](https://auth0.com/signup). There's no credit card and no paid plan to choose. From the [Auth0 pricing page](https://auth0.com/pricing) (checked 2026-11-10):

| | |
|---|---|
| **New tenants** | Start with a **22-day trial** of paid-plan features. After it ends, the **Free plan** activates automatically. |
| **Free plan** | $0, up to 25,000 monthly active users, no credit card. **Auth for MCP** is listed as included, and the plan includes **Token Vault**, with a limit on connections. |
| **Not needed here** | Custom Token Exchange (a paid feature) is a different feature from the on-behalf-of exchange this repo uses. |

This repo was built and verified on a development tenant during its trial. Plans change, so check the pricing table for the features in steps 2 to 4 before you rely on them after the trial ends.

## For Token Vault (step 4, optional)

- A GitHub account.
- A [GitHub OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) that you own. Auth0's development keys can't be used to link accounts, so the GitHub connection needs your own app.

## Background reading

Not required, but these explain the why behind each step:

- [Auth for MCP](https://auth0.com/ai/docs/mcp/overview): Auth0's model for securing MCP servers.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization): what clients and servers must do.
- [On-Behalf-Of Token Exchange](https://auth0.com/docs/secure/call-apis-on-users-behalf/on-behalf-of-token-exchange): how the server calls the reports API for the user.
- [Token Vault](https://auth0.com/docs/secure/call-apis-on-users-behalf/token-vault): how the server reaches GitHub without holding the user's GitHub credential.
- Standards: [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) (token exchange), [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) (protected-resource metadata), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) (resource indicators).

Next: [Step 1: Run the demo locally](01-run-locally.md)
