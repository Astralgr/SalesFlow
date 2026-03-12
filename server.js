const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

// ── CONFIG ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_YOUR_KEY_HERE';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500'; // your frontend origin

const stripe = Stripe(STRIPE_SECRET_KEY);

const app = express();

// ── MIDDLEWARE ───────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    FRONTEND_URL,
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://localhost:8080',
    // Add your deployed frontend URL here:
    // 'https://your-app.web.app',
    // 'https://your-app.netlify.app',
  ],
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// ── PRICE MAP ───────────────────────────────────────────────────────────
// Replace these with YOUR actual Stripe Price IDs from your Stripe Dashboard
// Go to: Products → Create Product → Add prices → Copy the price ID (starts with price_)
const PRICE_IDS = {
  starter: {
    monthly: process.env.PRICE_STARTER_MONTHLY || 'price_REPLACE_WITH_STARTER_MONTHLY',
    annual:  process.env.PRICE_STARTER_ANNUAL  || 'price_REPLACE_WITH_STARTER_ANNUAL',
  },
  pro: {
    monthly: process.env.PRICE_PRO_MONTHLY || 'price_REPLACE_WITH_PRO_MONTHLY',
    annual:  process.env.PRICE_PRO_ANNUAL  || 'price_REPLACE_WITH_PRO_ANNUAL',
  },
  unlimited: {
    monthly: process.env.PRICE_UNLIMITED_MONTHLY || 'price_REPLACE_WITH_UNLIMITED_MONTHLY',
    annual:  process.env.PRICE_UNLIMITED_ANNUAL  || 'price_REPLACE_WITH_UNLIMITED_ANNUAL',
  },
};

// ── HEALTH CHECK ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Salesflow payment server is running' });
});

// ── CREATE CHECKOUT SESSION ─────────────────────────────────────────────
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { plan, billing, userId, userEmail } = req.body;

    console.log('Checkout request:', { plan, billing, userId, userEmail });

    // Validate inputs
    if (!plan || !billing || !userId || !userEmail) {
      return res.status(400).json({ error: 'Missing required fields: plan, billing, userId, userEmail' });
    }

    // Look up the price ID
    const priceId = PRICE_IDS[plan]?.[billing];
    if (!priceId || priceId.includes('REPLACE')) {
      return res.status(400).json({ 
        error: `No Stripe price configured for plan="${plan}", billing="${billing}". ` +
               `Set up prices in your Stripe Dashboard and update PRICE_IDS in server.js.`
      });
    }

    // Determine success/cancel URLs
    const successUrl = `${FRONTEND_URL}/index.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${FRONTEND_URL}/index.html`;

    // Create the Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        userId:    userId,
        userEmail: userEmail,
        plan:      plan,
      },
      success_url: successUrl,
      cancel_url:  cancelUrl,
    });

    console.log('Session created:', session.id);
    res.json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── VERIFY SESSION (after payment redirect) ─────────────────────────────
app.get('/verify-session', async (req, res) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === 'paid') {
      const plan = session.metadata?.plan || 'starter';
      console.log('Payment verified for plan:', plan);
      res.json({ plan, status: 'active' });
    } else {
      res.json({ plan: null, status: session.payment_status });
    }

  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CUSTOMER PORTAL (manage subscription) ───────────────────────────────
app.post('/create-portal-session', async (req, res) => {
  try {
    const { stripeCustomerId } = req.body;

    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'Missing stripeCustomerId' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${FRONTEND_URL}/index.html`,
    });

    res.json({ url: portalSession.url });

  } catch (err) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── START SERVER ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Payment server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/`);
  console.log(`   Frontend URL: ${FRONTEND_URL}\n`);
});
