// backend/routes/auditLogRoutes.js
const express = require("express");
const router = express.Router();
const {
  getAuditLogs,
  getAuditLogStats,
  getAuditLogById,
  getUserActivity,
  exportAuditLogs,
  getAuditLogFilters,
  getAuditLogAnalytics,
} = require("../controllers/auditLogController");
const { protect, checkRole } = require("../middlewares/auth.middleware");

// All routes require authentication and admin access
router.use(protect);
router.use(checkRole("admin", "superadmin"));

// Main routes
router.get("/", getAuditLogs);
router.get("/stats", getAuditLogStats);
router.get("/filters", getAuditLogFilters);
router.get("/analytics", getAuditLogAnalytics);
router.get("/export", exportAuditLogs);
router.get("/:id", getAuditLogById);
router.get("/users/:userId", getUserActivity);

module.exports = router;
