# Step 0: Prerequisites

## For the local demo (step 1)

- [Node.js](https://nodejs.org/en/download) 22 or later and npm. Check with `node -v`.
- [git](https://git-scm.com)

That's all. Step 1 runs a stand-in for Auth0 on your machine and needs no account or internet once installed.

## For the Auth0 steps (2 to 4)

- A free [Auth0 account](https://auth0.com/signup) and a development tenant.
- A browser, for signing in during step 3.
- The [Auth0 CLI](https://auth0.github.io/auth0-cli/) is optional. The official MCP quickstarts use it, but every setting in step 2 can also be made in the Auth0 Dashboard.

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
