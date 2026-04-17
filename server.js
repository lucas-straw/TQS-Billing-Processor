const express = require('express');
const session = require('express-session');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const path = require('path');

const app = express();

// Trust Railway's TLS-terminating proxy so secure cookies work
app.set('trust proxy', 1);

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId:     process.env.CLIENT_ID,
    authority:    `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET,
  },
});

const REDIRECT_URI = process.env.REDIRECT_URI;
const SCOPES = ['openid', 'profile', 'email'];

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'lax' },
}));

app.get('/auth/login', async (req, res) => {
  try {
    const url = await msalClient.getAuthCodeUrl({ scopes: SCOPES, redirectUri: REDIRECT_URI });
    res.redirect(url);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Authentication error — check server logs');
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const result = await msalClient.acquireTokenByCode({
      code: req.query.code,
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
    });
    req.session.account = result.account;
    res.redirect('/');
  } catch (err) {
    console.error('Callback error:', err);
    res.redirect('/auth/login');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Protect all routes — redirect to Microsoft login if not authenticated
app.use((req, res, next) => {
  if (req.session.account) return next();
  res.redirect('/auth/login');
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
