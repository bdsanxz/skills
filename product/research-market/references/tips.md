# Tips

Mistakes earlier runs of this skill made, and how to avoid them. Read the part for a step before starting it.

## Collecting

- **A support account's mentions are mostly not customers.** In one run, a third of the posts found for a care account were templated replies from the company's other accounts, and another third were quiz and giveaway entries. After the first collection for an account, look at which authors appear most in the listing. Exclude the company's own accounts with `--exclude-from`, and add `-giveaway` and the quiz hashtag as `--terms` when they flood the result.
- **Check the handle before collecting.** Many plausible support handles are suspended, abandoned, or owned by someone else. Use the handles the user gave or confirmed. When you had to guess one, say so and ask.
- **Old posts are thin.** Search returned about thirty posts a day for the last week and three a day for earlier months, for the same account. Splitting the range into smaller windows does not bring more. To reach a large number of posts, add queries and accounts before adding months.
- **A large target is collected in batches.** One search stops after a limited depth. Run one window of the time range per call (`--since` and `--until`), keep the same `--out`, and add up `added` after each call. When a call stops at `--max`, its window is incomplete: run that window again before moving to the next.
- **Balance is a per-call decision.** `--max` applies to the whole call and `--per-query` to each query. To keep one busy account or query from dominating, give each its own call with its own `--max`.
- **Ambiguous words bring another topic.** A query for a budgeting product named after a common word returned phones, operating systems and trading cards. Add a word that fixes the context.
- **A whole language that finds nothing is a wrong language code.** Every Indonesian query returned nothing with `lang:id`; X files Indonesian under `lang:in`. When all queries of one language come back empty, run one of them without `lang:` and read the `lang` field of what it finds.
- **Many groups in one query find nothing.** A query with three or four `(A OR B)` groups must match all of them at once. Two groups, or one phrase and one group, is usually the most a query can carry.
- **Read `by_query` after every run.** Drop a query that added nothing, reword one that added mostly noise, and keep the file as the record of what worked.

## Reading and coding

- **Read with `list.py`, not the data file.** The listing is about a third of the size and gives each post the number the coding file needs. For a large file, read it in ranges with `--from` and `--to`.
- **Refer to posts by number.** Copying long URLs by hand into the coding file is where mistakes come from.
- **Posts with a picture are often unreadable alone.** "Why is it like this?" with a screenshot says nothing in text. Leave it uncoded unless its thread explains it.
- **Near-identical posts by one author count once.** People repeat a complaint to several accounts. Code one of them.
- **One incident can fill a theme.** Most posts of the largest theme of one run came from a single week. Check `days`, `first` and `last` in the tally before calling a theme frequent, and say so when it is one event.

## Opportunities

- **Complaints alone lead to ideas only the company can build.** A run that collected only complaints produced five ideas out of six that were features for the company's own app. Wishes, current behaviour and alternatives are where ideas for something new come from: make sure the queries covered them.
- **Do not rate from memory.** What exists in a market, what an app already does, and what something costs are checked on a page you can link, or written as Unknown.
