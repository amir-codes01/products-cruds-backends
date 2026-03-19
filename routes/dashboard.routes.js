const express = require("express");
const { getDashboardStats } = require("../controllers/dashboard.controller");

const { protect, isAdmin } = require("../middlewares/auth.middleware");
const router = express.Router();

router.get("/stats", protect, getDashboardStats);

module.exports = router;
