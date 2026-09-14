const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const files = [
  "server.js",
  "controllers/authController.js",
  "controllers/studentController.js",
  "controllers/academicController.js",
  "middleware/authMiddleware.js",
  "middleware/rateLimit.js",
  "routes/authRoutes.js",
  "routes/academicRoutes.js",
  "routes/nativeAlertRoutes.js",
  "controllers/nativeAlertController.js",
  "utils/liveAlertHub.js",
  "utils/sessionAuth.js",
  "utils/audit.js",
  "utils/metrics.js",
  "public/js/session-storage.js",
  "public/js/academic-center.js",
];


for (const relative of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
for (const model of ["Session", "AuditLog", "Notification", "PaymentEvent", "Grade", "Assignment", "Assessment", "LessonProgress", "PublicRoomArchive"]) {
  if (!schema.includes(`model ${model}`)) throw new Error(`Missing Prisma model: ${model}`);
}
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
if (server.includes("Register request body:")) throw new Error("Sensitive registration body logging is still enabled.");
console.log(`Project checks passed for ${files.length} JavaScript files and Prisma foundations.`);
