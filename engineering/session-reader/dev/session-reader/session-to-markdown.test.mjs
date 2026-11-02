import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  convertSession,
  parseSessionText,
  renderMarkdown,
  resolveSessionFile,
} from "../../scripts/session-to-markdown.mjs";

function sessionHeader(id) {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-09-14T10:00:00.000Z",
    cwd: "/tmp/example-project",
  };
}

function writeJsonl(root, fileName, records) {
  const path = join(root, "project", fileName);
  mkdirSync(join(root, "project"), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  writeFileSync(path, content);
  return path;
}

async function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), "session-reader-test-"));
  const sessionsRoot = join(root, "sessions");
  const projectRoot = join(root, "project");
  // The helper only creates the output directory. These roots are created here
  // so path and discovery behavior match a real workspace.
  mkdirSync(join(sessionsRoot, "project"), { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  try {
    await run({ root, sessionsRoot, projectRoot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("renders JSONL messages and session events without dropping content", () => {
  const header = sessionHeader("render-001");
  const records = [
    header,
    { type: "model_change", id: "e1", parentId: null, timestamp: header.timestamp, provider: "test", modelId: "model" },
    { type: "message", id: "u1", parentId: null, timestamp: header.timestamp, message: { role: "user", content: "question" } },
    {
      type: "message",
      id: "e2",
      parentId: "e1",
      timestamp: header.timestamp,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reasoning with ``` inside" },
          { type: "text", text: "answer" },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "file.md" } },
        ],
        provider: "test",
        model: "model",
      },
    },
    {
      type: "message",
      id: "e3",
      parentId: "e2",
      timestamp: header.timestamp,
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "tool output" }],
        isError: false,
      },
    },
    {
      type: "compaction",
      id: "e4",
      parentId: "e3",
      timestamp: header.timestamp,
      summary: "earlier context",
      firstKeptEntryId: "e2",
      tokensBefore: 100,
    },
    { type: "message", id: "e5", parentId: "", timestamp: header.timestamp, message: { role: "user", content: "empty parent" } },
  ];

  const parsed = parseSessionText(records.map((record) => JSON.stringify(record)).join("\n"), {
    extension: ".jsonl",
    sourcePath: "fixture.jsonl",
  });
  const markdown = renderMarkdown(parsed, { sourcePath: "fixture.jsonl" });

  assert.match(markdown, /# Pi Session Transcript/);
  assert.match(markdown, /### Assistant/);
  assert.doesNotMatch(markdown, /reasoning with ``` inside/);
  assert.match(markdown, /```text/);
  assert.match(markdown, /### Tool call.*read/);
  assert.match(markdown, /Path.*file\.md/);
  assert.match(markdown, /Tool result.*read/);
  assert.match(markdown, /tool output/);
  assert.match(markdown, /Context summary/);
  assert.match(markdown, /earlier context/);
  assert.doesNotMatch(markdown, /MODEL CHANGE|Entry ID|Message metadata|\"path\":|## Conversation/);
  assert.ok(markdown.indexOf("### User") < markdown.indexOf("### Assistant"));
  assert.ok(markdown.indexOf("### Assistant") < markdown.indexOf("### Tool call"));
  assert.ok(markdown.indexOf("### Tool call") < markdown.indexOf("### Tool result"));
  assert.match(markdown, /### User — `2026-09-14T10:00:00.000Z`/);
  assert.match(markdown, /\*\*parentId:\*\* `null`/);
  assert.match(markdown, /\*\*parentId:\*\* `""`/);
});

test("resolves exact and unique-prefix IDs without requiring the encoded cwd", async () => {
  await withFixture(async ({ sessionsRoot }) => {
    const exactHeader = sessionHeader("abc-001");
    const exactPath = writeJsonl(sessionsRoot, "2026-09-14T10-00-00-000Z_abc-001.jsonl", [exactHeader]);
    assert.equal(resolveSessionFile("abc-001", sessionsRoot), exactPath);
    assert.equal(resolveSessionFile("abc-0", sessionsRoot), exactPath);
  });
});

test("rejects an ambiguous session prefix instead of guessing", async () => {
  await withFixture(async ({ sessionsRoot }) => {
    writeJsonl(sessionsRoot, "2026-09-14T10-00-00-000Z_amb-one.jsonl", [sessionHeader("amb-one")]);
    writeJsonl(sessionsRoot, "2026-09-14T10-01-00-000Z_amb-two.jsonl", [sessionHeader("amb-two")]);
    assert.throws(() => resolveSessionFile("amb", sessionsRoot), /ambiguous/);
  });
});

test("converts JSONL to the active project, warns on malformed lines, and avoids overwrites", async () => {
  await withFixture(async ({ sessionsRoot, projectRoot }) => {
    const header = sessionHeader("convert-001");
    const sourcePath = writeJsonl(sessionsRoot, "2026-09-14T10-00-00-000Z_convert-001.jsonl", [
      header,
      { type: "message", id: "e1", parentId: null, timestamp: header.timestamp, message: { role: "user", content: "hello" } },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: header.timestamp,
        message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "note.md" } }] },
      },
      {
        type: "message",
        id: "e3",
        parentId: "e2",
        timestamp: header.timestamp,
        message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "result" }], isError: false },
      },
    ]);
    const original = readFileSync(sourcePath, "utf8");
    // Insert a malformed source line to prove the exporter reports it instead
    // of silently presenting an incomplete transcript.
    writeFileSync(sourcePath, `${original}not-json\n`);

    const first = await convertSession({ sessionId: "convert-001", sessionsRoot, projectRoot });
    const second = await convertSession({ sessionId: "convert-001", sessionsRoot, projectRoot });
    const firstMarkdown = readFileSync(first.outputPath, "utf8");

    assert.equal(first.entries, 3);
    assert.equal(first.messages, 1);
    assert.equal(first.toolCalls, 1);
    assert.equal(first.toolResults, 1);
    assert.equal(first.warnings, 1);
    assert.match(firstMarkdown, /hello/);
    assert.match(firstMarkdown, /\*\*parentId:\*\* `null`/);
    assert.match(firstMarkdown, /### Tool call.*read/);
    assert.match(firstMarkdown, /### Tool result.*read/);
    assert.match(firstMarkdown, /Export warnings/);
    assert.notEqual(first.outputPath, second.outputPath);
    assert.match(second.outputPath, /-2\.md$/);
    assert.equal(readFileSync(sourcePath, "utf8"), `${original}not-json\n`);
  });
});

test("accepts a JSON array source and rejects output traversal", async () => {
  await withFixture(async ({ sessionsRoot, projectRoot }) => {
    const header = sessionHeader("json-001");
    const jsonPath = join(sessionsRoot, "project", "json-001.json");
    writeFileSync(jsonPath, JSON.stringify([
      header,
      { type: "message", id: "e1", parentId: null, timestamp: header.timestamp, message: { role: "user", content: "from json" } },
    ]));

    const result = await convertSession({ sessionId: "json-001", sessionsRoot, projectRoot, outputPath: "json-export.md" });
    assert.match(readFileSync(result.outputPath, "utf8"), /from json/);
    assert.equal(result.messages, 1);
    await assert.rejects(
      convertSession({ sessionId: "json-001", sessionsRoot, projectRoot, outputPath: "../outside.md" }),
      /inside the active project/,
    );
  });
});
