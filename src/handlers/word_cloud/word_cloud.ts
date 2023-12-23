import { CONFIG } from "../../config.ts";
import { send_group_message } from "../../cqhttp.ts";
import { backup, error, log, spawn_set_input } from "../../utils.ts";
import { cq_image, remove_cqcode } from "../../cqhttp.ts";
import { Report } from "../base.ts";
import { cron } from "https://deno.land/x/deno_cron@v1.0.0/cron.ts";
import { register_report_handler } from "../base.ts";

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

export function wordcloud_handler(report: Report) {
  const group_id = report.group_id;
  const messages = context[group_id];

  const message = remove_cqcode(report.message);
  log(message);
  messages.push(message);

  return Promise.resolve();
}

let task = Promise.resolve();
cron(CONFIG.cron, () => {
  CONFIG.groups.forEach((group_id) => {
    task = task.then(async () => {
      const messages = context[group_id];
      if (messages.length === 0) return;

      await spawn_set_input([
        "python3",
        WORD_CLOUD_PY,
        `--output=${IMAGE_PATH}`,
      ], messages.join("\n"));

      const image = await Deno.readFile(IMAGE_PATH);
      const success = await send_group_message(group_id, cq_image(image), true);
      if (!success) {
        error("send image failed");
        backup(image, "word_cloud.png");
      }

      Deno.remove(IMAGE_PATH);
    }).catch(error);
  });

  task = task.then(() => {
    context.init();
  });
});

const IMAGE_PATH = "/dev/shm/word_cloud.png";
const WORD_CLOUD_PY = "./handlers/word_cloud/word_cloud.py";

register_report_handler(wordcloud_handler);
