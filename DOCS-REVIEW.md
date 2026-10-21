# Docs review: Auth0 for MCP servers (from a developer's first pass)

Reviewed 2026-10-21 against three pages: the MCP overview, the "Authorization for Your MCP Server" quickstart, and the Auth0 blog announcement. Findings come from reading the pages, not from a live tenant. Each item says what a first-time developer would hit and what would fix it.

Sources:
- Overview: https://auth0.com/ai/docs/mcp/intro/overview.md
- Quickstart: https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server
- Announcement: https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/

## 1. The release status is inconsistent (conflict across pages)
The announcement says Auth for MCP went generally available on May 6, 2026. A search summary of the quickstart said it was Early Access. The quickstart page itself doesn't state a status. A developer can't tell whether to rely on it.
**Fix:** put the status and date on each page.

## 2. The permissions claim isn't named where it matters (confirmed, and the demo was wrong)
The quickstart says `rfc9068_profile_authz` puts permissions in a `permissions` claim. My first server read only the `scope` claim, so a token with the right permissions was refused. The server now requires a permission to appear in both the `scope` and `permissions` claims, with tests. A token with `permissions` but no `scope` claim grants nothing.
**Fix:** the quickstart's "verify the token" step should show the exact claim names and a decoded example token.

## 3. The 401 challenge and metadata aren't shown (gap)
The quickstart says the server "verifies this token" but doesn't show the protected-resource metadata, the `WWW-Authenticate` header, or how to check issuer and audience. My server builds these from the RFC 9728 pattern, not from an Auth0 example.
**Fix:** add a copy-paste example for a plain Node HTTP server: the metadata JSON and the 401 header.

## 4. Two prerequisite toggles are easy to miss (gap)
Settings > Advanced needs "Resource Parameter Compatibility Profile" and "Include Issuer in Authorization Responses" turned on. They appear only in the prerequisites list. The overview doesn't mention them, and the quickstart doesn't say what breaks without them.
**Fix:** say, next to the step, that the `resource` parameter and the `iss` claim depend on these, and what fails if they're off.

## 5. The identifier must match exactly in three places (gap)
The API identifier, `AUTH0_AUDIENCE`, and `--api-id` all have to be `http://localhost:3001/`, including the trailing slash. A slash mismatch gives an audience error that doesn't name the cause.
**Fix:** say that the three values must match exactly, and show the error a mismatch produces.

## 6. The setup is CLI-only and long (gap)
Reaching the first working tool takes about fifteen steps, including `auth0 login`, `jq`, promoting connections to domain connections, creating roles, finding users, and assigning roles. A developer who works only in the dashboard has no path shown.
**Fix:** a dashboard path for the same result, or a note that the CLI is required.

## 7. Domain-connection promotion is buried (gap)
The quickstart says domain-connection promotion is needed for third-party clients such as MCP Inspector, but the step appears as step six of the setup, with no warning. A developer who skips it gets a client that can't log in.
**Fix:** move the step, or flag it as required for Inspector.

## 8. The overview says OAuth 2.1 and OAuth 2.0 (ambiguity)
The overview intro says OAuth 2.1. Its access section says "OAuth 2.0 access token." The version the tokens follow matters for client code.
**Fix:** pick one and say which.

## 9. The overview has no steps (gap)
The overview describes the model and links to the quickstart for every step. A developer who starts from the overview gets no next action.
**Fix:** add a short numbered list of the steps, with links.

## What I did with this
- Fixed item 2 in the server, with a test.
- Still open until a live run: item 3 (I built the challenge from the spec) and whether the `resource` value in a real token matches the identifier.
