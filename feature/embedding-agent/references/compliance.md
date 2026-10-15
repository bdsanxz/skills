# Compliance: running a vendor's agent inside your app

Last checked against the vendors' pages: 2026-10-14. Terms change. Before relying on any rule below, fetch the source pages and confirm it still holds.

## Sources to re-check

| Vendor | Page | What it governs |
| --- | --- | --- |
| Anthropic | https://code.claude.com/docs/en/legal-and-compliance | Offering Claude Code in a product; OAuth vs API key; credential handling; name and logo |
| Anthropic | https://www.anthropic.com/legal/commercial-terms | Commercial Terms, required to preinstall or run Claude Code in a product |
| Anthropic | https://www.anthropic.com/legal/consumer-terms | Free, Pro and Max users |
| Anthropic | https://code.claude.com/docs/en/agent-sdk/overview | Agent SDK authentication |
| Anthropic | https://www.anthropic.com/legal/aup | Usage policy |
| OpenAI | https://learn.chatgpt.com/docs/app-server (section on authentication) | Which Codex app-server authentication a commercial or hosted service may use |
| OpenAI | https://openai.com/policies/sign-in-with-chatgpt-terms/ | Sign in with ChatGPT (SIWC) for third-party apps |
| OpenAI | https://learn.chatgpt.com/docs/auth | Codex sign-in methods |
| OpenAI | https://openai.com/policies/usage-policies/ | Usage policy |
| pi | https://github.com/earendil-works/pi (LICENSE) | MIT license of the harness |
| pi | https://pi.dev/docs/latest/providers | Which sign-ins pi offers per provider, and pi's notes on how they are billed |
| pi | https://pi.dev/docs/latest/security | What pi does and does not restrict |
| omp | https://github.com/can1357/oh-my-pi (LICENSE, THIRD-PARTY-NOTICES.txt) | MIT license of the harness and the licenses of the code it vendors |
| omp | https://github.com/can1357/oh-my-pi/blob/main/docs/providers.md | Which sign-ins omp offers per provider, and where it stores them |
| omp | https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md | What omp's approvals do and do not restrict |
| Google | https://antigravity.google/docs/faq/ | Whether `agy` may be wrapped inside other apps, and on which plans |
| Google | https://antigravity.google/terms | Antigravity terms for individual accounts, including third-party access |
| Google | https://antigravity.google/docs/enterprise | Gemini Enterprise and Google Cloud sign-in, which replace the consumer terms |
| Google | https://antigravity.google/docs/plans | Plans, and whether bring-your-own-key is supported |
| xAI | https://x.ai/legal/terms-of-service | Consumer terms for Grok and SuperGrok accounts: credential sharing, brand use, beta features |
| xAI | https://x.ai/legal/terms-of-service-enterprise | Enterprise terms for developers, businesses and the API: building a Bundled Service for end users |
| xAI | https://docs.x.ai/build/overview | Grok Build sign-in methods and its ACP interface for other apps |
| xAI | https://github.com/xai-org/grok-build (LICENSE, THIRD-PARTY-NOTICES) | Apache-2.0 license of the Grok Build source |
| Any other provider pi or omp uses | That provider's terms and API terms | Whether its subscription may be used through a third-party harness or app |

## Anthropic: Claude Code

What the legal page says, in short:

1. **OAuth sign-in is for subscription holders' ordinary use** of Claude Code and Anthropic's own apps.
2. **Developers building products** that use Claude's capabilities, including with the Agent SDK, use **API key** authentication (Claude Console or a supported cloud provider). Third-party developers may not offer Claude.ai login in their own apps, may not route requests through Free, Pro or Max credentials on behalf of their users, and may not collect, store or intermediate Claude.ai credentials or session tokens. Sign-in must complete through Anthropic's own flow.
3. **This does not stop an end user from signing in to the unmodified Claude Code binary with their own subscription**, including where a platform hosts Claude Code.
4. **Preinstalling or running Claude Code in your products or services** requires agreeing to the Commercial Terms and these conditions:
   - The binary is installed and run as Anthropic publishes it. No sign-in method built into it may be removed, disabled or restricted.
   - You may not pay for, resell or intermediate Claude usage for your end users. Each end user authenticates with their own API key, subscription credentials, or cloud-provider credential, billed to them.
5. **Name and logo:** you may say in plain text that your product runs Claude Code. You may not use the Claude Code or Anthropic names or logos in your product, feature or company name or logo, or suggest Anthropic built, endorses or partners with you.
6. Advertised Pro and Max limits assume ordinary, individual use. Anthropic may enforce these rules without notice.

What this means for a host:

| Do | Do not |
| --- | --- |
| Spawn the `claude` binary the user installed, or install it with Anthropic's official installer after the user agrees | Bundle a patched, renamed or repackaged copy |
| Let the binary's own sign-in run (`claude auth login`, which opens Anthropic's page in the browser) | Draw your own Claude login form, capture the OAuth callback, or proxy the sign-in |
| Check sign-in state with `claude auth status` | Read `~/.claude` credential files or the system keychain, or copy tokens anywhere |
| Run each user's engine under that user's own account | Share one signed-in engine between several users, or sign in with your own account for them |
| Use the Agent SDK packages with an API key | Use the Agent SDK packages with a user's Claude.ai login in your product |
| Design for one person's interactive use | Fan out background work on a user's subscription beyond ordinary individual use |

Note on `--bare`: bare mode never reads OAuth credentials, so a subscription-backed run cannot use it. Isolate a subscription-backed run with the narrower flags in `claude-code.md` instead.

## OpenAI: Codex

What the pages say, in short:

1. The Codex **app-server** is the interface meant for deep integration into your own product (`codex app-server`, JSON-RPC over stdio).
2. The app-server documentation states that **app-server authentication has never been permitted for commercial or hosted services**. Local or open-source apps may keep using it, and OpenAI recommends migrating to **Sign in with ChatGPT**, which was launched for commercial and hosted cases (partner waitlist).
3. **Sign in with ChatGPT terms** (apply once you integrate it): use your app's own name in sign-in and activation; do not impersonate OpenAI or another app or open-source project; follow the usage policies; no reverse engineering or altering the SIWC software; OpenAI's names and logos only as authorized; access can be suspended for violations or risk.
4. Under SIWC a host may pass a user's plan access token to the app-server child process (`ACCESS_TOKEN`) and must identify itself in `initialize` with a stable `clientInfo.name`, a `title` and a `version`. Token refresh is the host's job.
5. An integration intended for enterprise use should contact OpenAI to be added to the known-clients list, so compliance logs can identify it.

What this means for a host:

| Situation | Path |
| --- | --- |
| Personal or open-source tool on the user's machine | `codex app-server` with Codex's own sign-in (`account/login/start`, type `chatgpt`, which opens OpenAI's page); or the user's API key |
| Commercial desktop or web product, user's ChatGPT plan | Sign in with ChatGPT (apply, accept its terms) |
| Any product, user pays per token | The user's own OpenAI API key, entered into Codex (`account/login/start`, type `apiKey`) |

## Google: Antigravity CLI

What the pages say, in short:

1. The FAQ says headless mode (`agy -p`) is intended for direct scripting and CI, and that **wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans**.
2. The Antigravity terms (section 6) make using third-party software, tools or services to access the Service, or using it in connection with products Google does not provide, a breach that may suspend or terminate the user's Antigravity and Gemini CLI accounts.
3. For third-party agents that need Gemini, the FAQ recommends a Gemini Enterprise or Google AI Studio API key.
4. A user who signs in through an organization's Google Cloud account or with a Gemini Enterprise API key is bound by the terms the organization's administrator accepted instead. Those pages do not say that embedding `agy` is allowed.

What this means for a host:

| Do | Do not |
| --- | --- |
| Offer the reverse direction: the app's MCP server, which the user adds to their own `agy` themselves | Start `agy` from the app for a user on an individual, Google AI Pro or Ultra account, commercial or not |
| Give Gemini models to the app's chat through another engine (pi, omp) with the user's own Gemini API key | Rotate several Google accounts, or share one, to stretch quotas |
| Embed `agy` only for an organization on Gemini Enterprise whose administrator confirmed in writing that its agreement allows it, each user signed in with their own organization identity | Rely on `agy`'s `GEMINI_API_KEY` mode as a way around the consumer rule without Google's written confirmation |

## xAI: Grok Build

What the pages say, in short:

1. Grok Build documents ACP (`grok agent stdio`) as the way to use it in other apps and editors, and headless `grok -p` for scripts and CI.
2. The **consumer terms** have no clause about third-party apps running Grok Build. They forbid sharing account credentials or making the account available to anyone else, require xAI's permission to use its names and logos (Brand Guidelines), and say beta features are not meant for production. They point developers and businesses to the Enterprise Terms.
3. The **enterprise terms** let a business build integrations between xAI's services and its own product (a *Bundled Service*) and offer it to end users. The business must hold end-user terms no less protective than xAI's, and is liable for its end users.
4. The source is Apache-2.0. That license grants no right to xAI's trademarks.

What this means for a host:

| Do | Do not |
| --- | --- |
| Drive the user's own `grok` over ACP, signed in through `grok`'s own sign-in on xAI's page | Read, copy or edit `~/.grok/auth.json`, or feed tokens in through `auth_provider_command` |
| Pass the user's own `XAI_API_KEY` to that user's runs only | Share one signed-in `grok` between users |
| For a commercial product on users' subscriptions, get xAI's written confirmation first; otherwise use API keys | Call the product "Grok" anything, or use xAI's logo, without xAI's permission |
| Run `grok` as xAI publishes it (the source is Apache-2.0, but a modified build is no longer xAI's product and its sign-in is no longer xAI's own flow) | Ship a patched or rebuilt `grok` that signs users in to their xAI accounts |

## pi and omp

pi is an open-source harness (MIT), not a model vendor. omp (oh-my-pi) is an MIT fork of pi, and everything in this section applies to it the same way. Two separate questions:

1. **The harness.** The MIT license lets a product bundle, modify and ship pi, as long as the product keeps pi's copyright and license notice (list it with the product's other third-party notices). No vendor agreement is needed for pi itself.
2. **The model access.** Every request pi makes goes to a model provider, under that provider's terms. pi offering a sign-in does not make it allowed for your app:
   - **Anthropic models.** pi offers a Claude Pro/Max sign-in, and its own docs say third-party harness usage is billed per token as extra usage, not against plan limits. An app that leads users into that sign-in is a third-party developer offering Claude.ai login in its own application, which Anthropic's legal page does not permit, and the app may not touch the resulting tokens either. Use the user's own Anthropic API key (or a cloud-provider credential) for Anthropic models in pi.
   - **OpenAI models.** pi offers a ChatGPT Plus/Pro (Codex) sign-in. Using ChatGPT plan access from a third-party product falls under Sign in with ChatGPT for commercial or hosted use (see *OpenAI: Codex*); some versions of pi's docs also mark that sign-in as personal use only. Use the user's own OpenAI API key unless the product has a Sign in with ChatGPT agreement.
   - **Other subscription sign-ins pi offers** (GitHub Copilot, Google plans, and others): check that provider's terms for use through a third-party app before offering them. Default to the provider's API key.
   - **API keys** are the portable path: the user's own key, passed only to that user's runs; or the app maker's own key under the maker's API agreement with that provider.

What this means for a host:

| Do | Do not |
| --- | --- |
| Bundle or install pi and keep its MIT notice | Present pi or a provider as your own product |
| Ask the user for their own API key per provider, store it in the OS keychain, pass it to that user's runs by environment variable or `--api-key` | Read, copy or edit pi's `auth.json`, or harvest tokens a subscription sign-in left there |
| Let a technically skilled user run interactive `pi` and `/login` themselves for their own personal use, outside the app's flow | Build a button, wizard or prompt that walks users through pi's Claude or ChatGPT subscription sign-in |
| Sandbox the run, because pi itself restricts nothing | Run pi with the user's full account permissions on a server or shared machine |

omp adds these, because it has more ways to reach a user's subscription:

| Do | Do not |
| --- | --- |
| Keep omp's MIT notice and its `THIRD-PARTY-NOTICES.txt` with the product | Ship omp without the notices of the code it vendors |
| Run the app's runs under an app-owned `--profile`, so a subscription login the user made in their own omp (stored logins outrank API keys) is never used by the app | Let the app's runs pick up the user's personal omp logins from the default auth store |
| Pass the user's own API key per provider to that user's runs | Call `omp token`, read `~/.omp/agent/agent.db`, or build a flow around `omp login` for Anthropic or ChatGPT subscriptions |
| Set `--approval-mode` explicitly and sandbox the run; omp's default mode approves everything | Use `auth-broker` or `auth-gateway` to share one user's logins with other users, machines or a hosted service |

## Decision table

Pick one row per engine. "Allowed" assumes every Do in the tables above and every item of the checklist below.

| Delivery | Who pays | Claude Code | Codex | pi, omp | Antigravity CLI | Grok Build |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop or local companion, personal or open-source | User's subscription | Allowed: user's unmodified `claude`, signed in by the user | Allowed: app-server with Codex's own sign-in; SIWC recommended | Not through the app: use the Claude Code or Codex column for that vendor's subscription, or use API keys in pi or omp | Not allowed on consumer plans; offer the reverse direction (app MCP server in the user's own `agy`) | Allowed as far as the terms say: user's own `grok` over ACP, signed in by the user; re-check the terms |
| Desktop or local companion, commercial | User's subscription | Allowed under the Commercial Terms and their conditions: user's unmodified `claude`, signed in by the user | Use SIWC | Not for Anthropic; OpenAI only through SIWC; others per their terms | Not allowed on consumer plans; Gemini Enterprise only with the organization's written confirmation | Not granted by the terms: get xAI's written confirmation, or use API keys |
| Hosted, each user in their own sandbox | User's subscription | Allowed under the Commercial Terms: the user signs in to the unmodified binary in their own sandbox; nothing pooled | Use SIWC | Same as the row above | Not allowed on consumer plans; Gemini Enterprise only with the organization's written confirmation | Not granted by the terms: get xAI's written confirmation, or use API keys |
| Any | User's own API key | Allowed: the user enters it into the engine or the host passes it to that user's runs only | Allowed | Allowed, for any provider whose API terms allow it | Not confirmed: use pi or omp with the user's Gemini API key instead | Allowed: `XAI_API_KEY` passed to that user's runs only |
| Any | App maker's API key | Not Claude Code: build your own agent with the Agent SDK or the API under your own Commercial Terms | Your own API account under OpenAI's terms; not via ChatGPT plans | Allowed under the maker's API agreement with each provider | Not confirmed: use the Gemini API in your own agent or in pi or omp | Allowed under the Enterprise Terms as a Bundled Service, with end-user terms carrying xAI's AUP |
| Hosted, one shared engine for many users on subscriptions | — | Not allowed | Not allowed | Not allowed | Not allowed | Not allowed |

## Compliance checklist

- [ ] The terms pages above were fetched on the day of the design, and any change is reported to the user.
- [ ] The engine binary is the vendor's, unmodified, and every sign-in method it has still works (Claude Code, Codex). For an open-source engine such as pi or omp, its license notice (and, for omp, its third-party notices) ships with the product.
- [ ] For pi or omp: every provider a run uses is reached with an API key (or a sign-in that provider's terms allow for third-party apps), and the app has no flow that leads users into the engine's subscription sign-ins.
- [ ] For omp: the app's runs use an app-owned `--profile` with no stored logins, set `--approval-mode` explicitly, and the code never calls `omp token` or the auth broker.
- [ ] No code path reads, writes, logs, transmits or stores the user's vendor credentials or tokens (search the code for the credential file paths, keychain calls, and token environment variables).
- [ ] Sign-in happens only through the engine's own command or protocol method, in the vendor's page.
- [ ] For the Antigravity CLI: the app never starts `agy` for a consumer-plan account; it is embedded only for a Gemini Enterprise organization that confirmed in writing, and nothing rotates or shares Google accounts.
- [ ] For Grok Build: no run uses always-approve, the sandbox profile was applied (not just warned about), and a commercial product on users' subscriptions has xAI's written confirmation.
- [ ] Each engine process runs for exactly one end user, under that user's account or key.
- [ ] The app does not charge for, meter as its own product, or resell the engine's model usage.
- [ ] The vendor's name appears only as a plain statement that the app runs that engine; no vendor logo or name in the app's own feature names.
- [ ] For a commercial product: the Commercial Terms (Anthropic), the SIWC terms (OpenAI) or the Enterprise Terms (xAI, when the maker pays) were accepted by the user's company, and the user confirmed it.
- [ ] The run records written by the app hold no credentials (the engine's init event names the auth source; store that name, never a token).
