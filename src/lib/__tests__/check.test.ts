import { describe, expect, test } from "bun:test";
import { checkModule, parseCapabilities, serviceScopes } from "@/lib/modules/check";

describe("checkModule", () => {
  test("accepts a component that calls a declared service", () => {
    const result = checkModule(`import { useService } from "@nshde/services";
export const capabilities = ["service:greeting"];
export default function Greeting() {
  const { data } = useService("greeting", { name: "Ada" });
  return <p>{String(data?.message ?? "")}</p>;
}
`);
    expect(result).toEqual({ ok: true, errors: [], capabilities: ["service:greeting"] });
  });

  test("reports syntax errors with a position", () => {
    const result = checkModule("export default function A() {\n  return <div>;\n}\n");
    expect(result.ok).toBe(false);
    expect(result.errors[0].line).toBe(2);
  });

  test("refuses other imports, a missing default export, and undeclared services", () => {
    const result = checkModule(`import fs from "node:fs";
import { call } from "@nshde/services";
export const capabilities = ["service:a", "network:*"];
export function A() { void call("b"); return null; }
`);
    const messages = result.errors.map((error) => error.message).join("\n");
    expect(messages).toMatch(/Import not allowed in the sandbox: node:fs/);
    expect(messages).toMatch(/must default-export/);
    expect(messages).toMatch(/Unknown capability "network:\*"/);
    expect(messages).toMatch(/Calls service "b" without declaring "service:b"/);
  });

  test("capabilities must be a literal", () => {
    expect(parseCapabilities("export const capabilities = list;").error?.message).toMatch(/array literal/);
    expect(parseCapabilities("export const capabilities = [name];").error?.message).toMatch(/only string literals/);
    expect(parseCapabilities("export const capabilities: string[] = ['service:x', \"service:y\",];").capabilities).toEqual([
      "service:x",
      "service:y",
    ]);
    expect(serviceScopes("export const capabilities = ['service:x', 'service:../y', 'other:z'];")).toEqual(["x"]);
  });
});
