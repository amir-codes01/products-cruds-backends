const express = require("express");
const {
  CreateOrder,
  getMyOrders,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
  getAllOrders,
} = require("../controllers/order.controller");
const { protect, isAdmin } = require("../middlewares/auth.middleware");
const router = express.Router();

router.route("/").get(getAllOrders).post(protect, isAdmin, CreateOrder);

router.route("/:id").get(getOrderById).put(protect, cancelOrder);

router.route("/my").get(protect, getMyOrders);
router("/:id/status", isAdmin, updateOrderStatus);

module.exports = router;
