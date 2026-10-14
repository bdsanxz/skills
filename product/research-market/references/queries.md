# Writing the queries

How to write the lines of the queries file: which search operators work, and a template for each research goal.

## The queries file

One search per line, written `goal | search text`. A line that begins with `#` is a comment.

```
# topic: personal budgeting apps, English
wish | "I wish there was" (budgeting OR budget) app lang:en
alternative | "switched from" (YNAB OR "Monarch Money") lang:en
```

The goal is a dimension key from `dimensions.md`, or any short label of your own. It is stored with every post the query finds, so you can list and judge the posts of one goal together. Keep the file: it is the query library of the run, and the next round of research on the topic starts from it.

## Operators

These work on X/Twitter through `collect.py`, checked against the API. Search is looser than it looks: a quoted phrase or a keyword can match text that is not in the post itself, such as a quoted post or a link title, so expect unrelated posts and leave them uncoded.

| Operator | What it does | Example |
| --- | --- | --- |
| `"exact phrase"` | Posts with this phrase | `"so tired of" budgeting` |
| `(A OR B)` | Either term. Always group alternatives in parentheses. | `(hassle OR annoying OR tedious)` |
| `-word` | Leave out a word | `-giveaway -promo` |
| `lang:xx` | Posts in one language. X has its own codes for a few languages: Indonesian is `lang:in`, not `lang:id`. | `lang:en`, `lang:in` |
| `min_faves:N`, `min_replies:N`, `min_retweets:N` | A minimum of likes, replies or reposts | `min_replies:3` |
| `from:handle`, `to:handle`, `@handle` | Written by, in reply to, or mentioning an account | `to:somebrandhelp` |
| `-from:handle` | Leave out an account's own posts | `-from:somebrand` |
| `-filter:replies`, `filter:replies` | Without replies, or replies only | append to the query |
| `-filter:retweets` | Without reposts | append to the query |
| `filter:links` | Only posts with a link | append to the query |

Do not write `since:` or `until:` yourself. Give the time range to `collect.py`, which adds them and then applies the exact range to the results.

A query may be at most 512 characters with its date range.

Bluesky has a search of its own. It has been failing with a server error, so its operators could not be checked: keep a Bluesky query to plain words and quoted phrases, and read in the summary of `collect.py --platform bluesky` whether the search works today.

## Latest and top

`collect.py --feed latest` returns the newest posts and shows what people say on an ordinary day. `--feed top` returns the posts that resonated most and shows what many agree with, but it favours viral posts. Run the queries once with each and compare: a theme that appears only in `top` may rest on one viral post.

## Templates

Replace `[TOPIC]`, `[PRODUCT_A]`, `[PRODUCT_B]` and `[ACCOUNT_A]` with the words of the research sheet. Use the synonyms from the sheet inside `(A OR B)` groups, because people rarely use the official term.

| Goal | Query templates |
| --- | --- |
| `pain` | `[TOPIC] (hassle OR annoying OR exhausting OR "so tired of") -filter:retweets`<br>`"why is it so" [TOPIC]`<br>`[TOPIC] "tried everything" still` |
| `wish` | `"I wish there was" [TOPIC]`<br>`"when will there be" [TOPIC]`<br>`"is there any" [TOPIC]` |
| `decision` | `"any recommendations" [TOPIC] min_replies:3`<br>`"anyone know" [TOPIC]`<br>`[PRODUCT_A] [PRODUCT_B] "which is better"` |
| `alternative` | `"switched from" [PRODUCT_A]`<br>`"stopped using" [PRODUCT_A]`<br>`regret [PRODUCT_A]` |
| `trigger` | `"finally started" [TOPIC]`<br>`"just realized" [TOPIC]`<br>`"because of" [TOPIC]` |
| `objection` | `[TOPIC] ("is it safe" OR "is it legit")`<br>`afraid [TOPIC]`<br>`"worth it" [PRODUCT_A]` |
| `price` | `[TOPIC] (expensive OR cheap OR "worth the price")`<br>`budget [TOPIC]`<br>`"I'd pay" [TOPIC]` |
| `delight` | `[PRODUCT_A] ("game changer" OR "love it" OR "so happy")`<br>`"no regrets" [PRODUCT_A]` |
| `behavior` | `"I usually" [TOPIC]`<br>`"built my own" [TOPIC]`<br>`[TOPIC] (spreadsheet OR manual OR "by hand")` |
| `switching-cost` | `[PRODUCT_A] ("too lazy to switch" OR "stuck with" OR "can't leave")` |
| `criteria` | `[TOPIC] ("must have" OR "what matters" OR "deal breaker")` |

Complaints sent to a competitor are collected by account instead of by query: `collect.py --account x:[ACCOUNT_A] --exclude-from [PRODUCT_A]`.

## Writing good queries

- Translate the phrases, do not transliterate them. For an Indonesian audience, "so tired of" becomes `"capek banget"`, "anyone know" becomes `"ada yang tau"`, and the query gets `lang:in`. Write the slang people really use.
- A product or topic word with another meaning brings in the other meaning. Add a word that fixes the context: `Mint budgeting`, not `Mint`.
- Add `-filter:retweets`, and `-giveaway -promo` on topics that attract promotion.
- Prefer several narrow queries over one long one. Each line of the file reports how many posts it brought in.
- Recommendation requests keep their value in the replies. Add `min_replies:3`, then fetch the replies of the best ones.
- Cover every research question with at least three queries worded differently, and include queries that could contradict what you expect.
