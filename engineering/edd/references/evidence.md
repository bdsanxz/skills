# Evidence

## What counts

Evidence is a file that someone who was not there can open and check against the criterion. Choose it by what the criterion is about:

| The criterion is about | Evidence that shows it |
| --- | --- |
| What a command prints, or how it ends | A transcript: the command, everything it printed, its exit code. |
| Files that are written, changed or left behind | A listing of the folder before and after, and a hash where "unchanged" or "the same" is claimed. |
| Processes or other resources that are started or released | A listing while the product runs, showing them there, and one after it ended, showing them gone. Count the whole process tree, not the parent alone. |
| Something a person sees: a screen, a rendered picture, a frame of a video | A picture of it. Add a measurement when position, size, colour or time matters to the criterion. |
| Motion, or anything that changes over time | Frames at named times on one sheet, each labelled with its time, or a short recording. |
| Two results being the same | A hash of each, or a count of what differs, made by a tool and not by eye. |
| Two results being close | The measured difference and the margin it is held to, both written in the transcript. |
| An error or a refusal | The failing input, run for real: the message, the exit code, and what was left behind. |
| Something that does not happen (no network use, nothing installed, nothing changed) | A watch or a before-and-after listing, with a control that shows the watch sees the thing when it does happen. |
| Behavior driven by clicks or typing | A script or a browser tool that performs the steps, with a picture after each step that matters. |
| Speed or cost | The measurement, how it was taken, how many runs, and what else the machine was doing. |

None of these is evidence:

- a sentence saying that it works, in a transcript, a commit message or a report;
- an exit code with no output, or the last lines of an output whose rest was cut off;
- a passing test, for a criterion about something seen;
- a line the script prints as fixed text (`echo "no process left"`), whatever the product did;
- output from code that has changed since;
- a result reported by a subagent, a CI page you did not open, or a run you remember.

Follow the project's rules on what may not be copied into a record. Never put a secret, a token or personal data in evidence; when a command prints one, mask it in the script and say so in the transcript.

## The evidence script

Evidence is made by a script, so that it can be made again from the final code, by you or by anyone else. A script follows these rules:

1. **A new work folder.** It takes the work folder as its argument and refuses one that exists. It never deletes anything outside it to make room. State from an earlier run cannot leak into this one. Once you have read the run, the whole folder is deleted, so nothing in it may be needed later.
2. **The real product.** It runs the built program or the public interface, the way a user would. It does not call internal functions.
3. **Its own inputs.** It creates every input it needs inside the work folder. It depends on nothing from your session.
4. **Everything shown.** It prints each command before running it, then everything the command printed, then the exit code.
5. **Computed observations.** Each line that states a fact gets its value from a command (`programs still running: $(count_programs)`). The script never prints a verdict as fixed text.
6. **A control.** It shows that the check can see the state it is meant to rule out: the processes listed while the product runs before "0 left" after it, a deliberately wrong input before the right one.
7. **A time limit.** Anything that can hang runs under a limit, and the transcript says so when the limit ended it.
8. **No hidden errors.** No `2>/dev/null` and no `|| true`. When a failure is what the criterion asks for, the failure and its exit code are in the transcript.
9. **One transcript per criterion.** It writes into the evidence folder, one file per criterion, or one for the few criteria that the same run proves: `c1-interrupt-in-each-stage.txt`, `c4-earlier-video-unchanged.txt`, `c7-render-after-cancel.png`. The name says what the file shows.
10. **Nothing anywhere else.** It writes only to the work folder and the evidence folder, and it leaves no process running.
11. **Copies only for a change.** It reads the repository where it stands when the criterion needs nothing changed in it. When a criterion needs a broken or changed repository, it makes one copy for each change, of the files the change needs, without the history and the build output, and removes each copy as soon as its observations are written. It never copies the product's dependencies' sources into the work folder.
12. **One build.** It builds the product once for the run, into one build folder inside the work folder, or uses the build that already exists for the final code. Copies share that build folder where the toolchain allows it; a copy never gets a fresh build of its own unless the criterion is about that build.
13. **Evidence outlives the work folder.** What a transcript must point to (a test log, a summary file) is written into the evidence folder, not left in the work folder. A transcript may name a work-folder path only as part of the setup, never as the place where something can be checked.

Do not edit a script while it is running: the shell reads it as it goes. Run a changed script in another new work folder.

A script in bash can start from this:

```bash
#!/bin/bash
# <run name>: <what this script shows>.
# Usage: bash <path to this script> <new work folder>
set -u
[ $# -eq 1 ] || { echo "usage: $0 <new work folder>"; exit 2; }
[ -e "$1" ] && { echo "the work folder must be new: $1"; exit 2; }
mkdir -p "$1" && W=$(cd "$1" && pwd)
EV=$(cd "$(dirname "$0")" && pwd)   # the evidence folder, where this script lives

LIMIT=120   # seconds one command may take

# Prints a command, runs it under the time limit, prints what it printed and how it ended.
run() {
    echo "\$ $*"
    perl -e 'alarm shift; exec @ARGV' "$LIMIT" "$@" 2>&1
    code=$?
    [ $code -eq 142 ] && echo "[stopped by the time limit of $LIMIT s]"
    echo "[exit $code]"
}

cd "$W"
{
    echo "<run name> criterion 1: <the criterion, word for word>"
    echo "<the setup in a line or two: the input, its size, anything the reader needs>"
    echo
    run <the product> <arguments>
    echo "after the run, the output folder holds: $(ls -A out | tr '\n' ' ')"
} > "$EV/c1-<what-it-shows>.txt" 2>&1
```

## The transcript

A transcript is plain text that a reader can follow without the script beside it:

```text
t038 criterion 4: When a video from an earlier render was at the output path, it is
byte-for-byte unchanged after the cancelled run.
Project demo: 320x180, 30 fps, 2 s (60 frames).

$ app render demo
Rendered 60 frames, 320x180, 30 fps
[exit 0]
sha256 of demo/out/demo.mp4 before: eb1938cb...f7ec

$ app render demo      (interrupted with SIGINT while it waits in encode)
while it waits, demo/out holds: demo.mp4 .demo.mp4.<run id>.part
Render cancelled (in encode)
[exit 130]
after the run, demo/out holds: demo.mp4
sha256 of demo/out/demo.mp4 after: eb1938cb...f7ec
same bytes as before: yes
after the run, programs it started that are still running: 0
```

- It opens with the criterion and the setup.
- Each command is on a line that starts with `$`, with a remark in brackets after it when something was done to the run from outside.
- The output is what the command printed, uncut. Replace only what differs from run to run and means nothing (a run id, a temporary path), and say so.
- Each observation names what was looked at, in words a reader understands without the code.
- It holds no verdict such as "PASS". The reader, and the ledger, judge it against the criterion.

## Pictures

- For a video or an animation, put the frames that matter on one sheet, each labelled with its frame number or time. For a comparison, put the two sides next to each other on one sheet.
- Take a picture of the real screen when the criterion is about the screen: a screenshot of the running UI, or of the player while the video plays.
- Open every picture and look at it before recording it. Say in `shows` what is in the picture, in words, without backticks.
- Keep each file small enough to open: crop to what matters, and scale down a large sheet. A picture stays under 5 MB, and the whole evidence folder under 100 MB.
- Record a video only when the criterion is about motion that a sheet of frames cannot show. Keep it to the seconds that show it, at a small size, and delete every recording that a picture can replace.
