const express = require("express");
const router = express.Router();

const {
  CreateOrder,
  getMyOrders,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
  getAllOrders,
} = require("../controllers/order.controller");

const { protect, checkRole } = require("../middlewares/auth.middleware");

// USER ROUTES

router.post("/", protect, CreateOrder);

router.get("/my", protect, getMyOrders);

router.get("/:id", protect, getOrderById);

router.patch("/:id/cancel", protect, cancelOrder);

// Admin Routes

router.get("/", protect, checkRole("admin", "superadmin"), getAllOrders);

router.patch(
  "/:id/status",
  protect,
  checkRole("admin", "superadmin"),
  updateOrderStatus,
);

module.exports = router;
