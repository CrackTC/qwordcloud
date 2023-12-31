import { get_config } from "../config.ts";
import { error, log, warn } from "../utils.ts";
import { wsApi } from "../main.ts";
import { sleep } from "https://deno.land/x/sleep@v1.2.1/mod.ts";
import { encode } from "https://deno.land/std@0.202.0/encoding/base64.ts";
import { WebSocketClient } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import {
  AtSegment,
  ImageSegment,
  Message,
  ReplySegment,
  TextSegment,
} from "./types/message.ts";
import { Event } from "./types/event/common.ts";
import { MessageEvent } from "./types/event/message.ts";

export const mk_text = (text: string): TextSegment => ({
  type: "text",
  data: {
    text,
  },
});

export const mk_image = (data: Uint8Array): ImageSegment => (
  {
    type: "image",
    data: {
      file: `base64://${encode(data)}`,
    },
  }
);

export const mk_at = (at: number | "all"): AtSegment => ({
  type: "at",
  data: {
    qq: `${at}`,
  },
});

export const mk_reply = (event: MessageEvent): ReplySegment => ({
  type: "reply",
  data: {
    id: `${event.message_id}`,
  },
});

export const is_group_message_event = (event: Event) =>
  event.post_type == "message" &&
  event.message_type == "group" &&
  event.sub_type == "normal";

export const is_at_self = (msg: Message) => {
  const self_id = get_config().self_id;
  if (typeof msg === "string") {
    return msg.includes(`[CQ:at,qq=${self_id}]`);
  }

  return msg.some((seg) => seg.type === "at" && seg.data.qq === `${self_id}`);
};

const get_api_body = <TParams>(
  endpoint: string,
  params: TParams,
  echo?: string,
) => JSON.stringify({ action: endpoint, params: params, echo });

const http_api_call = async <TParams>(
  endpoint: string,
  params: TParams,
) => {
  const { http_addr, retry_interval, max_retry } = get_config();

  for (let i = 0; i < max_retry + 1; i++) {
    try {
      const data = await fetch(http_addr, {
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: get_api_body(endpoint, params),
      }).then((resp) => resp.json());
      if (data.status !== "failed") return true;

      warn(`http api call to ${endpoint} failed: ${data}`);
      warn(`retry in ${retry_interval} seconds`);
      await sleep(retry_interval);
    } catch (e) {
      warn(`http api call to ${endpoint} failed: ${e}`);
      warn(`retry in ${retry_interval} seconds`);
      await sleep(retry_interval);
    }
  }

  error(`failed to call http api ${endpoint} after ${max_retry} retries`);
  return false;
};

const ws_fetch = (ws: WebSocketClient, msg: string, echo: string) =>
  new Promise<{ status: string }>((resolve) => {
    const listener = (msg: { data: string }) => {
      const data = JSON.parse(msg.data);
      if (data.echo == echo) {
        ws.off("message", listener);
        resolve(data);
      }
    };
    ws.on("message", listener).send(msg);
  });

const ws_api_call = async <TParams>(
  endpoint: string,
  params: TParams,
  ws: WebSocketClient,
) => {
  const { retry_interval, max_retry } = get_config();

  for (let i = 0; i < max_retry + 1; i++) {
    try {
      const echo = crypto.randomUUID();
      const msg = get_api_body(endpoint, params, echo);
      const data = await ws_fetch(ws, msg, echo);
      if (data.status !== "failed") return true;

      warn(`ws api call to ${endpoint} failed: ${data}`);
      warn(`retry in ${retry_interval} seconds`);
      await sleep(retry_interval);
    } catch (e) {
      warn(`ws api call to ${endpoint} failed: ${e}`);
      warn(`retry in ${retry_interval} seconds`);
      await sleep(retry_interval);
    }
  }

  error(`failed to call ws api ${endpoint} after ${max_retry} retries`);
  return false;
};

const api_call = <TParams>(
  endpoint: string,
  params: TParams,
) => {
  log(`calling api ${endpoint}, params: ${JSON.stringify(params)}`);
  return wsApi
    ? ws_api_call(endpoint, params, wsApi)
    : http_api_call(endpoint, params);
};

export const send_group_message = (
  group_id: number,
  message: Message,
  parse_cq = false,
) => api_call("send_group_msg", { group_id, message, auto_escape: !parse_cq });
