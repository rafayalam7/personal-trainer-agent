// Deterministic capture boundary for Strava MCP tool calls (Pre-Phase-7 contract).
// Fires on PostToolUse / PostToolUseFailure for mcp__strava-mcp__* only. Writes the
// tool's raw response to state/.raw-capture/ untouched by Claude — Claude's context
// is never the source of what lands on disk here, including for responses too large
// for the harness to hand Claude directly (see the large-response branch below,
// verified experimentally: PostToolUse's tool_response becomes a truncation notice,
// not the data, once a response exceeds the harness's own token budget — the real
// bytes still exist in the side file that notice names, which the harness wrote
// itself, so this hook reads *that* file rather than trusting tool_response).
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "..", "state", ".raw-capture");

function extractText(toolResponse) {
  // Normal case: MCP content-block array, e.g. [{type:"text", text:"<json string>"}].
  if (Array.isArray(toolResponse)) {
    return toolResponse.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("");
  }
  // Large-response case: a string placeholder naming where the harness saved the
  // full output, e.g. "...Output has been saved to <path>.txt.\n...".
  if (typeof toolResponse === "string") {
    const m = toolResponse.match(/saved to (.+\.txt)/);
    if (m) {
      try {
        return fs.readFileSync(m[1], "utf8");
      } catch (e) {
        return null; // side file unreadable — surface as capture_failed, not silent data loss
      }
    }
    return null; // unrecognized string shape — don't guess
  }
  return null;
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    process.exit(0); // nothing sane to capture
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${event.tool_name}-${event.tool_use_id}.json`);
  const captured_at = new Date().toISOString();

  if (event.hook_event_name === "PostToolUseFailure") {
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          status: "retrieval_failed",
          tool_name: event.tool_name,
          tool_input: event.tool_input,
          error: event.error,
          captured_at,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const text = extractText(event.tool_response);
  if (text === null) {
    fs.writeFileSync(
      file,
      JSON.stringify(
        { status: "capture_failed_unrecognized_format", tool_name: event.tool_name, captured_at },
        null,
        2
      )
    );
    process.stderr.write(`capture-strava: unrecognized tool_response shape for ${event.tool_name}\n`);
    process.exit(0);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null; // keep raw text below even if it doesn't parse as JSON
  }

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        status: "ok",
        tool_name: event.tool_name,
        tool_input: event.tool_input,
        captured_at,
        raw_text: text,
        parsed,
      },
      null,
      2
    )
  );
  process.exit(0);
});
