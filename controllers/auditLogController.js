// backend/controllers/auditLogController.js
const AuditLog = require("../models/audit.model");
const User = require("../models/user.model");
const asyncHandler = require("../utils/asyncHandler");

// @desc    Get all audit logs with advanced filtering
// @route   GET /api/audit-logs
// @access  Private/Admin
const getAuditLogs = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    user,
    action,
    startDate,
    endDate,
    search,
    sortBy = "createdAt",
    order = "desc",
  } = req.query;

  const pageNum = Math.max(parseInt(page) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

  const allowedSortFields = ["createdAt", "action"];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
  const sortOrder = order === "desc" ? -1 : 1;

  const filter = {};

  if (user) filter.user = user;
  if (action) filter.action = action;

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate && !isNaN(Date.parse(startDate))) {
      filter.createdAt.$gte = new Date(startDate);
    }
    if (endDate && !isNaN(Date.parse(endDate))) {
      filter.createdAt.$lte = new Date(endDate);
    }
  }

  if (search) {
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { action: { $regex: safeSearch, $options: "i" } },
      { ipAddress: { $regex: safeSearch, $options: "i" } },
      { "metadata.message": { $regex: safeSearch, $options: "i" } },
    ];
  }

  const skip = (pageNum - 1) * limitNum;

  const [auditLogs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate("user", "name email role profileImage")
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  const uniqueActions = await AuditLog.distinct("action");

  res.json({
    success: true,
    auditLogs,
    uniqueActions,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

// @desc    Get audit log statistics for dashboard
// @route   GET /api/audit-logs/stats
// @access  Private/Admin
const getAuditLogStats = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - parseInt(days));

    // Get total counts and unique users
    const [totalLogs, uniqueUsers] = await Promise.all([
      AuditLog.countDocuments({ createdAt: { $gte: dateLimit } }),
      AuditLog.distinct("User", { createdAt: { $gte: dateLimit } }).then(
        (users) => users.length,
      ),
    ]);

    // Get top actions by count
    const topActions = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get recent activity with user details
    const recentActivity = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      { $sort: { createdAt: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          action: 1,
          createdAt: 1,
          ipAddress: 1,
          "userDetails.name": 1,
          "userDetails.email": 1,
          "userDetails.profileImage": 1,
        },
      },
    ]);

    // Get daily activity for chart
    const dailyActivity = await AuditLog.aggregate([
      {
        $match: {
          createdAt: { $gte: dateLimit },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get activity by hour of day
    const hourlyActivity = await AuditLog.aggregate([
      {
        $match: {
          createdAt: { $gte: dateLimit },
        },
      },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get activity by day of week
    const weeklyActivity = await AuditLog.aggregate([
      {
        $match: {
          createdAt: { $gte: dateLimit },
        },
      },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get action type breakdown
    const actionBreakdown = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      {
        $group: {
          _id: {
            $arrayElemAt: [{ $split: ["$action", "."] }, 0],
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Get top users by activity
    const topUsers = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      {
        $group: {
          _id: "$user",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          count: 1,
          "userDetails.name": 1,
          "userDetails.email": 1,
          "userDetails.role": 1,
        },
      },
    ]);

    res.json({
      success: true,
      stats: {
        totalLogs,
        uniqueUsers,
        topActions,
        recentActivity,
        dailyActivity,
        hourlyActivity,
        weeklyActivity,
        actionBreakdown,
        topUsers,
        period: parseInt(days),
      },
    });
  } catch (error) {
    console.error("Error fetching audit log stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: error.message,
    });
  }
};

// @desc    Get single audit log details
// @route   GET /api/audit-logs/:id
// @access  Private/Admin
const getAuditLogById = async (req, res) => {
  try {
    const { id } = req.params;

    const auditLog = await AuditLog.findById(id)
      .populate("user", "name email role profileImage")
      .lean();

    if (!auditLog) {
      return res.status(404).json({
        success: false,
        message: "Audit log not found",
      });
    }

    res.json({
      success: true,
      auditLog,
    });
  } catch (error) {
    console.error("Error fetching audit log:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch audit log",
      error: error.message,
    });
  }
};

// @desc    Get user activity timeline
// @route   GET /api/audit-logs/users/:userId
// @access  Private/Admin
const getUserActivity = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50, startDate, endDate } = req.query;

    const filter = { user: userId };

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [activities, total, user] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      AuditLog.countDocuments(filter),
      User.findById(userId).select("name email role"),
    ]);

    // Get activity summary for user
    const summary = await AuditLog.aggregate([
      { $match: { user: mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          lastOccurrence: { $max: "$createdAt" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      user,
      activities,
      summary,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching user activity:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user activity",
      error: error.message,
    });
  }
};

// @desc    Export audit logs
// @route   GET /api/audit-logs/export
// @access  Private/Admin
const exportAuditLogs = async (req, res) => {
  try {
    const { startDate, endDate, format = "json", action, user } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    if (action) filter.action = action;
    if (user) filter.user = user;

    const logs = await AuditLog.find(filter)
      .populate("user", "name email role")
      .sort({ createdAt: -1 })
      .lean();

    if (format === "csv") {
      const csvHeaders = [
        "Action",
        "User Name",
        "User Email",
        "User Role",
        "IP Address",
        "User Agent",
        "Timestamp",
        "Metadata",
      ];

      const csvRows = logs.map((log) => [
        log.action,
        log.user?.name || "System",
        log.user?.email || "system@example.com",
        log.user?.role || "system",
        log.ipAddress || "",
        log.userAgent || "",
        new Date(log.createdAt).toISOString(),
        JSON.stringify(log.metadata || {}),
      ]);

      const csvContent = [csvHeaders, ...csvRows]
        .map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=audit-logs-${Date.now()}.csv`,
      );
      return res.send(csvContent);
    }

    // Default JSON export
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=audit-logs-${Date.now()}.json`,
    );
    res.json(logs);
  } catch (error) {
    console.error("Error exporting audit logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export audit logs",
      error: error.message,
    });
  }
};

// @desc    Get audit log filters data (for dropdowns)
// @route   GET /api/audit-logs/filters
// @access  Private/Admin
const getAuditLogFilters = async (req, res) => {
  try {
    const [actions, users] = await Promise.all([
      AuditLog.distinct("action"),
      User.find({}, "name email role").lean(),
    ]);

    // Group actions by category
    const actionCategories = {};
    actions.forEach((action) => {
      const category = action.split(".")[0];
      if (!actionCategories[category]) {
        actionCategories[category] = [];
      }
      actionCategories[category].push(action);
    });

    res.json({
      success: true,
      filters: {
        actions: actions.sort(),
        actionCategories,
        users,
      },
    });
  } catch (error) {
    console.error("Error fetching audit log filters:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch filters",
      error: error.message,
    });
  }
};

// @desc    Get audit log analytics
// @route   GET /api/audit-logs/analytics
// @access  Private/Admin
const getAuditLogAnalytics = async (req, res) => {
  try {
    const { period = "month" } = req.query;

    let dateLimit = new Date();
    switch (period) {
      case "week":
        dateLimit.setDate(dateLimit.getDate() - 7);
        break;
      case "month":
        dateLimit.setMonth(dateLimit.getMonth() - 1);
        break;
      case "quarter":
        dateLimit.setMonth(dateLimit.getMonth() - 3);
        break;
      case "year":
        dateLimit.setFullYear(dateLimit.getFullYear() - 1);
        break;
      default:
        dateLimit.setMonth(dateLimit.getMonth() - 1);
    }

    // Get peak activity times
    const peakHours = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 3 },
    ]);

    // Get most active days
    const activeDays = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Get success/failure rates
    const actionOutcomes = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      {
        $group: {
          _id: {
            action: "$action",
            status: "$metadata.responseStatus",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Get user activity trends
    const userTrends = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: dateLimit } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            user: "$user",
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.date",
          uniqueUsers: { $sum: 1 },
          totalActions: { $sum: "$count" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      analytics: {
        peakHours,
        activeDays,
        actionOutcomes,
        userTrends,
        period,
      },
    });
  } catch (error) {
    console.error("Error fetching audit log analytics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics",
      error: error.message,
    });
  }
};

module.exports = {
  getAuditLogs,
  getAuditLogStats,
  getAuditLogById,
  getUserActivity,
  exportAuditLogs,
  getAuditLogFilters,
  getAuditLogAnalytics,
};
