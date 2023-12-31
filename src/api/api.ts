import { add_cors, json_header, wrap } from "../wrappers.ts";
import { fail } from "./common.ts";
import { log } from "../utils.ts";

export type ApiHandler = (args: Record<string, string>) => Response;

function mux(path: string[]) {
  const name = path.shift();
  if (name === undefined) return wrap<ApiHandler>(() => fail());
  const sub_mux = mux_list[name];
  if (sub_mux === undefined) return wrap<ApiHandler>(() => fail());
  return sub_mux(path);
}

const request2args = (request: Request) => {
  const url = new URL(request.url);
  const args: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    args[key] = value;
  }
  return args;
};

export const api_handler = (request: Request) =>
  mux(new URL(request.url).pathname.split("/").filter((x) => x !== "").slice(1))
    .with(add_cors)
    .with(json_header)
    .call(request2args(request));

const mux_list: Record<string, typeof mux> = {};

export const load_api = async () => {
  for (const dirEntry of Deno.readDirSync("./api")) {
    if (dirEntry.isDirectory) {
      const module = await import(`./${dirEntry.name}/index.ts`);
      mux_list[dirEntry.name] = module.default;
      log(`Loaded mux ${dirEntry.name}`);
    }
  }
};
