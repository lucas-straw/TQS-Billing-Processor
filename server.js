const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { OIDCStrategy } = require('passport-azure-ad');
const path = require('path');

const app = express();

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new OIDCStrategy({
  identityMetadata: `https://login.microsoftonline.com/${process.env.TENANT_ID}/v2.0/.well-known/openid-configuration`,
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  responseType: 'code',
  responseMode: 'query',
  redirectUrl: process.env.REDIRECT_URI,
  allowHttpForRedirectUrl: false,
  scope: ['openid', 'profile', 'email'],
}, (iss, sub, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Auth routes
app.get('/auth/login', passport.authenticate('azuread-openidconnect'));
app.get('/auth/callback',
  passport.authenticate('azuread-openidconnect', { failureRedirect: '/auth/login' }),
  (req, res) => res.redirect('/')
);
app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// Protect everything
app.use((req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.redirect('/auth/login');
});

// Serve the app
app.use(express.static(path.join(__dirname, 'public')));

app.listen(process.env.PORT || 3000);
