# Expense reports: Tasks

## Scope

- Sources: the expense-reports specification (`_swe/specifications/expense-reports.md`: R1–R5, D1–D2, S1–S4).
- Outcome: members download their own expenses as a spreadsheet file, for a date range or a tax year, and support can see that they did.
- Actors: Member; Support operator; Visitor who is not signed in.
- In scope: Expense export, Tax-year selection.
- Not covered: exporting other members' expenses (R3); scheduled exports (product owner, message 5); Excel `.xlsx` files (D1); PDF reports, deferred (product owner, message 6).

## Feature: Expense export

Lets a member download their own expenses for a date range as a CSV file, and lets a support operator see afterwards that the export happened.

- **Work type**: new behavior

### T1. Member exports their expenses for a date range

- **Actor**: Member
- **Path**: Happy
- **Status**: Required
- **Source**: R1, R2, R3, D1, D2, S1
- **Needs**: none

**Scenario**: Given a signed-in member with expenses dated 2025-01-01, 2025-06-30 and 2026-01-01, when they choose 2025-01-01 as the start date and 2025-12-31 as the end date and ask for the export, then their browser downloads a CSV file that holds the expenses dated 2025-01-01 and 2025-06-30, one per row, and nothing else.

**Acceptance criteria**

- [ ] The file contains exactly two expense rows, dated 2025-01-01 and 2025-06-30.
- [ ] Opened in Excel and in Google Sheets, each row shows the expense's date, amount, currency, category and note in their own columns.
- [ ] An expense whose note is `Lunch, with "client"` shows that exact text in its note cell.
- [ ] Given members A and B who each have one expense dated 2025-03-01, when A exports 2025-03-01 to 2025-03-01, then the file holds one row, and it is A's.
- [ ] A range of exactly 366 days downloads a file.

### T2. Support operator sees a member's export in the activity log

- **Actor**: Support operator
- **Path**: Happy
- **Status**: Required
- **Source**: R4, S3
- **Needs**: T1
- **Needs because**: an export entry can only appear in the activity log after an export has been downloaded.

**Scenario**: Given a member who downloaded an export at 09:00 and another at 09:05, when a support operator opens that member's support page, then the activity log shows two export entries, the 09:05 one first.

**Acceptance criteria**

- [ ] The log shows two export entries for the member, each with its download time, newest first.

### T3. Member is told the end date is before the start date

- **Actor**: Member
- **Path**: Negative
- **Status**: Required
- **Source**: S1
- **Needs**: T1
- **Needs because**: the refusal is a response to the export request that T1 delivers.

**Scenario**: Given a signed-in member, when they choose 2025-12-31 as the start date and 2025-01-01 as the end date and ask for the export, then no file downloads and they see `The end date must be on or after the start date.`. They change the dates and export again.

**Acceptance criteria**

- [ ] With those dates, no file is downloaded and the message above is shown.
- [ ] After the member changes the end date to 2026-01-01 and exports again, the file downloads.

### T4. Member is told the range is too long

- **Actor**: Member
- **Path**: Negative
- **Status**: Required
- **Source**: D2, S1
- **Needs**: T1
- **Needs because**: the refusal is a response to the export request that T1 delivers.

**Scenario**: Given a signed-in member, when they ask for an export of a range that covers 367 days, then no file downloads and they see a message that names the 366-day limit [Q2]. They shorten the range and export again.

**Acceptance criteria**

- [ ] A range of 367 days downloads no file and shows the limit message.
- [ ] After the member shortens the range to 366 days and exports again, the file downloads.

### T5. Visitor who is not signed in is sent to sign in

- **Actor**: Visitor who is not signed in
- **Path**: Negative
- **Status**: Required
- **Source**: R3, S2, F1
- **Needs**: T1
- **Needs because**: the sign-in redirect guards the export that T1 delivers.

**Scenario**: Given a visitor who is not signed in, when they request an export, then no file downloads and they are sent to the sign-in page. After signing in they return to the page they asked for.

**Acceptance criteria**

- [ ] A request for an export without a session downloads no file and shows the sign-in page.
- [ ] After signing in, the visitor is on the export page.

### T6. Member exports a range with no expenses

- **Actor**: Member
- **Path**: Alternative
- **Status**: Required
- **Source**: R1 (empty state) [Q1]
- **Needs**: T1
- **Needs because**: an empty range is a case of the export that T1 delivers.

**Scenario**: Given a signed-in member with no expenses between 2024-01-01 and 2024-12-31, when they export that range, then [Q1].

**Acceptance criteria**

- [ ] The expected result is settled by [Q1]; the check is written once it is answered.

## Feature: Tax-year selection

Lets a member fill the export's date range by choosing a tax year instead of typing two dates.

- **Work type**: new behavior

### T7. Member exports a whole tax year by choosing the year

- **Actor**: Member
- **Path**: Alternative
- **Status**: Required
- **Source**: R5, S4
- **Needs**: T1
- **Needs because**: choosing a year fills the date range of the export that T1 delivers.

**Scenario**: Given a signed-in member, when they choose the year 2025 and ask for the export, then the date range is 2025-01-01 to 2025-12-31 and the file downloads exactly as if they had typed those dates.

**Acceptance criteria**

- [ ] Choosing 2025 shows the start date 2025-01-01 and the end date 2025-12-31.
- [ ] The downloaded file equals the file from T1's export of 2025-01-01 to 2025-12-31.

## Coverage

| Source statement | Covered by |
| --- | --- |
| R1 "Members need to download their expenses so they can open them in Excel or Google Sheets." | T1, T6 |
| R2 "They pick the period." | T1 |
| R3 "Nobody should ever be able to get someone else's expenses." | T1, T5 |
| R4 "Support has to see when someone exported." | T2 |
| R5 "Usually it's a tax year, so let them just pick the year." | T7 |
| D1 The file is CSV only. | T1 |
| D2 A range covers at most 366 days. | T1, T4 |
| S1 failure path: the end date is before the start date. | T3 |
| Wording of the message for a range over 366 days (not stated) | Q2 |

## Open questions

### Q1. What happens when the range contains no expenses?

- **Unclear**: No source says whether a member gets an empty file (header row only), or a message and no file.
- **Why it matters**: It decides what T6 checks.
- **Options raised**: none raised
- **Blocks**: T6

### Q2. What is the exact message when the range is over 366 days?

- **Unclear**: D2 gives the limit; no source gives the wording.
- **Why it matters**: T4's check compares the message text.
- **Options raised**: none raised
- **Blocks**: T4
