// config/stripe.config.js
const Stripe = require("stripe");

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16", // Use latest stable version
});

// Webhook secret for verifying Stripe webhooks
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

module.exports = { stripe, webhookSecret };
