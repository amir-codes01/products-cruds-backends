const express = require("express");
const { getDashboardStats } = require("../controllers/dashboard.controller");

const { protect, checkRole } = require("../middlewares/auth.middleware");
const router = express.Router();

router.get(
  "/stats",
  protect,
  checkRole("admin", "superadmin"),
  getDashboardStats,
);

module.exports = router;
