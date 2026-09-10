const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Like requireAuth, but a missing/invalid token isn't an error — it just proceeds
// without req.userId set. Used by routes that must work for both logged-in and
// anonymous callers (guest Polar checkout).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    try {
      req.userId = jwt.verify(token, process.env.JWT_SECRET).sub;
    } catch (err) {
      // Invalid/expired token from an anonymous caller — proceed as guest rather than reject.
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
