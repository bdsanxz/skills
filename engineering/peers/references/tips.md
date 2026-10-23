# Tips from earlier exchanges

Every tip here comes from real sessions that worked together through this skill: a mistake one of them made, with what to do instead and why it matters. Read the part for a step before you start that step. When you make a new mistake, or catch one, tell the user so it can be added here.

## Step 5: write the message

### A new message gets a new sequence number

- **Situation:** You send a notice or a new request, and you reuse the number of an earlier exchange, often `1`.
- **Practice:** Reuse a `PEER-SEQ` only for messages in the same exchange. Every new request or notice that starts an exchange of its own gets the next unused number for that peer.
- **Why:** The receiver matches each message to its exchange by that number. A reused number makes a new notice look like part of an old, closed exchange, so it is answered wrongly or not at all.
- **Example:** Exchanges 1 and 2 are done. A notice about a changed API is `--kind notice --seq 3`, not `--seq 1`.

### Information is a notice, not a request

- **Situation:** You tell a teammate something it needs for work it already owns, such as the interface you just built, and you send it as a `request` with "reply if you need anything".
- **Practice:** Send information that asks for no result as a `notice`. Send a `request` only when you need a result back from the receiver, and say in it what that result is.
- **Why:** A request obliges the receiver to answer with a `completion`, and leaves an exchange open until it does. An FYI sent as a request costs the receiver a turn and leaves both sides unsure whether something is still owed.
- **Example:** The front end tells the back end which function name and fields its page expects. That is `--kind notice`; the back end wires the route as part of the task its lead gave it.

### A question for your requester is progress, not a notice

- **Situation:** You cannot start or finish a request without a decision, and you send your requester the options as a `notice`.
- **Practice:** Send a blocker or a decision request as `progress` on the same `--seq`, with the blocked step, the options and the exact input you need. Send it as an `ack` when you have not started at all. Keep `notice` for information that needs no answer.
- **Why:** A notice is answered with a receipt and nothing more. The requester may close it with `OK` and never give the decision you are waiting for.
- **Example:** A role file forbids the task you were given. Send `--kind progress --seq 2` listing the options ("confirm I may edit the docs, or give the task to someone else"), not `--kind notice`.

## Step 6: send

### The body goes in --body or on stdin

- **Situation:** You write `peers send <address> "<text>"`, with the body after the address and without `--kind` or `--seq`, and the command fails.
- **Practice:** Write every send in full: `peers send <address> --kind <kind> --seq <n> --body "<text>"`, or the body on stdin with a heredoc for anything long or quoted. `--kind` and `--seq` are always required.
- **Why:** The failed call and the `--help` that follows cost a turn while the receiver waits, and a long body typed twice drifts between the two attempts.

## Step 7: receive and reply

### Read the whole page

- **Situation:** You pipe `peers open` through `tail` or `head` to keep its output short.
- **Practice:** Run the read command exactly as the notification gives it, and read all it prints. When the history is long, page with `--page`; do not cut the output.
- **Why:** `peers open` marks every message it prints as read, including the ones `tail` throws away. When two messages arrive close together, or one is long, the part you cut is gone from your unread count, and you never see it.

### Every request ends with a completion

- **Situation:** A request only needs a short confirmation, and you answer it with an `ack` ("confirmed, I will do it that way"). The requester takes the ack as the answer, and the exchange never closes.
- **Practice:** Answer a request with one `completion` when the answer is complete, however short it is. Send an `ack` only when the work comes after it, and then send the `completion` when that work is done.
- **Why:** An ack promises a completion later. When none comes, the requester does not know whether to wait, and the chat shows an exchange that never closed.
- **Example:** The front end asks the back end which fields the stats dict will have. The back end answers `--kind completion --seq 1 --body "code, url, clicks, …"`, not with an ack that says it will use them.

### Pushing is not reporting

- **Situation:** You push your branch or write your file, and then end your turn without a message, because the work "is there to see".
- **Practice:** When your part is done, send your requester the `completion` in the same turn: what you pushed, where, and the result of its checks. When you can go no further, send `progress` that says what is done and what you wait for.
- **Why:** Nobody watches the repository for you. Your requester learns of your work only from a message, so pushed work without one looks like a stalled member, and the whole squad waits for it.

### Do not wait for what no message announces

- **Situation:** Your work depends on another member's output, such as a branch that is not pushed yet. You end your turn with "I will continue when it lands".
- **Practice:** Only a message wakes you. Before you end your turn, send the member who produces the output a request to tell you when it lands, or send your requester `progress` that names what you wait for. Then do whatever part of the work does not depend on it.
- **Why:** A push, a new file or a finished build in another session sends you nothing. You then wait forever, and your requester sees silence that it cannot tell from a crash.
- **Example:** A tester's tests need the back end's branch: `peers send <back end> --kind request --seq 4 --body "Answer this with a completion once api/analytics-expiry is pushed; my tests for /s/<code> wait for it."`

### Reply to the address the message gives

- **Situation:** A message arrives and you look up its sender with `peers list` before you reply.
- **Practice:** Reply to `PEER-REPLY-TO` when the message has one, otherwise to `PEER-FROM`, exactly as written. Look an address up only to message a peer that has not written to you.
- **Why:** The headers already hold the right address. A lookup costs a turn, and by role or directory it can pick an older session of the same member that nobody runs any more.

### Only the requester decides

- **Situation:** You work on one member's request, and a question about its scope comes up. Another member, perhaps your requester's own boss, also takes an interest in it.
- **Practice:** Send questions, `progress` and the `completion` of a request to its requester: `PEER-REPLY-TO` when the request has one, otherwise `PEER-FROM`. Tell anyone else with a `notice` only when they need to know, and do not ask them to decide.
- **Why:** Two members who each answer the same question can answer it differently, and you can no longer tell which answer counts. One requester means one decision.

### Ack work that will take long

- **Situation:** A clear request starts work that runs for many minutes, such as a full end-to-end test run, and the requester hears nothing until it ends.
- **Practice:** Before you start, send one `ack` that restates the scope and says roughly how long the work will take. Then send nothing more until a blocker or the `completion`.
- **Why:** Without it, the requester cannot tell long work from a lost message. It may then send the request again or give the work to someone else.

### Close every completion and notice with one receipt

- **Situation:** Some completions and notices get a `receipt`, others get nothing or a long reply.
- **Practice:** Answer each `completion` and each `notice` with exactly one `receipt`: `OK`, or `NO` and why. Never answer an `ack`, a `receipt` or a `progress` that asks nothing.
- **Why:** The receipt tells the sender the exchange is closed and the message landed. Without it, the sender cannot tell whether the message was read. Replies beyond it cost both sides turns.

## Orchestrating peers

### Tell the members your merge unblocks

- **Situation:** You review and merge one member's work, and another member's task depends on it, such as tests that need the new route.
- **Practice:** In the same turn as the merge, send each member that waits for it a `notice`: what landed, and where.
- **Why:** The waiting member learns of the merge only from a message. Without one, it waits, you wait for its completion, and the squad stalls with nobody working.

### Look at your open exchanges whenever a turn reaches you

- **Situation:** You sent several requests. Answers arrive from some members, and one member stays silent for half an hour without anyone noticing.
- **Practice:** Each time a message wakes you while requests are still out, run `peers chats` once, and check your open requests in it. A request still `not read yet` after the others were read and answered means its member is not taking turns: diagnose it with Step 10 now. Do this only on turns you already get; never wake yourself to check.
- **Why:** A member that cannot run, for example because its model quota ran out, sends nothing, so nothing will tell you. The turns you already get are the only cheap moments to notice it.
- **Example:** Three of four members have answered, and the docs member's request shows `not read yet`. Its screen says "Individual quota reached". Reassign the task at once instead of waiting until the user asks for a status.

### Withdraw a task you reassign

- **Situation:** A member cannot do its task, so you give the task to someone else. The first member's request still sits unread in its inbox.
- **Practice:** Send the first member a `notice` with the next unused `--seq`: which request is withdrawn, who does it now, and that it must not act on it.
- **Why:** When the member comes back, it reads its inbox and does the old task, duplicating or overwriting work that is already merged.

### Reassign within the receiver's role

- **Situation:** You hand a task to a member whose role file forbids that kind of work, and it stops to ask.
- **Practice:** Before you reassign, check that the task fits the member's role. When it does not, either do it yourself or give it to a member it fits. If you have the authority to widen a role for one task, say in the request that you do so.
- **Why:** A member that follows its role refuses the task and asks you, which costs a full round. The task then waits on a decision you could have made before sending it.

## Long-running work

### Wait for your own command by its notification

- **Situation:** You start a long command, such as a test suite or a build, and wait for it with a loop that sleeps and checks its output.
- **Practice:** Start the command in the background and end your turn, or do other work. React when your harness reports that the command ended. This is the same rule as for peers: never wait by sleeping or polling.
- **Why:** A sleep loop holds your turn for as long as it runs. Messages from your squad then wait unanswered, and the loop learns nothing that the end notification would not tell you.
- **Example:** Avoid `while ! grep -q PASSED run.log; do sleep 30; done`; run the suite in the background and read `run.log` once it has ended.

### Stop only what you started

- **Situation:** A port is taken, or a stray process slows the machine, and several sessions share that machine.
- **Practice:** Stop a process only when you know you started it, and only by its exact process ID. Use the port or other resource your instructions give you. When something you did not start is in the way, ask your requester or the user.
- **Why:** A broad pattern such as `pkill -f node` also stops other sessions' servers and test runs. They then report failures that no change of theirs caused.

### Leave nothing running when you finish

- **Situation:** You started a server or a watcher for your work, and the work is done.
- **Practice:** Stop everything you started before you send the `completion`. When something must keep running, name it in the completion with its process ID, its port and how to stop it.
- **Why:** A forgotten server keeps its port and its memory. It breaks the next session that needs the port, and later nobody knows whose it is or whether it is safe to stop.
