# Coding posts

How to turn a collected post into lines of the coding file: which dimension it shows, what theme it belongs to, and how to rate it.

## The coding file

One line per observation, fields separated by `|`:

```
post | dimension | theme | sentiment | intensity | segment | exact words
```

| Field | Content |
| --- | --- |
| `post` | The number `list.py` prints for the post. A post URL also works. |
| `dimension` | One key from the table below. |
| `theme` | A short label in your own words, the same wording for every post that shares it. |
| `sentiment` | `neg`, `neu` or `pos`: how the author feels about what this line records. |
| `intensity` | `1` mentioned in passing, `2` clearly matters to the author, `3` very emotional or costly. |
| `segment` | The kind of person or market segment, as the post itself shows it; `-` when it does not show. |
| `exact words` | Words copied from the post that carry the meaning, several separated by `;`. Leave empty when nothing is worth quoting. |

A line that begins with `#` is a comment. One post usually gives several lines, one for each dimension it shows.

## Dimensions

| Key | Question it answers | Signals in a post |
| --- | --- | --- |
| `pain` | What is hard, slow, costly or broken? | "so tired of", "such a hassle", an error or failure described |
| `job` | What are they trying to get done, functionally, emotionally or socially? | "I want to be able to", "so that I", "I just need to" |
| `wish` | What would the ideal outcome or product look like? | "I wish there was", "when will there be", "is there any" |
| `delight` | What makes them very satisfied? | "game changer", "love it", "just realized how great" |
| `behavior` | What do they use or do today, including workarounds? | "I usually", "built my own", a spreadsheet, doing it by hand |
| `alternative` | What else did they try, and why did they leave or switch? | "moved from A to B", "stopped using", "regret" |
| `trigger` | What event made them look for a solution? | "after", "because of", "finally started" |
| `criteria` | What do they choose by: price, ease, trust, a feature, a recommendation? | "what matters is", "must have", "as long as" |
| `objection` | What makes them hesitate or distrust? | "is it safe", "is it legit", "scared of", "is it worth it" |
| `switching-cost` | Why do they stay with something that does not satisfy them? | "too lazy to switch", "all my data is there", "everyone uses it" |
| `decision` | Who is involved in the choice, and where do they look for information? | "anyone know", "any recommendations", "my partner says", "checking reviews" |
| `price` | What do they pay, what would they pay, what is too much? | "too expensive", "my budget is", "I'd pay", "worth the price" |
| `identity` | Who do they want to be, or be seen as? | "as a", "I'm the type who", "people like us" |
| `success` | How would they know the problem is solved? | "if I can", "as long as it", "all I need is" |
| `source` | Whom or what do they trust and cite? | an account, a site, a community or a person they quote or recommend |

The audience's language is not a dimension of its own. Record it in `exact words` on any line: the terms, slang and abbreviations people really use for the problem and the product.

## How to code

1. Code what the post says, not what it might imply. A post that only says a product is bad has a `pain` line and nothing else.
2. Keep what people say, what they do and what they feel apart: a `wish` is said, a `behavior` is done, `sentiment` and `intensity` are felt. They often disagree, and the disagreement is a finding.
3. Name a theme the way the audience would state it ("Refund takes weeks"), not as a solution ("Faster refunds") or a category ("Refunds"). Reuse the exact label for every post that shares the theme; a new spelling starts a new theme only when the dimension differs.
4. Rate intensity from the post: its wording, what the problem cost, how long it has lasted. Capital letters alone are not a 3.
5. Take the segment from what the author says about their situation ("as a freelancer", "for my shop", "my kids"), or from the product or market the post is about when the user asked for a breakdown by it. Never open a profile to find it.
6. Copy `exact words` letter for letter, a few words at a time. `tally.py` rejects words that are not in the post.
7. Leave uncoded: advertising, giveaways and promotion, accounts that post the same text repeatedly, posts by companies and their support staff, jokes with no real situation behind them, and posts about another meaning of a search word.
8. When a post cannot be understood alone, or may be sarcastic, read the post it replies to before coding it.
9. Code the posts that contradict the pattern you expect with the same care. A `delight` line about the thing others complain about belongs in the file.

## Example

A post, on the fictional topic of healthy meal delivery:

> Ordered diet catering 3 times but the portions keep being tiny and the delivery is always very late. I want to try cooking myself but I have no time. Anyone know a good one?

If `list.py` shows it as post 41, it gives these lines:

```
41 | pain | Portions too small | neg | 2 | - | portions keep being tiny
41 | pain | Delivery arrives late | neg | 2 | - | always very late
41 | behavior | Has tried catering several times | neu | 1 | - | Ordered diet catering 3 times
41 | alternative | Considers cooking at home but lacks the time | neg | 2 | - | I have no time
41 | job | Eat healthy without the effort | neu | 2 | - |
41 | decision | Asks followers for a recommendation | neu | 1 | - | Anyone know a good one
```
