"use strict";

const express = require("express");
const router = express.Router();
const {
  streamAlerts,
  checkAlert,
  pollAlert,
  acknowledgeAlert,
  dismissAlert,
  getActiveAlert,
  registerDevice,
  getStats,
  testTriggerAlert,
} = require("../controllers/nativeAlertController");

// Public endpoints consumed by native Android services & AlarmManager
router.get("/stream", streamAlerts);
router.get("/check", checkAlert);
router.get("/poll", pollAlert);
router.get("/active", getActiveAlert);
router.post("/ack", acknowledgeAlert);
router.post("/register", registerDevice);
router.get("/stats", getStats);

// Dismiss / Test
router.post("/dismiss", dismissAlert);
router.post("/test", testTriggerAlert);

module.exports = router;
