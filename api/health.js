const { setCors, handleOptions } = require('../lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  res.status(200).json({ status: 'ok', service: 'fomo-backend', timestamp: new Date().toISOString() });
};
