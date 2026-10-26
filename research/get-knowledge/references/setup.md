# Setup

Nothing has to be set up before the first use. This file is for when the user asks to add a reference, to lift a search limit with an API key, to change a setting, or where things are kept.

## Where things are kept

Everything is under one home directory: `~/.get-knowledge`, or the directory named by the environment variable `GET_KNOWLEDGE_HOME`. `knowledge config` prints the paths and the settings in effect.

| Path | Holds |
| --- | --- |
| `wikis/` | The saved pages: one topic for each web search and each fetched URL. A page file is the text with a short header of where it came from and when. |
| `files/` | Images that were fetched. |
| `repos/` | The clones of the git references. |
| `references.json` | The references. |
| `settings.json` | The settings. It exists only when someone wrote one. |

To make the wiki forget a topic, run `knowledge forget <file>` with any page file of the topic. It removes every page of that topic: `<topic>.md` and `<topic>.part-NNN.md`. Forget only what the user asked to forget.

## References

A reference is a directory to look in before the web: the team's handbook, a checkout of a library the project uses, a folder of specifications. Add one only when the user names it.

```
knowledge ref-add <alias> <directory> --description "<what it holds and when to look in it>"
knowledge ref-add <alias> <repository> [--branch <branch>] --description "<...>"
knowledge ref-remove <alias>
knowledge ref-refresh [<alias> ...]
```

- The alias is one word with no space, slash, comma or backtick.
- A directory begins with `/`, `~/` or `./`. It is used in place and never changed.
- A repository is `owner/name` for GitHub, `host/path`, `user@host:path`, or a URL. It is cloned once, at its newest commit only, into `repos/`. This needs git, and access to the repository without a password prompt.
- Write the description for the agent that will read the list: what the reference holds, and for which questions to look in it.
- `--hidden` leaves a reference out of the list; `knowledge local --alias <alias>` still selects it.
- `--replace` changes a reference that exists.
- `ref-refresh` brings the clones to the newest commit of their branch: all of them, or the ones named. Run it when the user asks, or when a git reference is listed as not cloned.
- `ref-remove` removes the reference and its clone. A local directory is never touched.

`references.json` can also be edited by hand. Each entry is a directory, a repository, or an object:

```json
{
  "references": {
    "handbook": "~/work/handbook",
    "react": {"repository": "facebook/react", "branch": "main", "description": "React source."},
    "specs": {"path": "/srv/specs", "description": "Product specifications.", "hidden": true}
  }
}
```

An entry that is not valid is ignored, and `knowledge local --type references` says which and why.

## Search providers and API keys

Web search has three providers: Exa, Keenable and Parallel. One is asked first: Exa, or the one named by the `provider` setting, or by `knowledge web-search --provider <name>` for one search. When it reports that its limit is reached, the next one is asked for the same search, in the order Exa, Keenable, Parallel, and so on until one answers. Any other failure ends the search and is reported as it is. A query can therefore reach any of the three.

Without a key, each provider is used through its free, keyless service, which allows only a few searches in a short time.

A key lifts the limit of its provider. Give it through the environment, where it is not written to disk:

| Provider | Environment variable | Where to get a key |
| --- | --- | --- |
| Exa | `EXA_API_KEY` | https://dashboard.exa.ai/api-keys |
| Keenable | `KEENABLE_API_KEY` | https://app.keenable.ai |
| Parallel | `PARALLEL_API_KEY` | https://platform.parallel.ai |

The user sets the variable themselves, in their shell profile or their agent's settings. Do not ask the user to paste a key into the conversation, and never print one. A key can also be stored in `settings.json`; the environment variable wins when both are set.

The providers do not take the search options in the same way:

| Option | Exa with a key | Exa without a key | Keenable | Parallel |
| --- | --- | --- | --- | --- |
| `--num-results` | yes | yes | yes | cuts its list, which has at most 10 results |
| `--type` | `auto`, `fast`, `deep` | not used | not used | not used |
| `--livecrawl preferred` | yes | not used | not used | not used |
| `--context-max-characters` | yes | not used | the length of each snippet | not used |

Exa's keyless service takes only the query and the number of results, so `--type`, `--livecrawl` and `--context-max-characters` need an Exa key to have an effect.

Parallel is asked with the query alone. With a key it always searches in its advanced mode; its keyless service always searches in its fast mode. Its excerpts are passed on whole, and they are longer than the highlights of the other two.

## Settings

`settings.json` holds one JSON object. Every key is optional. A value outside its range is ignored, and the commands say so.

| Key | Default | Allowed | Meaning |
| --- | --- | --- | --- |
| `provider` | `"exa"` | `"exa"`, `"keenable"`, `"parallel"` | The search provider asked first. |
| `defaultNumResults` | `5` | 1 to 20 | Results of a search when `--num-results` is not given. |
| `defaultSearchType` | `"auto"` | `"auto"`, `"fast"`, `"deep"` | Search depth when `--type` is not given. |
| `defaultLivecrawl` | `"fallback"` | `"fallback"`, `"preferred"` | `"preferred"` asks the provider to crawl pages anew. |
| `searchTimeoutMs` | `30000` | 1000 to 3600000 | Time allowed for one search, both providers together. |
| `fetchTimeoutSeconds` | `30` | 30 to 3600 | Time allowed for one URL when `--timeout` is not given. |
| `maxResponseBytes` | `5242880` | 1 to 536870912 | The largest answer accepted from a server. |
| `pageChars` | `24000` | 2000 to 400000 | The longest page file, in characters. Lower it when the agent's shell cuts output shorter than a page. |
| `exaApiKey`, `keenableApiKey`, `parallelApiKey` | none | text | A key, when it cannot be given through the environment. |

Example:

```json
{
  "provider": "keenable",
  "defaultNumResults": 8,
  "pageChars": 16000
}
```
