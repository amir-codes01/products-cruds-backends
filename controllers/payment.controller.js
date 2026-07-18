// controllers/payment.controller.js
const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { stripe, webhookSecret } = require("../config/stripe.config");

// Helper function to get Stripe instance (with error handling)
const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new ApiError(503, "Stripe is not configured on the server");
  }
  return stripe;
};

// Create Payment Intent for Stripe
exports.createPaymentIntent = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  // Validate order
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  // Check if user owns this order
  if (order.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "Not authorized to pay for this order");
  }

  // Check if already paid
  if (order.isPaid) {
    throw new ApiError(400, "Order already paid");
  }

  // Get Stripe instance
  const stripe = getStripe();

  // Convert to paisa (smallest currency unit)
  const amountInPaisa = Math.round(order.totalPrice * 100);

  try {
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPaisa,
      currency: "pkr",
      metadata: {
        orderId: order._id.toString(),
        userId: req.user._id.toString(),
      },
      // Optional: Add automatic payment methods
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Create payment record in database
    await Payment.create({
      order: order._id,
      user: req.user._id,
      provider: "Stripe",
      transactionId: paymentIntent.id,
      amount: order.totalPrice,
      currency: "PKR",
      status: "Pending",
    });

    res.status(200).json(
      new ApiResponse(200, "Payment intent created", {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      }),
    );
  } catch (error) {
    console.error("Stripe payment intent error:", error);
    throw new ApiError(500, `Stripe error: ${error.message}`);
  }
});

// Webhook endpoint to handle Stripe events
exports.markOrderPaid = asyncHandler(async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (error) {
    console.error("Webhook signature verification failed:", error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  // Handle payment success
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const { orderId, userId } = paymentIntent.metadata;

    try {
      // Find the order
      const order = await Order.findById(orderId);
      if (!order) {
        console.error("Order not found:", orderId);
        return res.status(404).send("Order not found");
      }

      // Update order
      order.isPaid = true;
      order.paidAt = Date.now();
      order.status = "Processing";
      order.paymentResult = {
        id: paymentIntent.id,
        status: paymentIntent.status,
        email: paymentIntent.receipt_email || order.user?.email,
        method: "Stripe",
      };
      await order.save();

      // Update payment record
      await Payment.findOneAndUpdate(
        { transactionId: paymentIntent.id },
        {
          status: "Succeeded",
          rawResponse: paymentIntent,
          paidAt: Date.now(),
        },
        { upsert: true, new: true },
      );

      console.log(`Order ${orderId} marked as paid successfully`);
    } catch (error) {
      console.error("Error processing webhook:", error);
      return res.status(500).send("Internal server error");
    }
  }

  // Acknowledge receipt of webhook
  res.status(200).json({ received: true });
});

// Confirm COD Order
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
