// server/middleware/auth.js
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer'))
      token = req.headers.authorization.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please log in.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select('-password');
    if (!user)          return res.status(401).json({ success: false, message: 'User no longer exists.' });
    if (!user.isActive) return res.status(401).json({ success: false, message: 'Account deactivated.' });

    req.user = user;
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid token.';
    res.status(401).json({ success: false, message: msg });
  }
};

const protectAdmin = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer'))
      token = req.headers.authorization.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Admin access required.' });

    const decoded = jwt.verify(token, process.env.JWT_ADMIN_SECRET);
    const user    = await User.findById(decoded.id).select('-password');
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admins only.' });
    if (!user.isActive) return res.status(401).json({ success: false, message: 'Admin account deactivated.' });

    req.user = user;
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Admin session expired.' : 'Invalid admin token.';
    res.status(401).json({ success: false, message: msg });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer'))
      token = req.headers.authorization.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    }
  } catch (_) {}
  next();
};

const signUserToken  = (id) => jwt.sign({ id }, process.env.JWT_SECRET,       { expiresIn: process.env.JWT_EXPIRES_IN       || '7d' });
const signAdminToken = (id) => jwt.sign({ id }, process.env.JWT_ADMIN_SECRET,  { expiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '1d' });

module.exports = { protect, protectAdmin, optionalAuth, signUserToken, signAdminToken };
