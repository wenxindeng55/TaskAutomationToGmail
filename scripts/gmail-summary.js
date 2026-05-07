const path = require("node:path");
const { TaskStore } = require("../src/taskStoreCore");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "tasks.json");

function readArg(name) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return null;
}

const store = new TaskStore(DATA_FILE);
const date = readArg("date") || store.today();
const url = readArg("url") || "http://localhost:8787/";
const summary = store.buildEmailSummary(date, url);

console.log(JSON.stringify(summary, null, 2));
