const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new ApiError(503, "Stripe is not configured on the server");
  }

  return require("stripe")(process.env.STRIPE_SECRET_KEY);
};

exports.createPaymentIntent = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  const order = await Order.findById(orderId);

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "Not authorized to pay for this order");
  }

  if (order.isPaid) {
    throw new ApiError(400, "Order already paid");
  }

  const stripe = getStripe();
  const amountInPaisa = Math.round(order.totalPrice * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInPaisa,
    currency: "pkr",
    metadata: {
      orderId: order._id.toString(),
      userId: req.user._id.toString(),
    },
  });

  res.status(200).json(
    new ApiResponse(200, "Payment intent created", {
      clientSecret: paymentIntent.client_secret,
    }),
  );
});

exports.markOrderPaid = asyncHandler(async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    throw new ApiError(400, "Webhook Error");
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const { orderId, userId } = paymentIntent.metadata;

    const order = await Order.findById(orderId);
    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    order.isPaid = true;
    order.paidAt = Date.now();
    order.status = "Processing";
    order.paymentResult = {
      id: paymentIntent.id,
      status: paymentIntent.status,
      email: paymentIntent.receipt_email,
      method: "Stripe",
    };

    await order.save();

    await Payment.findOneAndUpdate(
      { order: orderId },
      {
        provider: "Stripe",
        transactionId: paymentIntent.id,
        amount: paymentIntent.amount / 100,
        currency: "PKR",
        status: "Succeeded",
        rawResponse: paymentIntent,
        paidAt: Date.now(),
      },
      { upsert: true, new: true },
    );
  }

  res.status(200).json(new ApiResponse(200, "Webhook processed"));
});

exports.confirmCodOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId);

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "Not authorized");
  }

  if (order.paymentMethod !== "COD") {
    throw new ApiError(400, "This order is not a cash-on-delivery order");
  }

  order.status = "Processing";
  await order.save();

  res.status(200).json(
    new ApiResponse(200, "Cash on delivery order confirmed", {
      orderId: order._id,
      status: order.status,
      paymentMethod: order.paymentMethod,
      totalPrice: order.totalPrice,
    }),
  );
});
