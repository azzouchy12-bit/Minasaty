const express = require("express");
const {
  teacherLogin,
  parentLogin,
  getParentEmail,
  updateParentEmail,
  sendParentEmailCode,
  verifyParentEmailCode,
  logout,
  sessionStatus,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  changeParentPin,
  requestParentPinReset,
  listParentPinResetRequests,
  issueTemporaryParentPin,
} = require("../controllers/authController");
const { verifyToken, isTeacher } = require("../middleware/authMiddleware");
const { authRateLimit } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/teacher", authRateLimit, teacherLogin);
router.post("/parent", authRateLimit, parentLogin);
router.post("/parent/forgot", authRateLimit, requestParentPinReset);
router.get("/parent/forgot-requests", verifyToken, isTeacher, listParentPinResetRequests);
router.put("/parent/forgot-requests/:id/issue", verifyToken, isTeacher, issueTemporaryParentPin);
router.post("/logout", verifyToken, logout);
router.get("/session-status", verifyToken, sessionStatus);
router.get("/sessions", verifyToken, listSessions);
router.delete("/sessions/others", verifyToken, revokeOtherSessions);
router.delete("/sessions/:id", verifyToken, revokeSession);
router.put("/parent/pin", verifyToken, changeParentPin);
router.get("/parent/email", verifyToken, getParentEmail);
router.put("/parent/email", verifyToken, updateParentEmail);
router.post("/parent/email/send-code", verifyToken, sendParentEmailCode);
router.post("/parent/email/verify-code", verifyToken, verifyParentEmailCode);

module.exports = router;
