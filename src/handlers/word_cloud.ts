import { CONFIG } from "../config.ts";
import { send_group_message } from "../cqhttp.ts";
import { backup, error, image2cqcode, log, remove_cqcode } from "../utils.ts";
import { Report } from "./base.ts";
import { cron } from "https://deno.land/x/deno_cron@v1.0.0/cron.ts";

class Context {
  [group_id: number]: string[];

  init() {
    CONFIG.groups.forEach((group_id) => this[group_id] = []);
  }

  constructor() {
    this.init();
  }
}

const context = new Context();

export const wordcloud_handler = (report: Report) => {
  const group_id = report.group_id;
  const messages = context[group_id];

  const message = remove_cqcode(report.message);
  log(message);
  messages.push(message);
};

const COMMAND = new Deno.Command("python3", {
  args: ["./word_cloud.py", "--output=/dev/shm/word_cloud.png"],
  stdin: "piped",
  stdout: "null",
});

let task = Promise.resolve();
cron(CONFIG.cron, () => {
  CONFIG.groups.forEach((group_id) => {
    task = task.then(async () => {
      const messages = context[group_id];
      const all_msg = messages.join("\n");

      const child = COMMAND.spawn();

      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(all_msg));
      writer.releaseLock();
      child.stdin.close();

      const status = await child.status;
      if (!status.success) {
        error(`child process exited with non-zero status code ${status.code}`);
        return;
      }

      const img_bytes = await Deno.readFile("/dev/shm/word_cloud.png");
      const img = image2cqcode(img_bytes);
      const success = await send_group_message(group_id, img, true);
      if (!success) {
        error("send image failed");
        backup(img_bytes, "result.png");
      }

      Deno.remove("/dev/shm/word_cloud.png");
    });
  });

  task = task.then(() => {
    context.init();
  });
});