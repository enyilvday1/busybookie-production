import { request } from "node:http";
import { connect } from "node:net";

export type TestResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
}>;

// Loopback-only client for the server under test.
export function send(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, method, path, agent: false, headers }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        text += chunk;
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

// Writes raw bytes, for request targets the http client will not produce.
export function sendRaw(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port }, () => socket.write(raw));
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      text += chunk;
    });
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
  });
}
