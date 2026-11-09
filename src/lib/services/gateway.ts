import { connect } from "node:net";

/**
 * Client for the alchemist `Runtime.ServiceGateway`: one connection per call,
 * 4-byte big-endian length then JSON, in both directions. nshde only ever
 * sends `call`.
 */

export type GatewayResponse =
  | { ok: true; result: unknown }
  | { ok: false; code: string; error: string };

const maxResponse = 10 * 1024 * 1024;

export function callGateway(
  port: number,
  slug: string,
  args: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const body = Buffer.from(JSON.stringify({ op: "call", name: slug, args }), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.write(Buffer.concat([header, body])));
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32BE(0);
      if (size > maxResponse) {
        finish(() => reject(new Error("gateway response too large")));
        return;
      }
      if (buffer.length < 4 + size) return;
      const text = buffer.subarray(4, 4 + size).toString("utf8");
      finish(() => {
        try {
          resolve(JSON.parse(text) as GatewayResponse);
        } catch {
          reject(new Error("gateway sent invalid JSON"));
        }
      });
    });
    socket.on("timeout", () => finish(() => reject(new Error("gateway timed out"))));
    socket.on("error", (error) => finish(() => reject(error)));
    socket.on("close", () => finish(() => reject(new Error("gateway closed the connection"))));
  });
}

/** HTTP status for a gateway error code. */
export function gatewayStatus(code: string): number {
  switch (code) {
    case "bad_slug":
    case "bad_request":
    case "invalid_input":
    case "op_refused":
      return 400;
    case "not_published":
      return 403;
    case "not_found":
      return 404;
    case "source_changed":
      return 409;
    case "no_schema":
      return 422;
    case "invalid_output":
      return 502;
    case "not_loaded":
      return 503;
    case "timeout":
      return 504;
    default:
      return 500;
  }
}
