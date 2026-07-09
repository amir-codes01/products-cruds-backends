const mongoose = require("mongoose");
const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const Product = require("../models/product.model");

const getUnitPrice = (product) => {
  if (product.discountPrice && product.discountPrice > 0) {
    return product.discountPrice;
  }
  return product.price;
};

exports.CreateOrder = asyncHandler(async (req, res) => {
  const executeOrderCreation = async (session) => {
    const { orderItems, shippingAddress, paymentMethod } = req.body;

    if (!orderItems || orderItems.length === 0) {
      throw new ApiError(400, "No order items");
    }

    if (!shippingAddress) {
      throw new ApiError(400, "Shipping address is required");
    }

    const allowedMethods = ["COD", "Stripe", "PayPal"];
    if (!paymentMethod || !allowedMethods.includes(paymentMethod)) {
      throw new ApiError(400, "Valid payment method is required");
    }

    let itemsPrice = 0;
    const processedItems = [];

    for (const item of orderItems) {
      const product = session 
        ? await Product.findById(item.product).session(session)
        : await Product.findById(item.product);

      if (!product) {
        throw new ApiError(404, "Product not found");
      }

      if (!product.isActive) {
        throw new ApiError(400, `${product.name} is no longer available`);
      }

      if (product.stock < item.quantity) {
        throw new ApiError(400, `Insufficient stock for ${product.name}`);
      }

      const unitPrice = getUnitPrice(product);

      processedItems.push({
        product: product._id,
        name: product.name,
        image: product.images?.[0]?.url || "",
        price: unitPrice,
        quantity: item.quantity,
      });

      itemsPrice += unitPrice * item.quantity;

      product.stock -= item.quantity;
      product.sold = (product.sold || 0) + item.quantity;
      
      if (session) {
        await product.save({ session });
      } else {
        await product.save();
      }
    }

    const taxPrice = Math.round(itemsPrice * 0.1 * 100) / 100;
    const shippingPrice = itemsPrice > 2500 ? 0 : 200;
    const totalPrice = itemsPrice + taxPrice + shippingPrice;

    const orderData = {
      user: req.user._id,
      orderItems: processedItems,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
      status: "Pending",
    };

    let order;
    if (session) {
      const [createdOrder] = await Order.create([orderData], { session });
      order = createdOrder;
    } else {
      order = await Order.create(orderData);
    }

    const paymentData = {
      order: order._id,
      user: req.user._id,
      provider: paymentMethod,
      transactionId: `${paymentMethod}-${order._id}-${Date.now()}`,
      amount: totalPrice,
      currency: "PKR",
      status: "Pending",
    };

    if (session) {
      await Payment.create([paymentData], { session });
    } else {
      await Payment.create(paymentData);
    }

    return order;
  };

  let order;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      order = await executeOrderCreation(session);
    });
  } catch (error) {
    if (error.message && error.message.includes("Transaction numbers are only allowed on a replica set member or mongos")) {
      order = await executeOrderCreation(null);
    } else {
      throw error;
    }
  } finally {
    session.endSession();
  }

  res
    .status(201)
    .json(new ApiResponse(201, "Order created successfully", order));
});

exports.getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  res.status(200).json(
    new ApiResponse(200, "Orders fetched successfully", {
      count: orders.length,
      orders,
    }),
  );
});

exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    "user",
    "username email",
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

  res.status(200).json(new ApiResponse(200, "Order fetched successfully", order));
});

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

  res
    .status(200)
    .json(new ApiResponse(200, "Order status updated", order));
});

exports.getAllOrders = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const filter = {};

  if (req.query.status) {
    filter.status = req.query.status;
  }

  if (req.query.user) {
    filter.user = req.query.user;
  }

  const totalOrders = await Order.countDocuments(filter);

  const orders = await Order.find(filter)
    .populate("user", "username email")
    .populate("orderItems.product", "name price")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json(
    new ApiResponse(200, "Orders fetched successfully", {
      page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      orders,
    }),
  );
});

exports.cancelOrder = asyncHandler(async (req, res) => {
  const executeOrderCancellation = async (session) => {
    const order = session
      ? await Order.findById(req.params.id).session(session)
      : await Order.findById(req.params.id);

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.user.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Not allowed to cancel this order");
    }

    const cancellableStatuses = ["Pending", "Processing"];

    if (!cancellableStatuses.includes(order.status)) {
      throw new ApiError(400, "Order cannot be cancelled at this stage");
    }

    for (const item of order.orderItems) {
      if (session) {
        await Product.findByIdAndUpdate(
          item.product,
          {
            $inc: { stock: item.quantity, sold: -item.quantity },
          },
          { session },
        );
      } else {
        await Product.findByIdAndUpdate(
          item.product,
          {
            $inc: { stock: item.quantity, sold: -item.quantity },
          },
        );
      }
    }

    order.status = "Cancelled";
    if (session) {
      await order.save({ session });
    } else {
      await order.save();
    }

    return order;
  };

  let order;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      order = await executeOrderCancellation(session);
    });
  } catch (error) {
    if (error.message && error.message.includes("Transaction numbers are only allowed on a replica set member or mongos")) {
      order = await executeOrderCancellation(null);
    } else {
      throw error;
    }
  } finally {
    session.endSession();
  }

  res
    .status(200)
    .json(new ApiResponse(200, "Order cancelled successfully", order));
});
