const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");

function getJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    if (item === "node_modules" || item === ".git" || item === "android" || item === "coverage") continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(getJsFiles(full));
    } else if (item.endsWith(".js")) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = getJsFiles(root);
for (const fullPath of allFiles) {
  const result = spawnSync(process.execPath, ["--check", fullPath], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
for (const model of ["Session", "AuditLog", "Notification", "PaymentEvent", "Grade", "Assignment", "Assessment", "LessonProgress", "PublicRoomArchive"]) {
  if (!schema.includes(`model ${model}`)) throw new Error(`Missing Prisma model: ${model}`);
}
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
if (server.includes("Register request body:")) throw new Error("Sensitive registration body logging is still enabled.");
console.log(`Project checks passed for all ${allFiles.length} JavaScript files and Prisma foundations.`);
