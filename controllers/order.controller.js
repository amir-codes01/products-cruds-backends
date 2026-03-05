const mongoose = require("mongoose");
const Order = require("../models/order.model");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const Product = require("../models/product.model");

exports.CreateOrder = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderItems, shippingAddress, paymentMethod } = req.body;

    if (!orderItems || orderItems.lenght === 0) {
      throw new ApiError(400, "No order items");
    }

    let itemsPrice = 0;

    for (const item of orderItems) {
      const product = await Product.findById(item.product).session(session);

      if (!product) {
        throw new ApiError(404, `Product not found`);
      }

      if (product.stock < item.quantity) {
        throw new ApiError(400, `Insufficient stock for ${product.name}`);
      }

      item.price = product.price;
      item.name = product.name;
      item.image = product.image;

      itemsPrice += product.price * item.quantity;

      product.stock -= item.quantity;
      await product.save({ session });
    }

    const taxPrice = itemsPrice * 0.1;
    const shippingPrice = itemsPrice > 2500 ? 0 : 200;
    const totalPrice = itemsPrice + taxPrice + shippingPrice;

    const order = await Order.create(
      [
        {
          user: req.user._id,
          orderItems,
          shippingAddress,
          paymentMethod,
          itemsPrice,
          taxPrice,
          shippingPrice,
          taxPrice,
          totalPrice,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    res
      .status(201)
      .json(new ApiResponse(201, "Order created successfully", order[0]));
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

// @desc    Get logged in user's orders
// @route   GET /api/orders/my
// @access  Private
exports.getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  res.status(200).json(
    new ApiResponse(200, {
      count: orders.length,
      data: orders,
    }),
  );
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    "user",
    "name email",
  );

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (
    order.user._id.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    throw new ApiError(403, "Not authorized");
  }

  res.status(200).json(new ApiResponse(200, "order get successfully", order));
});

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Admin
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  const order = await Order.findById(req.params.id);

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  order.status = status;

  if (status === "Delivered") {
    order.isDelivered = true;
    order.deliveredAt = Date.now();
  }

  await order.save();

  res.status(200).json(200, "Order status updated", order);
});

exports.getAllOrders = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  const skip = (page - 1) * limit;

  // Optional filters
  const filter = {};

  if (req.query.status) {
    filter.status = req.query.status;
  }

  if (req.query.user) {
    filter.user = req.query.user;
  }

  const totalOrders = await Order.countDocuments(filter);

  const orders = await Order.find(filter)
    .populate("user", "name email")
    .populate("items.product", "name price")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json(
    new ApiResponse(200, {
      page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      orders,
    }),
  );
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findById(req.params.id).session(session);

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.user.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Not allowed to cancel this order");
    }

    const cancellableStatuses = ["pending", "confirmed"];

    if (!cancellableStatuses.includes(order.status)) {
      throw new ApiError(400, "Order cannot be cancelled at this stage");
    }
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: item.quantity } },
        { session },
      );
    }
    order.status = "cancelled";
    order.cancelledAt = new Date();

    await order.save({ session });

    await session.commitTransaction();

    res
      .status(200)
      .json(new ApiResponse(200, "Order cancelled successfully", order));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});
