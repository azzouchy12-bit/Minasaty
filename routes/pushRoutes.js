const express = require("express");
const { verifySessionToken } = require("../utils/sessionAuth");
const { getPublicKey, subscribe, unsubscribe } = require("../controllers/pushController");

async function optionalToken(req, _res, next) {
  const authorizationHeader = req.get("authorization") || "";
  const [scheme, token] = authorizationHeader.split(/\s+/);
  if (scheme?.toLowerCase() === "bearer" && token) {
    try {
      req.user = await verifySessionToken(token);
    } catch (_) {
      req.user = null;
    }
  }
  next();
}

const router = express.Router();
router.get("/public-key", getPublicKey);
router.post("/subscribe", optionalToken, subscribe);
router.delete("/subscribe", optionalToken, unsubscribe);
module.exports = router;

