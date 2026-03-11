require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const app = express();

// ── Price map matching your UI ──────────────────────────────────────────────
const PRICE_IDS = {
  starter:   { monthly: process.env.STRIPE_STARTER_MONTHLY,   annual: process.env.STRIPE_STARTER_ANNUAL },
  pro:       { monthly: process.env.STRIPE_PRO_MONTHLY,        annual: process.env.STRIPE_PRO_ANNUAL },
  unlimited: { monthly: process.env.STRIPE_UNLIMITED_MONTHLY,  annual: process.env.STRIPE_UNLIMITED_ANNUAL },
};

// ── Customer slot limits matching your UI ───────────────────────────────────
const PLAN_LIMITS = {
  free:      6,
  starter:   15,
  pro:       50,
  unlimited: Infinity,
};

app.use(cors({ origin: process.env.BASE_URL }));

// IMPORTANT: Webhook must use raw body — register BEFORE express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId  = session.metadata.userId;
      const plan    = session.metadata.plan;
      const billing = session.metadata.billing;

      // TODO: Save to your database
      // e.g. updateUser(userId, { plan, billing, stripeCustomerId: session.customer, subscriptionId: session.subscription })
      console.log(`✅ Payment success — User: ${userId} | Plan: ${plan} | Billing: ${billing}`);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const plan = getPlanFromPriceId(subscription.items.data[0].price.id);
      // TODO: Update user plan in your database
      console.log(`🔄 Subscription updated — Plan: ${plan} | Status: ${subscription.status}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      // TODO: Downgrade user to free plan in your database
      console.log(`❌ Subscription cancelled — Customer: ${subscription.customer}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      // TODO: Notify user of failed payment
      console.log(`⚠️ Payment failed — Customer: ${invoice.customer}`);
      break;
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ── Create Checkout Session ─────────────────────────────────────────────────
app.post('/create-checkout-session', async (req, res) => {
  const { plan, billing, userId, userEmail } = req.body;

  if (!PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'Invalid plan selected' });
  }

  const priceId = PRICE_IDS[plan][billing] || PRICE_IDS[plan].monthly;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId, plan, billing },
      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.BASE_URL}/cancel`,
      subscription_data: {
        metadata: { userId, plan, billing },
        trial_period_days: 14, // Remove this line if you don't want a free trial
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Create Customer Portal (for managing/cancelling subscription) ────────────
app.post('/create-portal-session', async (req, res) => {
  const { stripeCustomerId } = req.body;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: process.env.BASE_URL,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helper ──────────────────────────────────────────────────────────────────
function getPlanFromPriceId(priceId) {
  for (const [plan, billing] of Object.entries(PRICE_IDS)) {
    if (Object.values(billing).includes(priceId)) return plan;
  }
  return 'free';
}

app.get('/verify-session', async (req, res) => {
  const { session_id } = req.query;

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid') {
      res.json({
        plan:    session.metadata.plan,
        billing: session.metadata.billing,
        userId:  session.metadata.userId,
      });
    } else {
      res.status(400).json({ error: 'Payment not completed' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
