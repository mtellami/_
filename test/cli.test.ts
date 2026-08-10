import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../src/index.js";

describe("parseCliArgs", () => {
  it("parses the --spec flag", () => {
    assert.deepEqual(parseCliArgs(["--spec", "./openapi.yaml"]), {
      source: "./openapi.yaml",
      help: false,
    });
  });

  it("parses the -s short flag", () => {
    assert.deepEqual(parseCliArgs(["-s", "https://example.com/spec.json"]), {
      source: "https://example.com/spec.json",
      help: false,
    });
  });

  it("parses a positional source", () => {
    assert.deepEqual(parseCliArgs(["./openapi.yaml"]), {
      source: "./openapi.yaml",
      help: false,
    });
  });

  it("treats --help independently of the source", () => {
    const args = parseCliArgs(["--help", "--spec", "x.yaml"]);
    assert.equal(args.help, true);
    assert.equal(args.source, "x.yaml");
  });

  it("ignores unknown flags", () => {
    assert.deepEqual(parseCliArgs(["--verbose", "./openapi.yaml"]), {
      source: "./openapi.yaml",
      help: false,
    });
  });
});
