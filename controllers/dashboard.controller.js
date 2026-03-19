const asyncHandler = require("../utils/asyncHandler");
const User = require("../models/user.model");
const Order = require("../models/order.model");
const Product = require("../models/product.model");
const ApiResponse = require("../utils/ApiResponse");

const getDashboardStats = asyncHandler(async (req, res) => {
  const now = new Date();

  const lastMonth = new Date();
  lastMonth.setDate(now.getDate() - 30);

  const prevMonth = new Date();
  prevMonth.setDate(now.getDate() - 60);

  const buildCountFacet = () => ({
    $facet: {
      total: [{ $count: "count" }],
      lastMonth: [
        { $match: { createdAt: { $gte: lastMonth } } },
        { $count: "count" },
      ],
      prevMonth: [
        {
          $match: {
            createdAt: { $gte: prevMonth, $lt: lastMonth },
          },
        },
        { $count: "count" },
      ],
    },
  });

  const [userStats, orderStats, productStats, revenueStats] = await Promise.all(
    [
      User.aggregate([buildCountFacet()]),
      Order.aggregate([buildCountFacet()]),
      Product.aggregate([buildCountFacet()]),
      Order.aggregate([
        {
          $facet: {
            total: [
              {
                $group: {
                  _id: null,
                  total: { $sum: "$totalAmount" },
                },
              },
            ],
            lastMonth: [
              { $match: { createdAt: { $gte: lastMonth } } },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$totalAmount" },
                },
              },
            ],
            prevMonth: [
              {
                $match: {
                  createdAt: { $gte: prevMonth, $lt: lastMonth },
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$totalAmount" },
                },
              },
            ],
          },
        },
      ]),
    ],
  );

  const calculateTrend = (current, previous) => {
    if (previous === 0 && current === 0) return 0; // no activity
    if (previous === 0) return 100; // new growth
    return ((current - previous) / previous) * 100;
  };

  const users = userStats[0];
  const orders = orderStats[0];
  const products = productStats[0];
  const revenue = revenueStats[0];

  // 6 months ago, first day of that month
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // Aggregate revenue from Orders
  const monthlyRevenueData = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: sixMonthsAgo, $lte: now },
      },
    },
    {
      $group: {
        _id: { $month: "$createdAt" }, // group by month number
        revenue: { $sum: "$totalAmount" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Month names
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // Build last 6 months array with 0 revenue default
  const last6Months = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const month = monthNames[d.getMonth()];
    return { month, revenue: 0 };
  });

  // Fill revenue from aggregation
  monthlyRevenueData.forEach((item) => {
    const month = monthNames[item._id - 1];
    const idx = last6Months.findIndex((m) => m.month === month);
    if (idx !== -1) last6Months[idx].revenue = item.revenue;
  });

  const formattedMonthlyRevenue = last6Months;

  res.status(200).json(
    new ApiResponse(200, "data get successfully", {
      totals: {
        users: users.total[0]?.count || 0,
        orders: orders.total[0]?.count || 0,
        products: products.total[0]?.count || 0,
        revenue: revenue.total[0]?.total || 0,
      },
      monthlyRevenue: formattedMonthlyRevenue,
      trends: {
        users: calculateTrend(
          users.lastMonth[0]?.count || 0,
          users.prevMonth[0]?.count || 0,
        ),
        orders: calculateTrend(
          orders.lastMonth[0]?.count || 0,
          orders.prevMonth[0]?.count || 0,
        ),
        products: calculateTrend(
          products.lastMonth[0]?.count || 0,
          products.prevMonth[0]?.count || 0,
        ),
        revenue: calculateTrend(
          revenue.lastMonth[0]?.total || 0,
          revenue.prevMonth[0]?.total || 0,
        ),
      },
    }),
  );
});

module.exports = { getDashboardStats };
