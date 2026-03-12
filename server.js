require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const app = express();

const PRICE_IDS = {
  starter:   { monthly: process.env.STRIPE_STARTER_MONTHLY, annual: process.env.STRIPE_STARTER_ANNUAL },
  pro:       { monthly: process.env.STRIPE_PRO_MONTHLY,     annual: process.env.STRIPE_PRO_ANNUAL },
  unlimited: { monthly: process.env.STRIPE_UNLIMITED_MONTHLY, annual: process.env.STRIPE_UNLIMITED_ANNUAL },
};

app.use(cors({
  origin: ['https://astralgr.github.io', 'http://localhost'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  res.json({ received: true });
});

app.use(express.json());

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
      success_url: 'https://astralgr.github.io/SalesFlow/index.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://astralgr.github.io/SalesFlow/index.html',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/create-portal-session', async (req, res) => {
  const { stripeCustomerId } = req.body;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: 'https://astralgr.github.io/SalesFlow/index.html',
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

function getPlanFromPriceId(priceId) {
  for (const [plan, billing] of Object.entries(PRICE_IDS)) {
    if (Object.values(billing).includes(priceId)) return plan;
  }
  return 'free';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
