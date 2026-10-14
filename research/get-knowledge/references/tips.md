# Tips from earlier runs

Every tip here is a mistake an agent actually made while using this skill, with what it cost and what to do instead. Read the part for a step before starting that step. When you make a new mistake, or catch one, tell the user so it can be added here.

## Tools and shell

- **The command in a shell variable.** `K="python3 .../knowledge.py"; $K local ...` fails in zsh, which does not split a variable into words. Define the `knowledge` function at the start of each command.
- **A separator made of equals signs.** `echo =====` between two commands fails in zsh, which reads a word that begins with `=` as the name of a command to look up. Quote the separator, or use `echo "--"`.

## Step 2: Look locally

- **A score read as a measure of match.** An unrelated page scored 9.4 for one query, and the page that held the answer to another query scored 5.2. A score only orders the pages of one query; it says nothing across queries and has no threshold. Read `has N of M words` and the subject of each line: a page that has all the words and is about your subject is a candidate, and the others are no match.
- **The query expected to search the references.** The agent wrote a query for a question that a reference answered, and got a list of unrelated wiki pages. The query is run on the wiki only. For a reference, go by its description, open it with `--alias`, and search inside the root with your own file tools.

## Step 3: Search the web

- **Result URLs pinned to an old state.** For a question about a project's current default, one result pointed into the repository at a version tag several releases old and another at a single commit. Fetched as they were, they would have answered for the old state. Look at the version, tag or commit in a URL before you fetch it, and change it to the current version or the default branch when the question is about the current state.

## Step 4: Fetch what is worth reading

- **A file page of a code host fetched as a web page.** The page of one file on GitHub came back as buttons ("Blame", "Raw", "Latest commit") with no file text, because the site puts the text there with scripts. It was not empty, so nothing warned about it. A second fetch with `--whole-page` brought the same buttons and cost another request; only the raw file had the text. A GitHub file page is fetched as the raw file now. For another code host, fetch the host's raw-file address for the same file. `--whole-page` does not help when the page never held the content.
- **A useless page left in the wiki.** That page of buttons stayed saved, and it was listed second in the next local lookup, for an unrelated question. When a page you just fetched holds nothing of use, remove it with `knowledge forget <file>` before you go on.
- **The saved file opened to see whether it was complete.** The agent read the header inside a saved file to learn how many pages the text had. The `Saved:` line of every fetch gives the pages and the characters, and a page that is not the last one ends with a line naming the next.
